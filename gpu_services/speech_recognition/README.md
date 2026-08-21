# ECHO speech-recognition service

This localhost-only service owns conversational STT. It keeps the existing
three-position English / Mandarin / Wu preference contract:

- English forces Faster-Whisper English decoding and rejects strong Chinese
  hallucinations.
- Mandarin forces Chinese decoding and does not spend time on the Wu model.
- Wu first obtains the safe Chinese Faster-Whisper fallback and then asks the
  isolated WenetSpeech-Wu service to select the dialect hypothesis.
- `auto` remains available for one-time voice-reference preparation.

Timestamped words are also reduced to a non-sensitive aggregate cadence and
pause profile for the persona's voice style. The raw upload is deleted after
each request.
