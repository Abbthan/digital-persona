"""Durable, serial media transcription jobs outside the Cloudflare request."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import sqlite3
import tempfile
import time
import wave
from pathlib import Path
from typing import Callable

import httpx


def system_token(persona_id: str) -> str:
    encode = lambda data: base64.urlsafe_b64encode(data).rstrip(b"=").decode()
    payload = encode(json.dumps({"uid": "system", "pid": persona_id, "exp": time.time() + 600}, separators=(",", ":")).encode())
    signature = encode(hmac.new(os.environ["LIVETALKING_SESSION_SECRET"].encode(), payload.encode(), hashlib.sha256).digest())
    return payload + "." + signature


class MediaJobs:
    def __init__(self, path: str, consume: Callable) -> None:
        self.path, self.consume = path, consume
        with self.db() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS media_jobs (
                persona_id TEXT, asset_id TEXT, body TEXT, state TEXT,
                progress INTEGER, error TEXT, transcript TEXT, updated REAL,
                PRIMARY KEY(persona_id,asset_id))""")
            db.execute("UPDATE media_jobs SET state='queued' WHERE state='running'")

    def db(self):
        return sqlite3.connect(self.path, timeout=30)

    def enqueue(self, body: dict) -> dict:
        with self.db() as db:
            previous = db.execute("SELECT state,body FROM media_jobs WHERE persona_id=? AND asset_id=?", (body["persona_id"], body["asset_id"])).fetchone()
            serialized = json.dumps(body, sort_keys=True)
            if previous and previous[0] in {"queued", "running", "completed"} and previous[1] == serialized:
                return {"ok": True, "status": previous[0], "asset_id": body["asset_id"]}
            if previous and previous[0] == "running":
                raise ValueError("media source is currently processing; retry after completion")
            db.execute("INSERT OR REPLACE INTO media_jobs VALUES (?,?,?,'queued',0,'','',?)", (body["persona_id"], body["asset_id"], serialized, time.time()))
        return {"ok": True, "status": "queued", "asset_id": body["asset_id"]}

    def status(self, persona_id: str, asset_id: str) -> dict:
        with self.db() as db:
            db.row_factory = sqlite3.Row
            row = db.execute("SELECT state,progress,error,updated FROM media_jobs WHERE persona_id=? AND asset_id=?", (persona_id, asset_id)).fetchone()
        return dict(row) if row else {"state": "not_indexed", "progress": 0}

    def statuses(self, persona_id: str) -> dict[str, dict]:
        with self.db() as db:
            rows = db.execute("SELECT asset_id,state,progress,error FROM media_jobs WHERE persona_id=?", (persona_id,)).fetchall()
        return {asset_id: {"state": "no_speech" if state == "completed" and error.startswith("No ") else state,
                           "progress": progress} for asset_id, state, progress, error in rows}

    def cancel(self, persona_id: str, asset_id: str | None = None) -> None:
        with self.db() as db:
            if asset_id is None:
                db.execute("DELETE FROM media_jobs WHERE persona_id=?", (persona_id,))
            else:
                db.execute("DELETE FROM media_jobs WHERE persona_id=? AND asset_id=?", (persona_id, asset_id))

    def attribution(self, persona_id: str, asset_id: str) -> str:
        with self.db() as db:
            row = db.execute("SELECT body FROM media_jobs WHERE persona_id=? AND asset_id=?", (persona_id, asset_id)).fetchone()
        return json.loads(row[0]).get("target_authorship", "unknown") if row else "unknown"

    def attest(self, persona_id: str, asset_id: str, attribution: str) -> None:
        with self.db() as db:
            row = db.execute("SELECT body FROM media_jobs WHERE persona_id=? AND asset_id=?", (persona_id, asset_id)).fetchone()
            if row:
                body = json.loads(row[0])
                body["target_authorship"] = attribution
                db.execute("UPDATE media_jobs SET body=? WHERE persona_id=? AND asset_id=?", (json.dumps(body, sort_keys=True), persona_id, asset_id))

    def _update(self, body: dict, state: str, progress: int, error: str = "", transcript: str = "") -> None:
        with self.db() as db:
            db.execute("UPDATE media_jobs SET state=?,progress=?,error=?,transcript=?,updated=? WHERE persona_id=? AND asset_id=?", (state, progress, error, transcript, time.time(), body["persona_id"], body["asset_id"]))

    def _next(self):
        with self.db() as db:
            row = db.execute("SELECT body FROM media_jobs WHERE state='queued' ORDER BY updated LIMIT 1").fetchone()
        return json.loads(row[0]) if row else None

    async def run(self) -> None:
        while True:
            body = await asyncio.to_thread(self._next)
            if not body:
                await asyncio.sleep(2)
                continue
            try:
                self._update(body, "running", 1)
                await self.process(body)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                # Do not save private URLs, request headers or source text in errors.
                self._update(body, "failed", 0, type(error).__name__ + ": media transcription/indexing failed")

    async def process(self, body: dict) -> None:
        ffmpeg = os.environ.get("MEMORY_FFMPEG", "/home/user/echo/envs/livetalking/bin/ffmpeg")
        with tempfile.TemporaryDirectory(prefix="echo-memory-media-") as directory:
            root = Path(directory)
            source = root / "source.bin"
            async with httpx.AsyncClient(timeout=180, follow_redirects=False) as client:
                async with client.stream("GET", body["source_url"], headers={"Authorization": "Bearer " + system_token(body["persona_id"])}) as response:
                    response.raise_for_status()
                    size = 0
                    with source.open("wb") as target:
                        async for block in response.aiter_bytes(256 * 1024):
                            size += len(block)
                            if size > 110 * 1024 * 1024:
                                raise ValueError("media exceeds limit")
                            target.write(block)
                self._update(body, "running", 10)
                probe = await asyncio.create_subprocess_exec(str(Path(ffmpeg).with_name("ffprobe")), "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(source), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                try:
                    probe_output, _ = await asyncio.wait_for(probe.communicate(), 20)
                except BaseException:
                    probe.kill()
                    await probe.wait()
                    raise
                if probe.returncode == 0 and not probe_output.strip():
                    self._update(body, "completed", 100, "No audio track; no speaking-style evidence added.")
                    return
                process = await asyncio.create_subprocess_exec(
                    ffmpeg, "-hide_banner", "-loglevel", "error", "-i", str(source),
                    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
                    "-f", "segment", "-segment_time", "30", "-reset_timestamps", "1",
                    str(root / "part-%05d.wav"), stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                try:
                    code = await asyncio.wait_for(process.wait(), 180)
                except BaseException:
                    process.kill()
                    await process.wait()
                    raise
                if code:
                    raise ValueError("media has no decodable audio")
                parts = sorted(root.glob("part-*.wav"))
                if not parts or len(parts) > 40:
                    raise ValueError("media duration must not exceed 20 minutes")
                texts: list[str] = []
                segments: list[dict] = []
                offset = 0.0
                for index, part in enumerate(parts):
                    if self.status(body["persona_id"], body["asset_id"])["state"] == "not_indexed":
                        return
                    with part.open("rb") as audio:
                        result = await client.post(os.environ.get("MEMORY_STT_URL", "http://127.0.0.1:9891/transcribe"),
                            data={"dialect": "auto"}, files={"audio": (part.name, audio, "audio/wav")}, timeout=180)
                    result.raise_for_status()
                    text = str(result.json().get("text") or "").strip()
                    with wave.open(str(part), "rb") as wav:
                        duration = wav.getnframes() / wav.getframerate()
                    if text:
                        texts.append(text)
                        segments.append({"start": round(offset, 3), "end": round(offset + duration, 3), "text": text,
                                         "language": result.json().get("language"), "timing": "audio_chunk_not_word_alignment"})
                    offset += duration
                    self._update(body, "running", 15 + round(60 * (index + 1) / len(parts)))
                transcript = "\n".join(texts)
                if not transcript:
                    self._update(body, "completed", 100, "No intelligible speech; no speaking-style evidence added.")
                    return
                if self.status(body["persona_id"], body["asset_id"])["state"] == "not_indexed":
                    return
                await self.consume(body, transcript)
                self._update(body, "completed", 100, transcript=json.dumps({"text": transcript, "segments": segments}, ensure_ascii=False))
