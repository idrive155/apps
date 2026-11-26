'use strict';
/**
 * IDRIVE155 TikTok — vertical feed on the iDrive screen.
 * Next / previous via softkeys or the controller. Internet through MGU Store uplink (Wi-Fi / USB / LTE).
 * There is no Chromium webview on MGU: this app loads the feed over HTTPS and shows a car-native UI.
 */
const mgu = require('./kit/mgu');
const parkedWatch = require('./kit/parked');
const feed = require('./feed');

const W = 1600, H = 520;

const COL = {
    bg0: '#050508',
    bg1: '#121018',
    panel: '#1a1522',
    panelHi: '#261c30',
    text: '#f4f0f8',
    dim: '#a89bb8',
    faint: '#6e6278',
    cyan: '#25f4ee',
    pink: '#fe2c55',
    accent: '#fe2c55',
    green: '#3dd68c',
    red: '#e6242e',
    white: '#ffffff',
};

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        const lang = detectLang();
        const T = strings(lang);
        const parked = parkedWatch.watch(ctx, log);

        let items = feed.DEMO.slice();
        let idx = 0;
        let status = T.loading;
        let online = false;
        let source = 'demo';
        let busy = false;
        let flash = null; // 'prev' | 'next' | 'ok'
        let flashUntil = 0;
        let ccuLast = null;
        let playing = false;
        let playT0 = 0;

        function cur() { return items[idx] || null; }

        function fmtN(n) {
            n = Number(n) || 0;
            if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
            if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
            return String(n);
        }

        function withA(hex, a) {
            const s = hex.replace('#', '');
            const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
            return [r, g, b, Math.round(a * 255)];
        }

        function bumpFlash(kind) {
            flash = kind;
            flashUntil = Date.now() + 220;
        }

        async function reload() {
            if (busy) return;
            busy = true;
            status = T.loading;
            render();
            try {
                const res = await feed.loadFeed();
                items = (res.items && res.items.length) ? res.items : feed.DEMO.slice();
                idx = 0;
                online = !!res.online;
                source = res.source || 'demo';
                playing = false;
                if (!res.online) status = T.offline;
                else if (source === 'demo') status = T.demo + (res.error ? ' · ' + res.error : '');
                else status = T.online + ' · ' + items.length + ' ' + T.videos;
                log.info('tiktok feed: ' + source + ' n=' + items.length + (res.error ? ' err=' + res.error : ''));
            } catch (e) {
                status = T.error + ': ' + String(e && e.message || e).slice(0, 80);
                log.warn('tiktok reload: ' + e);
            }
            busy = false;
            return render();
        }

        function move(d) {
            if (parked.moving()) { status = T.moving; return render(); }
            if (!items.length) return;
            idx = ((idx + d) % items.length + items.length) % items.length;
            playing = false;
            bumpFlash(d > 0 ? 'next' : 'prev');
            status = (idx + 1) + ' / ' + items.length + (online ? '' : ' · ' + T.offlineShort);
            return render();
        }

        function activate() {
            if (parked.moving()) { status = T.moving; return render(); }
            const it = cur();
            if (!it) return;
            bumpFlash('ok');
            playing = !playing;
            playT0 = Date.now();
            status = playing
                ? (T.playing + ' · ' + it.author)
                : (T.paused + ' · ' + it.author);
            log.info('tiktok ' + (playing ? 'play' : 'pause') + ' ' + it.url);
            return render();
        }

        // Softkeys: vertical TikTok gesture → Fel = previous, Le = next
        ui.onClick('BTN_UP', () => move(-1));
        ui.onClick('BTN_DOWN', () => move(1));
        ui.onClick('BTN_OK', () => activate());
        ui.onClick('BTN_RELOAD', () => reload());

        // Rotary / tilt when the kit does not own the screen
        ctx.controller.onInput((v) => {
            const k = Number(v.frontRotaryEncoderOperation);
            const pb = Number(v.frontRotaryEncoderPushButton);
            const df = Number(v.frontRotaryEncoderDeflection);
            const L = ccuLast;
            ccuLast = { k, pb, df };
            if (pb === 15 && df === 15) return;
            let d = L ? ((k - L.k + 32768) & 0xffff) - 32768 : 0;
            if (Math.abs(d) > 64) d = 0;
            const down = (x) => x === 1 || x === 2;
            const press = down(pb) && !(L && down(L.pb));
            const tiltN = (df === 1 || df === 2) && !(L && (L.df === 1 || L.df === 2));
            const tiltS = (df === 7 || df === 8) && !(L && (L.df === 7 || L.df === 8));
            if (tiltN) d = -1;
            if (tiltS) d = 1;
            if (d) move(d > 0 ? 1 : -1);
            else if (press) activate();
        });

        ui.onVisible((name, on) => {
            if (name !== 'MAIN') return;
            try { ctx.controller.grab(!!on); } catch (e) { /* ignore */ }
            if (!on) { ccuLast = null; playing = false; }
        });
        try { ctx.controller.grab(true); } catch (e) { /* ignore */ }

        setInterval(() => {
            if (parked.moving() && playing) {
                playing = false;
                status = T.moving;
                render();
            }
        }, 500);

        function drawPhone(cv, x, y, w, h, it) {
            cv.roundRect(x, y, w, h, 28, COL.panel);
            cv.roundRect(x + 6, y + 6, w - 12, h - 12, 22, COL.bg0);
            // TikTok dual-tone wash
            cv.gradientRect(x + 10, y + 10, w - 20, h - 20, [
                [0, withA(COL.cyan, 0.18)],
                [1, withA(COL.pink, 0.22)],
            ]);
            // fake vertical video frame
            const ix = x + 28, iy = y + 36, iw = w - 56, ih = h - 100;
            cv.roundRect(ix, iy, iw, ih, 16, COL.panelHi);
            if (it && it.demo) {
                cv.text('DEMO', x + w / 2, iy + ih / 2 - 10, 36, COL.faint, { align: 'center', font: 'bold', literal: true });
            } else {
                cv.text('▶', x + w / 2, iy + ih / 2 + 12, 64, playing ? COL.white : withA(COL.white, 0.55), {
                    align: 'center', font: 'bold', literal: true,
                });
            }
            // side action stack (TikTok chrome)
            const sx = x + w - 58;
            const icons = ['♥', '💬', '↪'];
            icons.forEach((g, i) => {
                const yy = iy + 70 + i * 70;
                cv.roundRect(sx - 6, yy - 22, 44, 44, 22, withA('#000000', 0.35));
                cv.text(g, sx + 16, yy + 8, 22, COL.white, { align: 'center', literal: true });
            });
            if (it) {
                cv.text(fmtN(it.likes), sx + 16, iy + 70 + 28, 14, COL.dim, { align: 'center', literal: true });
            }
            // caption strip
            cv.roundRect(x + 18, y + h - 58, w - 36, 40, 10, withA('#000000', 0.45));
            const cap = it ? ((it.author || '') + '  ·  ' + (it.title || '')).slice(0, 42) : '';
            cv.text(cap, x + 30, y + h - 32, 16, COL.text, { literal: true });
        }

        function render() {
            const cv = ctx.canvas(W, H).clear(COL.bg0);
            const moving = parked.moving();
            const it = cur();
            const fl = Date.now() < flashUntil ? flash : null;

            cv.gradientRect(0, 0, W, H, [[0, COL.bg0], [1, COL.bg1]]);
            cv.fillRect(0, 0, 6, H, COL.pink);
            cv.fillRect(6, 0, 4, H, COL.cyan);

            // header
            cv.text('IDRIVE155', 48, 42, 20, COL.cyan, { font: 'bold', literal: true });
            cv.text(T.title, 48, 88, 44, COL.text, { font: 'bold', literal: true });
            cv.text(T.subtitle, 48, 122, 20, COL.dim, { literal: true });

            // net + park badges
            const netC = online ? COL.green : COL.red;
            cv.roundRect(48, 150, 220, 36, 10, withA(netC, 0.16));
            cv.text(online ? T.badgeOn : T.badgeOff, 158, 174, 18, netC, { align: 'center', font: 'bold', literal: true });

            const parkC = moving ? COL.red : COL.green;
            cv.roundRect(284, 150, 200, 36, 10, withA(parkC, 0.16));
            cv.text(moving ? T.badgeMove : T.badgePark, 384, 174, 18, parkC, { align: 'center', font: 'bold', literal: true });

            // left: phone / video stage
            drawPhone(cv, 48, 200, 420, 280, it);

            // right: details + nav hint
            const lx = 520, lw = 1030;
            cv.roundRect(lx, 48, lw, 70, 14, COL.panel);
            cv.text(status, lx + 28, 92, 26, COL.text, { font: 'bold', literal: true });

            cv.roundRect(lx, 140, lw, 280, 16, COL.panel);
            if (it) {
                cv.text(it.author, lx + 36, 190, 32, COL.cyan, { font: 'bold', literal: true });
                const lines = wrap(it.title || '', 52);
                lines.slice(0, 4).forEach((line, i) => {
                    cv.text(line, lx + 36, 240 + i * 34, 26, COL.text, { literal: true });
                });
                cv.text(fmtN(it.likes) + '  ♥     ' + fmtN(it.views) + '  ▶', lx + 36, 380, 22, COL.dim, { literal: true });
                if (playing) {
                    const p = Math.min(1, (Date.now() - playT0) / 15000);
                    cv.roundRect(lx + 36, 400, lw - 72, 8, 4, withA(COL.white, 0.12));
                    cv.roundRect(lx + 36, 400, Math.max(8, (lw - 72) * p), 8, 4, COL.pink);
                }
            } else {
                cv.text(T.empty, lx + 36, 280, 28, COL.dim, { literal: true });
            }

            // nav pills
            const py = 440;
            pill(cv, lx, py, 200, 48, T.prev, fl === 'prev');
            pill(cv, lx + 220, py, 200, 48, T.next, fl === 'next');
            pill(cv, lx + 440, py, 220, 48, playing ? T.pause : T.play, fl === 'ok');
            pill(cv, lx + 680, py, 200, 48, T.reload, false);

            cv.text(T.hint, lx, 508, 16, COL.faint, { literal: true });
            cv.text(source === 'tiktok' ? 'tiktok.com' : source, lx + lw, 508, 16, COL.faint, { align: 'right', literal: true });

            // touch targets on pills
            if (typeof cv.target === 'function') {
                cv.target(lx, py, 200, 48, () => move(-1), 'prev', 10);
                cv.target(lx + 220, py, 200, 48, () => move(1), 'next', 10);
                cv.target(lx + 440, py, 220, 48, () => activate(), 'ok', 10);
                cv.target(lx + 680, py, 200, 48, () => reload(), 'reload', 10);
            }

            return ui.image('MAIN_GFX', cv);
        }

        function pill(cv, x, y, w, h, label, on) {
            cv.roundRect(x, y, w, h, 12, on ? withA(COL.pink, 0.55) : COL.panelHi);
            if (on) cv.roundRect(x, y + h - 4, w, 4, 2, COL.cyan);
            cv.text(label, x + w / 2, y + h / 2 + 8, 22, COL.text, { align: 'center', font: 'bold', literal: true });
        }

        function wrap(s, n) {
            const words = String(s).split(/\s+/), lines = [];
            let cur = '';
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                if (!cur) cur = w;
                else if ((cur + ' ' + w).length <= n) cur += ' ' + w;
                else { lines.push(cur); cur = w; }
            }
            if (cur) lines.push(cur);
            return lines.length ? lines : [''];
        }

        ctx.loop('MAIN', 8, () => render());
        reload();
        log.info('idrive155_tiktok started (' + lang + ')');
    },
});

function detectLang() {
    try {
        const blob = [process.env.LANG, process.env.LC_ALL, process.env.LANGUAGE].join(' ');
        if (/^en\b|en_US|\.en\b/i.test(blob)) return 'en';
        if (/^hu\b|hu_HU|\.hu\b/i.test(blob)) return 'hu';
    } catch (e) { /* ignore */ }
    return 'hu';
}

function strings(lang) {
    if (lang === 'en') {
        return {
            title: 'TikTok',
            subtitle: 'For You feed · Store Wi-Fi / uplink',
            loading: 'Loading feed…',
            online: 'Online',
            offline: 'No uplink — demo reel',
            offlineShort: 'offline',
            demo: 'Demo reel (TikTok feed unavailable)',
            error: 'Error',
            moving: 'Parked only — stop to continue',
            empty: 'No videos',
            prev: 'PREV',
            next: 'NEXT',
            play: 'PLAY',
            pause: 'PAUSE',
            reload: 'RELOAD',
            playing: 'Playing',
            paused: 'Paused',
            videos: 'videos',
            badgeOn: 'UPLINK ON',
            badgeOff: 'UPLINK OFF',
            badgePark: 'PARKED',
            badgeMove: 'MOVING',
            hint: 'Turn controller or Up / Down · OK play/pause · Reload refreshes the feed',
        };
    }
    return {
        title: 'TikTok',
        subtitle: 'For You feed · Store Wi-Fi / uplink',
        loading: 'Feed betöltése…',
        online: 'Online',
        offline: 'Nincs uplink — demó lista',
        offlineShort: 'offline',
        demo: 'Demó lista (TikTok feed nem elérhető)',
        error: 'Hiba',
        moving: 'Csak álló autón — állj meg a folytatáshoz',
        empty: 'Nincs videó',
        prev: 'ELŐZŐ',
        next: 'KÖVETKEZŐ',
        play: 'PLAY',
        pause: 'SZÜNET',
        reload: 'FRISSÍT',
        playing: 'Lejátszás',
        paused: 'Szünet',
        videos: 'videó',
        badgeOn: 'UPLINK BE',
        badgeOff: 'UPLINK KI',
        badgePark: 'ÁLLÓ',
        badgeMove: 'MOZOG',
        hint: 'Tekerj vagy Fel / Le · OK play/szünet · Frissít újratölti a feedet',
    };
}
