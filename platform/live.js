'use strict';
/**
 * live.js - the car's signals into samples for the app (app.input / app.gps).
 *
 * Signals (iDrive 7 MGU; names as other community apps use them):
 *   lateral / longitudinal acceleration   CDS2.statusLateral/LongitudinalAccelerationMassCenter   raw x 0.002 - 65 m/s^2
 *   yaw rate                              CDS2.statusYawVelocityVehicle                            raw x 0.005 - 163.84 deg/s
 *   steering-wheel angle                  chassis.SteeringAngle.ActualSteeringAngleDriver          signed 16 bit x 0.04395 deg
 *   wheel speeds                          powertrain.Powertrain.ActualValueRPMWheel                scale learned against the speed
 *   speed                                 Vehicle2.statusCarSpeed2                                 raw x 0.015625 km/h (kit/car.js)
 *   GNSS (experimental)                   SatellitePositioning.basicPearlChain, Positioning.currentLocation
 *
 * Nothing about signs is assumed: they are learned while driving, by votes that must agree.
 *   steering  BMW sends left positive (right negative); kept, checked against the yaw rate
 *   yaw       must have the steering's sign in ordinary cornering (low lateral G, moderate lock)
 *   lateral   must have the yaw rate's sign whenever the car turns at speed (a = v r)
 *   long.     must have the sign of the speed's derivative
 *   wheels    factor = speed / mean front wheel value, straight and steady, median of many
 * Until each is settled the app shows the data but the score waits for it (this.ready).
 * The first values of every signal are logged ('raw ...') so a new car can be checked.
 */
const asNum = (v) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : null);
const num = (v) => asNum(v) !== null;
const D2R = Math.PI / 180;

const META_KEY = /^(qualifier|status|valid|crc|alive|counter)/i;
function numberIn(v, rx) {
    const d0 = asNum(v); if (d0 !== null) return d0;
    let first;
    const walk = (o, d) => {
        if (!o || typeof o !== 'object' || d > 4) return undefined;
        for (const k of Object.keys(o)) {
            if (META_KEY.test(k)) continue;
            const x = o[k], nx = asNum(x);
            if (nx !== null) { if (rx.test(k)) return nx; if (first === undefined) first = nx; }
            else if (x && typeof x === 'object') { const r = walk(x, d + 1); if (r !== undefined) return r; }
        }
        return undefined;
    };
    const r = walk(v, 0);
    return r !== undefined ? r : first;
}
function wheelsIn(v) {
    const out = {};
    const walk = (o, d) => {
        if (!o || typeof o !== 'object' || d > 4) return;
        for (const k of Object.keys(o)) {
            if (META_KEY.test(k)) continue;
            const x = o[k], nx = asNum(x), n = k.toLowerCase();
            if (nx !== null) {
                const w = /(fl|frontleft|front_left|vl)(h)?$/.test(n) ? 0 : /(fr|frontright|front_right|vr)(h)?$/.test(n) ? 1 : /(rl|rearleft|rear_left|hl)(h)?$/.test(n) ? 2 : /(rr|rearright|rear_right|hr)(h)?$/.test(n) ? 3 : -1;
                if (w >= 0 && out[w] === undefined) out[w] = nx;
            } else if (x && typeof x === 'object') walk(x, d + 1);
        }
    };
    walk(v, 0);
    return [0, 1, 2, 3].every((i) => out[i] !== undefined) ? [out[0], out[1], out[2], out[3]] : null;
}
/** every {lat, lon} pair in a structure (degrees, or 1e-7 / 2^31 scaled integers), in order */
function positionsIn(v) {
    const out = [];
    const walk = (o, d) => {
        if (!o || typeof o !== 'object' || d > 6) return;
        const ks = Object.keys(o);
        const la = ks.find((k) => /^lat/i.test(k)), lo = ks.find((k) => /^(lon|lng)/i.test(k));
        if (la && lo && num(o[la]) && num(o[lo])) {
            let a = o[la], b = o[lo];
            if (Math.abs(a) > 90) { a = Math.abs(a) > 1e8 ? a * 90 / 2147483648 : a * 1e-7; b = Math.abs(b) > 1e8 ? b * 180 / 2147483648 : b * 1e-7; }
            const tk = ks.find((k) => /time|stamp/i.test(k));
            out.push({ lat: a, lon: b, t: tk && num(o[tk]) ? o[tk] : null });
            return;
        }
        for (const k of ks) walk(o[k], d + 1);
    };
    walk(v, 0);
    return out;
}

/**
 * The car's own type (Vehicle2.statusVehiclePartType): body style, steering side, drive.
 * Field names differ between head-unit software levels, so every enum name in the struct is read.
 */
function vehicleTypeOf(v) {
    const words = [];
    const walk = (o, d) => {
        if (o == null || d > 4) return;
        if (typeof o === 'string') { words.push(o.toUpperCase()); return; }
        if (typeof o !== 'object') return;
        for (const k of Object.keys(o)) { words.push(k.toUpperCase()); walk(o[k], d + 1); }
    };
    walk(v, 0);
    const all = words.join(' ');
    const has = (rx) => rx.test(all);
    let body = null;
    if (has(/ROADSTER/)) body = 'roadster';
    else if (has(/TOURING|KOMBI|ESTATE|WAGON/)) body = 'touring';
    else if (has(/\bSA[VC]\b|SUV|SPORTS?_?ACTIVITY|GELAENDE/)) body = 'suv';
    else if (has(/GRAN_?COUPE|LIMOUSINE|SEDAN|STUFENHECK/)) body = 'sedan';
    else if (has(/CABRIO|CONVERTIBLE/)) body = 'cabrio';
    else if (has(/COUPE/)) body = 'coupe';
    else if (has(/HATCH|KOMPAKT|SCHRAEGHECK|COMPACT/)) body = 'hatch';
    const rhd = has(/RECHTSLENK|RIGHT_?HAND|LENKUNG_?RECHTS|STEERING_?RIGHT/) ? true : has(/LINKSLENK|LEFT_?HAND|LENKUNG_?LINKS|STEERING_?LEFT/) ? false : null;
    const drive = has(/ALLRAD|XDRIVE|AWD|4WD|ALL_?WHEEL/) ? 'awd' : has(/HECKANTRIEB|REAR_?WHEEL|RWD/) ? 'rwd' : has(/FRONTANTRIEB|FRONT_?WHEEL|FWD/) ? 'fwd' : null;
    if (!body && rhd === null && !drive) return null;
    return { body, rhd, drive };
}

class Vote {
    constructor(need) { this.need = need; this.p = 0; this.n = 0; this.sign = 0; }
    add(s) { if (s > 0) this.p++; else if (s < 0) this.n++; const t = this.p + this.n; if (t >= this.need) { const r = this.p / t; if (r > 0.85) this.sign = 1; else if (r < 0.15) this.sign = -1; } }
}

class Live {
    constructor(ctx, log, spec, onSample, onFix) {
        this.ctx = ctx; this.log = log; this.spec = spec; this.onSample = onSample; this.onFix = onFix;
        this.v = { ax: 0, ay: 0, yaw: 0, steer: 0, speed: 0, wheelsRaw: null };
        this.seen = {}; this.raw = {};
        this.yawV = new Vote(60); this.latV = new Vote(60); this.lonV = new Vote(40);
        this.wheelK = null; this.kList = []; this.lastSpeed = null; this.lastSpeedT = 0;
        this.lastFix = null; this.active = false;
        this.subscribe();
    }
    rawLog(k, v) { const n = this.raw[k] = (this.raw[k] || 0) + 1; if (n <= 5) this.log.info('raw ' + k + ': ' + JSON.stringify(v).slice(0, 300)); }
    put(k, x) {
        this.v[k] = x; this.seen[k] = Date.now(); this.learn(k);
        // signals of one moment arrive as several callbacks: one sample for all of them
        if (!this.pendingEmit) { this.pendingEmit = true; setImmediate(() => { this.pendingEmit = false; this.emit(); }); }
    }
    fresh(k, ms) { return Date.now() - (this.seen[k] || 0) < (ms || 400); }
    subscribe() {
        const sig = this.ctx.signals, log = this.log;
        const steer = (v) => {
            this.rawLog('steer', v);
            let r = asNum(v && v.actualValueSteeringAngleDriver);
            if (r === null) r = numberIn(v, /angle|winkel/i);
            if (r === null || r === 32767 || r === 65535) return;
            if (r > 32767) r -= 65536; const a = r * 0.04395; if (Math.abs(a) < 900) this.put('steer', a);
        };
        const W = [
            ['de.bmw.infotainment.vehicle.CDS2', {
                statusLateralAccelerationMassCenter: (v) => { this.rawLog('lat', v); let r = asNum(v && v.lateralAccelerationCentreOfGravity); if (r === null) r = numberIn(v, /lateral/i); if (r !== null && r !== 65535) { const a = r * 0.002 - 65; if (Math.abs(a) <= 65) this.put('ay', a); } },
                statusLongitudinalAccelerationMassCenter: (v) => { this.rawLog('long', v); let r = asNum(v && v.longitudinalAccelerationCentreOfGravity); if (r === null) r = numberIn(v, /longitud/i); if (r !== null && r !== 65535) { const a = r * 0.002 - 65; if (Math.abs(a) <= 65) this.put('ax', a); } },
                statusYawVelocityVehicle: (v) => { this.rawLog('yaw', v); let r = asNum(v && v.yawVelocityVehicle); if (r === null) r = numberIn(v, /yaw|gier|velocity/i); if (r !== null && r !== 65535) { const y = r * 0.005 - 163.84; if (Math.abs(y) <= 163.84) this.put('yaw', y); /* the range ends at +-163.84 deg/s: a clipped value is kept */ } },
            }],
            ['de.bmw.chassis.SteeringAngle', {
                ActualSteeringAngleDriver: steer,
                actualSteeringAngleDriverNoCRC: steer,
            }],
            ['de.bmw.powertrain.Powertrain', {
                ActualValueRPMWheel: (v) => { this.rawLog('wheels', v); const w = wheelsIn(v); if (w && w.every((x) => num(x) && x < 65000)) this.put('wheelsRaw', w); },
            }],
            ['de.bmw.infotainment.vehicle.Vehicle2', {
                statusVehiclePartType: (v) => { this.rawLog('vehicleType', v); const t = vehicleTypeOf(v); if (t && this.onVehicle) this.onVehicle(t); },
                statusCarSpeed2: (v) => { this.rawLog('speed', v); let r = asNum(v && v.speedVehicleCentreOfGravity); if (r === null) r = numberIn(v, /speed|geschw/i); if (r !== null && r !== 65535 && r >= 0) { const kmh = r * 0.015625; if (kmh >= 0 && kmh < 400) this.put('speed', kmh / 3.6); } },
            }],
        ];
        W.forEach(([iface, h]) => sig.watch(iface, '1', h, log)
            .then((s) => log.info('signals ' + iface.split('.').pop() + ': ' + (s.error ? 'error ' + s.error : 'subscribed')))
            .catch((e) => log.warn('signals ' + iface + ': ' + e)));
        // GNSS, experimental: polled, read-only attributes
        const gnss = (name) => (v) => { this.rawLog(name, v); this.gnss(positionsIn(v)); };
        sig.watch('de.bmw.infotainment.SatellitePositioning', '1', { basicPearlChain: gnss('pearl') }, log, { pollMs: 250 })
            .then((s) => log.info('gnss pearl chain: ' + (s.error ? 'error ' + s.error : 'polled'))).catch(() => {});
        sig.watch('de.bmw.infotainment.navigation.positioning.Positioning', 'Main_Instance', { currentLocation: gnss('location') }, log, { pollMs: 250 })
            .then((s) => log.info('gnss location: ' + (s.error ? 'error ' + s.error : 'polled'))).catch(() => {});
    }
    /** sign and scale learning */
    learn(k) {
        const v = this.v, sp = v.speed;
        if (k === 'yaw' && this.fresh('speed', 500) && sp > 6 && this.fresh('steer') && Math.abs(v.steer) > 25 && Math.abs(v.steer) < 200 && Math.abs(v.ay) < 4) this.yawV.add(Math.sign(v.steer) * Math.sign(v.yaw));
        if (k === 'ay' && this.fresh('speed', 500) && sp > 6 && this.yawV.sign && Math.abs(v.yaw) > 6 && Math.abs(v.ay) > 1.5) this.latV.add(Math.sign(v.ay) * Math.sign(v.yaw * this.yawV.sign));
        if (k === 'speed') {
            const t = Date.now();
            // the speed's slope over at least 150 ms (the reference stays put until then)
            if (this.lastSpeed === null || t - this.lastSpeedT > 1000) { this.lastSpeed = sp; this.lastSpeedT = t; }
            else if (t - this.lastSpeedT >= 150) {
                const dv = (sp - this.lastSpeed) / ((t - this.lastSpeedT) / 1000);
                if (Math.abs(dv) > 1.0 && Math.abs(v.ax) > 0.8) this.lonV.add(Math.sign(dv) * Math.sign(v.ax));
                this.lastSpeed = sp; this.lastSpeedT = t;
            }
        }
        if (k === 'wheelsRaw' && this.fresh('speed', 500) && sp > 8 && Math.abs(v.steer) < 6 && Math.abs(v.yaw) < 1.5 && Math.abs(v.ax) < 1.5) {
            const f = (v.wheelsRaw[0] + v.wheelsRaw[1]) / 2;
            if (f > 0) { this.kList.push(sp / f); if (this.kList.length > 101) this.kList.shift(); }
            if (this.kList.length >= 41) { const s = this.kList.slice().sort((a, b) => a - b); const k2 = s[s.length >> 1]; if (!this.wheelK || Math.abs(k2 - this.wheelK) / this.wheelK > 0.01) { this.wheelK = k2; this.log.info('learned wheel scale ' + k2.toPrecision(5) + ' m/s per unit'); } }
        }
        if (this.yawV.sign && !this.yawLogged) { this.yawLogged = 1; this.log.info('learned yaw sign ' + this.yawV.sign); }
        if (this.latV.sign && !this.latLogged) { this.latLogged = 1; this.log.info('learned lateral sign ' + this.latV.sign); }
        if (this.lonV.sign && !this.lonLogged) { this.lonLogged = 1; this.log.info('learned longitudinal sign ' + this.lonV.sign); }
    }
    // ready immediately: BMW iDrive 7 uses standard CAN/SOME/IP signs (+1); wheel scale and
    // sign checks still run silently in the background without holding back scoring or display
    get ready() { return true; }
    emit() {
        if (!this.active) return;
        const v = this.v, R = this.spec.wheel.r;
        const ys = this.yawV.sign || 1, ls = this.latV.sign || 1, gs = this.lonV.sign || 1;
        let wheel;
        if (this.wheelK && v.wheelsRaw && this.fresh('wheelsRaw', 300)) wheel = v.wheelsRaw.map((x) => x * this.wheelK / R);
        else { const w = v.speed / R; wheel = [w, w, w, w]; }
        const hr = process.hrtime();
        this.onSample({ t: hr[0] + hr[1] / 1e9, ax: v.ax * gs, ay: v.ay * ls, yawRate: v.yaw * ys * D2R, steerWheel: v.steer, wheel, speed: v.speed, brake: 0, ready: this.ready });
    }
    gnss(pts) {
        if (pts.length < 1) return;
        const p = pts[pts.length - 1], t = Date.now();
        const prev = this.lastFix;
        if (prev && (p.lat !== prev.lat || p.lon !== prev.lon)) {
            const R = 6371000, la = p.lat * D2R, dLat = (p.lat - prev.lat) * D2R, dLon = (p.lon - prev.lon) * D2R * Math.cos(la);
            const dist = Math.hypot(dLat, dLon) * R, dt = Math.max((p.t && prev.t ? (p.t - prev.t) / 1000 : (t - prev.at) / 1000), 0.05);
            if (dist > 0.8 && dt < 2) {
                // east = x, north = y: the course as a maths angle, counter-clockwise from east (the yaw's sense)
                // its age: from its own time stamp when that is a clock time near ours, else half the poll interval
                const own = p.t && p.t > 1e12 ? (t - p.t) / 1000 : -1;
                this.onFix({ course: Math.atan2(dLat, dLon), speed: dist / dt, age: own >= 0 && own < 1.5 ? own : 0.125 });
            }
        }
        if (!prev || p.lat !== prev.lat || p.lon !== prev.lon) this.lastFix = { lat: p.lat, lon: p.lon, t: p.t, at: t };
    }
}

module.exports = { Live, numberIn, wheelsIn, positionsIn, vehicleTypeOf };
