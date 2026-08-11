"""Fail-open client used by LiveTalking's transition boundary."""

from __future__ import annotations

import os
import urllib.error
import urllib.request

import numpy as np

from .rife_protocol import pack_request, unpack_response


class RifeTransitionClient:
    def __init__(self, endpoint: str, timeout_seconds: float = 0.028):
        self.endpoint = endpoint.rstrip("/") + "/interpolate"
        self.timeout_seconds = max(0.001, timeout_seconds)

    @classmethod
    def from_environment(cls) -> "RifeTransitionClient | None":
        if os.getenv("RIFE_TRANSITION_ENABLED", "0").strip().lower() not in {
            "1",
            "true",
            "yes",
            "on",
        }:
            return None
        endpoint = os.getenv("RIFE_TRANSITION_URL", "http://127.0.0.1:9030")
        timeout_ms = float(os.getenv("RIFE_TRANSITION_TIMEOUT_MS", "28"))
        return cls(endpoint, timeout_seconds=timeout_ms / 1000.0)

    def interpolate(
        self, first: np.ndarray, second: np.ndarray, count: int = 3
    ) -> list[np.ndarray]:
        request = urllib.request.Request(
            self.endpoint,
            data=pack_request(first, second, count=count),
            headers={"Content-Type": "application/octet-stream"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                if response.status != 200:
                    raise RuntimeError(f"RIFE returned HTTP {response.status}")
                frames = unpack_response(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read(500).decode("utf-8", "replace")
            raise RuntimeError(f"RIFE returned HTTP {error.code}: {detail}") from error
        if any(frame.shape != first.shape for frame in frames):
            raise ValueError("RIFE returned a frame with an unexpected shape")
        return frames
