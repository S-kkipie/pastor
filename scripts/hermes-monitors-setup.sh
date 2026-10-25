#!/usr/bin/env bash
# One-time wiring of pastor's "monitores" to Hermes. Run it ON THE HUB (the PC
# where Hermes's gateway lives — oracle83 in the deployed setup).
#
# It creates a signed Hermes webhook route and points the pastor hub at it. From
# then on, when a session you monitor finishes a turn, the hub POSTs that route
# and Hermes reacts. Add/remove monitors from Hermes with the pastor-hub tools
# monitor_add / monitor_remove (see the README, "Monitores").
set -euo pipefail

HERMES="${HERMES_BIN:-$HOME/.local/bin/hermes}"
BRIDGE="${PASTOR_BRIDGE:-$HOME/pastor/bridge/bridge.mjs}"
ROUTE="${ROUTE:-pastor-session}"
HOOK_URL="${HOOK_URL:-http://127.0.0.1:8644/webhooks/$ROUTE}"
SECRET="${SECRET:-$(openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')}"

PROMPT='Una sesión de Claude Code que vigilas terminó un turno.
Sesión: {title} ({session}) en {machine}.
Resumen: {summary}

Decide si hace falta hacer algo. Si sí, revísala con la tool pastor-hub session_read usando ese id y actúa o avísame por WhatsApp. Si no hace falta nada, no respondas.'

echo "→ creando la ruta webhook «$ROUTE» en Hermes…"
"$HERMES" webhook subscribe "$ROUTE" \
  --secret "$SECRET" \
  --events session.turn_end \
  --description "pastor: una sesión vigilada terminó su turno" \
  --prompt "$PROMPT"

echo "→ apuntando el hub de pastor a $HOOK_URL…"
node "$BRIDGE" hermes-hook "$HOOK_URL" "$SECRET"

cat <<EOF

Listo.

Si la plataforma webhook de Hermes NO estaba activa (el puerto 8644 no escuchaba),
añade esto a ~/.hermes/config.yaml bajo 'platforms:' y reinicia el gateway:

  webhook:
    enabled: true
    extra:
      host: 127.0.0.1
      port: 8644

  systemctl --user restart hermes-gateway

Desde Hermes, pon y quita monitores con las tools del MCP pastor-hub:
  monitor_add   { id: "<id de sessions_list>", note: "para qué" }
  monitor_remove{ id: "<id>" }
  monitors_list {}
EOF
