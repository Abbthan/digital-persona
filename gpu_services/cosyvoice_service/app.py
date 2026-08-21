from __future__ import annotations

import json
import logging
import os
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Iterator

import numpy as np
import torch
import torchaudio
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from .logic import (
    clamp_speed,
    cosine_fade_int16,
    normalize_language,
    select_inference_mode,
    silence_pcm16,
    split_text_with_pauses,
)


LOGGER = logging.getLogger("echo-cosyvoice")
COSYVOICE_ROOT = Path(os.environ.get("COSYVOICE_ROOT", "/home/user/echo/source/CosyVoice")).resolve()
MODEL_DIR = os.environ.get("COSYVOICE_MODEL_DIR", "/home/user/echo/models/CosyVoice2-0.5B")
OUTPUT_SAMPLE_RATE = 16_000
DECLICK_FADE_SAMPLES = round(0.015 * OUTPUT_SAMPLE_RATE)  # 15ms, applied at every clause splice

sys.path.insert(0, str(COSYVOICE_ROOT))
sys.path.insert(0, str(COSYVOICE_ROOT / "third_party" / "Matcha-TTS"))

from cosyvoice.cli.cosyvoice import AutoModel  # noqa: E402
app = FastAPI(title="ECHO CosyVoice service")
MODEL = AutoModel(
    model_dir=MODEL_DIR,
    load_jit=os.environ.get("COSYVOICE_LOAD_JIT", "0") == "1",
    load_trt=os.environ.get("COSYVOICE_LOAD_TRT", "0") == "1",
    fp16=os.environ.get("COSYVOICE_FP16", "1") == "1",
)
INFERENCE_LOCK = threading.Lock()
CACHED_VOICES: set[str] = set()


def _safe_voice_key(value: str) -> str:
    key = "".join(character for character in (value or "") if character.isalnum() or character in "_-.")
    if not key or len(key) > 180:
        raise HTTPException(status_code=400, detail="a valid voice_key is required")
    return key


def _clause_pcm(outputs: Iterator[dict]) -> np.ndarray:
    """Concatenates one clause's model output tensor(s) into int16 PCM.

    CosyVoice emits one tensor per normalized text segment. Resampling each
    arbitrary network chunk (instead of the complete tensor) was the cause of
    earlier truncated/choppy playback, so all pieces are joined in the float
    domain and quantized once.
    """

    pieces: list[torch.Tensor] = []
    for output in outputs:
        speech = output["tts_speech"].detach().to(dtype=torch.float32, device="cpu").reshape(-1)
        if MODEL.sample_rate != OUTPUT_SAMPLE_RATE:
            speech = torchaudio.functional.resample(speech, MODEL.sample_rate, OUTPUT_SAMPLE_RATE)
        pieces.append(speech)
    if not pieces:
        return np.zeros(0, dtype=np.int16)
    speech = torch.cat(pieces)
    return (
        speech.clamp(-1.0, 1.0)
        .mul(32767.0)
        .round()
        .to(dtype=torch.int16)
        .numpy()
        .astype(np.dtype("<i2"), copy=False)
    )


def _stream_pcm_blocks(pcm: np.ndarray, block_bytes: int = 6_400) -> Iterator[bytes]:
    """Yields fixed-size (200 ms) PCM blocks for HTTP transport only.

    This chunking is purely for streaming delivery, not a synthesis or
    splice boundary -- clause-edge fades are already baked into `pcm` by
    cosine_fade_int16 before it ever reaches this function.
    """

    raw = pcm.tobytes()
    for offset in range(0, len(raw), block_bytes):
        yield raw[offset : offset + block_bytes]


def _cache_voice(voice_key: str, prompt_text: str, prompt_file) -> None:
    if not prompt_text.strip():
        raise HTTPException(status_code=422, detail="the voice reference needs a transcript")
    # CosyVoice reads the prompt twice (24 kHz features, then 16 kHz speech
    # tokens). A multipart SpooledTemporaryFile remains at EOF after the first
    # read, so the second decoder reports an unrecognised format. Give the
    # frontend a stable path it can reopen for each pass.
    prompt_file.seek(0)
    with tempfile.NamedTemporaryFile(suffix=".wav") as prompt_copy:
        shutil.copyfileobj(prompt_file, prompt_copy)
        prompt_copy.flush()
        MODEL.add_zero_shot_spk(prompt_text.strip(), prompt_copy.name, voice_key)
    CACHED_VOICES.add(voice_key)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "echo-cosyvoice",
        "model": MODEL_DIR,
        "input_sample_rate": MODEL.sample_rate,
        "output_sample_rate": OUTPUT_SAMPLE_RATE,
        "fp16": bool(getattr(MODEL, "fp16", False)),
        "cached_voices": len(CACHED_VOICES),
    }


@app.post("/cache_voice")
def cache_voice(
    voice_key: str = Form(),
    prompt_text: str = Form(),
    prompt_wav: UploadFile = File(),
) -> dict:
    key = _safe_voice_key(voice_key)
    with INFERENCE_LOCK:
        _cache_voice(key, prompt_text, prompt_wav.file)
    return {"ok": True, "voice_key": key}


@app.post("/inference_auto")
def inference_auto(
    tts_text: str = Form(),
    prompt_text: str = Form(default=""),
    voice_key: str = Form(),
    language: str = Form(default="auto"),
    speed: str = Form(default="1.0"),
    speech_profile: str = Form(default=""),
    prompt_wav: UploadFile | None = File(default=None),
) -> StreamingResponse:
    text = tts_text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="tts_text is required")
    key = _safe_voice_key(voice_key)
    selected_language = normalize_language(language, text)
    selected_mode = select_inference_mode(text, prompt_text, selected_language)
    selected_speed = clamp_speed(speed)
    try:
        parsed_profile = json.loads(speech_profile) if speech_profile else None
    except (TypeError, ValueError, json.JSONDecodeError):
        parsed_profile = None
    if not isinstance(parsed_profile, dict):
        parsed_profile = None
    if key not in CACHED_VOICES:
        if prompt_wav is None:
            raise HTTPException(status_code=409, detail="voice reference is not cached")
        with INFERENCE_LOCK:
            if key not in CACHED_VOICES:
                _cache_voice(key, prompt_text, prompt_wav.file)

    def generate() -> Iterator[bytes]:
        started = time.perf_counter()
        first = True
        with INFERENCE_LOCK:
            for clause, pause_after in split_text_with_pauses(text, parsed_profile):
                if selected_mode == "zero_shot":
                    outputs = MODEL.inference_zero_shot(
                        clause,
                        prompt_text,
                        torch.empty(0),
                        zero_shot_spk_id=key,
                        stream=False,
                        speed=selected_speed,
                    )
                else:
                    outputs = MODEL.inference_cross_lingual(
                        clause,
                        torch.empty(0),
                        zero_shot_spk_id=key,
                        stream=False,
                        speed=selected_speed,
                    )
                pcm = cosine_fade_int16(_clause_pcm(outputs), DECLICK_FADE_SAMPLES, DECLICK_FADE_SAMPLES)
                for block in _stream_pcm_blocks(pcm):
                    if first:
                        LOGGER.info(
                            "first PCM block voice=%s language=%s mode=%s latency_ms=%d",
                            key,
                            selected_language,
                            selected_mode,
                            round((time.perf_counter() - started) * 1000),
                        )
                        first = False
                    yield block
                if pause_after > 0:
                    yield from _stream_pcm_blocks(silence_pcm16(pause_after, OUTPUT_SAMPLE_RATE))

    return StreamingResponse(
        generate(),
        media_type="audio/L16",
        headers={
            "X-Audio-Sample-Rate": str(OUTPUT_SAMPLE_RATE),
            "X-CosyVoice-Language": selected_language,
            "X-CosyVoice-Mode": selected_mode,
        },
    )


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("COSYVOICE_PORT", "9880")))
