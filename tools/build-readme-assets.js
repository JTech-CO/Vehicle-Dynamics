#!/usr/bin/env node
/*
 * Regenerates the README assets from the physics core:  npm run docs
 *
 *   docs/badges/*.svg        local status badges (no external badge service)
 *   docs/figures/*-light.svg result charts, light theme
 *   docs/figures/*-dark.svg  the same charts, dark theme
 *   README.md                sections between <!-- generated:… --> markers
 *
 * Everything is computed with the same code the app runs, so the README
 * cannot drift from the model. No dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const VD = require('../tests/load-core.js');

const ROOT = path.join(__dirname, '..');
const FIG_DIR = path.join(ROOT, 'docs', 'figures');
const BADGE_DIR = path.join(ROOT, 'docs', 'badges');
const { DEG, RAD, KPH, g } = VD.const;
const MAN = VD.maneuvers;

// Reference palette of the app's data-visualisation tokens (validated for CVD).
const THEMES = {
  light: {
    surface: '#fcfcfb', border: '#e1e0d9', ink: '#0b0b0b', ink2: '#52514e', muted: '#898781',
    grid: '#ecebe6', base: '#c3c2b7', cone: '#e8710a',
    s: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
    seq: ['#86b6ef', '#2a78d6', '#104281'],
  },
  dark: {
    surface: '#1a1a19', border: '#2c2c2a', ink: '#ffffff', ink2: '#c3c2b7', muted: '#898781',
    grid: '#262624', base: '#383835', cone: '#f08a24',
    s: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    seq: ['#256abf', '#6da7ec', '#cde2fb'],
  },
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r2 = (v) => Math.round(v * 100) / 100;

/** Escaped SVG text where `x_abc` renders abc as a subscript. */
function rich(str) {
  return String(str).split(/_([A-Za-z0-9,α-ω]+)/).map((t, i) => (i % 2 ? `<tspan baseline-shift="sub" font-size="75%">${esc(t)}</tspan>` : esc(t))).join('');
}

/** Rough text width for layout (Latin ≈ 0.56 em, CJK ≈ 1 em). */
function textWidth(str, size) {
  let w = 0;
  for (const ch of String(str).replace(/_/g, '')) w += /[ᄀ-ￜ]/.test(ch) ? size : /[il.,:;|' ]/.test(ch) ? size * 0.3 : /[mwMW]/.test(ch) ? size * 0.85 : size * 0.58;
  return w;
}

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------
function niceStep(range, count) {
  const raw = range / Math.max(count, 1);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
function ticks(min, max, count) {
  const step = niceStep(max - min, count);
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { out, digits: Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9))) };
}
const fmtNum = (v, d) => {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return (v < 0 && Number(s.replace(/,/g, '')) !== 0 ? '−' : '') + s;
};

// ---------------------------------------------------------------------------
// SVG line chart
// ---------------------------------------------------------------------------
/**
 * spec: { id, title, subtitle, x: {label, unit, min, max, log}, y: {label, unit, min, max},
 *         series: [{x, y, color: 's1'|'seq2'|'muted', dash, width, label}],
 *         vlines: [{x, label}], hlines: [{y, label}], underlay(map, T) → svg string }
 */
function chart(spec, mode) {
  const T = THEMES[mode];
  const W = spec.w || 720, H = spec.h || 400;
  const col = (c) => (c === 'muted' ? T.muted : c === 'ink' ? T.ink2 : c.startsWith('seq') ? T.seq[+c.slice(3) - 1] : T.s[+c.slice(1) - 1]);
  const L = 60, R = 22, TX = 20;
  let out = '';

  // legend layout (wraps)
  const items = spec.series.filter((s) => s.label);
  const rows = [[]];
  let lx = TX;
  for (const it of items) {
    const w = 26 + textWidth(it.label, 12) + 18;
    if (lx + w > W - R && rows[rows.length - 1].length) { rows.push([]); lx = TX; }
    rows[rows.length - 1].push({ it, x: lx });
    lx += w;
  }
  const legendTop = spec.subtitle ? 62 : 46;
  const legendH = items.length > 1 ? rows.length * 20 : 0;
  const top = legendTop + legendH + 22, bottom = H - 50;
  const pw = W - L - R, ph = bottom - top;

  // ranges
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of spec.series) for (let i = 0; i < s.x.length; i++) {
    if (!Number.isFinite(s.x[i]) || !Number.isFinite(s.y[i])) continue;
    x0 = Math.min(x0, s.x[i]); x1 = Math.max(x1, s.x[i]); y0 = Math.min(y0, s.y[i]); y1 = Math.max(y1, s.y[i]);
  }
  if (spec.x.min !== undefined) x0 = spec.x.min; if (spec.x.max !== undefined) x1 = spec.x.max;
  if (spec.y.min !== undefined) y0 = spec.y.min; else { const p = (y1 - y0) * 0.06; y0 -= p; }
  if (spec.y.max !== undefined) y1 = spec.y.max; else { const p = (y1 - y0) * 0.06; y1 += p; }
  const lx0 = spec.x.log ? Math.log10(x0) : x0, lx1 = spec.x.log ? Math.log10(x1) : x1;
  const X = (v) => L + ((spec.x.log ? Math.log10(v) : v) - lx0) / (lx1 - lx0) * pw;
  const Y = (v) => top + ph - (v - y0) / (y1 - y0) * ph;
  const map = { X, Y, L, top, pw, ph };

  out += `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" fill="${T.surface}" stroke="${T.border}"/>`;
  out += `<text x="${TX}" y="26" font-size="15" font-weight="600" fill="${T.ink}">${rich(spec.title)}</text>`;
  if (spec.subtitle) out += `<text x="${TX}" y="45" font-size="12" fill="${T.ink2}">${rich(spec.subtitle)}</text>`;
  if (items.length > 1) rows.forEach((row, ri) => row.forEach(({ it, x }) => {
    const yy = legendTop + ri * 20;
    out += `<line x1="${x}" y1="${yy}" x2="${x + 18}" y2="${yy}" stroke="${col(it.color)}" stroke-width="2.5" stroke-linecap="round"${it.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
    out += `<text x="${x + 24}" y="${yy + 4}" font-size="12" fill="${T.ink2}">${rich(it.label)}</text>`;
  }));

  // grid and ticks
  const yt = ticks(y0, y1, Math.max(3, Math.floor(ph / 52)));
  for (const v of yt.out) {
    const py = r2(Y(v));
    out += `<line x1="${L}" y1="${py}" x2="${L + pw}" y2="${py}" stroke="${v === 0 ? T.base : T.grid}"/>`;
    out += `<text x="${L - 8}" y="${py + 4}" font-size="11" fill="${T.muted}" text-anchor="end">${fmtNum(v, yt.digits)}</text>`;
  }
  if (spec.x.log) {
    for (let e = Math.floor(lx0); e <= Math.ceil(lx1); e++) {
      for (let k = 1; k <= 9; k++) {
        const v = k * Math.pow(10, e);
        if (v < x0 - 1e-12 || v > x1 + 1e-12) continue;
        const px = r2(X(v));
        out += `<line x1="${px}" y1="${top}" x2="${px}" y2="${top + ph}" stroke="${T.grid}"${k === 1 ? '' : ' stroke-opacity="0.55"'}/>`;
        if (k === 1) out += `<text x="${px}" y="${top + ph + 18}" font-size="11" fill="${T.muted}" text-anchor="middle">${fmtNum(v, Math.max(0, -e))}</text>`;
      }
    }
  } else {
    const xt = ticks(x0, x1, Math.max(3, Math.floor(pw / 78)));
    for (const v of xt.out) {
      const px = r2(X(v));
      out += `<line x1="${px}" y1="${top}" x2="${px}" y2="${top + ph}" stroke="${T.grid}"/>`;
      out += `<text x="${px}" y="${top + ph + 18}" font-size="11" fill="${T.muted}" text-anchor="middle">${fmtNum(v, xt.digits)}</text>`;
    }
  }
  out += `<line x1="${L}" y1="${top + ph + 0.5}" x2="${L + pw}" y2="${top + ph + 0.5}" stroke="${T.base}"/>`;
  out += `<text x="${TX}" y="${top - 10}" font-size="11" fill="${T.ink2}">${rich([spec.y.label, spec.y.unit ? `[${spec.y.unit}]` : ''].filter(Boolean).join(' '))}</text>`;
  out += `<text x="${L + pw}" y="${H - 10}" font-size="11" fill="${T.ink2}" text-anchor="end">${rich([spec.x.label, spec.x.unit ? `[${spec.x.unit}]` : ''].filter(Boolean).join(' '))}</text>`;

  // plot area
  const clip = `c-${spec.id}-${mode}`;
  out += `<clipPath id="${clip}"><rect x="${L}" y="${top}" width="${pw}" height="${ph}"/></clipPath><g clip-path="url(#${clip})">`;
  if (spec.underlay) out += spec.underlay(map, T);
  for (const h of spec.hlines || []) {
    const py = r2(Y(h.y));
    out += `<line x1="${L}" y1="${py}" x2="${L + pw}" y2="${py}" stroke="${T.muted}" stroke-dasharray="5 4"/>`;
    if (h.label) out += `<text x="${L + pw - 6}" y="${py - 6}" font-size="11" fill="${T.ink2}" text-anchor="end">${rich(h.label)}</text>`;
  }
  let lastX = -1e9, row = 0;
  for (const v of (spec.vlines || []).slice().sort((a, b) => a.x - b.x)) {
    const px = r2(X(v.x));
    row = px - lastX < 52 ? row + 1 : 0; lastX = px;
    out += `<line x1="${px}" y1="${top}" x2="${px}" y2="${top + ph}" stroke="${T.muted}" stroke-dasharray="3 3"/>`;
    if (v.label) out += `<text x="${px + 4}" y="${top + 13 + row * 14}" font-size="11" fill="${T.ink2}">${rich(v.label)}</text>`;
  }
  for (const s of spec.series) {
    // thin long series to ≤ ~900 points, always keeping the last sample
    const step = Math.max(1, Math.floor(s.x.length / 900));
    const idx = [];
    for (let i = 0; i < s.x.length; i += step) idx.push(i);
    if (idx[idx.length - 1] !== s.x.length - 1) idx.push(s.x.length - 1);
    let d = '', pen = false;
    for (const i of idx) {
      const xv = s.x[i], yv = s.y[i];
      if (!Number.isFinite(xv) || !Number.isFinite(yv) || (spec.x.log && xv <= 0)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${r2(X(xv))},${r2(Y(yv))}`;
      pen = true;
    }
    if (s.kind === 'points') {
      for (let i = 0; i < s.x.length; i++) out += `<circle cx="${r2(X(s.x[i]))}" cy="${r2(Y(s.y[i]))}" r="4.5" fill="${col(s.color)}" stroke="${T.surface}" stroke-width="2"/>`;
    } else {
      out += `<path d="${d}" fill="none" stroke="${col(s.color)}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="6 4"' : ''}/>`;
    }
  }
  out += '</g>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(FONT)}" role="img" aria-label="${esc(spec.title)}">${out}</svg>\n`;
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------
const P = (id) => VD.params.presetParams(id);
const name = (id) => VD.params.PRESETS.find((p) => p.id === id).name.en;
const metric = (run, id) => run.metrics.find((m) => m.id === id);
const sliceT = (run, t0) => { const c = run.res.ch; const i0 = c.t.findIndex((t) => t >= t0); return i0 < 0 ? 0 : i0; };

function figStep() {
  const series = [];
  ['sedan', 'suv', 'sports'].forEach((id, k) => {
    const run = MAN.execute('step', P(id), { v: 80, ampMode: 'ay', ayTarget: 4, tEnd: 4 }, { linearRef: false });
    const c = run.res.ch, rss = metric(run, 'rss').value;
    series.push({ x: Array.from(c.t, (t) => t - 0.5), y: Array.from(c.r, (r) => r / rss), color: `s${k + 1}`,
      label: `${name(id)} · T90 ${metric(run, 'tr90').value.toFixed(3)} s · overshoot ${metric(run, 'os').value.toFixed(1)} %` });
  });
  return { id: 'step', title: 'Step steer: normalised yaw-rate response (ISO 7401)',
    subtitle: '80 km/h, steering amplitude calibrated to a steady-state lateral acceleration of 4 m/s², nonlinear dual-track model',
    x: { label: 'time after steer onset', unit: 's', min: -0.2, max: 2.5 }, y: { label: 'r / r_ss', unit: '-', min: 0, max: 1.3 },
    series, hlines: [{ y: 1, label: 'steady state' }] };
}

function figHandling() {
  const series = [];
  const R = 40;
  ['sedan', 'sports', 'drift'].forEach((id, k) => {
    const p = P(id);
    const run = MAN.execute('circle', p, { R }, { linearRef: false });
    const c = run.res.ch;
    let best = -Infinity; for (let i = 0; i < c.t.length; i++) if (c.t[i] > 4) best = Math.max(best, c.ayg[i]);
    const xs = [], ys = [];
    for (let i = 0; i < c.t.length; i++) {
      if (c.t[i] < 4) continue;
      xs.push(c.ayg[i]); ys.push(c.swa[i] / p.steerRatio - ((p.a + p.b) / R) * RAD);
      if (c.ayg[i] >= 0.985 * best) break;
    }
    series.push({ x: xs, y: ys, color: `s${k + 1}`, label: `${name(id)} · K = ${metric(run, 'Kus').value.toFixed(2)} deg/g` });
  });
  return { id: 'handling', title: 'Handling diagram: constant radius 40 m (ISO 4138)',
    subtitle: 'Road-wheel angle above the Ackermann angle vs lateral acceleration; slope = understeer gradient K',
    x: { label: 'lateral acceleration', unit: 'g', min: 0 }, y: { label: 'δ − L/R', unit: 'deg' },
    series, hlines: [{ y: 0, label: 'neutral steer' }] };
}

function figGain() {
  const series = [], vl = [];
  ['sedan', 'sports', 'race', 'drift'].forEach((id, k) => {
    const p = P(id), us = VD.linear.understeer(p), L = p.a + p.b;
    const xs = [], ys = [];
    for (let v = 1; v <= 260; v += 1) { const y = 1 / (1 + (us.K * (v * KPH) ** 2) / L); xs.push(v); ys.push(y > 0 && y < 3.2 ? y : NaN); }
    series.push({ x: xs, y: ys, color: `s${k + 1}`, label: `${name(id)} (${us.Kdeg.toFixed(2)} deg/g)` });
    if (id === 'sedan') vl.push({ x: us.vch * 3.6, label: `v_ch ${Math.round(us.vch * 3.6)} km/h` });
    if (id === 'drift') vl.push({ x: us.vcrit * 3.6, label: `v_crit ${Math.round(us.vcrit * 3.6)} km/h` });
  });
  return { id: 'gain', title: 'Steady-state yaw-rate gain vs speed (linear single-track)',
    subtitle: 'Normalised to neutral steer: (r/δ)·L/v = 1/(1 + K v²/L); understeer falls, oversteer diverges at v_crit',
    x: { label: 'speed', unit: 'km/h', min: 0, max: 260 }, y: { label: '(r/δ)·L/v', unit: '-', min: 0, max: 3 },
    series, hlines: [{ y: 1, label: 'neutral steer' }], vlines: vl };
}

function figSwd() {
  const p = P('sedan');
  const on = MAN.execute('swd', p, { scalar: 5 }, { esc: 'on', linearRef: false });
  const off = MAN.execute('swd', p, { scalar: 5 }, { esc: 'off', linearRef: false });
  const v = (run) => (metric(run, 'verdict').verdict ? 'PASS' : 'FAIL');
  const yrr = (run) => { const m = metric(run, 'yrr1').value; return m === null ? 'spin' : `YRR(1.0 s) ${m.toFixed(0)} %`; };
  return { id: 'swd', title: 'Sine with dwell: ESC on vs off (FMVSS 126)',
    subtitle: `Mid-size sedan, 80 km/h coast, 0.7 Hz sine with 0.5 s dwell, 5 × A = ${metric(on, 'amp').value.toFixed(0)}° (BOS/COS: begin/completion of steer)`,
    x: { label: 'time', unit: 's', min: 0, max: on.res.ch.t[on.res.n - 1] }, y: { label: 'yaw rate', unit: 'deg/s', min: -60, max: 40 },
    series: [
      { x: on.res.ch.t, y: on.res.ch.r, color: 's1', label: `ESC on: ${v(on)} · ${yrr(on)}` },
      { x: off.res.ch.t, y: off.res.ch.r, color: 's2', label: `ESC off: ${v(off)} · ${yrr(off)}` },
    ],
    vlines: (on.annot.tMarks || []).map((m) => ({ x: m.t, label: m.label })) };
}

function figDlc() {
  const p = P('sedan');
  const runs = [80, 105].map((v) => MAN.execute('dlc', p, { v }, {}));
  const lanes = runs[0].annot.lanes;
  const underlay = (m, T) => {
    let s = '';
    for (const sec of lanes) for (const y of [sec.yL, sec.yR]) {
      s += `<line x1="${r2(m.X(sec.x0))}" y1="${r2(m.Y(y))}" x2="${r2(m.X(sec.x1))}" y2="${r2(m.Y(y))}" stroke="${T.cone}" stroke-width="1.5"/>`;
      const n = Math.round((sec.x1 - sec.x0) / 3);
      for (let k = 0; k <= n; k++) s += `<circle cx="${r2(m.X(sec.x0 + ((sec.x1 - sec.x0) * k) / n))}" cy="${r2(m.Y(y))}" r="3" fill="${T.cone}"/>`;
    }
    return s;
  };
  const lbl = (run, v) => `${v} km/h: ${metric(run, 'verdict').verdict ? 'PASS' : 'FAIL'} · max a_y ${metric(run, 'aymax').value.toFixed(1)} m/s²`;
  return { id: 'dlc', title: 'Double lane change: CG path through the cone gates (ISO 3888-1)',
    subtitle: 'Mid-size sedan with the built-in path-following driver; lateral axis exaggerated',
    x: { label: 'X', unit: 'm', min: -15, max: 140 },
    y: { label: 'Y', unit: 'm', min: Math.min(...lanes.map((l) => l.yR)) - 0.5, max: Math.max(...lanes.map((l) => l.yL)) + 0.5 },
    series: [
      { x: runs[0].res.ch.X, y: runs[0].res.ch.Y, color: 's1', label: lbl(runs[0], 80) },
      { x: runs[1].res.ch.X, y: runs[1].res.ch.Y, color: 's2', label: lbl(runs[1], 105) },
    ],
    underlay };
}

function figTire() {
  const p = P('sedan'), M = VD.params.toModel(p);
  const Fz = M.Fz0[0], Ca = M.Cf / 2, mu = M.muF;
  const a = []; for (let x = 0; x <= 16.0001; x += 0.1) a.push(x);
  const f = (model) => a.map((x) => -VD.tire.lateralPure(model, x * DEG, Fz, Ca, mu, M.mfC, M.mfE) / 1000);
  return { id: 'tire', title: 'Tire lateral force models',
    subtitle: `Front tire of the mid-size sedan at its static load F_z0 = ${Math.round(Fz)} N, μ = ${mu}, C_α = ${Math.round(Ca)} N/rad`,
    x: { label: 'slip angle α', unit: 'deg', min: 0, max: 16 }, y: { label: 'lateral force −Fy', unit: 'kN', min: 0, max: (1.35 * mu * Fz) / 1000 },
    series: [
      { x: a, y: f('mf'), color: 's1', label: `Magic Formula (C = ${M.mfC}, E = ${M.mfE})` },
      { x: a, y: f('fiala'), color: 's2', label: 'Fiala brush model' },
      { x: a, y: f('linear'), color: 's3', label: 'Linear (no saturation)' },
    ],
    hlines: [{ y: (mu * Fz) / 1000, label: 'μ·F_z' }] };
}

function figVerify() {
  const p = Object.assign({}, P('sedan'), { sigma: 0 });
  const run = MAN.execute('step', p, { v: 100, ampMode: 'swa', swa: 5, speedMode: 'fixed', tEnd: 3 }, { track: 'single', tire: 'linear', linearRef: true });
  const c = run.res.ch, lin = run.lin;
  const rl = Array.from(lin.r, (r) => r * RAD);
  let dmax = 0; const n = Math.min(c.r.length, rl.length);
  for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.abs(c.r[i] - rl[i]));
  const rss = metric(run, 'rss').value;
  return { id: 'verify', title: 'Verification: nonlinear solver vs closed-form linear model',
    subtitle: `Single track, linear tires, fixed 100 km/h, 5° steering step: max deviation ${(100 * dmax / rss).toFixed(2)} % of r_ss`,
    x: { label: 'time', unit: 's', min: 0, max: 3 }, y: { label: 'yaw rate', unit: 'deg/s', min: 0 },
    series: [
      { x: c.t, y: c.r, color: 's1', width: 4, label: 'Nonlinear 3DOF solver (RK4, 1 ms)' },
      { x: lin.t, y: rl, color: 's2', dash: true, label: 'Linear single-track model' },
    ] };
}

function figBode() {
  const p = P('sedan');
  const f = []; for (let k = 0; k <= 240; k++) f.push(Math.pow(10, -2 + (3 * k) / 240));
  const series = [60, 100, 140].map((v, i) => ({ x: f, y: VD.linear.freqResp(p, v * KPH, f).r.mag, color: `seq${i + 1}`, label: `${v} km/h` }));
  return { id: 'bode', title: 'Yaw-rate frequency response (linear single-track)',
    subtitle: 'Mid-size sedan, gain |r/δ_sw|; resonance rises and moves with speed',
    x: { label: 'frequency', unit: 'Hz', min: 0.01, max: 10, log: true }, y: { label: '|r/δ_sw|', unit: '1/s', min: 0 }, series };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
function badgeWidth(s) {
  let w = 0;
  for (const ch of s) w += /[il.:|' ·]/.test(ch) ? 3.6 : /[mwMW]/.test(ch) ? 9.6 : /[A-Z0-9]/.test(ch) ? 7.4 : 6.4;
  return Math.round(w + 12);
}
function badge(label, value, color) {
  const lw = badgeWidth(label), vw = badgeWidth(value), W = lw + vw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="20" role="img" aria-label="${esc(label)}: ${esc(value)}">` +
    `<title>${esc(label)}: ${esc(value)}</title><clipPath id="r"><rect width="${W}" height="20" rx="3"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#444"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana, DejaVu Sans, sans-serif" font-size="11">` +
    `<text x="${lw / 2}" y="14">${esc(label)}</text><text x="${lw + vw / 2}" y="14">${esc(value)}</text></g></svg>\n`;
}

// ---------------------------------------------------------------------------
// Benchmark table
// ---------------------------------------------------------------------------
function benchmark() {
  const rows = [];
  for (const pr of VD.params.PRESETS) {
    const p = P(pr.id);
    const d = VD.params.derive(p);
    const step = MAN.execute('step', p, {}, { linearRef: false });
    const sis = MAN.execute('sis', p, {}, { linearRef: false });
    const circ = MAN.execute('circle', p, {}, { linearRef: false });
    const dlc = MAN.execute('dlc', p, { v: 80 }, {});
    const brake = MAN.execute('brake', p, { v: 100 }, {});
    const fmvss = p.m <= 4536 ? MAN.execute('swd', p, {}, { linearRef: false }) : null;
    const acc = p.vMax > 101 ? MAN.execute('accel', p, { vEnd: 100 }, {}) : null;
    const f = (v, dg) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : fmtNum(v, dg));
    const verdict = (run) => (run ? (metric(run, 'verdict').verdict ? '✅' : '❌') : 'n/a');
    const speed = Number.isFinite(d.vch) ? `${Math.round(d.vch * 3.6)}` : `${Math.round(d.vcrit * 3.6)} (v<sub>crit</sub>)`;
    const lift = circ.warnings.some((w) => w.code === 'lift') ? '¹' : '';
    rows.push([pr.name.ko, f(p.m, 0), f(d.KusDegG, 2), speed, f(d.at100.fn, 2), f(d.at100.zeta, 2),
      f(metric(step, 'tr90').value, 3), f(metric(sis, 'A').value, 1), f(metric(circ, 'aymax').value, 2) + lift,
      verdict(fmvss), verdict(dlc), f(metric(brake, 'sd').value, 1), acc ? f(metric(acc, 't100').value, 1) : '-']);
  }
  const head = ['프리셋', 'm [kg]', 'K [deg/g]', 'v<sub>ch</sub> [km/h]', 'f<sub>n</sub> [Hz]', 'ζ', 'T<sub>r90</sub> [s]', 'A [deg]', 'a<sub>y,max</sub> [g]', 'FMVSS 126', 'ISO 3888-1 @80', '100→0 [m]', '0→100 [s]'];
  const lines = [`| ${head.join(' | ')} |`, `| ${head.map((h, i) => (i === 0 ? '---' : '---:')).join(' | ')} |`];
  for (const r of rows) lines.push(`| ${r.join(' | ')} |`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
function inject(readme, key, content) {
  const re = new RegExp(`(<!-- generated:${key} -->)[\\s\\S]*?(<!-- /generated:${key} -->)`);
  if (!re.test(readme)) { console.warn(`marker generated:${key} not found in README.md`); return readme; }
  return readme.replace(re, `$1\n${content}\n$2`);
}

function main() {
  fs.mkdirSync(FIG_DIR, { recursive: true });
  fs.mkdirSync(BADGE_DIR, { recursive: true });

  // 1. tests → badge
  let passed = 0, failed = 0;
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tests', 'run.js')], { encoding: 'utf8' });
    const m = /(\d+) passed, (\d+) failed/.exec(out); passed = +m[1]; failed = +m[2];
  } catch (e) {
    const m = /(\d+) passed, (\d+) failed/.exec(String(e.stdout || '')); if (m) { passed = +m[1]; failed = +m[2]; }
  }
  const badges = [
    ['license', 'license', 'MIT', '#1c5cab'],
    ['tests', 'tests', failed ? `${failed} failed` : `${passed} passed`, failed ? '#b02a2a' : '#2f7d32'],
    ['dependencies', 'dependencies', 'none', '#2f7d32'],
    ['build', 'build step', 'none', '#2f7d32'],
    ['offline', 'runs', 'offline · file://', '#1c5cab'],
    ['javascript', 'JavaScript', 'ES2020 · vanilla', '#8a6d00'],
    ['i18n', 'UI', 'Korean · English', '#1c5cab'],
    ['standards', 'standards', 'ISO 7401 · 4138 · 3888 · FMVSS 126', '#5b4bb3'],
    ['version', 'version', VD.version, '#555'],
  ];
  for (const [file, l, v, c] of badges) fs.writeFileSync(path.join(BADGE_DIR, `${file}.svg`), badge(l, v, c));

  // 2. figures
  const figs = [figStep(), figHandling(), figGain(), figBode(), figSwd(), figDlc(), figTire(), figVerify()];
  for (const spec of figs) for (const mode of ['light', 'dark']) fs.writeFileSync(path.join(FIG_DIR, `${spec.id}-${mode}.svg`), chart(spec, mode));

  // 3. README sections
  const readmePath = path.join(ROOT, 'README.md');
  let readme = fs.readFileSync(readmePath, 'utf8');
  // two centred rows: project status, then technology
  const LINKS = { license: 'LICENSE', tests: 'docs/VALIDATION.md', dependencies: 'package.json', standards: 'docs/MODEL.md' };
  const ROWS = [['license', 'version', 'tests', 'dependencies', 'build'], ['offline', 'javascript', 'i18n', 'standards']];
  const byFile = Object.fromEntries(badges.map((b) => [b[0], b]));
  const img = (file) => {
    const [, l, v] = byFile[file];
    const tag = `<img src="docs/badges/${file}.svg" alt="${esc(l)}: ${esc(v)}" height="20">`;
    return LINKS[file] ? `<a href="${LINKS[file]}">${tag}</a>` : tag;
  };
  const badgeMd = ROWS.map((row) => `<p align="center">\n  ${row.map(img).join('\n  ')}\n</p>`).join('\n');
  readme = inject(readme, 'badges', badgeMd);
  readme = inject(readme, 'benchmark', benchmark());
  fs.writeFileSync(readmePath, readme);

  console.log(`badges: ${badges.length}, figures: ${figs.length} × 2 themes, tests: ${passed} passed / ${failed} failed`);
}

main();
