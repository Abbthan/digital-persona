#!/usr/bin/env bash
set -Eeuo pipefail

root_dir="${ECHO_GPU_ROOT:-/data/echodigitalpersona}"
export CUDA_VISIBLE_DEVICES="${MEMORY_EXTRACTOR_GPU_ID:-3}"
export HF_HOME="${root_dir}/cache/huggingface"
export MEMORY_EXTRACTOR_MODEL="${MEMORY_EXTRACTOR_MODEL:-${root_dir}/models/Qwen3-4B-Instruct-2507}"
export MEMORY_EXTRACTOR_REVISION="${MEMORY_EXTRACTOR_REVISION:-cdbee75f17c01a7cc42f958dc650907174af0554}"
export HF_HUB_OFFLINE=1
export TOKENIZERS_PARALLELISM=false

cd "${root_dir}/services/agentic-memory"
exec "${root_dir}/LiveTalking/.venv/bin/python" extractor_app.py
