"""Pure data helpers for offline avatar transition banks.

This module deliberately depends only on NumPy so its pose clustering and
runtime entry selection can be unit-tested without OpenCV or a GPU.
"""

from __future__ import annotations

import numpy as np
from collections.abc import Sequence


def select_pose_anchors(signatures: np.ndarray, count: int) -> list[int]:
    """Select deterministic, diverse pose representatives.

    Signatures are flattened low-resolution face descriptors. The first
    medoid is closest to the global centroid; each later medoid is the frame
    farthest from its nearest selected representative. This is deterministic
    farthest-point sampling rather than time-uniform sampling, so brief but
    visually distinct head poses still receive an anchor.
    """

    values = np.asarray(signatures, dtype=np.float32)
    if values.ndim != 2 or values.shape[0] == 0:
        raise ValueError("signatures must be a non-empty 2D array")
    requested = max(1, min(int(count), values.shape[0]))
    centroid = values.mean(axis=0, keepdims=True)
    anchors = [int(np.argmin(np.mean(np.abs(values - centroid), axis=1)))]
    nearest = np.mean(np.abs(values - values[anchors[0]]), axis=1)
    while len(anchors) < requested:
        candidate = int(np.argmax(nearest))
        if candidate in anchors:
            break
        anchors.append(candidate)
        distance = np.mean(np.abs(values - values[candidate]), axis=1)
        nearest = np.minimum(nearest, distance)
    return sorted(anchors)


def assign_pose_entries(signatures: np.ndarray, anchors: list[int]) -> list[int]:
    """Return the nearest anchor-entry index for every source frame."""

    values = np.asarray(signatures, dtype=np.float32)
    if values.ndim != 2 or values.shape[0] == 0:
        raise ValueError("signatures must be a non-empty 2D array")
    if not anchors:
        raise ValueError("at least one anchor is required")
    if any(index < 0 or index >= values.shape[0] for index in anchors):
        raise ValueError("anchor index is outside the signature array")
    representatives = values[np.asarray(anchors, dtype=np.int64)]
    distances = np.mean(
        np.abs(values[:, None, :] - representatives[None, :, :]), axis=2
    )
    return np.argmin(distances, axis=1).astype(int).tolist()


def mapped_entry(
    frame_index: int, frame_to_entry: Sequence[int], entry_count: int
) -> int:
    """Resolve a possibly ping-ponged source index to a validated entry."""

    if not frame_to_entry or entry_count <= 0:
        raise ValueError("transition-bank mapping is empty")
    normalized = int(frame_index) % len(frame_to_entry)
    entry = int(frame_to_entry[normalized])
    if not 0 <= entry < entry_count:
        raise ValueError("transition-bank entry mapping is invalid")
    return entry
