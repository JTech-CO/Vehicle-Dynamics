/*!
 * Application controller: workspace routing, theme, language, status bar.
 * MIT License.
 */
(function (VD) {
  'use strict';

  const { $, on, emit, setLang, icon, clear, tx, bind, h, L } = VD.ui;
  const store = VD.store;
  const VIEWS = ['vehicle', 'maneuvers', 'linear', 'drive', 'theory'];
  const mounted = {};
  let current = null;
  const status = { view: null };

  function show(name, opts) {
    if (!VIEWS.includes(name)) name = 'vehicle';
    if (name === current) return;
    const prev = current;
    current = name;
    document.querySelectorAll('.tab').forEach((t) => {
      const sel = t.dataset.view === name;
      t.setAttribute('aria-selected', sel ? 'true' : 'false');
      t.tabIndex = sel ? 0 : -1;
    });
    VIEWS.forEach((v) => $('#view-' + v).classList.toggle('active', v === name));
    if (prev && VD.views[prev] && VD.views[prev].onHide) VD.views[prev].onHide();
    const sec = $('#view-' + name);
    if (!mounted[name] && VD.views[name]) { VD.views[name].mount(sec); mounted[name] = true; }
    if (VD.views[name] && VD.views[name].onShow) VD.views[name].onShow();
    store.setPref('tab', name);
    if (!(opts && opts.fromHash) && location.hash !== '#' + name) {
      try { history.replaceState(null, '', '#' + name); } catch (e) { /* file:// in some browsers */ }
    }
    status.view = null;
    renderStatus();
  }

  // ---- theme -----------------------------------------------------------------
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = {
    auto: { ko: '테마: 시스템 설정 따름', en: 'Theme: follow system' },
    light: { ko: '테마: 밝게', en: 'Theme: light' },
    dark: { ko: '테마: 어둡게', en: 'Theme: dark' },
  };
  function applyTheme(t) {
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    const btn = $('#theme-btn');
    clear(btn).appendChild(icon(t === 'light' ? 'sun' : t === 'dark' ? 'moon' : 'auto'));
    bind(btn, 'aria-label', THEME_LABEL[t]);
    bind(btn, 'title', THEME_LABEL[t]);
    emit('theme');
  }

  function applyLang(l) {
    setLang(l);
    document.querySelectorAll('[data-lang-btn]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.langBtn === l ? 'true' : 'false'));
    document.title = l === 'ko' ? '차량 동역학 워크벤치 · Vehicle Dynamics Workbench' : 'Vehicle Dynamics Workbench';
    renderChip();
    renderStatus();
  }

  function renderChip() { $('#vehicle-chip-name').textContent = store.vehicleLabel(); }

  // ---- status bar --------------------------------------------------------------
  function renderStatus() {
    const sb = $('#statusbar');
    clear(sb);
    const st = store.state.analysis.settings;
    const item = (k, v) => h('span', { class: 'sb-item' }, h('span', null, tx(k)), h('b', null, v));
    const trackL = st.track === 'single' ? { ko: '단일 트랙', en: 'single-track' } : { ko: '이중 트랙', en: 'dual-track' };
    const tireL = { mf: 'Magic Formula', fiala: 'Fiala', linear: { ko: '선형', en: 'linear' } }[st.tire];
    sb.append(
      item({ ko: '차량', en: 'Vehicle' }, store.vehicleLabel()),
      item({ ko: '모델', en: 'Model' }, [tx({ ko: '3DOF 평면 ', en: 'planar 3DOF ' }), tx(trackL)]),
      item({ ko: '타이어', en: 'Tire' }, typeof tireL === 'string' ? tireL : tx(tireL)),
      item({ ko: '적분', en: 'Solver' }, `RK4 · ${VD.ui.fmt(st.dt * 1000, st.dt < 0.001 ? 1 : 0)} ms`),
    );
    if (status.view) sb.appendChild(h('span', { class: 'sb-item sb-right' }, tx(status.view)));
    else sb.appendChild(h('span', { class: 'sb-item sb-right' }, `v${VD.version} · MIT`));
  }

  function init() {
    store.init();
    applyTheme(store.state.prefs.theme);
    applyLang(store.state.prefs.lang);

    document.querySelectorAll('.tab').forEach((t) => {
      t.addEventListener('click', () => show(t.dataset.view));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const tabs = Array.from(document.querySelectorAll('.tab'));
        const i = tabs.indexOf(t) + (e.key === 'ArrowRight' ? 1 : -1);
        const nx = tabs[(i + tabs.length) % tabs.length];
        nx.focus(); show(nx.dataset.view);
      });
    });
    document.querySelectorAll('[data-lang-btn]').forEach((b) => b.addEventListener('click', () => {
      store.setPref('lang', b.dataset.langBtn); applyLang(b.dataset.langBtn);
    }));
    $('#theme-btn').addEventListener('click', () => {
      const next = THEMES[(THEMES.indexOf(store.state.prefs.theme) + 1) % THEMES.length];
      store.setPref('theme', next); applyTheme(next);
    });
    $('#vehicle-chip').addEventListener('click', () => show('vehicle'));
    try {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => emit('theme'));
    } catch (e) { /* older browsers */ }

    on('vehicle', () => { renderChip(); renderStatus(); });
    on('settings', renderStatus);
    on('status', (s) => { status.view = s; renderStatus(); });
    window.addEventListener('hashchange', () => show(location.hash.slice(1), { fromHash: true }));
    VD.app = { show };

    const fromHash = location.hash.slice(1);
    show(VIEWS.includes(fromHash) ? fromHash : store.state.prefs.tab || 'vehicle');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(globalThis.VD = globalThis.VD || {});
