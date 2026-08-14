"""Small fail-open scheduler for runtime RIFE state transitions.

The scheduler replaces upcoming video frames with interpolation frames instead
of inserting extra frames.  Audio and video therefore keep the same packet
count and the WebRTC clocks do not drift merely because a state changed.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Sequence

import numpy as np

from .rife_client import RifeTransitionClient


class RuntimeRifeTransition:
    """Own the pending interpolation frames for one avatar session."""

    def __init__(
        self,
        client: RifeTransitionClient | None,
        frame_count: int = 3,
    ) -> None:
        if frame_count != 3:
            raise ValueError("the live RIFE service currently emits exactly 3 frames")
        self.client = client
        self.frame_count = frame_count
        self._pending: deque[np.ndarray] = deque()

    @classmethod
    def from_environment(cls) -> "RuntimeRifeTransition":
        return cls(RifeTransitionClient.from_environment())

    @property
    def enabled(self) -> bool:
        return self.client is not None

    @property
    def remaining(self) -> int:
        return len(self._pending)

    def begin(self, first: np.ndarray, second: np.ndarray) -> bool:
        """Replace any older transition with a newly interpolated boundary.

        Exceptions deliberately propagate to the LiveTalking boundary, which
        logs the failure and continues through its established visual fallback.
        Pending frames are cleared first so a failed new state change can never
        replay frames from the previous direction.
        """

        self._pending.clear()
        if self.client is None:
            return False
        frames: Sequence[np.ndarray] = self.client.interpolate(
            first,
            second,
            count=self.frame_count,
        )
        if len(frames) != self.frame_count:
            raise ValueError("RIFE returned an unexpected transition length")
        if any(frame.shape != first.shape for frame in frames):
            raise ValueError("RIFE returned a frame with an unexpected shape")
        self._pending.extend(frames)
        return True

    def render_or(self, destination: np.ndarray) -> np.ndarray:
        """Return the next interpolation frame, or the live destination."""

        return self._pending.popleft() if self._pending else destination
