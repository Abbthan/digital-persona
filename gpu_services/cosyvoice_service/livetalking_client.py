from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Iterator

import numpy as np
import requests

from registry import register
from utils.logger import logger

from .base_tts import BaseTTS, State


@register("tts", "cosyvoice")
class CosyVoiceTTS(BaseTTS):
    """Sample-preserving client for ECHO's 16 kHz CosyVoice service."""

    def __init__(self, opt, parent):
        super().__init__(opt, parent)
        self._cached_voice_keys: set[str] = set()
        self._http = requests.Session()
        self._speech_profile_cache: dict[str, tuple[int, dict]] = {}

    @staticmethod
    def _voice_key(ref_file: str) -> str:
        path = Path(ref_file)
        identity = f"{path.resolve()}:{path.stat().st_size}:{path.stat().st_mtime_ns}"
        return "echo-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32]

    def txt_to_audio(self, msg: tuple[str, dict]):
        text, event = msg
        tts_options = event.get("tts", {})
        ref_file = tts_options.get("ref_file", self.opt.REF_FILE)
        ref_text = tts_options.get("ref_text", self.opt.REF_TEXT)
        language = tts_options.get("language", "auto")
        speech_profile = self._speech_profile(ref_file)
        speed = tts_options.get("speed", speech_profile.get("speed_factor", 1.0))
        voice_key = tts_options.get("voice_key") or self._voice_key(ref_file)
        self._stream_pcm(
            self._request_audio(
                text,
                ref_file,
                ref_text,
                voice_key,
                language,
                speed,
                speech_profile,
            ),
            msg,
        )

    def _speech_profile(self, ref_file: str) -> dict:
        profile_path = Path(ref_file).with_suffix(".speech-profile.json")
        try:
            modified = profile_path.stat().st_mtime_ns
        except OSError:
            return {}
        cache_key = str(profile_path.resolve())
        cached = self._speech_profile_cache.get(cache_key)
        if cached and cached[0] == modified:
            return cached[1]
        try:
            profile = json.loads(profile_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return {}
        if not isinstance(profile, dict) or profile.get("version") != 1:
            return {}
        self._speech_profile_cache[cache_key] = (modified, profile)
        return profile

    def _request_once(
        self,
        text,
        ref_file,
        ref_text,
        voice_key,
        language,
        speed,
        speech_profile,
        include_reference,
    ):
        data = {
            "tts_text": text,
            "prompt_text": ref_text,
            "voice_key": voice_key,
            "language": language,
            "speed": str(speed),
            "speech_profile": json.dumps(speech_profile, separators=(",", ":")) if speech_profile else "",
        }
        files = None
        file_handle = None
        if include_reference:
            file_handle = open(ref_file, "rb")
            files = {"prompt_wav": (Path(ref_file).name, file_handle, "audio/wav")}
        try:
            return self._http.post(
                f"{self.opt.TTS_SERVER.rstrip('/')}/inference_auto",
                data=data,
                files=files,
                stream=True,
                timeout=(5, 240),
            )
        finally:
            if file_handle is not None:
                file_handle.close()

    def _request_audio(
        self,
        text,
        ref_file,
        ref_text,
        voice_key,
        language,
        speed,
        speech_profile,
    ) -> Iterator[bytes]:
        started = time.perf_counter()
        include_reference = voice_key not in self._cached_voice_keys
        response = self._request_once(
            text,
            ref_file,
            ref_text,
            voice_key,
            language,
            speed,
            speech_profile,
            include_reference,
        )
        if response.status_code == 409 and not include_reference:
            response.close()
            response = self._request_once(
                text,
                ref_file,
                ref_text,
                voice_key,
                language,
                speed,
                speech_profile,
                True,
            )
            include_reference = True
        if response.status_code != 200:
            detail = response.text[:1000]
            response.close()
            raise RuntimeError(f"CosyVoice returned HTTP {response.status_code}: {detail}")
        if include_reference:
            self._cached_voice_keys.add(voice_key)
        first = True
        try:
            for block in response.iter_content(chunk_size=6_400):
                if block and self.state == State.RUNNING:
                    if first:
                        logger.info("CosyVoice first audio bytes in %.3fs", time.perf_counter() - started)
                        first = False
                    yield block
        finally:
            response.close()

    def _stream_pcm(self, audio_stream: Iterator[bytes], msg: tuple[str, dict]):
        text, event = msg
        byte_buffer = bytearray()
        sample_buffer = np.empty(0, dtype=np.float32)
        first_frame = True
        try:
            for block in audio_stream:
                byte_buffer.extend(block)
                even_length = len(byte_buffer) - (len(byte_buffer) % 2)
                if even_length:
                    samples = (
                        np.frombuffer(bytes(byte_buffer[:even_length]), dtype="<i2")
                        .astype(np.float32)
                        / 32767.0
                    )
                    del byte_buffer[:even_length]
                    sample_buffer = np.concatenate((sample_buffer, samples))
                while len(sample_buffer) >= self.chunk:
                    frame_event = dict(event)
                    if first_frame:
                        frame_event.update({"status": "start", "text": text})
                        first_frame = False
                    self.parent.put_audio_frame(sample_buffer[: self.chunk], frame_event)
                    sample_buffer = sample_buffer[self.chunk :]
                if self.state != State.RUNNING:
                    return
            if len(sample_buffer):
                final_frame = np.zeros(self.chunk, dtype=np.float32)
                final_frame[: len(sample_buffer)] = sample_buffer
                frame_event = dict(event)
                if first_frame:
                    frame_event.update({"status": "start", "text": text})
                    first_frame = False
                self.parent.put_audio_frame(final_frame, frame_event)
        except Exception:
            logger.exception("CosyVoice synthesis failed")
        finally:
            end_event = dict(event)
            end_event.update({"status": "end", "text": text})
            self.parent.put_audio_frame(np.zeros(self.chunk, dtype=np.float32), end_event)
