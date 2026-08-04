from __future__ import annotations

import math
import re
from dataclasses import dataclass


_HAN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_WENET_ENGINE = "wenetspeech-wu-conformer-u2pp"


@dataclass(frozen=True)
class TranscriptCandidate:
    text: str
    engine: str
    language: str | None = None
    language_probability: float | None = None
    confidence: float | None = None


def _bounded_probability(value: float | None) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return max(0.0, min(1.0, value))


def han_ratio(text: str) -> float:
    visible = [character for character in text if not character.isspace()]
    if not visible:
        return 0.0
    return sum(bool(_HAN_RE.fullmatch(character)) for character in visible) / len(visible)


def choose_transcript(
    fallback: TranscriptCandidate,
    wu_text: str,
    wu_confidence: float | None,
) -> TranscriptCandidate:
    """Choose Wu ASR only when the acoustic/language evidence supports it.

    FastWhisper remains authoritative for confidently non-Chinese speech.
    WenetSpeech-Wu is preferred for Chinese/Wu speech and can recover a Wu
    utterance that Whisper classified uncertainly. Cross-model raw decode
    scores are intentionally not compared; only WeNet's normalized confidence
    and language/script evidence are used.
    """

    fallback_text = fallback.text.strip()
    dialect_text = wu_text.strip()
    confidence = _bounded_probability(wu_confidence)
    if not dialect_text or han_ratio(dialect_text) < 0.45:
        return TranscriptCandidate(
            fallback_text,
            fallback.engine,
            fallback.language,
            _bounded_probability(fallback.language_probability),
            fallback.confidence,
        )

    language = (fallback.language or "").lower()
    language_probability = _bounded_probability(fallback.language_probability)
    fallback_looks_chinese = han_ratio(fallback_text) >= 0.30
    chinese_language = language in {"zh", "yue", "wuu", "cmn"}
    whisper_is_uncertain = language_probability is None or language_probability < 0.82
    wu_is_usable = confidence is None or confidence >= 0.35
    wu_is_strong = confidence is not None and confidence >= 0.62

    if wu_is_usable and (chinese_language or fallback_looks_chinese):
        return TranscriptCandidate(dialect_text, _WENET_ENGINE, "wuu", None, confidence)
    if wu_is_strong and (not fallback_text or whisper_is_uncertain):
        return TranscriptCandidate(dialect_text, _WENET_ENGINE, "wuu", None, confidence)
    return TranscriptCandidate(
        fallback_text,
        fallback.engine,
        fallback.language,
        language_probability,
        fallback.confidence,
    )
