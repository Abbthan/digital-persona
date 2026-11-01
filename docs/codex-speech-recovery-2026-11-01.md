# Speech delivery recovery — 1 November 2026

## Scope and preserved systems

The user requested resolution of the remaining slow/uneven speech after the
31 October recovery. No Cloudflare domain, tunnel, TURN, database/storage,
LLM-provider, STT, memory or video connection configuration was changed.
Synthetic eye-warp blinking remains disabled. Only CosyVoice was restarted;
the working LiveTalking renderer and other services were left running.

## Diagnosed causes

- The deployed speech endpoint used `stream=False` and ran separate inference
  at every comma, including single-word tails. It then split the completed
  waveform into HTTP packets: transport chunking was not actual synthesis
  streaming. This caused repeated startup costs and starvation between pieces.
- The upstream CosyVoice2 streaming implementation mutated a model-wide
  `token_hop_len`. Later requests could inherit a large first hop. Patch 0032
  makes the adaptive hop local to each request.
- Speech and mouth rendering share one RTX 3090. Audio produced just fast
  enough without rendering could fall behind while the avatar was active.
- FP16 was already enabled and flow sampling already used 10 steps. Neither
  was reduced further. Large CPU thread pools were not the main cause.

## Applied implementation

- Default: one complete reply through native audio-streaming inference. Reuse
  the existing speech-style module for breath/break cues without deleting words.
- One persistent SoXR resampler per acoustic stream, flushed at EOF. No
  independent resampling or fades at arbitrary network-packet boundaries.
- One continuous FFmpeg atempo filter when the learned speed is non-unit,
  preserving pitch. The filter is drained before the final end event.
- Bounded startup pre-roll, default 1.5 seconds after the first acoustic block,
  capped at 2 seconds. Synthesis continues concurrently before GPU-intensive
  mouth rendering begins. Short completed replies can flush early. This
  intentionally trades some startup wait for steadier delivery; it is not
  zero-latency speech or a whole-WAV buffer.
- Two CPU dispatch threads, one interop thread. No new Torch installation,
  driver/reboot, TensorRT engine or model-weight replacement.
- Optional `COSYVOICE_PHRASE_PACING=1` retains an explicit measured-pause path.
  Its planner groups short openings and retains comma context. The default
  native path uses model prosody, not fixed inserted silence at every comma.
- Prebuilt JIT encoder was tested and rejected: new-shape stalls materially
  worsened latency. It remains disabled unless explicitly enabled.

## Verification performed during development

- 28 isolated Python audio regressions passed, including bilingual phrase
  preservation, final questions, paragraph/decimal handling, measured breaks,
  sample counts, cosine fades, pitch preservation, EOF drainage, bounded
  pre-roll ordering, error propagation and cancellation cleanup.
- 25 JavaScript regressions passed: admin, live-session access/ICE fixes,
  speech routing and provider transport. Lint passed with the pre-existing
  unused-disable warning in `front_end/state/auth-context.tsx:101`.
- Real English and Mandarin audio was generated with the existing authorized
  voice reference and transcribed through the existing STT service. The long
  English test included the full final question. ASR wording is approximate;
  this is not proof of perfect pronunciation or exact voice similarity.
- Representative single-pass synthesis (before startup pre-roll): about
  8.90 seconds of English audio generated in 6.31 seconds; 5.65 seconds of
  Mandarin audio in 4.23 seconds, at the persona's 1.074 learned speed factor.
  Cold short requests were slower proportionally. These are individual
  measurements, not a concurrency guarantee or controlled average benchmark.
- Complete synthetic replies were captured through actual WebRTC along with
  hundreds of changing video frames, then transcribed to check the final
  question. Every diagnostic session closed in `finally`. Host-local media
  checks alone do not prove external TURN; the signed-in website was also
  reconnected for its public-path check.

## Runtime and rollback

Code: `/home/user/echo/app/gpu_services/cosyvoice_service/`.
Upstream patch target:
`/home/user/echo/source/CosyVoice/cosyvoice/cli/model.py`.
Backup: `model.py.before-echo-stream-20261101` beside the target.

User service: `echo-cosyvoice.service`, localhost port 9880.
The existing environment-local FFmpeg is reused; no system package change.
Controls: `COSYVOICE_PREROLL_SECONDS`, `COSYVOICE_CPU_THREADS`,
`COSYVOICE_PHRASE_PACING`, `COSYVOICE_LOAD_JIT`, `COSYVOICE_FFMPEG`.
Do not restore the upstream hop bug while keeping native streaming enabled.

Reproducible diagnostics:
`scripts/gpu-server/benchmark-speech-stream.py` and
`scripts/gpu-server/verify-local-webrtc.py --capture-seconds 15 --capture-audio ...`.
Synthetic waveforms remain in the server's private runtime directory, not Git.
No credentials or reference recordings are included in this report/repository.

## Limits

The 3090 still has finite shared inference capacity. Normal thought pauses and
breaths remain intentional. Startup/cache rebuilding, LLM response time and
network jitter are separate contributors. The previously noted NVIDIA/NVML
version mismatch is unchanged; addressing it requires planned host maintenance.
Do not claim all latency, all warnings or all pronunciation errors are eliminated.
