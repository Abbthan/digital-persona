# GPU avatar blending and live TTS update — 2026-08-10

## Scope

This update addresses two production problems on the eight-GPU server:

1. MuseTalk could fall back to an uncomposited frame when OpenCV received a
   mask whose decoded size did not exactly match the face crop. The existing
   transition then cross-faded the entire image, producing visible double
   eyes/backgrounds between the talking and idle sources.
2. CosyVoice delayed the first audible packet and could starve real-time
   playback. FP16 was not enabled, and `CosyVoice2Model.tts()` accidentally
   enlarged the model-wide streaming hop after each request instead of using
   a request-local adaptive hop.

## Production changes

- `LiveTalking/avatars/musetalk/myutil.py`
  - clamps crop metadata to the decoded frame;
  - resizes the mask to the exact crop size before `cv2.blendLinear`;
  - normalizes both blend weights into contiguous `float32` arrays;
  - safely resizes/clamps the generated face insertion area.
- `LiveTalking/avatars/base_avatar.py`
  - retains the existing nearest-pose talking-to-idle frame selection;
  - removes the full-image `cv2.addWeighted` transition;
  - blends only a feathered mouth/lower-jaw region for five frames (200 ms),
    leaving the destination pose, eyes, shoulders, and background continuous.
- `CosyVoice/runtime/python/fastapi/server.py`
  - adds explicit `--fp16` support;
  - records first-PCM-packet and full-stream timings.
- `CosyVoice/cosyvoice/cli/model.py`
  - makes adaptive token-hop growth local to each utterance, so later requests
    do not silently begin at the maximum hop and wait for finalization.
- `/data/echodigitalpersona/start-cosyvoice.sh`
  - starts CosyVoice with `--fp16` on GPU 1.

The Flow Matching configuration was inspected and was already using 10 steps,
which is inside the requested 10–15 range. The production cross-lingual route
was also already a single streaming generator rather than restarting inference
for every punctuation segment, so neither setting was regressed.

## Validation

- Python syntax checks passed for all four Python files; the launch script
  passed `bash -n`.
- OpenCV regression tests passed for:
  - a 37×39 mask blended into a 70×70 crop;
  - a crop and face box extending beyond the decoded frame boundary.
- CosyVoice started with `fp16=True` and remained healthy on port 9880.
- Repeated warm English and Mandarin synthesis emitted the first PCM packet in
  about 1.53–1.55 seconds. Later chunks ran at roughly 0.55–0.64 RTF, faster
  than real-time playback.
- English output had peak amplitude 32,440 and was transcribed back to the full
  requested English sentence by Faster-Whisper.
- Mandarin output had peak amplitude 32,274 and was transcribed back to the
  full requested Mandarin sentence by Faster-Whisper.
- The production WebRTC dashboard connected to a 960×720, ready-state-4 stream.
- A direct authenticated speech test completed with:
  - one silent-to-talking and one talking-to-silent transition;
  - nearest idle-frame match at frame 160;
  - 47.7 MuseTalk inference FPS (above the 25 FPS output target);
  - no `paste_back_frame` or OpenCV errors.

## Reproducible patches

- Apply `scripts/gpu-server/patches/0023-avatar-blend-mouth-neutralization.patch`
  from the LiveTalking repository root.
- Apply `scripts/gpu-server/patches/0024-cosyvoice-fp16-first-packet.patch`
  from the CosyVoice repository root.
- Apply `scripts/gpu-server/patches/0025-cosyvoice-fp16-launch.patch`
  from `/data/echodigitalpersona`.

The pre-change production files were retained with `pre-...-20260810` suffixes
beside their originals for rollback.
