import unittest

import numpy as np

from gpu_services.avatar_rendering.runtime_transition import RuntimeRifeTransition


class FakeClient:
    def __init__(self, frames=None, error=None):
        self.frames = frames
        self.error = error
        self.calls = []

    def interpolate(self, first, second, count=3):
        self.calls.append((first, second, count))
        if self.error is not None:
            raise self.error
        return self.frames


class RuntimeRifeTransitionTests(unittest.TestCase):
    def setUp(self):
        self.first = np.zeros((4, 5, 3), dtype=np.uint8)
        self.second = np.full((4, 5, 3), 255, dtype=np.uint8)
        self.frames = [
            np.full((4, 5, 3), value, dtype=np.uint8)
            for value in (63, 127, 191)
        ]

    def test_replaces_three_frames_without_inserting_destination(self):
        transition = RuntimeRifeTransition(FakeClient(self.frames))
        self.assertTrue(transition.begin(self.first, self.second))
        self.assertEqual(transition.remaining, 3)
        for expected in self.frames:
            np.testing.assert_array_equal(transition.render_or(self.second), expected)
        np.testing.assert_array_equal(transition.render_or(self.second), self.second)

    def test_disabled_transition_returns_live_destination(self):
        transition = RuntimeRifeTransition(None)
        self.assertFalse(transition.begin(self.first, self.second))
        np.testing.assert_array_equal(transition.render_or(self.second), self.second)

    def test_failed_new_boundary_drops_old_pending_frames(self):
        client = FakeClient(self.frames)
        transition = RuntimeRifeTransition(client)
        transition.begin(self.first, self.second)
        client.error = TimeoutError("late")
        with self.assertRaises(TimeoutError):
            transition.begin(self.second, self.first)
        self.assertEqual(transition.remaining, 0)
        np.testing.assert_array_equal(transition.render_or(self.first), self.first)

    def test_rejects_invalid_response_length(self):
        transition = RuntimeRifeTransition(FakeClient(self.frames[:2]))
        with self.assertRaises(ValueError):
            transition.begin(self.first, self.second)
        self.assertEqual(transition.remaining, 0)


if __name__ == "__main__":
    unittest.main()
