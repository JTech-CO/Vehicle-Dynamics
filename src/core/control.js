/*!
 * Driver and vehicle controllers. MIT License.
 *  - SpeedController : PI longitudinal controller with drag feed-forward
 *  - PathFollower    : pure-pursuit steering with cross-track integral and
 *                      first-order driver lag
 *  - ESC             : yaw-rate tracking by single-wheel braking
 */
(function (VD) {
  'use strict';

  const { g, DEG } = VD.const;
  const { clamp } = VD.util;

  class SpeedController {
    constructor(model, kp = 1.5, ki = 0.4) {
      this.model = model; this.kp = kp; this.ki = ki; this.I = 0;
    }
    reset() { this.I = 0; }
    /** Writes throttle/brake into u for target speed vRef (m/s). */
    update(vRef, s, u, dt) {
      const M = this.model.M;
      const vx = s[3];
      const e = vRef - vx;
      this.I = clamp(this.I + e * dt, -5, 5);
      const ff = 0.5 * M.rho * M.CdA * vx * Math.abs(vx) + M.fr * M.m * g * Math.sign(vx);
      const F = M.m * (this.kp * e + this.ki * this.I) + ff;
      if (F >= 0) {
        const avail = this.model.availableDrive(vx, 1);
        u.throttle = avail > 0 ? clamp(F / avail, 0, 1) : 0; u.brake = 0;
      } else {
        u.throttle = 0; u.brake = clamp(-F / M.FbMax, 0, 1);
      }
      u.gear = 1;
    }
  }

  /** Polyline path with arc length, heading and (smoothed) curvature per node. */
  function makePath(xs, ys) {
    const n = xs.length;
    const s = new Float64Array(n), th = new Float64Array(n), k = new Float64Array(n);
    for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      th[i] = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]);
    }
    for (let i = 1; i < n; i++) {           // unwrap heading
      while (th[i] - th[i - 1] > Math.PI) th[i] -= 2 * Math.PI;
      while (th[i] - th[i - 1] < -Math.PI) th[i] += 2 * Math.PI;
    }
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      raw[i] = (th[b] - th[a]) / Math.max(s[b] - s[a], 1e-9);
    }
    // moving average over ±1 m of arc length
    for (let i = 0, j0 = 0, j1 = 0, acc = 0; i < n; i++) {
      while (j1 < n && s[j1] <= s[i] + 1) acc += raw[j1++];
      while (s[j0] < s[i] - 1) acc -= raw[j0++];
      k[i] = acc / (j1 - j0);
    }
    return { x: Float64Array.from(xs), y: Float64Array.from(ys), s, th, k, length: s[n - 1] };
  }

  function locateS(path, sq) {
    const s = path.s, n = s.length;
    if (sq <= 0) return [0, 0];
    if (sq >= s[n - 1]) return [n - 2, 1 + (sq - s[n - 1]) / Math.max(s[n - 1] - s[n - 2], 1e-9)];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= sq) lo = m; else hi = m; }
    return [lo, (sq - s[lo]) / (s[hi] - s[lo] || 1)];
  }

  function pathPointAt(path, sq) {
    const [i, t] = locateS(path, sq);
    return [path.x[i] + (path.x[i + 1] - path.x[i]) * t, path.y[i] + (path.y[i + 1] - path.y[i]) * t];
  }

  function pathValueAt(path, arr, sq) {
    const [i, t] = locateS(path, sq);
    const tc = clamp(t, 0, 1);
    return arr[i] + (arr[i + 1] - arr[i]) * tc;
  }

  /**
   * Path-following driver: curvature feed-forward with preview plus
   * look-ahead lateral-error feedback, then a first-order neuromuscular lag
   * and steering-rate limit.
   *
   *   δ = (L + K_us·v²)·κ(s + v·T_ff)  −  k_a·(L + K_us·v²)/v² · (e_y + x_la·sin e_ψ)  −  k_i∫e_y
   *
   * The feedback gain is expressed as a lateral-acceleration "spring" k_a so it
   * scales with the vehicle's own steady-state steering sensitivity.
   */
  class PathFollower {
    /**
     * @param opts { Tff: curvature preview (s), ka: feedback (1/s²), xla: look-ahead time (s),
     *               tau: driver lag (s), rate: max SWA rate (rad/s), ki: cross-track integral gain (rad/(m·s)) }
     */
    constructor(model, path, opts) {
      this.model = model; this.path = path;
      this.o = Object.assign({ Tff: 0.25, ka: 4, xla: 0.5, tau: 0.1, rate: 1000 * DEG, ki: 0 }, opts || {});
      this.reset();
    }
    reset() { this.idx = 0; this.swa = 0; this.I = 0; this.ey = 0; this.epsi = 0; this.sNear = 0; }

    /** Signed lateral offset of point (px, py) from the path (left = +) and arc position. */
    locate(px, py) {
      const P = this.path;
      const n = P.x.length;
      let best = Infinity, bi = this.idx;
      const i0 = Math.max(0, this.idx - 20), i1 = Math.min(n - 2, this.idx + 400);
      for (let i = i0; i <= i1; i++) {
        const dx = P.x[i + 1] - P.x[i], dy = P.y[i + 1] - P.y[i];
        const l2 = dx * dx + dy * dy || 1e-12;
        const t = clamp(((px - P.x[i]) * dx + (py - P.y[i]) * dy) / l2, 0, 1);
        const qx = P.x[i] + dx * t, qy = P.y[i] + dy * t;
        const d2 = (px - qx) ** 2 + (py - qy) ** 2;
        if (d2 < best) {
          best = d2; bi = i;
          const l = Math.sqrt(l2);
          this.sNear = P.s[i] + t * l;
          this.ey = ((px - qx) * -dy + (py - qy) * dx) / l >= 0 ? Math.sqrt(d2) : -Math.sqrt(d2);
        }
      }
      this.idx = bi;
    }

    update(s, u, dt) {
      const M = this.model.M, o = this.o;
      const v = Math.max(Math.abs(s[3]), 2);
      this.locate(s[0], s[1]);
      this.epsi = VD.util.wrapAngle(s[2] - pathValueAt(this.path, this.path.th, this.sNear));
      const xla = clamp(o.xla * v, 3, 25);
      const eLa = this.ey + xla * Math.sin(this.epsi);
      const gain = M.L + M.Kus * v * v;              // δ per unit curvature (steady state)
      const kff = pathValueAt(this.path, this.path.k, this.sNear + v * o.Tff);
      this.I = clamp(this.I + this.ey * dt, -20, 20);
      const delta = gain * kff - (o.ka * Math.max(gain, 0.3 * M.L) / (v * v)) * eLa - o.ki * this.I;
      const cmd = clamp(delta * M.steerRatio, -M.swaMax, M.swaMax);
      const want = this.swa + ((cmd - this.swa) * dt) / o.tau;
      const maxStep = o.rate * dt;
      this.swa = clamp(want, this.swa - maxStep, this.swa + maxStep);
      u.swa = this.swa;
      return this.swa;
    }
  }

  class ESC {
    constructor(model) {
      this.model = model;
      this.F = new Float64Array(4);
      this.reset();
    }
    reset() { this.active = false; this.rRef = 0; this.Mz = 0; this.F.fill(0); this.cut = 1; }

    /**
     * Writes per-wheel brake requests (N) into u.escBrake and an engine-torque
     * multiplier into u.throttleCut. `muRoad` is assumed known to the
     * controller (ideal friction estimation).
     */
    update(s, u, dt, muRoad) {
      const mdl = this.model, M = mdl.M;
      const vx = s[3], r = s[5];
      const target = [0, 0, 0, 0];
      this.Mz = 0;
      let on = false;
      if (vx > 15 / 3.6) {
        const df = clamp(u.swa / M.steerRatio, -M.roadMax, M.roadMax);
        const rLin = (vx * df) / (M.L + M.Kus * vx * vx);
        const mu = Math.min(M.muF, M.muR) * (muRoad || 1);
        const rMax = (0.85 * mu * g) / vx;
        this.rRef = clamp(rLin, -rMax, rMax);
        const e = r - this.rRef;
        const th = M.escThresh + 0.1 * Math.abs(this.rRef);
        if (Math.abs(e) > th) {
          on = true;
          const Mz = -M.escGain * M.Izz * (e - Math.sign(e) * th);
          this.Mz = Mz;
          const left = Mz > 0;                 // braking a left wheel yaws left
          const front = Mz * r < 0;            // opposing current yaw → oversteer → front
          const i = (front ? 0 : 2) + (left ? 0 : 1);
          const halfTrack = (front ? M.wf : M.wr) / 2;
          const aux = mdl.aux;
          const need = Math.abs(Mz) / halfTrack;
          if (aux.state[i] === VD.tire.STATE.ABS) {
            // the wheel is already at its ABS limit (e.g. μ-split braking):
            // release pressure on the opposite wheel of the axle instead
            const j = i ^ 1;
            const service = u.brake * M.FbMax * 0.5 * (front ? M.biasF : 1 - M.biasF);
            target[j] = -Math.min(need, service);
          } else {
            target[i] = Math.min(need, aux.mu[i] * Math.max(aux.Fz[i], 0));
          }
        }
      } else {
        this.rRef = 0;
      }
      // hydraulic pressure build-up as a first-order lag
      const k = Math.min(1, dt / 0.04);
      for (let i = 0; i < 4; i++) {
        this.F[i] += (target[i] - this.F[i]) * k;
        if (!u.escBrake) u.escBrake = new Float64Array(4);
        u.escBrake[i] = this.F[i];
      }
      this.cut += ((on ? 0 : 1) - this.cut) * Math.min(1, dt / 0.15);
      u.throttleCut = this.cut;
      this.active = on;
    }
  }

  VD.control = { SpeedController, PathFollower, ESC, makePath, pathPointAt, pathValueAt };
})(globalThis.VD = globalThis.VD || {});
