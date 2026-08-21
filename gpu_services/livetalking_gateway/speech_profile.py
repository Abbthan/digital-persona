from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


def profile_path_for_voice(voice_path: Path) -> Path:
    return voice_path.with_suffix(".speech-profile.json")


def save_speech_profile(voice_path: Path, value: Any) -> Path | None:
    """Atomically persist aggregate timing beside a private voice reference.

    The file contains no transcript or embedding. Invalid/low-confidence
    profiles remove an older derived profile so stale cadence is never reused
    after a replacement recording.
    """

    destination = profile_path_for_voice(voice_path)
    if not isinstance(value, dict) or value.get("version") != 1 or value.get("confidence") not in {"medium", "high"}:
        destination.unlink(missing_ok=True)
        return None

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f".{destination.name}.{os.urandom(6).hex()}.tmp")
    try:
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.chmod(0o600)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination
