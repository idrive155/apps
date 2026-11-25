'use strict';
/**
 * i18n.js - UI language for IDRIVE155 apps.
 * Follows the head unit language when possible (hu → Hungarian, else English).
 * Keys are the English source strings; t() returns the active translation.
 */
const HU = {
    // brand / headers
    'IDRIVE155 DRIFT ANGLE': 'IDRIVE155 DRIFT SZÖG',
    'IDRIVE155 Drift': 'IDRIVE155 Drift',
    'Drift Analyser': 'Drift elemző',
    'SIDEWAYS': 'IDRIVE155',
    'SIDEWAYS  /  DRIFT ANALYSER': 'IDRIVE155  /  DRIFT ELEMZŐ',

    // drive HUD
    'STRAIGHT': 'EGYENES',
    'LEFT  ‹': 'BAL  ‹',
    '›  RIGHT': '›  JOBB',
    'COUNTER': 'ELLENKORM.',
    'YAW': 'ORRMOZGÁS',
    'LAT': 'OLDAL',
    'SPEED': 'SEBESSÉG',
    'LIVE - CAR': 'ÉLŐ - AUTÓ',
    'DEMO DRIVE': 'DEMO MENET',
    'TYRE SLIP': 'KERÉKCSÚSZÁS',
    'FRONT': 'ELÖL',
    'REAR': 'HÁTUL',
    'TRANSITION': 'ÁTÁLLÁS',
    'STEADINESS': 'STABILITÁS',
    'ACCURACY  ±': 'PONTOSSÁG  ±',
    'GPS': 'GPS',
    'FUSED': 'ÖSSZEFÉSÜLVE',
    'NO FIX': 'NINCS JEL',
    'MAX ANGLE': 'MAX SZÖG',
    'LONGEST': 'LEGHOSZABB',
    'BEST CHAIN': 'LEGJOBB LÁNC',
    'SCORE': 'PONT',
    'DRIFT CHAIN': 'DRIFT LÁNC',
    ' LOST': ' ELVESZETT',
    'NO CAR DATA YET': 'MÉG NINCS AUTÓADAT',
    'Calibrating': 'Kalibrálás',
    'CALIBRATING': 'KALIBRÁLÁS',

    // nav buttons
    'SETTINGS': 'BEÁLLÍTÁSOK',
    'BEST DRIFTS': 'LEGJOBB DRIFTEK',
    'VITALS': 'VITALOK',
    'DRIVE': 'VEZETÉS',

    // vitals
    'Live Data': 'Élő adatok',
    'ARC BANDS  ·  SAME LANGUAGE AS THE DRIFT ANGLE DIAL': 'ÍVES MUTATÓK  ·  UGYANAZ A NYELV, MINT A DRIFT SZÖGNÉL',
    'COOLANT': 'HŰTŐVÍZ',
    'OIL': 'OLAJ',
    'GEARBOX': 'VÁLTÓ',
    'BOOST': 'TURBÓ',
    'RPM': 'FORDULAT',
    'GEAR': 'FOKOZAT',
    'BAR': 'BAR',

    // ratings / events (score.js)
    'NICE': 'SZÉP',
    'GREAT': 'NAGYSZERŰ',
    'AWESOME': 'KIRÁLY',
    'INSANE': 'ŐRÜLET',
    'LEGENDARY': 'LEGENDA',
    'GODLIKE': 'ISTENI',
    'NICE DRIFT': 'SZÉP DRIFT',
    'GREAT DRIFT': 'NAGYSZERŰ DRIFT',
    'AWESOME DRIFT': 'KIRÁLY DRIFT',
    'INSANE DRIFT': 'ŐRÜLET DRIFT',
    'LEGENDARY DRIFT': 'LEGENDA DRIFT',
    'GODLIKE DRIFT': 'ISTENI DRIFT',
    ' DRIFT': ' DRIFT',
    'SPUN OUT': 'KIPÖRGÉS',
    'CHAIN LOST': 'LÁNC ELVESZETT',
    'TRANSITION': 'ÁTÁLLÁS',
    'BIG ANGLE': 'NAGY SZÖG',
    'SPEED DRIFT': 'GYORS DRIFT',
    'LONG DRIFT': 'HOSSZÚ DRIFT',
    'SMOOTH': 'SIMA',
    'FULL LOCK': 'TELJES KORMÁNY',
    'FLICK!': 'FLICK!',
    'CHAIN x': 'LÁNC x',

    // settings
    'Settings': 'Beállítások',
    'Done': 'Kész',
    'Close': 'Bezárás',
    'CLOSE': 'BEZÁRÁS',
    'OK': 'OK',
    'TRY AGAIN': 'ÚJRA',
    'Try again': 'Újra',
    'Reset': 'Nullázás',
    'Car': 'Autó',
    'Driving': 'Vezetés',
    'Drive': 'Vezetés',
    'App': 'App',
    'Display': 'Kijelző',
    'About': 'Névjegy',
    'off': 'ki',
    'auto': 'auto',
    'kmh': 'km/h',
    'Body': 'Karosszéria',
    'Drivetrain': 'Hajtás',
    'Steering ratio': 'Kormánymű áttétel',
    'Data': 'Adat',
    'Demo drive': 'Demo menet',
    'Live car': 'Élő autó',
    'GPS fusion': 'GPS összeolvasztás',
    'Auto': 'Auto',
    'Off': 'Ki',
    'On': 'Be',
    'Units': 'Egység',
    'Session': 'Menet',
    'Design': 'Dizájn',
    'Graphics': 'Grafika',
    'Version': 'Verzió',
    'Language': 'Nyelv',
    'From the car': 'Az autóból',
    'Auto: ': 'Auto: ',
    'This car: ': 'Ez az autó: ',
    'Now: light': 'Most: könnyű',
    'Now: full': 'Most: teljes',
    'Full': 'Teljes',
    'Light': 'Könnyű',
    'Best ': 'Legjobb ',
    'RWD': 'Hátsókerék',
    'AWD': 'Összkerék',
    'iDrive 7': 'iDrive 7',
    'iDrive 8': 'iDrive 8',
    'km/h': 'km/h',
    'mph': 'mph',
    'KM/H': 'KM/H',
    'MPH': 'MPH',
    'Sideways ': 'IDRIVE155 ',
    'Coupe': 'Kupé',
    'Sedan': 'Sedan',
    'Cabrio': 'Cabrio',
    'Roadster': 'Roadster',
    'SUV': 'SUV',

    // history / replay / edit
    'REPLAY': 'VISSZAJÁTSZÁS',
    'DRIVER  ': 'VERSENYZŐ  ',
    'Edit': 'Szerkesztés',
    'Back': 'Vissza',
    'Export video': 'Videó export',
    'Format': 'Formátum',
    'Camera': 'Kamera',
    'Slow motion': 'Lassítás',
    'Length': 'Hossz',
    'Overlay': 'Átfedés',
    'Chase': 'Követő',
    'Top': 'Felülnézet',
    'Top wide': 'Magas felülnézet',
    'At the peak': 'Csúcspontnál',
    'The drift': 'A drift',
    'Whole clip': 'Teljes klip',
    'SLOW MOTION  ': 'LASSÍTÁS  ',
    'one camera, fixed': 'egy kamera, fix',
    ' s  /  one camera, fixed': ' s  /  egy kamera, fix',

    // share / export
    'Preparing your video': 'Videó előkészítése',
    'One moment.': 'Egy pillanat.',
    'Making the video': 'Videó készítése',
    'It is saved by itself': 'Magától mentődik',
    'when it is ready.': 'amikor kész.',
    'Saved': 'Mentve',
    'The video is in your downloads.': 'A videó a letöltésekben van.',
    'Could not make it': 'Nem sikerült',
    'Scan with your phone': 'Olvasd be a telefonnal',
    'On your phone': 'A telefonodon',
    'The video is saved.': 'A videó elmentve.',
    'The link is deleted.': 'A link törlődött.',
    'The link expired': 'A link lejárt',
    'It was not opened in time.': 'Nem nyitottad meg időben.',
    'Make a new one.': 'Készíts újat.',
    'Export unavailable': 'Export nem elérhető',
    'This car cannot export video here.': 'Ez az autó itt nem tud videót exportálni.',
    'Video export needs a local': 'A videóexporthoz helyi',
    'export host (browser preview).': 'export szerver kell (böngésző előnézet).',
    'Too long': 'Túl hosszú',
    'Choose Length: The drift,': 'Válaszd: Hossz → A drift,',
    'then try again.': 'majd próbáld újra.',
    'Something went wrong': 'Valami hiba történt',
    'Edit again': 'Újra szerkesztés',
    ' VIDEO  /  THE LINK DELETES ITSELF IN ': ' VIDEÓ  /  A LINK MAGÁTÓL TÖRLŐDIK ',

    // popups
    'SOMETHING WENT WRONG': 'VALAMI HIBA TÖRTÉNT',
    'The app hit an error and recovered: ': 'Az app hibázott, de helyreállt: ',
    '. It keeps running; if this comes back, restart it.': '. Tovább fut; ha újra előjön, indítsd újra.',
    'Reset session?': 'Nullázod a menetet?',
    'Best score and angle for this session will be cleared.': 'A menet legjobb pontja és szöge törlődik.',
    'Demo drive unlocked': 'Demo menet feloldva',
    'You can switch to Demo drive in Settings → Data.': 'A Beállítások → Adat menüben válthatsz Demo menetre.',

    // history sheet
    'pts': 'pont',
    'No drifts yet': 'Még nincs drift',
    'Go drive. Your best chains land here.': 'Menj driftelni. A legjobb láncok ide kerülnek.',
    'NO DRIFTS SAVED YET: BANK A CHAIN ON LIVE CAR DATA AND IT APPEARS HERE': 'MÉG NINCS MENTETT DRIFT: ÉLŐ ADATTAL ZÁRJ EGY LÁNCOT, ÉS ITT MEGJELENIK',
    'SAVED ON THIS CAR  ·  LIVE DRIVES ONLY': 'ERRE AZ AUTÓRA MENTVE  ·  CSAK ÉLŐ MENET',
    'JUST NOW': 'MOST',
    ' MIN AGO': ' PERCE',
    ' H AGO': ' ÓRÁJA',
    ' DAYS AGO': ' NAPJA',
    'PLAY': 'PLAY',
    'PAUSE': 'SZÜNET',
    'EXIT': 'KI',
    'EDIT VIDEO': 'VIDEÓ',
    'TOP WIDE': 'MAGAS FELÜLNÉZET',
    'CHASE': 'KÖVETŐ',
    'TOP': 'FELÜLNÉZET',
    'FREE': 'SZABAD',
    'DRAG TO ORBIT  /  + - TO ZOOM': 'HÚZD A FORGATÁSHOZ  /  + - A ZOOMHOZ',
    'DRAG THE CAR TO LOOK AROUND': 'HÚZD AZ AUTÓT A KÖRÜLNÉZÉSHEZ',
    'Play': 'Lejátszás',
    'Delete': 'Törlés',
    'Clear all': 'Összes törlése',
    'CAR': 'AUTÓ',
    'DRIVING': 'VEZETÉS',
    'APP': 'APP',
    '°/S SWING': '°/S LENDÜLET',

    // language options
    'Magyar': 'Magyar',
    'English': 'English',
};

const EN = {}; // identity via fallback

let lang = 'en';
let dict = EN;

function normalizeLang(code) {
    if (!code) return null;
    const s = String(code).trim().toLowerCase().replace('_', '-');
    if (s === 'hu' || s.indexOf('hu-') === 0 || s.indexOf('hungarian') >= 0) return 'hu';
    if (s === 'en' || s.indexOf('en-') === 0) return 'en';
    return null;
}

function readFile(path) {
    try {
        const fs = require('fs');
        return fs.readFileSync(path, 'utf8');
    } catch (e) { return ''; }
}

/** Detect head-unit / host language. Prefer explicit override, then env / HMI files. */
function detect(host) {
    host = host || {};
    const forced = normalizeLang(host.lang || host.language);
    if (forced) return forced;

    if (typeof process !== 'undefined' && process.env) {
        const blob = [process.env.LANG, process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANGUAGE, process.env.HMI_LANGUAGE, process.env.BMW_LANGUAGE].join(' ');
        const fromEnv = normalizeLang(blob.split(/[.:;\s]/)[0]) || (/hu/i.test(blob) ? 'hu' : null);
        if (fromEnv) return fromEnv;
    }

    // common places on MGU / Linux images
    const paths = [
        '/etc/locale.conf',
        '/etc/default/locale',
        '/var/opt/sys/locale',
        '/var/opt/sys/language',
        '/opt/bmw/hmi/language',
        '/etc/hu_language',
    ];
    for (let i = 0; i < paths.length; i++) {
        const txt = readFile(paths[i]);
        if (!txt) continue;
        if (/LANG\s*=\s*["']?hu/i.test(txt) || /\bhu[_-]HU\b/i.test(txt) || /^\s*hu\b/im.test(txt)) return 'hu';
        const m = txt.match(/LANG\s*=\s*["']?([A-Za-z_]+)/);
        const n = normalizeLang(m && m[1]);
        if (n) return n;
    }

    try {
        // dynamic path so the web bundler does not pull kit/locale.json
        const kit = require('../kit/' + 'locale.json');
        const n = normalizeLang(kit && kit.language);
        if (n) return n;
    } catch (e) { /* no kit locale in preview */ }

    if (typeof navigator !== 'undefined' && navigator.language) {
        const n = normalizeLang(navigator.language);
        if (n) return n;
    }
    return 'en';
}

function setLang(code) {
    lang = normalizeLang(code) || 'en';
    dict = lang === 'hu' ? HU : EN;
    return lang;
}

function getLang() { return lang; }

function t(s) {
    if (s == null) return '';
    const key = String(s);
    if (lang === 'en') return key;
    if (Object.prototype.hasOwnProperty.call(dict, key)) return dict[key];
    const low = key.toLowerCase();
    for (const k in HU) if (k.toLowerCase() === low) return HU[k];
    // "NICE DRIFT", "CHAIN x2.0", "12 MIN AGO", "Auto: Coupe"
    if (/ DRIFT$/i.test(key)) {
        const base = key.replace(/ DRIFT$/i, '');
        return t(base) + (dict[' DRIFT'] || ' DRIFT');
    }
    if (/^CHAIN x/i.test(key)) return key.replace(/^CHAIN x/i, dict['CHAIN x'] || 'LÁNC x');
    if (/^Auto: /i.test(key)) return (dict['Auto: '] || 'Auto: ') + t(key.slice(6));
    if (/^Best /i.test(key)) return (dict['Best '] || 'Best ') + key.slice(5);
    if (/^This car: /i.test(key)) return (dict['This car: '] || 'This car: ') + key.slice(10);
    if (/ MIN AGO$/i.test(key)) return key.replace(/ MIN AGO$/i, dict[' MIN AGO'] || ' MIN AGO');
    if (/ H AGO$/i.test(key)) return key.replace(/ H AGO$/i, dict[' H AGO'] || ' H AGO');
    if (/ DAYS AGO$/i.test(key)) return key.replace(/ DAYS AGO$/i, dict[' DAYS AGO'] || ' DAYS AGO');
    if (/ VIDEO  \/  THE LINK DELETES ITSELF IN /i.test(key)) {
        return key.replace(/ VIDEO  \/  THE LINK DELETES ITSELF IN /i, dict[' VIDEO  /  THE LINK DELETES ITSELF IN '] || ' VIDEO  /  THE LINK DELETES ITSELF IN ');
    }
    if (/ s  \/  one camera, fixed$/i.test(key)) {
        return key.replace(/ s  \/  one camera, fixed$/i, dict[' s  /  one camera, fixed'] || ' s  /  one camera, fixed');
    }
    return key;
}

/** Patch engine/text so every drawn label follows the active language. */
function install(textApi) {
    if (!textApi || textApi.__i18n) return textApi;
    const _text = textApi.text, _width = textApi.width;
    textApi.text = (rec, f, str, x, y, c, align, track, scale) => _text(rec, f, t(str), x, y, c, align, track, scale);
    textApi.width = (f, str, track) => _width(f, t(str), track);
    textApi.__i18n = true;
    return textApi;
}


/** Translate a rating token (NICE…) then optional " DRIFT" suffix. */
function tRating(name) {
    const base = t(String(name || 'NICE'));
    return base;
}

module.exports = { t, tRating, setLang, getLang, detect, install, HU };
