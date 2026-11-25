'use strict';
/**
 * preview.js - run createApp({ demo: true }) into SoftRenderer on the page canvas.
 */
(function () {
  const canvas = document.getElementById('c');
  const fpsEl = document.getElementById('fps');
  const W = 1920, H = 720;
  canvas.width = W; canvas.height = H;

  if (!window.DriftApp || !window.SoftRenderer) {
    fpsEl.textContent = 'bundle missing — run: npm run preview';
    return;
  }

  const store = {};
  const app = DriftApp.createApp({
    demo: true,
    idrive: 'id7',
    log: { info: function () {}, warn: function (m) { console.warn(m); } },
    load: function (k) {
      if (k === 'settings' && store[k] == null) {
        return { mode: 'demo', preset: 'coupe', autoBody: false, drive: 'rwd', lang: 'hu' };
      }
      return store[k] || null;
    },
    save: function (k, v) { if (v === null) delete store[k]; else store[k] = v; },
  });

  const soft = new SoftRenderer(canvas);
  const fonts = ['huge', 'big', 'mid', 'sm', 'xs', 'lab', 'labs', 'fx'];
  fonts.forEach(function (name) {
    const F = DriftApp.text.font(name);
    if (!F) return;
    const a = DriftApp.text.atlasById(F.id);
    if (a) soft.setAtlas(F.id, a.w, a.h, a.alpha);
  });

  const Rec = DriftApp.rec.Rec;
  const R = new Rec(1 << 19);

  function logical(ev) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left) * (W / r.width),
      y: (ev.clientY - r.top) * (H / r.height),
    };
  }
  canvas.addEventListener('pointerdown', function (ev) {
    canvas.setPointerCapture(ev.pointerId);
    const p = logical(ev); app.touch(1, p.x, p.y);
  });
  canvas.addEventListener('pointermove', function (ev) {
    if (ev.buttons === 0) return;
    const p = logical(ev); app.touch(2, p.x, p.y);
  });
  canvas.addEventListener('pointerup', function (ev) {
    const p = logical(ev); app.touch(3, p.x, p.y);
  });

  document.getElementById('btnVitals').onclick = function () {
    if (app.hud) app.hud.screen = app.hud.screen === 'vitals' ? null : 'vitals';
    this.classList.toggle('on', app.hud && app.hud.screen === 'vitals');
  };
  document.getElementById('btnMenu').onclick = function () {
    if (app.actions && app.actions.menu) app.actions.menu();
  };

  let last = performance.now(), frames = 0, fpsT = last, fps = 0;
  function tick(now) {
    try {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      app.frame(R, dt, W, H);
      soft.draw(R);
      frames++;
      if (now - fpsT >= 500) {
        fps = Math.round(frames * 1000 / (now - fpsT));
        frames = 0; fpsT = now;
        fpsEl.textContent = fps + ' fps · demo drive · click VITALS for Live Data';
      }
    } catch (e) {
      console.error(e);
      fpsEl.textContent = 'preview error — see console';
      return;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
