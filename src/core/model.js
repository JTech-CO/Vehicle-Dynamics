/*!
 * Nonlinear planar 3DOF vehicle body (longitudinal, lateral, yaw).
 * Dual-track and single-track variants, after MathWorks "Vehicle Body 3DOF".
 * MIT License.
 *
 * Frames: ISO 8855 — x forward, y left, z up; yaw rate r and steer angle δ
 * positive counter-clockwise (left turn). Earth frame X, Y with heading ψ.
 *
 * State vector s (12):
 *   0 X  1 Y  2 ψ  3 vx  4 vy  5 r
 *   6 Fx,f  7 Fy,f   filtered tire force sums used for load transfer (N)
 *   8..11 α_fl, α_fr, α_rl, α_rr   relaxation-length slip states (rad)
 *
 *   m(v̇x − r·vy) = ΣFx,i + F_aero,x
 *   m(v̇y + r·vx) = ΣFy,i
 *   Izz·ṙ        = Σ(x_i·Fy,i − y_i·Fx,i)
 */
(function (VD) {
  'use strict';

  const { g } = VD.const;
  const { clamp, sat } = VD.util;
  const T = VD.tire;

  const NX = 12;
  const WHEELS = ['fl', 'fr', 'rl', 'rr'];

  /**
   * @param p     vehicle parameters (engineering units, see params.js)
   * @param opts  { track: 'dual'|'single', tire: 'mf'|'fiala'|'linear',
   *                fixedSpeed: bool, mu: number | (X, Y) => number,
   *                abs, tcs, esc: bool overrides, vTol, vEps }
   */
  function create(p, opts) {
    opts = Object.assign({ track: 'dual', tire: 'mf', fixedSpeed: false, mu: 1.0, vTol: 0.5, vEps: 0.3 }, opts || {});
    const M = VD.params.toModel(p);
    const single = opts.track === 'single';
    const useAbs = opts.abs !== undefined ? !!opts.abs : M.abs;
    const useTcs = opts.tcs !== undefined ? !!opts.tcs : M.tcs;
    const useEsc = opts.esc !== undefined ? !!opts.esc : M.esc;
    const muFn = typeof opts.mu === 'function' ? opts.mu : null;
    const muConst = typeof opts.mu === 'number' ? opts.mu : 1.0;

    const xw = [M.a, M.a, -M.b, -M.b];
    const yw = single ? [0, 0, 0, 0] : [M.wf / 2, -M.wf / 2, M.wr / 2, -M.wr / 2];
    const Ca0 = [M.Cf / 2, M.Cf / 2, M.Cr / 2, M.Cr / 2];
    const mu0 = [M.muF, M.muF, M.muR, M.muR];
    const driveShareF = M.drive === 'FWD' ? 1 : M.drive === 'RWD' ? 0 : M.awdF;
    const tp = { model: opts.tire, C: M.mfC, E: M.mfE, slide: M.slide, eta: M.etaAbs, vEps: opts.vEps };

    // Auxiliary outputs of the most recent derivative evaluation.
    const aux = {
      Fz: new Float64Array(4), Fxw: new Float64Array(4), Fyw: new Float64Array(4),
      Fx: new Float64Array(4), Fy: new Float64Array(4),
      alpha: new Float64Array(4), mu: new Float64Array(4), util: new Float64Array(4),
      state: new Int8Array(4), delta: new Float64Array(4), Ca: new Float64Array(4),
      vxw: new Float64Array(4), vyw: new Float64Array(4),
      wx: new Float64Array(4), wy: new Float64Array(4),
      ax: 0, ay: 0, Mz: 0, Fdrag: 0, Fdown: 0, Fdrive: 0, deltaF: 0, deltaR: 0,
    };
    const res = { Fx: 0, Fy: 0, state: 0 };
    const FxDem = new Float64Array(4);
    const Fbrk = new Float64Array(4);
    const drive = new Float64Array(4);

    function frontAngles(df, out) {
      if (single || M.ack === 0 || Math.abs(df) < 1e-6) { out[0] = df; out[1] = df; return; }
      const ad = Math.abs(df);
      const R = M.L / Math.tan(ad);
      const din = Math.atan2(M.L, R - M.wf / 2);
      const dout = Math.atan2(M.L, R + M.wf / 2);
      const inner = ad + M.ack * (din - ad);
      const outer = ad + M.ack * (dout - ad);
      if (df > 0) { out[0] = inner; out[1] = outer; } else { out[0] = -outer; out[1] = -inner; }
    }

    /** Tractive force available at the wheels for the current speed and gear. */
    function availableDrive(vx, gear) {
      if (gear < 0) {
        const vr = -vx;
        return 0.35 * M.FtMax * clamp((25 / 3.6 - vr) / 1.0, 0, 1);
      }
      const vpos = Math.max(vx, 0.1);
      let F = Math.min(M.FtMax, M.Pmax / vpos);
      if (vx > M.vMax - 1) F *= clamp((M.vMax - vx) / 1.0, 0, 1);
      return F;
    }

    function deriv(t, s, u, ds) {
      const X = s[0], Y = s[1], psi = s[2], vx = s[3], vy = s[4], r = s[5];
      const FxF = s[6], FyF = s[7];
      const cpsi = Math.cos(psi), spsi = Math.sin(psi);

      // --- steering --------------------------------------------------------
      const df = clamp(u.swa / M.steerRatio, -M.roadMax, M.roadMax);
      const dr = M.krs * df;
      frontAngles(df, aux.delta);
      aux.delta[2] = dr; aux.delta[3] = dr;
      aux.deltaF = df; aux.deltaR = dr;

      // --- aerodynamics (air at rest, drag acting at CG height) -------------
      const q = 0.5 * M.rho * vx * vx;
      const Fdrag = -q * M.CdA * Math.sign(vx);
      const Fdown = -q * M.ClA;
      aux.Fdrag = Fdrag; aux.Fdown = Fdown;

      // --- normal loads: static + longitudinal + lateral transfer + aero ----
      const Fzf = (M.W * M.b - M.h * FxF) / M.L + Fdown * M.aeroF;
      const Fzr = (M.W * M.a + M.h * FxF) / M.L + Fdown * (1 - M.aeroF);
      const Fz = aux.Fz;
      if (single) {
        Fz[0] = Fz[1] = 0.5 * Fzf; Fz[2] = Fz[3] = 0.5 * Fzr;
      } else {
        const Tf = (M.lltd * M.h * FyF) / M.wf;
        const Tr = ((1 - M.lltd) * M.h * FyF) / M.wr;
        Fz[0] = 0.5 * Fzf - Tf; Fz[1] = 0.5 * Fzf + Tf;
        Fz[2] = 0.5 * Fzr - Tr; Fz[3] = 0.5 * Fzr + Tr;
      }

      // --- wheel kinematics, μ, stiffness -----------------------------------
      for (let i = 0; i < 4; i++) {
        if (Fz[i] < 0) Fz[i] = 0;
        const vxi = vx - r * yw[i];
        const vyi = vy + r * xw[i];
        const c = Math.cos(aux.delta[i]), sn = Math.sin(aux.delta[i]);
        aux.vxw[i] = vxi * c + vyi * sn;
        aux.vyw[i] = -vxi * sn + vyi * c;
        const wx = X + xw[i] * cpsi - yw[i] * spsi;
        const wy = Y + xw[i] * spsi + yw[i] * cpsi;
        aux.wx[i] = wx; aux.wy[i] = wy;
        const muRoad = muFn ? muFn(wx, wy) : muConst;
        aux.mu[i] = T.friction(mu0[i], Fz[i], M.Fz0[i], M.kMu) * muRoad;
        aux.Ca[i] = T.corneringStiffness(Ca0[i], Fz[i], M.Fz0[i], M.nC);
      }

      // --- longitudinal demand: driveline, brakes, rolling resistance -------
      const fixed = opts.fixedSpeed;
      let Fdrive = 0;
      if (!fixed) {
        const thr = clamp(u.throttle, 0, 1) * (u.throttleCut === undefined ? 1 : u.throttleCut);
        Fdrive = thr * availableDrive(vx, u.gear || 1) * (u.gear < 0 ? -1 : 1);
      }
      aux.Fdrive = Fdrive;
      const Ff = Fdrive * driveShareF, Fr = Fdrive * (1 - driveShareF);
      drive[0] = drive[1] = 0.5 * Ff;
      drive[2] = drive[3] = 0.5 * Fr;
      if (!fixed && !useTcs && Fdrive !== 0) {
        // open differentials: a spinning wheel limits the torque on its partner
        for (let ax = 0; ax < 2; ax++) {
          const i = 2 * ax, j = i + 1;
          const d = Math.abs(drive[i]);
          if (d === 0) continue;
          const capI = aux.mu[i] * Fz[i], capJ = aux.mu[j] * Fz[j];
          if (d > capI && d <= capJ) drive[j] = Math.sign(drive[j]) * Math.min(d, M.slide * capI);
          else if (d > capJ && d <= capI) drive[i] = Math.sign(drive[i]) * Math.min(d, M.slide * capJ);
        }
      }
      const brk = fixed ? 0 : clamp(u.brake, 0, 1) * M.FbMax;
      const hb = fixed ? 0 : clamp(u.handbrake || 0, 0, 1) * M.FhbMax * 0.5;
      Fbrk[0] = Fbrk[1] = 0.5 * brk * M.biasF;
      Fbrk[2] = Fbrk[3] = 0.5 * brk * (1 - M.biasF);
      if (useAbs && brk > 0 && !single) {
        // ABS "select-low" on the rear axle: both rear wheels are held to the
        // adhesion limit of the lower-μ side, which keeps rear lateral grip.
        const capR = M.etaAbs * Math.min(aux.mu[2] * Fz[2], aux.mu[3] * Fz[3]);
        if (Fbrk[2] > capR) Fbrk[2] = Fbrk[3] = capR;
      }
      if (u.escBrake) for (let i = 0; i < 4; i++) Fbrk[i] = Math.max(0, Fbrk[i] + u.escBrake[i]);

      // --- tire forces --------------------------------------------------------
      let FxT = 0, FyT = 0, Mz = 0;
      for (let i = 0; i < 4; i++) {
        const vxw = aux.vxw[i], vyw = aux.vyw[i];
        const den = Math.max(Math.abs(vxw), opts.vTol);
        const aSS = Math.atan(vyw / den);
        let alpha = aSS;
        if (M.sigma > 0) {
          alpha = s[8 + i];
          const vrel = Math.max(Math.hypot(vxw, vyw), opts.vTol);
          ds[8 + i] = (vrel / M.sigma) * (aSS - alpha);
        } else {
          ds[8 + i] = 0;
        }
        aux.alpha[i] = alpha;

        let braking = false, assist = false;
        if (fixed) {
          FxDem[i] = 0;
        } else {
          const hbi = i >= 2 ? hb : 0;
          const resist = (Fbrk[i] + hbi + M.fr * Fz[i]) * sat(vxw / opts.vEps);
          FxDem[i] = drive[i] - resist;
          braking = (Fbrk[i] + hbi) > 0 && FxDem[i] * vxw <= 0;
          assist = braking ? useAbs && hbi === 0 : useTcs;
        }
        T.combined(res, tp, alpha, Fz[i], aux.Ca[i], aux.mu[i], FxDem[i], braking, assist, vxw, vyw);
        const c = Math.cos(aux.delta[i]), sn = Math.sin(aux.delta[i]);
        const Fxb = res.Fx * c - res.Fy * sn;
        const Fyb = res.Fx * sn + res.Fy * c;
        aux.Fxw[i] = res.Fx; aux.Fyw[i] = res.Fy; aux.state[i] = res.state;
        aux.Fx[i] = Fxb; aux.Fy[i] = Fyb;
        aux.util[i] = Fz[i] > 0 ? Math.hypot(res.Fx, res.Fy) / (aux.mu[i] * Fz[i]) : 0;
        FxT += Fxb; FyT += Fyb;
        Mz += xw[i] * Fyb - yw[i] * Fxb;
      }

      // --- equations of motion ---------------------------------------------
      ds[0] = vx * cpsi - vy * spsi;
      ds[1] = vx * spsi + vy * cpsi;
      ds[2] = r;
      ds[3] = fixed ? 0 : (FxT + Fdrag) / M.m + r * vy;
      ds[4] = FyT / M.m - r * vx;
      ds[5] = Mz / M.Izz;
      ds[6] = ((fixed ? 0 : FxT) - FxF) / M.tauLT;
      ds[7] = (FyT - FyF) / M.tauLT;

      aux.ax = ds[3] - r * vy;   // body-frame acceleration (accelerometer at CG)
      aux.ay = ds[4] + r * vx;
      aux.Mz = Mz;
      return ds;
    }

    function initState(v0, X0, Y0, psi0) {
      const s = new Float64Array(NX);
      s[0] = X0 || 0; s[1] = Y0 || 0; s[2] = psi0 || 0; s[3] = v0 || 0;
      return s;
    }

    /** Body outline corners in world coordinates (for cone checks and drawing). */
    function bodyCorners(s, out) {
      const c = Math.cos(s[2]), sn = Math.sin(s[2]);
      const xf = M.a + M.ohF, xr = -(M.b + M.ohR), hw = M.bodyW / 2;
      const pts = [[xf, hw], [xf, -hw], [xr, -hw], [xr, hw]];
      for (let k = 0; k < 4; k++) {
        out[2 * k] = s[0] + pts[k][0] * c - pts[k][1] * sn;
        out[2 * k + 1] = s[1] + pts[k][0] * sn + pts[k][1] * c;
      }
      return out;
    }

    return {
      NX, M, opts, aux, deriv, initState, bodyCorners, availableDrive,
      wheelPos: { x: xw, y: yw },
      assists: { abs: useAbs, tcs: useTcs, esc: useEsc },
      single,
    };
  }

  VD.model = { create, NX, WHEELS };
})(globalThis.VD = globalThis.VD || {});
