# WenetSpeech-Wu STT service

This localhost-only GPU service adds Wu-dialect recognition to ECHO's existing
FastWhisper STT boundary. It uses ASLP-lab's Apache-2.0
`Conformer-U2pp-Wu` checkpoint and retains FastWhisper as the authoritative
English/general-language engine and as the failure fallback.

## Runtime isolation

- GPU: the ECHO rendering GPU (`CUDA_VISIBLE_DEVICES=0` by default on the
  single-RTX-3090 host)
- Compute dtype: FP32 (FP16 produced invalid attention-rescoring values for
  this published checkpoint during validation)
- HTTP: `127.0.0.1:9890`
- Source: `${ECHO_ROOT}/services/wenetspeech-wu`
- Model: `${ECHO_ROOT}/models/wenetspeech-wu/u2++`
- Disposable audio: `/tmp` or `/data/echodigitalpersona/runtime/jobs`
- tmux service: `echo-wenetspeech-wu`

The service uses the existing LiveTalking environment only as a read-only
CUDA/PyTorch/aiohttp base. No packages are installed into LiveTalking or
CosyVoice. A minimal local `whisper.tokenizer.LANGUAGES` compatibility module
is present only because WeNet imports that constant even for a non-Whisper
Conformer model; no Whisper inference code is used by this service.

## Pinned upstreams

- WeNet source commit: `a54b90bc768679bd4217e4c7765c0671fbfb3a7a`
- Model repository: `ASLP-lab/WenetSpeech-Wu-Speech-Understanding`
- Model revision: `cb53da7aefd9acd0f2af61b9631e49f5c3382686`
- Required checkpoint subtree: `u2++/`

## Contract

- `GET /health` reports model/device readiness.
- `POST /transcribe` accepts a WAV upload for isolated testing.
- `POST /transcribe-path` accepts a disposable local WAV path plus the existing
  FastWhisper candidate, runs WenetSpeech-Wu, and returns the safely selected
  transcript.

The selection rules intentionally do not compare raw scores from different
model families. Wu output is selected for Chinese/Wu input or uncertain
language detection when the Wu hypothesis has sufficient normalized
confidence and Chinese-script content. Confident English stays on FastWhisper.

## Deployment outline

1. Copy this directory to the service path above.
2. Clone the pinned WeNet commit into `wenet/`.
3. Download only the official `u2++/` model subtree into the model path.
4. Start `start.sh` in the `echo-wenetspeech-wu` tmux session.
5. Verify `/health`, then transcribe the official Wu sample and non-Chinese
   control audio before enabling the CosyVoice routing patch.

Apply `scripts/gpu-server/patches/0006-wenetspeech-wu-stt-routing.patch`
to the CosyVoice checkout after the service test passes. The patch enriches
Faster-Whisper results with detected-language metadata, asks this localhost
service to select the safe transcript, and retains the original result on any
Wu-service error. It does not modify CosyVoice synthesis or LiveTalking.

Production validation on the 8×A800 host selected Wu for the official dialect
sample and retained Faster-Whisper for a confident English control. The
authenticated local LiveTalking gateway and its existing Cloudflare Tunnel
both returned the same correct Wu transcript. No additional public port is
required.
