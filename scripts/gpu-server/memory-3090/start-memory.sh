#!/usr/bin/env bash
set -euo pipefail
set -a
source /home/user/echo/secrets/livetalking.env
set +a
export NEO4J_PASSWORD
NEO4J_PASSWORD="$(</home/user/echo/secrets/memory-graph.password)"
export NEO4J_URI=bolt://127.0.0.1:7687
export NEO4J_USER=neo4j
export AGENTIC_MEMORY_DATA_DIR=/home/user/echo/runtime/agentic-memory
export MEMORY_EMBEDDING_MODEL=/home/user/echo/models/bge-m3
export MEMORY_EMBEDDING_DEVICE=cpu
export MEMORY_EXTRACTOR_URL=http://127.0.0.1:9020/extract
export MEMORY_EXTRACTOR_TIMEOUT_SECONDS=300
export FASTEMBED_CACHE_PATH=/home/user/echo/cache/fastembed
export MEM0_TELEMETRY=false
export ANONYMIZED_TELEMETRY=false
export HF_HUB_OFFLINE=1
export OMP_NUM_THREADS=2
export MKL_NUM_THREADS=2
cd /home/user/echo/app/gpu_services/agentic_memory
exec /home/user/echo/envs/agentic-memory/bin/python -m uvicorn app:app --host 127.0.0.1 --port 9010 --workers 1
