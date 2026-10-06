/*!
 * Linear analysis view: steady-state gains, frequency response, stability
 * (eigenvalues vs speed) and normalised step response of the linear
 * single-track model. MIT License.
 */
(function (VD) {
  'use strict';

  const { h, tx, rtx, bind, fmt, clear, icon, download, on } = VD.ui;
  const { KPH, DEG, RAD, g } = VD.const;
  const LIN = VD.linear;
  const store = VD.store;

  const st = { v: 100, speeds: [60, 100, 140], fMin: 0.05, fMax: 5, vMax: 200, resp: 'r' };
  let plots = {}, asideHost, speedsField, headSub;

  const RESP = {
    r: { label: { ko: '요 레이트', en: 'Yaw rate' }, unit: '(deg/s)/deg', scale: 1, key: 'r' },
    ay: { label: { ko: '횡가속도', en: 'Lateral acceleration' }, unit: '(m/s²)/deg', scale: DEG, key: 'ay' },
    beta: { label: { ko: '차체 슬립각', en: 'Sideslip' }, unit: 'deg/deg', scale: 1, key: 'beta' },
  };
  const seqColor = (i, n) => `--seq-${n <= 1 ? 3 : Math.min(5, 1 + Math.round((i * 4) / (n - 1)))}`;

  function mount(el) {
    el.classList.add('workspace');
    headSub = h('p', { class: 'panel-sub' });
    const respSeg = VD.forms.segmented([
      { value: 'r', label: RESP.r.label }, { value: 'ay', label: { ko: '횡가속도', en: 'Lat. accel.' } }, { value: 'beta', label: { ko: '슬립각', en: 'Sideslip' } },
    ], st.resp, (v) => { st.resp = v; render(); }, 'full');

    speedsField = h('input', { type: 'text', id: 'ln-speeds', value: st.speeds.join(', '), inputmode: 'decimal', autocomplete: 'off' });
    const speedsErr = h('div', { class: 'field-error', hidden: true });
    speedsField.addEventListener('change', () => {
      const vals = speedsField.value.split(/[,\s;]+/).map(Number).filter((x) => Number.isFinite(x) && x >= 5 && x <= 400);
      if (!vals.length) { speedsErr.hidden = false; clear(speedsErr).append(...tx('5–400 km/h 범위의 속도를 쉼표로 구분해 입력하세요.', 'Enter speeds between 5 and 400 km/h, separated by commas.')); return; }
      speedsErr.hidden = true;
      st.speeds = Array.from(new Set(vals.map((x) => Math.round(x)))).sort((a, b) => a - b).slice(0, 5);
      speedsField.value = st.speeds.join(', ');
      render();
    });

    const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Linear analysis settings' },
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, tx('선형 해석', 'Linear analysis')), headSub),
      h('div', { class: 'panel-body', style: { display: 'grid', gap: '12px' } },
        h('p', { class: 'muted', style: { margin: 0, fontSize: 'var(--fs-sm)' } },
          tx('선형 단일 트랙(자전거) 모델의 해석해입니다. 소각도·선형 타이어·일정 속도를 가정하며, 비선형 시뮬레이션은 [시험 해석]에서 수행합니다.',
            'Closed-form results of the linear single-track (bicycle) model: small angles, linear tires, constant speed. Nonlinear simulation is in [Test maneuvers].')),
        VD.forms.number({ key: 'v', label: { ko: '분석 속도', en: 'Analysis speed' }, unit: 'km/h', min: 5, max: 400, step: 1,
          hint: { ko: '오른쪽 특성값 표와 그래프의 강조 표시에 사용', en: 'Used for the table on the right and highlighted on the charts' } }, st.v, (v) => { st.v = v; render(); }),
        h('div', { class: 'field wide' }, h('label', { class: 'field-label', for: 'ln-speeds' }, tx('비교 속도 (최대 5개)', 'Compared speeds (up to 5)')),
          h('div', { class: 'input-wrap' }, speedsField, h('span', { class: 'unit' }, 'km/h')), speedsErr),
        h('div', { class: 'field wide' }, h('span', { class: 'field-label' }, tx('주파수 응답 출력', 'Frequency-response output')), respSeg),
        VD.forms.number({ key: 'fMin', label: { ko: '최소 주파수', en: 'Min frequency' }, unit: 'Hz', min: 0.001, max: 1, step: 0.01 }, st.fMin, (v) => { st.fMin = v; render(); }),
        VD.forms.number({ key: 'fMax', label: { ko: '최대 주파수', en: 'Max frequency' }, unit: 'Hz', min: 0.5, max: 50, step: 0.5 }, st.fMax, (v) => { st.fMax = v; render(); }),
        VD.forms.number({ key: 'vMax', label: { ko: '속도 범위 상한', en: 'Speed range upper bound' }, unit: 'km/h', min: 40, max: 400, step: 10 }, st.vMax, (v) => { st.vMax = v; render(); }),
        h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn sm', on: { click: exportFRF } }, icon('table'), tx('주파수 응답 CSV', 'Frequency response CSV')),
          h('button', { type: 'button', class: 'btn sm', on: { click: exportSpeed } }, icon('table'), tx('속도별 특성 CSV', 'Speed sweep CSV')))));

    const grid = h('div', { class: 'plot-grid' });
    const card = (key, title, sub, opts, wide) => {
      const host = h('div');
      const subEl = h('span', { class: 'card-sub' });
      if (sub) subEl.append(...tx(sub));
      grid.appendChild(h('div', { class: ['card', wide && 'wide'] },
        h('div', { class: 'card-h' }, h('div', { class: 'card-head-text' }, h('h3', { class: 'card-title' }, tx(title)), subEl),
          h('div', { class: 'card-tools' }, iconBtn(key, title))),
        h('div', { class: 'card-b' }, host)));
      plots[key] = new VD.Plot(host, opts);
      plots[key].subEl = subEl;
    };
    card('gain', { ko: '정상상태 요 레이트 이득', en: 'Steady-state yaw-rate gain' }, { ko: 'r/δsw vs 차속 · 파선: 뉴트럴 스티어', en: 'r/δsw vs speed · dashed: neutral steer' },
      { x: { label: { ko: '차속', en: 'speed' }, unit: 'km/h' }, y: { label: '', unit: '1/s', zero: true }, hover: 'x' });
    card('mag', { ko: '주파수 응답 — 이득', en: 'Frequency response — gain' }, null,
      { x: { label: { ko: '주파수', en: 'frequency' }, unit: 'Hz', log: true }, y: { label: '', unit: '', zero: true }, hover: 'x', group: 'bode', syncX: true });
    card('phase', { ko: '주파수 응답 — 위상', en: 'Frequency response — phase' }, null,
      { x: { label: { ko: '주파수', en: 'frequency' }, unit: 'Hz', log: true }, y: { label: '', unit: 'deg', step: 45 }, hover: 'x', group: 'bode', syncX: true });
    card('root', { ko: '근궤적 (차속 변화)', en: 'Root locus over speed' }, { ko: '고유값 λ = σ ± jω, 20 km/h부터 · 범례: 차속 구간', en: 'Eigenvalues λ = σ ± jω from 20 km/h · legend: speed band' },
      { x: { label: 'σ', unit: '1/s' }, y: { label: 'jω', unit: 'rad/s' }, hover: 'nearest' });
    card('fn', { ko: '요 고유진동수', en: 'Yaw natural frequency' }, null,
      { x: { label: { ko: '차속', en: 'speed' }, unit: 'km/h' }, y: { label: '', unit: 'Hz', zero: true }, hover: 'x', group: 'spd', syncX: true });
    card('zeta', { ko: '요 감쇠비', en: 'Yaw damping ratio' }, null,
      { x: { label: { ko: '차속', en: 'speed' }, unit: 'km/h' }, y: { label: '', unit: '–', zero: true }, hover: 'x', group: 'spd', syncX: true });
    card('step', { ko: '정규화 스텝 응답', en: 'Normalised step response' }, { ko: '요 레이트 r(t)/r_ss, 이상적 스텝 조향', en: 'Yaw rate r(t)/r_ss for an ideal steering step' },
      { x: { label: { ko: '시간', en: 'time' }, unit: 's' }, y: { label: '', unit: '–', zero: true }, hover: 'x' }, true);

    const main = h('section', { class: 'main' }, grid);
    asideHost = h('div', { class: 'panel-body', style: { display: 'grid', gap: '14px' } });
    const aside = h('aside', { class: 'aside', 'aria-label': 'Characteristic values' },
      h('div', { class: 'panel-head' }, h('h2', { class: 'panel-title' }, tx('특성값', 'Characteristic values')),
        h('p', { class: 'panel-sub' }, tx('분석 속도 기준', 'At the analysis speed'))),
      asideHost);
    el.append(sidebar, main, aside);

    on('vehicle', render);
    on('lang', renderAside);
    render();
  }

  function iconBtn(key, title) {
    const b = h('button', { type: 'button', class: 'btn sm icon ghost', on: { click: async () => {
      const blob = await plots[key].toPNG(VD.ui.L(title));
      download(`linear_${key}.png`, blob);
    } } }, icon('image'));
    bind(b, 'title', { ko: 'PNG로 저장', en: 'Save as PNG' }); bind(b, 'aria-label', { ko: 'PNG로 저장', en: 'Save as PNG' });
    return b;
  }

  // ---------------------------------------------------------------------------
  function render() {
    const p = store.state.vehicle;
    clear(headSub).append(...tx('차량: ', 'Vehicle: '), store.vehicleLabel());
    const us = LIN.understeer(p);
    const vAxis = [];
    for (let v = 2; v <= st.vMax + 1e-9; v += 1) vAxis.push(v);

    // steady-state gain vs speed
    const gain = vAxis.map((v) => LIN.steadyGains(p, v * KPH).r);
    const neutral = vAxis.map((v) => (v * KPH) / ((p.a + p.b) * p.steerRatio));
    const gNS = neutral.map((x) => (x > 1.5 * Math.max(...gain.filter(Number.isFinite)) ? NaN : x));
    const vl = [];
    if (Number.isFinite(us.vch) && us.vch * 3.6 <= st.vMax) vl.push({ x: us.vch * 3.6, label: { ko: '특성속도', en: 'char. speed' } });
    if (Number.isFinite(us.vcrit) && us.vcrit * 3.6 <= st.vMax) vl.push({ x: us.vcrit * 3.6, label: { ko: '임계속도', en: 'crit. speed' } });
    vl.push({ x: st.v, label: `${st.v} km/h` });
    plots.gain.setData({ series: [
      { x: vAxis, y: gain.map((x) => (Math.abs(x) > 50 ? NaN : x)), color: '--series-1', label: { ko: '차량', en: 'Vehicle' }, digits: 3 },
      { x: vAxis, y: gNS, color: '--ink-3', dash: 'dash', width: 1.5, label: { ko: '뉴트럴 스티어', en: 'Neutral steer' }, digits: 3 },
    ], vlines: vl });

    // frequency response
    const freqs = [];
    const lo = Math.log10(st.fMin), hi = Math.log10(Math.max(st.fMax, st.fMin * 2));
    for (let k = 0; k <= 300; k++) freqs.push(Math.pow(10, lo + ((hi - lo) * k) / 300));
    const R = RESP[st.resp];
    const magS = [], phS = [];
    st.speeds.forEach((v, i) => {
      const fr = LIN.freqResp(p, v * KPH, freqs);
      const color = seqColor(i, st.speeds.length);
      magS.push({ x: freqs, y: fr[R.key].mag.map((m) => m * R.scale), color, label: `${v} km/h`, digits: 4 });
      phS.push({ x: freqs, y: fr[R.key].ph, color, label: `${v} km/h`, digits: 1 });
    });
    plots.mag.setAxes(null, { label: '', unit: R.unit, zero: true });
    clear(plots.mag.subEl).append(...tx({ ko: `${R.label.ko} / 조향휠각`, en: `${R.label.en} / steering-wheel angle` }));
    clear(plots.phase.subEl).append(...tx({ ko: `${R.label.ko} / 조향휠각`, en: `${R.label.en} / steering-wheel angle` }));
    plots.mag.setData({ series: magS });
    plots.phase.setData({ series: phS, hlines: [{ y: -90, color: VD.ui.cssVar('--line-strong') }] });

    // root locus, natural frequency, damping
    const nb = 5;
    const buckets = Array.from({ length: nb }, () => ({ x: [], y: [], t: [] }));
    const fn = [], zeta = [], vSp = [];
    const v0 = 20;
    for (let v = v0; v <= st.vMax + 1e-9; v += 2.5) {
      const an = LIN.analyze(p, v * KPH);
      const b = Math.min(nb - 1, Math.floor(((v - v0) / Math.max(st.vMax - v0, 1)) * nb));
      for (const [re, im] of an.eig) { buckets[b].x.push(re); buckets[b].y.push(im); buckets[b].t.push(v); }
      vSp.push(v); fn.push(an.fn); zeta.push(an.zeta);
    }
    const step = (st.vMax - v0) / nb;
    const anSel = LIN.analyze(p, st.v * KPH);
    plots.root.setData({ series: [
      ...buckets.map((bk, i) => ({ x: bk.x, y: bk.y, kind: 'points', r: 3, color: `--seq-${i + 1}`,
        label: `${Math.round(v0 + i * step)}–${Math.round(v0 + (i + 1) * step)} km/h` })),
      { x: anSel.eig.map((e) => e[0]), y: anSel.eig.map((e) => e[1]), kind: 'points', r: 6, color: '--series-2', label: `${st.v} km/h` },
    ] });
    plots.fn.setData({ series: [{ x: vSp, y: fn, color: '--series-1', label: 'f_n', digits: 3 }], vlines: [{ x: st.v, label: `${st.v} km/h` }] });
    plots.zeta.setData({ series: [{ x: vSp, y: zeta, color: '--series-1', label: 'ζ', digits: 3 }], vlines: [{ x: st.v, label: `${st.v} km/h` }],
      hlines: [{ y: 1, color: VD.ui.cssVar('--line-strong') }] });

    // normalised step response
    const stepS = [];
    st.speeds.forEach((v, i) => {
      const ss = LIN.steadyGains(p, v * KPH).r * DEG;
      const sim = LIN.simulate(p, v * KPH, (t) => (t > 0 ? DEG : 0), 3, 0.002, 2);
      stepS.push({ x: sim.t, y: Array.from(sim.r, (r) => r / ss), color: seqColor(i, st.speeds.length), label: `${v} km/h`, digits: 3 });
    });
    plots.step.setData({ series: stepS, hlines: [{ y: 1, color: VD.ui.cssVar('--line-strong') }] });

    renderAside();
  }

  function kv(label, value, unit, note) {
    return [h('div', { class: 'k' }, rtx(label), note ? h('span', { class: 'note' }, rtx(note)) : null),
      h('div', { class: 'val' }, value, unit ? h('span', { class: 'u' }, unit) : null)];
  }

  function renderAside() {
    if (!asideHost) return;
    const p = store.state.vehicle;
    const v = st.v * KPH;
    const us = LIN.understeer(p);
    const an = LIN.analyze(p, v);
    const { A } = LIN.matrices(p, v);
    const B = LIN.matrices(p, v).B;
    const ss = LIN.steadyGains(p, v);
    // linear step metrics at the analysis speed
    const sim = LIN.simulate(p, v, (t) => (t > 0 ? DEG : 0), 4, 0.001, 1);
    const rss = ss.r * DEG;
    let t90 = NaN, pk = -Infinity, tpk = NaN;
    for (let i = 0; i < sim.n; i++) {
      if (Number.isNaN(t90) && sim.r[i] >= 0.9 * rss) t90 = sim.t[i];
      if (sim.r[i] > pk) { pk = sim.r[i]; tpk = sim.t[i]; }
    }
    const eig = an.eig.map(([re, im]) => `${fmt(re, 2)}${im ? (im > 0 ? ' + j' : ' − j') + fmt(Math.abs(im), 2) : ''}`);
    const sec = (title, rows) => h('section', null, h('h3', { class: 'subhead', style: { marginBottom: '4px' } }, tx(title)), h('div', { class: 'kv' }, rows));
    clear(asideHost);
    if (!an.stable) asideHost.appendChild(h('div', { class: 'notice bad' }, h('span', null, tx('이 속도에서 선형 모델은 불안정합니다 (양의 실수부 고유값).', 'The linear model is unstable at this speed (eigenvalue with positive real part).'))));
    asideHost.append(
      sec({ ko: '조향 특성 (속도 무관)', en: 'Steer characteristics (speed independent)' }, [
        ...kv({ ko: '언더스티어 구배 K', en: 'Understeer gradient K' }, fmt(us.Kdeg, 2), 'deg/g'),
        ...kv({ ko: '특성 속도 v_ch', en: 'Characteristic speed v_ch' }, fmt(us.vch * 3.6, 0), 'km/h'),
        ...kv({ ko: '임계 속도 v_crit', en: 'Critical speed v_crit' }, fmt(us.vcrit * 3.6, 0), 'km/h'),
      ]),
      sec({ ko: `안정성 @ ${st.v} km/h`, en: `Stability @ ${st.v} km/h` }, [
        ...kv({ ko: '고유값 λ_1', en: 'Eigenvalue λ_1' }, eig[0], '1/s'),
        ...kv({ ko: '고유값 λ_2', en: 'Eigenvalue λ_2' }, eig[1], '1/s'),
        ...kv({ ko: '비감쇠 고유진동수 f_n', en: 'Undamped natural frequency f_n' }, fmt(an.fn, 3), 'Hz'),
        ...kv({ ko: '감쇠비 ζ', en: 'Damping ratio ζ' }, fmt(an.zeta, 3), ''),
      ]),
      sec({ ko: `정상상태 이득 @ ${st.v} km/h`, en: `Steady-state gains @ ${st.v} km/h` }, [
        ...kv({ ko: '요 레이트 r/δ_sw', en: 'Yaw rate r/δ_sw' }, fmt(ss.r, 4), '1/s'),
        ...kv({ ko: '횡가속도 a_y/δ_sw', en: 'Lateral accel. a_y/δ_sw' }, fmt((ss.ay * DEG * 100) / g, 3), 'g/100°'),
        ...kv({ ko: '차체 슬립각 β/δ_sw', en: 'Sideslip β/δ_sw' }, fmt(ss.beta, 4), 'deg/deg'),
        ...kv({ ko: '곡률 1/R per δ_sw', en: 'Curvature 1/R per δ_sw' }, fmt(ss.curvature * DEG, 5), '1/(m·deg)'),
      ]),
      sec({ ko: `주파수·시간 응답 @ ${st.v} km/h`, en: `Frequency & time response @ ${st.v} km/h` }, [
        ...kv({ ko: '요 레이트 공진 주파수', en: 'Yaw-rate resonance frequency' }, fmt(an.peakFreq, 2), 'Hz'),
        ...kv({ ko: '공진 배율 (피크/정상)', en: 'Resonance ratio (peak/steady)' }, fmt(an.peakRatio, 3), ''),
        ...kv({ ko: '−3 dB 대역폭', en: '−3 dB bandwidth' }, fmt(an.bandwidth, 2), 'Hz'),
        ...kv({ ko: '요 레이트 위상 @ 1 Hz', en: 'Yaw-rate phase @ 1 Hz' }, fmt(an.phaseR1Hz, 1), 'deg'),
        ...kv({ ko: '횡가속도 위상 @ 1 Hz', en: 'Lateral-accel. phase @ 1 Hz' }, fmt(an.phaseAy1Hz, 1), 'deg'),
        ...kv({ ko: '요 레이트 응답시간 (90%)', en: 'Yaw-rate response time (90 %)' }, fmt(t90, 3), 's', { ko: '이상적 스텝 기준', en: 'ideal step input' }),
        ...kv({ ko: '피크 응답시간 / 오버슈트', en: 'Peak time / overshoot' }, `${fmt(tpk, 3)} s · ${fmt((pk / rss - 1) * 100, 1)}`, '%'),
      ]),
      sec({ ko: '상태공간 행렬 (x = [v_y, r])', en: 'State-space matrices (x = [v_y, r])' }, [
        ...kv({ ko: 'A_11, A_12', en: 'A_11, A_12' }, `${fmt(A[0], 3)}, ${fmt(A[1], 3)}`, ''),
        ...kv({ ko: 'A_21, A_22', en: 'A_21, A_22' }, `${fmt(A[2], 3)}, ${fmt(A[3], 3)}`, ''),
        ...kv({ ko: 'B_1, B_2 (δ_f 입력)', en: 'B_1, B_2 (δ_f input)' }, `${fmt(B[0], 2)}, ${fmt(B[1], 2)}`, ''),
      ]),
    );
  }

  // ---------------------------------------------------------------------------
  function exportFRF() {
    const p = store.state.vehicle;
    const freqs = [];
    const lo = Math.log10(st.fMin), hi = Math.log10(st.fMax);
    for (let k = 0; k <= 200; k++) freqs.push(Math.pow(10, lo + ((hi - lo) * k) / 200));
    const head = ['f [Hz]'];
    const cols = [];
    for (const v of st.speeds) {
      const fr = LIN.freqResp(p, v * KPH, freqs);
      head.push(`|r/dsw| @${v}km/h [1/s]`, `phase r @${v}km/h [deg]`, `|ay/dsw| @${v}km/h [(m/s2)/deg]`, `phase ay @${v}km/h [deg]`, `|beta/dsw| @${v}km/h [-]`, `phase beta @${v}km/h [deg]`);
      cols.push(fr);
    }
    const rows = [head.join(',')];
    freqs.forEach((f, i) => {
      const r = [f.toPrecision(6)];
      for (const fr of cols) r.push(fr.r.mag[i].toPrecision(6), fr.r.ph[i].toFixed(3), (fr.ay.mag[i] * DEG).toPrecision(6), fr.ay.ph[i].toFixed(3), fr.beta.mag[i].toPrecision(6), fr.beta.ph[i].toFixed(3));
      rows.push(r.join(','));
    });
    download('frequency_response.csv', '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  }

  function exportSpeed() {
    const p = store.state.vehicle;
    const rows = ['v [km/h],r/dsw [1/s],ay/dsw [(m/s2)/deg],beta/dsw [-],fn [Hz],zeta [-],lambda1_re,lambda1_im,lambda2_re,lambda2_im,stable'];
    for (let v = 5; v <= st.vMax; v += 5) {
      const an = LIN.analyze(p, v * KPH);
      rows.push([v, an.yawGain.toPrecision(6), (an.ayGain * DEG).toPrecision(6), an.betaGain.toPrecision(6), Number.isFinite(an.fn) ? an.fn.toPrecision(5) : '',
        Number.isFinite(an.zeta) ? an.zeta.toPrecision(5) : '', an.eig[0][0].toPrecision(6), an.eig[0][1].toPrecision(6), an.eig[1][0].toPrecision(6), an.eig[1][1].toPrecision(6), an.stable].join(','));
    }
    download('linear_vs_speed.csv', '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
  }

  VD.views = VD.views || {};
  VD.views.linear = { mount, onShow() { Object.values(plots).forEach((p) => p.resize()); } };
})(globalThis.VD = globalThis.VD || {});
