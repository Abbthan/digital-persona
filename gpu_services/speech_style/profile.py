from __future__ import annotations

import json
import math
import re
import statistics
from typing import Any, Iterable

PROFILE_VERSION = 1
MIN_PAUSE_SECONDS = 0.18
MAX_PAUSE_SECONDS = 2.5

_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_EN_CONNECTOR_RE = re.compile(
    r"\s+(?=(?:and|but|because|so|then|actually|well|though|anyway)\b)",
    re.IGNORECASE,
)
_ZH_CONNECTOR_RE = re.compile(r"(?=(?:但是|不过|所以|然后|其实|而且|后来|嗯|呃))")
_CLAUSE_END_RE = re.compile(r"[,;:\u3001\uff0c\uff1b\uff1a]\s*")
_SENTENCE_END_RE = re.compile(r"[.!?\u3002\uff01\uff1f\u2026]+[\"'\u201d\u2019]?\s*")


def _finite_number(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _median(values: list[float], default: float) -> float:
    return float(statistics.median(values)) if values else default


def _token_units(text: str, language: str) -> int:
    if language.startswith(("zh", "yue")) or _CJK_RE.search(text):
        cjk = len(_CJK_RE.findall(text))
        return cjk or len([part for part in text.split() if part])
    return len(re.findall(r"[A-Za-z0-9]+(?:['\u2019-][A-Za-z0-9]+)*", text))


def _boundary_kind(text: str) -> str:
    stripped = text.rstrip()
    if re.search(r"[.!?\u3002\uff01\uff1f\u2026][\"'\u201d\u2019]?$", stripped):
        return "sentence"
    if re.search(r"[,;:\u3001\uff0c\uff1b\uff1a][\"'\u201d\u2019]?$", stripped):
        return "clause"
    return "unpunctuated"


def _normalise_words(segments: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in segments:
        for word in segment.get("words") or []:
            if not isinstance(word, dict):
                continue
            start = _finite_number(word.get("start"), -1)
            end = _finite_number(word.get("end"), -1)
            text = str(word.get("word") or word.get("text") or "")
            if start >= 0 and end > start and text.strip():
                words.append({"start": start, "end": end, "text": text})
    return sorted(words, key=lambda word: (word["start"], word["end"]))


def _normalise_segments(segments: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        start = _finite_number(segment.get("start"), -1)
        end = _finite_number(segment.get("end"), -1)
        text = str(segment.get("text") or "").strip()
        if start >= 0 and end > start and text:
            result.append({"start": start, "end": end, "text": text, "words": segment.get("words") or []})
    return sorted(result, key=lambda segment: (segment["start"], segment["end"]))


def build_speech_profile(segments: Iterable[dict[str, Any]], language: str | None = None) -> dict[str, Any]:
    """Measure tempo and break habits from timestamped, owner-authorized speech.

    The profile intentionally contains aggregate timing only—not transcript
    content or embeddings. Short/noisy samples remain low-confidence and are
    ignored by synthesis instead of turning one accidental hesitation into a
    permanent mannerism.
    """
    normalized_segments = _normalise_segments(segments)
    normalized_language = (language or "").lower() or "unknown"
    if not normalized_segments:
        return {
            "version": PROFILE_VERSION,
            "confidence": "low",
            "language": normalized_language,
            "sample_duration_seconds": 0.0,
            "speaking_rate": 0.0,
            "speaking_rate_unit": "characters_per_second" if normalized_language.startswith("zh") else "words_per_second",
            "speed_factor": 1.0,
            "pause_style": "balanced",
            "pauses_per_minute": 0.0,
            "observed_pause_count": 0,
            "median_short_pause_ms": 260,
            "median_long_pause_ms": 720,
            "long_pause_ratio": 0.0,
            "preferred_boundary": "sentence",
        }

    first_start = normalized_segments[0]["start"]
    last_end = max(segment["end"] for segment in normalized_segments)
    duration = max(0.0, last_end - first_start)
    transcript = " ".join(segment["text"] for segment in normalized_segments)
    units = _token_units(transcript, normalized_language)

    words = _normalise_words(normalized_segments)
    timed_items = words or normalized_segments
    pauses: list[tuple[float, str]] = []
    for previous, current in zip(timed_items, timed_items[1:]):
        gap = current["start"] - previous["end"]
        if MIN_PAUSE_SECONDS <= gap <= MAX_PAUSE_SECONDS:
            pauses.append((gap, _boundary_kind(previous["text"])))

    short_pauses = [gap for gap, _ in pauses if gap < 0.55]
    long_pauses = [gap for gap, _ in pauses if gap >= 0.55]
    pauses_per_minute = len(pauses) * 60.0 / duration if duration > 0 else 0.0
    rate = units / duration if duration > 0 else 0.0
    uses_characters = normalized_language.startswith(("zh", "yue")) or bool(_CJK_RE.search(transcript))
    neutral_rate = 4.0 if uses_characters else 2.55
    speed_factor = _clamp(rate / neutral_rate, 0.86, 1.14) if rate > 0 else 1.0

    if duration >= 20 and len(pauses) >= 5 and units >= 30:
        confidence = "high"
    elif duration >= 8 and len(pauses) >= 2 and units >= 12:
        confidence = "medium"
    else:
        confidence = "low"

    if pauses_per_minute < 7:
        pause_style = "sparse"
    elif pauses_per_minute > 18:
        pause_style = "frequent"
    else:
        pause_style = "balanced"

    boundary_counts = {"sentence": 0, "clause": 0, "unpunctuated": 0}
    for _, kind in pauses:
        boundary_counts[kind] += 1
    preferred_boundary = max(boundary_counts, key=boundary_counts.get) if pauses else "sentence"

    return {
        "version": PROFILE_VERSION,
        "confidence": confidence,
        "language": normalized_language,
        "sample_duration_seconds": round(duration, 2),
        "speaking_rate": round(rate, 3),
        "speaking_rate_unit": "characters_per_second" if uses_characters else "words_per_second",
        "speed_factor": round(speed_factor if confidence != "low" else 1.0, 3),
        "pause_style": pause_style,
        "pauses_per_minute": round(pauses_per_minute, 2),
        "observed_pause_count": len(pauses),
        "median_short_pause_ms": round(_median(short_pauses, 0.26) * 1000),
        "median_long_pause_ms": round(_median(long_pauses, 0.72) * 1000),
        "long_pause_ratio": round(len(long_pauses) / len(pauses), 3) if pauses else 0.0,
        "preferred_boundary": preferred_boundary,
    }


def normalize_speech_profile(value: Any) -> dict[str, Any] | None:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            return None
    if not isinstance(value, dict) or value.get("version") != PROFILE_VERSION:
        return None
    if value.get("confidence") not in {"medium", "high"}:
        return None
    return value


def _estimated_duration(text: str, profile: dict[str, Any]) -> float:
    language = str(profile.get("language") or "")
    units = _token_units(text, language)
    rate = _finite_number(profile.get("speaking_rate"), 0)
    return units / rate if rate > 0 else units / (4.0 if _CJK_RE.search(text) else 2.55)


def _candidate_breaks(text: str, preference: str) -> list[int]:
    patterns = [_SENTENCE_END_RE, _CLAUSE_END_RE]
    if preference == "clause":
        patterns.reverse()
    positions: list[int] = []
    for pattern in patterns:
        positions.extend(match.end() for match in pattern.finditer(text))
    connector_pattern = _ZH_CONNECTOR_RE if _CJK_RE.search(text) else _EN_CONNECTOR_RE
    positions.extend(match.start() for match in connector_pattern.finditer(text))
    return sorted({position for position in positions if 4 <= position <= len(text) - 4})


def condition_tts_text(text: str, profile_value: Any) -> tuple[str, float]:
    """Apply measured timing without restarting synthesis or deleting words.

    Punctuation and CosyVoice's documented ``[breath]`` token are inserted at
    existing phrase boundaries. The entire conditioned utterance still goes
    through one streaming inference call, preserving the continuity and lip
    sync fixes in the live pipeline.
    """
    clean = text.strip()
    profile = normalize_speech_profile(profile_value)
    if not clean or profile is None:
        return clean, 1.0

    speed = _clamp(_finite_number(profile.get("speed_factor"), 1.0), 0.86, 1.14)
    if profile.get("pause_style") != "frequent":
        return clean, speed

    duration = _estimated_duration(clean, profile)
    desired = int(round(_finite_number(profile.get("pauses_per_minute"), 0) * duration / 60.0))
    desired = max(0, min(2, desired))
    positions = _candidate_breaks(clean, str(profile.get("preferred_boundary") or "sentence"))
    if desired == 0 or not positions:
        return clean, speed

    # Spread additions across the utterance and insert right-to-left so index
    # positions stay valid. A real breath is used at most once, and only when
    # long gaps were common in the source; other learned breaks use an
    # ellipsis, which preserves every spoken word while cueing a softer pause.
    selected: list[int] = []
    for slot in range(desired):
        index = min(len(positions) - 1, round((slot + 1) * len(positions) / (desired + 1)) - 1)
        position = positions[max(0, index)]
        if position not in selected:
            selected.append(position)
    use_breath = _finite_number(profile.get("long_pause_ratio"), 0) >= 0.35
    conditioned = clean
    for insertion_index, position in enumerate(sorted(selected, reverse=True)):
        marker = "[breath]" if use_breath and insertion_index == 0 else "\u2026"
        conditioned = f"{conditioned[:position]}{marker}{conditioned[position:]}"
    return conditioned, speed


def speech_style_summary(profile_value: Any) -> str | None:
    profile = normalize_speech_profile(profile_value)
    if profile is None:
        return None
    rate = _finite_number(profile.get("speaking_rate"), 0)
    unit = "Chinese characters/second" if profile.get("speaking_rate_unit") == "characters_per_second" else "English words/second"
    boundary = str(profile.get("preferred_boundary") or "sentence")
    return (
        "Measured source-speech timing style (aggregate timing, not inferred biography): "
        f"{profile.get('pause_style', 'balanced')} pauses, about {profile.get('pauses_per_minute', 0)} pauses/minute; "
        f"median short break {profile.get('median_short_pause_ms', 260)} ms and long break "
        f"{profile.get('median_long_pause_ms', 720)} ms; preferred breaks at {boundary} boundaries; "
        f"speaking rate {rate:.2f} {unit}. "
        "Match these pause and phrase-break habits naturally in both English and Chinese when supported; "
        "do not mention this measurement or turn pauses into stage directions."
    )
