# ECHO CosyVoice service

This localhost-only service keeps CosyVoice model loading and reference-voice
feature extraction outside LiveTalking. It caches a stable speaker key, selects
a tested English/Chinese inference path, and genuinely streams acoustic output
through a persistent 24-to-16 kHz resampler to LiveTalking.

`livetalking_client.py` replaces only upstream `tts/cosyvoice.py`; MuseTalk and
the rest of LiveTalking remain independently updateable.

Use a dedicated environment and install `requirements.txt` there. Do not copy
or share LiveTalking's site-packages: CosyVoice2 pins torch/torchaudio 2.3.1,
and mixing only one of those with LiveTalking's newer build causes binary ABI
failures. The launcher binds to localhost and exposes GPU 0 by default.

English output intentionally uses cross-lingual inference even with an English
reference transcript. The historical same-language zero-shot path generated
near-silent English for the migrated persona, while cross-lingual synthesis is
healthy for both English and Chinese. Speaker embeddings are cached by persona
voice key and rebuilt automatically after a service restart.

## Streaming, pacing and de-click fades

By default `/inference_auto` sends one complete reply through streaming
inference. It reuses `speech_style.profile.condition_tts_text` for learned
breath/phrase-break cues, preserving all words, punctuation and the learned
tempo. This avoids restarting the acoustic model at each sentence on the
single 3090 that also renders the avatar. Native prosody controls the actual
within-reply silence durations; this path does not enforce fixed millisecond
silence at every comma.

`COSYVOICE_PHRASE_PACING=1` retains an optional explicit-pause path using
`logic.plan_synthesis_phrases`: comma-linked words and short openings stay in
the same acoustic context. Between separate phrases this path uses measured
sentence/thought pauses (bounded defaults 0.4–0.6s / 0.7–0.9s). Paragraph
breaks remain explicit. The older every-comma splitter remains available but
is not the live path: tiny fragments caused avoidable startup costs and gaps.

Model output uses `stream=True`; one SoXR filter per phrase preserves its
resampling state across all packets and flushes its final samples. A short
15ms cosine fade is applied only at phrase edges, not at every packet. One
continuous FFmpeg `atempo` process per reply preserves pitch and the learned
speed factor, because CosyVoice2's own speed argument is non-streaming-only.
In the explicit-pause path, pauses are compensated for the tempo filter, so
their final duration remains the measured target. `COSYVOICE_FFMPEG` can select an explicit binary;
the service also finds the existing environment-local binary automatically.

Apply `scripts/gpu-server/patches/0032-cosyvoice-request-local-stream-hop.patch`
to the matching upstream CosyVoice2 checkout before enabling this path. It
keeps hop growth request-local; otherwise later replies inherit a large first
hop and silently stop behaving like low-latency streams. Do not blindly apply
it to a different upstream revision; inspect/dry-run first.

FP16 remains enabled. Flow sampling on the installed model is already 10
steps; this change does not lower quality settings or replace model weights.
CPU dispatch uses two threads by default (override `COSYVOICE_CPU_THREADS`).
The vendor JIT encoder remains opt-in: it caused large new-shape stalls in
the 3090 benchmark. No TensorRT/vLLM installation is required.

A bounded pre-roll (`COSYVOICE_PREROLL_SECONDS`, default 1.5s, cap 2s)
lets synthesis build a small lead before mouth rendering starts competing for
the same GPU. It starts counting after the first acoustic block; completed
short replies can flush sooner. The FIFO holds at most 16 transport blocks,
not an entire WAV, and no delay is added between packets after startup.
Cancellation drains the active model iterator before releasing the inference
lock, preventing abandoned synthesis from overlapping the next request.
This deliberately trades a small startup wait for fewer mid-sentence stalls;
it is not a claim that response latency or GPU capacity is unlimited.

The renderer still receives one start/end pair for the complete reply and the
same 16 kHz PCM contract. This change does not alter video state transitions,
enable synthetic blinking, or assert that deliberate natural pauses should
make a silent mouth animate.

## Verification

Run `test_logic.py` and `test_pcm.py` with pytest (or invoke their plain test
functions in the isolated environment). Tests cover complete final questions,
Chinese punctuation, decimal/paragraph handling, measured pauses, edge fades,
byte-exact normal tempo, pitch preservation and final filter drainage.

`scripts/gpu-server/benchmark-speech-stream.py` measures first-audio latency,
generation/audio duration ratio and the minimum theoretical prebuffer needed
for each observed stream. It can run with a persona's existing timing profile
and transcribe only its synthetic test outputs. Keep reference files and keys
on the server; do not publish them in benchmark reports.

`verify-local-webrtc.py --capture-seconds 15 --capture-audio /private/path.wav`
can capture a complete synthetic utterance and closes its session in `finally`.
Host-local WebRTC tests do not prove external TURN connectivity; also exercise
the signed-in website before declaring an end-to-end deployment healthy.
