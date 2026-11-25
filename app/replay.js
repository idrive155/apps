'use strict';
/**
 * replay.js - recording and playing back drifts.
 *
 * The recorder keeps the last two minutes at 30 Hz (a ring of fixed-size frames) plus the score
 * events. When a chain is banked its stretch becomes a clip (from 2 s before it started to 1.5 s
 * after the bank); the best clip is kept on disk as a compact base64 string.
 *
 * A clip plays back with interpolation (yaw unwrapped), at any speed, scrubbable, under a
 * cinematic camera that the app chooses (chase, orbit, low side, top, front quarter, auto).
 */
const F = 16;     // floats per frame
// t, x, y, yaw, vxw, vyw, steer, wF, wR, brake, beta, kmh, chain (x mult), mult, yawRate, latG
const HZ = 30, RING = HZ * 120;

class Recorder {
    constructor() { this.buf = new Float32Array(RING * F); this.n = 0; this.head = 0; this.acc = 0; this.events = []; this.t = 0; }
    reset() { this.n = 0; this.head = 0; this.acc = 0; this.events = []; }
    /** called every simulation step */
    push(dt, st, m, score) {
        this.t += dt; this.acc += dt;
        if (this.acc < 1 / HZ) return;
        this.acc -= 1 / HZ; if (this.acc > 1 / HZ) this.acc = 0;
        const o = this.head * F, b = this.buf, w = st.wheelSpeed || [0, 0, 0, 0];
        b[o] = this.t; b[o + 1] = st.x; b[o + 2] = st.y; b[o + 3] = st.yaw; b[o + 4] = st.vxw || 0; b[o + 5] = st.vyw || 0;
        b[o + 6] = st.steer || 0; b[o + 7] = (w[0] + w[1]) / 2; b[o + 8] = (w[2] + w[3]) / 2; b[o + 9] = st.brake || 0;
        b[o + 10] = m.beta; b[o + 11] = m.kmh; b[o + 12] = score.chain * score.mult; b[o + 13] = score.mult; b[o + 14] = m.yawRate; b[o + 15] = m.latG;
        this.head = (this.head + 1) % RING; if (this.n < RING) this.n++;
    }
    event(e) { this.events.push(Object.assign({ at: this.t }, e)); while (this.events.length && this.t - this.events[0].at > 125) this.events.shift(); }
    /** the frames from time t0 to t1 as a clip */
    clip(t0, t1, meta) {
        const out = [];
        for (let k = 0; k < this.n; k++) {
            const i = (this.head - this.n + k + RING) % RING, o = i * F, t = this.buf[o];
            if (t >= t0 && t <= t1) for (let j = 0; j < F; j++) out.push(this.buf[o + j]);
        }
        if (out.length < F * 10) return null;
        const fr = Float32Array.from(out), start = fr[0];
        for (let i = 0; i < fr.length; i += F) fr[i] -= start;
        return new Clip(fr, this.events.filter((e) => e.at >= t0 && e.at <= t1).map((e) => Object.assign({}, e, { at: e.at - start })), meta || {});
    }
    /** the last `sec` seconds, whatever happened */
    last(sec, meta) { return this.clip(this.t - sec, this.t, meta); }
}

class Clip {
    constructor(frames, events, meta) { this.f = frames; this.n = frames.length / F; this.events = events; this.meta = meta; this.duration = frames[(this.n - 1) * F]; }
    /** interpolated state at time t (s from the clip's start) into out */
    sample(t, out) {
        const f = this.f, n = this.n;
        t = Math.max(0, Math.min(this.duration, t));
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (f[mid * F] <= t) lo = mid; else hi = mid; }
        const a = lo * F, b = hi * F, span = f[b] - f[a], u = span > 0 ? (t - f[a]) / span : 0;
        const L = (j) => f[a + j] + (f[b + j] - f[a + j]) * u;
        let dyaw = f[b + 3] - f[a + 3]; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
        out.x = L(1); out.y = L(2); out.yaw = f[a + 3] + dyaw * u; out.vxw = L(4); out.vyw = L(5); out.steer = L(6);
        const wf = L(7), wr = L(8); out.wheelSpeed = out.wheelSpeed || [0, 0, 0, 0];
        out.wheelSpeed[0] = out.wheelSpeed[1] = wf; out.wheelSpeed[2] = out.wheelSpeed[3] = wr;
        out.brake = L(9); out.beta = L(10); out.kmh = L(11); out.chain = L(12); out.mult = f[a + 13]; out.yawRate = L(14); out.latG = L(15);
        out.speed = out.kmh / 3.6;
        const c = Math.cos(out.yaw), s = Math.sin(out.yaw);
        out.vx = c * out.vxw + s * out.vyw; out.vy = -s * out.vxw + c * out.vyw;
        return out;
    }
    /** every second frame (15 Hz): compact sample for the clip */
    half() {
        const n = Math.ceil(this.n / 2), out = new Float32Array(n * F);
        for (let i = 0, j = 0; i < this.n; i += 2, j++) out.set(this.f.subarray(i * F, i * F + F), j * F);
        if ((this.n - 1) % 2) out.set(this.f.subarray((this.n - 1) * F, this.n * F), (n - 1) * F);
        return new Clip(out, this.events, this.meta);
    }
    toString() {
        const u = new Uint8Array(this.f.buffer, this.f.byteOffset, this.f.byteLength);
        let bin = ''; for (let i = 0; i < u.length; i += 8192) bin += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
        const b64 = typeof btoa !== 'undefined' ? btoa(bin) : Buffer.from(u).toString('base64');
        return JSON.stringify({ v: 1, f: b64, e: this.events, m: this.meta });
    }
    static parse(s) {
        try {
            const o = typeof s === 'string' ? JSON.parse(s) : s;
            if (!o || o.v !== 1) return null;
            let u;
            if (typeof atob !== 'undefined') { const bin = atob(o.f); u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); }
            else u = new Uint8Array(Buffer.from(o.f, 'base64'));
            return new Clip(new Float32Array(u.buffer, u.byteOffset, u.byteLength / 4), o.e || [], o.m || {});
        } catch (e) { return null; }
    }
}

/** playback state: time, speed, play/pause, camera */
class Player {
    constructor(clip) { this.clip = clip; this.t = 0; this.speed = 1; this.playing = true; this.cam = 'chase'; this.camT = 0; this.st = {}; }
    step(dt) {
        if (this.playing) this.t += dt * this.speed;
        if (this.t >= this.clip.duration) { this.t = this.clip.duration; this.playing = false; }
        this.camT += dt;
        return this.clip.sample(this.t, this.st);
    }
    seek(frac) { this.t = Math.max(0, Math.min(1, frac)) * this.clip.duration; }
}

module.exports = { Recorder, Clip, Player, F };
