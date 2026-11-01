# ECHO: AVTR-1 evaluation and responsive-avatar implementation proposal

Prepared 1 November 2026. This is a proposal, not a claim that AVTR-1 has
been installed, benchmarked on ECHO's RTX 3090, licensed, or deployed.

## Recommendation

AVTR-1 is worth a gated evaluation because its design conditions motion on
both the avatar's speech and the visitor's audio, carries motion state between
chunks, and includes silent/listening scenarios. It is closer to a video-call
interaction than ECHO's current recorded-frame MuseTalk pipeline. It is not,
however, a complete off-the-shelf solution to emotion, eyelid animation,
breathing, or person-specific movement. Those require validation and, where
missing, additional controls. Keep the existing renderer as the production
fallback throughout evaluation.

The first gate is commercial licensing. Do not start a commercial pilot by
assuming that public source or the model's revenue threshold licenses every
component. No AVTR-1 software was executed as part of preparing this document.

## 1. Upstream findings and important boundaries

Inspected repository: [avaturn-live/avtr-1](https://github.com/avaturn-live/avtr-1),
revision `eb1e5a89ed7bec3debe712b090efd676b3a420bd` (26 May 2026).

- The project documents speech-driven rendering, reactions to the peer audio,
  and idle micro-motion. Its published GPU figures are the authors' results,
  not an ECHO capacity estimate. The README still marks the technical report
  and production-ready backend as coming soon despite broader introductory
  production language. [README](https://github.com/avaturn-live/avtr-1/blob/main/README.md)
- The input contract has separate 16 kHz mono speech/listen tracks. Model
  state includes prior motion, audio context and correlated noise; maintaining
  this state offers a route to continuity across turns.
  [Types](https://github.com/avaturn-live/avtr-1/blob/main/src/avtr1_renderer/types.py),
  [motion generator](https://github.com/avaturn-live/avtr-1/blob/main/src/avtr1_renderer/avtr1_motion_generator.py)
- Registration from a custom portrait exists in source, but a custom-photo
  workflow still needs product integration and quality testing; bundled-avatar
  examples alone do not prove it works for Ethan's recordings.
  [Avatar loader](https://github.com/avaturn-live/avtr-1/blob/main/src/avtr1_renderer/avatar_loader.py)
- Current options expose guidance/noise/output controls, not a direct
  validated “concerned,” “happy,” or “look at the visitor” semantic API. The
  motion representation predicts 39 of 63 expression coordinates; others stay
  at source values. Treat full eyelid/upper-face performance as an open test,
  not a promised built-in capability.
  [Options](https://github.com/avaturn-live/avtr-1/blob/main/src/avtr1_renderer/types.py),
  [coordinate definition](https://github.com/avaturn-live/avtr-1/blob/main/src/avtr1_renderer/constants.py)
- Upstream also contains a prerecorded intro-motion library. Disable that
  intro for the no-replay evaluation. Never choose a generic smile template
  based on inferred gender or an avatar name.
  [Intro implementation](https://github.com/avaturn-live/avtr-1/blob/main/src/avtr1_renderer/intro_motion.py)
- It is a portrait-animation system, not evidence of complete 3D/full-body
  reconstruction. Increasing the video output dimensions does not itself
  increase the native detail of the neural face renderer.

## 2. Licensing, privacy and commercial go/no-go

The upstream component notice distinguishes model, renderer and streamer
licences. It describes model use below its revenue threshold separately from
the commercial permission required for the supplied renderer and streamer.
The distribution also has third-party model restrictions, including
InsightFace pretrained assets. This is a deployment checklist, not legal advice.

Before commercial execution, obtain written clarification/permission covering:

1. ECHO's paid hosted service, customer-created avatars and intended territories.
2. The renderer and streamer, not just the AVTR-1 weights. Review the patent
   notice with appropriate counsel; do not assume reimplementation is a bypass.
3. Detection/landmark models and any permitted replacement models.
4. Authorised likeness/voice recreation, including memorial use, output
   labelling, retention, deletion and necessary user-consent language.
5. Whether customer media, telemetry or any inference request leaves ECHO's
   infrastructure. Self-hosting is the default proposal; no third-party demo
   upload or hosted inference is authorised by this document.

There is no public commercial quote established here. Budget approval and any
contract/account acceptance remain the user's decision. Vendor contact listed
by upstream: `hello@avaturn.me`; no contact has been sent.

[Component notice](https://github.com/avaturn-live/avtr-1/blob/main/LICENSE.md),
[model terms](https://github.com/avaturn-live/avtr-1/blob/main/LICENSE-MODEL.md),
[third-party notices](https://github.com/avaturn-live/avtr-1/blob/main/THIRD-PARTY-NOTICES.md),
[patent notice](https://github.com/avaturn-live/avtr-1/blob/main/PATENTS.md).

## 3. Proposed integration architecture

Preserve the website, sign-in, persona ownership checks, R2 media, database,
Cloudflare routing, TURN and the current speech/memory services. Add a
renderer adapter behind an allowlisted per-session feature flag, initially
staff-only. The existing MuseTalk adapter remains independently selectable.

### A. Persona registration and motion profile

- Select a sharp neutral portrait from an authorised upload or facial scan.
  Preserve original media and record exactly which source/consent produced
  the registration. Store appearance features separately from motion style.
- Validate frontal visibility, illumination, stable crop, closed resting mouth
  and usable eye detail. Reject/review bad material explicitly rather than
  generating a misleading “100% ready” status.
- Estimate head-pose range/velocity, nod amplitude, gaze-hold durations, blink
  intervals, resting mouth openness and expression amplitude from footage.
  Keep aggregate statistics with confidence/source IDs. Avoid inferring mood,
  diagnosis or personality from a neutral facial image.
- Longer recordings are optional for generic animation, but useful for
  personalised habits. A neutral portrait cannot reveal someone's usual nods.
  Recommend a short neutral clip plus spontaneous speech/listening material;
  do not present a fixed duration as a guarantee of fidelity.

### B. Continuous session behaviour controller

Create one session-local controller for `resting`, `listening`, `thinking`,
`speaking`, `interrupted` and `ending`. These are behavioural intents, not
separate prerecorded videos. Keep the same model state, pose, noise trajectory,
gaze target and expression baseline throughout the session.

- Visitor voice activity enters listening; silence alone does not reset pose.
- Awaiting retrieval/LLM/TTS enters thinking with restrained motion, not an
  exaggerated repeated thinking gesture.
- Speech starts when its scheduled PCM is ready for playback, not when reply
  text appears. Natural pauses remain within the same utterance.
- End-of-utterance returns toward listening/resting smoothly from the current
  latent state. Do not reload the portrait or restart random noise each turn.
- On interruption, cancel the queued utterance by ID, stop its scheduled
  audio and preserve animation continuity. Stale packets may not re-open lips.
- Screen-off, mute and exit remain immediate user controls; unsolicited
  conversation must stop when the user exits or disables it.

Use hysteresis and bounded interpolation of motion controls rather than full
image crossfades. RIFE may remain an optional fallback experiment for difficult
transitions, not the basis of the state machine or an extra process on every
normal frame.

### C. One audio/video clock

Fork the exact post-tempo, post-pause CosyVoice PCM into playback and the
renderer. Do not synthesize separate tracks or feed unadjusted audio to the
face while playing adjusted speech. Every packet carries session/utterance
IDs, sequence and source sample offsets. Derive presentation timestamps from
sample count, not wall-clock arrival time.

Buffer the renderer's validated future-audio context before releasing matching
audio/video. In the inspected configuration that includes future motion/audio
context; it is not zero-lookahead. Bound queues and measure the extra delay.
Preserve one continuous resampling state for each audio path. Silence supplied
for future context must not be accidentally played as an additional pause.

For listening reactions, use the visitor's echo-cancelled microphone track,
never the avatar's own speaker output. Treat background-TV speech separately
from addressed speech. Retain this live listening audio only if the user has
explicitly enabled recording; animation does not require permanent storage.

### D. Context-sensitive expression layer

Create a small structured side-channel beside the reply, e.g. an allowed
affect class, bounded intensity, conversational act and emphasis spans. Do
not speak these tags. Treat them as proposals, subject to a deterministic
controller and safety bounds—not arbitrary coordinates from an LLM.

- Coordinate voice delivery and visual expression. If the current TTS model
  cannot reliably express an emotion, prefer neutral delivery rather than a
  dramatically smiling face with a flat or distressed voice.
- Smooth upper-face/gaze controls separately from audio-driven lips. The
  mouth/articulation track has priority over a smile offset during speech.
- Default to mild affect; avoid constant grinning, sympathetic nodding during
  serious disclosures, or unsupported displays of intimacy.
- Validate emotion controls experimentally; a model that predicts listening
  motion does not automatically understand the semantic meaning of a story.

### E. Non-repeating idle and personal movement

Continue the session's latent motion generator during silence. If explicit
controls are needed, apply slowly varying, mean-reverting motion in pose/
expression space, bounded by the persona profile. Avoid repeated PNG sequences
and whole-image zoom/rotation masquerading as breathing.

Add eyelid retargeting with validated facial controls, not the disabled eye
pixel-compression overlay. Use variable blink timing with plausible closing/
opening dynamics and eye-gaze coupling. Head/shoulder breathing needs a
separate supported control if the model only drives facial motion; do not
claim torso motion from a face-only output.

Personalise small motion statistics first. Do not add every learned offset to
an already expressive model: separate baseline, semantic affect, audio motion
and stochastic variation, then clamp the combined result. Fine-tuning a motion
model is a later, separately evaluated option—not the first integration step.

## 4. Evaluation and promotion gates

All figures below are proposed acceptance targets, not measured promises.

| Gate | Required evidence before promotion |
|---|---|
| Custom identity | Ethan portrait, multiple authorised sources, no systematic identity drift; human side-by-side review |
| Articulation | English and Mandarin test sets, bilabials/rounded vowels, question endings, numbers, fast/slow speech; measure A/V offset and lip-sync quality, not just changing pixels |
| Continuity | 10-minute sessions with repeated start/stop, silence, breathing pauses, interruption, reconnect; no resets to unrelated pose or replayed intro |
| Idle/listening | Five minutes without exact repeated motion sequences; eyes and resting mouth anatomically plausible; react to visitor speech without repeating stock nods |
| Expression | Blind review of neutral/warm/concerned/emphasis cases; control must not damage phonetic articulation |
| Runtime | Sustained 25 fps target, p95 five-frame generation below 200 ms under actual concurrent TTS/STT load; measure VRAM, first-frame delay, queue underruns and GPU headroom |
| Synchronisation | Target p95 absolute A/V offset below 80 ms, no cumulative drift across 10 minutes; validate end-of-speech tail and interruption separately |
| Isolation | Independent sessions cannot share identity, motion state, voice, memory or audio buffers |
| Recovery | Renderer failure produces a clear reconnect/fallback choice; never silently claim the replay fallback is the new generative renderer |
| Privacy/operations | Consent and AI disclosure, access control, exact per-source deletion, health checks and reproducible rollback |

Benchmark one concurrent user first, then two. Keep admission control and
measure the full stack; do not infer concurrency from a vendor demo or from
the GPU having 24 GB VRAM. The existing host driver/NVML mismatch should be
reviewed in planned maintenance before engine compilation; no reboot/driver
change is authorised here.

## 5. Phased delivery and decision points

1. **Licensing and dependency audit:** request written terms, pin source/model
   revisions and agree a permitted evaluation. Exit: a documented legal path;
   otherwise stop before commercial execution.
2. **Isolated feasibility benchmark:** separate environment, loopback-only
   adapter, no production route. Register Ethan's portrait and test prerecorded
   authorised audio, silent idle and two-party listening. Exit: useful identity,
   articulation and compute headroom on the actual 3090.
3. **Clocked renderer bridge:** integrate existing CosyVoice/STT and WebRTC
   without replacing memory, speech synthesis or deployment mechanisms.
4. **Controller and expression:** persistent state, interruptions, neutral mouth,
   gaze/eyelid controls, bounded affect and no prerecorded idle loop.
5. **Personalisation and pilot:** source-derived motion profile, blind review,
   cross-session tests and staff-only feature flag. Promote only after gates
   pass; preserve the previous adapter and assets for immediate rollback.

A rough engineering allowance is several weeks after licences, dependencies
and usable custom-avatar inference are confirmed. It is not a delivery date:
the two main unknowns are commercial permission and full-stack 3090 headroom.
No model download/engine build, vendor contact, contract or paid service switch
is included in today's implementation.

## 6. Speaking-style repair accompanying this proposal

The separate implementation repairs the currently observed self-reinforcement
problem without waiting for a renderer change:

- Dedicated source-only style evidence, separate English/Chinese summaries,
  original examples and confidence; generated persona text never teaches style.
- Background transcription of full authorised recordings, not only the selected
  voice-reference excerpt. Preserve raw text and coarse source timestamps.
- Owner-controlled speaker/author attribution; mixed/unverified sources may
  supply context but not the target's wording habits. Scripted readings are
  excluded from spontaneous style.
- Source-specific revocation/deletion and deterministic held-out examples.
  Those examples are withheld from the style prompt; a rigorous model-quality
  test must also exclude the same source text from factual retrieval.
- No fine-tuning is claimed. More spontaneous material is needed if the only
  existing recordings are read-aloud scripts. Evaluate held-out English and
  Chinese responses with the owner before calling style fidelity established.

The model can emulate observable habits; it does not become the person or
acquire their actual emotions. The product should keep clear AI disclosure
and controls regardless of the conversational voice used inside the experience.
