# RIFE and LivePortrait runtime evaluation — 2026-08-11

## Outcome

Neither experiment was promoted to production. The existing LiveTalking +
MuseTalk renderer remains active and unchanged.

- RIFE produced visually coherent transition frames, but every tested path
  missed the deadline required by the 25 fps render loop.
- LivePortrait's official implementation cannot replace MuseTalk by itself
  because it is driven by image/video motion, not audio. Its measured runtime
  on this server also leaves too little headroom once transport, crop/pasteback,
  and the existing mouth renderer are included.
- The isolated RIFE service was stopped after testing, leaving GPU 5 free.
- No Cloudflare Worker, public route, LiveTalking process, or customer data was
  changed by this evaluation.

## RIFE experiment

The experiment uses a localhost-only raw BGR protocol. It never passes image
buffers through Cloudflare, R2, Base64, or JSON. The ModelScope HDv3 checkpoint
is pinned by SHA-256:

`fe854fc8996547c953f732aaa3b78cae76cc0a12833ae856ea0749c4c570d7d8`

The benchmark pair was selected from the migrated Ethan persona package:

- talking frame: `full_imgs/00000367.png`
- nearest idle frame: `idle_imgs/00000123.png`
- source resolution: 960x720
- three generated frames: quarter, midpoint, and three-quarter

### Results on GPU 5

| Implementation | Input | Median | p95 | Maximum | 28 ms gate |
| --- | ---: | ---: | ---: | ---: | --- |
| Recursive HDv3 (three model calls) | 960x720 | 213.706 ms | 243.307 ms | 243.307 ms | Fail |
| Recursive HDv3 | 256x256 | 98.145 ms | 111.963 ms | 111.963 ms | Fail |
| Recursive HDv3 | 384x384 | 102.810 ms | 123.472 ms | 123.472 ms | Fail |
| Batched second pass, FP32 | 256x256 | 156.946 ms | 165.946 ms | 165.946 ms | Fail |
| Batched second pass, FP16 autocast | 256x256 | 172.771 ms | 190.785 ms | 190.785 ms | Fail |
| Single network pass + reused bidirectional flow | 256x256 | 78.183 ms | 85.311 ms | 87.140 ms | Fail |
| Single network pass + reused bidirectional flow | 128x128 | 69.629 ms | 73.612 ms | 75.526 ms | Fail |

FP16 was slower for this legacy graph, so it must not be described or enabled
as an optimization without a different engine. The best path still consumes
almost two 25 fps frame periods at an unacceptably small 128x128 resolution.
A synchronous integration would stall the renderer and risk A/V drift.

The safe next RIFE direction is a training-time/precomputed cache or a separate
TensorRT engine with a new measured latency gate. Runtime activation must remain
fail-open and feature-flagged. The existing nearest-pose selection plus
mouth-neutralization transition remains the production fallback.

## LivePortrait experiment

The official LivePortrait benchmark was run in its isolated environment on GPU
6. Measured component latency was:

| Component | Time |
| --- | ---: |
| Appearance feature extractor | 2.17 ms |
| Motion extractor | 5.81 ms |
| Warping | 8.66 ms |
| SPADE generator | 11.44 ms |
| Stitching/retargeting | 0.45 ms |

With appearance cached, the live-frame subtotal is approximately 26.36 ms
before crop/pasteback, process communication, frame copies, WebRTC delivery, or
the audio-driven renderer. `torch.compile` was also unavailable in the existing
environment because its installed Triton package lacks `triton_key`; eager mode
was used for the measurements.

More importantly, official LivePortrait requires a driving image or video. It
does not derive jaw, cheek, eye, throat, or pose motion from an audio waveform.
Feeding a MuseTalk-rendered frame into it would retain MuseTalk as the actual
audio-motion driver and cannot invent motion that the driving frame does not
contain. That can be evaluated later as a visual refinement, but it is not the
requested MuseTalk replacement.

The existing LivePortrait use therefore remains correct: an isolated
persona-training-time enhancer for the recorded guided/passive source loops,
while MuseTalk stays responsible for live audio-driven lip motion. A true
runtime replacement first needs a validated bilingual audio-to-expression/
pose driver, then an isolated service benchmark and side-by-side visual test.

## Production verification after the experiment

After stopping the RIFE tmux process, LiveTalking's local admin endpoint still
returned `code: 0`, model `musetalk`, transport `webrtc`, 25 fps, and
`max_session: 10`. No production restart was performed.

## References

- RIFE official repository: <https://github.com/hzwer/ECCV2022-RIFE>
- FILM official repository: <https://github.com/google-research/frame-interpolation>
- LivePortrait official repository: <https://github.com/KwaiVGI/LivePortrait>
- LivePortrait paper: <https://arxiv.org/abs/2407.03168>
