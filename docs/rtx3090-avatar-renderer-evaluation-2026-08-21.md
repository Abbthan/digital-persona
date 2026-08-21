# RTX 3090 avatar renderer evaluation

Date: 2026-08-21

## Current production state

Production remains on LiveTalking + MuseTalk. The permanent Cloudflare named
tunnel sends `livetalking.echodigitalpersona.com` to port 8010 on the RTX 3090
host. This route has passed a real WebRTC offer/answer, audio, and moving-video
test.

The replacement server currently uses about 17.3 GiB of its 24 GiB GPU memory:

- LiveTalking/MuseTalk: about 12.2 GiB;
- CosyVoice: about 3.1 GiB;
- speech recognition router: about 0.9 GiB;
- WenetSpeech-Wu: about 0.8 GiB.

That leaves too little headroom to load an unmeasured second full renderer into
the production process. An experimental renderer must therefore be isolated,
benchmarked, and canaried before it is allowed to replace MuseTalk.

## Improvements already active

CosyVoice now applies the requested punctuation-aware prosody profile:

- comma and enumeration pauses: 150–250 ms;
- sentence-ending pauses: 400–600 ms;
- ellipsis and paragraph pauses: 700–900 ms;
- short raised-cosine fades at clause boundaries to prevent hard audio joins.

The service also learns bounded pace and pause tendencies from each persona's
reference speech. The learned profile is stored next to the private voice
reference and is removed with the persona.

Avatar preparation now has a safe procedural idle fallback when a persona has
no passive facial scan. It uses a sharp neutral source frame, small
mean-reverting head/breathing motion, and a real closed-eye frame when one can
be found. Uploaded passive footage still has priority. The synthetic eyelid
warping experiment was rejected because visual inspection exposed artifacts;
it is not in production.

## Candidate assessment

### LivePortrait

LivePortrait is a source-image/video plus driving-video system. It is useful as
a full-face motion representation, but its base inference path is not an
audio-to-expression driver. Using it for live speech still requires another
model that converts audio into expressions and head motion. Its bundled face
analysis weights also require a separate commercial-use licensing review or a
replacement detector before customer deployment.

### EchoMimic / EchoMimicV2

EchoMimic supplies an audio-to-motion path, but the official EchoMimicV2
performance examples are not real-time enough for the present interactive
WebRTC requirement. It remains an offline-quality reference, not the first
production canary.

### Ditto

Ditto is the preferred first isolated experiment. It is audio-driven, derives
from LivePortrait-style motion modelling, exposes an online configuration, and
ships an Ampere-compatible TensorRT path. The code is Apache-2.0. Its official
test environment uses TensorRT 8.6.1, so the RTX 3090 environment and checkpoint
compatibility still need to be proven rather than assumed.

## Pinned source staging

The following source-only checkouts are staged under
`/home/user/echo/experiments`:

| Candidate | Revision |
| --- | --- |
| LivePortrait | `9b294b3d0536135442ea73cb01e6cb3ca7029dd3` |
| Ditto | `c3e47eee2e626500017a0556b470d6d4182f85e8` |

`scripts/gpu-server/stage-avatar-renderers-3090.sh` reproduces these pinned
checkouts. It intentionally does not download weights, install dependencies,
start a service, alter Cloudflare, or consume GPU memory.

## Acceptance gates before any renderer switch

1. Download model weights into an isolated experiment directory and record
   their checksums and licences.
2. Build a separate Python environment; do not modify the LiveTalking,
   CosyVoice, or STT environments.
3. Run offline image + speech tests while the candidate is not exposed to the
   website. Measure VRAM, first-frame latency, real-time factor, frame rate,
   lip-sync, blink/head-motion quality, and English/Chinese behavior.
4. Reject the candidate if total production VRAM would exceed 21.5 GiB or if it
   reduces WebRTC stability. This retains operational headroom on the 24 GiB
   card.
5. If it passes, expose it on a separate local port and add a server-side
   feature flag. MuseTalk must remain the immediate fallback.
6. Canary only an explicit test persona. Do not rewrite existing avatar
   packages until the canary passes real WebRTC tests.
7. Promote only after the browser proves continuous audio, corresponding lip
   motion, idle blinking/breathing, smooth idle/speaking transitions, and clean
   service/Cloudflare logs.

## Production rule

The existing MuseTalk architecture has not been deleted or disabled. Source
staging is not a deployment claim: neither LivePortrait nor Ditto is currently
serving customer sessions. This preserves the known-working route while the
replacement is evaluated safely on the single RTX 3090.
