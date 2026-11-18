#!/usr/bin/env bash
# Configure the Study Prep model provider and write ~/.config/simplestudy/webstudy.env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

PROVIDER=""
MODEL=""
BASE_URL=""
API_KEY=""
CONTEXT_TOKENS=""
MAX_OUTPUT_TOKENS=""
AUTO=0
RESET_AI=0

while [ $# -gt 0 ]; do
  case "$1" in
    --provider) shift; PROVIDER="${1:?--provider requires a value}" ;;
    --model) shift; MODEL="${1:?--model requires a value}" ;;
    --base-url) shift; BASE_URL="${1:?--base-url requires a value}" ;;
    --api-key) shift; API_KEY="${1:?--api-key requires a value}" ;;
    --context-tokens) shift; CONTEXT_TOKENS="${1:?--context-tokens requires a value}" ;;
    --max-output-tokens) shift; MAX_OUTPUT_TOKENS="${1:?--max-output-tokens requires a value}" ;;
    --auto) AUTO=1 ;;
    --reset) RESET_AI=1 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [options]

  --provider NAME        ollama | lmstudio | opencode | openai | skip
  --model NAME           Model name (provider-specific)
  --base-url URL         OpenAI-compatible or remote OpenCode service URL
  --api-key KEY          Remote API key. Prefer the hidden prompt instead.
  --context-tokens N     Prompt context budget (default depends on provider)
  --max-output-tokens N  Maximum generation per request
  --auto                 Choose the best available provider without prompting
  --reset                Clear existing AI settings before configuring
EOF
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

AI_KEYS=(
  WEBSTUDY_LLM_PROVIDER
  WEBSTUDY_LLM_MODEL
  WEBSTUDY_LLM_BASE_URL
  WEBSTUDY_LLM_API_KEY
  WEBSTUDY_LLM_CONTEXT_TOKENS
  WEBSTUDY_LLM_MAX_OUTPUT_TOKENS
  WEBSTUDY_LLM_REASONING_EFFORT
  WEBSTUDY_OPENCODE_AGENT
  WEBSTUDY_OPENCODE_MODEL
  WEBSTUDY_OPENCODE_BASE_URL
  WEBSTUDY_OPENCODE_PASSWORD
  WEBSTUDY_OPENCODE_LOCATION
  WEBSTUDY_OPENCODE_TIMEOUT_SECONDS
)

clear_ai_keys() {
  local key
  for key in "${AI_KEYS[@]}"; do
    env_unset "$key"
  done
}

ollama_models() {
  curl -fsS --max-time 3 http://127.0.0.1:11434/api/tags 2>/dev/null |
    python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data.get("models", []):
    name = item.get("name") or item.get("model")
    if name:
        print(name)
' 2>/dev/null || true
}

lmstudio_models() {
  curl -fsS --max-time 3 http://127.0.0.1:1234/v1/models 2>/dev/null |
    python3 -c '
import json, sys
data = json.load(sys.stdin)
for item in data.get("data", []):
    name = item.get("id")
    if name:
        print(name)
' 2>/dev/null || true
}

test_chat() {
  local base_url="$1" api_key="$2" model="$3" label="$4"
  local body response http_code
  local -a auth=()
  [ -n "$base_url" ] || { warn "No base URL for $label"; return 1; }
  base_url="${base_url%/}"
  [ -n "$api_key" ] && auth=(-H "Authorization: Bearer $api_key")
  body="$(python3 - "$model" <<'PY'
import json, sys
model = sys.argv[1]
print(json.dumps({
    "model": model,
    "messages": [
        {"role": "system", "content": "Return one valid JSON object only."},
        {"role": "user", "content": "Return {\"ok\":true} as JSON."},
    ],
    "temperature": 0,
    "max_tokens": 64,
    "stream": False,
}))
PY
)"
  response="$(mktemp)"
  http_code="$(curl -sS --max-time 120 -o "$response" -w '%{http_code}' \
    -H 'Content-Type: application/json' \
    "${auth[@]}" \
    -d "$body" "$base_url/chat/completions" 2>/dev/null || true)"
  if [ "$http_code" = "200" ] && python3 - "$response" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    choice = data["choices"][0]["message"]
    if not (choice.get("content") or choice.get("reasoning_content")):
        raise SystemExit(1)
except Exception:
    raise SystemExit(1)
PY
  then
    rm -f "$response"
    ok "$label answered a test prompt"
    return 0
  fi
  warn "$label test failed${http_code:+ (HTTP $http_code)}:"
  head -c 500 "$response" 2>/dev/null || true
  echo
  rm -f "$response"
  return 1
}

save_common() {
  local provider="$1" model="$2" base_url="$3" api_key="$4" context="$5" output="$6" reasoning="$7"
  env_set WEBSTUDY_LLM_PROVIDER "$provider"
  env_set WEBSTUDY_LLM_MODEL "$model"
  env_set WEBSTUDY_LLM_BASE_URL "$base_url"
  env_set WEBSTUDY_LLM_CONTEXT_TOKENS "$context"
  env_set WEBSTUDY_LLM_MAX_OUTPUT_TOKENS "$output"
  if [ -n "$reasoning" ]; then
    env_set WEBSTUDY_LLM_REASONING_EFFORT "$reasoning"
  else
    env_unset WEBSTUDY_LLM_REASONING_EFFORT
  fi
  if [ -n "$api_key" ]; then
    env_set WEBSTUDY_LLM_API_KEY "$api_key"
  else
    env_unset WEBSTUDY_LLM_API_KEY
  fi
}

clear_opencode() {
  env_unset WEBSTUDY_OPENCODE_AGENT
  env_unset WEBSTUDY_OPENCODE_MODEL
  env_unset WEBSTUDY_OPENCODE_BASE_URL
  env_unset WEBSTUDY_OPENCODE_PASSWORD
  env_unset WEBSTUDY_OPENCODE_LOCATION
  env_unset WEBSTUDY_OPENCODE_TIMEOUT_SECONDS
}

header "Study Prep AI configuration"

need_cmd curl || die "curl is required for provider checks."
need_cmd python3 || die "python3 is required for provider checks."

if [ "$RESET_AI" = "1" ]; then
  backup_env_file
  clear_ai_keys
  ok "Cleared existing AI configuration"
fi

# Detect what is available before showing the menu.
ollama_up=0
curl -fsS --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && ollama_up=1
lmstudio_up=0
curl -fsS --max-time 2 http://127.0.0.1:1234/v1/models >/dev/null 2>&1 && lmstudio_up=1
opencode_up=0
opencode_service_url=""
if need_cmd opencode; then
  opencode_service_url="$(opencode service status 2>/dev/null | grep -oE 'https?://[^[:space:]]+' | head -n1 || true)"
  [ -n "$opencode_service_url" ] && opencode_up=1
fi

existing_provider="$(env_get WEBSTUDY_LLM_PROVIDER)"
existing_base="$(env_get WEBSTUDY_LLM_BASE_URL)"
if [ "$existing_provider" = "openai-compatible" ] && [[ "$existing_base" == *:1234* ]]; then
  # Older setup runs labelled LM Studio as generic OpenAI-compatible.
  existing_provider="lmstudio"
fi
if [ -z "$PROVIDER" ] && [ "$AUTO" = "1" ]; then
  if [ -n "$existing_provider" ] && [ "$existing_provider" != "skip" ]; then
    case "$existing_provider" in
      ollama)
        [ "$ollama_up" = "1" ] && PROVIDER="$existing_provider"
        ;;
      lmstudio)
        [ "$lmstudio_up" = "1" ] && PROVIDER="$existing_provider"
        ;;
      opencode)
        [ "$opencode_up" = "1" ] && PROVIDER="$existing_provider"
        ;;
      openai-compatible)
        # Keep a remote endpoint; only ignore a stopped local LM Studio.
        if [[ "$existing_base" != *:1234* ]] || [ "$lmstudio_up" = "1" ]; then
          PROVIDER="$existing_provider"
        fi
        ;;
      *)
        PROVIDER="$existing_provider"
        ;;
    esac
  fi
  if [ -z "$PROVIDER" ]; then
    if [ "$ollama_up" = "1" ] && [ -n "$(ollama_models)" ]; then
      PROVIDER="ollama"
    elif [ "$opencode_up" = "1" ]; then
      PROVIDER="opencode"
    elif [ "$lmstudio_up" = "1" ]; then
      PROVIDER="lmstudio"
    else
      PROVIDER="skip"
    fi
  fi
fi

if [ -z "$PROVIDER" ]; then
  default_choice="5"
  [ "$ollama_up" = "1" ] && default_choice="1"
  [ -z "$existing_provider" ] || default_choice="1"
  [ "$existing_provider" = "opencode" ] && default_choice="3"
  [ "$existing_provider" = "lmstudio" ] && default_choice="2"
  [ "$existing_provider" = "openai" ] && default_choice="4"
  [ "$existing_provider" = "openai-compatible" ] && default_choice="4"

  ollama_state=" (not detected)"
  [ "$ollama_up" = "1" ] && ollama_state=", detected running"
  lmstudio_state=" (not detected)"
  [ "$lmstudio_up" = "1" ] && lmstudio_state=", detected running"
  opencode_state=" (service not running)"
  [ "$opencode_up" = "1" ] && opencode_state=", service running"

  cat <<EOF
Choose how Study Prep should generate notes:

  1) Ollama        local, free${ollama_state}
  2) LM Studio     local, use its Developer Server${lmstudio_state}
  3) OpenCode      use your existing OpenCode V2 installation${opencode_state}
  4) Remote API    OpenAI-compatible endpoint and API key
  5) Skip          configure later with ./scripts/setup-ai.sh
EOF
  ask "Provider" "$default_choice"
  case "$REPLY" in
    1|ollama) PROVIDER="ollama" ;;
    2|lmstudio|lm-studio) PROVIDER="lmstudio" ;;
    3|opencode) PROVIDER="opencode" ;;
    4|openai|remote) PROVIDER="openai" ;;
    5|skip|"") PROVIDER="skip" ;;
    *) die "Unknown provider choice: $REPLY" ;;
  esac
fi

case "$PROVIDER" in
  ollama)
    header "Ollama"
    if [ "$ollama_up" != "1" ]; then
      warn "Ollama is not reachable on http://127.0.0.1:11434."
      echo "Start it with 'ollama serve' (or your Ollama service), then re-run this script."
      echo "Official install: https://ollama.com/download"
      exit 1
    fi
    models="$(ollama_models)"
    [ -n "$models" ] || die "No Ollama models are installed. Run: ollama pull <model>"
    echo "Installed models:"
    while IFS= read -r model_name; do
      [ -n "$model_name" ] && printf '  %s\n' "$model_name"
    done <<<"$models"
    model="${MODEL:-$(env_get WEBSTUDY_LLM_MODEL)}"
    if [ -z "$model" ]; then
      model="$(printf '%s\n' "$models" | head -n1)"
      ask "Model" "$model"
      model="$REPLY"
    fi
    if ! printf '%s\n' "$models" | grep -Fxq "$model"; then
      warn "Model '$model' is not installed."
      if confirm "Run 'ollama pull $model' now?" n; then
        ollama pull "$model"
      else
        die "Choose an installed model or pull it first."
      fi
    fi
    current_context="$(env_get WEBSTUDY_LLM_CONTEXT_TOKENS)"
    ask_int "Backend context tokens" "${CONTEXT_TOKENS:-${WEBSTUDY_LLM_CONTEXT_TOKENS:-${current_context:-4096}}}" 512 131072
    context="$REPLY"
    default_output="1500"
    [ "$context" -ge 8192 ] 2>/dev/null && default_output="2500"
    current_output="$(env_get WEBSTUDY_LLM_MAX_OUTPUT_TOKENS)"
    ask_int "Maximum output tokens" "${MAX_OUTPUT_TOKENS:-${WEBSTUDY_LLM_MAX_OUTPUT_TOKENS:-${current_output:-$default_output}}}" 128 16384
    output="$REPLY"
    base="${BASE_URL:-http://127.0.0.1:11434/v1}"
    test_chat "$base" "" "$model" "Ollama" || {
      confirm "Save this configuration anyway?" n || exit 1
    }
    clear_opencode
    save_common "ollama" "$model" "$base" "" "$context" "$output" "none"
    ;;

  lmstudio|lm-studio)
    header "LM Studio"
    if [ "$lmstudio_up" != "1" ]; then
      warn "LM Studio is not reachable on http://127.0.0.1:1234/v1."
      cat <<EOF
Open LM Studio → Developer → Start Server, load a model, then re-run this script.
The OpenAI-compatible server must stay running while Study Prep works.
EOF
      exit 1
    fi
    models="$(lmstudio_models)"
    [ -n "$models" ] || die "LM Studio has no models loaded. Load one and start the server."
    echo "Available models:"
    while IFS= read -r model_name; do
      [ -n "$model_name" ] && printf '  %s\n' "$model_name"
    done <<<"$models"
    model="${MODEL:-$(env_get WEBSTUDY_LLM_MODEL)}"
    if [ -z "$model" ]; then
      model="$(printf '%s\n' "$models" | head -n1)"
      ask "Model" "$model"
      model="$REPLY"
    fi
    current_context="$(env_get WEBSTUDY_LLM_CONTEXT_TOKENS)"
    ask_int "Model context length configured in LM Studio" "${CONTEXT_TOKENS:-${WEBSTUDY_LLM_CONTEXT_TOKENS:-${current_context:-8192}}}" 512 131072
    context="$REPLY"
    default_output="2000"
    [ "$context" -ge 16384 ] 2>/dev/null && default_output="2500"
    current_output="$(env_get WEBSTUDY_LLM_MAX_OUTPUT_TOKENS)"
    ask_int "Maximum output tokens" "${MAX_OUTPUT_TOKENS:-${WEBSTUDY_LLM_MAX_OUTPUT_TOKENS:-${current_output:-$default_output}}}" 128 16384
    output="$REPLY"
    base="${BASE_URL:-http://127.0.0.1:1234/v1}"
    test_chat "$base" "" "$model" "LM Studio" || {
      confirm "Save this configuration anyway?" n || exit 1
    }
    clear_opencode
    save_common "lmstudio" "$model" "$base" "" "$context" "$output" "none"
    ;;

  opencode)
    header "OpenCode"
    if [ -n "$BASE_URL" ]; then
      service_url="${BASE_URL%/}"
      ok "Using OpenCode service: $service_url"
    else
      need_cmd opencode || {
        cat <<EOF
OpenCode is not installed or not on PATH.

Install OpenCode from https://opencode.ai/docs, then run:
  opencode service start
  ./scripts/setup-ai.sh

For OpenCode on another machine, pass its URL:
  ./scripts/setup-ai.sh --provider opencode --base-url http://host:port

You can also choose Ollama or LM Studio instead. No API token is needed for
OpenCode: WebStudy uses the OpenCode V2 service and its own service password.
EOF
        exit 1
      }
      raw_version="$(opencode --version 2>/dev/null || true)"
      version="$(printf '%s' "$raw_version" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
      if [ -n "$version" ] && version_ge "$version" "2.0"; then
        ok "OpenCode $version"
      else
        die "OpenCode V2 is required (found '${raw_version:-unknown}'). Upgrade OpenCode and retry."
      fi

      service_url="$opencode_service_url"
      if [ -z "$service_url" ]; then
        warn "The OpenCode background service is not running."
        if confirm "Start it now with 'opencode service start'?" y; then
          opencode service start
          sleep 1
          service_url="$(opencode service status 2>/dev/null | grep -oE 'https?://[^[:space:]]+' | head -n1 || true)"
        fi
      fi
      [ -n "$service_url" ] || die "OpenCode service is still unavailable. Run 'opencode service start' and retry."
    fi

    password="${WEBSTUDY_OPENCODE_PASSWORD:-$(env_get WEBSTUDY_OPENCODE_PASSWORD)}"
    if [ -z "$password" ]; then
      password="$(python3 - <<'PY' 2>/dev/null || true
import json, os
from pathlib import Path
base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
path = base / "opencode" / "service.json"
try:
    print(json.loads(path.read_text(encoding="utf-8")).get("password", ""))
except Exception:
    pass
PY
)"
    fi
    if [ -z "$password" ]; then
      warn "Could not read the OpenCode service password from ~/.config/opencode/service.json."
      ask_secret "OpenCode service password:"
      password="$REPLY"
    fi
    [ -n "$password" ] || die "A service password is required."

    if curl -fsS --max-time 5 -u "opencode:$password" "$service_url/api/info" >/dev/null 2>&1; then
      ok "Connected to $service_url"
    elif [ "${WEBSTUDY_ASSUME_YES:-0}" != "1" ]; then
      warn "Authentication failed for $service_url."
      ask_secret "OpenCode service password:"
      password="$REPLY"
      if [ -n "$password" ] && curl -fsS --max-time 5 -u "opencode:$password" "$service_url/api/info" >/dev/null 2>&1; then
        ok "Connected to $service_url"
      else
        die "Could not authenticate to the OpenCode service at $service_url."
      fi
    else
      die "Could not authenticate to the OpenCode service at $service_url."
    fi

    models=()
    if need_cmd opencode; then
      mapfile -t models < <(opencode models 2>/dev/null || true)
    fi
    model="${MODEL:-${WEBSTUDY_OPENCODE_MODEL:-$(env_get WEBSTUDY_OPENCODE_MODEL)}}"
    if [ -z "$model" ]; then
      model="opencode-go/deepseek-v4.1-flash"
      printf '%s\n' "${models[@]}" | grep -Fxq "$model" || model="${models[0]:-}"
      if [ "${#models[@]}" -gt 0 ]; then
        echo "Available OpenCode models (first 40):"
        printf '  %s\n' "${models[@]:0:40}"
      fi
      ask "Model (blank uses the agent default)" "$model"
      model="$REPLY"
    fi
    agent="${WEBSTUDY_OPENCODE_AGENT:-$(env_get WEBSTUDY_OPENCODE_AGENT)}"
    [ -n "$agent" ] || agent="study-prep"

    clear_ai_keys
    env_set WEBSTUDY_LLM_PROVIDER "opencode"
    env_set WEBSTUDY_OPENCODE_AGENT "$agent"
    if [ -n "$model" ]; then
      env_set WEBSTUDY_OPENCODE_MODEL "$model"
    else
      env_unset WEBSTUDY_OPENCODE_MODEL
    fi
    # Auto-discovery is normally better because the service port can change.
    if [ -n "$BASE_URL" ]; then
      env_set WEBSTUDY_OPENCODE_BASE_URL "$BASE_URL"
      env_set WEBSTUDY_OPENCODE_PASSWORD "$password"
    fi
    ok "OpenCode configuration saved"
    ;;

  openai|remote|openai-compatible)
    header "Remote OpenAI-compatible API"
    ask "Base URL" "${BASE_URL:-${WEBSTUDY_LLM_BASE_URL:-https://api.openai.com/v1}}"
    base="$REPLY"
    ask "Model" "${MODEL:-$(env_get WEBSTUDY_LLM_MODEL)}"
    model="$REPLY"
    [ -n "$model" ] || die "A model name is required."
    existing_key="$(env_get WEBSTUDY_LLM_API_KEY)"
    [ -n "$API_KEY" ] && key="$API_KEY" || key="${WEBSTUDY_LLM_API_KEY:-$existing_key}"
    if [ -z "$key" ]; then
      ask_secret "API key:"
      key="$REPLY"
    elif [ "${WEBSTUDY_ASSUME_YES:-0}" != "1" ]; then
      ask_secret "API key (leave blank to keep the existing key):"
      [ -n "$REPLY" ] && key="$REPLY"
    fi
    [ -n "$key" ] || die "An API key is required for a remote provider."
    current_context="$(env_get WEBSTUDY_LLM_CONTEXT_TOKENS)"
    ask_int "Backend context tokens" "${CONTEXT_TOKENS:-${WEBSTUDY_LLM_CONTEXT_TOKENS:-${current_context:-16384}}}" 512 131072
    context="$REPLY"
    current_output="$(env_get WEBSTUDY_LLM_MAX_OUTPUT_TOKENS)"
    ask_int "Maximum output tokens" "${MAX_OUTPUT_TOKENS:-${WEBSTUDY_LLM_MAX_OUTPUT_TOKENS:-${current_output:-2500}}}" 128 16384
    output="$REPLY"
    warn "Source excerpts will be sent to $base. Do not use a remote provider for confidential material."
    test_chat "$base" "$key" "$model" "Remote provider" || {
      confirm "Save this configuration anyway?" n || exit 1
    }
    clear_opencode
    save_common "openai-compatible" "$model" "$base" "$key" "$context" "$output" ""
    ;;

  skip)
    warn "Study Prep will remain unavailable until you run ./scripts/setup-ai.sh."
    exit 0
    ;;

  *)
    die "Unknown provider: $PROVIDER"
    ;;
esac

chmod 600 "$ENV_FILE" 2>/dev/null || true
ok "AI configuration written to $ENV_FILE"
echo
echo "Restart the backend to pick it up:"
echo "  ./scripts/start.sh"
