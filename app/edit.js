'use strict';
/**
 * edit.js - the director: turns a drift's replay into a finished edit, the same everywhere it runs
 * (the car's editor preview, the phone that renders the video, the browser preview).
 *
 * plan(clip, edit) reads the drift - where the angle peaks, where it changes sides, where the chain
 * was banked - and lays it out in time: the part of the clip, and a slow-motion stretch through the
 * peak angle (unless slow motion is off). One camera films it all, chosen by the driver: chase
 * (behind, as when driving), top (from above), top wide (from higher up). No cuts, no zooming: the
 * distance is set once for the whole video so the car stays in the frame even at its biggest angle.
 *
 * A Director draws any moment of the edit into a W x H frame (16:9, 9:16 or 1:1), with the
 * overlay: the drift angle as it happens, the chain and its multiplier, the banked rating, the
 * driver's name, and an end card. Its scene is the app's own: floor, light, trails, smoke, car.
 */
const { Cam } = require('../engine/cam');
const T = require('../engine/text');
const W3 = require('../fx/world');
const { F } = require('./replay');
const { pk, fade, hex } = require('../engine/rec');
const TM = require('../ui/theme');
const I18N = require('../ui/i18n');
I18N.install(T);

// the video's own size: QHD (1440 lines). The frame is laid out in proportion, so the car's editor
// preview (1080 lines, scaled into its box) shows the same picture
const FORMATS = { '16:9': [2560, 1440], '9:16': [1440, 2560], '1:1': [1440, 1440] };
const CAMERAS = ['chase', 'top', 'topwide'];
const TIERS = ['NICE', 'GREAT', 'AWESOME', 'INSANE', 'LEGENDARY', 'GODLIKE'];
const TIERC = [hex('#c9ccd2'), hex('#00a1d6'), hex('#ffffff'), hex('#e6242e'), hex('#ffb020'), hex('#ffffff')];
const MB = hex('#00a1d6'), MV = hex('#353189'), MR = hex('#e6242e'), WHITE = 0xffffffff;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** what happens in a clip: active stretch, the peak, the transitions, the banks */
function analyse(clip) {
    const f = clip.f, n = clip.n, d = clip.duration;
    let first = -1, last = -1, peak = 0, tp = 0, maxKmh = 0;
    const trans = [];
    let side = 0, sideT = 0;
    for (let i = 0; i < n; i++) {
        const o = i * F, t = f[o], b = f[o + 10], kmh = f[o + 11], ab = Math.abs(b);
        if (ab > 8 && kmh > 15) { if (first < 0) first = t; last = t; }
        if (ab > peak) { peak = ab; tp = t; }
        if (kmh > maxKmh) maxKmh = kmh;
        const s = b > 10 ? 1 : b < -10 ? -1 : 0;
        if (s && s !== side) { if (side && t - sideT < 1.6) trans.push((t + sideT) / 2); side = s; }
        if (s) sideT = t;
    }
    const banks = (clip.events || []).filter((e) => e.kind === 'bank');
    const tIn = first < 0 ? 0 : Math.max(0, first - 1.2), tOut = last < 0 ? d : Math.min(d, last + 1.4);
    return { tIn, tOut, peak, tp, trans, banks, maxKmh, duration: d };
}

/**
 * the shots of an edit: [{ c0, c1, speed, cam, v0 }] in clip time (c) and video time (v), plus the
 * end card's length. One camera all through (no cuts, no switching sides); slow motion through the
 * peak angle when asked. edit: { camera, slowmo: 'auto' | 'off', format, trim: 'auto' | 'full', overlay }
 */
function plan(clip, edit) {
    const a = analyse(clip), cam = CAMERAS.indexOf(edit.camera) >= 0 ? edit.camera : 'chase';
    const c0 = edit.trim === 'full' ? 0 : a.tIn, c1 = edit.trim === 'full' ? a.duration : Math.max(a.tOut, c0 + 2);
    const cuts = [[c0, 1]];                                     // [clip time, speed]
    if (edit.slowmo !== 'off' && a.peak > 20) {
        const tp = clamp(a.tp, c0 + 1.0, c1 - 1.0);
        cuts.push([tp - 0.9, 0.4], [tp + 0.9, 1]);
    }
    const shots = [];
    let v = 0;
    for (let i = 0; i < cuts.length; i++) {
        const s0 = Math.max(c0, cuts[i][0]), s1 = Math.min(c1, i + 1 < cuts.length ? cuts[i + 1][0] : c1);
        if (s1 - s0 < 0.05) continue;
        shots.push({ c0: s0, c1: s1, cam, speed: cuts[i][1], v0: v });
        v += (s1 - s0) / cuts[i][1];
    }
    // the side the camera stands on: the side the car shows at its biggest angle, kept for the whole video
    const sample = clip.sample(a.tp, {}), side = (sample.beta || 0) >= 0 ? 1 : -1;
    const endCard = 2.2;
    return { camera: cam, side, shots, video: v, endCard, duration: v + endCard, analysis: a, c0, c1 };
}

/** clip time at video time v (slow-motion ramps eased over 0.25 s so the speed change is felt, not jumped) */
function clipTime(p, v) {
    if (v <= 0) return p.c0;
    for (const s of p.shots) { const len = (s.c1 - s.c0) / s.speed; if (v < s.v0 + len) return s.c0 + (v - s.v0) * s.speed; }
    return p.c1;
}
function shotAt(p, v) { let cur = p.shots[0]; for (const s of p.shots) if (v >= s.v0) cur = s; return cur; }

class Director {
    /**
     * o: { clip, car (a CarRenderer), edit, name, units, tierOf(pts) }
     */
    constructor(o) {
        this.o = o; this.clip = o.clip; this.car = o.car; this.cam = new Cam();
        this.trails = new W3.Trails(); this.smoke = new W3.Smoke();
        this.st = {}; this.setEdit(o.edit || {});
    }
    setEdit(edit) {
        this.edit = Object.assign({ camera: 'chase', slowmo: 'auto', format: '16:9', trim: 'auto', overlay: true }, edit);
        this.plan = plan(this.clip, this.edit);
        this.duration = this.plan.duration;
        this.reset();
    }
    reset() { this.trails.reset(); this.smoke.reset(); this.lastV = -1; this.camYaw = null; this.camVel = 0; this.shown = 0; }
    /** draw video time v into a w x h frame at (0, 0); dt: video seconds since the last frame */
    frame(rec, v, dt, w, h) {
        const p = this.plan, end = v >= p.video;
        if (v < this.lastV - 0.001 || v - this.lastV > 1) this.reset();
        this.lastV = v;
        const ct = clipTime(p, Math.min(v, p.video)), shot = shotAt(p, Math.min(v, p.video - 1e-6)), st = this.clip.sample(ct, this.st);
        const cdt = end ? 0 : dt * shot.speed;
        st.dt = cdt;
        const beta = st.beta || 0, car = this.car, cam = this.cam;
        this.trails.add(car, st, beta, cdt);
        const rearSlip = st.wheelSpeed ? Math.max(0, (st.wheelSpeed[2] + st.wheelSpeed[3]) / 2 * car.spec.wheel.r / Math.max(st.speed, 1) - 1) * 4 : 0;
        this.smoke.update(car, st, beta, Math.min(1, rearSlip + Math.abs(beta) / 60), cdt);
        this.aim(st, shot, 0, dt, w, h);

        W3.floor(rec, cam, w, h, st.x, st.y);
        this.trails.draw(rec, cam);
        W3.shadow(rec, cam, car.body.foot, st);
        const TMP = [0, 0, 0]; cam.proj(st.x, st.y, 0.6, TMP, 0); const split = TMP[2];
        this.smoke.draw(rec, cam, split, false, st.brake > 0.2);
        { const g = TM.theme().ghost, tt = car.tint; tt[0] = g[0]; tt[1] = g[1]; tt[2] = g[2]; }   // one steady colour, the theme's
        const roll = clamp(-(st.latG || 0) * 0.035, -0.07, 0.07);
        car.draw(rec, cam, { x: st.x, y: st.y, yaw: st.yaw, roll, pitch: 0, steer: st.steer, wheelSpeed: st.wheelSpeed, brake: st.brake, speed: st.speed, dt: cdt });
        W3.lampGlow(rec, car.glows, st.brake || 0);
        this.smoke.draw(rec, cam, split, true, st.brake > 0.2);
        if (this.edit.overlay !== false && !end) this.overlay(rec, st, ct, v, shot, w, h);
        if (end) this.endCard(rec, v - p.video, w, h);
        return rec;
    }
    /** the camera of a shot; u: 0..1 through the shot */
    /** the camera's heading follows the direction of travel, smoothed (a spring), as in the car */
    follow(st, dt) {
        const travel = st.speed > 1.5 ? Math.atan2(st.vyw, st.vxw) : st.yaw;
        if (this.camYaw === null) this.camYaw = travel;
        const err = wrap(travel - this.camYaw), ddt = Math.min(dt, 0.1);
        this.camVel += (err * 9 - this.camVel * 5.2) * ddt; this.camYaw = wrap(this.camYaw + this.camVel * ddt);
        if (Math.abs(err) > 2.5) this.camYaw = travel;
    }
    /** where the camera stands for a state (before the fixed distance factor) */
    rig(st, w, h) {
        const cy = this.camYaw, portrait = h > w, ref = Math.min(w, h * 16 / 9) / 1280;
        let pitch = 0.55, dist = 9.5, cyk = 0.56;
        if (this.plan.camera === 'top') { pitch = 1.05; dist = 13; cyk = 0.5; }
        else if (this.plan.camera === 'topwide') { pitch = 1.12; dist = 19; cyk = 0.5; }
        if (portrait) { pitch = Math.min(1.25, pitch + 0.06); cyk = 0.5; }
        return { yaw: cy, pitch, dist, hz: 0.5, f: 950 * ref * (portrait ? 1.9 : h === w ? 1.45 : 1.2), cyk };
    }
    /** how far out of a safe area (9 % per side) the car's corners and roof reach: <= 1 is inside */
    reach(st, r, d, w, h) {
        const cam = this.cam, sp = this.car.spec, hl = sp.L / 2 + 0.1, hw = sp.W / 2 + 0.1, cyw = Math.cos(st.yaw), syw = Math.sin(st.yaw), P = [0, 0, 0];
        cam.f = r.f; cam.cx = w / 2; cam.cy = h * r.cyk;
        cam.chase(st.x, st.y, r.hz, r.yaw, r.pitch, d);
        let worst = 0;
        for (const ex of [-hl, hl]) for (const ey of [-hw, hw]) for (const ez of [0, sp.H]) {
            if (!cam.proj(st.x + cyw * ex - syw * ey, st.y + syw * ex + cyw * ey, ez, P, 0)) return 9;
            worst = Math.max(worst, Math.abs(P[0] - cam.cx) / (w * 0.41), (P[1] - cam.cy) / (h * (1 - r.cyk) - h * 0.09), (cam.cy - P[1]) / (cam.cy - h * 0.09));
        }
        return worst;
    }
    /**
     * the one distance for the whole video: the whole edit is run through once, beforehand, and the
     * camera is set as close as it can be while the car stays in the frame at every moment, its
     * biggest angle included. It never zooms during the video.
     */
    fitFor(w, h) {
        const key = w + 'x' + h + '|' + this.plan.camera + '|' + this.plan.video.toFixed(3);
        if (this.fitKey === key) return this.fitFixed;
        const keep = [this.camYaw, this.camVel], st = {};
        this.camYaw = null; this.camVel = 0;
        let fit = 1;                                            // only ever further back than the camera's own distance
        for (let v = 0; v <= this.plan.video; v += 1 / 30) {
            const s2 = this.clip.sample(clipTime(this.plan, v), st);
            this.follow(s2, 1 / 30);
            const r = this.rig(s2, w, h);
            while (fit < 4 && this.reach(s2, r, r.dist * fit, w, h) > 1) fit *= 1.02;
        }
        [this.camYaw, this.camVel] = keep;
        this.fitKey = key; this.fitFixed = fit * 1.04;          // a little room for the frame rate's own small differences
        return this.fitFixed;
    }
    aim(st, shot, u, dt, w, h) {
        const fit = this.fitFor(w, h);
        this.follow(st, dt);
        const r = this.rig(st, w, h), cam = this.cam;
        cam.f = r.f; cam.cx = w / 2; cam.cy = h * r.cyk;
        cam.chase(st.x, st.y, r.hz, r.yaw, r.pitch, r.dist * fit);
    }
    /** the overlay: angle, chain, rating, name, a slow-motion mark */
    overlay(rec, st, ct, v, shot, w, h) {
        const s = Math.min(w, h) / 1080, portrait = h > w, m = 56 * s;
        // vignettes so the type reads
        rec.grad(0, 0, w, 220 * s, [0, 0x000000b0, 1, 0x00000000]);
        rec.grad(0, h - 330 * s, w, 330 * s, [0, 0x00000000, 1, 0x000000d0]);
        // brand: the M stripe and the name
        rec.rect(m, m, 30 * s, 9 * s, MB); rec.rect(m + 34 * s, m, 30 * s, 9 * s, MV); rec.rect(m + 68 * s, m, 30 * s, 9 * s, MR);
        T.text(rec, 'sm', 'SIDEWAYS', m, m + 46 * s, WHITE, 0, 6, s * 1.25);
        if (this.o.name) T.text(rec, 'labs', String(this.o.name).toUpperCase(), m, m + 78 * s, fade(WHITE, 0.75), 0, 4, s * 1.4);
        // the angle, live
        const ab = Math.abs(st.beta || 0);
        this.shown += (ab - this.shown) * 0.35;
        const ang = String(Math.round(this.shown));
        const ax = m, ay = h - m - (portrait ? 150 : 40) * s;
        T.text(rec, 'labs', 'IDRIVE155 DRIFT ANGLE', ax + 4 * s, ay - 186 * s, fade(WHITE, 0.7), 0, 4, s * 1.4);
        const aw = T.text(rec, 'huge', ang, ax, ay, ab > 45 ? hex('#ffe2e8') : WHITE, 0, 2, s * 1.35);
        T.text(rec, 'mid', '°', ax + aw + 6 * s, ay - 84 * s, W3.angleColour(ab, 1), 0, 0, s * 1.4);
        const spd = this.o.units === 'mph' ? st.kmh / 1.609344 : st.kmh;
        T.text(rec, 'labs', 'SPEED', ax + 4 * s, ay + 52 * s, fade(WHITE, 0.6), 0, 4, s * 1.3);
        T.text(rec, 'sm', Math.round(spd) + (this.o.units === 'mph' ? ' MPH' : ' KM/H'), ax + 120 * s, ay + 54 * s, WHITE, 0, 2, s * 1.4);
        // the chain
        if (st.chain > 0) {
            const cx = portrait ? w - m : w - m, cyy = portrait ? h - m - 150 * s - 40 * s : h - m - 40 * s;
            T.text(rec, 'labs', 'DRIFT CHAIN', cx, cyy - 150 * s, fade(WHITE, 0.7), 1, 4, s * 1.4);
            T.text(rec, 'big', fmt(st.chain), cx, cyy - 30 * s, WHITE, 1, 2, s * 1.1);
            const mt = 'X' + (st.mult || 1).toFixed(1), mw = T.width('sm', mt, 1) * s * 1.4 + 28 * s;
            rec.rrect(cx - mw, cyy + 2 * s, mw, 44 * s, 6 * s, MR);
            T.text(rec, 'sm', mt, cx - mw / 2, cyy + 34 * s, WHITE, 0.5, 1, s * 1.4);
        }
        // the rating, when the chain is banked
        for (const e of this.clip.events || []) {
            if (e.kind !== 'bank') continue;
            const age = ct - e.at;
            if (age < 0 || age > 2.6) continue;
            const a = clamp(Math.min(age / 0.15, (2.6 - age) / 0.4), 0, 1), tier = e.tier || 0, col = TIERC[tier] || WHITE;
            const by = portrait ? h * 0.30 : h * 0.24, title = (TIERS[tier] || 'NICE') + ' DRIFT';
            const tw = T.width('mid', title, 4) * s * 1.6 + 120 * s;
            rec.rrect(w / 2 - tw / 2, by - 70 * s, tw, 120 * s, 10 * s, fade(pk(0, 0, 0, 0.72), a));
            rec.rect(w / 2 - tw / 2, by - 70 * s, tw, 5 * s, fade(col, a));
            T.text(rec, 'mid', title, w / 2, by, fade(col, a), 0.5, 4, s * 1.6);
            if (e.pts) T.text(rec, 'sm', '+' + fmt(e.pts), w / 2, by + 38 * s, fade(WHITE, a), 0.5, 2, s * 1.4);
        }
        // slow motion
        if (shot.speed < 1) {
            const k = shot.speed.toFixed(1) + 'X';
            T.text(rec, 'labs', 'SLOW MOTION  ' + k, w - m, m + 30 * s, fade(WHITE, 0.8), 1, 4, s * 1.3);
        }
    }
    /** the end card: the result, the driver, the app */
    endCard(rec, t, w, h) {
        const s = Math.min(w, h) / 1080, a = clamp(t / 0.35, 0, 1), meta = this.clip.meta || {};
        rec.rect(0, 0, w, h, pk(0.02, 0.02, 0.03, 0.82 * a));
        const tier = meta.tier || 0, col = TIERC[tier] || WHITE, cy = h / 2;
        rec.rect(w / 2 - 51 * s, cy - 230 * s, 30 * s, 9 * s, fade(MB, a)); rec.rect(w / 2 - 15 * s, cy - 230 * s, 30 * s, 9 * s, fade(MV, a)); rec.rect(w / 2 + 21 * s, cy - 230 * s, 30 * s, 9 * s, fade(MR, a));
        T.text(rec, 'mid', (TIERS[tier] || 'NICE') + ' DRIFT', w / 2, cy - 150 * s, fade(col, a), 0.5, 4, s * 1.6);
        T.text(rec, 'big', fmt(meta.pts || 0), w / 2, cy - 10 * s, fade(WHITE, a), 0.5, 2, s * 1.25);
        const line = Math.round(meta.maxAngle || this.plan.analysis.peak) + '° MAX   ' + (meta.time ? meta.time.toFixed(1) + ' S' : '') + (meta.mult ? '   X' + meta.mult.toFixed(1) : '');
        T.text(rec, 'sm', line, w / 2, cy + 60 * s, fade(WHITE, 0.8 * a), 0.5, 3, s * 1.4);
        if (this.o.name) T.text(rec, 'sm', String(this.o.name).toUpperCase(), w / 2, cy + 130 * s, fade(WHITE, a), 0.5, 4, s * 1.6);
        T.text(rec, 'labs', 'SIDEWAYS  /  DRIFT ANALYSER', w / 2, cy + 210 * s, fade(WHITE, 0.55 * a), 0.5, 5, s * 1.3);
    }
}
function fmt(n) { const s = String(Math.round(Math.abs(n))); let o = ''; for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) o += ','; o += s[i]; } return (n < 0 ? '-' : '') + o; }

module.exports = { Director, plan, analyse, clipTime, FORMATS, CAMERAS };
