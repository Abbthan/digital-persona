# LiveTalking real-time avatar integration

Real-time voice/video avatar for subscribers is backed by a standalone
[LiveTalking](https://github.com/lipku/LiveTalking) WebRTC server plus a
standalone [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) voice-cloning
server, both running on a separate GPU box — not on this app's own Cloudflare
Worker, which can't hold a stateful WebRTC media session or run these models.
Each persona gets its own trained MuseTalk 1.5 avatar and its own CosyVoice
voice clone; see `docs/TODO.md`'s "Real-time avatar video/audio" entry for
what that does and doesn't cover.

## Architecture

```
Upload/delete video, facial scan, or audio ──▶ this app's backend
                                                      │
                                     startPersonaTraining() (persona-training.ts)
                                                      │
                        ┌─────────────────────────────┴─────────────────────────────┐
                        ▼                                                           ▼
        POST {LT}/api/avatar/task                                  POST {LT}/api/voice/reference
        (submit video/photo, get task_id)                          (save+transcribe ref audio)
                        │                                                           │
                        ▼                                                           ▼
              GPU box: MuseTalk 1.5 (FP16)                          GPU box: saves data/voice_refs/<id>.wav,
              generates data/avatars/persona_<id>/                  proxies to CosyVoice's own /transcribe

Browser ──POST /api/personas/[id]/live-session──▶ this app (Cloudflare Worker)
   │                                                  │
   │◀──────────── { avatarId, refAudio, refText } ────┘
   │
   ├──POST /api/personas/[id]/live-session/offer──▶ this app ──POST {LT}/offer──▶ LiveTalking
   │◀───────────────────────────── SDP answer + sessionid ─────────────────────────────────┘
   │
   └──WebRTC media (video/audio) flows directly, browser ⇄ LiveTalking (CosyVoice TTS)───┘

(each chat reply: browser ──POST /api/personas/[id]/live-session/human──▶ this app ──POST {LT}/human──▶ LiveTalking)
```

`{LT}` = `LIVETALKING_SERVER_URL`. All GPU-box calls (from both the browser
and this app's backend) go through LiveTalking's one port — it internally
proxies the two voice endpoints to CosyVoice's own server, which is
localhost-only and never exposed on its own port.

**The browser never calls `{LT}` directly for signaling.** It used to (`/offer`
and `/human` were fetched straight from the client with a token from
`/live-session`), but `{LT}` is plain HTTP and the production site is HTTPS —
browsers block that as mixed content, so every real-world connection attempt
failed with `TypeError: Failed to fetch` (or the 15s connect-timeout message,
depending on how the browser reported it). `/api/personas/[id]/live-session/offer`
and `.../human` (`back_end/api/personas/[id]/live-session/{offer,human}/route.ts`)
now proxy those two calls server-side instead, minting their own short-lived
token rather than trusting one from the client. `/live-session` itself no
longer returns `token`/`serverUrl` at all — nothing in the browser needs them
anymore. Only the actual WebRTC media transport (ICE/SRTP, not a `fetch()`)
still connects browser-to-GPU-box directly, since that's not subject to
mixed-content blocking and Workers can't hold a stateful media session
anyway. Verified live against production: both proxy routes return real 200s
and the connection reaches `status: "connected"` in a real browser, not just
via curl (curl doesn't enforce mixed-content policy, which is exactly why
this didn't surface until tested in an actual browser).

### Training (`back_end/services/persona-training.ts`)

Runs on initial creation (the wizard's "Done" button, via `/finish`) and
again on any later add/delete of a `video`, `facial_scan`, or `audio` asset
once the persona is already active (`back_end/api/personas/[id]/assets/route.ts`
and `.../assets/[assetId]/route.ts`). There's no partial/selective unlearning
for either model — a delete that removes the only source just means the next
full retrain has nothing to work from, and clears `liveAvatarId`/
`voiceRefTranscript` accordingly.

- **Avatar source**: prefers an uploaded/recorded `video` asset **confirmed
  by `POST {LT}/api/avatar/face-match` to show the same face as the
  persona's `facial_scan`** (real head-movement video makes a meaningfully
  better avatar than a looped still photo, so a matching video wins) —
  otherwise falls back to the `facial_scan` photo itself, which LiveTalking's
  `avatar_routes.py` loops into a short silent clip via `ffmpeg` before
  handing it to MuseTalk's own `generate_avatar()`. With no `facial_scan` to
  check against, any video is trusted as before (nothing to verify against).
  Among multiple matching videos, the closest face-match distance wins.
- **Voice source**: prefers the one dedicated voice recording; falls back to
  the largest uploaded audio file (byte size as a proxy for duration, since
  there's no real duration metadata).
- **`avatarId`** is always `persona_<personaId>` — deterministic, so a
  retrain overwrites the same MuseTalk avatar directory rather than
  accumulating orphaned ones.
- **`refAudio` path** is always `data/voice_refs/<personaId>.wav` — same
  deterministic convention, computed by `voiceRefPath()` rather than stored
  in the database.
- The persona's `status` flips to `"processing"` for the duration; the
  existing `PersonaTrainingProgress.tsx` sidebar indicator (already built
  for the old fake-timer demo) picks this up with zero changes — it was
  already polling any `"processing"` persona.
- `resolvePersonaTrainingState()` polls LiveTalking's own async job API
  (`GET {LT}/api/avatar/task/{id}`) for real progress. No avatar source at
  all → resolves to `active` immediately (nothing to wait on). Job fails →
  resolves to `active` anyway with `avatarTrainingError` set — a failed
  avatar job doesn't block the persona, it just means no live avatar yet
  (see `LiveTalkingAvatar.tsx`'s fallback below).

### Auth

`back_end/services/livetalking.ts` mints a token:
`base64url(JSON{uid,pid,exp}) + "." + base64url(HMAC-SHA256(secret, payload))`
(Web Crypto, TTL 10 min). Two mint paths, both server-side only — the
browser never sees a raw token: `createLiveSessionToken(userId, personaId)`,
minted fresh inside `/live-session/offer` and `/live-session/human` for each
call a real logged-in user's browser triggers, and `systemToken()`
(`uid: "system"`) for this backend's own server-to-server training/RAG
calls. LiveTalking has no auth of its own, so a
`digital_persona_auth_middleware` was added to its `app.py`, checked on
`/offer`, `/human`, `/humanaudio`, `/interrupt_talk`, `/is_speaking`,
`/record`, `/set_audiotype`, `/sse`, `/api/avatar`, `/api/voice` — everything
else (its own static demo pages) is untouched.

### GPU-box endpoints added (not upstream LiveTalking/CosyVoice)

All in LiveTalking's `app.py` unless noted; pre-patch backups sit alongside
each modified file as `<name>.bak*`.

- **`POST /api/voice/reference`** — `persona_id` + `audio` → converts to
  16kHz mono WAV via `ffmpeg`, saves to `data/voice_refs/<persona_id>.wav`,
  proxies to CosyVoice's `/transcribe` for the text. Replaces an earlier,
  simpler transcribe-only endpoint once it became clear `refaudio` needs a
  stable server-side path, not just a transcript.
- **`server/avatar_routes.py`**'s existing `create_avatar_task` — extended to
  loop a still-image upload into a short clip via `ffmpeg` before calling
  `generate_avatar()`, so the facial-scan-only fallback path works. The
  async job API itself (`/api/avatar/task`, `/api/avatar/tasks`) is
  upstream LiveTalking, unmodified — model generation is already decoupled
  from whichever model the server is currently serving live, so avatar
  *generation* works regardless of the running `--model` flag.
- **CosyVoice's `runtime/python/fastapi/server.py`**: fixed a real upstream
  bug in `inference_zero_shot` (pre-loaded the uploaded audio into a tensor
  before calling `cosyvoice.inference_zero_shot()`, but the frontend's own
  `_extract_speech_feat` tries to `load_wav()` it again expecting a raw
  path — now saves to a temp file and passes that path instead, matching
  the project's own documented `example.py` usage). Added `POST /transcribe`
  using CosyVoice's already-installed `openai-whisper` ("base" model, lazy
  loaded) — not a general STT endpoint, only used by `/api/voice/reference`
  above.
- Missing runtime dependency `face_recognition` (needed by MuseTalk's own
  landmark step, not listed in `requirements.txt`) installed into
  LiveTalking's venv — pulls in `dlib`, compiled from source.
- **`POST /api/voice/transcribe`** — ephemeral speech-to-text for the
  always-on conversation mic (`front_end/components/dashboard/PersonaConversationView.tsx`'s
  browser-side VAD segments one). Unlike `/api/voice/reference`, nothing is
  persisted — proxies straight to CosyVoice's `/transcribe` and deletes its
  temp files immediately after. Reached via
  `back_end/services/livetalking.ts`'s `transcribeVoiceClip()` →
  `back_end/api/personas/[id]/transcribe/route.ts`.
- **`POST /api/avatar/face-match`** (`server/avatar_routes.py`) —
  `face_recognition`-backed comparison confirming a candidate video/photo
  shows the same person as a persona's facial scan (128-d embedding
  distance, ≤0.6 = match, `face_recognition`'s own standard cutoff). Used by
  `back_end/services/persona-training.ts`'s avatar-source selection so an
  unrelated or mis-tagged video upload never becomes what MuseTalk trains
  on — falls back to the facial scan itself if no uploaded video matches.
  Reached via `back_end/services/livetalking.ts`'s `checkFaceMatch()`.
- **`tts/cosyvoice.py`**: `CosyVoiceTTS.txt_to_audio` used to `open(reffile,
  'rb')` unconditionally, which would crash for any session with no trained
  voice reference (`REF_FILE` empty — true for every untrained persona, and
  in fact for this server's own demo avatar too, since no `--REF_FILE` flag
  is passed at startup). Patched to fall back to an internally-instantiated
  `EdgeTTS` for that utterance when `ref_file` is empty, so every persona
  gets audible speech immediately, cloned voice or not.
- **`/api/rag/*`** — generic reverse proxy (`rag_proxy` in `app.py`) to the
  standalone `persona-rag` FastAPI service (`127.0.0.1:9000`, localhost-only
  like CosyVoice). See `docs/persona-rag.md` for the service itself.

### Server startup flags that matter

```
python app.py --transport webrtc --model musetalk --avatar_id <any-existing-avatar> \
  --tts cosyvoice --TTS_SERVER http://127.0.0.1:9880
```

`--model musetalk` is required for live serving of *any* MuseTalk avatar —
avatar *generation* works regardless of this flag, but the running
inference session only serves one model family at a time (dynamically
loading whichever `avatar_id` a given `/offer` requests, as long as it's
that same family — see `build_avatar_session` in `app.py`). `--tts cosyvoice
--TTS_SERVER http://127.0.0.1:9880` is required for `refaudio`/`reftext` to
actually take effect; without it the server falls back to `edgetts`, which
ignores both.

CosyVoice's own server (separate process, separate venv — pinned
`torch==2.3.1`/`numpy==1.26.4`, incompatible with LiveTalking's
`torch==2.5.1`): `python runtime/python/fastapi/server.py --port 9880`,
auto-downloads `iic/CosyVoice2-0.5B` via ModelScope on first run.

The live cloned-speech path uses CosyVoice's cross-lingual decoder for both
English and Chinese. Production testing found that same-language zero-shot
could end a successful HTTP stream before the final sentence, whereas the
cross-lingual decoder retained the same warmed speaker embedding and produced
the complete utterance in both languages. The server also splits long replies
into bounded sentence groups inside one streaming response, with the final
sentence synthesized independently so a closing question cannot be silently
lost to an early model EOS.

## Known limitations

- **Cartoon avatar style isn't built.** Only the Realistic/MuseTalk pipeline
  above exists; `NameModal.tsx`'s style picker blocks Cartoon client-side
  with a message, and `POST /api/personas` rejects it server-side too.
- **Voice reference transcription accuracy is modest.** Uses openai-whisper's
  smallest "base" model for speed/simplicity — real, but not high-fidelity,
  especially on Chinese audio. `prompt_text` is a soft anchor for CosyVoice's
  zero-shot cloning, not required to be phonetically perfect, so this is an
  acceptable tradeoff, not a blocker.
- **LLM chat is retrieval-grounded, not a fine-tune.**
  `back_end/services/persona-ai.ts` now calls the configured server-only LLM
  with bounded, persona-scoped RAG context and recent chat history. The same
  generated reply is supplied to this integration for speech/lip sync. Raw
  uploads are not sent to the model unless their text has been extracted or
  transcribed first.
- **Embedding model runs on CPU, not GPU.** `persona-rag`'s fresh venv pulled
  a newer PyTorch than this box's NVIDIA driver's CUDA version supports
  (`CUDA initialization: The NVIDIA driver on your system is too old`) — it
  falls back to CPU automatically (see `store.py`'s `_cuda_available()`) and
  still works correctly, just slower than GPU. Not urgent: ingestion is
  async, off the chat-response critical path. Fixable later by pinning an
  older torch build matching the driver, same fix already applied to
  LiveTalking's and CosyVoice's own venvs.
- **OCR accuracy depends on image quality**, same caveat as Whisper
  transcription above — tesseract (chi_sim+eng) reads real scanned pages and
  photos well, but a low-resolution or stylized image can come out garbled.
  The raw text is still stored and still retrievable; it just may not be
  perfectly clean.

## Connectivity (resolved)

The GPU box is reachable from the public internet via a Tencent Cloud CLB
listener: `LIVETALKING_SERVER_URL=http://lb-ijqmz1bb-80pgjba6q4w2z9hl.clb.sh-tencentclb.com:4262`
(the CLB's auto-assigned external port, mapped to the box's `8010`). One
quirk from that listener, not from this app or LiveTalking itself: it
redirects plain **GET** requests to Tencent's own docs page, but **POST**
reaches the real backend fine. That only affected the two status-polling
endpoints that are naturally GET (`/api/avatar/task/{id}`,
`/api/avatar/tasks`) — both got POST aliases registered alongside the
originals in `server/avatar_routes.py`, and
`back_end/services/livetalking.ts`'s `getAvatarTrainingTask` calls the POST
form. Every other endpoint here (`/offer`, `/api/voice/*`, `/api/rag/*`) was
already POST/DELETE only, so it was never affected.

Confirmed working end-to-end against the real box (not just the training
submission call — the full async job through to `completed`, see "What's
been verified" below).

## Local dev gotcha: R2 needs `wrangler dev`, not plain `next dev`

`back_end/services/storage.ts` reads the `PERSONA_MEDIA` R2 binding via
`getCloudflareContext()`, which plain `npm run dev` doesn't provide — any
asset upload 500s with "Cloudflare R2 media storage is not configured."
Use `npm run preview` (`opennextjs-cloudflare build && wrangler dev`)
instead, which binds real (locally-emulated) R2/Hyperdrive. That in turn
needs a **Postgres connection string for Hyperdrive's local emulation**,
supplied either via a `.dev.vars` line
(`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=...`, gitignored)
or an inline env var on the same command — in this session `.dev.vars` alone
didn't get picked up reliably; passing it inline on the `npm run preview`
invocation is what actually worked.

## What's been verified so far

Everything below was checked directly against real infrastructure, not
assumed:

- **MuseTalk 1.5, FP16**: real avatar generated from an uploaded video
  (`/api/avatar/task` → `completed`, 150 frames + masks + precomputed
  latents, 92MB) and, separately, from a single still photo via the
  ffmpeg-loop fallback (also `completed`). Server restarted serving that
  exact generated avatar — HTTP 200, stable process, GPU memory consistent
  with FP16 (not FP32).
- **CosyVoice complete cloned speech**: the exact 151-character reply that had
  previously lost its final question was replayed with Ethan Ma's real voice
  reference. The production decoder returned 8.72 seconds of 24kHz audio and
  Faster-Whisper recovered the complete final question, “What made you share
  that with me?”. A subsequent real browser message produced one `start` and
  one `end` event for the complete 214-character reply, with no duplicate
  dispatch.
- **MuseTalk A/V timing**: audio and video now use one media epoch and queue
  pressure is measured in buffered seconds rather than incomparable packet
  counts (20ms audio versus 40ms video). A focused assertion confirmed that
  four video packets and eight audio packets both represent 160ms and resolve
  to an identical playback deadline (0.000000000s difference).
- **Voice reference + transcription**: `/api/voice/reference` saves a real
  WAV at the deterministic path and returns a real (if modest-accuracy)
  transcript.
- **Auth**: the middleware rejects missing/expired/tampered tokens (401) and
  lets valid ones through to the real handler on `/offer` *and* the newer
  `/api/avatar/task`/`/api/voice/reference`. A token minted by the actual
  running Next.js app (Web Crypto HMAC) was independently confirmed valid
  against the Python middleware (hmac module) — cross-implementation
  compatible, not just each internally self-consistent.
- **Full digital_persona-side pipeline, against real infrastructure, now
  including the real GPU-box round trip**: real paid test account, real
  video+audio uploaded to real R2 (via `wrangler dev`), real `/finish` call
  → `startPersonaTraining()` selected the voice reference asset, submitted
  the avatar job, polled it through `pending`/`processing`/`running` to
  `completed` for real (`liveAvatarId` set, `avatarTrainingError: null`,
  real `latents.pt`/`coords.pkl`/mask files on disk on the GPU box), and a
  real Whisper transcript came back for the voice reference.
- Cartoon-style blocking: verified live in the browser — clicking Cartoon in
  the name-entry slider shows the red "not available yet" alert and snaps
  back to Realistic, matches server-side rejection too.
- **EdgeTTS fallback**: a standalone unit test against the real, patched
  `CosyVoiceTTS` confirmed an empty `ref_file` produces real non-silent
  audio via the EdgeTTS path (103/139 frames non-zero) without touching the
  trained-voice zero-shot path, which was separately confirmed still
  unaffected (128/129 frames non-zero) using the real saved reference from
  the test persona above.
- **Whisper STT for the conversation mic**: `/api/voice/transcribe` returns
  a real transcript, verified both directly against the GPU box and through
  the full Next.js route (`POST /api/personas/[id]/transcribe`) using
  `wrangler dev` against real R2/Hyperdrive.
- **Face-matching for avatar-source selection**: verified both directions
  through the real training pipeline — a facial scan + a video of the same
  face correctly selected the video (richer motion data than a looped
  photo); swapping in a faceless video correctly rejected it and fell back
  to training on the facial scan instead, with the rejected video never
  even submitted to MuseTalk.
