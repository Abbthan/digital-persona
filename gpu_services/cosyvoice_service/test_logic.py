import numpy as np

from gpu_services.cosyvoice_service.logic import (
    clamp_speed,
    cosine_fade_int16,
    normalize_language,
    select_inference_mode,
    silence_pcm16,
    split_text_with_pauses,
)


def test_language_normalization() -> None:
    assert normalize_language("mandarin", "hello") == "zh"
    assert normalize_language("english", "你好") == "en"
    assert normalize_language("auto", "你好") == "zh"
    assert normalize_language("auto", "hello") == "en"


def test_english_uses_stable_cross_lingual_path() -> None:
    assert select_inference_mode("Hello there", "Hello, my name is Ethan", "en") == "cross_lingual"


def test_chinese_same_language_uses_zero_shot() -> None:
    assert select_inference_mode("你好", "大家好，我是 Ethan", "zh") == "zero_shot"
    assert select_inference_mode("你好", "Hello, I am Ethan", "zh") == "cross_lingual"


def test_speed_is_bounded() -> None:
    assert clamp_speed("bad") == 1.0
    assert clamp_speed(0.1) == 0.8
    assert clamp_speed(4.0) == 1.2


def test_split_text_with_pauses_tiers_by_punctuation() -> None:
    segments = split_text_with_pauses("Hi there, I mean it. Really... yes")
    assert [clause for clause, _ in segments] == ["Hi there", "I mean it", "Really", "yes"]
    pauses = [pause for _, pause in segments]
    assert 0.15 <= pauses[0] <= 0.25  # comma: a breath
    assert 0.40 <= pauses[1] <= 0.60  # period: end of statement
    assert 0.70 <= pauses[2] <= 0.90  # ellipsis: a beat between thoughts
    assert pauses[3] == 0.0  # nothing follows the last clause


def test_split_text_with_pauses_handles_chinese_punctuation() -> None:
    segments = split_text_with_pauses("你好，今天天气很好。")
    assert [clause for clause, _ in segments] == ["你好", "今天天气很好"]
    assert 0.15 <= segments[0][1] <= 0.25


def test_split_text_with_pauses_collapses_blank_lines() -> None:
    segments = split_text_with_pauses("first\n\n\nsecond")
    assert [clause for clause, _ in segments] == ["first", "second"]
    assert 0.70 <= segments[0][1] <= 0.90


def test_split_text_with_pauses_no_punctuation_is_single_clause() -> None:
    assert split_text_with_pauses("just one clause") == [("just one clause", 0.0)]


def test_split_text_with_pauses_uses_measured_persona_timing() -> None:
    profile = {
        "version": 1,
        "confidence": "high",
        "median_short_pause_ms": 360,
        "median_long_pause_ms": 880,
    }
    segments = split_text_with_pauses("Wait, I remember. Actually... yes", profile)
    pauses = [pause for _, pause in segments]
    assert 0.338 <= pauses[0] <= 0.382
    assert 0.827 <= pauses[1] <= 0.933
    assert 1.034 <= pauses[2] <= 1.166
    assert pauses[3] == 0.0


def test_low_confidence_timing_profile_is_ignored() -> None:
    profile = {
        "version": 1,
        "confidence": "low",
        "median_short_pause_ms": 900,
        "median_long_pause_ms": 2_000,
    }
    segments = split_text_with_pauses("Wait, really.", profile)
    assert 0.15 <= segments[0][1] <= 0.25


def test_split_text_with_pauses_ignores_empty_clauses() -> None:
    # Back-to-back punctuation ("a,,b") must not emit a spurious empty
    # clause between the two commas.
    segments = split_text_with_pauses("a,,b")
    assert [clause for clause, _ in segments] == ["a", "b"]


def test_silence_pcm16_matches_requested_duration() -> None:
    silence = silence_pcm16(0.2, 16_000)
    assert silence.shape == (3_200,)
    assert not silence.any()


def test_silence_pcm16_rejects_negative_duration() -> None:
    assert silence_pcm16(-1.0, 16_000).shape == (0,)


def test_cosine_fade_int16_reaches_silence_at_the_edges() -> None:
    pcm = np.full(400, 32000, dtype=np.int16)
    faded = cosine_fade_int16(pcm, fade_in_samples=100, fade_out_samples=100)
    assert faded[0] == 0
    assert faded[-1] == 0
    assert faded[200] == 32000  # untouched middle


def test_cosine_fade_int16_scales_down_on_very_short_clauses() -> None:
    pcm = np.full(50, 32000, dtype=np.int16)
    faded = cosine_fade_int16(pcm, fade_in_samples=100, fade_out_samples=100)
    assert faded.shape == pcm.shape
    assert faded[0] == 0


def test_cosine_fade_int16_handles_empty_input() -> None:
    assert cosine_fade_int16(np.zeros(0, dtype=np.int16)).shape == (0,)
