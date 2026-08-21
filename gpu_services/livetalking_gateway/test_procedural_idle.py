from __future__ import annotations

import unittest

from gpu_services.livetalking_gateway.procedural_idle import motion_samples


class ProceduralIdleMotionTests(unittest.TestCase):
    def test_motion_is_deterministic_and_bounded(self) -> None:
        first = motion_samples(300, 25, "persona_example")
        second = motion_samples(300, 25, "persona_example")
        self.assertEqual(first, second)
        self.assertTrue(first)
        for sample in first:
            self.assertLessEqual(abs(sample.translate_x), 2.8)
            self.assertLessEqual(abs(sample.translate_y), 2.2)
            self.assertLessEqual(abs(sample.rotation_degrees), 0.32)
            self.assertGreaterEqual(sample.scale, 0.9975)
            self.assertLessEqual(sample.scale, 1.0025)
            self.assertGreaterEqual(sample.blink, 0.0)
            self.assertLessEqual(sample.blink, 1.0)

    def test_blinks_are_present_but_not_continuous(self) -> None:
        samples = motion_samples(25 * 20, 25, "persona_blinks")
        blink_frames = [index for index, sample in enumerate(samples) if sample.blink > 0]
        self.assertGreaterEqual(len(blink_frames), 10)
        self.assertLess(len(blink_frames), len(samples) // 5)

    def test_invalid_dimensions_return_no_samples(self) -> None:
        self.assertEqual(motion_samples(0, 25, "x"), [])
        self.assertEqual(motion_samples(10, 0, "x"), [])


if __name__ == "__main__":
    unittest.main()
