"""Compact localhost protocol for RIFE transition interpolation.

Frames stay as raw uint8 BGR arrays.  This avoids PNG/JPEG encode latency and
keeps large media buffers away from the Cloudflare Worker.
"""

from __future__ import annotations

import struct
from typing import Iterable

import numpy as np


MAGIC_REQUEST = b"ERF1"
MAGIC_RESPONSE = b"ERF2"
_REQUEST_HEADER = struct.Struct("!4sIIII")
_RESPONSE_HEADER = struct.Struct("!4sIIII")
MAX_DIMENSION = 4096
MAX_INTERMEDIATE_FRAMES = 4


def _validate_frame(frame: np.ndarray) -> np.ndarray:
    if frame.dtype != np.uint8 or frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError("frame must be an HxWx3 uint8 array")
    height, width, _ = frame.shape
    if not (1 <= height <= MAX_DIMENSION and 1 <= width <= MAX_DIMENSION):
        raise ValueError("frame dimensions are outside the supported range")
    return np.ascontiguousarray(frame)


def pack_request(first: np.ndarray, second: np.ndarray, count: int = 3) -> bytes:
    first = _validate_frame(first)
    second = _validate_frame(second)
    if first.shape != second.shape:
        raise ValueError("transition frames must have identical shapes")
    if not 1 <= count <= MAX_INTERMEDIATE_FRAMES:
        raise ValueError("intermediate frame count must be between 1 and 4")
    height, width, channels = first.shape
    return (
        _REQUEST_HEADER.pack(MAGIC_REQUEST, height, width, channels, count)
        + first.tobytes()
        + second.tobytes()
    )


def unpack_request(payload: bytes) -> tuple[np.ndarray, np.ndarray, int]:
    if len(payload) < _REQUEST_HEADER.size:
        raise ValueError("request body is truncated")
    magic, height, width, channels, count = _REQUEST_HEADER.unpack_from(payload)
    if magic != MAGIC_REQUEST or channels != 3:
        raise ValueError("request header is invalid")
    if not (1 <= height <= MAX_DIMENSION and 1 <= width <= MAX_DIMENSION):
        raise ValueError("request dimensions are outside the supported range")
    if not 1 <= count <= MAX_INTERMEDIATE_FRAMES:
        raise ValueError("request frame count is outside the supported range")
    frame_bytes = height * width * channels
    expected = _REQUEST_HEADER.size + frame_bytes * 2
    if len(payload) != expected:
        raise ValueError("request body length does not match its header")
    view = memoryview(payload)
    offset = _REQUEST_HEADER.size
    first = np.frombuffer(view[offset : offset + frame_bytes], dtype=np.uint8).reshape(
        height, width, channels
    )
    second = np.frombuffer(view[offset + frame_bytes :], dtype=np.uint8).reshape(
        height, width, channels
    )
    return first.copy(), second.copy(), count


def pack_response(frames: Iterable[np.ndarray]) -> bytes:
    normalized = [_validate_frame(frame) for frame in frames]
    if not normalized:
        raise ValueError("response must contain at least one frame")
    if len(normalized) > MAX_INTERMEDIATE_FRAMES:
        raise ValueError("response contains too many frames")
    shape = normalized[0].shape
    if any(frame.shape != shape for frame in normalized[1:]):
        raise ValueError("response frames must have identical shapes")
    height, width, channels = shape
    return _RESPONSE_HEADER.pack(
        MAGIC_RESPONSE, height, width, channels, len(normalized)
    ) + b"".join(frame.tobytes() for frame in normalized)


def unpack_response(payload: bytes) -> list[np.ndarray]:
    if len(payload) < _RESPONSE_HEADER.size:
        raise ValueError("response body is truncated")
    magic, height, width, channels, count = _RESPONSE_HEADER.unpack_from(payload)
    if magic != MAGIC_RESPONSE or channels != 3:
        raise ValueError("response header is invalid")
    if not (1 <= height <= MAX_DIMENSION and 1 <= width <= MAX_DIMENSION):
        raise ValueError("response dimensions are outside the supported range")
    if not 1 <= count <= MAX_INTERMEDIATE_FRAMES:
        raise ValueError("response frame count is outside the supported range")
    frame_bytes = height * width * channels
    expected = _RESPONSE_HEADER.size + frame_bytes * count
    if len(payload) != expected:
        raise ValueError("response body length does not match its header")
    view = memoryview(payload)
    frames: list[np.ndarray] = []
    offset = _RESPONSE_HEADER.size
    for index in range(count):
        start = offset + index * frame_bytes
        frames.append(
            np.frombuffer(view[start : start + frame_bytes], dtype=np.uint8)
            .reshape(height, width, channels)
            .copy()
        )
    return frames

