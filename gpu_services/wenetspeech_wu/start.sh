#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="${ECHO_ROOT:-${ECHO_GPU_ROOT:-/home/user/echo}}"
service_dir="${root_dir}/services/wenetspeech-wu"

export CUDA_VISIBLE_DEVICES="${WENETSPEECH_WU_GPU:-0}"
export WENET_REPO="${service_dir}/wenet"
export WENETSPEECH_WU_MODEL_DIR="${root_dir}/models/wenetspeech-wu/u2++"
export WENETSPEECH_WU_DEVICE='cuda'
export WENETSPEECH_WU_DTYPE="${WENETSPEECH_WU_DTYPE:-fp32}"
export WENETSPEECH_WU_ALLOWED_ROOTS="/tmp,${root_dir}/runtime/jobs"
export PYTHONPATH="${service_dir}/deps:${WENET_REPO}:${service_dir}${PYTHONPATH:+:${PYTHONPATH}}"

cd "${service_dir}"
exec "${root_dir}/envs/livetalking/bin/python" app.py
