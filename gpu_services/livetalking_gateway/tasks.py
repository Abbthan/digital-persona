from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path


AVATAR_ID_RE = re.compile(r"^persona_[A-Za-z0-9_-]{1,160}$")


def atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


class AvatarTaskStore:
    def __init__(self, jobs_dir: Path, service_root: Path, python_executable: Path):
        self.jobs_dir = jobs_dir.resolve()
        self.service_root = service_root.resolve()
        self.python_executable = python_executable.resolve()
        self.task_dir = self.jobs_dir / "avatar-tasks"
        self.task_dir.mkdir(parents=True, exist_ok=True)
        self._queue: asyncio.Queue[str] = asyncio.Queue()
        self._worker: asyncio.Task | None = None

    def state_path(self, task_id: str) -> Path:
        if not re.fullmatch(r"[0-9a-f-]{36}", task_id):
            raise ValueError("invalid task id")
        return self.task_dir / f"{task_id}.json"

    def get(self, task_id: str) -> dict | None:
        path = self.state_path(task_id)
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def readiness(self, avatar_id: str) -> str:
        if not AVATAR_ID_RE.fullmatch(avatar_id):
            return "missing"
        root = self.service_root / "data" / "avatars" / avatar_id
        required = [root / "coords.pkl", root / "mask_coords.pkl", root / "latents.pt"]
        has_frames = (root / "full_imgs").is_dir() and any((root / "full_imgs").glob("*.png"))
        has_masks = (root / "mask").is_dir() and any((root / "mask").glob("*.png"))
        return "completed" if has_frames and has_masks and all(path.is_file() for path in required) else "missing"

    async def start(self) -> None:
        if self._worker is None:
            self._worker = asyncio.create_task(self._run(), name="echo-avatar-task-worker")

    async def close(self) -> None:
        if self._worker is not None:
            self._worker.cancel()
            await asyncio.gather(self._worker, return_exceptions=True)
            self._worker = None

    async def submit(self, avatar_id: str, source: Path, idle_source: Path | None) -> str:
        if not AVATAR_ID_RE.fullmatch(avatar_id):
            raise ValueError("invalid avatar id")
        task_id = str(uuid.uuid4())
        now = time.time()
        state = {
            "task_id": task_id,
            "model_type": "musetalk",
            "avatar_id": avatar_id,
            "status": "pending",
            "progress": 1,
            "error_msg": "",
            "start_time": now,
            "end_time": None,
            "source": os.fspath(source.resolve()),
            "idle_source": os.fspath(idle_source.resolve()) if idle_source else None,
        }
        atomic_write_json(self.state_path(task_id), state)
        await self._queue.put(task_id)
        return task_id

    async def _run(self) -> None:
        while True:
            task_id = await self._queue.get()
            try:
                await self._execute(task_id)
            finally:
                self._queue.task_done()

    async def _execute(self, task_id: str) -> None:
        state = self.get(task_id)
        if state is None:
            return
        state.update(status="running", progress=max(1, int(state.get("progress") or 1)))
        atomic_write_json(self.state_path(task_id), state)
        helper = Path(__file__).with_name("train_avatar.py")
        command = [
            os.fspath(self.python_executable), os.fspath(helper),
            "--service-root", os.fspath(self.service_root),
            "--state", os.fspath(self.state_path(task_id)),
            "--avatar-id", state["avatar_id"],
            "--source", state["source"],
        ]
        if state.get("idle_source"):
            command.extend(["--idle-source", state["idle_source"]])
        process = await asyncio.create_subprocess_exec(
            *command,
            cwd=os.fspath(self.service_root),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        final_state = self.get(task_id) or state
        final_state["end_time"] = time.time()
        if process.returncode == 0 and self.readiness(state["avatar_id"]) == "completed":
            final_state.update(status="completed", progress=100, error_msg="")
        else:
            detail = stderr.decode("utf-8", "replace").strip()[-1400:]
            if not detail:
                detail = stdout.decode("utf-8", "replace").strip()[-1400:]
            final_state.update(status="failed", progress=min(99, int(final_state.get("progress") or 1)), error_msg=detail or "avatar generation failed")
        atomic_write_json(self.state_path(task_id), final_state)
