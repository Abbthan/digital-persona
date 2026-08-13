"""Validated, shared runtime loader for precomputed avatar transitions."""

from __future__ import annotations

import json
import os
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import numpy as np

try:
    import cv2
except ImportError:  # lets pure manifest/selection tests run off the GPU image
    cv2 = None

from .transition_bank_core import mapped_entry


@dataclass(frozen=True)
class TransitionEntry:
    talking_frame_index: int
    idle_frame_index: int
    frames: tuple[np.ndarray, ...]


@dataclass(frozen=True)
class OfflineTransitionBank:
    talking_frame_count: int
    idle_frame_count: int
    frame_to_entry: tuple[int, ...]
    entries: tuple[TransitionEntry, ...]

    def select(self, talking_frame_index: int) -> TransitionEntry:
        entry_index = mapped_entry(
            talking_frame_index, self.frame_to_entry, len(self.entries)
        )
        return self.entries[entry_index]


_CACHE_LOCK = Lock()
_CACHE: "OrderedDict[tuple[str, int], OfflineTransitionBank]" = OrderedDict()
_MAX_CACHE_ENTRIES = max(1, int(os.getenv("OFFLINE_TRANSITION_CACHE_SIZE", "4")))


def _decode_frame(path: Path, width: int, height: int) -> np.ndarray:
    if cv2 is None:
        raise ValueError("OpenCV is required to decode transition frames")
    frame = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if frame is None:
        raise ValueError(f"could not decode transition frame: {path}")
    if frame.shape != (height, width, 3):
        raise ValueError(f"transition frame has unexpected dimensions: {path}")
    frame.setflags(write=False)
    return frame


def _load_uncached(bank_dir: Path) -> OfflineTransitionBank:
    manifest = json.loads((bank_dir / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("version") != 6:
        raise ValueError("unsupported transition-bank version")
    if manifest.get("compositor") != "rife-destination-face-matte_on-matched-idle":
        raise ValueError("unsupported transition-bank compositor")
    width, height = int(manifest["width"]), int(manifest["height"])
    talking_count = int(manifest["talking_frame_count"])
    idle_count = int(manifest["idle_frame_count"])
    mapping = tuple(int(value) for value in manifest["frame_to_entry"])
    raw_entries = manifest["entries"]
    if width <= 0 or height <= 0 or talking_count <= 0 or idle_count <= 0:
        raise ValueError("transition-bank dimensions/counts are invalid")
    if len(mapping) != talking_count or not raw_entries:
        raise ValueError("transition-bank mapping does not match source frames")

    entries = []
    for entry_index, raw in enumerate(raw_entries):
        frame_names = raw.get("frames", [])
        if len(frame_names) not in {3, 4}:
            raise ValueError("transition entry must contain 3 or 4 frames")
        frames = tuple(
            _decode_frame(bank_dir / str(name), width, height) for name in frame_names
        )
        entry = TransitionEntry(
            talking_frame_index=int(raw["talking_frame_index"]),
            idle_frame_index=int(raw["idle_frame_index"]),
            frames=frames,
        )
        if not 0 <= entry.talking_frame_index < talking_count:
            raise ValueError(f"transition entry {entry_index} has invalid talking index")
        if not 0 <= entry.idle_frame_index < idle_count:
            raise ValueError(f"transition entry {entry_index} has invalid idle index")
        entries.append(entry)
    if any(value < 0 or value >= len(entries) for value in mapping):
        raise ValueError("transition-bank mapping references a missing entry")
    return OfflineTransitionBank(talking_count, idle_count, mapping, tuple(entries))


def load_offline_transition_bank(
    avatar_dir: str | os.PathLike[str],
) -> OfflineTransitionBank | None:
    """Load and share one complete bank, or return None on absence/invalidity.

    The preparation writer publishes the directory atomically. Runtime keys
    the cache by manifest mtime so retraining a persona naturally replaces the
    old bank without restarting LiveTalking.
    """

    bank_dir = Path(avatar_dir).resolve() / "transition_bank"
    manifest_path = bank_dir / "manifest.json"
    try:
        cache_key = (str(bank_dir), manifest_path.stat().st_mtime_ns)
    except OSError:
        return None
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached is not None:
            _CACHE.move_to_end(cache_key)
            return cached
    try:
        bank = _load_uncached(bank_dir)
    except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None
    with _CACHE_LOCK:
        stale_keys = [key for key in _CACHE if key[0] == str(bank_dir)]
        for key in stale_keys:
            _CACHE.pop(key, None)
        _CACHE[cache_key] = bank
        while len(_CACHE) > _MAX_CACHE_ENTRIES:
            _CACHE.popitem(last=False)
    return bank
