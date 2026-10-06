/*!
 * Test-maneuver workspace: setup, execution, multi-run comparison, plots,
 * metrics, parameter sweeps and data export. MIT License.
 */
(function (VD) {
  'use strict';

  const { h, tx, rtx, L, bind, fmt, clear, icon, toast, download, pickTextFile, safeName, on, emit } = VD.ui;
  const { DEG, RAD } = VD.const;
  const store = VD.store;
  const MAN = VD.maneuvers;
  const CH = VD.sim.CHANNEL_BY_KEY;
  const WHEELS = VD.model.WHEELS;
  const WHEEL_COLOR = ['--series-1', '--series-2', '--series-3', '--series-4'];

  let root, paramHost, descHost, settingsHost, sweepHost, plotGrid, emptyHost, resultHost, runsHost, sweepCard, headSub, runBtn, advChk;
  let settingsSec, sweepSec, footEl;
  let layout = null;           // current plot specs
  let plots = [];              // { spec, plot, card }
  let busy = false;
  let showAdvanced = false;
  let sweepMetric = null;

  const S = () => store.state.analysis;
  const man = () => MAN.BY_ID[S().maneuver];
  const mp = () => (S().mp[S().maneuver] = MAN.fillParams(man(), S().mp[S().maneuver]));

  // ---------------------------------------------------------------------------
  // Mount
  // ---------------------------------------------------------------------------
  function mount(el) {
    root = el;
    el.classList.add('workspace');

    headSub = h('p', { class: 'panel-sub' });
    const manSel = h('select', { class: 'select', id: 'mn-select' });
    for (const grp of ['open', 'closed', 'long', 'record']) {
      const og = h('optgroup'); bind(og, 'label', MAN.GROUP_LABEL[grp]);
      for (const m of MAN.LIST.filter((x) => x.group === grp)) {
        const o = h('option', { value: m.id });
        bind(o, 'text', { ko: `${m.name.ko}${m.standard !== '—' ? ' · ' + m.standard : ''}`, en: `${m.name.en}${m.standard !== '—' ? ' · ' + m.standard : ''}` });
        og.appendChild(o);
      }
      manSel.appendChild(og);
    }
    manSel.value = S().maneuver;
    manSel.addEventListener('change', () => {
      S().maneuver = manSel.value;
      store.saveAnalysis();
      layout = null;
      const act = store.activeRun();
      if (!act || act.result.maneuver !== S().maneuver) {
        const same = store.state.runs.filter((r) => r.result.maneuver === S().maneuver);
        store.state.activeRun = same.length ? same[same.length - 1].id : null;
      }
      renderParams();
      renderPlots();
      renderResults();
      renderRuns();
      renderSweep();
    });

    descHost = h('div');
    paramHost = h('div', { class: 'section-body' });
    settingsHost = h('div', { class: 'section-body' });
    sweepHost = h('div', { class: 'section-body' });
    advChk = h('input', { type: 'checkbox' });
    advChk.addEventListener('change', () => { showAdvanced = advChk.checked; renderParams(); });

    runBtn = h('button', { type: 'button', class: 'btn primary', style: { flex: '1' }, on: { click: () => runOnce() } }, icon('play'), tx('시험 실행', 'Run test'));
    bind(runBtn, 'title', { ko: '실행 (Ctrl+Enter)', en: 'Run (Ctrl+Enter)' });

    const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Test setup' },
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, tx('시험 해석', 'Test maneuvers')), headSub),
      h('div', { class: 'panel-body', style: { display: 'grid', gap: '10px', paddingBottom: '10px' } },
        h('div', { class: 'field wide' }, h('label', { class: 'field-label', for: 'mn-select' }, tx('시험 절차', 'Procedure')), manSel),
        descHost),
      h('details', { class: 'section', open: true }, h('summary', null, tx('시험 조건', 'Test conditions')), paramHost,
        h('div', { style: { padding: '0 16px 12px' } }, h('label', { class: 'check' }, advChk, h('span', null, tx('고급 설정 (운전자 모델 등)', 'Advanced (driver model …)'))))),
      settingsSec = h('details', { class: 'section', open: true }, h('summary', null, tx('노면 · 모델 · 수치해법', 'Road · model · solver')), settingsHost),
      sweepSec = h('details', { class: 'section' }, h('summary', null, tx('매개변수 스윕', 'Parameter sweep')), sweepHost),
      footEl = h('div', { class: 'panel-foot' }, runBtn,
        h('button', { type: 'button', class: 'btn', on: { click: resetParams } }, icon('reset'), tx('기본값', 'Defaults'))));

    // main
    plotGrid = h('div', { class: 'plot-grid' });
    emptyHost = h('div');
    sweepCard = h('div');
    const addSel = channelSelect(null, (v) => {
      if (!v) return;
      ensureLayout().push(specFromValue(v));
      addSel.value = '';
      renderPlots();
    }, true);
    const main = h('section', { class: 'main' },
      h('div', { class: 'btn-row', style: { marginBottom: '12px' } },
        h('div', { style: { width: '220px' } }, addSel),
        h('button', { type: 'button', class: 'btn sm', on: { click: () => { layout = null; renderPlots(); } } }, icon('reset'), tx('기본 배치', 'Default layout')),
        h('span', { class: 'muted', style: { fontSize: 'var(--fs-xs)', marginLeft: 'auto' } },
          tx('드래그: 확대 · Shift+드래그: 이동 · Ctrl+휠: 확대/축소 · 더블클릭: 원래대로', 'Drag: zoom · Shift+drag: pan · Ctrl+wheel: zoom · Double-click: reset'))),
      emptyHost, sweepCard, plotGrid);

    // aside
    resultHost = h('div', { style: { display: 'grid', gap: '12px' } });
    runsHost = h('div', { class: 'runs' });
    const aside = h('aside', { class: 'aside', 'aria-label': 'Results' },
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, tx('결과', 'Results')),
        h('p', { class: 'panel-sub' }, tx('선택한 실행의 평가 지표', 'Metrics of the selected run'))),
      h('div', { class: 'panel-body', style: { display: 'grid', gap: '16px' } },
        resultHost,
        h('section', null,
          h('div', { class: 'btn-row', style: { marginBottom: '6px' } },
            h('h3', { class: 'subhead', style: { margin: 0 } }, tx('실행 목록', 'Runs')),
            h('span', { class: 'muted', style: { fontSize: 'var(--fs-xs)' } }, tx(`최대 ${store.MAX_RUNS}개`, `up to ${store.MAX_RUNS}`)),
            h('span', { style: { marginLeft: 'auto' } }),
            iconBtn('upload', { ko: '실행 결과(JSON) 가져오기', en: 'Import a run (JSON)' }, importRun),
            iconBtn('x', { ko: '모든 실행 지우기', en: 'Clear all runs' }, () => store.clearRuns())),
          runsHost)));

    el.append(sidebar, main, aside);

    on('runs', () => { renderRuns(); renderResults(); renderPlotsData(); renderSweep(); });
    on('vehicle', () => { renderHead(); renderSweepForm(); });
    on('lang', () => { renderHead(); renderResults(); renderRuns(); renderSweep(); });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && root.classList.contains('active')) {
        e.preventDefault();
        // commit a field that is still being edited (its change event fires on blur)
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
        runOnce();
      }
    });

    renderHead();
    renderParams();
    renderSettings();
    renderSweepForm();
    renderPlots();
    renderRuns();
    renderResults();
  }

  function iconBtn(ic, title, fn) {
    const b = h('button', { type: 'button', class: 'btn sm icon ghost', on: { click: fn } }, icon(ic));
    bind(b, 'title', title); bind(b, 'aria-label', title);
    return b;
  }

  function renderHead() {
    clear(headSub).append(...tx('차량: ', 'Vehicle: '), store.vehicleLabel());
  }

  // ---------------------------------------------------------------------------
  // Inputs
  // ---------------------------------------------------------------------------
  function renderParams() {
    const m = man(), p = mp();
    clear(descHost).append(
      h('div', { class: 'btn-row', style: { gap: '6px' } }, m.standard !== '—' ? h('span', { class: 'badge std' }, m.standard) : null),
      h('p', { class: 'muted', style: { margin: 0, fontSize: 'var(--fs-sm)' } }, tx(m.desc)));
    clear(paramHost);
    for (const q of m.params) {
      if (q.advanced && !showAdvanced) continue;
      if (q.when && !Object.keys(q.when).every((k) => p[k] === q.when[k])) continue;
      const fld = VD.forms.field(q, p[q.key], (v) => {
        p[q.key] = v;
        store.saveAnalysis();
        if (m.params.some((x) => x.when && q.key in x.when)) renderParams();
      });
      paramHost.appendChild(fld);
    }
    if (!m.params.some((q) => q.advanced)) advChk.parentElement.style.display = 'none';
    else advChk.parentElement.style.display = '';
    // recorded data cannot be re-run: hide the inputs that would not apply
    for (const el of [settingsSec, sweepSec, footEl, paramHost.closest('.section')]) if (el) el.hidden = !!m.recordOnly;
    renderSweepForm();
  }

  function resetParams() {
    S().mp[S().maneuver] = MAN.fillParams(man(), {});
    store.saveAnalysis();
    renderParams();
  }

  const TRI = [
    { value: 'vehicle', label: { ko: '차량 설정', en: 'Vehicle' } },
    { value: 'on', label: { ko: '켬', en: 'On' } },
    { value: 'off', label: { ko: '끔', en: 'Off' } },
  ];

  function renderSettings() {
    const st = S().settings;
    const save = () => { store.saveAnalysis(); emit('settings'); };
    clear(settingsHost);
    settingsHost.append(
      VD.forms.number({ key: 'mu', label: { ko: '노면 마찰계수 (배율)', en: 'Road friction (scale)' }, sym: 'μ', sub: 'road', unit: '–', min: 0.05, max: 1.5, step: 0.05,
        hint: { ko: '타이어 μ에 곱해지는 노면 계수. 건조 1.0, 젖음 ≈0.7, 눈 ≈0.3, 빙판 ≈0.1', en: 'Multiplies tire μ. Dry 1.0, wet ≈0.7, snow ≈0.3, ice ≈0.1' } },
      st.mu, (v) => { st.mu = v; save(); }),
      VD.forms.select({ key: 'tire', label: { ko: '타이어 모델', en: 'Tire model' }, options: [
        { value: 'mf', label: { ko: 'Magic Formula (비선형, 권장)', en: 'Magic Formula (nonlinear, default)' } },
        { value: 'fiala', label: { ko: 'Fiala 브러시 모델', en: 'Fiala brush model' } },
        { value: 'linear', label: { ko: '선형 (포화 없음, 검증용)', en: 'Linear (no saturation, for verification)' } }] }, st.tire, (v) => { st.tire = v; save(); }),
      VD.forms.select({ key: 'track', label: { ko: '차량 모델', en: 'Vehicle model' }, options: [
        { value: 'dual', label: { ko: '이중 트랙 (4륜, 하중이동 포함)', en: 'Dual track (4 wheels, load transfer)' } },
        { value: 'single', label: { ko: '단일 트랙 (자전거 모델)', en: 'Single track (bicycle)' } }] }, st.track, (v) => { st.track = v; save(); }),
      h('div', { class: 'subhead' }, tx('전자 제어 (이 해석에만 적용)', 'Assists (this analysis only)')),
      ...['abs', 'tcs', 'esc'].map((k) => VD.forms.select({ key: k, label: { ko: k.toUpperCase(), en: k.toUpperCase() }, options: TRI }, st[k], (v) => { st[k] = v; save(); })),
      h('div', { class: 'subhead' }, tx('수치해법', 'Numerics')),
      VD.forms.select({ key: 'dt', label: { ko: '적분 시간 간격 (RK4)', en: 'Integration step (RK4)' }, options: [
        { value: '0.0005', label: { ko: '0.5 ms', en: '0.5 ms' } }, { value: '0.001', label: { ko: '1 ms (권장)', en: '1 ms (default)' } },
        { value: '0.002', label: { ko: '2 ms', en: '2 ms' } }, { value: '0.005', label: { ko: '5 ms', en: '5 ms' } }] },
      String(st.dt), (v) => { st.dt = Number(v); save(); }),
      VD.forms.select({ key: 'outDt', label: { ko: '출력 샘플링', en: 'Output sampling' }, options: [
        { value: '0.01', label: { ko: '100 Hz', en: '100 Hz' } }, { value: '0.005', label: { ko: '200 Hz', en: '200 Hz' } },
        { value: '0.002', label: { ko: '500 Hz', en: '500 Hz' } }, { value: '0.001', label: { ko: '1 kHz', en: '1 kHz' } }] },
      String(st.outDt), (v) => { st.outDt = Number(v); save(); }),
      VD.forms.checkbox({ key: 'linearRef', label: { ko: '선형 모델 응답 겹쳐 보기', en: 'Overlay linear-model response' },
        hint: { ko: '개루프 조향 시험에서 같은 입력의 선형 단일 트랙 응답을 함께 표시', en: 'For open-loop steering tests, plot the linear single-track response to the same input' } },
      st.linearRef, (v) => { st.linearRef = v; save(); }),
    );
  }

  // ---- sweep -----------------------------------------------------------------
  function sweepTargets() {
    const out = [];
    for (const q of man().params) if (q.type === 'number') out.push({ value: 'm:' + q.key, label: { ko: `[시험] ${q.label.ko}`, en: `[Test] ${q.label.en}` }, unit: q.unit, min: q.min, max: q.max, def: mp()[q.key], step: q.step });
    out.push({ value: 's:mu', label: { ko: '[노면] 마찰계수', en: '[Road] friction' }, unit: '–', min: 0.05, max: 1.5, def: S().settings.mu, step: 0.05 });
    for (const f of VD.params.FIELDS) if (f.type === 'number') out.push({ value: 'v:' + f.key, label: { ko: `[차량] ${f.label.ko}`, en: `[Vehicle] ${f.label.en}` }, sym: f.sym ? f.sym + (f.sub || '') : null, unit: f.unit, min: f.min, max: f.max, def: store.state.vehicle[f.key], step: f.step });
    return out;
  }

  function renderSweepForm() {
    if (!sweepHost) return;
    const targets = sweepTargets();
    const sel = h('select', { class: 'select', id: 'sw-target' });
    for (const t of targets) { const o = h('option', { value: t.value }); bind(o, 'text', t.label); sel.appendChild(o); }
    const state = { from: 0, to: 0, n: 5 };
    const fromHost = h('div'), toHost = h('div');
    const setTarget = () => {
      const t = targets.find((x) => x.value === sel.value) || targets[0];
      state.t = t;
      state.from = +(t.def * 0.8).toPrecision(4); state.to = +(t.def * 1.2).toPrecision(4);
      if (state.from < t.min) state.from = t.min; if (state.to > t.max) state.to = t.max;
      clear(fromHost).appendChild(VD.forms.number({ key: 'from', label: { ko: '시작값', en: 'From' }, unit: t.unit, min: t.min, max: t.max, step: t.step }, state.from, (v) => { state.from = v; }));
      clear(toHost).appendChild(VD.forms.number({ key: 'to', label: { ko: '끝값', en: 'To' }, unit: t.unit, min: t.min, max: t.max, step: t.step }, state.to, (v) => { state.to = v; }));
    };
    sel.addEventListener('change', setTarget);
    sel.value = 'v:Cr';
    setTarget();
    clear(sweepHost).append(
      h('div', { class: 'field wide' }, h('label', { class: 'field-label', for: 'sw-target' }, tx('변경할 매개변수', 'Parameter')), sel),
      fromHost, toHost,
      VD.forms.number({ key: 'n', label: { ko: '단계 수', en: 'Steps' }, unit: '–', min: 2, max: store.MAX_RUNS, step: 1 }, state.n, (v) => { state.n = Math.round(v); }),
      h('p', { class: 'muted', style: { margin: 0, fontSize: 'var(--fs-xs)' } },
        tx('각 값마다 한 번씩 실행하여 실행 목록에 추가합니다. 기존 실행은 지워집니다.', 'Runs once per value and adds each to the run list. Existing runs are cleared.')),
      h('button', { type: 'button', class: 'btn', on: { click: () => runSweep(state) } }, icon('sweep'), tx('스윕 실행', 'Run sweep')));
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------
  function describe(m, p) {
    const keys = ['v', 'swa', 'ayTarget', 'scalar', 'R', 'f', 'vEnd'];
    const parts = [];
    for (const k of keys) {
      const q = m.params.find((x) => x.key === k);
      if (!q || (q.when && !Object.keys(q.when).every((kk) => p[kk] === q.when[kk]))) continue;
      parts.push(`${fmt(p[k], q.step < 1 ? 1 : 0)} ${q.unit}`);
    }
    return parts.slice(0, 2).join(' · ');
  }

  /** Settings that differ from the defaults, for telling runs apart in legends. */
  function settingsTags(st) {
    const t = [];
    for (const k of ['abs', 'tcs', 'esc']) if (st[k] && st[k] !== 'vehicle') t.push(`${k.toUpperCase()} ${st[k]}`);
    if (st.mu !== 1) t.push(`μ ${st.mu}`);
    if (st.tire !== 'mf') t.push(st.tire === 'fiala' ? 'Fiala' : 'linear tire');
    if (st.track === 'single') t.push('single-track');
    return t;
  }
  /** Legend name of a run: number plus what distinguishes it. */
  const runName = (run) => `#${run.seq} · ${run.tag || run.label}`;

  function execute(vehicle, mpv, settings) {
    const st = store.sanitizeSettings(settings);
    return MAN.execute(S().maneuver, vehicle, mpv, st);
  }

  function setBusy(b, msg) {
    busy = b;
    runBtn.disabled = b;
    emit('status', b ? (msg || { ko: '계산 중…', en: 'Computing…' }) : null);
  }

  function runOnce() {
    if (busy) return;
    if (man().recordOnly) {
      toast({ ko: '이 항목은 [실시간 주행]에서 기록한 데이터를 보는 용도입니다.', en: 'This entry shows data recorded in the [Driving simulator].' });
      return;
    }
    setBusy(true);
    setTimeout(() => {
      try {
        const m = man();
        const r = execute(store.state.vehicle, Object.assign({}, mp()), Object.assign({}, S().settings));
        let tag = [describe(m, r.mp), ...settingsTags(r.settings)].filter(Boolean).join(' · ');
        const vName = store.vehicleLabel();
        if (store.state.runs.some((x) => x.vehicleName !== vName && x.result.maneuver === r.maneuver)) tag += ` · ${vName}`;
        store.addRun(r, `${L(m.name)} · ${describe(m, r.mp)}`, { tag });
        emit('status', { ko: `완료 · 계산 ${fmt(r.cpuMs, 0)} ms · ${r.res.n} 샘플`, en: `Done · ${fmt(r.cpuMs, 0)} ms CPU · ${r.res.n} samples` });
      } catch (e) {
        console.error(e);
        toast({ ko: '계산 중 오류가 발생했습니다.', en: 'The computation failed.' }, 'bad');
        emit('status', null);
      }
      busy = false; runBtn.disabled = false;
    }, 20);
  }

  async function runSweep(state) {
    if (busy || !state.t) return;
    const t = state.t;
    const n = Math.max(2, Math.min(store.MAX_RUNS, state.n | 0));
    const vals = VD.util.linspace(state.from, state.to, n);
    store.clearRuns();
    const sweepId = 'sw' + Date.now();
    setBusy(true);
    const [kind, key] = t.value.split(':');
    for (let i = 0; i < n; i++) {
      emit('status', { ko: `스윕 계산 중 ${i + 1}/${n}`, en: `Sweep ${i + 1}/${n}` });
      await new Promise((r) => setTimeout(r, 10));
      const veh = Object.assign({}, store.state.vehicle);
      const mpv = Object.assign({}, mp());
      const st = Object.assign({}, S().settings);
      const val = +vals[i].toPrecision(6);
      if (kind === 'v') veh[key] = val; else if (kind === 'm') mpv[key] = val; else st.mu = val;
      try {
        const r = execute(VD.params.sanitize(veh, store.state.vehicle).params, mpv, st);
        const name = t.sym || L(t.label).replace(/^\[[^\]]*\]\s*/, '');
        const lbl = `${name} = ${fmt(val, Math.abs(val) >= 100 ? 0 : 3)}${t.unit === '–' ? '' : ' ' + t.unit}`;
        store.addRun(r, lbl, { tag: lbl, sweep: { id: sweepId, value: val, label: t.label, unit: t.unit } });
      } catch (e) {
        console.error(e);
      }
    }
    setBusy(false);
    emit('status', { ko: `스윕 완료 · ${n}회 실행`, en: `Sweep finished · ${n} runs` });
  }

  // ---------------------------------------------------------------------------
  // Plots
  // ---------------------------------------------------------------------------
  function specFromValue(v) {
    if (v === 'xy') return { xy: true };
    const [kind, key] = v.split(':');
    return kind === 'grp' ? { y: [key], group: true } : { y: [key] };
  }
  function specValue(sp) { return sp.xy ? 'xy' : sp.group ? 'grp:' + sp.y[0] : 'ch:' + sp.y[0]; }

  function ensureLayout() {
    if (!layout) layout = man().plots.map((p) => Object.assign({}, p, { y: p.y ? p.y.slice() : undefined }));
    return layout;
  }

  function channelSelect(value, onChange, addMode) {
    const sel = h('select', { class: 'select', style: { height: '26px', fontSize: 'var(--fs-sm)' } });
    if (addMode) { const o = h('option', { value: '' }); bind(o, 'text', { ko: '+ 플롯 추가…', en: '+ Add plot…' }); sel.appendChild(o); }
    const og0 = h('optgroup'); bind(og0, 'label', { ko: '궤적', en: 'Trajectory' });
    const ox = h('option', { value: 'xy' }); bind(ox, 'text', { ko: '주행 궤적 X–Y', en: 'Path X–Y' }); og0.appendChild(ox);
    sel.appendChild(og0);
    const og1 = h('optgroup'); bind(og1, 'label', { ko: '차량 채널', en: 'Vehicle channels' });
    for (const c of VD.sim.CHANNELS) {
      if (c.key === 't' || c.wheel || c.hidden) continue;
      const o = h('option', { value: 'ch:' + c.key }); bind(o, 'text', { ko: `${c.label.ko} [${c.unit}]`, en: `${c.label.en} [${c.unit}]` }); og1.appendChild(o);
    }
    sel.appendChild(og1);
    const og2 = h('optgroup'); bind(og2, 'label', { ko: '바퀴별 (4륜)', en: 'Per wheel (4)' });
    for (const gq of VD.sim.WHEEL_GROUPS) {
      const o = h('option', { value: 'grp:' + gq.key }); bind(o, 'text', { ko: `${gq.label.ko} [${gq.unit}]`, en: `${gq.label.en} [${gq.unit}]` }); og2.appendChild(o);
    }
    sel.appendChild(og2);
    if (value) sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function xSelect(value, onChange) {
    const sel = h('select', { class: 'select', style: { height: '26px', width: '108px', fontSize: 'var(--fs-sm)' } });
    const opts = [['t', { ko: 'x: 시간', en: 'x: time' }], ['ayg', { ko: 'x: 횡가속도', en: 'x: lat. accel.' }], ['swa', { ko: 'x: 조향휠각', en: 'x: SWA' }],
      ['speed', { ko: 'x: 차속', en: 'x: speed' }], ['X', { ko: 'x: 위치 X', en: 'x: position X' }], ['dist', { ko: 'x: 거리', en: 'x: distance' }]];
    for (const [v, lb] of opts) { const o = h('option', { value: v }); bind(o, 'text', lb); sel.appendChild(o); }
    sel.value = value || 't';
    bind(sel, 'aria-label', { ko: '가로축', en: 'x axis' });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  function renderPlots() {
    for (const p of plots) p.plot.destroy();
    plots = [];
    clear(plotGrid);
    ensureLayout().forEach((spec, idx) => {
      const host = h('div');
      const title = h('h3', { class: 'card-title' });
      const sub = h('span', { class: 'card-sub' });
      const csel = channelSelect(specValue(spec), (v) => { layout[idx] = Object.assign(specFromValue(v), { wide: spec.wide }); renderPlots(); });
      bind(csel, 'aria-label', { ko: '표시 채널', en: 'Channel' });
      const xsel = spec.xy || spec.group ? null : xSelect(spec.x, (v) => { spec.x = v === 't' ? undefined : v; renderPlots(); });
      let aspect = null;
      if (spec.xy) {
        aspect = VD.forms.segmented([
          { value: false, text: '1:1', title: { ko: '동일 축척', en: 'Equal scale' } },
          { value: true, text: 'Y×', title: { ko: '횡방향 확대', en: 'Exaggerate lateral axis' } }],
        !!spec.stretch, (v) => { spec.stretch = v; renderPlots(); });
      }
      const card = h('div', { class: ['card', spec.wide && 'wide'] },
        h('div', { class: 'card-h' }, h('div', { class: 'card-head-text' }, title, sub),
          h('div', { class: 'card-tools' }, aspect, csel, xsel,
            iconBtn('image', { ko: 'PNG로 저장', en: 'Save as PNG' }, () => savePNG(idx)),
            iconBtn('x', { ko: '플롯 제거', en: 'Remove plot' }, () => { layout.splice(idx, 1); renderPlots(); }))),
        h('div', { class: 'card-b' }, host));
      plotGrid.appendChild(card);
      const opts = spec.xy
        ? { x: { label: 'X', unit: 'm' }, y: { label: 'Y', unit: 'm' }, equal: !spec.stretch, zoomY: true, hover: 'nearest', size: spec.wide && !spec.stretch ? 'tall' : null }
        : { x: axisOf(spec.x || 't'), y: axisOf(spec.y[0], spec.group), group: 'man', syncX: !spec.x, hover: spec.x ? 'nearest' : 'x' };
      const plot = new VD.Plot(host, opts);
      plots.push({ spec, plot, card, title, sub });
    });
    renderPlotsData();
  }

  function axisOf(key, group) {
    if (key === 't') return { label: { ko: '시간', en: 'time' }, unit: 's' };
    if (group) { const gq = VD.sim.WHEEL_GROUPS.find((x) => x.key === key); return { label: '', unit: gq.unit }; }
    const c = CH[key];
    return { label: '', unit: c ? c.unit : '' };
  }

  function linChannel(lin, key) {
    if (!lin) return null;
    if (key === 'r') return Array.from(lin.r, (v) => v * RAD);
    if (key === 'ay') return lin.ay;
    if (key === 'ayg') return Array.from(lin.ay, (v) => v / VD.const.g);
    if (key === 'beta') return Array.from(lin.beta, (v) => v * RAD);
    if (key === 'vy') return lin.vy;
    return null;
  }

  /** Runs of the selected procedure only — different tests are not overlaid. */
  const shownRuns = () => store.visibleRuns().filter((r) => r.result.maneuver === S().maneuver);

  function renderPlotsData() {
    if (!plotGrid) return;
    const runs = shownRuns();
    let act = store.activeRun();
    if (act && act.result.maneuver !== S().maneuver) act = null;
    const single = runs.length === 1;
    clear(emptyHost);
    plotGrid.style.display = runs.length ? '' : 'none';
    if (!runs.length) {
      emptyHost.appendChild(h('div', { class: 'empty', style: { marginBottom: '12px' } },
        h('div', null,
          h('h3', null, store.state.runs.length ? tx('이 시험 절차의 실행 결과가 없습니다', 'No results for this procedure yet') : tx('아직 실행 결과가 없습니다', 'No results yet')),
          h('p', null, tx('왼쪽에서 시험 절차와 조건을 정한 뒤 실행하세요. 결과는 최대 8개까지 겹쳐 비교할 수 있습니다.',
            'Choose a procedure and its conditions on the left, then run. Up to 8 runs can be overlaid for comparison.')),
          h('button', { type: 'button', class: 'btn primary', on: { click: () => runOnce() } }, icon('play'), tx('시험 실행', 'Run test')))));
    }
    for (const P of plots) {
      const { spec, plot, title, sub } = P;
      clear(title); clear(sub);
      const series = [];
      let vlines = [], underlay = null, bounds = null;
      if (spec.xy) {
        title.append(...tx('주행 궤적', 'Vehicle path'));
        sub.append(...tx(spec.stretch ? '무게중심 경로 · 횡방향 확대 표시' : '무게중심 경로 · 동일 축척', spec.stretch ? 'CG path · lateral axis exaggerated' : 'CG path · equal scale'));
        for (const run of runs) {
          const c = run.result.res.ch;
          series.push({ x: c.X, y: c.Y, t: c.t, color: `--series-${run.slot}`, label: runName(run), endMarker: true });
        }
        const ref = act && act.visible ? act : runs[runs.length - 1];
        underlay = makeTrackUnderlay(ref, !spec.stretch);
        const an = ref ? ref.result.annot || {} : {};
        if (an.lanes) bounds = { y0: Math.min(...an.lanes.map((q) => q.yR)) - 0.3, y1: Math.max(...an.lanes.map((q) => q.yL)) + 0.3 };
        if (an.cones) bounds = { y0: -0.6, y1: 0.6 };
      } else if (spec.group) {
        const gq = VD.sim.WHEEL_GROUPS.find((x) => x.key === spec.y[0]);
        title.append(...tx(gq.label));
        const run = act && act.visible ? act : runs[runs.length - 1];
        if (run) {
          sub.append(...tx(`실행 ${runName(run)}`, `run ${runName(run)}`));
          const c = run.result.res.ch;
          const xk = spec.x || 't';
          WHEELS.forEach((w, i) => series.push({ x: c[xk], y: c[`${spec.y[0]}_${w}`], color: WHEEL_COLOR[i], label: { ko: ['좌전 FL', '우전 FR', '좌후 RL', '우후 RR'][i], en: ['FL', 'FR', 'RL', 'RR'][i] } }));
        }
      } else {
        const keys = spec.y;
        title.append(...tx({ ko: keys.map((k) => CH[k].label.ko).join(' · '), en: keys.map((k) => CH[k].label.en).join(' · ') }));
        if (spec.x) sub.append(...tx(`가로축: ${CH[spec.x].label.ko}`, `vs ${CH[spec.x].label.en}`));
        const xk = spec.x || 't';
        for (const run of runs) {
          const c = run.result.res.ch;
          keys.forEach((k, j) => {
            const color = single && keys.length > 1 ? `--series-${j + 1}` : `--series-${run.slot}`;
            const lbl = keys.length > 1 ? (single ? CH[k].label : { ko: `${runName(run)} · ${CH[k].label.ko}`, en: `${runName(run)} · ${CH[k].label.en}` }) : runName(run);
            series.push({ x: c[xk], y: c[k], t: c.t, color, label: lbl, dash: !single && j > 0 ? 'dash' : undefined, mono: xk === 't' ? true : undefined });
          });
          const lin = run.result.lin;
          if (lin && !spec.x && keys.length === 1 && (single || (act && run.id === act.id))) {
            const ly = linChannel(lin, keys[0]);
            if (ly) series.push({ x: lin.t, y: ly, color: single ? '--ink-3' : `--series-${run.slot}`, dash: 'dash', width: 1.5,
              label: single ? { ko: '선형 모델', en: 'Linear model' } : { ko: `${runName(run)} · 선형`, en: `${runName(run)} · linear` }, mono: true });
          }
        }
        if (act && act.visible && !spec.x) vlines = (act.result.annot.tMarks || []).map((m) => ({ x: m.t, label: m.label }));
      }
      const shown = series.filter((sr) => { for (let i = 0; i < sr.y.length; i++) if (Number.isFinite(sr.y[i])) return true; return false; });
      plot.canvas.setAttribute('aria-label', Array.from(title.querySelectorAll(`[lang="${VD.ui.getLang()}"]`)).map((x) => x.textContent).join(''));
      plot.setData({ series: shown, vlines, underlay, bounds, keepView: false });
    }
  }

  function makeTrackUnderlay(run, outlines) {
    if (!run) return null;
    const an = run.result.annot || {};
    const p = run.result.p;
    return (ctx, mp, C) => {
      const cone = VD.ui.cssVar('--cone');
      if (an.lanes) {
        ctx.strokeStyle = cone; ctx.lineWidth = 1.5;
        for (const sec of an.lanes) {
          for (const y of [sec.yL, sec.yR]) {
            ctx.beginPath(); ctx.moveTo(mp.xs(sec.x0), mp.ys(y)); ctx.lineTo(mp.xs(sec.x1), mp.ys(y)); ctx.stroke();
            ctx.fillStyle = cone;
            const nC = Math.max(2, Math.round((sec.x1 - sec.x0) / 3));
            for (let k = 0; k <= nC; k++) {
              const x = sec.x0 + ((sec.x1 - sec.x0) * k) / nC;
              ctx.beginPath(); ctx.arc(mp.xs(x), mp.ys(y), 3, 0, 2 * Math.PI); ctx.fill();
            }
          }
        }
      }
      if (an.cones) {
        ctx.fillStyle = cone;
        for (const c of an.cones) { ctx.beginPath(); ctx.arc(mp.xs(c.x), mp.ys(c.y), Math.max(3, 0.15 * mp.scale), 0, 2 * Math.PI); ctx.fill(); }
      }
      const ref = an.refPath ? [an.refPath.x, an.refPath.y] : an.refLine ? [an.refLine.map((q) => q[0]), an.refLine.map((q) => q[1])] : null;
      if (ref) {
        ctx.strokeStyle = C.ink3; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.beginPath();
        for (let i = 0; i < ref[0].length; i++) { const x = mp.xs(ref[0][i]), y = mp.ys(ref[1][i]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      if (an.muSplit) {
        ctx.fillStyle = VD.ui.cssVar('--accent'); ctx.globalAlpha = 0.07;
        const y0 = mp.ys(0);
        ctx.fillRect(mp.m.l, mp.m.t, mp.pw, Math.max(0, y0 - mp.m.t));
        ctx.globalAlpha = 1;
        ctx.fillStyle = C.ink3; ctx.font = '11px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(`μ = ${an.muSplit.muL}`, mp.m.l + 6, mp.m.t + 4);
        ctx.textBaseline = 'bottom'; ctx.fillText(`μ = ${an.muSplit.muR}`, mp.m.l + 6, mp.m.t + mp.ph - 4);
      }
      // body outlines of the selected run at regular intervals (true scale only)
      const c = run.result.res.ch, n = c.t.length;
      if (!n || !p || !outlines) return;
      const M = VD.params.toModel(p);
      const tEnd = c.t[n - 1];
      const every = tEnd > 30 ? 5 : tEnd > 10 ? 1 : 0.5;
      ctx.strokeStyle = VD.plotUtil.col(`--series-${run.slot}`); ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
      let next = 0;
      for (let i = 0; i < n; i++) {
        if (c.t[i] + 1e-9 < next) continue;
        next += every;
        const cs = Math.cos(c.psi[i] * DEG), sn = Math.sin(c.psi[i] * DEG);
        const pts = [[M.a + M.ohF, M.bodyW / 2], [M.a + M.ohF, -M.bodyW / 2], [-(M.b + M.ohR), -M.bodyW / 2], [-(M.b + M.ohR), M.bodyW / 2]];
        ctx.beginPath();
        pts.forEach(([px, py], k) => {
          const X = c.X[i] + px * cs - py * sn, Y = c.Y[i] + px * sn + py * cs;
          if (k) ctx.lineTo(mp.xs(X), mp.ys(Y)); else ctx.moveTo(mp.xs(X), mp.ys(Y));
        });
        ctx.closePath(); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
  }

  async function savePNG(idx) {
    const P = plots[idx];
    if (!P) return;
    const lang = VD.ui.getLang();
    const title = Array.from(P.title.querySelectorAll(`[lang="${lang}"]`)).map((e) => e.textContent).join('');
    const blob = await P.plot.toPNG(title);
    download(`${safeName(L(man().name))}_${idx + 1}.png`, blob);
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------
  function metricValue(m) {
    if (m.verdict !== undefined) return h('span', { class: ['badge', m.verdict ? 'pass' : 'fail'] }, tx(m.verdict ? { ko: '합격', en: 'PASS' } : { ko: '불합격', en: 'FAIL' }));
    if (m.text) return h('span', null, m.value !== null && m.value !== undefined ? `${fmt(m.value, m.digits)} · ` : null, tx(m.text));
    return h('span', { class: 'num' }, fmt(m.value, m.digits));
  }

  function renderResults() {
    if (!resultHost) return;
    clear(resultHost);
    const runs = shownRuns();
    const act = store.activeRun();
    if (!act || act.result.maneuver !== S().maneuver) {
      resultHost.appendChild(h('p', { class: 'muted', style: { margin: 0, fontSize: 'var(--fs-sm)' } }, tx('선택한 시험 절차의 실행 결과가 여기에 표시됩니다.', 'Results for the selected procedure appear here.')));
      return;
    }
    const r = act.result;
    const mDef = MAN.BY_ID[r.maneuver];
    const verdict = r.metrics.find((x) => x.verdict !== undefined);
    if (verdict) {
      const failed = r.metrics.filter((x) => x.pass === false && x.verdict === undefined);
      resultHost.appendChild(h('div', { class: ['verdict', verdict.verdict ? 'pass' : 'fail'] },
        h('div', { class: 'vd-mark', 'aria-hidden': 'true' }, verdict.verdict ? '✓' : '✕'),
        h('div', null,
          h('div', { class: 'vd-title' }, tx(verdict.verdict ? { ko: '합격', en: 'PASS' } : { ko: '불합격', en: 'FAIL' }), ' · ', mDef.standard),
          h('div', { class: 'vd-sub' }, failed.length
            ? tx({ ko: '미달: ' + failed.map((x) => x.label.ko).join(', '), en: 'Failed: ' + failed.map((x) => x.label.en).join(', ') })
            : tx('모든 판정 기준 충족', 'All criteria met')))));
    }
    if (r.warnings.length) resultHost.appendChild(h('div', { class: 'notices' }, r.warnings.map((w) => h('div', { class: 'notice warn' }, h('span', null, tx(w))))));

    const multi = runs.length > 1 && runs.every((x) => x.result.maneuver === r.maneuver);
    const cols = multi ? runs : [act];
    const table = h('table', { class: 'table' });
    const thead = h('tr', null, h('th', null, tx(mDef.name)));
    for (const run of cols) {
      const sw = h('span', { class: 'swatch', style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', marginRight: '6px', background: `var(--series-${run.slot})` } });
      thead.appendChild(h('th', { class: 'v', title: runName(run) }, sw, multi ? `#${run.seq}` : tx('값', 'Value')));
    }
    if (!multi) thead.appendChild(h('th', null, ''));
    table.appendChild(h('thead', null, thead));
    const tb = h('tbody');
    for (const m of r.metrics) {
      if (m.hidden || m.verdict !== undefined) continue;
      const tr = h('tr', null, h('td', null, rtx(m.label), m.crit ? h('span', { class: 'note' }, tx({ ko: `기준 ${m.crit}`, en: `criterion ${m.crit}` })) : null,
        m.note ? h('span', { class: 'note' }, rtx(m.note)) : null));
      for (const run of cols) {
        const mm = run.result.metrics.find((x) => x.id === m.id) || {};
        tr.appendChild(h('td', { class: 'v' }, metricValue(mm), mm.unit && mm.value !== null ? h('span', { class: 'muted' }, ' ' + mm.unit) : null));
      }
      if (!multi) tr.appendChild(h('td', null, m.pass === true ? h('span', { class: 'badge pass' }, 'OK') : m.pass === false ? h('span', { class: 'badge fail' }, 'NG') : null));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    resultHost.appendChild(h('div', { class: 'table-wrap' }, table));

    const asOn = r.assists;
    resultHost.appendChild(h('p', { class: 'muted', style: { margin: 0, fontSize: 'var(--fs-xs)' } },
      `${act.vehicleName} · ${r.settings.track === 'single' ? 'single-track' : 'dual-track'} · ${r.settings.tire.toUpperCase()} · μ ${r.settings.mu} · ABS ${asOn.abs ? 'on' : 'off'} · TCS ${asOn.tcs ? 'on' : 'off'} · ESC ${asOn.esc ? 'on' : 'off'} · dt ${r.settings.dt * 1000} ms`));
    resultHost.appendChild(h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn sm', on: { click: () => exportCSV(act) } }, icon('table'), tx('시계열 CSV', 'Time-series CSV')),
      h('button', { type: 'button', class: 'btn sm', on: { click: () => exportRunJSON(act) } }, icon('download'), tx('실행 JSON', 'Run JSON')),
      multi ? h('button', { type: 'button', class: 'btn sm', on: { click: () => exportCompare(cols, r) } }, icon('table'), tx('비교표 CSV', 'Comparison CSV')) : null,
      h('button', { type: 'button', class: 'btn sm', on: { click: () => window.print() } }, tx('인쇄 / PDF', 'Print / PDF'))));
  }

  const settingsSuffix = (run) => settingsTags(run.result.settings).join(' · ') || null;

  function renderRuns() {
    if (!runsHost) return;
    clear(runsHost);
    if (!store.state.runs.length) {
      runsHost.appendChild(h('p', { class: 'muted', style: { margin: 0, fontSize: 'var(--fs-sm)' } }, tx('실행 기록이 없습니다.', 'No runs yet.')));
      return;
    }
    for (const run of store.state.runs.slice().reverse()) {
      const vis = h('button', { type: 'button', class: 'btn sm icon ghost', on: { click: (e) => { e.stopPropagation(); store.setRunVisible(run.id, !run.visible); } } }, icon(run.visible ? 'eye' : 'eyeOff'));
      bind(vis, 'aria-label', run.visible ? { ko: '숨기기', en: 'Hide' } : { ko: '보이기', en: 'Show' });
      const del = h('button', { type: 'button', class: 'btn sm icon ghost', on: { click: (e) => { e.stopPropagation(); store.removeRun(run.id); } } }, icon('x'));
      bind(del, 'aria-label', { ko: '삭제', en: 'Delete' });
      const sw = h('span', { class: 'swatch' }); sw.style.background = `var(--series-${run.slot})`;
      if (!run.visible) sw.style.opacity = '0.3';
      const select = () => {
        if (run.result.maneuver !== S().maneuver) {
          S().maneuver = run.result.maneuver;
          const ms = document.getElementById('mn-select'); if (ms) ms.value = S().maneuver;
          layout = null; renderParams(); renderPlots();
        }
        store.setActiveRun(run.id);
      };
      const item = h('div', { class: ['run-item', run.id === store.state.activeRun && 'active', run.result.maneuver !== S().maneuver && 'other'], role: 'button', tabindex: '0',
        on: { click: select, keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } } } },
      vis, sw, h('div', { class: 'rl', title: `${run.label}${run.tag ? ' · ' + run.tag : ''}` }, h('b', null, `#${run.seq} ${run.label}`),
        h('span', null, [run.tag && run.tag !== run.label ? settingsSuffix(run) : null, run.vehicleName, run.createdAt.toLocaleTimeString()].filter(Boolean).join(' · '))), del);
      runsHost.appendChild(item);
    }
  }

  // ---- sweep summary ----------------------------------------------------------
  let sweepPlot = null;
  function renderSweep() {
    if (!sweepCard) return;
    const runs = shownRuns().filter((r) => r.sweep);
    const ids = new Set(runs.map((r) => r.sweep.id));
    if (runs.length < 2 || ids.size !== 1) { if (sweepPlot) { sweepPlot.destroy(); sweepPlot = null; } clear(sweepCard); return; }
    const metrics = runs[0].result.metrics.filter((m) => m.value !== null && Number.isFinite(m.value));
    if (!metrics.length) { clear(sweepCard); return; }
    if (!sweepMetric || !metrics.some((m) => m.id === sweepMetric)) sweepMetric = metrics[0].id;
    const sel = h('select', { class: 'select', style: { height: '26px', width: '240px', fontSize: 'var(--fs-sm)' } });
    for (const m of metrics) { const o = h('option', { value: m.id }); bind(o, 'text', m.label); sel.appendChild(o); }
    sel.value = sweepMetric;
    sel.addEventListener('change', () => { sweepMetric = sel.value; renderSweep(); });
    const host = h('div');
    const sw = runs[0].sweep;
    if (sweepPlot) sweepPlot.destroy();
    clear(sweepCard).appendChild(h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'card-h' }, h('h3', { class: 'card-title' }, tx('스윕 결과', 'Sweep result')),
        h('span', { class: 'card-sub' }, tx(sw.label)), h('div', { class: 'card-tools' }, sel)),
      h('div', { class: 'card-b' }, host)));
    const mm = metrics.find((m) => m.id === sweepMetric);
    const xs = runs.map((r) => r.sweep.value);
    const ys = runs.map((r) => { const q = r.result.metrics.find((m) => m.id === sweepMetric); return q && q.value !== null ? q.value : NaN; });
    const order = xs.map((x, i) => i).sort((a, b) => xs[a] - xs[b]);
    sweepPlot = new VD.Plot(host, { x: { label: '', unit: sw.unit === '–' ? '' : sw.unit }, y: { label: '', unit: mm.unit }, size: 'short', hover: 'x', legend: false });
    sweepPlot.setData({ series: [
      { x: order.map((i) => xs[i]), y: order.map((i) => ys[i]), color: '--ink-3', width: 1.5, label: mm.label, hover: false },
      ...order.map((i) => ({ x: [xs[i]], y: [ys[i]], color: `--series-${runs[i].slot}`, kind: 'points', r: 5, label: runs[i].label, hover: false })),
    ] });
  }

  // ---------------------------------------------------------------------------
  // Export / import
  // ---------------------------------------------------------------------------
  function exportCSV(run) {
    const c = run.result.res.ch;
    const keys = VD.sim.CHANNELS.map((x) => x.key).filter((k) => c[k]);
    const head = keys.map((k) => `${k} [${CH[k].unit}]`).join(',');
    const n = run.result.res.n;
    const lines = [head];
    for (let i = 0; i < n; i++) {
      lines.push(keys.map((k) => { const v = c[k][i]; return Number.isFinite(v) ? +v.toPrecision(7) : ''; }).join(','));
    }
    download(`${safeName(run.label)}.csv`, '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  function runPayload(run) {
    const r = run.result;
    const ch = {};
    for (const k in r.res.ch) ch[k] = Array.from(r.res.ch[k], (v) => (Number.isFinite(v) ? +v.toPrecision(7) : null));
    return {
      format: 'vd-workbench/run', version: 1, app: VD.version, created: run.createdAt.toISOString(),
      label: run.label, maneuver: r.maneuver, standard: MAN.BY_ID[r.maneuver].standard,
      vehicle: { name: run.vehicleName, params: r.p }, conditions: r.mp, settings: r.settings,
      metrics: r.metrics.map((m) => ({ id: m.id, label: m.label.en, value: m.value, unit: m.unit, pass: m.pass, verdict: m.verdict, text: m.text ? m.text.en : undefined })),
      warnings: r.warnings.map((w) => w.en),
      annotations: { tMarks: r.annot.tMarks || [], lanes: r.annot.lanes || null, cones: r.annot.cones || null },
      channels: ch,
    };
  }
  function exportRunJSON(run) {
    download(`${safeName(run.label)}.run.json`, JSON.stringify(runPayload(run)), 'application/json');
  }
  function exportCompare(runs, r) {
    const rows = [['metric', 'unit', ...runs.map((x) => `#${x.seq} ${x.label}`)]];
    for (const m of r.metrics) {
      if (m.hidden) continue;
      rows.push([m.label.en, m.unit || '', ...runs.map((x) => {
        const q = x.result.metrics.find((y) => y.id === m.id) || {};
        return q.verdict !== undefined ? (q.verdict ? 'PASS' : 'FAIL') : q.text ? q.text.en : q.value === null || q.value === undefined ? '' : q.value;
      })]);
    }
    const csv = rows.map((rw) => rw.map((c) => (/[",\r\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
    download('comparison.csv', '﻿' + csv, 'text/csv;charset=utf-8');
  }

  async function importRun() {
    let f;
    try { f = await pickTextFile('.json,application/json', 30e6); } catch (e) {
      if (e && e.code === 'size') toast({ ko: '파일이 너무 큽니다 (최대 30 MB).', en: 'File too large (max 30 MB).' }, 'bad');
      return;
    }
    try {
      const o = JSON.parse(f.text);
      if (!o || o.format !== 'vd-workbench/run' || !MAN.BY_ID[o.maneuver] || !o.channels) throw new Error('format');
      const n = Array.isArray(o.channels.t) ? o.channels.t.length : 0;
      if (n < 2 || n > 2e6) throw new Error('size');
      const ch = {};
      for (const c of VD.sim.CHANNELS) {
        const arr = o.channels[c.key];
        ch[c.key] = Float32Array.from({ length: n }, (_, i) => (Array.isArray(arr) && typeof arr[i] === 'number' ? arr[i] : NaN));
      }
      const p = VD.params.sanitize(o.vehicle && o.vehicle.params).params;
      const man2 = MAN.BY_ID[o.maneuver];
      const mpv = MAN.fillParams(man2, o.conditions);
      const result = {
        maneuver: o.maneuver, p, mp: mpv, settings: store.sanitizeSettings(o.settings || {}),
        res: { n, ch }, lin: null, cpuMs: 0, assists: { abs: true, tcs: true, esc: true },
        metrics: (Array.isArray(o.metrics) ? o.metrics : []).slice(0, 50).map((m) => {
          const def = { id: String(m.id).slice(0, 40), label: { ko: String(m.label).slice(0, 120), en: String(m.label).slice(0, 120) },
            value: typeof m.value === 'number' ? m.value : null, unit: String(m.unit || '').slice(0, 20), digits: 3 };
          if (typeof m.pass === 'boolean') def.pass = m.pass;
          if (typeof m.verdict === 'boolean') def.verdict = m.verdict;
          if (typeof m.text === 'string') def.text = { ko: m.text.slice(0, 60), en: m.text.slice(0, 60) };
          return def;
        }),
        warnings: [], annot: {},
      };
      if (o.annotations && Array.isArray(o.annotations.tMarks)) result.annot.tMarks = o.annotations.tMarks.filter((m) => typeof m.t === 'number').map((m) => ({ t: m.t, label: String(m.label || '').slice(0, 20) }));
      if (o.annotations && Array.isArray(o.annotations.lanes)) result.annot.lanes = o.annotations.lanes.filter((s) => ['x0', 'x1', 'yL', 'yR'].every((k) => typeof s[k] === 'number')).slice(0, 10);
      if (o.annotations && Array.isArray(o.annotations.cones)) result.annot.cones = o.annotations.cones.filter((c) => typeof c.x === 'number' && typeof c.y === 'number').slice(0, 200);
      store.addRun(result, `${String(o.label || 'imported').slice(0, 60)} (imported)`,
        { vehicleName: String((o.vehicle && o.vehicle.name) || '').slice(0, 60) });
      toast({ ko: '실행 결과를 가져왔습니다.', en: 'Run imported.' });
    } catch (e) {
      toast({ ko: '실행 결과 파일 형식이 아닙니다.', en: 'Not a run file.' }, 'bad');
    }
  }

  VD.views = VD.views || {};
  VD.views.maneuvers = {
    mount,
    onShow() { plots.forEach((p) => p.plot.resize()); if (sweepPlot) sweepPlot.resize(); },
  };
})(globalThis.VD = globalThis.VD || {});
