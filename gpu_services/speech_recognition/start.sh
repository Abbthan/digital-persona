#!/usr/bin/env bash
set -euo pipefail

echo_root="${ECHO_ROOT:-/home/user/echo}"
export PYTHONPATH="${echo_root}/app:${PYTHONPATH:-}"
export FASTER_WHISPER_MODEL_ROOT="${FASTER_WHISPER_MODEL_ROOT:-${echo_root}/models/faster-whisper}"
export HF_ENDPOINT="${HF_ENDPOINT:-https://hf-mirror.com}"
export HF_HUB_DISABLE_XET="${HF_HUB_DISABLE_XET:-1}"

# CTranslate2 loads CUDA libraries lazily on the first transcription. Keeping
# these libraries inside the speech-recognition environment prevents a healthy
# startup followed by a runtime failure, and avoids coupling STT to the
# LiveTalking or CosyVoice environments.
cuda_library_path=""
for cuda_lib_dir in "${echo_root}"/envs/speech-recognition/lib/python*/site-packages/nvidia/*/lib; do
  if [[ -d "${cuda_lib_dir}" ]]; then
    cuda_library_path="${cuda_library_path:+${cuda_library_path}:}${cuda_lib_dir}"
  fi
done
if [[ -n "${cuda_library_path}" ]]; then
  export LD_LIBRARY_PATH="${cuda_library_path}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
fi

cd "${echo_root}/app"
exec "${echo_root}/envs/speech-recognition/bin/python" -m gpu_services.speech_recognition.app
