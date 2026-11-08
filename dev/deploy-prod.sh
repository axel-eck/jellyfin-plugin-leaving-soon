#!/usr/bin/env bash
# Installe/MAJ le plugin sur le Jellyfin de prod (starrs, linuxserver image) : plugin + script d'injection,
# redémarrage de Jellyfin (vérifier qu'il n'y a pas de lecture en cours), configuration Maintainerr, rafraîchissement.
#   bash dev/deploy-prod.sh            # conserve la config existante du plugin (ou la crée au 1er déploiement)
#   bash dev/deploy-prod.sh --review   # inclut aussi les collections « revue » (tests visuels)
#   bash dev/deploy-prod.sh --strict   # ne garde que les collections qui suppriment (réglage décidé)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
HOST=${HOST:-starrs}
VERSION=$(grep -oE '^version: "[^"]+"' "$REPO/build.yaml" | cut -d'"' -f2)
MODE=${1:-keep}
[ -f "$REPO/out/leaving-soon-${VERSION}.tgz" ] || bash "$REPO/dev/build.sh"

ssh "$HOST" 'K=$(python3 -c "import json;print(json.load(open(\"/home/axeleck/appdata/jellyseerr/settings.json\"))[\"jellyfin\"][\"apiKey\"])"); curl -s -H "Authorization: MediaBrowser Token=\"$K\"" "http://localhost:8096/Sessions?ActiveWithinSeconds=300" | python3 -c "
import json,sys; s=[x for x in json.load(sys.stdin) if x.get(\"NowPlayingItem\")]
print(\"lectures en cours:\", len(s), [x.get(\"UserName\") for x in s])
sys.exit(1 if s else 0)"' || { echo "quelqu'un regarde quelque chose : réessayer plus tard"; exit 1; }

# rm des ._* : au cas où l'archive viendrait d'un tar macOS sans COPYFILE_DISABLE (Jellyfin tente de les charger et désactive le plugin).
ssh "$HOST" "P=/home/axeleck/appdata/jellyfin/data/plugins; rm -rf \"\$P/Leaving Soon_${VERSION}\"; tar -xzf - -C \"\$P\" 2>/dev/null; rm -f \"\$P/Leaving Soon_${VERSION}\"/._*; python3 -c \"import json,sys; p=sys.argv[1]; m=json.load(open(p)); m['status']='Active'; json.dump(m, open(p,'w'), indent=2)\" \"\$P/Leaving Soon_${VERSION}/meta.json\"; ls \"\$P/Leaving Soon_${VERSION}\"" < "$REPO/out/leaving-soon-${VERSION}.tgz"
ssh "$HOST" 'cat > /home/axeleck/appdata/jellyfin/custom-cont-init.d/jellyfin-leaving-soon-init.sh && chmod +x /home/axeleck/appdata/jellyfin/custom-cont-init.d/jellyfin-leaving-soon-init.sh' < "$REPO/contrib/jellyfin-leaving-soon-init.sh"

ssh "$HOST" 'cd /home/axeleck/stacks/jellyfin && sudo -n docker compose restart jellyfin >/dev/null 2>&1; curl -s -o /dev/null --retry 60 --retry-delay 2 --retry-all-errors -m 5 http://localhost:8096/health; sleep 8
echo "plugin chargé : $(grep -hc "Loaded plugin: \"Leaving Soon\"" $(ls -1t /home/axeleck/appdata/jellyfin/log/log_*.log | head -1))"
echo "script injecté : $(curl -s http://localhost:8096/web/index.html | grep -c data-leaving-soon)"'

ssh "$HOST" "MODE=$MODE"' bash -s' <<'REMOTE'
K=$(python3 -c "import json;print(json.load(open('/home/axeleck/appdata/jellyfin/settings.json' if False else '/home/axeleck/appdata/jellyseerr/settings.json'))['jellyfin']['apiKey'])")
A="Authorization: MediaBrowser Token=\"$K\""
ID=d3149a2293e64ae6915f23c652a7f6e4
CUR=$(curl -s -H "$A" http://localhost:8096/Plugins/$ID/Configuration)
python3 - "$MODE" "$CUR" <<'PY' > /tmp/ls-config.json
import json, sys
mode, cur = sys.argv[1], json.loads(sys.argv[2] or "{}")
cfg = {"MaintainerrUrl": cur.get("MaintainerrUrl") or "http://maintainerr:6246", "ApiKey": cur.get("ApiKey") or "",
       "RefreshMinutes": cur.get("RefreshMinutes") or 10, "IncludeNonDeletingCollections": bool(cur.get("IncludeNonDeletingCollections")),
       "ShowBanner": cur.get("ShowBanner", True), "ShowBadges": cur.get("ShowBadges", True),
       "WarnWithinDays": cur.get("WarnWithinDays") or 0, "UrgentWithinDays": cur.get("UrgentWithinDays", 3)}
if mode == "--review": cfg["IncludeNonDeletingCollections"] = True
if mode == "--strict": cfg["IncludeNonDeletingCollections"] = False
print(json.dumps(cfg))
PY
curl -s -o /dev/null -w "config %{http_code}\n" -H "$A" -H "Content-Type: application/json" -X POST http://localhost:8096/Plugins/$ID/Configuration --data-binary @/tmp/ls-config.json
sleep 2
curl -s -H "$A" -X POST -H "Content-Type: application/json" http://localhost:8096/LeavingSoon/Refresh -d "{}" | python3 -c "
import json,sys; d=json.load(sys.stdin); print('statut : collections', d.get('CollectionsTracked'), '/', d.get('CollectionsSeen'), '| items', len(d.get('Items',[])), '| erreur', d.get('LastError'))
[print('  ', i.get('Title'), '|', i['CollectionTitle'], '| suppression le', i['DeleteAt'][:10]) for i in d.get('Items',[])]"
rm -f /tmp/ls-config.json
REMOTE
echo "page admin : https://stream.axel-eck.fr/web/#/configurationpage?name=LeavingSoon"
