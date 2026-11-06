#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
build_dir="$root/desktop/.build"
python="${WEBSTUDY_PYTHON:-$root/.venv/bin/python}"

if [[ ! -x "$python" ]]; then
  echo "Python virtualenv not found at $python" >&2
  echo "Create it first: python3 -m venv .venv && .venv/bin/pip install -e './backend[dev,desktop]'" >&2
  exit 1
fi

if ! "$python" -c 'import PyInstaller' >/dev/null 2>&1; then
  echo "PyInstaller is not installed for $python" >&2
  echo "Install the desktop build extra:" >&2
  echo "  $python -m pip install -e './backend[desktop]'" >&2
  exit 1
fi

cd "$root"
rm -rf "$build_dir/backend" "$build_dir/pyinstaller" "$build_dir/spec"

"$python" -m PyInstaller \
  --noconfirm \
  --clean \
  --onedir \
  --name webstudy \
  --distpath "$build_dir/backend" \
  --workpath "$build_dir/pyinstaller" \
  --specpath "$build_dir/spec" \
  --paths "$root/backend" \
  --collect-submodules webstudy \
  --collect-submodules uvicorn \
  --copy-metadata fastapi \
  --copy-metadata starlette \
  --copy-metadata uvicorn \
  "$root/desktop/backend_entry.py"

if [[ ! -x "$build_dir/backend/webstudy/webstudy" ]]; then
  echo "PyInstaller did not produce the expected backend executable." >&2
  exit 1
fi

echo
echo "Backend bundle: $build_dir/backend/webstudy"
