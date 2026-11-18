#!/usr/bin/env bash
# Create or update the Python environment used by the backend and desktop app.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

WITH_DESKTOP=0
for arg in "$@"; do
  case "$arg" in
    --with-desktop) WITH_DESKTOP=1 ;;
    -h|--help)
      echo "Usage: $0 [--with-desktop]"
      exit 0
      ;;
    *) die "Unknown option: $arg" ;;
  esac
done

header "Backend Python environment"

need_cmd python3 || die "python3 is required."
python_version="$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
version_ge "$python_version" "3.11" || die "Python 3.11+ is required (found $python_version)."
ok "Python $python_version"

if [ -x "$(venv_python)" ]; then
  ok "Reusing $ROOT_DIR/.venv"
  venv_version="$("$(venv_python)" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
  version_ge "$venv_version" "3.11" || die "The existing venv uses Python $venv_version. Remove .venv and rerun."
else
  info "Creating .venv"
  python3 -m venv "$ROOT_DIR/.venv"
fi

extras="dev"
[ "$WITH_DESKTOP" = "1" ] && extras="dev,desktop"

info "Installing backend (editable, extras: $extras)"
"$(venv_python)" -m pip install --quiet --upgrade pip
"$(venv_python)" -m pip install --quiet -e "$BACKEND_DIR[$extras]"

"$(venv_python)" -c "import webstudy; print(webstudy.__version__)" >/dev/null
ok "Backend installed"

if [ "$WITH_DESKTOP" = "1" ]; then
  need_cmd node || die "Node.js is required for the desktop app."
  need_cmd npm || die "npm is required for the desktop app."
  info "Installing desktop dependencies"
  (cd "$ROOT_DIR/desktop" && npm install)
  ok "Desktop dependencies installed"
fi
