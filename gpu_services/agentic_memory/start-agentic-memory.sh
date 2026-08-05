#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="${ECHO_GPU_ROOT:-/data/echodigitalpersona}"
service_dir="${root_dir}/services/agentic-memory"
set -a
# shellcheck disable=SC1090
source "${root_dir}/secrets/agentic-memory.env"
set +a

export AGENTIC_MEMORY_DATA_DIR="${root_dir}/runtime/agentic-memory"
export MEMORY_EMBEDDING_MODEL="${root_dir}/cache/huggingface/hub/models--BAAI--bge-m3/snapshots/$(cat "${root_dir}/cache/huggingface/hub/models--BAAI--bge-m3/refs/main")"
export MEMORY_EMBEDDING_DEVICE="cuda:0"
export MEMORY_EXTRACTOR_URL="http://127.0.0.1:9020/extract"
export CUDA_VISIBLE_DEVICES="${AGENTIC_MEMORY_GPU_ID:-4}"
export FASTEMBED_CACHE_PATH="${root_dir}/cache/fastembed"
export HF_HUB_OFFLINE=1
export MEM0_TELEMETRY=false
export ANONYMIZED_TELEMETRY=false

cd "${service_dir}"
exec .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 9010 --workers 1
