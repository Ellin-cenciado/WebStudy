#!/usr/bin/env bash
# One-command WebStudy setup. Safe to re-run.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

WITH_MOBILE=0
WITH_DESKTOP=0
SKIP_FRONTEND=0
SKIP_AI=0
AI_AUTO=0
RESET_AI=0
PROVIDER=""
MODEL=""
BASE_URL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --yes|-y) export WEBSTUDY_ASSUME_YES=1 ;;
    --with-mobile) WITH_MOBILE=1 ;;
    --with-desktop) WITH_DESKTOP=1 ;;
    --no-frontend) SKIP_FRONTEND=1 ;;
    --skip-ai) SKIP_AI=1 ;;
    --auto-ai) AI_AUTO=1 ;;
    --reset-ai) RESET_AI=1 ;;
    --provider) shift; PROVIDER="${1:?--provider requires a value}" ;;
    --model) shift; MODEL="${1:?--model requires a value}" ;;
    --base-url) shift; BASE_URL="${1:?--base-url requires a value}" ;;
    -h|--help)
      cat <<EOF
Usage: $0 [options]

  --yes, -y          Accept defaults; useful for automation.
  --with-mobile      Build the Android release APK too.
  --with-desktop     Install desktop dependencies too.
  --no-frontend      Skip the frontend install/build.
  --skip-ai          Do not configure Study Prep.
  --auto-ai          Choose the best available AI provider automatically.
  --provider NAME    ollama | lmstudio | opencode | openai | skip
  --model NAME       Model name for the selected provider.
  --base-url URL     Base URL for an OpenAI-compatible or remote OpenCode service.
  --reset-ai         Clear the existing AI configuration first.
EOF
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

header "WebStudy setup"
cat <<EOF
This will:
  1. Create/update the Python environment
  2. Install and build the frontend
  3. Configure Study Prep AI (optional, interactive)
  4. Optionally build the Android APK

Configuration is stored outside the repository:
  $ENV_FILE
EOF

if [ "$(uname -s)" != "Linux" ]; then
  warn "WebStudy currently targets Linux. Other platforms may work but are not supported."
fi

info "Step 1/4: backend"
backend_args=()
[ "$WITH_DESKTOP" = "1" ] && backend_args+=(--with-desktop)
"$SCRIPT_DIR/setup-backend.sh" "${backend_args[@]}"

if [ "$SKIP_FRONTEND" = "0" ]; then
  info "Step 2/4: frontend"
  "$SCRIPT_DIR/setup-frontend.sh"
else
  warn "Skipping the frontend"
fi

ai_ok=1
if [ "$SKIP_AI" = "0" ]; then
  info "Step 3/4: Study Prep AI"
  ai_args=()
  [ -n "$PROVIDER" ] && ai_args+=(--provider "$PROVIDER")
  [ -n "$MODEL" ] && ai_args+=(--model "$MODEL")
  [ -n "$BASE_URL" ] && ai_args+=(--base-url "$BASE_URL")
  [ "$AI_AUTO" = "1" ] && ai_args+=(--auto)
  [ "$RESET_AI" = "1" ] && ai_args+=(--reset)
  if [ "${WEBSTUDY_ASSUME_YES:-0}" = "1" ] && [ -z "$PROVIDER" ] && [ "$AI_AUTO" = "0" ]; then
    ai_args+=(--auto)
  fi
  if ! "$SCRIPT_DIR/setup-ai.sh" "${ai_args[@]}"; then
    ai_ok=0
    warn "Study Prep AI was not configured. You can rerun: ./scripts/setup-ai.sh"
  elif [ -z "$(env_get WEBSTUDY_LLM_PROVIDER)" ]; then
    ai_ok=0
    warn "Study Prep AI was skipped. Enable it later with ./scripts/setup-ai.sh"
  fi
else
  ai_ok=0
  warn "Skipping Study Prep AI configuration"
fi

if [ "$WITH_MOBILE" = "1" ]; then
  info "Step 4/4: Android"
  "$SCRIPT_DIR/setup-mobile.sh"
elif [ "${WEBSTUDY_ASSUME_YES:-0}" != "1" ]; then
  if confirm "Build the Android release APK now?" n; then
    info "Step 4/4: Android"
    "$SCRIPT_DIR/setup-mobile.sh"
  fi
else
  info "Skipping Android (use --with-mobile to include it)"
fi

printf '\n'
header "Setup complete"
cat <<EOF
Start the web app:
  ./scripts/start.sh

Use it from a phone on the same Wi-Fi:
  ./scripts/start.sh --lan

Rebuild the Android APK:
  ./scripts/setup-mobile.sh --install

Check the installation or a provider problem:
  ./scripts/doctor.sh

Run it automatically at login (systemd user service):
  ./scripts/install-service.sh
  ./scripts/install-service.sh --lan   # for phone access

EOF

if [ "$ai_ok" = "0" ]; then
  warn "Study Prep will show a configuration warning until ./scripts/setup-ai.sh succeeds."
fi
