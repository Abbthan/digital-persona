"""Precompute talking-to-idle RIFE transitions during persona preparation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pickle
import shutil
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np

from .rife_service import RifeInterpolator
from .transition_bank_core import assign_pose_entries, select_pose_anchors


IMAGE_GLOB_SUFFIXES = {".png", ".jpg", ".jpeg"}
PINNED_CHECKPOINT_SHA256 = (
    "fe854fc8996547c953f732aaa3b78cae76cc0a12833ae856ea0749c4c570d7d8"
)


def image_paths(directory: Path) -> list[Path]:
    return sorted(
        path for path in directory.iterdir() if path.suffix.lower() in IMAGE_GLOB_SUFFIXES
    )


def signature(frame: np.ndarray) -> np.ndarray:
    height, width = frame.shape[:2]
    crop = frame[
        int(height * 0.08) : max(int(height * 0.90), 1),
        int(width * 0.18) : max(int(width * 0.82), 1),
    ]
    if crop.size == 0:
        crop = frame
    gray = cv2.equalizeHist(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY))
    return cv2.resize(gray, (32, 40), interpolation=cv2.INTER_AREA).astype(
        np.float32
    ).reshape(-1)


def signatures_for(paths: list[Path]) -> tuple[np.ndarray, tuple[int, int, int]]:
    signatures: list[np.ndarray] = []
    expected_shape = None
    for path in paths:
        frame = cv2.imread(str(path), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError(f"could not decode transition source: {path}")
        if expected_shape is None:
            expected_shape = frame.shape
        elif frame.shape != expected_shape:
            raise ValueError("all transition-bank frames must have the same shape")
        signatures.append(signature(frame))
    if expected_shape is None:
        raise ValueError("transition source is empty")
    return np.stack(signatures), expected_shape


def valid_face_box(raw, width: int, height: int) -> tuple[int, int, int, int] | None:
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    x1, y1, x2, y2 = (int(value) for value in raw)
    x1, x2 = max(0, x1), min(width, x2)
    y1, y2 = max(0, y1), min(height, y2)
    return (x1, y1, x2, y2) if x2 > x1 and y2 > y1 else None


def detect_idle_face_box(frame: np.ndarray) -> tuple[int, int, int, int] | None:
    import face_recognition

    locations = face_recognition.face_locations(
        cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), model="hog"
    )
    if not locations:
        return None
    top, right, bottom, left = max(
        locations, key=lambda item: (item[1] - item[3]) * (item[2] - item[0])
    )
    return valid_face_box((left, top, right, bottom), frame.shape[1], frame.shape[0])


def subject_mask(
    frame_shape: tuple[int, ...],
    talking_box: tuple[int, int, int, int] | None,
    idle_box: tuple[int, int, int, int] | None,
) -> np.ndarray:
    """Create a deterministic soft subject mask anchored to detected faces."""

    height, width = frame_shape[:2]
    mask = np.zeros((height, width), dtype=np.uint8)
    # Anchor the matte to the destination face. Unioning differently framed
    # source boxes makes the mask tall enough to include room objects.
    box = idle_box or talking_box
    if box is not None:
        x1, y1, x2, y2 = box
        face_width, face_height = x2 - x1, y2 - y1
        center = ((x1 + x2) // 2, (y1 + y2) // 2)
        axes = (
            min(width // 2, max(24, int(face_width * 0.72))),
            min(height, max(32, int(face_height * 0.88))),
        )
    else:
        center = (width // 2, int(height * 0.58))
        axes = (int(width * 0.30), int(height * 0.56))
    cv2.ellipse(mask, center, axes, 0, 0, 360, 255, -1)
    blur = max(5, int(round(min(frame_shape[:2]) * 0.045)))
    if blur % 2 == 0:
        blur += 1
    return cv2.GaussianBlur(mask, (blur, blur), 0).astype(np.float32) / 255.0


def composite_transition(
    idle: np.ndarray,
    interpolated: np.ndarray,
    mask: np.ndarray,
) -> np.ndarray:
    """Place only the RIFE-interpolated person on the matched idle frame."""

    alpha = mask[..., None]
    return np.clip(
        interpolated.astype(np.float32) * alpha
        + idle.astype(np.float32) * (1.0 - alpha),
        0,
        255,
    ).astype(np.uint8)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--avatar-dir", required=True)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--anchor-count", type=int, default=8)
    parser.add_argument("--intermediate-count", type=int, default=3)
    args = parser.parse_args()

    if args.intermediate_count != 3:
        raise SystemExit("the pinned HDv3 builder currently emits exactly 3 frames")
    avatar_dir = Path(args.avatar_dir).resolve()
    checkpoint = Path(args.weights).resolve() / "flownet.pkl"
    if not checkpoint.is_file():
        raise SystemExit(f"RIFE checkpoint is missing: {checkpoint}")
    digest = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    if digest != PINNED_CHECKPOINT_SHA256:
        raise SystemExit("RIFE checkpoint checksum does not match the pinned model")
    talking_paths = image_paths(avatar_dir / "full_imgs")
    idle_paths = image_paths(avatar_dir / "idle_imgs")
    if not talking_paths or not idle_paths:
        raise SystemExit("both full_imgs and idle_imgs are required")

    talking_signatures, shape = signatures_for(talking_paths)
    idle_signatures, idle_shape = signatures_for(idle_paths)
    if idle_shape != shape:
        raise SystemExit("all transition-bank frames must have the same shape")
    anchor_indices = select_pose_anchors(talking_signatures, args.anchor_count)
    frame_to_entry = assign_pose_entries(talking_signatures, anchor_indices)
    coords_path = avatar_dir / "coords.pkl"
    if not coords_path.is_file():
        raise SystemExit(f"talking face coordinates are missing: {coords_path}")
    with coords_path.open("rb") as stream:
        talking_coords = pickle.load(stream)
    if len(talking_coords) != len(talking_paths):
        raise SystemExit("talking face coordinates do not match source frame count")

    output_dir = avatar_dir / "transition_bank"
    temporary = Path(
        tempfile.mkdtemp(prefix=".transition-bank-", dir=str(avatar_dir))
    )
    started = time.perf_counter()
    try:
        interpolator = RifeInterpolator(Path(args.repository), Path(args.weights))
        entries = []
        for entry_index, talking_index in enumerate(anchor_indices):
            talking_signature = talking_signatures[talking_index]
            idle_scores = np.mean(
                np.abs(idle_signatures - talking_signature[None, :]), axis=1
            )
            idle_index = int(np.argmin(idle_scores))
            talking = cv2.imread(
                str(talking_paths[talking_index]), cv2.IMREAD_COLOR
            )
            idle = cv2.imread(str(idle_paths[idle_index]), cv2.IMREAD_COLOR)
            generated = interpolator.interpolate(
                talking,
                idle,
                count=3,
            )
            talking_box = valid_face_box(
                talking_coords[talking_index], shape[1], shape[0]
            )
            idle_box = detect_idle_face_box(idle)
            mask = subject_mask(shape, talking_box, idle_box)
            names = []
            for frame_index, frame in enumerate(generated):
                frame = composite_transition(
                    idle,
                    frame,
                    mask,
                )
                name = f"entry-{entry_index:02d}-{frame_index:02d}.png"
                if not cv2.imwrite(str(temporary / name), frame):
                    raise RuntimeError(f"could not write {name}")
                names.append(name)
            entries.append(
                {
                    "talking_frame_index": talking_index,
                    "idle_frame_index": idle_index,
                    "pose_score": round(float(idle_scores[idle_index]), 6),
                    "frames": names,
                }
            )

        manifest = {
            "version": 6,
            "compositor": "rife-destination-face-matte_on-matched-idle",
            "talking_frame_count": len(talking_paths),
            "idle_frame_count": len(idle_paths),
            "width": int(shape[1]),
            "height": int(shape[0]),
            "anchor_count": len(entries),
            "intermediate_count": 3,
            "frame_to_entry": frame_to_entry,
            "entries": entries,
            "build_seconds": round(time.perf_counter() - started, 3),
        }
        (temporary / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        backup = avatar_dir / ".transition-bank-previous"
        shutil.rmtree(backup, ignore_errors=True)
        if output_dir.exists():
            os.replace(output_dir, backup)
        try:
            os.replace(temporary, output_dir)
        except Exception:
            if backup.exists() and not output_dir.exists():
                os.replace(backup, output_dir)
            raise
        shutil.rmtree(backup, ignore_errors=True)
        print(json.dumps({"ok": True, **manifest}, ensure_ascii=False))
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


if __name__ == "__main__":
    main()
