from __future__ import annotations

import unittest

from profile import build_speech_profile, condition_tts_text, speech_style_summary


class SpeechProfileTests(unittest.TestCase):
    def test_measures_english_breaks_and_rate(self) -> None:
        profile = build_speech_profile([
            {
                "start": 0.0,
                "end": 10.0,
                "text": "Well, I remember that. But honestly, it was funny.",
                "words": [
                    {"start": 0.0, "end": 0.4, "word": "Well,"},
                    {"start": 0.8, "end": 1.1, "word": "I"},
                    {"start": 1.2, "end": 1.8, "word": "remember"},
                    {"start": 2.0, "end": 2.4, "word": "that."},
                    {"start": 3.2, "end": 3.5, "word": "But"},
                    {"start": 3.7, "end": 4.3, "word": "honestly,"},
                    {"start": 4.8, "end": 5.0, "word": "it"},
                    {"start": 5.2, "end": 5.5, "word": "was"},
                    {"start": 5.8, "end": 6.3, "word": "funny."},
                ],
            },
            {
                "start": 11.0,
                "end": 22.0,
                "text": "So I stopped, and then I tried again, because I cared.",
                "words": [
                    {"start": 11.0, "end": 11.3, "word": "So"},
                    {"start": 11.5, "end": 11.7, "word": "I"},
                    {"start": 11.9, "end": 12.4, "word": "stopped,"},
                    {"start": 12.8, "end": 13.1, "word": "and"},
                    {"start": 13.3, "end": 13.7, "word": "then"},
                    {"start": 13.9, "end": 14.1, "word": "I"},
                    {"start": 14.3, "end": 14.7, "word": "tried"},
                    {"start": 15.4, "end": 15.8, "word": "again,"},
                    {"start": 16.2, "end": 16.7, "word": "because"},
                    {"start": 16.9, "end": 17.1, "word": "I"},
                    {"start": 17.3, "end": 17.8, "word": "cared."},
                ],
            },
        ], "en")
        self.assertIn(profile["confidence"], {"medium", "high"})
        self.assertEqual(profile["speaking_rate_unit"], "words_per_second")
        self.assertGreaterEqual(profile["observed_pause_count"], 5)
        self.assertIn(profile["preferred_boundary"], {"sentence", "clause", "unpunctuated"})
        self.assertIsNotNone(speech_style_summary(profile))

    def test_low_evidence_is_not_applied(self) -> None:
        profile = build_speech_profile([
            {"start": 0.0, "end": 1.0, "text": "Hi there", "words": []},
        ], "en")
        self.assertEqual(profile["confidence"], "low")
        self.assertEqual(condition_tts_text("Hi there.", profile), ("Hi there.", 1.0))
        self.assertIsNone(speech_style_summary(profile))

    def test_chinese_profile_and_conditioning_preserve_content(self) -> None:
        profile = {
            "version": 1,
            "confidence": "high",
            "language": "zh",
            "speaking_rate": 3.5,
            "speaking_rate_unit": "characters_per_second",
            "speed_factor": 0.9,
            "pause_style": "frequent",
            "pauses_per_minute": 24,
            "observed_pause_count": 9,
            "median_short_pause_ms": 330,
            "median_long_pause_ms": 820,
            "long_pause_ratio": 0.5,
            "preferred_boundary": "clause",
        }
        original = "我还记得那一天，但是后来我们都笑了，所以我一直没有忘记。"
        conditioned, speed = condition_tts_text(original, profile)
        self.assertEqual(speed, 0.9)
        self.assertTrue("[breath]" in conditioned or "\u2026" in conditioned)
        self.assertEqual(
            conditioned.replace("[breath]", "").replace("\u2026", ""),
            original,
        )


if __name__ == "__main__":
    unittest.main()
