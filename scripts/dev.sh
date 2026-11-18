#!/usr/bin/env bash
# Run the backend with auto-reload and the Vite frontend together.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_venv
[ -d "$FRONTEND_DIR/node_modules" ] || die "Frontend dependencies missing. Run ./scripts/setup-frontend.sh --deps-only."
port_in_use 8000 && die "Port 8000 is already in use. Stop the other backend first."

backend_pid=""
frontend_pid=""
cleanup() {
  trap - EXIT INT TERM
  [ -n "$frontend_pid" ] && kill "$frontend_pid" 2>/dev/null || true
  [ -n "$backend_pid" ] && kill "$backend_pid" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

info "Backend:  http://127.0.0.1:8000  (auto-reload)"
info "Frontend: http://127.0.0.1:5173"
info "Press Ctrl-C to stop both."
printf '\n'

(cd "$ROOT_DIR" && PYTHONPATH=backend "$(venv_python)" -m uvicorn webstudy.main:app --reload --host 127.0.0.1 --port 8000) &
backend_pid=$!
(cd "$FRONTEND_DIR" && npm run dev) &
frontend_pid=$!

wait -n "$backend_pid" "$frontend_pid"
