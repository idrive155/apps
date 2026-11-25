'use strict';
/**
 * rclient.js - Sideways' own connection to mgu-render (the MGU Store's GPU renderer), native
 * dialect mgu-render/1 (kit/renderd/PROTOCOL.md in idrive7-apps):
 *
 *   HELLO "sideways\0proto=mgu-render/1"  ->  X_READY (app area, caps), READY (screen, touch)
 *   X_MODE layer, PLACE over the app area (logical height 720), CLAIM the whole area for touch
 *   SHOW while our screen is open; one FRAME per TICK (the renderer paces us to the display)
 *   TOUCH (phase, x, y logical) -> 'touch';  CLOSED (HMI touched outside) -> 'closed'
 *
 * An older renderer answers READY alone: then this stays in the plain dialect (no claims; the
 * app still draws, touch then goes to the HMI). Reconnects every 2 s when the socket goes.
 */
const net = require('net');
const fs = require('fs');
const EventEmitter = require('events');

const SOCKETS = process.env.SIDEWAYS_RENDER_SOCKET ? [process.env.SIDEWAYS_RENDER_SOCKET] : ['/run/mgu-render/render.sock', '/run/mgu-renderd/renderd.sock'];
const M = { HELLO: 1, PLACE: 2, SHOW: 3, ATLAS: 4, RAMP: 5, LAYER: 6, FRAME: 7, CLAIM: 9 };
const E = { READY: 101, TICK: 102, ERROR: 103, STATS: 104, TOUCH: 105, CLOSED: 106 };
const X = { MODE: 0x4d520001, READY: 0x4d520101, STATE: 0x4d520102 };
const isSock = (p) => { try { return fs.statSync(p).isSocket(); } catch (e) { return false; } };

class RenderConn extends EventEmitter {
    constructor(appId, log, core) {
        super();
        this.appId = appId; this.log = log; this.core = core;  // core: { rec: { Session }, text: { atlasById } }
        this.sock = null; this.ready = false; this.native = false; this.visible = false;
        this.W = 1920; this.H = 720; this.area = null; this.buf = Buffer.alloc(0); this.waiting = false;
        this.stats = { frames: 0, avgUs: 0 };
        this.connect();
    }
    connect() {
        const path = SOCKETS.find(isSock);
        if (!path) { this._retry('no renderer socket yet'); return; }
        const s = net.createConnection(path);
        this.sock = s; this.ready = false; this.native = false; this.xready = null; this.buf = Buffer.alloc(0);
        s.on('connect', () => {
            const hello = Buffer.from(this.appId + '\0proto=mgu-render/1', 'utf8');
            this._msg(M.HELLO, hello);
            this.log.info('renderer: connected to ' + path);
        });
        s.on('data', (d) => this._data(d));
        s.on('error', (e) => this.log.warn('renderer: ' + e.message));
        s.on('close', () => { if (this.sock === s) { this.sock = null; this.ready = false; this.emit('down'); this._retry('closed'); } });
    }
    _retry(why) {
        clearTimeout(this.rt);
        this.rt = setTimeout(() => this.connect(), 2000);
        if (!this.retried) { this.retried = true; this.log.info('renderer: ' + why + ', retrying every 2 s'); }
    }
    _msg(type, payload) {
        if (!this.sock) return false;
        const len = payload ? payload.length : 0, pad = (4 - (len & 3)) & 3;
        const b = Buffer.alloc(8 + len + pad);
        b.writeUInt32LE(type >>> 0, 0); b.writeUInt32LE(len + pad, 4);
        if (len) payload.copy(b, 8);
        return this.sock.write(b);
    }
    _data(d) {
        this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
        while (this.buf.length >= 8) {
            const type = this.buf.readUInt32LE(0), len = this.buf.readUInt32LE(4);
            if (this.buf.length < 8 + len) break;
            const p = this.buf.subarray(8, 8 + len);
            this.buf = this.buf.subarray(8 + len);
            this._event(type, p);
        }
    }
    _event(type, p) {
        if (type === X.READY && p.length >= 44) {
            this.native = true;
            this.xready = { caps: p.readUInt32LE(8), area: { x: p.readInt32LE(28), y: p.readInt32LE(32), w: p.readInt32LE(36), h: p.readInt32LE(40) } };
        } else if (type === E.READY) {
            const sw = p.length >= 12 ? p.readUInt32LE(4) : 1920, sh = p.length >= 12 ? p.readUInt32LE(8) : 720;
            this.touch = p.length >= 16 && p.readUInt32LE(12) !== 0;
            let a = { x: 0, y: 0, w: sw, h: sh };
            this.area = a;
            // logical: 720 high, as wide as the area allows (1920 on a full screen)
            const scale = a.h / 720;
            this.W = Math.round(a.w / scale); this.H = 720; this.scale = scale;
            if (this.native) { const m = Buffer.alloc(4); m.writeUInt32LE(1, 0); this._msg(X.MODE, m); }
            this.session = new this.core.rec.Session(this.appId, (b) => this._raw(b), this.core.text.atlasById);
            this.session.place(a.x, a.y, a.w, a.h, scale, 0, 0);
            this.ready = true; this.waiting = false;
            this.log.info('renderer: ready ' + sw + 'x' + sh + ', area ' + JSON.stringify(a) + ', logical ' + this.W + 'x720, ' +
                (this.native ? 'mgu-render/1' : 'plain dialect') + (this.touch ? ', touch' : ''));
            if (this.visible) this._show(true);
            this.emit('ready');
        } else if (type === E.TICK) {
            this.waiting = false; this.emit('tick');
        } else if (type === E.TOUCH && p.length >= 12) {
            this.emit('touch', p.readUInt32LE(0), p.readFloatLE(4), p.readFloatLE(8));
        } else if (type === E.CLOSED) {
            this.emit('closed');
        } else if (type === X.STATE && p.length >= 12) {
            this.emit('state', { mode: p.readUInt32LE(0), onScreen: !!p.readUInt32LE(4), inFront: !!p.readUInt32LE(8) });
        } else if (type === E.ERROR) {
            this.log.warn('renderer error: ' + p.toString('utf8').replace(/\0+$/, ''));
        } else if (type === E.STATS && p.length >= 12) {
            this.stats = { frames: p.readUInt32LE(0), avgUs: p.readUInt32LE(4), maxUs: p.readUInt32LE(8) };
        }
    }
    _raw(u8) { if (this.sock) this.sock.write(Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)); }
    _show(on) {
        const b = Buffer.alloc(4); b.writeUInt32LE(on ? 1 : 0, 0); this._msg(M.SHOW, b);
        if (on && this.touch) {
            // touch anywhere on our area is ours while shown (the HMI's back arrow lies outside it)
            const c = Buffer.alloc(20); c.writeUInt32LE(1, 0); c.writeFloatLE(0, 4); c.writeFloatLE(0, 8); c.writeFloatLE(this.W, 12); c.writeFloatLE(this.H, 16);
            this._msg(M.CLAIM, c);
        }
    }
    show(on) {
        on = !!on;
        if (on === this.visible) return;
        this.visible = on;
        this.waiting = false;
        if (this.ready) this._show(on);
    }
    /** send a recorded frame; false while the previous one is not taken yet */
    frame(rec) {
        if (!this.ready) return false;
        // the renderer answers each frame with a TICK; should one get lost, go on after 250 ms
        if (this.waiting && Date.now() - this.sentAt < 250) return false;
        this.waiting = true; this.sentAt = Date.now();
        this.session.frame(rec);
        return true;
    }
    close() { clearTimeout(this.rt); if (this.sock) { this.sock.destroy(); this.sock = null; } }
}

module.exports = { RenderConn, SOCKETS };
