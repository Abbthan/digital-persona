# ECHO 回响 — Claude handoff (2026-07-31, continued)

Picks up from `docs/claude-conversation-handoff-2026-07-30.md` and
`docs/claude-handoff-2026-07-31.md` (Codex's). Read both before touching the
new GPU server or its network/TURN setup — there is now a real fix in place
that neither of those files knows about. No API keys, passwords, database
URLs, or SSH private keys are included here.

## Current repo/deploy state

- Branch `main`, HEAD `567182b` (`release: 2026-07-31T06:07:24Z`), pushed and
  deployed. Two production deploys landed today, both confirmed live on
  `echodigitalpersona.com` and `www.echodigitalpersona.com`:
  - Worker version `8fd488d9` — Hero section scroll fix: the hero's animated
    gradient background now stays pinned (`position: fixed`, `-z-10`) while
    scrolling, but the logo/heading/buttons on top of it scroll away
    normally (previously the whole section was pinned). `!bg-transparent`
    on the Hero `<Section>` was required — without it the section's own
    opaque background sits above the fixed background in stacking order and
    hides it.
  - Worker version `a3f15964` — reverted the "Liquid Glass" video-chat popup
    effect entirely (`front_end/components/dashboard/PersonaConversationView.tsx`,
    `app/globals.css`). The e6dc235 hotfix didn't fully fix the
    invisible-popup regression in practice, so per explicit instruction the
    whole effect was removed, back to the plain opaque
    `border-white/20 bg-canvas/95 shadow-product backdrop-blur-xl` panel it
    used before Liquid Glass existed. Verified visible in-browser (light
    mode) before deploying. The unrelated proactive-opening feature added in
    the same original commit was left untouched.
- Working tree has one uncommitted, non-secret change: `.env.example` gained
  documented `TURN_SERVER_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL`
  placeholder entries (see below). Safe to commit whenever convenient.
- Deleted the `ethanma1209@hotmail.com` test account (username `bro`,
  already-verified, no personas attached) from the database at the owner's
  request, so they can re-register that email to test the verification
  flow fresh.

## Bug 1 (CosyVoice English near-silence) — retested, not currently reproducible

Yesterday's handoff flagged `inference_zero_shot` (English, same-language)
producing near-silent audio (peak ~300/32767) on the new 8×A800, while
`inference_cross_lingual` (Chinese) was healthy (~32440/32767).

Today this was retested directly against `http://127.0.0.1:9880` on the new
server, using Ethan Ma's real reference file/transcript, several ways:

- Raw uncached `inference_zero_shot` upload, English target: peak 21271/32767.
- Raw uncached `inference_cross_lingual`, English target: peak 23702/32767.
- Warmed/cached `voice_key` path (the actual path the live app uses) via
  `inference_zero_shot`, English target: peak 20878/32767.
- Same cached path, cross-lingual: peak 32440/32767.
- 8 back-to-back cached `inference_zero_shot` calls with varied English
  sentences (simulating a real conversation): all healthy, 0/8 near-silent.

Could not reproduce the near-silence at all. Most likely explanation: the
original test ran during/shortly after the persona's voice reference `.wav`
was still being migrated onto the new server, and briefly read a
partially-written file. The file is now stable (695118 bytes, confirmed).
Treat as resolved but not "fixed" by a code change — nothing was changed
for this bug. If it recurs, re-check file integrity / timing relative to any
future migration, not the zero-shot code path itself (which is confirmed
correct by reading `CosyVoice/cosyvoice/cli/frontend.py` — cached
`zero_shot_spk_id` pulls a complete, correctly-built `spk2info` entry
regardless of endpoint).

## Bug 2 (coturn/TURN unreachable) — root-caused and fixed

### Root cause, confirmed with hard evidence

The new server (Volcengine/ByteDance "veMLP" managed dev-container, region
cn-beijing — confirmed via `CLOUD_PROVIDER=volcengine`, `MLP_INNER_CONTAINER=true`
env vars) has **no real public IP on any network interface**. All of
`eth0`–`eth5` are private/overlay addresses (`10.249.x`, `172.18.x`, and a
`33.204.x` range that happens to be WHOIS-registered to the US DoD but is
just this platform's internal overlay addressing — not usable from the
internet). The only way in from outside is via ports the platform's own
dashboard has been told to forward — that's how SSH works today (public IP
`221.194.152.152`, port 50010 → the pod), and it's the same reason raw
port-forwarding for LiveTalking's HTTP port 8010 was blocked before
(resolved earlier via the Cloudflare Tunnel now running).

A live WebRTC test (see "Test status" below) proved this generalizes past
just TURN: **before today's fix, no media path worked at all** — not host
candidates, not STUN-reflexive, not the old local coturn relay. The
`RTCPeerConnection` reliably went `ice:disconnected` → `conn:failed`. The
STUN-reflexive candidate the pod could gather (`221.194.152.152`, an
ephemeral outbound-NAT port) looked promising but wasn't actually reachable
inbound, because that specific ephemeral port was never forwarded — only
SSH's port 50010 was.

### The fix: an Alibaba Cloud relay, both sides connect outbound

The owner stood up a small Alibaba Cloud VM with a real public IP
(`47.116.3.151`) running coturn, and gave both STUN and TURN URLs plus
credentials for it. The key property that makes this work: **outbound**
connections from the Volcengine pod are not blocked (same reason SSH and
the Cloudflare Tunnel connector both work) — only **inbound** to arbitrary
ports is blocked. So instead of trying to make the pod itself reachable,
LiveTalking's own WebRTC stack now requests a relay candidate from the
Alibaba TURN server (an outbound connection, allowed), and the browser
connects to that same TURN server's public IP directly (a completely normal
inbound connection from the browser's side, no NAT issue there at all). The
TURN server bridges the two.

This was actually already half-wired in the codebase before today — worth
knowing so nobody re-invents it:

- **Server side** — `LiveTalking/server/rtc_manager.py:86-93` already reads
  `TURN_SERVER_URL` / `TURN_USERNAME` / `TURN_CREDENTIAL` from the process
  environment and adds them to the `aiortc` `RTCConfiguration` for every
  offer. This code existed and was correct; it just had never been pointed
  at a *reachable* TURN server.
- **Client side** — `back_end/services/livetalking.ts` `turnServerConfig()`
  and `front_end/components/dashboard/LiveTalkingAvatar.tsx` already build
  the browser's `RTCPeerConnection` `iceServers` from the same three env
  var names (via `back_end/api/personas/[id]/live-session/route.ts`). Also
  pre-existing, also just never had values.

**What changed today:**

1. `/data/echodigitalpersona/start-livetalking.sh` on the GPU server — was
   deriving `TURN_SERVER_URL`/`TURN_USERNAME`/`TURN_CREDENTIAL` from the
   local (broken) `turnserver.conf`'s `external-ip=33.204.189.227`. Now
   hardcoded to the Alibaba relay: `turn:47.116.3.151:3478?transport=udp`,
   with the given username/credential. A dated `.bak` copy of the old
   script was left next to it. The LiveTalking process was restarted (had
   to recreate the `echo-livetalking` tmux session — `Ctrl-C` on a script
   that ends in `exec` kills the pane's underlying shell, not just the
   foreground process, so the tmux session itself closed; recreated with
   `tmux new-session -d -s echo-livetalking`). Confirmed via
   `/proc/<pid>/environ` that the running process has the new values.
2. Same three vars added to `.env.example` (documented placeholders, no
   real values) and set as **Cloudflare Worker secrets** via
   `wrangler secret put` for production (`TURN_SERVER_URL`, `TURN_USERNAME`,
   `TURN_CREDENTIAL`). These take effect immediately for the currently
   deployed Worker version — no redeploy needed for secrets. Production's
   `LIVETALKING_SERVER_URL` itself is **still the old Tencent server** —
   only the TURN secrets are staged ahead of the eventual cutover.
3. The local coturn service on the GPU box (`turnserver.conf`,
   `external-ip=33.204.189.227`) was left running but is no longer
   referenced by anything. Fine to decommission later; not urgent.

### Test status — CONFIRMED WORKING end-to-end

First attempt (before the Alibaba relay existed): a real WebRTC session was
attempted from a local dev server (pointed at the new server's Cloudflare
Tunnel URL, `LIVETALKING_SERVER_URL` override — production untouched),
logged in as the real account. `conn:failed`, candidate dump showing only
unreachable addresses. Solid proof of the *old* broken state.

Second attempt (Alibaba relay wired in, both sides successfully allocating
relay candidates on `47.116.3.151`): still `conn:failed`. Root cause turned
out to be coturn's own default anti-abuse rule — it silently refuses to let
a client install a permission for a peer address that is the TURN server's
*own* public IP, which is exactly what a relay-to-relay pairing on a single
shared TURN server looks like (both peers' relay candidates are
`47.116.3.151:<port>`). The server owner added an explicit allow rule for
this on the Alibaba VM and restarted coturn.

Also added at this point, client-side: `iceTransportPolicy: "relay"` in
`front_end/components/dashboard/LiveTalkingAvatar.tsx`, applied only when
`tokenResult.turn` is present (falls back to the old STUN-only behavior
otherwise — forcing relay-only with zero relay servers configured would
leave zero viable candidates, which is exactly the failure mode a past
comment in this file already warned about). Reasoning: the GPU pod has no
directly reachable address on any candidate type, so letting ICE work
through the doomed host/srflx pairs first was eating the whole connection
timeout before the one viable relay-relay pair ever got a fair shot. aiortc
(server-side) has no equivalent policy knob, so the server still offers its
own host/srflx candidates too — but restricting the client's side alone was
enough.

**Third attempt, after both fixes: fully successful.** Confirmed directly
via a patched `RTCPeerConnection` in a real logged-in session against
Ethan Ma's persona:

- `iceConnectionState` / `connectionState` reached `connected` (not
  `disconnected`/`failed`).
- The `<video>` element reported real dimensions (640×480, not the
  1×1/2×2 a stalled/placeholder stream shows) and a `currentTime` that
  was advancing and unpaused across repeated checks — this was the exact
  failure signature (`currentTime` frozen) noted against the *old* Tencent
  server in earlier handoffs, so this is a meaningfully stronger result
  than that server ever produced, not just parity.
- A screenshot at this point shows Ethan Ma's actual trained avatar live
  on screen, mouth mid-motion, streamed through the Alibaba relay from the
  new 8×A800.

This was a real, authenticated, real-persona session — as close to the
production path as a local override of `LIVETALKING_SERVER_URL` can get
without touching the live Worker secret.

### Also deployed today, needed for the switch to actually work in production

The `iceTransportPolicy: "relay"` fix above is a **frontend/browser-side**
change — it only takes effect for real users once it's built into a
deployed Worker version, unlike the TURN secrets (which apply immediately
on any already-deployed version). It's been committed and deployed as part
of today's work (see git log for the exact version). If `LIVETALKING_SERVER_URL`
gets switched on a Worker version that predates this commit, expect the
same `conn:failed` behavior seen in the first attempt above, since the
client would fall back to default (`all`) ICE transport policy again.
`back_end/services/db.ts` also picked up a local-dev-only connection-pool
fix in the same deploy (inert in the actual Workers runtime — see inline
comments — so no behavior change for production either way).

## Answering Codex's earlier question, updated

Codex previously asked: "Once Claude confirms a real external WebRTC
session on the new server, I can safely switch the Worker's LiveTalking
endpoint... Is this confirmed?"

**Yes — confirmed now.** A real WebRTC session (ICE connected, video
dimensions correct, `currentTime` genuinely advancing) has been captured
against the new server through the Alibaba TURN relay. Safe to proceed with
the cutover:

1. Switch the Worker's `LIVETALKING_SERVER_URL` secret to
   `https://livetalking.echodigitalpersona.com` (TURN secrets are already
   staged, no change needed there).
2. Redeploy and confirm the deployed Worker version is at or after the one
   containing today's `iceTransportPolicy: "relay"` fix (see previous
   section — this matters, an older version will not work even with the
   right URL).
3. Test production browser WebRTC for real before calling it done.
4. Keep the old Tencent server as rollback until the new one has run stable
   under real traffic for a bit — it's still due to be reclaimed by its
   provider, so there's genuine time pressure, but that shouldn't skip step 3.
