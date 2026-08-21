import unittest

from gpu_services.speech_recognition.language import forced_language, gate_transcript, normalize_preference


class LanguageTests(unittest.TestCase):
    def test_preference_mapping(self):
        self.assertEqual(forced_language("english"), "en")
        self.assertEqual(forced_language("mandarin"), "zh")
        self.assertEqual(forced_language("wu"), "zh")
        self.assertIsNone(forced_language("auto"))

    def test_language_gates(self):
        self.assertEqual(gate_transcript("你好世界", "english"), "")
        self.assertEqual(gate_transcript("hello world", "mandarin"), "")
        self.assertEqual(gate_transcript("hello world", "english"), "hello world")
        self.assertEqual(gate_transcript("你好世界", "wu"), "你好世界")

    def test_unknown_defaults_to_auto(self):
        self.assertEqual(normalize_preference("unknown"), "auto")


if __name__ == "__main__":
    unittest.main()
