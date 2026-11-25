'use strict';
/**
 * rec.js - draw-op recorder for mgu-render (kit/renderd/PROTOCOL.md), zero allocation per frame.
 *
 * Words: u32 op, then f32 / u32 arguments. Colours are 0xRRGGBBAA (straight alpha; the renderer
 * premultiplies). Consecutive triangles are merged into one TRIS op, so a depth-sorted scene of
 * thousands of triangles costs one op header per run.
 *
 * The same recorder runs on the head unit (frames go to the renderer's socket) and in the browser
 * preview (frames go to the renderer compiled to WebAssembly): what the preview shows is what the
 * car shows, pixel for pixel.
 */
const OP = { CLEAR: 1, RECT: 2, GRAD: 3, RRECT: 4, RSTROKE: 5, CARD: 6, RAMPRECT: 7, ARC: 8, LINE: 9,
    TRIS: 10, GLYPHS: 11, LAYER: 12, CLIP: 13, NOCLIP: 14, QUAD: 15, ALPHA: 16, XF: 17, IMAGE: 18 };
const MSG = { HELLO: 1, PLACE: 2, SHOW: 3, ATLAS: 4, RAMP: 5, LAYER: 6, FRAME: 7, DROP_LAYER: 8 };

/* ---------- colour ---------- */
function c8(v) { v = v * 255 + 0.5; return v <= 0 ? 0 : v >= 255 ? 255 : v | 0; }
/** floats 0..1 -> 0xRRGGBBAA */
function rgba(r, g, b, a) { return ((c8(r) << 24) | (c8(g) << 16) | (c8(b) << 8) | c8(a === undefined ? 1 : a)) >>> 0; }
/** '#rrggbb' or '#rrggbbaa' -> 0xRRGGBBAA */
function hex(s, a) {
    let v = parseInt(s.slice(1), 16);
    if (s.length === 7) v = (v << 8) | (a === undefined ? 255 : c8(a));
    return v >>> 0;
}
/** colour with its alpha multiplied by k */
function fade(c, k) { const a = c8((c & 255) / 255 * k); return ((c & 0xffffff00) | a) >>> 0; }
/** linear mix of two packed colours */
function mix(a, b, t) {
    const u = 1 - t;
    const r = ((a >>> 24) * u + (b >>> 24) * t) | 0, g = (((a >>> 16) & 255) * u + ((b >>> 16) & 255) * t) | 0;
    const bl = (((a >>> 8) & 255) * u + ((b >>> 8) & 255) * t) | 0, al = ((a & 255) * u + (b & 255) * t) | 0;
    return ((r << 24) | (g << 16) | (bl << 8) | al) >>> 0;
}
/** float rgb (0..1+, clamped) + alpha -> packed; the hot path of per-vertex shading */
function pk(r, g, b, a) {
    r = r * 255 + 0.5; g = g * 255 + 0.5; b = b * 255 + 0.5; a = a * 255 + 0.5;
    r = r <= 0 ? 0 : r >= 255 ? 255 : r | 0; g = g <= 0 ? 0 : g >= 255 ? 255 : g | 0;
    b = b <= 0 ? 0 : b >= 255 ? 255 : b | 0; a = a <= 0 ? 0 : a >= 255 ? 255 : a | 0;
    return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

class Rec {
    constructor(words) {
        this.buf = new ArrayBuffer((words || 65536) * 4);
        this.u = new Uint32Array(this.buf); this.f = new Float32Array(this.buf);
        this.n = 0; this.triAt = -1; this.ramps = new Set(); this.atlases = new Set();
        this.tris = 0; this.ops = 0;
    }
    reset() { this.n = 0; this.triAt = -1; this.tris = 0; this.ops = 0; this.ramps.clear(); this.atlases.clear(); return this; }
    _grow(k) {
        if (this.n + k <= this.u.length) return;
        let cap = this.u.length * 2; while (cap < this.n + k) cap *= 2;
        const b = new ArrayBuffer(cap * 4); new Uint32Array(b).set(this.u.subarray(0, this.n));
        this.buf = b; this.u = new Uint32Array(b); this.f = new Float32Array(b);
    }
    _op(op, k) { this.triAt = -1; this._grow(k + 1); this.u[this.n++] = op; this.ops++; }
    words() { return this.u.subarray(0, this.n); }

    clear(c) { this._op(OP.CLEAR, 1); this.u[this.n++] = c; return this; }
    rect(x, y, w, h, c) { this._op(OP.RECT, 5); const f = this.f, i = this.n; f[i] = x; f[i + 1] = y; f[i + 2] = w; f[i + 3] = h; this.u[i + 4] = c; this.n += 5; return this; }
    /** vertical gradient, stops = [t, c, t, c, ...] */
    grad(x, y, w, h, stops) { return this._g(OP.GRAD, x, y, w, h, -1, stops); }
    card(x, y, w, h, r, stops) { return this._g(OP.CARD, x, y, w, h, r, stops); }
    _g(op, x, y, w, h, r, st) {
        const k = st.length >> 1; this._op(op, (r < 0 ? 5 : 6) + k * 2);
        const f = this.f; let i = this.n;
        f[i++] = x; f[i++] = y; f[i++] = w; f[i++] = h; if (r >= 0) f[i++] = r;
        this.u[i++] = k; for (let j = 0; j < k; j++) { f[i++] = st[j * 2]; this.u[i++] = st[j * 2 + 1]; }
        this.n = i; return this;
    }
    rrect(x, y, w, h, r, c) { this._op(OP.RRECT, 6); const f = this.f, i = this.n; f[i] = x; f[i + 1] = y; f[i + 2] = w; f[i + 3] = h; f[i + 4] = r; this.u[i + 5] = c; this.n += 6; return this; }
    rstroke(x, y, w, h, r, lw, c) { this._op(OP.RSTROKE, 7); const f = this.f, i = this.n; f[i] = x; f[i + 1] = y; f[i + 2] = w; f[i + 3] = h; f[i + 4] = r; f[i + 5] = lw; this.u[i + 6] = c; this.n += 7; return this; }
    /** ring sector, angles in degrees clockwise from 12 o'clock; ramp = id from ramp() or 0 */
    arc(cx, cy, r0, r1, a0, a1, c, caps, ramp, rf, rt) {
        this._op(OP.ARC, 11); const f = this.f, u = this.u, i = this.n;
        f[i] = cx; f[i + 1] = cy; f[i + 2] = r0; f[i + 3] = r1; f[i + 4] = a0; f[i + 5] = a1; u[i + 6] = c;
        u[i + 7] = (caps ? 1 : 0) | (ramp ? 2 : 0); u[i + 8] = ramp || 0; f[i + 9] = rf || 0; f[i + 10] = rt || 0;
        if (ramp) this.ramps.add(ramp);
        this.n += 11; return this;
    }
    line(xa, ya, xb, yb, w, c) { this._op(OP.LINE, 6); const f = this.f, i = this.n; f[i] = xa; f[i + 1] = ya; f[i + 2] = xb; f[i + 3] = yb; f[i + 4] = w; this.u[i + 5] = c; this.n += 6; return this; }
    /** convex quad, anti-aliased by the renderer */
    quad(x0, y0, x1, y1, x2, y2, x3, y3, c) {
        this._op(OP.QUAD, 9); const f = this.f, i = this.n;
        f[i] = x0; f[i + 1] = y0; f[i + 2] = x1; f[i + 3] = y1; f[i + 4] = x2; f[i + 5] = y2; f[i + 6] = x3; f[i + 7] = y3; this.u[i + 8] = c;
        this.n += 9; return this;
    }
    /** one triangle with a colour per vertex; runs of triangles share one TRIS op */
    tri(x0, y0, c0, x1, y1, c1, x2, y2, c2) {
        if (this.triAt < 0) { this._op(OP.TRIS, 1); this.triAt = this.n; this.u[this.n++] = 0; }
        this._grow(9);
        const f = this.f, u = this.u, i = this.n;
        f[i] = x0; f[i + 1] = y0; u[i + 2] = c0; f[i + 3] = x1; f[i + 4] = y1; u[i + 5] = c1; f[i + 6] = x2; f[i + 7] = y2; u[i + 8] = c2;
        this.n += 9; this.u[this.triAt]++; this.tris++;
        return this;
    }
    /** glyph quads from an alpha atlas, one colour: q = [x, y, w, h, u0, v0, u1, v1] * n (Float32Array or array) */
    glyphs(atlasId, c, q, n) {
        this._op(OP.GLYPHS, 3 + n * 8); const f = this.f, u = this.u; let i = this.n;
        u[i++] = atlasId; u[i++] = c; u[i++] = n;
        for (let j = 0; j < n * 8; j++) f[i++] = q[j];
        this.n = i; this.atlases.add(atlasId); return this;
    }
    clip(x, y, w, h) { this._op(OP.CLIP, 4); const f = this.f, i = this.n; f[i] = x; f[i + 1] = y; f[i + 2] = w; f[i + 3] = h; this.n += 4; return this; }
    noclip() { this._op(OP.NOCLIP, 0); return this; }
    alpha(a) { this._op(OP.ALPHA, 1); this.f[this.n++] = a; return this; }
    xf(s, ox, oy) { this._op(OP.XF, 3); const f = this.f, i = this.n; f[i] = s; f[i + 1] = ox; f[i + 2] = oy; this.n += 3; return this; }
}

/* ---------- resources: ramps ---------- */
const ramps = [];          // id - 1 -> Uint32Array of colours
function ramp(colours) { ramps.push(Uint32Array.from(colours)); return ramps.length; }

/* ---------- messages ---------- */
function message(type, payloadU8) {
    const len = payloadU8 ? payloadU8.length : 0, pad = (4 - (len & 3)) & 3;
    const out = new Uint8Array(8 + len + pad), dv = new DataView(out.buffer);
    dv.setUint32(0, type, true); dv.setUint32(4, len + pad, true);
    if (len) out.set(payloadU8, 8);
    return out;
}
function u32bytes(arr) { const u = Uint32Array.from(arr); return new Uint8Array(u.buffer); }
function f32words(ints, floats) { const b = new ArrayBuffer((ints.length + floats.length) * 4), dv = new DataView(b); let o = 0; ints.forEach((v) => { dv.setInt32(o, v, true); o += 4; }); floats.forEach((v) => { dv.setFloat32(o, v, true); o += 4; }); return new Uint8Array(b); }

/**
 * Session: what one renderer connection has been sent. send(bytes) is the transport
 * (socket.write on the car, gfx.feed in the preview).
 */
class Session {
    constructor(appId, send, atlases) {
        this.send = send; this.appId = appId; this.atlases = atlases; // id -> { w, h, alpha: Uint8Array }
        this.sentRamp = new Set(); this.sentAtlas = new Set();
    }
    hello() {
        const s = this.appId; const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
        this.send(message(MSG.HELLO, b));
    }
    place(x, y, w, h, scale, ox, oy) { this.sentRamp.clear(); this.sentAtlas.clear(); this.send(message(MSG.PLACE, f32words([x, y, w, h], [scale || 1, ox || 0, oy || 0]))); }
    show(on) { this.send(message(MSG.SHOW, u32bytes([on ? 1 : 0]))); }
    frame(rec) {
        rec.ramps.forEach((id) => {
            if (this.sentRamp.has(id)) return;
            const c = ramps[id - 1]; const p = new Uint32Array(2 + c.length); p[0] = id; p[1] = c.length; p.set(c, 2);
            this.send(message(MSG.RAMP, new Uint8Array(p.buffer))); this.sentRamp.add(id);
        });
        rec.atlases.forEach((id) => {
            if (this.sentAtlas.has(id)) return;
            const a = this.atlases(id); if (!a) return;
            const p = new Uint8Array(12 + a.alpha.length), dv = new DataView(p.buffer);
            dv.setUint32(0, id, true); dv.setUint32(4, a.w, true); dv.setUint32(8, a.h, true); p.set(a.alpha, 12);
            this.send(message(MSG.ATLAS, p)); this.sentAtlas.add(id);
        });
        const w = rec.words();
        this.send(message(MSG.FRAME, new Uint8Array(w.buffer, 0, w.length * 4)));
    }
}

module.exports = { Rec, Session, OP, MSG, rgba, hex, fade, mix, pk, ramp, message };
