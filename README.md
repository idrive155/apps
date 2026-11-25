# idrive155-apps

BMW iDrive 7 / iDrive 8 (MGU) apps for the [MGU Store](https://github.com/robertnisipeanu/mgu-store).

## Drift analyser (Sideways fork)

This repository currently ships **[Sideways](https://github.com/idrive-labs/sideways)** — a professional drift angle meter and scorer (M Drift Analyser style): live angle, chain scoring, Live Data vitals, and replays.

Based on Sideways by iDrive Labs (GPL-3.0-or-later). Upstream: https://github.com/idrive-labs/sideways

### Install on the car (fastest)

You do **not** need this repo on the head unit to try it:

1. MGU Store → **Settings → Add source**
2. Type `idrive-labs/mgu-apps`, choose **Releases**
3. Install **Sideways**
4. Drive a few normal corners until *Calibrating* disappears

Needs root + MGU Store.

### Live Data vitals (v0.7)

Always-on strip + full **VITALS** page (idrive7 Live Data / M Vitals scaling):

| Tile | Source |
|---|---|
| Coolant / engine oil | `CDS.statusEngineTemperature` (−48 °C) |
| Gearbox oil | `BasicDataSet` when the car fills it |
| Boost | `FES.statusSwitchDriveDynamicSport2` (0.01 bar) |
| RPM / torque / power % | CDS + FES sport display |
| Gear | `VehicleInformation.statusGearboxDrive` |

Read-only SOME/IP — same idea as Live Data, nothing written to the car.

### Scoring (same as upstream)

| | |
|---|---|
| **Drifting** | angle ≥ 10° above 20 km/h |
| **Points** | angle × speed, more when held steady |
| **Chain** | 1.4 s grace between drifts |
| **Multiplier** | +0.5 / 2.5 s and on clean transitions, up to ×6 |
| **Bank** | points × multiplier when grace ends; spin (>110°) or stop loses the chain |
| **Ratings** | Nice · Great 800 · Awesome 2500 · Insane 6000 · Legendary 12000 · Godlike 25000 |

### Develop / customise here

```sh
./tools/make_kit_app.sh
# -> dist/sideways  (app folder for the idrive7-apps kit)
# cp -r dist/sideways /path/to/idrive7-apps/apps/
# python3 kit/tools/build.py sideways
```

Node.js + Python 3. Head unit runs Node 8 — keep that API surface.

Signals used (read-only): yaw rate, lateral/longitudinal accel, steering angle, wheel speeds, vehicle speed. See `platform/live.js`.

### Own Store source later

To publish from **this** GitHub repo (`idrive155/apps`):

1. Push this tree (or built `@.tgz` packages) to GitHub
2. In the Store: **Add source** → `idrive155/apps` (Releases, Tags, or a branch with `mgu-repo.json`)
3. Install your package from that source

See [mgu-store PUBLISHING](https://github.com/robertnisipeanu/mgu-store/blob/main/docs/PUBLISHING.md).

## Licence

GPL-3.0-or-later (`LICENSE`). Upstream credits: `CREDITS.md`.
Not affiliated with BMW AG. Drift only on closed courses.
