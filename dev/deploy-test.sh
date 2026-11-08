#!/usr/bin/env bash
# Build, then install into the local test Jellyfin (container jftest, data in ~/dev/jftest) and restart it.
# First run creates the container and completes the startup wizard (admin / see ~/dev/jftest/admin-password.txt).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
JF="$HOME/dev/jftest"
VERSION=$(grep -oE '^version: "[^"]+"' "$REPO/build.yaml" | cut -d'"' -f2)
PLUGIN_DIR="$JF/config/data/plugins/Leaving Soon_${VERSION}"
PORT=${JFTEST_PORT:-8097}

"$REPO/dev/build.sh"

mkdir -p "$JF/config" "$JF/custom-cont-init.d" "$JF/media"
cp "$REPO/contrib/jellyfin-leaving-soon-init.sh" "$JF/custom-cont-init.d/"
chmod +x "$JF/custom-cont-init.d/"*.sh
mkdir -p "$PLUGIN_DIR"
cp "$REPO/publish/Jellyfin.Plugin.LeavingSoon.dll" "$PLUGIN_DIR/"
cp "$REPO/dev/meta.json" "$PLUGIN_DIR/meta.json"

if ! docker ps -a --format '{{.Names}}' | grep -qx jftest; then
  docker run -d --name jftest -p "$PORT:8096" -e PUID="$(id -u)" -e PGID="$(id -g)" -e TZ=Europe/Paris \
    -v "$JF/config:/config" -v "$JF/media:/data/media" -v "$JF/custom-cont-init.d:/custom-cont-init.d" \
    lscr.io/linuxserver/jellyfin:latest >/dev/null
else
  docker restart jftest >/dev/null
fi
curl -s -o /dev/null --retry 90 --retry-delay 2 --retry-all-errors -m 5 "http://localhost:$PORT/health"

# Startup wizard, once.
if curl -s "http://localhost:$PORT/System/Info/Public" | grep -q '"StartupWizardCompleted":false'; then
  PW=$(openssl rand -hex 12); echo "$PW" > "$JF/admin-password.txt"; chmod 600 "$JF/admin-password.txt"
  H='Authorization: MediaBrowser Client="dev", Device="dev", DeviceId="dev", Version="1"'
  curl -s -H "$H" -H 'Content-Type: application/json' -X POST "http://localhost:$PORT/Startup/Configuration" -d '{"UICulture":"fr","MetadataCountryCode":"FR","PreferredMetadataLanguage":"fr"}'
  curl -s -H "$H" "http://localhost:$PORT/Startup/User" >/dev/null
  curl -s -H "$H" -H 'Content-Type: application/json' -X POST "http://localhost:$PORT/Startup/User" -d "{\"Name\":\"admin\",\"Password\":\"$PW\"}"
  curl -s -H "$H" -H 'Content-Type: application/json' -X POST "http://localhost:$PORT/Startup/RemoteAccess" -d '{"EnableRemoteAccess":true,"EnableAutomaticPortMapping":false}'
  curl -s -H "$H" -X POST "http://localhost:$PORT/Startup/Complete"
  echo "wizard done (admin / $JF/admin-password.txt)"
fi
sleep 5
LOG=$(ls -1t "$JF"/config/log/log_*.log 2>/dev/null | head -1)
[ -n "$LOG" ] && grep -h 'Loaded plugin: "Leaving Soon"' "$LOG" | tail -1 | cut -c1-120 || true
echo "web: http://localhost:$PORT/web/  (script injected: $(curl -s http://localhost:$PORT/web/index.html | grep -c data-leaving-soon))"
