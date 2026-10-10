#!/bin/bash
# Installs pastor's general agent on the hub's machine (the VPS): dependencies,
# a device token and a systemd user service; WhatsApp is linked from the app (QR). Safe to run again.
set -euo pipefail
DIR="$HOME/pastor/agent"
H="${PASTOR_AGENT_HOME:-$HOME/pastor-agent}"
mkdir -p "$H/whatsapp" "$H/canales" "$H/uploads"
cd "$DIR" && npm install --omit=dev --no-audit --no-fund
PASTOR_AGENT_HOME="$H" node "$DIR/src/setup.mjs"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/pastor-agent.service" <<EOF
[Unit]
Description=pastor agent (WhatsApp + control del hub)
After=pastor-hub.service

[Service]
Environment=PASTOR_AGENT_HOME=$H
ExecStart=$(command -v node) $DIR/src/main.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
systemctl --user daemon-reload
systemctl --user enable --now pastor-agent.service
sleep 3
systemctl --user is-active pastor-agent.service
