#!/bin/sh
# make_kit_app.sh - pack all Store apps (or one) into dist/*.tgz + catalog.json
#   ./tools/make_kit_app.sh
#   ./tools/make_kit_app.sh idrive155_drift
set -e
cd "$(dirname "$0")/.."
if [ -n "$1" ]; then
  python3 tools/build_apps.py --app "$1"
else
  python3 tools/build_apps.py
fi
ls -la dist
