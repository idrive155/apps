#!/usr/bin/env python3
"""pack_oap.py - build one apps/<id> folder into a Store OAP package <id>@<version>.tgz.

Uses a donor OAP package (Sideways GPL release) for the kit/, rhmiData shell and layout,
then swaps in this app's javascript, icon, package.json and titles.

  python3 tools/pack_oap.py apps/idrive155_drift --out dist
"""
import hashlib, json, os, shutil, sys, tarfile, tempfile, urllib.request, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from bundle_core import bundle  # noqa: E402

DONOR_URL = os.environ.get(
    'MGU_DONOR_TGZ',
    'https://github.com/idrive-labs/sideways/releases/download/v0.6.6/sideways@0.6.6.tgz',
)
DONOR_CACHE = os.path.join(ROOT, 'tools', 'cache', 'donor-sideways@0.6.6.tgz')
NS = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')


def uid(s):
    return str(uuid.uuid5(NS, 'https://github.com/idrive155/apps/' + s))


def ensure_donor():
    os.makedirs(os.path.dirname(DONOR_CACHE), exist_ok=True)
    if os.path.isfile(DONOR_CACHE) and os.path.getsize(DONOR_CACHE) > 1000:
        return DONOR_CACHE
    print('downloading donor OAP', DONOR_URL)
    urllib.request.urlretrieve(DONOR_URL, DONOR_CACHE)
    return DONOR_CACHE


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_app(app_dir):
    meta = json.load(open(os.path.join(app_dir, 'app.json'), encoding='utf8'))
    for k in ('id', 'title', 'version'):
        if not meta.get(k):
            raise SystemExit('app.json missing ' + k)
    return meta


def extract_donor(donor, dest):
    with tarfile.open(donor, 'r:gz') as tar:
        tar.extractall(dest)
    pkg = os.path.join(dest, 'package')
    if not os.path.isdir(pkg):
        raise SystemExit('donor has no package/ root')
    return pkg


def rewrite_texts(texts_dir, title_en, title_hu=None):
    title_hu = title_hu or title_en
    for name in os.listdir(texts_dir):
        if not name.endswith('.json'):
            continue
        path = os.path.join(texts_dir, name)
        try:
            data = json.load(open(path, encoding='utf8'))
        except Exception:
            continue
        title = title_hu if name.lower().startswith('hu_') else title_en
        changed = False
        for key in list(data.keys()):
            if key in ('SID_SIDEWAYS_TITLE', 'SID_SIDEWAYS_MAIN_TITLE'):
                data[key] = title
                changed = True
        if changed:
            open(path, 'w', encoding='utf8').write(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def pack_app(app_dir, out_dir):
    meta = load_app(app_dir)
    app_id = meta['id']
    version = meta['version']
    title = meta['title']
    core_entry = meta.get('coreEntry', None)
    if core_entry:
        core_rel = os.path.relpath(os.path.join(app_dir, 'app_core.js'), ROOT)
        bundle(core_entry, core_rel)

    donor = ensure_donor()
    work = tempfile.mkdtemp(prefix='oap-')
    try:
        pkg = extract_donor(donor, work)
        js = os.path.join(pkg, 'javascript')
        # keep kit/ only from the donor; replace app javascript from apps/<id>/
        for name in os.listdir(js):
            if name == 'kit':
                continue
            p = os.path.join(js, name)
            if os.path.isfile(p):
                os.remove(p)

        for name in os.listdir(app_dir):
            src = os.path.join(app_dir, name)
            if not os.path.isfile(src):
                continue
            if name in ('app.json', 'icon.png', 'README.md') or name.startswith('.'):
                continue
            if name.endswith('.js') or name == 'LICENSE':
                dest_name = 'app.js' if name == 'main.js' else name
                shutil.copy2(src, os.path.join(js, dest_name))

        spec = {
            'id': app_id,
            'title': title,
            'version': version,
            'screens': meta.get('screens', [{'name': 'MAIN', 'kind': 'canvas', 'title': title, 'chrome': False, 'buttons': []}]),
            'settings': meta.get('settings', []),
            'config': meta.get('config', {}),
            'startWidget': None,
            'stateIds': {'MAIN': 1},
        }
        open(os.path.join(js, 'kit', 'app-spec.json'), 'w', encoding='utf8').write(json.dumps(spec, indent=1) + '\n')
        if os.path.isfile(os.path.join(ROOT, 'LICENSE')):
            shutil.copy2(os.path.join(ROOT, 'LICENSE'), os.path.join(js, 'LICENSE'))

        pkg_json = {
            'name': app_id,
            'version': version,
            'description': meta.get('description', title),
            'main': 'javascript/app.js',
            'private': False,
            'author': meta.get('author', meta.get('vendor', 'idrive155')),
            'license': 'GPL-3.0-or-later',
            'engines': {'node': '>=8.7.0'},
            'oapAppSettings': {
                'maxDiskUsage': 20971520,
                'cpuLimit': 60,
                'memoryThresholdKB': 196608,
                'priority': 'PRIO_LOW',
                'visibility': 'FOREGROUND',
                'latencyClass': 'FOREGROUND',
                'loggingId': meta.get('loggingId', 'I155'),
                'userLoginRequired': False,
                'backgroundPriority': 200,
                'someipManifest': 'manifest.json',
            },
            'mguHmi': meta.get('mguHmi', ['ID7', 'ID8']),
            'homepage': 'https://github.com/idrive155/apps',
        }
        if meta.get('mguInternet'):
            pkg_json['mguInternet'] = True
        open(os.path.join(pkg, 'package.json'), 'w', encoding='utf8').write(json.dumps(pkg_json, indent=2) + '\n')

        rhmi_path = os.path.join(pkg, 'rhmiData', 'application.json')
        rhmi = json.load(open(rhmi_path, encoding='utf8'))
        app = rhmi['application']
        app['name'] = app_id
        app['vendor'] = meta.get('vendor', 'idrive155')
        app['version'] = version
        app['uuid'] = uid(app_id + '/application')
        app['stringBundleUuid'] = uid(app_id + '/strings')
        app['resourceBundleUuid'] = uid(app_id + '/resources')
        ep = app['entryPoints'][0]
        ep['name'] = app_id.upper().replace('-', '_') + '_ENTRY'
        ep['uuid'] = uid(app_id + '/entry')
        ep['textId'] = 'SID_SIDEWAYS_TITLE'
        ep['icon'] = 'sideways_icon.png'
        open(rhmi_path, 'w', encoding='utf8').write(json.dumps(rhmi, indent=2) + '\n')

        title_hu = meta.get('titleHu') or 'IDRIVE155 Drift'
        rewrite_texts(os.path.join(pkg, 'rhmiData', 'variantGroups', 'Common', 'texts'), title, title_hu)

        icon_src = os.path.join(app_dir, 'icon.png')
        icon_dst = os.path.join(pkg, 'rhmiData', 'variantGroups', 'Common', 'images', 'sideways_icon.png')
        if os.path.isfile(icon_src):
            shutil.copy2(icon_src, icon_dst)

        nm = os.path.join(pkg, 'node_modules')
        if os.path.isdir(nm):
            shutil.rmtree(nm)

        os.makedirs(out_dir, exist_ok=True)
        out_name = '%s@%s.tgz' % (app_id, version)
        out_path = os.path.join(out_dir, out_name)
        with tarfile.open(out_path, 'w:gz') as tar:
            tar.add(pkg, arcname='package')

        icon_out = os.path.join(out_dir, app_id + '.png')
        if os.path.isfile(icon_src):
            shutil.copy2(icon_src, icon_out)

        info = {
            'id': app_id,
            'version': version,
            'title': title,
            'titleHu': meta.get('titleHu'),
            'description': meta.get('description', title),
            'descriptionHu': meta.get('descriptionHu'),
            'author': meta.get('author', meta.get('vendor', 'idrive155')),
            'artifact': out_name,
            'size': os.path.getsize(out_path),
            'sha256': sha256_file(out_path),
            'icon': app_id + '.png',
            'iconSha256': sha256_file(icon_out) if os.path.isfile(icon_out) else None,
            'mguHmi': meta.get('mguHmi', ['ID7', 'ID8']),
            'requires': meta.get('requires', {'mgu-render': '0.3.1'}),
            'uninstallable': True,
        }
        open(os.path.join(out_dir, app_id + '.json'), 'w', encoding='utf8').write(json.dumps(info, indent=2) + '\n')
        print('packed', out_path, '%.1f MB' % (info['size'] / 1e6))
        return info
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('app_dir')
    ap.add_argument('--out', default=os.path.join(ROOT, 'dist'))
    args = ap.parse_args()
    app_dir = args.app_dir if os.path.isabs(args.app_dir) else os.path.join(ROOT, args.app_dir)
    pack_app(app_dir, args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out))


if __name__ == '__main__':
    main()
