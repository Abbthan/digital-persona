#!/usr/bin/env python3
"""Verify cloned speech and aggregate timing without printing private audio."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import requests


def zero_runs_ms(pcm: np.ndarray, sample_rate: int) -> list[int]:
    silent = pcm == 0
    padded = np.pad(silent.astype(np.int8), (1, 1))
    edges = np.flatnonzero(np.diff(padded))
    runs = (edges[1::2] - edges[::2]) * 1000 / sample_rate
    return [round(float(value)) for value in runs if value >= 100]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://127.0.0.1:9880/inference_auto")
    parser.add_argument("--voice-reference", type=Path, required=True)
    parser.add_argument("--prompt-text", default="Reference voice for ECHO.")
    parser.add_argument("--speech-profile", type=Path, required=True)
    parser.add_argument("--language", choices=("en", "zh"), default="en")
    parser.add_argument("--text", default="Wait, I remember. Actually... yes")
    args = parser.parse_args()

    profile = json.loads(args.speech_profile.read_text(encoding="utf-8"))
    with args.voice_reference.open("rb") as reference:
        response = requests.post(
            args.endpoint,
            data={
                "tts_text": args.text,
                "prompt_text": args.prompt_text,
                "voice_key": "echo-prosody-verifier",
                "language": args.language,
                "speed": str(profile.get("speed_factor", 1.0)),
                "speech_profile": json.dumps(profile, separators=(",", ":")),
            },
            files={"prompt_wav": (args.voice_reference.name, reference, "audio/wav")},
            timeout=(10, 180),
        )
    if response.status_code != 200:
        raise RuntimeError(f"CosyVoice returned HTTP {response.status_code}: {response.text[:500]}")
    pcm = np.frombuffer(response.content[: len(response.content) - len(response.content) % 2], dtype="<i2")
    if pcm.size == 0 or int(np.max(np.abs(pcm.astype(np.int32)))) < 100:
        raise RuntimeError("CosyVoice returned empty or near-silent audio")
    sample_rate = int(response.headers.get("X-Audio-Sample-Rate", "16000"))
    result = {
        "ok": True,
        "language": response.headers.get("X-CosyVoice-Language"),
        "mode": response.headers.get("X-CosyVoice-Mode"),
        "duration_seconds": round(pcm.size / sample_rate, 3),
        "peak": int(np.max(np.abs(pcm.astype(np.int32)))),
        "inserted_pause_candidates_ms": zero_runs_ms(pcm, sample_rate),
        "profile_confidence": profile.get("confidence"),
        "profile_speed_factor": profile.get("speed_factor"),
        "profile_short_pause_ms": profile.get("median_short_pause_ms"),
        "profile_long_pause_ms": profile.get("median_long_pause_ms"),
    }
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
