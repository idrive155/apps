#!/usr/bin/env python3
"""bake_atlases.py - keep the original Latin atlases, append Hungarian glyphs.

Restores contrast from the original bake and only adds ÁÉÍÓÖŐÚÜŰáéíóöőúüű
into free atlas space (or a new row).

  tools/.venv/bin/python tools/bake_atlases.py
"""
import base64, json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, 'fonts', 'src', 'Saira.ttf')
OUT = os.path.join(ROOT, 'assets', 'atlases.js')
BAK = OUT + '.bak'

HU = 'ÁÉÍÓÖŐÚÜŰáéíóöőúüű'
# fonts that show UI labels (huge/big stay numeric-only)
LABEL_FONTS = ('mid', 'sm', 'xs', 'lab', 'labs')


def load_exports(path):
    raw = open(path, encoding='utf8').read()
    return json.loads(raw[raw.find('{'):raw.rfind('}') + 1])


def save_exports(data, path):
    body = "'use strict';\n/* made by tools/bake_atlases.py - do not edit */\nmodule.exports = " + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(path, 'w', encoding='utf8').write(body)


def boost_alpha(img, target_mean=200):
    """Lift antialiased coverage toward the original atlas brightness."""
    px = img.load()
    w, h = img.size
    vals = [px[x, y] for y in range(h) for x in range(w) if px[x, y] > 0]
    if not vals:
        return img
    mean = sum(vals) / len(vals)
    if mean >= target_mean * 0.95:
        return img
    # gamma-ish boost then clip
    scale = target_mean / max(mean, 1)
    out = Image.new('L', img.size, 0)
    op = out.load()
    for y in range(h):
        for x in range(w):
            v = px[x, y]
            if v:
                op[x, y] = min(255, int(round(v * scale * 1.05)))
    return out


def raster_glyph(font, ch, ascent, descent):
    adv = font.getlength(ch) if hasattr(font, 'getlength') else font.getsize(ch)[0]
    pad = 4
    W = max(8, int(adv) + 8 + pad * 2)
    H = ascent + descent + pad * 2 + 8
    canvas = Image.new('L', (W, H), 0)
    draw = ImageDraw.Draw(canvas)
    try:
        draw.text((pad, ascent), ch, font=font, fill=255, anchor='ls')
    except TypeError:
        draw.text((pad, 0), ch, font=font, fill=255)
    ink = canvas.getbbox()
    if not ink:
        return round(float(adv), 2), 0, 0, None
    l, t, r, b = ink
    img = boost_alpha(canvas.crop((l, t, r, b)))
    return round(float(adv), 2), int(l - pad), int(t), img


def extend_font(name, font_data):
    missing = [c for c in HU if c not in font_data['glyphs'] or font_data['glyphs'][c][3] == 0]
    if not missing:
        print(name, 'already has Hungarian')
        return font_data

    px = font_data['px']
    font = ImageFont.truetype(FONT, size=px)
    ascent = font_data.get('asc', font.getmetrics()[0])
    descent = font_data.get('desc', font.getmetrics()[1])

    atlas = Image.frombytes('L', (font_data['w'], font_data['h']), base64.b64decode(font_data['alpha']))
    glyphs = dict(font_data['glyphs'])
    pad = 2

    # measure strip height first
    rasters = []
    row_h = 0
    for ch in missing:
        adv, ox, oy, img = raster_glyph(font, ch, ascent, descent)
        if img is None:
            glyphs[ch] = [adv, 0, 0, 0, 0, 0, 0]
            continue
        rasters.append((ch, adv, ox, oy, img))
        row_h = max(row_h, img.size[1])

    # append a new strip under the original bake (keeps Latin glyphs untouched)
    strip_h = row_h + pad * 2
    new_h = (atlas.size[1] + strip_h + 3) & ~3
    grown = Image.new('L', (atlas.size[0], new_h), 0)
    grown.paste(atlas, (0, 0))
    atlas = grown

    x = pad
    y = font_data['h'] + pad
    for ch, adv, ox, oy, img in rasters:
        gw, gh = img.size
        if x + gw + pad > atlas.size[0]:
            # wrap within the new strip if needed
            x = pad
            y += row_h + pad
            if y + gh + pad > atlas.size[1]:
                extra = (y + gh + pad * 2 + 3) & ~3
                bigger = Image.new('L', (atlas.size[0], extra), 0)
                bigger.paste(atlas, (0, 0))
                atlas = bigger
        atlas.paste(img, (x, y))
        glyphs[ch] = [adv, ox, oy, int(gw), int(gh), int(x), int(y)]
        print('  +', name, repr(ch), 'at', x, y, 'adv', adv)
        x += gw + pad

    font_data = dict(font_data)
    font_data['h'] = atlas.size[1]
    font_data['glyphs'] = glyphs
    font_data['alpha'] = base64.b64encode(atlas.tobytes()).decode('ascii')
    return font_data


def main():
    src = BAK if os.path.isfile(BAK) else OUT
    if not os.path.isfile(src):
        raise SystemExit('missing ' + src)
    if not os.path.isfile(FONT):
        raise SystemExit('missing ' + FONT)

    data = load_exports(src)
    # keep a pristine bak of the original Latin bake once
    if src == OUT and not os.path.isfile(BAK):
        open(BAK, 'w', encoding='utf8').write(open(OUT, encoding='utf8').read())

    for name in LABEL_FONTS:
        if name not in data:
            continue
        print('extend', name)
        data[name] = extend_font(name, data[name])

    save_exports(data, OUT)
    print('wrote', OUT, '%.1f MB' % (os.path.getsize(OUT) / 1e6))
    mid = data['mid']['glyphs']
    for ch in HU:
        assert ch in mid and mid[ch][3] > 0, ch
    # brightness check vs original Latin
    a = base64.b64decode(data['mid']['alpha'])
    nz = [b for b in a if b > 0]
    mean = sum(nz) / len(nz)
    print('mid nonzero mean alpha', round(mean, 1), '(want ~190+)')


if __name__ == '__main__':
    main()
