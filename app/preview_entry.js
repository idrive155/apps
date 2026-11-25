'use strict';
/* entry of both bundles (browser preview, the phone's export page, and the head unit's sideways_core.js) */
const rec = require('../engine/rec');
const text = require('../engine/text');
const { createApp } = require('./core');
const { PRESETS, PAINTS } = require('../car/presets');
const { CarRenderer } = require('../car/render');
const { Cam } = require('../engine/cam');
const W3 = require('../fx/world');
const { Director, plan, FORMATS, CAMERAS } = require('./edit');
const { Clip } = require('./replay');
const theme = require('../ui/theme');
const { qr } = require('../engine/qr');
module.exports = { rec, text, createApp, PRESETS, PAINTS, CarRenderer, Cam, W3, Director, plan, FORMATS, CAMERAS, Clip, theme, qr };
