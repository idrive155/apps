'use strict';
/**
 * qr.js - a QR code (ISO/IEC 18004) for a short text such as a link: byte mode, error correction
 * level M (15 % of the code can be lost), versions 1 to 10 (up to 213 bytes), the mask with the
 * lowest penalty. No dependencies; runs on the head unit's Node 8.
 *
 *   const q = qr('https://...');   // { size, dark(x, y) }
 */

/* GF(256), polynomial 0x11d */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
const mul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);

function rsGenerator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
        const next = new Array(g.length + 1).fill(0);
        for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= mul(g[j], EXP[i]); }
        g = next;
    }
    return g;
}
function rsRemainder(data, n) {
    const g = rsGenerator(n), r = new Array(n).fill(0);
    for (const d of data) {
        const f = d ^ r.shift(); r.push(0);
        for (let j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f);
    }
    return r;
}

/* level M: [ec codewords per block, [blocks, data codewords per block]...] and alignment centres */
const VERSIONS = [null,
    [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
    [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]];
const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function bch(value, poly, bits) {
    let v = value << bits;
    const top = 31 - Math.clz32(poly);
    while (v && 31 - Math.clz32(v) >= top) v ^= poly << (31 - Math.clz32(v) - top);
    return (value << bits) | v;
}

function utf8(s) {
    if (typeof Buffer !== 'undefined') return Array.from(Buffer.from(s, 'utf8'));
    return Array.from(new TextEncoder().encode(s));
}

function qr(text) {
    const bytes = utf8(String(text));
    let ver = 0, dataCw = 0;
    for (let v = 1; v <= 10; v++) {
        const cw = VERSIONS[v][1].reduce((a, g) => a + g[0] * g[1], 0), lenBits = v < 10 ? 8 : 16;
        if (4 + lenBits + bytes.length * 8 <= cw * 8) { ver = v; dataCw = cw; break; }
    }
    if (!ver) throw new Error('qr: text too long (' + bytes.length + ' bytes)');
    // the bit stream: mode 0100, length, the bytes, terminator, padding
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver < 10 ? 8 : 16); for (const b of bytes) put(b, 8);
    put(0, Math.min(4, dataCw * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (let p = 0; data.length < dataCw; p++) data.push(p % 2 ? 0x11 : 0xec);
    // blocks, error correction, interleaving
    const [ecn, groups] = VERSIONS[ver], blocks = [], ecs = [];
    let at = 0;
    for (const [count, len] of groups) for (let k = 0; k < count; k++) { const b = data.slice(at, at + len); at += len; blocks.push(b); ecs.push(rsRemainder(b, ecn)); }
    const out = [], maxLen = Math.max.apply(null, blocks.map((b) => b.length));
    for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecn; i++) for (const e of ecs) out.push(e[i]);

    // the matrix
    const size = ver * 4 + 17, M = new Int8Array(size * size).fill(-1), F = new Uint8Array(size * size);   // F: function module
    const set = (x, y, v) => { M[y * size + x] = v ? 1 : 0; F[y * size + x] = 1; };
    const finder = (cx, cy) => {
        for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
            const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue;
            const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4);
        }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    for (let i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
    const al = ALIGN[ver];
    for (const ax of al) for (const ay of al) {
        if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    // reserve format (and version) areas
    for (let i = 0; i < 9; i++) { F[8 * size + i] = 1; F[i * size + 8] = 1; }
    for (let i = 0; i < 8; i++) { F[8 * size + size - 1 - i] = 1; F[(size - 1 - i) * size + 8] = 1; }
    set(8, size - 8, 1);                                                   // the dark module
    if (ver >= 7) for (let i = 0; i < 18; i++) { const a = Math.floor(i / 3), b = size - 11 + i % 3; F[b * size + a] = 1; F[a * size + b] = 1; }
    // data, in the zigzag
    const cwBits = []; for (const c of out) for (let i = 7; i >= 0; i--) cwBits.push((c >>> i) & 1);
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5;
        for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
            const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
            if (F[y * size + x]) continue;
            M[y * size + x] = bi < cwBits.length ? cwBits[bi] : 0; bi++;
        }
    }
    const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
        (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
        (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];
    const withMask = (mask) => {
        const R = Int8Array.from(M);
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y * size + x] && MASKS[mask](x, y)) R[y * size + x] ^= 1;
        // format: level M = 00, then the mask, BCH, xor
        const fmt = bch((0 << 3) | mask, 0x537, 10) ^ 0x5412;
        const fb = (i) => (fmt >>> i) & 1;
        const at3 = (x, y, v) => { R[y * size + x] = v; };
        for (let i = 0; i <= 5; i++) at3(8, i, fb(i));
        at3(8, 7, fb(6)); at3(8, 8, fb(7)); at3(7, 8, fb(8));
        for (let i = 9; i < 15; i++) at3(14 - i, 8, fb(i));
        for (let i = 0; i < 8; i++) at3(size - 1 - i, 8, fb(i));
        for (let i = 8; i < 15; i++) at3(8, size - 15 + i, fb(i));
        R[(size - 8) * size + 8] = 1;
        if (ver >= 7) {
            const vb = bch(ver, 0x1f25, 12);
            for (let i = 0; i < 18; i++) { const bit = (vb >>> i) & 1, a = Math.floor(i / 3), b = size - 11 + i % 3; R[b * size + a] = bit; R[a * size + b] = bit; }
        }
        return R;
    };
    const penalty = (R) => {
        let p = 0;
        const at2 = (x, y) => R[y * size + x];
        for (let pass = 0; pass < 2; pass++) for (let i = 0; i < size; i++) {
            let run = 1;
            for (let j = 1; j <= size; j++) {
                const same = j < size && (pass ? at2(i, j) === at2(i, j - 1) : at2(j, i) === at2(j - 1, i));
                if (same) run++; else { if (run >= 5) p += run - 2; run = 1; }
            }
        }
        for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = at2(x, y); if (c === at2(x + 1, y) && c === at2(x, y + 1) && c === at2(x + 1, y + 1)) p += 3; }
        const pat = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], tap = pat.slice().reverse();
        for (let y = 0; y < size; y++) for (let x = 0; x <= size - 11; x++) for (const pt of [pat, tap]) {
            let h = true, v = true;
            for (let k = 0; k < 11; k++) { if (at2(x + k, y) !== pt[k]) h = false; if (at2(y, x + k) !== pt[k]) v = false; }
            if (h) p += 40; if (v) p += 40;
        }
        let dark = 0; for (let i = 0; i < R.length; i++) dark += R[i];
        p += Math.floor(Math.abs(dark * 20 - R.length * 10) / R.length) * 10;
        return p;
    };
    let best = null, bestP = Infinity;
    for (let m = 0; m < 8; m++) { const R = withMask(m), p = penalty(R); if (p < bestP) { bestP = p; best = R; } }
    return { size, version: ver, dark: (x, y) => best[y * size + x] === 1 };
}

module.exports = { qr };
