import unittest

import numpy as np

from gpu_services.avatar_rendering.transition_bank_core import (
    assign_pose_entries,
    mapped_entry,
    select_pose_anchors,
)


class TransitionBankCoreTests(unittest.TestCase):
    def test_pose_anchors_include_distinct_extremes(self):
        signatures = np.asarray([[0, 0], [1, 1], [10, 10], [11, 11]], dtype=np.float32)
        anchors = select_pose_anchors(signatures, 2)
        self.assertEqual(len(anchors), 2)
        self.assertTrue(any(index < 2 for index in anchors))
        self.assertTrue(any(index >= 2 for index in anchors))

    def test_every_frame_maps_to_nearest_anchor_entry(self):
        signatures = np.asarray([[0], [2], [9], [10]], dtype=np.float32)
        self.assertEqual(assign_pose_entries(signatures, [0, 3]), [0, 0, 1, 1])

    def test_runtime_mapping_normalizes_frame_index(self):
        self.assertEqual(mapped_entry(5, [0, 1, 2], 3), 2)
        with self.assertRaises(ValueError):
            mapped_entry(0, [4], 3)


if __name__ == "__main__":
    unittest.main()
