from __future__ import annotations

import random
import re
from typing import Any

import numpy as np


_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def contains_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text or ""))


def normalize_language(value: str, text: str) -> str:
    language = (value or "auto").strip().lower()
    if language in {"zh", "zh-cn", "mandarin", "wu", "chinese"}:
        return "zh"
    if language in {"en", "en-us", "en-gb", "english"}:
        return "en"
    return "zh" if contains_cjk(text) else "en"


def select_inference_mode(tts_text: str, prompt_text: str, language: str) -> str:
    """Choose the stable bilingual path for CosyVoice2.

    English zero-shot generation has produced near-silent output with the
    migrated voice reference, while the cross-lingual path remains healthy.
    Chinese can use zero-shot only when the reference transcript is Chinese;
    otherwise it also uses the cross-lingual path.
    """

    target = normalize_language(language, tts_text)
    if target == "en":
        return "cross_lingual"
    return "zero_shot" if contains_cjk(prompt_text) else "cross_lingual"


def clamp_speed(value: str | float | None) -> float:
    try:
        speed = float(value if value is not None else 1.0)
    except (TypeError, ValueError):
        speed = 1.0
    return min(1.2, max(0.8, speed))


# Punctuation-tiered pause durations (seconds), modeled on natural breath and
# thought boundaries rather than one fixed gap for every punctuation mark.
SHORT_PAUSE_RANGE = (0.15, 0.25)  # comma / 、，  -- a breath, not a stop
LONG_PAUSE_RANGE = (0.40, 0.60)  # . ! ? 。！？ -- end of a statement
PARAGRAPH_PAUSE_RANGE = (0.70, 0.90)  # ... / … / line break -- a beat between thoughts

_LONG_PAUSE_CHARS = set("。！？!?.")
_PAUSE_SPLIT_RE = re.compile(r"(\.\.\.|…|\n+|[，,、]|[。！？!?.])")


def _finite_milliseconds(profile: dict[str, Any] | None, key: str) -> float | None:
    if not profile or profile.get("version") != 1 or profile.get("confidence") not in {"medium", "high"}:
        return None
    try:
        value = float(profile.get(key))
    except (TypeError, ValueError):
        return None
    return value if np.isfinite(value) and value > 0 else None


def _jittered(value: float, low: float, high: float) -> float:
    """Keep learned timing human without allowing pathological gaps."""

    return min(high, max(low, value * random.uniform(0.94, 1.06)))


def _pause_for_delimiter(delimiter: str, profile: dict[str, Any] | None = None) -> float:
    measured_short = _finite_milliseconds(profile, "median_short_pause_ms")
    measured_long = _finite_milliseconds(profile, "median_long_pause_ms")
    if delimiter.startswith("...") or delimiter == "…" or delimiter.startswith("\n"):
        if measured_long is not None:
            return _jittered((measured_long / 1000.0) * 1.25, 0.60, 1.40)
        return random.uniform(*PARAGRAPH_PAUSE_RANGE)
    if delimiter in _LONG_PAUSE_CHARS:
        if measured_long is not None:
            return _jittered(measured_long / 1000.0, 0.30, 1.00)
        return random.uniform(*LONG_PAUSE_RANGE)
    if measured_short is not None:
        return _jittered(measured_short / 1000.0, 0.12, 0.45)
    return random.uniform(*SHORT_PAUSE_RANGE)


def split_text_with_pauses(
    text: str,
    speech_profile: dict[str, Any] | None = None,
) -> list[tuple[str, float]]:
    """Splits reply text at punctuation, pairing each clause with the pause
    (seconds) that should follow it once synthesized.

    Sending a whole reply to the TTS model in one call produces a flat,
    continuous stream with none of the rhythm real speech has. This mirrors
    how a person actually paces clauses: a short breath at a comma, a full
    stop at sentence-end punctuation, and a longer beat at an ellipsis or
    paragraph break. The last clause always carries a 0.0 pause -- there's
    nothing after it to pace against.
    """

    segments: list[tuple[str, float]] = []
    pending = ""
    for part in _PAUSE_SPLIT_RE.split(text or ""):
        if not part:
            continue
        if _PAUSE_SPLIT_RE.fullmatch(part):
            clause = pending.strip()
            if clause:
                segments.append((clause, _pause_for_delimiter(part, speech_profile)))
            pending = ""
        else:
            pending += part
    tail = pending.strip()
    if tail:
        segments.append((tail, 0.0))
    return segments


def silence_pcm16(duration_seconds: float, sample_rate: int) -> np.ndarray:
    sample_count = max(0, round(duration_seconds * sample_rate))
    return np.zeros(sample_count, dtype=np.int16)


def cosine_fade_int16(pcm: np.ndarray, fade_in_samples: int = 0, fade_out_samples: int = 0) -> np.ndarray:
    """Applies a raised-cosine ramp to the start/end of an int16 PCM buffer.

    Splicing synthesized clauses and inserted silence together on a hard
    sample-value discontinuity is audible as a click or pop at every pause.
    A short cosine ramp (as opposed to a linear one) removes that
    discontinuity without perceptibly dulling the clause's onset/offset at
    the short (~15ms) lengths used here.
    """

    if pcm.size == 0:
        return pcm
    samples = pcm.astype(np.float32)
    total = samples.size
    fade_in_samples = max(0, min(fade_in_samples, total))
    fade_out_samples = max(0, min(fade_out_samples, total))
    if fade_in_samples + fade_out_samples > total:
        # A very short clause: keep the ramps proportional so they meet in
        # the middle instead of both scaling the same overlapping samples.
        scale = total / (fade_in_samples + fade_out_samples)
        fade_in_samples = int(fade_in_samples * scale)
        fade_out_samples = total - fade_in_samples
    if fade_in_samples > 0:
        ramp = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, fade_in_samples, dtype=np.float32))
        samples[:fade_in_samples] *= ramp
    if fade_out_samples > 0:
        ramp = 0.5 + 0.5 * np.cos(np.linspace(0.0, np.pi, fade_out_samples, dtype=np.float32))
        samples[total - fade_out_samples :] *= ramp
    return np.clip(samples, -32768.0, 32767.0).astype(np.int16)
