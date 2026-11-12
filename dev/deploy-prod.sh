#!/usr/bin/env bash
# Build, then install/upgrade the plugin on a remote Jellyfin (linuxserver image) over SSH:
# plugin folder + web client init script, restart Jellyfin (refuses while someone is playing),
# write the plugin configuration, trigger a refresh and print what is tracked.
#
#   bash dev/deploy-prod.sh            # keep the existing plugin config (or create it on first deploy)
#   bash dev/deploy-prod.sh --review   # also include review-only collections (visual testing)
#   bash dev/deploy-prod.sh --strict   # only collections whose action deletes
#
# Settings come from the environment or from dev/deploy-prod.env (git-ignored, sourced if present):
#   JF_HOST          ssh destination (default: jellyfin)
#   JF_APPDATA       Jellyfin config dir on the host, the one mounted on /config (default: /opt/jellyfin/config)
#   JF_COMPOSE_DIR   directory holding the compose file of the jellyfin service (default: /opt/jellyfin)
#   JF_COMPOSE       compose command on the host (default: docker compose)
#   JF_URL           Jellyfin URL as seen from the host (default: http://localhost:8096)
#   JF_API_KEY       Jellyfin API key (admin), or
#   JF_API_KEY_CMD   shell command run ON THE HOST that prints it
#   MAINTAINERR_URL  Maintainerr URL as seen from the Jellyfin container, used on first deploy (default: http://maintainerr:6246)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$REPO/dev/deploy-prod.env" ] && . "$REPO/dev/deploy-prod.env"
JF_HOST=${JF_HOST:-jellyfin}
JF_APPDATA=${JF_APPDATA:-/opt/jellyfin/config}
JF_COMPOSE_DIR=${JF_COMPOSE_DIR:-/opt/jellyfin}
JF_COMPOSE=${JF_COMPOSE:-docker compose}
JF_URL=${JF_URL:-http://localhost:8096}
MAINTAINERR_URL=${MAINTAINERR_URL:-http://maintainerr:6246}
if [ -n "${JF_API_KEY:-}" ]; then JF_API_KEY_CMD="printf %s '$JF_API_KEY'"; fi
[ -n "${JF_API_KEY_CMD:-}" ] || { echo "set JF_API_KEY or JF_API_KEY_CMD (see the header of this script)"; exit 1; }
VERSION=$(grep -oE '^version: "[^"]+"' "$REPO/build.yaml" | cut -d'"' -f2)
MODE=${1:-keep}
PLUGIN_ID=$(grep -oE '^guid: "[^"]+"' "$REPO/build.yaml" | cut -d'"' -f2 | tr -d -)
[ -f "$REPO/out/leaving-soon-${VERSION}.tgz" ] || bash "$REPO/dev/build.sh"

# Pass the settings to every remote shell as exported variables.
REMOTE_ENV="JF_APPDATA=$(printf %q "$JF_APPDATA") JF_COMPOSE_DIR=$(printf %q "$JF_COMPOSE_DIR") JF_COMPOSE=$(printf %q "$JF_COMPOSE") JF_URL=$(printf %q "$JF_URL") JF_API_KEY_CMD=$(printf %q "$JF_API_KEY_CMD") MAINTAINERR_URL=$(printf %q "$MAINTAINERR_URL") VERSION=$(printf %q "$VERSION") PLUGIN_ID=$(printf %q "$PLUGIN_ID") MODE=$(printf %q "$MODE")"

# Refuse to restart while someone is watching.
ssh "$JF_HOST" "$REMOTE_ENV bash -s" <<'REMOTE' || { echo "someone is playing something: retry later"; exit 1; }
K=$(eval "$JF_API_KEY_CMD")
curl -s -H "Authorization: MediaBrowser Token=\"$K\"" "$JF_URL/Sessions?ActiveWithinSeconds=300" | python3 -c "
import json,sys; s=[x for x in json.load(sys.stdin) if x.get('NowPlayingItem')]
print('active playbacks:', len(s), [x.get('UserName') for x in s])
sys.exit(1 if s else 0)"
REMOTE

# Plugin folder. The ._* removal covers archives made by a macOS tar without COPYFILE_DISABLE
# (Jellyfin tries to load them as DLLs and disables the plugin). The archive goes through stdin,
# so the remote script is passed base64-encoded on the command line.
INSTALL=$(cat <<'REMOTE'
P="$JF_APPDATA/data/plugins"; D="$P/Leaving Soon_${VERSION}"
rm -rf "$D"; tar -xzf - -C "$P" 2>/dev/null; rm -f "$D"/._*
python3 -c "import json,sys; p=sys.argv[1]; m=json.load(open(p)); m['status']='Active'; json.dump(m, open(p,'w'), indent=2)" "$D/meta.json"
ls "$D"
REMOTE
)
ssh "$JF_HOST" "$REMOTE_ENV bash -c \"\$(echo $(printf %s "$INSTALL" | base64 | tr -d '\n') | base64 -d)\"" < "$REPO/out/leaving-soon-${VERSION}.tgz"
INIT='mkdir -p "$JF_APPDATA/custom-cont-init.d" && cat > "$JF_APPDATA/custom-cont-init.d/jellyfin-leaving-soon-init.sh" && chmod +x "$JF_APPDATA/custom-cont-init.d/jellyfin-leaving-soon-init.sh"'
ssh "$JF_HOST" "$REMOTE_ENV bash -c \"\$(echo $(printf %s "$INIT" | base64 | tr -d '\n') | base64 -d)\"" < "$REPO/contrib/jellyfin-leaving-soon-init.sh"

# Restart and check.
ssh "$JF_HOST" "$REMOTE_ENV bash -s" <<'REMOTE'
cd "$JF_COMPOSE_DIR" && $JF_COMPOSE restart jellyfin >/dev/null 2>&1
curl -s -o /dev/null --retry 60 --retry-delay 2 --retry-all-errors -m 5 "$JF_URL/health"; sleep 8
echo "plugin loaded: $(grep -hc 'Loaded plugin: "Leaving Soon"' "$(ls -1t "$JF_APPDATA"/log/log_*.log | head -1)")"
echo "script injected: $(curl -s "$JF_URL/web/index.html" | grep -c data-leaving-soon)"
REMOTE

# Configuration + refresh.
ssh "$JF_HOST" "$REMOTE_ENV bash -s" <<'REMOTE'
K=$(eval "$JF_API_KEY_CMD")
A="Authorization: MediaBrowser Token=\"$K\""
CUR=$(curl -s -H "$A" "$JF_URL/Plugins/$PLUGIN_ID/Configuration")
CFG=$(python3 - "$MODE" "$CUR" "$MAINTAINERR_URL" <<'PY'
import json, sys
mode, cur, url = sys.argv[1], json.loads(sys.argv[2] or "{}"), sys.argv[3]
cfg = {"MaintainerrUrl": cur.get("MaintainerrUrl") or url, "ApiKey": cur.get("ApiKey") or "",
       "RefreshMinutes": cur.get("RefreshMinutes") or 10, "IncludeNonDeletingCollections": bool(cur.get("IncludeNonDeletingCollections")),
       "ShowBanner": cur.get("ShowBanner", True), "ShowBadges": cur.get("ShowBadges", True),
       "WarnWithinDays": cur.get("WarnWithinDays") or 0, "UrgentWithinDays": cur.get("UrgentWithinDays", 3)}
if mode == "--review": cfg["IncludeNonDeletingCollections"] = True
if mode == "--strict": cfg["IncludeNonDeletingCollections"] = False
print(json.dumps(cfg))
PY
)
printf %s "$CFG" | curl -s -o /dev/null -w "config %{http_code}\n" -H "$A" -H "Content-Type: application/json" -X POST "$JF_URL/Plugins/$PLUGIN_ID/Configuration" --data-binary @-
sleep 2
curl -s -H "$A" -X POST -H "Content-Type: application/json" "$JF_URL/LeavingSoon/Refresh" -d "{}" | python3 -c "
import json,sys; d=json.load(sys.stdin); print('status: collections', d.get('CollectionsTracked'), '/', d.get('CollectionsSeen'), '| items', len(d.get('Items',[])), '| error', d.get('LastError'))
[print('  ', i.get('Title'), '|', i['CollectionTitle'], '| deleted on', i['DeleteAt'][:10]) for i in d.get('Items',[])]"
REMOTE
echo "admin page: $JF_URL/web/#/configurationpage?name=LeavingSoon"
