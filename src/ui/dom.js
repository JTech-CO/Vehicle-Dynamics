/*!
 * DOM helpers, bilingual text, formatting, file I/O. MIT License.
 *
 * Text is always inserted with textContent / createTextNode — never as HTML —
 * so imported files and user input cannot inject markup.
 *
 * Bilingual strings: `tx(ko, en)` produces a pair of spans with lang
 * attributes; CSS shows the active one, so switching language needs no
 * re-render. Attributes and <option> labels cannot hold spans, so `bind()`
 * registers them for update on language change.
 */
(function (VD) {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const listeners = {};
  const bound = new Set();
  let LANG = 'ko';

  function emit(evt, data) { (listeners[evt] || []).slice().forEach((fn) => fn(data)); }
  function on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); return () => off(evt, fn); }
  function off(evt, fn) { const a = listeners[evt]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }

  // ---------------------------------------------------------------------------
  // Element builder
  // ---------------------------------------------------------------------------
  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach((c) => append(el, c)); return; }
    if (child instanceof Node) { el.appendChild(child); return; }
    el.appendChild(document.createTextNode(String(child)));
  }

  function setAttrs(el, attrs) {
    if (!attrs) return;
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'on') for (const e in v) el.addEventListener(e, v[e]);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'props') Object.assign(el, v);
      else if (k === 'i18n') for (const p in v) bind(el, p, v[p]);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs && (typeof attrs !== 'object' || Array.isArray(attrs) || attrs instanceof Node)) { children.unshift(attrs); attrs = null; }
    setAttrs(el, attrs);
    append(el, children);
    return el;
  }

  function s(tag, attrs, ...children) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined) continue;
      if (k === 'text') el.textContent = v; else el.setAttribute(k, String(v));
    }
    append(el, children);
    return el;
  }

  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const $ = (sel, root) => (root || document).querySelector(sel);

  // ---------------------------------------------------------------------------
  // Bilingual text
  // ---------------------------------------------------------------------------
  const L = (o) => (o == null ? '' : typeof o === 'string' ? o : o[LANG] ?? o.en ?? o.ko ?? '');
  const tx = (ko, en) => (typeof ko === 'object' && ko !== null && !Array.isArray(ko)
    ? [h('span', { lang: 'ko' }, ko.ko), h('span', { lang: 'en' }, ko.en)]
    : [h('span', { lang: 'ko' }, ko), h('span', { lang: 'en' }, en)]);

  /** Text where `X_abc` renders abc as a subscript (used for symbols in labels). */
  function rich(str) {
    const parts = String(str).split(/_([A-Za-z0-9,]+)/);
    return parts.map((t, i) => (i % 2 ? h('sub', null, t) : t));
  }
  const rtx = (o) => [h('span', { lang: 'ko' }, rich(o.ko)), h('span', { lang: 'en' }, rich(o.en))];

  /** Keep a property/attribute of `el` in the active language. */
  function bind(el, prop, obj) {
    const apply = () => {
      const v = L(obj);
      if (prop === 'text') el.textContent = v; else el.setAttribute(prop, v);
    };
    apply();
    bound.add({ el, apply, t: Date.now() });
    if (bound.size % 400 === 0) prune();
    return el;
  }
  /** Forget detached elements (only ones old enough not to be mid-render). */
  function prune() {
    const now = Date.now();
    for (const b of Array.from(bound)) if (!b.el.isConnected && now - b.t > 3000) bound.delete(b);
  }

  function setLang(lang) {
    LANG = lang === 'en' ? 'en' : 'ko';
    document.documentElement.lang = LANG;
    document.documentElement.setAttribute('data-lang', LANG);
    prune();
    for (const b of bound) b.apply();
    emit('lang', LANG);
  }
  const getLang = () => LANG;

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  function fmt(v, digits, opts) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '—';
    const d = digits === undefined ? 2 : digits;
    let str = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: !(opts && opts.noGroup) });
    if (v < 0 && Number(str.replace(/,/g, '')) !== 0) str = '−' + str;
    return str;
  }
  /** Compact formatting with sensible precision for axis ticks and readouts. */
  function fmtAuto(v) {
    if (!Number.isFinite(v)) return '—';
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 1e-3)) return v.toExponential(2).replace('-', '−');
    const d = a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : 3;
    return fmt(v, d);
  }

  // ---------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------
  function download(filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /** Ask for a local text file. Resolves with {name, text}; rejects on size/type issues. */
  function pickTextFile(accept, maxBytes) {
    return new Promise((resolve, reject) => {
      const inp = h('input', { type: 'file', accept: accept || '', style: { display: 'none' } });
      inp.addEventListener('change', () => {
        const f = inp.files && inp.files[0];
        inp.remove();
        if (!f) return reject({ code: 'none' });
        if (f.size > (maxBytes || 2e6)) return reject({ code: 'size' });
        const rd = new FileReader();
        rd.onload = () => resolve({ name: f.name, text: String(rd.result) });
        rd.onerror = () => reject({ code: 'read' });
        rd.readAsText(f);
      });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  const safeName = (sname) => String(sname || 'export').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 80);

  // ---------------------------------------------------------------------------
  // Feedback
  // ---------------------------------------------------------------------------
  let toastHost = null;
  function toast(msg, kind) {
    if (!toastHost) { toastHost = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(toastHost); }
    const el = h('div', { class: ['toast', kind] }, typeof msg === 'object' && !(msg instanceof Node) && !Array.isArray(msg) ? tx(msg) : msg);
    toastHost.appendChild(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 5000 : 2600);
  }

  // ---------------------------------------------------------------------------
  // Icons (inline SVG, stroke-based, 16×16 viewBox 0 0 24 24)
  // ---------------------------------------------------------------------------
  const ICONS = {
    play: 'M7 4.5v15l12-7.5z',
    download: 'M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14',
    upload: 'M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M5 19.5h14',
    save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
    reset: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4.5H9',
    plus: 'M12 5v14M5 12h14',
    x: 'M6 6l12 12M18 6L6 18',
    pause: 'M8 5v14M16 5v14',
    record: 'M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10',
    image: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 3-3L20 15M15 9.5h.01',
    table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
    sun: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
    moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z',
    auto: 'M12 4a8 8 0 1 0 0 16zM12 4a8 8 0 0 1 0 16',
    eye: 'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
    eyeOff: 'M3 3l18 18M10.6 6a9.6 9.6 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-2.7 3.4M6.6 7.1C4 8.8 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.3-1.1',
    sweep: 'M4 18c3-9 5-12 8-12s5 3 8 12M4 18h16',
    pin: 'M12 3v7m-5 0h10l-2 5H9zM12 15v6',
    code: 'M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5',
  };
  function icon(name) {
    const sv = s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    const d = ICONS[name];
    if (d) {
      const fill = name === 'play' || name === 'record';
      sv.appendChild(s('path', { d, fill: fill ? 'currentColor' : 'none', stroke: fill ? 'none' : 'currentColor' }));
    }
    return sv;
  }

  /** Read a CSS custom property from an element (defaults to :root). */
  const cssVar = (name, el) => getComputedStyle(el || document.documentElement).getPropertyValue(name).trim();

  // ---------------------------------------------------------------------------
  // Storage (per-browser conveniences only; every access may fail)
  // ---------------------------------------------------------------------------
  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  VD.ui = Object.assign(VD.ui || {}, {
    h, s, clear, $, tx, rtx, rich, L, bind, setLang, getLang, on, off, emit,
    fmt, fmtAuto, download, pickTextFile, safeName, toast, icon, cssVar, storage,
  });
})(globalThis.VD = globalThis.VD || {});
