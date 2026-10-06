/*!
 * Application state: active vehicle, preferences, saved vehicles, runs.
 * Persisted per browser via localStorage (best effort). MIT License.
 */
(function (VD) {
  'use strict';

  const { storage, emit, L } = VD.ui;
  const KEY = {
    vehicle: 'vdw.vehicle.v1', prefs: 'vdw.prefs.v1', library: 'vdw.library.v1', analysis: 'vdw.analysis.v1',
  };
  const MAX_RUNS = 8;
  const MAX_LIBRARY = 50;
  const NAME_MAX = 60;

  const cleanName = (n) => String(n == null ? '' : n).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, NAME_MAX);

  const state = {
    vehicle: null,
    vehicleName: '',
    vehicleBase: 'sedan',
    prefs: { lang: 'ko', theme: 'auto', advanced: false, tab: 'vehicle' },
    analysis: { maneuver: 'step', mp: {}, settings: Object.assign({}, VD.maneuvers.SETTINGS_DEFAULT) },
    runs: [],
    activeRun: null,
  };

  function presetName(id) {
    const pr = VD.params.PRESETS.find((x) => x.id === id);
    return pr ? pr.name : { ko: id, en: id };
  }

  function init() {
    const prefs = storage.get(KEY.prefs, null);
    if (prefs && typeof prefs === 'object') {
      if (prefs.lang === 'en' || prefs.lang === 'ko') state.prefs.lang = prefs.lang;
      else state.prefs.lang = (navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
      if (['auto', 'light', 'dark'].includes(prefs.theme)) state.prefs.theme = prefs.theme;
      state.prefs.advanced = !!prefs.advanced;
      if (typeof prefs.tab === 'string') state.prefs.tab = prefs.tab;
    } else {
      state.prefs.lang = (navigator.language || 'ko').toLowerCase().startsWith('ko') ? 'ko' : 'en';
    }
    const saved = storage.get(KEY.vehicle, null);
    if (saved && saved.params) {
      state.vehicle = VD.params.sanitize(saved.params).params;
      state.vehicleName = cleanName(saved.name);
      state.vehicleBase = VD.params.PRESETS.some((p) => p.id === saved.base) ? saved.base : 'sedan';
    } else {
      state.vehicle = VD.params.presetParams('sedan');
      state.vehicleBase = 'sedan';
      state.vehicleName = '';
    }
    const an = storage.get(KEY.analysis, null);
    if (an && typeof an === 'object') {
      if (VD.maneuvers.BY_ID[an.maneuver]) state.analysis.maneuver = an.maneuver;
      if (an.mp && typeof an.mp === 'object') {
        for (const id in an.mp) if (VD.maneuvers.BY_ID[id]) state.analysis.mp[id] = VD.maneuvers.fillParams(VD.maneuvers.BY_ID[id], an.mp[id]);
      }
      if (an.settings && typeof an.settings === 'object') state.analysis.settings = sanitizeSettings(an.settings);
    }
  }

  function sanitizeSettings(sIn) {
    const d = VD.maneuvers.SETTINGS_DEFAULT;
    const out = Object.assign({}, d);
    if (['dual', 'single'].includes(sIn.track)) out.track = sIn.track;
    if (VD.tire.MODELS.includes(sIn.tire)) out.tire = sIn.tire;
    const num = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : def);
    out.dt = num(sIn.dt, 0.0002, 0.01, d.dt);
    out.outDt = num(sIn.outDt, 0.001, 0.1, d.outDt);
    out.mu = num(sIn.mu, 0.05, 1.5, d.mu);
    for (const k of ['abs', 'tcs', 'esc']) if (['vehicle', 'on', 'off'].includes(sIn[k])) out[k] = sIn[k];
    out.linearRef = sIn.linearRef !== false;
    return out;
  }

  const savePrefs = () => storage.set(KEY.prefs, state.prefs);
  const saveVehicle = () => storage.set(KEY.vehicle, { name: state.vehicleName, base: state.vehicleBase, params: state.vehicle });
  const saveAnalysis = () => storage.set(KEY.analysis, state.analysis);

  function setPref(key, value) { state.prefs[key] = value; savePrefs(); emit('prefs', { key, value }); }

  /** Display name of the active vehicle in the current language. */
  function vehicleLabel() {
    if (state.vehicleName) return state.vehicleName;
    const base = L(presetName(state.vehicleBase));
    return isModified() ? `${base} *` : base;
  }

  function isModified() {
    const base = VD.params.presetParams(state.vehicleBase);
    return VD.params.FIELDS.some((f) => base[f.key] !== state.vehicle[f.key]);
  }

  function setVehicle(params, meta) {
    state.vehicle = VD.params.sanitize(params, state.vehicle).params;
    if (meta) {
      if (meta.name !== undefined) state.vehicleName = cleanName(meta.name);
      if (meta.base && VD.params.PRESETS.some((p) => p.id === meta.base)) state.vehicleBase = meta.base;
    }
    saveVehicle();
    emit('vehicle', { source: meta && meta.source });
  }

  function setParam(key, value) {
    if (!(key in VD.params.FIELD_BY_KEY)) return;
    const next = Object.assign({}, state.vehicle, { [key]: value });
    state.vehicle = VD.params.sanitize(next, state.vehicle).params;
    saveVehicle();
    emit('vehicle', { source: 'field', key });
  }

  function loadPreset(id) {
    setVehicle(VD.params.presetParams(id), { base: id, name: '', source: 'preset' });
  }

  // --- saved vehicles ---------------------------------------------------------
  function library() {
    const raw = storage.get(KEY.library, []);
    return Array.isArray(raw) ? raw.filter((x) => x && typeof x.id === 'string' && x.params).slice(0, MAX_LIBRARY) : [];
  }
  function saveToLibrary(name) {
    const lib = library();
    const entry = { id: 'v' + Date.now().toString(36), name: cleanName(name) || vehicleLabel(), base: state.vehicleBase, params: state.vehicle, savedAt: new Date().toISOString() };
    lib.unshift(entry);
    const ok = storage.set(KEY.library, lib.slice(0, MAX_LIBRARY));
    state.vehicleName = entry.name;
    saveVehicle();
    emit('library');
    emit('vehicle', { source: 'library' });
    return ok;
  }
  function loadFromLibrary(id) {
    const e = library().find((x) => x.id === id);
    if (e) setVehicle(e.params, { name: e.name, base: e.base, source: 'library' });
  }
  function removeFromLibrary(id) {
    storage.set(KEY.library, library().filter((x) => x.id !== id));
    emit('library');
  }

  // --- vehicle file format ------------------------------------------------------
  function exportVehicle() {
    return JSON.stringify({
      format: 'vd-workbench/vehicle', version: 1, app: VD.version,
      name: vehicleLabel(), base: state.vehicleBase, units: 'see docs/MODEL.md',
      params: state.vehicle,
    }, null, 2);
  }
  function importVehicle(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw { code: 'json' }; }
    if (!obj || typeof obj !== 'object') throw { code: 'json' };
    const params = obj.params && typeof obj.params === 'object' ? obj.params : obj;
    const known = VD.params.FIELDS.filter((f) => f.key in params).length;
    if (known < 5) throw { code: 'schema' };
    const res = VD.params.sanitize(params, VD.params.presetParams('sedan'));
    setVehicle(res.params, { name: cleanName(obj.name) || 'Imported', base: obj.base, source: 'import' });
    return res.issues;
  }

  // --- runs -------------------------------------------------------------------
  let runSeq = 0;
  /** Add a run; `extra` (tag, sweep info …) is attached before listeners are notified. */
  function addRun(result, label, extra) {
    const used = new Set(state.runs.map((r) => r.slot));
    if (state.runs.length >= MAX_RUNS) {
      const oldest = state.runs.shift();
      used.delete(oldest.slot);
    }
    let slot = 1;
    while (used.has(slot)) slot++;
    const run = {
      id: 'r' + (++runSeq), seq: runSeq, slot, label: label || `#${runSeq}`, visible: true,
      vehicleName: vehicleLabel(), result, createdAt: new Date(),
    };
    if (extra) Object.assign(run, extra);
    state.runs.push(run);
    state.activeRun = run.id;
    emit('runs');
    return run;
  }
  function removeRun(id) {
    state.runs = state.runs.filter((r) => r.id !== id);
    if (state.activeRun === id) state.activeRun = state.runs.length ? state.runs[state.runs.length - 1].id : null;
    emit('runs');
  }
  function clearRuns() { state.runs = []; state.activeRun = null; emit('runs'); }
  function setRunVisible(id, v) { const r = state.runs.find((x) => x.id === id); if (r) { r.visible = v; emit('runs'); } }
  function setActiveRun(id) { state.activeRun = id; emit('runs'); }
  const visibleRuns = () => state.runs.filter((r) => r.visible);
  const activeRun = () => state.runs.find((r) => r.id === state.activeRun) || null;

  VD.store = {
    state, init, setPref, savePrefs, saveAnalysis, sanitizeSettings,
    vehicleLabel, isModified, setVehicle, setParam, loadPreset, presetName,
    library, saveToLibrary, loadFromLibrary, removeFromLibrary, exportVehicle, importVehicle,
    addRun, removeRun, clearRuns, setRunVisible, setActiveRun, visibleRuns, activeRun, MAX_RUNS,
  };
})(globalThis.VD = globalThis.VD || {});
