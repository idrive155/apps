'use strict';
/**
 * vitals.js - Live Data / M Vitals style engine numbers from SOME/IP (read-only).
 *
 * Scaling matches idrive7-apps kit / Live Data (CDS temps, FES boost, gear, rpm).
 * Gearbox oil from BasicDataSet when the car fills it; otherwise stays null.
 */
const { numberIn } = require('./live');

const META = /^(qualifier|status|valid|crc|alive|counter)/i;
const asNum = (v) => (typeof v === 'number' && isFinite(v) ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : null);

function gearText(v) {
    if (!v || typeof v !== 'object') return null;
    const st = v.statusActualStageDrive, g = v.statusActualGearDrive;
    const stage = { P: 'P', R: 'R', N: 'N', D: 'D', 1: 'P', 2: 'R', 3: 'N', 4: 'D' }[st];
    const gear = typeof g === 'number' ? (g >= 3 && g <= 12 ? g - 2 : null)
        : /^G\d+$/.test(String(g)) ? Number(String(g).slice(1)) : null;
    if (!stage) return null;
    return stage + (stage === 'D' && gear ? String(gear) : '');
}

/** pick gearbox oil °C from BasicDataSet (field names vary by software) */
function gearboxOilOf(v) {
    if (!v || typeof v !== 'object') return null;
    let found = null;
    const walk = (o, d) => {
        if (!o || typeof o !== 'object' || d > 5 || found !== null) return;
        for (const k of Object.keys(o)) {
            if (META.test(k)) continue;
            const n = k.toLowerCase(), x = o[k], nx = asNum(x);
            if (nx !== null && /getriebe|gearbox|transmission/.test(n) && /temp|oel|oil/.test(n)) {
                const c = nx > 200 ? nx - 48 : nx - (nx > 80 ? 0 : 48);
                if (c > -20 && c < 160) { found = c; return; }
            }
            if (x && typeof x === 'object') walk(x, d + 1);
        }
    };
    walk(v, 0);
    if (found !== null) return found;
    const raw = numberIn(v, /temp|oel|oil|getriebe/i);
    if (raw === null || raw === 255 || raw === 65535) return null;
    const c = raw - 48;
    return (c > -20 && c < 160) ? c : null;
}

function boostOf(v) {
    let r = asNum(v && v.displayBoostPressure);
    if (r === null) r = numberIn(v, /boost/i);
    if (r === null || r === 255 || r === 65535) return null;
    // Live Data: 0.01 bar per bit (car unit may differ; treat as bar gauge pressure)
    const bar = r * 0.01;
    return (bar >= 0 && bar < 5) ? bar : null;
}

class Vitals {
    constructor(ctx, log) {
        this.ctx = ctx; this.log = log;
        this.v = {
            rpm: null, coolant: null, oil: null, gearbox: null, boost: null,
            gear: null, torque: null, powerPct: null, ambient: null, seen: {},
        };
        this.subscribe();
    }
    touch(k) { this.v.seen[k] = Date.now(); }
    fresh(k, ms) { return Date.now() - (this.v.seen[k] || 0) < (ms || 3000); }
    put(k, x) { this.v[k] = x; this.touch(k); }
    snapshot() {
        const v = this.v, f = (k, ms) => (this.fresh(k, ms) ? v[k] : null);
        return {
            rpm: f('rpm', 800), coolant: f('coolant', 5000), oil: f('oil', 5000),
            gearbox: f('gearbox', 8000), boost: f('boost', 800), gear: f('gear', 2000),
            torque: f('torque', 800), powerPct: f('powerPct', 800), ambient: f('ambient', 30000),
        };
    }
    /** demo / local: inject plausible numbers */
    setDemo(s) { Object.keys(s || {}).forEach((k) => { if (s[k] !== undefined) this.put(k, s[k]); }); }
    subscribe() {
        const sig = this.ctx.signals, log = this.log, self = this;
        const W = [
            ['de.bmw.infotainment.vehicle.CDS', {
                statusEngineSpeed2: (v) => {
                    let r = asNum(v && v.actualValueRPMEngineCrankshaft);
                    if (r === null) r = numberIn(v, /rpm|speed|engine/i);
                    if (r !== null && r !== 65535) { const rpm = r * 0.25; if (rpm >= 0 && rpm < 12000) self.put('rpm', rpm); }
                },
                statusEngineTemperature: (v) => {
                    let c = asNum(v && v.temperatureEngineDrive);
                    if (c === null) c = numberIn(v, /engine|coolant|drive/i);
                    if (c !== null && c !== 255) { const t = c - 48; if (t > -40 && t < 160) self.put('coolant', t); }
                    let o = asNum(v && v.temperatureEngineOilDrive);
                    if (o === null) o = numberIn(v, /oil/i);
                    if (o !== null && o !== 255) { const t = o - 48; if (t > -40 && t < 160) self.put('oil', t); }
                },
            }],
            ['de.bmw.infotainment.drivingexcitement.FES', {
                statusSwitchDriveDynamicSport2: (v) => {
                    const b = boostOf(v); if (b !== null) self.put('boost', b);
                },
                statusVehicleDynamicEngine: (v) => {
                    let p = asNum(v && v.displaySportEnginePower);
                    if (p === null) p = numberIn(v, /power/i);
                    if (p !== null && p !== 255 && p >= 0 && p <= 100) self.put('powerPct', p);
                },
                statusActualValueTorque2: (v) => {
                    let r = asNum(v && v.actualValueTorqueCrankshaft);
                    if (r === null) r = numberIn(v, /torque/i);
                    if (r !== null && r < 4095) self.put('torque', r * 0.5 - 1023.5);
                },
            }],
            ['de.bmw.infrastructure.VehicleInformation', {
                statusGearboxDrive: (v) => { const g = gearText(v); if (g) self.put('gear', g); },
                DataPowerTrain2: (v) => {
                    if (self.fresh('gear', 1500)) return;
                    const x = v && v.statusGearSelectionDrive;
                    const n = typeof x === 'number' ? x : { N: 1, R: 2, P: 3, NP: 4 }[x] || (/^_\d$/.test(String(x)) ? 4 + Number(String(x).slice(1)) : 0);
                    if (n === 1) self.put('gear', 'N');
                    else if (n === 2) self.put('gear', 'R');
                    else if (n === 3) self.put('gear', 'P');
                    else if (n >= 5 && n <= 13) self.put('gear', 'D' + (n - 4));
                },
            }],
            ['de.bmw.infrastructure.analytics.BasicDataSet', {
                basicDataSet: (v) => { const t = gearboxOilOf(v); if (t !== null) self.put('gearbox', t); },
            }],
            ['de.bmw.infrastructure.EnvironmentalInformation', {
                ExteriorTemperature: (v) => {
                    let r = asNum(v && v.temperatureExterior);
                    if (r === null) r = numberIn(v, /temp|exterior|outside/i);
                    if (r !== null && r !== 255) { const t = r * 0.5 - 40; if (t > -50 && t < 80) self.put('ambient', t); }
                },
            }],
        ];
        W.forEach(([iface, h]) => {
            sig.watch(iface, '1', h, log)
                .then((s) => log.info('vitals ' + iface.split('.').pop() + ': ' + (s.error ? 'error ' + s.error : 'subscribed')))
                .catch((e) => log.warn('vitals ' + iface + ': ' + e));
        });
    }
}

module.exports = { Vitals, gearText, gearboxOilOf, boostOf };
