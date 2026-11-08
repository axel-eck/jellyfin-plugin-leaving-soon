# Leaving Soon — Jellyfin plugin

Tells viewers, inside Jellyfin, which movies and series [Maintainerr](https://github.com/maintainerr/maintainerr) is about to delete and when.

- **Banner** on the movie / series page: "This movie is about to be deleted in 12 days (on 20 November). Play it to keep it."
- **Badge** on posters everywhere cards are rendered: `D-12`, turning red (and pulsing) when the deadline is close.
- **Dashboard page**: Maintainerr URL and key, connection test with the list of collections and what the plugin does with each, refresh interval, display options, status and the full tracked list.
- **Read-only**: the plugin never writes to Maintainerr. Watching the item is what saves it, Maintainerr drops it from the collection on its next run.

Only collections whose Maintainerr action actually deletes media are shown (`delete`, `unmonitor + delete`, `delete show if empty`). Review-only collections (`do nothing`), `unmonitor` and quality-profile changes are ignored unless *Also warn for collections that do not delete* is enabled.

The deletion date is `addDate + deleteAfterDays` of the collection, i.e. when Maintainerr will act on the item. An item present in several collections keeps the earliest date.

## Requirements

- Jellyfin 12 (targetAbi 12.0.0.0, .NET 10).
- Maintainerr 3.x reachable from the Jellyfin server (`/api/collections` and `/api/collections/media/{id}/content/{page}`), with Jellyfin as media server so `mediaServerId` holds Jellyfin item ids.
- Web client: one `<script>` tag in `index.html`. `contrib/jellyfin-leaving-soon-init.sh` adds it for linuxserver images (`custom-cont-init.d`), idempotently, so it survives image updates. Other setups: add
  `<script src="/LeavingSoon/client.js" defer data-leaving-soon></script>` before `</body>`.

## Install

1. Copy `Leaving Soon_<version>/` (DLL + `meta.json`, from `out/leaving-soon-<version>.tgz`) into Jellyfin's `plugins/` folder, restart Jellyfin.
2. Dashboard → Plugins → Leaving Soon: set the Maintainerr URL, *Test connection*, *Save*.
3. Install the web client script (see above), restart once more.

## API

| Route | Auth | Purpose |
|---|---|---|
| `GET /LeavingSoon/Items` | any signed-in user | items to warn about + display settings (what `client.js` reads) |
| `GET /LeavingSoon/Status` | admin | cache state and the full list with titles |
| `POST /LeavingSoon/Refresh` | admin | re-read Maintainerr now |
| `POST /LeavingSoon/Test` `{url, apiKey}` | admin | try settings without saving |
| `GET /LeavingSoon/client.js`, `client.css` | none | web client assets |

Jellyfin serialises JSON in PascalCase (`Items`, `DeleteAt`…) and omits nulls.

## Development

- `dev/build.sh` — builds in the `mcr.microsoft.com/dotnet/sdk:10.0` container, produces `publish/` and `out/leaving-soon-<version>.tgz`.
- `dev/deploy-test.sh` — build + local test Jellyfin (`jftest`, linuxserver image, port 8097, data in `~/dev/jftest`; first run completes the setup wizard, admin password in `~/dev/jftest/admin-password.txt`).
- `dev/deploy-prod.sh` — build + install on the production host over SSH, restart, configure, refresh (refuses to restart while someone is playing).

The web client script is plain ES5 (no modules) so it loads in every browser the web client supports. It injects `client.css`, polls `/LeavingSoon/Items` every 5 minutes, decorates cards through a `MutationObserver` and the detail page on `hashchange`/`viewshow`. Episodes and seasons are mapped to their series with one batched `/Items?Ids=` lookup.

## License

MIT.
