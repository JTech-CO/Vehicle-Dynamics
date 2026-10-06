/*!
 * Parametric vehicle schematic (top and side view) as inline SVG. MIT License.
 * Drawn to scale from the active parameters; ISO 8855 axes at the CG.
 */
(function (VD) {
  'use strict';

  const { s } = VD.ui;
  const f2 = (v) => VD.ui.fmt(v, 2);

  /** Label parts: [symbol (italic), subscript, remainder]. */
  function label(t, parts) {
    const [sym, sub, rest] = parts;
    if (sym) t.appendChild(s('tspan', { class: 'sym', text: sym }));
    if (sub) t.appendChild(s('tspan', { 'baseline-shift': 'sub', 'font-size': '9', text: sub }));
    if (rest) t.appendChild(s('tspan', { text: rest }));
  }

  function arrowHead(x, y, ang, size) {
    const a1 = ang + Math.PI * 0.85, a2 = ang - Math.PI * 0.85;
    return `M${x},${y} L${x + size * Math.cos(a1)},${y + size * Math.sin(a1)} M${x},${y} L${x + size * Math.cos(a2)},${y + size * Math.sin(a2)}`;
  }

  /** Horizontal dimension line between x1 and x2 at height y, with label. */
  function hdim(g, x1, x2, y, lab, ext) {
    const e = ext || [];
    if (e[0] !== undefined) g.appendChild(s('line', { class: 'dim', x1, y1: e[0], x2: x1, y2: y + (y > e[0] ? 4 : -4) }));
    if (e[1] !== undefined) g.appendChild(s('line', { class: 'dim', x1: x2, y1: e[1], x2, y2: y + (y > e[1] ? 4 : -4) }));
    g.appendChild(s('path', { class: 'dim', d: `M${x1},${y} L${x2},${y} ${arrowHead(x1, y, Math.PI, 5)} ${arrowHead(x2, y, 0, 5)}` }));
    const t = s('text', { class: 'dim-text', x: (x1 + x2) / 2, y: y - 5, 'text-anchor': 'middle' });
    label(t, lab);
    g.appendChild(t);
  }
  function vdim(g, y1, y2, x, lab, anchor) {
    g.appendChild(s('path', { class: 'dim', d: `M${x},${y1} L${x},${y2} ${arrowHead(x, y1, -Math.PI / 2, 5)} ${arrowHead(x, y2, Math.PI / 2, 5)}` }));
    const t = s('text', { class: 'dim-text', x: x + (anchor === 'end' ? -6 : 6), y: (y1 + y2) / 2 + 4, 'text-anchor': anchor || 'start' });
    label(t, lab);
    g.appendChild(t);
  }

  function build(p) {
    const wrap = VD.ui.h('div', { class: 'diagram-pair' });
    wrap.append(topView(p), sideView(p));
    return wrap;
  }

  const tireDims = (p) => {
    const dT = Math.min(1.05, Math.max(0.55, 0.24 * (p.a + p.b)));
    return { dT, wT: dT * 0.34 };
  };

  function topView(p) {
    const W = 470;
    const a = p.a, b = p.b, L = a + b;
    const xf = a + p.ohF, xr = -(b + p.ohR), len = xf - xr;
    const hw = p.bodyW / 2;
    const { dT, wT } = tireDims(p);
    const marginX = 84;
    const k = (W - 2 * marginX) / len;               // px per metre
    const X = (x) => marginX + (x - xr) * k;
    const cy = 34 + hw * k;
    const Y = (y) => cy - y * k;
    const H = Math.round(cy + hw * k + 70);

    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Top view' });
    const g = s('g');
    svg.appendChild(g);
    const r = Math.min(0.35 * k, 12);
    g.appendChild(s('rect', { class: 'body', x: X(xr), y: Y(hw), width: len * k, height: p.bodyW * k, rx: r }));
    g.appendChild(s('line', { class: 'axle', x1: X(a), y1: Y(p.wf / 2), x2: X(a), y2: Y(-p.wf / 2) }));
    g.appendChild(s('line', { class: 'axle', x1: X(-b), y1: Y(p.wr / 2), x2: X(-b), y2: Y(-p.wr / 2) }));
    for (const [x, y] of [[a, p.wf / 2], [a, -p.wf / 2], [-b, p.wr / 2], [-b, -p.wr / 2]]) {
      g.appendChild(s('rect', { class: 'tire', x: X(x) - (dT * k) / 2, y: Y(y) - (wT * k) / 2, width: dT * k, height: wT * k, rx: 2 }));
    }
    const ax = Math.min(0.9 * k, (a * k) * 0.8);
    g.appendChild(s('path', { class: 'axis-line', d: `M${X(0)},${Y(0)} L${X(0) + ax},${Y(0)} ${arrowHead(X(0) + ax, Y(0), 0, 6)}` }));
    g.appendChild(s('path', { class: 'axis-line', d: `M${X(0)},${Y(0)} L${X(0)},${Y(0) - ax} ${arrowHead(X(0), Y(0) - ax, -Math.PI / 2, 6)}` }));
    g.appendChild(s('text', { class: 'axis-text', x: X(0) + ax + 2, y: Y(0) + 15, text: 'x' }));
    g.appendChild(s('text', { class: 'axis-text', x: X(0) + 8, y: Y(0) - ax + 6, text: 'y' }));
    cgMark(g, X(0), Y(0));

    const yBelow = Y(-hw) + 24;
    hdim(g, X(-b), X(0), yBelow, ['b', '', ` = ${f2(b)}`], [Y(-p.wr / 2) + (wT * k) / 2 + 2, Y(0) + 8]);
    hdim(g, X(0), X(a), yBelow, ['a', '', ` = ${f2(a)}`], [undefined, Y(-p.wf / 2) + (wT * k) / 2 + 2]);
    hdim(g, X(-b), X(a), yBelow + 24, ['L', '', ` = ${f2(L)} m`]);
    hdim(g, X(xr), X(xf), Y(hw) - 12, ['', '', `${f2(len)} m`], [Y(hw) - 2, Y(hw) - 2]);
    vdim(g, Y(p.wf / 2), Y(-p.wf / 2), X(xf) + 14, ['w', 'f', ` = ${f2(p.wf)}`]);
    vdim(g, Y(p.wr / 2), Y(-p.wr / 2), X(xr) - 14, ['w', 'r', ` = ${f2(p.wr)}`], 'end');
    return svg;
  }

  function sideView(p) {
    const W = 300;
    const a = p.a, b = p.b;
    const xf = a + p.ohF, xr = -(b + p.ohR), len = xf - xr;
    const { dT } = tireDims(p);
    const zTop = Math.min(3.4, Math.max(0.9, 2.6 * p.h));
    const mL = 92, mR = 20;
    const k = (W - mL - mR) / len;
    const X = (x) => mL + (x - xr) * k;
    const ZG = 30 + (zTop + 0.05) * k;
    const Z = (z) => ZG - z * k;
    const H = Math.round(ZG + 34);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Side view' });
    const g = s('g');
    svg.appendChild(g);
    const r = Math.min(0.35 * k, 10);
    const clear = Math.max(0.12, 0.25 * dT);
    g.appendChild(s('line', { class: 'ground', x1: X(xr) - 30, y1: ZG, x2: X(xf) + 12, y2: ZG }));
    g.appendChild(s('rect', { class: 'body', x: X(xr), y: Z(zTop), width: len * k, height: (zTop - clear) * k, rx: r }));
    for (const x of [a, -b]) g.appendChild(s('circle', { class: 'tire', cx: X(x), cy: Z(dT / 2), r: (dT / 2) * k }));
    cgMark(g, X(0), Z(p.h));
    // CG height dimension outside the body, with a leader from the CG
    const xd = X(xr) - 12;
    g.appendChild(s('line', { class: 'dim', x1: X(0) - 8, y1: Z(p.h), x2: xd - 4, y2: Z(p.h), 'stroke-dasharray': '3 3' }));
    vdim(g, ZG, Z(p.h), xd, ['h', '', ` = ${f2(p.h)} m`], 'end');
    g.appendChild(s('text', { class: 'caption', x: X(xf), y: H - 8, 'text-anchor': 'end', text: 'x →' }));
    return svg;
  }

  function cgMark(g, x, y) {
    const r = 7;
    g.appendChild(s('circle', { class: 'cg-b', cx: x, cy: y, r }));
    g.appendChild(s('path', { class: 'cg-a', d: `M${x},${y} L${x + r},${y} A${r},${r} 0 0,0 ${x},${y - r} Z M${x},${y} L${x - r},${y} A${r},${r} 0 0,0 ${x},${y + r} Z` }));
  }

  VD.diagram = { build };
})(globalThis.VD = globalThis.VD || {});
