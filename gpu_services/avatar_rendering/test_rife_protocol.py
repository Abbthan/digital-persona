import unittest

import numpy as np

from gpu_services.avatar_rendering.rife_protocol import (
    pack_request,
    pack_response,
    unpack_request,
    unpack_response,
)


class RifeProtocolTests(unittest.TestCase):
    def setUp(self):
        self.first = np.arange(6 * 8 * 3, dtype=np.uint8).reshape(6, 8, 3)
        self.second = np.flip(self.first, axis=1).copy()

    def test_request_round_trip(self):
        first, second, count = unpack_request(pack_request(self.first, self.second, 3))
        self.assertEqual(count, 3)
        np.testing.assert_array_equal(first, self.first)
        np.testing.assert_array_equal(second, self.second)

    def test_response_round_trip(self):
        frames = [self.first, self.second, self.first]
        decoded = unpack_response(pack_response(frames))
        self.assertEqual(len(decoded), 3)
        for actual, expected in zip(decoded, frames):
            np.testing.assert_array_equal(actual, expected)

    def test_mismatched_shapes_are_rejected(self):
        with self.assertRaises(ValueError):
            pack_request(self.first, self.second[:5], 3)


if __name__ == "__main__":
    unittest.main()

