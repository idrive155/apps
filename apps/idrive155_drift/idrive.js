'use strict';
/**
 * idrive.js - which iDrive generation the head unit is: 'id7' (MGU, OS 7) or 'id8' (MGU22 and
 * later, OS 8 / 8.5). Read once at start, used for the app's first look only (the driver can
 * change it in the settings, and that choice is kept).
 *
 * The unit is identified from text it carries about itself: SIDEWAYS_IDRIVE=id7|id8 first (set it
 * to override), then the system's own description files. A file naming MGU22, IDC23 or iDrive 8
 * means id8; one naming the MGU (iDrive 7) means id7. Nothing found: id7, because the app kit it
 * runs on (idrive7-apps) is made for iDrive 7 units. tools/probe_car.sh prints the same files, so
 * a unit this does not recognise can be added.
 */
const fs = require('fs');

const FILES = ['/etc/os-release', '/etc/version', '/etc/sw_version', '/etc/hostname', '/etc/issue', '/proc/device-tree/model',
    '/etc/hu_variant', '/etc/build_info', '/opt/sys/etc/version', '/var/opt/sys/hu_info'];
const ID8 = /MGU[-_ ]?22|IDC[-_ ]?23|MGU[-_ ]?24|i?Drive[-_ ]?8|\bOS[-_ ]?8(\.5)?\b|\bID8\b/i;
const ID7 = /\bMGU\b(?![-_ ]?2[2-9])|MGU[-_ ]?(18|21)\b|i?Drive[-_ ]?7|\bID7\b|\bOS[-_ ]?7\b/i;

function generation(env, read) {
    env = env || process.env;
    read = read || ((f) => { try { return fs.readFileSync(f, 'utf8').slice(0, 4096); } catch (e) { return ''; } });
    const forced = String(env.SIDEWAYS_IDRIVE || '').toLowerCase();
    if (forced === 'id7' || forced === 'id8') return { gen: forced, why: 'SIDEWAYS_IDRIVE' };
    let seen7 = null;
    for (const f of FILES) {
        const t = read(f); if (!t) continue;
        if (ID8.test(t)) return { gen: 'id8', why: f };
        if (!seen7 && ID7.test(t)) seen7 = f;
    }
    return seen7 ? { gen: 'id7', why: seen7 } : { gen: 'id7', why: 'default: the idrive7-apps kit' };
}

module.exports = { generation, FILES };
