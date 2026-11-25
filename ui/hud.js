'use strict';
/**
 * hud.js - the screen over the 3D view: drift angle dial, chain and skills, the numbers,
 * the angle trace, and the touch menu. All touch targets of a frame are collected in
 * this.targets ({ x, y, w, h, run }) for the app to hit-test.
 */
const { rgba, pk, fade, hex } = require('../engine/rec');
const poly = require('../engine/poly');
const T = require('../engine/text');
const { angleColour } = require('../fx/world');
const TM = require('./theme');
const I18N = require('./i18n');
I18N.install(T);

const WHITE = 0xffffffff;
let DIM = rgba(0.62, 0.68, 0.80, 1), FAINT = rgba(0.45, 0.52, 0.66, 1);
// the M colours, from the M logo: light blue #00A1D6, dark blue #353189, red #E6242E
const MB = hex('#00a1d6'), MV = hex('#353189'), RED = hex('#e6242e');   // the M colours (the stripe, warnings)
let LBLUE = MB, BLUE = MV, VIOLET = MV, TH = TM.theme();
/** the theme's colours into the HUD's names (ui/theme.js) */
function applyTheme(name) {
    TH = TM.setTheme(name);
    DIM = TM.c(TH.dim); FAINT = TM.c(TH.faint); BLUE = TM.c(TH.accent); VIOLET = BLUE; LBLUE = TM.c(TH.accent2);
}
const VG = (a) => TM.c(TH.vig, a / 255);
const TIERS = [hex('#c9ccd2'), hex('#00a1d6'), hex('#ffffff'), hex('#e6242e'), hex('#ffb020'), hex('#ffffff')];
const P = new Float32Array(64), C = new Uint32Array(32);

function fmt(n) { const s = String(Math.round(Math.abs(n))); let o = ''; for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) o += ','; o += s[i]; } return (n < 0 ? '-' : '') + o; }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

/** a panel: a tile with the theme's corner radius, its two tones blended, a fine light top edge (sk: unused, the old slant) */
function slant(rec, x, y, w, h, sk, cTop, cBot) {
    const r = Math.min(TH.radius, h / 2, w / 2);
    const m = ((((cTop >>> 24) + (cBot >>> 24)) >> 1) << 24 | ((((cTop >>> 16) & 255) + ((cBot >>> 16) & 255)) >> 1) << 16 | ((((cTop >>> 8) & 255) + ((cBot >>> 8) & 255)) >> 1) << 8 | (((cTop & 255) + (cBot & 255)) >> 1)) >>> 0;
    rec.rrect(x, y, w, h, r, m);
    const a = (cTop & 255) / 255;
    if (h >= 24 && a > 0.5) rec.line(x + r, y + 0.75, x + w - r, y + 0.75, 1, pk(1, 1, 1, TH.edge * a));
}
/** a panel's outline with rounded corners */
function slantLine(rec, x, y, w, h, sk, c, lw) {
    lw = lw || 1.2;
    const r = Math.min(TH.radius, h / 2, w / 2), r0 = Math.max(0, r - lw / 2), r1 = r + lw / 2;
    rec.line(x + r, y, x + w - r, y, lw, c); rec.line(x + w, y + r, x + w, y + h - r, lw, c);
    rec.line(x + w - r, y + h, x + r, y + h, lw, c); rec.line(x, y + h - r, x, y + r, lw, c);
    if (r > 1) { rec.arc(x + r, y + r, r0, r1, -90, 0, c); rec.arc(x + w - r, y + r, r0, r1, 0, 90, c); rec.arc(x + w - r, y + h - r, r0, r1, 90, 180, c); rec.arc(x + r, y + h - r, r0, r1, 180, 270, c); }
}
const dt0 = (h) => Math.min(0.1, h.lastDt || 1 / 60);
/** a heading: the label on the shared baseline, a hairline under the whole width */
const HY = 58;
function header(rec, x, w, label) {
    T.text(rec, 'lab', label, x, HY, DIM, 0, 3);
    rec.rect(x, HY + 12, w, 1, TM.tn(1, 1, 1, 0.14));
}
/** the M tricolour stripe */
function stripe(rec, x, y, w, h, sk) {
    const k = w / 3;
    rec.rect(x, y, k - 3, h, MB);
    rec.rect(x + k, y, k - 3, h, MV);
    rec.rect(x + 2 * k, y, k - 3, h, RED);
}

applyTheme('id7');

class Hud {
    constructor() {
        this.targets = []; this.t = 0; this.menu = false; this.pressed = null; this.pressT = 0; this.scroll = {}; this.scrollArea = null;
        this.trace = new Float32Array(160); this.traceN = 0; this.traceAcc = 0;   // 20 s at 8 Hz
        this.shownAngle = 0; this.shownChain = 0; this.popups = []; this.seen = 0;
    }
    reset() { this.traceN = 0; this.popups = []; this.seen = 0; this.replaySeen = -1; this.dialAngle = 0; this.peakL = 0; this.peakR = 0; this.peakLs = 0; this.peakRs = 0; this.peakAlpha = 0; }
    /** 'id7' or 'id8' (ui/theme.js) */
    setTheme(name) { if (name !== this.themeName) { applyTheme(name); this.themeName = name; } }
    update(dt, M) {
        this.t += dt; this.lastDt = dt;
        const ab = Math.abs(M.m.beta);
        this.shownAngle += (ab - this.shownAngle) * Math.min(1, dt * 14);
        // the dial's needle: the SIGNED angle on the dial (left of centre = the nose to the left), eased,
        // so a change of side sweeps through zero instead of jumping across
        const dialTarget = -clamp(M.m.beta, -100, 100);
        this.dialAngle = (this.dialAngle || 0) + (dialTarget - (this.dialAngle || 0)) * Math.min(1, dt * 12);
        // two peak marks, one per side: the biggest angle reached to the left and to the right in this drift.
        // Each glides out to a new peak; both stay through the combo and fade out together after it
        const cur = this.dialAngle, drifting = Math.abs(M.m.beta) > 8;
        if ((this.peakAlpha || 0) <= 0.001) { this.peakL = 0; this.peakR = 0; this.peakLs = 0; this.peakRs = 0; }
        if (cur < -5) this.peakL = Math.max(this.peakL || 0, -cur);
        if (cur > 5) this.peakR = Math.max(this.peakR || 0, cur);
        const kp = Math.min(1, dt * 6);
        this.peakLs = (this.peakLs || 0) + ((this.peakL || 0) - (this.peakLs || 0)) * kp;
        this.peakRs = (this.peakRs || 0) + ((this.peakR || 0) - (this.peakRs || 0)) * kp;
        this.peakAlpha = clamp((this.peakAlpha || 0) + (drifting ? dt * 4 : -dt * 0.35), 0, 1);
        const chain = M.score.chain * M.score.mult;
        this.shownChain = chain < this.shownChain ? chain : this.shownChain + (chain - this.shownChain) * Math.min(1, dt * 9);
        this.traceAcc += dt;
        while (this.traceAcc >= 1 / 8) {
            this.traceAcc -= 1 / 8;
            if (this.traceN < this.trace.length) this.trace[this.traceN++] = M.m.beta;
            else { this.trace.copyWithin(0, 1); this.trace[this.trace.length - 1] = M.m.beta; }
        }
        // new score events become popups
        const ev = M.score.events;
        for (const e of ev) if (e.t > this.seen) { this.popups.push({ e, t: this.t }); this.seen = e.t; }
        this.popups = this.popups.filter((p) => this.t - p.t < (p.e.kind === 'bank' || p.e.kind === 'lost' ? 3.2 : 2.4));
    }
    tap(id) { this.pressed = id; this.pressT = this.t; }
    target(x, y, w, h, id, run, drag) { this.targets.push({ x, y, w, h, id, run, drag }); }
    /** the topmost target under (x, y) */
    hit(x, y) { for (let i = this.targets.length - 1; i >= 0; i--) { const t = this.targets[i]; if (x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h) return t; } return null; }

    draw(rec, M, W, H) {
        this.targets.length = 0; this.scrollArea = null;
        this.W = W; this.H = H;
        if (this.screen === 'edit' || this.screen === 'share') { this._screens(rec, M, W, H); return; }
        if (M.replay) { this._replay(rec, M, W, H); this._screens(rec, M, W, H); return; }
        this._drive(rec, M, W, H);
        this._screens(rec, M, W, H);
    }
    _screens(rec, M, W, H) {
        if (this.screen === 'menu') this._menu(rec, M, W, H);
        else if (this.screen === 'history') this._history(rec, M, W, H);
        else if (this.screen === 'edit') this._edit(rec, M, W, H);
        else if (this.screen === 'share') this._share(rec, M, W, H);
        else if (this.screen === 'vitals') this._vitalsPage(rec, M, W, H);
        this._toast(rec, W, H);
        this._popup(rec, W, H);
    }

    /** Full Live Data page: temps, boost, rpm, gear, torque — M Vitals style bars */
    /**
     * One Live Data dial in the same language as the drift-angle meter:
     * outer track with ticks, a filled arc from the low end, a needle, value in the middle.
     */
    _vitalDial(rec, cx, cy, R, label, val, unit, lo, hi, fmtVal) {
        const span = 100;
        const RL = 0.82;
        const p = (val === null) ? null : clamp((val - lo) / Math.max(1e-3, hi - lo), 0, 1);
        const ang = (p === null) ? -span : -span + p * (span * 2);
        const hot = p !== null && p >= RL;
        const cold = p !== null && p < 0.22 && /°C|OIL|COOL|GEARBOX/i.test(label + unit);
        const aHot = -span + RL * (span * 2);

        rec.arc(cx, cy, R - 5, R, -span, aHot, TM.tn(0.6, 0.72, 1.0, 0.16));
        rec.arc(cx, cy, R - 5, R, aHot, span, fade(RED, hot ? 0.85 : 0.45));
        if (hot) rec.arc(cx, cy, R - 11, R + 4, aHot, span, fade(RED, 0.16));
        rec.arc(cx, cy, R - 30, R - 27, -span, span, TM.tn(0.6, 0.72, 1.0, 0.10));

        for (let d = -span; d <= span; d += 20) {
            const a = d * Math.PI / 180, s = Math.sin(a), c = -Math.cos(a);
            const big = d % 50 === 0, red = d >= aHot - 1e-3;
            const r0 = R - (big ? 20 : 13), r1 = R - 6;
            const col = red ? fade(RED, big ? 0.9 : 0.55) : big ? TM.tn(0.85, 0.9, 1, 0.75) : TM.tn(0.6, 0.7, 0.9, 0.4);
            rec.line(cx + s * r0, cy + c * r0, cx + s * r1, cy + c * r1, big ? 2.2 : 1.3, col);
        }

        if (p !== null && p > 0.005) {
            const col = hot ? RED : cold ? LBLUE : MB;
            rec.arc(cx, cy, R - 26, R + 3, -span, ang, fade(col, 0.14));
            rec.arc(cx, cy, R - 22, R - 8, -span, ang, fade(col, 0.95), false);
        }

        { const a = ang * Math.PI / 180;
          rec.line(cx + Math.sin(a) * (R - 38), cy - Math.cos(a) * (R - 38),
                   cx + Math.sin(a) * (R + 6), cy - Math.cos(a) * (R + 6), 3.2, WHITE); }

        if (val === null) {
            T.text(rec, 'mid', '—', cx, cy + 14, DIM, 0.5, 1);
        } else {
            const txt = fmtVal ? fmtVal(val) : String(Math.round(val));
            T.text(rec, 'mid', txt, cx - 2, cy + 16, hot ? hex('#ffe2e8') : WHITE, 0.5, 1);
            if (unit) T.text(rec, 'labs', unit, cx, cy + 40, FAINT, 0.5, 2);
        }
        T.text(rec, 'lab', label, cx, cy + R + 26, FAINT, 0.5, 3);
    }

    _vitalsPage(rec, M, W, H) {
        const m = TH.menu, X = (h, a) => TM.hex(h, a);
        const P = this.panel(rec, W, H, 1600, 540, () => { this.screen = null; });
        stripe(rec, P.x + 40, P.y + 28, 96, 10, 4);
        T.text(rec, 'mid', 'Live Data', P.x + 40, P.y + 72, WHITE, 0, 0);
        T.text(rec, 'labs', 'ARC BANDS  ·  SAME LANGUAGE AS THE DRIFT ANGLE DIAL', P.x + 40, P.y + 98, X(m.text3), 0, 2);
        this.panelButton(rec, P.x + 24, P.y + P.h - 24 - 70, 280, 'Back', 'vitals-close', () => { this.screen = null; }, true);

        const V = M.vitals || {};
        const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
        const dials = [
            ['COOLANT', num(V.coolant), '°C', 40, 120, null],
            ['OIL', num(V.oil), '°C', 50, 135, null],
            ['GEARBOX', num(V.gearbox), '°C', 40, 140, null],
            ['BOOST', num(V.boost), 'BAR', 0, 2.5, (v) => v.toFixed(2)],
            ['RPM', num(V.rpm), 'RPM', 0, 7500, (v) => String(Math.round(v))],
        ];
        const R = 96, cy = P.y + 280, gap = (P.w - 80) / dials.length;
        dials.forEach((d, i) => {
            const cx = P.x + 40 + gap * (i + 0.5);
            this._vitalDial(rec, cx, cy, R, d[0], d[1], d[2], d[3], d[4], d[5]);
        });

        const g = V.gear || '—';
        const gx = P.x + P.w - 220, gy = P.y + 36;
        slant(rec, gx, gy, 160, 64, 10, X(m.selEdge), X(m.selMid));
        T.text(rec, 'labs', 'GEAR', gx + 80, gy + 22, fade(WHITE, 0.7), 0.5, 2);
        T.text(rec, 'mid', String(g), gx + 80, gy + 54, WHITE, 0.5, 1);
    }
    _drive(rec, M, W, H) {
        const ab = Math.abs(M.m.beta), shown = this.shownAngle, units = M.units === 'mph';
        const m = TH.menu, X = (h, a) => TM.hex(h, a);
        // vignette: the HUD reads over the ground
        rec.grad(0, 0, W, 150, [0, VG(0xe0), 1, VG(0)]);
        rec.grad(0, H - 210, W, 210, [0, VG(0), 0.45, VG(0xb0), 1, VG(0xf4)]);
        // footer band behind score + vitals (theme panel tone)
        rec.grad(0, H - 168, W, 168, [0, X(m.panel, 0), 0.35, X(m.panel, 0.55), 1, X(m.bg, 0.78)]);
        rec.rect(0, H - 168, W, 1, X(m.hair, 0.35));

        /* ---------- left: drift angle dial ---------- */
        const cx = 262, cy = 338, R = 168;
        // the three headings share one baseline (HY) and one style: the label, a hairline under it, a tag on the right
        header(rec, 34, 560, 'IDRIVE155 DRIFT ANGLE');
        stripe(rec, 34 + 560 - 72, HY - 11, 72, 10, 5);
        // scale: -100..+100 deg, 12 o'clock = straight
        // the redline: past 60 deg on either side (where a drift turns into a spin), part of the scale itself:
        // the outer track turns red there and so do its ticks; it lights up while the needle is in it
        const RL = 60, inRed = Math.abs(this.dialAngle || 0) >= RL;
        this.redGlow = clamp((this.redGlow || 0) + (inRed ? dt0(this) * 5 : -dt0(this) * 1.5), 0, 1);
        rec.arc(cx, cy, R - 6, R, -RL, RL, TM.tn(0.6, 0.72, 1.0, 0.16));
        for (const sd of [-1, 1]) {
            const a0 = sd < 0 ? -100 : RL, a1 = sd < 0 ? -RL : 100;
            rec.arc(cx, cy, R - 6, R, a0, a1, fade(RED, 0.55 + 0.35 * this.redGlow));
            if (this.redGlow > 0.01) rec.arc(cx, cy, R - 12, R + 6, a0, a1, fade(RED, 0.18 * this.redGlow));
        }
        rec.arc(cx, cy, R - 40, R - 37, -100, 100, TM.tn(0.6, 0.72, 1.0, 0.10));
        for (let d = -90; d <= 90; d += 10) {
            const a = d * Math.PI / 180, s = Math.sin(a), c = -Math.cos(a), big = d % 30 === 0, red = Math.abs(d) >= RL;
            const r0 = R - (big ? 26 : 16), r1 = R - 8;
            const col = red ? fade(RED, big ? 0.9 : 0.6) : big ? TM.tn(0.85, 0.9, 1, 0.75) : TM.tn(0.6, 0.7, 0.9, 0.4);
            rec.line(cx + s * r0, cy + c * r0, cx + s * r1, cy + c * r1, big ? 2.4 : 1.4, col);
            if (big && d !== 0) T.text(rec, 'xs', String(Math.abs(d)), cx + s * (R + 18), cy + c * (R + 18) + 6, red ? fade(RED, 0.85) : FAINT, 0.5);
        }
        // value: from 0 towards the side the nose points (left = negative on the dial)
        const va = clamp(this.dialAngle || 0, -100, 100), av = Math.abs(va);
        if (av > 0.5) {
            const a0 = Math.min(0, va), a1 = Math.max(0, va), col = angleColour(av, 1);
            rec.arc(cx, cy, R - 34, R + 6, a0, a1, fade(col, 0.16));
            rec.arc(cx, cy, R - 30, R - 10, a0, a1, fade(col, 0.95), false);   // square ends: the fill stops exactly at zero and at the needle
        }
        // the needle: always there, straight up at zero too
        { const a = va * Math.PI / 180;
          rec.line(cx + Math.sin(a) * (R - 48), cy - Math.cos(a) * (R - 48), cx + Math.sin(a) * (R + 10), cy - Math.cos(a) * (R + 10), 4, WHITE); }
        // peak marker
        for (const pv of [-(this.peakLs || 0), this.peakRs || 0]) {
            if (Math.abs(pv) <= 2 || this.peakAlpha <= 0.01) continue;
            const pk2 = clamp(pv, -100, 100) * Math.PI / 180;
            rec.line(cx + Math.sin(pk2) * (R + 2), cy - Math.cos(pk2) * (R + 2), cx + Math.sin(pk2) * (R + 16), cy - Math.cos(pk2) * (R + 16), 3, fade(RED, this.peakAlpha));
        }
        // the number
        const big = String(Math.round(shown));
        T.text(rec, 'huge', big, cx - 4, cy + 36, ab > 45 ? hex('#ffe2e8') : WHITE, 0.5, 2);
        T.text(rec, 'mid', '°', cx - 4 + T.width('huge', big, 2) / 2 + 6, cy - 30, DIM, 0);
        T.text(rec, 'labs', ab < 1 ? 'STRAIGHT' : M.m.beta > 0 ? 'LEFT  ‹' : '›  RIGHT', cx, cy + 76, FAINT, 0.5, 4);
        // three numbers under the dial — a touch lower, quiet hairlines
        const statY = 488;
        const stat = (x, label, val, unit) => {
            T.text(rec, 'labs', label, x, statY, FAINT, 0, 3);
            const w = T.text(rec, 'mid', val, x, statY + 42, WHITE, 0);
            T.text(rec, 'labs', unit, x + 6 + w, statY + 42, DIM, 0, 1);
        };
        stat(62, 'COUNTER', String(Math.round(M.m.cs)), '°');
        rec.rect(186, statY - 14, 1, 62, X(m.hair, 0.55));
        stat(204, 'YAW', String(Math.round(Math.abs(M.m.yawRate))), '°/S');
        rec.rect(336, statY - 14, 1, 62, X(m.hair, 0.55));
        stat(354, 'LAT', Math.abs(M.m.latG).toFixed(2), 'G');

        /* ---------- right: speed, axle slip, transition ---------- */
        const rx = W - 454;
        header(rec, rx, 420, 'SPEED');
        if (!this.hideMode) T.text(rec, 'labs', M.mode === 'LIVE' ? 'LIVE - CAR' : 'DEMO DRIVE', rx + 420, HY, M.mode === 'LIVE' ? hex('#59e39a') : hex('#ffb020'), 1, 2);
        const spd = units ? M.m.kmh / 1.609344 : M.m.kmh;
        const sw = T.text(rec, 'big', String(Math.round(spd)), rx + 30, 186, WHITE, 0, 2);
        T.text(rec, 'sm', units ? 'MPH' : 'KM/H', rx + 44 + sw, 186, DIM, 0, 2);
        // speed bar
        const sp = clamp(M.m.kmh / 160, 0, 1);
        slant(rec, rx + 30, 204, 360, 10, 6, TM.tn(1, 1, 1, 0.08), TM.tn(1, 1, 1, 0.08));
        if (sp > 0.01) { P[0] = 0; slant(rec, rx + 30, 204, Math.max(14, 360 * sp), 10, 6, LBLUE, BLUE); }
        // axle slip angles
        const bar = (y, label, v) => {
            T.text(rec, 'labs', label, rx + 30, y, FAINT, 0, 2);
            const cxb = rx + 250, half = 140, a = clamp(Math.abs(v) / 60, 0, 1) * half * (v >= 0 ? -1 : 1);
            rec.rect(cxb - half, y - 9, half * 2, 6, TM.tn(1, 1, 1, 0.07));
            rec.rect(cxb - 1, y - 14, 2, 16, TM.tn(1, 1, 1, 0.35));
            if (Math.abs(a) > 1) rec.rect(Math.min(cxb, cxb + a), y - 10, Math.abs(a), 8, angleColour(Math.abs(v), 0.95));
            T.text(rec, 'sm', Math.round(Math.abs(v)) + '°', rx + 418, y, WHITE, 1);
        };
        T.text(rec, 'lab', 'TYRE SLIP', rx + 26, 262, DIM, 0, 3);
        bar(300, 'FRONT', M.m.af);
        bar(338, 'REAR', M.m.ar);
        T.text(rec, 'lab', 'TRANSITION', rx + 26, 398, DIM, 0, 3);
        const fl = String(Math.round(Math.max(M.m.flick, M.m.flickAt < 6 ? M.m.flickPeak : 0)));
        T.text(rec, 'mid', fl, rx + 30, 448, WHITE, 0);
        T.text(rec, 'labs', '°/S SWING', rx + 30 + T.width('mid', fl) + 10, 448, DIM, 0, 2);
        T.text(rec, 'lab', 'STEADINESS', rx + 236, 398, DIM, 0, 3);
        const st = clamp(M.m.stability, 0, 1);
        for (let i = 0; i < 10; i++) slant(rec, rx + 236 + i * 18, 424, 14, 24, 4, i < st * 10 ? angleColour(15 + i * 4, 0.95) : TM.tn(1, 1, 1, 0.08), i < st * 10 ? angleColour(15 + i * 4, 0.7) : TM.tn(1, 1, 1, 0.05));
        // estimate quality (live) or the session's numbers: the same label / value pairs, no box
        if (M.mode === 'LIVE') {
            T.text(rec, 'lab', 'ACCURACY  ±', rx + 26, 512, DIM, 0, 3);
            if (M.status) T.text(rec, 'mid', '-', rx + 30, 556, DIM, 0);
            else { const v = (M.sigma || 0).toFixed(1) + '°'; T.text(rec, 'mid', v, rx + 30, 556, M.sigma < 2 ? hex('#59e39a') : M.sigma < 4 ? hex('#ffb020') : RED, 0); }
            T.text(rec, 'lab', 'GPS', rx + 236, 512, DIM, 0, 3);
            T.text(rec, 'sm', M.gps ? 'FUSED' : 'NO FIX', rx + 236, 554, M.gps ? hex('#59e39a') : DIM, 0, 1);
        } else {
            T.text(rec, 'lab', 'MAX ANGLE', rx + 26, 512, DIM, 0, 3);
            T.text(rec, 'mid', Math.round(M.score.maxAngle) + '°', rx + 30, 556, WHITE, 0);
            T.text(rec, 'lab', 'LONGEST', rx + 236, 512, DIM, 0, 3);
            T.text(rec, 'mid', Math.max(M.score.longest, M.score.chainTime).toFixed(1) + 'S', rx + 236, 556, WHITE, 0);
        }

        /* ---------- top centre: the chain (or what live mode waits for) ---------- */
        if (M.status) {
            const tw = T.width('sm', M.status, 2) + 80;
            slant(rec, W / 2 - tw / 2, 40, tw, 54, 12, hex('#ffb020'), hex('#c47e00'));
            T.text(rec, 'sm', M.status, W / 2, 76, 0x101010ff, 0.5, 2);
        } else this._chain(rec, M, W);

        /* ---------- between gauges and vitals: BEST left, SCORE a bit right of centre ---------- */
        const footY = H - 128;
        T.text(rec, 'labs', 'BEST CHAIN', 34, footY, FAINT, 0, 3);
        T.text(rec, 'sm', fmt(M.score.best), 34 + T.width('labs', 'BEST CHAIN', 3) + 12, footY, WHITE, 0, 1);
        const sc = fmt(M.score.total), scLab = 'SCORE', scW = T.width('labs', scLab, 3) + 12 + T.width('sm', sc, 1);
        const scX = W / 2 + 56 - scW / 2;
        T.text(rec, 'labs', scLab, scX, footY, FAINT, 0, 3);
        T.text(rec, 'sm', sc, scX + T.width('labs', scLab, 3) + 12, footY, WHITE, 0, 1);

        this._vitalsStrip(rec, M, W, H);
        this._buttons(rec, M, W);
        if (!M.status) this._rank(rec, W);
    }

    /** replay, best drifts, vitals and menu: big touch targets, top right */
    _buttons(rec, M, W) {
        // in the headings' own language: no boxes, a line icon and a label on the bottom row's baseline,
        // a hairline above; the touch area is far bigger than what is drawn
        const A = this.actions || {}, H = this.H, base = H - 34;
        const items = [
            ['menu', 'SETTINGS', () => A.menu && A.menu()],
            ['history', 'BEST DRIFTS', () => A.history && A.history()],
            ['vitals', this.screen === 'vitals' ? 'DRIVE' : 'VITALS', () => { this.screen = this.screen === 'vitals' ? null : 'vitals'; }],
        ];
        let x = W - 34;
        for (const [id, label, run] of items) {
            const down = this.pressed === id && this.t - this.pressT < 0.25, col = down ? WHITE : (id === 'vitals' && this.screen === 'vitals' ? LBLUE : DIM);
            const lw = T.width('lab', label, 3), w = lw + 50;
            T.text(rec, 'lab', label, x, base, col, 1, 3);
            icon(rec, id === 'vitals' ? 'menu' : id, x - lw - 28, base - 7, col);
            rec.rect(x - w, base - 40, w, 1, down || (id === 'vitals' && this.screen === 'vitals') ? fade(LBLUE, 0.9) : TM.tn(1, 1, 1, 0.14));
            this.target(x - w - 16, H - 96, w + 32, 96, id, run);
            x -= w + 48;
        }
    }

    /**
     * Compact Live Data strip under the drive view: coolant · oil · gearbox · boost · rpm · gear.
     * Full M Vitals-style page: screen === 'vitals'.
     */
    _vitalsStrip(rec, M, W, H) {
        const V = M.vitals || {};
        const m = TH.menu, X = (h, a) => TM.hex(h, a);
        const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
        const cells = [
            ['COOLANT', num(V.coolant), '°C', 40, 120],
            ['OIL', num(V.oil), '°C', 50, 130],
            ['GEARBOX', num(V.gearbox), '°C', 40, 140],
            ['BOOST', num(V.boost), 'BAR', 0, 2.5],
            ['RPM', num(V.rpm), '', 0, 7000],
            ['GEAR', V.gear, '', 0, 1],
        ];
        // under SCORE / BEST, above the nav row; leave room for the right-side buttons
        const y = H - 86, h = 46, gap = 8, n = cells.length;
        const rightClear = 520;
        const tw = Math.min(148, Math.floor((W - 68 - rightClear - (n - 1) * gap) / n));
        const x0 = 34;
        cells.forEach((c, i) => {
            const x = x0 + i * (tw + gap), [lab, val, unit, lo, hi] = c;
            slant(rec, x, y, tw, h, TH.radius + 2, X(m.surf2, 0.92), X(m.surf, 0.88));
            rec.rect(x + TH.radius, y + 0.75, tw - TH.radius * 2, 1, X(m.hair, TH.edge + 0.12));
            T.text(rec, 'labs', lab, x + 10, y + 15, X(m.text3), 0, 2);
            if (lab === 'GEAR') {
                T.text(rec, 'sm', val || '—', x + 10, y + 40, val ? WHITE : DIM, 0, 1);
            } else if (val === null) {
                T.text(rec, 'sm', '—', x + 10, y + 40, DIM, 0, 1);
            } else {
                const p = clamp((val - lo) / Math.max(1e-3, hi - lo), 0, 1);
                const hot = p >= 0.82;
                const cold = lab !== 'BOOST' && lab !== 'RPM' && p < 0.25;
                const col = hot ? RED : cold ? LBLUE : WHITE;
                const txt = lab === 'BOOST' ? val.toFixed(2) : lab === 'RPM' ? String(Math.round(val)) : String(Math.round(val));
                const w = T.text(rec, 'sm', txt, x + 10, y + 40, col, 0, 1);
                if (unit) T.text(rec, 'labs', unit, x + 14 + w, y + 40, X(m.text3), 0, 1);
                // mini arc band, same language as the drift dial
                const cx = x + tw - 26, cy = y + 26, r = 16, span = 100;
                const ang = -span + p * (span * 2), aHot = -span + 0.82 * (span * 2);
                rec.arc(cx, cy, r - 3, r, -span, aHot, TM.tn(0.6, 0.72, 1.0, 0.16));
                rec.arc(cx, cy, r - 3, r, aHot, span, fade(RED, hot ? 0.8 : 0.38));
                if (p > 0.01) {
                    const fill = hot ? RED : cold ? LBLUE : MB;
                    rec.arc(cx, cy, r - 9, r - 1, -span, ang, fade(fill, 0.95), false);
                }
                const a = ang * Math.PI / 180;
                rec.line(cx + Math.sin(a) * (r - 11), cy - Math.cos(a) * (r - 11),
                         cx + Math.sin(a) * (r + 1), cy - Math.cos(a) * (r + 1), 2, WHITE);
            }
        });
    }

    _chain(rec, M, W) {
        const S = M.score, cx = W / 2, t = this.t;
        const banner = this.popups.find((p) => (p.e.kind === 'bank' || p.e.kind === 'lost') && t - p.t < 2.6);
        if (S.active && !banner) {
            const chain = this.shownChain;
            header(rec, cx - 300, 600, 'DRIFT CHAIN');
            T.text(rec, 'labs', S.chainTime.toFixed(1) + ' S', cx + 300, HY, DIM, 1, 2);
            const pulse = S.drifting ? 1 + 0.03 * Math.max(0, Math.sin(t * 10)) : 1;
            T.text(rec, 'big', fmt(chain), cx, 152, WHITE, 0.5, 2, pulse);
            // multiplier chip
            const mx = cx + 230;
            slant(rec, mx, 78, 96, 50, 12, RED, RED);
            T.text(rec, 'sm', 'X' + S.mult.toFixed(1), mx + 48, 112, WHITE, 0.5, 1);
            // grace bar: shrinks while not drifting
            const g = S.drifting ? 1 : clamp(1 - S.grace / 1.4, 0, 1);
            rec.rect(cx - 260, 168, 520, 4, TM.tn(1, 1, 1, 0.08));
            rec.rect(cx - 260, 168, 520 * g, 4, S.drifting ? angleColour(Math.abs(M.m.beta), 0.95) : RED);
        }
        // popups
        let row = 0;
        for (const p of this.popups) {
            const e = p.e, age = t - p.t;
            if (e.kind === 'bank' || e.kind === 'lost') {
                const k = ease(age / 0.35), out = clamp((age - 2.6) / 0.6, 0, 1), a = (1 - out);
                const col = e.kind === 'lost' ? RED : TIERS[e.tier || 0];
                if (p !== banner && age < 2.6) continue;
                const y = 112;
                const sc = 0.6 + 0.4 * k;
                slant(rec, cx - 330 * sc, y - 62 * sc, 660 * sc, 136 * sc, 18 * sc, fade(TM.tn(0.04, 0.06, 0.12, 0.92), a), fade(TM.tn(0.02, 0.03, 0.07, 0.92), a));
                rec.rect(cx - 320 * sc, y - 62 * sc, 640 * sc * k, 3, fade(col, a));
                T.text(rec, 'mid', e.text, cx, y - 10 * sc, fade(col, a), 0.5, 4, sc);
                if (e.kind === 'bank') T.text(rec, 'big', '+' + fmt(e.pts), cx, y + 64 * sc, fade(WHITE, a), 0.5, 2, sc * 0.8);
                else T.text(rec, 'sm', fmt(e.pts) + ' LOST', cx, y + 44 * sc, fade(DIM, a), 0.5, 2, sc);
            } else if (S.active && !banner && row < 3) {
                const k = ease(age / 0.25), a = clamp(1 - (age - 1.8) / 0.6, 0, 1);
                const y = 214 + row * 34, x = cx + (1 - k) * 60;
                const col = e.kind === 'mult' ? RED : LBLUE;
                const ptxt = e.pts ? '+' + fmt(e.pts) : '', bw = Math.max(380, T.width('sm', e.text, 1) + T.width('sm', ptxt, 1) + 80);
                slant(rec, x - bw / 2, y - 22, bw, 30, 8, fade(TM.tn(0.05, 0.08, 0.16, 0.85), a), fade(TM.tn(0.03, 0.05, 0.11, 0.85), a));
                rec.rect(x - bw / 2 + 4, y - 22, 4, 30, fade(col, a));
                T.text(rec, 'sm', e.text, x - bw / 2 + 22, y + 1, fade(WHITE, a), 0, 1);
                if (ptxt) T.text(rec, 'sm', ptxt, x + bw / 2 - 14, y + 1, fade(col, a), 1, 1);
                row++;
            }
        }
    }

    /** angle over the last 20 s: a filled band coloured by angle, left = past */
    _trace(rec, x, base, w, h) {
        const n = this.traceN; if (n < 2) return;
        rec.rect(x, base, w, 1, TM.tn(1, 1, 1, 0.15));
        for (const lv of [30, 60]) rec.rect(x, base - h * lv / 90, w, 1, TM.tn(1, 1, 1, 0.05));
        const N = this.trace.length, dx = w / (N - 1), off = N - n;
        let px = 0, py = 0, pc = 0;
        for (let i = 0; i < n; i++) {
            const v = Math.min(Math.abs(this.trace[i]), 90), X = x + (off + i) * dx, Y = base - h * v / 90;
            const c = angleColour(v, 0.9), c0 = angleColour(v, 0.05);
            if (i) {
                rec.tri(px, py, pc, X, Y, c, X, base, c0);
                rec.tri(px, py, pc, X, base, c0, px, base, fade(pc, 0.05));
            }
            px = X; py = Y; pc = c;
        }
        for (let i = 1; i < n; i++) {
            const v0 = Math.min(Math.abs(this.trace[i - 1]), 90), v1 = Math.min(Math.abs(this.trace[i]), 90);
            rec.line(x + (off + i - 1) * dx, base - h * v0 / 90, x + (off + i) * dx, base - h * v1 / 90, 1.6, angleColour(v1, 1));
        }
    }

    /* ---------- the settings, laid out like the car's own menus: categories on the left, rows on the right ---------- */
    _menu(rec, M, W, H) {
        const m = TH.menu, X = (h, a) => TM.hex(h, a);
        const pressed = (id) => this.pressed === id && this.t - this.pressT < 0.25;
        const P = this.panel(rec, W, H, 1500, 624, () => this.actions.close());
        // title (seven quick taps on it: the demo drive's lock)
        T.text(rec, 'mid', 'Settings', P.x + 40, P.y + 58, WHITE, 0, 0);
        rec.rect(P.x + 40, P.y + 72, T.width('mid', 'Settings', 0), 2, X(m.tab));
        this.target(P.x + 20, P.y, T.width('mid', 'Settings', 0) + 60, 84, 'set-title', () => this.actions.titleTap());
        this.panelButton(rec, P.x + 24, P.y + P.h - 24 - 70, 300, 'Done', 'close', () => this.actions.close(), true);

        const groups = [];
        for (const r of M.menuRows || []) { if (r.section) groups.push({ name: r.section, rows: [] }); else if (groups.length) groups[groups.length - 1].rows.push(r); }
        if (!groups.length) return;
        if (!groups.some((g) => g.name === this.menuCat)) this.menuCat = groups[0].name;
        const top = P.y + 100, rh = 80, lx = P.x + 24, lw = 300;
        const sel = (x, y, w, h) => { rec.grad(x, y, w, h, [0, X(m.selEdge), 1, X(m.selMid)]); rec.rect(x, y + h - 3, w, 3, X(m.selLine)); };
        // left: the groups
        groups.forEach((g, k) => {
            const y = top + k * (rh - 8), on = g.name === this.menuCat, id = 'cat' + k, hgt = rh - 10;
            if (on) sel(lx, y, lw, hgt); else rec.rect(lx, y, lw, hgt, pressed(id) ? X(m.surf2) : X(m.surf));
            const name = g.name.charAt(0) + g.name.slice(1).toLowerCase();
            T.text(rec, 'sm', name, lx + 26, y + hgt / 2 + 10, WHITE, 0, 0);
            this.target(lx, y, lw, hgt, id, () => { this.menuCat = g.name; });
        });
        // right: the chosen group's rows
        const g = groups.find((q) => q.name === this.menuCat), px = lx + lw + 20, pw = P.x + P.w - 24 - px;
        rec.rrect(px, top, pw, P.y + P.h - 24 - top, 10, X(m.surf2));
        const cx = px + 360, cw = pw - 360 - 24;
        g.rows.forEach((r, k) => {
            const y = top + k * rh, off = !!r.disabled, A = off ? 0.38 : 1, rid = 'r' + this.menuCat + k;
            if (k < g.rows.length - 1) rec.rect(px + 20, y + rh - 1, pw - 40, 1, X(m.hair, 0.7));
            T.text(rec, 'sm', r.label, px + 28, r.note ? y + 36 : y + 48, fade(WHITE, A), 0, 0);
            if (r.note) T.text(rec, 'xs', r.note, px + 28, y + 62, X(m.text3, off ? 0.8 : 1), 0, 0);
            const by = y + 14, bh = rh - 28;
            const box = (bx, bw, on, id) => {
                if (on && off) { rec.rect(bx, by, bw, bh, X(m.surf, 0.6)); rec.rect(bx, by + bh - 2, bw, 2, X(m.selLine, 0.35)); }
                else if (on) sel(bx, by, bw, bh);
                else rec.rect(bx, by, bw, bh, !off && pressed(id) ? X(m.surf2) : X(m.surf, off ? 0.6 : 1));
            };
            if (r.kind === 'seg') {
                const n = r.options.length, sw = (cw - (n - 1) * 4) / n;
                r.options.forEach((o, q) => {
                    const ox = cx + q * (sw + 4), on = o.id === r.value, id = rid + ':' + q;
                    box(ox, sw, on, id);
                    T.text(rec, 'lab', o.label, ox + sw / 2, by + bh / 2 + 7, fade(on ? WHITE : X(m.text2), A), 0.5, 0);
                    if (!off) this.target(ox, y, sw + 4, rh, id, () => r.set(o.id));
                });
            } else if (r.kind === 'step') {
                const bw = 76;
                [[-1, cx], [1, cx + cw - bw]].forEach(([d, bx]) => {
                    const id = rid + (d < 0 ? ':l' : ':r');
                    box(bx, bw, false, id);
                    const mx = bx + bw / 2, my = by + bh / 2, c = fade(WHITE, A);
                    rec.line(mx - 5 * d, my - 10, mx + 5 * d, my, 2.4, c); rec.line(mx + 5 * d, my, mx - 5 * d, my + 10, 2.4, c);
                    if (!off) this.target(bx, y, bw, rh, id, () => r.set(d));
                });
                T.text(rec, 'sm', String(r.value), cx + cw / 2, by + bh / 2 + 9, fade(WHITE, A), 0.5, 0);
            } else if (r.kind === 'info') {
                T.text(rec, 'sm', String(r.value), cx + cw, by + bh / 2 + 9, X(m.text2), 1, 0);
            } else if (r.kind === 'button') {
                const bw = 200, id = rid;
                T.text(rec, 'sm', String(r.value), cx, by + bh / 2 + 9, X(m.text2), 0, 0);
                const dn2 = pressed(id);
                rec.rect(cx + cw - bw, by, bw, bh, dn2 ? X(m.selMid) : X(m.surf));
                rec.rect(cx + cw - bw, by + bh - 3, bw, 3, r.danger ? RED : X(m.selLine));
                T.text(rec, 'lab', r.action, cx + cw - bw / 2, by + bh / 2 + 7, WHITE, 0.5, 0);
                this.target(cx + cw - bw, y, bw, rh, id, r.run);
            }
        });
    }
}

/* ---------- the editor: the edit plays on the left, its choices on the right, the actions at the bottom ---------- */
Hud.prototype.editBox = function (W, H) { return { x: 24, y: 24, w: 1172, h: H - 24 - 104 }; };
Hud.prototype._edit = function (rec, M, W, H) {
    const A = this.actions, E = M.edit, m = TH.menu, X = (h, a) => TM.hex(h, a);
    if (!E) return;
    const pressed = (id) => this.pressed === id && this.t - this.pressT < 0.25;
    const sel = (x, y, w, h) => { rec.grad(x, y, w, h, [0, X(m.selEdge), 1, X(m.selMid)]); rec.rect(x, y + h - 3, w, 3, X(m.selLine)); };
    // around the preview: the screen's own ground; the preview itself was drawn before this
    const box = this.editBox(W, H), r2 = this.editRect || box;
    rec.rect(0, 0, W, box.y, X(m.bg)); rec.rect(0, box.y + box.h, W, H - box.y - box.h, X(m.bg));
    rec.rect(0, box.y, r2.x, box.h, X(m.bg)); rec.rect(r2.x + r2.w, box.y, W - r2.x - r2.w, box.h, X(m.bg));
    rec.rstroke(8, 6, W - 16, H - 12, 18, 1.5, X(m.hair));            // the editor reads as a panel too
    this.target(0, 0, W, H, 'sheet', () => {});
    // under the preview: play / pause and the timeline
    const py = box.y + box.h + 16, ph = 72;
    const pid = 'ed-play', dn = pressed(pid);
    rec.rect(box.x, py, 96, ph, dn ? X(m.selMid) : X(m.surf));
    { const cx = box.x + 48, cy = py + ph / 2;
      if (E.playing) { rec.rect(cx - 11, cy - 15, 8, 30, WHITE); rec.rect(cx + 3, cy - 15, 8, 30, WHITE); }
      else { P[0] = cx - 10; P[1] = cy - 16; P[2] = cx + 15; P[3] = cy; P[4] = cx - 10; P[5] = cy + 16; poly.fill(rec, P, 3, WHITE, null, 1); } }
    this.target(box.x, py - 8, 96, ph + 16, pid, () => A.editToggle());
    const tx = box.x + 120, tw = box.x + box.w - tx, ty = py + ph / 2, fr = E.d > 0 ? Math.min(1, E.v / E.d) : 0;
    rec.rect(tx, ty - 3, tw, 6, X(m.surf));
    rec.rect(tx, ty - 3, tw * fr, 6, X(m.selLine));
    rec.arc(tx + tw * fr, ty, 0, 12, 0, 360, WHITE);
    T.text(rec, 'labs', E.v.toFixed(1) + ' / ' + E.d.toFixed(1) + ' S', tx + tw, py + 10, X(m.text2), 1, 2);
    this.target(tx - 12, py - 8, tw + 24, ph + 16, 'ed-time', () => {}, (x) => A.editSeek((x - tx) / tw));

    // the right: the choices
    const px = box.x + box.w + 24, pw = W - 24 - px, rh = 80;
    rec.rect(px, box.y, pw, box.h, X(m.surf2));
    T.text(rec, 'mid', 'Edit', px + 24, box.y + 52, WHITE, 0, 0);
    rec.rect(px + 24, box.y + 64, T.width('mid', 'Edit', 0), 2, X(m.tab));
    T.text(rec, 'xs', E.video.toFixed(1) + ' s  /  one camera, fixed', px + pw - 24, box.y + 50, X(m.text3), 1, 0);
    const rows = [
        ['Format', 'format', [['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']]],
        ['Camera', 'camera', [['chase', 'Chase'], ['top', 'Top'], ['topwide', 'Top wide']]],
        ['Slow motion', 'slowmo', [['auto', 'At the peak'], ['off', 'Off']]],
        ['Length', 'trim', [['auto', 'The drift'], ['full', 'Whole clip']]],
        ['Overlay', 'overlay', [[true, 'On'], [false, 'Off']]],
    ];
    rows.forEach(([label, key, opts], k) => {
        const y = box.y + 84 + k * rh;
        rec.rect(px, y + rh - 1, pw, 1, X(m.hair, 0.7));
        T.text(rec, 'sm', label, px + 24, y + 30, WHITE, 0, 0);
        const cx = px + 24, cw = pw - 48, by = y + 40, bh = 38;
        const n = opts.length, sw = (cw - (n - 1) * 4) / n;
        opts.forEach(([val, name], q) => {
            const ox = cx + q * (sw + 4), on = E.edit[key] === val, id = 'ed-' + key + q;
            if (on) sel(ox, by, sw, bh); else rec.rect(ox, by, sw, bh, pressed(id) ? X(m.surf2) : X(m.surf));
            T.text(rec, 'lab', name, ox + sw / 2, by + bh / 2 + 7, on ? WHITE : X(m.text2), 0.5, 0);
            this.target(ox, y + 34, sw + 4, rh - 34, id, () => A.editSet(key, val));
        });
    });
    // the bottom: back, and the one thing this screen is for
    const bw = 200, bid = 'ed-back', eid = 'ed-export';
    rec.rect(px, py, bw, ph, pressed(bid) ? X(m.selMid) : X(m.surf));
    rec.rect(px, py + ph - 3, bw, 3, X(m.hair));
    T.text(rec, 'sm', 'Back', px + bw / 2, py + 45, WHITE, 0.5, 0);
    this.target(px, py - 8, bw, ph + 16, bid, () => A.editClose());
    const ex = px + bw + 12, ew = pw - bw - 12, edn = pressed(eid);
    sel(ex, py, ew, ph); if (edn) rec.rect(ex, py, ew, ph, fade(WHITE, 0.2));
    T.text(rec, 'sm', 'Export video', ex + ew / 2, py + 45, WHITE, 0.5, 0);
    this.target(ex, py - 8, ew, ph + 16, eid, () => A.exportStart());
};

/* the export: a QR code for the phone; the phone makes the video and the link deletes itself */
Hud.prototype._share = function (rec, M, W, H) {
    const A = this.actions, S = M.share || { state: 'sending' }, m = TH.menu, X = (h, a) => TM.hex(h, a);
    // a small popup, the size of the code: the title, the code, a line, the buttons
    const P = this.panel(rec, W, H, 540, 664, null);
    const qs = 400, qx = P.x + (P.w - qs) / 2, qy = P.y + 92;
    const left = S.expires ? Math.max(0, Math.round((S.expires - Date.now()) / 1000)) : 0, mmss = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    const fmtName = M.edit ? M.edit.edit.format : '16:9';
    const say = {
        sending: ['Preparing your video', ['One moment.']],
        local: ['Making the video', ['It is saved by itself', 'when it is ready.']],
        'local-done': ['Saved', ['The video is in your downloads.']],
        'local-failed': ['Could not make it', [String(S.error || '').slice(0, 40)]],
        ready: ['Scan with your phone', null],
        downloaded: ['On your phone', ['The video is saved.', 'The link is deleted.']],
        expired: ['The link expired', ['It was not opened in time.', 'Make a new one.']],
        offline: ['Export unavailable', ['This car cannot export video here.']],
        'no-server': ['Export unavailable', ['Video export needs a local', 'export host (browser preview).']],
        'too-long': ['Too long', ['Choose Length: The drift,', 'then try again.']],
    }[S.state] || ['Something went wrong', [String(S.error || '').slice(0, 40)]];
    T.text(rec, 'mid', say[0], P.x + P.w / 2, P.y + 62, WHITE, 0.5, 0);
    rec.rrect(qx, qy, qs, qs, 14, S.state === 'ready' ? WHITE : X(m.surf));
    if (S.state === 'ready' && S.qr) {
        const q = S.qr, n = q.size + 6, mod = Math.floor(qs / n), off = (qs - mod * q.size) / 2;
        for (let y = 0; y < q.size; y++) {
            let x = 0;
            while (x < q.size) {
                if (!q.dark(x, y)) { x++; continue; }
                let e = x; while (e < q.size && q.dark(e, y)) e++;
                rec.rect(qx + off + x * mod, qy + off + y * mod, (e - x) * mod, mod, 0x000000ff);
                x = e;
            }
        }
        T.text(rec, 'labs', fmtName + ' VIDEO  /  THE LINK DELETES ITSELF IN ' + mmss, P.x + P.w / 2, qy + qs + 36, X(m.text3), 0.5, 1);
    } else {
        const cx = qx + qs / 2, cy = qy + 130;
        if (S.state === 'sending' || S.state === 'local') { const a = (this.t * 300) % 360; rec.arc(cx, cy, 40, 47, a, a + 260, X(m.selLine)); }
        else if (S.state === 'downloaded' || S.state === 'local-done') { rec.line(cx - 48, cy, cx - 12, cy + 36, 9, hex('#59e39a')); rec.line(cx - 12, cy + 36, cx + 56, cy - 36, 9, hex('#59e39a')); }
        else { rec.arc(cx, cy, 40, 47, 0, 360, hex('#ffb020')); rec.line(cx - 29, cy - 29, cx + 29, cy + 29, 7, hex('#ffb020')); }
        (say[1] || []).forEach((l, i) => T.text(rec, 'sm', l, cx, cy + 110 + i * 40, X(m.text2), 0.5, 0));
    }
    // the buttons, side by side at the bottom
    const by = P.y + P.h - 24 - 70, bw = (P.w - 48 - 12) / 2;
    const done = S.state === 'downloaded' || S.state === 'local-done';
    this.panelButton(rec, P.x + 24, by, bw, done ? 'Done' : 'Close', 'sh-done', () => A.shareClose(), done);
    if (S.state === 'offline' || S.state === 'expired' || S.state === 'no-server') {
        this.panelButton(rec, P.x + 36 + bw, by, bw, 'Try again', 'sh-retry', () => A.exportStart(), true);
    } else if (!done) this.panelButton(rec, P.x + 36 + bw, by, bw, 'Edit again', 'sh-edit', () => A.shareEdit());
};

/** line icons: menu, history (list), replay (circular arrow) */
function icon(rec, id, cx, cy, col) {
    const c = col === undefined ? WHITE : col;
    if (id === 'menu') { for (let i = -1; i <= 1; i++) rec.rect(cx - 13, cy - 2 + i * 9, 26, 3, c); return; }
    if (id === 'history') {
        for (let i = -1; i <= 1; i++) {
            rec.rect(cx - 12, cy - 2 + i * 9, 24, 3, c);
            rec.rect(cx - 12, cy - 2 + i * 9, 3, 3, fade(c, 0.55));
        }
        return;
    }
    if (id === 'replay') {
        rec.arc(cx, cy, 9, 12, 40, 330, c, true);
        P[0] = cx + 1; P[1] = cy - 17; P[2] = cx + 10; P[3] = cy - 10; P[4] = cx + 0; P[5] = cy - 5;
        poly.fill(rec, P, 3, c, null, 1);
    }
}

Hud.prototype._replay = function (rec, M, W, H) {
    const R = M.replay, st = R.st, A = this.actions, t = this.t;
    this.target(0, 0, W, H, 'rp-scene', () => {});                 // the scene itself: the freestyle camera's (core.js)
    rec.grad(0, 0, W, 130, [0, VG(0xd8), 1, VG(0)]);
    rec.grad(0, H - 190, W, 190, [0, VG(0), 1, VG(0xf2)]);
    // title: what is being replayed
    slant(rec, 34, 34, 320, 44, 12, RED, RED);
    T.text(rec, 'sm', 'REPLAY', 64, 64, WHITE, 0, 4);
    const blink = Math.sin(t * 6) > 0 ? 1 : 0.35;
    rec.arc(330, 56, 0, 7, 0, 360, fade(WHITE, blink));
    const meta = R.meta || {};
    if (meta.text) T.text(rec, 'lab', String(meta.text).toUpperCase() + (meta.pts ? '  +' + fmt(meta.pts) : ''), 380, 64, DIM, 0, 3);
    if (meta.name) T.text(rec, 'labs', 'DRIVER  ' + meta.name, 380, 86, FAINT, 0, 3);
    // the numbers of that moment
    const ab = Math.abs(st.beta || 0);
    T.text(rec, 'labs', 'IDRIVE155 DRIFT ANGLE', 60, H - 214, FAINT, 0, 3);
    T.text(rec, 'big', String(Math.round(ab)) + '°', 56, H - 128, ab > 45 ? hex('#ffe2e8') : WHITE, 0, 2);
    T.text(rec, 'labs', 'SPEED', W - 60, H - 214, FAINT, 1, 3);
    T.text(rec, 'big', String(Math.round(M.units === 'mph' ? st.kmh / 1.609344 : st.kmh)), W - 60, H - 128, WHITE, 1, 2);
    if (st.chain > 0) {
        T.text(rec, 'big', fmt(st.chain), W / 2, 150, WHITE, 0.5, 2);
        slant(rec, W / 2 + 250, 78, 96, 50, 12, RED, RED);
        T.text(rec, 'sm', 'X' + (st.mult || 1).toFixed(1), W / 2 + 298, 112, WHITE, 0.5, 1);
    }
    // the clip's score events, at their moment
    let row = 0;
    for (const e of R.events || []) {
        const age = R.t - e.at;
        if (age < 0 || age > 2.2 || row > 2) continue;
        const a = clamp(1 - (age - 1.6) / 0.6, 0, 1), col = e.kind === 'bank' ? TIERS[e.tier || 0] : e.kind === 'lost' ? RED : e.kind === 'mult' ? RED : LBLUE;
        const y = 214 + row * 36, ptxt = e.pts > 0 ? '+' + fmt(e.pts) : '';
        const bw = Math.max(400, T.width('sm', e.text, 1) + T.width('sm', ptxt, 1) + 90), bx = W / 2 - bw / 2;
        slant(rec, bx, y - 24, bw, 32, 8, fade(TM.tn(0.05, 0.08, 0.16, 0.85), a), fade(TM.tn(0.03, 0.05, 0.11, 0.85), a));
        rec.rect(bx + 4, y - 24, 4, 32, fade(col, a));
        T.text(rec, 'sm', e.text, bx + 22, y, fade(WHITE, a), 0, 1);
        if (ptxt) T.text(rec, 'sm', ptxt, bx + bw - 14, y, fade(col, a), 1, 1);
        row++;
    }
    // controls: play / pause, speed, camera, timeline, exit
    const by = H - 92, bh = 60;
    const btn = (x, w, id, label, run, on) => {
        const down = this.pressed === id && this.t - this.pressT < 0.25;
        slant(rec, x, by, w, bh, 12, down || on ? BLUE : TM.tn(0.10, 0.16, 0.30, 0.92), down || on ? BLUE : TM.tn(0.06, 0.10, 0.20, 0.92));
        if (label === 'PLAY' || label === 'PAUSE') {
            const cx = x + w / 2, cy = by + bh / 2;
            if (label === 'PAUSE') { rec.rect(cx - 10, cy - 13, 7, 26, WHITE); rec.rect(cx + 3, cy - 13, 7, 26, WHITE); }
            else { P[0] = cx - 9; P[1] = cy - 14; P[2] = cx + 13; P[3] = cy; P[4] = cx - 9; P[5] = cy + 14; poly.fill(rec, P, 3, WHITE, null, 1); }
        } else T.text(rec, 'sm', label, x + w / 2, by + 39, WHITE, 0.5, 1);
        this.target(x - 6, by - 12, w + 12, bh + 24, id, run);
    };
    const x0 = W / 2 - 520;
    btn(x0, 96, 'rp-play', R.playing ? 'PAUSE' : 'PLAY', () => A.replayToggle());
    btn(x0 + 110, 120, 'rp-speed', R.speed === 1 ? '1X' : R.speed === 0.5 ? '0.5X' : '0.25X', () => A.replaySpeed(), R.speed !== 1);
    btn(x0 + 244, 170, 'rp-cam', R.cam === 'topwide' ? 'TOP WIDE' : String(R.cam).toUpperCase(), () => A.replayCam(), R.cam === 'free');
    // freestyle: zoom buttons at the right edge (a pinch does the same where the screen sends two fingers)
    if (R.cam === 'free') {
        const zx = W - 104, zb = (yy, id, plus, k) => {
            const dn = this.pressed === id && this.t - this.pressT < 0.25;
            slant(rec, zx, yy, 70, 64, 10, dn ? BLUE : TM.tn(0.10, 0.16, 0.30, 0.92), dn ? BLUE : TM.tn(0.06, 0.10, 0.20, 0.92));
            rec.rect(zx + 22, yy + 30, 26, 4, WHITE); if (plus) rec.rect(zx + 33, yy + 19, 4, 26, WHITE);
            this.target(zx - 8, yy - 6, 86, 76, id, () => A.replayZoom(k));
        };
        zb(H / 2 - 90, 'rp-zin', true, 0.8); zb(H / 2 - 10, 'rp-zout', false, 1.25);
    }
    T.text(rec, 'labs', R.cam === 'free' ? 'DRAG TO ORBIT  /  + - TO ZOOM' : 'DRAG THE CAR TO LOOK AROUND', x0, by - 14, FAINT, 0, 3);
    btn(W / 2 + 400, 120, 'rp-exit', 'EXIT', () => A.replayExit());
    // your own drift: edit it into a video (someone else's can only be watched)
    const own = !!(R.meta && R.meta.own);
    if (own) btn(W / 2 + 214, 172, 'rp-edit', 'EDIT VIDEO', () => A.editOpen(), true);
    // timeline: drag to scrub
    const tx = x0 + 434, tw = (own ? W / 2 + 196 : W / 2 + 380) - tx, ty = by + bh / 2;
    rec.rect(tx, ty - 3, tw, 6, TM.tn(1, 1, 1, 0.12));
    const fr = R.d > 0 ? R.t / R.d : 0;
    rec.rect(tx, ty - 3, tw * fr, 6, LBLUE);
    for (const e of R.events || []) if (e.kind === 'bank' || e.kind === 'skill') rec.rect(tx + tw * (e.at / R.d) - 1, ty - 11, 2, 22, e.kind === 'bank' ? RED : fade(WHITE, 0.4));
    rec.arc(tx + tw * fr, ty, 0, 12, 0, 360, WHITE);
    T.text(rec, 'labs', R.t.toFixed(1) + ' / ' + R.d.toFixed(1) + ' S', tx + tw, by - 6, DIM, 1, 2);
    const seek = (x) => A.replaySeek((x - tx) / tw);
    this.target(tx - 10, by - 10, tw + 20, bh + 20, 'rp-time', () => {}, seek);
};

/* local best drifts saved on this car; a tap plays that drift */
function ago(ts) {
    const s2 = Math.max(0, (Date.now() - ts) / 1000);
    return s2 < 90 ? 'JUST NOW' : s2 < 3600 ? Math.round(s2 / 60) + ' MIN AGO' : s2 < 86400 ? Math.round(s2 / 3600) + ' H AGO' : Math.round(s2 / 86400) + ' DAYS AGO';
}
function playIcon(rec, x, y, c) { P[0] = x - 7; P[1] = y - 9; P[2] = x + 9; P[3] = y; P[4] = x - 7; P[5] = y + 9; poly.fill(rec, P, 3, c, null, 1); }
Hud.prototype._history = function (rec, M, W, H) {
    const A = this.actions;
    rec.rect(0, 0, W, H, TM.tn(0.01, 0.015, 0.03, 0.88));
    this.target(0, 0, W, H, 'scrim', () => A.close());
    const px = W / 2 - 660, py = 34, pw = 1320, ph = 652;
    slant(rec, px, py, pw, ph, 24, TM.tn(0.06, 0.09, 0.18, 0.97), TM.tn(0.03, 0.05, 0.10, 0.97));
    slantLine(rec, px, py, pw, ph, 24, TM.tn(0.4, 0.6, 1.0, 0.25), 1.2);
    this.target(px, py, pw, ph, 'sheet', () => {});
    stripe(rec, px + 60, py + 24, 96, 12, 4);
    T.text(rec, 'mid', 'BEST DRIFTS', px + 60, py + 84, WHITE, 0, 6);
    T.text(rec, 'labs', 'SAVED ON THIS CAR  ·  LIVE DRIVES ONLY', px + 64, py + 112, DIM, 0, 2);
    const cx = px + 40, cy = py + ph - 76;
    slant(rec, cx, cy, 150, 56, 12, RED, RED);
    T.text(rec, 'sm', 'CLOSE', cx + 75, cy + 37, WHITE, 0.5, 2);
    this.target(cx - 10, cy - 10, 170, 76, 'close', () => A.close());

    const lx = px + 64, lw = pw - 128, top = py + 138, rh = 46;
    const listH = ph - 138 - 96, VIS = Math.floor(listH / rh);
    const key = 'history', scroll = (n) => {
        const max = Math.max(0, n * rh - VIS * rh);
        this.scroll[key] = clamp(this.scroll[key] || 0, 0, max);
        this.scrollArea = { x: lx - 12, y: top, w: lw + 24, h: VIS * rh, key, max };
        return this.scroll[key];
    };
    const hs = M.history || [];
    if (!hs.length) {
        this.scrollArea = null;
        T.text(rec, 'sm', 'NO DRIFTS SAVED YET: BANK A CHAIN ON LIVE CAR DATA AND IT APPEARS HERE', lx, top + 40, FAINT, 0, 1);
        return;
    }
    const off = scroll(hs.length), first = Math.floor(off / rh);
    rec.clip(lx - 14, top, lw + 28, VIS * rh);
    for (let i = first; i < Math.min(hs.length, first + VIS + 1); i++) {
        const h = hs[i], y = top + i * rh - off, id = 'h' + h.id;
        if (i % 2 === 0) rec.rect(lx - 12, y, lw + 24, rh - 6, TM.tn(1, 1, 1, 0.025));
        const yy = y + 29;
        T.text(rec, 'sm', String(h.text || '').replace(' DRIFT', ''), lx + 10, yy, TIERS[h.tier || 0], 0, 1);
        T.text(rec, 'labs', ago(h.ts), lx + 250, yy - 1, FAINT, 0, 2);
        T.text(rec, 'labs', Math.round(h.maxAngle || 0) + '° MAX  /  ' + (h.time || 0).toFixed(1) + ' S', lx + 410, yy - 1, DIM, 0, 2);
        if (h.body) T.text(rec, 'labs', String(h.body).toUpperCase(), lx + 700, yy - 1, FAINT, 0, 2);
        T.text(rec, 'sm', fmt(h.pts), lx + lw - 160, yy, WHITE, 1, 1);
        const right = lx + lw - 70 - 60;
        const down = this.pressed === id && this.t - this.pressT < 0.25;
        slant(rec, right, y + 3, 76, rh - 12, 8, down ? BLUE : TM.tn(0.12, 0.2, 0.38, 0.95), down ? BLUE : TM.tn(0.08, 0.13, 0.26, 0.95));
        playIcon(rec, right + 40, y + (rh - 6) / 2, WHITE);
        if (y + rh > top && y < top + VIS * rh) this.target(lx - 12, Math.max(y, top), lw + 24, Math.min(rh - 6, top + VIS * rh - y), id, () => A.playRun(h.id));
        const xid = 'x' + h.id, xd = this.pressed === xid && this.t - this.pressT < 0.25, bx = lx + lw - 46, bcy = y + (rh - 6) / 2;
        slant(rec, bx, y + 3, 56, rh - 12, 8, xd ? RED : TM.tn(0.20, 0.07, 0.09, 0.9), xd ? RED : TM.tn(0.14, 0.05, 0.07, 0.9));
        rec.line(bx + 20, bcy - 8, bx + 36, bcy + 8, 2.6, WHITE); rec.line(bx + 36, bcy - 8, bx + 20, bcy + 8, 2.6, WHITE);
        if (y + rh > top && y < top + VIS * rh) this.target(bx - 6, Math.max(y, top), 68, Math.min(rh - 6, top + VIS * rh - y), xid, () => A.historyDelete(h.id));
    }
    rec.noclip();
    if (hs.length > VIS) {
        const bh = VIS * rh * VIS / hs.length, by = top + (VIS * rh - bh) * off / Math.max(1, hs.length * rh - VIS * rh);
        rec.rect(lx + lw + 18, top, 3, VIS * rh, TM.tn(1, 1, 1, 0.08)); rec.rect(lx + lw + 18, by, 3, bh, TM.tn(0.4, 0.6, 1.0, 0.6));
    }
};

/**
 * a popup's panel over what is behind it (the drive, a replay): the rest of the screen dimmed, a
 * rounded panel in the middle. outside: what a tap beside the panel does (null: nothing).
 */
Hud.prototype.panel = function (rec, W, H, w, h, outside) {
    const m = TH.menu, X = (c, a) => TM.hex(c, a);
    const x = Math.round((W - w) / 2), y = Math.round((H - h) / 2);
    rec.rect(0, 0, W, H, TM.tn(0, 0, 0, 0.62));
    this.target(0, 0, W, H, 'scrim', outside || (() => {}));
    rec.rrect(x - 1, y - 1, w + 2, h + 2, 19, X(m.hair, 0.9));
    rec.rrect(x, y, w, h, 18, X(m.bg));
    this.target(x, y, w, h, 'sheet', () => {});
    return { x, y, w, h };
};
/* the closing button of a popup: bottom left, where the hand rests */
Hud.prototype.panelButton = function (rec, x, y, w, label, id, run, primary) {
    const m = TH.menu, X = (c, a) => TM.hex(c, a), dn = this.pressed === id && this.t - this.pressT < 0.25, h = 70;
    if (primary) { rec.grad(x, y, w, h, [0, X(m.selEdge), 1, X(m.selMid)]); rec.rect(x, y + h - 3, w, 3, X(m.selLine)); if (dn) rec.rect(x, y, w, h, fade(WHITE, 0.15)); }
    else { rec.rect(x, y, w, h, dn ? X(m.selMid) : X(m.surf)); rec.rect(x, y + h - 3, w, 3, X(m.hair)); }
    T.text(rec, 'sm', label, x + w / 2, y + 45, WHITE, 0.5, 0);
    this.target(x, y - 6, w, h + 12, id, run);
};

/* a short message over everything */
/* the rank card: under the chain, after a bank (what it means against everyone) */
Hud.prototype.rank = function (lines) { this.rankLines = lines && lines.length ? lines : null; this.rankAt = this.t; };
Hud.prototype._rank = function (rec, W) {
    if (!this.rankLines) return;
    const age = this.t - this.rankAt - 0.6;                  // after the banner has landed
    if (age < 0 || age > 5) return;
    const a = clamp(Math.min(age / 0.25, (5 - age) / 0.5), 0, 1), y0 = 196;
    this.rankLines.forEach((l, i) => {
        const col = l.tone === 'gold' ? hex('#ffb020') : l.tone === 'blue' ? LBLUE : DIM, w = T.width('sm', l.text, 2) + 60, y = y0 + i * 44;
        slant(rec, W / 2 - w / 2, y, w, 38, 8, fade(TM.tn(0.05, 0.08, 0.16, 0.9), a), fade(TM.tn(0.03, 0.05, 0.11, 0.9), a));
        rec.rect(W / 2 - w / 2, y, 4, 38, fade(col, a));
        T.text(rec, 'sm', l.text, W / 2, y + 27, fade(col, a), 0.5, 2);
    });
};
/*
 * a popup: what went wrong (or what is happening), in words, over everything, with its buttons -
 * { title, text, tone: 'error' | 'info' | 'busy', buttons: [{ label, run, primary }] }. While it is
 * open nothing under it takes a tap. A 'busy' popup has a spinner and may have no buttons.
 */
Hud.prototype.popupShow = function (p) { this.popup = p || null; this.popupAt = this.t; };
Hud.prototype._popup = function (rec, W, H) {
    const p = this.popup;
    if (!p) return;
    const m = TH.menu, X = (h, a) => TM.hex(h, a), tone = p.tone === 'error' ? hex('#ffb020') : p.tone === 'busy' ? X(m.selLine) : LBLUE;
    rec.rect(0, 0, W, H, TM.tn(0, 0, 0, 0.62));
    this.target(0, 0, W, H, 'popup-sheet', () => {});
    const w = 860, h = 330, x = (W - w) / 2, y = (H - h) / 2 - 10;
    rec.rect(x, y, w, h, X(m.panel));
    rec.rect(x, y, 6, h, tone);
    T.text(rec, 'mid', String(p.title || ''), x + 48, y + 72, WHITE, 0, 2);
    // the text, wrapped to the box
    const words = String(p.text || '').split(' '), lines = [];
    let cur = '';
    for (const wd of words) { const t = cur ? cur + ' ' + wd : wd; if (T.width('sm', t, 1) > w - 96 && cur) { lines.push(cur); cur = wd; } else cur = t; }
    if (cur) lines.push(cur);
    lines.slice(0, 4).forEach((l, i) => T.text(rec, 'sm', l, x + 48, y + 124 + i * 36, X(m.text2), 0, 1));
    if (p.tone === 'busy') { const a = (this.t * 300) % 360; rec.arc(x + w - 70, y + 62, 18, 23, a, a + 260, tone); }
    // the buttons: along the bottom, the main one on the right
    const bs = p.buttons || [], bw = 230, bh = 66, by = y + h - bh - 26;
    bs.forEach((b, i) => {
        const bx = x + w - 48 - (bs.length - i) * (bw + 14) + 14, id = 'pp' + i, dn = this.pressed === id && this.t - this.pressT < 0.25;
        if (b.primary) { rec.grad(bx, by, bw, bh, [0, X(m.selEdge), 1, X(m.selMid)]); rec.rect(bx, by + bh - 3, bw, 3, X(m.selLine)); }
        else { rec.rect(bx, by, bw, bh, dn ? X(m.surf2) : X(m.surf)); rec.rect(bx, by + bh - 3, bw, 3, X(m.hair)); }
        T.text(rec, 'sm', String(b.label), bx + bw / 2, by + 42, WHITE, 0.5, 1);
        this.target(bx, by - 8, bw, bh + 16, id, () => { this.popup = null; if (b.run) b.run(); });
    });
};
Hud.prototype.toast = function (text, sec) { this.toastText = text; this.toastUntil = text ? this.t + (sec || 3) : 0; };
Hud.prototype._toast = function (rec, W, H) {
    if (!this.toastText || this.t > this.toastUntil) return;
    const w = T.width('sm', this.toastText, 2) + 80, x = W / 2 - w / 2, y = H / 2 - 30;
    slant(rec, x, y, w, 60, 14, TM.tn(0.05, 0.08, 0.16, 0.96), TM.tn(0.03, 0.05, 0.11, 0.96));
    slantLine(rec, x, y, w, 60, 14, hex('#ffb020'), 1.4);
    T.text(rec, 'sm', this.toastText, W / 2, y + 39, WHITE, 0.5, 2);
};

module.exports = { Hud, fmt, slant };
