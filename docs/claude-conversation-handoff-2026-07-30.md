# ECHO 回响 — Claude handoff (2026-07-30)

Factual handoff of what happened today, picking up from
`docs/codex-handoff-2026-07-29.md`. Safe to give to another coding assistant.
No API keys, passwords, database URLs, or SSH private keys are included here.

## What today's session was about

Yesterday's handoff (Codex) left the new physical 8×A800 fully migrated and
verified locally (LiveTalking, CosyVoice, FastWhisper, persona-RAG all pass
locally), but blocked on exposing LiveTalking's port 8010 to the public
internet — the SSH login lands inside a restricted container network
namespace where even root cannot manage the host firewall (`iptables` denied).

Two exploration paths were listed as options: get the physical host/network
admin to forward the port, or finish a Cloudflare Tunnel that Codex had
already created (`echo-livetalking-node8`, no hostname/ingress configured
yet, inactive). Today's session pursued the Tunnel path.

## Current status: Tunnel is running, one config value still wrong

- Tunnel `echo-livetalking-node8` (ID `85df6d88-344e-499c-8060-5197c1f552bd`)
  is **active** with 4 registered connections to Cloudflare's edge.
- DNS is live: `livetalking.echodigitalpersona.com` → CNAME →
  `85df6d88-344e-499c-8060-5197c1f552bd.cfargotunnel.com`, proxied.
- The `cloudflared` connector runs on the new server inside a tmux session
  named `echo-cloudflared`, started via:
  `cloudflared tunnel run --token <token>`, logging to
  `/data/echodigitalpersona/cloudflared.log`. Matches the existing convention
  of the other three service tmux sessions (`echo-livetalking`,
  `echo-cosyvoice`, `echo-persona-rag`).
- **Known bug, not yet fixed at time of writing:** the tunnel's ingress rule
  was created with `service: https://localhost:8010`, but LiveTalking on that
  port is plain HTTP, not HTTPS. This produces a `502` when hitting
  `https://livetalking.echodigitalpersona.com/` externally. The owner was
  mid-way through fixing this in the Cloudflare dashboard (Tunnels → 
  `echo-livetalking-node8` → Routes → edit the route → change the Service URL
  from `https://localhost:8010` to `http://localhost:8010`) when this handoff
  was written — **check whether that's actually been done before assuming
  it's fixed.**
- **Production is still pointed at the old server.** `LIVETALKING_SERVER_URL`
  (both in local `.env` and as the deployed Worker secret, per
  `wrangler secret list`) has not been changed. Per Codex's own note, this
  should stay that way until the new server's tunnel is proven end-to-end —
  do not flip it without deliberately verifying browser WebRTC works through
  the tunnel first (this session only got as far as fixing the plain HTTP
  signalling path; it has not yet tested a real WebRTC session through it).

## Server-side service health, verified today by reading logs directly

All three of the new server's own service logs were read in full (not just
"process is running") and show no errors, only expected library deprecation
warnings:

- `livetalking.log` — started cleanly on port 8010, GPU inference active,
  `TTS_SERVER=http://127.0.0.1:9880`. One log line worth knowing about but not
  worth acting on: `[ASR] funasr not installed — local ASR endpoint disabled`.
  This is a *different*, unused ASR backend baked into LiveTalking itself —
  the app's actual STT path is FastWhisper via CosyVoice's `/transcribe`
  endpoint, confirmed separately below, not this one.
- `cosyvoice.log` — model loaded, server up on 9880. Directly confirms a real
  test: a 21.7s audio clip was transcribed by Faster-Whisper
  (`POST /transcribe` → `200`), and CosyVoice's own `/openapi.json` responded
  `200`. Both STT and TTS are demonstrably functioning, not just started.
- `persona-rag.log` — up on port 9000, `/health` responding `200`.

## SSH access note (context, not a task)

SSH to the new server (host alias `Voc_gpu_node8_a800`, port 50010) failed
for an extended period today — TCP connected but the SSH banner exchange
timed out, i.e. the connection was accepted then silently dropped rather than
cleanly rejected. This is the signature of an IP-based allowlist/firewall
rule, not a credentials problem (a real auth failure happens *after* the
banner, not before it). It resolved once the owner changed the connecting
machine's IP back to one that had worked previously. If this recurs: it is a
server/network-side access-list issue, not a `cloudflared` or LiveTalking
problem, and needs whoever administers that box's network access.

Separately (and unrelated to the above): the SSH private key file used for
this connection had its permissions reset to `0644` at least once mid-session,
which OpenSSH refuses to use (`bad permissions`, ignores the key). If SSH
auth ever fails with that specific message, the fix is `chmod 600` on the
key file — nothing more.

## Update — 2026-07-31

Confirmed fixed and externally proven. `curl https://livetalking.echodigitalpersona.com/index.html`
returns `200` with LiveTalking's real HTML (not the tunnel/edge, the origin
app itself). The `https://localhost:8010` → `http://localhost:8010` ingress
fix (see above) was applied and resolved the `502`.

**Note for Codex / whoever reads this next:** `docs/claude-handoff-2026-07-31.md`
does not mention this Tunnel work and still frames "external network exposure"
as the open blocker requiring host/provider-level port forwarding. That's now
out of date for the signalling path specifically — the Tunnel is live and
proven for plain HTTP. Read this file, not just that one, before touching
the new server's network setup again, to avoid standing up a second,
conflicting exposure path (e.g. a duplicate tunnel, or someone independently
pursuing raw port-forwarding for the same port). If raw port-forwarding does
get set up later for other reasons (e.g. the TURN/UDP relay ports, which the
Tunnel does not carry), that's additive, not a replacement for this.

Still not done: a real external WebRTC session has not been tested through
the tunnel yet (this only proves the HTTP signalling path responds — offer
negotiation, ICE, and media flow are untested). `LIVETALKING_SERVER_URL` has
therefore still not been changed.

### Worked through Codex's checklist on 2026-07-31 — two real bugs found

- Ethan Ma's persona (`cmrzzt8au0000psp7x4i0upsz`, confirmed via direct DB
  query) has both its avatar package and voice reference present on the new
  server (`LiveTalking/data/avatars/persona_cmrzzt8au.../`,
  `LiveTalking/data/voice_refs/cmrzzt8au....wav`).
- GPUs: all 8×A800 healthy, no ECC errors. GPU0 (LiveTalking, ~8GB) / GPU1
  (CosyVoice, ~4GB) matches the intended split; GPUs 2-7 idle and free.
- persona-RAG: `/health` returns `{"ok":true}`, and its Chroma data directory
  (`persona-rag/data/chroma`) exists and was migrated. Did not do a full
  authenticated retrieval test against it (needs the app's HMAC token scheme,
  not just a curl call) — lower priority than the two bugs below, not done.
- **Bug 1 — CosyVoice `inference_zero_shot` (same-language synthesis)
  produces near-silent audio.** Tested directly against
  `http://127.0.0.1:9880` on the new server using Ethan Ma's real reference
  file/transcript. English-in/English-out via `inference_zero_shot`: peak
  amplitude ~300/32767 on two separate attempts (near-silence). Chinese-out
  via `inference_cross_lingual` (the endpoint used when reply language ≠
  reference language, per `LiveTalking/tts/cosyvoice.py`): peak amplitude
  ~32440/32767 — normal, healthy speech. So English replies specifically are
  likely broken/inaudible on the new server right now; Chinese replies are
  fine. Not yet root-caused — worth checking whether this reproduces on the
  *old* server too (would point at a CosyVoice/model issue, not a
  migration-specific one) before assuming it's new-server-only.
- **Bug 2 — coturn's advertised `external-ip` is not a real public address.**
  `/data/echodigitalpersona/turnserver.conf` has
  `external-ip=33.204.189.227`. That address is registered to the US DoD
  (WHOIS: `DISN-IP-LEGACY`) and is unreachable from the public internet
  (direct TCP probe to port 3478 failed). This is a different network
  interface on the pod (`eth5`), not a real internet-routable IP — almost
  certainly the same kind of multi-homed-pod-interface issue as LiveTalking's
  original port-exposure blocker, just not yet solved for TURN. Even with
  UDP 49160-49169 and TCP/UDP 3478 forwarded by a network admin, WebRTC
  clients told to relay through `33.204.189.227` won't be able to reach it.
  This needs a real, publicly-routable external IP in that config (likely
  needs the same network administrator who'd handle port-forwarding to
  confirm what address actually fronts this pod), not just a port-forward.

Net effect: the HTTP signalling path is solid, but do not assume the new
server is ready for a full WebRTC+voice cutover yet — both TURN relay and
English CosyVoice output need fixing first, or a real browser WebRTC test
will likely surface one or both of these as connection/audio failures.

## Immediate next steps for whoever picks this up

1. **Confirm the `https://` → `http://` ingress fix landed** (see above) —
   check the tunnel's route config in the Cloudflare dashboard, or just
   `curl -I https://livetalking.echodigitalpersona.com/`; a `502` means it's
   still wrong, anything else (even a 403/404 from LiveTalking itself) means
   the proxy path is working.
2. Once that's confirmed, prove a **real external WebRTC session** through
   the tunnel before touching production config — a plain HTTP 200 on the
   signalling path is necessary but not sufficient; the actual offer/answer +
   media flow needs a live browser test.
3. Only after that: switch `LIVETALKING_SERVER_URL` (Worker secret, via
   `wrangler secret put`) from the old Tencent CLB URL to
   `https://livetalking.echodigitalpersona.com`, redeploy, and keep the old
   A800 available briefly as rollback per Codex's original recommendation.
4. The old server is being reclaimed by its provider — there is real time
   pressure on step 3, more than Codex's original handoff implied.
