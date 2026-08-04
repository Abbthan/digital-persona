# LivePortrait idle-loop integration (GPU server)

Adds LivePortrait as a persona-training-time enhancement layer on top of the
existing MuseTalk pipeline — not a replacement for it. See
`docs/claude-conversation-handoff-2026-07-31.md` for the research that ruled
out a pure audio-driven LivePortrait replacement (the official model isn't
audio-driven; the community fork that adds it has no track record).

## Where things live

- `/data/echodigitalpersona/LivePortrait-experiment/` — a full, isolated
  clone of `KwaiVGI/LivePortrait` with its own venv (`.venv/`) and pretrained
  weights (`pretrained_weights/`, ~2GB, downloaded via hf-mirror.com — direct
  HuggingFace access from this host is effectively blocked). None of this is
  tracked in git; it's GPU-server-local infrastructure, the same way
  LiveTalking's and CosyVoice's own venvs and model weights aren't tracked.
- `LivePortrait-experiment/enhance_and_extract.py` — the actual integration
  script (tracked here as `scripts/gpu-server/patches/0009-liveportrait-enhance-and-extract-script.patch`,
  a whole-new-file "patch" against `/dev/null`, since it's not a diff of an
  existing upstream file). Runs self-driven LivePortrait (source video,
  dummy static-image driving input) and extracts the result as a zero-padded
  PNG sequence, matching MuseTalk's own `full_imgs/` naming convention.
- `LiveTalking/server/task_manager.py` — patched
  (`0008-liveportrait-idle-loop-task-integration.patch`) to invoke that
  script as a subprocess, inside the existing single-worker avatar-bake task
  queue, before `generate_avatar()` runs. Writes to
  `data/avatars/<avatar_id>/idle_imgs/`.
- `LiveTalking/avatars/base_avatar.py` — patched
  (`0007-liveportrait-idle-loop-safe-fallback.patch`) so a missing/empty
  `idle_imgs/` (avatar predates this feature, or the enhancement step
  failed) falls through to LiveTalking's existing no-custom-action
  behavior instead of crashing on the first silence period.
- `back_end/services/livetalking.ts`'s `personaIdleActionConfig()` — always
  points at `idle_imgs/`; safe unconditionally because of the fallback
  above.

## Why a separate venv/process, not an in-process import

LivePortrait's dependency set (`onnxruntime-gpu`, `gradio`, `tyro`,
`albumentations`, ...) is a real conflict risk against LiveTalking's own
torch/CUDA install if merged into the same environment — this was proven
directly while setting this up: `pip install -r requirements.txt` silently
upgraded torch to an incompatible CUDA-13 build via a loose transitive
dependency (`albumentations` → `albucore>=0.0.11`, which today resolves to a
release requiring `torch>=2.13`), breaking CUDA init entirely until pinned
back down (`albucore==0.0.11`, recorded in
`LivePortrait-experiment/requirements-frozen.txt` on the GPU box). Keeping
LivePortrait in its own venv, invoked via `subprocess`, isolates that risk
completely — the same pattern CosyVoice already uses as a standalone service
rather than an in-process import.

## GPU allocation

LivePortrait runs pinned to `CUDA_VISIBLE_DEVICES=2` — GPUs 0 and 1 are
LiveTalking's and CosyVoice's live-serving processes respectively; GPUs 2-7
were confirmed idle when this was set up. Real measured speed on this A800:
~57ms/frame (~17.6fps sustained), i.e. a few tens of seconds for a passive
scan's worth of video — acceptable as a one-time background step during
persona training, not something that runs in the live chat path at all.

## Known follow-up, not done yet

- **License compliance before production ship**: LivePortrait vendors its
  own InsightFace subtree. Two specific weight files need replacing before
  any real customer's persona goes through this pipeline:
  `det_10g.onnx` (face detector — YuNet, Apache-2.0, is a clean swap) and
  `2d106det.onnx` (106-point dense landmarks — YuNet only gives 5 points, so
  this needs a separately-licensed dense-landmark model, e.g. MediaPipe Face
  Mesh, with real integration work in `src/utils/face_analysis_diy.py` and
  `src/utils/cropper.py`). Everything built so far has only run against
  LivePortrait's own bundled sample clips and this project's now-deleted
  pre-gate test persona — not yet validated against a real user's re-recorded
  guided/passive scans.
- **Phase 2 (talking-loop realism)**: not yet built. Plan: switch
  `selectAvatarSourceAsset()` to the guided (talking) scan instead of the
  passive scan, LivePortrait-enhance it the same way, and let it become the
  avatar's primary baked source — MuseTalk's own audio-driven mouth
  inpainting then runs unmodified on top. See
  `docs/claude-conversation-handoff-2026-07-31.md`'s plan for the full
  reasoning (why this needs no changes to `process_frames`/live rendering
  code at all).
