'use strict';
/**
 * world.js - everything on the ground: the floor and its grid, the light pool the car sits in,
 * its soft shadow, the protractor that shows the drift angle on the asphalt, glowing tyre
 * trails coloured by angle, and tyre smoke.
 */
const { pk, fade, rgba } = require('../engine/rec');
const poly = require('../engine/poly');
const text = require('../engine/text');
const TM = require('../ui/theme');

const TMP = new Float32Array(3), PTS = new Float32Array(512);

/*
 * colour along the angle scale: the M colours themselves (the logo's codes), in sharp steps, never
 * mixed (a mix of them is a colour of no one's): light blue to 25 deg, dark blue to 45, red above
 */
const M1 = [0x00 / 255, 0xa1 / 255, 0xd6 / 255], M2 = [0x35 / 255, 0x31 / 255, 0x89 / 255], M3 = [0xe6 / 255, 0x24 / 255, 0x2e / 255];
function angleRGB(deg, out) {
    const c = deg < 25 ? M1 : deg < 45 ? M2 : M3;
    out[0] = c[0]; out[1] = c[1]; out[2] = c[2];
    return out;
}
const AC = [0, 0, 0];
function angleColour(deg, a) { angleRGB(deg, AC); return pk(AC[0], AC[1], AC[2], a); }

/** project a ground point; false if too close to the camera */
function gp(cam, x, y, z) { return cam.proj(x, y, z || 0, TMP, 0) && TMP[2] > 2.5; }

/** clip the segment (x0,y0)-(x1,y1) to the screen plus a margin (Liang-Barsky); null when outside */
const CL = new Float32Array(4);
function clipSeg(x0, y0, x1, y1, W, H) {
    const m = 40, dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy], q = [x0 + m, W + m - x0, y0 + m, H + m - y0];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; continue; }
        const r = q[i] / p[i];
        if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    CL[0] = x0 + dx * t0; CL[1] = y0 + dy * t0; CL[2] = x0 + dx * t1; CL[3] = y0 + dy * t1;
    return CL;
}

/* ---------- floor ---------- */
function floor(rec, cam, W, H, cx, cy) {
    const F = TM.theme().floor, G = F.grid, Gm = F.gridMinor, Hz = F.horizon;
    rec.grad(0, 0, W, H, [0, F.sky[0], 0.45, F.sky[1], 1, F.sky[2]]);
    // a low camera sees the horizon: night sky above it, a city glow along it
    const hy = cam.cy - cam.f * Math.tan(cam.pitch);
    if (hy > -40) {
        const top = Math.min(hy, H);
        rec.grad(0, 0, W, Math.max(1, top), [0, F.sky[0], 0.7, F.sky[1], 1, F.sky[2]]);
        rec.grad(0, top, W, Math.max(1, H - top), [0, F.sky[2], 0.3, F.sky[1], 1, F.sky[2]]);
        // only a wide, faint glow along it: no drawn line (a hard edge across the picture reads as a fault)
        rec.grad(0, top - 70, W, 140, [0, pk(Hz[0], Hz[1], Hz[2], 0), 0.5, pk(Hz[0], Hz[1], Hz[2], 0.07), 1, pk(Hz[0], Hz[1], Hz[2], 0)]);
    }
    // grid every 2 m (every 10 m brighter), lines cut into pieces that fade with distance
    const step = 2, span = 46, x0 = Math.floor((cx - span) / step) * step, y0 = Math.floor((cy - span) / step) * step;
    const seg = (ax, ay, bx, by, major) => {
        const n = 6;
        for (let k = 0; k < n; k++) {
            const u0 = k / n, u1 = (k + 1) / n;
            const px = ax + (bx - ax) * u0, py = ay + (by - ay) * u0, qx = ax + (bx - ax) * u1, qy = ay + (by - ay) * u1;
            if (!gp(cam, px, py)) continue; const sx = TMP[0], sy = TMP[1], d0 = TMP[2];
            if (!gp(cam, qx, qy)) continue;
            const d = (d0 + TMP[2]) / 2, fadeK = Math.max(0, 1 - (d - 6) / 34);
            if (fadeK <= 0.02) continue;
            const mx = (px + qx) / 2 - cx, my = (py + qy) / 2 - cy, near = Math.max(0, 1 - Math.hypot(mx, my) / 30);
            const a = (major ? 0.15 : 0.065) * fadeK * (0.8 + 0.0 * near);   // even: no brighter patch around the car
            const c = clipSeg(sx, sy, TMP[0], TMP[1], W, H); if (!c) continue;
            rec.line(c[0], c[1], c[2], c[3], major ? 1.4 : 1.0, major ? pk(G[0], G[1], G[2], a) : pk(Gm[0], Gm[1], Gm[2], a));
        }
    };
    for (let x = x0; x <= cx + span; x += step) seg(x, cy - span, x, cy + span, Math.round(x / step) % 5 === 0);
    for (let y = y0; y <= cy + span; y += step) seg(cx - span, y, cx + span, y, Math.round(y / step) % 5 === 0);
}

/** a circle (ellipse in perspective) of radius r around (x, y) on the ground, into PTS; returns point count */
function ring(cam, x, y, r, n) {
    let k = 0;
    for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        if (!gp(cam, x + Math.cos(a) * r, y + Math.sin(a) * r)) continue;
        PTS[k * 2] = TMP[0]; PTS[k * 2 + 1] = TMP[1]; k++;
    }
    return k;
}

function lightPool(rec, cam, x, y) {
    const P = TM.theme().pool;
    let n = ring(cam, x, y, 5.6, 40);
    if (n > 2) poly.soft(rec, PTS, n, rgba(P[0][0], P[0][1], P[0][2], P[0][3]), 110, 0);
    n = ring(cam, x, y, 3.6, 40);
    if (n > 2) poly.soft(rec, PTS, n, rgba(P[1][0], P[1][1], P[1][2], P[1][3]), 90, 0);
}

/**
 * soft shadow under the car: the footprint (car frame) laid on the ground as rings - a dark core
 * and a fading border, all made on the ground and only then projected. Softening in screen space
 * (the old way) pulled spikes out of the outline wherever a low camera squashed it flat.
 */
const SH_RING = [[-0.10, 0.62], [0.08, 0.50], [0.24, 0.24], [0.42, 0.0]];      // (metres out from the footprint, opacity)
const SH = new Float64Array(64 * 3 * SH_RING.length);
function shadow(rec, cam, foot, st) {
    const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw), n = foot.length / 2;
    if (n < 3 || n > 64) return;
    // the footprint's centre, and every point's way out from it (on the ground)
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += foot[i * 2]; my += foot[i * 2 + 1]; }
    mx /= n; my /= n;
    for (let r = 0; r < SH_RING.length; r++) {
        const d = SH_RING[r][0];
        for (let i = 0; i < n; i++) {
            const lx = foot[i * 2], ly = foot[i * 2 + 1];
            // the outward normal at this point: across its neighbours
            const ax = foot[((i + n - 1) % n) * 2], ay = foot[((i + n - 1) % n) * 2 + 1], bx = foot[((i + 1) % n) * 2], by = foot[((i + 1) % n) * 2 + 1];
            let nx = by - ay, ny = -(bx - ax); const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
            if (nx * (lx - mx) + ny * (ly - my) < 0) { nx = -nx; ny = -ny; }
            const px = lx + nx * d + 0.12, py = ly + ny * d - 0.08, o = (r * n + i) * 3;
            if (!gp(cam, st.x + cy * px - sy * py, st.y + sy * px + cy * py)) { SH[o + 2] = -1; continue; }
            SH[o] = TMP[0]; SH[o + 1] = TMP[1]; SH[o + 2] = 1;
        }
    }
    const P = (r, i) => (r * n + i) * 3;
    // the core: a fan from the centre
    if (gp(cam, st.x + cy * (mx + 0.12) - sy * (my - 0.08), st.y + sy * (mx + 0.12) + cy * (my - 0.08))) {
        const ccx = TMP[0], ccy = TMP[1], c0 = rgba(0, 0, 0, SH_RING[0][1]);
        for (let i = 0; i < n; i++) {
            const a = P(0, i), b = P(0, (i + 1) % n);
            if (SH[a + 2] < 0 || SH[b + 2] < 0) continue;
            rec.tri(ccx, ccy, c0, SH[a], SH[a + 1], c0, SH[b], SH[b + 1], c0);
        }
    }
    // the border: bands between the rings, their opacity running from one to the next
    for (let r = 0; r < SH_RING.length - 1; r++) {
        const ci = rgba(0, 0, 0, SH_RING[r][1]), co = rgba(0, 0, 0, SH_RING[r + 1][1]);
        for (let i = 0; i < n; i++) {
            const a = P(r, i), b = P(r, (i + 1) % n), c = P(r + 1, (i + 1) % n), d = P(r + 1, i);
            if (SH[a + 2] < 0 || SH[b + 2] < 0 || SH[c + 2] < 0 || SH[d + 2] < 0) continue;
            rec.tri(SH[a], SH[a + 1], ci, SH[b], SH[b + 1], ci, SH[c], SH[c + 1], co);
            rec.tri(SH[a], SH[a + 1], ci, SH[c], SH[c + 1], co, SH[d], SH[d + 1], co);
        }
    }
}

/**
 * The protractor on the ground around the car: a ring fixed to the body with ticks every 10 deg,
 * the direction of travel as an arrow, and the wedge between nose and travel filled with the
 * angle's colour. Drawn under the car, so it reads as projected light.
 */
function protractor(rec, cam, st, betaDeg, speed, R) {
    const hx = Math.cos(st.yaw), hy = Math.sin(st.yaw);
    const travel = st.yaw - betaDeg * Math.PI / 180, tx = Math.cos(travel), ty = Math.sin(travel);
    const ab = Math.abs(betaDeg);
    // ring
    let n = 0;
    for (let i = 0; i <= 72; i++) {
        const a = i / 72 * Math.PI * 2;
        if (!gp(cam, st.x + Math.cos(a) * R, st.y + Math.sin(a) * R)) continue;
        PTS[n * 2] = TMP[0]; PTS[n * 2 + 1] = TMP[1]; n++;
    }
    for (let i = 0; i < n - 1; i++) rec.line(PTS[i * 2], PTS[i * 2 + 1], PTS[i * 2 + 2], PTS[i * 2 + 3], 1.6, TM.tn(0.55, 0.7, 1.0, 0.22));
    // ticks every 10 deg on the front half (from the nose), longer every 30
    for (let d = -90; d <= 90; d += 10) {
        const a = st.yaw + d * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), len = d % 30 === 0 ? 0.42 : 0.2;
        if (!gp(cam, st.x + ca * R, st.y + sa * R)) continue; const x0 = TMP[0], y0 = TMP[1];
        if (!gp(cam, st.x + ca * (R + len), st.y + sa * (R + len))) continue;
        rec.line(x0, y0, TMP[0], TMP[1], d % 30 === 0 ? 2.2 : 1.4, TM.tn(0.7, 0.8, 1.0, d % 30 === 0 ? 0.55 : 0.3));
    }
    // wedge: from the nose to the travel direction, filled with the angle colour
    if (ab > 2) {
        const steps = Math.max(2, Math.ceil(ab / 4));
        const c0 = angleColour(ab, 0.10), c1 = angleColour(ab, 0.42);
        if (gp(cam, st.x, st.y)) {
            const ox = TMP[0], oy = TMP[1];
            let px = 0, py = 0, have = false;
            for (let i = 0; i <= steps; i++) {
                const a = st.yaw - betaDeg * Math.PI / 180 * i / steps;
                if (!gp(cam, st.x + Math.cos(a) * R, st.y + Math.sin(a) * R)) { have = false; continue; }
                if (have) rec.tri(ox, oy, c0, px, py, c1, TMP[0], TMP[1], c1);
                px = TMP[0]; py = TMP[1]; have = true;
            }
            // the arc's edge, bright
            have = false;
            for (let i = 0; i <= steps; i++) {
                const a = st.yaw - betaDeg * Math.PI / 180 * i / steps;
                if (!gp(cam, st.x + Math.cos(a) * (R + 0.05), st.y + Math.sin(a) * (R + 0.05))) { have = false; continue; }
                if (have) rec.line(px, py, TMP[0], TMP[1], 3.2, angleColour(ab, 0.95));
                px = TMP[0]; py = TMP[1]; have = true;
            }
        }
    }
    // nose line and travel arrow
    const arrow = (dx, dy, r0, r1, w, c, head) => {
        if (!gp(cam, st.x + dx * r0, st.y + dy * r0)) return; const ax = TMP[0], ay = TMP[1];
        if (!gp(cam, st.x + dx * r1, st.y + dy * r1)) return; const bx = TMP[0], by = TMP[1];
        rec.line(ax, ay, bx, by, w, c);
        if (head) {
            const px2 = -dy, py2 = dx, hb = r1 - 0.55;
            if (!gp(cam, st.x + dx * hb + px2 * 0.32, st.y + dy * hb + py2 * 0.32)) return; const lx = TMP[0], ly = TMP[1];
            if (!gp(cam, st.x + dx * hb - px2 * 0.32, st.y + dy * hb - py2 * 0.32)) return;
            PTS[0] = bx; PTS[1] = by; PTS[2] = lx; PTS[3] = ly; PTS[4] = TMP[0]; PTS[5] = TMP[1];
            poly.fill(rec, PTS, 3, c, null, 1);
        }
    };
    arrow(hx, hy, R - 0.1, R + 0.9, 2.0, rgba(1, 1, 1, 0.5), false);
    const len = R + 0.6 + Math.min(speed, 30) * 0.08;
    arrow(tx, ty, R + 0.15, len, 4.0, ab > 8 ? angleColour(ab, 0.95) : rgba(0.85, 0.9, 1, 0.75), true);
}

/* ---------- tyre trails: glowing ribbons on the asphalt ---------- */
class Trails {
    constructor() { this.n = 2; this.max = 160; this.p = [[], []]; this.time = 0; }
    reset() { this.p = [[], []]; this.lv = 0; this.hold = 0; }
    /**
     * the rear tyres' marks follow how much the car slides, through an envelope: it rises fast when a
     * slide starts and falls slowly when it ends. So a straight run with grip leaves no mark, a slide
     * fades in, a transition (the angle passing through zero for a moment) does not cut the line, and
     * the end of a drift fades out. The colour follows the angle, held through the transition.
     */
    add(car, st, betaDeg, dt) {
        this.time += dt;
        if (dt <= 0) return;
        const ab = Math.abs(betaDeg), slide = st.speed > 3 ? Math.max(0, Math.min(1, (ab - 4) / 8)) : 0;
        const lv0 = this.lv || 0;
        this.lv = slide > lv0 ? lv0 + (slide - lv0) * Math.min(1, dt / 0.12) : Math.max(0, lv0 - dt / 1.4);
        this.hold = Math.max(ab, (this.hold || 0) - dt * 25);     // the colour's angle: held, then easing down
        const on = this.lv > 0.02 && st.speed > 1;
        const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
        for (let i = 0; i < 2; i++) {
            const w = car.wpos[2 + i];
            const x = st.x + cy * w[0] - sy * w[1], y = st.y + sy * w[0] + cy * w[1];
            const arr = this.p[i];
            const last = arr[arr.length - 1];
            if (on) {
                if (!last || last.brk || Math.hypot(x - last.x, y - last.y) > 0.55) arr.push({ x, y, t: this.time, a: this.hold, lv: this.lv, brk: false });
            } else if (last && !last.brk) { arr.push({ x, y, t: this.time, a: this.hold, lv: 0, brk: true }); }
            while (arr.length > this.max || (arr.length && this.time - arr[0].t > 7)) arr.shift();
        }
    }
    draw(rec, cam) {
        const XY = this._xy || (this._xy = new Float32Array(1024)), HW = this._hw || (this._hw = new Float32Array(512)), CC = this._cc || (this._cc = new Uint32Array(512));
        // one pass: a bright core whose edge ramp is wide, which reads as a glow
        for (const arr of this.p) {
            let n = 0, glow = 0;
            const flush = () => { if (n > 1) poly.ribbon(rec, XY, HW, CC, n, glow / n); n = 0; glow = 0; };
            for (let k = 0; k < arr.length; k++) {
                const q = arr[k];
                // off screen, or a jump: end the ribbon here (a strip between a far-off point and a visible one
                // would cut across the whole screen)
                if (!gp(cam, q.x, q.y) || TMP[2] < 3.5 || TMP[0] < -300 || TMP[0] > cam.cx * 2 + 300 || TMP[1] < -300 || TMP[1] > cam.cy * 2 + 600) { flush(); continue; }
                if (n && Math.hypot(TMP[0] - XY[n * 2 - 2], TMP[1] - XY[n * 2 - 1]) > 160) flush();
                const age = this.time - q.t, life = Math.max(0, 1 - age / 7);
                const px = cam.f / TMP[2];
                XY[n * 2] = TMP[0]; XY[n * 2 + 1] = TMP[1];
                HW[n] = Math.min(9, Math.max(1.2, 0.09 * px));
                glow += Math.min(22, Math.max(3, 0.28 * px));
                // gripping: a colourless, fainter line; sliding: the angle's colour, eased in between 6 and 14 deg
                // the slide's envelope fades the line in and out; the colour is the angle's
                angleRGB(Math.max(q.a, 10), AC); CC[n] = rgba(AC[0], AC[1], AC[2], 0.8 * q.lv * life * life);
                n++;
                if (q.brk || n >= 500) flush();
            }
            flush();
        }
    }
}

/* ---------- tyre smoke ---------- */
class Smoke {
    constructor() { this.max = 260; this.p = []; this.acc = 0; this.seed = 1; }
    rnd() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }
    reset() { this.p = []; }
    update(car, st, betaDeg, slip, dt) {
        // no smoke from a car that has (almost) stopped: at walking pace the angle means nothing and the tyres do not slide
        const ab = Math.abs(betaDeg), k = Math.max(0, Math.min(1, (ab - 8) / 30)) * Math.max(0, Math.min(1, (st.speed - 2.5) / 3)) * (0.4 + 0.6 * Math.min(1, slip));
        if (dt <= 0) return;                                    // paused: nothing is made and nothing moves
        this.acc += k * 70 * dt;
        const cy = Math.cos(st.yaw), sy = Math.sin(st.yaw);
        const vx = st.vxw || 0, vy = st.vyw || 0;
        while (this.acc >= 1) {
            this.acc -= 1;
            const w = car.wpos[2 + (this.rnd() < 0.5 ? 0 : 1)];
            const lx = w[0] - 0.15 + this.rnd() * 0.2, ly = w[1] + (this.rnd() - 0.5) * 0.25;
            if (this.p.length >= this.max) this.p.shift();
            this.p.push({
                x: st.x + cy * lx - sy * ly, y: st.y + sy * lx + cy * ly, z: 0.25,
                vx: vx * 0.22 + (this.rnd() - 0.5) * 1.6, vy: vy * 0.22 + (this.rnd() - 0.5) * 1.6, vz: 0.35 + this.rnd() * 0.5,
                age: 0, life: 2.0 + this.rnd() * 1.6, r0: 0.25 + this.rnd() * 0.2, v: (this.rnd() * 4) | 0, k: 0.55 + 0.45 * k,
            });
        }
        for (const q of this.p) {
            q.age += dt; const drag = Math.exp(-dt * 1.4);
            q.vx *= drag; q.vy *= drag; q.vz *= Math.exp(-dt * 0.8);
            q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        }
        while (this.p.length && this.p[0].age > this.p[0].life) this.p.shift();
    }
    /** draw the particles nearer (front = true) or farther than depth `split` */
    draw(rec, cam, split, front, brake) {
        const buckets = this._b || (this._b = []);
        for (let i = 0; i < 40; i++) buckets[i] = buckets[i] || [];
        for (let i = 0; i < 40; i++) buckets[i].length = 0;
        for (const q of this.p) {
            if (!cam.proj(q.x, q.y, q.z, TMP, 0) || TMP[2] < 3) continue;
            if ((TMP[2] < split) !== front) continue;
            const u = q.age / q.life;
            // puffs drifting up to the camera thin out instead of filling the screen
            const a = Math.min(1, u * 8) * (1 - u) * (1 - u) * 0.42 * q.k * Math.min(1, (TMP[2] - 3) / 3);
            const lvl = Math.min(9, Math.round(a / 0.42 * 9));
            if (lvl <= 0) continue;
            const size = Math.min(720, (q.r0 + u * 2.6) * 2 * cam.f / TMP[2]);
            buckets[q.v * 10 + lvl].push(TMP[0], TMP[1], size);
        }
        for (let v = 0; v < 4; v++) for (let l = 1; l < 10; l++) {
            const b = buckets[v * 10 + l]; if (!b.length) continue;
            const a = l / 9 * 0.42;
            text.sBegin(brake ? rgba(0.95, 0.72, 0.74, a) : rgba(0.80, 0.83, 0.88, a));
            for (let i = 0; i < b.length; i += 3) text.sAdd('puff' + v, b[i], b[i + 1], b[i + 2], b[i + 2]);
            text.sEnd(rec);
        }
    }
}

/** additive-looking glow of the lamps (sprites over the car) */
function lampGlow(rec, glows, brake) {
    if (!glows.length) return;
    text.sBegin(rgba(1.0, 0.12, 0.14, 0.22 + 0.25 * brake));
    for (const g of glows) if (g.mat === 7) text.sAdd('glow', g.x, g.y, Math.max(24, g.w * 1.7), Math.max(16, g.w * 0.9));
    text.sEnd(rec);
    text.sBegin(rgba(0.85, 0.92, 1.0, 0.16));
    for (const g of glows) if (g.mat === 8) text.sAdd('glow', g.x, g.y, Math.max(20, g.w * 1.8), Math.max(16, g.w * 1.2));
    text.sEnd(rec);
}

module.exports = { floor, lightPool, shadow, protractor, Trails, Smoke, lampGlow, angleColour, angleRGB };
