#!/usr/bin/env bash
# Leaving Soon - web client integration for container images.
#
# Injects the plugin's client script into the web client's index.html. The script is served by the
# plugin itself (/LeavingSoon/client.js), so it updates with the plugin; only this one tag is needed.
#
# linuxserver/jellyfin: place at config/custom-cont-init.d/jellyfin-leaving-soon-init.sh, chmod +x,
# mount ./config/custom-cont-init.d:/custom-cont-init.d. Runs as root before Jellyfin starts and is
# idempotent, so it survives image updates (which replace index.html).
set -euo pipefail

WEB_DIR="${JELLYFIN_WEB_DIR:-/usr/share/jellyfin/web}"
BASE="${JELLYFIN_BASE_PATH:-}"          # e.g. /jellyfin when served under a sub-path
INDEX="${WEB_DIR}/index.html"
TAG="<script src=\"${BASE}/LeavingSoon/client.js\" defer data-leaving-soon></script>"

log() { echo "**** [leaving-soon] $* ****"; }

if [ ! -f "$INDEX" ]; then
    log "index.html not found at $INDEX, nothing to do"
    exit 0
fi

if grep -q 'data-leaving-soon' "$INDEX"; then
    log "client script already present in index.html"
else
    sed -i "s|</body>|${TAG}</body>|" "$INDEX"
    log "client script added to index.html"
fi
