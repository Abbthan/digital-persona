"""Benchmark the local RIFE service against real avatar transition pairs."""

from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

import cv2

from .rife_client import RifeTransitionClient


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", required=True)
    parser.add_argument("--second", required=True)
    parser.add_argument("--endpoint", default="http://127.0.0.1:9030")
    parser.add_argument("--iterations", type=int, default=30)
    parser.add_argument("--output-dir")
    args = parser.parse_args()

    first = cv2.imread(args.first, cv2.IMREAD_COLOR)
    second = cv2.imread(args.second, cv2.IMREAD_COLOR)
    if first is None or second is None:
        raise SystemExit("both benchmark frames must be decodable images")
    if first.shape != second.shape:
        raise SystemExit(f"frame shapes differ: {first.shape} != {second.shape}")

    client = RifeTransitionClient(args.endpoint, timeout_seconds=10.0)
    # Warm the model and transport before recording latency.
    client.interpolate(first, second, count=3)
    durations: list[float] = []
    generated = []
    for _ in range(max(1, args.iterations)):
        started = time.perf_counter()
        generated = client.interpolate(first, second, count=3)
        durations.append((time.perf_counter() - started) * 1000)

    sorted_durations = sorted(durations)
    p95_index = min(len(sorted_durations) - 1, int(len(sorted_durations) * 0.95))
    result = {
        "iterations": len(durations),
        "shape": list(first.shape),
        "median_ms": round(statistics.median(durations), 3),
        "p95_ms": round(sorted_durations[p95_index], 3),
        "max_ms": round(max(durations), 3),
        "passes_28ms_gate": sorted_durations[p95_index] < 28.0,
    }
    print(json.dumps(result, indent=2))

    if args.output_dir:
        output_dir = Path(args.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(output_dir / "00-talking.png"), first)
        for index, frame in enumerate(generated, start=1):
            cv2.imwrite(str(output_dir / f"0{index}-rife.png"), frame)
        cv2.imwrite(str(output_dir / "04-idle.png"), second)


if __name__ == "__main__":
    main()
