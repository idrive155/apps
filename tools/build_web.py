#!/usr/bin/env python3
"""build_web.py - thin wrapper around bundle_core.py (keeps old CLI)."""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from bundle_core import bundle

TARGET = sys.argv[1] if len(sys.argv) > 1 else 'web'
if TARGET == 'node':
    # legacy path used by old kit script
    bundle('app/preview_entry.js', 'dist/sideways/sideways_core.js')
elif TARGET == 'web':
    bundle('app/preview_entry.js', 'web/bundle.js', export_name='window.DriftApp')
    print('preview bundle only (no phone-export assets in web/)')
else:
    raise SystemExit('usage: python3 tools/build_web.py [web|node]')
