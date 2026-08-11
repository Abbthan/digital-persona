"""Local-only RIFE interpolation service for state-transition frames."""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import numpy as np
import torch
from torch.nn import functional as torch_functional

from .rife_protocol import pack_response, unpack_request


class RifeInterpolator:
    def __init__(self, repository: Path, weights: Path):
        sys.path.insert(0, str(repository))
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.use_fp16 = self.device.type == "cuda" and os.getenv(
            "RIFE_FP16", "0"
        ).strip().lower() in {"1", "true", "yes", "on"}
        self.single_pass_flow = False
        self.rife_warp = None
        try:
            # The China-hosted ModelScope package carries the same RIFE HDv3
            # architecture and a checkpoint whose SHA-256 is recorded in the
            # deployment notes. It avoids importing any code into LiveTalking.
            from modelscope.models.cv.video_frame_interpolation.rife import (
                RIFEModel,
            )
            from modelscope.models.cv.video_frame_interpolation.rife.warplayer import (
                warp,
            )

            self.model = RIFEModel(str(weights))
            self.single_pass_flow = os.getenv(
                "RIFE_SINGLE_PASS_FLOW", "1"
            ).strip().lower() in {"1", "true", "yes", "on"}
            self.rife_warp = warp
            self.lock = threading.Lock()
            torch.set_grad_enabled(False)
            if torch.cuda.is_available():
                torch.backends.cudnn.enabled = True
                torch.backends.cudnn.benchmark = True
            return
        except ImportError:
            # Fall through to the original-author repository layout.
            pass

        model_class = None
        for module_name in (
            "model.RIFE_HDv2",
            "train_log.RIFE_HDv3",
            "model.RIFE_HD",
            "model.RIFE",
        ):
            try:
                module = __import__(module_name, fromlist=["Model"])
                model_class = module.Model
                break
            except (ImportError, AttributeError):
                continue
        if model_class is None:
            raise RuntimeError("no supported RIFE Model class was found")
        if not (weights / "flownet.pkl").is_file():
            raise FileNotFoundError(f"RIFE weights are missing: {weights / 'flownet.pkl'}")
        self.model = model_class()
        self.model.load_model(str(weights), -1)
        self.model.eval()
        self.model.device()
        self.lock = threading.Lock()
        torch.set_grad_enabled(False)
        if torch.cuda.is_available():
            torch.backends.cudnn.enabled = True
            torch.backends.cudnn.benchmark = True

    def _tensor(self, frame: np.ndarray) -> tuple[torch.Tensor, int, int]:
        height, width = frame.shape[:2]
        tensor = (
            torch.from_numpy(frame)
            .to(self.device, non_blocking=True)
            .permute(2, 0, 1)
            .unsqueeze(0)
            .float()
            .div_(255.0)
        )
        padded_height = ((height - 1) // 32 + 1) * 32
        padded_width = ((width - 1) // 32 + 1) * 32
        return (
            torch_functional.pad(
                tensor, (0, padded_width - width, 0, padded_height - height)
            ),
            height,
            width,
        )

    @staticmethod
    def _frame(tensor: torch.Tensor, height: int, width: int) -> np.ndarray:
        return (
            tensor[0, :, :height, :width]
            .clamp(0, 1)
            .mul(255)
            .byte()
            .permute(1, 2, 0)
            .cpu()
            .numpy()
        )

    def interpolate(
        self, first: np.ndarray, second: np.ndarray, count: int
    ) -> list[np.ndarray]:
        if count != 3:
            raise ValueError("the live transition path currently requires 3 frames")
        first_tensor, height, width = self._tensor(first)
        second_tensor, second_height, second_width = self._tensor(second)
        if (height, width) != (second_height, second_width):
            raise ValueError("transition frames must have identical shapes")
        autocast = (
            torch.autocast(device_type="cuda", dtype=torch.float16)
            if self.use_fp16
            else contextlib.nullcontext()
        )
        with self.lock, torch.inference_mode(), autocast:
            if self.single_pass_flow and self.rife_warp is not None:
                flow_list, _mask, merged = self.model.flownet(
                    torch.cat((first_tensor, second_tensor), dim=1),
                    [4, 2, 1],
                )
                flow = flow_list[-1]
                middle = merged[-1]

                def warped_at(timestep: float) -> torch.Tensor:
                    # HDv3 predicts displacement from each endpoint to the
                    # midpoint. Scale those two fields to the requested time,
                    # then blend the already-aligned pixels. This reuses one
                    # network pass for all three output frames.
                    from_first = self.rife_warp(
                        first_tensor, flow[:, :2] * (2.0 * timestep)
                    )
                    from_second = self.rife_warp(
                        second_tensor, flow[:, 2:4] * (2.0 * (1.0 - timestep))
                    )
                    return from_first * (1.0 - timestep) + from_second * timestep

                quarter = warped_at(0.25)
                three_quarters = warped_at(0.75)
            else:
                middle = self.model.inference(first_tensor, second_tensor)
                # Quarter and three-quarter frames are independent once the
                # midpoint exists, so run them as one batch rather than two
                # sequential model calls.
                outer = self.model.inference(
                    torch.cat((first_tensor, middle), dim=0),
                    torch.cat((middle, second_tensor), dim=0),
                )
                quarter = outer[0:1]
                three_quarters = outer[1:2]
            if torch.cuda.is_available():
                torch.cuda.synchronize()
        return [
            self._frame(quarter, height, width),
            self._frame(middle, height, width),
            self._frame(three_quarters, height, width),
        ]


class Handler(BaseHTTPRequestHandler):
    server_version = "EchoRIFE/1"

    def _json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._json(404, {"ok": False})
            return
        self._json(
            200,
            {
                "ok": True,
                "device": str(self.server.interpolator.device),
                "fp16": self.server.interpolator.use_fp16,
                "single_pass_flow": self.server.interpolator.single_pass_flow,
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/interpolate":
            self._json(404, {"ok": False})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if not 1 <= content_length <= 128 * 1024 * 1024:
                raise ValueError("request size is outside the supported range")
            first, second, count = unpack_request(self.rfile.read(content_length))
            started = time.perf_counter()
            frames = self.server.interpolator.interpolate(first, second, count)
            payload = pack_response(frames)
            elapsed_ms = (time.perf_counter() - started) * 1000
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("X-RIFE-Inference-Ms", f"{elapsed_ms:.3f}")
            self.end_headers()
            self.wfile.write(payload)
        except Exception as error:  # fail closed here; LiveTalking fails open
            self._json(422, {"ok": False, "error": str(error)[:300]})

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"rife_service: {format_string % args}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repository",
        default=os.getenv("RIFE_REPOSITORY", "/data/echodigitalpersona/RIFE-experiment"),
    )
    parser.add_argument(
        "--weights",
        default=os.getenv("RIFE_WEIGHTS", "/data/echodigitalpersona/RIFE-experiment/train_log"),
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9030)
    args = parser.parse_args()
    interpolator = RifeInterpolator(Path(args.repository), Path(args.weights))
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.interpolator = interpolator
    print(f"RIFE ready on http://{args.host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
