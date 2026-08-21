from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from gpu_services.livetalking_gateway.speech_profile import (
    profile_path_for_voice,
    save_speech_profile,
)


class SpeechProfileStoreTests(unittest.TestCase):
    def test_saves_aggregate_profile_beside_voice(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            voice = Path(directory) / "persona.wav"
            profile = {
                "version": 1,
                "confidence": "high",
                "speed_factor": 0.94,
                "median_short_pause_ms": 230,
                "median_long_pause_ms": 610,
            }
            destination = save_speech_profile(voice, profile)
            self.assertEqual(destination, Path(directory) / "persona.speech-profile.json")
            self.assertEqual(json.loads(destination.read_text(encoding="utf-8")), profile)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o600)

    def test_low_confidence_removes_stale_profile(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            voice = Path(directory) / "persona.wav"
            destination = profile_path_for_voice(voice)
            destination.write_text("{}", encoding="utf-8")
            self.assertIsNone(save_speech_profile(voice, {"version": 1, "confidence": "low"}))
            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
