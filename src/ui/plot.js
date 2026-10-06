/*!
 * Lightweight engineering plot on <canvas>. MIT License.
 *
 *  - line / point series, dashed variants, NaN gaps
 *  - nice linear ticks, log axes with decade/minor ticks, equal-aspect XY
 *  - hover crosshair + tooltip, synchronised across a plot group
 *  - drag to box-zoom, Shift+drag to pan, Ctrl+wheel to zoom, double-click to reset
 *  - min/max decimation for long monotonic series
 *  - PNG export including title and legend
 */
(function (VD) {
  'use strict';

  const { h, L, tx, fmtAuto, cssVar, on } = VD.ui;
  const groups = new Map();
  const all = new Set();

  // ---------------------------------------------------------------------------
  // Tick generation
  // ---------------------------------------------------------------------------
  function niceStep(range, count) {
    const raw = range / Math.max(count, 1);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    const m = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
    return m * p;
  }
  function linearTicks(min, max, count, fixedStep) {
    const step = fixedStep || niceStep(max - min, count);
    const start = Math.ceil(min / step - 1e-9) * step;
    const ticks = [];
    for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    const digits = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    return { ticks, step, digits: Math.min(digits, 6) };
  }
  function logTicks(min, max) {
    const major = [], minor = [];
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min > 40) return { major, minor };
    for (let e = Math.floor(min); e <= Math.ceil(max); e++) {
      if (e >= min - 1e-9 && e <= max + 1e-9) major.push(e);
      for (let k = 2; k <= 9; k++) { const v = e + Math.log10(k); if (v > min && v < max) minor.push(v); }
    }
    return { major, minor };
  }
  const fmtTick = (v, digits) => {
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e8 || a < 1e-4)) return v.toExponential(2).replace('-', '−');
    return VD.ui.fmt(v, digits);
  };
  const fmtLog = (e) => { const v = Math.pow(10, e); return v >= 1 ? VD.ui.fmt(v, 0) : VD.ui.fmt(v, Math.min(6, -e)); };

  function lowerBound(arr, x) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; }
    return lo;
  }
  function isMonotonic(arr) {
    for (let i = 1; i < arr.length; i += Math.max(1, Math.floor(arr.length / 200))) if (arr[i] < arr[i - 1]) return false;
    for (let i = 1; i < arr.length; i++) if (arr[i] < arr[i - 1]) return false;
    return true;
  }

  const DASH = { dash: [6, 4], dot: [2, 3], dashdot: [7, 3, 2, 3] };
  // Colours may be given as CSS custom-property names ('--series-1') so they follow the theme.
  const col = (c) => (typeof c === 'string' && c.startsWith('--') ? cssVar(c) : c);
  const cssCol = (c) => (typeof c === 'string' && c.startsWith('--') ? `var(${c})` : c);

  // ---------------------------------------------------------------------------
  class Plot {
    constructor(host, opts) {
      this.o = Object.assign({ x: {}, y: {}, equal: false, group: null, syncX: false, legend: true, hover: 'x', height: null }, opts || {});
      this.host = host;
      host.classList.add('plot-host');
      this.legendEl = h('div', { class: 'plot-legend', 'aria-hidden': 'true' });
      this.box = h('div', { class: ['plot', this.o.size] });
      if (this.o.height) this.box.style.height = this.o.height + 'px';
      this.canvas = h('canvas', { role: 'img' });
      this.tip = h('div', { class: 'plot-tip' });
      this.resetBtn = h('button', { class: 'btn sm plot-reset', type: 'button', i18n: { title: { ko: '확대 초기화 (더블클릭)', en: 'Reset zoom (double-click)' } } }, tx('원래 범위', 'Reset'));
      this.box.append(this.canvas, this.tip, this.resetBtn);
      host.append(this.legendEl, this.box);
      this.ctx = this.canvas.getContext('2d');
      this.series = []; this.vlines = []; this.hlines = []; this.under = null; this.over = null;
      this.view = null; this.cursorX = null; this.drag = null; this.map = null;
      this.w = 0; this.h = 0;
      this.bindEvents();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.box);
      if (this.o.group) {
        if (!groups.has(this.o.group)) groups.set(this.o.group, new Set());
        groups.get(this.o.group).add(this);
      }
      all.add(this);
      this.resize();
    }

    destroy() {
      this.ro.disconnect();
      if (this.o.group && groups.has(this.o.group)) groups.get(this.o.group).delete(this);
      all.delete(this);
    }

    peers() { return this.o.group && this.o.syncX ? Array.from(groups.get(this.o.group)).filter((p) => p !== this && p.o.syncX) : []; }

    setData(d) {
      this.series = (d.series || []).filter((sr) => sr && sr.x && sr.y && sr.x.length);
      this.series.forEach((sr) => { sr._mono = sr.mono !== undefined ? sr.mono : isMonotonic(sr.x); });
      this.vlines = d.vlines || [];
      this.hlines = d.hlines || [];
      this.under = d.underlay || null;
      this.over = d.overlay || null;
      this.bounds = d.bounds || null;
      if (d.keepView !== true) this.view = null;
      this.renderLegend();
      this.render();
    }

    setAxes(xo, yo) { if (xo) this.o.x = xo; if (yo) this.o.y = yo; this.render(); }

    renderLegend() {
      const el = this.legendEl;
      while (el.firstChild) el.removeChild(el.firstChild);
      const items = this.series.filter((sr) => sr.label && sr.legend !== false);
      if (!this.o.legend || items.length < 2) { el.style.display = this.o.legendSpace ? '' : 'none'; return; }
      el.style.display = '';
      for (const sr of items) {
        const key = h('span', { class: ['key', sr.kind === 'points' ? 'mark' : sr.dash] });
        key.style.color = cssCol(sr.color);
        el.appendChild(h('span', { class: 'lg' }, key, typeof sr.label === 'object' ? tx(sr.label) : sr.label));
      }
    }

    resize() {
      const r = this.box.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(10, Math.round(r.width)), hh = Math.max(10, Math.round(r.height));
      if (w === this.w && hh === this.h && this.dpr === dpr) return;
      this.w = w; this.h = hh; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(hh * dpr);
      this.render();
    }

    // -------------------------------------------------------------------------
    // Ranges
    // -------------------------------------------------------------------------
    dataRange() {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      const xl = this.o.x.log, yl = this.o.y.log;
      for (const sr of this.series) {
        if (sr.noBounds) continue;
        const { x, y } = sr;
        for (let i = 0; i < x.length; i++) {
          const xv = x[i], yv = y[i];
          if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
          if ((xl && xv <= 0) || (yl && yv <= 0)) continue;
          if (xv < x0) x0 = xv; if (xv > x1) x1 = xv;
          if (yv < y0) y0 = yv; if (yv > y1) y1 = yv;
        }
      }
      if (this.bounds) {
        const b = this.bounds;
        if (b.x0 !== undefined) x0 = Math.min(x0, b.x0); if (b.x1 !== undefined) x1 = Math.max(x1, b.x1);
        if (b.y0 !== undefined) y0 = Math.min(y0, b.y0); if (b.y1 !== undefined) y1 = Math.max(y1, b.y1);
      }
      if (!Number.isFinite(x0)) { x0 = xl ? 0.1 : 0; x1 = xl ? 10 : 1; y0 = yl ? 0.1 : 0; y1 = yl ? 10 : 1; }
      if (xl) { x0 = Math.log10(x0); x1 = Math.log10(x1); }
      if (yl) { y0 = Math.log10(y0); y1 = Math.log10(y1); }
      if (this.o.x.min !== undefined) x0 = this.o.x.min; if (this.o.x.max !== undefined) x1 = this.o.x.max;
      if (this.o.y.min !== undefined) y0 = this.o.y.min; if (this.o.y.max !== undefined) y1 = this.o.y.max;
      if (this.o.y.zero && !yl) { y0 = Math.min(y0, 0); y1 = Math.max(y1, 0); }
      if (x1 - x0 < 1e-12) { const c = x0; x0 = c - (Math.abs(c) * 0.1 || 1); x1 = c + (Math.abs(c) * 0.1 || 1); }
      if (y1 - y0 < 1e-12) { const c = y0; y0 = c - (Math.abs(c) * 0.1 || 1); y1 = c + (Math.abs(c) * 0.1 || 1); }
      return { x0, x1, y0, y1 };
    }

    layout(W, H) {
      const v = this.view || this.dataRange();
      let { x0, x1, y0, y1 } = v;
      const ctx = this.ctx;
      ctx.font = `12px ${cssVar('--font-sans') || 'system-ui'}`;
      if (!this.view && !this.o.y.log && this.o.y.min === undefined) {
        const pad = (y1 - y0) * 0.06; y0 -= pad; y1 += pad;
        if (this.o.y.zero && v.y0 >= 0) y0 = Math.max(y0, 0);
      }
      if (!this.view && this.o.equal) {
        const px = (x1 - x0) * 0.04, py = (y1 - y0) * 0.06; x0 -= px; x1 += px; y0 -= py; y1 += py;
      }
      // y tick labels decide the left margin
      const yt = this.o.y.log ? null : linearTicks(y0, y1, Math.max(3, Math.floor(H / 48)), this.o.y.step);
      let lw = 0;
      if (yt) for (const t of yt.ticks) lw = Math.max(lw, ctx.measureText(fmtTick(t, yt.digits)).width);
      else lw = ctx.measureText('0.001').width;
      const m = { l: Math.ceil(lw) + 14, r: 12, t: 20, b: 28 };
      const pw = Math.max(10, W - m.l - m.r), ph = Math.max(10, H - m.t - m.b);
      if (this.o.equal) {
        const sx = pw / (x1 - x0), sy = ph / (y1 - y0);
        const sc = Math.min(sx, sy);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        x0 = cx - pw / sc / 2; x1 = cx + pw / sc / 2; y0 = cy - ph / sc / 2; y1 = cy + ph / sc / 2;
      }
      const xs = (x) => m.l + ((this.o.x.log ? Math.log10(x) : x) - x0) / (x1 - x0) * pw;
      const ys = (y) => m.t + ph - ((this.o.y.log ? Math.log10(y) : y) - y0) / (y1 - y0) * ph;
      const xi = (px) => { const v2 = x0 + ((px - m.l) / pw) * (x1 - x0); return this.o.x.log ? Math.pow(10, v2) : v2; };
      const yi = (py) => { const v2 = y0 + ((m.t + ph - py) / ph) * (y1 - y0); return this.o.y.log ? Math.pow(10, v2) : v2; };
      return { m, pw, ph, x0, x1, y0, y1, xs, ys, xi, yi, yt, W, H, scale: this.o.equal ? pw / (x1 - x0) : null };
    }

    // -------------------------------------------------------------------------
    // Drawing
    // -------------------------------------------------------------------------
    render() {
      if (!this.w) return;
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.draw(ctx, this.w, this.h);
      this.resetBtn.style.display = this.view ? 'inline-flex' : 'none';
    }

    draw(ctx, W, H) {
      const C = {
        surface: cssVar('--surface'), grid: cssVar('--grid'), axis: cssVar('--axis'),
        base: cssVar('--line-strong'), ink: cssVar('--ink-2'), ink3: cssVar('--ink-3'), sel: cssVar('--accent'),
        font: cssVar('--font-sans') || 'system-ui',
      };
      const map = this.layout(W, H);
      this.map = map;
      const { m, pw, ph, x0, x1, y0, y1 } = map;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = C.surface; ctx.fillRect(0, 0, W, H);
      ctx.font = `12px ${C.font}`;
      ctx.lineWidth = 1;

      // grid + tick labels
      ctx.textBaseline = 'middle';
      if (this.o.y.log) {
        const lt = logTicks(y0, y1);
        ctx.strokeStyle = C.grid; ctx.globalAlpha = 0.5; ctx.beginPath();
        for (const e of lt.minor) { const py = Math.round(m.t + ph - ((e - y0) / (y1 - y0)) * ph) + 0.5; ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); }
        ctx.stroke(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.fillStyle = C.axis; ctx.textAlign = 'right';
        for (const e of lt.major) {
          const py = Math.round(m.t + ph - ((e - y0) / (y1 - y0)) * ph) + 0.5;
          ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); ctx.fillText(fmtLog(e), m.l - 6, py);
        }
        ctx.stroke();
      } else {
        ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.fillStyle = C.axis; ctx.textAlign = 'right';
        for (const t of map.yt.ticks) {
          const py = Math.round(map.ys(t)) + 0.5;
          if (py < m.t - 1 || py > m.t + ph + 1) continue;
          ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py);
          ctx.fillText(fmtTick(t, map.yt.digits), m.l - 6, py);
        }
        ctx.stroke();
      }
      ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      if (this.o.x.log) {
        const lt = logTicks(x0, x1);
        ctx.strokeStyle = C.grid; ctx.globalAlpha = 0.5; ctx.beginPath();
        for (const e of lt.minor) { const px = Math.round(m.l + ((e - x0) / (x1 - x0)) * pw) + 0.5; ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); }
        ctx.stroke(); ctx.globalAlpha = 1; ctx.beginPath();
        for (const e of lt.major) {
          const px = Math.round(m.l + ((e - x0) / (x1 - x0)) * pw) + 0.5;
          ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); ctx.fillText(fmtLog(e), px, m.t + ph + 6);
        }
        ctx.stroke();
      } else {
        // fewer ticks when the labels are wide (large numbers)
        let nT = Math.max(3, Math.floor(pw / 64)), xt;
        for (;;) {
          xt = linearTicks(x0, x1, nT, this.o.x.step);
          const lw = Math.max(...xt.ticks.map((t) => ctx.measureText(fmtTick(t, xt.digits)).width), 16);
          if (this.o.x.step || nT <= 2 || xt.ticks.length * (lw + 18) <= pw) break;
          nT--;
        }
        ctx.strokeStyle = C.grid; ctx.beginPath();
        for (const t of xt.ticks) {
          const px = Math.round(map.xs(t)) + 0.5;
          if (px < m.l - 1 || px > m.l + pw + 1) continue;
          ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph);
          ctx.fillText(fmtTick(t, xt.digits), px, m.t + ph + 6);
        }
        ctx.stroke();
      }
      // zero lines and frame baseline
      ctx.strokeStyle = C.base; ctx.beginPath();
      if (!this.o.y.log && y0 < 0 && y1 > 0) { const py = Math.round(map.ys(0)) + 0.5; ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); }
      if (!this.o.x.log && this.o.equal && x0 < 0 && x1 > 0) { const px = Math.round(map.xs(0)) + 0.5; ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); }
      ctx.moveTo(m.l, m.t + ph + 0.5); ctx.lineTo(m.l + pw, m.t + ph + 0.5);
      ctx.moveTo(m.l - 0.5, m.t); ctx.lineTo(m.l - 0.5, m.t + ph);
      ctx.stroke();

      // axis titles: unit above the y axis, x quantity at the bottom right
      ctx.fillStyle = C.ink3; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const yTitle = [L(this.o.y.label), this.o.y.unit ? `[${this.o.y.unit}]` : ''].filter(Boolean).join(' ');
      if (yTitle) ctx.fillText(yTitle, Math.max(2, m.l - 8), m.t - 7);
      const xTitle = [L(this.o.x.label), this.o.x.unit ? `[${this.o.x.unit}]` : ''].filter(Boolean).join(' ');
      if (xTitle) {
        ctx.textAlign = 'right';
        const tw = ctx.measureText(xTitle).width;
        ctx.fillStyle = C.surface; ctx.fillRect(m.l + pw - tw - 6, m.t + ph - 18, tw + 6, 16);
        ctx.fillStyle = C.ink3; ctx.fillText(xTitle, m.l + pw - 3, m.t + ph - 6);
      }

      ctx.save();
      ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
      if (this.under) this.under(ctx, map, C);

      // reference lines
      for (const hl of this.hlines) {
        if (!Number.isFinite(hl.y)) continue;
        const py = Math.round(map.ys(hl.y)) + 0.5;
        ctx.strokeStyle = hl.color || C.ink; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); ctx.stroke(); ctx.setLineDash([]);
        if (hl.label) { ctx.fillStyle = C.ink; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(L(hl.label), m.l + pw - 4, py - 2); }
      }
      let lastLx = -Infinity, row = 0;
      for (const vl of this.vlines.slice().sort((a, b) => a.x - b.x)) {
        if (!Number.isFinite(vl.x)) continue;
        const px = Math.round(map.xs(vl.x)) + 0.5;
        row = px - lastLx < 44 ? (row + 1) % 3 : 0;
        lastLx = px;
        ctx.strokeStyle = C.ink3; ctx.globalAlpha = 0.7; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        if (vl.label) { ctx.fillStyle = C.ink3; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = `11px ${C.font}`; ctx.fillText(L(vl.label), px + 3, m.t + 2 + row * 13); ctx.font = `12px ${C.font}`; }
      }

      for (const sr of this.series) this.drawSeries(ctx, sr, map);
      if (this.over) this.over(ctx, map, C);

      // crosshair
      if (this.cursor && this.o.hover !== 'none') {
        const c = this.cursor;
        ctx.strokeStyle = C.ink3; ctx.lineWidth = 1;
        ctx.beginPath();
        if (c.px !== undefined) { ctx.moveTo(Math.round(c.px) + 0.5, m.t); ctx.lineTo(Math.round(c.px) + 0.5, m.t + ph); }
        ctx.stroke();
        for (const pt of c.points || []) {
          ctx.fillStyle = C.surface; ctx.beginPath(); ctx.arc(pt.px, pt.py, 5.5, 0, 2 * Math.PI); ctx.fill();
          ctx.fillStyle = col(pt.color); ctx.beginPath(); ctx.arc(pt.px, pt.py, 3.5, 0, 2 * Math.PI); ctx.fill();
        }
      }
      // drag selection
      if (this.drag && this.drag.mode === 'zoom') {
        const d = this.drag;
        const xa = Math.min(d.x0, d.x1), xb = Math.max(d.x0, d.x1);
        const zoomY = this.o.equal || this.o.zoomY;
        const ya = zoomY ? Math.min(d.y0, d.y1) : m.t, yb = zoomY ? Math.max(d.y0, d.y1) : m.t + ph;
        ctx.fillStyle = C.sel; ctx.globalAlpha = 0.1; ctx.fillRect(xa, ya, xb - xa, yb - ya); ctx.globalAlpha = 1;
        ctx.strokeStyle = C.sel; ctx.strokeRect(xa + 0.5, ya + 0.5, xb - xa, yb - ya);
      }
      ctx.restore();
    }

    drawSeries(ctx, sr, map) {
      const { x, y } = sr;
      const n = x.length;
      const { m, pw } = map;
      const color = col(sr.color);
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.globalAlpha = sr.alpha === undefined ? 1 : sr.alpha;
      ctx.lineWidth = sr.width || 2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash(DASH[sr.dash] || []);
      const X = this.o.x.log ? (v) => (v > 0 ? map.xs(v) : NaN) : map.xs;
      const Y = this.o.y.log ? (v) => (v > 0 ? map.ys(v) : NaN) : map.ys;
      if (sr.kind === 'points') {
        const r = sr.r || 4;
        for (let i = 0; i < n; i++) {
          const px = X(x[i]), py = Y(y[i]);
          if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
          ctx.beginPath(); ctx.arc(px, py, r, 0, 2 * Math.PI); ctx.fill();
        }
        ctx.globalAlpha = 1; ctx.setLineDash([]);
        return;
      }
      let i0 = 0, i1 = n - 1;
      if (sr._mono && !this.o.x.log) {
        i0 = Math.max(0, lowerBound(x, map.x0) - 1);
        i1 = Math.min(n - 1, lowerBound(x, map.x1) + 1);
      }
      const count = i1 - i0 + 1;
      ctx.beginPath();
      let pen = false;
      if (sr._mono && count > pw * 3) {
        // min/max per pixel column
        let col = -1, mn = 0, mx = 0, first = 0, last = 0;
        const flush = () => {
          if (col < 0) return;
          const px = col + 0.5;
          if (!pen) { ctx.moveTo(px, first); pen = true; } else ctx.lineTo(px, first);
          ctx.lineTo(px, mn); ctx.lineTo(px, mx); ctx.lineTo(px, last);
        };
        for (let i = i0; i <= i1; i++) {
          const px = X(x[i]), py = Y(y[i]);
          if (!Number.isFinite(py) || !Number.isFinite(px)) { flush(); col = -1; pen = false; continue; }
          const c = Math.floor(px);
          if (c !== col) { flush(); col = c; mn = mx = first = last = py; }
          else { if (py < mn) mn = py; if (py > mx) mx = py; last = py; }
        }
        flush();
      } else {
        for (let i = i0; i <= i1; i++) {
          const px = X(x[i]), py = Y(y[i]);
          if (!Number.isFinite(px) || !Number.isFinite(py)) { pen = false; continue; }
          if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
      if (sr.endMarker && n) {
        const px = X(x[n - 1]), py = Y(y[n - 1]);
        if (Number.isFinite(px) && Number.isFinite(py)) {
          ctx.setLineDash([]);
          ctx.fillStyle = cssVar('--surface'); ctx.beginPath(); ctx.arc(px, py, 6, 0, 2 * Math.PI); ctx.fill();
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI); ctx.fill();
        }
      }
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      void m;
    }

    // -------------------------------------------------------------------------
    // Interaction
    // -------------------------------------------------------------------------
    bindEvents() {
      const cv = this.canvas;
      const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
      cv.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.map) return;
        const [px, py] = pos(e);
        cv.setPointerCapture(e.pointerId);
        this.drag = { x0: px, y0: py, x1: px, y1: py, mode: e.shiftKey ? 'pan' : 'zoom', view: this.currentView() };
      });
      cv.addEventListener('pointermove', (e) => {
        const [px, py] = pos(e);
        if (this.drag) {
          this.drag.x1 = px; this.drag.y1 = py;
          if (this.drag.mode === 'pan') this.pan(this.drag);
          else this.render();
          return;
        }
        this.hover(px, py, true);
      });
      cv.addEventListener('pointerup', (e) => {
        if (!this.drag) return;
        const d = this.drag; this.drag = null;
        try { cv.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        if (d.mode === 'zoom' && Math.abs(d.x1 - d.x0) > 6) this.zoomBox(d);
        else this.render();
      });
      cv.addEventListener('pointerleave', () => { if (!this.drag) this.hover(null, null, true); });
      cv.addEventListener('dblclick', () => this.resetView(true));
      cv.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey) || !this.map) return;
        e.preventDefault();
        const [px, py] = pos(e);
        const f = e.deltaY > 0 ? 1.25 : 0.8;
        const v = this.currentView();
        const mp = this.map;
        const cx = (this.o.x.log ? Math.log10(mp.xi(px)) : mp.xi(px));
        const cy = (this.o.y.log ? Math.log10(mp.yi(py)) : mp.yi(py));
        const zy = this.o.equal || this.o.zoomY;
        this.setView({ x0: cx + (v.x0 - cx) * f, x1: cx + (v.x1 - cx) * f,
          y0: zy ? cy + (v.y0 - cy) * f : v.y0, y1: zy ? cy + (v.y1 - cy) * f : v.y1 }, true);
      }, { passive: false });
      this.resetBtn.addEventListener('click', () => this.resetView(true));
    }

    currentView() { const mp = this.map; return { x0: mp.x0, x1: mp.x1, y0: mp.y0, y1: mp.y1 }; }

    setView(v, broadcast) {
      this.view = v;
      this.render();
      if (broadcast) for (const p of this.peers()) { p.view = p.view ? Object.assign({}, p.view, { x0: v.x0, x1: v.x1 }) : this.peerView(p, v); p.render(); }
    }
    peerView(p, v) {
      const r = p.dataRange();
      const pad = (r.y1 - r.y0) * 0.06;
      return { x0: v.x0, x1: v.x1, y0: r.y0 - pad, y1: r.y1 + pad };
    }
    resetView(broadcast) {
      this.view = null; this.render();
      if (broadcast) for (const p of this.peers()) { p.view = null; p.render(); }
    }
    zoomBox(d) {
      const mp = this.map;
      const lx = (v) => (this.o.x.log ? Math.log10(v) : v), ly = (v) => (this.o.y.log ? Math.log10(v) : v);
      const xa = lx(mp.xi(Math.min(d.x0, d.x1))), xb = lx(mp.xi(Math.max(d.x0, d.x1)));
      const zoomY = this.o.equal || this.o.zoomY;
      let ya = mp.y0, yb = mp.y1;
      if (zoomY) { ya = ly(mp.yi(Math.max(d.y0, d.y1))); yb = ly(mp.yi(Math.min(d.y0, d.y1))); }
      else { // fit y to data inside the new x window
        const r = this.yRangeIn(xa, xb);
        if (r) { const pad = (r[1] - r[0]) * 0.08 || 1; ya = r[0] - pad; yb = r[1] + pad; }
      }
      this.setView({ x0: xa, x1: xb, y0: ya, y1: yb }, true);
      if (!zoomY) for (const p of this.peers()) {
        const r = p.yRangeIn(xa, xb);
        if (r) { const pad = (r[1] - r[0]) * 0.08 || 1; p.view = { x0: xa, x1: xb, y0: r[0] - pad, y1: r[1] + pad }; p.render(); }
      }
    }
    yRangeIn(xa, xb) {
      let lo = Infinity, hi = -Infinity;
      for (const sr of this.series) for (let i = 0; i < sr.x.length; i++) {
        const xv = this.o.x.log ? Math.log10(sr.x[i]) : sr.x[i];
        if (xv >= xa && xv <= xb && Number.isFinite(sr.y[i])) { const yv = this.o.y.log ? Math.log10(sr.y[i]) : sr.y[i]; lo = Math.min(lo, yv); hi = Math.max(hi, yv); }
      }
      return Number.isFinite(lo) ? [lo, hi] : null;
    }
    pan(d) {
      const mp = this.map, v = d.view;
      const dxp = d.x1 - d.x0, dyp = d.y1 - d.y0;
      const kx = (v.x1 - v.x0) / mp.pw, ky = (v.y1 - v.y0) / mp.ph;
      this.setView({ x0: v.x0 - dxp * kx, x1: v.x1 - dxp * kx, y0: v.y0 + dyp * ky, y1: v.y1 + dyp * ky }, !(this.o.equal || this.o.zoomY));
    }

    /** Hover at canvas position (px, py); `local` broadcasts the x cursor to the group. */
    hover(px, py, local) {
      const mp = this.map;
      if (!mp || px === null || px < mp.m.l || px > mp.m.l + mp.pw || py < mp.m.t - 4 || py > mp.m.t + mp.ph + 4) {
        this.cursor = null; this.tip.style.display = 'none'; this.render();
        if (local) for (const p of this.peers()) p.showX(null);
        return;
      }
      if (this.o.hover === 'nearest' || this.o.equal) this.hoverNearest(px, py);
      else {
        const xv = mp.xi(px);
        this.showX(xv, px, py);
        if (local) for (const p of this.peers()) p.showX(xv);
      }
    }

    showX(xv, pxIn, pyIn) {
      const mp = this.map;
      if (!mp || xv === null || xv === undefined) { this.cursor = null; this.tip.style.display = 'none'; this.render(); return; }
      const px = pxIn !== undefined ? pxIn : mp.xs(xv);
      const pts = [], rows = [];
      for (const sr of this.series) {
        if (sr.hover === false || !sr._mono) continue;
        const i = lowerBound(sr.x, xv);
        if (i <= 0 || i >= sr.x.length) continue;
        const xa = sr.x[i - 1], xb = sr.x[i];
        const t = (xv - xa) / (xb - xa || 1);
        const yv = sr.y[i - 1] + (sr.y[i] - sr.y[i - 1]) * t;
        if (!Number.isFinite(yv)) continue;
        pts.push({ px, py: mp.ys(yv), color: sr.color });
        rows.push({ color: sr.color, label: sr.label, v: yv, unit: sr.unit !== undefined ? sr.unit : this.o.y.unit, digits: sr.digits });
      }
      this.cursor = { px, points: pts };
      this.render();
      this.showTip(px, pyIn !== undefined ? pyIn : mp.m.t + 20, this.fmtX(xv), rows);
    }

    hoverNearest(px, py) {
      const mp = this.map;
      let best = null, bd = 30 * 30;
      for (const sr of this.series) {
        if (sr.hover === false) continue;
        const n = sr.x.length, step = Math.max(1, Math.floor(n / 4000));
        for (let i = 0; i < n; i += step) {
          const qx = mp.xs(sr.x[i]), qy = mp.ys(sr.y[i]);
          const d = (qx - px) ** 2 + (qy - py) ** 2;
          if (d < bd) { bd = d; best = { sr, i, qx, qy }; }
        }
      }
      if (!best) { this.cursor = null; this.tip.style.display = 'none'; this.render(); return; }
      const { sr, i } = best;
      this.cursor = { points: [{ px: best.qx, py: best.qy, color: sr.color }] };
      this.render();
      const rows = [{ color: sr.color, label: sr.label, v: sr.y[i], unit: this.o.y.unit, digits: sr.digits }];
      const head = [`${L(this.o.x.label) || 'x'} ${fmtAuto(sr.x[i])}${this.o.x.unit ? ' ' + this.o.x.unit : ''}`];
      if (sr.t) head.push(`t ${VD.ui.fmt(sr.t[i], 2)} s`);
      this.showTip(best.qx, best.qy, head.join(' · '), rows, L(this.o.y.label));
    }

    fmtX(xv) { return `${L(this.o.x.label) || 'x'} = ${fmtAuto(xv)}${this.o.x.unit ? ' ' + this.o.x.unit : ''}`; }

    showTip(px, py, head, rows, yName) {
      const tip = this.tip;
      while (tip.firstChild) tip.removeChild(tip.firstChild);
      tip.appendChild(h('div', { class: 'tt-x' }, head));
      for (const r of rows) {
        const sw = h('span', { class: 'sw' }); sw.style.background = cssCol(r.color);
        const lbl = r.label ? L(r.label) : (yName || '');
        tip.appendChild(h('div', { class: 'tt-row' }, sw, h('span', null, lbl),
          h('span', { class: 'v' }, `${r.digits !== undefined ? VD.ui.fmt(r.v, r.digits) : fmtAuto(r.v)}${r.unit ? ' ' + r.unit : ''}`)));
      }
      tip.style.display = rows.length ? 'block' : 'none';
      const bw = this.box.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = px + 14, top = py - th / 2;
      if (left + tw > bw - 4) left = px - tw - 14;
      top = Math.max(2, Math.min(top, this.box.clientHeight - th - 2));
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }

    // -------------------------------------------------------------------------
    // Export
    // -------------------------------------------------------------------------
    toPNG(title) {
      const scale = 2, W = this.w, Hh = this.h;
      const items = this.series.filter((sr) => sr.label && sr.legend !== false);
      const headH = (title ? 26 : 6) + (items.length > 1 ? 20 : 0);
      const cv = document.createElement('canvas');
      cv.width = W * scale; cv.height = (Hh + headH) * scale;
      const ctx = cv.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = cssVar('--surface'); ctx.fillRect(0, 0, W, Hh + headH);
      const font = cssVar('--font-sans') || 'system-ui';
      let y = 6;
      if (title) { ctx.fillStyle = cssVar('--ink'); ctx.font = `600 14px ${font}`; ctx.textBaseline = 'top'; ctx.fillText(title, 10, y); y += 22; }
      if (items.length > 1) {
        let x = 10; ctx.font = `12px ${font}`; ctx.textBaseline = 'middle';
        for (const sr of items) {
          ctx.strokeStyle = col(sr.color); ctx.lineWidth = 2; ctx.setLineDash(DASH[sr.dash] || []);
          ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x + 16, y + 8); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = cssVar('--ink-2'); const lbl = L(sr.label); ctx.fillText(lbl, x + 22, y + 8);
          x += 22 + ctx.measureText(lbl).width + 16;
        }
      }
      ctx.translate(0, headH);
      const saved = this.cursor; this.cursor = null;
      this.draw(ctx, W, Hh);
      this.cursor = saved;
      return new Promise((res) => cv.toBlob(res, 'image/png'));
    }
  }

  // re-render on theme / language changes
  const rerenderAll = () => all.forEach((p) => { p.renderLegend(); p.render(); });
  on('lang', rerenderAll);
  on('theme', rerenderAll);

  VD.Plot = Plot;
  VD.plotUtil = { linearTicks, niceStep, col, cssCol };
})(globalThis.VD = globalThis.VD || {});
