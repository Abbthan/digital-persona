from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import urlparse

if TYPE_CHECKING:
    from aiohttp import ClientSession
else:
    ClientSession = Any


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
ALLOWED_APP_HOSTS = {"echodigitalpersona.com", "www.echodigitalpersona.com"}


def safe_filename(value: str, fallback: str = "upload.bin") -> str:
    name = SAFE_NAME_RE.sub("_", Path(value).name).strip("._")
    return name[:180] or fallback


def validate_private_media_url(url: str, allowed_hosts: set[str] | None = None) -> None:
    parsed = urlparse(url)
    hosts = allowed_hosts or ALLOWED_APP_HOSTS
    if parsed.scheme != "https" or parsed.hostname not in hosts:
        raise ValueError("media URL is not an approved ECHO HTTPS endpoint")
    if not parsed.path.startswith("/api/internal/persona-media/"):
        raise ValueError("media URL is not an ECHO persona-media endpoint")


async def download_private_media(
    session: ClientSession,
    url: str,
    bearer_token: str,
    destination: Path,
    *,
    max_bytes: int = 110 * 1024 * 1024,
) -> Path:
    validate_private_media_url(url)
    destination.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    async with session.get(url, headers={"Authorization": f"Bearer {bearer_token}"}) as response:
        if response.status != 200:
            raise ValueError(f"private media endpoint returned HTTP {response.status}")
        with destination.open("wb") as output:
            async for chunk in response.content.iter_chunked(256 * 1024):
                written += len(chunk)
                if written > max_bytes:
                    raise ValueError("private media exceeds the GPU gateway size limit")
                output.write(chunk)
    if written == 0:
        raise ValueError("private media endpoint returned an empty file")
    return destination


async def run_ffmpeg(*arguments: str, timeout_seconds: int = 120) -> None:
    process = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        *arguments,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        _stdout, stderr = await asyncio.wait_for(process.communicate(), timeout_seconds)
    except TimeoutError:
        process.kill()
        await process.wait()
        raise ValueError("media conversion timed out")
    if process.returncode != 0:
        detail = stderr.decode("utf-8", "replace").strip()[-800:]
        raise ValueError(f"media conversion failed: {detail}")


async def canonical_avatar_video(source: Path, destination: Path) -> Path:
    image_extensions = {".jpg", ".jpeg", ".png"}
    video_extensions = {".mp4", ".mov", ".webm", ".mkv", ".avi"}
    extension = source.suffix.lower()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if extension in image_extensions:
        await run_ffmpeg(
            "-loop", "1", "-i", os.fspath(source), "-t", "3", "-r", "25",
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-an", "-movflags", "+faststart", os.fspath(destination),
        )
    elif extension in video_extensions:
        await run_ffmpeg(
            "-i", os.fspath(source), "-map", "0:v:0", "-an", "-vf", "fps=25",
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", os.fspath(destination),
        )
    else:
        raise ValueError("avatar source must be JPG, PNG, MP4, MOV, WebM, MKV, or AVI")
    if not destination.is_file() or destination.stat().st_size == 0:
        raise ValueError("avatar conversion produced no MP4 output")
    return destination


async def canonical_voice_reference(source: Path, destination: Path) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    await run_ffmpeg(
        "-i", os.fspath(source), "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", os.fspath(destination),
    )
    if not destination.is_file() or destination.stat().st_size <= 44:
        raise ValueError("voice conversion produced no WAV audio")
    return destination
