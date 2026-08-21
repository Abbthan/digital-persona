#!/usr/bin/env bash
set -euo pipefail

# Stage renderer source trees without installing packages, downloading model
# weights, changing services, or allocating GPU memory. Production remains on
# LiveTalking + MuseTalk until a renderer passes the isolated acceptance gates
# documented in docs/rtx3090-avatar-renderer-evaluation-2026-08-21.md.

experiment_root="${ECHO_EXPERIMENT_ROOT:-/home/user/echo/experiments}"
liveportrait_revision="${LIVEPORTRAIT_REVISION:-9b294b3d0536135442ea73cb01e6cb3ca7029dd3}"
ditto_revision="${DITTO_REVISION:-c3e47eee2e626500017a0556b470d6d4182f85e8}"

stage_repository() {
  local name="$1"
  local url="$2"
  local revision="$3"
  local destination="${experiment_root}/${name}"

  if [[ ! -d "${destination}/.git" ]]; then
    git clone --filter=blob:none --no-checkout "${url}" "${destination}"
  fi

  git -C "${destination}" fetch --depth=1 origin "${revision}"
  git -C "${destination}" checkout --detach "${revision}"

  local actual_revision
  actual_revision="$(git -C "${destination}" rev-parse HEAD)"
  if [[ "${actual_revision}" != "${revision}" ]]; then
    echo "${name}: expected ${revision}, got ${actual_revision}" >&2
    exit 1
  fi

  printf '%s %s\n' "${name}" "${actual_revision}"
}

mkdir -p "${experiment_root}"

stage_repository \
  "LivePortrait" \
  "https://github.com/KwaiVGI/LivePortrait.git" \
  "${liveportrait_revision}"

stage_repository \
  "Ditto" \
  "https://github.com/antgroup/ditto-talkinghead.git" \
  "${ditto_revision}"

cat <<'EOF'
Source staging complete. No model weights, Python environments, systemd units,
Cloudflare routes, or production renderer settings were changed.
EOF
