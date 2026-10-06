/*!
 * Real-time driving simulator. Runs the same nonlinear 3DOF model as the
 * analysis workspace at 1 kHz with keyboard, gamepad or touch input.
 * MIT License.
 */
(function (VD) {
  'use strict';

  const { h, tx, bind, fmt, clear, icon, toast, download, safeName, on, emit, cssVar, L } = VD.ui;
  const { DEG, RAD, KPH, g } = VD.const;
  const { clamp } = VD.util;
  const store = VD.store;
  const STATE = VD.tire.STATE;
  const STATE_LABEL = ['GRIP', 'ABS', 'TCS', 'LOCK', 'SPIN', 'LIFT'];
  const WHEEL_NAME = [{ ko: '좌전', en: 'FL' }, { ko: '우전', en: 'FR' }, { ko: '좌후', en: 'RL' }, { ko: '우후', en: 'RR' }];
  const DT = 0.001;

  const COURSES = [
    { id: 'pad', label: { ko: '자유 주행장', en: 'Open pad' } },
    { id: 'skidpad', label: { ko: '스키드패드 R 40 m', en: 'Skid pad R 40 m' } },
    { id: 'dlc', label: { ko: '더블 레인 체인지 ISO 3888-1', en: 'Double lane change ISO 3888-1' } },
    { id: 'dlc2', label: { ko: '장애물 회피 ISO 3888-2', en: 'Obstacle avoidance ISO 3888-2' } },
    { id: 'slalom', label: { ko: '슬라럼 18 m', en: 'Slalom 18 m' } },
    { id: 'musplit', label: { ko: 'μ-split 직선로', en: 'μ-split straight' } },
  ];
  const SURFACES = [
    { v: 1.0, label: { ko: '건조 노면 μ 1.0', en: 'Dry μ 1.0' } },
    { v: 0.7, label: { ko: '젖은 노면 μ 0.7', en: 'Wet μ 0.7' } },
    { v: 0.3, label: { ko: '압설 μ 0.3', en: 'Snow μ 0.3' } },
    { v: 0.1, label: { ko: '빙판 μ 0.1', en: 'Ice μ 0.1' } },
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const opt = { course: 'skidpad', mu: 1.0, abs: true, tcs: true, esc: true, cam: 'follow', scale: 1, forces: true, trail: true, steerAssist: true, autoZoom: true };
  let root, stage, canvas, ctx, helpEl, hudEl, pausedEl, teleHost;
  let model = null, stepper = null, esc = null, s = null, u = null;
  let t = 0, dist = 0, running = false, active = false, paused = false, raf = 0, lastFrame = 0;
  let course = null, cam = { x: 0, y: 0, rot: 0, z: 16 }, zoomUser = 1;
  const keys = new Set();
  const ctrl = { thr: 0, brk: 0, gearT: 0, swa: 0, pad: null };
  const skids = { buf: new Float32Array(6 * 6000), n: 0, head: 0, last: [null, null, null, null] };
  const trail = { x: new Float32Array(3000), y: new Float32Array(3000), n: 0, head: 0, acc: 0 };
  const gg = { x: new Float32Array(180), y: new Float32Array(180), n: 0, head: 0 };
  const strip = { t: [], r: [], rRef: [], ay: [], beta: [], acc: 0 };
  let timing = null, lap = null, coneHits = 0;
  let rec = null, recStart = 0, lastRecording = null, nextRec = 0;
  let tele = {}, frame = 0;

  // ---------------------------------------------------------------------------
  // Courses
  // ---------------------------------------------------------------------------
  function buildCourse(id, p) {
    const c = { id, cones: [], lines: [], circles: [], zones: [], gate: null, start: { X: 0, Y: 0, psi: 0 } };
    const coneLine = (x0, y0, x1, y1, spacing) => {
      const L0 = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L0 / spacing));
      for (let k = 0; k <= n; k++) c.cones.push({ x: x0 + ((x1 - x0) * k) / n, y: y0 + ((y1 - y0) * k) / n, hit: false, dx: 0, dy: 0 });
      c.lines.push([x0, y0, x1, y1]);
    };
    if (id === 'skidpad') {
      const R = 40;
      for (const r of [R - 2, R + 2]) {
        const n = Math.round((2 * Math.PI * r) / 4);
        for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; c.cones.push({ x: r * Math.sin(a), y: R - r * Math.cos(a), hit: false, dx: 0, dy: 0 }); }
        c.circles.push({ cx: 0, cy: R, r });
      }
      c.start = { X: 0, Y: 0, psi: 0 };
      c.lap = { R };
    } else if (id === 'dlc' || id === 'dlc2') {
      const lay = VD.maneuvers.lanes3888(id === 'dlc' ? 1 : 2, p.bodyW, 1);
      for (const sec of lay.sections) { coneLine(sec.x0, sec.yL, sec.x1, sec.yL, 3); coneLine(sec.x0, sec.yR, sec.x1, sec.yR, 3); }
      c.gate = { x0: 0, x1: lay.length };
      c.start = { X: -80, Y: 0, psi: 0 };
    } else if (id === 'slalom') {
      for (let k = 0; k < 7; k++) c.cones.push({ x: k * 18, y: 0, hit: false, dx: 0, dy: 0 });
      c.gate = { x0: 0, x1: 108 };
      c.start = { X: -80, Y: 0, psi: 0 };
    } else if (id === 'musplit') {
      c.zones.push({ x0: 0, x1: 500, y0: 0, y1: 12, mu: 0.2 });
      c.lines.push([-200, 0, 500, 0], [-200, -3.5, 500, -3.5], [-200, 3.5, 500, 3.5]);
      c.gate = { x0: 0, x1: 500 };
      c.start = { X: -120, Y: 0, psi: 0 };
    }
    return c;
  }

  function muAt(x, y) {
    for (const z of course.zones) if (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) return z.mu;
    return opt.mu;
  }

  // ---------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------
  function rebuild(keepState) {
    const p = store.state.vehicle;
    model = VD.model.create(p, { track: 'dual', tire: 'mf', mu: (x, y) => muAt(x, y), abs: opt.abs, tcs: opt.tcs, esc: opt.esc });
    stepper = new VD.sim.Stepper(model);
    esc = opt.esc ? new VD.control.ESC(model) : null;
    if (!keepState || !s) reset();
    else stepper.refresh(t, s, u);
  }

  function reset() {
    course = buildCourse(opt.course, store.state.vehicle);
    const st0 = course.start;
    s = model.initState(0, st0.X, st0.Y, st0.psi);
    u = VD.sim.newInput();
    t = 0; dist = 0;
    ctrl.thr = 0; ctrl.brk = 0; ctrl.swa = 0; ctrl.gearT = 0;
    skids.n = 0; skids.head = 0; skids.last = [null, null, null, null];
    trail.n = 0; trail.head = 0; gg.n = 0; gg.head = 0;
    strip.t = []; strip.r = []; strip.rRef = []; strip.ay = []; strip.beta = [];
    timing = null; lap = null; coneHits = 0;
    if (esc) esc.reset();
    cam.x = st0.X; cam.y = st0.Y; cam.rot = st0.psi;
    stepper.refresh(0, s, u);
  }

  /** Speed-sensitive steering limit for digital (keyboard) input. */
  function swaLimit(v) {
    const M = model.M;
    if (!opt.steerAssist || v < 3) return M.swaMax;
    const mu = Math.max(muAt(s[0], s[1]), 0.05) * Math.min(M.muF, M.muR);
    const lim = M.steerRatio * Math.max(M.L + M.Kus * v * v, 0.3 * M.L) * (1.25 * mu * g) / (v * v);
    return clamp(lim, 20 * DEG, M.swaMax);
  }

  function readInput(dtr) {
    const v = Math.hypot(s[3], s[4]);
    const left = keys.has('left') || ctrl.touch?.left, right = keys.has('right') || ctrl.touch?.right;
    let up = keys.has('up') || ctrl.touch?.up, down = keys.has('down') || ctrl.touch?.down;
    let steerTarget = ((left ? 1 : 0) - (right ? 1 : 0)) * swaLimit(v);
    let rate = steerTarget === 0 ? 720 * DEG : 420 * DEG;
    let thrT = up ? 1 : 0, brkT = down ? 1 : 0, hb = keys.has('hb') ? 1 : 0;
    const gp = pollGamepad();
    if (gp) {
      steerTarget = -gp.steer * (opt.steerAssist ? swaLimit(v) : model.M.swaMax);
      rate = 1500 * DEG;
      if (gp.thr > 0.02) { thrT = gp.thr; up = true; }
      if (gp.brk > 0.02) { brkT = gp.brk; down = true; }
      if (gp.hb) hb = 1;
    }
    const dS = steerTarget - ctrl.swa, mx = rate * dtr;
    ctrl.swa += clamp(dS, -mx, mx);
    // pedals: forward gear uses up=throttle/down=brake, reverse swaps them
    const vx = s[3];
    if (u.gear > 0) {
      if (down && !up && Math.abs(vx) < 0.4) ctrl.gearT += dtr; else ctrl.gearT = 0;
      if (ctrl.gearT > 0.3) { u.gear = -1; ctrl.gearT = 0; }
    } else {
      if (up && !down && Math.abs(vx) < 0.4) ctrl.gearT += dtr; else ctrl.gearT = 0;
      if (ctrl.gearT > 0.3) { u.gear = 1; ctrl.gearT = 0; }
      [thrT, brkT] = [brkT, thrT];
    }
    if (u.gear < 0 && thrT > 0 && vx < 0.4) { /* reversing */ } else if (u.gear < 0 && vx > 0.5) { brkT = Math.max(brkT, thrT); thrT = 0; }
    const ramp = (cur, tgt, up_, dn) => cur + clamp(tgt - cur, -dn * dtr, up_ * dtr);
    ctrl.thr = ramp(ctrl.thr, thrT, 4, 8);
    ctrl.brk = ramp(ctrl.brk, brkT, 6, 10);
    u.swa = ctrl.swa; u.throttle = ctrl.thr; u.brake = ctrl.brk; u.handbrake = hb;
  }

  function pollGamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] || 0;
      const steer = Math.abs(ax) < 0.06 ? 0 : ax;
      const val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
      if (pressed(3) && !ctrl.padY) reset();
      ctrl.padY = pressed(3);
      if (Math.abs(steer) > 0 || val(7) > 0 || val(6) > 0 || pressed(0)) { ctrl.pad = gp.id; return { steer, thr: val(7), brk: val(6), hb: pressed(0) }; }
      if (ctrl.pad) return { steer, thr: 0, brk: 0, hb: false };
    }
    return null;
  }

  function stepSim(dtr) {
    let steps = Math.min(Math.round((dtr * opt.scale) / DT), 120);
    while (steps-- > 0) {
      if (esc) esc.update(s, u, DT, muAt(s[0], s[1]));
      stepper.step(t, s, u, DT);
      t += DT;
      dist += Math.hypot(s[3], s[4]) * DT;
      if (rec && t >= nextRec) {
        stepper.refresh(t, s, u);
        rec.push(t - recStart, s, u, model, { esc, dist });
        nextRec += 0.01;
        if (t - recStart > 600) stopRecording();
      }
      if (!Number.isFinite(s[3])) { reset(); toast({ ko: '수치 발산으로 초기화했습니다.', en: 'Numerical divergence — reset.' }, 'bad'); return; }
    }
    stepper.refresh(t, s, u);
    // very low speed with brakes held: park the vehicle (avoids creeping)
    if (Math.hypot(s[3], s[4]) < 0.05 && u.throttle < 0.02 && (u.brake > 0.1 || u.handbrake > 0)) { s[3] = 0; s[4] = 0; s[5] = 0; }
  }

  // ---------------------------------------------------------------------------
  // Course logic: cones, gates, laps, skid marks, trails
  // ---------------------------------------------------------------------------
  const corners = new Float64Array(8);
  function updateCourse() {
    const M = model.M;
    const c = Math.cos(s[2]), sn = Math.sin(s[2]);
    const xf = M.a + M.ohF, xr = -(M.b + M.ohR), hw = M.bodyW / 2, rc = 0.15;
    for (const cn of course.cones) {
      if (cn.hit) continue;
      const dx = cn.x - s[0], dy = cn.y - s[1];
      if (dx * dx + dy * dy > 64) continue;
      const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
      if (lx > xr - rc && lx < xf + rc && Math.abs(ly) < hw + rc) {
        cn.hit = true; coneHits++;
        const v = Math.hypot(s[3], s[4]) || 1;
        cn.dx = (s[3] * c - s[4] * sn) / v * 0.8; cn.dy = (s[3] * sn + s[4] * c) / v * 0.8;
        if (timing && timing.running) timing.hits++;
      }
    }
    // gate timing
    if (course.gate) {
      const gx = course.gate;
      if (!timing && s[0] >= gx.x0 && s[3] > 0) timing = { running: true, t0: t, v0: s[3], hits: 0 };
      if (timing && timing.running && s[0] >= gx.x1) { timing.running = false; timing.dt = t - timing.t0; timing.v1 = s[3]; }
    }
    // skid-pad lap
    if (course.lap) {
      const prevX = course._px === undefined ? s[0] : course._px;
      if (prevX < 0 && s[0] >= 0 && s[1] < course.lap.R && s[3] > 0) {
        if (lap && lap.t0 !== undefined) { lap.last = t - lap.t0; lap.ay = (4 * Math.PI * Math.PI * course.lap.R) / (lap.last * lap.last) / g; }
        lap = Object.assign(lap || {}, { t0: t });
      }
      course._px = s[0];
    }
    // skid marks while sliding
    const aux = model.aux;
    for (let i = 0; i < 4; i++) {
      const st = aux.state[i];
      const sliding = (st === STATE.LOCK || st === STATE.SPIN || aux.util[i] > 0.96) && Math.hypot(s[3], s[4]) > 1;
      const last = skids.last[i];
      if (sliding) {
        if (last && Math.hypot(aux.wx[i] - last[0], aux.wy[i] - last[1]) < 3) {
          const k = skids.head * 6;
          skids.buf[k] = last[0]; skids.buf[k + 1] = last[1]; skids.buf[k + 2] = aux.wx[i]; skids.buf[k + 3] = aux.wy[i];
          skids.buf[k + 4] = Math.min(1, aux.util[i]); skids.buf[k + 5] = t;
          skids.head = (skids.head + 1) % 6000; skids.n = Math.min(skids.n + 1, 6000);
        }
        skids.last[i] = [aux.wx[i], aux.wy[i]];
      } else skids.last[i] = null;
    }
    // CG trail
    trail.acc += 1;
    if (trail.acc >= 3) {
      trail.acc = 0;
      trail.x[trail.head] = s[0]; trail.y[trail.head] = s[1];
      trail.head = (trail.head + 1) % trail.x.length; trail.n = Math.min(trail.n + 1, trail.x.length);
    }
    gg.x[gg.head] = aux.ay / g; gg.y[gg.head] = aux.ax / g;
    gg.head = (gg.head + 1) % gg.x.length; gg.n = Math.min(gg.n + 1, gg.x.length);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function render(dtr) {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    }
    const C = { road: cssVar('--road'), line: cssVar('--road-line'), ink: cssVar('--ink'), ink2: cssVar('--ink-2'), ink3: cssVar('--ink-3'),
      cone: cssVar('--cone'), veh: cssVar('--vehicle'), vehInk: cssVar('--vehicle-ink'), accent: cssVar('--accent'),
      good: cssVar('--good'), warn: cssVar('--warn'), bad: cssVar('--bad'), surface: cssVar('--surface') };
    const v = Math.hypot(s[3], s[4]);
    // camera
    const k = 1 - Math.exp(-dtr / 0.12);
    const lead = Math.min(v * 0.35, 12);
    const tx_ = s[0] + lead * Math.cos(s[2]), ty_ = s[1] + lead * Math.sin(s[2]);
    cam.x += (tx_ - cam.x) * k; cam.y += (ty_ - cam.y) * k;
    let dRot = VD.util.wrapAngle(s[2] - cam.rot); cam.rot += dRot * (1 - Math.exp(-dtr / 0.35));
    const zTarget = (opt.autoZoom ? 30 / (1 + v / 22) : 16) * zoomUser * Math.min(1.4, Math.max(0.6, Math.min(W, H) / 700));
    cam.z += (zTarget - cam.z) * (1 - Math.exp(-dtr / 0.5));
    const z = cam.z;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.road; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2 + (opt.cam === 'heading' ? H * 0.18 : 0));
    ctx.scale(z, -z);
    if (opt.cam === 'heading') ctx.rotate(Math.PI / 2 - cam.rot);
    ctx.translate(-cam.x, -cam.y);
    const px = 1 / z;

    // grid
    const R = Math.hypot(W, H) / z;
    const step = z > 8 ? 5 : z > 3 ? 10 : 25;
    ctx.strokeStyle = C.line; ctx.lineWidth = px;
    ctx.beginPath();
    const gx0 = Math.floor((cam.x - R) / step) * step, gy0 = Math.floor((cam.y - R) / step) * step;
    for (let x = gx0; x <= cam.x + R; x += step) { ctx.moveTo(x, cam.y - R); ctx.lineTo(x, cam.y + R); }
    for (let y = gy0; y <= cam.y + R; y += step) { ctx.moveTo(cam.x - R, y); ctx.lineTo(cam.x + R, y); }
    ctx.stroke();

    // friction zones
    for (const zn of course.zones) {
      ctx.fillStyle = C.accent; ctx.globalAlpha = 0.12;
      ctx.fillRect(zn.x0, zn.y0, zn.x1 - zn.x0, zn.y1 - zn.y0);
      ctx.globalAlpha = 1;
    }
    // course lines & circles
    ctx.strokeStyle = C.cone; ctx.globalAlpha = 0.35; ctx.lineWidth = 1.5 * px;
    for (const l of course.lines) { ctx.beginPath(); ctx.moveTo(l[0], l[1]); ctx.lineTo(l[2], l[3]); ctx.stroke(); }
    for (const ci of course.circles) { ctx.beginPath(); ctx.arc(ci.cx, ci.cy, ci.r, 0, 2 * Math.PI); ctx.stroke(); }
    ctx.globalAlpha = 1;
    // skid marks
    ctx.strokeStyle = C.ink; ctx.lineCap = 'round';
    const tw = Math.max(0.16, 0.34 * Math.min(1.05, Math.max(0.55, 0.24 * model.M.L)));
    ctx.lineWidth = tw;
    for (let i = 0; i < skids.n; i++) {
      const kk = ((skids.head - 1 - i + 6000) % 6000) * 6;
      const age = t - skids.buf[kk + 5];
      ctx.globalAlpha = 0.28 * skids.buf[kk + 4] * Math.max(0.25, 1 - age / 60);
      ctx.beginPath(); ctx.moveTo(skids.buf[kk], skids.buf[kk + 1]); ctx.lineTo(skids.buf[kk + 2], skids.buf[kk + 3]); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // trail
    if (opt.trail && trail.n > 1) {
      ctx.strokeStyle = C.accent; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.5 * px; ctx.beginPath();
      const N = trail.x.length;
      for (let i = 0; i < trail.n; i++) {
        const kk = (trail.head - trail.n + i + N) % N;
        if (i) ctx.lineTo(trail.x[kk], trail.y[kk]); else ctx.moveTo(trail.x[kk], trail.y[kk]);
      }
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // cones
    for (const cn of course.cones) {
      ctx.fillStyle = C.cone; ctx.globalAlpha = cn.hit ? 0.35 : 1;
      ctx.beginPath(); ctx.arc(cn.x + cn.dx, cn.y + cn.dy, Math.max(0.17, 2.5 * px), 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawVehicle(C, px);
    ctx.restore();

    // screen-space overlays: scale bar and zone labels
    const sb = step;
    ctx.fillStyle = C.ink2; ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(16, H - 20); ctx.lineTo(16 + sb * z, H - 20); ctx.moveTo(16, H - 25); ctx.lineTo(16, H - 15); ctx.moveTo(16 + sb * z, H - 25); ctx.lineTo(16 + sb * z, H - 15); ctx.stroke();
    ctx.font = `12px ${cssVar('--font-sans')}`; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`${sb} m`, 16, H - 26);
    if (course.zones.length) { ctx.textBaseline = 'top'; ctx.fillStyle = C.ink2; ctx.fillText(L({ ko: '파란 영역: μ = 0.2 (저마찰)', en: 'Blue area: μ = 0.2 (low friction)' }), 16, H - 60); }
  }

  function drawVehicle(C, px) {
    const M = model.M, aux = model.aux;
    const len = M.a + M.ohF + M.b + M.ohR, hw = M.bodyW / 2;
    const dT = Math.min(1.05, Math.max(0.55, 0.24 * M.L)), wT = dT * 0.34;
    ctx.save();
    ctx.translate(s[0], s[1]); ctx.rotate(s[2]);
    // shadow-free flat body
    ctx.fillStyle = C.veh;
    roundRect(-(M.b + M.ohR), -hw, len, M.bodyW, Math.min(0.35, hw * 0.4)); ctx.fill();
    // windscreen band marks the front
    ctx.fillStyle = C.vehInk; ctx.globalAlpha = 0.35;
    roundRect(M.a * 0.35, -hw * 0.82, Math.max(0.35, M.ohF * 0.5), hw * 1.64, 0.12); ctx.fill();
    ctx.globalAlpha = 1;
    // wheels coloured by friction utilisation, outline marks the tire state
    const pos = [[M.a, M.wf / 2], [M.a, -M.wf / 2], [-M.b, M.wr / 2], [-M.b, -M.wr / 2]];
    for (let i = 0; i < 4; i++) {
      ctx.save();
      ctx.translate(pos[i][0], pos[i][1]); ctx.rotate(aux.delta[i]);
      const ut = aux.util[i], st = aux.state[i];
      ctx.fillStyle = st === STATE.LIFT ? C.ink3 : ut > 0.97 || st === STATE.LOCK || st === STATE.SPIN ? C.bad : ut > 0.8 ? C.warn : C.good;
      roundRect(-dT / 2, -wT / 2, dT, wT, 0.05); ctx.fill();
      ctx.restore();
    }
    // tire force vectors (body frame), 1 m per 5 kN
    if (opt.forces) {
      ctx.strokeStyle = C.ink; ctx.lineWidth = 2 * px; ctx.fillStyle = C.ink;
      for (let i = 0; i < 4; i++) arrow(pos[i][0], pos[i][1], aux.Fx[i] / 5000, aux.Fy[i] / 5000, px);
      // velocity vector at the CG (0.3 s look-ahead)
      ctx.strokeStyle = C.accent; ctx.fillStyle = C.accent;
      arrow(0, 0, s[3] * 0.3, s[4] * 0.3, px);
    }
    // CG mark
    ctx.fillStyle = C.surface; ctx.beginPath(); ctx.arc(0, 0, 4 * px, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5 * px; ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + hh - r); ctx.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
    ctx.lineTo(x + r, y + hh); ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  function arrow(x, y, dx, dy, px) {
    const l = Math.hypot(dx, dy);
    if (l < 3 * px) return;
    const ux = dx / l, uy = dy / l, hd = Math.min(0.35, l * 0.35);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx - hd * ux + hd * 0.5 * uy, y + dy - hd * uy - hd * 0.5 * ux);
    ctx.lineTo(x + dx - hd * ux - hd * 0.5 * uy, y + dy - hd * uy + hd * 0.5 * ux); ctx.closePath(); ctx.fill();
  }

  // ---------------------------------------------------------------------------
  // Telemetry panel
  // ---------------------------------------------------------------------------
  function buildTelemetry() {
    const bar = (cls, label) => {
      const fill = h('div', { class: 'fill' });
      const val = h('span', { class: 'v' });
      return { el: h('div', { class: ['bar', cls] }, h('span', null, tx(label)), h('div', { class: ['track', cls === 'steer' && 'center'] }, fill), val), fill, val };
    };
    tele.speed = h('span', { class: 'speed-big num' }, '0');
    tele.gear = h('span', { class: 'gear' }, 'D');
    tele.thr = bar(null, { ko: '가속', en: 'Throttle' });
    tele.brk = bar('brake', { ko: '제동', en: 'Brake' });
    tele.swa = bar('steer', { ko: '조향휠', en: 'Steering' });
    tele.assist = {};
    const asst = h('div', { class: 'btn-row', style: { gap: '6px' } });
    for (const k of ['ABS', 'TCS', 'ESC']) { tele.assist[k] = h('span', { class: 'badge info' }, k); asst.appendChild(tele.assist[k]); }
    tele.ggCanvas = h('canvas', { style: { width: '100%', height: '170px', display: 'block' }, role: 'img', 'aria-label': 'g-g diagram' });
    tele.wheels = [];
    const wheels = h('div', { class: 'wheels' });
    for (let i = 0; i < 4; i++) {
      const w = { st: h('span', { class: 'st', 'data-s': '0' }, 'GRIP'), fz: h('span'), al: h('span'), ut: h('i'), el: null };
      w.el = h('div', { class: 'wheel' },
        h('div', { class: 'wh' }, h('span', null, tx(WHEEL_NAME[i])), w.st),
        h('div', { class: 'wr' }, h('span', null, 'Fz'), w.fz),
        h('div', { class: 'wr' }, h('span', null, 'α'), w.al),
        h('div', { class: 'ut' }, w.ut));
      tele.wheels.push(w); wheels.appendChild(w.el);
    }
    tele.vals = {};
    const kv = h('div', { class: 'kv' });
    for (const [k, lb, unit] of [['ay', { ko: '횡가속도', en: 'Lateral accel.' }, 'g'], ['ax', { ko: '종가속도', en: 'Longitudinal accel.' }, 'g'],
      ['r', { ko: '요 레이트', en: 'Yaw rate' }, 'deg/s'], ['beta', { ko: '차체 슬립각', en: 'Sideslip' }, 'deg'], ['R', { ko: '선회 반경', en: 'Turn radius' }, 'm']]) {
      tele.vals[k] = h('span');
      kv.append(h('div', { class: 'k' }, tx(lb)), h('div', { class: 'val' }, tele.vals[k], h('span', { class: 'u' }, unit)));
    }
    const plotHost = h('div');
    tele.plotR = new VD.Plot(plotHost, { x: { label: '', unit: 's' }, y: { label: { ko: '요 레이트', en: 'yaw rate' }, unit: 'deg/s' }, height: 120, hover: 'none', legend: true });
    const plotHost2 = h('div');
    tele.plotB = new VD.Plot(plotHost2, { x: { label: '', unit: 's' }, y: { label: { ko: '슬립각 β', en: 'sideslip β' }, unit: 'deg' }, height: 110, hover: 'none' });

    tele.recBtn = h('button', { type: 'button', class: 'btn sm', on: { click: () => (rec ? stopRecording() : startRecording()) } });
    tele.recInfo = h('span', { class: 'muted', style: { fontSize: 'var(--fs-xs)' } });
    tele.recActions = h('div', { class: 'btn-row' });
    renderRecButton();

    clear(teleHost).append(
      h('div', { class: 'tele-top' }, h('div', null, tele.speed, h('span', { class: 'speed-unit' }, 'km/h')), tele.gear),
      h('div', { class: 'bars' }, tele.thr.el, tele.brk.el, tele.swa.el),
      asst,
      h('section', null, h('h3', { class: 'subhead', style: { margin: '0 0 4px' } }, tx('마찰원 (g-g 선도)', 'Friction circle (g-g)')), tele.ggCanvas),
      kv,
      h('section', null, h('h3', { class: 'subhead', style: { margin: '0 0 6px' } }, tx('타이어 상태', 'Tire state')), wheels),
      h('section', null, plotHost, plotHost2),
      h('section', null, h('h3', { class: 'subhead', style: { margin: '0 0 6px' } }, tx('데이터 기록', 'Data recording')),
        h('div', { class: 'btn-row' }, tele.recBtn, tele.recInfo), tele.recActions));
  }

  function renderRecButton() {
    clear(tele.recBtn).append(icon(rec ? 'pause' : 'record'), ...tx(rec ? { ko: '기록 중지', en: 'Stop' } : { ko: '기록 시작', en: 'Record' }));
    tele.recBtn.classList.toggle('primary', !!rec);
    clear(tele.recActions);
    if (!rec && lastRecording) {
      tele.recActions.append(
        h('button', { type: 'button', class: 'btn sm', on: { click: () => exportRecording() } }, icon('table'), tx('CSV 저장', 'Save CSV')),
        h('button', { type: 'button', class: 'btn sm', on: { click: () => sendRecording() } }, icon('play'), tx('해석으로 보내기', 'Send to analysis')));
    }
  }

  function updateTelemetry() {
    const aux = model.aux, M = model.M;
    const v = Math.hypot(s[3], s[4]);
    tele.speed.textContent = fmt(v * 3.6 * Math.sign(s[3] || 1), 0);
    tele.gear.textContent = u.gear < 0 ? 'R' : 'D';
    tele.thr.fill.style.width = `${u.throttle * (u.throttleCut ?? 1) * 100}%`; tele.thr.val.textContent = `${fmt(u.throttle * 100, 0)} %`;
    tele.brk.fill.style.width = `${Math.max(u.brake, u.handbrake) * 100}%`; tele.brk.val.textContent = u.handbrake ? 'HB' : `${fmt(u.brake * 100, 0)} %`;
    const sw = u.swa / M.swaMax;
    tele.swa.fill.style.left = sw >= 0 ? '50%' : `${50 + sw * 50}%`;
    tele.swa.fill.style.width = `${Math.abs(sw) * 50}%`;
    tele.swa.val.textContent = `${fmt(u.swa * RAD, 0)}°`;
    const anyState = (st) => Array.prototype.some.call(aux.state, (x) => x === st);
    const lit = { ABS: opt.abs && anyState(STATE.ABS), TCS: opt.tcs && anyState(STATE.TCS), ESC: !!(esc && esc.active) };
    for (const k in lit) {
      const b = tele.assist[k];
      b.className = 'badge ' + (lit[k] ? 'active' : 'info');
      b.style.opacity = opt[k.toLowerCase()] ? '1' : '0.4';
    }
    for (let i = 0; i < 4; i++) {
      const w = tele.wheels[i];
      const st = aux.state[i];
      w.st.textContent = STATE_LABEL[st]; w.st.dataset.s = String(st);
      w.fz.textContent = `${fmt(aux.Fz[i] / 1000, 2)} kN`;
      w.al.textContent = `${fmt(aux.alpha[i] * RAD, 1)}°`;
      w.ut.style.width = `${Math.min(100, aux.util[i] * 100)}%`;
      w.el.dataset.level = aux.util[i] > 0.97 || st >= STATE.LOCK ? 'bad' : aux.util[i] > 0.8 ? 'warn' : 'ok';
    }
    tele.vals.ay.textContent = fmt(aux.ay / g, 2);
    tele.vals.ax.textContent = fmt(aux.ax / g, 2);
    tele.vals.r.textContent = fmt(s[5] * RAD, 1);
    tele.vals.beta.textContent = fmt(v > 1 ? Math.atan2(s[4], Math.abs(s[3])) * RAD : 0, 1);
    tele.vals.R.textContent = Math.abs(s[5]) > 0.01 && v > 1 ? fmt(v / Math.abs(s[5]), 1) : '—';
    if (rec) tele.recInfo.textContent = `● ${fmt(t - recStart, 1)} s`;
    // HUD: course timing
    clear(hudEl);
    const parts = [];
    if (timing) parts.push(timing.running ? `${L({ ko: '구간', en: 'Section' })} ${fmt(t - timing.t0, 2)} s`
      : `${L({ ko: '통과', en: 'Run' })} ${fmt(timing.dt, 2)} s · ${L({ ko: '진입', en: 'entry' })} ${fmt(timing.v0 * 3.6, 1)} km/h · ${L({ ko: '콘', en: 'cones' })} ${timing.hits}`);
    if (lap && lap.last) parts.push(`${L({ ko: '랩', en: 'Lap' })} ${fmt(lap.last, 2)} s · ${fmt(lap.ay, 2)} g`);
    if (course.cones.length) parts.push(`${L({ ko: '콘 접촉', en: 'Cones hit' })} ${coneHits}`);
    parts.push(`t ${fmt(t, 1)} s${opt.scale !== 1 ? ` · ×${opt.scale}` : ''}`);
    hudEl.textContent = parts.join('  ·  ');
  }

  function drawGG() {
    const cv = tele.ggCanvas, c2 = cv.getContext('2d');
    const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    c2.clearRect(0, 0, W, H);
    const mu = Math.max(muAt(s[0], s[1]) * Math.min(model.M.muF, model.M.muR), 0.1);
    const lim = Math.max(1.0, Math.ceil(mu * 1.2 * 2) / 2);
    const R = Math.min(W, H) / 2 - 14, cx = W / 2, cy = H / 2, k = R / lim;
    c2.strokeStyle = cssVar('--grid'); c2.lineWidth = 1;
    c2.beginPath(); c2.moveTo(cx - R, cy); c2.lineTo(cx + R, cy); c2.moveTo(cx, cy - R); c2.lineTo(cx, cy + R); c2.stroke();
    for (let q = 0.5; q <= lim + 1e-9; q += 0.5) { c2.beginPath(); c2.arc(cx, cy, q * k, 0, 2 * Math.PI); c2.stroke(); }
    c2.strokeStyle = cssVar('--ink-3'); c2.setLineDash([4, 3]);
    c2.beginPath(); c2.arc(cx, cy, mu * k, 0, 2 * Math.PI); c2.stroke(); c2.setLineDash([]);
    c2.fillStyle = cssVar('--ink-3'); c2.font = `11px ${cssVar('--font-sans')}`; c2.textAlign = 'left'; c2.textBaseline = 'top';
    c2.fillText(`μg = ${fmt(mu, 2)}`, cx + mu * k * 0.71 + 2, cy - mu * k * 0.71 - 12);
    c2.fillText('a_y [g] →', cx + R - 52, cy + 3);
    c2.fillText('a_x [g]', cx + 6, cy - R - 2);
    const N = gg.x.length;
    c2.strokeStyle = cssVar('--accent'); c2.globalAlpha = 0.6; c2.lineWidth = 1.5; c2.beginPath();
    for (let i = 0; i < gg.n; i++) {
      const kk = (gg.head - gg.n + i + N) % N;
      // ISO: +ay is a left turn → plotted to the left so the trace matches the view from the driver's seat
      const x = cx - gg.x[kk] * k, y = cy - gg.y[kk] * k;
      if (i) c2.lineTo(x, y); else c2.moveTo(x, y);
    }
    c2.stroke(); c2.globalAlpha = 1;
    if (gg.n) {
      const kk = (gg.head - 1 + N) % N;
      c2.fillStyle = cssVar('--accent'); c2.beginPath(); c2.arc(cx - gg.x[kk] * k, cy - gg.y[kk] * k, 5, 0, 2 * Math.PI); c2.fill();
    }
  }

  function updateStrips() {
    const v = Math.hypot(s[3], s[4]);
    strip.t.push(t); strip.r.push(s[5] * RAD); strip.rRef.push(esc ? esc.rRef * RAD : NaN);
    strip.ay.push(model.aux.ay); strip.beta.push(v > 1 ? Math.atan2(s[4], Math.abs(s[3])) * RAD : 0);
    while (strip.t.length && strip.t[0] < t - 10) { strip.t.shift(); strip.r.shift(); strip.rRef.shift(); strip.ay.shift(); strip.beta.shift(); }
    const xr = { min: Math.max(0, t - 10), max: Math.max(10, t) };
    tele.plotR.o.x.min = xr.min; tele.plotR.o.x.max = xr.max;
    tele.plotB.o.x.min = xr.min; tele.plotB.o.x.max = xr.max;
    tele.plotR.setData({ series: [
      { x: strip.t, y: strip.r, color: '--series-1', label: { ko: '요 레이트', en: 'yaw rate' }, mono: true },
      { x: strip.t, y: strip.rRef, color: '--ink-3', dash: 'dash', width: 1.5, label: { ko: 'ESC 기준', en: 'ESC reference' }, mono: true },
    ], keepView: true });
    tele.plotB.setData({ series: [{ x: strip.t, y: strip.beta, color: '--series-2', label: 'β', mono: true }], keepView: true });
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------
  function startRecording() {
    rec = new VD.sim.Recorder(6000);
    recStart = t; nextRec = t;
    lastRecording = null;
    renderRecButton();
  }
  function stopRecording() {
    if (!rec) return;
    const out = rec.finish();
    rec = null;
    if (out.n > 10) {
      const p = Object.assign({}, store.state.vehicle);
      const res = { n: out.n, ch: out.ch, dt: DT, outDt: 0.01, events: {}, diverged: false };
      lastRecording = {
        maneuver: 'drive', p, mp: {}, res, lin: null, cpuMs: 0,
        settings: store.sanitizeSettings({ track: 'dual', tire: 'mf', dt: DT, outDt: 0.01, mu: opt.mu, abs: opt.abs ? 'on' : 'off', tcs: opt.tcs ? 'on' : 'off', esc: opt.esc ? 'on' : 'off' }),
        metrics: VD.maneuvers.genericMetrics(res), warnings: [], assists: { abs: opt.abs, tcs: opt.tcs, esc: opt.esc },
        annot: { cones: course.cones.length && course.cones.length < 400 ? course.cones.map((c) => ({ x: c.x, y: c.y })) : null },
        course: opt.course,
      };
      tele.recInfo.textContent = `${fmt(out.ch.t[out.n - 1], 1)} s · ${out.n} ${L({ ko: '샘플', en: 'samples' })}`;
    } else {
      tele.recInfo.textContent = '';
    }
    renderRecButton();
  }
  function exportRecording() {
    if (!lastRecording) return;
    const c = lastRecording.res.ch, n = lastRecording.res.n;
    const keys2 = VD.sim.CHANNELS.map((x) => x.key);
    const lines = [keys2.map((k) => `${k} [${VD.sim.CHANNEL_BY_KEY[k].unit}]`).join(',')];
    for (let i = 0; i < n; i++) lines.push(keys2.map((k) => (Number.isFinite(c[k][i]) ? +c[k][i].toPrecision(7) : '')).join(','));
    download(`drive_${safeName(store.vehicleLabel())}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }
  function sendRecording() {
    if (!lastRecording) return;
    const courseName = L(COURSES.find((c) => c.id === lastRecording.course).label);
    store.state.analysis.maneuver = 'drive';
    const label = `${L({ ko: '주행 기록', en: 'Drive' })} · ${courseName}`;
    store.addRun(lastRecording, label, { tag: `${courseName} · ${fmt(lastRecording.res.ch.t[lastRecording.res.n - 1], 1)} s` });
    VD.app.show('maneuvers');
    const sel = document.getElementById('mn-select');
    if (sel) { sel.value = 'drive'; sel.dispatchEvent(new Event('change')); }
    toast({ ko: '기록을 [시험 해석]으로 보냈습니다.', en: 'Recording sent to [Test maneuvers].' });
  }

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  function loop(ts) {
    raf = 0;
    if (!active) return;
    const dtr = lastFrame ? Math.min((ts - lastFrame) / 1000, 0.1) : 0.016;
    lastFrame = ts;
    if (!paused) {
      readInput(dtr);
      stepSim(dtr);
      updateCourse();
    }
    render(dtr);
    frame++;
    if (frame % 4 === 0) { updateTelemetry(); drawGG(); }
    if (frame % 6 === 0 && !paused) updateStrips();
    raf = requestAnimationFrame(loop);
  }
  function start() { if (!raf && active) { lastFrame = 0; raf = requestAnimationFrame(loop); } }
  function setPaused(p) { paused = p; pausedEl.classList.toggle('on', p); }

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------
  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'hb' };

  function mount(el) {
    root = el;
    el.classList.add('drive');
    canvas = h('canvas', { role: 'img', 'aria-label': 'Driving simulator view' });
    ctx = canvas.getContext('2d');
    hudEl = h('div', { class: 'drive-hud', 'aria-live': 'off' });
    pausedEl = h('div', { class: 'drive-paused' }, h('div', { class: 'card' },
      h('strong', null, tx('일시정지', 'Paused')), h('div', { class: 'muted' }, tx('P 키 또는 아래 버튼으로 계속', 'Press P or the button to resume')),
      h('button', { type: 'button', class: 'btn primary', style: { marginTop: '10px' }, on: { click: () => setPaused(false) } }, icon('play'), tx('계속', 'Resume'))));

    const sel = (items, value, onChange, labelObj) => {
      const sl = h('select', { class: 'select' });
      for (const it of items) { const o = h('option', { value: String(it.id ?? it.v) }); bind(o, 'text', it.label); sl.appendChild(o); }
      sl.value = String(value);
      sl.addEventListener('change', () => { onChange(sl.value); sl.blur(); canvas.focus(); });
      if (labelObj) bind(sl, 'aria-label', labelObj);
      return sl;
    };
    const toggle = (key, label) => {
      const b = h('button', { type: 'button', 'aria-pressed': opt[key] ? 'true' : 'false' }, label);
      b.addEventListener('click', () => {
        opt[key] = !opt[key]; b.setAttribute('aria-pressed', opt[key] ? 'true' : 'false');
        if (['abs', 'tcs', 'esc'].includes(key)) rebuild(true);
        b.blur();
      });
      return b;
    };
    const assists = h('div', { class: 'seg' }, toggle('abs', 'ABS'), toggle('tcs', 'TCS'), toggle('esc', 'ESC'));
    const view = h('div', { class: 'seg' }, toggle('forces', tx('힘', 'Forces')), toggle('trail', tx('궤적', 'Trail')), toggle('steerAssist', tx('조향 보조', 'Steer assist')));
    const camSeg = VD.forms.segmented([
      { value: 'follow', label: { ko: '북쪽 고정', en: 'North-up' } }, { value: 'heading', label: { ko: '차량 기준', en: 'Heading-up' } }],
    opt.cam, (v) => { opt.cam = v; });
    const speedSeg = VD.forms.segmented([{ value: 1, text: '1×' }, { value: 0.5, text: '½×' }, { value: 0.25, text: '¼×' }], opt.scale, (v) => { opt.scale = v; });
    bind(speedSeg, 'aria-label', { ko: '시뮬레이션 배속', en: 'Simulation speed' });

    const toolbar = h('div', { class: 'drive-toolbar' },
      h('div', { class: 'tb-group' }, sel(COURSES, opt.course, (v) => { opt.course = v; reset(); }, { ko: '코스', en: 'Course' }),
        sel(SURFACES, opt.mu, (v) => { opt.mu = Number(v); }, { ko: '노면', en: 'Surface' })),
      h('div', { class: 'tb-group' }, assists),
      h('div', { class: 'tb-group' }, camSeg, speedSeg),
      h('div', { class: 'tb-group' }, view),
      h('div', { class: 'tb-group' },
        h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => { reset(); canvas.focus(); } } }, icon('reset'), tx('초기화 (R)', 'Reset (R)')),
        h('button', { type: 'button', class: 'btn sm ghost', on: { click: () => setPaused(!paused) } }, icon('pause'), tx('일시정지 (P)', 'Pause (P)'))));

    helpEl = h('div', { class: 'drive-help' },
      h('h3', null, tx('조작', 'Controls')),
      h('dl', null,
        h('dt', null, h('kbd', null, '↑'), ' ', h('kbd', null, 'W')), h('dd', null, tx('가속 (후진 중에는 제동)', 'Throttle (brake when reversing)')),
        h('dt', null, h('kbd', null, '↓'), ' ', h('kbd', null, 'S')), h('dd', null, tx('제동 · 정지 후 유지하면 후진', 'Brake · hold at standstill to reverse')),
        h('dt', null, h('kbd', null, '←'), ' ', h('kbd', null, '→')), h('dd', null, tx('조향 (속도 감응 한계)', 'Steer (speed-sensitive limit)')),
        h('dt', null, h('kbd', null, 'Space')), h('dd', null, tx('주차 브레이크 (후륜)', 'Handbrake (rear)')),
        h('dt', null, h('kbd', null, 'R'), ' ', h('kbd', null, 'P'), ' ', h('kbd', null, 'C')), h('dd', null, tx('초기화 · 일시정지 · 카메라', 'Reset · pause · camera')),
        h('dt', null, h('kbd', null, '+'), ' ', h('kbd', null, '−')), h('dd', null, tx('확대 · 축소', 'Zoom in · out')),
        h('dt', null, tx('게임패드', 'Gamepad')), h('dd', null, tx('좌 스틱 조향 · RT 가속 · LT 제동 · A 주차 · Y 초기화', 'Left stick steer · RT throttle · LT brake · A handbrake · Y reset'))),
      h('button', { type: 'button', class: 'btn sm ghost', style: { marginTop: '6px' }, on: { click: () => { helpEl.hidden = true; } } }, tx('닫기 (H)', 'Close (H)')));

    // touch pad for coarse pointers
    const touch = {};
    ctrl.touch = touch;
    const tbtn = (k, label) => {
      const b = h('button', { type: 'button', class: 'btn', style: { width: '56px', height: '56px', fontSize: '20px' }, 'aria-label': k }, label);
      const set = (v) => (e) => { e.preventDefault(); touch[k] = v; };
      b.addEventListener('pointerdown', set(true)); b.addEventListener('pointerup', set(false));
      b.addEventListener('pointerleave', set(false)); b.addEventListener('pointercancel', set(false));
      return b;
    };
    const touchPad = h('div', { style: { position: 'absolute', right: '12px', bottom: '56px', zIndex: 3, display: 'none', gap: '8px' } },
      tbtn('left', '◀'), tbtn('right', '▶'), h('span', { style: { width: '24px' } }), tbtn('down', '▼'), tbtn('up', '▲'));
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) touchPad.style.display = 'flex';

    // keep keyboard focus on the scene after toolbar buttons, so Space never re-presses a button
    toolbar.addEventListener('click', (e) => { if (e.target.closest('button')) canvas.focus(); });
    if (window.matchMedia && window.matchMedia('(max-width: 860px), (pointer: coarse)').matches) helpEl.hidden = true;
    stage = h('div', { class: 'drive-stage' }, canvas, toolbar, helpEl, hudEl, touchPad, pausedEl);
    canvas.tabIndex = 0;
    teleHost = h('div', { class: 'tele' });
    const aside = h('aside', { class: 'aside', 'aria-label': 'Telemetry' },
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, tx('텔레메트리', 'Telemetry')),
        h('p', { class: 'panel-sub' }, tx('비선형 3DOF 이중 트랙 · MF 타이어 · RK4 1 kHz', 'Nonlinear 3DOF dual-track · MF tires · RK4 1 kHz'))),
      teleHost);
    el.append(stage, aside);

    canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomUser = clamp(zoomUser * (e.deltaY > 0 ? 0.88 : 1.14), 0.2, 6); }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (!active) return;
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || (tg.tagName === 'SELECT' && !e.code.startsWith('Arrow')))) return;
      if (tg && tg.tagName === 'SELECT') return;
      const k = KEYMAP[e.code];
      if (k) { keys.add(k); e.preventDefault(); return; }
      if (e.code === 'KeyR') reset();
      else if (e.code === 'KeyP') setPaused(!paused);
      else if (e.code === 'KeyC') { opt.cam = opt.cam === 'follow' ? 'heading' : 'follow'; camSeg.setValue(opt.cam); }
      else if (e.code === 'KeyH') helpEl.hidden = !helpEl.hidden;
      else if (e.code === 'Equal' || e.code === 'NumpadAdd') zoomUser = clamp(zoomUser * 1.2, 0.2, 6);
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract') zoomUser = clamp(zoomUser / 1.2, 0.2, 6);
    });
    window.addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (k) { keys.delete(k); if (active) e.preventDefault(); } });
    window.addEventListener('blur', () => keys.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden && active) { keys.clear(); setPaused(true); } });

    on('vehicle', () => { if (model) { rebuild(true); course = buildCourse(opt.course, store.state.vehicle); } });
    buildTelemetry();
    rebuild(false);
  }

  VD.views = VD.views || {};
  VD.views.drive = {
    mount,
    onShow() { active = true; tele.plotR && tele.plotR.resize(); tele.plotB && tele.plotB.resize(); start(); setTimeout(() => canvas && canvas.focus(), 0); emit('status', { ko: '실시간 주행 · 1 kHz', en: 'Real-time driving · 1 kHz' }); },
    onHide() { active = false; keys.clear(); if (raf) cancelAnimationFrame(raf); raf = 0; },
  };
})(globalThis.VD = globalThis.VD || {});
