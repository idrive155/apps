'use strict';
/**
 * score.js - drift scoring: Sideways chains plus an M Drift Analyser-style star rating.
 *
 * Chain scoring (game layer):
 * - Drifting while |angle| >= 10 deg above 20 km/h. Points from angle x speed, steadiness weighted.
 * - Chains link through transitions and short grip (1.4 s grace). Multiplier to x6.
 * - Skills: TRANSITION, BIG ANGLE, SPEED DRIFT, LONG DRIFT, SMOOTH, FULL LOCK.
 * - Bank = points x multiplier; spin (>110°) or stop loses the chain.
 *
 * M Analyser layer (per banked drift):
 * - Star rating 0.5..5.0 from duration, distance and average angle (angle weighs most).
 * - Last / best drift keep those three numbers + stars.
 * - Session "performance" is the integral of |beta| over every drifted second (deg·s).
 */

const RATINGS = [
    [0, 'NICE'], [800, 'GREAT'], [2500, 'AWESOME'], [6000, 'INSANE'], [12000, 'LEGENDARY'], [25000, 'GODLIKE'],
];
function ratingOf(p) { let r = RATINGS[0][1]; for (const [t, n] of RATINGS) if (p >= t) r = n; return r; }
function tierOf(p) { let r = 0; RATINGS.forEach(([t], i) => { if (p >= t) r = i; }); return r; }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * Factory-style stars from duration (s), distance (m) and average angle (deg).
 * Half-star steps; angle dominates, matching BMW's published emphasis.
 */
function starsOf(duration, distance, avgAngle) {
    const a = clamp((avgAngle - 8) / 32, 0, 1);
    const t = clamp((duration - 1.0) / 10, 0, 1);
    const d = clamp((distance - 15) / 180, 0, 1);
    // small bonus when all three are strong together (the "magic dust")
    const blend = a * t * d;
    const raw = 0.48 * a + 0.26 * t + 0.20 * d + 0.06 * blend;
    const stars = Math.round((0.5 + raw * 4.5) * 2) / 2;
    return clamp(stars, 0.5, 5);
}

function emptyDrift() {
    return { pts: 0, stars: 0, rating: '', tier: 0, time: 0, distance: 0, avgAngle: 0, maxAngle: 0, mult: 1, t: 0 };
}

class Score {
    constructor() { this.reset(); }
    reset() {
        this.total = 0; this.best = 0; this.chain = 0; this.mult = 1; this.active = false; this.drifting = false;
        this.grace = 0; this.driftTime = 0; this.chainTime = 0; this.multClock = 0; this.longClock = 0;
        this.bigClock = 0; this.smoothClock = 0; this.csClock = 0; this.events = []; this.t = 0;
        this.chains = 0; this.longest = 0; this.maxAngle = 0; this.angleSum = 0; this.angleTime = 0;
        this.last = null; this.rate = 0; this.speedClock = 0; this.chainMax = 0; this.spinClock = 0; this.sideDrift = 0;
        // per-chain M metrics
        this.chainDist = 0; this.chainAngSum = 0; this.chainAngTime = 0;
        // session: integral of |beta| while drifting (deg·s), and best star drift
        this.performance = 0; this.bestStars = 0;
        this.lastDrift = emptyDrift(); this.bestDrift = emptyDrift();
        this.sessionDrifts = 0;
    }
    _ev(kind, text, pts, extra) { const e = Object.assign({ kind, text, pts: pts | 0, t: this.t }, extra || {}); this.events.push(e); if (this.events.length > 24) this.events.shift(); return e; }
    _mult(add, why) { const m = Math.min(6, this.mult + add); if (m > this.mult) { this.mult = m; this._ev('mult', why, 0); } }
    get chainAvgAngle() { return this.chainAngTime ? this.chainAngSum / this.chainAngTime : 0; }
    update(m, dt) {
        this.t += dt;
        const ang = Math.abs(m.beta), kmh = m.kmh;
        const drifting = ang >= 10 && kmh >= 20 && ang < 110;
        this.drifting = drifting;
        this.spinClock = ang >= 110 ? this.spinClock + dt : 0;
        if (this.active && (this.spinClock >= 0.2 || (kmh < 8 && this.grace > 0.3))) {
            this._ev('lost', this.spinClock >= 0.2 ? 'SPUN OUT' : 'CHAIN LOST', -this.chain);
            this.active = false; this.chain = 0; this.mult = 1; this.chainTime = 0; this.rate = 0;
            this.chainDist = 0; this.chainAngSum = 0; this.chainAngTime = 0;
            return this;
        }
        if (drifting) {
            if (!this.active) {
                this.active = true; this.chain = 0; this.mult = 1; this.chainTime = 0;
                this.multClock = 0; this.longClock = 0; this.chainMax = 0; this.chains++;
                this.chainDist = 0; this.chainAngSum = 0; this.chainAngTime = 0;
            }
            this.grace = 0; this.sideDrift += dt;
            this.driftTime += dt; this.chainTime += dt; this.multClock += dt; this.longClock += dt;
            this.maxAngle = Math.max(this.maxAngle, ang); this.chainMax = Math.max(this.chainMax || 0, ang);
            this.angleSum += ang * dt; this.angleTime += dt;
            this.chainAngSum += ang * dt; this.chainAngTime += dt;
            this.chainDist += (kmh / 3.6) * dt;
            this.performance += ang * dt;
            const steady = 0.7 + 0.3 * m.stability;
            this.rate = Math.min(ang, 75) * Math.max(kmh, 20) * 0.032 * steady;
            this.chain += this.rate * dt;
            if (this.multClock >= 2.5) { this.multClock = 0; this._mult(0.5, 'CHAIN x' + Math.min(6, this.mult + 0.5).toFixed(1)); }
            if (this.longClock >= 6) { this.longClock = 0; this.chain += 150; this._ev('skill', 'LONG DRIFT', 150); }
            if (ang > 50) { this.bigClock += dt; if (this.bigClock >= 1 && this.bigClock - dt < 1) { this.chain += 200; this._ev('skill', 'BIG ANGLE', 200); } } else this.bigClock = 0;
            if (kmh > 80) { this.speedClock = (this.speedClock || 0) + dt; if (this.speedClock >= 1 && this.speedClock - dt < 1) { this.chain += 250; this._ev('skill', 'SPEED DRIFT', 250); } } else this.speedClock = 0;
            if (m.stability > 0.85 && ang > 25) { this.smoothClock += dt; if (this.smoothClock >= 3) { this.smoothClock = 0; this.chain += 100; this._ev('skill', 'SMOOTH', 100); } } else this.smoothClock = 0;
            if (m.cs > 25) { this.csClock += dt; if (this.csClock >= 1.5 && this.csClock - dt < 1.5) { this.chain += 120; this._ev('skill', 'FULL LOCK', 120); } } else this.csClock = 0;
        } else {
            this.rate = 0;
            if (this.active) {
                this.grace += dt;
                if (this.grace > 1.4) this.bank();
            }
        }
        const paid = m.transition && this.active && this.sideDrift >= 0.5;
        if (m.transition) this.sideDrift = 0;
        if (paid) {
            const p = Math.round(40 + Math.min(m.flick, 300) * 0.6);
            this.chain += p; this._ev('skill', m.flick > 160 ? 'FLICK!' : 'TRANSITION', p);
            this._mult(0.5, 'CHAIN x' + Math.min(6, this.mult + 0.5).toFixed(1));
        }
        return this;
    }
    bank() {
        const pts = Math.round(this.chain * this.mult);
        const time = this.chainTime;
        const distance = this.chainDist;
        const avgAngle = this.chainAvgAngle;
        const maxAngle = this.chainMax || 0;
        const stars = starsOf(time, distance, avgAngle);
        const rating = ratingOf(pts);
        const tier = tierOf(pts);
        this.total += pts; this.best = Math.max(this.best, pts); this.longest = Math.max(this.longest, time);
        this.sessionDrifts++;
        const drift = { pts, stars, rating, tier, time, distance, avgAngle, maxAngle, mult: this.mult, t: this.t };
        this.last = drift; this.lastDrift = drift;
        if (stars > this.bestStars || (stars === this.bestStars && pts >= (this.bestDrift.pts || 0))) {
            this.bestStars = stars; this.bestDrift = Object.assign({}, drift);
        }
        this._ev('bank', rating + ' DRIFT', pts, {
            tier, mult: this.mult, time, maxAngle, distance, avgAngle, stars,
        });
        this.active = false; this.chain = 0; this.mult = 1; this.chainTime = 0; this.grace = 0;
        this.chainDist = 0; this.chainAngSum = 0; this.chainAngTime = 0;
    }
    /** session average angle while drifting */
    get avgAngle() { return this.angleTime ? this.angleSum / this.angleTime : 0; }
}

module.exports = { Score, ratingOf, tierOf, RATINGS, starsOf, emptyDrift };
