#!/usr/bin/env bash
set -euo pipefail

echo_root="${ECHO_ROOT:-/home/user/echo}"
token_file="${ECHO_CLOUDFLARED_TOKEN_FILE:-${echo_root}/secrets/cloudflared.token}"
cloudflared_bin="${CLOUDFLARED_BIN:-${echo_root}/bin/cloudflared}"

if [[ ! -x "${cloudflared_bin}" ]]; then
  echo "cloudflared is unavailable: ${cloudflared_bin}" >&2
  exit 1
fi
if [[ ! -r "${token_file}" || ! -s "${token_file}" ]]; then
  echo "Cloudflare tunnel token is unavailable: ${token_file}" >&2
  exit 1
fi

# Keep the connector credential out of process arguments and logs. cloudflared
# reads TUNNEL_TOKEN directly; the file itself remains mode 0600.
TUNNEL_TOKEN="$(<"${token_file}")"
export TUNNEL_TOKEN
exec "${cloudflared_bin}" tunnel --no-autoupdate run
