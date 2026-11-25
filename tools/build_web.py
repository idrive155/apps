#!/usr/bin/env python3
"""build_web.py - bundle the app's CommonJS modules into web/bundle.js for the browser preview.

The preview runs the same modules as the head unit; only the transport differs (the renderer
compiled to WebAssembly instead of its socket). Entry: app/preview_entry.js.
"""
import json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import sys
TARGET = sys.argv[1] if len(sys.argv) > 1 else 'web'
ENTRY = 'app/preview_entry.js'
REQ = re.compile(r"require\((['\"])(\.{1,2}/[^'\"]+)\1\)")


def resolve(frm, rel):
    p = os.path.normpath(os.path.join(os.path.dirname(frm), rel))
    if not p.endswith('.js'):
        p += '.js'
    return p


def main():
    mods, order, todo = {}, [], [ENTRY]
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
    out = ['// made by tools/build_web.py - do not edit', '(function () {', 'const defs = {}, cache = {};',
           'function req(id) { if (cache[id]) return cache[id].exports; const m = { exports: {} }; cache[id] = m; defs[id](m, m.exports); return m.exports; }']
    for m in order:
        src, deps = mods[m]
        for rel, dep in deps.items():
            src = src.replace("require('%s')" % rel, 'req(%s)' % json.dumps(dep)).replace('require("%s")' % rel, 'req(%s)' % json.dumps(dep))
        out.append('defs[%s] = function (module, exports) {\n%s\n};' % (json.dumps(m), src))
    if TARGET == 'node':
        out[1] = ''
        out.append('module.exports = req(%s);' % json.dumps(ENTRY))
        path = os.path.join(ROOT, 'dist', 'sideways', 'sideways_core.js')
        os.makedirs(os.path.dirname(path), exist_ok=True)
    else:
        out.append('window.DriftApp = req(%s);' % json.dumps(ENTRY))
        out.append('})();')
        path = os.path.join(ROOT, 'web', 'bundle.js')
    open(path, 'w', encoding='utf8').write('\n'.join(out))
    print('%s: %d modules, %.0f KB' % (os.path.relpath(path, ROOT), len(order), os.path.getsize(path) / 1024))
    if TARGET != 'node':
        # optional: copy into server/public when those assets exist (phone video export)
        import shutil
        pub = os.path.join(ROOT, 'server', 'public')
        extras = ['x.html', 'mp4.js', 'maker.js', 'atlases_hd.js']
        if all(os.path.isfile(os.path.join(ROOT, 'web', f)) for f in extras):
            os.makedirs(os.path.join(pub, 'gfx'), exist_ok=True)
            shutil.copy(path, os.path.join(pub, 'bundle.js'))
            for f in extras:
                shutil.copy(os.path.join(ROOT, 'web', f), os.path.join(pub, f))
            gfx = os.path.join(ROOT, 'web', 'gfx')
            if os.path.isdir(gfx):
                for f in os.listdir(gfx):
                    if f.endswith(('.js', '.wasm')):
                        shutil.copy(os.path.join(gfx, f), os.path.join(pub, 'gfx', f))
        else:
            print('preview bundle only (no phone-export assets in web/)')


if __name__ == '__main__':
    main()
