# ECHO 回响 — Codex to Claude handover (2026-08-04)

This document continues the coordination history in
`docs/claude-conversation-handoff-2026-07-31.md`. It records the work completed
after Claude's LiveTalking session-limit/SDP incident fix. No API keys,
passwords, database URLs, TURN credentials, or SSH private keys are included.

## Source and production state before the later Wu deployment

- Branch: `main`
- Earlier local/GitHub baseline:
  `05d963c60c991db38a7fc88add3aeb7a3abd5112`
- Commit subject: `fix persona preparation and live session lifecycle`
- Source tree: `ae7c9584f80373753950f2cdbcbf924f2dbb12ea`
- Working tree was clean at the end of the Codex work.
- Production Cloudflare Worker version:
  `5027aef7-f1f5-4bc6-aa32-36a51d877b78`
- Production routes verified with HTTP 200:
  - `https://echodigitalpersona.com/`
  - `https://www.echodigitalpersona.com/`
  - `https://echodigitalpersona.com/dashboard`
  - `https://livetalking.echodigitalpersona.com/index.html`

The Worker was deployed immediately before GitHub synchronization. GitHub's
normal git HTTP endpoint repeatedly reset the connection, so the identical
tree was uploaded through GitHub's authenticated Git Data API with blob, tree,
parent, and commit checks. GitHub omits the final newline in an API-created
one-line commit message, so the local commit object was normalized to the same
canonical GitHub SHA. The deployed source tree and the final local/GitHub tree
are byte-for-byte identical (`ae7c958...`).

Claude subsequently advanced local and GitHub `main` to
`2445f7d86bab5b5fa99497a49fc4375eda22cd56` with the LivePortrait integration
records before Codex synchronized the Wu work. The Wu commit is intentionally
built on top of that revision. Claude also had a separate, uncommitted edit in
`back_end/services/persona-training.ts`; Codex neither staged nor modified it.

## Coordination with Claude's fix

Claude's work in commit `94bd0cb` remains intact:

1. LiveTalking's session-limit rejection returns HTTP 503 rather than a false
   HTTP 200.
2. `LiveTalkingAvatar.tsx` defensively refuses a response body that lacks a
   real SDP answer, so overload errors no longer become cryptic SDP parse
   failures.
3. LiveTalking was restarted with a clean session table after five leaked test
   sessions had filled the old cap.

Codex did not replace that approach. The new work complements it by releasing
sessions normally, reaping abandoned sessions, and increasing conservative
capacity. Do not remove either layer: Claude's validation makes overload
failure understandable; the cleanup changes prevent avoidable overload.

## Work completed in `05d963c`

### 1. Two required facial recordings

- Guided facial scan: 40 seconds, with the bilingual consent/script displayed
  above the camera so the subject looks toward the lens.
- Passive facial scan: 20 seconds, no reading prompt; instructs the subject to
  remain relaxed and use natural blinking, breathing, and small movements.
- The old generic live `VideoRecorderTile` was removed. Ordinary uploaded video
  remains available as an uploaded asset, but it cannot substitute for either
  required scan.
- Create and edit persona windows use the same guided/passive scan controls and
  bilingual labels.
- Deleting a guided or passive recording frees that slot so it can be recorded
  again.

Primary files:

- `front_end/components/persona-wizard/FacialScanTile.tsx`
- `front_end/components/persona-wizard/PassiveFacialScanTile.tsx`
- `front_end/components/persona-wizard/UploadWizard.tsx`
- `front_end/components/dashboard/PersonaManagerModal.tsx`
- `shared/persona-asset-sources.ts`

### 2. Strict video-readiness gate

- A persona receives a LiveTalking avatar only when it has:
  - a usable facial reference image;
  - the guided facial recording; and
  - the passive facial recording.
- The passive recording is selected as the MuseTalk motion source so its real
  relaxed movement supplies idle animation instead of a fabricated static
  placeholder.
- If either scan is missing, the persona finishes as active and chat-usable but
  remains video-disabled (`liveAvatarId = null`, `videoReady = false`).
- The dashboard no longer silently falls back to the built-in generic avatar.
- Live-session and offer routes return HTTP 409 when the persona is not video
  ready.
- Existing personas created before this gate may need both scans recorded again
  before their video toggle becomes available. This is deliberate.

Primary files:

- `back_end/services/persona-training.ts`
- `back_end/api/personas/route.ts`
- `back_end/api/personas/[id]/live-session/route.ts`
- `back_end/api/personas/[id]/live-session/offer/route.ts`
- `front_end/components/dashboard/PersonaConversationView.tsx`

### 3. Truthful preparation progress

- Training now starts with a durable `avatarTrainingTaskId = "starting"`
  sentinel rather than fake client-side progress.
- The avatar job is submitted before slower voice-reference transcription so a
  real GPU task ID is persisted quickly.
- Running progress is clamped to 99%. A response reaches 100% only after the GPU
  reports completion and the database contains the resulting `liveAvatarId`.
- Failed GPU submission/preparation finalizes the persona as chat-usable with an
  error instead of leaving it permanently stuck at 100%.
- The progress component keys dismissal by `trainingStartedAt`, so a later
  retraining run for the same persona appears normally.

Primary files:

- `back_end/services/persona-training.ts`
- `back_end/api/personas/[id]/training/route.ts`
- `front_end/components/dashboard/PersonaTrainingProgress.tsx`
- `front_end/components/dashboard/DashboardShell.tsx`

### 4. WebRTC session lifecycle cleanup

- New authenticated route:
  `POST /api/personas/{id}/live-session/close`
- The client sends a keepalive close request during WebRTC cleanup/unmount.
- LiveTalking now tracks peer connections per session and exposes
  `/close_session`.
- An unconnected/unclaimed session is automatically reaped after 45 seconds.
- This closes the gap that allowed browser navigation/test sessions to consume
  every slot indefinitely.

Primary files:

- `back_end/api/personas/[id]/live-session/close/route.ts`
- `back_end/services/livetalking.ts`
- `front_end/components/dashboard/LiveTalkingAvatar.tsx`
- `scripts/gpu-server/patches/0003-webrtc-session-cleanup.patch`
- `scripts/gpu-server/patches/0004-session-limit-http-status.patch`

### 5. LiveTalking capacity increased

- The GPU server's start script now launches LiveTalking with
  `--max_session 10` instead of the previous default of 5.
- Runtime verification through `/api/admin/config` returned
  `max_session: 10`, `fps: 25`, and `batch_size: 4`.
- `/api/admin/sessions` returned an empty session list immediately after the
  clean restart.
- Recorded repository patch:
  `scripts/gpu-server/patches/0005-max-live-sessions.patch`

The current GPU machine is the new physical 8×A800 server reachable through
the previously configured SSH endpoint at `221.194.152.152:50010`. Use the
existing local SSH key configuration; never copy a private key into the repo.
The LiveTalking HTTP/signalling path continues through the existing Cloudflare
Tunnel. Do not create a second competing tunnel.

`max_session` is a concurrency/resource limit, not a count of GPUs or exposed
ports. Ten is a conservative doubling backed by the observed GPU headroom and
new cleanup behavior. For materially higher concurrency, run multiple
LiveTalking instances on separate GPUs and add sticky session routing/load
balancing. Do not simply raise a single process to 40 or 80 without a measured
load/VRAM/latency test.

## Verification performed

- `git diff --check` — passed.
- `npm run lint` — passed with only the pre-existing unused eslint-disable
  warning in `front_end/state/auth-context.tsx`.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed; the build route table includes the new
  `/api/personas/[id]/live-session/close` route.
- `scripts/verify-persona-training-selection.ts` — passed deterministic tests
  for the two-scan selection/gating rules.
- GPU Python stub test confirmed image-only idle action selection works.
- An existing generated avatar package contained 758 frames; frames 0 and 100
  had substantial pixel difference, confirming that the trained package itself
  contains recorded motion rather than one repeated still frame.
- New GPU LiveTalking admin API reported `max_session: 10` and no leaked
  sessions after restart.
- Both public domains, `/dashboard`, and the LiveTalking tunnel returned 200.
- A signed-in production dashboard loaded with no page console errors.

## Remaining testing boundary / follow-up

The production browser session available during the final verification was
signed into an account with zero personas. Therefore Codex did not claim a new
end-to-end camera capture → training → production WebRTC test during this final
turn. The deterministic gate, GPU package motion, server admin state, Worker
build, public routing, and dashboard rendering were verified, but the next
useful manual smoke test is:

1. Sign into an account suitable for testing.
2. Create or edit a persona and record both facial scans.
3. Confirm progress stays below 100 while the GPU task is running and disappears
   after durable completion.
4. Confirm video remains unavailable if either scan is deleted/missing.
5. With both scans present, start video and verify relaxed recorded movement,
   blinking/breathing, advancing frames, synchronized speech, and successful
   session release after closing video or navigating away.
6. Check `/api/admin/sessions` after closing; the session should disappear
   immediately or be reaped within 45 seconds.
7. Exercise more than five simultaneous clients to confirm the new ten-session
   cap improves real user availability without unacceptable GPU latency.

Do not use the built-in avatar appearing on screen as proof that persona
training worked. The new application code intentionally removes that fallback.

## Safe continuation checklist for Claude

1. Start by confirming `git status --short` is clean and both local HEAD and
   `origin/main` are `05d963c` (or understand any newer commit before editing).
2. Preserve the 503/SDP validation, explicit close route, and 45-second reaper.
3. Do not duplicate or replace the existing Cloudflare Tunnel/TURN path while
   another agent is working on it.
4. If changing GPU runtime files directly, also update/add the corresponding
   patch under `scripts/gpu-server/patches/` so a restart/migration remains
   reproducible.
5. Before production release, run `npm run verify` and the persona training
   selection test.
6. Keep local, GitHub `main`, and Cloudflare deployment synchronized through the
   documented release workflow. Do not commit secrets, model weights, RAG data,
   uploaded persona media, or SSH keys.

## WenetSpeech-Wu STT work (later on 2026-08-04)

This work is deliberately isolated from Claude's Hybrid MuseTalk + LivePortrait
work. Codex did not edit LivePortrait, MuseTalk, LiveTalking, TURN, the existing
Cloudflare Tunnel, or any avatar route.

### Completed and currently running

- Selected ASLP-lab's Apache-2.0 `Conformer-U2pp-Wu` checkpoint, rather than
  replacing the general Faster-Whisper recognizer.
- Pinned WeNet source commit
  `a54b90bc768679bd4217e4c7765c0671fbfb3a7a` and model revision
  `cb53da7aefd9acd0f2af61b9631e49f5c3382686`.
- Verified the linked checkpoint SHA-256:
  `9afd6fd82f8c638bdde993764c3c9c04e74fb8db20dc8399fd8fc6b8a34e7670`.
- Deployed an isolated localhost-only service to
  `/data/echodigitalpersona/services/wenetspeech-wu` with its model under
  `/data/echodigitalpersona/models/wenetspeech-wu/u2++`.
- The service runs in tmux session `echo-wenetspeech-wu` on physical GPU 2 and
  listens only at `127.0.0.1:9890`; it does not expose another public port.
- No packages were installed into LiveTalking or CosyVoice. The service uses
  LiveTalking's existing PyTorch environment read-only and stores its one
  compatibility dependency inside its own `deps/` directory.
- FP32 is intentional: this published checkpoint produced invalid
  attention-rescoring values with FP16 during validation.
- Health verification reports the correct engine, CUDA device, and FP32.
- The official 6.86-second Wu sample transcribed as
  `最早辰光阿拉是做啥呢有钞票呢是到银行里报本报息` in 238 ms with confidence
  0.807, while using approximately 1.1 GB on GPU 2.

Repository source lives in `gpu_services/wenetspeech_wu/`. It includes pure
transcript-selection tests that preserve confident English Faster-Whisper
output while selecting Wu for Chinese/Wu or sufficiently strong uncertain Wu
speech. All four unit tests and Python/shell syntax checks pass.

### Applied to CosyVoice and verified

`scripts/gpu-server/patches/0006-wenetspeech-wu-stt-routing.patch` is the
narrow integration patch. It adds Faster-Whisper language metadata and asks
the localhost Wu service to select the transcript; on timeout or any malformed
response it returns the original STT result. It changes only CosyVoice's
`/transcribe` route and does not touch synthesis.

The patch was applied to `/data/echodigitalpersona/CosyVoice` after a successful
dry run and with a timestamped backup of `server.py`. Python compilation passed.
Only the `echo-cosyvoice` tmux service was restarted for the integration. The
Wu service was subsequently restarted because another operator's earlier
LiveTalking restart had also removed its tmux session; no other GPU service was
modified.

End-to-end verification results:

- Official 6.86-second Wu sample through CosyVoice `/transcribe`: HTTP 200,
  correct Wu transcript, Wu engine selected, confidence 0.807.
- Synthetic Mandarin control: HTTP 200, exact transcript, confidence 0.795.
- Synthetic English control: HTTP 200, exact transcript, Faster-Whisper kept as
  the selected engine with English language probability 0.983.
- Authenticated LiveTalking gateway at `127.0.0.1:8010`: HTTP 200 with the
  correct Wu transcript.
- Authenticated public Cloudflare Tunnel at
  `https://livetalking.echodigitalpersona.com/api/voice/transcribe`: HTTP 200
  with the same correct Wu transcript.

The unauthenticated gateway correctly returned HTTP 401. Test authentication
used a short-lived token generated in server memory from the existing secret;
neither the secret nor the token was printed, copied, or committed.

Operational note: this machine does not currently use systemd or a root crontab
for any ECHO GPU service; all ECHO processes use tmux. Preserve/recreate the
`echo-wenetspeech-wu` session whenever performing a broad tmux restart. The
service launch command remains
`/data/echodigitalpersona/services/wenetspeech-wu/start.sh`.
