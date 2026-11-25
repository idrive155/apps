'use strict';
/**
 * subd.js - Catmull-Clark subdivision with sharp creases, as car modellers use it: a coarse cage of
 * polygons becomes, level by level, a smooth sculpted surface; edges marked as creases (and open
 * borders) stay crisp lines. Quads and n-gons in, quads out; each new face keeps its parent's tag.
 *
 *   const out = subdivide({ P: [[x, y, z]...], F: [[i, j, k, l]...], tag: [..per face], crease: Set('i,j') }, levels)
 *   -> { P, F, tag, crease }
 */
const ek = (a, b) => (a < b ? a + ',' + b : b + ',' + a);

function level(m) {
    const P = m.P, F = m.F, nv = P.length;
    // edges: their faces, and whether sharp (a crease, or a border with one face)
    const edges = new Map();
    F.forEach((f, fi) => {
        for (let i = 0; i < f.length; i++) {
            const a = f[i], b = f[(i + 1) % f.length], k = ek(a, b);
            let e = edges.get(k);
            if (!e) { e = { a, b, faces: [] }; edges.set(k, e); }
            e.faces.push(fi);
        }
    });
    edges.forEach((e, k) => { e.sharp = e.faces.length !== 2 || m.crease.has(k); });
    // face points
    const FP = F.map((f) => { const c = [0, 0, 0]; for (const v of f) { c[0] += P[v][0]; c[1] += P[v][1]; c[2] += P[v][2]; } return c.map((q) => q / f.length); });
    const out = [];
    for (const p of P) out.push(null);                     // vertex points first (same indices)
    const fpIndex = FP.map((c) => { out.push(c); return out.length - 1; });
    const epIndex = new Map();
    edges.forEach((e, k) => {
        const pa = P[e.a], pb = P[e.b];
        let q;
        if (e.sharp) q = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
        else {
            const f0 = FP[e.faces[0]], f1 = FP[e.faces[1]];
            q = [(pa[0] + pb[0] + f0[0] + f1[0]) / 4, (pa[1] + pb[1] + f0[1] + f1[1]) / 4, (pa[2] + pb[2] + f0[2] + f1[2]) / 4];
        }
        out.push(q); epIndex.set(k, out.length - 1);
    });
    // vertex points
    const vEdges = Array.from({ length: nv }, () => []), vFaces = Array.from({ length: nv }, () => []);
    edges.forEach((e) => { vEdges[e.a].push(e); vEdges[e.b].push(e); });
    F.forEach((f, fi) => { for (const v of f) vFaces[v].push(fi); });
    for (let v = 0; v < nv; v++) {
        const p = P[v], es = vEdges[v], sharp = es.filter((e) => e.sharp);
        if (!es.length) { out[v] = p.slice(); continue; }
        if (sharp.length > 2) { out[v] = p.slice(); continue; }                 // a corner stays
        if (sharp.length === 2) {                                                // on a crease: the crease rule
            const o1 = P[sharp[0].a === v ? sharp[0].b : sharp[0].a], o2 = P[sharp[1].a === v ? sharp[1].b : sharp[1].a];
            out[v] = [(6 * p[0] + o1[0] + o2[0]) / 8, (6 * p[1] + o1[1] + o2[1]) / 8, (6 * p[2] + o1[2] + o2[2]) / 8];
            continue;
        }
        const n = es.length, Fa = [0, 0, 0], Ra = [0, 0, 0];
        for (const fi of vFaces[v]) { Fa[0] += FP[fi][0]; Fa[1] += FP[fi][1]; Fa[2] += FP[fi][2]; }
        const nf = vFaces[v].length || 1;
        for (const e of es) { const o = P[e.a === v ? e.b : e.a]; Ra[0] += (p[0] + o[0]) / 2; Ra[1] += (p[1] + o[1]) / 2; Ra[2] += (p[2] + o[2]) / 2; }
        out[v] = [0, 1, 2].map((i) => (Fa[i] / nf + 2 * Ra[i] / n + (n - 3) * p[i]) / n);
    }
    // new faces and creases
    const NF = [], tag = [], crease = new Set();
    F.forEach((f, fi) => {
        for (let i = 0; i < f.length; i++) {
            const v = f[i], next = f[(i + 1) % f.length], prev = f[(i - 1 + f.length) % f.length];
            NF.push([v, epIndex.get(ek(v, next)), fpIndex[fi], epIndex.get(ek(prev, v))]);
            tag.push(m.tag[fi]);
        }
    });
    edges.forEach((e, k) => {
        if (!m.crease.has(k)) return;
        const mid = epIndex.get(k);
        crease.add(ek(e.a, mid)); crease.add(ek(mid, e.b));
    });
    return { P: out, F: NF, tag, crease };
}

function subdivide(m, levels) {
    let cur = { P: m.P, F: m.F, tag: m.tag, crease: m.crease || new Set() };
    for (let i = 0; i < levels; i++) cur = level(cur);
    return cur;
}

module.exports = { subdivide, ek };
