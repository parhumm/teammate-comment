#!/usr/bin/env bash
#
# Build the widget locally, ship the artifacts, restart the service.
#
# The VPS never needs a toolchain: Vite runs here, and the server runs the
# TypeScript directly on node, so the remote install is production deps only.
#
#   TC_HOST=you@your-vps ./deploy.sh
#
set -euo pipefail

HOST=${TC_HOST:?set TC_HOST=user@your-vps}
DEST=${TC_DEST:-/opt/tc}
SERVICE=${TC_SERVICE:-tc}

echo "==> building widget"
npm run build:widget
test -s widget/dist/widget.js || { echo "widget bundle is missing or empty"; exit 1; }

echo "==> shipping to $HOST:$DEST"
# Excluded paths are also protected from --delete, so the remote node_modules
# survives. `data` is excluded twice over: it is not in the source list, and it
# lives outside $DEST on the server anyway.
rsync -az --delete \
  --exclude=node_modules \
  --exclude=.git \
  --exclude=data \
  package.json package-lock.json shared server widget \
  "$HOST:$DEST/"

echo "==> installing and restarting"
# `widget` ships whole so widget/package.json is present: npm ci refuses to run
# with a workspace manifest missing.
ssh "$HOST" "cd $DEST && npm ci --omit=dev && sudo systemctl restart $SERVICE"

echo "==> done"
echo "    logs: ssh $HOST journalctl -u $SERVICE -f"
