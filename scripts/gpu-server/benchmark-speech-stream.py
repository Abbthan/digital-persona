#!/usr/bin/env python3
"""Measure sample-aligned TTS delivery without printing reference audio/text."""
from __future__ import annotations

import argparse
import json
import time
import wave
from pathlib import Path

import numpy as np
import requests

CASES = {
    "en_short": ("en", "Two plus three is five, man."),
    "en_reply": ("en", "That's a good one. Always loved that quote, the round pegs in square holes. Kind of feels like most of us, doesn't it? What made you share that with me?"),
    "zh_reply": ("zh", "你好，今天过得怎么样？我刚刚想起我们之前聊过的事情，想听听你的看法。"),
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voice-key", required=True)
    parser.add_argument("--endpoint", default="http://127.0.0.1:9880")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--voice-reference", type=Path)
    parser.add_argument("--prompt-file", type=Path)
    parser.add_argument("--speech-profile", type=Path)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("--transcribe", action="store_true")
    parser.add_argument("--cases", nargs="+", choices=CASES, default=list(CASES))
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    if args.voice_reference:
        with args.voice_reference.open("rb") as reference:
            response = requests.post(
                args.endpoint + "/cache_voice",
                data={"voice_key": args.voice_key, "prompt_text": args.prompt_file.read_text() if args.prompt_file else "Reference voice for ECHO."},
                files={"prompt_wav": ("reference.wav", reference, "audio/wav")},
                timeout=(5, 120),
            )
        response.raise_for_status()
    for name in args.cases:
        language, text = CASES[name]
        started = time.perf_counter()
        arrivals: list[tuple[float, int]] = []
        audio = bytearray()
        with requests.post(
            args.endpoint + "/inference_auto",
            data={"tts_text": text, "voice_key": args.voice_key, "language": language,
                  "speed": str(args.speed), "speech_profile": args.speech_profile.read_text() if args.speech_profile else ""},
            stream=True, timeout=(5, 180),
        ) as response:
            response.raise_for_status()
            rate = int(response.headers["X-Audio-Sample-Rate"])
            for block in response.iter_content(chunk_size=6400):
                if block:
                    audio.extend(block)
                    arrivals.append((time.perf_counter() - started, len(audio)))
        elapsed = time.perf_counter() - started
        assert len(audio) % 2 == 0 and audio, "empty/misaligned PCM"
        samples = np.frombuffer(audio, dtype="<i2")
        duration = len(samples) / rate
        first = arrivals[0][0]
        # Minimum startup delay after first packet that avoids any starvation.
        previous_bytes = 0
        required_buffer = 0.0
        for arrival, count in arrivals:
            required_buffer = max(required_buffer, arrival - first - previous_bytes / (2 * rate))
            previous_bytes = count
        output = args.output_dir / (name + ".wav")
        with wave.open(str(output), "wb") as wav:
            wav.setparams((1, 2, rate, 0, "NONE", "not compressed"))
            wav.writeframes(audio)
        report = {
            "case": name, "first_audio_ms": round(first * 1000),
            "elapsed_s": round(elapsed, 3), "audio_s": round(duration, 3),
            "rtf": round(elapsed / duration, 3),
            "required_prebuffer_ms": round(required_buffer * 1000),
            "peak": int(np.abs(samples.astype(np.int32)).max()),
            "packets": len(arrivals), "output": str(output),
        }
        if args.transcribe:
            with output.open("rb") as wav:
                transcription = requests.post("http://127.0.0.1:9891/transcribe",
                    data={"dialect": "english" if language == "en" else "mandarin"},
                    files={"audio": (output.name, wav, "audio/wav")}, timeout=(5, 90))
            transcription.raise_for_status()
            report["synthetic_transcript"] = transcription.json().get("text")
        print(json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
