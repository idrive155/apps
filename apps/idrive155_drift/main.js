'use strict';
/**
 * IDRIVE155 Drift on the iDrive 7 / 8 head unit (MGU).
 *
 * The kit gives the app its HMI entry, its screen and the car's signals; the drawing goes to
 * mgu-render over our own connection (rclient.js): a full layer over the app's area at the
 * display's rate, touch claimed for the whole area. The HMI's back arrow stays the HMI's.
 * Without mgu-render installed the screen says so (the kit's software canvas, 1 fps).
 */
const fs = require('fs');
const path = require('path');
const APP_ID = 'idrive155_drift';
// the kit's own display must not open a second renderer connection
process.env.MGU_RENDERD_SOCKET = '/run/' + APP_ID + '-no-kit-renderer';
const mgu = require('./kit/mgu');
const core = require('./app_core');
const { RenderConn } = require('./rclient');
const { Live } = require('./live');
const { Vitals } = require('./vitals');
const { generation } = require('./idrive');

mgu.run({
    async start(ctx) {
        const log = ctx.log;
        const file = (k) => path.join(ctx.dataDir, k + '.json');
        const pending = {}, timers = {};
        const writeNow = (k) => {
            if (pending[k] === undefined) return;
            const text = pending[k]; delete pending[k]; clearTimeout(timers[k]);
            try { const tmp = file(k) + '.tmp', fd = fs.openSync(tmp, 'w'); try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(tmp, file(k)); }
            catch (e) { log.warn('save ' + k + ': ' + e); }
        };
        const flush = () => Object.keys(pending).forEach(writeNow);
        process.on('exit', flush);
        ['SIGTERM', 'SIGINT', 'SIGHUP'].forEach((s) => process.on(s, () => { flush(); process.exit(0); }));
        if (ctx.app && ctx.app.on) ctx.app.on('shutdown', flush);

        process.on('uncaughtException', (e) => { try { log.warn('uncaught: ' + (e && e.stack ? String(e.stack).split('\n').slice(0, 3).join(' | ') : e)); } catch (x) { /* logging itself failed */ } });
        process.on('unhandledRejection', (e) => { try { log.warn('unhandled rejection: ' + (e && e.message || e)); } catch (x) { /* ditto */ } });
        const gen = generation();
        log.info('iDrive generation: ' + gen.gen + ' (' + gen.why + ')');
        const app = core.createApp({
            log,
            idrive: gen.gen,
            load: (k) => { try { return JSON.parse(fs.readFileSync(file(k), 'utf8')); } catch (e) { return null; } },
            save: (k, v) => {
                if (v === null) { clearTimeout(timers[k]); delete pending[k]; try { fs.unlinkSync(file(k)); } catch (e) { /* not there */ } return; }
                pending[k] = JSON.stringify(v); clearTimeout(timers[k]); timers[k] = setTimeout(() => writeNow(k), 400);
            },
        });
        const live = new Live(ctx, log, core.PRESETS[app.settings.preset] || core.PRESETS.coupe, (s) => app.input(s), (f) => app.gps(f));
        const vitals = new Vitals(ctx, log);
        let vitalsPush = 0;
        live.onVehicle = (t) => { log.info('vehicle type: ' + JSON.stringify(t)); app.vehicle(t); };

        const rc = new RenderConn(APP_ID, log, core);
        const R = new core.rec.Rec(1 << 17);
        let last = process.hrtime(), shown = false, n = 0, spent = 0;
        rc.on('tick', () => {
            if (!shown) return;
            const t = process.hrtime(), dt = (t[0] - last[0]) + (t[1] - last[1]) / 1e9; last = t;
            vitalsPush += dt;
            if (vitalsPush >= 0.1) { vitalsPush = 0; app.vitals(vitals.snapshot()); }
            const a = process.hrtime();
            app.frame(R, dt, rc.W, rc.H);
            try { rc.frame(R); } catch (e) { log.warn('renderer: ' + e); }
            const d = process.hrtime(a); spent += d[0] * 1e3 + d[1] / 1e6;
            if (++n % 600 === 0) { log.info('frame ' + (spent / 600).toFixed(2) + ' ms JS, ' + R.n + ' words, renderer ' + rc.stats.frames + ' fps ' + (rc.stats.avgUs / 1000).toFixed(2) + ' ms'); spent = 0; }
        });
        const kick = () => { if (shown && rc.ready) { last = process.hrtime(); app.frame(R, 1 / 60, rc.W, rc.H); try { rc.frame(R); } catch (e) { log.warn('renderer: ' + e); } } };
        rc.on('ready', kick);
        rc.on('touch', (phase, x, y) => app.touch(phase, x, y));
        rc.on('closed', () => { log.info('HMI touched outside: hidden'); });
        ctx.ui.onVisible((name, on) => {
            if (name !== 'MAIN') return;
            shown = on; live.active = on; rc.show(on);
            if (on) kick();
            log.info('screen ' + (on ? 'open' : 'closed'));
        });
        ctx.loop('MAIN', 1, () => {
            if (rc.ready) return null;
            const cv = ctx.canvas(1600, 520).clear('#05070c');
            cv.text('IDRIVE155 Drift needs mgu-render', 800, 230, 44, '#ffffff', { align: 'center', font: 'bold' });
            cv.text('Install it from the MGU Store, then open the app again.', 800, 300, 28, '#9fb4d8', { align: 'center' });
            return ctx.ui.image('MAIN_GFX', cv);
        });
        process.on('exit', () => rc.close());
        log.info(APP_ID + ' started');
    },
});
