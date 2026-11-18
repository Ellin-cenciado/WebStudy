#!/usr/bin/env bash
# Run the backend, frontend, and mobile checks.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

RUN_BACKEND=1
RUN_FRONTEND=1
RUN_MOBILE=1
BUILD_FRONTEND=1

for arg in "$@"; do
  case "$arg" in
    --backend-only) RUN_FRONTEND=0; RUN_MOBILE=0 ;;
    --frontend-only) RUN_BACKEND=0; RUN_MOBILE=0 ;;
    --mobile-only) RUN_BACKEND=0; RUN_FRONTEND=0 ;;
    --no-build) BUILD_FRONTEND=0 ;;
    -h|--help)
      echo "Usage: $0 [--backend-only|--frontend-only|--mobile-only] [--no-build]"
      exit 0
      ;;
    *) die "Unknown option: $arg" ;;
  esac
done

if [ "$RUN_BACKEND" = "1" ]; then
  header "Backend tests"
  run_backend_tests
  ok "Backend tests passed"
fi

if [ "$RUN_FRONTEND" = "1" ]; then
  header "Frontend checks"
  cd "$FRONTEND_DIR"
  npm test
  npm run lint
  if [ "$BUILD_FRONTEND" = "1" ]; then
    npm run build
  fi
  ok "Frontend checks passed"
fi

if [ "$RUN_MOBILE" = "1" ]; then
  header "Mobile checks"
  [ -d "$MOBILE_DIR/node_modules" ] || die "Mobile dependencies missing. Run ./scripts/setup-mobile.sh --deps-only."
  cd "$MOBILE_DIR"
  npx tsc --noEmit
  npm test -- --silent
  npm run lint
  ok "Mobile checks passed"
fi

printf '\n'
ok "All selected checks passed"
