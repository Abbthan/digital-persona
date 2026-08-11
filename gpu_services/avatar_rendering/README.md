# Experimental avatar rendering services

This directory contains optional, fail-open GPU experiments. Production
LiveTalking/MuseTalk remains the default renderer.

## RIFE transition interpolation

`rife_service.py` runs on `127.0.0.1:9030`, pinned to an otherwise-unused GPU.
It generates three intermediate frames only for the talking-to-idle boundary.
Frames use a bounded raw-binary localhost protocol; no Base64, R2, Worker, or
public route is involved.

This service is **not wired into production LiveTalking**. An earlier
feature-flag patch was deliberately discarded after the real-persona benchmark
missed the render deadline. Do not add it to `start-livetalking.sh` until a new
implementation satisfies all of these gates:

- p95 end-to-end service time below 28 ms at the avatar's real resolution;
- no transition frame duplicates, corruption, or shape mismatch;
- no extra audio queue depth and no A/V drift;
- visual review beats the existing pose-match + mouth-neutralization fallback.

If the service is unavailable, late, or returns invalid output, LiveTalking
continues through its existing transition code. RIFE is never required for a
session to start.

The model implementation and weights remain server-local in
`/data/echodigitalpersona/RIFE-experiment`; they are not committed here. The
current checkpoint came from ModelScope's MIT-licensed
`Damo_XR_Lab/cv_rife_video-frame-interpolation` package and has SHA-256
`fe854fc8996547c953f732aaa3b78cae76cc0a12833ae856ea0749c4c570d7d8`.

Measured on the physical 8x A800 host with real 960x720 Ethan persona frames:

| Path | p95 end-to-end |
| --- | ---: |
| recursive, full 960x720 | 243.307 ms |
| recursive, 256x256 face crop | 111.963 ms |
| batched FP32, 256x256 face crop | 165.946 ms |
| batched FP16, 256x256 face crop | 190.785 ms |
| single-pass flow reuse, 256x256 face crop | 85.311 ms |
| single-pass flow reuse, 128x128 face crop | 73.612 ms |

All paths failed the 28 ms gate. The experiment process was stopped after the
benchmark so GPU 5 is free. The generated frames were visually coherent, but
latency—not image validity—prevents safe live activation. See
`docs/rife-liveportrait-runtime-evaluation-2026-08-11.md`.

## LivePortrait boundary

Official LivePortrait is video/image-driven, not audio-driven. The existing
integration therefore remains a persona-training-time enhancer. A runtime
LivePortrait renderer must be a separate feature-flagged process and must have
an independently validated audio-to-motion driver before it can replace
MuseTalk. Passing MuseTalk's output into LivePortrait can be tested as an
enhancement, but it is not a true MuseTalk replacement.
