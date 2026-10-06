/*!
 * Signal post-processing helpers for test metrics. MIT License.
 * All functions take sample arrays on an ascending time base.
 */
(function (VD) {
  'use strict';

  const { interp1 } = VD.util;

  function idxAt(t, tq) {
    let lo = 0, hi = t.length - 1;
    if (tq <= t[0]) return 0;
    if (tq >= t[hi]) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tq) lo = m; else hi = m; }
    return lo;
  }

  const at = (t, y, tq) => (tq < t[0] || tq > t[t.length - 1] + 1e-9 ? NaN : interp1(t, y, tq));

  function mean(t, y, t0, t1) {
    let s = 0, n = 0;
    for (let i = 0; i < t.length; i++) if (t[i] >= t0 && t[i] <= t1) { s += y[i]; n++; }
    return n ? s / n : NaN;
  }

  /** First time y crosses `level` in direction dir (+1 rising, −1 falling) after tStart. */
  function crossTime(t, y, level, tStart, dir) {
    const d = dir || 1;
    for (let i = Math.max(1, idxAt(t, tStart)); i < t.length; i++) {
      if (t[i - 1] < tStart) continue;
      const a = d * (y[i - 1] - level), b = d * (y[i] - level);
      if (a < 0 && b >= 0) return t[i - 1] + ((t[i] - t[i - 1]) * -a) / (b - a || 1);
    }
    return NaN;
  }

  /** Extreme of sgn·y in [t0, t1]. Returns {t, v, i} with v in original sign. */
  function peak(t, y, t0, t1, sgn) {
    const s = sgn || 1;
    let best = -Infinity, bi = -1;
    for (let i = 0; i < t.length; i++) {
      if (t[i] < t0 || t[i] > t1) continue;
      if (s * y[i] > best) { best = s * y[i]; bi = i; }
    }
    return bi < 0 ? { t: NaN, v: NaN, i: -1 } : { t: t[bi], v: y[bi], i: bi };
  }

  /**
   * First local extremum of sgn·y after tStart whose magnitude exceeds
   * `minAbs`. Falls back to the global extreme in [tStart, tEnd].
   */
  function firstLocalPeak(t, y, tStart, tEnd, sgn, minAbs) {
    const s = sgn || 1;
    for (let i = Math.max(1, idxAt(t, tStart)); i < t.length - 1 && t[i] <= tEnd; i++) {
      const v = s * y[i];
      if (v > (minAbs || 0) && v >= s * y[i - 1] && v > s * y[i + 1]) return { t: t[i], v: y[i], i };
    }
    return peak(t, y, tStart, tEnd, s);
  }

  /** Least-squares fit y ≈ c + a·sin(ωt) + b·cos(ωt) over [t0, t1]. */
  function sineFit(t, y, f, t0, t1) {
    const w = 2 * Math.PI * f;
    // normal equations for [c, a, b]
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], R = [0, 0, 0];
    for (let i = 0; i < t.length; i++) {
      if (t[i] < t0 || t[i] > t1) continue;
      const row = [1, Math.sin(w * t[i]), Math.cos(w * t[i])];
      for (let j = 0; j < 3; j++) { R[j] += row[j] * y[i]; for (let k = 0; k < 3; k++) S[j][k] += row[j] * row[k]; }
    }
    const x = solve3(S, R);
    if (!x) return { amp: NaN, phase: NaN, offset: NaN };
    return { amp: Math.hypot(x[1], x[2]), phase: Math.atan2(x[2], x[1]), offset: x[0] };
  }

  function solve3(A, b) {
    const M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  function maxAbs(t, y, t0, t1) {
    let m = 0;
    for (let i = 0; i < t.length; i++) if (t[i] >= (t0 ?? -Infinity) && t[i] <= (t1 ?? Infinity)) m = Math.max(m, Math.abs(y[i]));
    return m;
  }

  /** Samples (x, y) where the gate signal g lies in [lo, hi] (and t ≥ tMin). */
  function selectRange(t, x, y, gsig, lo, hi, tMin) {
    const xs = [], ys = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] < (tMin || -Infinity)) continue;
      if (gsig[i] >= lo && gsig[i] <= hi) { xs.push(x[i]); ys.push(y[i]); }
    }
    return { xs, ys };
  }

  const wrapDeg = (d) => { let x = ((d + 180) % 360 + 360) % 360 - 180; return x; };

  VD.metrics = { idxAt, at, mean, crossTime, peak, firstLocalPeak, sineFit, maxAbs, selectRange, wrapDeg };
})(globalThis.VD = globalThis.VD || {});
