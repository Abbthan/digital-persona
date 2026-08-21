#!/usr/bin/env bash
set -euo pipefail

echo_root="${ECHO_ROOT:-/home/user/echo}"
export PYTHONPATH="${echo_root}/app:${PYTHONPATH:-}"
export FASTER_WHISPER_MODEL_ROOT="${FASTER_WHISPER_MODEL_ROOT:-${echo_root}/models/faster-whisper}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"
cd "${echo_root}/app"
exec "${echo_root}/envs/speech-recognition/bin/python" -m gpu_services.speech_recognition.app
