/*!
 * Tire force models. MIT License.
 *
 * Sign convention (ISO 8855 / MATLAB Vehicle Body 3DOF):
 *   α = atan(v_y,w / |v_x,w|) in the wheel frame,  F_y ≈ −C_α·α  for small α.
 *
 * The body model is 3DOF, so wheel spin is not a state. Longitudinal force is a
 * demand from the driveline/brakes; the tire either transmits it (adhesion,
 * friction-ellipse reduction of F_y), regulates it (ABS/TCS), or saturates into
 * full sliding (lock-up or wheel-spin) where the resultant force opposes the
 * contact-patch sliding velocity.
 */
(function (VD) {
  'use strict';

  const STATE = Object.freeze({ GRIP: 0, ABS: 1, TCS: 2, LOCK: 3, SPIN: 4, LIFT: 5 });
  const MODELS = ['mf', 'fiala', 'linear'];

  const K_SPIN = 0.5;     // nominal practical slip of a spinning wheel
  const V_SPIN_MIN = 1.0; // m/s, keeps the spin direction defined at standstill

  /** Pure lateral force of one tire (N). */
  function lateralPure(model, alpha, Fz, Ca, mu, C, E) {
    if (Fz <= 0) return 0;
    if (model === 'linear') return -Ca * alpha;
    const D = mu * Fz;
    if (model === 'fiala') {
      const t = Math.tan(alpha);
      const ta = Math.abs(t);
      const tsl = (3 * D) / Ca;          // tan of full-sliding slip angle
      if (ta >= tsl) return -D * Math.sign(alpha);
      const k = Ca / (3 * D);
      // −Cα·t + Cα²/(3D)·|t|·t − Cα³/(27D²)·t³
      return -Ca * t * (1 - k * ta + (k * k * t * t) / 3);
    }
    // Magic Formula (lateral, pure slip): B·C·D = Cα
    const B = Ca / (C * D);
    const x = B * alpha;
    return -D * Math.sin(C * Math.atan(x - E * (x - Math.atan(x))));
  }

  /**
   * Combined force at one wheel, written into `res` to avoid allocation.
   * @param res   {Fx, Fy, state} wheel-frame result
   * @param tp    {model, C, E, slide, eta, vEps}
   * @param FxDem longitudinal force demand (N, wheel frame)
   * @param braking true when the demand opposes the wheel's rolling direction
   * @param assist  ABS (braking) or TCS (driving) available on this wheel
   */
  function combined(res, tp, alpha, Fz, Ca, mu, FxDem, braking, assist, vxw, vyw) {
    if (Fz <= 0) { res.Fx = 0; res.Fy = 0; res.state = STATE.LIFT; return res; }
    const Fy0 = lateralPure(tp.model, alpha, Fz, Ca, mu, tp.C, tp.E);
    if (tp.model === 'linear') {
      res.Fx = FxDem; res.Fy = Fy0; res.state = STATE.GRIP; return res;
    }
    const Fmax = mu * Fz;
    const cap = assist ? tp.eta * Fmax : Fmax;
    const ax = Math.abs(FxDem);
    if (ax <= cap) {
      const q = FxDem / Fmax;
      res.Fx = FxDem;
      res.Fy = Fy0 * Math.sqrt(Math.max(0, 1 - q * q));
      res.state = STATE.GRIP;
      return res;
    }
    if (assist) {
      res.Fx = Math.sign(FxDem) * cap;
      res.Fy = Fy0 * Math.sqrt(Math.max(0, 1 - tp.eta * tp.eta));
      res.state = braking ? STATE.ABS : STATE.TCS;
      return res;
    }
    const Fs = tp.slide * Fmax;
    if (braking) {
      // locked wheel: contact patch slides with the wheel-centre velocity
      const n = Math.max(Math.hypot(vxw, vyw), tp.vEps);
      res.Fx = (-Fs * vxw) / n;
      res.Fy = (-Fs * vyw) / n;
      res.state = STATE.LOCK;
    } else {
      // spinning wheel: patch slides backwards relative to the drive direction
      const d = Math.sign(FxDem);
      const vs = K_SPIN * Math.max(Math.abs(vxw), V_SPIN_MIN);
      const n = Math.hypot(vs, vyw);
      res.Fx = (Fs * d * vs) / n;
      res.Fy = (-Fs * vyw) / n;
      res.state = STATE.SPIN;
    }
    return res;
  }

  /** Load-dependent cornering stiffness of one tire: Cα0·(Fz/Fz0)^n. */
  function corneringStiffness(Ca0, Fz, Fz0, n) {
    if (Fz <= 0) return 0;
    return Ca0 * Math.pow(Fz / Fz0, n);
  }

  /** Load-dependent peak friction: μ0·(Fz/Fz0)^(−k), ratio floored at 0.05. */
  function friction(mu0, Fz, Fz0, k) {
    const r = Math.max(Fz / Fz0, 0.05);
    return mu0 * Math.pow(r, -k);
  }

  /** Slip angle (rad) at which |Fy| peaks, by dense scan. */
  function peakSlip(model, Fz, Ca, mu, C, E) {
    if (model === 'linear') return NaN;
    let best = 0, bestA = 0;
    for (let a = 0; a <= 0.6; a += 0.0005) {
      const f = Math.abs(lateralPure(model, a, Fz, Ca, mu, C, E));
      if (f > best + 1e-9) { best = f; bestA = a; }
    }
    return bestA;
  }

  VD.tire = { STATE, MODELS, lateralPure, combined, corneringStiffness, friction, peakSlip };
})(globalThis.VD = globalThis.VD || {});
