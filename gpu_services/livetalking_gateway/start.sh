#!/usr/bin/env bash
set -euo pipefail

echo_root="${ECHO_ROOT:-/home/user/echo}"
set -a
source "${echo_root}/secrets/livetalking.env"
set +a

export LIVETALKING_SERVICE_ROOT="${LIVETALKING_SERVICE_ROOT:-${echo_root}/services/livetalking}"
export LIVETALKING_PYTHON="${LIVETALKING_PYTHON:-${echo_root}/envs/livetalking/bin/python}"
export ECHO_JOBS_DIR="${ECHO_JOBS_DIR:-${echo_root}/runtime/jobs}"
export PYTHONPATH="${echo_root}/app:${PYTHONPATH:-}"
# The server intentionally has no system-wide ffmpeg. Both gateway media
# canonicalisation and avatar idle-frame extraction invoke it by name, so
# expose the isolated LiveTalking build without requiring root packages.
export PATH="${echo_root}/envs/livetalking/bin:${PATH}"
cd "${echo_root}/app"
exec "${echo_root}/envs/livetalking/bin/python" -m gpu_services.livetalking_gateway.app
