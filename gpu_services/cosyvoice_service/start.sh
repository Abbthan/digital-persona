#!/usr/bin/env bash
set -euo pipefail

ECHO_ROOT="${ECHO_ROOT:-/home/user/echo}"
export PYTHONPATH="${ECHO_ROOT}/app:${ECHO_ROOT}/source/CosyVoice:${ECHO_ROOT}/source/CosyVoice/third_party/Matcha-TTS${PYTHONPATH:+:${PYTHONPATH}}"
export COSYVOICE_ROOT="${COSYVOICE_ROOT:-${ECHO_ROOT}/source/CosyVoice}"
export COSYVOICE_MODEL_DIR="${COSYVOICE_MODEL_DIR:-${ECHO_ROOT}/models/CosyVoice2-0.5B}"
export COSYVOICE_PORT="${COSYVOICE_PORT:-9880}"
export COSYVOICE_FP16="${COSYVOICE_FP16:-1}"
# The vendor JIT encoder stalled on new input shapes in the 3090 benchmark.
# Retain an explicit opt-in, not an automatic production enablement.
export COSYVOICE_LOAD_JIT="${COSYVOICE_LOAD_JIT:-0}"
export COSYVOICE_CPU_THREADS="${COSYVOICE_CPU_THREADS:-2}"
export OMP_NUM_THREADS="${COSYVOICE_CPU_THREADS}"
export MKL_NUM_THREADS="${COSYVOICE_CPU_THREADS}"
export CUDA_VISIBLE_DEVICES="${CUDA_VISIBLE_DEVICES:-0}"

exec "${ECHO_ROOT}/envs/cosyvoice/bin/python" -m gpu_services.cosyvoice_service.app
