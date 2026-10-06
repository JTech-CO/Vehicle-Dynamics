/*!
 * Vehicle view: parameter editor, schematic, tire characteristics and
 * derived handling quantities. MIT License.
 */
(function (VD) {
  'use strict';

  const { h, tx, L, bind, fmt, clear, icon, toast, download, pickTextFile, safeName, on } = VD.ui;
  const { RAD, KPH, g, DEG } = VD.const;
  const store = VD.store;
  const P = VD.params;

  let root, formHost, headSub, presetSel, diagramHost, tirePlot, derivedHost, libHost, tireModel = 'mf';
  const fieldEls = {};

  function mount(el) {
    root = el;
    el.classList.add('workspace');

    // ---- sidebar: editor -------------------------------------------------
    headSub = h('p', { class: 'panel-sub' });
    presetSel = h('select', { class: 'select', id: 'vh-preset' });
    presetSel.addEventListener('change', () => {
      const v = presetSel.value;
      if (v.startsWith('lib:')) store.loadFromLibrary(v.slice(4));
      else store.loadPreset(v);
      toast({ ko: '차량을 불러왔습니다.', en: 'Vehicle loaded.' });
    });

    const advChk = h('input', { type: 'checkbox' });
    advChk.checked = store.state.prefs.advanced;
    advChk.addEventListener('change', () => { store.setPref('advanced', advChk.checked); renderForm(); });

    formHost = h('div');
    libHost = h('div', { class: 'section-body' });

    const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Vehicle parameters' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, tx('차량 제원', 'Vehicle parameters')),
        headSub),
      h('div', { class: 'panel-body', style: { display: 'grid', gap: '10px', paddingBottom: '12px' } },
        h('div', { class: 'field wide' },
          h('label', { class: 'field-label', for: 'vh-preset' }, tx('프리셋 · 저장된 차량', 'Preset · saved vehicle')), presetSel),
        h('div', { class: 'btn-row' },
          btn('save', { ko: '저장', en: 'Save' }, saveVehicle, { ko: '이 브라우저에 차량 저장', en: 'Save the vehicle in this browser' }),
          btn('upload', { ko: '가져오기', en: 'Import' }, importVehicle, { ko: 'JSON 파일에서 차량 불러오기', en: 'Load a vehicle from a JSON file' }),
          btn('download', { ko: 'JSON', en: 'JSON' }, exportJSON, { ko: '차량 제원을 JSON으로 내보내기', en: 'Export the vehicle as JSON' }),
          btn('code', { ko: 'MATLAB', en: 'MATLAB' }, exportMatlab, { ko: 'MATLAB 스크립트(.m)로 내보내기', en: 'Export as a MATLAB script (.m)' }),
          btn('reset', { ko: '되돌리기', en: 'Revert' }, () => store.loadPreset(store.state.vehicleBase), { ko: '기준 프리셋 값으로 되돌리기', en: 'Revert to the base preset' })),
        h('label', { class: 'check' }, advChk, h('span', null, tx('고급 항목 표시 (타이어 형상·이완 길이·ESC 게인 등)', 'Show advanced fields (tire shape, relaxation, ESC gains …)')))),
      formHost,
      h('details', { class: 'section' },
        h('summary', null, tx('저장된 차량 (이 브라우저)', 'Saved vehicles (this browser)')), libHost));

    // ---- main: schematic + tire curves -----------------------------------
    diagramHost = h('div', { class: 'diagram' });
    const tirePlotHost = h('div');
    const modelSeg = VD.forms.segmented([
      { value: 'mf', label: { ko: 'Magic Formula', en: 'Magic Formula' } },
      { value: 'fiala', label: { ko: 'Fiala', en: 'Fiala' } },
      { value: 'linear', label: { ko: '선형', en: 'Linear' } },
    ], tireModel, (v) => { tireModel = v; renderTire(); });
    const main = h('section', { class: 'main' },
      h('div', { class: 'vehicle-grid' },
        h('div', { class: 'card' },
          h('div', { class: 'card-h' }, h('h3', { class: 'card-title' }, tx('차량 개략도 (축척 도시)', 'Vehicle schematic (to scale)')),
            h('span', { class: 'card-sub' }, tx('평면도 · 측면도, ISO 8855 좌표계', 'Top and side view, ISO 8855 axes'))),
          h('div', { class: 'card-b' }, diagramHost)),
        h('div', { class: 'card' },
          h('div', { class: 'card-h' }, h('h3', { class: 'card-title' }, tx('타이어 횡력 특성 (타이어 1개)', 'Tire lateral characteristic (single tire)')),
            h('div', { class: 'card-tools' }, modelSeg)),
          h('div', { class: 'card-b' }, tirePlotHost,
            h('p', { class: 'muted', style: { margin: '6px 0 0', fontSize: 'var(--fs-xs)' } },
              tx('실선: 정적 하중 Fz0 · 파선: 1.5 Fz0 · 점선: 0.5 Fz0. 하중 민감도(nC, kμ)가 반영됩니다.',
                'Solid: static load Fz0 · dashed: 1.5 Fz0 · dotted: 0.5 Fz0. Includes load sensitivity (nC, kμ).'))))));

    tirePlot = new VD.Plot(tirePlotHost, {
      x: { label: { ko: '슬립각 α', en: 'Slip angle α' }, unit: 'deg' },
      y: { label: { ko: '횡력 −Fy', en: 'Lateral force −Fy' }, unit: 'kN', zero: true },
      size: 'tall', hover: 'x',
    });

    // ---- aside: derived --------------------------------------------------
    derivedHost = h('div', { class: 'panel-body', style: { display: 'grid', gap: '14px' } });
    const aside = h('aside', { class: 'aside', 'aria-label': 'Derived characteristics' },
      h('div', { class: 'panel-head' },
        h('h2', { class: 'panel-title' }, tx('파생 특성', 'Derived characteristics')),
        h('p', { class: 'panel-sub' }, tx('선형 단일 트랙 이론과 정역학으로 계산', 'From linear single-track theory and statics'))),
      derivedHost);

    el.append(sidebar, main, aside);

    on('vehicle', (e) => { if (!e || e.source !== 'field') renderForm(); else markChanged(); renderAll(); });
    on('library', () => { renderPresetSelect(); renderLibrary(); });
    on('lang', () => { renderHead(); renderDerived(); renderPresetSelect(); });
    renderForm();
    renderPresetSelect();
    renderLibrary();
    renderAll();
  }

  function btn(ic, label, fn, title) {
    const b = h('button', { type: 'button', class: 'btn sm', on: { click: fn } }, icon(ic), tx(label));
    if (title) bind(b, 'title', title);
    return b;
  }

  // ---------------------------------------------------------------------------
  function renderPresetSelect() {
    clear(presetSel);
    const og1 = h('optgroup'); bind(og1, 'label', { ko: '프리셋', en: 'Presets' });
    for (const pr of P.PRESETS) {
      const o = h('option', { value: pr.id }); bind(o, 'text', { ko: `${pr.name.ko} — ${pr.desc.ko}`, en: `${pr.name.en} — ${pr.desc.en}` });
      og1.appendChild(o);
    }
    presetSel.appendChild(og1);
    const lib = store.library();
    if (lib.length) {
      const og2 = h('optgroup'); bind(og2, 'label', { ko: '저장된 차량', en: 'Saved vehicles' });
      for (const e of lib) og2.appendChild(h('option', { value: 'lib:' + e.id, text: e.name }));
      presetSel.appendChild(og2);
    }
    presetSel.value = store.state.vehicleBase;
  }

  function renderLibrary() {
    clear(libHost);
    const lib = store.library();
    if (!lib.length) {
      libHost.appendChild(h('p', { class: 'muted', style: { margin: 0, fontSize: 'var(--fs-sm)' } },
        tx('저장된 차량이 없습니다. [저장]을 누르면 이 브라우저에만 보관됩니다.', 'No saved vehicles. [Save] keeps them in this browser only.')));
      return;
    }
    for (const e of lib) {
      const row = h('div', { class: 'run-item', style: { gridTemplateColumns: 'minmax(0,1fr) auto auto' } },
        h('div', { class: 'rl' }, h('b', null, e.name), h('span', null, new Date(e.savedAt).toLocaleString())),
        h('button', { type: 'button', class: 'btn sm', on: { click: () => { store.loadFromLibrary(e.id); toast({ ko: '불러왔습니다.', en: 'Loaded.' }); } } }, tx('불러오기', 'Load')),
        h('button', { type: 'button', class: 'btn sm icon ghost', 'aria-label': 'Delete', on: { click: () => store.removeFromLibrary(e.id) } }, icon('x')));
      libHost.appendChild(row);
    }
  }

  function renderHead() {
    clear(headSub);
    headSub.append(store.vehicleLabel());
  }

  function renderForm() {
    clear(formHost);
    const p = store.state.vehicle;
    const base = P.presetParams(store.state.vehicleBase);
    const adv = store.state.prefs.advanced;
    for (const grp of P.GROUPS) {
      const fields = P.FIELDS.filter((f) => f.group === grp.id && (adv || !f.advanced));
      if (!fields.length) continue;
      const body = h('div', { class: 'section-body' });
      const bools = [];
      for (const f of fields) {
        const el = VD.forms.field(f, p[f.key], (v) => store.setParam(f.key, v), { changed: base[f.key] !== p[f.key] });
        if (base[f.key] !== p[f.key]) el.dataset.changed = 'true';
        fieldEls[f.key] = el;
        if (f.type === 'bool') bools.push(el); else body.appendChild(el);
      }
      if (bools.length) body.appendChild(h('div', { class: 'btn-row', style: { gap: '16px' } }, bools));
      formHost.appendChild(h('details', { class: 'section', open: true },
        h('summary', null, tx(grp.label), h('span', { class: 'count' }, String(fields.length))), body));
    }
    syncConditional();
  }

  function markChanged() {
    const p = store.state.vehicle;
    const base = P.presetParams(store.state.vehicleBase);
    for (const k in fieldEls) {
      const el = fieldEls[k];
      if (!el.isConnected) continue;
      if (base[k] !== p[k]) el.dataset.changed = 'true'; else delete el.dataset.changed;
    }
    syncConditional();
  }

  function syncConditional() {
    const awd = fieldEls.awdFront;
    if (awd && awd.input) {
      const on2 = store.state.vehicle.drive === 'AWD';
      awd.input.disabled = !on2;
      awd.style.opacity = on2 ? '' : '0.55';
    }
  }

  // ---------------------------------------------------------------------------
  function renderAll() {
    renderHead();
    clear(diagramHost).appendChild(VD.diagram.build(store.state.vehicle));
    renderTire();
    renderDerived();
    if (presetSel && document.activeElement !== presetSel) presetSel.value = store.state.vehicleBase;
  }

  function renderTire() {
    const p = store.state.vehicle;
    const M = P.toModel(p);
    const alphaDeg = [];
    for (let a = 0; a <= 20.0001; a += 0.1) alphaDeg.push(a);
    const series = [];
    const axles = [
      { key: 'f', Ca0: M.Cf / 2, mu0: M.muF, Fz0: M.Fz0[0], color: '--series-1', label: { ko: '전륜', en: 'Front' } },
      { key: 'r', Ca0: M.Cr / 2, mu0: M.muR, Fz0: M.Fz0[2], color: '--series-2', label: { ko: '후륜', en: 'Rear' } },
    ];
    for (const ax of axles) {
      for (const [k, dash, tag] of [[1, null, ''], [1.5, 'dash', ' 1.5 Fz0'], [0.5, 'dot', ' 0.5 Fz0']]) {
        const Fz = ax.Fz0 * k;
        const Ca = VD.tire.corneringStiffness(ax.Ca0, Fz, ax.Fz0, M.nC);
        const mu = VD.tire.friction(ax.mu0, Fz, ax.Fz0, M.kMu);
        const y = alphaDeg.map((a) => -VD.tire.lateralPure(tireModel, a * DEG, Fz, Ca, mu, M.mfC, M.mfE) / 1000);
        series.push({ x: alphaDeg, y, color: ax.color, dash, width: k === 1 ? 2 : 1.5,
          label: { ko: ax.label.ko + (tag || ' Fz0'), en: ax.label.en + (tag || ' Fz0') }, unit: 'kN', digits: 2 });
      }
    }
    tirePlot.setData({ series });
  }

  /** k: {ko, en, sym?, sub?} — the symbol is rendered after the label with a real subscript. */
  function row(k, v, unit, note) {
    return [h('div', { class: 'k' }, tx(k), k.sym ? [' ', VD.forms.symNode(k.sym, k.sub)] : null, note ? h('span', { class: 'note' }, tx(note)) : null),
      h('div', { class: 'val' }, v, unit ? h('span', { class: 'u' }, unit) : null)];
  }

  function renderDerived() {
    const p = store.state.vehicle;
    const d = P.derive(p);
    const M = P.toModel(p);
    clear(derivedHost);

    const warns = P.check(p);
    if (warns.length) derivedHost.appendChild(h('div', { class: 'notices' },
      warns.map((w) => h('div', { class: ['notice', w.level === 'warn' ? 'warn' : null] }, h('span', null, tx(w))))));

    const cls = d.balance === 'understeer' ? { ko: '언더스티어', en: 'Understeer' }
      : d.balance === 'oversteer' ? { ko: '오버스티어', en: 'Oversteer' } : { ko: '뉴트럴', en: 'Neutral' };
    const lin = d.at100;
    const pkF = VD.tire.peakSlip('mf', M.Fz0[0], M.Cf / 2, M.muF, M.mfC, M.mfE) * RAD;
    const pkR = VD.tire.peakSlip('mf', M.Fz0[2], M.Cr / 2, M.muR, M.mfC, M.mfE) * RAD;

    const sec = (title, rows) => h('section', null, h('h3', { class: 'subhead', style: { marginBottom: '4px' } }, tx(title)), h('div', { class: 'kv' }, rows));

    derivedHost.append(
      h('div', { class: 'verdict', style: { padding: '10px 12px' } },
        h('div', null,
          h('div', { class: 'vd-sub' }, tx('언더스티어 구배 K', 'Understeer gradient K')),
          h('div', { class: 'vd-title num' }, `${fmt(d.KusDegG, 2)} deg/g`),
          h('div', { class: 'vd-sub' }, tx(cls), ' · ',
            Number.isFinite(d.vch) ? tx(`특성속도 ${fmt(d.vch * 3.6, 0)} km/h`, `characteristic speed ${fmt(d.vch * 3.6, 0)} km/h`)
              : Number.isFinite(d.vcrit) ? tx(`임계속도 ${fmt(d.vcrit * 3.6, 0)} km/h`, `critical speed ${fmt(d.vcrit * 3.6, 0)} km/h`) : ''))),
      sec({ ko: '질량 배분', en: 'Mass distribution' }, [
        ...row({ ko: '휠베이스', en: 'Wheelbase', sym: 'L' }, fmt(d.L, 3), 'm'),
        ...row({ ko: '전축 하중 비율', en: 'Front axle load share' }, fmt(d.frontWeightPct, 1), '%'),
        ...row({ ko: '정적 하중 (전륜 1개)', en: 'Static load, front wheel' }, fmt(d.FzWheelF, 0), 'N'),
        ...row({ ko: '정적 하중 (후륜 1개)', en: 'Static load, rear wheel' }, fmt(d.FzWheelR, 0), 'N'),
        ...row({ ko: '요 동적 지수 I/(m·a·b)', en: 'Yaw dynamic index I/(m·a·b)' }, fmt(d.dynIndex, 2), ''),
      ]),
      sec({ ko: '조종 안정성 (선형)', en: 'Handling (linear)' }, [
        ...row({ ko: '정적 여유', en: 'Static margin', sym: 'SM' }, fmt(d.staticMargin, 1), '%', { ko: '+ 이면 중립조향점이 CG 뒤', en: '+ = neutral-steer point behind CG' }),
        ...row({ ko: '중립조향점 위치', en: 'Neutral-steer point' }, fmt(d.nsp, 3), 'm', { ko: 'CG 기준 전방 +', en: 'ahead of CG = +' }),
        ...row({ ko: '특성 속도', en: 'Characteristic speed', sym: 'v', sub: 'ch' }, fmt(d.vch * 3.6, 0), 'km/h'),
        ...row({ ko: '임계 속도', en: 'Critical speed', sym: 'v', sub: 'crit' }, fmt(d.vcrit * 3.6, 0), 'km/h'),
      ]),
      sec({ ko: '100 km/h 선형 응답', en: 'Linear response at 100 km/h' }, [
        ...row({ ko: '요 고유진동수', en: 'Yaw natural frequency', sym: 'f', sub: 'n' }, fmt(lin.fn, 2), 'Hz'),
        ...row({ ko: '요 감쇠비', en: 'Yaw damping ratio', sym: 'ζ' }, fmt(lin.zeta, 2), ''),
        ...row({ ko: '요 레이트 이득', en: 'Yaw-rate gain', sym: 'r/δ_sw' }, fmt(lin.yawGain, 3), '1/s'),
        ...row({ ko: '횡가속도 이득', en: 'Lateral-accel. gain', sym: 'a_y/δ_sw' }, fmt((lin.ayGain * DEG * 100) / g, 3), 'g/100°'),
        ...row({ ko: '슬립각 구배', en: 'Sideslip gradient', sym: 'β/a_y' }, fmt((lin.betaGain / lin.ayGain) * RAD * g, 2), 'deg/g'),
        ...row({ ko: '요 레이트 공진 주파수', en: 'Yaw-rate peak frequency' }, fmt(lin.peakFreq, 2), 'Hz'),
        ...row({ ko: '횡가속도 위상 @ 1 Hz', en: 'Lateral-accel. phase @ 1 Hz' }, fmt(lin.phaseAy1Hz, 1), 'deg'),
      ]),
      sec({ ko: '한계 성능 (추정)', en: 'Limit performance (estimates)' }, [
        ...row({ ko: '정적 안정 계수', en: 'Static stability factor', sym: 'SSF' }, fmt(d.ssf, 2), 'g', { ko: 'w/(2h), 전복 한계 지표', en: 'w/(2h), rollover index' }),
        ...row({ ko: '최고 속도', en: 'Top speed' }, fmt(d.vTop * 3.6, 0), 'km/h', d.vTop < d.vTopPower - 0.1 ? { ko: '제한기에 의함', en: 'governor-limited' } : { ko: '출력–저항 균형', en: 'power–drag balance' }),
        ...row({ ko: '출력 대 질량비', en: 'Power-to-mass ratio' }, fmt(d.powerToWeight, 1), 'W/kg'),
        ...row({ ko: '최대 감속도 (마찰·제동력 한계)', en: 'Max deceleration (friction/brake)' }, fmt(d.decelMax / g, 2), 'g'),
        ...row({ ko: '피크 슬립각 (전/후, MF)', en: 'Peak slip angle (F/R, MF)' }, `${fmt(pkF, 1)} / ${fmt(pkR, 1)}`, 'deg'),
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  function saveVehicle() {
    const name = window.prompt(L({ ko: '저장할 이름', en: 'Name for this vehicle' }), store.vehicleLabel().replace(/ \*$/, ''));
    if (name === null) return;
    const ok = store.saveToLibrary(name);
    toast(ok ? { ko: '이 브라우저에 저장했습니다.', en: 'Saved in this browser.' } : { ko: '브라우저 저장소를 사용할 수 없습니다. JSON으로 내보내세요.', en: 'Browser storage unavailable. Export as JSON instead.' }, ok ? null : 'bad');
  }

  function exportJSON() {
    download(`${safeName(store.vehicleLabel())}.vehicle.json`, store.exportVehicle(), 'application/json');
  }

  async function importVehicle() {
    try {
      const f = await pickTextFile('.json,application/json', 1e6);
      const issues = store.importVehicle(f.text);
      toast(issues.length
        ? { ko: `불러왔습니다. ${issues.length}개 항목이 허용 범위로 보정되었습니다.`, en: `Imported. ${issues.length} value(s) were clamped to the allowed range.` }
        : { ko: '불러왔습니다.', en: 'Imported.' });
    } catch (e) {
      if (e && e.code === 'none') return;
      const msg = e && e.code === 'size' ? { ko: '파일이 너무 큽니다 (최대 1 MB).', en: 'File too large (max 1 MB).' }
        : e && e.code === 'schema' ? { ko: '차량 제원 파일 형식이 아닙니다.', en: 'Not a vehicle parameter file.' }
          : { ko: 'JSON을 읽을 수 없습니다.', en: 'Could not read the JSON file.' };
      toast(msg, 'bad');
    }
  }

  function exportMatlab() {
    const p = store.state.vehicle;
    const M = P.toModel(p);
    const name = store.vehicleLabel();
    const lines = [];
    const q = (sv) => String(sv).replace(/'/g, "''").replace(/[\r\n]+/g, ' ');
    const num = (v) => (Number.isInteger(v) ? String(v) : Number(v.toPrecision(8)).toString());
    const put = (field, v, comment) => lines.push(`veh.${field.padEnd(14)} = ${num(v).padStart(10)};  % ${comment}`);
    lines.push(`% Vehicle parameters exported from Vehicle Dynamics Workbench ${VD.version}`);
    lines.push(`% ${q(name)} — ${new Date().toISOString().slice(0, 10)}`);
    lines.push('% Units are SI. Names in brackets refer to the MATLAB Vehicle Dynamics Blockset');
    lines.push('% "Vehicle Body 3DOF" block parameters where an equivalent exists.');
    lines.push('');
    lines.push(`veh.Name = '${q(name)}';`);
    put('Mass', p.m, '[m]     vehicle mass, kg');
    put('Izz', p.Izz, '[Izz]   yaw moment of inertia, kg*m^2');
    put('a', p.a, '[a]     CG to front axle, m');
    put('b', p.b, '[b]     CG to rear axle, m');
    put('h', p.h, '[h]     CG height above ground, m');
    put('wf', p.wf, '[w(1)]  front track width, m');
    put('wr', p.wr, '[w(2)]  rear track width, m');
    put('Cf_axle', p.Cf, 'front axle cornering stiffness at static load, N/rad');
    put('Cr_axle', p.Cr, 'rear axle cornering stiffness at static load, N/rad');
    put('Cy_f', p.Cf / 2, '[Cy_f]  front tire (per wheel) cornering stiffness, N/rad');
    put('Cy_r', p.Cr / 2, '[Cy_r]  rear tire (per wheel) cornering stiffness, N/rad');
    put('Fznom_f', M.Fz0[0], 'static front wheel load (use as Fznom), N');
    put('Fznom_r', M.Fz0[2], 'static rear wheel load, N');
    put('mu_f', p.muF, 'front tire peak friction, -');
    put('mu_r', p.muR, 'rear tire peak friction, -');
    put('sigma', p.sigma, '[sigma_f, sigma_r] relaxation length, m');
    put('Cd', p.Cd, '[Cd]    drag coefficient, -');
    put('Af', p.Af, '[Af]    frontal area, m^2');
    put('Cl', p.Cl, '[Cl]    lift coefficient, -');
    put('rho', p.rho, 'air density, kg/m^3');
    put('SteerRatio', p.steerRatio, 'steering-wheel / road-wheel angle, -');
    put('MaxSWA', p.swaMax, 'max steering-wheel angle, deg');
    put('LLTD_front', p.lltdF / 100, 'front share of lateral load transfer (MATLAB 3DOF: 0.5), -');
    put('MF_C', p.mfC, 'Magic Formula shape factor C, -');
    put('MF_E', p.mfE, 'Magic Formula curvature factor E, -');
    put('nC', p.nC, 'cornering-stiffness load exponent, -');
    put('kMu', p.kMu, 'friction load sensitivity, -');
    put('Pmax', p.Pmax * 1000, 'max power at wheels, W');
    put('FtMax', p.FtMax, 'max tractive force, N');
    put('FbMax', p.FbMax, 'max service-brake force, N');
    put('BrakeBiasF', p.brakeBiasF / 100, 'front brake bias, -');
    put('fr', p.fr, 'rolling-resistance coefficient, -');
    lines.push(`veh.Drive          = '${p.drive}';`);
    lines.push('');
    lines.push('% Linear single-track characteristics');
    put('Kus', M.Kus, 'understeer gradient, rad/(m/s^2)');
    download(`${safeName(name)}_vehicle.m`, lines.join('\n') + '\n', 'text/plain;charset=utf-8');
  }

  VD.views = VD.views || {};
  VD.views.vehicle = { mount, onShow: () => tirePlot && tirePlot.resize() };
})(globalThis.VD = globalThis.VD || {});
