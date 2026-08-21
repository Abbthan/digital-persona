from __future__ import annotations

import re


SUPPORTED_PREFERENCES = {"auto", "english", "mandarin", "wu"}


def normalize_preference(value: str | None) -> str:
    candidate = (value or "auto").strip().lower()
    return candidate if candidate in SUPPORTED_PREFERENCES else "auto"


def forced_language(preference: str) -> str | None:
    normalized = normalize_preference(preference)
    if normalized == "english":
        return "en"
    if normalized in {"mandarin", "wu"}:
        return "zh"
    return None


def gate_transcript(text: str, preference: str) -> str:
    """Reject a strong cross-language hallucination without rewriting speech."""
    normalized = normalize_preference(preference)
    clean = text.strip()
    cjk_count = len(re.findall(r"[\u3400-\u9fff]", clean))
    latin_count = len(re.findall(r"[A-Za-z]", clean))
    if normalized == "english" and cjk_count > max(1, latin_count // 5):
        return ""
    if normalized in {"mandarin", "wu"} and latin_count > 2 and cjk_count == 0:
        return ""
    return clean
