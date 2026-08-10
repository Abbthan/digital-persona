#!/usr/bin/env python3
"""Create aggregate timing sidecars for existing private voice references.

Run on the GPU host after patch 0026. The script deliberately never prints or
persists transcript content; only the bounded numeric speech profile is saved.
"""

from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

import requests


def write_profile(reference: Path, endpoint: str) -> tuple[str, str]:
    with reference.open("rb") as audio:
        response = requests.post(
            endpoint,
            data={"dialect": "auto"},
            files={"audio": (reference.name, audio, "audio/wav")},
            timeout=(5, 90),
        )
    response.raise_for_status()
    profile = response.json().get("speech_profile")
    if not isinstance(profile, dict):
        raise ValueError("transcription response did not contain a speech profile")

    destination = reference.with_suffix(".speech.json")
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix="speech_profile_", suffix=".json", dir=destination.parent
    )
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as output:
            json.dump(profile, output, ensure_ascii=False, separators=(",", ":"))
        os.replace(temporary_name, destination)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    return profile.get("confidence", "unknown"), profile.get("language", "unknown")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--voice-ref-dir",
        default="/data/echodigitalpersona/LiveTalking/data/voice_refs",
    )
    parser.add_argument("--endpoint", default="http://127.0.0.1:9880/transcribe")
    args = parser.parse_args()

    references = sorted(Path(args.voice_ref_dir).glob("*.wav"))
    for reference in references:
        confidence, language = write_profile(reference, args.endpoint)
        print(f"{reference.stem}: profile={confidence} language={language}")
    print(f"processed={len(references)}")


if __name__ == "__main__":
    main()
