#!/usr/bin/env bash
# Back up the existing SimpleStudy XDG data before running WebStudy against it.
# This script only reads the source directories and writes a tarball; it never
# modifies or deletes the originals.
set -euo pipefail

config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
state_home="${XDG_STATE_HOME:-$HOME/.local/state}"
source_config="$config_home/simplestudy"
source_state="$state_home/simplestudy"
destination="${1:-$HOME/webstudy-backups}"

if [[ ! -d "$source_config" && ! -d "$source_state" ]]; then
  echo "No SimpleStudy config or state directory found." >&2
  echo "Looked in: $source_config and $source_state" >&2
  exit 1
fi

mkdir -p "$destination"
timestamp="$(date +%Y%m%d-%H%M%S)"
archive="$destination/simplestudy-$timestamp.tar.gz"

paths=()
[[ -d "$source_config" ]] && paths+=("$source_config")
[[ -d "$source_state" ]] && paths+=("$source_state")

tar -czf "$archive" -C / "${paths[@]#/}"
echo "Wrote $archive"
echo "Original data was not modified."
