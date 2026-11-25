#!/usr/bin/env python3
"""bundle_core.py - CommonJS bundle for one app (head-unit core or web preview).

  python3 tools/bundle_core.py --entry app/preview_entry.js --out apps/idrive155_drift/app_core.js
  python3 tools/bundle_core.py --web   # -> web/bundle.js
"""
import argparse, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REQ = re.compile(r"require\((['\"])(\.{1,2}/[^'\"]+)\1\)")


def resolve(frm, rel):
    p = os.path.normpath(os.path.join(os.path.dirname(frm), rel))
    if not p.endswith('.js'):
        p += '.js'
    return p


def bundle(entry, out_path, export_name=None):
    mods, order, todo = {}, [], [entry]
    while todo:
        m = todo.pop()
        if m in mods:
            continue
        src = open(os.path.join(ROOT, m), encoding='utf8').read()
        deps = {}
        for _, rel in REQ.findall(src):
            dep = resolve(m, rel)
            deps[rel] = dep
            todo.append(dep)
        mods[m] = (src, deps)
        order.append(m)
    out = ['// made by tools/bundle_core.py - do not edit',
           '(function () {',
           'const defs = {}, cache = {};',
           'function req(id) { if (cache[id]) return cache[id].exports; const m = { exports: {} }; cache[id] = m; defs[id](m, m.exports); return m.exports; }']
    for m in order:
        src, deps = mods[m]
        for rel, dep in deps.items():
            src = src.replace("require('%s')" % rel, 'req(%s)' % json.dumps(dep))
            src = src.replace('require("%s")' % rel, 'req(%s)' % json.dumps(dep))
        out.append('defs[%s] = function (module, exports) {\n%s\n};' % (json.dumps(m), src))
    if export_name:
        out.append('%s = req(%s);' % (export_name, json.dumps(entry)))
        out.append('})();')
    else:
        out[1] = ''  # drop IIFE open for CommonJS
        out.append('module.exports = req(%s);' % json.dumps(entry))
    os.makedirs(os.path.dirname(os.path.join(ROOT, out_path)) or '.', exist_ok=True)
    path = os.path.join(ROOT, out_path)
    open(path, 'w', encoding='utf8').write('\n'.join(out))
    print('%s: %d modules, %.0f KB' % (out_path, len(order), os.path.getsize(path) / 1024))
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--entry', default='app/preview_entry.js')
    ap.add_argument('--out', default='')
    ap.add_argument('--web', action='store_true')
    args = ap.parse_args()
    if args.web:
        bundle(args.entry, 'web/bundle.js', export_name='window.DriftApp')
        pub = os.path.join(ROOT, 'server', 'public')
        extras = ['x.html', 'mp4.js', 'maker.js', 'atlases_hd.js']
        if all(os.path.isfile(os.path.join(ROOT, 'web', f)) for f in extras):
            os.makedirs(os.path.join(pub, 'gfx'), exist_ok=True)
            shutil.copy(os.path.join(ROOT, 'web', 'bundle.js'), os.path.join(pub, 'bundle.js'))
        else:
            print('preview bundle only (no phone-export assets in web/)')
        return
    out = args.out or 'dist/app_core.js'
    bundle(args.entry, out)


if __name__ == '__main__':
    main()
