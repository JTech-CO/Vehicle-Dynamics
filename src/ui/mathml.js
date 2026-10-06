/*!
 * Minimal TeX-subset → MathML converter for the built-in documentation.
 * Input is static, trusted text shipped with the app. MIT License.
 *
 * Supported: identifiers, numbers, operators, groups {…}, _ and ^,
 * \frac \sqrt \dot \ddot \hat \text \mathrm \operatorname, \sum, spacing
 * (\, \; \quad), \left/\right (ignored), \begin{cases}…\end{cases},
 * and a handful of symbol macros.
 */
(function (VD) {
  'use strict';

  const NS = 'http://www.w3.org/1998/Math/MathML';
  const el = (tag, text) => { const e = document.createElementNS(NS, tag); if (text !== undefined) e.textContent = text; return e; };
  const wrap = (tag, kids) => { const e = el(tag); kids.forEach((k) => e.appendChild(k)); return e; };

  const SYMBOLS = {
    cdot: ['mo', '·'], times: ['mo', '×'], pm: ['mo', '±'], mp: ['mo', '∓'], le: ['mo', '≤'], ge: ['mo', '≥'],
    approx: ['mo', '≈'], to: ['mo', '→'], infty: ['mi', '∞'], partial: ['mi', '∂'], neq: ['mo', '≠'],
    sum: ['mo', '∑'], int: ['mo', '∫'], ldots: ['mo', '…'], equiv: ['mo', '≡'], propto: ['mo', '∝'], in: ['mo', '∈'],
    Rightarrow: ['mo', '⇒'], lvert: ['mo', '|'], rvert: ['mo', '|'],
  };
  const GREEK = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', kappa: 'κ',
    lambda: 'λ', mu: 'μ', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', psi: 'ψ', omega: 'ω',
    Delta: 'Δ', Psi: 'Ψ', Omega: 'Ω', Sigma: 'Σ',
  };
  const FUNCS = ['sin', 'cos', 'tan', 'arctan', 'atan', 'exp', 'min', 'max', 'sgn', 'sign', 'clamp', 'sat', 'Re', 'Im', 'det', 'tr', 'ln', 'log'];
  const SPACES = { ',': '0.17em', ';': '0.28em', quad: '1em', qquad: '2em', ' ': '0.25em' };

  function parse(src) {
    let i = 0;
    const peek = () => src[i];
    const eatSpaces = () => { while (i < src.length && /\s/.test(src[i])) i++; };

    function readCommand() {
      i++; // backslash
      if (!/[A-Za-z]/.test(src[i] || '')) return src[i++];
      let name = '';
      while (i < src.length && /[A-Za-z]/.test(src[i])) name += src[i++];
      return name;
    }
    function readRaw() { // {raw text}
      eatSpaces();
      if (src[i] !== '{') return src[i++] || '';
      let depth = 0, out = '';
      for (; i < src.length; i++) {
        if (src[i] === '{') { if (depth++) out += '{'; continue; }
        if (src[i] === '}') { if (--depth === 0) { i++; break; } out += '}'; continue; }
        out += src[i];
      }
      return out;
    }

    function atom() {
      eatSpaces();
      const c = peek();
      if (c === undefined) return null;
      if (c === '{') { i++; const kids = seq('}'); i++; return kids.length === 1 ? kids[0] : wrap('mrow', kids); }
      if (c === '\\') {
        const save = i;
        const cmd = readCommand();
        if (cmd === 'frac') { const a = atom(), b = atom(); return wrap('mfrac', [a, b]); }
        if (cmd === 'sqrt') { return wrap('msqrt', [atom()]); }
        if (cmd === 'dot' || cmd === 'ddot' || cmd === 'hat' || cmd === 'bar' || cmd === 'tilde') {
          const base = atom();
          const acc = el('mo', { dot: '˙', ddot: '¨', hat: '^', bar: '¯', tilde: '~' }[cmd]);
          const m = wrap('mover', [base, acc]); m.setAttribute('accent', 'true'); return m;
        }
        if (cmd === 'text') { return el('mtext', readRaw()); }
        if (cmd === 'mathrm' || cmd === 'operatorname') { const t = el('mi', readRaw()); t.setAttribute('mathvariant', 'normal'); return t; }
        if (cmd === 'left' || cmd === 'right') { eatSpaces(); const d = src[i] === '\\' ? (readCommand(), '') : src[i++]; if (d === '.' || !d) return el('mrow'); const o = el('mo', d === '{' ? '{' : d); o.setAttribute('stretchy', 'true'); return o; }
        if (cmd === 'begin') {
          const env = readRaw();
          if (env === 'cases') return cases();
          return el('mtext', env);
        }
        if (cmd in SPACES) { const sp = el('mspace'); sp.setAttribute('width', SPACES[cmd]); return sp; }
        if (cmd in SYMBOLS) { const [t, v] = SYMBOLS[cmd]; return el(t, v); }
        if (cmd in GREEK) return el('mi', GREEK[cmd]);
        if (FUNCS.includes(cmd)) {
          // thin spaces around the function name, as TeX does for \sin etc.
          const t = el('mi', cmd); t.setAttribute('mathvariant', 'normal');
          const sp = () => { const m = el('mspace'); m.setAttribute('width', '0.17em'); return m; };
          return wrap('mrow', [sp(), t, sp()]);
        }
        if (cmd === '{' || cmd === '}' || cmd === '|' || cmd === '%') return el('mo', cmd);
        i = save + 1;
        return el('mtext', '\\');
      }
      i++;
      if (/[0-9.]/.test(c)) {
        let num = c;
        while (i < src.length && /[0-9.]/.test(src[i])) num += src[i++];
        return el('mn', num);
      }
      if (/[A-Za-zͰ-Ͽ]/.test(c)) return el('mi', c);
      if (c === '-') return el('mo', '−');
      if (c === "'") return el('mo', '′');
      return el('mo', c);
    }

    function scripts(base) {
      eatSpaces();
      let sub = null, sup = null;
      for (let k = 0; k < 2; k++) {
        eatSpaces();
        if (peek() === '_' && !sub) { i++; sub = atom(); }
        else if (peek() === '^' && !sup) { i++; sup = atom(); }
      }
      if (sub && sup) return wrap('msubsup', [base, sub, sup]);
      if (sub) return wrap('msub', [base, sub]);
      if (sup) return wrap('msup', [base, sup]);
      return base;
    }

    function seq(end) {
      const out = [];
      while (i < src.length) {
        eatSpaces();
        if (end && src.startsWith(end, i)) break;
        const a = atom();
        if (!a) break;
        out.push(scripts(a));
      }
      return out;
    }

    function cases() {
      const rows = [];
      let cells = [], cur = [];
      const flushCell = () => { cells.push(wrap('mtd', [wrap('mrow', cur)])); cur = []; };
      while (i < src.length) {
        eatSpaces();
        if (src.startsWith('\\end{cases}', i)) { i += '\\end{cases}'.length; break; }
        if (src[i] === '&') { i++; flushCell(); continue; }
        if (src.startsWith('\\\\', i)) { i += 2; flushCell(); rows.push(wrap('mtr', cells)); cells = []; continue; }
        const a = atom(); if (!a) break; cur.push(scripts(a));
      }
      if (cur.length || cells.length) { flushCell(); rows.push(wrap('mtr', cells)); }
      const tbl = wrap('mtable', rows);
      tbl.setAttribute('columnalign', 'left left');
      const brace = el('mo', '{'); brace.setAttribute('stretchy', 'true');
      return wrap('mrow', [brace, tbl]);
    }

    return seq(null);
  }

  /** Build a <math> element. display: true for block equations. */
  function tex(src, display) {
    const m = el('math');
    if (display) m.setAttribute('display', 'block');
    m.appendChild(wrap('mrow', parse(src)));
    return m;
  }

  VD.mathml = { tex };
})(globalThis.VD = globalThis.VD || {});
