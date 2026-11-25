'use strict';
/**
 * IDRIVE155 Lights — parked-only exterior lamp controls (indicators, high beam, fog, disco).
 * Uses BDC LEUCHTEN_FUNKTION timed tests; ending the diagnostic session returns lamps to the car.
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
    bg: '#07090f',
    panel: '#121826',
    panel2: '#1a2233',
    line: '#2a3548',
    text: '#e8eef8',
    dim: '#8b9bb4',
    faint: '#5a6a84',
    accent: '#3d8bfd',
    amber: '#ffb020',
    red: '#e6242e',
    green: '#3dd68c',
    white: '#f5f7fb',
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

        let mode = 'idle'; // idle | left | right | both | high | fog | disco
        let lit = { L: false, R: false, high: false, fog: false };
        let status = T.ready;
        let discoStep = 0;
        let runUntil = 0;
        let renewTimer = null;
        let discoTimer = null;

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

        // safety poll
        setInterval(() => {
            if (mode !== 'idle' && parked.moving()) hardStop(T.moving);
            else if (mode !== 'idle' && runUntil && Date.now() > runUntil) hardStop(T.timeout);
        }, 500);

        process.on('exit', () => { try { lamps.stop(); } catch (e) { /* ignore */ } });
        ['SIGTERM', 'SIGINT', 'SIGHUP'].forEach((s) => process.on(s, () => { lamps.stop(); process.exit(0); }));
        if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => lamps.stop());

        ui.onClick('BTN_LEFT', () => setMode(mode === 'left' ? 'idle' : 'left'));
        ui.onClick('BTN_RIGHT', () => setMode(mode === 'right' ? 'idle' : 'right'));
        ui.onClick('BTN_BOTH', () => setMode(mode === 'both' ? 'idle' : 'both'));
        ui.onClick('BTN_HIGH', () => setMode(mode === 'high' ? 'idle' : 'high'));
        ui.onClick('BTN_FOG', () => setMode(mode === 'fog' ? 'idle' : 'fog'));
        ui.onClick('BTN_DISCO', () => (mode === 'disco' ? hardStop(T.stopped) : startDisco()));
        ui.onClick('BTN_STOP', () => hardStop(T.stopped));

        function carSketch(cv, cx, cy) {
            // top-down car silhouette
            cv.roundRect(cx - 70, cy - 150, 140, 300, 36, COL.panel2);
            cv.roundRect(cx - 52, cy - 120, 104, 70, 14, COL.panel);
            cv.roundRect(cx - 52, cy + 40, 104, 80, 14, COL.panel);
            // cabin glass
            cv.roundRect(cx - 44, cy - 40, 88, 70, 12, '#1e2a3d');
            // lights
            const lamp = (x, y, on, color, w, h) => {
                cv.roundRect(x, y, w, h, 6, on ? color : '#2a3140');
                if (on) cv.roundRect(x - 2, y - 2, w + 4, h + 4, 8, withA(color, 0.25));
            };
            lamp(cx - 78, cy - 148, lit.L, COL.amber, 22, 28);
            lamp(cx + 56, cy - 148, lit.R, COL.amber, 22, 28);
            lamp(cx - 78, cy + 122, lit.L, COL.amber, 22, 28);
            lamp(cx + 56, cy + 122, lit.R, COL.amber, 22, 28);
            lamp(cx - 40, cy - 158, lit.high, COL.white, 28, 14);
            lamp(cx + 12, cy - 158, lit.high, COL.white, 28, 14);
            lamp(cx - 88, cy - 100, lit.fog, '#fff2b0', 16, 20);
            lamp(cx + 72, cy - 100, lit.fog, '#fff2b0', 16, 20);
        }

        function withA(hex, a) {
            const s = hex.replace('#', '');
            const r = parseInt(s.slice(0, 2), 16), g = parseInt(s.slice(2, 4), 16), b = parseInt(s.slice(4, 6), 16);
            return [r, g, b, Math.round(a * 255)];
        }

        function chip(cv, x, y, w, h, label, on, accent) {
            cv.roundRect(x, y, w, h, 14, on ? accent : COL.panel);
            cv.text(label, x + w / 2, y + h / 2 + 8, 26, on ? '#0a0c12' : COL.text, { align: 'center', font: 'bold', literal: true });
        }

        function render() {
            const cv = ctx.canvas(W, H).clear(COL.bg);
            const moving = parked.moving();
            const spd = parked.speed();

            // header
            cv.text('IDRIVE155', 48, 48, 22, COL.accent, { font: 'bold', literal: true });
            cv.text(T.title, 48, 88, 42, COL.text, { font: 'bold', literal: true });
            cv.text(T.subtitle, 48, 122, 20, COL.dim, { literal: true });

            // park badge
            const badge = moving ? T.badgeMove : T.badgePark;
            const badgeC = moving ? COL.red : COL.green;
            cv.roundRect(W - 360, 36, 312, 56, 14, withA(badgeC, 0.18));
            cv.text(badge, W - 204, 72, 24, badgeC, { align: 'center', font: 'bold', literal: true });
            if (spd != null) cv.text(Math.round(spd) + ' km/h', W - 204, 108, 18, COL.faint, { align: 'center', literal: true });

            // car
            carSketch(cv, 280, 300);

            // status
            cv.roundRect(480, 160, 1070, 70, 16, COL.panel);
            cv.text(status, 510, 205, 28, COL.text, { font: 'bold', literal: true });

            // mode chips (visual only — actions are softkeys)
            const row = 270;
            chip(cv, 480, row, 200, 64, T.left, mode === 'left', COL.amber);
            chip(cv, 700, row, 200, 64, T.right, mode === 'right', COL.amber);
            chip(cv, 920, row, 200, 64, T.both, mode === 'both', COL.amber);
            chip(cv, 1140, row, 200, 64, T.high, mode === 'high', COL.white);
            chip(cv, 1360, row, 190, 64, T.fog, mode === 'fog', '#fff2b0');

            chip(cv, 480, 360, 420, 72, mode === 'disco' ? T.discoStop : T.disco, mode === 'disco', COL.accent);
            chip(cv, 920, 360, 300, 72, T.stop, mode !== 'idle', COL.red);

            cv.text(T.hint, 480, 470, 20, COL.faint, { literal: true });
            cv.text(T.limit, 480, 500, 18, COL.faint, { literal: true });

            return ui.image('MAIN_GFX', cv);
        }

        // softkey labels in RHMI come from app.json; keep loop for live park/speed
        ctx.loop('MAIN', 4, () => render());
        log.info('idrive155_lights started (' + lang + ')');
    },
});

function detectLang() {
    try {
        const blob = [process.env.LANG, process.env.LC_ALL, process.env.LANGUAGE].join(' ');
        if (/^hu\b|hu_HU|\.hu\b/i.test(blob)) return 'hu';
    } catch (e) { /* ignore */ }
    return 'hu'; // default Hungarian for this source
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
            left: 'LEFT',
            right: 'RIGHT',
            both: 'BOTH',
            high: 'HIGH',
            fog: 'FOG',
            disco: 'DISCO',
            discoStop: 'DISCO · STOP',
            stop: 'STOP',
            badgePark: 'PARKED',
            badgeMove: 'MOVING',
            hint: 'Use the softkeys under the screen: Left · Right · Both · High · Fog · Disco · Stop',
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
        left: 'BAL',
        right: 'JOBB',
        both: 'MINDKETTŐ',
        high: 'TÁVOLI',
        fog: 'KÖD',
        disco: 'DISCO',
        discoStop: 'DISCO · STOP',
        stop: 'STOP',
        badgePark: 'ÁLLÓ',
        badgeMove: 'MOZOG',
        hint: 'A képernyő alatti softkey-ek: Bal · Jobb · Mindkettő · Távoli · Köd · Disco · Stop',
        limit: 'Magánterület · max 30 mp · elinduláskor leáll',
    };
}
