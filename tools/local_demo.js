#!/usr/bin/env node
'use strict';
/**
 * local_demo.js - run the scoring loop on your Mac without the car or MGU Store.
 *
 *   node tools/local_demo.js
 *   node tools/local_demo.js --seconds 45
 *
 * Prints live angle / chain / multiplier, and M-style stars when a drift banks.
 */
const path = require('path');
const { DemoDriver } = require('../sim/demo');
const { Metrics } = require('../sim/metrics');
const { Score } = require('../sim/score');
const { PRESETS } = require('../car/presets');

const args = process.argv.slice(2);
let seconds = 40;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--seconds' && args[i + 1]) seconds = Math.max(5, Number(args[++i]) || 40);
}

const spec = PRESETS.coupe;
const demo = new DemoDriver(spec);
const metrics = new Metrics(spec);
const score = new Score();
const DT = 1 / 60;
const steps = Math.round(seconds / DT);

function starsBar(n) {
    const full = Math.floor(n), half = n - full >= 0.5 ? 1 : 0;
    return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - half));
}

function line(s) {
    process.stdout.write('\r\x1b[K' + s);
}

console.log('idrive155 Drift — local demo (' + seconds + 's). Ctrl+C to stop.\n');
console.log('angle   chain      xmult   status');
console.log('----------------------------------------');

let lastLog = 0;
for (let i = 0; i < steps; i++) {
    const st = demo.step(DT);
    metrics.update(st, DT);
    score.update(metrics, DT);

    for (const e of score.events) {
        if (e._seen) continue;
        e._seen = true;
        if (e.kind === 'bank') {
            const d = score.lastDrift;
            process.stdout.write('\n');
            console.log('  BANK  ' + e.text + '  +' + e.pts
                + '  ' + starsBar(d.stars) + ' (' + d.stars.toFixed(1) + ')'
                + '  ' + d.time.toFixed(1) + 's  '
                + Math.round(d.distance) + 'm  avg ' + d.avgAngle.toFixed(1) + '°');
        } else if (e.kind === 'lost') {
            process.stdout.write('\n');
            console.log('  LOST  ' + e.text);
        } else if (e.kind === 'skill' || e.kind === 'mult') {
            process.stdout.write('\n');
            console.log('  ' + e.text + (e.pts ? '  +' + e.pts : ''));
        }
    }

    const t = i * DT;
    if (t - lastLog >= 0.1) {
        lastLog = t;
        const ang = metrics.beta;
        const chain = Math.round(score.chain * score.mult);
        const stt = score.drifting ? 'DRIFT' : score.active ? 'grace' : '----';
        line(
            (ang >= 0 ? '+' : '') + ang.toFixed(1).padStart(5) + '°  '
            + String(chain).padStart(7) + '  x' + score.mult.toFixed(1)
            + '   ' + stt
            + '  t=' + t.toFixed(1) + 's'
        );
    }
}

process.stdout.write('\n\n');
console.log('Session');
console.log('  score total     ' + Math.round(score.total));
console.log('  best chain      ' + Math.round(score.best));
console.log('  drifts banked   ' + score.sessionDrifts);
console.log('  best stars      ' + (score.bestStars ? starsBar(score.bestStars) + ' (' + score.bestStars.toFixed(1) + ')' : '—'));
console.log('  performance     ' + score.performance.toFixed(0) + ' deg·s');
console.log('  max angle       ' + score.maxAngle.toFixed(1) + '°');
console.log('\nLive Data vitals (demo sample at end of run):');
{
  const betaDeg = Math.abs(metrics.beta || 0), load = Math.min(1, betaDeg / 40);
  console.log('  coolant  ' + (88 + load * 8).toFixed(0) + ' °C');
  console.log('  oil      ' + (102 + load * 12).toFixed(0) + ' °C');
  console.log('  gearbox  ' + (78 + load * 18).toFixed(0) + ' °C');
  console.log('  boost    ' + (load * 1.35).toFixed(2) + ' bar');
  console.log('  rpm      ' + Math.round(2200 + load * 2800));
}
console.log('\nDone. Full UI on the car: strip + VITALS page (coolant / oil / gearbox / boost).');
