#!/usr/bin/env python3
"""build_apps.py - pack every app under apps/ into dist/ and write catalog.json.

  python3 tools/build_apps.py
  python3 tools/build_apps.py --app idrive155_drift
"""
import argparse, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from pack_oap import pack_app  # noqa: E402


def list_apps():
    apps_dir = os.path.join(ROOT, 'apps')
    out = []
    for name in sorted(os.listdir(apps_dir)):
        if name.startswith('_') or name.startswith('.'):
            continue
        d = os.path.join(apps_dir, name)
        if os.path.isdir(d) and os.path.isfile(os.path.join(d, 'app.json')):
            out.append(d)
    return out


def write_catalog(infos, out_dir, download_base):
    """catalog.json for MGU Store Releases → catalog release."""
    components = []
    for info in infos:
        art = {
            'name': info['artifact'],
            'size': info['size'],
            'sha256': info['sha256'],
            'url': download_base.rstrip('/') + '/' + info['artifact'] if download_base else info['artifact'],
        }
        entry = {
            'id': info['id'],
            'kind': 'app',
            'title': info['title'],
            'description': info['description'],
            'author': info['author'],
            'version': info['version'],
            'artifact': art,
            'uninstallable': True,
            'mguHmi': info['mguHmi'],
            'requires': info.get('requires') or {},
        }
        if info.get('descriptionHu') or info.get('titleHu'):
            entry['texts'] = {
                'hu': {
                    'title': info.get('titleHu') or info['title'],
                    'description': info.get('descriptionHu') or info['description'],
                }
            }
        if info.get('icon'):
            entry['icon'] = info['icon']
            if download_base:
                # Store accepts asset name on catalog release, or absolute URL
                entry['icon'] = info['icon']
            if info.get('iconSha256'):
                entry['iconSha256'] = info['iconSha256']
        components.append(entry)
    catalog = {'schema': 2, 'components': components}
    path = os.path.join(out_dir, 'catalog.json')
    open(path, 'w', encoding='utf8').write(json.dumps(catalog, indent=2) + '\n')
    print('wrote', path, '(%d apps)' % len(components))
    return path


def write_mgu_store(infos, out_dir):
    apps = {}
    for info in infos:
        apps[info['id']] = {
            'title': info['title'],
            'description': info['description'],
            'author': info['author'],
            'icon': info['icon'],
            'iconSha256': info.get('iconSha256'),
        }
    path = os.path.join(out_dir, 'mgu-store.json')
    open(path, 'w', encoding='utf8').write(json.dumps({'apps': apps}, indent=2) + '\n')
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--app', help='only this app id')
    ap.add_argument('--out', default=os.path.join(ROOT, 'dist'))
    ap.add_argument('--download-base', default='',
                    help='e.g. https://github.com/idrive155/apps/releases/download/catalog')
    args = ap.parse_args()
    out_dir = args.out if os.path.isabs(args.out) else os.path.join(ROOT, args.out)
    os.makedirs(out_dir, exist_ok=True)

    apps = list_apps()
    if args.app:
        apps = [d for d in apps if os.path.basename(d) == args.app]
        if not apps:
            raise SystemExit('app not found: ' + args.app)

    infos = []
    for d in apps:
        print('==', os.path.basename(d))
        infos.append(pack_app(d, out_dir))

    base = args.download_base
    write_catalog(infos, out_dir, base)
    write_mgu_store(infos, out_dir)
    open(os.path.join(out_dir, 'apps-index.json'), 'w', encoding='utf8').write(
        json.dumps(infos, indent=2) + '\n')


if __name__ == '__main__':
    main()
