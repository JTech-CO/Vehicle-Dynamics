/*!
 * Vehicle Dynamics Workbench — core namespace and math helpers
 * (c) Vehicle Dynamics Workbench contributors, MIT License
 *
 * Every core file attaches itself to the global `VD` namespace so the app runs
 * from file:// without a bundler, and the same files load unchanged in Node
 * for the test suite.
 */
(function (VD) {
  'use strict';

  const DEG = Math.PI / 180;

  VD.version = '1.0.0';

  VD.const = Object.freeze({
    g: 9.81,          // m/s², same value as MATLAB Vehicle Dynamics Blockset
    DEG: DEG,         // rad per degree
    RAD: 1 / DEG,     // degree per rad
    KPH: 1 / 3.6,     // m/s per km/h
  });

  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  VD.util = {
    clamp,
    lerp: (a, b, t) => a + (b - a) * t,
    sign: (x) => (x > 0 ? 1 : x < 0 ? -1 : 0),
    /** Saturating unit function used to regularise sign() near zero. */
    sat: (x) => clamp(x, -1, 1),
    wrapAngle(a) {
      a = (a + Math.PI) % (2 * Math.PI);
      if (a < 0) a += 2 * Math.PI;
      return a - Math.PI;
    },
    linspace(a, b, n) {
      if (n < 2) return [a];
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = a + ((b - a) * i) / (n - 1);
      return out;
    },
    /** Linear interpolation on an ascending grid, clamped at both ends. */
    interp1(xs, ys, x) {
      const n = xs.length;
      if (n === 0) return NaN;
      if (x <= xs[0]) return ys[0];
      if (x >= xs[n - 1]) return ys[n - 1];
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (xs[mid] <= x) lo = mid; else hi = mid;
      }
      const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
      return ys[lo] + (ys[hi] - ys[lo]) * t;
    },
    /** Least-squares line y = a + b·x. Returns {a, b, r2, n}. */
    linregress(xs, ys) {
      const n = xs.length;
      if (n < 2) return { a: NaN, b: NaN, r2: NaN, n };
      let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
      }
      const den = n * sxx - sx * sx;
      if (Math.abs(den) < 1e-300) return { a: NaN, b: NaN, r2: NaN, n };
      const b = (n * sxy - sx * sy) / den;
      const a = (sy - b * sx) / n;
      const ssTot = syy - (sy * sy) / n;
      let ssRes = 0;
      for (let i = 0; i < n; i++) { const e = ys[i] - (a + b * xs[i]); ssRes += e * e; }
      return { a, b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, n };
    },
    deepClone: (o) => JSON.parse(JSON.stringify(o)),
  };
})(globalThis.VD = globalThis.VD || {});
