#!/usr/bin/env python3
"""Exercise bilingual TTS -> STT and Wu routing without retaining audio."""

from __future__ import annotations

import argparse
import json
import tempfile
import time
import wave
from pathlib import Path

import requests


def synthesize(
    endpoint: str,
    voice_reference: Path,
    text: str,
    language: str,
    destination: Path,
) -> dict[str, object]:
    started = time.perf_counter()
    with voice_reference.open("rb") as reference:
        response = requests.post(
            endpoint,
            data={
                "tts_text": text,
                "prompt_text": "Reference voice for ECHO.",
                "voice_key": "echo-stt-roundtrip",
                "language": language,
                "speed": "1.0",
            },
            files={"prompt_wav": (voice_reference.name, reference, "audio/wav")},
            timeout=(10, 180),
        )
    response.raise_for_status()
    sample_rate = int(response.headers.get("X-Audio-Sample-Rate", "16000"))
    if not response.content:
        raise RuntimeError(f"CosyVoice returned empty {language} audio")
    with wave.open(str(destination), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(response.content)
    return {
        "language": language,
        "seconds": round(time.perf_counter() - started, 3),
        "audio_seconds": round(len(response.content) / 2 / sample_rate, 3),
        "bytes": len(response.content),
    }


def transcribe(endpoint: str, audio_path: Path, dialect: str) -> dict[str, object]:
    started = time.perf_counter()
    with audio_path.open("rb") as audio:
        response = requests.post(
            endpoint,
            data={"dialect": dialect},
            files={"audio": (audio_path.name, audio, "audio/wav")},
            timeout=(10, 180),
        )
    elapsed = round(time.perf_counter() - started, 3)
    if response.status_code != 200:
        raise RuntimeError(f"{dialect} STT returned HTTP {response.status_code}: {response.text[:500]}")
    payload = response.json()
    return {
        "dialect": dialect,
        "seconds": elapsed,
        "text": payload.get("text"),
        "engine": payload.get("engine"),
        "language": payload.get("language"),
        "model_latency_ms": payload.get("latency_ms"),
        "wu_engine": (payload.get("wu") or {}).get("engine") if isinstance(payload.get("wu"), dict) else None,
        "wu_latency_ms": (payload.get("wu") or {}).get("latency_ms")
        if isinstance(payload.get("wu"), dict)
        else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tts-endpoint", default="http://127.0.0.1:9880/inference_auto")
    parser.add_argument("--stt-endpoint", default="http://127.0.0.1:9891/transcribe")
    parser.add_argument("--voice-reference", type=Path, required=True)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory(prefix="echo-stt-roundtrip-") as temporary:
        root = Path(temporary)
        english_path = root / "english.wav"
        mandarin_path = root / "mandarin.wav"
        synthesis = [
            synthesize(
                args.tts_endpoint,
                args.voice_reference,
                "Hello, this is a speech recognition test.",
                "en",
                english_path,
            ),
            synthesize(
                args.tts_endpoint,
                args.voice_reference,
                "你好，这是一次普通话语音识别测试。",
                "zh",
                mandarin_path,
            ),
        ]
        recognition = [
            transcribe(args.stt_endpoint, english_path, "english"),
            transcribe(args.stt_endpoint, mandarin_path, "mandarin"),
            # A Mandarin sample should normally retain the safe Whisper result,
            # but this still proves that the Wu model was invoked and returned.
            transcribe(args.stt_endpoint, mandarin_path, "wu"),
        ]

    print(json.dumps({"ok": True, "synthesis": synthesis, "recognition": recognition}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
