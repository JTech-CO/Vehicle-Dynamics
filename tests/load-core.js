// Loads the browser core files into Node's global scope (same order as index.html).
'use strict';
const path = require('path');
const FILES = ['vd.js', 'params.js', 'tire.js', 'model.js', 'linear.js', 'control.js', 'sim.js', 'metrics.js', 'maneuvers.js'];
for (const f of FILES) require(path.join(__dirname, '..', 'src', 'core', f));
module.exports = globalThis.VD;
