'use strict';
/**
 * poly.js - anti-aliased fills built from plain triangles.
 *
 * The renderer's TRIS op has no anti-aliasing (no MSAA on the head unit), but it does
 * interpolate a colour per vertex. So every edge gets a "fringe": a thin strip of triangles
 * whose outer vertices carry alpha 0, one pixel wide. Inner edge half a pixel in, outer half a
 * pixel out: the coverage ramp of a perfectly filtered edge. Make the strip wider and it is a
 * soft feather (shadows, glows), still one draw op.
 */
const { fade } = require('./rec');

const NX = new Float32Array(1024), NY = new Float32Array(1024), IX = new Float32Array(1024), IY = new Float32Array(1024);

function area2(p, n) { let s = 0; for (let i = 0, j = n - 1; i < n; j = i++) s += p[j * 2] * p[i * 2 + 1] - p[i * 2] * p[j * 2 + 1]; return s; }

/** vertex normals (miter, limited) of a closed polygon, pointing out */
function normals(p, n) {
    const sgn = area2(p, n) > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
        const a = (i + n - 1) % n, b = (i + 1) % n;
        let ex0 = p[i * 2] - p[a * 2], ey0 = p[i * 2 + 1] - p[a * 2 + 1];
        let ex1 = p[b * 2] - p[i * 2], ey1 = p[b * 2 + 1] - p[i * 2 + 1];
        let l0 = Math.hypot(ex0, ey0) || 1, l1 = Math.hypot(ex1, ey1) || 1;
        // outward normal of an edge (dx, dy) for a polygon of sign sgn: (dy, -dx) * sgn
        let n0x = ey0 / l0 * sgn, n0y = -ex0 / l0 * sgn, n1x = ey1 / l1 * sgn, n1y = -ex1 / l1 * sgn;
        let mx = n0x + n1x, my = n0y + n1y; const ml = mx * mx + my * my;
        if (ml < 1e-6) { mx = n1x; my = n1y; } else {
            // miter length 1/cos(half angle), capped so sharp corners do not spike
            let k = 2 / ml; if (k > 4) k = 4;
            mx *= k; my *= k;
        }
        NX[i] = mx; NY[i] = my;
    }
}

/**
 * Filled polygon with an anti-aliased edge.
 * p: [x0, y0, x1, y1, ...] screen px, n points. col: one colour, or array/Uint32Array per vertex.
 * idx: triangle indices (concave shapes), or null for a fan (convex).
 * feather: width of the edge ramp in px (1 = crisp anti-aliasing, more = soft).
 */
function fill(rec, p, n, col, idx, feather) {
    if (n < 3) return;
    const per = typeof col !== 'number';
    feather = feather || 1;
    normals(p, n);
    const hin = Math.min(feather * 0.5, 0.5), hout = feather - hin;
    for (let i = 0; i < n; i++) { IX[i] = p[i * 2] - NX[i] * hin; IY[i] = p[i * 2 + 1] - NY[i] * hin; }
    const C = (i) => (per ? col[i] : col);
    if (idx) {
        for (let t = 0; t < idx.length; t += 3) {
            const a = idx[t], b = idx[t + 1], c = idx[t + 2];
            rec.tri(IX[a], IY[a], C(a), IX[b], IY[b], C(b), IX[c], IY[c], C(c));
        }
    } else {
        for (let i = 1; i < n - 1; i++) rec.tri(IX[0], IY[0], C(0), IX[i], IY[i], C(i), IX[i + 1], IY[i + 1], C(i + 1));
    }
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const ci = C(i), cj = C(j), ci0 = fade(ci, 0), cj0 = fade(cj, 0);
        const oix = p[i * 2] + NX[i] * hout, oiy = p[i * 2 + 1] + NY[i] * hout;
        const ojx = p[j * 2] + NX[j] * hout, ojy = p[j * 2 + 1] + NY[j] * hout;
        rec.tri(IX[j], IY[j], cj, IX[i], IY[i], ci, oix, oiy, ci0);
        rec.tri(IX[j], IY[j], cj, oix, oiy, ci0, ojx, ojy, cj0);
    }
}

/**
 * Soft blob: polygon whose colour fades to nothing over `soft` px outside (and `inner` px inside).
 * Shadows, light pools, glows.
 */
function soft(rec, p, n, col, soft, inner) {
    normals(p, n);
    inner = inner || 0;
    const c0 = fade(col, 0);
    for (let i = 0; i < n; i++) { IX[i] = p[i * 2] - NX[i] * inner; IY[i] = p[i * 2 + 1] - NY[i] * inner; }
    for (let i = 1; i < n - 1; i++) rec.tri(IX[0], IY[0], col, IX[i], IY[i], col, IX[i + 1], IY[i + 1], col);
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const oix = p[i * 2] + NX[i] * soft, oiy = p[i * 2 + 1] + NY[i] * soft;
        const ojx = p[j * 2] + NX[j] * soft, ojy = p[j * 2 + 1] + NY[j] * soft;
        rec.tri(IX[j], IY[j], col, IX[i], IY[i], col, oix, oiy, c0);
        rec.tri(IX[j], IY[j], col, oix, oiy, c0, ojx, ojy, c0);
    }
}

/**
 * Ribbon along a polyline: xy[i], half width hw[i] (px), colour col[i]; fringe on both sides.
 * Joints use the averaged direction, so thin trails stay smooth.
 */
const LX = new Float32Array(4096), LY = new Float32Array(4096), RX = new Float32Array(4096), RY = new Float32Array(4096), DX = new Float32Array(4096), DY = new Float32Array(4096);
function ribbon(rec, xy, hw, col, n, edge) {
    if (n < 2) return;
    edge = edge === undefined ? 1 : edge;
    for (let i = 0; i < n; i++) {
        const a = i > 0 ? i - 1 : 0, b = i < n - 1 ? i + 1 : n - 1;
        let dx = xy[b * 2] - xy[a * 2], dy = xy[b * 2 + 1] - xy[a * 2 + 1];
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        DX[i] = -dy; DY[i] = dx;
        const w = Math.max(hw[i] - edge * 0.5, 0.05);
        LX[i] = xy[i * 2] + DX[i] * w; LY[i] = xy[i * 2 + 1] + DY[i] * w;
        RX[i] = xy[i * 2] - DX[i] * w; RY[i] = xy[i * 2 + 1] - DY[i] * w;
    }
    for (let i = 0; i < n - 1; i++) {
        const c0 = col[i], c1 = col[i + 1];
        rec.tri(LX[i], LY[i], c0, RX[i], RY[i], c0, RX[i + 1], RY[i + 1], c1);
        rec.tri(LX[i], LY[i], c0, RX[i + 1], RY[i + 1], c1, LX[i + 1], LY[i + 1], c1);
        if (edge > 0) {
            const z0 = fade(c0, 0), z1 = fade(c1, 0);
            const e0 = edge, e1 = edge;
            rec.tri(LX[i], LY[i], c0, LX[i + 1], LY[i + 1], c1, LX[i + 1] + DX[i + 1] * e1, LY[i + 1] + DY[i + 1] * e1, z1);
            rec.tri(LX[i], LY[i], c0, LX[i + 1] + DX[i + 1] * e1, LY[i + 1] + DY[i + 1] * e1, z1, LX[i] + DX[i] * e0, LY[i] + DY[i] * e0, z0);
            rec.tri(RX[i], RY[i], c0, RX[i + 1], RY[i + 1], c1, RX[i + 1] - DX[i + 1] * e1, RY[i + 1] - DY[i + 1] * e1, z1);
            rec.tri(RX[i], RY[i], c0, RX[i + 1] - DX[i + 1] * e1, RY[i + 1] - DY[i + 1] * e1, z1, RX[i] - DX[i] * e0, RY[i] - DY[i] * e0, z0);
        }
    }
}

/** ear clipping, once, for concave outlines (decals); returns triangle indices */
function triangulate(p, n) {
    const idx = [], V = []; for (let i = 0; i < n; i++) V.push(i);
    const s = area2(p, n) > 0 ? 1 : -1;
    const cross = (a, b, c) => ((p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[a * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[a * 2])) * s;
    const inside = (a, b, c, q) => cross(a, b, q) >= 0 && cross(b, c, q) >= 0 && cross(c, a, q) >= 0;
    let guard = 0;
    while (V.length > 3 && guard++ < 10000) {
        let cut = false;
        for (let k = 0; k < V.length; k++) {
            const a = V[(k + V.length - 1) % V.length], b = V[k], c = V[(k + 1) % V.length];
            if (cross(a, b, c) <= 1e-9) continue;
            let ok = true;
            for (const q of V) if (q !== a && q !== b && q !== c && inside(a, b, c, q)) { ok = false; break; }
            if (!ok) continue;
            idx.push(a, b, c); V.splice(k, 1); cut = true; break;
        }
        if (!cut) break;
    }
    if (V.length === 3) idx.push(V[0], V[1], V[2]);
    return idx;
}

module.exports = { fill, soft, ribbon, triangulate, area2 };
