# ECHO 回响 — Codex handoff (2026-07-29)

This is a factual handoff of the work checked today. It is safe to give to
another coding assistant. Do not add API keys, passwords, database URLs, SSH
private keys, or Cloudflare credentials to this document.

## Current status

- The live site remains `https://echodigitalpersona.com` and
  `https://www.echodigitalpersona.com`, served by Cloudflare Worker
  `echo-digital-persona`.
- The original Tencent A800 remains the live production LiveTalking,
  CosyVoice, and persona-RAG backend. It was deliberately left online.
- A new physical 8×A800 has received the stack, models, persona assets, voice
  references, and RAG data. Its services work locally, but Internet access to
  its LiveTalking port does not yet work. Do not switch production to it yet.
- CosyVoice on the old production A800 was found hung, restarted, and then
  verified with Ethan Ma's stored voice reference. The verified Chinese test
  used CosyVoice cross-lingual cloned speech, not EdgeTTS fallback.
- A real retrieval-grounded LLM reply path was built and deployed today. The
  final authenticated browser chat test was interrupted before completion.

## Cloudflare deployment made today

- Worker: `echo-digital-persona`
- Domains: `echodigitalpersona.com`, `www.echodigitalpersona.com`
- Deployed Worker version: `e12288c3-51ee-49cf-a3aa-67c421a5e2c5`
- Workers.dev endpoint:
  `https://echo-digital-persona.ethanma1209.workers.dev`
- Worker bindings confirmed during deployment:
  - `HYPERDRIVE`
  - `PERSONA_MEDIA` → R2 bucket `digital-persona-ethan`
  - `ASSETS`

### Secrets

- The LLM API credential was stored only as encrypted Cloudflare Worker secret
  `OPENAI_API_KEY` using Wrangler. It is not in source, browser code, docs,
  logs, or this report.
- The code defaults to `gpt-4.1-mini` unless a server-side `OPENAI_MODEL`
  setting overrides it.
- Existing database, session, mail, LiveTalking HMAC, and TURN secrets were
  not changed by this update.

## New physical 8×A800 migration

### Migration result

The transfer from the original A800 to the new physical 8×A800 completed
through a direct server-to-server copy. A temporary migration SSH key was
authorised specifically for the transfer, then removed from both servers after
verification.

Migrated and checked:

- ECHO/LiveTalking application stack at `/data/echodigitalpersona`
- LiveTalking models and generated persona-avatar packages
- CosyVoice runtime and voice-reference material
- persona-RAG service and persisted Chroma vector data
- Existing data required for Ethan Ma's persona

### Services verified locally on the new server

- LiveTalking on port `8010`
- CosyVoice on port `9880`
- persona-RAG on port `9000` with successful health check
- coturn service/session
- Ethan Ma's avatar package exists
- CosyVoice functional test passed
- FastWhisper functional test passed

The observed allocation placed LiveTalking on GPU 0 and CosyVoice on GPU 1;
the new machine has substantially more GPUs available for later parallel work.

### Migration blocker: external network exposure

`localhost:8010` works on the new server, but an outside request to its public
IP and port 8010 times out. The SSH login is inside a restricted container-like
network namespace (`10.249.157.159/17`); even root cannot manage the host
firewall from there (`iptables` is denied/unavailable). Therefore port exposure
has to be completed by the physical host/provider network administrator.

Required next infrastructure action:

1. Expose or forward the new server's HTTPS/signalling port to its container
   address.
2. Expose/forward the TURN control and relay ports if WebRTC relay is needed.
3. Test a real external HTTPS request and browser WebRTC connection.
4. Only then change Cloudflare `LIVETALKING_SERVER_URL` to the new server.

A Cloudflare Tunnel named `echo-livetalking-node8` was created during
exploration, but it has no production hostname/ingress route and is not active
in the production path.

## Old production A800: CosyVoice repair

Relevant paths on the old server:

- `/root/ethan/LiveTalking`
- `/root/ethan/CosyVoice`
- `/root/ethan/persona-rag`

Issue:

- The CosyVoice process existed but its local `/openapi.json` hung, including
  after voice preparation. This likely caused reports that the custom voice
  was not applied.

Fix:

- Restarted via `/root/ethan/restart_cosyvoice.sh` in tmux session
  `cosyvoice-server`.
- `/openapi.json` then returned HTTP 200 and the GPU process was loaded.
- The existing Ethan Ma reference audio was prepared and used for a Chinese
  `inference_cross_lingual` test.
- Result: a nonempty 209,280-byte WAV in about 4.45 seconds; server logs
  confirmed CosyVoice inference rather than EdgeTTS fallback.

Important implementation detail:

- `LiveTalking/tts/cosyvoice.py` prepares/caches a persona voice key and uses
  it for synthesis. EdgeTTS is intended only as fallback where no reference
  exists or CosyVoice fails.
- Recommended future work: add a health check/watchdog that restarts
  CosyVoice if a `prepare_voice` call wedges the service again.

## Existing TURN / WebRTC work

The Tencent development A800 could not expose a broad dynamic relay range.
coturn was therefore reduced to:

```ini
min-port=49160
max-port=49162
```

The owner reported Tencent CLB mappings for TCP 8010, UDP 3478, and UDP
49160–49162. If a WebRTC failure remains, verify those public CLB mappings and
coturn before changing code. Avoid forcing `iceTransportPolicy: "relay"`
unless required, because it adds latency and hides direct ICE success.

## LLM + persona memory implementation deployed today

### Files changed

- `back_end/services/persona-ai.ts`
- `back_end/services/persona-rag.ts`
- `back_end/api/personas/[id]/messages/route.ts`
- `back_end/api/personas/[id]/import-social/route.ts`
- `back_end/api/personas/[id]/assets/[assetId]/route.ts`
- `.env.example`
- `docs/persona-rag.md`

### New reply flow

The former canned response in `getPersonaReply()` was replaced. For one
message, the server now:

1. Confirms the signed-in user owns the requested persona.
2. Saves the user message and obtains the last 12 chat turns.
3. Calls existing persona-RAG with an HMAC token to retrieve relevant excerpts
   scoped only to that persona.
4. Sends a bounded prompt to the server-only LLM Responses API, including
   persona name, language preference, recent history, retrieved excerpts, and
   the current message.
5. Saves the model reply, returns it to the chat UI, and uses that same text
   for LiveTalking speech if there is an active paid live session.
6. Queues both the human and persona response for RAG ingestion after the
   visible response, so future messages retain conversation continuity without
   blocking the current request.

### Privacy and resource protections

- No raw R2 object, private R2 URL, secret, or cross-account persona data is
  sent to the LLM.
- Persona lookup includes both `personaId` and authenticated `userId`; RAG
  uses the existing per-persona HMAC scope.
- Retrieved uploads/chat text is explicitly treated as untrusted reference
  data, not executable instructions, to reduce prompt-injection risk.
- Context, history, output, and network waits are capped to reduce Worker
  resource-limit risk.

### Social media update

Public-profile imports already create a compact private text note. Those notes
now enter the same persona RAG document-ingestion path as PDF/TXT/DOCX files.
Deleting a social-link asset also removes its exact RAG source.

### Important limitations (do not misrepresent these)

- This is retrieval-grounded prompting, not a global model fine-tune. One
  account's information is not mixed into another account's persona.
- Documents and compacted public social-profile notes are semantically indexed.
- Photos, videos, and audio continue to drive the visual avatar and voice
  pipeline. The LLM can only use media content once it has actually been
  extracted/transcribed; it does not understand arbitrary stored raw pixels or
  video frames automatically.
- CosyVoice currently selects one best voice-reference clip (dedicated
  recording, then audio upload, then video audio). It is not a multi-file
  fine-tune. A later enhancement should transcribe/index approved audio/video
  material separately while retaining the best clip for low-latency cloning.

### Verification completed

- `npx tsc --noEmit`: passed after both the initial LLM integration and the
  later voice-reference-transcript addition.
- `npm run lint`: passed with one pre-existing warning in
  `front_end/state/auth-context.tsx` about an unused eslint-disable directive.
- `npm run build`: passed. The first sandboxed build failed only because the
  sandbox prohibited a Turbopack helper from binding a port; the approved
  local build compiled fully.
- `npm run deploy`: passed twice; the latest Worker version is listed above.
- `wrangler secret list`: confirmed the encrypted `OPENAI_API_KEY` secret is
  present by name only; its value was not read back.
- A direct local no-data API test could not reach the external LLM endpoint
  from this environment, so it did not establish whether any later provider
  error is credential/model related. Production Worker egress still needs the
  authenticated application chat test below.

### Final validation remaining

The browser was opened on an already signed-in production dashboard, but the
browser-control session timed out before a harmless real message was sent.
The next agent should:

1. Open the authenticated production dashboard.
2. Send one harmless normal chat message to a persona with known source data.
3. Verify the reply is not the old canned-echo text and respects the language
   and persona prompt.
4. If it returns the generic temporary-failure message, inspect recent Worker
   logs for `[persona-ai]` errors (without logging secrets or private content).
5. Send a follow-up message and confirm recent conversation has been retained.

## Database RLS note

Earlier work added migration
`prisma/migrations/20260729103000_enable_rls_for_community_and_metrics/migration.sql`
to enable RLS on `CommunityMessage` and `PlatformMetric`. `prisma migrate
status` previously reported the schema up to date. Today's LLM change did not
alter RLS policies.

## Recommended order of follow-up work

1. Complete the authenticated production LLM chat test and check Worker logs.
2. Add CosyVoice watchdog/health monitoring on the old production A800.
3. Finish network port exposure or a correctly configured Tunnel for the new
   physical 8×A800.
4. Prove external signalling and WebRTC on the new server.
5. Switch Worker LiveTalking configuration only after that proof, keeping the
   old A800 briefly as rollback.
6. Add asynchronous transcription for all approved audio/video files and
   controlled image/video captioning before claiming those media sources
   contribute semantic LLM knowledge.
