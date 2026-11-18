#!/usr/bin/env bash
# Install frontend dependencies and build the assets served by the backend.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

DEPS_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --deps-only) DEPS_ONLY=1 ;;
    -h|--help)
      echo "Usage: $0 [--deps-only]"
      exit 0
      ;;
    *) die "Unknown option: $arg" ;;
  esac
done

header "Frontend"

need_cmd node || die "Node.js is required."
need_cmd npm || die "npm is required."
node_version="$(node -v | sed 's/^v//')"
version_ge "$node_version" "20.19" || die "Node.js 20.19+ is required (found $node_version)."
ok "Node.js $node_version"

cd "$FRONTEND_DIR"
if [ -f package-lock.json ]; then
  info "Installing frontend dependencies (npm ci)"
  npm ci
else
  info "Installing frontend dependencies (npm install)"
  npm install
fi

if [ "$DEPS_ONLY" = "0" ]; then
  info "Building frontend"
  npm run build
  [ -f "$FRONTEND_DIR/dist/index.html" ] || die "Frontend build did not produce dist/index.html."
  ok "Frontend built at frontend/dist"
else
  ok "Frontend dependencies installed"
fi
