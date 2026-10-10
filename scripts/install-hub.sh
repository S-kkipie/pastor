#!/bin/sh
# pastor hub: an always-on bridge (a VPS on your tailnet) that the phone pairs
# with; each PC's own bridge is linked to it. Run as a normal user, not root.
#   curl/gh the repo, then: sh scripts/install-hub.sh
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node || true)
[ -n "$NODE" ] || { echo "Falta node 18+ (p. ej. sudo apt install nodejs, o nvm)"; exit 1; }
"$NODE" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' || { echo "node demasiado viejo: $("$NODE" -v)"; exit 1; }

UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/pastor-hub.service" <<EOF
[Unit]
Description=pastor hub (bridge de Claude Code siempre encendido)
After=network-online.target tailscaled.service

[Service]
ExecStart=$NODE $DIR/bridge/bridge.mjs serve
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now pastor-hub.service
# keep it running with nobody logged in
loginctl enable-linger "$USER" 2>/dev/null || sudo loginctl enable-linger "$USER" || echo "aviso: ejecuta 'sudo loginctl enable-linger $USER' para que siga vivo sin sesión abierta"
sleep 1

PORT=$("$NODE" -e 'console.log(require(require("os").homedir()+"/.claude/pastor/config.json").port)')
if command -v tailscale >/dev/null; then
  tailscale serve --bg --https=443 "http://127.0.0.1:$PORT" 2>/dev/null \
    || tailscale serve --bg --http=80 "http://127.0.0.1:$PORT" 2>/dev/null \
    || sudo tailscale serve --bg --http=80 "http://127.0.0.1:$PORT" \
    || echo "aviso: publica el puerto $PORT con tailscale serve (o 'sudo tailscale set --operator=$USER' y vuelve a correr esto)"
  DNS=$(tailscale status --json 2>/dev/null | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{}})')
fi

echo
"$NODE" "$DIR/bridge/bridge.mjs" status
echo
[ -n "$DNS" ] && echo "Abre en el móvil: http://$DNS/"
echo "Enlaza cada PC (en la PC: /pastor serve y /pastor para ver su código; aquí):"
echo "  node $DIR/bridge/bridge.mjs link http://<pc>.<tu-tailnet>/ <código>"
