'use strict';
/**
 * lamps.js - slim exterior lamp driver via BDC LEUCHTEN_FUNKTION (timed lamp tests).
 * Based on the community Light Show approach (idrive7-apps / eroobeeroo), GPL-compatible.
 *
 * Only while the caller keeps renewing: each function runs for `holdMs`, then ends.
 * stop() ends the diagnostic session so the car takes the lamps back within a few seconds.
 */
const BDC = 0x40;
const FN_DID = [0xD5, 0x42];

/** TAB_LEUCHTEN_FUNKTION_ARG — both sides except indicators */
const FN = {
    low: 0x03,
    drl: 0x04,
    high: 0x05,
    indL: 0x06,
    indR: 0x07,
    fog: 0x08,
    rfog: 0x0E,
    rev: 0x0F,
};

const NRC = {
    0x10: 'refused', 0x11: 'not supported', 0x13: 'wrong length',
    0x22: 'conditions not correct', 0x31: 'out of range',
    0x33: 'security', 0x7E: 'wrong session', 0x7F: 'wrong session',
};
const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');

function fnReq(fn, ms) {
    const t = Math.max(1, Math.min(32700, Math.round(ms / 10)));
    return [0x2E].concat(FN_DID, [0x00, fn, (t >> 8) & 0xff, t & 0xff]);
}

class LampDriver {
    constructor(diag, log) {
        this.diag = diag;
        this.log = log || { info() {}, warn() {} };
        this.active = false;
        this.queue = Promise.resolve();
        this.tp = null;
        this.lastErr = '';
        this.ok = 0;
        this.fail = 0;
    }

    _run(fn) {
        const next = this.queue.then(fn, fn);
        this.queue = next.catch(() => null);
        return next;
    }

    async _uds(bytes) {
        const sid = bytes[0], data = bytes.slice(1);
        const echo = data.slice(0, 2);
        const accept = (u) => (u[0] === sid + 0x40 && echo.every((x, i) => u[i + 1] === x)) || (u[0] === 0x7F && u[1] === sid);
        let u = null;
        try {
            u = await this.diag.physical(BDC, sid, data, 800, accept, {
                maxRetries: 1, retryBaseMs: 50, pendingTimeoutMs: 1000, callTimeoutMs: 1500,
            });
        } catch (e) {
            this.lastErr = String(e && e.message || e);
            this.fail++;
            return { ok: false };
        }
        if (!u) { this.fail++; this.lastErr = 'no answer'; return { ok: false }; }
        if (u[0] === 0x7F) {
            this.fail++;
            this.lastErr = NRC[u[2]] || ('NRC ' + hex(u[2]));
            return { ok: false, nrc: u[2] };
        }
        this.ok++;
        return { ok: true };
    }

    async start() {
        return this._run(async () => {
            if (this.active) return true;
            const r = await this._uds([0x10, 0x03]);
            if (!r.ok) {
                this.log.warn('lights: session ' + this.lastErr);
                return false;
            }
            this.active = true;
            clearInterval(this.tp);
            this.tp = setInterval(() => {
                this._run(() => this._uds([0x3E, 0x00])).catch(() => null);
            }, 2000);
            this.log.info('lights: BDC extended session');
            return true;
        });
    }

    /** Fire a lamp function for holdMs (renew before it ends to keep it on). */
    async pulse(name, holdMs) {
        const fn = FN[name];
        if (fn == null) return false;
        return this._run(async () => {
            if (!this.active) {
                const ok = await this.start();
                if (!ok) return false;
            }
            const r = await this._uds(fnReq(fn, holdMs || 600));
            if (!r.ok) this.log.warn('lights: ' + name + ' ' + this.lastErr);
            return r.ok;
        });
    }

    async stop() {
        return this._run(async () => {
            clearInterval(this.tp);
            this.tp = null;
            if (!this.active) return;
            // default session → car takes lamps back within a few seconds
            await this._uds([0x10, 0x01]);
            this.active = false;
            this.log.info('lights: session ended, lamps back to car');
        });
    }
}

module.exports = { LampDriver, FN };
