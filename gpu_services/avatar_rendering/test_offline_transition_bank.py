import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

try:
    import cv2
except ImportError:
    cv2 = None

from gpu_services.avatar_rendering.offline_transition_bank import (
    load_offline_transition_bank,
)


class OfflineTransitionBankTests(unittest.TestCase):
    @unittest.skipIf(cv2 is None, "OpenCV is only installed in the GPU runtime")
    def test_loads_and_selects_valid_bank(self):
        with tempfile.TemporaryDirectory() as directory:
            avatar = Path(directory)
            bank = avatar / "transition_bank"
            bank.mkdir()
            frames = []
            for index in range(3):
                name = f"frame-{index}.png"
                cv2.imwrite(str(bank / name), np.full((8, 10, 3), index, np.uint8))
                frames.append(name)
            (bank / "manifest.json").write_text(
                json.dumps(
                    {
                        "version": 6,
                        "compositor": "rife-destination-face-matte_on-matched-idle",
                        "width": 10,
                        "height": 8,
                        "talking_frame_count": 2,
                        "idle_frame_count": 4,
                        "frame_to_entry": [0, 0],
                        "entries": [
                            {
                                "talking_frame_index": 1,
                                "idle_frame_index": 3,
                                "frames": frames,
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            loaded = load_offline_transition_bank(avatar)
            self.assertIsNotNone(loaded)
            entry = loaded.select(3)
            self.assertEqual(entry.idle_frame_index, 3)
            self.assertEqual(len(entry.frames), 3)
            self.assertFalse(entry.frames[0].flags.writeable)

    def test_invalid_bank_fails_open(self):
        with tempfile.TemporaryDirectory() as directory:
            bank = Path(directory) / "transition_bank"
            bank.mkdir()
            (bank / "manifest.json").write_text("{}", encoding="utf-8")
            self.assertIsNone(load_offline_transition_bank(directory))


if __name__ == "__main__":
    unittest.main()
