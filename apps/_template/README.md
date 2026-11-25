# New app template

1. Copy this folder to `apps/<your_id>/` (id: letters, digits, `_` — unique on the head unit).
2. Edit `app.json` (`id`, `title`, `version`, `description`).
3. Add `icon.png` (140×140 PNG, ≤128 KiB).
4. Put your head-unit entry in `main.js` (requires `./kit/mgu` and your core bundle).
5. Set `coreEntry` to the CommonJS entry that `tools/bundle_core.py` should pack, or ship plain modules next to `main.js`.
6. Push a `v*` tag (or run **Publish MGU Store catalog** in Actions) — every folder under `apps/` with an `app.json` is built and listed.
