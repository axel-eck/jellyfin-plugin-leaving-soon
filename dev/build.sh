#!/usr/bin/env bash
# Build the plugin in the .NET 10 SDK container (works on the Mac with Colima or any Docker host).
# Output: publish/Jellyfin.Plugin.LeavingSoon.dll and out/leaving-soon-<version>.tgz
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
VERSION=$(grep -oE '^version: "[^"]+"' build.yaml | cut -d'"' -f2)
docker run --rm -v "$REPO":/src -w /src -v leavingsoon-nuget:/root/.nuget mcr.microsoft.com/dotnet/sdk:10.0 \
  sh -c "dotnet publish LeavingSoon/LeavingSoon.csproj -c Release -o /src/publish 2>&1 | grep -E 'error|warning (CS|SA|CA)|->' | tail -20; chown -R $(id -u):$(id -g) /src/publish /src/LeavingSoon/obj /src/LeavingSoon/bin 2>/dev/null || true"
test -f publish/Jellyfin.Plugin.LeavingSoon.dll
mkdir -p out
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/Leaving Soon_${VERSION}"
cp publish/Jellyfin.Plugin.LeavingSoon.dll "$STAGE/Leaving Soon_${VERSION}/"
cp dev/meta.json "$STAGE/Leaving Soon_${VERSION}/meta.json"
tar -C "$STAGE" -czf "out/leaving-soon-${VERSION}.tgz" "Leaving Soon_${VERSION}"
rm -rf "$STAGE"
echo "built out/leaving-soon-${VERSION}.tgz"
