# idrive155-apps

BMW iDrive 7 / iDrive 8 (MGU) apps for the [MGU Store](https://github.com/robertnisipeanu/mgu-store).

Multi-app source: every folder under [`apps/`](apps/) with an `app.json` is published and shows up when you add this repository as a Store source.

## Install on the car

1. Root + [MGU Store](https://github.com/robertnisipeanu/mgu-store) on the head unit  
2. Store → **Settings → Add source**  
3. Type: **`idrive155/apps`**  
4. Choose **Releases**  
5. Install the apps you want (and **mgu-render** if prompted)

Updates: bump `version` in `apps/<id>/app.json`, push a `v*` tag (or run the **Publish MGU Store catalog** Action). The Store reads the `catalog` release.

## Apps in this repo

| Id | Title | Folder |
|---|---|---|
| `idrive155_drift` | IDRIVE155 Drift | [`apps/idrive155_drift`](apps/idrive155_drift) |

### IDRIVE155 Drift

Sideways-based drift angle meter and scorer (M Drift Analyser style): live angle, chain scoring, Live Data vitals, replays. GPL fork of [Sideways](https://github.com/idrive-labs/sideways) by iDrive Labs.

| | |
|---|---|
| **Drifting** | angle ≥ 10° above 20 km/h |
| **Points** | angle × speed, more when held steady |
| **Chain** | 1.4 s grace; multiplier up to ×6 |
| **Vitals** | coolant, oil, gearbox, boost, rpm, gear (read-only SOME/IP) |

## Add a new app

```sh
cp -R apps/_template apps/my_app
# edit apps/my_app/app.json  (unique id!)
# add apps/my_app/icon.png   (140×140, ≤128 KiB)
# add apps/my_app/main.js + modules
```

Then publish (see below). The Action packs **every** `apps/*/app.json` into the catalog — all of them appear in the Store under this one source.

## Develop / publish

```sh
npm run preview          # browser HUD preview
npm run build            # pack all apps → dist/*.tgz + catalog.json
npm run build -- idrive155_drift
```

GitHub Action [`.github/workflows/publish.yml`](.github/workflows/publish.yml):

- **workflow_dispatch** or tag **`v*`** → builds all apps  
- Uploads / replaces the **`catalog`** release (`catalog.json`, `*.tgz`, icons)  
- On a `v*` tag, also creates that version release  

Head unit runs Node 8 — keep that API surface. No BMW `oap-sdk` in the packages (donor kit shell only).

## Licence

GPL-3.0-or-later (`LICENSE`). Upstream credits: `CREDITS.md`.  
Not affiliated with BMW AG. Drift only on closed courses.
