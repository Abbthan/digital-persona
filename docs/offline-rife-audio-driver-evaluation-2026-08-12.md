# Offline RIFE and audio-to-expression evaluation — 2026-08-12

## Decision

No production renderer was changed during this evaluation. LiveTalking and
MuseTalk remain active. The experiments used free GPU 5+ in isolation; no
public port, tunnel, Cloudflare Worker, or customer-facing route was modified.

## Offline RIFE result

The offline design works mechanically:

- select eight representative talking-pose anchors;
- choose the nearest idle pose for each anchor;
- precompute three RIFE frames per anchor during persona preparation;
- atomically publish a versioned manifest and 24 PNG frames;
- validate source frame counts and dimensions when loading;
- share immutable decoded frames through a bounded LRU cache;
- fail open to the existing pose-match + mouth-neutralization transition.

For the Ethan test persona (734 talking frames, 258 idle frames, 960x720), the
GPU portion took approximately 7–10 seconds. The first cold decode of 24 PNGs
was previously measured at about 367 ms during session construction, decoded
memory at about 47.5 MB, and cached lookup below 0.001 ms. This eliminates
runtime RIFE inference.

However, the source recordings use different camera framing. Full-frame RIFE
warped the ceiling and chandelier. Semantic person masks still admitted a
chandelier/hair halo, and deterministic face masks still exposed a visible
warped hair arc. The problem is incorrect optical correspondence already
present in the interpolated image, not runtime latency or cache lookup.

Therefore the implementation remains opt-in and is not imported by production.
Activation patches were removed. A future retry must normalize both recordings
to one canonical crop or derive talking and idle states from one source.

## Audio-to-expression candidates

### EchoMimic V1 and V2

Official accelerated performance is about 50 seconds for 240 V1 frames on V100
(roughly 4.8 fps), and 50 seconds for 120 V2 frames on A100 (roughly 2.4 fps).
Both show English and Chinese results, but neither is a 25 fps conversational
renderer.

### Community LivePortrait-AudioDriven

This project describes the desired architecture (Whisper audio features to a
keypoint predictor to LivePortrait), but its instructions require preprocessing
MEAD, training the model, and supplying the resulting `statistic.pt` and a
separately trained `pretrained_model_path`. It is not a ready pretrained
production component.

### Ditto

The official Apache-2.0 Ditto project is the most suitable isolated successor
candidate found here. It includes an online HuBERT audio configuration,
streaming audio-to-motion inference, LivePortrait-derived whole-face
warp/decode stages, ONNX/Ampere+ TensorRT artifacts, and an official Python
3.10 / TensorRT 8.6.1 reference environment.

The repository was cloned server-side to
`/data/echodigitalpersona/Ditto-experiment` at commit
`c3e47eee2e626500017a0556b470d6d4182f85e8`. It is not imported or started by
production. An isolated Python 3.10 environment now imports TensorRT 8.6.1 and
PyTorch 2.5.1+cu121 successfully on A800 GPU 6. GPU 6 has no persistent Ditto
process and no public listener.

The official model inventory has been recorded, but no model checkpoint has
been downloaded yet. In particular, the public model repository does not ship
the `warp_network_fp16.engine` named in the README; it ships the corresponding
ONNX graph and TensorRT plugin. A faithful benchmark therefore requires the
official model subset (about 2.2 GB), followed by an isolated conversion of
that one ONNX graph. Until that succeeds, there is no measured Ditto frame rate,
first-frame latency, bilingual lip-sync result, or production claim.

Its checkpoint benchmark is a separate promotion gate and must not overwrite
MuseTalk or LiveTalking.

## Verification state

- Local pure-data tests: 4 passed; the OpenCV decode test was skipped because
  OpenCV is intentionally absent from the local web environment.
- GPU-runtime tests: all 5 passed, including OpenCV decoding and immutable
  frame validation.
- Production LiveTalking: port 8010 remains bound by the pre-existing Python
  process. No restart, renderer import, feature flag, public route, tunnel, or
  Cloudflare deployment occurred in this evaluation.
- The old `/admin/sessions` diagnostic route returns 404 on the current server
  build; listener/process health was verified directly instead.

## Promotion gates

1. Sustain at least 25 fps at the real persona resolution.
2. Measure first-frame and steady-state latency, not only offline throughput.
3. Verify complete English and Chinese utterances with phoneme-aligned lips.
4. Preserve blink, gaze, head, cheek, jaw, and throat movement.
5. Provide continuous idle/listening motion and smooth talk/idle boundaries.
6. Keep MuseTalk/LiveTalking available as an immediate fallback.
7. Run in a separate process/GPU over a bounded local protocol.
8. Pass side-by-side visual review before enabling any feature flag.

## Sources

- EchoMimic: <https://github.com/antgroup/echomimic>
- EchoMimic V2: <https://github.com/antgroup/echomimic_v2>
- Community LivePortrait-AudioDriven:
  <https://github.com/Hekenye/LivePortrait-AudioDriven>
- Ditto: <https://github.com/antgroup/ditto-talkinghead>
