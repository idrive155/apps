'use strict';
/**
 * theme.js - the app's two looks, after the two generations of BMW's own system:
 *
 *   id7  iDrive 7 (OS 7): neutral charcoal, near-black ground, flat dark-grey tiles with small
 *        corners, quiet grey type, BMW blue for what is selected.
 *   id8  iDrive 8 (OS 8): deep blue-black with depth, translucent glass cards with large corners
 *        and a fine light edge, a brighter blue.
 *
 * The HUD is written with one set of colours; tn() maps them into the theme: a dark panel tone
 * keeps its brightness (luminance) and alpha but takes the theme's hue, a cool light line takes
 * the theme's line colour, and anything else (white, accents, warnings) passes through.
 */
const { pk } = require('../engine/rec');
const hexRGB = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

const THEMES = {
    id7: {
        // measured from BMW's own iDrive 7 (OS 7) navigation menu (BMW video still): neutral near-black
        // ground #121212-#181818, cool grey list rows #323138 with light hairlines #4b4951, a darker side
        // panel #252429, white mixed-case text; the focus is NOT blue: a rust gradient (#3a1810 -> #5a1c08)
        // with a bright orange-red line under it (#b76859 in the compressed video, about #d9583a)
        name: 'id7', label: 'iD7',
        hue: [1.0, 0.985, 1.13],
        line: [0.82, 0.81, 0.85],
        accent: hexRGB('#c8502c'), accent2: hexRGB('#e0613f'),
        dim: hexRGB('#a9a7ad'), faint: hexRGB('#77757c'),
        vig: [0.07, 0.07, 0.072],
        radius: 3, edge: 0.07, glass: false,
        // an even ambient: the whole ground a little lifted, no light following the car
        floor: { sky: [0x151517ff, 0x1a1a1dff, 0x232228ff], grid: [0.62, 0.61, 0.66], gridMinor: [0.45, 0.44, 0.48], horizon: [0.55, 0.54, 0.58] },
        pool: [[1, 1, 1, 0.055], [1, 1, 1, 0.05]],   // the overhead light around the car: colourless
        ghost: [0.50, 0.52, 0.56],                   // the ghost car's glow: one steady colour, silver-white
        menu: { bg: '#121212', panel: '#18181b', surf: '#302f36', surf2: '#252429', hair: '#4b4951', selEdge: '#3a1810', selMid: '#5a1c08', selLine: '#d9583a', text2: '#a9a7ad', text3: '#77757c', tab: '#ffffff' },
    },
    id8: {
        name: 'id8', label: 'iD8',
        hue: [0.70, 0.98, 1.75],
        line: [0.62, 0.77, 1.0],
        accent: hexRGB('#2f86ff'), accent2: hexRGB('#4cb6ff'),
        dim: [0.66, 0.73, 0.86], faint: [0.46, 0.53, 0.68],
        vig: [0.008, 0.02, 0.05],
        radius: 14, edge: 0.16, glass: true,
        floor: { sky: [0x060b17ff, 0x0b162cff, 0x112240ff], grid: [0.18, 0.55, 1.0], gridMinor: [0.25, 0.45, 0.8], horizon: [0.40, 0.55, 0.95] },
        pool: [[0.25, 0.42, 0.85, 0.07], [0.6, 0.72, 1.0, 0.06]],
        ghost: [0.12, 0.42, 0.80],                   // the ghost car's glow: the theme's calm blue, steady
        // not measured yet (no iD8 reference image): blue glass, from BMW's published OS 8 material
        menu: { bg: '#060b16', panel: '#0a1322', surf: '#15233c', surf2: '#0f1a2e', hair: '#2b3d5f', selEdge: '#12356f', selMid: '#1d5bc0', selLine: '#6fb6ff', text2: '#a8b6d0', text3: '#6d7c99', tab: '#ffffff' },
    },
};

let TH = THEMES.id7;
function setTheme(name) { TH = THEMES[name] || THEMES.id7; return TH; }
function theme() { return TH; }

/** a colour written for the HUD, mapped into the current theme */
function tn(r, g, b, a) {
    const mx = Math.max(r, g, b);
    if (mx <= 0.42) {
        const L = 0.2126 * r + 0.7152 * g + 0.0722 * b, h = TH.hue;
        return pk(Math.min(1, L * h[0]), Math.min(1, L * h[1]), Math.min(1, L * h[2]), a);
    }
    if (b >= 0.9 && b > r + 0.15 && g < 0.95) {           // a cool light line
        const k = (r + g + b) / (0.6 + 0.72 + 1.0), l = TH.line;
        return pk(Math.min(1, l[0] * k), Math.min(1, l[1] * k), Math.min(1, l[2] * k), a);
    }
    return pk(r, g, b, a);
}
const c = (rgb, a) => pk(rgb[0], rgb[1], rgb[2], a === undefined ? 1 : a);

const hex = (h, a) => { const r = hexRGB(h); return pk(r[0], r[1], r[2], a === undefined ? 1 : a); };

module.exports = { THEMES, setTheme, theme, tn, c, hex };
