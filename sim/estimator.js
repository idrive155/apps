'use strict';
/**
 * estimator.js - the drift angle from the signals a car actually has.
 *
 * No production car measures its side-slip directly: nothing senses the sideways velocity vy,
 * and the drift angle is beta = -atan(vy / vx). BMW's own M Drift Analyser adds no sensors
 * either. Two ways are known to recover it, and this filter uses both:
 *
 *  A. front-wheel kinematics: on a rear-driven car the front wheels roll without slipping, so
 *     each front wheel's speed is the velocity of its hub along the wheel,
 *        w R = (vx - r t) cos(delta) + (vy + a r) sin(delta)
 *     With counter-steer delta is large, so vy is observable from wheel speed and steering.
 *  B. GPS course over ground against the heading (Racelogic DriftBox's method): the direction of
 *     travel from the GNSS receiver minus the body heading (integrated yaw rate) is the drift
 *     angle. Gyro drift is the classic weakness; here the gyro bias is a filter state, pinned
 *     whenever the car runs straight.
 *
 * Extended Kalman filter, x = [vx, vy, bay, psi, br]:
 *   dvx/dt = ax + r vy,   dvy/dt = ay - bay - r vx,   dpsi/dt = r,   r = r_meas - br
 *   bay: lateral accelerometer bias (camber, body roll, offset);  br: yaw-rate gyro bias
 * Measurements: front wheel speeds (A), GPS course and speed with latency compensation (B),
 * the linear bicycle model while plainly gripping, and "straight and steady" (vy = 0, ay = bias,
 * r = bias). Outliers (a locked or spinning wheel, a GPS jump) are gated at 4 sigma.
 *
 * tools/test_estimator.js checks it against the demo driver with noisy, biased, delayed signals.
 */
const N = 5;

class DriftEstimator {
    constructor(spec, opt) {
        opt = opt || {};
        this.a = spec.WB * (opt.frontShare || 0.5); this.b = spec.WB - this.a;
        this.R = spec.wheel.r; this.tf = spec.wheel.trackF / 2;
        this.awd = !!opt.awd;
        this.gpsLag = opt.gpsLag !== undefined ? opt.gpsLag : 0.10;   // s
        this.x = new Float64Array(N); this.P = new Float64Array(N * N);
        this.Q = new Float64Array([0.5, 0.35, 0.0004, 1e-6, 1e-8]);   // per second
        this.Pn = new Float64Array(N * N); this.F = new Float64Array(N * N); this.T = new Float64Array(N * N);
        this.PH = new Float64Array(N); this.K = new Float64Array(N); this.H = new Float64Array(N);
        // history for delayed GPS: time, psi, vx, vy
        this.hist = new Float64Array(128 * 4); this.hn = 0; this.t = 0;
        this.beta = 0; this.ok = false; this.gpsSeen = -1e9; this.quality = 0; this.rejects = 0;
    }
    reset(v) {
        this.x.fill(0); this.x[0] = v || 0;
        this.P.fill(0); this.P[0] = 1; this.P[6] = 1; this.P[12] = 0.05; this.P[18] = 10; this.P[24] = 1e-4;
    }

    /**
     * s: { ax, ay, yawRate (rad/s), steer (road wheels, rad), wheel: [fl, fr, rl, rr] (rad/s) }
     * gps (optional, when a fix arrives): { course (rad, + = to the left of x... i.e. same sense as yaw), speed (m/s), age (s) }
     */
    update(s, dt, gps) {
        const x = this.x, P = this.P;
        this.t += dt;
        if (!this.ok) { this.reset(((s.wheel[0] + s.wheel[1]) / 2) * this.R); this.ok = true; if (gps) x[3] = gps.course; }
        // ---- predict ----
        const vx = x[0], vy = x[1], r = s.yawRate - x[4];
        x[0] = vx + (s.ax + r * vy) * dt;
        x[1] = vy + (s.ay - x[2] - r * vx) * dt;
        x[3] += r * dt;
        const F = this.F; F.fill(0);
        for (let i = 0; i < N; i++) F[i * N + i] = 1;
        F[0 * N + 1] = r * dt; F[0 * N + 4] = -vy * dt;
        F[1 * N + 0] = -r * dt; F[1 * N + 2] = -dt; F[1 * N + 4] = vx * dt;
        F[3 * N + 4] = -dt;
        // P = F P F^T + Q dt
        const T = this.T, Pn = this.Pn;
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { let acc = 0; for (let k = 0; k < N; k++) acc += F[i * N + k] * P[k * N + j]; T[i * N + j] = acc; }
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { let acc = 0; for (let k = 0; k < N; k++) acc += T[i * N + k] * F[j * N + k]; Pn[i * N + j] = acc; }
        for (let i = 0; i < N; i++) Pn[i * N + i] += this.Q[i] * dt;
        // the yaw-rate signal saturates at +-163.84 deg/s: past that the true rate is unknown, so the
        // integration is not trusted (the wheels pull the state back)
        if (Math.abs(s.yawRate) > 2.80) { const k = (Math.abs(s.yawRate) - 2.6) * 40 * dt; Pn[0] += k; Pn[6] += 4 * k; Pn[18] += 0.05 * k; }
        P.set(Pn);

        const H = this.H;
        const rr = s.yawRate - x[4];
        // ---- A. front wheels ----
        const d = s.steer, cd = Math.cos(d), sd = Math.sin(d);
        for (let i = 0; i < 2; i++) {
            const t = i === 0 ? this.tf : -this.tf;
            const z = s.wheel[i] * this.R;
            const h = (x[0] - rr * t) * cd + (x[1] + this.a * rr) * sd;
            let rv = 0.05 + 0.015 * Math.abs(z);
            if (s.ax < -4) rv *= 5;                 // hard braking: fronts may lock
            if (this.awd) rv *= s.ax > 0.5 ? 12 : 3; // AWD under power: fronts spin
            H.fill(0); H[0] = cd; H[1] = sd; H[4] = t * cd - this.a * sd;
            if (this._upd(z - h, rv * rv)) this.rejects = 0;
            else if (++this.rejects > 30) {
                // the wheels have disagreed for a while: the state, not the wheels, is off. Widen its
                // uncertainty so the measurements pull it back (a missed transient, a bad start)
                P[0] += 1; P[6] += 4; this.rejects = 0;
            }
        }
        // ---- B. GPS course and speed (DriftBox method), against the state when the fix was taken ----
        this._push();
        if (gps && gps.speed > 3 && (!this.gpsInit || this.t - this.gpsSeen > 5)) {
            // first fix (or after a gap): the heading state is put on the GPS course, the history with it
            const psi = gps.course - Math.atan2(x[1], Math.max(x[0], 0.5)), d = psi - x[3];
            x[3] = psi;
            for (let k = 0; k < 128; k++) this.hist[k * 4 + 1] += d;
            for (let k = 0; k < N; k++) { P[3 * N + k] = 0; P[k * N + 3] = 0; }
            P[3 * N + 3] = 0.01;
            this.gpsInit = true; this.gpsSeen = this.t;
            gps = null;
        }
        if (gps && gps.speed > 3) {
            const lag = this.gpsLag + (gps.age || 0);
            const old = this._at(this.t - lag);
            const V2 = x[0] * x[0] + x[1] * x[1], V = Math.sqrt(V2);
            const hC = old[0] + Math.atan2(old[2], old[1]);
            let inn = gps.course - hC; inn = Math.atan2(Math.sin(inn), Math.cos(inn));
            const sc = (gps.sigmaV || 0.12) / gps.speed;  // course noise grows as speed falls
            H.fill(0); H[0] = -x[1] / V2; H[1] = x[0] / V2; H[3] = 1;
            this._upd(inn, sc * sc + 1e-5);
            const hV = Math.hypot(old[1], old[2]);
            H.fill(0); H[0] = x[0] / V; H[1] = x[1] / V;
            this._upd(gps.speed - hV, (gps.sigmaV || 0.12) ** 2);
            this.gpsSeen = this.t;
        }
        // ---- bicycle model while gripping ----
        const v = Math.max(x[0], 0.5), L = this.a + this.b;
        const rModel = v * d / (L + 0.0025 * v * v);
        if (v > 2 && Math.abs(s.ay) < 4.5 && Math.abs(rr - rModel) < 0.05 + 0.08 * Math.abs(rModel)) {
            // rear axle slip small, proportional to lateral load: vy - b r = -kr ay vx
            H.fill(0); H[1] = 1; H[4] = this.b;
            this._upd(this.b * rr - 0.0053 * s.ay * v - x[1], 0.5 * 0.5);
        }
        // ---- straight and steady: no slip, no lateral load, no yaw ----
        const wl = s.wheel[0], wr = s.wheel[1];
        if (v > 3 && Math.abs(d) < 0.03 && Math.abs(s.yawRate) < 0.04 && Math.abs(wl - wr) * this.R < 0.04 * v) {
            H.fill(0); H[1] = 1; this._upd(-x[1], 0.08 * 0.08);
            H.fill(0); H[2] = 1; this._upd(s.ay - x[2], 0.3 * 0.3);
            // the wheels say how fast the car turns: (wl - wr) R / track
            const rWheel = (wl - wr) * this.R / (2 * this.tf);
            H.fill(0); H[4] = 1; this._upd((s.yawRate - rWheel) - x[4], 0.01 * 0.01);
        }
        // ---- standstill: parked car cannot drift sideways; pin vx, vy and sensor biases ----
        const vWheel = (Math.abs(wl) + Math.abs(wr)) * 0.5 * this.R;
        if (vWheel < 0.3 && Math.abs(s.yawRate) < 0.05 && Math.hypot(x[0], x[1]) < 2.0) {
            H.fill(0); H[0] = 1; this._upd(-x[0], 0.05 * 0.05);
            H.fill(0); H[1] = 1; this._upd(-x[1], 0.05 * 0.05);
            H.fill(0); H[2] = 1; this._upd(s.ay - x[2], 0.3 * 0.3);
            H.fill(0); H[4] = 1; this._upd(s.yawRate - x[4], 0.01 * 0.01);
        }
        this.beta = Math.hypot(x[0], x[1]) > 1.5 ? -Math.atan2(x[1], x[0]) : 0;
        this.vx = x[0]; this.vy = x[1];
        // quality 0..1: angle uncertainty (from the covariance) against 5 deg
        const sb = Math.sqrt(Math.max(P[6], 0)) / Math.max(x[0], 1);
        this.sigma = sb * 180 / Math.PI;
        this.quality = Math.max(0, Math.min(1, 1 - this.sigma / 5));
        return this;
    }
    _push() {
        const i = (this.hn++ % 128) * 4, h = this.hist;
        h[i] = this.t; h[i + 1] = this.x[3]; h[i + 2] = this.x[0]; h[i + 3] = this.x[1];
    }
    /** state [psi, vx, vy] at time t (nearest stored) */
    _at(t) {
        const h = this.hist, n = Math.min(this.hn, 128);
        let best = (this.hn - 1) % 128, bd = 1e9;
        for (let k = 0; k < n; k++) { const d = Math.abs(h[k * 4] - t); if (d < bd) { bd = d; best = k; } }
        const o = this._o || (this._o = [0, 0, 0]);
        o[0] = h[best * 4 + 1]; o[1] = h[best * 4 + 2]; o[2] = h[best * 4 + 3];
        return o;
    }
    /** scalar update with row this.H */
    _upd(innov, rv) {
        const P = this.P, x = this.x, H = this.H, PH = this.PH, K = this.K;
        let S = rv;
        for (let i = 0; i < N; i++) { let acc = 0; for (let k = 0; k < N; k++) acc += P[i * N + k] * H[k]; PH[i] = acc; }
        for (let i = 0; i < N; i++) S += H[i] * PH[i];
        if (innov * innov > 16 * S) return false;   // 4 sigma gate
        for (let i = 0; i < N; i++) { K[i] = PH[i] / S; x[i] += K[i] * innov; }
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) P[i * N + j] -= K[i] * PH[j];
        return true;
    }
}

module.exports = { DriftEstimator };
