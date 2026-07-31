# ECHO 回响 — Claude handoff (2026-07-31)

This document records the current factual state of the ECHO codebase and
infrastructure. It is safe to share with another coding agent.

Do **not** add API keys, database URLs, passwords, SSH private keys, Worker
secrets, session cookies, or any other credentials to this document or Git.

## Immediate status

- Repository: `https://github.com/Abbthan/digital-persona`
- Branch: `main`
- Current local/GitHub commit: `e6dc235` (`release: 2026-07-30T07:26:04Z`)
- The working tree was clean when this handoff was created.
- The current production Worker release is still the preceding version:
  `71b8bcff-bb1c-4f9c-84d0-06227870fc31`.
- The most recent hotfix commit `e6dc235` was successfully pushed to GitHub,
  but was **not deployed to Cloudflare** because the deploy command was not
  allowed to start after an approval/network interruption. Do not claim it is
  live until a successful deploy reports a new Worker version.

### Urgent production UI regression

The production chat popup currently uses commit `69f52ff` / Worker version
`71b8bcff-bb1c-4f9c-84d0-06227870fc31`. Its first Liquid Glass experiment can
make the draggable video-chat panel appear invisible over the video stream.

Commit `e6dc235` replaces that risky blend-mode/z-index implementation with a
guaranteed visible translucent base, while keeping a lens-style rim/highlight.
It must be deployed as the immediate next action:

```bash
npm run deploy:cloudflare
```

Only run this after confirming `git status --short` is clean and
`git log -1 --oneline` is `e6dc235` (or a later intentional commit). The
project convention is GitHub-first: push source before Cloudflare deployment.
If the release script is used, it runs verify → commit/push → deploy. If the
commit is already pushed but the release script stalls during GitHub push,
first push the existing HEAD successfully, then deploy that same HEAD. Never
deploy unpushed source.

## Recent code changes

### Proactive persona conversations

Commit `bc12865` added a private, rate-limited proactive-opening feature.

Files:

- `back_end/services/persona-ai.ts`
- `back_end/api/personas/[id]/initiative/route.ts`
- `app/api/personas/[id]/initiative/route.ts`
- `front_end/components/dashboard/PersonaConversationView.tsx`

Behavior:

1. While an active dashboard chat is open and quiet, the browser checks
   sparingly for an initiative.
2. The server enforces an 8-minute quiet period and a deterministic
   “sometimes” cadence to avoid spam.
3. It uses the same persona-scoped RAG/context/style retrieval as normal
   replies.
4. If the LLM is unavailable, lacks usable context, or replies
   `NO_MESSAGE`, nothing is created; it never falls back to canned prompts.
5. A returned opening is stored as a normal `persona` chat message, ingested
   into persona memory, counted once in platform metrics, and spoken by the
   live avatar only if a paid live session is active.

This is deliberately active-chat behavior, not push notifications when the
site is closed. Background re-engagement would require separate user consent,
notifications, and scheduled infrastructure.

### LiveTalking idle-action correction

Files:

- `back_end/services/livetalking.ts`
- `back_end/api/personas/[id]/live-session/idle/route.ts`
- `front_end/components/dashboard/LiveTalkingAvatar.tsx`

The app now explicitly selects LiveTalking idle action type `1` after a
persona session is negotiated. The offer route already configures this action
to use the persona's own source-frame directory:

```text
data/avatars/<avatarId>/full_imgs
```

This fixes an application-side mismatch where action type `0` was being used
instead of the intended silence/idle type.

**Important limitation:** this alone cannot guarantee blinking, breathing, or
a closed resting mouth. Those are renderer/training assets. The current facial
scan includes a spoken consent clip, so looping its raw frames can contain
open-mouth speech frames. The GPU pipeline needs a dedicated closed-mouth
idle sequence (for example, extract/select neutral frames with face/lip
landmarks, then make an idle action directory). Do not fake this as genuine
facial animation with CSS.

### Liquid Glass work

The user asked to restore the homepage dock and apply a corrected Apple
Liquid Glass-inspired effect only to the draggable video chat popup.

- `front_end/components/ui/Dock.tsx` was reverted to its previous dock design.
- `front_end/components/dashboard/PersonaConversationView.tsx` assigns
  `liquid-glass-chat` only to the video-mode chat panel.
- `app/globals.css` contains the new stable material in commit `e6dc235`.

The first attempt used `mix-blend-mode`, pseudo-element stacking, and z-index
layers. It was visually unreliable in the live-video compositor and may make
the panel disappear. The hotfix removes those risky layers. It retains a
visible adaptive translucent base, a high-contrast border/lens rim, inset
highlights, a light/dark variant, and a subtle press flex.

Apple reference used for the intent:

- https://developer.apple.com/videos/play/wwdc2025/219/

Liquid Glass is not merely blur: it responds to the content below, has
translucency, lensing/refraction cues around edges, reflected highlights, and
adaptive legibility. Browser CSS cannot reproduce Apple's system compositor
exactly, so always prioritize visible controls and readable chat over an
aggressive effect.

### Removed unrelated research file

The unrelated local export `output/ai-resurrection-hir-reference.md` was
deleted. `.gitignore` now also explicitly excludes both:

```text
ai_resurrection_hir_reference.md
ai-resurrection-hir-reference.md
```

Checks confirmed it was never tracked by Git and never appeared in repository
history, so no GitHub history rewrite is required.

## Current GPU/server architecture

### Old production A800 (currently active)

The Cloudflare Worker still points `LIVETALKING_SERVER_URL` to the original
Tencent CLB-backed LiveTalking endpoint. That old server remains the live
production backend for:

- LiveTalking WebRTC avatar rendering
- CosyVoice voice generation
- FastWhisper / voice transcription endpoint
- persona-RAG gateway

The old deployment is slow and has exhibited frozen idle video, poor latency,
and past CosyVoice health issues. It should remain only as rollback until the
new machine passes external health and WebRTC tests.

### New physical 8×A800 server

Previous migration work (detailed in `docs/codex-handoff-2026-07-29.md`) had
already copied the ECHO stack, models, persona avatar packages, voice
references, and Chroma RAG data to the new physical 8×A800 server.

The owner has now reported that the public IP-address/network issue has been
fixed. This has not yet been independently revalidated by an agent. The next
agent must connect using the owner-provided SSH configuration (do not put its
key material in source), then verify:

```bash
nvidia-smi
cd /data/echodigitalpersona
```

Required service checks on the new server:

1. LiveTalking health/signalling endpoint on its configured public port.
2. CosyVoice health and an actual reference-voice synthesis test in both
   English and Chinese.
3. FastWhisper transcription health.
4. persona-RAG health and Chroma data availability.
5. coturn and public UDP/TCP mapping for WebRTC.
6. Ethan Ma's persona package and voice reference material.

The intended GPU split is:

- GPU 0: LiveTalking/MuseTalk rendering
- GPU 1: CosyVoice
- additional GPUs: FastWhisper, RAG/indexing, preprocessing, or parallel
  rendering as needed

The new machine has eight GPUs; avoid running all heavy services on one GPU.
Use explicit `CUDA_VISIBLE_DEVICES` values per service and verify with
`nvidia-smi` while under load.

### Safe migration order

1. Prove the new server is reachable over SSH and externally over its
   signalling/API port.
2. Validate the local and external health endpoints for LiveTalking,
   CosyVoice, FastWhisper, RAG, and coturn.
3. Make a test WebRTC session and confirm video time advances while idle and
   while speaking. Check `inferfps`/`finalfps`, GPU utilization, and packet
   loss; do not rely only on SDP success.
4. Confirm the new server can fetch private persona media through the signed
   Worker media endpoint.
5. Test Ethan Ma's existing avatar package, custom voice, English/Chinese
   speech, and a harmless transcription request.
6. Update the encrypted Cloudflare Worker `LIVETALKING_SERVER_URL` secret to
   the new public signalling endpoint only after the previous checks pass.
7. Deploy/restart Worker configuration as required, then test production
   browser WebRTC.
8. Keep the old endpoint documented as rollback until the new server remains
   stable under real traffic.

Never expose the LiveTalking HMAC secret, TURN credentials, SSH private key,
or database URL in code, logs, or this document.

## Known avatar/STT/TTS issues

- A WebRTC session previously connected and delivered media tracks, but the
  video `currentTime` stopped advancing. This identifies a renderer/stream
  problem, not just a frontend layout problem.
- The app was changed to prefer direct STUN connectivity with TURN fallback;
  it no longer forces `iceTransportPolicy: "relay"`, which had added latency
  and produced repeated recoverable ICE errors.
- FastWhisper is not separately configured in Cloudflare secrets. The current
  transcription route forwards to the GPU server's `/api/voice/transcribe`
  endpoint. Verify that endpoint is genuinely backed by FastWhisper on the
  new machine before describing it as such.
- CosyVoice uses a selected reference clip for zero-shot voice cloning; it is
  not yet a full multi-file fine-tune. Existing code chooses a dedicated
  recording first, then the best audio upload, then video audio.
- For lower TTS latency, cache each persona's prepared reference embedding,
  pre-warm models, keep CosyVoice separate from LiveTalking, use FP16/TensorRT
  only after profiling, and stream/chunk only if the target service supports
  it safely.

## LLM and memory implementation

Normal chat uses `back_end/services/persona-ai.ts`:

1. Ownership is checked via `personaId` and authenticated `userId`.
2. Last 12 chat turns are included.
3. Persona-scoped RAG retrieves relevant old conversation/uploads and separate
   style examples.
4. A server-only OpenAI Responses API call generates a bounded reply.
5. User and persona turns are ingested into long-term persona RAG after the
   visible response.

The LLM key is an encrypted Worker secret and must never be read or copied to
source. If replies fail with the generic temporary message, inspect Worker
logs for `[persona-ai]` status errors without logging private prompt content.

This is retrieval-grounded personalization, not a global model fine-tune:

- Each persona/account remains isolated.
- Documents and compact social-profile notes are indexed semantically.
- Raw images/video/audio are not automatically semantic LLM context until a
  separate caption/transcription pipeline has extracted their content.

## Deployment convention

Use the release workflow from the repository root:

```bash
npm run release
```

It verifies, commits approved source changes, pushes to GitHub, then deploys
to Cloudflare. Avoid force pushes and do not deploy code that has not been
pushed. The repository may contain user changes; preserve unrelated edits.

## Validation checklist after the next deployment

- Confirm the chat popup is visibly rendered in video mode and remains
  draggable/minimizable.
- Confirm its chat text, buttons, and input are readable over both a dark and
  bright video frame.
- Confirm the homepage dock has its prior visual design.
- Confirm both custom domains serve the same new Worker version.
- Test one authenticated normal message when LLM billing is available.
- Test one Chinese and one English custom-voice reply after the new GPU server
  is switched.
- Confirm an idle video advances and uses neutral, closed-mouth source frames.
