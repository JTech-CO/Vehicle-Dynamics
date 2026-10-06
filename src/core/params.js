/*!
 * Vehicle parameter schema, presets, validation and derived characteristics.
 * MIT License.
 *
 * Parameters are stored in engineering units (kW, deg, %, km/h) because that is
 * what users type and what the exported JSON should read like. `toModel()`
 * converts them once into SI for the solver.
 */
(function (VD) {
  'use strict';

  const { g, DEG, RAD, KPH } = VD.const;

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------
  const GROUPS = [
    { id: 'mass', label: { ko: '질량·관성', en: 'Mass & inertia' } },
    { id: 'geometry', label: { ko: '차축 배치', en: 'Axle layout' } },
    { id: 'body', label: { ko: '차체 외형', en: 'Body envelope' } },
    { id: 'steering', label: { ko: '조향계', en: 'Steering' } },
    { id: 'tires', label: { ko: '타이어', en: 'Tires' } },
    { id: 'load', label: { ko: '하중 이동', en: 'Load transfer' } },
    { id: 'powertrain', label: { ko: '구동계', en: 'Powertrain' } },
    { id: 'brakes', label: { ko: '제동계', en: 'Brakes' } },
    { id: 'aero', label: { ko: '공력·저항', en: 'Aero & resistance' } },
    { id: 'assist', label: { ko: '전자 제어', en: 'Electronic assists' } },
  ];

  // sym/sub are rendered as text + <sub>, never as HTML.
  const F = (key, group, o) => Object.assign({ key, group, type: 'number', advanced: false }, o);

  const FIELDS = [
    F('m', 'mass', { sym: 'm', unit: 'kg', min: 100, max: 60000, step: 10,
      label: { ko: '차량 질량', en: 'Vehicle mass' },
      hint: { ko: '시험 상태 질량(운전자·계측장비 포함)', en: 'Test mass including driver and instrumentation' } }),
    F('Izz', 'mass', { sym: 'I', sub: 'zz', unit: 'kg·m²', min: 50, max: 500000, step: 10,
      label: { ko: '요 관성 모멘트', en: 'Yaw moment of inertia' },
      hint: { ko: '무게중심 z축 기준', en: 'About the vertical axis through the CG' } }),
    F('h', 'mass', { sym: 'h', unit: 'm', min: 0.1, max: 3, step: 0.01,
      label: { ko: '무게중심 높이', en: 'CG height' },
      hint: { ko: '지면 기준', en: 'Above ground' } }),

    F('a', 'geometry', { sym: 'a', unit: 'm', min: 0.3, max: 8, step: 0.01,
      label: { ko: '무게중심-전축 거리', en: 'CG to front axle' },
      hint: { ko: 'MATLAB 3DOF의 a (l_f)', en: 'MATLAB 3DOF parameter a (l_f)' } }),
    F('b', 'geometry', { sym: 'b', unit: 'm', min: 0.3, max: 8, step: 0.01,
      label: { ko: '무게중심-후축 거리', en: 'CG to rear axle' },
      hint: { ko: 'MATLAB 3DOF의 b (l_r)', en: 'MATLAB 3DOF parameter b (l_r)' } }),
    F('wf', 'geometry', { sym: 'w', sub: 'f', unit: 'm', min: 0.5, max: 3.5, step: 0.01,
      label: { ko: '전륜 윤거', en: 'Front track width' } }),
    F('wr', 'geometry', { sym: 'w', sub: 'r', unit: 'm', min: 0.5, max: 3.5, step: 0.01,
      label: { ko: '후륜 윤거', en: 'Rear track width' } }),

    F('ohF', 'body', { sym: 'o', sub: 'f', unit: 'm', min: 0, max: 4, step: 0.01,
      label: { ko: '전방 오버행', en: 'Front overhang' },
      hint: { ko: '전축에서 차체 앞끝까지. 콘 판정·도시에 사용', en: 'Front axle to bumper. Used for cone checks and drawing' } }),
    F('ohR', 'body', { sym: 'o', sub: 'r', unit: 'm', min: 0, max: 5, step: 0.01,
      label: { ko: '후방 오버행', en: 'Rear overhang' } }),
    F('bodyW', 'body', { sym: 'W', unit: 'm', min: 0.8, max: 3.0, step: 0.01,
      label: { ko: '차체 전폭', en: 'Overall width' },
      hint: { ko: 'ISO 3888 차로 폭 계산에 사용', en: 'Used for ISO 3888 lane widths' } }),

    F('steerRatio', 'steering', { sym: 'i', sub: 's', unit: '-', min: 5, max: 40, step: 0.1,
      label: { ko: '조향 기어비', en: 'Steering ratio' },
      hint: { ko: '조향휠각 / 전륜 조향각', en: 'Steering-wheel angle / road-wheel angle' } }),
    F('swaMax', 'steering', { sym: 'δ', sub: 'sw,max', unit: 'deg', min: 90, max: 1200, step: 5,
      label: { ko: '최대 조향휠각', en: 'Max steering-wheel angle' },
      hint: { ko: '중립 위치에서 락까지의 각도', en: 'Centre to lock' } }),
    F('ackermann', 'steering', { sym: 'A', sub: 'ck', unit: '%', min: 0, max: 100, step: 1,
      label: { ko: '애커먼 비율', en: 'Ackermann percentage' },
      hint: { ko: '0 = 평행 조향, 100 = 기하학적 애커먼', en: '0 = parallel steer, 100 = full geometric Ackermann' } }),
    F('rearSteer', 'steering', { sym: 'k', sub: 'rs', unit: '-', min: -0.5, max: 0.5, step: 0.01,
      label: { ko: '후륜 조향비', en: 'Rear-steer ratio' },
      hint: { ko: 'δr = k·δf. 음수 = 역위상', en: 'δr = k·δf. Negative = counter-phase' } }),

    F('Cf', 'tires', { sym: 'C', sub: 'αf', unit: 'N/rad', min: 5000, max: 2000000, step: 1000,
      label: { ko: '전축 코너링 강성', en: 'Front axle cornering stiffness' },
      hint: { ko: '정적 하중에서 좌우 합산, 컴플라이언스 포함 등가값', en: 'Both tires at static load; effective value incl. compliance' } }),
    F('Cr', 'tires', { sym: 'C', sub: 'αr', unit: 'N/rad', min: 5000, max: 2000000, step: 1000,
      label: { ko: '후축 코너링 강성', en: 'Rear axle cornering stiffness' } }),
    F('muF', 'tires', { sym: 'μ', sub: 'f', unit: '-', min: 0.2, max: 2.5, step: 0.01,
      label: { ko: '전륜 최대 마찰계수', en: 'Front tire peak friction' },
      hint: { ko: '기준 노면(μ=1)에서의 값', en: 'On the reference surface (road μ = 1)' } }),
    F('muR', 'tires', { sym: 'μ', sub: 'r', unit: '-', min: 0.2, max: 2.5, step: 0.01,
      label: { ko: '후륜 최대 마찰계수', en: 'Rear tire peak friction' } }),
    F('mfC', 'tires', { sym: 'C', sub: 'y', unit: '-', min: 1.0, max: 2.0, step: 0.01, advanced: true,
      label: { ko: 'Magic Formula 형상계수', en: 'Magic Formula shape factor' } }),
    F('mfE', 'tires', { sym: 'E', sub: 'y', unit: '-', min: -5, max: 0.9, step: 0.05, advanced: true,
      label: { ko: 'Magic Formula 곡률계수', en: 'Magic Formula curvature factor' },
      hint: { ko: '음수일수록 피크 슬립각이 작아짐', en: 'More negative → smaller peak slip angle' } }),
    F('nC', 'tires', { sym: 'n', sub: 'C', unit: '-', min: 0, max: 1, step: 0.01, advanced: true,
      label: { ko: '코너링 강성 하중 지수', en: 'Cornering-stiffness load exponent' },
      hint: { ko: 'Cα ∝ Fzⁿ. 1 = MATLAB 3DOF와 동일한 비례 모델', en: 'Cα ∝ Fzⁿ. 1 = proportional, as in MATLAB 3DOF' } }),
    F('kMu', 'tires', { sym: 'k', sub: 'μ', unit: '-', min: 0, max: 0.5, step: 0.01, advanced: true,
      label: { ko: '마찰계수 하중 민감도', en: 'Friction load sensitivity' },
      hint: { ko: 'μ ∝ (Fz/Fz0)^(−k)', en: 'μ ∝ (Fz/Fz0)^(−k)' } }),
    F('slideRatio', 'tires', { sym: 'μ', sub: 's/p', unit: '-', min: 0.4, max: 1, step: 0.01, advanced: true,
      label: { ko: '미끄럼/최대 마찰비', en: 'Sliding-to-peak friction ratio' },
      hint: { ko: '잠김·휠스핀 상태의 마찰', en: 'Friction while locked or spinning' } }),
    F('sigma', 'tires', { sym: 'σ', unit: 'm', min: 0, max: 2, step: 0.01, advanced: true,
      label: { ko: '이완 길이', en: 'Relaxation length' },
      hint: { ko: '0 = 정상상태 슬립각(지연 없음)', en: '0 = steady-state slip angle (no lag)' } }),

    F('lltdF', 'load', { sym: 'λ', sub: 'f', unit: '%', min: 20, max: 80, step: 1,
      label: { ko: '전축 횡하중이동 분담률', en: 'Front lateral load-transfer share' },
      hint: { ko: '롤 강성 배분(LLTD). MATLAB 3DOF는 50%', en: 'Roll-stiffness distribution (LLTD). MATLAB 3DOF uses 50%' } }),
    F('tauLT', 'load', { sym: 'τ', sub: 'LT', unit: 's', min: 0.01, max: 0.5, step: 0.01, advanced: true,
      label: { ko: '하중이동 시정수', en: 'Load-transfer time constant' },
      hint: { ko: '롤·피치 지연을 1차 지연으로 근사', en: 'First-order lag approximating roll/pitch response' } }),

    F('drive', 'powertrain', { type: 'enum', sym: '', unit: '',
      options: [
        { value: 'FWD', label: { ko: '전륜구동 (FWD)', en: 'Front-wheel drive (FWD)' } },
        { value: 'RWD', label: { ko: '후륜구동 (RWD)', en: 'Rear-wheel drive (RWD)' } },
        { value: 'AWD', label: { ko: '사륜구동 (AWD)', en: 'All-wheel drive (AWD)' } },
      ],
      label: { ko: '구동 방식', en: 'Drive layout' } }),
    F('awdFront', 'powertrain', { sym: 'ξ', sub: 'f', unit: '%', min: 0, max: 100, step: 1,
      label: { ko: 'AWD 전륜 구동력 배분', en: 'AWD front torque share' } }),
    F('Pmax', 'powertrain', { sym: 'P', sub: 'max', unit: 'kW', min: 5, max: 1500, step: 1,
      label: { ko: '최대 휠 출력', en: 'Max power at wheels' } }),
    F('FtMax', 'powertrain', { sym: 'F', sub: 't,max', unit: 'N', min: 500, max: 200000, step: 100,
      label: { ko: '최대 구동력', en: 'Max tractive force' },
      hint: { ko: '저속(1단) 휠 구동력 한계', en: 'Low-speed (1st gear) limit at the wheels' } }),
    F('vMax', 'powertrain', { sym: 'v', sub: 'max', unit: 'km/h', min: 20, max: 450, step: 1,
      label: { ko: '최고속도 제한', en: 'Speed governor' } }),

    F('FbMax', 'brakes', { sym: 'F', sub: 'b,max', unit: 'N', min: 1000, max: 400000, step: 100,
      label: { ko: '최대 제동력', en: 'Max service-brake force' },
      hint: { ko: '페달 100%에서 4륜 합계', en: 'Sum of four wheels at 100 % pedal' } }),
    F('brakeBiasF', 'brakes', { sym: 'β', sub: 'b', unit: '%', min: 0, max: 100, step: 1,
      label: { ko: '전륜 제동 배분', en: 'Front brake bias' } }),
    F('FhbMax', 'brakes', { sym: 'F', sub: 'hb', unit: 'N', min: 0, max: 100000, step: 100,
      label: { ko: '주차 브레이크 제동력', en: 'Handbrake force' },
      hint: { ko: '후륜에만 작용, ABS 미적용', en: 'Rear only, bypasses ABS' } }),

    F('Cd', 'aero', { sym: 'C', sub: 'd', unit: '-', min: 0, max: 2, step: 0.01,
      label: { ko: '항력 계수', en: 'Drag coefficient' } }),
    F('Af', 'aero', { sym: 'A', sub: 'f', unit: 'm²', min: 0.3, max: 12, step: 0.01,
      label: { ko: '전면 투영 면적', en: 'Frontal area' } }),
    F('Cl', 'aero', { sym: 'C', sub: 'l', unit: '-', min: -6, max: 1, step: 0.01,
      label: { ko: '양력 계수', en: 'Lift coefficient' },
      hint: { ko: '음수 = 다운포스', en: 'Negative = downforce' } }),
    F('aeroBalF', 'aero', { sym: 'ε', sub: 'f', unit: '%', min: 0, max: 100, step: 1,
      label: { ko: '전축 공력 배분', en: 'Front aero balance' } }),
    F('rho', 'aero', { sym: 'ρ', unit: 'kg/m³', min: 0.8, max: 1.4, step: 0.001, advanced: true,
      label: { ko: '공기 밀도', en: 'Air density' } }),
    F('fr', 'aero', { sym: 'f', sub: 'r', unit: '-', min: 0, max: 0.05, step: 0.001,
      label: { ko: '구름저항 계수', en: 'Rolling-resistance coefficient' } }),

    F('abs', 'assist', { type: 'bool', sym: '', unit: '', label: { ko: 'ABS', en: 'ABS' },
      hint: { ko: '제동 중 바퀴 잠김 방지', en: 'Prevents wheel lock under braking' } }),
    F('tcs', 'assist', { type: 'bool', sym: '', unit: '', label: { ko: 'TCS', en: 'TCS' },
      hint: { ko: '구동륜 휠스핀 방지', en: 'Prevents drive-wheel spin' } }),
    F('esc', 'assist', { type: 'bool', sym: '', unit: '', label: { ko: 'ESC', en: 'ESC' },
      hint: { ko: '개별 제동으로 요 레이트 제어', en: 'Yaw-rate control by individual wheel braking' } }),
    F('absEff', 'assist', { sym: 'η', sub: 'ABS', unit: '-', min: 0.5, max: 1, step: 0.01, advanced: true,
      label: { ko: 'ABS 마찰 활용률', en: 'ABS friction utilisation' } }),
    F('escGain', 'assist', { sym: 'K', sub: 'ESC', unit: '1/s', min: 0, max: 40, step: 0.5, advanced: true,
      label: { ko: 'ESC 요 모멘트 게인', en: 'ESC yaw-moment gain' } }),
    F('escThresh', 'assist', { sym: 'Δr', sub: 'th', unit: 'deg/s', min: 0, max: 20, step: 0.5, advanced: true,
      label: { ko: 'ESC 개입 문턱', en: 'ESC activation threshold' } }),
  ];

  const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

  // ---------------------------------------------------------------------------
  // Presets: representative values, not specific production vehicles.
  // ---------------------------------------------------------------------------
  const COMMON = {
    mfC: 1.3, mfE: -1.0, nC: 0.8, kMu: 0.1, slideRatio: 0.8, sigma: 0.3,
    tauLT: 0.05, rho: 1.204, fr: 0.012, rearSteer: 0,
    abs: true, tcs: true, esc: true, absEff: 0.9, escGain: 8, escThresh: 3,
    awdFront: 40,
  };

  const PRESETS = [
    {
      id: 'sedan',
      name: { ko: '중형 세단', en: 'Mid-size sedan' },
      desc: { ko: 'FWD · 약한 언더스티어 · 일반 타이어', en: 'FWD · mild understeer · touring tires' },
      p: { m: 1600, Izz: 2700, h: 0.55, a: 1.15, b: 1.70, wf: 1.60, wr: 1.60,
        ohF: 0.95, ohR: 1.05, bodyW: 1.85, steerRatio: 15.5, swaMax: 540, ackermann: 50,
        Cf: 105000, Cr: 125000, muF: 1.0, muR: 1.0, lltdF: 55,
        drive: 'FWD', Pmax: 150, FtMax: 7500, vMax: 220,
        FbMax: 19000, brakeBiasF: 70, FhbMax: 6000,
        Cd: 0.28, Af: 2.3, Cl: 0.08, aeroBalF: 50 },
    },
    {
      id: 'suv',
      name: { ko: 'SUV', en: 'SUV' },
      desc: { ko: 'AWD · 높은 무게중심 · 큰 관성', en: 'AWD · high CG · large inertia' },
      p: { m: 2150, Izz: 4100, h: 0.72, a: 1.40, b: 1.55, wf: 1.66, wr: 1.67,
        ohF: 0.95, ohR: 1.05, bodyW: 1.95, steerRatio: 16, swaMax: 540, ackermann: 60,
        Cf: 105000, Cr: 150000, muF: 0.95, muR: 0.95, lltdF: 58,
        drive: 'AWD', awdFront: 40, Pmax: 220, FtMax: 10000, vMax: 210,
        FbMax: 25000, brakeBiasF: 65, FhbMax: 7000,
        Cd: 0.35, Af: 2.8, Cl: 0.1, aeroBalF: 50 },
    },
    {
      id: 'sports',
      name: { ko: '스포츠카', en: 'Sports car' },
      desc: { ko: 'RWD · 고출력 · 고그립 타이어', en: 'RWD · high power · high-grip tires' },
      p: { m: 1450, Izz: 2050, h: 0.46, a: 1.25, b: 1.20, wf: 1.58, wr: 1.60,
        ohF: 0.95, ohR: 0.95, bodyW: 1.85, steerRatio: 13, swaMax: 450, ackermann: 40,
        Cf: 120000, Cr: 160000, muF: 1.1, muR: 1.1, lltdF: 55, sigma: 0.25,
        drive: 'RWD', Pmax: 330, FtMax: 9000, vMax: 290,
        FbMax: 20000, brakeBiasF: 64, FhbMax: 6000,
        Cd: 0.33, Af: 2.0, Cl: -0.15, aeroBalF: 45 },
    },
    {
      id: 'race',
      name: { ko: '포뮬러형 레이싱카', en: 'Formula-style race car' },
      desc: { ko: 'RWD · 대형 다운포스 · 슬릭 · 보조장치 없음', en: 'RWD · high downforce · slicks · no assists' },
      p: { m: 700, Izz: 1150, h: 0.30, a: 1.75, b: 1.25, wf: 1.60, wr: 1.55,
        ohF: 0.9, ohR: 0.5, bodyW: 1.80, steerRatio: 10, swaMax: 270, ackermann: 20,
        Cf: 120000, Cr: 190000, muF: 1.7, muR: 1.7, lltdF: 52, slideRatio: 0.85, sigma: 0.2,
        drive: 'RWD', Pmax: 500, FtMax: 9000, vMax: 330,
        FbMax: 20000, brakeBiasF: 58, FhbMax: 0,
        Cd: 0.95, Af: 1.4, Cl: -3.2, aeroBalF: 42,
        abs: false, tcs: false, esc: false },
    },
    {
      id: 'drift',
      name: { ko: '드리프트 세팅', en: 'Drift setup' },
      desc: { ko: 'RWD · 후륜 그립 저하 · 큰 조향각 · ESC/TCS 해제', en: 'RWD · reduced rear grip · large lock · ESC/TCS off' },
      p: { m: 1350, Izz: 1900, h: 0.47, a: 1.22, b: 1.33, wf: 1.52, wr: 1.54,
        ohF: 0.9, ohR: 0.95, bodyW: 1.75, steerRatio: 12, swaMax: 600, ackermann: 0,
        Cf: 110000, Cr: 90000, muF: 1.05, muR: 0.9, lltdF: 60,
        drive: 'RWD', Pmax: 300, FtMax: 9000, vMax: 250,
        FbMax: 18000, brakeBiasF: 62, FhbMax: 9000,
        Cd: 0.32, Af: 2.0, Cl: 0, aeroBalF: 50,
        abs: true, tcs: false, esc: false },
    },
    {
      id: 'van',
      name: { ko: '소형 트럭·밴 (3.5 t)', en: 'Light truck / van (3.5 t)' },
      desc: { ko: 'RWD · 적재 상태 · 높은 무게중심', en: 'RWD · laden · high CG' },
      p: { m: 3500, Izz: 10500, h: 0.95, a: 1.95, b: 1.70, wf: 1.72, wr: 1.72,
        ohF: 1.0, ohR: 1.6, bodyW: 2.05, steerRatio: 18, swaMax: 630, ackermann: 80,
        Cf: 105000, Cr: 146000, muF: 0.9, muR: 0.9, lltdF: 55, sigma: 0.4,
        drive: 'RWD', Pmax: 130, FtMax: 14000, vMax: 160,
        FbMax: 38000, brakeBiasF: 60, FhbMax: 12000,
        Cd: 0.38, Af: 4.5, Cl: 0, aeroBalF: 50 },
    },
    {
      id: 'bus',
      name: { ko: '시내버스', en: 'City bus' },
      desc: { ko: 'RWD · 12 t · 긴 휠베이스 · 큰 관성', en: 'RWD · 12 t · long wheelbase · large inertia' },
      p: { m: 12500, Izz: 140000, h: 1.2, a: 3.8, b: 2.1, wf: 2.10, wr: 1.85,
        ohF: 2.6, ohR: 3.5, bodyW: 2.55, steerRatio: 20, swaMax: 900, ackermann: 100,
        Cf: 240000, Cr: 520000, muF: 0.8, muR: 0.8, lltdF: 50, sigma: 0.6,
        drive: 'RWD', Pmax: 220, FtMax: 40000, vMax: 90,
        FbMax: 110000, brakeBiasF: 45, FhbMax: 40000,
        Cd: 0.65, Af: 8.0, Cl: 0, aeroBalF: 50, fr: 0.008 },
    },
  ];

  function presetParams(id) {
    const pr = PRESETS.find((x) => x.id === id) || PRESETS[0];
    return Object.assign({}, COMMON, pr.p);
  }

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  /**
   * Coerce an untrusted object (e.g. imported JSON) into a valid parameter set.
   * Unknown keys are dropped, numbers are clamped to the schema range and
   * anything missing is taken from `fallback`.
   */
  function sanitize(raw, fallback) {
    const base = fallback || presetParams('sedan');
    const out = {};
    const issues = [];
    const src = raw && typeof raw === 'object' ? raw : {};
    for (const f of FIELDS) {
      const v = src[f.key];
      if (f.type === 'number') {
        const num = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
        if (!Number.isFinite(num)) {
          out[f.key] = base[f.key];
          if (v !== undefined) issues.push({ key: f.key, kind: 'invalid' });
        } else {
          const c = Math.min(f.max, Math.max(f.min, num));
          if (c !== num) issues.push({ key: f.key, kind: 'clamped', from: num, to: c });
          out[f.key] = c;
        }
      } else if (f.type === 'enum') {
        out[f.key] = f.options.some((o) => o.value === v) ? v : base[f.key];
      } else if (f.type === 'bool') {
        out[f.key] = typeof v === 'boolean' ? v : !!base[f.key];
      }
    }
    return { params: out, issues };
  }

  /** Validate a single field value from a form input. */
  function checkField(key, value) {
    const f = FIELD_BY_KEY[key];
    if (!f || f.type !== 'number') return { ok: true, value };
    const num = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
    if (!Number.isFinite(num)) return { ok: false, reason: 'nan' };
    if (num < f.min) return { ok: false, reason: 'min', limit: f.min };
    if (num > f.max) return { ok: false, reason: 'max', limit: f.max };
    return { ok: true, value: num };
  }

  // ---------------------------------------------------------------------------
  // SI model parameters
  // ---------------------------------------------------------------------------
  function toModel(p) {
    const L = p.a + p.b;
    const W = p.m * g;
    const Fzf0 = (W * p.b) / L;          // static front axle load
    const Fzr0 = (W * p.a) / L;
    const Kus = (p.m / L) * (p.b / p.Cf - p.a / p.Cr); // rad/(m/s²), front-steer only
    return {
      src: p,
      m: p.m, Izz: p.Izz, h: p.h, a: p.a, b: p.b, L, wf: p.wf, wr: p.wr,
      ohF: p.ohF, ohR: p.ohR, bodyW: p.bodyW,
      steerRatio: p.steerRatio, swaMax: p.swaMax * DEG, roadMax: (p.swaMax * DEG) / p.steerRatio,
      ack: p.ackermann / 100, krs: p.rearSteer,
      Cf: p.Cf, Cr: p.Cr, muF: p.muF, muR: p.muR,
      mfC: p.mfC, mfE: p.mfE, nC: p.nC, kMu: p.kMu, slide: p.slideRatio, sigma: p.sigma,
      lltd: p.lltdF / 100, tauLT: p.tauLT,
      drive: p.drive, awdF: p.awdFront / 100, Pmax: p.Pmax * 1000, FtMax: p.FtMax, vMax: p.vMax * KPH,
      FbMax: p.FbMax, biasF: p.brakeBiasF / 100, FhbMax: p.FhbMax,
      CdA: p.Cd * p.Af, ClA: p.Cl * p.Af, aeroF: p.aeroBalF / 100, rho: p.rho, fr: p.fr,
      abs: !!p.abs, tcs: !!p.tcs, esc: !!p.esc, etaAbs: p.absEff, etaTcs: p.absEff,
      escGain: p.escGain, escThresh: p.escThresh * DEG,
      W, Fzf0, Fzr0, Fz0: [Fzf0 / 2, Fzf0 / 2, Fzr0 / 2, Fzr0 / 2],
      Kus,
    };
  }

  // ---------------------------------------------------------------------------
  // Derived characteristics (linear single-track theory + simple statics)
  // ---------------------------------------------------------------------------
  function derive(p) {
    const M = toModel(p);
    const { m, a, b, L, Cf, Cr, Izz } = M;
    const d = {};
    d.L = L;
    d.frontWeightPct = (b / L) * 100;
    d.Fzf0 = M.Fzf0; d.Fzr0 = M.Fzr0;
    d.FzWheelF = M.Fzf0 / 2; d.FzWheelR = M.Fzr0 / 2;
    d.Kus = M.Kus;                          // rad/(m/s²)
    d.KusDegG = M.Kus * RAD * g;            // deg/g
    d.balance = Math.abs(d.KusDegG) < 0.05 ? 'neutral' : d.KusDegG > 0 ? 'understeer' : 'oversteer';
    d.vch = M.Kus > 1e-9 ? Math.sqrt(L / M.Kus) : NaN;   // characteristic speed, m/s
    d.vcrit = M.Kus < -1e-9 ? Math.sqrt(-L / M.Kus) : NaN; // critical speed, m/s
    d.nsp = (a * Cf - b * Cr) / (Cf + Cr);  // neutral-steer point ahead of CG, m
    d.staticMargin = -d.nsp / L * 100;      // % of wheelbase, + = stable
    d.dynIndex = Izz / (m * a * b);         // yaw dynamic index
    d.ssf = Math.min(p.wf, p.wr) / (2 * p.h); // static stability factor, g
    d.muMax = Math.max(p.muF, p.muR);
    // top speed: P = (½ρCdA v² + fr·m·g)·v, solved by bisection, capped by governor
    const resist = (v) => (0.5 * M.rho * M.CdA * v * v + M.fr * m * g) * v;
    let lo = 0, hi = 200;
    for (let i = 0; i < 60; i++) { const mid = 0.5 * (lo + hi); if (resist(mid) < M.Pmax) lo = mid; else hi = mid; }
    d.vTopPower = lo;
    d.vTop = Math.min(lo, M.vMax);
    d.powerToWeight = (p.Pmax * 1000) / m;
    d.decelMax = Math.min(M.FbMax / m, Math.min(p.muF, p.muR) * g);
    // linear yaw-plane characteristics at 100 km/h
    const v = 100 * KPH;
    const lin = VD.linear ? VD.linear.analyze(p, v) : null;
    if (lin) {
      d.at100 = lin;
    }
    return d;
  }

  /** Cross-field engineering plausibility checks. */
  function check(p) {
    const w = [];
    const d = derive(p);
    if (d.ssf < Math.max(p.muF, p.muR)) {
      w.push({ level: 'warn',
        ko: `정적 안정 계수(SSF ${d.ssf.toFixed(2)})가 타이어 μ보다 작습니다. 실차는 미끄러지기 전에 전복될 수 있으나 3DOF 평면 모델은 전복을 표현하지 않습니다.`,
        en: `Static stability factor (SSF ${d.ssf.toFixed(2)}) is below tire μ. A real vehicle could roll over before sliding; the planar 3DOF model does not capture rollover.` });
    }
    if (d.dynIndex < 0.5 || d.dynIndex > 1.6) {
      w.push({ level: 'warn',
        ko: `요 동적 지수 Izz/(m·a·b) = ${d.dynIndex.toFixed(2)} 이 일반 범위(0.5~1.6)를 벗어났습니다. 요 관성을 확인하세요.`,
        en: `Yaw dynamic index Izz/(m·a·b) = ${d.dynIndex.toFixed(2)} is outside the usual range of 0.5 to 1.6. Check the yaw inertia.` });
    }
    if (d.balance === 'oversteer') {
      w.push({ level: 'info',
        ko: `선형 해석상 오버스티어 차량입니다. 임계속도 ${(d.vcrit * 3.6).toFixed(0)} km/h 이상에서 요 운동이 불안정합니다.`,
        en: `Linearly oversteering. Yaw motion is unstable above the critical speed of ${(d.vcrit * 3.6).toFixed(0)} km/h.` });
    }
    if (p.drive !== 'AWD' && p.awdFront !== COMMON.awdFront) {
      // purely informational, the share is ignored for 2WD layouts
    }
    if (p.wf > p.bodyW || p.wr > p.bodyW) {
      w.push({ level: 'warn',
        ko: '윤거가 차체 전폭보다 넓습니다.', en: 'Track width exceeds overall width.' });
    }
    return w;
  }

  VD.params = {
    GROUPS, FIELDS, FIELD_BY_KEY, PRESETS, COMMON,
    presetParams, sanitize, checkField, toModel, derive, check,
    defaults: () => presetParams('sedan'),
  };
})(globalThis.VD = globalThis.VD || {});
