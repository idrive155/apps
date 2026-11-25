'use strict';
/**
 * cam.js - perspective chase camera. World: x/y ground plane, z up.
 * view(): camera basis; proj(): world -> screen (sx, sy, depth) into an output array.
 */
class Cam {
    constructor() {
        this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.pitch = 0.7; this.f = 1800; this.cx = 960; this.cy = 360;
        this.R = new Float64Array(9); // rows: right, up, forward
    }
    /** look at (tx, ty, tz) from dist metres, heading yaw, pitched down by pitch */
    chase(tx, ty, tz, yaw, pitch, dist) {
        const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
        this.yaw = yaw; this.pitch = pitch;
        this.x = tx - cy * cp * dist; this.y = ty - sy * cp * dist; this.z = tz + sp * dist;
        const R = this.R;
        R[0] = sy; R[1] = -cy; R[2] = 0;                       // right
        R[3] = cy * sp; R[4] = sy * sp; R[5] = cp;             // up
        R[6] = cy * cp; R[7] = sy * cp; R[8] = -sp;            // forward
    }
    /** world point -> out[o] = sx, out[o+1] = sy, out[o+2] = depth (metres along the view); false behind */
    proj(px, py, pz, out, o) {
        const R = this.R, dx = px - this.x, dy = py - this.y, dz = pz - this.z;
        const zc = R[6] * dx + R[7] * dy + R[8] * dz;
        const xc = R[0] * dx + R[1] * dy + R[2] * dz, yc = R[3] * dx + R[4] * dy + R[5] * dz;
        out[o + 2] = zc;
        if (zc < 0.2) { out[o] = this.cx; out[o + 1] = this.cy; return false; }
        const k = this.f / zc;
        out[o] = this.cx + xc * k; out[o + 1] = this.cy - yc * k;
        return true;
    }
    /** pixels per metre at depth z */
    scale(z) { return this.f / z; }
}

module.exports = { Cam };
