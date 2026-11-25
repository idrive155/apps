#!/bin/sh
# make_kit_app.sh - dist/sideways: the app folder for the idrive7-apps kit
#   cp -r dist/sideways <idrive7-apps>/apps/  &&  python3 kit/tools/build.py sideways
set -e
cd "$(dirname "$0")/.."
rm -rf dist/sideways && mkdir -p dist/sideways
python3 tools/build_web.py node
cp platform/main.js platform/rclient.js platform/live.js platform/vitals.js platform/http.js platform/idrive.js platform/sig.js platform/carid.js platform/app.json platform/icon.png dist/sideways/
cp LICENSE dist/sideways/LICENSE 2>/dev/null || true
node -e "require('./dist/sideways/sideways_core.js'); console.log('core loads under node')"
ls -la dist/sideways
