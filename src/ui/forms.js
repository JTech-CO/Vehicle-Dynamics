/*!
 * Schema-driven form fields with validation. MIT License.
 */
(function (VD) {
  'use strict';

  const { h, tx, bind, fmt } = VD.ui;
  let uid = 0;

  const decimals = (step) => {
    if (!step || step >= 1) return 0;
    return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step) - 1e-9)));
  };
  const show = (v, step) => {
    if (!Number.isFinite(v)) return '';
    const d = Math.max(decimals(step), (String(v).split('.')[1] || '').length);
    return String(Number(v.toFixed(Math.min(d, 6))));
  };

  /** Symbol with subscript. Either (sym, sub) or a single string using '_' for subscripts: 'a_y/δ_sw'. */
  function symNode(sym, sub) {
    if (!sym) return null;
    if (sub === undefined && sym.includes('_')) {
      const parts = sym.split(/_([^\s/·()]+)/);
      return h('span', { class: 'sym' }, parts.map((t, i) => (i % 2 ? h('sub', null, t) : t)));
    }
    return h('span', { class: 'sym' }, sym, sub ? h('sub', null, sub) : null);
  }

  /**
   * Numeric field. `f` follows the params/maneuver schema
   * ({key, label, sym, sub, unit, min, max, step, hint}).
   * onCommit(value) is called with a validated number.
   */
  function number(f, value, onCommit, opts) {
    const id = 'f' + (++uid);
    const input = h('input', { id, type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false', value: show(value, f.step) });
    const err = h('div', { class: 'field-error', hidden: true, 'aria-live': 'polite' });
    const hint = f.hint ? h('div', { class: 'field-hint' }, tx(f.hint)) : null;
    const field = h('div', { class: 'field', 'data-key': f.key },
      h('label', { class: 'field-label', for: id }, tx(f.label), symNode(f.sym, f.sub)),
      h('div', { class: 'input-wrap' }, input, f.unit && f.unit !== '-' ? h('span', { class: 'unit' }, f.unit) : null),
      hint, err);
    if (hint) input.setAttribute('aria-describedby', id + 'h'), hint.id = id + 'h';
    let last = value;

    const validate = () => {
      const raw = input.value.trim().replace(',', '.');
      const num = Number(raw);
      let msg = null;
      if (raw === '' || !Number.isFinite(num)) msg = { ko: '숫자를 입력하세요.', en: 'Enter a number.' };
      else if (num < f.min) msg = { ko: `최소 ${f.min} ${f.unit || ''}`, en: `Minimum ${f.min} ${f.unit || ''}` };
      else if (num > f.max) msg = { ko: `최대 ${f.max} ${f.unit || ''}`, en: `Maximum ${f.max} ${f.unit || ''}` };
      field.dataset.invalid = msg ? 'true' : 'false';
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
      err.hidden = !msg;
      VD.ui.clear(err);
      if (msg) err.append(...tx(msg));
      return msg ? null : num;
    };
    const commit = () => {
      const v = validate();
      if (v === null) return;
      if (v !== last) { last = v; onCommit(v); }
      input.value = show(v, f.step);
    };
    input.addEventListener('input', validate);
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { commit(); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const cur = Number(input.value.replace(',', '.'));
      const st = (f.step || 1) * (e.shiftKey ? 10 : 1);
      const base = Number.isFinite(cur) ? cur : last;
      const next = Math.min(f.max, Math.max(f.min, Math.round((base + (e.key === 'ArrowUp' ? st : -st)) / st) * st));
      input.value = show(next, f.step);
      commit();
    });
    field.setValue = (v) => { last = v; input.value = show(v, f.step); validate(); };
    field.input = input;
    if (opts && opts.changed) field.dataset.changed = 'true';
    return field;
  }

  function select(f, value, onCommit) {
    const id = 'f' + (++uid);
    const sel = h('select', { id, class: 'select' });
    for (const o of f.options) {
      const opt = h('option', { value: o.value });
      bind(opt, 'text', o.label);
      if (o.value === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => onCommit(sel.value));
    // long option labels get the full row width, label above
    const longest = Math.max(...f.options.map((o) => Math.max(o.label.ko.length * 1.6, o.label.en.length)));
    const field = h('div', { class: ['field', longest > 16 && 'wide'], 'data-key': f.key },
      h('label', { class: 'field-label', for: id }, tx(f.label)),
      sel);
    field.setValue = (v) => { sel.value = v; };
    field.input = sel;
    return field;
  }

  function checkbox(f, value, onCommit) {
    const inp = h('input', { type: 'checkbox' });
    inp.checked = !!value;
    inp.addEventListener('change', () => onCommit(inp.checked));
    const field = h('label', { class: 'check', 'data-key': f.key, title: f.hint ? VD.ui.L(f.hint) : null }, inp, h('span', null, tx(f.label)));
    if (f.hint) bind(field, 'title', f.hint);
    field.setValue = (v) => { inp.checked = !!v; };
    field.input = inp;
    return field;
  }

  function textarea(f, value, onCommit) {
    const id = 'f' + (++uid);
    const ta = h('textarea', { id, class: 'textarea', spellcheck: 'false', rows: 8 });
    ta.value = value || '';
    ta.addEventListener('change', () => onCommit(ta.value));
    const field = h('div', { class: 'field wide', 'data-key': f.key },
      h('label', { class: 'field-label', for: id }, tx(f.label)), ta);
    field.setValue = (v) => { ta.value = v; };
    field.input = ta;
    return field;
  }

  /** Build any field type from a schema entry. */
  function field(f, value, onCommit, opts) {
    if (f.type === 'enum') return select(f, value, onCommit);
    if (f.type === 'bool') return checkbox(f, value, onCommit);
    if (f.type === 'text') return textarea(f, value, onCommit);
    return number(f, value, onCommit, opts);
  }

  /** Segmented control. options: [{value, label:{ko,en}}] */
  function segmented(options, value, onChange, cls) {
    const wrap = h('div', { class: ['seg', cls], role: 'group' });
    const btns = options.map((o) => {
      const b = h('button', { type: 'button', 'aria-pressed': o.value === value ? 'true' : 'false' }, o.label ? tx(o.label) : o.text);
      if (o.title) bind(b, 'aria-label', o.title);
      if (o.title) bind(b, 'title', o.title);
      b.addEventListener('click', () => {
        btns.forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        onChange(o.value);
      });
      wrap.appendChild(b);
      return b;
    });
    wrap.setValue = (v) => options.forEach((o, i) => btns[i].setAttribute('aria-pressed', o.value === v ? 'true' : 'false'));
    return wrap;
  }

  VD.forms = { number, select, checkbox, textarea, field, segmented, show, symNode, fmt };
})(globalThis.VD = globalThis.VD || {});
