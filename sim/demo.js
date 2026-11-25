'use strict';
/**
 * demo.js - scripted car for local / Settings demo drive (not scored into Best drifts).
 *
 * Plays a short loop of drifts so the HUD, stars and chain can be tested without a car.
 * Body frame: +x forward, +y left; yawRate rad/s left-positive; steer road-wheel rad left-positive.
 */
const D2R = Math.PI / 180;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

/** timeline: [t0, t1, betaDeg, kmh] segments (t in seconds into the loop) */
const LOOP = [
    [0, 2.5, 0, 55],
    [2.5, 6.5, 28, 70],
    [6.5, 9.0, -32, 75],
    [9.0, 13.5, 45, 85],
    [13.5, 16.0, 55, 78],
    [16.0, 18.5, 18, 65],
    [18.5, 21.0, 0, 50],
    [21.0, 24.5, -40, 80],
    [24.5, 27.0, -22, 60],
    [27.0, 30.0, 0, 45],
];
const PERIOD = LOOP[LOOP.length - 1][1];

function sample(t) {
    const u = ((t % PERIOD) + PERIOD) % PERIOD;
    for (let i = 0; i < LOOP.length; i++) {
        const [a, b, beta, kmh] = LOOP[i];
        if (u >= a && u < b) {
            const k = smooth((u - a) / Math.max(1e-3, b - a));
            const prev = i ? LOOP[i - 1] : LOOP[LOOP.length - 1];
            return {
                beta: lerp(prev[2], beta, k) * D2R,
                speed: lerp(prev[3], kmh, k) / 3.6,
            };
        }
    }
    return { beta: 0, speed: 40 / 3.6 };
}

class DemoDriver {
    constructor(spec) {
        this.spec = spec;
        this.t = 0;
        this.x = 0; this.y = 0; this.yaw = 0;
        this.vx = 0; this.vy = 0;
        this.prevBeta = 0;
    }
    step(dt) {
        this.t += dt;
        const s = sample(this.t);
        const beta = s.beta, speed = Math.max(s.speed, 0.5);
        // body velocity from speed and slip angle (beta = -atan(vy/vx) for nose-left positive as Metrics)
        const vx = speed * Math.cos(-beta);
        const vy = speed * Math.sin(-beta);
        const betaRate = (beta - this.prevBeta) / Math.max(dt, 1e-3);
        this.prevBeta = beta;
        // yaw rate from bicycle-ish relation while drifting: roughly keep the path turning
        const L = (this.spec && this.spec.WB) || 2.8;
        const yawRate = (speed / L) * Math.sin(beta) * 1.15 + betaRate * 0.25;
        const steer = clamp(beta * 0.35 - yawRate * 0.08, -0.7, 0.7);
        const ax = (vx - this.vx) / Math.max(dt, 1e-3);
        const ay = (vy - this.vy) / Math.max(dt, 1e-3) + yawRate * vx;
        this.vx = vx; this.vy = vy;
        this.yaw += yawRate * dt;
        const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
        this.x += (cy * vx - sy * vy) * dt;
        this.y += (sy * vx + cy * vy) * dt;
        return {
            x: this.x, y: this.y, yaw: this.yaw,
            vx, vy, speed, yawRate, ax, ay, steer, brake: 0,
        };
    }
}

module.exports = { DemoDriver };
