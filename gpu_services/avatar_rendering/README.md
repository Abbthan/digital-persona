# Experimental avatar rendering services

This directory contains optional, fail-open GPU experiments. Production
LiveTalking/MuseTalk remains the default renderer.

## RIFE transition interpolation

`rife_service.py` runs on `127.0.0.1:9030` on GPU 5. It generates three runtime
intermediate frames for both idle→talking and talking→idle boundaries. Frames
use a bounded raw-binary localhost protocol; no Base64, R2, Worker, or public
route is involved.

As of 2026-08-14 the feature-flagged client is wired into production
LiveTalking. The three interpolation frames replace the next three ordinary
video frames; they are not inserted, so audio and video packet counts and
timestamps remain unchanged. A state change cancels any older pending
transition. If the service is unavailable, overloaded, late, or returns an
invalid response, LiveTalking immediately continues through its established
pose-match + mouth-neutralization transition. RIFE is never required for a
session to start.

The startup script attempts to bring up the localhost service on GPU 5, but it
does not block LiveTalking startup if RIFE fails. Runtime activation is
controlled by `RIFE_TRANSITION_ENABLED`, `RIFE_TRANSITION_URL`, and
`RIFE_TRANSITION_TIMEOUT_MS` (currently 750 ms).

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

All paths failed the original 28 ms gate. The product decision on 2026-08-14
explicitly relaxed that gate in favor of runtime continuity. With single-pass
flow reuse at 960×720, the new bidirectional test measured 195.993 ms median /
204.606 ms p95 for idle→talking and 194.366 ms median / 210.326 ms p95 for
talking→idle. See `docs/runtime-rife-bidirectional-2026-08-14.md` and the older
baseline in `docs/rife-liveportrait-runtime-evaluation-2026-08-11.md`.

## Offline RIFE transition bank

`build_offline_transition_bank.py` and `offline_transition_bank.py` implement
a bounded preparation-time experiment. The builder selects eight talking-pose
anchors, maps each talking frame to an anchor, finds the closest idle frame,
and bakes three RIFE intermediates. The loader validates a versioned,
atomically published manifest and shares immutable decoded frames through a
small LRU cache.

The bank is deliberately **not wired into production**. On the Ethan persona,
24 frames baked in roughly 7–10 seconds and runtime selection became a memory
lookup, but different camera framing between guided and passive recordings
still produced unacceptable hair/background arcs. Offline execution removes
latency, not incorrect optical correspondence. Activation patches were removed
so it cannot be enabled accidentally. See
`docs/offline-rife-audio-driver-evaluation-2026-08-12.md`.

## LivePortrait boundary

Official LivePortrait is video/image-driven, not audio-driven. The existing
integration therefore remains a persona-training-time enhancer. A runtime
LivePortrait renderer must be a separate feature-flagged process and must have
an independently validated audio-to-motion driver before it can replace
MuseTalk. Passing MuseTalk's output into LivePortrait can be tested as an
enhancement, but it is not a true MuseTalk replacement.

EchoMimic V1/V2 are offline diffusion pipelines and miss real-time throughput.
The community LivePortrait-AudioDriven project requires a custom MEAD training
run and its own statistics/checkpoint. The official Apache-2.0 Ditto pipeline,
which provides an online HuBERT configuration and TensorRT engines, is the next
isolated candidate. It must pass latency, bilingual lip-sync, idle-motion, and
A/V continuity gates before any production renderer switch.

An isolated Ditto checkout and Python/TensorRT environment exist on the GPU
server, but the model artifacts are not installed and no Ditto process is
running. Do not point production at that directory or advertise benchmark
results until the model download, local warp-engine build, and the promotion
gates in `docs/offline-rife-audio-driver-evaluation-2026-08-12.md` are complete.
