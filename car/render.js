'use strict';
/**
 * render.js - draws the car: transform, light, depth-sort, emit.
 *
 * - Per-vertex lighting through the renderer's per-vertex colours: a key light, a clear coat
 *   reflecting a studio (sky gradient, overhead soft boxes, a strip light over the camera, a
 *   coloured horizon, the dark ground), Fresnel, specular, ambient occlusion baked per vertex,
 *   an ACES tone curve. The studio turns with the camera, so the car rotating into a drift slides
 *   its reflections over the panels.
 * - Glass is see-through (its opacity follows Fresnel): the interior shows beneath it.
 * - Painter's algorithm: front faces only, bucket sort by depth, far to near; decals, light pipes,
 *   shut lines and silhouettes are sorted in with the triangles.
 * - Anti-aliasing: silhouettes and material seams are 1 px anti-aliased lines in the surface's
 *   colour; decals are polygons with a fringe; light pipes are anti-aliased lines plus a halo.
 * - Wheels: tyre, rim lip, ten real spokes (front and side faces, dished), a disc behind them,
 *   a caliper that does not spin; a blur disc at speed. Front wheels steer.
 */
const { build, MAT } = require('./body');
const { buildModel } = require('./model');
const { orient } = require('./orient');
const { pk, fade } = require('../engine/rec');
const poly = require('../engine/poly');

/* ---------- wheel (local: axle along y, outer face at +y, x forward, z up) ---------- */
function wheelMesh(spec, w) {
    const R = spec.wheel.r, Rr = spec.wheel.rim, h = w / 2, N = spec.lod ? 18 : 28;
    const V = [], Nn = [], T = [], TM = [];
    const band = (y0, r0, y1, r1, mat, core, n) => {
        n = n || N;
        const base = V.length / 3, dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1;
        let nr = -dy / l, ny = dr / l;
        if (nr * ((r0 + r1) / 2 - core[0]) + ny * ((y0 + y1) / 2 - core[1]) < 0) { nr = -nr; ny = -ny; }
        for (let ring = 0; ring < 2; ring++) for (let j = 0; j < n; j++) {
            const a = j / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), y = ring ? y1 : y0, r = ring ? r1 : r0;
            V.push(r * ca, y, r * sa); Nn.push(nr * ca, ny, nr * sa);
        }
        for (let j = 0; j < n; j++) {
            const a = base + j, b = base + (j + 1) % n, c = base + n + (j + 1) % n, d = base + n + j;
            T.push(a, b, c, a, c, d); TM.push(mat, mat);
        }
    };
    const flat = (pts, n, mat) => {
        const base = V.length / 3;
        for (const p of pts) { V.push(p[0], p[1], p[2]); Nn.push(n[0], n[1], n[2]); }
        for (let i = 1; i < pts.length - 1; i++) { T.push(base, base + i, base + i + 1); TM.push(mat); }
    };
    const TC = [(R + Rr) / 2, 0], FC = [0, -1];
    band(-h + 0.03, R, h - 0.03, R, MAT.TIRE, TC);
    band(h - 0.03, R, h, R * 0.93, MAT.TIRE, TC);
    band(h, R * 0.93, h - 0.004, Rr * 1.04, MAT.TIRE, TC);
    band(-h, R * 0.93, -h + 0.03, R, MAT.TIRE, TC);
    band(h - 0.004, Rr * 1.04, h - 0.016, Rr * 0.97, MAT.RIM, FC, 36);
    band(h - 0.016, Rr * 0.97, h - 0.10, Rr * 0.95, MAT.RIMDARK, [0, -0.2], 36);
    flat(Array.from({ length: 24 }, (_, j) => { const a = j / 24 * Math.PI * 2; return [Math.cos(a) * Rr * 0.42, h - 0.10, Math.sin(a) * Rr * 0.42]; }), [0, 1, 0], MAT.RIMDARK);
    band(h - 0.10, Rr * 0.86, h - 0.10, Rr * 0.42, MAT.DISC, FC, 24);
    // ten spokes in five pairs, dished: a front face and two side faces each
    const S = 10, yLip = h - 0.016, yHub = h - 0.062, d = 0.028;
    for (let s = 0; s < S; s++) {
        const a = Math.floor(s / 2) / 5 * Math.PI * 2 + (s % 2 ? 0.075 : -0.075);
        const P = (r, da, y) => { const aa = a + da; return [Math.cos(aa) * r, y, Math.sin(aa) * r]; };
        const rs = [0.07, Rr * 0.5, Rr * 0.93], ys = [yHub, (yHub + yLip) / 2 + 0.006, yLip], half = [0.016, 0.013, 0.011];
        for (let k = 0; k < 2; k++) {
            const r0 = rs[k], r1 = rs[k + 1], w0 = half[k] / r0, w1 = half[k + 1] / r1;
            const A = P(r0, -w0, ys[k]), B = P(r1, -w1, ys[k + 1]), C = P(r1, w1, ys[k + 1]), Dd = P(r0, w0, ys[k]);
            const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = Dd[0] - A[0], vy = Dd[1] - A[1], vz = Dd[2] - A[2];
            let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; if (n[1] < 0) n = n.map((q) => -q);
            const l = Math.hypot(n[0], n[1], n[2]); n = n.map((q) => q / l);
            flat([A, B, C, Dd], n, MAT.RIM);
            const back = (p) => [p[0], p[1] - d, p[2]];
            const tn = (sign) => { const ta = a + sign * Math.PI / 2; return [Math.cos(ta), 0, Math.sin(ta)]; };
            flat([A, back(A), back(B), B], tn(-1), MAT.RIM);
            flat([Dd, C, back(C), back(Dd)], tn(1), MAT.RIM);
        }
    }
    flat(Array.from({ length: 16 }, (_, j) => { const a = j / 16 * Math.PI * 2; return [Math.cos(a) * 0.075, yHub + 0.004, Math.sin(a) * 0.075]; }), [0, 1, 0], MAT.RIM);
    flat(Array.from({ length: 12 }, (_, j) => { const a = j / 12 * Math.PI * 2; return [Math.cos(a) * 0.032, yHub + 0.008, Math.sin(a) * 0.032]; }), [0, 1, 0], MAT.RIMDARK);
    const nSolid = T.length / 3;
    band(h - 0.02, Rr * 0.965, h - 0.055, 0.075, MAT.BLUR, FC, 24);
    orient(V, Nn, T, 0, nSolid);
    return { V, N: Nn, T, TM, nSolid };
}
function caliperMesh(spec, w) {
    const Rr = spec.wheel.rim, h = w / 2, V = [], N = [], T = [], TM = [];
    const a0 = 1.95, a1 = 2.6, n = 7, y0 = h - 0.078, y1 = h - 0.118, r0 = Rr * 0.60, r1 = Rr * 0.90;
    for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n, ca = Math.cos(a), sa = Math.sin(a); V.push(r0 * ca, y0, r0 * sa, r1 * ca, y0, r1 * sa); N.push(0, 1, 0, 0, 1, 0); }
    for (let k = 0; k < n; k++) { const a = k * 2; T.push(a, a + 2, a + 3, a, a + 3, a + 1); TM.push(MAT.CALIPER, MAT.CALIPER); }
    const b2 = V.length / 3;
    for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n, ca = Math.cos(a), sa = Math.sin(a); V.push(r1 * ca, y0, r1 * sa, r1 * ca, y1, r1 * sa); N.push(ca, 0, sa, ca, 0, sa); }
    for (let k = 0; k < n; k++) { const a = b2 + k * 2; T.push(a, a + 2, a + 3, a, a + 3, a + 1); TM.push(MAT.CALIPER, MAT.CALIPER); }
    orient(V, N, T);
    return { V, N, T, TM, nSolid: T.length / 3 };
}

/* ---------- materials ---------- */
// c base, kd diffuse, r0 reflectance head-on, kf Fresnel gain, ks specular, metal (environment tinted
// by the base), e emissive, a opacity (glass, head-on)
const LEATHER = { black: [0.022, 0.022, 0.024], cognac: [0.22, 0.10, 0.045], red: [0.26, 0.025, 0.03], white: [0.55, 0.53, 0.50] };
function materials(paint, opt) {
    const p = paint, M = [];
    const m = (c, kd, r0, kf, ks, metal, e, a) => ({ c, kd, r0, kf, ks, metal: metal || 0, e: e || 0, a: a === undefined ? 1 : a });
    M[MAT.PAINT] = m([p[0], p[1], p[2]], 0.62, 0.045, 0.95, 1.2, 0.35 + p[3]);
    M[MAT.GLASS] = m([0.006, 0.008, 0.011], 0.15, 0.06, 1.0, 1.3, 0, 0, 0.5);
    M[MAT.TOP] = m([0.028, 0.028, 0.032], 1.0, 0.01, 0.06, 0.06);
    M[MAT.ROOF] = opt.blackRoof ? m([0.010, 0.010, 0.013], 0.6, 0.05, 0.85, 1.0) : M[MAT.PAINT];
    M[MAT.TRIM] = m([0.008, 0.008, 0.010], 0.5, 0.04, 0.65, 0.7);
    M[MAT.TIRE] = m([0.026, 0.026, 0.028], 0.9, 0.0, 0.08, 0.05);
    const rc = opt.rim === 'black' ? [0.022, 0.023, 0.026] : opt.rim === 'bronze' ? [0.30, 0.20, 0.10] : opt.rim === 'gunmetal' ? [0.12, 0.125, 0.135] : [0.46, 0.47, 0.50];
    M[MAT.RIM] = m(rc, 0.7, 0.28, 0.4, 1.1, 0.65);
    M[MAT.BLUR] = M[MAT.RIM];
    M[MAT.RIMDARK] = m([0.014, 0.014, 0.016], 0.6, 0.02, 0.1, 0.1);
    M[MAT.DISC] = m([0.20, 0.20, 0.21], 0.7, 0.15, 0.2, 0.6, 0.4);
    M[MAT.TAIL] = m([0.3, 0.01, 0.015], 0, 0, 0, 0, 0, [1.0, 0.06, 0.08]);
    M[MAT.TAILLENS] = m([0.10, 0.004, 0.008], 0.4, 0.06, 0.9, 1.0, 0, [0.18, 0.0, 0.01]);
    M[MAT.HEAD] = m([0.2, 0.2, 0.22], 0, 0, 0, 0, 0, [0.80, 0.90, 1.0]);
    M[MAT.LENS] = m([0.02, 0.022, 0.026], 0.3, 0.10, 1.0, 1.4);
    M[MAT.CHROME] = m([0.32, 0.33, 0.35], 0.25, 0.65, 0.35, 1.2, 0.4);
    M[MAT.PLATE] = m([0.70, 0.70, 0.66], 0.8, 0.03, 0.3, 0.2);
    M[MAT.GRILLE] = m([0.006, 0.006, 0.008], 0.4, 0.03, 0.45, 0.4);
    M[MAT.WELL] = m([0.004, 0.004, 0.005], 0.2, 0, 0, 0);
    M[MAT.DIFF] = m([0.012, 0.012, 0.014], 0.5, 0.03, 0.5, 0.6);
    const cc = opt.caliper === 'red' ? [0.55, 0.02, 0.02] : opt.caliper === 'grey' ? [0.2, 0.2, 0.22] : opt.caliper === 'gold' ? [0.55, 0.38, 0.06] : [0.02, 0.12, 0.62];
    M[MAT.CALIPER] = m(cc, 0.9, 0.05, 0.6, 0.8);
    M[MAT.INT] = m([0.020, 0.020, 0.022], 0.9, 0.02, 0.2, 0.2);
    M[MAT.SEAT] = m(LEATHER[opt.interior] || LEATHER.black, 1.0, 0.03, 0.3, 0.3);
    M[MAT.INTLIGHT] = m([0.05, 0.05, 0.06], 0.3, 0.05, 0.3, 0.4, 0, [0.05, 0.22, 0.55]);
    return M;
}

/* ---------- the studio (env frame: x = camera heading, y left, z up) ---------- */
const ENV = { r: 0, g: 0, b: 0 };
const LX = -0.40, LY = 0.32, LZ = 0.86;
function sstep(a, b, x) { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); }
function env(rx, ry, rz, accent) {
    if (rz < 0) {                    // the ground: dark, a little light from the pool around the car
        const k = Math.min(-rz * 3, 1);
        ENV.r = 0.030 - 0.020 * k; ENV.g = 0.034 - 0.022 * k; ENV.b = 0.046 - 0.028 * k;
        return;
    }
    const ay = Math.abs(ry), ax = Math.abs(rx);
    // a dark studio: a faint cool gradient
    let r = 0.020 + 0.03 * rz, g = 0.024 + 0.035 * rz, b = 0.034 + 0.05 * rz;
    // big soft boxes only: wide, smooth gradients sample cleanly at the vertices (no blotches)
    const top = sstep(0.18, 0.75, rz) * (1 - 0.55 * sstep(0.15, 0.6, ay));          // a broad overhead light
    const flank = sstep(0.45, 0.95, ay) * sstep(0.0, 0.35, rz) * (1 - sstep(0.55, 0.9, rz));
    const ahead = sstep(0.2, 0.9, rx) * sstep(0.0, 0.12, rz) * (1 - sstep(0.25, 0.55, rz));
    const over = sstep(0.0, -0.7, rx) * sstep(0.25, 0.6, rz);
    r += top * 0.95 + flank * 0.85 + ahead * 1.2 + over * 0.45;
    g += top * 0.98 + flank * 0.88 + ahead * 1.15 + over * 0.47;
    b += top * 1.05 + flank * 0.95 + ahead * 1.05 + over * 0.50;
    // horizon band: blue to the left, red to the right, warm behind (the UI's colours)
    const hb = (1 - sstep(0.0, 0.16, rz)) * accent;
    const left = sstep(-0.2, 0.6, ry), right = sstep(-0.2, 0.6, -ry), back = sstep(0, 0.8, -rx);
    r += hb * (0.10 * left + 0.95 * right + 0.60 * back);
    g += hb * (0.32 * left + 0.10 * right + 0.52 * back);
    b += hb * (1.10 * left + 0.26 * right + 0.46 * back);
    ENV.r = r; ENV.g = g; ENV.b = b;
}
function aces(x) { return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14); }

class CarRenderer {
    constructor(spec, opt) {
        this.opt = Object.assign({ paint: [0.02, 0.09, 0.42, 0.55], rim: 'silver', caliper: 'blue', blackRoof: false, accent: 1, interior: 'black', style: 'ghost', ghostBack: true }, opt || {});
        this.tint = [0.0, 0.63, 0.84];     // ghost rim colour, set per frame (the drift angle's colour)
        this.setSpec(spec);
    }
    setSpec(spec) {
        this.spec = spec;
        const body = this.body = spec.model ? buildModel(spec) : build(spec);
        this.M = materials(this.opt.paint, this.opt);
        const parts = [{ V: body.V, N: body.N, T: body.T, TM: body.TM, nSolid: body.T.length / 3, AO: body.AO }];
        const ws = [spec.wheel.wf, spec.wheel.wf, spec.wheel.wr, spec.wheel.wr];
        for (let i = 0; i < 4; i++) parts.push(wheelMesh(spec, ws[i]));
        for (let i = 0; i < 4; i++) parts.push(caliperMesh(spec, ws[i]));
        const W = spec.wheel;
        this.wpos = [[body.AXF, W.trackF / 2, 1], [body.AXF, -W.trackF / 2, -1], [body.AXR, W.trackR / 2, 1], [body.AXR, -W.trackR / 2, -1]];
        let nv = 0, nt = 0;
        for (const p of parts) { nv += p.V.length / 3; nt += p.T.length / 3; }
        this.nv = nv; this.nt = nt;
        this.LV = new Float32Array(nv * 3); this.LN = new Float32Array(nv * 3); this.AO = new Float32Array(nv);
        this.TI = new Uint32Array(nt * 3); this.TMat = new Uint8Array(nt); this.TPart = new Uint8Array(nt); this.TBlur = new Uint8Array(nt);
        this.VPart = new Uint8Array(nv);
        let vo = 0, to = 0;
        parts.forEach((p, pi) => {
            const n = p.V.length / 3, side = pi >= 1 && pi <= 4 ? this.wpos[pi - 1][2] : pi >= 5 ? this.wpos[pi - 5][2] : 1;
            for (let i = 0; i < n; i++) {
                this.LV[(vo + i) * 3] = p.V[i * 3]; this.LV[(vo + i) * 3 + 1] = p.V[i * 3 + 1] * side; this.LV[(vo + i) * 3 + 2] = p.V[i * 3 + 2];
                this.LN[(vo + i) * 3] = p.N[i * 3]; this.LN[(vo + i) * 3 + 1] = p.N[i * 3 + 1] * side; this.LN[(vo + i) * 3 + 2] = p.N[i * 3 + 2];
                this.AO[vo + i] = p.AO ? p.AO[i] : 0.85;
                this.VPart[vo + i] = pi;
            }
            const m = p.T.length / 3;
            for (let t = 0; t < m; t++) {
                this.TI[(to + t) * 3] = p.T[t * 3] + vo; this.TI[(to + t) * 3 + 1] = p.T[t * 3 + 1] + vo; this.TI[(to + t) * 3 + 2] = p.T[t * 3 + 2] + vo;
                this.TMat[to + t] = p.TM[t]; this.TPart[to + t] = pi; this.TBlur[to + t] = t >= p.nSolid ? 1 : 0;
            }
            vo += n; to += m;
        });
        this.FN = new Float32Array(nt * 3);
        for (let t = 0; t < nt; t++) {
            const a = this.TI[t * 3], b = this.TI[t * 3 + 1], c = this.TI[t * 3 + 2], V = this.LV, LN = this.LN;
            const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
            const vx = V[c * 3] - V[a * 3], vy = V[c * 3 + 1] - V[a * 3 + 1], vz = V[c * 3 + 2] - V[a * 3 + 2];
            let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            // the winding is the truth: every mesh is oriented (car/orient.js) before it gets here. Vertex
            // normals at a border are shared with the neighbouring surface and may look elsewhere.
            const l = Math.hypot(nx, ny, nz) || 1;
            this.FN[t * 3] = nx / l; this.FN[t * 3 + 1] = ny / l; this.FN[t * 3 + 2] = nz / l;
        }
        this.S = new Float32Array(nv * 3); this.W = new Float32Array(nv * 3);
        this.Lt = new Float32Array(nv * 7); this.Lstamp = new Uint32Array(nv); this.stamp = 0;
        this.Cs = new Uint32Array(nv); this.Cm = new Uint8Array(nv); this.Cc = new Uint32Array(nv);
        this.front = new Uint8Array(nt); this.tkey = new Float32Array(nt);
        this.decals = body.decals.map((d) => ({ mat: d.mat, n: d.n, p: Float32Array.from(d.p), np: d.p.length / 3, idx: null, scr: new Float32Array(d.p.length / 3 * 2), wc: [0, 0, 0] }));
        this.decals.forEach((d) => {
            const ax = Math.abs(d.n[0]) > 0.6 ? 0 : 2, fl = [];
            for (let i = 0; i < d.np; i++) fl.push(ax === 0 ? d.p[i * 3 + 1] : d.p[i * 3], ax === 0 ? d.p[i * 3 + 2] : d.p[i * 3 + 1]);
            d.idx = d.np > 3 && !isConvex(fl, d.np) ? poly.triangulate(fl, d.np) : null;
        });
        this.pipes = body.pipes.map((p) => ({ mat: p.mat, n: p.n, p: Float32Array.from(p.p), np: p.p.length / 3, w: p.w, scr: new Float32Array(p.p.length) }));
        this.lines = body.lines.map((l) => ({ kind: l.kind, p: Float32Array.from(l.p), n: Float32Array.from(l.n), np: l.p.length / 3, scr: new Float32Array(l.p.length), vis: new Uint8Array(l.p.length / 3) }));
        let np2 = 0; for (const p of this.pipes) np2 += p.np; for (const l of this.lines) np2 += l.np;
        const maxItems = nt + this.decals.length + body.E.length / 4 + body.EI.length / 4 + np2 + 64;
        this.ikey = new Float32Array(maxItems); this.iref = new Int32Array(maxItems); this.sorted = new Int32Array(maxItems);
        this.bucket = new Uint32Array(2049);
        this.glowPool = []; this.nglow = 0; this.glows = [];
        this.mx = new Float64Array(9 * 9); this.mt = new Float64Array(3 * 9);
        this.stats = { tris: 0, items: 0 };
        this.spin = [0, 0, 0, 0];
        this.edgeTri = new Int32Array(body.E.length / 4);
        this.crease = new Uint8Array(body.E.length / 4);
        // a low-poly model's facets meet at 10-30 degrees all over: only its real creases (~38+) are lines
        const creaseCos = spec.model ? 0.79 : 0.93;
        for (let e = 0; e < body.E.length / 4; e++) {
            const t1 = body.E[e * 4 + 2], t2 = body.E[e * 4 + 3];
            if (t2 < 0) continue;
            const d = this.FN[t1 * 3] * this.FN[t2 * 3] + this.FN[t1 * 3 + 1] * this.FN[t2 * 3 + 1] + this.FN[t1 * 3 + 2] * this.FN[t2 * 3 + 2];
            if (d < creaseCos) this.crease[e] = 1;
        }
        // the interior's creases, as the shell's: faces meeting at more than ~21 degrees
        this.creaseI = new Uint8Array(body.EI.length / 4);
        for (let e = 0; e < body.EI.length / 4; e++) {
            const t1 = body.EI[e * 4 + 2], t2 = body.EI[e * 4 + 3];
            if (t2 < 0) { this.creaseI[e] = 1; continue; }
            const d = this.FN[t1 * 3] * this.FN[t2 * 3] + this.FN[t1 * 3 + 1] * this.FN[t2 * 3 + 1] + this.FN[t1 * 3 + 2] * this.FN[t2 * 3 + 2];
            if (d < 0.93) this.creaseI[e] = 1;
        }
        // ghost: inside parts are hidden, except in an open car, where the cockpit is the point
        const INTERIOR = spec.open ? [MAT.RIMDARK, MAT.DISC, MAT.CALIPER] : [MAT.INT, MAT.SEAT, MAT.INTLIGHT, MAT.RIMDARK, MAT.DISC, MAT.CALIPER];
        this.hideGhost = new Uint8Array(32); INTERIOR.forEach((m) => { this.hideGhost[m] = 1; });
        this.dn = new Float64Array(3); this.T6 = new Float32Array(7);
    }

    /** st: x, y, yaw, roll, pitch (rad), steer (front road wheels), wheelSpeed [4] rad/s, brake 0..1, dt */
    draw(rec, cam, st) {
        const spec = this.spec, body = this.body, mx = this.mx, mt = this.mt;
        this.stamp++;
        const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
        const cr = Math.cos(st.roll || 0), sr = Math.sin(st.roll || 0), cp = Math.cos(st.pitch || 0), sp = Math.sin(st.pitch || 0);
        const r00 = cp, r01 = sp * sr, r02 = sp * cr, r10 = 0, r11 = cr, r12 = -sr, r20 = -sp, r21 = cp * sr, r22 = cp * cr;
        const setPart = (pi, a00, a01, a02, a10, a11, a12, a20, a21, a22, tx, ty, tz) => {
            const o = pi * 9;
            mx[o] = cy * a00 - sy * a10; mx[o + 1] = cy * a01 - sy * a11; mx[o + 2] = cy * a02 - sy * a12;
            mx[o + 3] = sy * a00 + cy * a10; mx[o + 4] = sy * a01 + cy * a11; mx[o + 5] = sy * a02 + cy * a12;
            mx[o + 6] = a20; mx[o + 7] = a21; mx[o + 8] = a22;
            mt[pi * 3] = st.x + cy * tx - sy * ty; mt[pi * 3 + 1] = st.y + sy * tx + cy * ty; mt[pi * 3 + 2] = tz;
        };
        const pz = 0.45;
        setPart(0, r00, r01, r02, r10, r11, r12, r20, r21, r22, -(r02 * pz), -(r12 * pz), pz - r22 * pz);
        // a paused replay passes dt = 0: the wheels must stop with it (0 is not 'unknown')
        const dt = typeof st.dt === 'number' ? st.dt : 1 / 60, rolling = (st.speed === undefined || st.speed > 0.3);
        for (let i = 0; i < 4; i++) {
            const wx = this.wpos[i][0], wy = this.wpos[i][1];
            // a standing car's wheels stand: sensor noise below ~0.5 rad/s (under 1 km/h) is no rotation
            const steer = i < 2 ? (st.steer || 0) : 0, w0 = st.wheelSpeed ? st.wheelSpeed[i] : 0, ws = Math.abs(w0) < 0.5 || (!rolling && Math.abs(w0) < 3) ? 0 : w0;
            this.spin[i] = (this.spin[i] + ws * dt) % (Math.PI * 2);
            const cs = Math.cos(steer), ss = Math.sin(steer), ca = Math.cos(-this.spin[i]), sa = Math.sin(-this.spin[i]);
            setPart(1 + i, cs * ca, -ss, cs * sa, ss * ca, cs, ss * sa, -sa, 0, ca, wx, wy, spec.wheel.r);
            setPart(5 + i, cs, -ss, 0, ss, cs, 0, 0, 0, 1, wx, wy, spec.wheel.r);
        }
        const ghost = this.opt.style === 'ghost';
        this.ghost = ghost;
        const blurK = Math.min(1, Math.max(0, (Math.abs(st.wheelSpeed ? st.wheelSpeed[2] : 0) - 7) / 20));

        const LV = this.LV, S = this.S, Wp = this.W, VP = this.VPart, nv = this.nv;
        const camR = cam.R, cxp = cam.x, cyp = cam.y, czp = cam.z, f = cam.f, ccx = cam.cx, ccy = cam.cy;
        for (let v = 0; v < nv; v++) {
            const pi = VP[v], o = pi * 9, t = pi * 3, lx = LV[v * 3], ly = LV[v * 3 + 1], lz = LV[v * 3 + 2];
            const wx = mx[o] * lx + mx[o + 1] * ly + mx[o + 2] * lz + mt[t];
            const wy = mx[o + 3] * lx + mx[o + 4] * ly + mx[o + 5] * lz + mt[t + 1];
            const wz = mx[o + 6] * lx + mx[o + 7] * ly + mx[o + 8] * lz + mt[t + 2];
            Wp[v * 3] = wx; Wp[v * 3 + 1] = wy; Wp[v * 3 + 2] = wz;
            const dx = wx - cxp, dy = wy - cyp, dz = wz - czp;
            const zc = camR[6] * dx + camR[7] * dy + camR[8] * dz, k = f / Math.max(zc, 0.2);
            S[v * 3] = ccx + (camR[0] * dx + camR[1] * dy + camR[2] * dz) * k;
            S[v * 3 + 1] = ccy - (camR[3] * dx + camR[4] * dy + camR[5] * dz) * k;
            S[v * 3 + 2] = zc;
        }
        const TI = this.TI, FN = this.FN, TP = this.TPart, nt = this.nt, front = this.front, tkey = this.tkey;
        const ikey = this.ikey, iref = this.iref;
        let ni = 0;
        for (let t = 0; t < nt; t++) {
            if ((this.TBlur[t] && blurK < 0.04) || (ghost && this.hideGhost[this.TMat[t]])) { front[t] = 0; continue; }
            const a = TI[t * 3], b = TI[t * 3 + 1], c = TI[t * 3 + 2], o = TP[t] * 9;
            const fx = FN[t * 3], fy = FN[t * 3 + 1], fz = FN[t * 3 + 2];
            const nx = mx[o] * fx + mx[o + 1] * fy + mx[o + 2] * fz, ny = mx[o + 3] * fx + mx[o + 4] * fy + mx[o + 5] * fz, nz = mx[o + 6] * fx + mx[o + 7] * fy + mx[o + 8] * fz;
            const facing = nx * (cxp - Wp[a * 3]) + ny * (cyp - Wp[a * 3 + 1]) + nz * (czp - Wp[a * 3 + 2]) > 0;
            const key = (S[a * 3 + 2] + S[b * 3 + 2] + S[c * 3 + 2]) * (1 / 3);
            tkey[t] = key;
            if (!facing) {
                front[t] = 0;
                // the ghost is see-through: its faces show from behind as well, as transparent as from the front
                if (!(ghost && (t >= body.intStart && t < body.intEnd || (this.opt.ghostBack && TP[t] === 0)))) continue;
            } else front[t] = 1;
            ikey[ni] = key; iref[ni] = t; ni++;
        }
        const P3 = this.P3 || (this.P3 = new Float64Array(3));
        const proj = (lx, ly, lz, out, o2) => {
            const wx = mx[0] * lx + mx[1] * ly + mx[2] * lz + mt[0], wy = mx[3] * lx + mx[4] * ly + mx[5] * lz + mt[1], wz = mx[6] * lx + mx[7] * ly + mx[8] * lz + mt[2];
            const dx = wx - cxp, dy = wy - cyp, dz = wz - czp, zc = camR[6] * dx + camR[7] * dy + camR[8] * dz, k = f / Math.max(zc, 0.2);
            out[o2] = ccx + (camR[0] * dx + camR[1] * dy + camR[2] * dz) * k; out[o2 + 1] = ccy - (camR[3] * dx + camR[4] * dy + camR[5] * dz) * k;
            P3[0] = wx; P3[1] = wy; P3[2] = wz;
            return zc;
        };
        const facing = (n, wx, wy, wz) => (mx[0] * n[0] + mx[1] * n[1] + mx[2] * n[2]) * (cxp - wx) + (mx[3] * n[0] + mx[4] * n[1] + mx[5] * n[2]) * (cyp - wy) + (mx[6] * n[0] + mx[7] * n[1] + mx[8] * n[2]) * (czp - wz) > 0;
        for (let i = 0; i < this.decals.length; i++) {
            const d = this.decals[i];
            let kz = 0, sx = 0, sy2 = 0, sz = 0;
            for (let j = 0; j < d.np; j++) { kz += proj(d.p[j * 3], d.p[j * 3 + 1], d.p[j * 3 + 2], d.scr, j * 2); sx += P3[0]; sy2 += P3[1]; sz += P3[2]; }
            sx /= d.np; sy2 /= d.np; sz /= d.np;
            if (!facing(d.n, sx, sy2, sz)) continue;
            d.wc[0] = sx; d.wc[1] = sy2; d.wc[2] = sz;
            ikey[ni] = kz / d.np - 0.035; iref[ni] = (1 << 24) | i; ni++;
        }
        for (let i = 0; i < this.pipes.length; i++) {
            const pp = this.pipes[i];
            let sx = 0, sy2 = 0, sz = 0;
            for (let j = 0; j < pp.np; j++) { pp.scr[j * 3 + 2] = proj(pp.p[j * 3], pp.p[j * 3 + 1], pp.p[j * 3 + 2], pp.scr, j * 3); sx += P3[0]; sy2 += P3[1]; sz += P3[2]; }
            if (!facing(pp.n, sx / pp.np, sy2 / pp.np, sz / pp.np)) continue;
            for (let j = 0; j < pp.np - 1; j++) { ikey[ni] = (pp.scr[j * 3 + 2] + pp.scr[j * 3 + 5]) / 2 - 0.04; iref[ni] = (4 << 24) | (i << 12) | j; ni++; }
        }
        for (let li = 0; li < this.lines.length; li++) {
            const l = this.lines[li];
            for (let j = 0; j < l.np; j++) {
                l.scr[j * 3 + 2] = proj(l.p[j * 3], l.p[j * 3 + 1], l.p[j * 3 + 2], l.scr, j * 3);
                const nx = mx[0] * l.n[j * 3] + mx[1] * l.n[j * 3 + 1] + mx[2] * l.n[j * 3 + 2], ny = mx[3] * l.n[j * 3] + mx[4] * l.n[j * 3 + 1] + mx[5] * l.n[j * 3 + 2], nz = mx[6] * l.n[j * 3] + mx[7] * l.n[j * 3 + 1] + mx[8] * l.n[j * 3 + 2];
                const dx = P3[0] - cxp, dy = P3[1] - cyp, dz = P3[2] - czp;
                l.vis[j] = -(nx * dx + ny * dy + nz * dz) > 0.12 * Math.sqrt(dx * dx + dy * dy + dz * dz) ? 1 : 0;
            }
            for (let j = 0; j < l.np - 1; j++) {
                if (!l.vis[j] || !l.vis[j + 1]) continue;
                ikey[ni] = (l.scr[j * 3 + 2] + l.scr[j * 3 + 5]) / 2 - 0.02; iref[ni] = (2 << 24) | (li << 12) | j; ni++;
            }
        }
        const E = body.E, TMat = this.TMat, ne = E.length / 4;
        for (let e = 0; e < ne; e++) {
            const t1 = E[e * 4 + 2], t2 = E[e * 4 + 3];
            // the end caps are flat: their own edges are never outlines (the body's last ring draws the rim)
            if (t1 >= body.capStart && (t2 < 0 || t2 >= body.capStart)) continue;
            const f1 = front[t1], f2 = t2 >= 0 ? front[t2] : 0;
            if (!f1 && !f2) continue;
            let ft = -1, seam = 0;
            if (f1 && !f2) ft = t1; else if (f2 && !f1) ft = t2;
            else if (TMat[t1] !== TMat[t2]) { ft = tkey[t1] < tkey[t2] ? t1 : t2; seam = (TMat[t1] === MAT.GLASS || TMat[t2] === MAT.GLASS) ? 1 : 2; }
            else if (ghost && this.crease[e]) { ft = tkey[t1] < tkey[t2] ? t1 : t2; seam = 3; }
            if (ft < 0) continue;
            ikey[ni] = tkey[ft] - 0.004; iref[ni] = (3 << 24) | (seam << 22) | e; ni++;
            this.edgeTri[e] = ft;
        }
        // ghost: the interior drawn the way the shell is (type 5): its outline where a face turns away
        // from the camera (a silhouette), its creases softer; a smooth stretch has no lines
        if (ghost) {
            const EI = body.EI, CI = this.creaseI;
            for (let e = 0; e < EI.length / 4; e++) {
                const t1 = EI[e * 4 + 2], t2 = EI[e * 4 + 3];
                if (this.hideGhost[TMat[t1]]) continue;
                const f1 = front[t1], f2 = t2 >= 0 ? front[t2] : 0;
                let seam;
                if (f1 !== f2 && t2 >= 0) seam = 0; else if (CI[e] && (f1 || f2)) seam = 3; else continue;
                ikey[ni] = (f1 ? tkey[t1] : tkey[t2 >= 0 ? t2 : t1]) - 0.003; iref[ni] = (5 << 24) | (seam << 22) | e; ni++;
            }
        }
        let kmin = 1e9, kmax = -1e9;
        for (let i = 0; i < ni; i++) { const k = ikey[i]; if (k < kmin) kmin = k; if (k > kmax) kmax = k; }
        const NB = 2048, bk = this.bucket, sorted = this.sorted;
        bk.fill(0);
        const scale = (NB - 1) / Math.max(kmax - kmin, 1e-6);
        for (let i = 0; i < ni; i++) bk[(NB - 1 - ((ikey[i] - kmin) * scale | 0)) + 1]++;
        for (let b = 1; b <= NB; b++) bk[b] += bk[b - 1];
        for (let i = 0; i < ni; i++) { const b = NB - 1 - ((ikey[i] - kmin) * scale | 0); sorted[bk[b]++] = i; }

        this.nglow = 0;
        this._ce = Math.cos(cam.yaw); this._se = Math.sin(cam.yaw); this._cam = cam; this._brake = st.brake || 0;
        let tris = 0;
        for (let s2 = 0; s2 < ni; s2++) {
            const r = iref[sorted[s2]], type = r >>> 24;
            if (this.opt.skip && this.opt.skip[type]) continue;   // debugging: leave out a kind of item
            if (type === 0) {
                const t = r, a = TI[t * 3], b = TI[t * 3 + 1], c = TI[t * 3 + 2], m = TMat[t];
                let ca = this.shade(a, m), cb = this.shade(b, m), cc = this.shade(c, m);
                if (this.TBlur[t]) { ca = fade(ca, blurK * 0.85); cb = fade(cb, blurK * 0.85); cc = fade(cc, blurK * 0.85); }
                rec.tri(S[a * 3], S[a * 3 + 1], ca, S[b * 3], S[b * 3 + 1], cb, S[c * 3], S[c * 3 + 1], cc);
                tris++;
            } else if (type === 1) {
                const d = this.decals[r & 0xffffff], n = this.dn;
                n[0] = mx[0] * d.n[0] + mx[1] * d.n[1] + mx[2] * d.n[2]; n[1] = mx[3] * d.n[0] + mx[4] * d.n[1] + mx[5] * d.n[2]; n[2] = mx[6] * d.n[0] + mx[7] * d.n[1] + mx[8] * d.n[2];
                poly.fill(rec, d.scr, d.np, ghost && !this.M[d.mat].e ? this.ghostLine(d.mat === MAT.CHROME ? 0.35 : 0.12) : this.shadeFlat(n, d.wc, d.mat), d.idx, 1);
            } else if (type === 4) {
                const pi2 = (r >> 12) & 0xfff, j = r & 0xfff, pp = this.pipes[pi2];
                const z = (pp.scr[j * 3 + 2] + pp.scr[j * 3 + 5]) / 2, wpx = Math.max(0.9, pp.w * f / z);
                const M = this.M[pp.mat];
                let col;
                if (M.e) {
                    const k = pp.mat === MAT.TAIL ? 0.55 + 0.6 * this._brake : 1;
                    col = pk(aces(M.e[0] * 2.2 * k), aces(M.e[1] * 2.2 * k + 0.05), aces(M.e[2] * 2.2 * k + 0.05), 1);
                    const g = this.glowPool[this.nglow] || (this.glowPool[this.nglow] = { x: 0, y: 0, w: 0, mat: 0 });
                    g.x = (pp.scr[j * 3] + pp.scr[j * 3 + 3]) / 2; g.y = (pp.scr[j * 3 + 1] + pp.scr[j * 3 + 4]) / 2;
                    g.w = Math.max(14, Math.hypot(pp.scr[j * 3 + 3] - pp.scr[j * 3], pp.scr[j * 3 + 4] - pp.scr[j * 3 + 1]) + wpx * 8); g.mat = pp.mat; this.nglow++;
                } else col = ghost ? this.ghostLine(pp.mat === MAT.CHROME ? 0.55 : 0.25) : pp.mat === MAT.CHROME ? 0xb9bfc8ff : 0x050506e6;
                rec.line(pp.scr[j * 3], pp.scr[j * 3 + 1], pp.scr[j * 3 + 3], pp.scr[j * 3 + 4], wpx, col);
            } else if (type === 5) {
                const e = r & 0x3fffff, seam = (r >> 22) & 3, EI = body.EI, a = EI[e * 4], b = EI[e * 4 + 1];
                rec.line(S[a * 3], S[a * 3 + 1], S[b * 3], S[b * 3 + 1], seam === 0 ? 1.4 : 1.0, this.ghostLine(seam === 0 ? 0.8 : 0.34));
            } else if (type === 2) {
                const li = (r >> 12) & 0xfff, j = r & 0xfff, l = this.lines[li];
                const c = ghost ? this.ghostLine(l.kind === 'sig' ? 0.75 : l.kind === 'handle' ? 0.6 : 0.32) : l.kind === 'shut' ? 0x00000090 : l.kind === 'handle' ? 0xd0d6e0aa : l.kind === 'sig' ? 0xffffff22 : 0x000000b0;
                rec.line(l.scr[j * 3], l.scr[j * 3 + 1], l.scr[j * 3 + 3], l.scr[j * 3 + 4], l.kind === 'shut' ? 1.15 : l.kind === 'handle' ? 2.2 : l.kind === 'sig' ? 1.5 : 1.8, c);
            } else {
                const e = r & 0x3fffff, seam = (r >> 22) & 3, a = E[e * 4], b = E[e * 4 + 1];
                if (ghost) {
                    // the hologram's outline: silhouettes brightest, creases and seams softer
                    rec.line(S[a * 3], S[a * 3 + 1], S[b * 3], S[b * 3 + 1], seam === 0 ? 1.6 : 1.15, this.ghostLine(seam === 0 ? 0.95 : seam === 3 ? 0.55 : 0.45));
                } else if (seam === 1) rec.line(S[a * 3], S[a * 3 + 1], S[b * 3], S[b * 3 + 1], 1.5, 0x020203d8);
                else {
                    const m = TMat[this.edgeTri[e]];
                    rec.line(S[a * 3], S[a * 3 + 1], S[b * 3], S[b * 3 + 1], 1.0, mixc(this.shade(a, m), this.shade(b, m)));
                }
            }
        }
        // a model's lamps: one halo per lit group
        if (body.glow) for (const g of body.glow) {
            const out = this._gp || (this._gp = new Float32Array(2));
            const z = proj(g.p[0], g.p[1], g.p[2], out, 0);
            if (z < 0.5) continue;
            const q = this.glowPool[this.nglow] || (this.glowPool[this.nglow] = { x: 0, y: 0, w: 0, mat: 0 });
            q.x = out[0]; q.y = out[1]; q.w = 0.55 * f / z; q.mat = g.mat; this.nglow++;
        }
        this.stats.tris = tris; this.stats.items = ni;
        this.glows = this.glowPool.slice(0, this.nglow);
    }

    light(v) {
        if (this.Lstamp[v] === this.stamp) return;
        this.Lstamp[v] = this.stamp;
        const o = this.VPart[v] * 9, mx = this.mx, LN = this.LN;
        const lx = LN[v * 3], ly = LN[v * 3 + 1], lz = LN[v * 3 + 2];
        const W = this.W, cam = this._cam;
        const vx = cam.x - W[v * 3], vy = cam.y - W[v * 3 + 1], vz = cam.z - W[v * 3 + 2];
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
        this._terms(mx[o] * lx + mx[o + 1] * ly + mx[o + 2] * lz, mx[o + 3] * lx + mx[o + 4] * ly + mx[o + 5] * lz, mx[o + 6] * lx + mx[o + 7] * ly + mx[o + 8] * lz,
            vx / vl, vy / vl, vz / vl, v * 7, this.Lt, this.AO[v]);
    }
    _terms(wnx, wny, wnz, vx, vy, vz, o, out, ao) {
        const ce = this._ce, se = this._se;
        const nx = wnx * ce + wny * se, ny = -wnx * se + wny * ce, nz = wnz;
        const ex = vx * ce + vy * se, ey = -vx * se + vy * ce, ez = vz;
        let ndv = nx * ex + ny * ey + nz * ez; if (ndv < 0) ndv = this.ghost ? -ndv : 0;
        const fr = 1 - ndv, fr2 = fr * fr, F = fr2 * fr2 * fr;
        const rx = 2 * ndv * nx - ex, ry = 2 * ndv * ny - ey, rz = 2 * ndv * nz - ez;
        env(rx, ry, rz, this.opt.accent);
        let dif = nx * LX + ny * LY + nz * LZ; if (dif < 0) dif = 0;
        let rl = rx * LX + ry * LY + rz * LZ; if (rl < 0) rl = 0;
        const r2 = rl * rl, r4 = r2 * r2, r8 = r4 * r4, r16 = r8 * r8, r32 = r16 * r16, spec = r32 * r32 * r8;
        out[o] = dif; out[o + 1] = F; out[o + 2] = ENV.r; out[o + 3] = ENV.g; out[o + 4] = ENV.b; out[o + 5] = spec; out[o + 6] = ao;
    }
    /** a hologram line colour with alpha a, in the rim tint */
    ghostLine(a) { const t = this.tint; return pk(aces(0.35 + t[0] * 1.3), aces(0.38 + t[1] * 1.3), aces(0.45 + t[2] * 1.3), a); }
    _mat(L, o, m) {
        const M = this.M[m];
        if (this.ghost && (!M.e || m === MAT.INTLIGHT)) {
            // ghost: see-through where you look straight at it, glowing where the surface turns away
            // no lights on it: nothing reflects, nothing is lit from one side; only the view angle (the rim) counts
            const F = L[o + 1], ao = L[o + 6], t = this.tint;
            const rim = Math.pow(F, 0.55), dark = m === MAT.TIRE || m === MAT.TRIM || m === MAT.GRILLE || m === MAT.DIFF ? 0.45 : m === MAT.GLASS ? 0.7 : 1;
            const base = 0.26 * ao * dark;
            const inside = m === MAT.SEAT || m === MAT.INT || m === MAT.INTLIGHT;
            if (inside) {
                // the cabin is part of the same ghost: one even tone that hardly changes as the car turns
                // (a rim term here makes the seats flash on and off with the view angle)
                // the body's own dark base tone, lightly tinted; low alpha because the layers add up
                const k = 0.16 + 0.10 * ao;
                return pk(aces(0.07 + t[0] * k), aces(0.08 + t[1] * k), aces(0.10 + t[2] * k), 0.10 + 0.03 * rim);
            }
            const r = base * 0.75 + t[0] * rim * 1.55 * dark, g = base * 0.85 + t[1] * rim * 1.55 * dark, b = base * 1.0 + t[2] * rim * 1.55 * dark;
            const a = Math.min(0.88, (0.16 + 0.72 * rim) * (0.55 + 0.45 * dark));
            return pk(aces(r), aces(g), aces(b), a);
        }
        const dif = L[o], F = L[o + 1], er = L[o + 2], eg = L[o + 3], eb = L[o + 4], sp = L[o + 5], ao = L[o + 6];
        const kr = (M.r0 + (1 - M.r0) * F * M.kf) * (0.55 + 0.45 * ao), amb = 0.07 * ao, kd = M.kd * (0.35 + 0.65 * ao);
        let r = M.c[0] * (amb + kd * dif) + er * kr + M.c[0] * er * M.metal * 2.4 + sp * M.ks * ao;
        let g = M.c[1] * (amb + kd * dif) + eg * kr + M.c[1] * eg * M.metal * 2.4 + sp * M.ks * ao;
        let b = M.c[2] * (amb + kd * dif) + eb * kr + M.c[2] * eb * M.metal * 2.4 + sp * M.ks * ao;
        if (M.e) { const k = m === MAT.TAILLENS ? 0.55 + 0.75 * this._brake : 1; r += M.e[0] * k; g += M.e[1] * k; b += M.e[2] * k; }
        const a = M.a < 1 ? Math.min(1, M.a + 0.55 * F + 0.25 * Math.min(1, er + eg + eb)) : 1;
        return pk(aces(r), aces(g), aces(b), a);
    }
    shade(v, m) {
        if (this.Cs[v] === this.stamp && this.Cm[v] === m) return this.Cc[v];
        this.light(v);
        const c = this._mat(this.Lt, v * 7, m);
        this.Cs[v] = this.stamp; this.Cm[v] = m; this.Cc[v] = c;
        return c;
    }
    shadeFlat(n, c, m) {
        const cam = this._cam;
        const vx = cam.x - c[0], vy = cam.y - c[1], vz = cam.z - c[2];
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
        this._terms(n[0], n[1], n[2], vx / vl, vy / vl, vz / vl, 0, this.T6, 0.9);
        return this._mat(this.T6, 0, m);
    }
}
function mixc(a, b) {
    return ((((a >>> 24) + (b >>> 24)) >> 1) << 24 | ((((a >>> 16) & 255) + ((b >>> 16) & 255)) >> 1) << 16 | ((((a >>> 8) & 255) + ((b >>> 8) & 255)) >> 1) << 8 | Math.min(a & 255, b & 255)) >>> 0;
}
function isConvex(p, n) {
    let sg = 0;
    for (let i = 0; i < n; i++) {
        const a = i, b = (i + 1) % n, c = (i + 2) % n;
        const cr = (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[b * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[b * 2]);
        if (Math.abs(cr) < 1e-12) continue;
        const s = cr > 0 ? 1 : -1;
        if (sg && s !== sg) return false;
        sg = s;
    }
    return true;
}

module.exports = { CarRenderer, LEATHER };
