'use strict';
/**
 * model.js - an imported 3D model (assets/models/<name>.js, made by tools/import_model.py) in the
 * same form car/body.js builds: positions, crease normals, triangles with materials, ambient
 * occlusion, the shell's edges (silhouettes, creases, seams), the interior's range, glow points
 * for the lamps and a footprint for the shadow. The wheels are not in it: the renderer draws its
 * own at the model's wheel centres, so they spin and steer.
 */
const { MAT } = require('./body');
const { orient } = require('./orient');

function b64(s) {
    if (typeof Buffer !== 'undefined') { const b = Buffer.from(s, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
    const bin = atob(s), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
}
const copy = (u8) => { const c = new Uint8Array(u8.length); c.set(u8); return c.buffer; };

/** the measures a model gives the rest of the app (presets.js uses this for its body style) */
function specOf(data, extra) {
    const m = data.meta, w = m.wheels;
    return Object.assign({
        name: m.name, model: data, L: m.L, W: m.Wbody || m.W, H: m.H, WB: m.WB, ohF: m.xf - m.WB / 2, rocker: 0.2, softTop: false, open: false, rearSeats: true,
        wheel: { r: m.wheel.r, rim: m.wheel.r * 0.72, wf: m.wheel.wf, wr: m.wheel.wr, trackF: m.trackF, trackR: m.trackR, spokes: 5 },
        axles: { f: (w[0].x + w[1].x) / 2, r: (w[2].x + w[3].x) / 2 },
    }, extra || {});
}

function buildModel(spec) {
    const data = spec.model, meta = data.meta;
    const Vq = new Int16Array(copy(b64(data.V))), Nq = new Int8Array(copy(b64(data.N)));
    const Fq = data.F32 ? new Uint32Array(copy(b64(data.F))) : new Uint16Array(copy(b64(data.F)));
    const M = b64(data.M);
    const nv = Vq.length / 3, nt = Fq.length / 3;
    let V0 = new Array(nv * 3), N0 = new Array(nv * 3);
    for (let i = 0; i < nv * 3; i++) { V0[i] = Vq[i] / 1000; N0[i] = Nq[i] / 127; }
    const T0 = Array.from(Fq);
    // "recalculate outside", as for the built bodies: the shell and the cabin each on their own
    orient(V0, N0, T0, 0, meta.intStart); orient(V0, N0, T0, meta.intStart, meta.intEnd);
    const V = new Float32Array(V0), N = new Float32Array(N0), T = new Uint32Array(T0), TM = new Uint8Array(M);
    const nvAll = V.length / 3;
    // ambient occlusion: the ground darkens the lower body, faces looking down are in shade
    const AO = new Float32Array(nvAll);
    for (let v = 0; v < nvAll; v++) {
        const z = V[v * 3 + 2], t = Math.min(1, Math.max(0, (z - 0.08) / 0.55));
        let ao = 0.4 + 0.6 * t * t * (3 - 2 * t);
        if (N[v * 3 + 2] < -0.3) ao *= 0.6;
        AO[v] = ao;
    }
    // edges of everything but the interior, joined by position (crease normals split the vertices)
    const key = (v) => Math.round(V[v * 3] * 1000) + ',' + Math.round(V[v * 3 + 1] * 1000) + ',' + Math.round(V[v * 3 + 2] * 1000);
    const edges = (from, to) => {
        const em = new Map(), out = [];
        for (let t = from; t < to; t++) for (let e = 0; e < 3; e++) {
            const a = T[t * 3 + e], b = T[t * 3 + (e + 1) % 3], ka = key(a), kb = key(b), k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
            const r = em.get(k); if (r) r.push(t); else em.set(k, [t, a, b]);
        }
        em.forEach((r) => out.push(r[1], r[2], r[0], r.length > 3 ? r[3] : -1));
        return out;
    };
    // the shell's edges, and the cabin's (its seats' contours, drawn as the shell's are)
    const E = edges(0, meta.intStart), EI = edges(meta.intStart, meta.intEnd);
    // the lamps: glow points at the middle of each lit group, per side
    const glow = [];
    for (const mat of [MAT.TAIL, MAT.HEAD]) for (const sd of [1, -1]) {
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let t = 0; t < nt; t++) {
            if (TM[t] !== mat) continue;
            const a = T[t * 3];
            if (V[a * 3 + 1] * sd <= 0) continue;
            sx += V[a * 3]; sy += V[a * 3 + 1]; sz += V[a * 3 + 2]; n++;
        }
        if (n) glow.push({ mat, p: [sx / n, sy / n, sz / n] });
    }
    // footprint: a rounded rectangle under the body
    const Wm = spec.W / 2, foot = [];
    for (let k = 0; k < 28; k++) {
        const a = k / 28 * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a);
        const px = Math.sign(cx) * Math.pow(Math.abs(cx), 0.3), py = Math.sign(sy) * Math.pow(Math.abs(sy), 0.3);
        foot.push((px > 0 ? meta.xf : -meta.xr) * px, Wm * 1.02 * py);
    }
    // the model's axles are not quite at +-WB/2: the renderer places the body by the wheel centres
    return {
        V, N, T, TM, AO, E: new Int32Array(E), decals: [], pipes: [], lines: [], glow, foot,
        xf: meta.xf, xr: meta.xr, AXF: spec.axles.f, AXR: spec.axles.r, ARCH: { r: spec.wheel.r + 0.05, zc: spec.wheel.r }, Wm,
        nShellTris: nt, capStart: nt, intStart: meta.intStart, intEnd: meta.intEnd, EI: new Int32Array(EI),
    };
}

module.exports = { buildModel, specOf };
