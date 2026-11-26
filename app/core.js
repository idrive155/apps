'use strict';
/**
 * core.js - Sideways: the whole app without its host. The head unit (platform/main.js) and the
 * browser preview (web/) both run this; they differ only in where frames go, where touches, car
 * signals and the network come from, and how things are stored.
 *
 *   const app = createApp({ load, save, log, http, });
 *   app.input(sample)          live car signals (platform/live.js), any rate
 *   app.gps(fix)               a GNSS fix, when there is one
 *   app.vitals(snap)           Live Data engine numbers (platform/vitals.js)
 *   app.vehicle(type)          the car's own type: { body, rhd, drive }
 *   app.frame(rec, dt, W, H)   one frame into a Rec, logical W x H
 *   app.touch(phase, x, y)     1 down, 2 move, 3 up (logical px)
 */
const { CarRenderer } = require('../car/render');
const { PRESETS, BODIES } = require('../car/presets');
const VERSION = '0.7.1';
const { Cam } = require('../engine/cam');
// the demo drive is a development tool: a public build has none (sim/demo.js exports DemoDriver: null)
const { DemoDriver } = require('../sim/demo');
const { Metrics } = require('../sim/metrics');
const { Score, ratingOf, tierOf } = require('../sim/score');
const { DriftEstimator } = require('../sim/estimator');
const W3 = require('../fx/world');
const { Hud } = require('../ui/hud');
const I18N = require('../ui/i18n');
const { pk, hex } = require('../engine/rec');
function randomHex(n) {
    let out = '';
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const b = new Uint8Array(n); crypto.getRandomValues(b);
        for (let i = 0; i < b.length; i++) out += (b[i] < 16 ? '0' : '') + b[i].toString(16);
        return out;
    }
    try { return require('crypto').randomBytes(n).toString('hex'); } catch (e) { /* fall through */ }
    for (let i = 0; i < n; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    return out;
}
const { Recorder, Clip, Player } = require('./replay');
const { Director } = require('./edit');
const TM = require('../ui/theme');

const DEFAULTS = {
    mode: 'live', preset: 'coupe', autoBody: true, demoUnlocked: false,
    drive: 'rwd', rhd: false, gps: 'auto', units: 'kmh', steerRatio: 15.0, quality: 'auto',
    theme: null,          // 'id7' | 'id8'; null until the first start, then the car's own generation (host.idrive)
    lang: 'auto',         // 'auto' | 'hu' | 'en' — auto follows the head unit
};
// replay cameras: chase, top, and top from higher up; each holds its angle and distance (no cuts, no zoom)
const CAMS = ['chase', 'top', 'topwide'];
const TINT = [0, 0, 0];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const cycle = (list, v) => list[(list.indexOf(v) + 1) % list.length];

function createApp(host) {
    host = host || {};
    const log = host.log || { info() {}, warn() {} };
    const saved = (host.load && host.load('settings')) || {};
    const S = Object.assign({}, DEFAULTS, saved);
    if (host.demo && !saved.mode && DemoDriver) S.mode = 'demo';                      // a host without a car (the preview) starts on the demo drive
    if (!PRESETS[S.preset]) S.preset = DEFAULTS.preset;
    const records = Object.assign({ best: 0, total: 0, maxAngle: 0, longest: 0, chains: 0 }, (host.load && host.load('records')) || {});
    const save = () => host.save && host.save('settings', S);
    // the look follows the car's iDrive on the very first start; after that it is the driver's choice
    if (S.theme !== 'id7' && S.theme !== 'id8') { S.theme = host.idrive === 'id8' ? 'id8' : 'id7'; save(); }
    function applyLang() {
        const want = S.lang === 'hu' || S.lang === 'en' ? S.lang : I18N.detect(host);
        I18N.setLang(want);
    }
    applyLang();
    const saveRecords = () => host.save && host.save('records', records);
    const t = I18N.t;

    /* ---------- the car, the sim, the session ---------- */
    let spec, car, demo, metrics, est, score, hud, trails, smoke, cam, rec2, lod = S.quality === 'low' ? 1 : 0;
    let lastSampleT = null, wasReady = false, pose, camYaw = 0, camVel = 0, live = null, liveFresh = 0, gpsFix = null, gpsSeen = -1e9, clock = 0;
    let vitalsSnap = { rpm: null, coolant: null, oil: null, gearbox: null, boost: null, gear: null, torque: null, powerPct: null, ambient: null };
    let chainStartT = null, chainKmh = 0, pendingClip = null, lastClip = null, bestClip = null, player2 = null;
    let editor = null, share = null;
    try { const b = host.load && host.load('bestReplay'); if (b) bestClip = Clip.parse(b); } catch (e) { bestClip = null; }
    // past drifts: an index here, each clip in its own file ('clip-<id>')
    let titleTaps = [];
    /** a problem, told in a popup: what happened and what to do; TRY AGAIN when it may pass */
    function problem(title, text, retry) {
        hud.popupShow({ title: t(title), text: t(text), tone: 'error', buttons: retry ? [{ label: t('CLOSE') }, { label: t('TRY AGAIN'), run: retry, primary: true }] : [{ label: t('OK'), primary: true }] });
    }
    // the demo drive is for showing the app off, not for a car on the road: locked unless unlocked
    // (or the host has no car at all, as the browser preview)
    const demoOk = () => !!DemoDriver && !!(host.demo || S.demoUnlocked);
    if (S.mode === 'demo' && !demoOk()) S.mode = 'live';
    let history = (host.load && host.load('history')) || [];
    if (!Array.isArray(history)) history = [];
    if (!host.recordDemo) history = history.filter((h) => h && h.mode === 'live');      // nothing from a demo drive stays
    function keepHistory(entry, clip) {
        if (host.save) host.save('clip-' + entry.id, clip.toString());
        history.unshift(entry);
        // the 20 newest and the 10 best stay; the rest and their clips go
        const newest = history.slice(0, 20), best = history.slice().sort((a, b) => b.pts - a.pts).slice(0, 10);
        const keep = new Set(newest.concat(best).map((h) => h.id));
        for (const h of history) if (!keep.has(h.id) && host.save) host.save('clip-' + h.id, null);
        history = history.filter((h) => keep.has(h.id));
        if (host.save) host.save('history', history);
    }

    function build(keepScore) {
        spec = Object.assign({}, PRESETS[S.preset], { rhd: !!S.rhd, lod });
        car = new CarRenderer(spec, { style: 'ghost' });                         // the car is always the ghost
        if (!keepScore) {
            demo = DemoDriver ? new DemoDriver(spec) : null; metrics = new Metrics(spec); score = new Score();
            est = new DriftEstimator(spec, { awd: S.drive === 'awd' });
            trails = new W3.Trails(); smoke = new W3.Smoke(); hud = hud || new Hud(); hud.reset();
            rec2 = new Recorder(); pose = { x: 0, y: 0, yaw: 0 }; chainStartT = null;
        } else {
            metrics.a = metrics.b = spec.WB / 2;
            est = new DriftEstimator(spec, { awd: S.drive === 'awd' });
            if (demo) { demo.WB = spec.WB; demo.r = spec.wheel.r; }
        }
        cam = cam || new Cam();
    }
    build(false);
    /* ---------- live: one step per sample, with the sample's own time ---------- */
    function liveStep(s, dt) {
        s = s || { ax: 0, ay: 0, yawRate: 0, steerWheel: 0, wheel: [0, 0, 0, 0], brake: 0 };
        let steer = (s.steerWheel || 0) / S.steerRatio * Math.PI / 180;     // steering-wheel deg -> road-wheel rad
        // road wheels rarely exceed ~35°; clamp noise / bad scale so the model does not flap
        const STEER_MAX = 0.65;
        if (steer > STEER_MAX) steer = STEER_MAX; else if (steer < -STEER_MAX) steer = -STEER_MAX;
        const fix = S.gps !== 'off' && gpsFix ? gpsFix : null; gpsFix = null;
        if (fix) gpsSeen = clock;
        // signs just settled or flipped: rebuild the filter (gyro bias was learned under the old sign)
        if ((s.ready && !wasReady) || s.signFlip) {
            est = new DriftEstimator(spec, { awd: S.drive === 'awd' });
            pose.yaw = 0; camYaw = 0; camVel = 0;
        }
        wasReady = !!s.ready;
        est.update({ ax: s.ax, ay: s.ay, yawRate: s.yawRate, steer, wheel: s.wheel, wheelsReal: s.wheelsReal }, dt, fix);
        const r = s.yawRate - est.x[4];
        pose.yaw += r * dt;
        const cy = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
        const vxw = cy * est.vx - sy * est.vy, vyw = sy * est.vx + cy * est.vy;
        pose.x += vxw * dt; pose.y += vyw * dt;
        const speed = Math.hypot(est.vx, est.vy);
        // when gripping / going straight, pull body yaw onto the travel heading so residual gyro bias cannot spin the car
        if (speed > 2.5 && Math.abs(est.beta) * 180 / Math.PI < 10 && Math.abs(r) < 0.15) {
            const travel = Math.atan2(vyw, vxw);
            pose.yaw += wrap(travel - pose.yaw) * Math.min(1, dt * 3.5);
        }
        return { x: pose.x, y: pose.y, yaw: pose.yaw, vx: est.vx, vy: est.vy, speed, yawRate: r, ax: s.ax, ay: s.ay - est.x[2],
            steer, brake: s.brake || 0, wheelSpeed: s.wheel, dt, vxw, vyw };
    }
    /* ---------- one simulation step ---------- */
    function step(dt) {
        let st;
        if (S.mode === 'demo') {
            st = demo.step(dt);
            st.vxw = Math.cos(st.yaw) * st.vx - Math.sin(st.yaw) * st.vy;
            st.vyw = Math.sin(st.yaw) * st.vx + Math.cos(st.yaw) * st.vy;
            pose.x = st.x; pose.y = st.y; pose.yaw = st.yaw;
            // synthetic Live Data vitals for the HUD while demo-driving
            const betaDeg = st.speed > 1 ? Math.abs(Math.atan2(st.vy, Math.abs(st.vx))) * 180 / Math.PI : 0;
            const load = Math.min(1, betaDeg / 40);
            vitalsSnap = {
                rpm: 2200 + load * 2800 + Math.sin(clock * 3) * 180,
                coolant: 88 + load * 8, oil: 102 + load * 12, gearbox: 78 + load * 18,
                boost: Math.max(0, load * 1.35 + Math.sin(clock * 2) * 0.08),
                gear: load > 0.35 ? 'M' + Math.min(6, 2 + Math.floor(load * 4)) : 'D4',
                torque: 180 + load * 220, powerPct: Math.round(25 + load * 70), ambient: 18,
            };
        } else st = liveStep(live, dt);
        metrics.update(st, dt);
        // score only when signs are locked and the filter is not wildly uncertain
        const scoreOk = S.mode === 'demo' || (live && live.ready && (!est || est.quality >= 0.2 || est.sigma < 8));
        if (scoreOk) score.update(metrics, dt);
        else if (score.active) { score.grace += dt; if (score.grace > 1.4) score.bank(); }
        if (score.active) { if (chainStartT === null) { chainStartT = rec2.t; chainKmh = 0; } chainKmh = Math.max(chainKmh, metrics.kmh); }
        // new score events go into the replay; a banked chain becomes a local clip
        for (const e of score.events) {
            if (e._seen) continue;
            e._seen = true;
            rec2.event({ kind: e.kind, text: e.text, pts: e.pts, tier: e.tier });
            if (e.kind === 'bank') onBank(e);
            if (e.kind === 'lost') chainStartT = null;
        }
        rec2.push(dt, st, metrics, score);
        if (pendingClip && rec2.t >= pendingClip.at) {
            const c = rec2.clip(pendingClip.t0, pendingClip.at, pendingClip.meta);
            if (c) {
                lastClip = c;
                if (pendingClip.best && (c.meta.mode === 'live' || host.recordDemo)) { bestClip = c; if (host.save) host.save('bestReplay', c.toString()); }
                onClip(c, pendingClip);
            }
            pendingClip = null;
        }
        return st;
    }
    function onBank(e) {
        const t0 = Math.max(0, (chainStartT !== null ? chainStartT : rec2.t - (e.time || 10) - 1.4) - 2);
        const best = e.pts >= ((bestClip && bestClip.meta.pts) || 0);
        pendingClip = { t0, at: rec2.t + 1.5, best, kmh: chainKmh, angleAvg: score.avgAngle,
            meta: { id: randomHex(10), pts: e.pts, text: e.text, tier: e.tier, mult: e.mult, time: e.time, maxAngle: e.maxAngle !== undefined ? e.maxAngle : score.maxAngle, mode: S.mode, name: '', ts: Date.now(), body: S.preset } };
        chainStartT = null;
        hud.rank(rankLines(e.pts));
        records.chains++;
        if (S.mode === 'live' || host.recordDemo) {                  // demo drives are never recorded
            records.total += e.pts; records.best = Math.max(records.best, e.pts);
            records.maxAngle = Math.max(records.maxAngle, score.maxAngle); records.longest = Math.max(records.longest, e.time || 0);
            saveRecords();
        }
    }
    function rankLines(pts) {
        const out = [];
        if (pts > records.best && records.chains > 0) out.push({ text: 'NEW PERSONAL BEST', tone: 'gold' });
        return out;
    }
    /** the clip of a banked chain is ready: into the local history (live data only) */
    function onClip(c, p) {
        const m = c.meta;
        // a demo drive is never kept: it can be watched again until the next one, nothing more
        if (m.mode !== 'live' && !host.recordDemo) return;
        keepHistory({ id: m.id, pts: m.pts, text: m.text, tier: m.tier, time: m.time, maxAngle: m.maxAngle, ts: m.ts, mode: m.mode, body: m.body, dur: c.duration }, c);
    }

    let st = step(1 / 60);

    /* ---------- menu ---------- */
    let slow = 0;
    /**
     * The settings, as sections of rows for the HUD to draw: each row is a segmented choice ('seg'),
     * a palette ('swatch'), a stepper ('step'), a button or a read-out. A row that does not apply
     * (the colours while the car is a ghost, the roof of an open car) is drawn dimmed and takes no taps.
     */
    function menuRows() {
        const rebuild = () => build(true);
        const bodies = ['auto'].concat(BODIES.indexOf(S.preset) >= 0 || S.autoBody ? BODIES : BODIES.concat([S.preset])), bodyNow = S.autoBody ? 'auto' : S.preset;
        return [
            { section: 'CAR' },
            { kind: 'step', label: 'Body', value: S.autoBody ? 'Auto: ' + spec.name : spec.name, note: S.autoBody ? 'From the car' : '',
                set: (d) => { const k = bodies[(bodies.indexOf(bodyNow) + d + bodies.length) % bodies.length]; if (k === 'auto') S.autoBody = true; else { S.autoBody = false; S.preset = k; } rebuild(); } },
            { kind: 'seg', label: 'Drivetrain', value: S.drive, options: [{ id: 'rwd', label: 'RWD' }, { id: 'awd', label: 'AWD' }], set: (v) => { if (v !== S.drive) { S.drive = v; rebuild(); } } },
            { kind: 'step', label: 'Steering ratio', value: S.steerRatio.toFixed(1) + ' : 1', set: (d) => { S.steerRatio = Math.max(10, Math.min(20, +(S.steerRatio + d * 0.5).toFixed(1))); } },
            { section: 'DRIVING' },
            demoOk() ? { kind: 'seg', label: 'Data', value: S.mode, options: [{ id: 'demo', label: 'Demo drive' }, { id: 'live', label: 'Live car' }], set: (v) => { if (v !== S.mode) { S.mode = v; build(false); } } }
                : { kind: 'info', label: 'Data', value: 'Live car' },
            { kind: 'seg', label: 'GPS fusion', value: S.gps === 'off' ? 'off' : 'auto', options: [{ id: 'auto', label: 'Auto' }, { id: 'off', label: 'Off' }], set: (v) => { S.gps = v; } },
            { kind: 'seg', label: 'Units', value: S.units === 'mph' ? 'mph' : 'kmh', options: [{ id: 'kmh', label: 'km/h' }, { id: 'mph', label: 'mph' }], set: (v) => { S.units = v; } },
            { kind: 'button', label: 'Session', value: 'Best ' + Math.round(records.best).toLocaleString(I18N.getLang() === 'hu' ? 'hu-HU' : 'en') + '  /  ' + Math.round(records.maxAngle) + '°', action: 'Reset', danger: true,
                run: () => { score.reset(); trails.reset(); smoke.reset(); hud.reset(); rec2.reset(); } },
            { section: 'APP' },
            { kind: 'seg', label: 'Language', value: S.lang || 'auto',
                options: [{ id: 'auto', label: 'Auto' }, { id: 'hu', label: 'Magyar' }, { id: 'en', label: 'English' }],
                set: (v) => { S.lang = v; applyLang(); save(); } },
            { kind: 'seg', label: 'Design', value: S.theme, note: host.idrive ? t('This car: ') + (host.idrive === 'id8' ? 'iDrive 8' : 'iDrive 7') : '',
                options: [{ id: 'id7', label: 'iDrive 7', raw: true }, { id: 'id8', label: 'iDrive 8', raw: true }], set: (v) => { S.theme = v; hud.setTheme(v); save(); } },
            { kind: 'seg', label: 'Graphics', value: S.quality, note: S.quality === 'auto' ? (lod ? t('Now: light') : t('Now: full')) : '', options: [{ id: 'auto', label: 'Auto' }, { id: 'high', label: 'Full' }, { id: 'low', label: 'Light' }],
                set: (v) => { S.quality = v; lod = v === 'low' ? 1 : 0; slow = 0; rebuild(); } },
            { kind: 'info', label: 'Version', value: 'IDRIVE155 ' + VERSION },
        ];
    }

    /* ---------- cameras: chase while driving; cuts between five angles in a replay ---------- */
    function aim(v, dt, mode, t) {
        const travel = v.speed > 1.5 ? Math.atan2(v.vyw, v.vxw) : v.yaw;
        const err = wrap(travel - camYaw);
        camVel += (err * 9 - camVel * 5.2) * dt; camYaw = wrap(camYaw + camVel * dt);
        if (Math.abs(err) > 2.5) camYaw = travel;
        // a little look-ahead only: too much and the car sinks to the bottom of the screen at speed
        let yaw = camYaw, pitch = 0.70, dist = 10.5, lead = Math.min(v.speed * 0.045, 1.1), f = 900, cyk = 0.565, h = 0.45;
        if (mode === 'top') { pitch = 1.15; dist = 15; lead = 0; cyk = 0.5; }
        else if (mode === 'topwide') { pitch = 1.2; dist = 22; lead = 0; cyk = 0.5; }
        else if (mode === 'free') { yaw = free.yaw; pitch = free.pitch; dist = free.dist; lead = 0; cyk = 0.55; h = 0.5; }
        lastAim = { yaw, pitch, dist };
        cam.chase(v.x + Math.cos(camYaw) * lead, v.y + Math.sin(camYaw) * lead, h, yaw, pitch, dist);
        return { f, cyk };
    }

    /* ---------- frame ---------- */
    let acc = 0, carMs = 0, frames = 0;
    const prof = {};
    const now = typeof performance !== 'undefined' ? () => performance.now() : () => { const t = process.hrtime(); return t[0] * 1e3 + t[1] / 1e6; };
    /*
     * nothing may stop the app: an error in a frame is logged, the frame is drawn again from a clean
     * state with a popup that says so, and the app goes on (the same error is told once)
     */
    let lastCrash = '';
    function frame(rec, dt, W, H) {
        try { return frameInner(rec, dt, W, H); } catch (e) {
            const msg = String(e && e.message || e).slice(0, 120);
            if (log.warn) log.warn('frame error: ' + msg + (e && e.stack ? ' ' + String(e.stack).split('\n').slice(1, 3).join(' ') : ''));
            player2 = null; editor = null; share = null; hud.screen = null;
            if (msg !== lastCrash) {
                lastCrash = msg;
                hud.popupShow({
                    title: t('SOMETHING WENT WRONG'),
                    text: t('The app hit an error and recovered: ') + msg + t('. It keeps running; if this comes back, restart it.'),
                    tone: 'error', buttons: [{ label: t('OK'), primary: true }],
                });
            }
            try { rec.reset(); return frameInner(rec, 0, W, H); } catch (e2) { rec.reset(); rec.clear(0x000000ff); return undefined; }
        }
    }
    function frameInner(rec, dt, W, H) {
        dt = Math.min(Math.max(dt, 0), 0.1);
        clock += dt;
        if (editor && hud.screen === 'edit') return editFrame(rec, dt, W, H);          // (the export's popup is over the drive or the replay)
        let view;
        const replaying = !!player2;
        if (replaying) { view = player2.step(dt); view.dt = dt; }
        else {
            if (S.mode === 'demo') { acc += dt; while (acc >= 1 / 120) { st = step(1 / 120); acc -= 1 / 120; } }
            view = st;
        }
        const beta = replaying ? view.beta : metrics.beta;
        // the world's own time: a paused (or finished) replay stands still - no wheel turns, no smoke is made
        const simDt = replaying ? (player2.playing ? dt * player2.speed : 0) : dt;
        view.dt = simDt;
        trails.add(car, view, beta, simDt);
        const rearSlip = view.wheelSpeed ? Math.max(0, (view.wheelSpeed[2] + view.wheelSpeed[3]) / 2 * spec.wheel.r / Math.max(view.speed, 1) - 1) * 4 : 0;
        smoke.update(car, view, beta, Math.min(1, rearSlip + Math.abs(beta) / 60), simDt);
        const M = model(view);
        hud.update(dt, M);

        const camMode = replaying ? (player2.cam === 'free' ? 'free' : CAMS.indexOf(player2.cam) >= 0 ? player2.cam : 'chase') : 'chase';
        const ck = aim(view, dt, camMode, replaying ? player2.camT : 0);
        cam.f = ck.f * H / 720; cam.cx = W / 2; cam.cy = H * ck.cyk;

        rec.reset();
        hud.setTheme(S.theme);
        W3.floor(rec, cam, W, H, view.x, view.y);
        trails.draw(rec, cam);
        if (camMode === 'chase' || camMode === 'top') W3.protractor(rec, cam, view, beta, view.speed, Math.max(spec.L / 2 + 0.6, 2.9));
        W3.shadow(rec, cam, car.body.foot, view);
        const TMP = [0, 0, 0]; cam.proj(view.x, view.y, 0.6, TMP, 0); const split = TMP[2];
        smoke.draw(rec, cam, split, false, view.brake > 0.2);
        const latG = replaying ? view.latG : (view.ay || 0) / 9.81;
        const roll = Math.max(-0.07, Math.min(0.07, -latG * 0.035));
        const pitch = replaying ? 0 : Math.max(-0.04, Math.min(0.04, (view.ax || 0) / 9.81 * 0.02));
        // the ghost keeps one colour, the theme's: it does not change with the angle
        { const g = TM.theme().ghost, tt = car.tint; tt[0] = g[0]; tt[1] = g[1]; tt[2] = g[2]; }
        const t0 = now();
        car.draw(rec, cam, { x: view.x, y: view.y, yaw: view.yaw, roll, pitch, steer: view.steer, wheelSpeed: view.wheelSpeed, brake: view.brake, speed: view.speed, dt: simDt });
        const cm = now() - t0;
        W3.lampGlow(rec, car.glows, view.brake || 0);
        smoke.draw(rec, cam, split, true, view.brake > 0.2);
        hud.draw(rec, M, W, H);
        // automatic detail: a head unit that takes long over the car gets the lighter body
        carMs += cm; frames++;
        if (frames >= 180) {
            const avg = carMs / frames; carMs = 0; frames = 0; prof.carMs = avg;
            if (S.quality === 'auto' && !lod && avg > 6) { if (++slow >= 2) { lod = 1; log.info('graphics: the car took ' + avg.toFixed(1) + ' ms: lighter detail'); build(true); } }
            else slow = 0;
        }
        return rec;
    }
    const editCars = new Map();
    function editCar() {
        const spec = PRESETS[S.preset] || PRESETS.coupe, key = S.preset;
        if (!editCars.has(key)) { editCars.clear(); editCars.set(key, new CarRenderer(spec, { style: 'ghost' })); }
        return editCars.get(key);
    }
    /** the editor: the edit's own frame, scaled into the preview box; the controls around it */
    function editFrame(rec, dt, W, H) {
        const d = editor.dir;
        if (editor.playing) { editor.v += dt; if (editor.v > d.duration + 0.6) { editor.v = 0; d.reset(); } }
        rec.reset();
        hud.setTheme(S.theme);
        const M = model(player2 ? player2.step(0) : st);
        hud.update(dt, M);
        if (hud.screen === 'edit') {
            const box = hud.editBox(W, H), fmt = editor.edit.format, sz = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080] }[fmt] || [1920, 1080];
            const k = Math.min(box.w / sz[0], box.h / sz[1]), bx = box.x + (box.w - sz[0] * k) / 2, by = box.y + (box.h - sz[1] * k) / 2;
            hud.editRect = { x: bx, y: by, w: sz[0] * k, h: sz[1] * k };
            rec.xf(k, bx, by); rec.clip(0, 0, sz[0], sz[1]);
            d.frame(rec, Math.min(editor.v, d.duration), editor.playing ? dt : 0, sz[0], sz[1]);
            rec.noclip(); rec.xf(0, 0, 0);
        }
        hud.draw(rec, M, W, H);
        return rec;
    }
    function model(view) {
        const status = S.mode === 'demo' || player2 ? null : !live || clock - liveFresh > 3 ? t('NO CAR DATA YET') : null;
        return {
            m: metrics, score, vitals: vitalsSnap, mode: S.mode === 'demo' ? 'DEMO' : 'LIVE', units: S.units, sigma: est.sigma || 0, status, gps: clock - gpsSeen < 2,
            menuRows: hud && hud.screen === 'menu' ? menuRows() : null,
            history: hud && hud.screen === 'history' ? history.slice() : null,
            edit: editor ? { edit: editor.edit, v: editor.v, d: editor.dir.duration, playing: editor.playing, camera: editor.dir.plan.camera, video: editor.dir.plan.video } : null,
            share,
            replay: player2 ? { t: player2.t, d: player2.clip.duration, playing: player2.playing, speed: player2.speed, cam: player2.cam, st: view, meta: player2.clip.meta, events: player2.clip.events } : null,
            clips: { last: !!(lastClip || rec2.n > 60), best: !!bestClip, bestPts: bestClip ? bestClip.meta.pts : 0 }, records,
        };
    }

    /* ---------- actions (the HUD's touch targets call these) ---------- */
    const actions = {
        menu() { hud.screen = 'menu'; },
        /** the demo drive's lock: seven quick taps on the settings' title */
        titleTap() {
            const now = clock; titleTaps = titleTaps.filter((t) => now - t < 4); titleTaps.push(now);
            if (titleTaps.length < 7 || host.demo || !DemoDriver) return;
            titleTaps = [];
            S.demoUnlocked = !S.demoUnlocked;
            if (!S.demoUnlocked && S.mode === 'demo') { S.mode = 'live'; build(false); }
            hud.toast(S.demoUnlocked ? 'DEMO DRIVE UNLOCKED: NOTHING IT DOES IS SCORED' : 'DEMO DRIVE LOCKED'); save();
        },
        /** a drift taken out of this car's history (its replay too) */
        historyDelete(id) {
            const n = history.length;
            history = history.filter((h) => h.id !== id);
            if (history.length === n) return;
            if (host.save) { host.save('clip-' + id, null); host.save('history', history); }
            if (bestClip && bestClip.meta.id === id) { bestClip = null; if (host.save) host.save('bestReplay', null); }
            hud.toast('DRIFT DELETED', 1.5);
        },
        /** local saved drifts on this car */
        history() { hud.screen = 'history'; },
        close() { hud.screen = null; save(); },
        replay(which) {
            const c = which === 'best' ? bestClip : lastClip || rec2.last(20, { text: 'LAST 20 SECONDS', pts: 0 });
            if (!c) return;
            c.meta = Object.assign({}, c.meta, { own: true });
            player2 = new Player(c); player2.cam = S.replayCam && S.replayCam !== 'free' ? S.replayCam : 'chase'; hud.screen = null; trails.reset(); smoke.reset(); hud.reset();
        },
        /** a drift from this car's local history */
        playRun(id) {
            if (!id) return;
            const local = host.load && host.load('clip-' + id);
            const c = local ? Clip.parse(local) : null;
            if (!c) { problem('NO REPLAY', 'This drift has no replay saved on this car.'); return; }
            c.meta = Object.assign({}, c.meta, { own: true });
            player2 = new Player(c); player2.cam = S.replayCam && S.replayCam !== 'free' ? S.replayCam : 'chase'; hud.screen = null; trails.reset(); smoke.reset(); hud.reset();
        },
        /* ---------- the editor: own drifts only ---------- */
        editOpen() {
            if (!player2 || !player2.clip.meta || !player2.clip.meta.own) { hud.toast('ONLY YOUR OWN DRIFTS CAN BE EDITED'); return; }
            const e = Object.assign({ camera: 'chase', slowmo: 'auto', format: '16:9', trim: 'auto', overlay: true }, S.lastEdit || {});
            delete e.style; if (['chase', 'top', 'topwide'].indexOf(e.camera) < 0) e.camera = 'chase';
            delete e.car;
            editor = { clip: player2.clip, edit: e, v: 0, playing: true };
            editor.dir = new Director({ clip: player2.clip, car: editCar(), edit: e, name: '', units: S.units });
            player2.playing = false; hud.screen = 'edit';
        },
        editSet(k, v) {
            if (!editor) return;
            editor.edit = Object.assign({}, editor.edit, { [k]: v });
            editor.dir.setEdit(editor.edit); editor.v = 0; editor.playing = true;
            S.lastEdit = editor.edit; save();
        },
        editToggle() { if (!editor) return; if (!editor.playing && editor.v >= editor.dir.duration) editor.v = 0; editor.playing = !editor.playing; },
        editSeek(frac) { if (!editor) return; editor.v = Math.max(0, Math.min(1, frac)) * editor.dir.duration; editor.dir.reset(); },
        editClose() { editor = null; share = null; editCars.clear(); hud.screen = null; trails.reset(); smoke.reset(); },
        /** export: browser preview can encode locally; on the car this needs a host export hook */
        exportStart() {
            if (!editor) return;
            hud.screen = 'share';
            const c0 = editor.clip, m0 = Object.assign({}, c0.meta || {}); delete m0.own;
            if (host.exportLocal) {
                share = { state: 'local' };
                host.exportLocal(c0.toString(), editor.edit, Object.assign({}, m0, { name: '', units: S.units, body: S.preset, theme: S.theme }))
                    .then(() => { if (share && share.state === 'local') share.state = 'local-done'; }, (e) => { share = { state: 'local-failed', error: String(e && e.message || e) }; });
                return;
            }
            share = { state: 'no-server' };
        },
        shareClose() { share = null; editor = null; editCars.clear(); hud.screen = null; },
        shareEdit() { share = null; hud.screen = editor ? 'edit' : null; },
        replayExit() { player2 = null; trails.reset(); smoke.reset(); hud.reset(); },
        replayToggle() { if (!player2) return; if (!player2.playing && player2.t >= player2.clip.duration) player2.t = 0; player2.playing = !player2.playing; },
        replaySpeed() { if (player2) player2.speed = player2.speed === 1 ? 0.5 : player2.speed === 0.5 ? 0.25 : 1; },
        replayCam() { if (player2) { player2.cam = player2.cam === 'free' ? 'chase' : cycle(CAMS, player2.cam); player2.camT = 0; S.replayCam = player2.cam; } },
        replayZoom(k) { if (player2) { goFree(); free.dist = Math.max(3, Math.min(30, free.dist * (k || 0.8))); } },
        replaySeek(frac) { if (player2) { player2.seek(frac); trails.reset(); smoke.reset(); } },
    };
    hud.actions = actions;

    /* ---------- touch ---------- */
    let down = null;
    /*
     * the freestyle camera (replays): a finger dragged over the scene orbits the car (sideways: round it,
     * up and down: the height), two fingers pinch the distance. Any camera turns free the moment it is
     * dragged. Fingers are told apart by `id` (0 when the host knows only one).
     */
    const free = { yaw: 0, pitch: 0.5, dist: 10 }, fingers = new Map();
    let lastAim = { yaw: 0, pitch: 0.6, dist: 10 }, pinchD = 0, orbiting = false;
    const goFree = () => { if (player2 && player2.cam !== 'free') { free.yaw = lastAim.yaw; free.pitch = lastAim.pitch; free.dist = lastAim.dist; player2.cam = 'free'; } };
    function freeTouch(phase, x, y, id) {
        if (phase === 1) fingers.set(id, { x, y });
        const f0 = fingers.get(id);
        if (phase === 3) { fingers.delete(id); if (fingers.size < 2) pinchD = 0; if (!fingers.size) orbiting = false; return; }
        if (!f0) return;
        if (fingers.size >= 2) {                                    // a pinch: the distance follows the fingers' spread
            const [a, b] = Array.from(fingers.values()); if (id !== undefined) fingers.set(id, { x, y });
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (pinchD > 0 && d > 10) { goFree(); free.dist = Math.max(3, Math.min(30, free.dist * pinchD / d)); }
            pinchD = d; return;
        }
        if (phase === 2) {
            const dx = x - f0.x, dy = y - f0.y;
            if (orbiting || Math.hypot(dx, dy) > 6) {
                orbiting = true; goFree();
                free.yaw -= dx * 0.0075; free.pitch = Math.max(0.03, Math.min(1.45, free.pitch + dy * 0.005));
            }
            fingers.set(id, { x, y });
        }
    }
    let scrollG = null;
    function touch(phase, x, y, id) {
        try { touchInner(phase, x, y, id); } catch (e) {
            if (log.warn) log.warn('touch error: ' + String(e && e.message || e).slice(0, 120));
            down = null; scrollG = null;
        }
    }
    function touchInner(phase, x, y, id) {
        id = id || 0;
        // a replay with nothing open over it: the scene (not its buttons) is the freestyle camera's
        if (player2 && !hud.screen && !hud.popup) {
            const h0 = hud.hit(x, y);
            if (fingers.size || (phase === 1 && (!h0 || h0.id === 'rp-scene'))) { freeTouch(phase, x, y, id); if (fingers.size || phase === 3) return; }
        }
        const sa = hud.scrollArea;
        if (phase === 1) scrollG = sa && x >= sa.x && x < sa.x + sa.w && y >= sa.y && y < sa.y + sa.h ? { key: sa.key, y0: y, s0: hud.scroll[sa.key] || 0, max: sa.max, moved: false } : null;
        if (phase === 2 && scrollG) {
            const d = y - scrollG.y0;
            if (Math.abs(d) > 12) scrollG.moved = true;
            if (scrollG.moved) { hud.scroll[scrollG.key] = Math.max(0, Math.min(scrollG.max, scrollG.s0 - d)); hud.pressed = null; return; }
        }
        if (phase === 3 && scrollG) { const mv = scrollG.moved; scrollG = null; if (mv) { down = null; return; } }
        const hit = hud.hit(x, y);
        if (phase === 1) { down = hit ? hit.id : null; if (hit) { hud.tap(hit.id); if (hit.drag) hit.drag(x, y); } return; }
        if (phase === 2) { if (hit && hit.drag && down === hit.id) hit.drag(x, y); return; }
        if (phase !== 3) return;
        const was = down; down = null;
        if (!hit || hit.id !== was) { if (hud.screen && !hit && was === null) actions.close(); return; }
        if (typeof hit.run === 'function') { hit.run(); save(); }
    }

    return {
        frame, touch, settings: S, prof,
        /** read-only views for tests and the platform */
        get share() { return share; }, get editor() { return editor; },
        debug() { return { spin: car.spin.slice(), smoke: smoke.p.length, replaying: !!player2, playing: player2 ? player2.playing : null, cam: player2 ? player2.cam : null, free: Object.assign({}, free) }; },
        input(sample) {
            live = sample; liveFresh = clock;
            if (S.mode !== 'live' || player2) return;
            const t = sample.t !== undefined ? sample.t : clock;
            const dt = lastSampleT === null ? 0.02 : Math.min(Math.max(t - lastSampleT, 0), 0.1);
            lastSampleT = t;
            if (dt > 0) { try { st = step(dt); } catch (e) { if (log.warn) log.warn('step error: ' + String(e && e.message || e).slice(0, 120)); } }
        },
        gps(fix) { gpsFix = fix; },
        /** Live Data vitals (platform/vitals.js): coolant, oil, gearbox, boost, rpm, gear */
        vitals(snap) { if (snap && typeof snap === 'object') vitalsSnap = Object.assign({}, vitalsSnap, snap); },
        /** the car's own type from its signals: applied unless the user chose a body by hand */
        vehicle(t) {
            if (!t || !S.autoBody) return;
            let ch = false;
            if (t.body && PRESETS[t.body] && S.preset !== t.body) { S.preset = t.body; ch = true; }
            if ((t.drive === 'awd' || t.drive === 'rwd') && S.drive !== t.drive) { S.drive = t.drive; ch = true; }
            if (t.rhd !== null && t.rhd !== undefined && S.rhd !== t.rhd) { S.rhd = t.rhd; ch = true; }
            if (ch) { log.info('vehicle: ' + S.preset + ', ' + S.drive + (S.rhd ? ', right-hand drive' : '')); build(true); save(); }
        },
        get car() { return car; }, get metrics() { return metrics; }, get score() { return score; }, get hud() { return hud; },
        get state() { return st; }, get est() { return est; }, get liveSample() { return live; },
        get actions() { return actions; },
    };
}

module.exports = { createApp, DEFAULTS };
