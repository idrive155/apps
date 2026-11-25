'use strict';
/**
 * text.js - text and sprites from the baked alpha atlases (assets/atlases.js).
 * Glyphs are rasterised at the size they are drawn at; positions snap to whole pixels so
 * the renderer samples texel centres (no blur). Scaled sprites use the atlas' linear filter.
 * Type drawn larger than baked (the video, at QHD) takes the HD bake of the same font when one is
 * given (useHd, from web/atlases_hd.js), so it is drawn from a bigger raster, not stretched.
 */
const A = require('../assets/atlases');

const decoded = new Map();
let HD = null;                                      // name -> the same font baked bigger (browser only)
function useHd(set) { HD = set || null; }
function b64(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
}
/** id -> { w, h, alpha } for the Session */
function atlasById(id) {
    let a = decoded.get(id);
    if (a) return a;
    for (const S of HD ? [A, HD] : [A]) for (const k in S) if (S[k].id === id) { a = { w: S[k].w, h: S[k].h, alpha: b64(S[k].alpha) }; decoded.set(id, a); return a; }
    return null;
}

const Q = new Float32Array(8 * 256);

/** width of str in font f at its native size, with tracking (extra px between letters) */
function width(f, str, track) {
    const F = A[f], G = F.glyphs; let w = 0;
    for (let i = 0; i < str.length; i++) { const g = G[str[i]] || G[' ']; w += g[0] + (track || 0); }
    return w - (str.length ? (track || 0) : 0);
}

/**
 * text at (x, baseline y). align: 0 left, 0.5 centre, 1 right. scale: drawn size / baked size.
 * Returns the width drawn.
 */
function text(rec, f, str, x, y, c, align, track, scale) {
    let F = A[f]; scale = scale || 1; track = track || 0;
    if (HD && scale > 1.01 && HD[f]) { const k = F.px / HD[f].px; F = HD[f]; scale *= k; track /= k; }
    const G = F.glyphs;
    let w = 0;
    for (let i = 0; i < str.length; i++) w += (G[str[i]] || G[' '])[0] + track;
    w = (w - (str.length ? track : 0)) * scale;
    let px = x - w * (align || 0);
    const snap = scale === 1;
    if (snap) px = Math.round(px);
    const top = y - F.asc * scale;
    let n = 0;
    for (let i = 0; i < str.length; i++) {
        const g = G[str[i]] || G[' '];
        if (g[3]) {
            let gx = px + g[1] * scale, gy = top + g[2] * scale;
            if (snap) { gx = Math.round(gx); gy = Math.round(gy); }
            const o = n * 8;
            Q[o] = gx; Q[o + 1] = gy; Q[o + 2] = g[3] * scale; Q[o + 3] = g[4] * scale;
            Q[o + 4] = g[5]; Q[o + 5] = g[6]; Q[o + 6] = g[5] + g[3]; Q[o + 7] = g[6] + g[4];
            n++;
        }
        px += (g[0] + track) * scale;
    }
    if (n) rec.glyphs(F.id, c, Q, n);
    return w;
}

/** font metrics */
function font(f) { return A[f]; }

/* ---------- sprites ---------- */
const FX = A.fx;
const spr = FX.sprites;
let SQ = new Float32Array(8 * 512), sn = 0, sc = 0;
/** begin a batch of sprites in one colour */
function sBegin(c) { sn = 0; sc = c; }
/** sprite name centred at (x, y), size w x h */
function sAdd(name, x, y, w, h) {
    const s = spr[name];
    if (sn * 8 + 8 > SQ.length) { const b = new Float32Array(SQ.length * 2); b.set(SQ); SQ = b; }
    const o = sn * 8;
    SQ[o] = x - w / 2; SQ[o + 1] = y - h / 2; SQ[o + 2] = w; SQ[o + 3] = h;
    // half a texel in, so linear filtering never reads the neighbour
    SQ[o + 4] = s[0] + 0.5; SQ[o + 5] = s[1] + 0.5; SQ[o + 6] = s[0] + s[2] - 0.5; SQ[o + 7] = s[1] + s[3] - 0.5;
    sn++;
}
function sEnd(rec) { if (sn) rec.glyphs(FX.id, sc, SQ, sn); sn = 0; }

module.exports = { text, width, font, atlasById, useHd, sBegin, sAdd, sEnd };
