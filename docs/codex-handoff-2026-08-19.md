# ECHO handover — website and RTX 3090 migration

Date: 2026-08-19 (Asia/Shanghai)
Repository: `/Users/ethanma/Desktop/digital_persona`
GitHub: `https://github.com/Abbthan/digital-persona`
Production domains: `https://echodigitalpersona.com` and `https://www.echodigitalpersona.com`

## 1. Executive status

The ECHO GPU stack has been staged and functionally tested on the replacement
RTX 3090 workstation. The local HTTP services, cloned voice, Mandarin/English
STT, Wu-dialect STT, avatar preparation, authenticated WebRTC, TURN traversal,
idle video and speaking video all work on the new machine.

Production has **not** been switched to the replacement machine. This is
deliberate. The durable Cloudflare named tunnel is still down because its
connector token has not yet been transferred to the new machine. A temporary
Cloudflare Quick Tunnel proves that external signalling and WebRTC media work,
but it is not a production endpoint and can disappear at any time.

The exact safe stopping point is:

- new RTX 3090 services: running and healthy;
- temporary public WebRTC test: passed;
- existing named Cloudflare tunnel: not running on the new host;
- Worker/production domain: unchanged;
- GitHub/local/remote application trees: **not yet synchronized**, because the
  migration files are still uncommitted work in progress;
- no secret values are present in this document.

Do not change the Worker secret or DNS before the named hostname passes a real
external WebRTC test.

## 2. New server access and boundaries

SSH command supplied by the owner and tested successfully:

```bash
ssh -p 15786 user@frp-hub.com
```

Host details:

| Item | Value |
|---|---|
| Hostname | `LabWorkStation` |
| User | `user` |
| OS | Ubuntu 22.04-class workstation |
| CPU | Ryzen 9 5950X, 16 cores / 32 threads |
| RAM | about 94 GB |
| GPU | one RTX 3090, 24 GB VRAM |
| ECHO root | `/home/user/echo` |
| ECHO application checkout | `/home/user/echo/app` |
| LiveTalking checkout | `/home/user/echo/services/livetalking` |
| Models | `/home/user/echo/models` |
| Runtime data | `/home/user/echo/runtime` |
| Logs | `/home/user/echo/logs` |
| Secrets | `/home/user/echo/secrets` |

Important isolation rule: do not touch `/home/user/zhanglin`, the unrelated
ROS/Isaac workload, or the existing `tmux` session named `multi`.

The host is behind a private/residential network. Sakura FRP currently exposes
only SSH (`frp-hub.com:15786`) and is not the application data path. The web
application should use Cloudflare Tunnel for HTTPS signalling; TURN handles
WebRTC relay when direct ICE is unavailable.

## 3. Current service topology on the RTX 3090

```text
Cloudflare named tunnel (not connected yet)
    -> 127.0.0.1:8010 ECHO gateway
        -> 127.0.0.1:8011 LiveTalking / MuseTalk / WebRTC
        -> 127.0.0.1:9891 speech-recognition router
             -> CPU FasterWhisper
             -> 127.0.0.1:9890 WenetSpeech-Wu when Wu is selected
        -> 127.0.0.1:9010 Agentic Memory (currently absent; calls fail open)

LiveTalking
    -> 127.0.0.1:9880 CosyVoice2 voice-cloning service
    -> authenticated external TURN when required
```

Running services at handover:

| Service | Bind address | Runtime | Status |
|---|---|---|---|
| ECHO gateway | `127.0.0.1:8010` | `tmux echo-gateway` | healthy, upstream healthy |
| LiveTalking/MuseTalk | `0.0.0.0:8011` | `tmux echo-livetalking` | healthy |
| CosyVoice2 | `127.0.0.1:9880` | `tmux echo-cosyvoice` | healthy, FP16 |
| FasterWhisper router | `127.0.0.1:9891` | standalone Python process | healthy, CPU INT8 |
| WenetSpeech-Wu | `127.0.0.1:9890` | `tmux echo-wenetspeech-wu` | healthy, CUDA FP32 |
| Temporary Quick Tunnel | public ephemeral URL -> `8010` | `tmux echo-cloudflared-quick` | running for staging only |
| Agentic Memory | `127.0.0.1:9010` | none | **not deployed** |
| Local memory extractor | `127.0.0.1:9020` | none | **not deployed** |
| Runtime RIFE | `127.0.0.1:9030` | none | **not deployed** |
| LivePortrait/EchoMimic/Ditto | none | none | **not deployed** |

Current GPU memory consumers observed at handover:

- LiveTalking/MuseTalk: about 12.2 GB;
- CosyVoice: about 3.1 GB;
- WenetSpeech-Wu: about 0.9 GB;
- total baseline: about 16.2 GB, leaving roughly 7.8 GB before active-session
  allocations.

LiveTalking currently uses `--max_session 2`. Do not increase this blindly on a
single 24 GB card. Run a two-session and then three-session load test while
watching `nvidia-smi`, frame rate and CosyVoice real-time factor. The current
safe default is intentionally conservative.

### Reboot warning

Most services currently run in `tmux`; they are not yet represented by enabled
`systemd --user` units. `loginctl` reports `Linger=yes`, so user services can be
made reboot-safe, but that conversion has not been performed. A host reboot can
therefore leave ECHO offline until the sessions are started again.

## 4. Migrated models and persona data

The following model/runtime assets are installed on the replacement host:

- MuseTalk and its VAE/face parsing dependencies;
- CosyVoice2-0.5B;
- FasterWhisper small;
- WenetSpeech-Wu U2++;
- required LiveTalking runtime dependencies and gateway code.

WenetSpeech-Wu is pinned to:

- WeNet source commit: `a54b90bc768679bd4217e4c7765c0671fbfb3a7a`;
- model repository: `ASLP-lab/WenetSpeech-Wu-Speech-Understanding`;
- model revision: `cb53da...`;
- `u2++.pt` SHA-256:
  `9afd6fd82f8c638bdde993764c3c9c04e74fb8db20dc8399fd8fc6b8a34e7670`.

The verified persona package is:

| Item | Value |
|---|---|
| Account used for verification | `ethanma1209@gmail.com` |
| Persona ID | `cmsjqcvp60002psp73uk39ks9` |
| Avatar ID | `persona_cmsjqcvp60002psp73uk39ks9` |
| Voice reference | `/home/user/echo/services/livetalking/data/voice_refs/cmsjqcvp60002psp73uk39ks9.wav` |
| Prepared avatar | `/home/user/echo/services/livetalking/data/avatars/persona_cmsjqcvp60002psp73uk39ks9` |
| Prepared full frames | 883 |
| Prepared idle frames | 431 |

Ethan Ma's avatar latents, coordinate metadata, masks, idle loop and voice
reference are present and tested.

This does **not** mean every account's complete uploaded media was copied to
the GPU workstation. Account media remains private in Cloudflare R2, with
ownership/metadata in the database. GPU packages are derived caches and should
be created on demand. At handover, Ethan Ma is the only explicitly verified
prebuilt avatar package. Any other old-server-only derived packages must be
rebuilt from R2 if they are needed.

## 5. Functional and code changes completed during this migration

### 5.1 New 3090 gateway split

The public boundary is now intended to be the lightweight ECHO gateway at
`127.0.0.1:8010`. It validates signed persona-scoped requests and proxies only
the required paths to separate services. Heavy audio, rendering, STT and
retrieval work stays off the Cloudflare Worker.

Relevant local files:

- `gpu_services/livetalking_gateway/`
- `scripts/gpu-server/start-gateway-3090.sh`
- `scripts/gpu-server/start-livetalking-3090.sh`

### 5.2 WebRTC session cleanup and correct failures

`scripts/gpu-server/prepare-livetalking-3090.py` patches upstream LiveTalking
to:

- track peer connections by session ID;
- provide an idempotent explicit session close route;
- reap unconnected ICE sessions after a bounded timeout;
- release renderer sessions on closed/failed peers;
- return HTTP 503 for session-creation failures instead of HTTP 200 error JSON;
- load authenticated TURN configuration from environment variables.

This prevents leaked sessions from permanently filling `max_session` and stops
the frontend from trying to parse an error object as an SDP answer.

### 5.3 Passive idle scan activation

The preparation script fixes the upstream custom-state guard so a passive
image-only idle video can run without requiring a matching custom audio file.
This enables recorded breathing, blinking and relaxed motion while silent.

### 5.4 Avatar build resilience

The preparation script now:

- rejects undecodable/empty videos clearly;
- accepts WebM as an input source when rebuilding legacy recordings;
- recovers an isolated missed face-detection frame from the nearest valid
  bounding box;
- clamps bounding boxes to each decoded frame;
- rejects a source only when no usable face is found at all.

### 5.5 OpenCV mask compositor fix

A real WebRTC test revealed recurring upstream warnings:

```text
size == _weights1.size() && size == _weights2.size() in function 'blendLinear'
```

The cause was a one-pixel/crop metadata mismatch between the decoded frame,
face crop and mask. `prepare-livetalking-3090.py` now patches
`avatars/musetalk/myutil.py` to clamp the crop and resize/contiguously normalize
the mask before `cv2.blendLinear`.

The patch was applied on the new server, only LiveTalking was restarted, and a
complete session produced no `blendLinear` or `paste_back_frame` warnings.
The pre-fix remote file is retained at:

```text
/home/user/echo/services/livetalking/avatars/musetalk/myutil.py.pre-echo-mask-fix
```

### 5.6 CosyVoice service

The versioned service under `gpu_services/cosyvoice_service/`:

- isolates CosyVoice from LiveTalking;
- runs FP16 on the RTX 3090;
- caches voice-reference features;
- supports English and Chinese reference/text routing;
- exposes health and synthesis endpoints to localhost only.

Health at handover reported the CosyVoice2-0.5B model, 24 kHz input, 16 kHz
output, FP16 enabled and three cached voices.

### 5.7 STT and Wu-dialect support

The speech-recognition router at `9891` uses FasterWhisper for English and
Mandarin/general recognition. When the saved speech-language selection is Wu,
it routes Chinese audio to WenetSpeech-Wu at `9890`.

The Wenet app originally used `torchaudio.load`, which failed under the current
Torch/TorchCodec combination. `gpu_services/wenetspeech_wu/app.py` now decodes
canonical WAV with `soundfile`, retaining torchaudio only for resampling and
Kaldi features. The service requirements and start script were updated for the
new paths.

Control test result through CosyVoice -> STT router -> WenetSpeech-Wu:

```text
engine: wenetspeech-wu-conformer-u2pp
language: wuu
text: 你好今天天气很好我们一起出去走走
```

English audio in Wu mode returns no English result by design, matching the UI
requirement that the selected language constrains STT results.

### 5.8 Website persona reply and memory behaviour already in the current code

The current `main` commit contains the following application behaviour:

- persona replies remain first-person and do not identify themselves as
  ECHO, an AI, avatar, simulation or roleplay;
- the prompt blocks unsupported identity claims and treats “Echo” as the
  product/company name;
- recent chat plus long-term retrieval are used when available;
- a separate retrieval query supplies style evidence: vocabulary, cadence,
  fillers, phrasing, punctuation, natural pauses, humour, dialect and
  Chinese/English code switching;
- proactive/initiative messages can be grounded in recent discussion or an
  older retrieved memory;
- retrieval is best effort and times out after three seconds, so an unavailable
  GPU memory service does not block the LLM reply.

Relevant files:

- `back_end/services/persona-ai.ts`
- `back_end/services/persona-rag.ts`

Agentic Memory itself is not running on the replacement host, so only the
fallback/recent-history path is presently available there. See the limitations
section below.

## 6. Verification evidence

### 6.1 Local unit/static checks

The following passed on the Mac worktree:

```bash
python3 -m unittest gpu_services.wenetspeech_wu.test_selection
python3 -m py_compile \
  gpu_services/wenetspeech_wu/app.py \
  scripts/gpu-server/prepare-livetalking-3090.py \
  scripts/gpu-server/verify-local-webrtc.py \
  gpu_services/livetalking_gateway/app.py \
  gpu_services/speech_recognition/app.py \
  gpu_services/cosyvoice_service/app.py
git diff --check
```

### 6.2 Real local WebRTC test after the compositor fix

Authenticated gateway -> LiveTalking -> CosyVoice -> WebRTC result:

```json
{
  "ok": true,
  "connection_state": "connected",
  "video_frames": 242,
  "idle_mean_frame_difference": 5.9421,
  "speaking_mean_frame_difference": 1.4187,
  "audio_peak": 16227
}
```

The session disappeared from the LiveTalking session table after close. No
OpenCV compositor warnings were present in the post-restart log.

### 6.3 External WebRTC test through the temporary Cloudflare tunnel

Earlier in the same migration, a Mac client connected over the public
Quick-Tunnel HTTPS endpoint and completed real ICE/WebRTC:

```json
{
  "video_frames": 235,
  "idle_mean_frame_difference": 5.252,
  "speaking_mean_frame_difference": 1.9173,
  "audio_peak": 15473,
  "selected_ice_types": ["relay->srflx"]
}
```

This proves public HTTPS signalling and TURN/NAT media traversal on the new
workstation. It does not make the ephemeral URL suitable for production.

Current temporary URL (may expire without notice):

```text
https://sale-arrive-classic-motorcycles.trycloudflare.com
```

### 6.4 Other model checks

- real English voice-reference transcription through FasterWhisper: passed;
- real English CosyVoice synthesis: passed;
- real Chinese CosyVoice cross-lingual synthesis: passed;
- WenetSpeech-Wu synthetic Chinese control: passed;
- gateway `/health`: reports `upstream: true`;
- all four localhost health endpoints were healthy at handover.

## 7. Cloudflare state and the exact production blocker

Wrangler is authenticated locally to the owner's Cloudflare account. The
existing named tunnel is:

| Item | Value |
|---|---|
| Tunnel name | `echo-livetalking-node8` |
| Tunnel ID | `85df6d88-344e-499c-8060-5197c1f552bd` |
| Intended public host | `https://livetalking.echodigitalpersona.com` |
| Current status | down / no connector on the new host |

The new server has official `cloudflared` at:

```text
/home/user/echo/bin/cloudflared
```

Version observed: `2026.8.2`.

The connector token has **not** been installed. A secure direct transfer was
attempted but the execution safety reviewer rejected it because the owner's
earlier approval was too general. Do not work around that control and do not
paste the token into chat, logs, Git, a shell-history command or this document.

Before a future agent transfers the token, obtain this exact informed approval
from the owner:

> I explicitly authorize transferring the existing Cloudflare named-tunnel
> connector token to `user@frp-hub.com:15786` and storing it as
> `/home/user/echo/secrets/cloudflared.token` with `0600` permissions.

After that approval, the intended secret file is:

```text
/home/user/echo/secrets/cloudflared.token
```

It must be owned by `user`, mode `0600`, and non-empty. Never print its
contents. Start `cloudflared` with `TUNNEL_TOKEN` sourced from that file, not
with the token visible in process arguments.

The production Worker already has secret names for the LiveTalking endpoint,
session HMAC and TURN settings. Secret values were never printed. If the
existing named tunnel and hostname are reused, the Worker endpoint may not
need to change at all; confirm its current value rather than overwriting it.

## 8. Security notes

- `/home/user/echo/secrets/livetalking.env` is mode `0600` and contains the
  LiveTalking session secret plus TURN settings. Do not copy its values into
  documentation or Git.
- `scripts/gpu-server/patches/0013-agentic-memory-env.patch` previously carried
  static TURN credentials. The local working copy now contains placeholders.
  The TURN credential should still be rotated because an old value may remain
  in Git history.
- Account media is still ownership-scoped through the application/database and
  private R2 access route. The GPU gateway accepts persona-scoped signed
  requests; it is not a public file browser.
- Do not expose ports `8011`, `9880`, `9890`, `9891`, `9010`, `9020` or `9030`
  directly to the internet. Only the `8010` gateway belongs behind the tunnel.
- Do not use the Quick Tunnel as a long-term endpoint.

## 9. Known limitations and work explicitly not completed

1. **Production cutover is not complete.** The named connector token is the
   immediate blocker.
2. **Reboot persistence is not complete.** Most services run only in `tmux`.
3. **Agentic Memory is not running.** Ports `9010` and `9020` are absent;
   Neo4j is absent; `/home/user/echo/runtime/agentic-memory` and the local
   Chroma directory contain no migrated memory corpus.
4. **Do not load the previous Qwen3-4B extractor onto this 3090 as-is.** The
   baseline services already consume about 16.2 GB. A local 4B extractor can
   starve live rendering. Use a CPU/external-LLM extractor or another host.
5. **RIFE is not running on the new server.** The repository has RIFE code and
   historical experiments, but there is no `9030` process on this host.
6. **LivePortrait/EchoMimic/Ditto are not in the live path.** Current production
   candidate rendering is MuseTalk plus the recorded passive idle loop.
7. **The proposed LivePortrait replacement, Brownian idle motion, Poisson
   blinking, audio-to-expression driver and SSML/punctuation pause scheduler
   have not been implemented on the replacement server.** Preserve MuseTalk
   until an alternative passes objective A/B tests.
8. **Only Ethan Ma's derived avatar package has been explicitly verified.**
   Other personas may need preparation from their private R2 sources.
9. **Maximum live sessions is two.** Capacity has not been load-tested above
   that value on the single 3090.
10. **No new webpage UI was deployed during this migration.** The website is
    still on the previously deployed application build while the GPU backend
    cutover is staged.

## 10. Working-tree state — do not accidentally discard it

Local repository HEAD and GitHub `origin/main` are both:

```text
c647938 Enable bidirectional runtime RIFE transitions
```

Local uncommitted state at handover:

```text
 M gpu_services/wenetspeech_wu/README.md
 M gpu_services/wenetspeech_wu/app.py
 M gpu_services/wenetspeech_wu/requirements.txt
 M gpu_services/wenetspeech_wu/start.sh
 M scripts/gpu-server/patches/0013-agentic-memory-env.patch
?? gpu_services/cosyvoice_service/
?? gpu_services/livetalking_gateway/
?? gpu_services/speech_recognition/
?? scripts/gpu-server/prepare-livetalking-3090.py
?? scripts/gpu-server/start-gateway-3090.sh
?? scripts/gpu-server/start-livetalking-3090.sh
?? scripts/gpu-server/verify-local-webrtc.py
```

The remote application checkout is also at `c647938`, with migration files
copied in and an unrelated/pre-existing modification to
`scripts/gpu-server/backfill-speech-profiles.py`. Do not overwrite or revert
that file without reviewing it.

Do not use `git reset --hard`, `git checkout -- .`, or a blanket clean. Review
and commit only the migration files after production verification.

## 11. Safe next steps, in order

### Step 1 — obtain the exact token-transfer approval

Use the exact approval text in section 7. Do not proceed on a generic “I
approve.”

### Step 2 — install and start the named tunnel

Transfer the connector token directly into the mode-`0600` remote secret file
without printing it. Then replace the temporary Quick Tunnel with a persistent
`systemd --user` named-tunnel service using:

```text
TUNNEL_TOKEN=<read from /home/user/echo/secrets/cloudflared.token>
/home/user/echo/bin/cloudflared tunnel --no-autoupdate run
```

Do not put the token itself in a unit file. Use an `EnvironmentFile` or a small
mode-`0700` launcher that reads the `0600` token file.

### Step 3 — verify the named hostname before production

From outside the workstation:

```bash
curl -fsS https://livetalking.echodigitalpersona.com/health
```

Then run the authenticated verifier from the Mac:

```bash
python3 scripts/gpu-server/verify-local-webrtc.py \
  --gateway https://livetalking.echodigitalpersona.com \
  --secret-file .env \
  --persona-id cmsjqcvp60002psp73uk39ks9
```

Required pass conditions:

- connection state is `connected`;
- both audio and video frames are received;
- idle and speaking frame differences are non-zero;
- audio peak is non-zero;
- session disappears after explicit close;
- no `blendLinear`, `paste_back_frame`, SDP parse, ICE loop or traceback errors.

### Step 4 — make services reboot-safe

Create narrowly scoped `systemd --user` units for:

- CosyVoice;
- WenetSpeech-Wu;
- FasterWhisper router;
- LiveTalking;
- gateway;
- named Cloudflare tunnel.

Order them so CosyVoice/STT start before LiveTalking, and gateway/tunnel start
after LiveTalking. Preserve `Linger=yes`. Do not alter the unrelated `multi`
session or ROS processes.

### Step 5 — production smoke test

Test both domains and both languages:

- sign in and open Ethan Ma;
- start video and receive idle movement;
- send one English message and hear the full reply;
- send one Mandarin message and hear the full reply;
- select Wu, speak a Wu control phrase and confirm the transcribed text is sent
  as an actual chat message;
- close/reopen the video and confirm no session leak;
- confirm account/profile and private persona data remain scoped correctly.

Do not delete the Quick Tunnel session until the named hostname has passed.
After success, stop `tmux echo-cloudflared-quick`.

### Step 6 — commit, push and synchronize

After reviewing the diff and completing the production smoke test:

1. commit the migration/runtime files locally;
2. push `main` to `Abbthan/digital-persona`;
3. verify local HEAD equals GitHub `origin/main`;
4. verify `/home/user/echo/app` is on that same commit;
5. if Worker code changed, build/deploy with the repository's established
   OpenNext/Wrangler flow and use `--keep-vars` so secrets are preserved;
6. record the deployed Worker version.

### Step 7 — restore long-term memory without starving the GPU

Recommended single-3090 approach:

- keep the application-side three-second retrieval timeout and fail-open
  behaviour;
- run embeddings on CPU or a separate host;
- use an external LLM/API or CPU worker for NER/relation extraction instead of
  loading Qwen3-4B on the 3090;
- make Neo4j/graph storage optional so vector memory can start independently;
- backfill from the authoritative private R2/database sources rather than
  copying opaque caches from the dead server;
- verify persona/account scoping before enabling `/api/rag/*` in production.

### Step 8 — evaluate rendering upgrades separately

Do not replace MuseTalk in place. Build a feature-flagged experimental path and
compare:

- first-frame latency;
- steady FPS;
- lip-sync error;
- talk-to-idle visual distance;
- identity preservation;
- VRAM and concurrent-session cost.

Candidates discussed but not deployed are LivePortrait + EchoMimic/Audio2Exp,
Ditto, and RIFE boundary interpolation. On a single 3090, a second full
renderer can exceed the remaining VRAM; isolate it or stop the primary renderer
during tests.

## 12. Useful operational checks

From the new server:

```bash
tmux ls
ss -ltnp | grep -E '(:8010|:8011|:9880|:9890|:9891|:9010|:9020|:9030)'
nvidia-smi
curl -fsS http://127.0.0.1:8010/health
curl -fsS http://127.0.0.1:9880/health
curl -fsS http://127.0.0.1:9890/health
curl -fsS http://127.0.0.1:9891/health
tmux capture-pane -p -t echo-livetalking -S -300
```

Current tmux sessions belonging to ECHO:

```text
echo-cloudflared-quick
echo-cosyvoice
echo-gateway
echo-livetalking
echo-wenetspeech-wu
```

The separate `multi` session is not part of ECHO.

## 13. Final handover statement

The replacement RTX 3090 host is not merely copied; its core ECHO media path
has been exercised through real synthesis, authenticated WebRTC, public
Cloudflare transport, TURN and explicit cleanup. The remaining production
work is mainly operational: securely attach the existing named tunnel, make
services persistent, run the production smoke test, then commit/push/sync.

The migration should not be described as complete until those steps pass.

## 14. 2026-08-21 migration completion addendum

This section supersedes the operational blockers in sections 7, 8, 9 and 11.
It records the exact state after the permanent production cutover to the
replacement RTX 3090 host.

### Permanent Cloudflare tunnel

- Existing named tunnel: `echo-livetalking-node8`
- Tunnel ID: `85df6d88-344e-499c-8060-5197c1f552bd`
- Connector token location on the 3090 host:
  `/home/user/echo/secrets/cloudflared.token`
- Token file metadata: owner `user:user`, mode `0600`
- The token was transferred through a mode-`0700` temporary directory and
  file/stdin boundaries. It was never printed or placed in a command-line
  argument, unit file, repository file or log.
- Persistent service: `echo-cloudflared.service`, enabled and active.
- Four QUIC connector connections registered successfully in Hong Kong.
- Cloudflare's remotely managed ingress maps
  `livetalking.echodigitalpersona.com` to `http://localhost:8010` with a final
  `404` catch-all.
- The temporary `echo-cloudflared-quick` tmux session was removed only after
  the named tunnel passed real WebRTC validation. The unrelated `multi` tmux
  session remains untouched.

The Worker's encrypted `LIVETALKING_SERVER_URL` secret now points to:

```text
https://livetalking.echodigitalpersona.com
```

No tunnel credential is committed to Git or included in this document.

### Reboot-persistent services

The following user-systemd units are installed, enabled and active:

```text
echo-cosyvoice.service
echo-wenetspeech-wu.service
echo-speech-recognition.service
echo-livetalking.service
echo-gateway.service
echo-cloudflared.service
```

`loginctl` linger is enabled for `user`, so these services do not depend on an
interactive SSH login. The source-controlled units are in
`scripts/gpu-server/systemd-user/`.

### Named-tunnel WebRTC proof

The authenticated verifier was run through the public named hostname after
the temporary tunnel was stopped. Result:

```json
{
  "ok": true,
  "connection_state": "connected",
  "video_frames": 199,
  "idle_mean_frame_difference": 7.0843,
  "speaking_mean_frame_difference": 1.5121,
  "audio_peak": 24265,
  "selected_candidate_types": ["host->host"]
}
```

This proves public signalling, ICE negotiation, bidirectional WebRTC media,
the custom passive-idle loop and bilingual CosyVoice output on the replacement
host. A second post-systemd local verification also passed with 280 frames and
audio peak 19300.

### Learned speech timing and pause rendering

The cloned-voice path now uses a bounded per-person speech profile extracted
from the reference recording. High/medium-confidence profiles control:

- speech speed within the existing safe range;
- comma/short pauses, bounded to 120-450 ms;
- sentence-end pauses, bounded to 300-1000 ms;
- ellipsis/paragraph pauses, bounded to 600-1400 ms.

Without a usable profile, defaults remain 150-250 ms, 400-600 ms and
700-900 ms. Every synthesized clause receives a 15 ms raised-cosine fade at
both ends before silence is inserted, preventing hard-splice clicks. Profile
sidecars are atomic, mode `0600`, contain only aggregate timing metrics and
are removed with the persona.

Ethan's real reference produced a high-confidence English profile and the
live verification returned a 5.482-second result with peak 25471. The service
keeps English on the healthy cross-lingual CosyVoice path and supports Chinese
through the stable bilingual routing logic.

### Durable data boundary

The GPU host currently contains one verified derived avatar/voice package:
`persona_cmsjqcvp60002psp73uk39ks9`. The LiveTalking data paths are symlinks
to durable directories below `/home/user/echo/runtime`, so package data is not
inside an upstream source checkout.

Private uploaded files, accounts, chat history and authoritative persona
metadata remain in Cloudflare R2 and the database; they were never supposed to
be copied into a public or shared GPU cache. The replacement host's old Chroma
and Agentic Memory directories are empty. This is not customer-data loss: the
memory indexes are derived caches and must be rebuilt from the private
authoritative sources with persona/account scoping checks.

### Still experimental and not claimed as production

- LivePortrait, EchoMimic, Audio2LivePortrait and Ditto are not installed in
  the 3090 live path.
- Runtime RIFE is not running on port 9030.
- The live renderer remains MuseTalk plus the verified passive-idle loop and
  fail-open transition fixes.
- A local Qwen3-4B memory extractor must not be added to the already
  17.2-GB baseline GPU allocation. Use CPU/external extraction or another GPU
  host, then rebuild vector/graph memory from R2/database sources.
- The single 24-GB card is not a drop-in replacement for the old eight-card
  experimental allocation. Any LivePortrait/audio-driver trial must run in a
  separate environment, remain feature-flagged, and pass VRAM, FPS, first-frame
  latency, bilingual lip-sync, identity-preservation and rollback gates before
  production activation.

An immediate non-GPU fallback is now available for newly prepared personas
that have no separate passive scan. It selects a neutral, sharp frame from the
baked avatar, applies bounded mean-reverting head drift and subtle breathing,
and reuses a landmark-confirmed naturally closed-eye source frame for blinks.
It never synthesizes eyelids, never replaces a real passive scan, runs only at
preparation time, and fails open to the prior full-frame fallback. The isolated
Ethan preview produced 150 frames at 25 fps, selected source frame 56 and
natural blink frame 96, with no static consecutive pairs and no visible eye
deformation in the inspected blink sequence.

### Current verification and source-control state

The service-local suites pass 49 tests with one optional RIFE test skipped;
Python compilation and `git diff --check` are clean. The Agentic Memory suite's
HTTP integration test additionally needs its own environment's `httpx`
dependency when run on a development Mac. That service is not loaded on the
single RTX 3090, so this is not a production regression.

### Renderer candidates staged without changing production

LivePortrait and Ditto source trees are now pinned under
`/home/user/echo/experiments`. No weights, environments, ports, systemd units,
or GPU processes were added. Production remains LiveTalking + MuseTalk.

- LivePortrait: `9b294b3d0536135442ea73cb01e6cb3ca7029dd3`
- Ditto: `c3e47eee2e626500017a0556b470d6d4182f85e8`

Ditto is the first recommended isolated benchmark because it has an online,
audio-driven path. Base LivePortrait requires a separate audio-to-expression
driver. See `docs/rtx3090-avatar-renderer-evaluation-2026-08-21.md` for the
VRAM, licensing, acceptance, canary, and fallback requirements.

## 15. 2026-08-21 production parity audit

All six persistent services were enabled and active, with no failed user
units. The gateway, CosyVoice, WenetSpeech-Wu and Faster-Whisper health routes
all returned healthy. GPU allocation was 17,248 MiB of 24,576 MiB.

The audit caught a lazy-runtime failure that a shallow health check had missed:
Faster-Whisper could start, but its first real transcription failed because
`libcublas.so.12` was absent from the isolated STT environment. The repair:

- pins cuBLAS, CUDA Runtime and cuDNN inside the speech-recognition environment;
- exposes only that environment's NVIDIA library directories to the process;
- loads cuBLAS and cuDNN during application startup, so a broken CUDA runtime
  can no longer report healthy and fail only on first use.

Post-repair real round trips passed:

- English Faster-Whisper: 366 ms model latency;
- Mandarin Faster-Whisper: 131 ms model latency;
- Wu route: 621 ms HTTP total, including 487 ms WenetSpeech-Wu inference.

The public named-tunnel WebRTC test also passed after the repair: connected,
202 video frames, non-zero idle/speaking motion, audio peak 19,237, explicit
session cleanup and no warning-level journal entries. Total diagnostic wall
time was 12.70 seconds, including ICE, three seconds of idle observation,
synthesis, playback observation and cleanup.

CosyVoice punctuation/prosody verification passed in English and Chinese. The
latest short-utterance first-audio measurements were about 1.62 seconds for
English and 1.33 seconds for Chinese. English full-generation time can still
slightly exceed generated audio duration on this single 3090, so this is a
remaining performance limitation rather than full old-A800 latency parity.

The public page and API routes render correctly. A stale cached profile could
briefly request an avatar while session hydration was expiring and parse an
HTML/interrupted response as JSON; `UserAvatar` now validates HTTP/content type
and fails quietly to initials instead of emitting an unhandled console error.
