from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


def atomic_write(path: Path, payload: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--service-root", required=True)
    parser.add_argument("--state", required=True)
    parser.add_argument("--avatar-id", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--idle-source")
    args = parser.parse_args()

    service_root = Path(args.service_root).resolve()
    state_path = Path(args.state).resolve()
    sys.path.insert(0, os.fspath(service_root))
    os.chdir(service_root)

    state = json.loads(state_path.read_text(encoding="utf-8"))

    def progress(value: int) -> None:
        state["status"] = "running"
        state["progress"] = max(1, min(99, int(value)))
        atomic_write(state_path, state)

    from avatars.musetalk.genavatar import generate_avatar

    avatar_root = service_root / "data" / "avatars" / args.avatar_id
    if avatar_root.exists():
        shutil.rmtree(avatar_root)
    generate_avatar(
        video_path=args.source,
        avatar_id=args.avatar_id,
        save_path=os.fspath(service_root / "data" / "avatars"),
        bbox_shift=0,
        extra_margin=10,
        parsing_mode="jaw",
        version="v15",
        progress_callback=progress,
    )

    idle_source = Path(args.idle_source).resolve() if args.idle_source else None
    idle_dir = avatar_root / "idle_imgs"
    idle_dir.mkdir(parents=True, exist_ok=True)
    if idle_source and idle_source.is_file():
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", os.fspath(idle_source),
                "-vf", "fps=25", os.fspath(idle_dir / "%08d.png"),
            ],
            check=True,
        )
    if not any(idle_dir.glob("*.png")):
        for source_frame in sorted((avatar_root / "full_imgs").glob("*.png")):
            shutil.copy2(source_frame, idle_dir / source_frame.name)
    state.update(status="completed", progress=100, error_msg="", end_time=time.time())
    atomic_write(state_path, state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
