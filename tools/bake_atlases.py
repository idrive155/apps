#!/usr/bin/env python3
"""bake_atlases.py - rebuild assets/atlases.js from fonts/src/Saira.ttf (Latin + Hungarian).

  tools/.venv/bin/python tools/bake_atlases.py
"""
import base64, json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, 'fonts', 'src', 'Saira.ttf')
OUT = os.path.join(ROOT, 'assets', 'atlases.js')

# ASCII printable + degree/specials already used + Hungarian letters
BASE = ''.join(chr(c) for c in range(32, 127))
EXTRA = '°±·‹›ÁÉÍÓÖŐÚÜŰáéíóöőúüű'
CHARS = BASE + EXTRA

SPECS = [
    # name, px, atlas_w, tracking style (weight via variation if available)
    ('huge', 124, 1024, 700, '0123456789°-'),
    ('big', 92, 1024, 600, '0123456789.,:-+°%/±'),
    ('mid', 40, 1024, 600, CHARS),
    ('sm', 24, 1024, 500, CHARS),
    ('xs', 17, 512, 500, CHARS),
    ('lab', 19, 512, 600, CHARS),
    ('labs', 15, 512, 500, CHARS),
]


def load_font(px, weight):
    try:
        return ImageFont.truetype(FONT, size=px)
    except Exception as e:
        raise SystemExit('need %s: %s' % (FONT, e))


def raster_glyph(font, ch, ascent, descent):
    """Render ch; return (advance, ox, oy, img) with oy from top-of-line (ascent box)."""
    adv = font.getlength(ch) if hasattr(font, 'getlength') else font.getsize(ch)[0]
    # draw on a canvas with baseline at y=ascent; find ink
    pad = 4
    W = max(8, int(adv) + 8 + pad * 2)
    H = ascent + descent + pad * 2
    canvas = Image.new('L', (W, H), 0)
    draw = ImageDraw.Draw(canvas)
    # Pillow text position is top-left of the em box for default anchor; use anchor='ls' (left/baseline) when available
    try:
        draw.text((pad, ascent), ch, font=font, fill=255, anchor='ls')
    except TypeError:
        draw.text((pad, 0), ch, font=font, fill=255)
    ink = canvas.getbbox()
    if not ink:
        return round(float(adv), 2), 0, 0, None
    l, t, r, b = ink
    img = canvas.crop((l, t, r, b))
    ox = l - pad
    oy = t  # already from top of canvas ≈ top of line when anchor=ls
    return round(float(adv), 2), int(ox), int(oy), img


def bake_font(name, px, atlas_w, weight, charset):
    font = load_font(px, weight)
    ascent, descent = font.getmetrics()
    pad = 1
    x = pad
    y = pad
    row_h = 0
    glyphs = {}
    placed = []  # (ch, x, y, w, h, ox, oy, adv, img)

    for ch in charset:
        adv, ox, oy, img = raster_glyph(font, ch, ascent, descent)
        if img is None:
            glyphs[ch] = [adv, 0, 0, 0, 0, 0, 0]
            continue
        gw, gh = img.size
        if x + gw + pad > atlas_w:
            x = pad
            y += row_h + pad
            row_h = 0
        placed.append((ch, x, y, gw, gh, ox, oy, adv, img))
        row_h = max(row_h, gh)
        x += gw + pad

    atlas_h = y + row_h + pad
    # round up to multiple of 4
    atlas_h = max(atlas_h, 4)
    atlas_h = (atlas_h + 3) & ~3
    atlas = Image.new('L', (atlas_w, atlas_h), 0)
    for ch, gx, gy, gw, gh, ox, oy, adv, img in placed:
        atlas.paste(img, (gx, gy))
        glyphs[ch] = [round(float(adv), 2), int(ox), int(oy), int(gw), int(gh), int(gx), int(gy)]

    alpha = base64.b64encode(atlas.tobytes()).decode('ascii')
    # stable id from name+size
    fid = abs(hash(name + str(px))) % (2**32)
    return {
        'id': fid,
        'kind': 'font',
        'px': px,
        'asc': ascent,
        'desc': descent,
        'w': atlas_w,
        'h': atlas_h,
        'glyphs': glyphs,
        'alpha': alpha,
    }


def main():
    if not os.path.isfile(FONT):
        raise SystemExit('missing ' + FONT)
    out = {}
    # preserve fx sprites from existing atlases
    prev_path = OUT
    fx = None
    if os.path.isfile(prev_path):
        raw = open(prev_path, encoding='utf8').read()
        i = raw.find('{')
        j = raw.rfind('}')
        if i >= 0 and j > i:
            prev = json.loads(raw[i:j + 1])
            fx = prev.get('fx')
    for name, px, aw, weight, chars in SPECS:
        print('baking', name, px, 'chars', len(chars))
        out[name] = bake_font(name, px, aw, weight, chars)
    if not fx:
        raise SystemExit('no fx atlas in existing assets/atlases.js — keep sprites')
    out['fx'] = fx
    body = "'use strict';\n/* made by tools/bake_atlases.py - do not edit */\nmodule.exports = " + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n'
    open(OUT, 'w', encoding='utf8').write(body)
    print('wrote', OUT, '%.1f MB' % (os.path.getsize(OUT) / 1e6))
    for ch in 'ÁÉÍÓÖŐÚÜŰáéíóöőúüű':
        assert ch in out['mid']['glyphs'], ch
    print('hungarian glyphs ok')


if __name__ == '__main__':
    main()
