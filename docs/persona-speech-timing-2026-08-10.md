# Persona speech timing and natural pauses — 2026-08-10

## Outcome

Voice training now learns aggregate timing habits from the authorized talking
recording instead of reducing the recording to plain transcript text. The
profile measures:

- speaking rate (English words/second or Chinese characters/second);
- short- and long-break medians;
- pause frequency and long-pause ratio;
- whether breaks most often occur at sentence, clause, or unpunctuated
  boundaries;
- an evidence confidence level based on recording duration, speech amount,
  and observed pauses.

The profile contains no transcript content, raw audio, or speaker embedding.
It is written privately beside the reference WAV as
`data/voice_refs/<persona-id>.speech.json` and is deleted by the existing
persona GPU cleanup route.

## Runtime behavior

1. Faster-Whisper produces word timestamps during the one-time reference
   transcription.
2. `persona_speech_profile.py` calculates a bounded profile. Recordings with
   too little reliable evidence remain `confidence=low` and do not alter TTS.
3. LiveTalking loads the sidecar when the WebRTC persona session is created.
4. CosyVoice applies the measured, tightly clamped pace (0.86–1.14×) and, for
   clearly frequent pausers, adds at most two pause cues at real phrase
   boundaries. It uses CosyVoice's documented `[breath]` token only when long
   pauses were common.
5. The complete utterance still runs through one streaming inference call.
   No per-sentence CosyVoice restarts were reintroduced, preserving the audio
   continuity, latency, complete-utterance, and lip-sync fixes from patches
   0014–0025.
6. A non-sensitive timing summary is ingested with the same source asset so
   the reply model can express the person's phrase breaks through natural
   punctuation and sentence length in English and Chinese. The summary is
   removed with that asset.

Existing reference WAVs are backfilled by
`scripts/gpu-server/backfill-speech-profiles.py`; no persona retraining is
required for the TTS layer.

## Reproducible deployment

- Apply `scripts/gpu-server/patches/0026-cosyvoice-persona-speech-timing.patch`
  from `/data/echodigitalpersona/CosyVoice`.
- Apply `scripts/gpu-server/patches/0027-livetalking-persona-speech-timing.patch`
  from `/data/echodigitalpersona/LiveTalking`.
- Restart only CosyVoice and LiveTalking, then run the backfill script with
  CosyVoice's virtual environment.

Production rollback copies use the suffix
`.pre-speech-timing-20260810` beside each modified server file.

## Verification

- Python unit tests cover English measurement, Chinese conditioning, evidence
  gating, and word/content preservation.
- Python syntax checks passed for the new module, CosyVoice server,
  LiveTalking app/TTS/deletion route, and the backfill script.
- Both production patches passed a dry run against exact live source files.
- Existing references were backfilled: one usable 24.98-second English sample
  produced a high-confidence profile (2.72 words/second, 7 observed pauses,
  420 ms median short break, 720 ms median long break); a silent/insufficient
  reference correctly remained low-confidence and therefore neutral.
- Live English synthesis re-transcribed to the complete requested sentence
  and produced 5.32 seconds of continuous audio.
- Live Mandarin synthesis re-transcribed to the complete requested sentence
  and produced 7.16 seconds of continuous audio.
- Both languages used a single CosyVoice inference segment. First PCM arrived
  in 1.51 seconds on the warm Chinese request; subsequent chunks stayed faster
  than real time. LiveTalking restarted at its intended 25 FPS.

The remaining startup warnings about `torch.load(weights_only=False)` and one
old process's semaphore cleanup are pre-existing framework/shutdown warnings,
not failures in the timing path.
