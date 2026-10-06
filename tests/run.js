#!/usr/bin/env node
/*
 * Verification suite for the physics core. No dependencies:  node tests/run.js
 *
 * The checks compare the nonlinear 3DOF model against closed-form linear
 * theory, physical limits and symmetry, and harden the input parsers.
 */
'use strict';
const VD = require('./load-core.js');
const { DEG, RAD, KPH, g } = VD.const;

let passed = 0, failed = 0;
const results = [];
function test(name, fn) {
  try { fn(); passed++; results.push(['PASS', name]); }
  catch (e) { failed++; results.push(['FAIL', name, e.message]); }
}
function near(actual, expected, tol, what) {
  const err = Math.abs(actual - expected);
  const lim = typeof tol === 'object' ? tol.abs ?? Math.abs(expected) * tol.rel : tol;
  if (!(err <= lim)) throw new Error(`${what || 'value'}: got ${actual}, expected ${expected} ± ${lim}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

const sedan = VD.params.presetParams('sedan');
const metric = (run, id) => run.metrics.find((m) => m.id === id);

// ---------------------------------------------------------------------------
test('MF tire: initial slope equals cornering stiffness', () => {
  const Fz = 4500, Ca = 50000, mu = 1.0;
  const a = 1e-5;
  const slope = -VD.tire.lateralPure('mf', a, Fz, Ca, mu, 1.3, -1.0) / a;
  near(slope, Ca, { rel: 1e-4 }, 'dFy/dα');
});

test('MF / Fiala tire: peak force equals μ·Fz', () => {
  const Fz = 4500, Ca = 50000, mu = 0.9;
  let pkMF = 0, pkF = 0;
  for (let a = 0; a < 0.6; a += 1e-4) {
    pkMF = Math.max(pkMF, Math.abs(VD.tire.lateralPure('mf', a, Fz, Ca, mu, 1.3, -1.0)));
    pkF = Math.max(pkF, Math.abs(VD.tire.lateralPure('fiala', a, Fz, Ca, mu)));
  }
  near(pkMF, mu * Fz, { rel: 1e-4 }, 'MF peak');
  near(pkF, mu * Fz, { rel: 1e-6 }, 'Fiala peak');
});

test('Tire force opposes lateral sliding in reverse', () => {
  const res = { Fx: 0, Fy: 0, state: 0 };
  const tp = { model: 'mf', C: 1.3, E: -1, slide: 0.8, eta: 0.9, vEps: 0.3 };
  const vyw = 0.5, vxw = -3;                       // reversing, sliding left
  const alpha = Math.atan(vyw / Math.abs(vxw));
  VD.tire.combined(res, tp, alpha, 4000, 50000, 1, 0, false, false, vxw, vyw);
  ok(res.Fy < 0, 'Fy should point right when the patch slides left');
});

test('Friction ellipse: longitudinal demand reduces lateral force', () => {
  const tp = { model: 'mf', C: 1.3, E: -1, slide: 0.8, eta: 0.9, vEps: 0.3 };
  const a = { Fx: 0, Fy: 0 }, b = { Fx: 0, Fy: 0 };
  VD.tire.combined(a, tp, 0.05, 4000, 50000, 1, 0, false, false, 20, 1);
  VD.tire.combined(b, tp, 0.05, 4000, 50000, 1, -3000, true, true, 20, 1);
  ok(Math.abs(b.Fy) < Math.abs(a.Fy), 'combined slip must reduce |Fy|');
  ok(Math.hypot(b.Fx, b.Fy) <= 4000 + 1e-6, 'resultant within μ·Fz');
});

// ---------------------------------------------------------------------------
const linSettings = { track: 'single', tire: 'linear', linearRef: true };
const linVeh = Object.assign({}, sedan, { sigma: 0 });

test('Nonlinear single-track (linear tires, fixed speed) matches linear steady-state yaw gain', () => {
  const v = 80;
  const run = VD.maneuvers.execute('step', linVeh, { v, ampMode: 'swa', swa: 10, speedMode: 'fixed', tEnd: 6 }, linSettings);
  const gss = VD.linear.steadyGains(linVeh, v * KPH);
  near(metric(run, 'rss').value, gss.r * 10, { rel: 0.003 }, 'r_ss [deg/s]');
  near(metric(run, 'ayss').value, gss.ay * 10 * DEG, { rel: 0.003 }, 'ay_ss [m/s²]');
});

test('Nonlinear single-track step response tracks the linear model in time', () => {
  const run = VD.maneuvers.execute('step', linVeh, { v: 100, ampMode: 'swa', swa: 5, speedMode: 'fixed', tEnd: 4 }, linSettings);
  const r = run.res.ch.r, rl = run.lin.r;
  let e2 = 0, m = 0;
  const n = Math.min(r.length, rl.length);
  for (let i = 0; i < n; i++) { e2 += (r[i] - rl[i] * RAD) ** 2; m = Math.max(m, Math.abs(r[i])); }
  near(Math.sqrt(e2 / n) / m, 0, 0.01, 'normalised RMS error');
});

test('Dual track with proportional load sensitivity equals single track (MATLAB 3DOF equivalence)', () => {
  const p = Object.assign({}, linVeh, { nC: 1, kMu: 0, lltdF: 50 });
  const mp = { v: 80, ampMode: 'swa', swa: 8, speedMode: 'fixed', tEnd: 5 };
  const a = VD.maneuvers.execute('step', p, mp, { track: 'single', tire: 'linear' });
  const b = VD.maneuvers.execute('step', p, mp, { track: 'dual', tire: 'linear', esc: 'off' });
  near(metric(b, 'rss').value, metric(a, 'rss').value, { rel: 0.01 }, 'r_ss dual vs single');
});

test('Load sensitivity (n_C < 1) with front-biased LLTD increases understeer', () => {
  const base = Object.assign({}, sedan, { sigma: 0, nC: 0.7 });
  const mp = { v: 80, ampMode: 'swa', swa: 40, speedMode: 'fixed', tEnd: 5 };
  const lo = VD.maneuvers.execute('step', Object.assign({}, base, { lltdF: 40 }), mp, { esc: 'off' });
  const hi = VD.maneuvers.execute('step', Object.assign({}, base, { lltdF: 70 }), mp, { esc: 'off' });
  ok(metric(hi, 'rss').value < metric(lo, 'rss').value, 'more front LLTD → lower yaw gain');
});

test('Steady-state kinematics: ay = v·r in steady cornering', () => {
  const run = VD.maneuvers.execute('step', linVeh, { v: 60, ampMode: 'swa', swa: 20, speedMode: 'fixed', tEnd: 6 }, linSettings);
  const v = 60 * KPH;
  near(metric(run, 'ayss').value, v * metric(run, 'rss').value * DEG, { rel: 0.002 }, 'ay vs v·r');
});

test('Left and right steering give mirrored responses', () => {
  const mp = { v: 80, ampMode: 'swa', swa: 60, tEnd: 4 };
  const L = VD.maneuvers.execute('step', sedan, Object.assign({ dir: 'left' }, mp), {});
  const R = VD.maneuvers.execute('step', sedan, Object.assign({ dir: 'right' }, mp), {});
  near(metric(L, 'rss').value, -metric(R, 'rss').value, { rel: 1e-6 }, 'r_ss symmetry');
});

// ---------------------------------------------------------------------------
test('Linear FRF at ω → 0 equals the steady-state gain', () => {
  const v = 90 * KPH;
  const tf = VD.linear.tfAt(sedan, v, 1e-6);
  const ss = VD.linear.steadyGains(sedan, v);
  near(tf.r[0], ss.r, { rel: 1e-6 }, 'r gain');
  near(tf.ay[0], ss.ay, { rel: 1e-6 }, 'ay gain');
});

test('Linear yaw-rate gain peaks at the characteristic speed', () => {
  const us = VD.linear.understeer(sedan);
  let best = 0, vBest = 0;
  for (let v = 5; v < 80; v += 0.05) {
    const gss = VD.linear.steadyGains(sedan, v).curvature * v;
    if (gss > best) { best = gss; vBest = v; }
  }
  near(vBest, us.vch, { rel: 0.01 }, 'v at max r/δ');
});

test('Oversteering vehicle is unstable above the critical speed', () => {
  const p = VD.params.presetParams('drift');
  const us = VD.linear.understeer(p);
  ok(us.K < 0, 'drift preset is oversteering');
  ok(VD.linear.analyze(p, us.vcrit * 0.95).stable, 'stable below v_crit');
  ok(!VD.linear.analyze(p, us.vcrit * 1.05).stable, 'unstable above v_crit');
});

// ---------------------------------------------------------------------------
test('Coast-down deceleration equals drag + rolling resistance', () => {
  const p = Object.assign({}, sedan, { Cl: 0 });
  const model = VD.model.create(p, { esc: false });
  const s = model.initState(30, 0, 0, 0);
  const st = new VD.sim.Stepper(model);
  const u = VD.sim.newInput();
  st.refresh(0, s, u);
  const M = model.M;
  const expected = -(0.5 * M.rho * M.CdA * 30 * 30 + M.fr * M.m * g) / M.m;
  near(model.aux.ax, expected, { rel: 0.01 }, 'ax at 30 m/s');
});

test('ABS straight-line braking: MFDD ≈ η·μ·g', () => {
  const run = VD.maneuvers.execute('brake', sedan, { v: 100 }, { mu: 1.0 });
  const mfdd = metric(run, 'mfdd').value;
  ok(mfdd > 0.88 * g && mfdd < 0.95 * g, `MFDD ${mfdd.toFixed(2)} m/s² outside 0.88-0.95 g`);
  ok(metric(run, 'lock').pass, 'no wheel lock with ABS');
});

test('Without ABS, hard braking locks the wheels', () => {
  const run = VD.maneuvers.execute('brake', Object.assign({}, sedan, { FbMax: 30000 }), { v: 100 }, { abs: 'off' });
  ok(!metric(run, 'lock').pass, 'lock-up expected');
});

test('μ-split braking produces a heading deviation toward the high-μ side', () => {
  const run = VD.maneuvers.execute('brake', sedan, { v: 80, muMode: 'split', muL: 0.2, muR: 1.0 }, { esc: 'off' });
  const psi = run.res.ch.psi;
  ok(psi[psi.length - 1] < -0.5, 'vehicle should yaw to the right (high-μ side)');
});

// ---------------------------------------------------------------------------
test('FMVSS 126 sine with dwell: sedan with ESC passes', () => {
  const run = VD.maneuvers.execute('swd', sedan, { scalar: 6.5 }, {});
  ok(metric(run, 'verdict').verdict === true, 'expected PASS');
});

test('FMVSS 126 sine with dwell: oversteering car without ESC fails', () => {
  const run = VD.maneuvers.execute('swd', VD.params.presetParams('drift'), { scalar: 6.5 }, { esc: 'off' });
  ok(metric(run, 'verdict').verdict === false, 'expected FAIL');
});

test('SIS understeer gradient agrees with linear theory at low ay', () => {
  const p = Object.assign({}, sedan, { nC: 1, kMu: 0, sigma: 0 });
  const run = VD.maneuvers.execute('sis', p, {}, { track: 'single' });
  near(metric(run, 'Kus').value, VD.linear.understeer(p).Kdeg, { abs: 0.15 }, 'K_us [deg/g]');
});

test('μ-split braking with ABS (rear select-low) and ESC stays controllable', () => {
  const run = VD.maneuvers.execute('brake', sedan, { v: 100, muMode: 'split', muL: 0.2, muR: 1.0, steer: 'driver' }, {});
  ok(metric(run, 'psimax').value < 20, `heading deviation ${metric(run, 'psimax').value.toFixed(1)}° too large`);
  ok(metric(run, 'sd').value < 80, 'vehicle should stop within 80 m');
});

test('ISO 3888-1 lane layout matches the published widths', () => {
  const L = VD.maneuvers.lanes3888(1, 1.8, 1);
  near(L.sections[0].yL - L.sections[0].yR, 1.1 * 1.8 + 0.25, 1e-9, 'section 1 width');
  near(L.sections[1].yL - L.sections[1].yR, 1.2 * 1.8 + 0.25, 1e-9, 'section 3 width');
  near(L.sections[2].yL - L.sections[2].yR, 1.3 * 1.8 + 0.25, 1e-9, 'section 5 width');
  near(L.length, 125, 1e-9, 'track length');
});

test('Closed-loop lane change: sedan passes ISO 3888-1 at 80 km/h', () => {
  const run = VD.maneuvers.execute('dlc', sedan, { v: 80 }, {});
  ok(metric(run, 'verdict').verdict === true, 'expected PASS');
});

test('Rollover-prone vehicle reports wheel lift on the skid pad', () => {
  const run = VD.maneuvers.execute('circle', VD.params.presetParams('bus'), {}, {});
  ok(run.warnings.some((w) => w.code === 'lift'), 'wheel-lift warning expected');
});

// ---------------------------------------------------------------------------
test('Parameter sanitiser clamps values and drops unknown keys', () => {
  const { params, issues } = VD.params.sanitize({ m: -5, Izz: 'abc', a: 99, evil: '<script>', drive: 'XYZ' });
  ok(!('evil' in params), 'unknown key kept');
  near(params.m, VD.params.FIELD_BY_KEY.m.min, 0, 'mass clamp');
  near(params.a, VD.params.FIELD_BY_KEY.a.max, 0, 'a clamp');
  ok(params.drive === 'FWD', 'enum fallback');
  ok(issues.length >= 3, 'issues reported');
});

test('Steering-table parser rejects malformed input', () => {
  const bad = ['', '1,2', '0,0\n1,a', '0,0\n0,1', '0,0\n1,5000', '0;0\n'.repeat(30000)];
  for (const b of bad) {
    let threw = false;
    try { VD.maneuvers.parseTable(b); } catch (e) { threw = true; }
    ok(threw, `should reject: ${JSON.stringify(b.slice(0, 20))}`);
  }
  const good = VD.maneuvers.parseTable('t,swa\n0, 0\n1.5 30\n2;45');
  ok(good.t.length === 3 && good.swa[2] === 45, 'valid table parsed');
});

test('Every maneuver runs on every preset without diverging', () => {
  for (const pr of VD.params.PRESETS) {
    const p = VD.params.presetParams(pr.id);
    for (const man of VD.maneuvers.LIST) {
      if (man.recordOnly) continue;
      const run = VD.maneuvers.execute(man.id, p, {}, { linearRef: false });
      ok(!run.res.diverged, `${pr.id}/${man.id} diverged`);
      ok(run.res.n > 10, `${pr.id}/${man.id} produced no samples`);
    }
  }
});

// ---------------------------------------------------------------------------
for (const r of results) console.log(`${r[0] === 'PASS' ? '  ✓' : '  ✗'} ${r[1]}${r[2] ? '\n      ' + r[2] : ''}`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
