'use strict';
/**
 * body.js - a car body, built once at start-up, for any body style (presets.js).
 *
 * Car frame: x forward (m), y left, z up; origin on the ground, midway between the axles.
 *
 * The body is a grid of stations along x. Each station is a cross-section through eleven
 * control points per side:
 *
 *   p0 rocker underside   p1 sill edge*     p2 lower door (concave)   p3 mid door
 *   p4 shoulder crease*   p5 upper door     p6 belt / fender top*      p7 side glass
 *   p8 roof edge / hood crease*            p9 roof / hood crown       p10 centre line
 *
 * Points marked * are hard edges: the mesh splits its vertices there, so the normals break and
 * the light draws a crisp character line, as on a real car. Some stations are hard too
 * (windscreen base and header, the rear glass, the trunk lip, the rear face's edge).
 * Materials follow the grid (paint, glass, roof, pillars, sill), so every material border is a
 * mesh edge and gets an anti-aliased seam. Glass is see-through: inside are the seats, the
 * dashboard, the steering wheel and the console. Over the wheels the lower points follow the
 * arch line, which opens the arches. Lamps, grille, diffuser and exhausts are decals and
 * light pipes (glowing lines); the mirrors are small meshes of their own.
 * Every vertex carries an ambient-occlusion factor (ground, arches, crevices), computed here.
 */

const { triangulate } = require('../engine/poly');
const { orient } = require('./orient');
const { subdivide, ek } = require('./subd');

const MAT = { PAINT: 0, GLASS: 1, TOP: 2, TRIM: 3, TIRE: 4, RIM: 5, RIMDARK: 6, TAIL: 7, HEAD: 8, CHROME: 9, PLATE: 10,
    GRILLE: 11, WELL: 12, DIFF: 13, CALIPER: 14, ROOF: 15, BLUR: 16, INT: 17, INTLIGHT: 18, SEAT: 19, LENS: 20, TAILLENS: 21, DISC: 22 };

/* ---------- curves ---------- */
function monotone(xs, ys) {
    const n = xs.length, d = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
        if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
        const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
        if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
    }
    return (x) => {
        if (x <= xs[0]) return ys[0];
        if (x >= xs[n - 1]) return ys[n - 1];
        let i = 0; while (x > xs[i + 1]) i++;
        const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    };
}
function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/* profile: subdivisions per segment p_i -> p_i+1, and which points are hard */
const SUB = [1, 2, 3, 3, 3, 3, 3, 2, 3, 4];
const HARD = [true, true, false, false, false, false, true, false, true, false, false];   // the shoulder is a soft roll; its line is drawn
const NHALF = SUB.reduce((a, b) => a + b, 0);     // points per side, centre excluded
const NRING = NHALF * 2 + 1;

/**
 * Key frames along x: x, zc (centre top), W (shoulder half width), zsh (shoulder crease z),
 * zb (belt / fender top z), wb (its half width), wr (roof edge / hood crease half width),
 * zr (its z), hard (the station is a hard edge).
 */
/**
 * Key frames from a measured reference (car/ref_*.js): the real car's side profile, plan view and side
 * window, one station every 8 cm. The cabin marks (windscreen, roof end, deck) come from the preset.
 */
function refKeyframes(s) {
    const ref = s.ref, Wm = s.W / 2, c = s.cabin;
    const at = (key, x) => {                                   // linear interpolation along the 5 cm samples
        const X = ref.x, a = ref[key];
        if (x <= X[0]) return a[0];
        if (x >= X[X.length - 1]) return a[a.length - 1];
        const i = Math.min(X.length - 2, Math.floor((x - X[0]) / (X[1] - X[0])));
        const t = (x - X[i]) / (X[i + 1] - X[i]);
        return a[i] + (a[i + 1] - a[i]) * t;
    };
    // the plan's half width without the mirrors (they sit over the doors' front ends)
    const half = (x) => (x > 0.12 && x < 0.72 ? at('half', 0.12) + (at('half', 0.72) - at('half', 0.12)) * (x - 0.12) / 0.6 : at('half', x));
    const D = ref.dlo, dlo = (x, k) => {                       // the side window's lower (k 1) / upper (k 2) edge
        if (x >= D[D.length - 1][0]) return D[D.length - 1][k];
        if (x <= D[0][0]) return D[0][k];
        for (let i = 0; i < D.length - 1; i++) if (x >= D[i][0] && x <= D[i + 1][0]) { const t = (x - D[i][0]) / (D[i + 1][0] - D[i][0]); return D[i][k] + (D[i + 1][k] - D[i][k]) * t; }
        return D[0][k];
    };
    const xf = ref.x[ref.x.length - 1] + 0.01, xr = ref.x[0] - 0.01;
    // the side window as smooth lines fitted to the measured one (the raw samples carry the A-pillar, the
    // mirror and the handle): the belt rising towards the rear, the upper edge under the roof
    const ss = (e0, e1, x) => { const q = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return q * q * (3 - 2 * q); };
    const belt = (x) => Math.min(0.962 + 0.105 * ss(0.15, -1.45, x), at('top', x) - 0.03);
    const dloTop = (x) => Math.min(at('top', x) - 0.105, 1.285);
    const Rw = Wm * s.roofW;
    const K = [];
    const row = (x, zc, W, zsh, zb, wb, wr, zr, hard) => K.push({ x, zc, W, zsh, zb, wb, wr, zr, hard: !!hard });
    const marks = [c.xDeckEnd, c.xRoofEnd, c.xWsTop, c.xWsBase];
    const xs = [];
    for (let x = xr; x <= xf + 1e-6; x += 0.08) xs.push(+x.toFixed(4));
    for (const m of marks) if (!xs.some((x) => Math.abs(x - m) < 0.02)) xs.push(m);
    xs.sort((a, b) => a - b);
    for (const x of xs) {
        const zc = at('top', x), W = half(x) * 0.995, hard = marks.some((m) => Math.abs(m - x) < 1e-6);
        let zb, wb, wr, zr;
        if (s.open && x < c.xWsTop) {                           // top down: behind the windscreen everything stays at the body line
            zb = zc - 0.035; wb = W - 0.045; wr = Wm * 0.80; zr = zc - 0.007;
        } else if (s.open && x < c.xWsBase) {                   // top down: the windscreen's frame over the body line
            const t = (c.xWsBase - x) / (c.xWsBase - c.xWsTop), bodyTop = ref.body ? at('body', x) : zc;
            zb = bodyTop - 0.035; wb = W - 0.045; wr = Wm * 0.60 + (Rw - Wm * 0.60) * t; zr = zc - 0.03 - 0.02 * t;
        } else if (x >= c.xWsBase) {                            // the hood: its edges a little under the crown
            const t = Math.min(1, (x - c.xWsBase) / Math.max(0.3, xf - c.xWsBase));
            zb = zc - 0.045 - 0.03 * t; wb = W - 0.05 - 0.04 * t; wr = Wm * (0.60 - 0.18 * t); zr = zc - 0.018;
        } else if (x >= c.xWsTop) {                             // the windscreen
            const t = (c.xWsBase - x) / (c.xWsBase - c.xWsTop);
            zb = belt(x); wb = W - 0.045; wr = Wm * 0.60 + (Rw - Wm * 0.60) * t; zr = zc - 0.03 - 0.03 * t;
        } else if (x >= c.xRoofEnd) {                           // the roof
            zb = belt(x); wb = W - 0.045; wr = Rw; zr = Math.min(dloTop(x), zc - 0.05);
        } else if (x >= c.xDeckEnd) {                           // the rear glass
            const t = (c.xRoofEnd - x) / (c.xRoofEnd - c.xDeckEnd);
            zb = Math.min(belt(x), zc - 0.06); wb = W - 0.05; wr = Rw + (Wm * 0.69 - Rw) * t; zr = zc - 0.03 - 0.03 * (1 - t);
        } else {                                                // the deck and the tail
            const t = Math.min(1, (c.xDeckEnd - x) / Math.max(0.3, c.xDeckEnd - xr));
            zb = zc - 0.03 - 0.06 * t * t; wb = W - 0.05 - 0.05 * t; wr = Wm * (0.69 - 0.12 * t * t); zr = zc - 0.012 - 0.03 * t * t;
        }
        const zsh = zb - 0.15;
        row(x, zc, W / Wm, zsh, zb, wb / Wm, wr, zr, hard);
    }
    K.sort((a, b) => a.x - b.x);
    // the rows hold W and wb as fractions of Wm (as keyframes() does)
    K.forEach((k) => { k.W = Wm * k.W; k.wb = Wm * k.wb; });
    return { K, xf, xr };
}

function keyframes(s) {
    if (s.ref) return refKeyframes(s);
    const Wm = s.W / 2, xf = s.WB / 2 + s.ohF, xr = -(s.L - s.WB / 2 - s.ohF);
    const B = s.belt, D = s.deck, R = s.H, Hc = s.cowl, Hn = s.nose, Rw = Wm * s.roofW * 1.02, c = s.cabin;
    const K = [];
    const row = (x, zc, Wk, zsh, zb, wb, wr, zr, hard) => K.push({ x, zc, W: Wm * Wk, zsh, zb, wb: Wm * wb, wr, zr, hard: !!hard });
    const shR = D - 0.15;
    // rear face, its rounded edge and the trunk lip (a small ducktail)
    // the tail: corners rounded off in plan, the deck's edge rolling down into the rear face (a short lip on top)
    row(xr, D - 0.11, 0.76, shR - 0.06, D - 0.125, 0.66, Wm * 0.52, D - 0.13);
    row(xr + 0.025, D - 0.045, 0.84, shR - 0.03, D - 0.065, 0.74, Wm * 0.58, D - 0.07, true);
    row(xr + 0.08, D - 0.008, 0.905, shR - 0.012, D - 0.03, 0.81, Wm * 0.63, D - 0.03);
    row(xr + 0.18, D + 0.014, 0.95, shR, D - 0.012, 0.86, Wm * 0.66, D - 0.012, true);
    row(xr + 0.34, D + 0.016, 0.98, shR + 0.005, D - 0.012, 0.885, Wm * 0.68, D - 0.012);
    if (c.xDeckEnd - (xr + 0.17) > 0.28) row((xr + 0.17 + c.xDeckEnd) / 2, D + 0.012, 1.0, shR + 0.01, D - 0.016, 0.89, Wm * 0.69, D - 0.016);
    row(c.xDeckEnd, D + 0.008, 1.0, Math.min(shR + 0.02, B - 0.08), D - 0.012, 0.89, Wm * 0.70, D - 0.014, true);
    if (s.open) {
        // an open car: behind the windscreen everything stays at the belt (the cockpit is cut out of it
        // later; behind the seats it is the cover over the folded top)
        const flatRow = (x, hard) => row(x, B + 0.035, 1.0, B - 0.08, B, 0.89, Wm * 0.80, B + 0.028, hard);
        const n = Math.max(3, Math.round((c.xWsTop - 0.06 - c.xDeckEnd) / 0.25));
        for (let k = 1; k <= n; k++) flatRow(lerp(c.xDeckEnd, c.xWsTop - 0.06, k / n), k === n);
        row(c.xWsTop, R, 0.98, B - 0.08, B, 0.885, Rw, R - 0.05, true);
    } else {
    // rear glass (or the top) rising to the roof; the belt falls to the door line
    for (let k = 1; k <= 3; k++) {
        const t = k / 4, x = lerp(c.xDeckEnd, c.xRoofEnd, t), e = Math.pow(Math.sin(t * Math.PI / 2), s.fastback ? 1.25 : 0.75);
        row(x, lerp(D + 0.008, R, e), lerp(1.0, 0.99, t), lerp(Math.min(shR + 0.02, B - 0.08), B - 0.08, t), lerp(D - 0.012, B, t), lerp(0.89, 0.885, t), lerp(Wm * 0.70, Rw, t), lerp(D - 0.014, R - 0.05, e));
    }
    // roof
    const nRoof = Math.max(2, Math.round((c.xWsTop - c.xRoofEnd) / 0.28));
    for (let k = 0; k <= nRoof; k++) {
        const t = k / nRoof, x = lerp(c.xRoofEnd, c.xWsTop, t), arc = Math.sin(t * Math.PI);
        row(x, R - 0.012 * (1 - arc), 0.985 - 0.01 * arc, B - 0.08, B, 0.885 - 0.005 * arc, Rw * (0.98 + 0.03 * arc), R - 0.062 + 0.006 * arc, k === 0 || k === nRoof);
    }
    }
    // windscreen down to the cowl
    for (let k = 1; k <= 3; k++) {
        const t = k / 4, x = lerp(c.xWsTop, c.xWsBase, t), zc = lerp(R, Hc, Math.pow(t, 0.95));
        row(x, zc, 0.98, lerp(B - 0.08, B - 0.09, t), lerp(B, Hc - 0.025, t), lerp(0.885, 0.875, t), lerp(Rw, Wm * 0.74, t), zc - lerp(0.05, 0.02, t));
    }
    row(c.xWsBase, Hc, 0.98, B - 0.09, Hc - 0.025, 0.875, Wm * 0.74, Hc - 0.02, true);
    // hood: the fenders stand a little above the hood's edge; the crease lines run to the nose
    const hoodEnd = xf - 0.30, nHood = Math.max(3, Math.round((hoodEnd - c.xWsBase) / 0.32));
    for (let k = 1; k <= nHood; k++) {
        const t = k / nHood, x = lerp(c.xWsBase + 0.03, hoodEnd, t);
        const zc = lerp(Hc - 0.01, Hn + 0.12, Math.pow(t, 1.3));
        row(x, zc, lerp(0.985, 0.975, t) + 0.007 * Math.sin(Math.min(1, t * 1.6) * Math.PI), lerp(B - 0.09, Hn + 0.04, Math.pow(t, 1.2)),
            zc - lerp(0.045, 0.05, t), lerp(0.875, 0.83, t), Wm * lerp(0.60, 0.48, t), zc - lerp(0.018, 0.024, t));
    }
    // nose
    // nose: the hood's front edge rolls down into the face, the corners round off in plan
    row(xf - 0.20, Hn + 0.075, 0.95, Hn + 0.01, Hn + 0.045, 0.77, Wm * 0.42, Hn + 0.07, true);
    row(xf - 0.11, Hn + 0.045, 0.91, Hn - 0.04, Hn + 0.015, 0.69, Wm * 0.37, Hn + 0.04);
    row(xf - 0.05, Hn + 0.0, 0.84, Hn - 0.08, Hn - 0.03, 0.60, Wm * 0.32, Hn - 0.002);
    row(xf - 0.015, Hn - 0.045, 0.77, Hn - 0.11, Hn - 0.075, 0.52, Wm * 0.28, Hn - 0.047);
    row(xf, Hn - 0.075, 0.71, Hn - 0.13, Hn - 0.10, 0.46, Wm * 0.25, Hn - 0.077);
    K.sort((a, b) => a.x - b.x);
    return { K, xf, xr };
}
/* Node 8 on the head unit: no Array.prototype.flat */
function flat(a) { const o = []; for (const x of a) { if (Array.isArray(x)) for (const y of x) o.push(y); else o.push(x); } return o; }
function posKey(V, v) { return Math.round(V[v * 3] * 2000) + ',' + Math.round(V[v * 3 + 1] * 2000) + ',' + Math.round(V[v * 3 + 2] * 2000); }

function build(spec) {
    const s = spec, Wm = s.W / 2;
    // light detail (slow head units): fewer points per section, stations further apart
    const SUBL = s.lod ? [1, 1, 1, 1, 1, 2, 1, 1, 2, 2] : SUB, NH = SUBL.reduce((a, b) => a + b, 0), NR = NH * 2 + 1;
    const { K, xf, xr } = keyframes(s);
    const refBottom = (x) => {                                  // the measured lower line (under the wheels: the sill's height)
        const R = s.ref, X = R.x, i = Math.max(0, Math.min(X.length - 2, Math.floor((x - X[0]) / (X[1] - X[0]))));
        const v = R.bottom[i] + (R.bottom[i + 1] - R.bottom[i]) * Math.max(0, Math.min(1, (x - X[i]) / (X[i + 1] - X[i])));
        return Math.max(v, 0.12);
    };
    const xs = K.map((k) => k.x);
    const I = {};
    ['zc', 'W', 'zsh', 'zb', 'wb', 'wr', 'zr'].forEach((key) => { I[key] = monotone(xs, K.map((r) => r[key])); });
    const AXF = s.WB / 2, AXR = -s.WB / 2;
    const ARCH = { r: s.wheel.r + 0.036, zc: s.wheel.r + 0.006 };
    const archZ = (x) => {
        for (const ax of [AXF, AXR]) { const dx = x - ax; if (Math.abs(dx) < ARCH.r) return ARCH.zc + Math.sqrt(ARCH.r * ARCH.r - dx * dx); }
        return null;
    };
    const c = s.cabin;

    /* the eleven control points (half section) at x */
    const bump = (x, c0, w) => { const u = (x - c0) / w; return Math.abs(u) >= 1 ? 0 : (1 + Math.cos(u * Math.PI)) / 2; };
    // the stance: flared arches front and (more) rear over a pinched waist, as on an M car
    const hips = s.ref ? () => 1 : (x) => 1 + 0.062 * bump(x, AXR - 0.02, 0.78) - 0.028 * bump(x, (AXF + AXR) / 2 + 0.1, 0.95) + 0.038 * bump(x, AXF + 0.02, 0.62);
    const control = (x) => {
        const zc = I.zc(x), W = I.W(x) * hips(x), zsh = I.zsh(x), zb = I.zb(x), wb = I.wb(x), wr = I.wr(x), zr = I.zr(x);
        // the underside sweeps up into the front apron and the rear diffuser, so neither end is a wall
        let z0 = s.rocker;
        const fa = s.apronF || 0.40, ra = s.apronR || 0.42;
        if (x > xf - fa) { const u = (x - (xf - fa)) / fa; z0 = s.rocker + 0.20 * u * u; }
        if (x < xr + ra) { const u = (xr + ra - x) / ra; z0 = s.rocker + 0.23 * u * u; }
        if (s.ref) z0 = refBottom(x);
        const zs = Math.max(zsh, z0 + 0.22);
        // the step from the shoulder in to the window line: a few centimetres along the cabin (the glass rises
        // out of the shoulder, as on a real car), the full step only towards the nose and the tail
        const endK = Math.max(0, Math.min(1, Math.max((x - (xf - 0.55)) / 0.45, ((xr + 0.6) - x) / 0.5)));
        const inset = (W - wb) * (0.38 + 0.62 * endK), wbE = W - inset;
        return [
            [W - 0.07, z0], [W - 0.04, z0 + 0.05],                                   // rocker, sill
            [W - 0.028, z0 + 0.14], [W - 0.004, lerp(z0 + 0.14, zs, 0.5)],            // the lower door tucks in, the door swells
            [W, zs],                                                                   // the shoulder (widest)
            [W - inset * 0.42, lerp(zs, zb, 0.62)], [wbE, zb],                        // rolling in to the window line
            [lerp(wbE, wr, 0.5) + 0.018, lerp(zb, zr, 0.5)],                          // the side glass, curved
            [wr, zr], [wr * 0.55, lerp(zr, zc, 0.82)], [0, zc],
        ];
    };
    /* half profile: from the rocker (k = 0) to the centre (k = NH), with segment and hardness */
    const half = (x) => {
        const p = control(x), out = [];
        for (let g = 0; g < 10; g++) {
            // a hard point is not smoothed through: its tangent follows its own segment
            const a = g > 0 && !HARD[g] ? p[g - 1] : [2 * p[g][0] - p[g + 1][0], 2 * p[g][1] - p[g + 1][1]];
            const d = g === 9 ? [-p[9][0], p[9][1]] : !HARD[g + 1] ? p[g + 2] : [2 * p[g + 1][0] - p[g][0], 2 * p[g + 1][1] - p[g][1]];
            for (let k = 0; k < SUBL[g]; k++) {
                const t = k / SUBL[g];
                out.push({ y: catmull(a[0], p[g][0], p[g + 1][0], d[0], t), z: catmull(a[1], p[g][1], p[g + 1][1], d[1], t), seg: g, sub: k, hard: k === 0 && HARD[g] });
            }
        }
        out.push({ y: 0, z: p[10][1], seg: 10, sub: 0, hard: false });
        const az = archZ(x);
        if (az !== null) for (const q of out) if (q.z < az && q.y > Wm * 0.5) { q.z = az; q.y = Math.max(q.y, p[1][0]); }
        return out;
    };

    /* stations: key frames (hard ones stay hard), the arch edges, fill-ins at most 0.16 m apart */
    const hardX = new Set(K.filter((k) => k.hard).map((k) => +k.x.toFixed(4)));
    const keep = new Set(xs.map((x) => +x.toFixed(4)));
    for (const ax of [AXF, AXR]) for (let k = -8; k <= 8; k++) keep.add(+(ax + Math.sin(k / 8 * Math.PI / 2) * ARCH.r * 0.999).toFixed(4));   // dense round the arches: a smooth opening
    const X0 = Array.from(keep).filter((x) => x >= xr && x <= xf).sort((a, b) => a - b);
    const XS = [X0[0]];
    for (let i = 1; i < X0.length; i++) {
        const gap = X0[i] - X0[i - 1];
        if (gap < 0.012) continue;
        const n = Math.ceil(gap / (s.lod ? 0.2 : 0.09));
        for (let k = 1; k < n; k++) XS.push(X0[i - 1] + gap * k / n);
        XS.push(X0[i]);
    }
    const hardStation = XS.map((x) => hardX.has(+x.toFixed(4)));
    const prof = XS.map(half);

    /* material of a cell between stations at profile segment (seg, sub) */
    const cellMat = (xm, seg, sub) => {
        const ws = xm > c.xWsTop && xm < c.xWsBase, roof = xm > c.xRoofEnd && xm <= c.xWsTop, back = xm > c.xDeckEnd && xm <= c.xRoofEnd;
        const top = s.softTop;
        if (s.open) {
            if (seg >= 6 && xm > c.xRoofEnd && xm < c.xWsTop) return -1;          // the cockpit: open
            if ((seg === 6 || seg === 7) && ws) return -1;                         // side windows down
            if (seg >= 6 && back) return MAT.PAINT;                                // the cover behind the seats
            if (ws) return seg === 8 && sub === 0 ? MAT.TRIM : seg >= 8 ? MAT.GLASS : MAT.PAINT;
        }
        if (seg === 0) return MAT.TRIM;
        if (seg === 1 && sub === 0 && xm > AXR + ARCH.r && xm < AXF - ARCH.r) return MAT.TRIM;
        if (seg >= 8) {
            if (ws) return seg === 8 && sub === 0 ? (top ? MAT.TRIM : MAT.ROOF) : MAT.GLASS;
            if (roof) return top ? MAT.TOP : MAT.ROOF;
            if (back) return top ? MAT.TOP : seg === 8 && sub === 0 ? MAT.ROOF : MAT.GLASS;
        }
        if (seg === 6 || seg === 7) {
            if (ws) return MAT.GLASS;
            if (roof) {
                if (s.bPillar && Math.abs(xm - s.bPillar) < 0.05) return MAT.TRIM;
                return MAT.GLASS;
            }
            if (back) {
                if (top) return MAT.TOP;
                if (s.cPillar && Math.abs(xm - s.cPillar) < 0.06) return MAT.TRIM;
                return xm > c.xRoofEnd - (s.dloBack || 0) ? MAT.GLASS : MAT.ROOF;
            }
        }
        return MAT.PAINT;
    };

    /* ---------- the body grid, vertices split at hard rows and columns ---------- */
    const V = [], T = [], TM = [];
    const vmap = new Map();
    const vert = (i, k, ci, ck) => {
        const kk = k <= NH ? k : 2 * NH - k;
        const p = prof[i][kk];
        const sideI = hardStation[i] ? (ci === i ? 1 : 0) : 0;
        const sideK = p.hard ? (ck === k ? 1 : 0) : 0;
        const key = (i * 256 + k) * 4 + sideI * 2 + sideK;
        let v = vmap.get(key);
        if (v === undefined) {
            v = V.length / 3;
            V.push(XS[i], k < NH ? -p.y : k === NH ? 0 : p.y, p.z);
            vmap.set(key, v);
        }
        return v;
    };
    const segOf = (k) => { const kk = k < NH ? k : 2 * NH - 1 - k; return prof[0][kk]; };
    // a measured body is a subdivision surface (subd.js): the sections' control points are a coarse cage,
    // subdivided twice into a smooth, sculpted shell; the window line and the roof edge stay crisp
    const SUBD = !!s.ref;
    if (SUBD) {
        const XC = new Set([xr, xr + 0.05, xf - 0.05, xf, c.xWsBase, c.xWsTop, c.xRoofEnd, c.xDeckEnd]);
        for (let x = xr + 0.3; x < xf - 0.25; x += 0.42) XC.add(+x.toFixed(3));
        for (const ax of [AXF, AXR]) for (const d of [-0.44, -0.30, -0.15, 0, 0.15, 0.30, 0.44]) XC.add(+(ax + d).toFixed(3));
        const xsC = Array.from(XC).filter((x) => x >= xr && x <= xf).sort((a, b) => a - b).filter((x, i, a) => i === 0 || x - a[i - 1] > 0.035);
        // the cage's half ring: the profile's control points without the sill and the door's middle (the
        // subdivision makes those curves itself); mirrored to 17 points round the section
        const IDX = [0, 2, 4, 5, 6, 7, 8, 9, 10], HC = IDX.length - 1, RN = 2 * HC;
        const P = [], rings = [];
        for (const x of xsC) {
            // over a wheel the lower door point becomes the arch's edge (the band below it is cut out)
            const p = control(x), az = archZ(x), ring = [];
            const pt = (q, i) => (i === 2 && az !== null ? [q[0], Math.max(q[1], az)] : [q[0], q[1]]);
            for (let j = 0; j < RN; j++) {
                const ii = IDX[j <= HC ? j : RN - j], q = pt(p[ii], ii);
                P.push([x, j < HC ? -q[0] : j === HC ? 0 : q[0], q[1]]); ring.push(P.length - 1);
            }
            rings.push(ring);
        }
        const F = [], tag = [], crease = new Set();
        // an edge of the ring: the profile segment it lies on (the lower of its two points), -2 for the underside
        const segE = (j) => (j < HC ? IDX[j] : j < RN - 1 ? IDX[RN - 1 - j] : -2);
        for (let i = 0; i < rings.length - 1; i++) {
            const xm = (xsC[i] + xsC[i + 1]) / 2, A = rings[i], B = rings[i + 1];
            const overWheel = Math.min(Math.abs(xm - AXF), Math.abs(xm - AXR)) < ARCH.r + 0.06;
            for (let j = 0; j < RN; j++) {
                const j2 = (j + 1) % RN, sg = segE(j), m = sg === -2 ? MAT.TRIM : cellMat(xm, sg, 0);
                if (m < 0) continue;
                if (overWheel && sg === 0) continue;                                    // the wheel arch: open
                F.push([A[j], A[j2], B[j2], B[j]]); tag.push(m);
            }
            for (const j of [IDX.indexOf(6), RN - IDX.indexOf(6), IDX.indexOf(8), RN - IDX.indexOf(8)]) crease.add(ek(A[j], B[j]));   // the window line, the roof edge
        }
        F.push(rings[0].slice().reverse()); tag.push(MAT.PAINT);                   // the tail and the nose: one face each
        F.push(rings[rings.length - 1].slice()); tag.push(MAT.PAINT);
        const S2 = subdivide({ P, F, tag, crease }, s.lod ? 1 : 2);
        for (const q of S2.P) V.push(q[0], q[1], q[2]);
        S2.F.forEach((f, fi) => { T.push(f[0], f[1], f[2], f[0], f[2], f[3]); TM.push(S2.tag[fi], S2.tag[fi]); });
    } else
    for (let i = 0; i < XS.length - 1; i++) {
        const xm = (XS[i] + XS[i + 1]) / 2;
        for (let k = 0; k < NR - 1; k++) {
            const q = segOf(k), m = cellMat(xm, q.seg, q.sub);
            if (m < 0) continue;
            const a = vert(i, k, i, k), b = vert(i, k + 1, i, k), cc = vert(i + 1, k + 1, i, k), d = vert(i + 1, k, i, k);
            T.push(a, d, cc, a, cc, b); TM.push(m, m);
        }
    }
    const nBody = V.length / 3;
    const N = new Float64Array(nBody * 3);
    for (let t = 0; t < T.length / 3; t++) {
        const a = T[t * 3], b = T[t * 3 + 1], cc = T[t * 3 + 2];
        const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
        const vx = V[cc * 3] - V[a * 3], vy = V[cc * 3 + 1] - V[a * 3 + 1], vz = V[cc * 3 + 2] - V[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const v of [a, b, cc]) { N[v * 3] += nx; N[v * 3 + 1] += ny; N[v * 3 + 2] += nz; }
    }
    let out = 0;
    for (let v = 0; v < nBody; v++) {
        const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
        N[v * 3] /= l; N[v * 3 + 1] /= l; N[v * 3 + 2] /= l;
        out += N[v * 3 + 1] * V[v * 3 + 1] + N[v * 3 + 2] * (V[v * 3 + 2] - 0.6);
    }
    if (out < 0) for (let i = 0; i < N.length; i++) N[i] = -N[i];
    const NN = Array.from(N);

    // end caps: own vertices, flat normals. The section is symmetric, so it is closed by horizontal
    // strips between each point and its mirror image, bottom to top (a fan from the centre would
    // reach outside the concave lower door)
    const cap = (i, dir) => {
        // the ring first: vert() may itself add a vertex, which must not land between the copies
        const ring = []; for (let k = 0; k < NR; k++) ring.push(vert(i, k, -1, -1));
        while (NN.length < V.length) NN.push(dir, 0, 0);                        // a vertex vert() added: keep the normals aligned
        const base = V.length / 3;
        for (const v of ring) { V.push(V[v * 3], V[v * 3 + 1], V[v * 3 + 2]); NN.push(dir, 0, 0); }
        const tri = (a, b, cc) => {
            const ay = V[a * 3 + 1], az = V[a * 3 + 2], cr = (V[b * 3 + 1] - ay) * (V[cc * 3 + 2] - az) - (V[b * 3 + 2] - az) * (V[cc * 3 + 1] - ay);
            if (Math.abs(cr) < 1e-9) return;
            if ((cr > 0) === (dir > 0)) T.push(a, b, cc); else T.push(a, cc, b);
            TM.push(MAT.PAINT);
        };
        // rows bottom to top, each cut into columns: small triangles sort correctly against the lamps and
        // the diffuser drawn on the cap (one 1.5 m triangle would cover half of them)
        const COLS = 8, rowV = [];
        for (let k = 0; k <= NH; k++) {
            const r = base + k, l = base + NR - 1 - k, ids = [];
            for (let j = 0; j <= COLS; j++) {
                if (k === NH) { ids.push(base + NH); continue; }
                const u = j / COLS, id = V.length / 3;
                V.push(V[r * 3], V[r * 3 + 1] + (V[l * 3 + 1] - V[r * 3 + 1]) * u, V[r * 3 + 2] + (V[l * 3 + 2] - V[r * 3 + 2]) * u); NN.push(dir, 0, 0);
                ids.push(id);
            }
            rowV.push(ids);
        }
        for (let k = 0; k < NH; k++) for (let j = 0; j < COLS; j++) {
            const a = rowV[k][j], b = rowV[k][j + 1], cc = rowV[k + 1][j + 1], d = rowV[k + 1][j];
            if (k === NH - 1) tri(a, b, d); else { tri(a, b, cc); tri(a, cc, d); }
        }
    };
    const capStart = T.length / 3;
    if (!SUBD) { cap(0, -1); cap(XS.length - 1, 1); }
    const nShell = V.length / 3, nShellTris = T.length / 3;
    // the surface's own section at x (a subdivided shell is not the analytic profile): its right half from the
    // bottom round to the top centre, as half() gives it, so lamps and lines sit on the real surface
    const sliceCache = new Map();
    const halfS = !SUBD ? half : (x) => {
        const key = Math.round(x * 1000);
        if (sliceCache.has(key)) return sliceCache.get(key);
        const pts = [];
        for (let t = 0; t < nShellTris; t++) {
            const ids = [T[t * 3], T[t * 3 + 1], T[t * 3 + 2]];
            for (let e = 0; e < 3; e++) {
                const a = ids[e], b = ids[(e + 1) % 3], xa = V[a * 3], xb = V[b * 3];
                if ((xa - x) * (xb - x) > 0 || xa === xb) continue;
                const u = (x - xa) / (xb - xa), y = V[a * 3 + 1] + (V[b * 3 + 1] - V[a * 3 + 1]) * u, z = V[a * 3 + 2] + (V[b * 3 + 2] - V[a * 3 + 2]) * u;
                if (y >= -1e-4) pts.push({ y: Math.max(0, y), z });
            }
        }
        const zc0 = 0.55;
        pts.sort((p, q) => Math.atan2(p.z - zc0, p.y + 0.01) - Math.atan2(q.z - zc0, q.y + 0.01));
        const out = [];
        for (const q of pts) if (!out.length || Math.hypot(q.y - out[out.length - 1].y, q.z - out[out.length - 1].z) > 0.004) out.push({ y: q.y, z: q.z, seg: 0, sub: 0, hard: false });
        if (!out.length) return half(x);
        sliceCache.set(key, out);
        return out;
    };

    /* ---------- surface helpers ---------- */
    const surfaceTop = (x, y, sd, lift) => {
        const h = halfS(x), NH = h.length - 1;
        for (let k = NH; k > 0; k--) {
            const a = h[k], b = h[k - 1];
            if (b.y >= y && a.y <= y) { const t = (y - a.y) / ((b.y - a.y) || 1); return [x, y * sd, a.z + (b.z - a.z) * t + (lift || 0.004)]; }
        }
        return [x, y * sd, h[0].z];
    };
    const surfaceSide = (x, z, sd, off) => {
        const h = halfS(x), NH = h.length - 1;
        for (let k = 0; k < NH; k++) {
            const a = h[k], b = h[k + 1];
            if (a.z <= z && b.z >= z && a.y > Wm * 0.55) { const t = (z - a.z) / ((b.z - a.z) || 1); return [x, (a.y + (b.y - a.y) * t + (off || 0.004)) * sd, z]; }
        }
        return null;
    };

    /* ---------- small meshes: interior, mirrors ---------- */
    const addTri = (p, q, r, n, m) => { const b = V.length / 3; V.push(...p, ...q, ...r); NN.push(...n, ...n, ...n); T.push(b, b + 1, b + 2); TM.push(m); };
    const quad = (p, q, r, t, m) => {
        const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = t[0] - p[0], vy = t[1] - p[1], vz = t[2] - p[2];
        let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((v) => v / l);
        // a big face is cut into tiles of at most 0.16 m: the painter's sort then works on small pieces,
        // and a door panel cannot jump in front of the body side it sits behind
        const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz), nu = Math.max(1, Math.ceil(lu / 0.16)), nv = Math.max(1, Math.ceil(lv / 0.16));
        if (nu === 1 && nv === 1) { addTri(p, q, r, n, m); addTri(p, r, t, n, m); return; }
        const at = (i, j) => { const u = i / nu, v = j / nv;   // bilinear over p q r t
            return [0, 1, 2].map((k) => (1 - u) * (1 - v) * p[k] + u * (1 - v) * q[k] + u * v * r[k] + (1 - u) * v * t[k]); };
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
            const a2 = at(i, j), b2 = at(i + 1, j), c2 = at(i + 1, j + 1), d2 = at(i, j + 1);
            addTri(a2, b2, c2, n, m); addTri(a2, c2, d2, n, m);
        }
    };
    const box = (x0, x1, y0, y1, z0, z1, m, tilt) => {
        const P = (x, y, z) => (tilt ? [x - Math.sin(tilt) * (z - z0), y, z0 + Math.cos(tilt) * (z - z0)] : [x, y, z]);
        const a = P(x0, y0, z0), b = P(x1, y0, z0), cc = P(x1, y1, z0), d = P(x0, y1, z0);
        const e = P(x0, y0, z1), f = P(x1, y0, z1), g = P(x1, y1, z1), h = P(x0, y1, z1);
        quad(e, f, g, h, m); quad(b, cc, g, f, m); quad(d, a, e, h, m); quad(a, b, f, e, m); quad(cc, d, h, g, m);
    };
    const blob = (cx, cy, cz, rx, ry, rz, mTop, mBottom) => {
        const nu = 12, nv = 6, base = V.length / 3;
        for (let j = 0; j <= nv; j++) {
            const v = j / nv * Math.PI, sv = Math.sin(v), cv = Math.cos(v);
            for (let i = 0; i < nu; i++) {
                const u = i / nu * Math.PI * 2, x = Math.cos(u) * sv, y = Math.sin(u) * sv, z = cv;
                V.push(cx + x * rx, cy + y * ry, cz + z * rz);
                const nx = x / rx, ny = y / ry, nz = z / rz, l = Math.hypot(nx, ny, nz); NN.push(nx / l, ny / l, nz / l);
            }
        }
        for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
            const a = base + j * nu + i, b = base + j * nu + (i + 1) % nu, cc = base + (j + 1) * nu + (i + 1) % nu, d = base + (j + 1) * nu + i;
            const m = j < nv / 2 ? mTop : mBottom;
            T.push(a, d, cc, a, cc, b); TM.push(m, m);
        }
    };

    // interior, seen through the glass
    const intStart = T.length / 3;
    const drv = s.rhd ? -1 : 1, B = s.belt;
    const cabinFront = c.xWsBase - 0.05, cabinRear = Math.max(c.xRoofEnd - (s.softTop ? 0.10 : 0.25), c.xDeckEnd + 0.12);
    const seatX = lerp(cabinRear, cabinFront, s.rearSeats ? 0.50 : 0.30), seatW = 0.25, seatY = 0.37, floorZ = s.rocker + 0.20;
    box(cabinRear, cabinFront, -Wm * 0.82, Wm * 0.82, floorZ - 0.02, floorZ, MAT.INT);
    box(cabinFront - 0.42, cabinFront, -Wm * 0.84, Wm * 0.84, B - 0.20, B - 0.04, MAT.INT);
    box(cabinFront - 0.44, cabinFront - 0.40, -Wm * 0.70, Wm * 0.70, B - 0.07, B - 0.045, MAT.INTLIGHT);
    box(seatX + 0.30, cabinFront - 0.40, -0.06, 0.06, floorZ, floorZ + 0.13, MAT.INT);
    /*
     * A sports bucket seat, lofted: the cushion and the back are each a grid of sections across the
     * seat (bolsters standing up at the sides, the middle dished), closed by a flat underside / back
     * panel, with smooth normals. The back is wide at the shoulders, narrow at the waist, with the
     * headrest built in above a neck notch. (x0, y0, z0): the seat's base, rear centre; k: size.
     */
    const seat = (x0, y0, z0, k, recline, cushion) => {
        const ss = (e0, e1, x) => { const q = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return q * q * (3 - 2 * q); };
        const cols = 16, across = (j) => j / cols * 2 - 1;                     // -1 .. 1 across the seat
        // the bolsters rise smoothly towards the sides and roll over at the edge
        const lift = (u, bol, mid) => { const a2 = Math.abs(u); return (mid + (bol - mid) * ss(0.35, 0.82, a2)) * (1 - ss(0.86, 1.0, a2)); };
        /*
         * A closed solid, like a manifold mesh in a modeller: each row is a closed ring (the padded
         * face across the seat, then back along its flat underside), rows joined into a tube, both
         * ends capped. Then, as "recalculate normals outside": the signed volume decides the winding
         * (all triangles turned if it is negative), and the normals come from the faces: smooth over
         * the padding, flat on the end caps (their own vertices).
         */
        const solid = (rows, top, bot) => {
            const base = V.length / 3, ring = 2 * (cols + 1), t0 = T.length;
            const put = (p) => { V.push(p[0], p[1], p[2]); NN.push(0, 0, 0); return V.length / 3 - 1; };
            for (let i = 0; i <= rows; i++) {
                for (let jj = 0; jj <= cols; jj++) put(top(i, jj));
                for (let jj = cols; jj >= 0; jj--) put(bot(i, jj));
            }
            const tri = (a2, b2, c2) => { T.push(a2, b2, c2); TM.push(MAT.SEAT); };
            for (let i = 0; i < rows; i++) for (let q = 0; q < ring; q++) {
                const a2 = base + i * ring + q, b2 = base + i * ring + (q + 1) % ring;
                tri(a2, b2, b2 + ring); tri(a2, b2 + ring, a2 + ring);
            }
            for (const i of [0, rows]) {                                       // end caps: own vertices, a fan from the middle
                const first = V.length / 3; let cx = 0, cy = 0, cz = 0;
                for (let q = 0; q < ring; q++) { const v = base + i * ring + q; put([V[v * 3], V[v * 3 + 1], V[v * 3 + 2]]); cx += V[v * 3]; cy += V[v * 3 + 1]; cz += V[v * 3 + 2]; }
                const c = put([cx / ring, cy / ring, cz / ring]);
                for (let q = 0; q < ring; q++) tri(c, first + q, first + (q + 1) % ring);
                if (i === 0) for (let q = T.length - ring * 3; q < T.length; q += 3) { const b2 = T[q + 1]; T[q + 1] = T[q + 2]; T[q + 2] = b2; }
            }
            // orientation by signed volume: outward if positive
            let vol = 0;
            for (let q = t0; q < T.length; q += 3) {
                const a2 = T[q] * 3, b2 = T[q + 1] * 3, c2 = T[q + 2] * 3;
                vol += V[a2] * (V[b2 + 1] * V[c2 + 2] - V[b2 + 2] * V[c2 + 1]) - V[a2 + 1] * (V[b2] * V[c2 + 2] - V[b2 + 2] * V[c2]) + V[a2 + 2] * (V[b2] * V[c2 + 1] - V[b2 + 1] * V[c2]);
            }
            if (vol < 0) for (let q = t0; q < T.length; q += 3) { const b2 = T[q + 1]; T[q + 1] = T[q + 2]; T[q + 2] = b2; }
            // normals from the (now consistent) faces, area weighted
            for (let q = t0; q < T.length; q += 3) {
                const a2 = T[q], b2 = T[q + 1], c2 = T[q + 2];
                const ux = V[b2 * 3] - V[a2 * 3], uy = V[b2 * 3 + 1] - V[a2 * 3 + 1], uz = V[b2 * 3 + 2] - V[a2 * 3 + 2];
                const vx = V[c2 * 3] - V[a2 * 3], vy = V[c2 * 3 + 1] - V[a2 * 3 + 1], vz = V[c2 * 3 + 2] - V[a2 * 3 + 2];
                const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                for (const v of [a2, b2, c2]) { NN[v * 3] += nx; NN[v * 3 + 1] += ny; NN[v * 3 + 2] += nz; }
            }
            for (let v = base; v < V.length / 3; v++) { const l = Math.hypot(NN[v * 3], NN[v * 3 + 1], NN[v * 3 + 2]) || 1; NN[v * 3] /= l; NN[v * 3 + 1] /= l; NN[v * 3 + 2] /= l; }
        };
        if (cushion) {                                                         // the cushion: front to back rows
            const L2 = 0.50 * k, rows = 8, w = (t) => (0.26 - 0.02 * t) * k;
            solid(rows, (i, jj) => { const t = i / rows, u = across(jj);
                return [x0 + t * L2, y0 + u * w(t), z0 + (0.08 + lift(u, 0.11, 0.0) * (1 - 0.35 * t) + 0.02 * Math.sin(t * Math.PI)) * k]; },
            (i, jj) => { const t = i / rows, u = across(jj); return [x0 + t * L2, y0 + u * w(t) * 0.97, z0]; });
        }
        // the back: rises from the cushion's rear, reclined; waist -> shoulders -> neck -> headrest, every change smooth
        const H2 = 0.86 * k, rows = 20, cr = Math.cos(recline), sr2 = Math.sin(recline);
        const width = (t) => (0.235 + 0.04 * ss(0.20, 0.55, t) - 0.145 * ss(0.58, 0.72, t) + 0.01 * ss(0.75, 0.9, t)) * k;
        const bolster = (t) => 0.13 - 0.08 * ss(0.52, 0.70, t);
        const P = (t, u, d) => { const h = t * H2; return [x0 - sr2 * h + cr * d, y0 + u * width(t), z0 + 0.08 * k + cr * h + sr2 * d]; };
        solid(rows, (i, jj) => { const t = i / rows, u = across(jj); return P(t, u, (0.03 + lift(u, bolster(t), 0.01)) * k); },
            (i, jj) => { const t = i / rows, u = across(jj); return P(t, u * 0.97, -0.04 * k); });
    };
    for (const sd of [1, -1]) {
        seat(seatX - 0.04, seatY * sd, floorZ, 1, 0.30, true);
        if (s.rearSeats) seat(cabinRear + 0.10, seatY * sd * 1.02, floorZ + 0.02, 0.86, 0.38, false);
    }
    {
        const cx = cabinFront - 0.50, cy = seatY * drv, cz = B + 0.02, R0 = 0.185, n = 14;
        for (let i = 0; i < n; i++) {
            const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2;
            const P = (a, r) => [cx + Math.sin(a) * r * 0.45, cy + Math.cos(a) * r, cz + Math.sin(a) * r * 0.85];
            quad(P(a0, R0), P(a1, R0), P(a1, R0 - 0.03), P(a0, R0 - 0.03), MAT.INT);
        }
        box(cx - 0.02, cx + 0.03, cy - 0.05, cy + 0.05, cz - 0.04, cz + 0.03, MAT.INTLIGHT);
    }
    if (s.open) {
        for (const sd of [1, -1]) {
            const yo = (I.wb(seatX) - 0.035) * sd;
            box(cabinRear, cabinFront - 0.30, Math.min(yo, yo - 0.05 * sd), Math.max(yo, yo - 0.05 * sd), floorZ, B - 0.015, MAT.INT);   // inner door trim
            box(cabinRear + 0.10, cabinFront - 0.45, Math.min(yo - 0.05 * sd, yo - 0.09 * sd), Math.max(yo - 0.05 * sd, yo - 0.09 * sd), B - 0.11, B - 0.08, MAT.INTLIGHT);  // armrest
            if (!s.rearSeats) {
                // roll hoops behind the headrests
                const hx = seatX - 0.36, hy = seatY * sd, hz = B + 0.02, hr = 0.17, n = 9;
                for (let k = 0; k < n; k++) {
                    const a0 = k / n * Math.PI, a1 = (k + 1) / n * Math.PI;
                    const P = (a, r, dx) => [hx + dx, hy + Math.cos(a) * r, hz + Math.sin(a) * r];
                    quad(P(a0, hr, 0.02), P(a1, hr, 0.02), P(a1, hr - 0.035, 0.02), P(a0, hr - 0.035, 0.02), MAT.CHROME);
                    quad(P(a0, hr, 0.02), P(a0, hr, -0.03), P(a1, hr, -0.03), P(a1, hr, 0.02), MAT.CHROME);
                }
            }
        }
    }
    const intEnd = T.length / 3;
    // shark-fin antenna
    if (!s.softTop) blob(c.xRoofEnd + 0.10, 0, s.H - 0.035, 0.075, 0.025, 0.035, MAT.PAINT, MAT.PAINT);
    // mirrors
    for (const sd of [1, -1]) {
        const mx = c.xWsBase - 0.10, my = (I.wb(mx) + 0.10) * sd, mz = B + 0.06;
        blob(mx, my, mz, 0.075, 0.11, 0.06, MAT.PAINT, MAT.TRIM);
        box(mx - 0.04, mx + 0.04, Math.min(my, my - 0.09 * sd), Math.max(my, my - 0.09 * sd), mz - 0.035, mz - 0.012, MAT.TRIM);
    }

    /* ---------- ambient occlusion per vertex ---------- */
    const nV = V.length / 3, AO = new Float32Array(nV);
    for (let v = 0; v < nV; v++) {
        const x = V[v * 3], y = V[v * 3 + 1], z = V[v * 3 + 2];
        let ao = 0.38 + 0.62 * smooth(Math.min(1, Math.max(0, (z - s.rocker * 0.6) / 0.55)));
        for (const ax of [AXF, AXR]) {
            const d = Math.hypot(x - ax, z - ARCH.zc) - ARCH.r;
            if (d < 0.12 && Math.abs(y) > Wm * 0.5) ao *= 0.55 + 0.45 * Math.max(0, d) / 0.12;
        }
        if (v >= nShell) ao *= 0.8;
        if (NN[v * 3 + 2] < -0.3) ao *= 0.6;
        AO[v] = ao;
    }

    /* ---------- decals and light pipes ---------- */
    const D = [], P2 = [];
    let xre = XS[0] - 0.004, xfr = XS[XS.length - 1] + 0.004;
    if (SUBD) { let mn = 1e9, mx = -1e9; for (let v = 0; v < nShell; v++) { mn = Math.min(mn, V[v * 3]); mx = Math.max(mx, V[v * 3]); } xre = mn - 0.004; xfr = mx + 0.004; }
    // the end faces where the surface really is (a subdivided shell rounds in from the cage's last section)
    const xEnd0 = SUBD ? XS[0] + 0.03 : XS[0], xEnd1 = SUBD ? XS[XS.length - 1] - 0.03 : XS[XS.length - 1];
    const rearRing = halfS(xEnd0), capTop = rearRing[rearRing.length - 1].z, capW = Math.max(...rearRing.map((p) => p.y));
    const rear = (mat, pts, dx) => D.push({ mat, n: [-1, 0, 0], p: flat(pts.map(([y, z]) => [xre - (dx || 0), y, z])) });
    const front = (mat, pts, dx) => D.push({ mat, n: [1, 0, 0], p: flat(pts.map(([y, z]) => [xfr + (dx || 0), y, z])) });
    const pipe = (mat, n, pts, w) => P2.push({ mat, n, p: flat(pts), w });
    const lampZ = Math.min(capTop - 0.045, s.belt);
    for (const sd of [1, -1]) {
        const o = (y) => y * sd * capW;
        const lens = [[0.30, lampZ + 0.022], [0.90, lampZ + 0.012], [0.975, lampZ - 0.005], [0.985, lampZ - 0.125], [0.88, lampZ - 0.13], [0.86, lampZ - 0.055], [0.31, lampZ - 0.045]];
        rear(MAT.TAILLENS, lens.map(([y, z]) => [o(y), z]));
        // the double L: a thick bar along the top, turning down at the outer end; a thinner one inside it
        pipe(MAT.TAIL, [-1, 0, 0], [[0.36, lampZ + 0.002], [0.88, lampZ - 0.006], [0.935, lampZ - 0.03], [0.94, lampZ - 0.115]].map(([y, z]) => [xre - 0.003, o(y), z]), 0.016);
        pipe(MAT.TAIL, [-1, 0, 0], [[0.48, lampZ - 0.030], [0.85, lampZ - 0.036], [0.885, lampZ - 0.055], [0.89, lampZ - 0.11]].map(([y, z]) => [xre - 0.003, o(y), z]), 0.008);
        // the lamp wraps round the corner onto the flank
        const sx0 = XS[2], sx1 = XS[2] + 0.26;
        const side = [surfaceSide(sx0, lampZ - 0.006, sd, 0.009), surfaceSide(sx1 - 0.02, lampZ - 0.012, sd, 0.009)].filter(Boolean);
        if (side.length === 2) pipe(MAT.TAIL, [0, sd, 0], side, 0.014);
        rear(MAT.TAILLENS, [[0.80, s.rocker + 0.17], [0.92, s.rocker + 0.17], [0.92, s.rocker + 0.195], [0.80, s.rocker + 0.195]].map(([y, z]) => [o(y), z]));
        const tips = s.exhaust === 'quad' ? [0.56, 0.72] : s.exhaust === 'center' ? [] : [0.68];
        for (const ty of tips) {
            const ex = ty * sd * capW, ez = s.rocker + 0.085, rr = s.exhaust === 'quad' ? 0.046 : 0.056;
            const ring = [], inner = [];
            for (let k = 0; k < 20; k++) { const a = k / 20 * Math.PI * 2; ring.push([ex + Math.cos(a) * rr, ez + Math.sin(a) * rr * 0.9]); inner.push([ex + Math.cos(a) * rr * 0.78, ez + Math.sin(a) * rr * 0.68]); }
            rear(MAT.CHROME, ring, 0.004); rear(MAT.GRILLE, inner, 0.007);
        }
    }
    if (s.exhaust === 'center') for (const ty of [-0.06, 0.06]) {
        const pts = []; for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; pts.push([ty + Math.cos(a) * 0.045, s.rocker + 0.08 + Math.sin(a) * 0.04]); }
        rear(MAT.CHROME, pts, 0.004);
    }
    const dz = s.rocker + 0.015, dh = 0.17;
    rear(MAT.DIFF, [[-0.88 * capW, dz], [0.88 * capW, dz], [0.92 * capW, dz + dh], [0.62 * capW, dz + dh - 0.01], [0.52 * capW, dz + dh + 0.025], [-0.52 * capW, dz + dh + 0.025], [-0.62 * capW, dz + dh - 0.01], [-0.92 * capW, dz + dh]]);
    for (const fy of [-0.30, -0.15, 0, 0.15, 0.30]) pipe(MAT.TRIM, [-1, 0, 0], [[xre - 0.006, fy * capW, dz + 0.01], [xre - 0.006, fy * capW, dz + dh - 0.01]], 0.005);
    const pz = s.plateZ !== undefined ? s.plateZ : (s.rocker + 0.27);
    rear(MAT.TRIM, [[-0.29, pz], [0.29, pz], [0.30, pz + 0.145], [-0.30, pz + 0.145]]);
    rear(MAT.PLATE, [[-0.26, pz + 0.015], [0.26, pz + 0.015], [0.26, pz + 0.125], [-0.26, pz + 0.125]], 0.002);
    if (s.thirdLight) pipe(MAT.TAIL, [-1, 0, 0], [[xre - 0.003, -0.22, capTop - 0.008], [xre - 0.003, 0.22, capTop - 0.008]], 0.008);
    const Hn = s.nose;
    // the double kidney: two rounded openings either side of the centre, a bright surround, vertical slats
    const kidney = (sd) => {
        const y0 = 0.035, y1 = 0.275, z0 = Hn - 0.265, z1 = Hn - 0.045, r = 0.05, out = [];
        const corner = (cy, cz, a0) => { for (let k = 0; k <= 4; k++) { const a = a0 + k / 4 * Math.PI / 2; out.push([cy + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
        corner(y1 - r, z0 + r, -Math.PI / 2); corner(y1 - r - 0.012, z1 - r, 0); corner(y0 + r, z1 - r, Math.PI / 2); corner(y0 + r, z0 + r, Math.PI);
        return out.map(([y, z]) => [y * sd, z]);
    };
    for (const sd of [1, -1]) {
        const g = kidney(sd);
        front(MAT.GRILLE, g);
        pipe(MAT.CHROME, [1, 0, 0], g.concat([g[0]]).map(([y, z]) => [xfr + 0.004, y, z]), 0.006);
        for (let k = 1; k <= 6; k++) { const y = (0.035 + k * 0.034) * sd; pipe(MAT.TRIM, [1, 0, 0], [[xfr + 0.005, y, Hn - 0.25], [xfr + 0.005, y, Hn - 0.06]], 0.0035); }
        front(MAT.GRILLE, [[0.36, s.rocker + 0.03], [0.62, s.rocker + 0.04], [0.65, s.rocker + 0.15], [0.40, s.rocker + 0.165]].map(([y, z]) => [y * sd, z]));
    }
    front(MAT.GRILLE, [[-0.30, s.rocker + 0.02], [0.30, s.rocker + 0.02], [0.30, s.rocker + 0.13], [-0.30, s.rocker + 0.13]]);
    pipe(MAT.TRIM, [1, 0, 0], [[xfr + 0.01, -Wm * 0.75, s.rocker + 0.012], [xfr + 0.01, Wm * 0.75, s.rocker + 0.012]], 0.025);
    // the headlamps: in the nose's front face, at its outer corners (not on the hood): a slim lens swept
    // up and out, two small rings in it and a light bar along its top
    const frontRing = halfS(xEnd1), fTop = frontRing[frontRing.length - 1].z, fW = Math.max(...frontRing.map((p) => p.y));
    for (const sd of [1, -1]) {
        const lz = Math.min(fTop - 0.025, Hn - 0.035), o = (y) => y * sd * fW;
        const lens = [[0.40, lz - 0.075], [0.86, lz - 0.050], [0.97, lz - 0.010], [0.95, lz + 0.012], [0.42, lz - 0.012]];
        front(MAT.LENS, lens.map(([y, z]) => [o(y), z]), 0.003);
        for (const [ry, rz] of [[0.57, lz - 0.040], [0.78, lz - 0.026]]) {
            const ring = []; for (let k = 0; k <= 18; k++) { const a = k / 18 * Math.PI * 2; ring.push([xfr + 0.006, o(ry) + Math.cos(a) * 0.026, rz + Math.sin(a) * 0.021]); }
            pipe(MAT.HEAD, [1, 0, 0], ring, 0.0045);
        }
        pipe(MAT.HEAD, [1, 0, 0], [[0.44, lz - 0.006], [0.93, lz + 0.006]].map(([y, z]) => [xfr + 0.006, o(y), z]), 0.005);
    }

    /* ---------- feature lines: shut lines, handles, gills ---------- */
    const L = [];
    const trunk = [];
    const xt = c.xDeckEnd - 0.06;
    for (let y = -0.84; y <= 0.841; y += 0.084) trunk.push(surfaceTop(xt, Math.abs(y) * Wm, Math.sign(y) || 1));
    L.push({ kind: 'shut', p: trunk });
    const hoodFront = [];
    for (let y = -0.80; y <= 0.801; y += 0.08) hoodFront.push(surfaceTop(xf - 0.24, Math.abs(y) * Wm, Math.sign(y) || 1));
    L.push({ kind: 'shut', p: hoodFront });
    for (const sd of [1, -1]) {
        const hs = [];
        for (let x = c.xWsBase + 0.08; x <= xf - 0.24; x += 0.12) hs.push(surfaceTop(x, Math.min(I.wb(x) - 0.03, Wm * 0.84), sd));
        L.push({ kind: 'shut', p: hs });
        const doorF = c.xWsBase + 0.22, doorR = s.doorRear !== undefined ? s.doorRear : c.xRoofEnd + 0.02;
        for (const xd of s.bPillar ? [doorF, s.bPillar, doorR] : [doorF, doorR]) {
            const d = []; for (let z = s.rocker + 0.12; z <= s.belt - 0.03; z += 0.08) { const p = surfaceSide(xd, z, sd); if (p) d.push(p); }
            if (d.length > 1) L.push({ kind: 'shut', p: d });
        }
        for (const xh of s.bPillar ? [s.bPillar + 0.18, doorR + 0.2] : [doorR + 0.22]) {
            const a = surfaceSide(xh, I.zsh(xh) - 0.05, sd, 0.008), b = surfaceSide(xh + 0.14, I.zsh(xh) - 0.05, sd, 0.008);
            if (a && b) L.push({ kind: 'handle', p: [a, b] });
        }
        // the hood's two creases, closing in towards the kidneys
        const hc = []; for (let k = 0; k <= 6; k++) { const t = k / 6, x = lerp(c.xWsBase + 0.10, xf - 0.26, t); hc.push(surfaceTop(x, Wm * lerp(0.42, 0.20, t), sd, 0.006)); }
        L.push({ kind: 'sig', p: hc });
        // the Hofmeister kink: the side window's rear edge rises from the belt, then turns forward
        if (!s.softTop) {
            const xk = c.xRoofEnd - (s.dloBack || 0) + 0.02, zr = I.zr(xk + 0.3) - 0.012;
            const kp = [[xk + 0.32, B + 0.012], [xk + 0.02, B + 0.016], [xk + 0.0, B + 0.05], [xk + 0.055, B + 0.11], [xk + 0.20, zr - 0.02], [xk + 0.42, zr]].map(([x, z]) => surfaceSide(x, z, sd, 0.008)).filter(Boolean);
            if (kp.length > 2) L.push({ kind: 'sig', p: kp });
        }
        // the character line: from the front wheel back, rising towards the tail lamps
        const cl = []; for (let k = 0; k <= 8; k++) { const t = k / 8, x = lerp(AXF - ARCH.r - 0.02, xr + 0.32, t), p = surfaceSide(x, I.zsh(x) - lerp(0.10, 0.035, t), sd, 0.007); if (p) cl.push(p); }
        if (cl.length > 2) L.push({ kind: 'sig', p: cl });
        const g1 = surfaceSide(AXF - ARCH.r - 0.05, I.zsh(AXF - 0.5) - 0.08, sd, 0.006), g2 = surfaceSide(AXF - ARCH.r - 0.20, I.zsh(AXF - 0.5) - 0.06, sd, 0.006);
        if (g1 && g2) L.push({ kind: 'gill', p: [g1, g2] });
    }
    for (const l of L) {
        l.n = [];
        for (const q of l.p) {
            let best = 0, bd = 1e9;
            for (let v = 0; v < nBody; v++) { const d2 = (V[v * 3] - q[0]) ** 2 + (V[v * 3 + 1] - q[1]) ** 2 + (V[v * 3 + 2] - q[2]) ** 2; if (d2 < bd) { bd = d2; best = v; } }
            l.n.push(NN[best * 3], NN[best * 3 + 1], NN[best * 3 + 2]);
        }
        l.p = flat(l.p);
    }

    // footprint for the shadow
    const foot = [];
    for (let k = 0; k < 28; k++) {
        const a = k / 28 * Math.PI * 2, cx = Math.cos(a), sy = Math.sin(a);
        const px = Math.sign(cx) * Math.pow(Math.abs(cx), 0.3), py = Math.sign(sy) * Math.pow(Math.abs(sy), 0.3);
        foot.push((px > 0 ? xf : -xr) * px, Wm * 1.02 * py);
    }

    // the interior's own edges, for the ghost: where two faces meet at an angle, or a face ends.
    // (the diagonal that splits each quad into two triangles is not one of them)
    const EI = [];
    {
        const im = new Map(), fn = (t) => {
            const a = T[t * 3], b = T[t * 3 + 1], cc = T[t * 3 + 2];
            const ux = V[b * 3] - V[a * 3], uy = V[b * 3 + 1] - V[a * 3 + 1], uz = V[b * 3 + 2] - V[a * 3 + 2];
            const vx = V[cc * 3] - V[a * 3], vy = V[cc * 3 + 1] - V[a * 3 + 1], vz = V[cc * 3 + 2] - V[a * 3 + 2];
            const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(n[0], n[1], n[2]) || 1;
            return [n[0] / l, n[1] / l, n[2] / l];
        };
        for (let t = intStart; t < intEnd; t++) for (let e = 0; e < 3; e++) {
            const a = T[t * 3 + e], b = T[t * 3 + (e + 1) % 3];
            const ka = posKey(V, a), kb = posKey(V, b), key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
            const r = im.get(key); if (r) r.push(t); else im.set(key, [t, a, b]);
        }
        im.forEach((r) => {
            const t1 = r[0], t2 = r.length > 3 ? r[3] : -1;
            // only edges inside a flat face are left out (a quad's diagonal): on a rounded surface any edge can be the outline
            if (t2 >= 0) { const n1 = fn(t1), n2 = fn(t2); if (Math.abs(n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) > 0.9995) return; }
            EI.push(r[1], r[2], t1, t2);
        });
    }
    // every face out: consistent winding per part, outside by volume / rays, normals to match (car/orient.js)
    const nBefore = V.length / 3, srcOf = [];
    for (const [f, t] of [[0, intStart], [intStart, intEnd], [intEnd, T.length / 3]]) srcOf.push(...orient(V, NN, T, f, t).src);
    // the split vertices take their source's ambient occlusion
    const AOx = new Float32Array(V.length / 3);
    for (let v = 0; v < AOx.length; v++) { const s2 = v < nBefore ? v : srcOf[v - nBefore]; AOx[v] = s2 < AO.length ? AO[s2] : 0.8; }

    // edges of the shell: silhouettes and seams. Vertices split at hard edges are joined by position.
    const em = new Map();
    for (let t = 0; t < nShellTris; t++) for (let e = 0; e < 3; e++) {
        const a = T[t * 3 + e], b = T[t * 3 + (e + 1) % 3];
        const ka = posKey(V, a), kb = posKey(V, b), key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        const r = em.get(key); if (r) r.push(t); else em.set(key, [t, a, b]);
    }
    const E = [];
    em.forEach((r) => { E.push(r[1], r[2], r[0], r.length > 3 ? r[3] : -1); });

    return {
        V: new Float32Array(V), N: new Float32Array(NN), T: new Uint32Array(T), TM: new Uint8Array(TM), AO: AOx, E: new Int32Array(E),
        decals: D, pipes: P2, lines: L, foot, xf, xr, AXF, AXR, ARCH, Wm, nShellTris, capStart, intStart, intEnd, EI: new Int32Array(EI),
    };
}

module.exports = { build, MAT };
