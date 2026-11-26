'use strict';
/**
 * IDRIVE155 Lights — parked-only exterior lamp controls (indicators, high beam, fog, disco).
 * Uses BDC LEUCHTEN_FUNKTION timed tests; ending the diagnostic session returns lamps to the car.
 * Controller / softkey navigation: turn or Fel/Le to move focus, press / OK to toggle.
 */
const mgu = require('./kit/mgu');
const { Diag } = require('./kit/diag');
const parkedWatch = require('./kit/parked');
const { LampDriver } = require('./lamps');

const W = 1600, H = 520;
const MAX_RUN_MS = 30000;
const HOLD_MS = 700;
const RENEW_MS = 450;

const COL = {
    bg0: '#06080e',
    bg1: '#0c121c',
    panel: '#121a28',
    panelHi: '#1a2436',
    line: '#2a3548',
    text: '#e8eef8',
    dim: '#8b9bb4',
    faint: '#5a6a84',
    accent: '#4a9bff',
    amber: '#ffb020',
    red: '#e6242e',
    green: '#3dd68c',
    white: '#f5f7fb',
    fog: '#fff2b0',
};

mgu.run({
    async start(ctx) {
        const { ui, log } = ctx;
        const lang = detectLang();
        const T = strings(lang);

        const diag = new Diag(ctx.signals, log);
        diag.quiet = true;
        diag.busyMs = 60;
        diag.init();
        const lamps = new LampDriver(diag, log);
        const parked = parkedWatch.watch(ctx, log);

        const OPTIONS = [
            { id: 'left', label: T.left, accent: COL.amber },
            { id: 'right', label: T.right, accent: COL.amber },
            { id: 'both', label: T.both, accent: COL.amber },
            { id: 'high', label: T.high, accent: COL.white },
            { id: 'fog', label: T.fog, accent: COL.fog },
            { id: 'disco', label: T.disco, accent: COL.accent },
            { id: 'stop', label: T.stop, accent: COL.red },
        ];

        let mode = 'idle'; // idle | left | right | both | high | fog | disco
        let focus = 0;
        let lit = { L: false, R: false, high: false, fog: false };
        let status = T.ready;
        let discoStep = 0;
        let runUntil = 0;
        let renewTimer = null;
        let discoTimer = null;
        let ccuLast = null;

        function clearTimers() {
            clearInterval(renewTimer); renewTimer = null;
            clearInterval(discoTimer); discoTimer = null;
        }

        async function hardStop(why) {
            clearTimers();
            mode = 'idle';
            lit = { L: false, R: false, high: false, fog: false };
            status = why || T.stopped;
            try { await lamps.stop(); } catch (e) { log.warn('lights stop: ' + e); }
            return render();
        }

        function assertParked() {
            if (parked.moving()) {
                status = T.moving;
                return false;
            }
            return true;
        }

        function armDeadline() {
            runUntil = Date.now() + MAX_RUN_MS;
        }

        async function hold(names) {
            if (!assertParked()) { await hardStop(T.moving); return false; }
            const ok = await lamps.start();
            if (!ok) { status = T.noDiag + (lamps.lastErr ? ' (' + lamps.lastErr + ')' : ''); return false; }
            let any = false;
            for (let i = 0; i < names.length; i++) {
                if (await lamps.pulse(names[i], HOLD_MS)) any = true;
            }
            return any;
        }

        function startRenew(names, paint) {
            clearTimers();
            armDeadline();
            const tick = async () => {
                if (parked.moving() || Date.now() > runUntil) {
                    await hardStop(parked.moving() ? T.moving : T.timeout);
                    return;
                }
                await hold(names);
                if (paint) paint();
            };
            tick();
            renewTimer = setInterval(tick, RENEW_MS);
        }

        const DISCO = [
            ['indL'],
            ['indR'],
            ['indL', 'indR'],
            ['high'],
            ['fog'],
            ['indL', 'high'],
            ['indR', 'fog'],
            ['indL', 'indR', 'high', 'fog'],
        ];

        async function startDisco() {
            if (!assertParked()) return hardStop(T.moving);
            clearTimers();
            mode = 'disco';
            status = T.discoOn;
            armDeadline();
            discoStep = 0;
            const ok = await lamps.start();
            if (!ok) { status = T.noDiag; mode = 'idle'; return render(); }
            const beat = async () => {
                if (parked.moving() || Date.now() > runUntil) {
                    await hardStop(parked.moving() ? T.moving : T.timeout);
                    return;
                }
                const step = DISCO[discoStep % DISCO.length];
                discoStep++;
                lit = {
                    L: step.indexOf('indL') >= 0,
                    R: step.indexOf('indR') >= 0,
                    high: step.indexOf('high') >= 0,
                    fog: step.indexOf('fog') >= 0,
                };
                for (let i = 0; i < step.length; i++) await lamps.pulse(step[i], 380);
                render();
            };
            beat();
            discoTimer = setInterval(beat, 420);
            return render();
        }

        async function setMode(next) {
            if (next === 'idle') return hardStop(T.stopped);
            if (!assertParked()) return hardStop(T.moving);
            mode = next;
            if (next === 'left') {
                lit = { L: true, R: false, high: false, fog: false };
                status = T.leftOn;
                startRenew(['indL']);
            } else if (next === 'right') {
                lit = { L: false, R: true, high: false, fog: false };
                status = T.rightOn;
                startRenew(['indR']);
            } else if (next === 'both') {
                lit = { L: true, R: true, high: false, fog: false };
                status = T.bothOn;
                startRenew(['indL', 'indR']);
            } else if (next === 'high') {
                lit = { L: false, R: false, high: true, fog: false };
                status = T.highOn;
                startRenew(['high']);
            } else if (next === 'fog') {
                lit = { L: false, R: false, high: false, fog: true };
                status = T.fogOn;
                startRenew(['fog']);
            }
            return render();
        }

        function moveFocus(d) {
            const n = OPTIONS.length;
            focus = ((focus + d) % n + n) % n;
            return render();
        }

        function activateFocus() {
            const opt = OPTIONS[focus];
            if (!opt) return;
            if (opt.id === 'stop') return hardStop(T.stopped);
            if (opt.id === 'disco') return mode === 'disco' ? hardStop(T.stopped) : startDisco();
            return setMode(mode === opt.id ? 'idle' : opt.id);
        }

        function activateId(id) {
            const i = OPTIONS.findIndex((o) => o.id === id);
            if (i >= 0) focus = i;
            return activateFocus();
        }

        // safety poll
        setInterval(() => {
            if (mode !== 'idle' && parked.moving()) hardStop(T.moving);
            else if (mode !== 'idle' && runUntil && Date.now() > runUntil) hardStop(T.timeout);
        }, 500);

        process.on('exit', () => { try { lamps.stop(); } catch (e) { /* ignore */ } });
        ['SIGTERM', 'SIGINT', 'SIGHUP'].forEach((s) => process.on(s, () => { lamps.stop(); process.exit(0); }));
        if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => lamps.stop());

        // Softkeys: step through the list (works without touch / without GPU own-mode)
        ui.onClick('BTN_UP', () => moveFocus(-1));
        ui.onClick('BTN_DOWN', () => moveFocus(1));
        ui.onClick('BTN_OK', () => activateFocus());
        ui.onClick('BTN_STOP', () => hardStop(T.stopped));

        // Optional direct softkeys (if present in an older pack)
        ui.onClick('BTN_LEFT', () => activateId('left'));
        ui.onClick('BTN_RIGHT', () => activateId('right'));
        ui.onClick('BTN_BOTH', () => activateId('both'));
        ui.onClick('BTN_HIGH', () => activateId('high'));
        ui.onClick('BTN_FOG', () => activateId('fog'));
        ui.onClick('BTN_DISCO', () => activateId('disco'));

        // Rotary when the kit does not own the screen (software path / no touch routing)
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
            // tilt N/S also steps (handy if knob is flaky)
            const tiltN = (df === 1 || df === 2) && !(L && (L.df === 1 || L.df === 2));
            const tiltS = (df === 7 || df === 8) && !(L && (L.df === 7 || L.df === 8));
            if (tiltN) d = -1;
            if (tiltS) d = 1;
            if (d) moveFocus(d > 0 ? 1 : -1);
            else if (press) activateFocus();
        });

        ui.onVisible((name, on) => {
            if (name !== 'MAIN') return;
            try { ctx.controller.grab(!!on); } catch (e) { /* ignore */ }
            if (!on) ccuLast = null;
        });
        try { ctx.controller.grab(true); } catch (e) { /* ignore */ }

        function withA(hex, a) {
            const s = hex.replace('#', '');
            const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
            return [r, g, b, Math.round(a * 255)];
        }

        function carSketch(cv, cx, cy) {
            cv.roundRect(cx - 78, cy - 162, 156, 324, 42, COL.panel);
            cv.roundRect(cx - 70, cy - 150, 140, 300, 36, COL.panelHi);
            cv.roundRect(cx - 52, cy - 120, 104, 70, 14, COL.panel);
            cv.roundRect(cx - 52, cy + 40, 104, 80, 14, COL.panel);
            cv.roundRect(cx - 44, cy - 40, 88, 70, 12, '#1e2a3d');
            const lamp = (x, y, on, color, w, h) => {
                cv.roundRect(x, y, w, h, 6, on ? color : '#2a3140');
                if (on) cv.roundRect(x - 3, y - 3, w + 6, h + 6, 8, withA(color, 0.28));
            };
            lamp(cx - 78, cy - 148, lit.L, COL.amber, 22, 28);
            lamp(cx + 56, cy - 148, lit.R, COL.amber, 22, 28);
            lamp(cx - 78, cy + 122, lit.L, COL.amber, 22, 28);
            lamp(cx + 56, cy + 122, lit.R, COL.amber, 22, 28);
            lamp(cx - 40, cy - 158, lit.high, COL.white, 28, 14);
            lamp(cx + 12, cy - 158, lit.high, COL.white, 28, 14);
            lamp(cx - 88, cy - 100, lit.fog, COL.fog, 16, 20);
            lamp(cx + 72, cy - 100, lit.fog, COL.fog, 16, 20);
        }

        function render() {
            const cv = ctx.canvas(W, H).clear(COL.bg0);
            const moving = parked.moving();
            const spd = parked.speed();

            // soft vertical wash
            cv.gradientRect(0, 0, W, H, [[0, COL.bg0], [1, COL.bg1]]);
            cv.fillRect(0, 0, 6, H, COL.accent);

            // left: brand + car
            cv.text('IDRIVE155', 48, 42, 20, COL.accent, { font: 'bold', literal: true });
            cv.text(T.title, 48, 88, 44, COL.text, { font: 'bold', literal: true });
            cv.text(T.subtitle, 48, 122, 20, COL.dim, { literal: true });

            carSketch(cv, 250, 310);

            const badge = moving ? T.badgeMove : T.badgePark;
            const badgeC = moving ? COL.red : COL.green;
            cv.roundRect(130, 470, 240, 36, 10, withA(badgeC, 0.16));
            cv.text(badge + (spd != null ? '  ·  ' + Math.round(spd) + ' km/h' : ''), 250, 494, 18, badgeC, {
                align: 'center', font: 'bold', literal: true,
            });

            // right: status + focusable list
            const lx = 480, ly = 36, lw = 1070;
            cv.roundRect(lx, ly, lw, 56, 12, COL.panel);
            cv.text(status, lx + 28, ly + 36, 26, COL.text, { font: 'bold', literal: true });

            const listY = 112;
            const rowH = 46;
            const gap = 6;
            OPTIONS.forEach((opt, i) => {
                const y = listY + i * (rowH + gap);
                const on = opt.id !== 'stop' && mode === opt.id;
                const focused = i === focus;
                const bg = on ? withA(opt.accent, 0.22) : focused ? COL.panelHi : COL.panel;
                cv.roundRect(lx, y, lw, rowH, 10, bg);
                if (focused) {
                    cv.roundRect(lx, y, 6, rowH, 3, opt.accent);
                    if (cv.strokeRoundRect) {
                        try { cv.strokeRoundRect(lx, y, lw, rowH, 10, 2, withA(opt.accent, 0.85)); } catch (e) { /* ignore */ }
                    }
                } else if (on) {
                    cv.roundRect(lx, y, 6, rowH, 3, opt.accent);
                }
                const label = opt.id === 'disco' && mode === 'disco' ? T.discoStop : opt.label;
                cv.text(label, lx + 28, y + rowH / 2 + 8, 24, on || focused ? COL.text : COL.dim, {
                    font: 'bold', literal: true,
                });
                if (on) {
                    cv.text(T.active, lx + lw - 28, y + rowH / 2 + 8, 18, opt.accent, {
                        align: 'right', font: 'bold', literal: true,
                    });
                }
                // Touch + kit-own controller: each row is a target
                if (typeof cv.target === 'function') {
                    const idx = i;
                    cv.target(lx, y, lw, rowH, () => {
                        focus = idx;
                        return activateFocus();
                    }, 'opt:' + opt.id, 10);
                }
            });

            cv.text(T.hint, lx, 500, 18, COL.faint, { literal: true });
            cv.text(T.limit, lx + lw, 500, 16, COL.faint, { align: 'right', literal: true });

            return ui.image('MAIN_GFX', cv);
        }

        ctx.loop('MAIN', 4, () => render());
        log.info('idrive155_lights started (' + lang + ')');
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
            title: 'Lights',
            subtitle: 'Exterior lamps · parked only',
            ready: 'Ready — car must stay still',
            stopped: 'Stopped — lamps back to the car',
            moving: 'Blocked — car is moving',
            timeout: 'Auto-stop after 30 s',
            noDiag: 'No diagnostic link to the body controller',
            leftOn: 'Left indicators on',
            rightOn: 'Right indicators on',
            bothOn: 'Both indicators on',
            highOn: 'High beam on',
            fogOn: 'Fog lights on',
            discoOn: 'Disco running',
            left: 'Left indicator',
            right: 'Right indicator',
            both: 'Both indicators',
            high: 'High beam',
            fog: 'Fog lights',
            disco: 'Disco',
            discoStop: 'Disco · stop',
            stop: 'Stop all',
            active: 'ON',
            badgePark: 'PARKED',
            badgeMove: 'MOVING',
            hint: 'Turn the controller or use Up / Down · press OK to toggle',
            limit: 'Private property · max 30 s · stops if you roll',
        };
    }
    return {
        title: 'Lámpák',
        subtitle: 'Külső fények · csak álló autón',
        ready: 'Kész — az autónak állnia kell',
        stopped: 'Leállítva — a lámpák vissza a kocsinak',
        moving: 'Tiltva — az autó mozog',
        timeout: 'Automatikus stop 30 mp után',
        noDiag: 'Nincs diagnosztikai kapcsolat a karosszéria-vezérlőhöz',
        leftOn: 'Bal index be',
        rightOn: 'Jobb index be',
        bothOn: 'Mindkét index be',
        highOn: 'Távoli be',
        fogOn: 'Köd be',
        discoOn: 'Disco megy',
        left: 'Bal index',
        right: 'Jobb index',
        both: 'Mindkét index',
        high: 'Távoli',
        fog: 'Köd',
        disco: 'Disco',
        discoStop: 'Disco · stop',
        stop: 'Minden ki',
        active: 'BE',
        badgePark: 'ÁLLÓ',
        badgeMove: 'MOZOG',
        hint: 'Tekerj vagy Fel / Le · OK-val kapcsolod',
        limit: 'Magánterület · max 30 mp · elinduláskor leáll',
    };
}
