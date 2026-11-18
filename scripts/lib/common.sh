#!/usr/bin/env bash
# Shared helpers for the WebStudy setup and maintenance scripts.
# shellcheck shell=bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
MOBILE_DIR="$ROOT_DIR/mobile"
ANDROID_DIR="$MOBILE_DIR/android"

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
APP_CONFIG_DIR="${WEBSTUDY_CONFIG_DIR:-$CONFIG_HOME/simplestudy}"
ENV_FILE="${WEBSTUDY_ENV_FILE:-$APP_CONFIG_DIR/webstudy.env}"

if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  RED=$'\033[31m'
  GREEN=$'\033[32m'
  YELLOW=$'\033[33m'
  BLUE=$'\033[34m'
  RESET=$'\033[0m'
else
  BOLD="" DIM="" RED="" GREEN="" YELLOW="" BLUE="" RESET=""
fi

info() { printf '%s\n' "${BLUE}==>${RESET} $*"; }
ok() { printf '%s\n' "${GREEN}✓${RESET} $*"; }
warn() { printf '%s\n' "${YELLOW}!${RESET} $*" >&2; }
error() { printf '%s\n' "${RED}✗${RESET} $*" >&2; }
die() {
  error "$*"
  exit 1
}

header() {
  printf '\n%s\n' "${BOLD}$*${RESET}"
}

# ask PROMPT [DEFAULT] -> REPLY
ask() {
  local prompt="$1" default="${2-}" answer=""
  if [ "${WEBSTUDY_ASSUME_YES:-0}" = "1" ] && [ -n "$default" ]; then
    REPLY="$default"
    return 0
  fi
  if [ -n "$default" ]; then
    printf '%s [%s] ' "$prompt" "$default"
  else
    printf '%s ' "$prompt"
  fi
  IFS= read -r answer || answer=""
  REPLY="${answer:-$default}"
}

# ask_secret PROMPT -> REPLY (input is not echoed)
ask_secret() {
  local prompt="$1" answer=""
  if [ "${WEBSTUDY_ASSUME_YES:-0}" = "1" ]; then
    REPLY=""
    return 0
  fi
  printf '%s ' "$prompt"
  IFS= read -rs answer || answer=""
  printf '\n'
  REPLY="$answer"
}

# ask_int PROMPT DEFAULT [MIN] [MAX] -> REPLY
ask_int() {
  local prompt="$1" default="$2" min="${3:-1}" max="${4:-1000000}" value=""
  while true; do
    ask "$prompt" "$default"
    value="$REPLY"
    if [[ "$value" =~ ^[0-9]+$ ]] && [ "$value" -ge "$min" ] && [ "$value" -le "$max" ]; then
      return 0
    fi
    warn "Enter a whole number between $min and $max."
    if [ "${WEBSTUDY_ASSUME_YES:-0}" = "1" ]; then
      REPLY="$default"
      return 0
    fi
  done
}

# confirm PROMPT [y|n] -> exit status 0 for yes
confirm() {
  local prompt="$1" default="${2:-y}" answer=""
  if [ "${WEBSTUDY_ASSUME_YES:-0}" = "1" ]; then
    [ "$default" = "y" ]
    return
  fi
  printf '%s [%s/%s] ' "$prompt" \
    "$([ "$default" = "y" ] && printf 'Y' || printf 'y')" \
    "$([ "$default" = "y" ] && printf 'n' || printf 'N')"
  IFS= read -r answer || answer=""
  answer="${answer:-$default}"
  case "$answer" in
    y|Y|yes|YES|s|S|si|sí|SI|SÍ) return 0 ;;
    *) return 1 ;;
  esac
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

version_ge() {
  # version_ge CURRENT REQUIRED
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]
}

detect_lan_ip() {
  local ip=""
  if need_cmd ip; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
  fi
  if [ -z "$ip" ] && need_cmd hostname; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "$ip"
}

port_in_use() {
  local port="$1"
  if need_cmd ss; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"
  else
    return 1
  fi
}

# env_quote VALUE -> safe double-quoted shell/Python-compatible value
env_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\$}"
  value="${value//\`/\\\`}"
  printf '"%s"' "$value"
}

env_get() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  local line
  line="$(grep -E "^${key}=" "$ENV_FILE" | tail -n1 || true)"
  [ -n "$line" ] || return 0
  line="${line#*=}"
  line="${line#\"}"
  line="${line%\"}"
  line="${line#\'}"
  line="${line%\'}"
  printf '%s' "$line"
}

env_set() {
  local key="$1" value="$2" tmp
  mkdir -p "$(dirname "$ENV_FILE")"
  chmod 700 "$(dirname "$ENV_FILE")" 2>/dev/null || true
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  if [ -f "$ENV_FILE" ]; then
    grep -vE "^${key}=" "$ENV_FILE" >"$tmp" || true
  fi
  printf '%s=%s\n' "$key" "$(env_quote "$value")" >>"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

env_unset() {
  local key="$1" tmp
  [ -f "$ENV_FILE" ] || return 0
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  grep -vE "^${key}=" "$ENV_FILE" >"$tmp" || true
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
}

backup_env_file() {
  [ -f "$ENV_FILE" ] || return 0
  local backup="${ENV_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
  cp -p "$ENV_FILE" "$backup"
  ok "Backed up existing AI configuration to $backup"
}

venv_python() {
  printf '%s' "$ROOT_DIR/.venv/bin/python"
}

require_venv() {
  [ -x "$(venv_python)" ] || die "Python venv not found. Run ./scripts/setup-backend.sh first."
}

have_venv() {
  [ -x "$(venv_python)" ]
}

run_backend_tests() {
  require_venv
  (cd "$ROOT_DIR" && PYTHONPATH=backend "$(venv_python)" -m unittest discover -s backend/tests -t backend)
}
