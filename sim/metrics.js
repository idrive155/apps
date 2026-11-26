'use strict';
/**
 * metrics.js - every angle of a drift, from the car's motion.
 *
 * Input (body frame, SI): vx, vy (m/s; y to the left), yawRate (rad/s, + = turning left),
 * ax, ay (m/s^2), steer (road-wheel angle, rad, + = left), speed.
 *
 *   drift angle  beta      the body against its direction of travel, + = nose left of the travel
 *   counter-steer          how far the front wheels point out of the turn (deg, road wheels)
 *   axle slip angles       front and rear: the tyres against their own travel (bicycle model)
 *   yaw rate, lateral and longitudinal G
 *   transition rate        how fast the angle swings from one side to the other (deg/s)
 *   stability              how steady the angle is held (0..1, from its wobble over ~1 s)
 */
const R2D = 180 / Math.PI;

class Metrics {
    constructor(spec) {
        this.a = spec.WB / 2; this.b = spec.WB / 2;
        this.beta = 0; this.betaRate = 0; this.wobble = 0; this.stability = 1;
        this.flick = 0; this.flickPeak = 0; this.side = 0; this.transition = false;
        this.yawRate = 0; this.latG = 0; this.lonG = 0; this.cs = 0; this.af = 0; this.ar = 0; this.kmh = 0;
        this.peakAngle = 0;
    }
    update(s, dt) {
        const vx = Math.max(Math.abs(s.vx), 0.5) * Math.sign(s.vx || 1), vy = s.vy;
        let beta = s.speed > 1 ? -Math.atan2(vy, Math.abs(vx)) * R2D : 0;
        // kill sub-2° noise so the HUD and score stay quiet on a straight road
        if (Math.abs(beta) < 2) beta = 0;
        const rate = (beta - this.beta) / dt;
        this.betaRate += (rate - this.betaRate) * Math.min(1, dt * 12);
        this.beta = beta;
        // wobble: high-passed angle rate while on one side (transitions are not wobble)
        const sd = Math.abs(beta) > 6 ? Math.sign(beta) : 0;
        this.transition = sd !== 0 && this.side !== 0 && sd !== this.side;
        if (this.transition) { this.flickPeak = this.flick; this.flickAt = 0; }
        this.flickAt = (this.flickAt || 0) + dt;
        if (sd) this.side = sd;
        const w = Math.abs(this.betaRate);
        this.wobble += ((Math.abs(beta) > 8 ? Math.min(w, 120) : 0) - this.wobble) * Math.min(1, dt * 1.5);
        this.stability = Math.max(0, Math.min(1, 1 - (this.wobble - 6) / 50));
        // flick: the swing rate while the angle crosses zero
        if (Math.abs(beta) < 15) this.flick = Math.max(this.flick * Math.exp(-dt * 2), w);
        else this.flick *= Math.exp(-dt * 2);
        this.yawRate = s.yawRate * R2D;
        this.latG = s.ay / 9.81; this.lonG = s.ax / 9.81;
        this.kmh = s.speed * 3.6;
        const d = s.steer || 0;
        this.steer = d * R2D;
        // counter-steer: wheels pointing away from the direction the car rotates into
        this.cs = beta > 3 ? Math.max(0, -d * R2D) : beta < -3 ? Math.max(0, d * R2D) : 0;
        // bicycle model slip angles (deg), sign as beta
        this.af = -(Math.atan2(vy + this.a * s.yawRate, Math.abs(vx)) - d) * R2D;
        this.ar = -Math.atan2(vy - this.b * s.yawRate, Math.abs(vx)) * R2D;
        this.peakAngle = Math.max(this.peakAngle * Math.exp(-dt * 0.25), Math.abs(beta));
        return this;
    }
}

module.exports = { Metrics, R2D };
