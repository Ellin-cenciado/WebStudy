#!/usr/bin/env bash
# Install WebStudy as a systemd user service.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

LAN=0
NO_START=0

while [ $# -gt 0 ]; do
  case "$1" in
    --lan) LAN=1 ;;
    --no-start) NO_START=1 ;;
    --uninstall)
      systemctl --user disable --now webstudy.service 2>/dev/null || true
      rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/webstudy.service"
      systemctl --user daemon-reload 2>/dev/null || true
      ok "Removed the WebStudy user service"
      exit 0
      ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--lan] [--no-start] [--uninstall]

  --lan       Bind 0.0.0.0 so phones on the LAN can reach the backend.
  --no-start  Enable the service but do not start it now.
  --uninstall Remove the user service.
EOF
      exit 0
      ;;
    *) die "Unknown option: $1" ;;
  esac
  shift
done

require_venv
need_cmd systemctl || die "systemd is required for this script."

HOST="127.0.0.1"
[ "$LAN" = "1" ] && HOST="0.0.0.0"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
UNIT="$UNIT_DIR/webstudy.service"
mkdir -p "$UNIT_DIR"

cat >"$UNIT" <<EOF
[Unit]
Description=WebStudy study tracker backend
Documentation=file://$ROOT_DIR/README.md
After=default.target

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
Environment=WEBSTUDY_HOST=$HOST
Environment=WEBSTUDY_PORT=8000
EnvironmentFile=-$ENV_FILE
ExecStart=$ROOT_DIR/.venv/bin/webstudy
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable webstudy.service
if [ "$NO_START" = "0" ]; then
  systemctl --user restart webstudy.service
fi

ok "Installed $UNIT"
if [ "$LAN" = "1" ]; then
  lan_ip="$(detect_lan_ip)"
  [ -n "$lan_ip" ] && info "LAN: http://$lan_ip:8000"
  warn "The backend has no authentication. Use LAN mode only on a trusted network."
else
  info "Local: http://127.0.0.1:8000"
fi
echo
echo "Inspect it with:"
echo "  systemctl --user status webstudy.service"
echo "  journalctl --user -u webstudy.service -f"
