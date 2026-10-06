/*!
 * Fixed-step RK4 integration, output channels and the batch runner.
 * MIT License.
 */
(function (VD) {
  'use strict';

  const { RAD, g } = VD.const;

  // ---------------------------------------------------------------------------
  // Output channels. Values are stored in display units; `scale` converts SI.
  // ---------------------------------------------------------------------------
  const C = (key, unit, ko, en, o) => Object.assign({ key, unit, label: { ko, en } }, o || {});
  const WHEEL_LABEL = { fl: { ko: '좌전', en: 'FL' }, fr: { ko: '우전', en: 'FR' }, rl: { ko: '좌후', en: 'RL' }, rr: { ko: '우후', en: 'RR' } };

  const CHANNELS = [
    C('t', 's', '시간', 'Time'),
    C('X', 'm', '종방향 위치 X', 'Position X'),
    C('Y', 'm', '횡방향 위치 Y', 'Position Y'),
    C('psi', 'deg', '요 각 ψ', 'Heading ψ'),
    C('speed', 'km/h', '차속', 'Speed'),
    C('vx', 'km/h', '종방향 속도 vx', 'Longitudinal velocity vx'),
    C('vy', 'm/s', '횡방향 속도 vy', 'Lateral velocity vy'),
    C('r', 'deg/s', '요 레이트 r', 'Yaw rate r'),
    C('beta', 'deg', '차체 슬립각 β', 'Body sideslip β'),
    C('ax', 'm/s²', '종가속도 ax', 'Longitudinal accel. ax'),
    C('ay', 'm/s²', '횡가속도 ay', 'Lateral accel. ay'),
    C('ayg', 'g', '횡가속도 (g)', 'Lateral accel. (g)'),
    C('swa', 'deg', '조향휠각 δsw', 'Steering-wheel angle δsw'),
    C('deltaF', 'deg', '전륜 조향각 δf', 'Front road-wheel angle δf'),
    C('deltaR', 'deg', '후륜 조향각 δr', 'Rear road-wheel angle δr'),
    C('throttle', '%', '가속 페달', 'Throttle'),
    C('brake', '%', '브레이크 페달', 'Brake pedal'),
    C('alphaF', 'deg', '전축 평균 슬립각 αf', 'Front axle slip angle αf'),
    C('alphaR', 'deg', '후축 평균 슬립각 αr', 'Rear axle slip angle αr'),
    C('Mz', 'N·m', '요 모멘트 Mz', 'Yaw moment Mz'),
    C('rRef', 'deg/s', 'ESC 기준 요 레이트', 'ESC reference yaw rate'),
    C('escMz', 'N·m', 'ESC 요 모멘트 요구', 'ESC yaw-moment request'),
    C('dist', 'm', '주행 거리', 'Distance travelled'),
  ];
  const WHEEL_GROUPS = [
    { key: 'Fz', unit: 'N', label: { ko: '수직하중 Fz', en: 'Normal load Fz' } },
    { key: 'Fy', unit: 'N', label: { ko: '타이어 횡력 Fy', en: 'Tire lateral force Fy' } },
    { key: 'Fx', unit: 'N', label: { ko: '타이어 종력 Fx', en: 'Tire longitudinal force Fx' } },
    { key: 'alpha', unit: 'deg', label: { ko: '슬립각 α', en: 'Slip angle α' } },
    { key: 'util', unit: '%', label: { ko: '마찰 이용률', en: 'Friction utilisation' } },
  ];
  for (const grp of WHEEL_GROUPS) {
    for (const w of VD.model.WHEELS) {
      CHANNELS.push({ key: `${grp.key}_${w}`, unit: grp.unit, group: grp.key, wheel: w,
        label: { ko: `${grp.label.ko} (${WHEEL_LABEL[w].ko})`, en: `${grp.label.en} (${WHEEL_LABEL[w].en})` } });
    }
  }
  for (const w of VD.model.WHEELS) {
    CHANNELS.push({ key: `state_${w}`, unit: '-', group: 'state', wheel: w, hidden: true,
      label: { ko: `타이어 상태 (${WHEEL_LABEL[w].ko})`, en: `Tire state (${WHEEL_LABEL[w].en})` } });
  }
  const CHANNEL_BY_KEY = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));

  // ---------------------------------------------------------------------------
  // RK4 stepper
  // ---------------------------------------------------------------------------
  class Stepper {
    constructor(model) {
      this.model = model;
      const n = model.NX;
      this.k1 = new Float64Array(n); this.k2 = new Float64Array(n);
      this.k3 = new Float64Array(n); this.k4 = new Float64Array(n);
      this.tmp = new Float64Array(n); this.dOut = new Float64Array(n);
    }
    /** Advance s in place by dt with input u held constant (zero-order hold). */
    step(t, s, u, dt) {
      const f = this.model.deriv, n = s.length;
      const { k1, k2, k3, k4, tmp } = this;
      f(t, s, u, k1);
      for (let i = 0; i < n; i++) tmp[i] = s[i] + 0.5 * dt * k1[i];
      f(t + 0.5 * dt, tmp, u, k2);
      for (let i = 0; i < n; i++) tmp[i] = s[i] + 0.5 * dt * k2[i];
      f(t + 0.5 * dt, tmp, u, k3);
      for (let i = 0; i < n; i++) tmp[i] = s[i] + dt * k3[i];
      f(t + dt, tmp, u, k4);
      for (let i = 0; i < n; i++) s[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
    /** Re-evaluate the model at (t, s) so model.aux reflects the stored state. */
    refresh(t, s, u) { this.model.deriv(t, s, u, this.dOut); }
  }

  function newInput() {
    return { swa: 0, throttle: 0, brake: 0, handbrake: 0, gear: 1, escBrake: new Float64Array(4), throttleCut: 1 };
  }

  // ---------------------------------------------------------------------------
  // Recorder
  // ---------------------------------------------------------------------------
  class Recorder {
    constructor(capacity) {
      this.cap = capacity; this.n = 0;
      this.ch = {};
      for (const c of CHANNELS) this.ch[c.key] = new Float32Array(capacity);
    }
    grow() {
      this.cap *= 2;
      for (const k in this.ch) { const a = new Float32Array(this.cap); a.set(this.ch[k]); this.ch[k] = a; }
    }
    push(t, s, u, model, extra) {
      if (this.n >= this.cap) this.grow();
      const i = this.n++, ch = this.ch, aux = model.aux;
      const vx = s[3], vy = s[4];
      ch.t[i] = t;
      ch.X[i] = s[0]; ch.Y[i] = s[1]; ch.psi[i] = s[2] * RAD;
      ch.speed[i] = Math.hypot(vx, vy) * 3.6; ch.vx[i] = vx * 3.6; ch.vy[i] = vy;
      ch.r[i] = s[5] * RAD;
      // full-range sideslip, unwrapped so a spinning vehicle gives a continuous trace
      let beta = Math.hypot(vx, vy) > 0.5 ? Math.atan2(vy, vx) * RAD : 0;
      if (i > 0) { const prev = ch.beta[i - 1]; beta = prev + (((beta - prev + 180) % 360) + 360) % 360 - 180; }
      ch.beta[i] = beta;
      ch.ax[i] = aux.ax; ch.ay[i] = aux.ay; ch.ayg[i] = aux.ay / g;
      ch.swa[i] = u.swa * RAD; ch.deltaF[i] = aux.deltaF * RAD; ch.deltaR[i] = aux.deltaR * RAD;
      ch.throttle[i] = u.throttle * (u.throttleCut === undefined ? 1 : u.throttleCut) * 100;
      ch.brake[i] = u.brake * 100;
      ch.alphaF[i] = 0.5 * (aux.alpha[0] + aux.alpha[1]) * RAD;
      ch.alphaR[i] = 0.5 * (aux.alpha[2] + aux.alpha[3]) * RAD;
      ch.Mz[i] = aux.Mz;
      ch.rRef[i] = extra && extra.esc ? extra.esc.rRef * RAD : NaN;
      ch.escMz[i] = extra && extra.esc ? extra.esc.Mz : 0;
      ch.dist[i] = extra ? extra.dist : 0;
      const W = VD.model.WHEELS;
      for (let w = 0; w < 4; w++) {
        const sfx = W[w];
        ch['Fz_' + sfx][i] = aux.Fz[w];
        ch['Fy_' + sfx][i] = aux.Fyw[w];
        ch['Fx_' + sfx][i] = aux.Fxw[w];
        ch['alpha_' + sfx][i] = aux.alpha[w] * RAD;
        ch['util_' + sfx][i] = aux.util[w] * 100;
        ch['state_' + sfx][i] = aux.state[w];
      }
    }
    finish() {
      const out = {};
      for (const k in this.ch) out[k] = this.ch[k].slice(0, this.n);
      return { n: this.n, ch: out };
    }
  }

  // ---------------------------------------------------------------------------
  // Batch runner
  // ---------------------------------------------------------------------------
  /**
   * @param cfg { model, x0, tEnd, dt, outDt,
   *              driver(t, s, u, dt, ctx),   writes steering/pedals into u
   *              stop(t, s, ctx) → bool,     optional early termination
   *              muAt(X, Y) → μ,             optional, used by ESC }
   */
  function run(cfg) {
    const model = cfg.model;
    const dt = cfg.dt || 0.001;
    const outDt = Math.max(cfg.outDt || 0.01, dt);
    const every = Math.max(1, Math.round(outDt / dt));
    const nSteps = Math.ceil(cfg.tEnd / dt - 1e-9);
    const s = cfg.x0;
    const u = newInput();
    const st = new Stepper(model);
    const rec = new Recorder(Math.floor(nSteps / every) + 4);
    const esc = model.assists.esc ? new VD.control.ESC(model) : null;
    const ctx = { esc, dist: 0, model, stopped: false, events: {} };
    const t0 = (typeof performance !== 'undefined' ? performance : Date).now();

    cfg.driver(0, s, u, dt, ctx);
    st.refresh(0, s, u);
    rec.push(0, s, u, model, ctx);
    let t = 0;
    for (let i = 0; i < nSteps; i++) {
      cfg.driver(t, s, u, dt, ctx);
      if (esc) {
        const mu = cfg.muAt ? cfg.muAt(s[0], s[1]) : 1;
        esc.update(s, u, dt, mu);
      }
      st.step(t, s, u, dt);
      t = (i + 1) * dt;
      ctx.dist += Math.hypot(s[3], s[4]) * dt;
      const last = i === nSteps - 1;
      const halt = cfg.stop ? cfg.stop(t, s, ctx) : false;
      if ((i + 1) % every === 0 || last || halt) {
        st.refresh(t, s, u);
        rec.push(t, s, u, model, ctx);
        if (ctx.events.wheelLift === undefined) {
          const Fz = model.aux.Fz;
          if (Fz[0] <= 0 || Fz[1] <= 0 || Fz[2] <= 0 || Fz[3] <= 0) ctx.events.wheelLift = t;
        }
      }
      if (!Number.isFinite(s[3]) || !Number.isFinite(s[5])) { ctx.diverged = true; break; }
      if (halt) { ctx.stopped = true; break; }
    }
    const out = rec.finish();
    out.dt = dt; out.outDt = outDt;
    out.events = ctx.events;
    out.diverged = !!ctx.diverged;
    out.stopped = !!ctx.stopped;
    out.cpuMs = (typeof performance !== 'undefined' ? performance : Date).now() - t0;
    return out;
  }

  VD.sim = { CHANNELS, CHANNEL_BY_KEY, WHEEL_GROUPS, Stepper, Recorder, newInput, run };
})(globalThis.VD = globalThis.VD || {});
