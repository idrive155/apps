'use strict';
/**
 * soft.js - browser software playback of engine/rec.js draw ops (mgu-render protocol).
 * Pixel-close enough for a desktop preview of the Drift Analyser UI.
 */
(function (global) {
  const OP = { CLEAR: 1, RECT: 2, GRAD: 3, RRECT: 4, RSTROKE: 5, CARD: 6, RAMPRECT: 7, ARC: 8, LINE: 9,
    TRIS: 10, GLYPHS: 11, LAYER: 12, CLIP: 13, NOCLIP: 14, QUAD: 15, ALPHA: 16, XF: 17, IMAGE: 18 };

  function rgba(c) {
    const r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255, a = (c & 255) / 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function Soft(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.atlases = new Map();
    this.glyphCache = new Map();
    this.alpha = 1;
    this.xf = { s: 1, ox: 0, oy: 0 };
  }

  Soft.prototype.setAtlas = function (id, w, h, alphaU8) {
    this.atlases.set(id, { w: w, h: h, alpha: alphaU8 });
  };

  Soft.prototype._applyXf = function (ctx) {
    const x = this.xf;
    if (x.s !== 1 || x.ox || x.oy) ctx.setTransform(x.s, 0, 0, x.s, x.ox, x.oy);
    else ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  Soft.prototype._rr = function (ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
    else {
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
  };

  Soft.prototype._gradStops = function (u, f, i, k) {
    const stops = [];
    for (let j = 0; j < k; j++) stops.push({ t: f[i + j * 2], c: u[i + j * 2 + 1] });
    return stops;
  };

  Soft.prototype._fillGrad = function (ctx, x, y, w, h, stops) {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    for (let i = 0; i < stops.length; i++) g.addColorStop(Math.max(0, Math.min(1, stops[i].t)), rgba(stops[i].c));
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  };

  Soft.prototype._glyphs = function (ctx, atlasId, c, q, n) {
    const A = this.atlases.get(atlasId); if (!A || !n) return;
    // Atlas UVs from engine/text.js are absolute texel coords (not 0..1).
    const r = (c >>> 24) & 255, g = (c >>> 16) & 255, b = (c >>> 8) & 255, a = ((c & 255) / 255) * this.alpha;
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      const x = q[o], y = q[o + 1], w = q[o + 2], h = q[o + 3];
      let u0 = q[o + 4], v0 = q[o + 5], u1 = q[o + 6], v1 = q[o + 7];
      if (u1 <= 1.5 && v1 <= 1.5 && A.w > 2) {
        u0 *= A.w; v0 *= A.h; u1 *= A.w; v1 *= A.h;
      }
      let sx = Math.max(0, Math.floor(u0));
      let sy = Math.max(0, Math.floor(v0));
      let sw = Math.max(1, Math.ceil(u1) - sx);
      let sh = Math.max(1, Math.ceil(v1) - sy);
      if (sx + sw > A.w) sw = A.w - sx;
      if (sy + sh > A.h) sh = A.h - sy;
      if (sw < 1 || sh < 1) continue;
      const key = atlasId + ':' + sx + ',' + sy + ',' + sw + ',' + sh + ':' + (c >>> 0);
      let img = this.glyphCache.get(key);
      if (!img) {
        const id = ctx.createImageData(sw, sh), d = id.data;
        for (let yy = 0; yy < sh; yy++) for (let xx = 0; xx < sw; xx++) {
          const ai = A.alpha[(sy + yy) * A.w + (sx + xx)] || 0, p = (yy * sw + xx) * 4;
          d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = Math.round(ai * a);
        }
        const off = document.createElement('canvas'); off.width = sw; off.height = sh;
        off.getContext('2d').putImageData(id, 0, 0);
        img = off; this.glyphCache.set(key, img);
        if (this.glyphCache.size > 4000) this.glyphCache.clear();
      }
      ctx.drawImage(img, x, y, w, h);
    }
  };

  Soft.prototype.draw = function (rec) {
    const ctx = this.ctx, u = rec.u, f = rec.f, n = rec.n;
    const W = this.cv.width, H = this.cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; this.alpha = 1; this.xf = { s: 1, ox: 0, oy: 0 };
    let i = 0;
    while (i < n) {
      const op = u[i++];
      if (op === OP.CLEAR) {
        ctx.fillStyle = rgba(u[i++]); ctx.fillRect(0, 0, W, H);
      } else if (op === OP.RECT) {
        const x = f[i], y = f[i + 1], w = f[i + 2], h = f[i + 3], c = u[i + 4]; i += 5;
        ctx.globalAlpha = this.alpha; ctx.fillStyle = rgba(c); ctx.fillRect(x, y, w, h);
      } else if (op === OP.GRAD || op === OP.CARD) {
        const x = f[i], y = f[i + 1], w = f[i + 2], h = f[i + 3]; i += 4;
        let r = -1; if (op === OP.CARD) { r = f[i++]; }
        const k = u[i++]; const stops = this._gradStops(u, f, i, k); i += k * 2;
        ctx.globalAlpha = this.alpha;
        if (r > 0) { this._rr(ctx, x, y, w, h, r); const g = ctx.createLinearGradient(x, y, x, y + h);
          for (let j = 0; j < stops.length; j++) g.addColorStop(Math.max(0, Math.min(1, stops[j].t)), rgba(stops[j].c));
          ctx.fillStyle = g; ctx.fill(); }
        else this._fillGrad(ctx, x, y, w, h, stops);
      } else if (op === OP.RRECT) {
        const x = f[i], y = f[i + 1], w = f[i + 2], h = f[i + 3], r = f[i + 4], c = u[i + 5]; i += 6;
        ctx.globalAlpha = this.alpha; ctx.fillStyle = rgba(c); this._rr(ctx, x, y, w, h, r); ctx.fill();
      } else if (op === OP.RSTROKE) {
        const x = f[i], y = f[i + 1], w = f[i + 2], h = f[i + 3], r = f[i + 4], lw = f[i + 5], c = u[i + 6]; i += 7;
        ctx.globalAlpha = this.alpha; ctx.strokeStyle = rgba(c); ctx.lineWidth = lw; this._rr(ctx, x, y, w, h, r); ctx.stroke();
      } else if (op === OP.ARC) {
        const cx = f[i], cy = f[i + 1], r0 = f[i + 2], r1 = f[i + 3], a0 = f[i + 4], a1 = f[i + 5], c = u[i + 6]; i += 11;
        // angles: clockwise from 12 o'clock → canvas: -90deg start, clockwise = negative in standard math... canvas is clockwise with increasing angle if we use the right conversion
        const toRad = (d) => (d - 90) * Math.PI / 180;
        ctx.globalAlpha = this.alpha; ctx.fillStyle = rgba(c);
        ctx.beginPath();
        ctx.arc(cx, cy, r1, toRad(a0), toRad(a1), false);
        ctx.arc(cx, cy, r0, toRad(a1), toRad(a0), true);
        ctx.closePath(); ctx.fill();
      } else if (op === OP.LINE) {
        const xa = f[i], ya = f[i + 1], xb = f[i + 2], yb = f[i + 3], w = f[i + 4], c = u[i + 5]; i += 6;
        ctx.globalAlpha = this.alpha; ctx.strokeStyle = rgba(c); ctx.lineWidth = w; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
      } else if (op === OP.TRIS) {
        const count = u[i++];
        ctx.globalAlpha = this.alpha;
        for (let t = 0; t < count; t++) {
          const x0 = f[i], y0 = f[i + 1], c0 = u[i + 2], x1 = f[i + 3], y1 = f[i + 4], c1 = u[i + 5], x2 = f[i + 6], y2 = f[i + 7], c2 = u[i + 8]; i += 9;
          // flat fill with average colour (fast preview)
          const r = (((c0 >>> 24) + (c1 >>> 24) + (c2 >>> 24)) / 3) | 0;
          const g = ((((c0 >>> 16) & 255) + ((c1 >>> 16) & 255) + ((c2 >>> 16) & 255)) / 3) | 0;
          const b = ((((c0 >>> 8) & 255) + ((c1 >>> 8) & 255) + ((c2 >>> 8) & 255)) / 3) | 0;
          const a = (((c0 & 255) + (c1 & 255) + (c2 & 255)) / 3) | 0;
          ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (a / 255) + ')';
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.closePath(); ctx.fill();
        }
      } else if (op === OP.GLYPHS) {
        const atlasId = u[i++], c = u[i++], gn = u[i++];
        const q = f.subarray(i, i + gn * 8); i += gn * 8;
        this._glyphs(ctx, atlasId, c, q, gn);
      } else if (op === OP.CLIP) {
        const x = f[i], y = f[i + 1], w = f[i + 2], h = f[i + 3]; i += 4;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      } else if (op === OP.NOCLIP) {
        ctx.restore(); this._applyXf(ctx);
      } else if (op === OP.QUAD) {
        const x0 = f[i], y0 = f[i + 1], x1 = f[i + 2], y1 = f[i + 3], x2 = f[i + 4], y2 = f[i + 5], x3 = f[i + 6], y3 = f[i + 7], c = u[i + 8]; i += 9;
        ctx.globalAlpha = this.alpha; ctx.fillStyle = rgba(c);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.closePath(); ctx.fill();
      } else if (op === OP.ALPHA) {
        this.alpha = f[i++]; ctx.globalAlpha = this.alpha;
      } else if (op === OP.XF) {
        this.xf = { s: f[i], ox: f[i + 1], oy: f[i + 2] }; i += 3; this._applyXf(ctx);
      } else {
        // unknown / unused op — stop this frame (keeps preview from painting garbage)
        break;
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  };

  global.SoftRenderer = Soft;
})(typeof window !== 'undefined' ? window : global);
