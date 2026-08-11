#!/usr/bin/env bash
set -euo pipefail

root_dir="${ECHO_GPU_ROOT:-/data/echodigitalpersona}"
export CUDA_VISIBLE_DEVICES="${RIFE_GPU_ID:-5}"
export PYTHONPATH="${root_dir}/RIFE-experiment/vendor:${root_dir}:${PYTHONPATH:-}"

cd "${root_dir}"
exec "${root_dir}/LiveTalking/.venv/bin/python" -m gpu_services.avatar_rendering.rife_service \
  --repository "${RIFE_REPOSITORY:-${root_dir}/RIFE-experiment}" \
  --weights "${RIFE_WEIGHTS:-${root_dir}/RIFE-experiment/modelscope-rife}" \
  --host 127.0.0.1 \
  --port "${RIFE_PORT:-9030}"
