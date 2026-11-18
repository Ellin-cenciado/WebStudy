#!/usr/bin/env bash
# Diagnose the local WebStudy setup and AI provider connectivity.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

STRICT=0
DEEP=0
for arg in "$@"; do
  case "$arg" in
    --strict) STRICT=1 ;;
    --deep) DEEP=1 ;;
    -h|--help)
      echo "Usage: $0 [--strict] [--deep]"
      echo "  --strict  Exit non-zero when a problem is found."
      echo "  --deep    Also send a tiny completion to the configured model."
      exit 0
      ;;
    *) die "Unknown option: $arg" ;;
  esac
done

ISSUES=0
problem() {
  ISSUES=$((ISSUES + 1))
  warn "$*"
}

json_models() {
  # Read one of: {"data":[{"id":...}]}, {"models":[{"name":...}]}
  python3 -c '
import json, sys
data = json.load(sys.stdin)
items = data.get("data") or data.get("models") or []
for item in items:
    value = item.get("id") or item.get("name") or item.get("model")
    if value:
        print(value)
' 2>/dev/null || true
}

header "Versions"
if need_cmd python3; then
  ok "Python $(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
else
  problem "python3 is missing"
fi
if [ -x "$(venv_python)" ]; then
  ok "Virtualenv $(venv_python) ($("$(venv_python)" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))'))"
else
  problem "No .venv. Run ./scripts/setup-backend.sh"
fi
if need_cmd node; then
  ok "Node.js $(node -v)"
else
  problem "Node.js is missing"
fi
if need_cmd npm; then
  ok "npm $(npm -v)"
else
  problem "npm is missing"
fi
if need_cmd java; then
  ok "Java $(java -version 2>&1 | head -n1)"
else
  warn "Java is missing; the Android build will not work"
fi

header "Application"
[ -f "$FRONTEND_DIR/dist/index.html" ] && ok "Frontend build present" || problem "frontend/dist is missing. Run ./scripts/setup-frontend.sh"
if need_cmd curl; then
  health="$(curl -fsS --max-time 3 http://127.0.0.1:8000/api/health 2>/dev/null || true)"
  if [ -n "$health" ]; then
    ok "Backend is running: $health"
    prep="$(curl -fsS --max-time 3 http://127.0.0.1:8000/api/study-prep/config 2>/dev/null || true)"
    if [ -n "$prep" ]; then
      printf '   %s\n' "$(printf '%s' "$prep" | python3 -c '
import json, sys
d = json.load(sys.stdin)
print(f"Study Prep: configured={d.get(\"configured\")} provider={d.get(\"provider\") or \"-\"} model={d.get(\"model\") or d.get(\"agent\") or \"-\"}")
' 2>/dev/null || printf '%s' "$prep")"
    fi
  else
    warn "Backend is not running on 127.0.0.1:8000"
  fi
else
  problem "curl is missing"
fi

header "AI configuration"
if [ -f "$ENV_FILE" ]; then
  env_mode="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
  if [ "$env_mode" = "600" ]; then
    ok "Env file: $ENV_FILE (600)"
  else
    problem "Env file permissions are $env_mode; run: chmod 600 $ENV_FILE"
  fi
  provider="$(env_get WEBSTUDY_LLM_PROVIDER)"
  model="$(env_get WEBSTUDY_LLM_MODEL)"
  if [ "$provider" = "opencode" ]; then
    model="$(env_get WEBSTUDY_OPENCODE_MODEL)"
    agent="$(env_get WEBSTUDY_OPENCODE_AGENT)"
    echo "   provider=opencode agent=${agent:-study-prep} model=${model:-(agent default)}"
  else
    echo "   provider=${provider:-auto} model=${model:-(none)} base=$(env_get WEBSTUDY_LLM_BASE_URL)"
  fi
  api_key="$(env_get WEBSTUDY_LLM_API_KEY)"
  [ -n "$api_key" ] && echo "   API key: (set)"
else
  warn "No env file at $ENV_FILE. Run ./scripts/setup-ai.sh to configure Study Prep."
fi

if [ -z "$provider" ]; then
  header "Local AI services"
  if curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    ok "Ollama is running on 127.0.0.1:11434"
  else
    info "Ollama is not running"
  fi
  if curl -fsS --max-time 2 http://127.0.0.1:1234/v1/models >/dev/null 2>&1; then
    ok "LM Studio is running on 127.0.0.1:1234"
  else
    info "LM Studio is not running"
  fi
  if need_cmd opencode; then
    opencode_url="$(opencode service status 2>/dev/null | grep -oE 'https?://[^[:space:]]+' | head -n1 || true)"
    [ -n "$opencode_url" ] && ok "OpenCode service: $opencode_url" || info "OpenCode is installed but its service is not running"
  else
    info "OpenCode is not installed"
  fi
fi

provider="$(env_get WEBSTUDY_LLM_PROVIDER)"
case "$provider" in
  ollama)
    if curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      ok "Ollama is reachable"
      models="$(curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags | json_models)"
      echo "   Models: ${models//$'\n'/, }"
      model="$(env_get WEBSTUDY_LLM_MODEL)"
      if [ -n "$model" ] && ! printf '%s\n' "$models" | grep -Fxq "$model"; then
        problem "Configured model '$model' is not installed in Ollama"
      fi
      if [ "$DEEP" = "1" ] && [ -n "$model" ]; then
        info "Sending a test prompt to $model..."
        response="$(curl -fsS --max-time 120 http://127.0.0.1:11434/v1/chat/completions \
          -H 'Content-Type: application/json' \
          -d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with {\\\"ok\\\":true} only.\"}],\"max_tokens\":64,\"temperature\":0}" 2>&1 || true)"
        if printf '%s' "$response" | grep -q '"content"'; then
          ok "Model answered"
        else
          problem "Model did not answer correctly: ${response:0:300}"
        fi
      fi
    else
      problem "Ollama is not reachable on 127.0.0.1:11434"
    fi
    ;;
  openai-compatible)
    base_url="$(env_get WEBSTUDY_LLM_BASE_URL)"
    api_key="$(env_get WEBSTUDY_LLM_API_KEY)"
    if [[ "$base_url" == *:1234* ]]; then
      if curl -fsS --max-time 3 http://127.0.0.1:1234/v1/models >/dev/null 2>&1; then
        ok "LM Studio is reachable on 127.0.0.1:1234"
      else
        problem "LM Studio is configured but not reachable on 127.0.0.1:1234"
      fi
    elif [ -n "$base_url" ]; then
      if curl -fsS --max-time 5 -H "Authorization: Bearer $api_key" "$base_url/models" >/dev/null 2>&1; then
        ok "Remote endpoint is reachable: $base_url"
      else
        problem "Could not reach $base_url/models with the saved credentials"
      fi
    else
      problem "WEBSTUDY_LLM_BASE_URL is empty"
    fi
    ;;
  opencode)
    if ! need_cmd opencode; then
      problem "opencode is not on PATH"
    else
      opencode_version="$(opencode --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
      if [ -n "$opencode_version" ] && version_ge "$opencode_version" "2.0"; then
        ok "OpenCode $opencode_version"
      else
        problem "OpenCode V2 is required (found '${opencode_version:-unknown}')"
      fi
      service_url="$(opencode service status 2>/dev/null | grep -oE 'https?://[^[:space:]]+' | head -n1 || true)"
      if [ -z "$service_url" ]; then
        problem "OpenCode service is not running. Run: opencode service start"
      else
        ok "OpenCode service: $service_url"
        password="$(python3 -c '
import json, os, pathlib
base = pathlib.Path(os.environ.get("XDG_CONFIG_HOME") or pathlib.Path.home() / ".config")
path = base / "opencode" / "service.json"
try:
    print(json.loads(path.read_text()).get("password", ""))
except Exception:
    pass
' 2>/dev/null || true)"
        if [ -n "$password" ] && curl -fsS --max-time 5 -u "opencode:$password" "$service_url/api/info" >/dev/null 2>&1; then
          ok "OpenCode service accepted the local password"
        else
          problem "Could not authenticate to OpenCode. Check ~/.config/opencode/service.json"
        fi
      fi
    fi
    ;;
  ""|lm-studio|lmstudio)
    if curl -fsS --max-time 3 http://127.0.0.1:1234/v1/models >/dev/null 2>&1; then
      ok "LM Studio is reachable on 127.0.0.1:1234"
      models="$(curl -fsS --max-time 3 http://127.0.0.1:1234/v1/models | json_models)"
      echo "   Models: ${models//$'\n'/, }"
    elif [ "$provider" = "lm-studio" ] || [ "$provider" = "lmstudio" ]; then
      problem "LM Studio is configured but not reachable on 127.0.0.1:1234"
    fi
    ;;
  *)
    warn "Unknown provider '$provider'"
    ;;
esac

header "Network"
lan_ip="$(detect_lan_ip)"
[ -n "$lan_ip" ] && ok "LAN address: $lan_ip" || warn "Could not detect a LAN address"
if port_in_use 8000; then
  ok "Port 8000 is in use (backend or another process)"
else
  info "Port 8000 is free (backend not running)"
fi
if port_in_use 5173; then
  ok "Port 5173 is in use (Vite dev server)"
fi

header "Android"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] && [ -f "$ANDROID_DIR/local.properties" ]; then
  SDK="$(sed -n 's/^sdk.dir=//p' "$ANDROID_DIR/local.properties" | head -n1)"
fi
if [ -n "$SDK" ] && [ -d "$SDK" ]; then
  ok "Android SDK: $SDK"
else
  warn "Android SDK not found (set ANDROID_HOME or sdk.dir in mobile/android/local.properties)"
fi
if need_cmd adb; then
  devices="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}' | tr '\n' ' ' || true)"
  [ -n "$devices" ] && ok "ADB devices: $devices" || warn "No ADB device connected"
fi

printf '\n'
if [ "$ISSUES" -gt 0 ]; then
  warn "$ISSUES problem(s) found. See the messages above."
  [ "$STRICT" = "1" ] && exit 1
else
  ok "No problems detected"
  if ! curl -fsS --max-time 2 http://127.0.0.1:8000/api/health >/dev/null 2>&1; then
    echo "  Start the backend with: ./scripts/start.sh"
  fi
fi
