# LivePortrait idle-loop + talking-loop integration (GPU server)

Adds LivePortrait as a persona-training-time enhancement layer on top of the
existing MuseTalk pipeline — not a replacement for it. See
`docs/claude-conversation-handoff-2026-07-31.md` for the research that ruled
out a pure audio-driven LivePortrait replacement (the official model isn't
audio-driven; the community fork that adds it has no track record).

Both phases are complete: idle motion (Phase 1, the passive scan) and
talking motion (Phase 2, the guided scan) each get their own
LivePortrait-enhanced source, feeding two different parts of LiveTalking's
existing avatar-serving mechanism — see "Two enhancement passes" below.

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
  Shared by both phases — `--animation-region`/`--driving-multiplier` are
  what differ between the idle and talking passes.
- `LiveTalking/server/task_manager.py` — patched
  (`0008-liveportrait-idle-loop-task-integration.patch`, then
  `0010-liveportrait-talking-loop-task-integration.patch`) to run that
  script twice inside the existing single-worker avatar-bake task queue,
  before `generate_avatar()` runs. See "Two enhancement passes" below.
- `LiveTalking/server/avatar_routes.py` — patched
  (`0011-liveportrait-talking-loop-idle-source-plumbing.patch`) so both the
  URL-based and multipart avatar-task endpoints accept an optional second
  source (`idle_source_url`/`idle_file_name` or `idle_video_path`) alongside
  the primary one, canonicalize it the same way, and pass it through as
  `idle_video_path` in task params.
- `LiveTalking/avatars/base_avatar.py` — patched
  (`0007-liveportrait-idle-loop-safe-fallback.patch`) so a missing/empty
  `idle_imgs/` (avatar predates this feature, or the enhancement step
  failed) falls through to LiveTalking's existing no-custom-action
  behavior instead of crashing on the first silence period.
- `back_end/services/livetalking.ts`'s `personaIdleActionConfig()` — always
  points at `idle_imgs/`; safe unconditionally because of the fallback
  above. `submitAvatarTrainingJob()` takes an optional fourth
  `idleSourceAsset` argument, sent as `idle_source_url`/`idle_file_name`.
- `back_end/services/persona-training.ts` — `selectAvatarSourceAsset()` now
  returns the **guided** scan (was the passive scan); a new
  `selectIdleSourceAsset()` returns the passive scan, gated on the same
  three-asset requirement. Both get passed to `submitAvatarTrainingJob()`.

## Two enhancement passes

Both scans get LivePortrait-enhanced inside the same queued task, before
`generate_avatar()` runs, using different regions/intensity:

1. **Idle pass** (`animation_region="eyes"`, `driving_multiplier=0.8`) runs
   on the passive scan (or the main scan, if no separate idle source was
   given — the pre-Phase-2 fallback). Output goes to
   `data/avatars/<id>/idle_imgs/`, consumed directly by LiveTalking's
   existing `custom_img_cycle`/`set_audiotype` mechanism — a plain frame
   dump, no MuseTalk VAE/landmark bake needed since it's just played back
   during silence.
2. **Talking pass** (`animation_region="all"`, `driving_multiplier=1.0`)
   runs on the guided scan (the task's main `video_path`). On success, its
   output directory *becomes* `video_path` before `generate_avatar()` is
   called — `genavatar.py`'s `generate_avatar()` already accepts a directory
   of PNG frames as `video_path` (not just a video file; it copies them
   directly), so no re-encoding back to video is needed. On failure, the
   original canonicalized scan is used instead, exactly like this avatar
   always baked before this feature existed. The intermediate
   `_liveportrait_talking_imgs/` directory is deleted once
   `generate_avatar()` has consumed it.

Neither pass touches `process_frames`/`inference`/any live-rendering code —
MuseTalk's existing audio-driven mouth inpainting runs unmodified on top of
whichever source ended up in `full_imgs/`.

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
- **Real end-to-end verification against an actual persona**: everything so
  far has been validated with LivePortrait's own bundled sample clips
  (`assets/examples/source/s18.mp4`, `s20.mp4`) submitted directly against
  the real GPU HTTP endpoints — proven the full pipeline (idle pass +
  talking pass + `generate_avatar()` bake) works end-to-end, produces
  correct frame counts, correct directory structure, and clean visual
  output. It has **not** been run against a real user's re-recorded
  guided/passive scans yet — Ethan Ma's persona (the project's usual test
  persona) has no assets left to select from, since Codex's video-readiness
  gate requires both scans to exist and this persona predates it. Needs the
  account owner to record both scans through the app before a real
  training run can be tested.
- A one-off standalone `python -c` script invoking `_enqueue_avatar_task`
  directly (bypassing the real `app.py` process) failed with a
  `diffusers`/`AutoImageProcessor` import error that did **not** occur when
  the exact same task was submitted through the real running server
  process via HTTP. Root cause not fully chased down — strongly suspected
  to be an import-order/environment artifact specific to a fresh
  interpreter invoked outside `start-livetalking.sh`'s own env
  (`XDG_CACHE_HOME` etc. also had to be reproduced manually for a
  standalone script to find already-cached models like
  `s3fd-619a316812.pth` instead of re-downloading them from
  adrianbulat.com at ~20KB/s). Always test via the real HTTP endpoints
  against the running process, not standalone scripts, if this comes up
  again.
