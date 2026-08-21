#!/usr/bin/env python3
"""Create aggregate timing sidecars for existing private voice references.

Run on the GPU host after patch 0026. The script deliberately never prints or
persists transcript content; only the bounded numeric speech profile is saved.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import requests

from gpu_services.livetalking_gateway.speech_profile import save_speech_profile


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

    destination = save_speech_profile(reference, profile)
    if destination is None:
        # Low-confidence recordings are deliberately not applied to live
        # synthesis; report them without leaving a stale cadence sidecar.
        return profile.get("confidence", "unknown"), profile.get("language", "unknown")
    return profile.get("confidence", "unknown"), profile.get("language", "unknown")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--voice-ref-dir",
        default="/home/user/echo/services/livetalking/data/voice_refs",
    )
    parser.add_argument("--endpoint", default="http://127.0.0.1:9891/transcribe")
    args = parser.parse_args()

    references = sorted(Path(args.voice_ref_dir).glob("*.wav"))
    for reference in references:
        confidence, language = write_profile(reference, args.endpoint)
        print(f"{reference.stem}: profile={confidence} language={language}")
    print(f"processed={len(references)}")


if __name__ == "__main__":
    main()
