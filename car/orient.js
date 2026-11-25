'use strict';
/**
 * orient.js - "recalculate normals outside" for a triangle mesh, as a modeller does it.
 *
 *   1. Parts: triangles joined across shared edges (vertices are matched by position, so
 *      split hard edges still join) make connected parts.
 *   2. Consistent winding: inside a part, every edge shared by exactly two triangles must be
 *      walked in opposite directions by them; a flood fill turns the triangles that disagree.
 *   3. Outside: a closed part (no open edges) faces out when its signed volume is positive.
 *      An open part (a shell with holes) is decided by rays: from sample triangles a ray is cast
 *      along the normal and against it; the side whose rays hit the part's own surface less
 *      often is the outside. A flat part whose two sides tie keeps the winding it was made with.
 *   4. Normals: every vertex normal is turned to agree with the (now outward) faces around it;
 *      a vertex shared by faces that look opposite ways (a thin two-sided panel) is split, so
 *      every triangle's corner normals point the way the triangle faces. V and N must be plain
 *      arrays (they may grow); rep.src lists the source vertex of every vertex added.
 *
 * orient(V, N, T, from, to) works in place on the triangles from..to (default: all) and returns
 * a report { parts, closed, open, flippedTris, flippedParts, fixedNormals, nonManifold }.
 */
function orient(V, N, T, from, to) {
    from = from || 0; to = to === undefined ? T.length / 3 : to;
    const nt = to - from, rep = { parts: 0, closed: 0, open: 0, flippedTris: 0, flippedParts: 0, fixedNormals: 0, nonManifold: 0, split: 0, src: [] };
    if (nt <= 0) return rep;
    // position ids
    const pid = new Map(), P = new Int32Array(V.length / 3);
    for (let v = 0; v < V.length / 3; v++) {
        const k = Math.round(V[v * 3] * 2000) + ',' + Math.round(V[v * 3 + 1] * 2000) + ',' + Math.round(V[v * 3 + 2] * 2000);
        let id = pid.get(k); if (id === undefined) { id = pid.size; pid.set(k, id); } P[v] = id;
    }
    // edges -> the triangles (local index) that use them, with the direction they walk it
    const edges = new Map();
    for (let i = 0; i < nt; i++) {
        const t = from + i;
        for (let e = 0; e < 3; e++) {
            const a = P[T[t * 3 + e]], b = P[T[t * 3 + (e + 1) % 3]];
            if (a === b) continue;
            const k = a < b ? a + ':' + b : b + ':' + a, dir = a < b ? 1 : -1;
            const r = edges.get(k); if (r) r.push(i, dir); else edges.set(k, [i, dir]);
        }
    }
    const nbr = [];
    for (let i = 0; i < nt; i++) nbr.push([]);
    const open = new Uint8Array(nt);
    edges.forEach((r) => {
        if (r.length === 4) { nbr[r[0]].push(r[2], r[1] === r[3] ? 1 : 0); nbr[r[2]].push(r[0], r[1] === r[3] ? 1 : 0); }
        else if (r.length === 2) open[r[0]] = 1;
        else { rep.nonManifold++; for (let j = 0; j < r.length; j += 2) open[r[j]] = 1; }
    });
    const flip = (t) => { const b = T[t * 3 + 1]; T[t * 3 + 1] = T[t * 3 + 2]; T[t * 3 + 2] = b; };
    const fn = (t, out) => {
        const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
        const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
        out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
        return out;
    };
    // 1 + 2: flood fill each part, turning triangles to agree with their neighbours
    const part = new Int32Array(nt).fill(-1), turned = new Uint8Array(nt), parts = [];
    for (let s = 0; s < nt; s++) {
        if (part[s] >= 0) continue;
        const list = [s], id = parts.length; part[s] = id;
        for (let q = 0; q < list.length; q++) {
            const i = list[q], nb = nbr[i];
            for (let j = 0; j < nb.length; j += 2) {
                const k = nb[j]; if (part[k] >= 0) continue;
                // same direction on the shared edge = opposite windings; after turning i, compare again
                part[k] = id; turned[k] = turned[i] ^ nb[j + 1]; list.push(k);
            }
        }
        parts.push(list);
    }
    for (let i = 0; i < nt; i++) if (turned[i]) { flip(from + i); rep.flippedTris++; }
    // 3: outside per part
    const f = [0, 0, 0], g = [0, 0, 0];
    for (const list of parts) {
        rep.parts++;
        let isOpen = false;
        for (const i of list) if (open[i]) { isOpen = true; break; }
        let sign = 0;
        if (!isOpen) {
            rep.closed++;
            let vol = 0;
            for (const i of list) {
                const t = from + i, a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
                vol += V[a] * (V[b + 1] * V[c + 2] - V[b + 2] * V[c + 1]) - V[a + 1] * (V[b] * V[c + 2] - V[b + 2] * V[c]) + V[a + 2] * (V[b] * V[c + 1] - V[b + 1] * V[c]);
            }
            sign = vol > 0 ? 1 : vol < 0 ? -1 : 0;
        } else {
            rep.open++;
            // rays from up to 24 sample triangles, both ways, against the part's own triangles
            let outHits = 0, inHits = 0;
            const step = Math.max(1, Math.floor(list.length / 24));
            for (let q = 0; q < list.length; q += step) {
                const t = from + list[q]; fn(t, f);
                const l = Math.hypot(f[0], f[1], f[2]); if (l < 1e-12) continue;
                const dx = f[0] / l, dy = f[1] / l, dz = f[2] / l;
                const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
                const ox = (V[a] + V[b] + V[c]) / 3, oy = (V[a + 1] + V[b + 1] + V[c + 1]) / 3, oz = (V[a + 2] + V[b + 2] + V[c + 2]) / 3;
                for (const i of list) {
                    const u = from + i; if (u === t) continue;
                    const h = ray(V, T, u, ox, oy, oz, dx, dy, dz);
                    if (h > 1e-4) outHits++; else if (h < -1e-4) inHits++;
                }
            }
            sign = outHits < inHits ? 1 : outHits > inHits ? -1 : 0;
            if (sign === 0) {
                // a flat or tied part: keep the side its normals were authored for (majority vote)
                let agree = 0;
                for (const i of list) {
                    const t = from + i; fn(t, f);
                    for (let e = 0; e < 3; e++) { const v = T[t * 3 + e] * 3; agree += (f[0] * N[v] + f[1] * N[v + 1] + f[2] * N[v + 2]) > 0 ? 1 : -1; }
                }
                sign = agree >= 0 ? 1 : -1;
            }
        }
        if (sign < 0) { for (const i of list) flip(from + i); rep.flippedParts++; }
    }
    // 4: vertex normals agree with their faces
    const acc = new Float32Array(V.length), used = new Uint8Array(V.length / 3);
    for (let i = 0; i < nt; i++) {
        const t = from + i; fn(t, g);
        for (let e = 0; e < 3; e++) { const v = T[t * 3 + e]; acc[v * 3] += g[0]; acc[v * 3 + 1] += g[1]; acc[v * 3 + 2] += g[2]; used[v] = 1; }
    }
    for (let v = 0; v < used.length; v++) {
        if (!used[v]) continue;
        const d = acc[v * 3] * N[v * 3] + acc[v * 3 + 1] * N[v * 3 + 1] + acc[v * 3 + 2] * N[v * 3 + 2];
        if (d < 0) { N[v * 3] = -N[v * 3]; N[v * 3 + 1] = -N[v * 3 + 1]; N[v * 3 + 2] = -N[v * 3 + 2]; rep.fixedNormals++; }
        else if (N[v * 3] === 0 && N[v * 3 + 1] === 0 && N[v * 3 + 2] === 0) {
            const l = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]) || 1;
            N[v * 3] = acc[v * 3] / l; N[v * 3 + 1] = acc[v * 3 + 1] / l; N[v * 3 + 2] = acc[v * 3 + 2] / l; rep.fixedNormals++;
        }
    }
    // auto smooth: a corner whose normal is more than 60 degrees off its face (it looks against it,
    // or it is shared with a surface that turns away, like the rim of a flat end cap) gets a vertex
    // of its own with the face's normal; corners of one flat face share it
    const dup = new Map(), COS = 0.5;
    for (let i = 0; i < nt; i++) {
        const t = from + i; fn(t, g);
        const gl = Math.hypot(g[0], g[1], g[2]); if (gl < 1e-14) continue;
        const gx = g[0] / gl, gy = g[1] / gl, gz = g[2] / gl;
        for (let e = 0; e < 3; e++) {
            const v = T[t * 3 + e], nl = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
            if ((gx * N[v * 3] + gy * N[v * 3 + 1] + gz * N[v * 3 + 2]) / nl >= COS) continue;
            const key = v + '|' + Math.round(gx * 20) + ',' + Math.round(gy * 20) + ',' + Math.round(gz * 20);
            let w = dup.get(key);
            if (w === undefined) {
                w = V.length / 3; dup.set(key, w);
                V.push(V[v * 3], V[v * 3 + 1], V[v * 3 + 2]); N.push(gx, gy, gz);
                rep.src.push(v); rep.split++;
            }
            T[t * 3 + e] = w;
        }
    }
    return rep;
}

/** signed distance along (d) from o to triangle u (Möller-Trumbore), 0 if it misses */
function ray(V, T, u, ox, oy, oz, dx, dy, dz) {
    const a = T[u * 3] * 3, b = T[u * 3 + 1] * 3, c = T[u * 3 + 2] * 3;
    const e1x = V[b] - V[a], e1y = V[b + 1] - V[a + 1], e1z = V[b + 2] - V[a + 2];
    const e2x = V[c] - V[a], e2y = V[c + 1] - V[a + 1], e2z = V[c + 2] - V[a + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) return 0;
    const inv = 1 / det, sx = ox - V[a], sy = oy - V[a + 1], sz = oz - V[a + 2];
    const uu = (sx * px + sy * py + sz * pz) * inv; if (uu < 0 || uu > 1) return 0;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const vv = (dx * qx + dy * qy + dz * qz) * inv; if (vv < 0 || uu + vv > 1) return 0;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

/** a check without changing anything: faces whose normals disagree with their winding, and inconsistent edges */
function audit(V, N, T, from, to) {
    from = from || 0; to = to === undefined ? T.length / 3 : to;
    const Vc = Array.from(V), Nc = Array.from(N), Tc = Array.from(T);
    let bad = 0;
    for (let t = from; t < to; t++) {
        const a = Tc[t * 3] * 3, b = Tc[t * 3 + 1] * 3, c = Tc[t * 3 + 2] * 3;
        const ux = Vc[b] - Vc[a], uy = Vc[b + 1] - Vc[a + 1], uz = Vc[b + 2] - Vc[a + 2], vx = Vc[c] - Vc[a], vy = Vc[c + 1] - Vc[a + 1], vz = Vc[c + 2] - Vc[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const s = (Nc[a] + Nc[b] + Nc[c]) * nx + (Nc[a + 1] + Nc[b + 1] + Nc[c + 1]) * ny + (Nc[a + 2] + Nc[b + 2] + Nc[c + 2]) * nz;
        if (s < 0) bad++;
    }
    const before = Tc.slice(from * 3, to * 3), Nb = Nc.slice(), Vb = Vc.slice();
    const rep = orient(Vc, Nc, Tc, from, to);
    // triangles that end up facing the other way than the renderer would have drawn them
    let wrong = 0;
    for (let t = from; t < to; t++) {
        const i = (t - from) * 3;
        const tri = (I, VV) => { const a = I[0] * 3, b = I[1] * 3, c = I[2] * 3;
            const ux = VV[b] - VV[a], uy = VV[b + 1] - VV[a + 1], uz = VV[b + 2] - VV[a + 2], vx = VV[c] - VV[a], vy = VV[c + 1] - VV[a + 1], vz = VV[c + 2] - VV[a + 2];
            return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; };
        const I0 = [before[i], before[i + 1], before[i + 2]], n0 = tri(I0, Vb);
        const drawn = Math.sign((Nb[I0[0] * 3] + Nb[I0[1] * 3] + Nb[I0[2] * 3]) * n0[0] + (Nb[I0[0] * 3 + 1] + Nb[I0[1] * 3 + 1] + Nb[I0[2] * 3 + 1]) * n0[1] + (Nb[I0[0] * 3 + 2] + Nb[I0[1] * 3 + 2] + Nb[I0[2] * 3 + 2]) * n0[2]);
        const n1 = tri([Tc[t * 3], Tc[t * 3 + 1], Tc[t * 3 + 2]], Vc);
        if (Math.sign(n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2]) * drawn < 0) wrong++;
    }
    return Object.assign(rep, { normalVsWinding: bad, wrongSide: wrong, tris: to - from });
}

module.exports = { orient, audit };
