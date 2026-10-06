/*!
 * Linear single-track (bicycle) model: state space, stability, frequency
 * response and steady-state gains. MIT License.
 *
 * States x = [v_y, r], input δ_f (road-wheel), rear steer δ_r = k·δ_f.
 * Same sign convention as the nonlinear model (F_y = −C_α·α).
 *
 *   ẋ = A·x + B·δ_f
 *   A = [ −(Cf+Cr)/(m·v)        −v − (a·Cf − b·Cr)/(m·v) ]
 *       [ −(a·Cf − b·Cr)/(Iz·v)  −(a²·Cf + b²·Cr)/(Iz·v)  ]
 *   B = [ (Cf + k·Cr)/m ,  (a·Cf − k·b·Cr)/Iz ]ᵀ
 */
(function (VD) {
  'use strict';

  const { DEG, RAD } = VD.const;

  function matrices(p, v) {
    const { m, Izz: Iz, a, b, Cf, Cr } = p;
    const k = p.rearSteer || 0;
    const A = [
      -(Cf + Cr) / (m * v),
      -v - (a * Cf - b * Cr) / (m * v),
      -(a * Cf - b * Cr) / (Iz * v),
      -(a * a * Cf + b * b * Cr) / (Iz * v),
    ];
    const B = [(Cf + k * Cr) / m, (a * Cf - k * b * Cr) / Iz];
    return { A, B };
  }

  function eig2(A) {
    const tr = A[0] + A[3];
    const det = A[0] * A[3] - A[1] * A[2];
    const disc = (tr * tr) / 4 - det;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return { l: [[tr / 2 + s, 0], [tr / 2 - s, 0]], tr, det };
    }
    const s = Math.sqrt(-disc);
    return { l: [[tr / 2, s], [tr / 2, -s]], tr, det };
  }

  // complex helpers on [re, im]
  const cmul = (x, y) => [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
  const cdiv = (x, y) => {
    const d = y[0] * y[0] + y[1] * y[1];
    return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d];
  };

  /**
   * Transfer functions from steering-wheel angle at s = jω.
   * Returns complex gains: r/δsw [1/s], ay/δsw [(m/s²)/rad], β/δsw [–].
   */
  function tfAt(p, v, w) {
    const { A, B } = matrices(p, v);
    const is = p.steerRatio;
    const s = [0, w];
    const sa = [s[0] - A[0], s[1]];
    const sd = [s[0] - A[3], s[1]];
    const D = [sa[0] * sd[0] - sa[1] * sd[1] - A[1] * A[2], sa[0] * sd[1] + sa[1] * sd[0]];
    // X1 = ((s − a22)·b1 + a12·b2)/Δ,  X2 = (a21·b1 + (s − a11)·b2)/Δ
    const n1 = [sd[0] * B[0] + A[1] * B[1], sd[1] * B[0]];
    const n2 = [A[2] * B[0] + sa[0] * B[1], sa[1] * B[1]];
    const X1 = cdiv(n1, D), X2 = cdiv(n2, D);
    const r = [X2[0] / is, X2[1] / is];
    const ay = [(A[0] * X1[0] + (A[1] + v) * X2[0] + B[0]) / is, (A[0] * X1[1] + (A[1] + v) * X2[1]) / is];
    const beta = [X1[0] / (v * is), X1[1] / (v * is)];
    return { r, ay, beta };
  }

  const mag = (c) => Math.hypot(c[0], c[1]);
  const phase = (c) => Math.atan2(c[1], c[0]);

  /** Frequency response over `freqs` (Hz); phases unwrapped, in degrees. */
  function freqResp(p, v, freqs) {
    const out = { f: freqs.slice(), r: { mag: [], ph: [] }, ay: { mag: [], ph: [] }, beta: { mag: [], ph: [] } };
    const prev = { r: 0, ay: 0, beta: 0 };
    freqs.forEach((f, i) => {
      const tf = tfAt(p, v, 2 * Math.PI * f);
      for (const key of ['r', 'ay', 'beta']) {
        let ph = phase(tf[key]) * RAD;
        if (i > 0) { while (ph - prev[key] > 180) ph -= 360; while (ph - prev[key] < -180) ph += 360; }
        prev[key] = ph;
        out[key].mag.push(mag(tf[key]));
        out[key].ph.push(ph);
      }
    });
    return out;
  }

  /** Steady-state gains per steering-wheel angle (rad/rad based). */
  function steadyGains(p, v) {
    const { A, B } = matrices(p, v);
    const det = A[0] * A[3] - A[1] * A[2];
    const x1 = -(A[3] * B[0] - A[1] * B[1]) / det;
    const x2 = -(-A[2] * B[0] + A[0] * B[1]) / det;
    const is = p.steerRatio;
    return { vy: x1 / is, r: x2 / is, ay: (v * x2) / is, beta: x1 / (v * is), curvature: x2 / (v * is) };
  }

  /** One-stop linear characterisation at speed v (m/s). */
  function analyze(p, v) {
    const { A } = matrices(p, v);
    const e = eig2(A);
    const stable = e.l[0][0] < 0 && e.l[1][0] < 0;
    const wn = e.det > 0 ? Math.sqrt(e.det) : NaN;
    const zeta = e.det > 0 ? -e.tr / (2 * wn) : NaN;
    const ss = steadyGains(p, v);
    // frequency-domain characteristic values (ISO 7401 style)
    const fgrid = [];
    for (let k = 0; k <= 400; k++) fgrid.push(0.01 * Math.pow(10, (k / 400) * 3)); // 0.01–10 Hz
    let peakF = 0, peakMag = 0, bw = NaN;
    const g0 = Math.abs(ss.r);
    for (const f of fgrid) {
      const m = mag(tfAt(p, v, 2 * Math.PI * f).r);
      if (m > peakMag) { peakMag = m; peakF = f; }
      if (Number.isNaN(bw) && m < g0 / Math.SQRT2 && f > peakF) bw = f;
    }
    const tf1 = tfAt(p, v, 2 * Math.PI * 1.0);
    return {
      v, A, eig: e.l, stable, wn, fn: wn / (2 * Math.PI), zeta,
      yawGain: ss.r,                 // (rad/s)/rad  ≡ (deg/s)/deg
      ayGain: ss.ay,                 // (m/s²)/rad
      betaGain: ss.beta,             // rad/rad
      curvGain: ss.curvature,        // (1/m)/rad
      peakFreq: peakF, peakRatio: g0 > 0 ? peakMag / g0 : NaN, bandwidth: bw,
      phaseR1Hz: phase(tf1.r) * RAD, phaseAy1Hz: phase(tf1.ay) * RAD,
    };
  }

  /**
   * Time simulation of the linear model with RK4.
   * swaFn(t) returns the steering-wheel angle in rad. Speed is constant.
   */
  function simulate(p, v, swaFn, tEnd, dt, outEvery) {
    const { A, B } = matrices(p, v);
    const is = p.steerRatio;
    const n = Math.floor(tEnd / dt + 1e-9);
    const every = outEvery || 1;
    const cap = Math.floor(n / every) + 1;
    const res = { t: new Float32Array(cap), r: new Float32Array(cap), vy: new Float32Array(cap),
      ay: new Float32Array(cap), beta: new Float32Array(cap), X: new Float32Array(cap), Y: new Float32Array(cap) };
    let vy = 0, r = 0, X = 0, Y = 0, psi = 0, k = 0;
    const f = (vy_, r_, d) => [A[0] * vy_ + A[1] * r_ + B[0] * d, A[2] * vy_ + A[3] * r_ + B[1] * d];
    const rec = (t, d) => {
      const dvy = A[0] * vy + A[1] * r + B[0] * d;
      res.t[k] = t; res.r[k] = r; res.vy[k] = vy; res.ay[k] = dvy + v * r; res.beta[k] = Math.atan2(vy, v);
      res.X[k] = X; res.Y[k] = Y; k++;
    };
    rec(0, swaFn(0) / is);
    for (let i = 0; i < n; i++) {
      const t = i * dt;
      const d1 = swaFn(t) / is, d2 = swaFn(t + dt / 2) / is, d3 = swaFn(t + dt) / is;
      const k1 = f(vy, r, d1);
      const k2 = f(vy + (dt / 2) * k1[0], r + (dt / 2) * k1[1], d2);
      const k3 = f(vy + (dt / 2) * k2[0], r + (dt / 2) * k2[1], d2);
      const k4 = f(vy + dt * k3[0], r + dt * k3[1], d3);
      const r0 = r;
      vy += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      r += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      const psiMid = psi + 0.5 * dt * (r0 + r) * 0.5;
      X += (v * Math.cos(psiMid) - vy * Math.sin(psiMid)) * dt;
      Y += (v * Math.sin(psiMid) + vy * Math.cos(psiMid)) * dt;
      psi += 0.5 * dt * (r0 + r);
      if ((i + 1) % every === 0 && k < cap) rec(t + dt, d3);
    }
    for (const key in res) res[key] = res[key].subarray(0, k);
    res.n = k;
    return res;
  }

  /** Understeer gradient, characteristic/critical speed (front-steer definition). */
  function understeer(p) {
    const L = p.a + p.b;
    const K = (p.m / L) * (p.b / p.Cf - p.a / p.Cr);
    return { K, Kdeg: K * RAD * VD.const.g, vch: K > 0 ? Math.sqrt(L / K) : NaN, vcrit: K < 0 ? Math.sqrt(-L / K) : NaN };
  }

  VD.linear = { matrices, eig2, tfAt, freqResp, steadyGains, analyze, simulate, understeer, DEG };
})(globalThis.VD = globalThis.VD || {});
