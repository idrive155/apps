'use strict';
/**
 * presets.js - body styles. Dimensions in metres; cabin positions in the car frame
 * (x forward from the middle of the wheelbase). Each is close to a real car of that class,
 * named after the class; users can override any field (settings: length, width, wheelbase...).
 *
 * xWsBase: base of the windscreen, xWsTop: top of it, xRoofEnd: where the rear glass (or top)
 * starts falling, xDeckEnd: where it meets the trunk lid.
 */
const BASE = {
    rocker: 0.19, belt: 0.95, deck: 0.99, cowl: 0.95, nose: 0.64, roofW: 0.70,
    wheel: { r: 0.335, rim: 0.245, wf: 0.255, wr: 0.275, trackF: 1.60, trackR: 1.61, spokes: 5 },
    exhaust: 'dual', softTop: false, fastback: false, dloBack: 0, rearSeats: true, rhd: false, bPillar: null, thirdLight: true,
};
function mk(o) { return Object.assign({}, BASE, o, { wheel: Object.assign({}, BASE.wheel, o.wheel || {}) }); }

const { specOf } = require('./model');

/* The bodies: coupe, sedan, cabrio, roadster and SUV (assets/models/*.js), drawn with the renderer's own wheels. */
const body = (data, extra) => specOf(data, Object.assign({ exhaust: 'quad', rearSeats: true }, extra));
const coupe = body(require('../assets/models/coupe'), { name: 'Coupe' });
const sedan = body(require('../assets/models/sedan'), { name: 'Sedan' });
const PRESETS = {
    coupe,
    sedan,
    cabrio: body(require('../assets/models/cabrio'), { name: 'Cabrio', softTop: true, open: true }),
    roadster: body(require('../assets/models/roadster'), { name: 'Roadster', softTop: true, open: true, rearSeats: false }),
    suv: body(require('../assets/models/suv'), { name: 'SUV', exhaust: 'dual' }),
    // earlier body styles, kept so that saved settings still find a car
    compact: Object.assign({}, coupe, { hidden: true }),
    touring: Object.assign({}, sedan, { hidden: true }),
    hatch: Object.assign({}, sedan, { hidden: true }),
};
/** the bodies offered in the settings, in order */
const BODIES = ['coupe', 'sedan', 'cabrio', 'roadster', 'suv'];

const PAINTS = {
    'White': [0.80, 0.81, 0.82, 0.10],
    'Black': [0.010, 0.012, 0.016, 0.55],
    'Grey': [0.24, 0.26, 0.28, 0.35],
    'Deep blue': [0.020, 0.090, 0.42, 0.55],
    'Bright blue': [0.035, 0.16, 0.55, 0.45],
    'Red': [0.42, 0.012, 0.018, 0.40],
    'Yellow': [0.78, 0.55, 0.02, 0.25],
    'Green': [0.012, 0.16, 0.10, 0.55],
    'Purple': [0.10, 0.025, 0.20, 0.60],
    'Matte black': [0.030, 0.030, 0.034, 0.02],
};

module.exports = { PRESETS, PAINTS, BODIES };
