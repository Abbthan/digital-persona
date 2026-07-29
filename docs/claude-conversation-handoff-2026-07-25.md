# Claude conversation handoff — 2026-07-25

Covers everything from the initial "set up LiveTalking on the A800" request through
today. This is the AI-persona video/voice/memory stack: a standalone GPU box running
three Python services, talked to from this Next.js app's Cloudflare Worker and
directly from the browser. Read this before touching anything under
`back_end/services/livetalking.ts`, `back_end/services/persona-rag.ts`,
`front_end/components/dashboard/LiveTalkingAvatar.tsx`, or anything on the A800 box.

See also `docs/livetalking-integration.md` (avatar/voice architecture in depth) and
`docs/persona-rag.md` (memory/RAG system in depth) — this doc is the narrative
connecting them plus everything not yet folded into those two.

## The GPU box

- Reached over SSH: `ssh -p 22 root@lb-ijqmz1bb-80pgjba6q4w2z9hl.clb.sh-tencentclb.com`
  (password auth, not in any repo file). Working directory `/root/ethan/`.
- **This is a Kubernetes pod, not a plain VM** (`cat /proc/1/cgroup` shows
  `/kubepods/...`). Its real interface IP is `172.18.0.204` — a cluster-internal
  address, never routable from the internet. Every external-facing port is a
  Tencent Cloud CLB (Cloud Load Balancer) listener mapping `<external host>:<external
  port>` → `172.18.0.204:<internal port>`, configured by the user (I have no console
  access — every port opening in this doc was requested from and done by the user).
  **This constraint drove most of the debugging described below** — assume nothing
  on this box is reachable from outside until a specific CLB mapping is confirmed.
- Outbound internet is throttled for GitHub/HuggingFace/Google specifically;
  ModelScope/Tsinghua-mirror-PyPI/Quark are fast without it. The proxy:
  `source /share_data/zhanglin/clash_2.0.24_linux_amd64/setproxy`. SSHing into
  `~ethan` was set up to auto-source this.
- Three real services, one GPU, three isolated venvs (deliberately — avoids replaying
  the multi-hour dependency fights described below):
  | Service | Dir | venv | Port (internal) | tmux session |
  |---|---|---|---|---|
  | LiveTalking (avatar+voice serving, WebRTC, HTTP signaling, and now a reverse proxy for RAG) | `~/ethan/LiveTalking` | own | 8010 | `livetalking-server` |
  | CosyVoice (voice cloning + Whisper transcription) | `~/ethan/CosyVoice` | own, `torch==2.3.1` | 9880 (localhost only) | `cosyvoice-server` |
  | persona-rag (vector memory FastAPI) | `~/ethan/persona-rag` | own, `torch==2.5.1+cu121` | 9000 (localhost only) | `persona-rag` |
  | coturn (TURN relay for WebRTC media) | n/a (apt package) | n/a | 3478 control + 49160-49169 relay | `turn-server` |
- Restart pattern used throughout: `tmux send-keys -t <session> C-c`, wait ~3s,
  `tmux send-keys -t <session> '<same launch command>' Enter`, wait ~15-18s for model
  load, then `tmux capture-pane -t <session> -p -S -N` to confirm clean startup.
  LiveTalking's launch command:
  ```
  python app.py --transport webrtc --model musetalk --avatar_id musetalk_test1 \
    --tts cosyvoice --TTS_SERVER http://127.0.0.1:9880
  ```

## Currently reachable external endpoints

- `http://lb-ijqmz1bb-80pgjba6q4w2z9hl.clb.sh-tencentclb.com:4262` → LiveTalking's
  port 8010 (**plain HTTP, not HTTPS** — see the mixed-content section below for why
  that matters). All of `/offer`, `/human`, `/api/avatar/*`, `/api/voice/*`,
  `/api/rag/*` live here. **GET requests to this listener get redirected to
  Tencent's own docs page — POST works fine.** Two GET-only upstream endpoints
  (`/api/avatar/task/{id}`, `/api/avatar/tasks`) got POST aliases registered
  specifically to work around this; this app's client always uses POST for them.
- `turn:lb-ijqmz1bb-80pgjba6q4w2z9hl.clb.sh-tencentclb.com:37647?transport=udp` and
  `:35227?transport=tcp` → coturn's port 3478 (UDP and TCP got different external
  ports from the same CLB — not a mistake, that's just how Tencent's console
  assigned them).
- The relay port range coturn needs (49160-49169 UDP) — **status unconfirmed as of
  this writing**. See "Outstanding" below.

## How auth works between this app and the GPU box

Every GPU-box call (both from this app's backend and directly from the browser) is
gated by a short-lived HMAC-signed token, because LiveTalking has no auth of its own:

```
base64url(JSON{uid, pid, exp}) + "." + base64url(HMAC-SHA256(secret, payload))
```

- Minted by `createLiveSessionToken(userId, personaId)` in `back_end/services/livetalking.ts`
  (Web Crypto). 10-minute TTL (`LIVE_SESSION_TOKEN_TTL_SECONDS`).
- Verified by `digital_persona_auth_middleware` in `app.py` (Python `hmac`,
  cross-checked compatible with the TS side). Reads `LIVETALKING_SESSION_SECRET`
  lazily via `os.environ.get()` inside the function — **not** at module import time
  (an earlier bug: it was read before `load_dotenv()` ran, so it was always empty).
- Server-to-server calls (training submission, RAG ingestion, etc.) use a fixed
  `uid: "system"` token minted by the same function.
- Shared secret lives in `.env`'s `LIVETALKING_SESSION_SECRET` (this repo) and
  `~/ethan/LiveTalking/.env`'s `LIVETALKING_SESSION_SECRET` (the GPU box) — must be
  the literal same string in both places. Also set as a Cloudflare Worker secret in
  production (`wrangler secret put LIVETALKING_SESSION_SECRET`).
- `persona-rag`'s own auth (`auth.py` on the GPU box) reuses this exact same
  token/secret scheme rather than inventing a second one.

## Avatar + voice training pipeline (per persona)

Full detail in `docs/livetalking-integration.md`; summary here:

- Triggers automatically: once at persona creation (`/finish`), and again on any
  later add/delete of a `video`, `facial_scan`, or `audio` asset once the persona is
  already `active`.
- **Avatar (MuseTalk 1.5, FP16)**: source priority is an uploaded video **confirmed
  by real face-recognition comparison** (`POST {LT}/api/avatar/face-match`, using the
  `face_recognition` library, 128-d embedding distance ≤0.6 = match) to show the same
  person as the persona's `facial_scan`, else the facial scan itself (looped into a
  short clip via ffmpeg). A video that doesn't match the facial scan is never used —
  this stops a mis-tagged or generic video from becoming someone else's avatar.
  `avatarId` is always `persona_<personaId>`, deterministic, so a retrain overwrites
  rather than accumulates.
- **Voice (CosyVoice zero-shot cloning)**: source priority is the one dedicated
  voice recording, else the largest uploaded audio file. Its transcript (needed as
  CosyVoice's `prompt_text`) comes from openai-whisper's "base" model — real,
  smallest/fastest tier, so accuracy is modest, especially on Chinese audio.
  `refAudio` path is always `data/voice_refs/<personaId>.wav`, computed by
  `voiceRefPath()`, not stored in the DB.
- No partial/selective unlearning for either model — a delete that removes the only
  source means the next full retrain has nothing to work from. (RAG, below, is the
  one exception with real selective deletion.)
- **Real race condition found and fixed**: `load_avatar()` in
  `avatars/musetalk_avatar.py` used to `torch.load()` a freshly-trained avatar's
  `latents.pt` with zero tolerance for the file still being written — a user opening
  a persona's conversation view moments after finishing the wizard could hit
  `FileNotFoundError` → surfaced to the browser as "Avatar server returned 500." Now
  waits up to 60s (polling every 1s) for all required files to exist before loading.
  Backup at `avatars/musetalk_avatar.py.bak-pre-race-fix`.

## EdgeTTS fallback (today's earlier work)

- `tts/cosyvoice.py`'s `CosyVoiceTTS.txt_to_audio` used to `open(reffile, 'rb')`
  unconditionally — crashed for **any** session with no trained voice reference,
  which included the server's own default demo avatar (no `--REF_FILE` flag is
  passed at startup, so its `ref_file` is always empty). Patched to fall back to an
  internally-instantiated `EdgeTTS` for that utterance when `ref_file` is empty, so
  every persona is audible immediately, cloned voice or not. Verified with a real
  synthesis test (non-silent audio, 103/139 frames) and confirmed the real
  zero-shot-cloning path is unaffected (128/129 frames) using a real saved
  reference. Backup: `tts/cosyvoice.py.bak`.

## Whisper STT — always-on conversation mic

- `front_end/components/dashboard/PersonaConversationView.tsx`'s mic used to be a
  fake push-to-talk button that just sent the literal string `"(voice message)"`.
  Now: toggling it on starts a continuous Web Audio `AnalyserNode` volume-threshold
  loop that segments speech from silence — an utterance ends after ~1.5s of quiet,
  and the next `MediaRecorder` segment starts immediately so the user can keep
  talking without touching the button again.
- Each segment is transcribed via a **new, ephemeral** GPU-box endpoint,
  `POST /api/voice/transcribe` (`app.py`) — proxies to CosyVoice's `/transcribe`
  and deletes its temp files immediately after. Unlike `/api/voice/reference`
  (training-time), nothing is persisted here.
- Reached via `back_end/services/livetalking.ts`'s `transcribeVoiceClip()` →
  `back_end/api/personas/[id]/transcribe/route.ts` → browser.
- The reply is still `getPersonaReply()`'s canned echo — STT was wired ahead of any
  real reply generation, by explicit instruction, not an oversight.

## RAG memory system (persona-rag)

Full detail in `docs/persona-rag.md`; summary here. **No LLM is called anywhere in
this system** — it's retrieval + prompt-assembly infrastructure built ahead of an
LLM integration, by explicit instruction.

- New standalone FastAPI service, `~/ethan/persona-rag/` on the GPU box (own venv:
  fastapi, chromadb, sentence-transformers, PyMuPDF, python-docx, pytesseract).
  Reached via a generic reverse proxy in `app.py` (`rag_proxy`, forwards
  `{LT}/api/rag/*` → `127.0.0.1:9000/api/rag/*`) rather than its own external port.
- **Embedding model**: `BAAI/bge-m3` — chosen specifically because it's genuinely
  strong at both Chinese and English in the same vector space. Verified with a real
  cross-lingual test: an English query correctly ranked a Chinese-language memory
  above unrelated English facts. Runs on GPU (`torch==2.5.1+cu121`, matching
  LiveTalking's proven-working version — the venv's first, unpinned
  `sentence-transformers` install had pulled an incompatible newer torch build that
  silently fell back to CPU; fixed by reinstalling pinned to the known-good CUDA
  build). Loads with `HF_HUB_OFFLINE=1` set (it's fully cached locally; without this
  it occasionally hangs trying an online freshness-check against huggingface.co).
- **Vector store**: Chroma, persisted to `persona-rag/data/chroma/`, one collection
  with `persona_id`/`source_type`/`asset_id`/`message_id` metadata per chunk.
- **Ingests**: every uploaded document (PDF/DOCX/TXT — native text plus OCR via
  `pytesseract` `lang="chi_sim+eng"` of any images embedded in it, verified with real
  generated test files including a genuinely garbled OCR case that turned out to be
  an image-quality limit, not a pipeline bug) and every **user** chat message (not
  the persona's canned-echo reply — ingesting that would just teach the retriever to
  surface "You said: ..." as a memory; revisit once replies are real).
- **Real, exact selective deletion** — unlike the avatar/voice models, forgetting one
  document or message doesn't need a full rebuild.
- `compose-prompt` endpoint retrieves relevant chunks and assembles a system+context
  prompt string, ready for a future LLM call — not wired into `getPersonaReply()` yet
  (computing real retrieval and discarding it would add latency for no benefit until
  an LLM exists to send it to).
- Wiring point for later: `back_end/services/persona-rag.ts` has all the client
  functions (`ingestDocument`, `ingestConversationMessage`, `deleteRagSource`,
  `deleteAllRagData`, `composePersonaPrompt`) already built and tested.

## The WebRTC connectivity saga (three separate, unrelated bugs)

The user reported "Couldn't reach the avatar server in time" / "failed to fetch",
then later "video window is empty, no error." These turned out to be **three
different bugs**, diagnosed and fixed one at a time:

1. **Mixed content.** The browser (`https://echodigitalpersona.com`) can't `fetch()`
   a plain-`http://` URL — browsers block this outright. `LiveTalkingAvatar.tsx` used
   to `fetch()` LiveTalking's `:4262` URL directly from the browser for the `/offer`
   and `/human` signaling calls. Fixed by proxying just those two calls through new
   same-origin HTTPS routes (`back_end/api/personas/[id]/live-session/offer/route.ts`,
   `.../human/route.ts`) which mint their own token server-side — the browser no
   longer needs to know the raw GPU-box URL/token at all for signaling. (The actual
   WebRTC *media* still connects browser-to-GPU-box directly — that part structurally
   can't go through the Worker, and isn't subject to mixed-content rules anyway,
   since it's not a `fetch`/XHR call.)
2. **Silent UI on connection failure.** `LiveTalkingAvatar.tsx` used to set
   `status: "connected"` right after the SDP exchange finished, without checking
   whether the actual ICE/media connection succeeded. If media then failed, the UI
   showed a blank video with no error, forever. Fixed: now listens for
   `connectionstatechange` and only shows "connected" once `pc.connectionState ===
   "connected"`; shows a real error on `"failed"`.
3. **No route to the GPU box's media port at all.** This is the Kubernetes-pod
   constraint from the top of this doc. Diagnosed by injecting a
   `RTCPeerConnection` monkey-patch into a live browser session and reading real
   values: `iceConnectionState` went `checking` → `disconnected` after ~15s (ICE's
   own timeout), and the SDP answer's candidates showed the server's host candidate
   as `172.18.0.204` (unroutable) and its STUN-discovered candidate as a real public
   IP (`43.142.95.73`) on a port that simply isn't forwarded anywhere. STUN alone
   cannot fix this — it can only discover a public address, not make an unforwarded
   port reachable. **Fix: a TURN relay.** Installed `coturn` on the same GPU box
   (apt), verified it actually relays with `turnutils_uclient` (0 packets lost) before
   asking for any port to be opened. Config at `~/ethan/turnserver.conf`; credentials
   in `~/ethan/LiveTalking/.env` (`TURN_USERNAME`/`TURN_CREDENTIAL`, static long-term
   auth — not the more sophisticated ephemeral-credential mode coturn also supports,
   which would be a reasonable future hardening). Wired into both sides:
   - Server (`server/rtc_manager.py`, `RTCManager.handle_offer`): reads
     `TURN_SERVER_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` from env, adds as a second
     `RTCIceServer` alongside the existing STUN one. Uses coturn's **internal**
     address (`172.18.0.204:3478`) since the server is on the same host — no need to
     round-trip through the external CLB to reach itself.
   - Browser (`back_end/services/livetalking.ts`'s `turnServerConfig()` →
     `live-session` route → `LiveTalkingAvatar.tsx`): uses coturn's **external**
     CLB address(es), since the browser is remote. `TURN_SERVER_URL` is
     comma-separated because TCP and UDP got different external ports (see above);
     split into an array and passed as `RTCIceServer.urls`.
   - Set as Cloudflare Worker secrets: `TURN_SERVER_URL`, `TURN_USERNAME`,
     `TURN_CREDENTIAL`.
   - Verified the browser receives the correct config (captured the real
     `RTCPeerConnection` constructor args mid-session, confirmed both TURN URLs and
     credentials present). **Not yet verified: an actual successful end-to-end
     connection** — see Outstanding below.

## Delete-flow robustness (today, prompted by a real production bug report)

User reported "Couldn't delete the selected upload"/"Couldn't delete the selected
persona" on the live site. Root cause not conclusively caught live in production
logs, but a real, plausible mechanism was found and fixed regardless (this was very
likely triggered by GPU-box services being mid-restart during unrelated maintenance
at that exact moment):

- `deleteAllRagData`, `deletePersonaGpuFiles`, `deleteRagSource` (all GPU-box calls
  made during delete) now have an 8s `AbortSignal.timeout()` — previously an
  unresponsive box could hang the request past Cloudflare's own execution limit,
  producing a raw failure instead of the intended graceful degradation.
- R2 media deletion (`deletePersonaMedia`) is now best-effort/logged rather than
  fatal in both `back_end/api/personas/[id]/route.ts` (persona delete) and
  `.../assets/[assetId]/route.ts` (single asset delete) — previously, one bad R2
  object could permanently block deleting a persona or asset (a retry would just hit
  the same broken object again).
- **New real feature, not just a fix**: deleting a persona used to leave its trained
  MuseTalk avatar directory (50-100MB+) and voice reference file orphaned on the GPU
  box forever — nothing cleaned them up. Added `DELETE /api/avatar/persona/{id}` on
  the GPU box (`server/avatar_routes.py`) and wired it into the persona delete route
  via `deletePersonaGpuFiles()`. Verified for real: trained a throwaway persona,
  confirmed its files existed, deleted it through the real API, confirmed they were
  gone.

## Upload limits: HEIC + video size (today)

- Photos now accept HEIC/HEIF (extension-based check, not MIME-sniffed — HEIC's MIME
  type is unreliable across browsers/OSes). Facial scans intentionally excluded
  (camera-captured JPG/PNG only, HEIC never applies there). No thumbnail rendering
  exists anywhere for photo assets, so there's no browser-image-compatibility
  question to solve — HEIC just stores like any other blob.
- Video size limit raised 10MB → 20MB. Video upload is already fully paid-gated
  (`PAID_ONLY_ASSET_TYPES` in `back_end/services/limits.ts`), so this is a flat bump,
  no free/paid tiering needed. Photo stays 5MB (uniform, unchanged).
- **Real bug found and fixed along the way**: the client-side size check
  (`maxSizeBytes` prop on `FileUploadTile`) was hardcoded to `10 * 1024 * 1024` in
  two places (`UploadWizard.tsx`, `PersonaManagerModal.tsx`), completely independent
  of `shared/persona-upload-limits.ts`'s constant. Raising just the constant would
  not have raised the actual limit. Fixed to reference the shared constant.
  Chinese translations (`front_end/components/providers/LocaleTextTranslator.tsx`)
  updated to match (translation lookup is a literal dictionary keyed by the exact
  English string — a text change on one side without the other silently breaks
  translation, not a crash).
- Verified end-to-end against both local preview and live production: a real HEIC
  upload, a 15MB video (would've failed under the old limit, now succeeds), a 25MB
  video (still correctly rejected, with the new "20 MB" message, not a stale one).

## Unrelated: two real react-hooks/set-state-in-effect lint fixes

Not part of the LiveTalking/RAG work, but done in this same window:

- `CommunityConversationView.tsx`: polling effect called an external
  `useCallback`-wrapped async function; React's compiler-based lint flags this even
  though the actual `setState` calls are behind `await fetch()`. Restructured to
  inline the fetch logic directly in the effect (matching the working pattern
  already used in `PersonaConversationView.tsx`), which also fixed a real gap: added
  an `ignore` flag so a slow request can't set state after unmount.
- `locale-context.tsx`: a genuine instance of the anti-pattern (synchronously
  deriving locale from the user's account preference inside an effect). Fixed using
  React's own documented pattern — adjusting state during render, guarded so it only
  fires once per distinct account value — rather than in an effect.
- (Investigated but deliberately left alone: `auth-context.tsx`'s two
  `eslint-disable-next-line react-hooks/set-state-in-effect` comments look
  stale but aren't — that's a `useLayoutEffect` restoring cached auth state
  before first paint, almost certainly to avoid an SSR/hydration mismatch with
  `localStorage`. Don't remove those.)

## Deploys

Deployed to production (`npm run deploy` → `echodigitalpersona.com` /
`www.echodigitalpersona.com`) multiple times today as each fix landed — the LiveTalking
integration, RAG system, EdgeTTS/STT/face-matching, the mixed-content fix, the
delete-robustness fixes, the TURN wiring, and the HEIC/size-limit changes are **all
live in production now**, not just in this working tree. Relevant Worker secrets
(`LIVETALKING_SERVER_URL`, `LIVETALKING_SESSION_SECRET`, `TURN_SERVER_URL`,
`TURN_USERNAME`, `TURN_CREDENTIAL`) are set.

## Outstanding

1. **Unconfirmed: does the WebRTC video actually work end-to-end now?** TURN is
   installed, verified working in isolation, and both ends are correctly configured
   (confirmed via live inspection). But the relay port range (49160-49169 UDP) may
   not be mapped yet — the user's CLB screenshots only showed the 3478 control port.
   If the video still doesn't show up, check that range first. I was not able to get
   a clean live browser test through to completion myself (unrelated tooling
   friction in my sandboxed browser, not a sign of an app bug) — the user was going
   to try directly and report back.
2. No LLM is wired up anywhere. RAG ingestion and retrieval are real and running;
   `getPersonaReply()` is still `lib/persona-ai.ts`'s canned echo. This was explicit
   and deliberate, not a gap to "discover."
3. `docs/TODO.md` was updated earlier today to reflect most of the above but may not
   mention the TURN work specifically yet — check it's current before relying on it.
4. Known pre-existing gaps unrelated to this work, still open: subscription expiry
   isn't automated, no file-type/virus validation on uploads, no rate limiting. See
   `docs/TODO.md`'s "Known gaps" section.
5. A minor UX bug noticed in passing while testing, not yet investigated: the login
   modal sometimes doesn't auto-close after a successful login (button stays stuck
   on "Logging in…" while the session is actually already authenticated underneath).
   Low priority, easy to work around (closing it manually works fine), but real.

## Follow-up validation — 2026-07-26

The live avatar service was re-tested from an authenticated production browser
session. The visible error, **“Couldn't reach the avatar server in time,”** is
not a Cloudflare Worker error and not a missing persona record. The website is
served by a Worker, but the actual WebRTC media path is direct:

```
browser  <── WebRTC media ──>  Tencent CLB  <──>  A800 pod / coturn
```

The A800 server is reachable over SSH and LiveTalking starts normally. TURN
authentication also succeeds: coturn creates relays on its internal address
`172.18.0.204` in the configured range `49160–49169`. Each allocation then
times out immediately. This is conclusive evidence that the relay ports are
not exposed through the Tencent CLB. The control listener alone is insufficient
for WebRTC media.

### Required Tencent Cloud action

In the CLB that fronts `lb-ijqmz1bb-80pgjba6q4w2z9hl.clb.sh-tencentclb.com`,
add port-range forwarding for **both UDP and TCP**:

| External ports | Backend target | Internal ports |
| --- | --- | --- |
| `49160–49169` UDP | A800 pod `172.18.0.204` | `49160–49169` UDP |
| `49160–49169` TCP | A800 pod `172.18.0.204` | `49160–49169` TCP |

The current coturn configuration already advertises the load balancer's public
address (`43.142.95.73`) for those relays. Do **not** change its TURN username,
credential, realm, or `external-ip` setting while adding the mappings. The A800
server has no configured Tencent CLI credentials, so this CLB change cannot be
made from SSH; it must be done in the Tencent console or by granting a scoped
Tencent Cloud API credential.

### Safety fixes applied

- LiveTalking `app.py` now falls back to its known-good default avatar if a
  persona's generated avatar files are incomplete/corrupt, rather than returning
  a 500 and blocking the conversation. A server-side backup is kept as
  `app.py.bak-avatar-fallback-20260726`.
- `back_end/services/persona-training.ts` no longer publishes `liveAvatarId`
  until the avatar-training task is actually reported as completed. This stops
  a newly-created persona from attempting to load an unfinished avatar folder.
  It was deployed as Worker version `f4272502-409d-4d7e-bd41-c830468ae646`.
