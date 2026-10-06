/*!
 * Standardised test procedures and their evaluation metrics. MIT License.
 *
 *   step    ISO 7401  step steer (transient response)
 *   sine    ISO 7401  continuous sinusoidal steer (frequency response point)
 *   swd     FMVSS 126 / UN GTR 8  sine with dwell (ESC performance)
 *   sis     NHTSA     slowly increasing steer (characterisation, A @ 0.3 g)
 *   circle  ISO 4138  steady-state circular, constant radius
 *   dlc     ISO 3888-1 double lane change
 *   dlc2    ISO 3888-2 obstacle avoidance
 *   slalom  constant-pitch cone slalom
 *   brake   straight-line braking, optional μ-split (ECE R13-H MFDD)
 *   accel   full-throttle acceleration, optional μ-split
 *   custom  user steering table
 */
(function (VD) {
  'use strict';

  const { DEG, RAD, KPH, g } = VD.const;
  const { clamp, linregress } = VD.util;
  const X = VD.metrics;
  const { SpeedController, PathFollower, makePath } = VD.control;

  // ---------------------------------------------------------------------------
  // Parameter helpers
  // ---------------------------------------------------------------------------
  const P = (key, unit, def, min, max, step, ko, en, o) =>
    Object.assign({ key, unit, def, min, max, step, type: 'number', label: { ko, en } }, o || {});
  const E = (key, def, options, ko, en, o) =>
    Object.assign({ key, def, type: 'enum', options, label: { ko, en } }, o || {});

  const OPT_DIR = [
    { value: 'left', label: { ko: '좌회전 (+)', en: 'Left (+)' } },
    { value: 'right', label: { ko: '우회전 (−)', en: 'Right (−)' } },
  ];
  const OPT_SPEED = [
    { value: 'fixed', label: { ko: '속도 고정 (ẍ = 0, MATLAB 동일)', en: 'Fixed speed (ẍ = 0, as MATLAB)' } },
    { value: 'cruise', label: { ko: '정속 제어 (PI)', en: 'Cruise control (PI)' } },
    { value: 'throttle', label: { ko: '스로틀 고정', en: 'Throttle hold' } },
    { value: 'coast', label: { ko: '타력 주행', en: 'Coast (throttle off)' } },
  ];
  const OPT_MU = [
    { value: 'uniform', label: { ko: '균일 노면', en: 'Uniform' } },
    { value: 'split', label: { ko: 'μ-split (좌/우)', en: 'μ-split (left/right)' } },
  ];
  const OPT_STEER = [
    { value: 'fixed', label: { ko: '조향 고정 (0°)', en: 'Steering held (0°)' } },
    { value: 'driver', label: { ko: '운전자 보정 (직진 유지)', en: 'Driver corrects (hold lane)' } },
  ];

  const sgnOf = (dir) => (dir === 'right' ? -1 : 1);

  // ---------------------------------------------------------------------------
  // Shared building blocks
  // ---------------------------------------------------------------------------
  function resistance(M, v) { return 0.5 * M.rho * M.CdA * v * v + M.fr * M.m * g; }

  /** Longitudinal behaviour common to the open-loop tests. */
  function longDriver(model, mode, v0, tStart) {
    const sc = new SpeedController(model);
    const thr0 = clamp(resistance(model.M, v0) / Math.max(model.availableDrive(v0, 1), 1), 0, 1);
    return (t, s, u, dt) => {
      u.gear = 1;
      if (mode === 'fixed') { u.throttle = 0; u.brake = 0; return; }
      if (mode === 'cruise' || t < tStart) { sc.update(v0, s, u, dt); return; }
      u.brake = 0;
      u.throttle = mode === 'throttle' ? thr0 : 0;
    };
  }

  function stepSwa(A, rate, t0) {
    const s = Math.sign(A), a = Math.abs(A);
    return (t) => (t <= t0 ? 0 : s * Math.min(a, rate * (t - t0)));
  }

  function swdSwa(A, f, dwell, t0) {
    const T1 = 0.75 / f;
    return (t) => {
      const tp = t - t0;
      if (tp <= 0) return 0;
      if (tp < T1) return A * Math.sin(2 * Math.PI * f * tp);
      if (tp < T1 + dwell) return -A;
      if (tp < 1 / f + dwell) return A * Math.sin(2 * Math.PI * f * (tp - dwell));
      return 0;
    };
  }

  function quick(id, p, mp, settings) {
    return execute(id, p, mp, Object.assign({}, settings, { linearRef: false, outDt: 0.01 }));
  }

  /** ISO 3888 lane layout for a vehicle of overall width W. */
  function lanes3888(variant, W, sgn) {
    let sections, offY;
    if (variant === 1) {
      const w1 = 1.1 * W + 0.25, w3 = 1.2 * W + 0.25, w5 = 1.3 * W + 0.25;
      const yR1 = -w1 / 2;
      sections = [
        { x0: 0, x1: 15, yR: yR1, yL: yR1 + w1 },
        { x0: 45, x1: 70, yR: yR1 + 3.5, yL: yR1 + 3.5 + w3 },
        { x0: 95, x1: 125, yR: yR1, yL: yR1 + w5 },
      ];
      offY = [[15, 45], [70, 95]];
    } else {
      const w1 = 1.1 * W + 0.25, w3 = W + 1, w5 = Math.max(1.3 * W + 0.25, 3);
      const yR1 = -w1 / 2, yL1 = w1 / 2;
      sections = [
        { x0: 0, x1: 12, yR: yR1, yL: yL1 },
        { x0: 25.5, x1: 36.5, yR: yL1 + 1, yL: yL1 + 1 + w3 },
        { x0: 49, x1: 61, yR: yR1, yL: yR1 + w5 },
      ];
      offY = [[12, 25.5], [36.5, 49]];
    }
    if (sgn < 0) sections = sections.map((s) => ({ x0: s.x0, x1: s.x1, yR: -s.yL, yL: -s.yR }));
    return { sections, transitions: offY, length: sections[2].x1 };
  }

  /**
   * Reference line for the CG through an ISO 3888 layout. Like a test driver,
   * it keeps to the lane edge nearest the next lane and starts each transition
   * `ext` metres before the gap (the body may yaw while its rear is still
   * between the cones).
   */
  function lanePath(layout, hw, ext, xStart, xEnd) {
    const [S1, S3, S5] = layout.sections;
    const mid = (S) => 0.5 * (S.yR + S.yL);
    const up = mid(S3) > mid(S1);
    const margin = 0.15;
    const edge = (S, towardLeft) => {
      const lo = S.yR + hw + margin, hi = S.yL - hw - margin;
      if (lo > hi) return mid(S);
      return towardLeft ? hi : lo;
    };
    const y1 = edge(S1, up), y3 = edge(S3, !up), y5 = edge(S5, up);
    const knots = [
      [xStart, mid(S1)], [S1.x0 - 15, mid(S1)], [S1.x0, y1],
      [S1.x1 - ext, y1], [S3.x0 + ext, y3],
      [S3.x1 - ext, y3], [S5.x0 + ext, y5],
      [S5.x1, y5], [S5.x1 + 25, mid(S5)], [xEnd, mid(S5)],
    ];
    const yAt = (x) => {
      for (let k = 0; k < knots.length - 1; k++) {
        const [xa, ya] = knots[k], [xb, yb] = knots[k + 1];
        if (x <= xb || k === knots.length - 2) {
          const u = clamp((x - xa) / Math.max(xb - xa, 1e-6), 0, 1);
          return ya + (yb - ya) * 0.5 * (1 - Math.cos(Math.PI * u));
        }
      }
      return knots[knots.length - 1][1];
    };
    const xs = [], yv = [];
    for (let x = xStart; x <= xEnd; x += 0.25) { xs.push(x); yv.push(yAt(x)); }
    return makePath(xs, yv);
  }

  /** Body-corner encroachment over lane boundaries, per section and side. */
  function laneCheck(res, M, layout) {
    const { t, X: Xc, Y: Yc, psi } = res.ch;
    const xf = M.a + M.ohF, xr = -(M.b + M.ohR), hw = M.bodyW / 2;
    const corners = [[xf, hw], [xf, -hw], [xr, -hw], [xr, hw]];
    const pen = layout.sections.map(() => ({ left: 0, right: 0 }));
    for (let i = 0; i < t.length; i++) {
      const c = Math.cos(psi[i] * DEG), s = Math.sin(psi[i] * DEG);
      for (const [px, py] of corners) {
        const x = Xc[i] + px * c - py * s, y = Yc[i] + px * s + py * c;
        layout.sections.forEach((sec, k) => {
          if (x < sec.x0 || x > sec.x1) return;
          pen[k].left = Math.max(pen[k].left, y - sec.yL);
          pen[k].right = Math.max(pen[k].right, sec.yR - y);
        });
      }
    }
    return pen;
  }

  // ---------------------------------------------------------------------------
  // Metric record helpers
  // ---------------------------------------------------------------------------
  const m = (id, ko, en, value, unit, digits, o) =>
    Object.assign({ id, label: { ko, en }, value: Number.isFinite(value) ? value : null, unit, digits }, o || {});

  function steadyWindow(res) {
    const t = res.ch.t, tEnd = t[t.length - 1];
    return [tEnd - 1.0, tEnd];
  }

  // ---------------------------------------------------------------------------
  // Maneuver definitions
  // ---------------------------------------------------------------------------
  const LIST = [];
  const def = (o) => { LIST.push(o); return o; };

  // ---- ISO 7401 step steer --------------------------------------------------
  def({
    id: 'step', group: 'open', standard: 'ISO 7401',
    name: { ko: '스텝 조향', en: 'Step steer' },
    desc: { ko: '일정 속도에서 조향휠을 빠르게 꺾어 유지. 과도 응답(응답시간·오버슈트)과 정상상태 이득 평가.',
      en: 'Rapid steering-wheel step at constant speed. Evaluates transient response (response time, overshoot) and steady-state gains.' },
    params: [
      P('v', 'km/h', 80, 10, 250, 1, '시험 속도', 'Test speed'),
      E('ampMode', 'ay', [
        { value: 'ay', label: { ko: '목표 정상 횡가속도로 보정', en: 'Calibrate to steady-state ay' } },
        { value: 'swa', label: { ko: '조향휠각 직접 입력', en: 'Steering-wheel angle' } }], '진폭 지정', 'Amplitude by'),
      P('ayTarget', 'm/s²', 4, 0.5, 15, 0.1, '목표 정상 횡가속도', 'Target steady-state ay', { when: { ampMode: 'ay' } }),
      P('swa', 'deg', 30, 1, 900, 1, '조향휠각 진폭', 'Steering-wheel amplitude', { when: { ampMode: 'swa' } }),
      P('rate', 'deg/s', 500, 20, 2000, 10, '조향 속도', 'Steering rate'),
      E('dir', 'left', OPT_DIR, '조향 방향', 'Direction'),
      P('t0', 's', 0.5, 0, 5, 0.1, '조향 시작 시각', 'Steer start time'),
      P('tEnd', 's', 5, 2, 30, 0.5, '해석 시간', 'Duration'),
      E('speedMode', 'throttle', OPT_SPEED, '종방향 조건', 'Longitudinal mode'),
    ],
    plots: [{ y: ['swa'] }, { y: ['r'] }, { y: ['ay'] }, { y: ['beta'] }, { y: ['alphaF', 'alphaR'] }, { xy: true }],
    build(ctx) {
      const { mp, p } = ctx;
      const v0 = mp.v * KPH, sgn = sgnOf(mp.dir);
      let A = mp.swa * DEG;
      if (mp.ampMode === 'ay') A = calibrateStep(ctx);
      const swaFn = stepSwa(sgn * A, mp.rate * DEG, mp.t0);
      const t50 = mp.t0 + (0.5 * A) / (mp.rate * DEG);
      return {
        v0, tEnd: mp.tEnd, fixedSpeed: mp.speedMode === 'fixed', swaFn, A,
        makeDriver: (model) => {
          const lon = longDriver(model, mp.speedMode, v0, mp.t0);
          return (t, s, u, dt) => { u.swa = swaFn(t); lon(t, s, u, dt); };
        },
        annot: { tMarks: [{ t: mp.t0, label: 'start' }, { t: t50, label: 't₅₀' }] },
        t50, sgn,
      };
    },
    metrics(res, ctx, b) {
      const { t, r, ay, beta } = res.ch;
      const [w0, w1] = steadyWindow(res);
      const rss = X.mean(t, r, w0, w1), ayss = X.mean(t, ay, w0, w1), bss = X.mean(t, beta, w0, w1);
      const s = b.sgn;
      const tR90 = X.crossTime(t, r, 0.9 * rss, b.t50, s);
      const tAy90 = X.crossTime(t, ay, 0.9 * ayss, b.t50, s);
      const pk = X.peak(t, r, b.t50, w1, s);
      const TRpk = pk.t - b.t50;
      const swaDeg = b.A * RAD;
      return [
        m('swa', '조향휠각 진폭', 'Steering-wheel amplitude', swaDeg, 'deg', 1),
        m('rss', '정상 요 레이트', 'Steady-state yaw rate', rss, 'deg/s', 2),
        m('ayss', '정상 횡가속도', 'Steady-state lateral accel.', ayss, 'm/s²', 2),
        m('bss', '정상 차체 슬립각', 'Steady-state sideslip', bss, 'deg', 2),
        m('gain', '요 레이트 이득', 'Yaw-rate gain', rss / (s * swaDeg), '1/s', 3),
        m('tr90', '요 레이트 응답시간 (90%)', 'Yaw-rate response time (90 %)', tR90 - b.t50, 's', 3,
          { note: { ko: '조향 50% 시점 t_50 기준', en: 'from 50 % steering input, t_50' } }),
        m('trpk', '요 레이트 피크 응답시간', 'Yaw-rate peak response time', TRpk, 's', 3),
        m('os', '요 레이트 오버슈트', 'Yaw-rate overshoot', ((pk.v - rss) / rss) * 100, '%', 1),
        m('tay90', '횡가속도 응답시간 (90%)', 'Lateral-accel. response time (90 %)', tAy90 - b.t50, 's', 3),
        m('tb', 'TB 계수', 'TB factor', TRpk * Math.abs(bss), 's·deg', 3, { note: { ko: 'T_rpk × β_ss', en: 'T_rpk × β_ss' } }),
      ];
    },
  });

  function calibrateStep(ctx) {
    const { p, mp, settings } = ctx;
    const v = mp.v * KPH;
    const lin = VD.linear.steadyGains(p, v);
    const target = mp.ayTarget;
    const maxA = p.swaMax * DEG;
    const ayOf = (A) => {
      const r = quick('step', p, Object.assign({}, mp, { ampMode: 'swa', swa: A * RAD, dir: 'left' }), settings);
      const [w0, w1] = steadyWindow(r.res);
      return X.mean(r.res.ch.t, r.res.ch.ay, w0, w1);
    };
    let A0 = clamp(target / Math.max(lin.ay, 1e-6), 0.2 * DEG, maxA);
    let f0 = ayOf(A0) - target;
    let A1 = clamp(A0 * target / Math.max(f0 + target, 1e-3), 0.2 * DEG, maxA);
    for (let k = 0; k < 6; k++) {
      const f1 = ayOf(A1) - target;
      if (Math.abs(f1) < 0.005 * target) return A1;
      const slope = (f1 - f0) / (A1 - A0 || 1e-9);
      const An = clamp(A1 - f1 / (Math.abs(slope) > 1e-9 ? slope : 1), 0.2 * DEG, maxA);
      A0 = A1; f0 = f1; A1 = An;
      if (A1 >= maxA && f1 < 0) break;
    }
    const fin = ayOf(A1);
    if (Math.abs(fin - target) > 0.02 * target) {
      ctx.warnings.push({ ko: `목표 횡가속도 ${target} m/s²에 도달하지 못했습니다(도달값 ${fin.toFixed(2)} m/s²). 타이어 한계 또는 최대 조향각을 확인하세요.`,
        en: `Could not reach the target ${target} m/s² (got ${fin.toFixed(2)} m/s²). Check tire limits or the maximum steering angle.` });
    }
    return A1;
  }

  // ---- ISO 7401 continuous sine --------------------------------------------
  def({
    id: 'sine', group: 'open', standard: 'ISO 7401',
    name: { ko: '정현파 조향', en: 'Sinusoidal steer' },
    desc: { ko: '단일 주파수 연속 정현파 조향. 요 레이트·횡가속도의 이득과 위상 지연을 선형 모델과 비교.',
      en: 'Continuous single-frequency sine. Gain and phase lag of yaw rate and lateral acceleration, compared with the linear model.' },
    params: [
      P('v', 'km/h', 80, 10, 250, 1, '시험 속도', 'Test speed'),
      P('swa', 'deg', 20, 1, 600, 1, '조향휠각 진폭', 'Steering-wheel amplitude'),
      P('f', 'Hz', 0.5, 0.05, 4, 0.05, '주파수', 'Frequency'),
      P('cycles', '-', 4, 1, 20, 1, '주기 수', 'Cycles'),
      P('t0', 's', 0.5, 0, 5, 0.1, '조향 시작 시각', 'Steer start time'),
      E('speedMode', 'throttle', OPT_SPEED, '종방향 조건', 'Longitudinal mode'),
    ],
    plots: [{ y: ['swa'] }, { y: ['r'] }, { y: ['ay'] }, { y: ['beta'] }, { xy: true }],
    build(ctx) {
      const { mp } = ctx;
      const v0 = mp.v * KPH, A = mp.swa * DEG, f = mp.f, tE = mp.t0 + mp.cycles / f;
      const swaFn = (t) => (t > mp.t0 && t < tE ? A * Math.sin(2 * Math.PI * f * (t - mp.t0)) : 0);
      return {
        v0, tEnd: tE + 1, fixedSpeed: mp.speedMode === 'fixed', swaFn,
        makeDriver: (model) => {
          const lon = longDriver(model, mp.speedMode, v0, mp.t0);
          return (t, s, u, dt) => { u.swa = swaFn(t); lon(t, s, u, dt); };
        },
        annot: { tMarks: [{ t: mp.t0, label: 'start' }, { t: tE, label: 'end' }] },
        tE,
      };
    },
    metrics(res, ctx, b) {
      const { mp, p } = ctx;
      const { t, swa, r, ay, beta } = res.ch;
      const nc = Math.min(2, mp.cycles);
      const w0 = b.tE - nc / mp.f, w1 = b.tE;
      const fs = X.sineFit(t, swa, mp.f, w0, w1);
      const lag = (y) => {
        const fy = X.sineFit(t, y, mp.f, w0, w1);
        let ph = (fy.phase - fs.phase) * RAD;
        ph = X.wrapDeg(ph); if (ph > 90) ph -= 360;
        return { gain: fy.amp / fs.amp, ph };
      };
      const R = lag(r), AY = lag(ay), B = lag(beta);
      const tf = VD.linear.tfAt(p, mp.v * KPH, 2 * Math.PI * mp.f);
      const lph = (c) => { let x = Math.atan2(c[1], c[0]) * RAD; x = X.wrapDeg(x); return x > 90 ? x - 360 : x; };
      return [
        m('rgain', '요 레이트 이득', 'Yaw-rate gain', R.gain, '(deg/s)/deg', 3),
        m('rgainLin', '요 레이트 이득 (선형 모델)', 'Yaw-rate gain (linear model)', Math.hypot(...tf.r), '(deg/s)/deg', 3),
        m('rph', '요 레이트 위상', 'Yaw-rate phase', R.ph, 'deg', 1),
        m('rphLin', '요 레이트 위상 (선형 모델)', 'Yaw-rate phase (linear model)', lph(tf.r), 'deg', 1),
        m('aygain', '횡가속도 이득', 'Lateral-accel. gain', AY.gain, '(m/s²)/deg', 4),
        m('aygainLin', '횡가속도 이득 (선형 모델)', 'Lateral-accel. gain (linear model)', Math.hypot(...tf.ay) * DEG, '(m/s²)/deg', 4),
        m('ayph', '횡가속도 위상', 'Lateral-accel. phase', AY.ph, 'deg', 1),
        m('ayphLin', '횡가속도 위상 (선형 모델)', 'Lateral-accel. phase (linear model)', lph(tf.ay), 'deg', 1),
        m('bgain', '차체 슬립각 이득', 'Sideslip gain', B.gain, 'deg/deg', 4),
      ];
    },
  });

  // ---- FMVSS 126 sine with dwell -------------------------------------------
  def({
    id: 'swd', group: 'open', standard: 'FMVSS 126 / UN GTR 8',
    name: { ko: '사인 위드 드웰', en: 'Sine with Dwell' },
    desc: { ko: '0.7 Hz 정현파 후 500 ms 유지. ESC 성능 기준(요 레이트 비, 횡변위)으로 합격 여부 판정.',
      en: '0.7 Hz sine with a 500 ms dwell. Pass/fail on the ESC criteria (yaw-rate ratios, lateral displacement).' },
    params: [
      P('v', 'km/h', 80, 40, 150, 1, '진입 속도', 'Entry speed'),
      E('Amode', 'sis', [
        { value: 'sis', label: { ko: 'SIS 시험으로 A 산출', en: 'A from SIS test' } },
        { value: 'linear', label: { ko: '선형 모델로 A 산출', en: 'A from linear model' } },
        { value: 'manual', label: { ko: 'A 직접 입력', en: 'Manual A' } }], 'A 결정 방법', 'Determine A by'),
      P('A', 'deg', 25, 1, 270, 0.5, 'A (0.3 g 조향휠각)', 'A (SWA at 0.3 g)', { when: { Amode: 'manual' } }),
      P('scalar', '× A', 5, 0.5, 10, 0.5, '진폭 배수', 'Amplitude scalar'),
      E('dir', 'left', [
        { value: 'left', label: { ko: '좌 → 우', en: 'Left then right' } },
        { value: 'right', label: { ko: '우 → 좌', en: 'Right then left' } }], '조향 순서', 'Steer order'),
      P('f', 'Hz', 0.7, 0.3, 1.5, 0.05, '주파수', 'Frequency', { advanced: true }),
      P('dwell', 's', 0.5, 0, 2, 0.05, '드웰 시간', 'Dwell time', { advanced: true }),
      E('speedMode', 'coast', OPT_SPEED, '종방향 조건 (BOS 이후)', 'Longitudinal mode (after BOS)'),
    ],
    plots: [{ y: ['swa'] }, { y: ['r', 'rRef'] }, { y: ['ay'] }, { y: ['beta'] }, { y: ['escMz'] }, { xy: true }],
    build(ctx) {
      const { mp, p, settings } = ctx;
      const v0 = mp.v * KPH, sgn = sgnOf(mp.dir), t0 = 1.0;
      let Adeg = mp.A;
      if (mp.Amode === 'linear') {
        Adeg = (0.3 * g / VD.linear.steadyGains(p, v0).ay) * RAD;
      } else if (mp.Amode === 'sis') {
        const sis = quick('sis', p, { v: mp.v }, settings);
        const a = sis.metrics.find((x) => x.id === 'A');
        if (a && a.value) Adeg = a.value;
        else {
          Adeg = (0.3 * g / VD.linear.steadyGains(p, v0).ay) * RAD;
          ctx.warnings.push({ ko: 'SIS 시험에서 0.3 g에 도달하지 못해 선형 모델로 A를 산출했습니다.', en: 'SIS did not reach 0.3 g; A was taken from the linear model.' });
        }
      }
      const amp = Math.min(mp.scalar * Adeg, 270);
      if (mp.scalar * Adeg > 270) ctx.warnings.push({ ko: '조향휠각이 FMVSS 126 상한 270°로 제한되었습니다.', en: 'Steering amplitude capped at the FMVSS 126 limit of 270°.' });
      const swaFn = swdSwa(sgn * amp * DEG, mp.f, mp.dwell, t0);
      const cos = t0 + 1 / mp.f + mp.dwell;
      return {
        v0, tEnd: cos + 2.5, fixedSpeed: mp.speedMode === 'fixed', swaFn,
        makeDriver: (model) => {
          const lon = longDriver(model, mp.speedMode, v0, t0);
          return (t, s, u, dt) => { u.swa = swaFn(t); lon(t, s, u, dt); };
        },
        annot: { tMarks: [{ t: t0, label: 'BOS' }, { t: t0 + 1.07, label: '+1.07 s' }, { t: cos, label: 'COS' },
          { t: cos + 1.0, label: '+1.0 s' }, { t: cos + 1.75, label: '+1.75 s' }] },
        t0, cos, sgn, Adeg, amp,
      };
    },
    metrics(res, ctx, b) {
      const { t, r, Y, beta } = res.ch;
      const { mp, p } = ctx;
      const s2 = -b.sgn; // yaw direction of the second lobe
      const pk = X.firstLocalPeak(t, r, b.t0 + 0.5 / mp.f, b.cos + 1.75, s2, 2);
      const r1 = X.at(t, r, b.cos + 1.0), r2 = X.at(t, r, b.cos + 1.75);
      // no yaw reversal (spin-out during the first lobe) → ratios are undefined
      const valid = Math.abs(pk.v) >= 2 && Math.sign(pk.v) === s2;
      const yrr1 = valid ? (r1 / pk.v) * 100 : NaN, yrr2 = valid ? (r2 / pk.v) * 100 : NaN;
      const lat = b.sgn * (X.at(t, Y, b.t0 + 1.07) - X.at(t, Y, b.t0));
      const latLim = p.m <= 3500 ? 1.83 : 1.52;
      const spun = X.maxAbs(t, beta) > 45;
      const pass1 = !spun && Number.isFinite(yrr1) && yrr1 <= 35;
      const pass2 = !spun && Number.isFinite(yrr2) && yrr2 <= 20;
      const pass3 = Number.isFinite(lat) && lat >= latLim;
      return [
        m('A', 'A (0.3 g 조향휠각)', 'A (SWA at 0.3 g)', b.Adeg, 'deg', 1),
        m('amp', '조향휠각 진폭', 'Steering amplitude', b.amp, 'deg', 1),
        m('rpk', '피크 요 레이트', 'Peak yaw rate', Math.abs(pk.v), 'deg/s', 2),
        m('yrr1', '요 레이트 비 @ COS+1.00 s', 'Yaw-rate ratio @ COS+1.00 s', yrr1, '%', 1, { pass: pass1, crit: '≤ 35 %' }),
        m('yrr2', '요 레이트 비 @ COS+1.75 s', 'Yaw-rate ratio @ COS+1.75 s', yrr2, '%', 1, { pass: pass2, crit: '≤ 20 %' }),
        m('lat', '횡변위 @ BOS+1.07 s', 'Lateral displacement @ BOS+1.07 s', lat, 'm', 2,
          { pass: pass3, crit: `≥ ${latLim.toFixed(2)} m`, note: mp.scalar < 5 ? { ko: '5A 이상에서만 적용', en: 'applies from 5A' } : null }),
        m('bmax', '최대 차체 슬립각', 'Max sideslip', X.maxAbs(t, beta), 'deg', 1),
        m('spin', '스핀 (|β| > 45°)', 'Spin-out (|β| > 45°)', null, '', 0,
          { text: spun ? { ko: '발생', en: 'Yes' } : { ko: '없음', en: 'No' }, pass: !spun }),
        m('verdict', '판정', 'Verdict', null, '', 0, { verdict: pass1 && pass2 && (pass3 || mp.scalar < 5) }),
      ];
    },
  });

  // ---- NHTSA slowly increasing steer ---------------------------------------
  def({
    id: 'sis', group: 'open', standard: 'NHTSA SIS / FMVSS 126',
    name: { ko: '서서히 증가하는 조향 (SIS)', en: 'Slowly increasing steer (SIS)' },
    desc: { ko: '정속에서 조향휠각을 13.5 °/s로 증가. 0.3 g에서의 조향휠각 A와 언더스티어 구배를 산출.',
      en: 'Steering ramp at 13.5 °/s at constant speed. Yields A (SWA at 0.3 g) and the understeer gradient.' },
    params: [
      P('v', 'km/h', 80, 20, 200, 1, '시험 속도', 'Test speed'),
      P('rate', 'deg/s', 13.5, 1, 100, 0.5, '조향 증가율', 'Steering ramp rate'),
      P('swaEnd', 'deg', 270, 10, 900, 5, '최종 조향휠각', 'Final steering angle'),
      E('dir', 'left', OPT_DIR, '조향 방향', 'Direction'),
      E('speedMode', 'cruise', OPT_SPEED, '종방향 조건', 'Longitudinal mode'),
    ],
    plots: [{ x: 'ayg', y: ['swa'] }, { x: 'ayg', y: ['beta'] }, { y: ['r'] }, { y: ['speed'] }, { xy: true }],
    build(ctx) {
      const { mp } = ctx;
      const v0 = mp.v * KPH, sgn = sgnOf(mp.dir), t0 = 1.0;
      const rate = mp.rate * DEG, end = mp.swaEnd * DEG;
      const swaFn = (t) => (t <= t0 ? 0 : sgn * Math.min(end, rate * (t - t0)));
      return {
        v0, tEnd: t0 + end / rate + 0.5, fixedSpeed: mp.speedMode === 'fixed', swaFn, sgn, t0,
        makeDriver: (model) => {
          const lon = longDriver(model, mp.speedMode, v0, t0);
          return (t, s, u, dt) => { u.swa = swaFn(t); lon(t, s, u, dt); };
        },
        stop: (t, s) => Math.abs(Math.atan2(s[4], Math.max(Math.abs(s[3]), 0.5))) > 20 * DEG || s[3] < 3,
        annot: { tMarks: [{ t: t0, label: 'start' }] },
      };
    },
    metrics(res, ctx, b) {
      const { t, ayg, swa, beta, speed } = res.ch;
      const s = b.sgn, n = t.length;
      const ayA = new Float64Array(n), swA = new Float64Array(n), bA = new Float64Array(n);
      for (let i = 0; i < n; i++) { ayA[i] = s * ayg[i]; swA[i] = s * swa[i]; bA[i] = s * beta[i]; }
      const pk = X.peak(t, ayA, b.t0, t[n - 1], 1);
      // restrict to the rising branch up to the peak
      const cut = (lo, hi, y) => {
        const xs = [], ys = [];
        for (let i = 0; i <= pk.i; i++) if (t[i] > b.t0 && ayA[i] >= lo && ayA[i] <= hi) { xs.push(ayA[i]); ys.push(y[i]); }
        return linregress(xs, ys);
      };
      const regA = cut(0.1, 0.375, swA);
      const A = pk.v >= 0.375 ? regA.a + regA.b * 0.3 : NaN;
      const regK = cut(0.05, Math.min(0.3, 0.6 * pk.v), swA);
      const v = X.mean(t, speed, b.t0, t[pk.i]) * KPH;
      const L = ctx.p.a + ctx.p.b;
      const K = regK.b / ctx.p.steerRatio - (L / (v * v)) * g * RAD;
      const regB = cut(0.05, Math.min(0.3, 0.6 * pk.v), bA);
      return [
        m('A', 'A (0.3 g 조향휠각)', 'A (SWA at 0.3 g)', A, 'deg', 2,
          { note: { ko: '0.1~0.375 g 선형회귀', en: 'linear regression, 0.1 to 0.375 g' } }),
        m('r2', 'A 회귀 결정계수 R²', 'A regression R²', regA.r2, '', 4),
        m('aymax', '최대 횡가속도', 'Max lateral acceleration', pk.v, 'g', 3),
        m('swaAtMax', '최대 횡가속도 시 조향휠각', 'SWA at max lateral accel.', X.at(t, swA, pk.t), 'deg', 1),
        m('Kus', '언더스티어 구배', 'Understeer gradient', K, 'deg/g', 2,
          { note: { ko: '정속법: dδsw/day / is − L/v²', en: 'constant-speed method: dδsw/day / is − L/v²' } }),
        m('bgrad', '슬립각 구배', 'Sideslip gradient', regB.b, 'deg/g', 2),
      ];
    },
  });

  // ---- ISO 4138 constant radius --------------------------------------------
  def({
    id: 'circle', group: 'closed', standard: 'ISO 4138',
    name: { ko: '정상원 선회 (정반경)', en: 'Steady-state circular (constant radius)' },
    desc: { ko: '일정 반경 원을 따라 속도를 서서히 증가. 조향 특성 선도(handling diagram)와 언더스티어 구배 산출.',
      en: 'Follow a fixed-radius circle while slowly increasing speed. Produces the handling diagram and understeer gradient.' },
    params: [
      P('R', 'm', 40, 10, 500, 1, '선회 반경', 'Radius'),
      E('dir', 'left', OPT_DIR, '선회 방향', 'Direction'),
      P('v0', 'km/h', 20, 5, 150, 1, '시작 속도', 'Start speed'),
      P('vEnd', 'km/h', 120, 10, 300, 1, '최종 속도', 'End speed'),
      P('accel', 'km/h/s', 1.0, 0.1, 5, 0.1, '속도 증가율', 'Speed ramp rate'),
      P('maxDev', 'm', 1.5, 0.3, 5, 0.1, '경로 이탈 한계', 'Path deviation limit'),
    ],
    plots: [{ x: 'ayg', y: ['swa'] }, { x: 'ayg', y: ['beta'] }, { x: 'ayg', y: ['alphaF', 'alphaR'] }, { y: ['speed'] }, { xy: true }],
    build(ctx) {
      const { mp } = ctx;
      const sgn = sgnOf(mp.dir), R = mp.R;
      const v0 = mp.v0 * KPH, vE = Math.max(mp.vEnd, mp.v0 + 1) * KPH, acc = mp.accel * KPH, tHold = 3;
      const tEnd = Math.min(tHold + (vE - v0) / acc + 1, 240);
      const dist = ((v0 + vE) / 2) * tEnd;
      const laps = Math.min(Math.ceil(dist / (2 * Math.PI * R)) + 1, 400);
      const nPts = Math.min(Math.ceil((laps * 2 * Math.PI * R) / 0.5), 400000);
      const xs = new Array(nPts), ys = new Array(nPts);
      for (let i = 0; i < nPts; i++) { const ph = (i * 0.5) / R; xs[i] = R * Math.sin(ph); ys[i] = sgn * R * (1 - Math.cos(ph)); }
      const path = makePath(xs, ys);
      const circ = [];
      for (let k = 0; k <= 180; k++) { const ph = (k / 180) * 2 * Math.PI; circ.push([R * Math.sin(ph), sgn * R * (1 - Math.cos(ph))]); }
      let follower = null, lagT = 0, liftT = 0, mdl = null;
      return {
        v0, tEnd, fixedSpeed: false,
        makeDriver: (model) => {
          mdl = model;
          const sc = new SpeedController(model);
          follower = new PathFollower(model, path, { ki: 0.02 });
          return (t, s, u, dt) => {
            const vref = t < tHold ? v0 : Math.min(vE, v0 + acc * (t - tHold));
            sc.update(vref, s, u, dt);
            follower.update(s, u, dt);
            // the speed can no longer be raised: lateral limit reached
            lagT = vref - s[3] > 3 * KPH ? lagT + dt : 0;
            const Fz = mdl.aux.Fz;
            liftT = Fz[0] <= 0 || Fz[1] <= 0 || Fz[2] <= 0 || Fz[3] <= 0 ? liftT + dt : 0;
          };
        },
        stop: (t, s) => (t > tHold + 2 && follower && Math.abs(follower.ey) > mp.maxDev)
          || lagT > 3 || liftT > 0.5
          || Math.abs(Math.atan2(s[4], Math.max(Math.abs(s[3]), 0.5))) > 20 * DEG,
        annot: { refLine: circ },
        sgn, tHold,
      };
    },
    metrics(res, ctx, b) {
      const { t, ayg, swa, beta, speed } = res.ch;
      const n = t.length, s = b.sgn;
      // 1-s moving average lateral acceleration → sustained maximum
      const tm = b.tHold + 1;
      let best = -Infinity, bestT = NaN;
      let j = 0, acc = 0;
      for (let i = 0; i < n; i++) {
        acc += s * ayg[i];
        while (t[i] - t[j] > 1.0) { acc -= s * ayg[j]; j++; }
        if (t[i] > tm && acc / (i - j + 1) > best) { best = acc / (i - j + 1); bestT = t[i]; }
      }
      // only the quasi-static ramp before the limit is first approached
      let tLim = t[n - 1];
      for (let i = 0; i < n; i++) if (t[i] > tm && s * ayg[i] >= 0.97 * best) { tLim = t[i]; break; }
      const xs = [], ys = [], bs = [];
      const hi = Math.min(0.4, 0.6 * best);
      for (let i = 0; i < n; i++) {
        if (t[i] < tm || t[i] > tLim) continue;
        const a = s * ayg[i];
        if (a >= 0.1 && a <= hi) { xs.push(a); ys.push((s * swa[i]) / ctx.p.steerRatio); bs.push(s * beta[i]); }
      }
      const regK = linregress(xs, ys);
      const regB = linregress(xs, bs);
      const lastBeta = s * beta[n - 1];
      const ended = res.stopped;
      return [
        m('Kus', '언더스티어 구배', 'Understeer gradient', regK.b, 'deg/g', 2,
          { note: { ko: `정반경법, ay 0.1~${hi.toFixed(2)} g`, en: `constant-radius method, ay 0.1 to ${hi.toFixed(2)} g` } }),
        m('r2', '회귀 결정계수 R²', 'Regression R²', regK.r2, '', 4),
        m('bgrad', '슬립각 구배', 'Sideslip gradient', regB.b, 'deg/g', 2),
        m('aymax', '지속 최대 횡가속도 (1 s 평균)', 'Max sustained lateral accel. (1 s avg)', best, 'g', 3),
        m('vmax', '한계 속도', 'Limit speed', X.at(t, speed, bestT), 'km/h', 1),
        m('limit', '한계 거동', 'Limit behaviour', null, '', 0,
          { text: Math.abs(lastBeta) > 8 ? { ko: '오버스티어 (스핀)', en: 'Oversteer (spin)' } : { ko: '언더스티어 (경로 이탈)', en: 'Understeer (runs wide)' }, hidden: !ended }),
      ];
    },
  });

  // ---- ISO 3888-1 / -2 lane changes ----------------------------------------
  function laneChangeDef(variant) {
    const is1 = variant === 1;
    return {
      id: is1 ? 'dlc' : 'dlc2', group: 'closed', standard: is1 ? 'ISO 3888-1' : 'ISO 3888-2',
      name: is1 ? { ko: '더블 레인 체인지', en: 'Double lane change' } : { ko: '장애물 회피 (무스 테스트)', en: 'Obstacle avoidance (moose test)' },
      desc: is1
        ? { ko: '125 m 코스 2회 차로 변경. 경로 추종 운전자 모델로 콘 이탈 여부 판정.', en: 'Two lane changes over 125 m with a path-following driver; checks cone-line violations.' }
        : { ko: '61 m 단거리 회피 코스. 1구간 이후 가속 페달 해제(타력).', en: 'Short 61 m evasive course; throttle released after section 1 (coast).' },
      params: [
        P('v', 'km/h', is1 ? 80 : 60, 20, 200, 1, '진입 속도', 'Entry speed'),
        E('dir', 'left', [
          { value: 'left', label: { ko: '좌측으로 회피', en: 'Evade to the left' } },
          { value: 'right', label: { ko: '우측으로 회피', en: 'Evade to the right' } }], '회피 방향', 'Evasion side'),
        E('speedMode', is1 ? 'cruise' : 'coast', OPT_SPEED.filter((o) => o.value !== 'fixed'), '종방향 조건', 'Longitudinal mode'),
        P('Tff', 's', 0.15, 0, 1, 0.05, '운전자 곡률 예견 시간', 'Driver curvature preview', { advanced: true }),
        P('ka', '1/s²', is1 ? 8 : 12, 0.5, 30, 0.5, '운전자 횡오차 게인', 'Driver lateral-error gain', { advanced: true }),
        P('tau', 's', 0.1, 0.02, 0.5, 0.01, '운전자 지연', 'Driver lag', { advanced: true }),
        P('ext', 'm', 2, 0, 10, 0.5, '차로 변경 조기 시작 거리', 'Transition lead distance', { advanced: true }),
      ],
      plots: [{ xy: true, wide: true, stretch: true }, { y: ['swa'] }, { y: ['ay'] }, { y: ['r'] }, { y: ['beta'] }, { y: ['speed'] }],
      build(ctx) {
        const { mp, p } = ctx;
        const v0 = mp.v * KPH, sgn = sgnOf(mp.dir);
        const layout = lanes3888(variant, p.bodyW, sgn);
        const xStart = -40, xEnd = layout.length + 40;
        const path = lanePath(layout, p.bodyW / 2, mp.ext, xStart - 5, xEnd + 40);
        const x1 = layout.sections[0].x1;
        return {
          v0, x0: xStart, tEnd: (xEnd - xStart) / Math.max(v0 * 0.5, 1) + 2, fixedSpeed: false,
          makeDriver: (model) => {
            const sc = new SpeedController(model);
            const thr0 = clamp(resistance(model.M, v0) / Math.max(model.availableDrive(v0, 1), 1), 0, 1);
            const pf = new PathFollower(model, path, { Tff: mp.Tff, ka: mp.ka, tau: mp.tau });
            return (t, s, u, dt) => {
              pf.update(s, u, dt);
              const past = s[0] + model.M.a > x1;
              if (mp.speedMode === 'cruise' || !past) sc.update(v0, s, u, dt);
              else { u.brake = 0; u.throttle = mp.speedMode === 'throttle' ? thr0 : 0; }
            };
          },
          stop: (t, s) => s[0] > xEnd || s[3] < 1,
          annot: { lanes: layout.sections, refPath: path },
          layout,
        };
      },
      metrics(res, ctx, b) {
        const { t, ay, r, swa, beta, speed, X: Xc } = res.ch;
        const M = VD.params.toModel(ctx.p);
        const pen = laneCheck(res, M, b.layout);
        let worst = 0, hits = 0;
        pen.forEach((q) => { worst = Math.max(worst, q.left, q.right); if (q.left > 0) hits++; if (q.right > 0) hits++; });
        const iExit = Math.max(0, X.idxAt(Xc, b.layout.length));
        const finished = Xc[Xc.length - 1] >= b.layout.length;
        const pass = finished && worst <= 0;
        const W = ['1', '3', '5'];
        const where = pen.flatMap((q, k) => [q.left > 0 ? `S${W[k]}-L` : null, q.right > 0 ? `S${W[k]}-R` : null]).filter(Boolean);
        return [
          m('verdict', '판정', 'Verdict', null, '', 0, { verdict: pass }),
          m('viol', '이탈 경계 수', 'Boundary violations', hits, '', 0,
            { pass: hits === 0, text: where.length ? { ko: where.join(', '), en: where.join(', ') } : null }),
          m('pen', '최대 침범량', 'Max encroachment', Math.max(worst, 0), 'm', 3),
          m('aymax', '최대 횡가속도', 'Max lateral accel.', X.maxAbs(t, ay), 'm/s²', 2),
          m('rmax', '최대 요 레이트', 'Max yaw rate', X.maxAbs(t, r), 'deg/s', 1),
          m('swamax', '최대 조향휠각', 'Max steering-wheel angle', X.maxAbs(t, swa), 'deg', 1),
          m('bmax', '최대 차체 슬립각', 'Max sideslip', X.maxAbs(t, beta), 'deg', 2),
          m('vexit', '출구 속도', 'Exit speed', finished ? speed[iExit] : NaN, 'km/h', 1),
        ];
      },
    };
  }
  def(laneChangeDef(1));
  def(laneChangeDef(2));

  // ---- Slalom ---------------------------------------------------------------
  def({
    id: 'slalom', group: 'closed', standard: '-',
    name: { ko: '슬라럼', en: 'Slalom' },
    desc: { ko: '등간격 콘 사이를 지그재그로 통과. 경로 추종 운전자 모델로 콘 접촉 여부 판정.',
      en: 'Weave through equally spaced cones with a path-following driver; counts cone contacts.' },
    params: [
      P('v', 'km/h', 50, 10, 160, 1, '시험 속도', 'Test speed'),
      P('d', 'm', 18, 8, 40, 0.5, '콘 간격', 'Cone spacing'),
      P('n', '-', 7, 3, 15, 1, '콘 개수', 'Number of cones'),
      P('A', 'm', 1.3, 0.5, 4, 0.05, '경로 진폭', 'Path amplitude'),
      E('dir', 'left', [
        { value: 'left', label: { ko: '첫 콘 좌측 통과', en: 'Pass first cone on the left' } },
        { value: 'right', label: { ko: '첫 콘 우측 통과', en: 'Pass first cone on the right' } }], '진입 방향', 'Entry side'),
      P('Tff', 's', 0.15, 0, 1, 0.05, '운전자 곡률 예견 시간', 'Driver curvature preview', { advanced: true }),
      P('ka', '1/s²', 8, 0.5, 30, 0.5, '운전자 횡오차 게인', 'Driver lateral-error gain', { advanced: true }),
    ],
    plots: [{ xy: true, wide: true, stretch: true }, { y: ['swa'] }, { y: ['ay'] }, { y: ['r'] }, { y: ['beta'] }],
    build(ctx) {
      const { mp } = ctx;
      const v0 = mp.v * KPH, sgn = sgnOf(mp.dir), d = mp.d, n = mp.n;
      const xs = [], ys = [];
      const xa = -d / 2, xb = (n - 1) * d + d / 2;
      for (let x = -60; x <= xb + 80; x += 0.25) {
        xs.push(x);
        ys.push(x < xa || x > xb ? 0 : sgn * mp.A * Math.sin((Math.PI * (x - xa)) / d));
      }
      const path = makePath(xs, ys);
      const cones = [];
      for (let k = 0; k < n; k++) cones.push({ x: k * d, y: 0 });
      return {
        v0, x0: -40, tEnd: (xb + 80) / Math.max(v0 * 0.5, 1) + 2, fixedSpeed: false,
        makeDriver: (model) => {
          const sc = new SpeedController(model);
          const pf = new PathFollower(model, path, { Tff: mp.Tff, ka: mp.ka });
          return (t, s, u, dt) => { pf.update(s, u, dt); sc.update(v0, s, u, dt); };
        },
        stop: (t, s) => s[0] > xb + 30 || s[3] < 1,
        annot: { cones, refPath: path },
        cones, xa, xb,
      };
    },
    metrics(res, ctx, b) {
      const { t, ay, r, swa, beta, X: Xc, Y: Yc, psi } = res.ch;
      const M = VD.params.toModel(ctx.p);
      const xf = M.a + M.ohF, xr = -(M.b + M.ohR), hw = M.bodyW / 2, rc = 0.15;
      const hit = new Set();
      for (let i = 0; i < t.length; i++) {
        const c = Math.cos(psi[i] * DEG), s = Math.sin(psi[i] * DEG);
        b.cones.forEach((cn, k) => {
          const dx = cn.x - Xc[i], dy = cn.y - Yc[i];
          const lx = dx * c + dy * s, ly = -dx * s + dy * c;
          if (lx > xr - rc && lx < xf + rc && Math.abs(ly) < hw + rc) hit.add(k);
        });
      }
      const tIn = X.crossTime(t, Xc, 0, 0, 1), tOut = X.crossTime(t, Xc, b.cones[b.cones.length - 1].x, 0, 1);
      return [
        m('verdict', '판정', 'Verdict', null, '', 0, { verdict: hit.size === 0 && Number.isFinite(tOut) }),
        m('hits', '콘 접촉', 'Cones hit', hit.size, '', 0, { pass: hit.size === 0 }),
        m('time', '통과 시간 (첫~마지막 콘)', 'Time first→last cone', tOut - tIn, 's', 2),
        m('aymax', '최대 횡가속도', 'Max lateral accel.', X.maxAbs(t, ay), 'm/s²', 2),
        m('rmax', '최대 요 레이트', 'Max yaw rate', X.maxAbs(t, r), 'deg/s', 1),
        m('swamax', '최대 조향휠각', 'Max steering-wheel angle', X.maxAbs(t, swa), 'deg', 1),
        m('bmax', '최대 차체 슬립각', 'Max sideslip', X.maxAbs(t, beta), 'deg', 2),
      ];
    },
  });

  // ---- Straight-line braking -------------------------------------------------
  function splitMu(mp) { return mp.muMode === 'split' ? (x, y) => (y >= 0 ? mp.muL : mp.muR) : null; }

  def({
    id: 'brake', group: 'long', standard: 'ECE R13-H (MFDD)',
    name: { ko: '직진 제동', en: 'Straight-line braking' },
    desc: { ko: '초기 속도에서 정지까지 제동. 제동거리, 평균 완전발현 감속도(MFDD), μ-split 요 편차 평가.',
      en: 'Brake from speed to standstill. Stopping distance, mean fully developed deceleration (MFDD), μ-split yaw deviation.' },
    params: [
      P('v', 'km/h', 100, 10, 300, 1, '초기 속도', 'Initial speed'),
      P('pedal', '%', 100, 5, 100, 1, '제동 페달', 'Brake pedal'),
      P('tRise', 's', 0.2, 0, 1, 0.05, '페달 상승 시간', 'Pedal rise time'),
      E('steer', 'fixed', OPT_STEER, '조향', 'Steering'),
      E('muMode', 'uniform', OPT_MU, '노면', 'Surface'),
      P('muL', '-', 0.2, 0.05, 1.2, 0.05, '좌측 노면 μ', 'Left-side μ', { when: { muMode: 'split' } }),
      P('muR', '-', 1.0, 0.05, 1.2, 0.05, '우측 노면 μ', 'Right-side μ', { when: { muMode: 'split' } }),
    ],
    plots: [{ y: ['speed'] }, { y: ['ax'] }, { y: ['psi'] }, { y: ['Fz'], group: true }, { y: ['util'], group: true }, { xy: true, stretch: true }],
    build(ctx) {
      const { mp } = ctx;
      const v0 = mp.v * KPH, t0 = 0.5;
      const xs = [], ys = [];
      for (let x = -5; x <= 600; x += 1) { xs.push(x); ys.push(0); }
      const path = makePath(xs, ys);
      return {
        v0, tEnd: t0 + mp.tRise + v0 / 2 + 5, fixedSpeed: false, muFn: splitMu(mp),
        makeDriver: (model) => {
          const sc = new SpeedController(model);
          const pf = mp.steer === 'driver' ? new PathFollower(model, path, { ka: 2 }) : null;
          return (t, s, u, dt) => {
            if (pf) pf.update(s, u, dt); else u.swa = 0;
            if (t < t0) { sc.update(v0, s, u, dt); return; }
            u.throttle = 0;
            u.brake = (mp.pedal / 100) * (mp.tRise > 0 ? clamp((t - t0) / mp.tRise, 0, 1) : 1);
          };
        },
        stop: (t, s) => t > t0 + 0.5 && Math.hypot(s[3], s[4]) < 0.08,
        annot: { tMarks: [{ t: t0, label: 'brake' }], muSplit: mp.muMode === 'split' ? { muL: mp.muL, muR: mp.muR } : null },
        t0,
      };
    },
    metrics(res, ctx, b) {
      const { t, speed, dist, psi, Y, swa } = res.ch;
      const n = t.length;
      const v0 = ctx.mp.v;
      const d0 = X.at(t, dist, b.t0);
      const stopped = speed[n - 1] < 0.5;
      const vb = 0.8 * v0, ve = 0.1 * v0;
      const tb = X.crossTime(t, speed, vb, b.t0, -1), te = X.crossTime(t, speed, ve, b.t0, -1);
      const sb = X.at(t, dist, tb), se = X.at(t, dist, te);
      const mfdd = (vb * vb - ve * ve) / (25.92 * (se - sb));
      let lock = false;
      for (const w of VD.model.WHEELS) { const st = res.ch['state_' + w]; for (let i = 0; i < n; i++) if (st[i] === VD.tire.STATE.LOCK) { lock = true; break; } }
      return [
        m('sd', '제동 거리', 'Stopping distance', stopped ? dist[n - 1] - d0 : NaN, 'm', 2, { note: { ko: '페달 작동 시점부터', en: 'from pedal application' } }),
        m('st', '제동 시간', 'Stopping time', stopped ? t[n - 1] - b.t0 : NaN, 's', 2),
        m('mfdd', 'MFDD', 'MFDD', mfdd, 'm/s²', 2, { note: { ko: '0.8 v₀ → 0.1 v₀', en: '0.8 v₀ → 0.1 v₀' } }),
        m('mfddg', 'MFDD (g)', 'MFDD (g)', mfdd / g, 'g', 3),
        m('psimax', '최대 요 각 편차', 'Max heading deviation', X.maxAbs(t, psi), 'deg', 2),
        m('ymax', '최대 횡 편차', 'Max lateral deviation', X.maxAbs(t, Y), 'm', 2),
        m('swamax', '최대 조향휠각', 'Max steering-wheel angle', X.maxAbs(t, swa), 'deg', 1),
        m('lock', '바퀴 잠김 발생', 'Wheel lock-up', null, '', 0, { text: lock ? { ko: '있음', en: 'Yes' } : { ko: '없음', en: 'No' }, pass: !lock }),
      ];
    },
  });

  // ---- Full-throttle acceleration ------------------------------------------
  def({
    id: 'accel', group: 'long', standard: '-',
    name: { ko: '발진 가속', en: 'Full-throttle acceleration' },
    desc: { ko: '정지 상태에서 가속 페달 100%. 0~100 km/h 시간, 견인 한계, μ-split 거동.',
      en: 'Full throttle from standstill. 0-100 km/h time, traction limit, μ-split behaviour.' },
    params: [
      P('vEnd', 'km/h', 100, 20, 350, 1, '목표 속도', 'Target speed'),
      E('steer', 'driver', OPT_STEER, '조향', 'Steering'),
      E('muMode', 'uniform', OPT_MU, '노면', 'Surface'),
      P('muL', '-', 0.2, 0.05, 1.2, 0.05, '좌측 노면 μ', 'Left-side μ', { when: { muMode: 'split' } }),
      P('muR', '-', 1.0, 0.05, 1.2, 0.05, '우측 노면 μ', 'Right-side μ', { when: { muMode: 'split' } }),
    ],
    plots: [{ y: ['speed'] }, { y: ['ax'] }, { y: ['Fx'], group: true }, { y: ['util'], group: true }, { y: ['throttle'] }],
    build(ctx) {
      const { mp } = ctx;
      const t0 = 0.5;
      let vE = mp.vEnd * KPH;
      if (vE > ctx.p.vMax * KPH - 1 * KPH) {
        vE = (ctx.p.vMax - 1) * KPH;
        ctx.warnings.push({ ko: `목표 속도가 최고속도 제한(${ctx.p.vMax} km/h)에 걸려 ${ctx.p.vMax - 1} km/h로 낮췄습니다.`,
          en: `Target speed limited by the speed governor (${ctx.p.vMax} km/h); using ${ctx.p.vMax - 1} km/h.` });
      }
      const xs = [], ys = [];
      for (let x = -5; x <= 3000; x += 2) { xs.push(x); ys.push(0); }
      const path = makePath(xs, ys);
      return {
        v0: 0, tEnd: 90, fixedSpeed: false, muFn: splitMu(mp),
        makeDriver: (model) => {
          const pf = mp.steer === 'driver' ? new PathFollower(model, path, { ka: 2 }) : null;
          return (t, s, u, dt) => {
            if (pf) pf.update(s, u, dt); else u.swa = 0;
            u.gear = 1; u.brake = 0; u.throttle = t < t0 ? 0 : 1;
          };
        },
        stop: (t, s) => s[3] >= vE,
        annot: { tMarks: [{ t: t0, label: 'start' }] },
        t0,
      };
    },
    metrics(res, ctx, b) {
      const { t, speed, dist, ax, psi } = res.ch;
      const tt = (v) => X.crossTime(t, speed, v, b.t0, 1) - b.t0;
      const t80 = X.crossTime(t, speed, 80, b.t0, 1), t120 = X.crossTime(t, speed, 120, b.t0, 1);
      const tE = tt(Math.min(ctx.mp.vEnd, ctx.p.vMax - 1) - 1e-6);
      let spin = false;
      for (const w of VD.model.WHEELS) { const st = res.ch['state_' + w]; for (let i = 0; i < t.length; i++) if (st[i] === VD.tire.STATE.SPIN) { spin = true; break; } }
      return [
        m('t60', '0~60 km/h', '0-60 km/h', tt(60), 's', 2),
        m('t100', '0~100 km/h', '0-100 km/h', tt(100), 's', 2),
        m('t80120', '80~120 km/h', '80-120 km/h', t120 - t80, 's', 2),
        m('tEnd', '0~목표속도', '0 to target speed', tE, 's', 2),
        m('dEnd', '목표속도 도달 거리', 'Distance to target speed', X.at(t, dist, tE + b.t0), 'm', 1),
        m('axmax', '최대 종가속도', 'Max longitudinal accel.', X.maxAbs(t, ax) / g, 'g', 3),
        m('psimax', '최대 요 각 편차', 'Max heading deviation', X.maxAbs(t, psi), 'deg', 2),
        m('spin', '휠스핀 발생', 'Wheel spin', null, '', 0, { text: spin ? { ko: '있음', en: 'Yes' } : { ko: '없음', en: 'No' } }),
      ];
    },
  });

  // ---- User steering table ---------------------------------------------------
  const MAX_ROWS = 20000;
  /** Parse "t, δsw" rows. Throws {code} on malformed input. */
  function parseTable(text) {
    if (typeof text !== 'string') throw { code: 'empty' };
    if (text.length > 1e6) throw { code: 'tooLarge' };
    const ts = [], vs = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const parts = line.split(/[\s,;\t]+/).filter(Boolean);
      if (parts.length < 2) throw { code: 'columns', line };
      const tv = Number(parts[0]), sv = Number(parts[1]);
      if (!Number.isFinite(tv) || !Number.isFinite(sv)) {
        if (ts.length === 0) continue; // header row
        throw { code: 'number', line };
      }
      if (ts.length && tv <= ts[ts.length - 1]) throw { code: 'order', line };
      if (tv < 0 || tv > 600 || Math.abs(sv) > 1500) throw { code: 'range', line };
      ts.push(tv); vs.push(sv);
      if (ts.length > MAX_ROWS) throw { code: 'tooLarge' };
    }
    if (ts.length < 2) throw { code: 'empty' };
    return { t: ts, swa: vs };
  }

  def({
    id: 'custom', group: 'open', standard: '-',
    name: { ko: '사용자 조향 입력', en: 'Custom steering input' },
    desc: { ko: '시간-조향휠각 표(CSV)를 직접 입력. 실측 조향 데이터 재현에 사용.',
      en: 'Time vs steering-wheel angle table (CSV). Use it to replay measured steering.' },
    params: [
      P('v', 'km/h', 80, 5, 250, 1, '시험 속도', 'Test speed'),
      E('speedMode', 'throttle', OPT_SPEED, '종방향 조건', 'Longitudinal mode'),
      P('tEnd', 's', 8, 1, 600, 0.5, '해석 시간', 'Duration'),
      { key: 'table', type: 'text', def: '# t [s], swa [deg]\n0, 0\n1.0, 0\n1.3, 60\n2.5, 60\n2.8, -60\n4.0, -60\n4.3, 0',
        label: { ko: '조향 입력 표 (t [s], δsw [deg])', en: 'Steering table (t [s], δsw [deg])' } },
    ],
    plots: [{ y: ['swa'] }, { y: ['r'] }, { y: ['ay'] }, { y: ['beta'] }, { xy: true }],
    build(ctx) {
      const { mp } = ctx;
      const v0 = mp.v * KPH;
      let tab;
      try { tab = parseTable(mp.table); } catch (e) {
        ctx.warnings.push({ code: 'table', ko: `조향 표를 해석할 수 없습니다 (${e.code || 'error'}). 조향 0으로 계산합니다.`, en: `Could not parse the steering table (${e.code || 'error'}). Running with zero steering.` });
        tab = { t: [0, 1], swa: [0, 0] };
      }
      const tsw = tab.swa.map((x) => x * DEG);
      const swaFn = (t) => VD.util.interp1(tab.t, tsw, t);
      return {
        v0, tEnd: mp.tEnd, fixedSpeed: mp.speedMode === 'fixed', swaFn,
        makeDriver: (model) => {
          const lon = longDriver(model, mp.speedMode, v0, tab.t[0]);
          return (t, s, u, dt) => { u.swa = swaFn(t); lon(t, s, u, dt); };
        },
      };
    },
    metrics(res) {
      const { t, ay, r, swa, beta } = res.ch;
      return [
        m('aymax', '최대 횡가속도', 'Max lateral accel.', X.maxAbs(t, ay), 'm/s²', 2),
        m('rmax', '최대 요 레이트', 'Max yaw rate', X.maxAbs(t, r), 'deg/s', 1),
        m('swamax', '최대 조향휠각', 'Max steering-wheel angle', X.maxAbs(t, swa), 'deg', 1),
        m('bmax', '최대 차체 슬립각', 'Max sideslip', X.maxAbs(t, beta), 'deg', 2),
      ];
    },
  });

  // ---- Recording from the real-time driving simulator ----------------------
  /** Generic metrics for any time history (used for recorded drives). */
  function genericMetrics(res) {
    const { t, ay, r, swa, beta, speed, dist } = res.ch;
    const n = t.length;
    return [
      m('dur', '기록 시간', 'Duration', n ? t[n - 1] - t[0] : NaN, 's', 1),
      m('dist', '주행 거리', 'Distance', n ? dist[n - 1] - dist[0] : NaN, 'm', 1),
      m('vmax', '최고 속도', 'Max speed', X.maxAbs(t, speed), 'km/h', 1),
      m('aymax', '최대 횡가속도', 'Max lateral accel.', X.maxAbs(t, ay), 'm/s²', 2),
      m('rmax', '최대 요 레이트', 'Max yaw rate', X.maxAbs(t, r), 'deg/s', 1),
      m('swamax', '최대 조향휠각', 'Max steering-wheel angle', X.maxAbs(t, swa), 'deg', 1),
      m('bmax', '최대 차체 슬립각', 'Max sideslip', X.maxAbs(t, beta), 'deg', 2),
    ];
  }
  def({
    id: 'drive', group: 'record', standard: '-', recordOnly: true,
    name: { ko: '실시간 주행 기록', en: 'Driving-simulator recording' },
    desc: { ko: '[실시간 주행]에서 기록한 데이터입니다. 여기서는 실행할 수 없으며, 주행 화면에서 기록 후 [해석으로 보내기]를 누르세요.',
      en: 'Data recorded in the [Driving simulator]. It cannot be run here: record a drive there and press [Send to analysis].' },
    params: [],
    plots: [{ xy: true, wide: true }, { y: ['speed'] }, { y: ['swa'] }, { y: ['r', 'rRef'] }, { y: ['ay'] }, { y: ['beta'] }, { y: ['util'], group: true }],
    build() { throw new Error('recordOnly'); },
    metrics: genericMetrics,
  });

  const BY_ID = Object.fromEntries(LIST.map((x) => [x.id, x]));
  const GROUP_LABEL = {
    open: { ko: '개루프 조향 시험', en: 'Open-loop steering tests' },
    closed: { ko: '폐루프 (경로 추종)', en: 'Closed-loop (path following)' },
    long: { ko: '종방향 시험', en: 'Longitudinal tests' },
    record: { ko: '기록 데이터', en: 'Recorded data' },
  };

  const SETTINGS_DEFAULT = Object.freeze({
    track: 'dual', tire: 'mf', dt: 0.001, outDt: 0.01, mu: 1.0,
    abs: 'vehicle', tcs: 'vehicle', esc: 'vehicle', linearRef: true,
  });

  /** Complete maneuver parameters with defaults and clamp numeric values. */
  function fillParams(man, mp) {
    const out = {};
    const src = mp || {};
    for (const q of man.params) {
      const v = src[q.key];
      if (q.type === 'number') {
        const num = typeof v === 'number' ? v : parseFloat(v);
        out[q.key] = Number.isFinite(num) ? clamp(num, q.min, q.max) : q.def;
      } else if (q.type === 'enum') {
        out[q.key] = q.options.some((o) => o.value === v) ? v : q.def;
      } else if (q.type === 'text') {
        out[q.key] = typeof v === 'string' ? v.slice(0, 1e6) : q.def;
      }
    }
    return out;
  }

  const tri = (v) => (v === 'on' ? true : v === 'off' ? false : undefined);

  /** Run one maneuver and evaluate it. */
  function execute(id, p, mpIn, settingsIn) {
    const man = BY_ID[id];
    if (!man) throw new Error('unknown maneuver ' + id);
    const settings = Object.assign({}, SETTINGS_DEFAULT, settingsIn || {});
    const mp = fillParams(man, mpIn);
    const ctx = { p, mp, settings, warnings: [] };
    const b = man.build(ctx);
    const muBase = clamp(Number(settings.mu) || 1, 0.05, 1.5);
    const muFn = b.muFn || null; // μ-split values are absolute
    const model = VD.model.create(p, {
      track: settings.track, tire: settings.tire, fixedSpeed: !!b.fixedSpeed,
      mu: muFn || muBase, abs: tri(settings.abs), tcs: tri(settings.tcs), esc: tri(settings.esc),
    });
    const x0 = model.initState(b.v0, b.x0 || 0, 0, 0);
    if (b.v0 > 0 && !b.fixedSpeed) x0[6] = resistance(model.M, b.v0);
    const dt = clamp(Number(settings.dt) || 0.001, 0.0002, 0.01);
    const res = VD.sim.run({
      model, x0, tEnd: b.tEnd, dt, outDt: settings.outDt,
      driver: b.makeDriver(model), stop: b.stop,
      muAt: muFn ? (x, y) => muFn(x, y) : () => muBase,
    });
    if (res.diverged) ctx.warnings.push({ ko: '수치 해가 발산했습니다. 시간 간격을 줄이세요.', en: 'The solution diverged. Reduce the time step.' });
    if (res.events.wheelLift !== undefined) {
      const tl = res.events.wheelLift.toFixed(2);
      ctx.warnings.push({ code: 'lift',
        ko: `t = ${tl} s에서 바퀴 들림(수직하중 0)이 발생했습니다. 이후 구간은 평면 3DOF 모델의 유효 범위를 벗어나며 실차는 전복될 수 있습니다.`,
        en: `Wheel lift-off (zero normal load) at t = ${tl} s. Beyond this point the planar 3DOF model is outside its validity range; a real vehicle may roll over.` });
    }
    let lin = null;
    if (settings.linearRef && b.swaFn && b.v0 > 1) {
      const tEnd = res.ch.t[res.n - 1];
      lin = VD.linear.simulate(p, b.v0, b.swaFn, tEnd, dt, Math.max(1, Math.round(settings.outDt / dt)));
    }
    let metrics = [];
    try { metrics = man.metrics(res, ctx, b); } catch (e) {
      ctx.warnings.push({ ko: '지표 계산 중 오류가 발생했습니다.', en: 'Metric evaluation failed.' });
    }
    return {
      maneuver: id, p, mp, settings, res, lin, metrics, annot: b.annot || {},
      warnings: ctx.warnings, assists: model.assists, cpuMs: res.cpuMs,
    };
  }

  VD.maneuvers = { LIST, BY_ID, GROUP_LABEL, SETTINGS_DEFAULT, OPT_SPEED, fillParams, execute, parseTable, lanes3888, genericMetrics };
})(globalThis.VD = globalThis.VD || {});
