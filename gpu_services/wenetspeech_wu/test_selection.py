import unittest

from gpu_services.wenetspeech_wu.selection import TranscriptCandidate, choose_transcript


class TranscriptSelectionTests(unittest.TestCase):
    def test_prefers_wu_for_chinese_whisper_result(self):
        selected = choose_transcript(
            TranscriptCandidate("我不知道", "faster-whisper", "zh", 0.98),
            "阿拉勿晓得",
            0.71,
        )
        self.assertEqual(selected.engine, "wenetspeech-wu-conformer-u2pp")
        self.assertEqual(selected.text, "阿拉勿晓得")

    def test_recovers_wu_when_whisper_language_is_uncertain(self):
        selected = choose_transcript(
            TranscriptCandidate("", "faster-whisper", "en", 0.51),
            "侬今朝到啥地方去",
            0.78,
        )
        self.assertEqual(selected.language, "wuu")

    def test_keeps_confident_english(self):
        selected = choose_transcript(
            TranscriptCandidate("How are you today?", "faster-whisper", "en", 0.99),
            "好啊有台",
            0.80,
        )
        self.assertEqual(selected.engine, "faster-whisper")
        self.assertEqual(selected.text, "How are you today?")

    def test_rejects_non_han_wu_hypothesis(self):
        selected = choose_transcript(
            TranscriptCandidate("hello", "faster-whisper", "en", 0.60),
            "hello",
            0.95,
        )
        self.assertEqual(selected.engine, "faster-whisper")


if __name__ == "__main__":
    unittest.main()
