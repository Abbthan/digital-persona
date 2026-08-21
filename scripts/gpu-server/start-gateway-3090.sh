#!/usr/bin/env bash
set -euo pipefail

echo_root="${ECHO_ROOT:-/home/user/echo}"
export ECHO_ROOT="${echo_root}"
export LIVETALKING_UPSTREAM_URL="${LIVETALKING_UPSTREAM_URL:-http://127.0.0.1:8011}"
export ECHO_STT_URL="${ECHO_STT_URL:-http://127.0.0.1:9891}"
export GATEWAY_HOST="${GATEWAY_HOST:-127.0.0.1}"
export GATEWAY_PORT="${GATEWAY_PORT:-8010}"

cd "${echo_root}/app"
exec ./gpu_services/livetalking_gateway/start.sh
