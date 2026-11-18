#!/usr/bin/env bash
# Start the WebStudy backend with the configured AI environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

HOST="127.0.0.1"
PORT="${WEBSTUDY_PORT:-8000}"
LAN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --lan) LAN=1; HOST="0.0.0.0" ;;
    --host) shift; HOST="${1:?--host requires a value}" ;;
    --port) shift; PORT="${1:?--port requires a value}" ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--lan] [--host ADDRESS] [--port PORT]

  --lan    Bind 0.0.0.0 so phones on the LAN can reach the backend.
  --host   Bind a specific address (default 127.0.0.1).
  --port   Listen port (default 8000, or WEBSTUDY_PORT).
EOF
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

require_venv
[ -f "$FRONTEND_DIR/dist/index.html" ] || die "Frontend is not built. Run ./scripts/setup-frontend.sh first."
port_in_use "$PORT" && die "Port $PORT is already in use. Stop the other process or use --port."

if [ -f "$ENV_FILE" ]; then
  provider="$(env_get WEBSTUDY_LLM_PROVIDER)"
  model="$(env_get WEBSTUDY_LLM_MODEL)"
  [ "$provider" = "opencode" ] && model="$(env_get WEBSTUDY_OPENCODE_MODEL)"
  if [ -n "$provider" ]; then
    info "Study Prep: ${provider}${model:+ · $model}"
  fi
else
  warn "No AI configuration yet. Run ./scripts/setup-ai.sh to enable Study Prep."
fi

info "Backend: http://127.0.0.1:$PORT"
if [ "$LAN" = "1" ]; then
  lan_ip="$(detect_lan_ip)"
  if [ -n "$lan_ip" ]; then
    info "LAN:     http://$lan_ip:$PORT"
    warn "The backend has no authentication. Use --lan only on a trusted network."
  else
    warn "Could not detect a LAN address. Phones will not be able to connect."
  fi
fi

cd "$ROOT_DIR"
exec "$ROOT_DIR/.venv/bin/webstudy" --host "$HOST" --port "$PORT"
