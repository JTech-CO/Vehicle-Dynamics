/*!
 * Theory and documentation view: model equations, assumptions, test
 * procedures, verification and references. Bilingual (KO/EN). MIT License.
 */
(function (VD) {
  'use strict';

  const { h, s, tx, clear, on } = VD.ui;

  // ---------------------------------------------------------------------------
  // Content helpers
  // ---------------------------------------------------------------------------
  const P = (ko, en) => ({ p: { ko, en } });
  const EQ = (t) => ({ eq: t });
  const H3 = (ko, en) => ({ h3: { ko, en } });
  const UL = (...items) => ({ ul: items.map(([ko, en]) => ({ ko, en })) });
  const NOTE = (ko, en) => ({ note: { ko, en } });
  const TABLE = (head, rows) => ({ table: { head, rows } });
  const FIG = (id, ko, en) => ({ fig: id, cap: { ko, en } });

  /** Inline text: `$…$` becomes MathML, `…` (backticks) becomes code. */
  function inline(str) {
    const out = [];
    const re = /\$([^$]+)\$|`([^`]+)`/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) out.push(str.slice(last, m.index));
      out.push(m[1] ? VD.mathml.tex(m[1], false) : h('code', null, m[2]));
      last = re.lastIndex;
    }
    if (last < str.length) out.push(str.slice(last));
    return out;
  }
  const itx = (o) => [h('span', { lang: 'ko' }, inline(o.ko)), h('span', { lang: 'en' }, inline(o.en))];
  const cell = (c) => (typeof c === 'string' ? inline(c) : itx(c));

  // ---------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------
  const SECTIONS = [
    {
      id: 'overview', title: { ko: '1. 개요', en: '1. Overview' }, blocks: [
        P('이 프로그램은 평면 3자유도(종·횡·요) 차량 모델로 조종 안정성을 해석하는 정적 웹 애플리케이션입니다. 서버나 외부 라이브러리 없이 브라우저에서만 동작하며, 같은 물리 엔진이 [시험 해석], [선형 해석], [실시간 주행]에 공통으로 쓰입니다.',
          'This application analyses vehicle handling with a planar three-degree-of-freedom (longitudinal, lateral, yaw) model. It runs entirely in the browser without a server or external libraries, and one physics engine serves [Test maneuvers], [Linear analysis] and the [Driving simulator].'),
        P('운동방정식의 골격은 MathWorks Vehicle Dynamics Blockset의 "Vehicle Body 3DOF" 블록(이중 트랙/단일 트랙)과 같습니다. 여기에 비선형 타이어(Magic Formula, Fiala), 하중 민감도, 롤 강성 배분에 따른 횡하중이동, 종·횡 복합 슬립, ABS·TCS·ESC, 구동·제동계, 경로 추종 운전자 모델과 표준 시험 절차를 더했습니다.',
          'The equations of motion follow the MathWorks Vehicle Dynamics Blockset "Vehicle Body 3DOF" block (dual and single track). On top of that the app adds nonlinear tires (Magic Formula, Fiala), load sensitivity, lateral load transfer with a roll-stiffness distribution, combined slip, ABS, TCS and ESC, a driveline and brakes, a path-following driver model and standardised test procedures.'),
        TABLE([{ ko: '모델', en: 'Model' }, { ko: '자유도·특징', en: 'States and features' }, { ko: '사용처', en: 'Used in' }], [
          [{ ko: '선형 단일 트랙', en: 'Linear single track' }, { ko: '$v_y, r$ · 일정 속도 · 선형 타이어 · 해석해', en: '$v_y, r$ · constant speed · linear tires · closed form' }, { ko: '선형 해석, 파생 특성, 선형 기준 응답', en: 'Linear analysis, derived values, linear reference' }],
          [{ ko: '비선형 단일 트랙', en: 'Nonlinear single track' }, { ko: '$v_x, v_y, r, X, Y, ψ$ · 축 단위 타이어', en: '$v_x, v_y, r, X, Y, ψ$ · axle tires' }, { ko: '시험 해석 (선택)', en: 'Test maneuvers (option)' }],
          [{ ko: '비선형 이중 트랙 (기본)', en: 'Nonlinear dual track (default)' }, { ko: '+ 4륜 개별 타이어, 하중이동, 이완 길이', en: '+ four tires, load transfer, relaxation' }, { ko: '시험 해석, 실시간 주행', en: 'Test maneuvers, driving simulator' }],
        ]),
      ],
    },
    {
      id: 'coords', title: { ko: '2. 좌표계와 부호 규약', en: '2. Coordinate systems and signs' }, blocks: [
        P('ISO 8855를 따릅니다. 차량 좌표계는 무게중심(CG)에 원점을 두고 $x$ 전방, $y$ 좌측, $z$ 상방입니다. 요 레이트 $r$, 조향각 $δ$, 슬립각, 차체 슬립각 $β$는 위에서 볼 때 반시계 방향(좌회전)이 양(+)입니다. 지면 고정 좌표계 $X, Y$에서 차량의 방향은 요 각 $ψ$입니다.',
          'The app follows ISO 8855. The vehicle frame has its origin at the centre of gravity (CG) with $x$ forward, $y$ to the left and $z$ up. Yaw rate $r$, steer angle $δ$ and body sideslip $β$ are positive counter-clockwise seen from above (a left turn). In the earth frame $X, Y$ the heading is $ψ$.'),
        FIG('dualtrack', '그림 1. 이중 트랙 3DOF 모델의 기호. 각 바퀴 $i$의 타이어 힘 $F_{x,i}, F_{y,i}$는 바퀴 좌표계에서 정의되고 조향각 $δ_i$만큼 회전해 차체에 작용합니다.',
          'Figure 1. Dual-track 3DOF notation. Tire forces $F_{x,i}, F_{y,i}$ are defined in each wheel frame and rotated by the steer angle $δ_i$ into the body frame.'),
        P('슬립각은 MATLAB 3DOF 블록과 같이 $α = \\arctan(v_{yw}/v_{xw})$로 정의하므로, 작은 슬립각에서 횡력은 $F_y ≈ -C_α α$로 슬립각과 반대 부호입니다. 좌회전 정상 선회에서 전·후륜 슬립각은 음수, 타이어 횡력은 양수입니다.',
          'As in the MATLAB 3DOF block the slip angle is $α = \\arctan(v_{yw}/v_{xw})$, so for small angles $F_y ≈ -C_α α$ has the opposite sign. In a steady left turn both axle slip angles are negative and the lateral tire forces positive.'),
      ],
    },
    {
      id: 'eom', title: { ko: '3. 운동방정식', en: '3. Equations of motion' }, blocks: [
        P('차체는 평면 강체입니다. 회전 좌표계에서 쓴 뉴턴–오일러 방정식은 다음과 같습니다.',
          'The body is a planar rigid body. The Newton–Euler equations in the rotating vehicle frame are'),
        EQ('m(\\dot{v}_x - r v_y) = \\sum_{i} F_{x,i} + F_{a,x}'),
        EQ('m(\\dot{v}_y + r v_x) = \\sum_{i} F_{y,i}'),
        EQ('I_{zz} \\dot{r} = \\sum_{i} (x_i F_{y,i} - y_i F_{x,i})'),
        EQ('\\dot{X} = v_x \\cos ψ - v_y \\sin ψ ,\\quad \\dot{Y} = v_x \\sin ψ + v_y \\cos ψ ,\\quad \\dot{ψ} = r'),
        P('바퀴 위치는 $(x_i, y_i) = (a, \\pm w_f/2), (-b, \\pm w_r/2)$이며 $i ∈ \\{fl, fr, rl, rr\\}$입니다. 단일 트랙 모델은 $w_f = w_r = 0$이고 횡하중이동이 없는 특수한 경우입니다. 출력 채널의 가속도는 가속도계와 같은 차체 좌표계 값 $a_x = \\dot{v}_x - r v_y$, $a_y = \\dot{v}_y + r v_x$입니다.',
          'Wheel positions are $(x_i, y_i) = (a, \\pm w_f/2), (-b, \\pm w_r/2)$ with $i ∈ \\{fl, fr, rl, rr\\}$. The single-track model is the special case $w_f = w_r = 0$ without lateral load transfer. Output accelerations are body-frame values as measured by an accelerometer at the CG, $a_x = \\dot{v}_x - r v_y$ and $a_y = \\dot{v}_y + r v_x$.'),
        P('"속도 고정" 조건에서는 MATLAB의 External longitudinal velocity 모드처럼 $\\dot{v}_x = 0$으로 두고 종방향 힘을 무시합니다. 이 조건은 선형 모델과 직접 비교할 때 사용합니다.',
          'With "Fixed speed", as in the MATLAB External longitudinal velocity mode, $\\dot{v}_x = 0$ and longitudinal forces are ignored. Use it for direct comparison with the linear model.'),
      ],
    },
    {
      id: 'kinematics', title: { ko: '4. 조향과 바퀴 운동학', en: '4. Steering and wheel kinematics' }, blocks: [
        EQ('δ_f = \\frac{δ_{sw}}{i_s} ,\\qquad δ_r = k_{rs} δ_f'),
        P('애커먼 기하에서 내·외측 바퀴 각은 $δ^{geo}_{in,out} = \\arctan(L/(R \\mp w_f/2))$, $R = L/\\tan|δ_f|$이며, 애커먼 비율 $A_{ck}$로 평행 조향과 보간합니다: $δ_i = |δ_f| + A_{ck}(δ^{geo}_i - |δ_f|)$.',
          'With Ackermann geometry the inner and outer wheel angles are $δ^{geo}_{in,out} = \\arctan(L/(R \\mp w_f/2))$ with $R = L/\\tan|δ_f|$; the Ackermann percentage $A_{ck}$ blends them with parallel steer: $δ_i = |δ_f| + A_{ck}(δ^{geo}_i - |δ_f|)$.'),
        P('각 바퀴 중심의 속도를 바퀴 좌표계로 옮겨 슬립각을 구합니다.', 'Wheel-centre velocities are transformed into each wheel frame to obtain the slip angles:'),
        EQ('v_{x,i} = v_x - r y_i ,\\qquad v_{y,i} = v_y + r x_i'),
        EQ('v_{xw,i} = v_{x,i} \\cos δ_i + v_{y,i} \\sin δ_i ,\\qquad v_{yw,i} = -v_{x,i} \\sin δ_i + v_{y,i} \\cos δ_i'),
        EQ('α_{ss,i} = \\arctan \\frac{v_{yw,i}}{\\max(|v_{xw,i}|, v_{tol})}'),
        P('분모의 $v_{tol}$(기본 0.5 m/s)은 MATLAB의 xdot_tol과 같은 역할로 저속 특이점을 막습니다. 절댓값을 쓰므로 후진 중에도 횡력은 접지면의 미끄럼을 거스르는 방향입니다. 이완 길이 $σ > 0$이면 슬립각은 1차 지연 상태가 됩니다.',
          'The floor $v_{tol}$ (0.5 m/s by default) plays the role of MATLAB\'s xdot_tol and removes the low-speed singularity. Because of the absolute value the lateral force still opposes the contact-patch sliding when reversing. With a relaxation length $σ > 0$ the slip angle becomes a first-order lag state:'),
        EQ('\\dot{α}_i = \\frac{\\max(|v_{w,i}|, v_{tol})}{σ} (α_{ss,i} - α_i)'),
        P('바퀴 좌표계의 타이어 힘은 다음과 같이 차체 좌표계로 변환합니다.', 'Tire forces are rotated from the wheel frame into the body frame:'),
        EQ('F_{x,i} = F_{xw,i} \\cos δ_i - F_{yw,i} \\sin δ_i ,\\qquad F_{y,i} = F_{xw,i} \\sin δ_i + F_{yw,i} \\cos δ_i'),
      ],
    },
    {
      id: 'loads', title: { ko: '5. 수직하중과 하중이동', en: '5. Normal loads and load transfer' }, blocks: [
        P('종방향 하중이동은 지면에 작용하는 타이어 종력의 피치 모멘트로, 횡방향 하중이동은 롤 모멘트를 롤 강성 배분(LLTD) $λ_f$로 전·후축에 나눈 값으로 계산합니다. 공기항력은 무게중심 높이에 작용한다고 가정합니다.',
          'Longitudinal load transfer comes from the pitch moment of the tire forces at ground level; lateral transfer splits the roll moment between the axles with the roll-stiffness distribution (LLTD) $λ_f$. Aerodynamic drag is assumed to act at CG height.'),
        EQ('F_{z,f} = \\frac{m g b - h \\bar{F}_x}{L} + ε_f F_D ,\\qquad F_{z,r} = \\frac{m g a + h \\bar{F}_x}{L} + (1 - ε_f) F_D'),
        EQ('F_{z,fl/fr} = \\frac{F_{z,f}}{2} \\mp \\frac{λ_f h \\bar{F}_y}{w_f} ,\\qquad F_{z,rl/rr} = \\frac{F_{z,r}}{2} \\mp \\frac{(1 - λ_f) h \\bar{F}_y}{w_r}'),
        P('$\\bar{F}_x, \\bar{F}_y$는 타이어 힘 합을 시정수 $τ_{LT}$로 필터링한 상태입니다. 하중→타이어 힘→가속도→하중의 대수 루프를 끊고, 롤·피치 응답의 지연을 1차로 근사합니다.',
          '$\\bar{F}_x, \\bar{F}_y$ are the tire-force sums filtered with the time constant $τ_{LT}$. This breaks the algebraic loop load → force → acceleration → load and approximates the roll/pitch response lag to first order.'),
        EQ('τ_{LT} \\dot{\\bar{F}}_x = \\sum_i F_{x,i} - \\bar{F}_x ,\\qquad τ_{LT} \\dot{\\bar{F}}_y = \\sum_i F_{y,i} - \\bar{F}_y'),
        P('$λ_f = 0.5$이면 MATLAB 이중 트랙 블록과 같습니다. 수직하중이 0 이하가 되면 0으로 제한하고 "바퀴 들림" 경고를 냅니다. 평면 모델은 전복을 표현하지 못하므로 그 이후의 결과는 유효 범위 밖입니다.',
          '$λ_f = 0.5$ reproduces the MATLAB dual-track block. Normal loads are clipped at zero and a "wheel lift-off" warning is raised: the planar model cannot represent rollover, so results beyond that point are outside its validity range.'),
      ],
    },
    {
      id: 'tire', title: { ko: '6. 타이어 모델', en: '6. Tire models' }, blocks: [
        H3('하중 민감도', 'Load sensitivity'),
        P('입력하는 축 코너링 강성 $C_{αf}, C_{αr}$은 정적 하중 $F_{z0}$에서 두 타이어 합입니다. 바퀴별 값과 최대 마찰계수는 하중에 따라 다음과 같이 변합니다($n_C = 1$, $k_μ = 0$이면 MATLAB의 비례 모델).',
          'The axle cornering stiffnesses $C_{αf}, C_{αr}$ are the sum of both tires at the static load $F_{z0}$. Per-wheel stiffness and peak friction vary with load as follows ($n_C = 1$, $k_μ = 0$ gives MATLAB\'s proportional model):'),
        EQ('C_{α,i} = C_{α0,i} \\left( \\frac{F_{z,i}}{F_{z0,i}} \\right)^{n_C} ,\\qquad μ_i = μ_{0,i} μ_{road} \\left( \\frac{F_{z,i}}{F_{z0,i}} \\right)^{-k_μ}'),
        P('$n_C < 1$이면 하중이동이 축의 등가 코너링 강성을 낮춥니다. 따라서 전축 LLTD를 높이면 언더스티어가 커지며, 안티롤바 튜닝의 효과가 재현됩니다.',
          'With $n_C < 1$ load transfer lowers the effective axle cornering stiffness, so a higher front LLTD increases understeer — the mechanism behind anti-roll-bar tuning.'),
        H3('순수 횡력', 'Pure lateral force'),
        UL(['선형: $F_{y0} = -C_α α$ (포화 없음, 검증용)', 'Linear: $F_{y0} = -C_α α$ (no saturation, for verification)'],
          ['Fiala 브러시 모델 (아래 식)', 'Fiala brush model (below)'],
          ['Magic Formula (기본): $B C D = C_α$로 원점 기울기를 코너링 강성에 맞춤', 'Magic Formula (default): $B C D = C_α$ matches the initial slope to the cornering stiffness']),
        EQ('F_{y0} = \\begin{cases} -C_α t + \\frac{C_α^2}{3 μ F_z} |t| t - \\frac{C_α^3}{27 μ^2 F_z^2} t^3 , & |t| < t_{sl} \\\\ -μ F_z \\mathrm{sgn}(α) , & |t| \\ge t_{sl} \\end{cases} \\qquad t = \\tan α ,\\; t_{sl} = \\frac{3 μ F_z}{C_α}'),
        EQ('F_{y0} = -D \\sin (C \\arctan (B α - E (B α - \\arctan B α))) ,\\qquad D = μ F_z ,\\; B = \\frac{C_α}{C D}'),
        H3('복합 슬립과 바퀴 상태', 'Combined slip and wheel states'),
        P('3DOF 모델에는 바퀴 회전 자유도가 없으므로, 종방향 힘은 구동·제동계의 요구값 $F_{x,dem}$으로 주어집니다. 타이어는 그 요구를 전달(점착), 조절(ABS/TCS), 또는 포화(잠김·휠스핀) 상태로 처리합니다.',
          'The 3DOF model has no wheel-spin degree of freedom, so the longitudinal force is a demand $F_{x,dem}$ from the driveline and brakes. The tire transmits it (adhesion), regulates it (ABS/TCS) or saturates into full sliding (lock-up, wheel spin):'),
        EQ('|F_{x,dem}| \\le μ F_z :\\quad F_x = F_{x,dem} ,\\quad F_y = F_{y0} \\sqrt{1 - (F_x/μ F_z)^2}'),
        EQ('\\text{ABS/TCS}:\\quad F_x = \\mathrm{sgn}(F_{x,dem}) η μ F_z ,\\quad F_y = F_{y0} \\sqrt{1 - η^2}'),
        EQ('\\text{lock}:\\quad (F_{xw}, F_{yw}) = -μ_s F_z \\frac{(v_{xw}, v_{yw})}{\\max(|v_w|, v_ε)}'),
        EQ('\\text{spin}:\\quad (F_{xw}, F_{yw}) = μ_s F_z \\frac{(s v_s, -v_{yw})}{\\sqrt{v_s^2 + v_{yw}^2}} ,\\quad v_s = κ_s \\max(|v_{xw}|, 1)'),
        P('$η$는 ABS·TCS의 마찰 활용률(기본 0.9), $μ_s = (μ_s/μ_p) μ$는 미끄럼 마찰, $s$는 구동 방향, $κ_s = 0.5$는 휠스핀 상태의 명목 슬립률입니다. 잠긴 바퀴는 횡력을 잃어 조향이 되지 않고, 휠스핀 중인 구동륜은 횡력이 크게 줄어 파워 오버스티어가 나타납니다.',
          '$η$ is the ABS/TCS friction utilisation (0.9 by default), $μ_s = (μ_s/μ_p) μ$ the sliding friction, $s$ the drive direction and $κ_s = 0.5$ a nominal practical slip of a spinning wheel. A locked wheel loses its lateral force (no steering), and a spinning drive wheel loses most of it (power oversteer).'),
        P('ABS는 승용차 표준 구성인 "전륜 개별 제어 + 후륜 select-low"입니다. 후륜 두 바퀴는 낮은 μ 쪽의 점착 한계로 함께 제한되어 μ-split 제동에서도 후륜 횡력이 유지됩니다. TCS가 꺼져 있으면 오픈 디퍼렌셜처럼 한쪽 바퀴가 헛돌 때 반대쪽 구동력도 그만큼으로 제한됩니다.',
          'ABS uses the standard passenger-car layout "individual front control + rear select-low": both rear wheels are held to the adhesion limit of the lower-μ side, which preserves rear lateral grip on μ-split. With TCS off the differentials are open, so a spinning wheel also limits the drive force on its partner.'),
      ],
    },
    {
      id: 'driveline', title: { ko: '7. 구동·제동·주행 저항', en: '7. Driveline, brakes and resistances' }, blocks: [
        EQ('F_t = θ \\min (F_{t,max}, P_{max}/v_x)'),
        P('구동력은 FWD/RWD 또는 AWD 배분 $ξ_f$로 축에 나누고 좌우 동일하게 전달합니다. 최고속도 제한기 근처에서는 선형으로 줄입니다. 제동력은 페달 $β_p$와 전륜 배분 $β_b$로 나누고, 주차 브레이크는 후륜에만 작용하며 ABS를 거치지 않습니다. 제동력과 구름저항 $f_r F_z$는 바퀴 회전 방향의 반대로 작용하며, 정지 근처에서는 $\\mathrm{sat}(v_{xw}/v_ε)$로 연속화합니다.',
          'The tractive force is split per axle (FWD/RWD or AWD share $ξ_f$) and equally between left and right, and tapered near the speed governor. Brake force uses the pedal $β_p$ and front bias $β_b$; the handbrake acts on the rear wheels only and bypasses ABS. Brake force and rolling resistance $f_r F_z$ oppose the wheel rolling direction and are regularised with $\\mathrm{sat}(v_{xw}/v_ε)$ near standstill.'),
        EQ('F_{a,x} = -\\frac{1}{2} ρ C_d A_f v_x |v_x| ,\\qquad F_D = -\\frac{1}{2} ρ C_l A_f v_x^2'),
        P('$C_l < 0$이면 다운포스 $F_D > 0$이 공력 배분 $ε_f$에 따라 수직하중을 늘립니다. 바람은 고려하지 않습니다.',
          'A negative lift coefficient $C_l < 0$ produces downforce $F_D > 0$, distributed by the aero balance $ε_f$. Wind is not modelled.'),
      ],
    },
    {
      id: 'linear', title: { ko: '8. 선형 단일 트랙 모델', en: '8. Linear single-track model' }, blocks: [
        P('소각도, 선형 타이어, 일정 속도 $v$를 가정하면 상태 $x = [v_y, r]$에 대한 2차 선형 시스템을 얻습니다($δ_r = k_{rs} δ_f$).',
          'Small angles, linear tires and constant speed $v$ give a second-order linear system in $x = [v_y, r]$ (with $δ_r = k_{rs} δ_f$):'),
        EQ('\\dot{v}_y = -\\frac{C_f + C_r}{m v} v_y - \\left( v + \\frac{a C_f - b C_r}{m v} \\right) r + \\frac{C_f + k_{rs} C_r}{m} δ_f'),
        EQ('\\dot{r} = -\\frac{a C_f - b C_r}{I_{zz} v} v_y - \\frac{a^2 C_f + b^2 C_r}{I_{zz} v} r + \\frac{a C_f - k_{rs} b C_r}{I_{zz}} δ_f'),
        H3('정상상태 특성', 'Steady-state characteristics'),
        EQ('δ_f = \\frac{L}{R} + K a_y ,\\qquad K = \\frac{m}{L} \\left( \\frac{b}{C_f} - \\frac{a}{C_r} \\right)'),
        EQ('\\frac{r}{δ_f} = \\frac{v}{L + K v^2} ,\\qquad v_{ch} = \\sqrt{L/K} \\; (K > 0) ,\\qquad v_{crit} = \\sqrt{-L/K} \\; (K < 0)'),
        EQ('SM = \\frac{b C_r - a C_f}{(C_f + C_r) L}'),
        P('$K$를 deg/g로 나타내면 $K \\cdot g \\cdot 180/π$입니다. 언더스티어 차량($K>0$)의 요 레이트 이득은 특성속도 $v_{ch}$에서 최대이고, 오버스티어 차량($K<0$)은 임계속도 $v_{crit}$ 이상에서 불안정합니다. 정적 여유 $SM > 0$이면 중립조향점이 무게중심 뒤에 있습니다.',
          '$K$ in deg/g is $K \\cdot g \\cdot 180/π$. For an understeering vehicle ($K>0$) the yaw-rate gain peaks at the characteristic speed $v_{ch}$; an oversteering vehicle ($K<0$) is unstable above the critical speed $v_{crit}$. A positive static margin $SM$ places the neutral-steer point behind the CG.'),
        H3('안정성과 주파수 응답', 'Stability and frequency response'),
        EQ('λ^2 - \\mathrm{tr}(A) λ + \\det(A) = 0 ,\\qquad ω_n = \\sqrt{\\det A} ,\\qquad ζ = -\\frac{\\mathrm{tr} A}{2 ω_n}'),
        EQ('G(jω) = C (jω I - A)^{-1} B + D'),
        P('조향휠각 입력 $δ_{sw} = i_s δ_f$에 대한 요 레이트, 횡가속도($a_y = \\dot{v}_y + v r$), 차체 슬립각의 전달함수를 해석적으로 계산합니다. 공진 주파수, 공진 배율, 1 Hz 위상 지연은 ISO 7401 주파수 응답 평가에서 쓰는 특성값입니다.',
          'Yaw rate, lateral acceleration ($a_y = \\dot{v}_y + v r$) and sideslip responses to the steering-wheel angle $δ_{sw} = i_s δ_f$ are evaluated in closed form. Resonance frequency, resonance ratio and phase lag at 1 Hz are the characteristic values used in ISO 7401 frequency-response evaluation.'),
      ],
    },
    {
      id: 'control', title: { ko: '9. 운전자 모델과 ESC', en: '9. Driver model and ESC' }, blocks: [
        H3('경로 추종 운전자', 'Path-following driver'),
        P('폐루프 시험(ISO 4138, ISO 3888, 슬라럼)에서는 곡률 피드포워드와 전방 주시 횡오차 피드백을 결합한 운전자 모델을 씁니다. 피드백 게인은 횡가속도 "스프링" $k_a$로 정의되어 차량 고유의 조향 감도에 맞게 자동으로 스케일됩니다.',
          'Closed-loop tests (ISO 4138, ISO 3888, slalom) use a driver that combines curvature feed-forward with look-ahead lateral-error feedback. The feedback gain is a lateral-acceleration "spring" $k_a$, so it scales with the vehicle\'s own steering sensitivity:'),
        EQ('δ_f = (L + K v^2) κ(s + v T_{ff}) - k_a \\frac{L + K v^2}{v^2} (e_y + x_{la} \\sin e_ψ) - k_i \\int e_y dt'),
        P('출력에는 1차 신경근 지연(기본 0.1 s)과 조향 속도 제한(1000 °/s)이 붙습니다. 차선 변경 경로는 시험 운전자처럼 다음 차로 쪽 경계를 따라가며, 각 차로 변경을 구간 시작보다 약간 일찍(기본 2 m) 시작합니다. 판정은 차체 네 모서리가 콘 경계선 안에 있는지로 합니다.',
          'The output passes a first-order neuromuscular lag (0.1 s) and a steering-rate limit (1000 °/s). Like a test driver, the lane-change line keeps to the lane edge nearest the next lane and starts each transition slightly early (2 m by default). The verdict checks that all four body corners stay inside the cone lines.'),
        H3('ESC', 'ESC'),
        EQ('r_{ref} = \\mathrm{clamp} \\left( \\frac{v δ_f}{L + K v^2} , \\pm \\frac{0.85 μ g}{v} \\right) ,\\qquad e = r - r_{ref}'),
        EQ('ΔM_z = -K_{ESC} I_{zz} (e - \\mathrm{sgn}(e) e_{th}) \\qquad (|e| > e_{th})'),
        P('요구 요 모멘트가 현재 요 운동과 반대이면(오버스티어) 외측 전륜을, 같은 방향이면(언더스티어) 내측 후륜을 제동합니다. 해당 바퀴가 이미 ABS 한계라면 같은 축 반대쪽 바퀴의 압력을 줄입니다. 개입 중에는 엔진 토크를 줄이고, 유압 형성은 40 ms 1차 지연으로 근사합니다. 노면 μ는 제어기가 안다고 가정합니다.',
          'If the requested yaw moment opposes the current yaw motion (oversteer) the outer front wheel is braked; otherwise (understeer) the inner rear wheel. If that wheel is already at its ABS limit, pressure is released on the opposite wheel of the same axle instead. Engine torque is cut while active and pressure build-up is a 40 ms first-order lag. The controller is assumed to know the road friction.'),
      ],
    },
    {
      id: 'tests', title: { ko: '10. 시험 절차와 평가 지표', en: '10. Test procedures and metrics' }, blocks: [
        TABLE([{ ko: '시험', en: 'Test' }, { ko: '기준', en: 'Standard' }, { ko: '입력·조건', en: 'Input and conditions' }, { ko: '평가 지표', en: 'Metrics' }], [
          [{ ko: '스텝 조향', en: 'Step steer' }, 'ISO 7401', { ko: '80 km/h, 500 °/s 스텝, $a_{y,ss} = 4$ m/s²로 진폭 보정', en: '80 km/h, 500 °/s step calibrated to $a_{y,ss} = 4$ m/s²' }, { ko: '정상 이득, 응답시간(t₅₀→90 %), 피크시간, 오버슈트, TB', en: 'Steady gains, response time (t₅₀→90 %), peak time, overshoot, TB' }],
          [{ ko: '정현파 조향', en: 'Sinusoidal steer' }, 'ISO 7401', { ko: '연속 정현파, 주파수·진폭 지정', en: 'Continuous sine of given frequency and amplitude' }, { ko: '$r, a_y, β$ 이득·위상 및 선형 모델 비교', en: 'Gain and phase of $r, a_y, β$ vs linear model' }],
          [{ ko: '사인 위드 드웰', en: 'Sine with dwell' }, 'FMVSS 126 · GTR 8', { ko: '80 km/h 타력, 0.7 Hz, 500 ms 드웰, 진폭 ≤ 6.5A·270°', en: '80 km/h coast, 0.7 Hz, 500 ms dwell, amplitude ≤ 6.5A, 270°' }, { ko: 'YRR(1.00 s) ≤ 35 %, YRR(1.75 s) ≤ 20 %, 횡변위(1.07 s) ≥ 1.83 m', en: 'YRR(1.00 s) ≤ 35 %, YRR(1.75 s) ≤ 20 %, displacement(1.07 s) ≥ 1.83 m' }],
          ['SIS', 'NHTSA', { ko: '80 km/h, 13.5 °/s 램프', en: '80 km/h, 13.5 °/s ramp' }, { ko: 'A(0.3 g, 0.1–0.375 g 회귀), $K$, 최대 $a_y$', en: 'A (0.3 g, regression 0.1–0.375 g), $K$, max $a_y$' }],
          [{ ko: '정상원 선회', en: 'Constant radius' }, 'ISO 4138', { ko: 'R 40 m, 속도 서서히 증가', en: 'R 40 m, slowly increasing speed' }, { ko: '조향 특성 선도, $K$, β 구배, 한계 $a_y$', en: 'Handling diagram, $K$, β gradient, limit $a_y$' }],
          [{ ko: '더블 레인 체인지', en: 'Double lane change' }, 'ISO 3888-1', { ko: '폭 1.1W+0.25 / 1.2W+0.25 / 1.3W+0.25 m, 오프셋 3.5 m', en: 'Widths 1.1W+0.25 / 1.2W+0.25 / 1.3W+0.25 m, offset 3.5 m' }, { ko: '경계 이탈, 최대 $a_y, r, δ_{sw}, β$', en: 'Boundary violations, max $a_y, r, δ_{sw}, β$' }],
          [{ ko: '장애물 회피', en: 'Obstacle avoidance' }, 'ISO 3888-2', { ko: '폭 1.1W+0.25 / W+1 / max(1.3W+0.25, 3) m, 오프셋 1 m, 1구간 후 타력', en: 'Widths 1.1W+0.25 / W+1 / max(1.3W+0.25, 3) m, offset 1 m, coast after section 1' }, { ko: '경계 이탈, 출구 속도', en: 'Boundary violations, exit speed' }],
          [{ ko: '직진 제동', en: 'Straight braking' }, 'ECE R13-H', { ko: '100 km/h, μ-split 선택', en: '100 km/h, optional μ-split' }, { ko: '제동거리, MFDD, 요 각·횡 편차, 잠김', en: 'Stopping distance, MFDD, yaw and lateral deviation, lock-up' }],
        ]),
        EQ('YRR_{1.0} = \\frac{r(t_{COS} + 1.0)}{r_{peak}} ,\\qquad YRR_{1.75} = \\frac{r(t_{COS} + 1.75)}{r_{peak}}'),
        EQ('d_m = \\frac{v_b^2 - v_e^2}{25.92 (s_e - s_b)} ,\\qquad v_b = 0.8 v_0 ,\\; v_e = 0.1 v_0'),
        EQ('K = \\frac{1}{i_s} \\frac{dδ_{sw}}{da_y} - \\frac{L}{v^2} \\quad (\\text{SIS}) ,\\qquad K = \\frac{1}{i_s} \\frac{dδ_{sw}}{da_y} \\quad (R = \\text{const})'),
        NOTE('ISO 3888 원문은 유료 문서이므로 공개된 구간 길이·폭 치수를 사용했습니다. 차로 오프셋(3.5 m, 1 m)의 기준 경계선은 일반적인 구현 관행(ISO 3888-1: 우측 경계 간, ISO 3888-2: 1차로 좌측–3차로 우측 경계 간)을 따른 가정입니다. FMVSS 126의 GVWR은 시험 질량으로 대신합니다.',
          'ISO 3888 is a paid standard; the published section lengths and widths are used. The reference boundary for the lane offsets (3.5 m, 1 m) follows common practice (ISO 3888-1: between the right-hand boundaries; ISO 3888-2: from lane 1 left to lane 3 right boundary) and is an assumption. FMVSS 126 GVWR is approximated by the test mass.'),
      ],
    },
    {
      id: 'numerics', title: { ko: '11. 수치 해법', en: '11. Numerical method' }, blocks: [
        P('12개 상태 $[X, Y, ψ, v_x, v_y, r, \\bar{F}_x, \\bar{F}_y, α_{fl}, α_{fr}, α_{rl}, α_{rr}]$를 고정 간격 4차 Runge–Kutta로 적분합니다. 제어 입력은 각 간격 동안 일정(zero-order hold)하며, 운전자 모델·ESC는 간격마다 한 번 갱신됩니다. 기본 간격 1 ms에서 이완 길이 시정수 $σ/v$와 저속 횡 감쇠 시정수가 RK4 안정 영역 안에 있습니다.',
          'The twelve states $[X, Y, ψ, v_x, v_y, r, \\bar{F}_x, \\bar{F}_y, α_{fl}, α_{fr}, α_{rl}, α_{rr}]$ are integrated with fixed-step fourth-order Runge–Kutta. Inputs are held constant over each step (zero-order hold); the driver model and ESC update once per step. At the default 1 ms step the relaxation time constant $σ/v$ and the low-speed lateral damping stay inside the RK4 stability region.'),
        EQ('x_{n+1} = x_n + \\frac{h}{6} (k_1 + 2 k_2 + 2 k_3 + k_4)'),
        P('출력은 지정한 샘플링(기본 100 Hz)으로 저장하며, 저장 시점에 모델을 다시 평가해 타이어 힘·하중 등 보조 출력을 상태와 일치시킵니다. 실시간 주행도 같은 1 kHz 적분을 사용합니다.',
          'Outputs are stored at the chosen rate (100 Hz by default); the model is re-evaluated at each stored sample so that auxiliary outputs (tire forces, loads) match the state. The driving simulator uses the same 1 kHz integration.'),
      ],
    },
    {
      id: 'validation', title: { ko: '12. 검증', en: '12. Verification' }, blocks: [
        P('`tests/run.js`는 의존성 없이 Node.js로 실행되는 검증 묶음입니다(`npm test`). 현재 판에서 모두 통과합니다.',
          '`tests/run.js` is a dependency-free verification suite run with Node.js (`npm test`). All checks pass in this release.'),
        TABLE([{ ko: '검증 항목', en: 'Check' }, { ko: '허용 오차', en: 'Tolerance' }], [
          [{ ko: '비선형 단일 트랙(선형 타이어, 속도 고정) vs 선형 해석해: 정상 요 레이트·횡가속도', en: 'Nonlinear single track (linear tires, fixed speed) vs closed-form steady yaw rate and $a_y$' }, '0.3 %'],
          [{ ko: '스텝 응답 시간 이력 vs 선형 모델', en: 'Step-response time history vs linear model' }, { ko: '정규화 RMS 1 %', en: 'normalised RMS 1 %' }],
          [{ ko: '이중 트랙($n_C = 1$, LLTD 50 %) = 단일 트랙 (MATLAB 3DOF 등가성)', en: 'Dual track ($n_C = 1$, LLTD 50 %) = single track (MATLAB 3DOF equivalence)' }, '1 %'],
          [{ ko: '정상 선회 운동학 $a_y = v r$', en: 'Steady cornering kinematics $a_y = v r$' }, '0.2 %'],
          [{ ko: 'MF 원점 기울기 = $C_α$, MF·Fiala 최대 횡력 = $μ F_z$', en: 'MF initial slope = $C_α$; MF and Fiala peak = $μ F_z$' }, '0.01 %'],
          [{ ko: '선형 FRF($ω→0$) = 정상 이득, 이득 최대점 = $v_{ch}$, $v_{crit}$ 전후 안정성 전환', en: 'Linear FRF($ω→0$) = steady gain; gain maximum at $v_{ch}$; stability change across $v_{crit}$' }, '1 %'],
          [{ ko: '타력 감속 = 항력 + 구름저항, ABS 제동 MFDD ≈ $η μ g$', en: 'Coast-down = drag + rolling resistance; ABS MFDD ≈ $η μ g$' }, '1 % / 0.88–0.95 g'],
          [{ ko: '좌우 대칭성, SIS 언더스티어 구배 vs 선형 이론', en: 'Left/right symmetry; SIS understeer gradient vs linear theory' }, '0.15 deg/g'],
          [{ ko: 'FMVSS 126: ESC 장착 세단 합격, ESC 없는 오버스티어 차량 불합격', en: 'FMVSS 126: sedan with ESC passes, oversteering car without ESC fails' }, '—'],
          [{ ko: 'μ-split 제동(ABS·ESC) 요 각 편차 < 20°, 바퀴 들림 경고, 입력 파서 방어', en: 'μ-split braking (ABS, ESC) heading deviation < 20°; wheel-lift warning; parser hardening' }, '—'],
        ]),
        P('외부 데이터와의 정량 검증(실차 시험, 상용 소프트웨어 비교)은 포함되어 있지 않습니다. 실무 적용 전 대상 차량의 측정값으로 코너링 강성·관성·LLTD를 보정하십시오.',
          'Quantitative validation against external data (vehicle tests, commercial software) is not included. Calibrate cornering stiffness, inertia and LLTD with measurements of the target vehicle before engineering use.'),
      ],
    },
    {
      id: 'limits', title: { ko: '13. 적용 범위와 한계', en: '13. Scope and limitations' }, blocks: [
        UL(
          ['롤·피치·바운스 자유도가 없습니다. 하중이동은 준정적이며 1차 지연으로 근사합니다.', 'No roll, pitch or bounce degrees of freedom; load transfer is quasi-static with a first-order lag.'],
          ['바퀴 회전 자유도가 없습니다. 잠김·휠스핀은 준정적 상태로 표현하며 ABS·TCS의 제어 주기는 모델링하지 않습니다.', 'No wheel-spin dynamics; lock-up and spin are quasi-static states and ABS/TCS control cycles are not modelled.'],
          ['서스펜션 기구학, 컴플라이언스 스티어, 캠버, 셀프 얼라이닝 토크, 조향 반력은 등가 코너링 강성에 포함된 것으로 봅니다.', 'Suspension kinematics, compliance steer, camber, aligning moment and steering feel are lumped into the effective cornering stiffness.'],
          ['노면은 평탄하며 경사·뱅크·바람은 없습니다. 전복은 표현하지 못하고 바퀴 들림 경고만 냅니다.', 'Flat road without grade, bank or wind. Rollover is not represented; only a wheel-lift warning is raised.'],
          ['운전자 모델은 재현성 있는 비교를 위한 것이며 인간 운전자의 한계 성능을 대표하지 않습니다.', 'The driver model aims at repeatable comparisons and does not represent the limit performance of a human driver.'],
          ['프리셋은 대표값이며 특정 양산 차량의 데이터가 아닙니다.', 'Presets are representative values, not data of specific production vehicles.'],
        ),
      ],
    },
    {
      id: 'matlab', title: { ko: '14. MATLAB Vehicle Body 3DOF와의 대응', en: '14. Mapping to MATLAB Vehicle Body 3DOF' }, blocks: [
        TABLE([{ ko: '이 프로그램', en: 'This app' }, { ko: 'MATLAB 블록 매개변수', en: 'MATLAB block parameter' }, { ko: '비고', en: 'Notes' }], [
          ['$m, I_{zz}, a, b, h$', 'Mass, Izz, a, b, h', '—'],
          ['$w_f, w_r$', 'w (track width)', '—'],
          ['$C_{αf}/2, C_{αr}/2$', 'Cy_f, Cy_r', { ko: '바퀴당 값, 정적 하중을 Fznom으로', en: 'per wheel, use the static load as Fznom' }],
          ['$σ$', 'sigma_f, sigma_r', '—'],
          ['$C_d, C_l, A_f, ρ$', 'Cd, Cl, Af, Pabs·Tair', { ko: '공기 밀도는 직접 입력', en: 'air density is entered directly' }],
          ['$v_{tol}$', 'xdot_tol', '0.5 m/s'],
          [{ ko: '속도 고정 조건', en: 'Fixed-speed mode' }, 'External longitudinal velocity', '$\\dot{v}_x = 0$'],
        ]),
        P('MATLAB 이중 트랙과 같은 결과를 얻으려면 타이어 모델 "선형", $n_C = 1$, $k_μ = 0$, 전축 LLTD 50 %로 두십시오. 기본 설정은 여기에 타이어 포화, 하중 민감도, 복합 슬립, 전자 제어를 더한 확장 모델입니다. [차량 제원]의 MATLAB 내보내기는 위 대응에 따른 `.m` 스크립트를 생성합니다.',
          'To reproduce the MATLAB dual-track block set the tire model to "Linear", $n_C = 1$, $k_μ = 0$ and front LLTD to 50 %. The default configuration extends it with tire saturation, load sensitivity, combined slip and electronic assists. The MATLAB export in [Vehicle] writes a `.m` script following this mapping.'),
      ],
    },
    {
      id: 'refs', title: { ko: '15. 참고문헌', en: '15. References' }, blocks: [
        { refs: [
          'MathWorks, Vehicle Dynamics Blockset — Vehicle Body 3DOF / Vehicle Body 3DOF Longitudinal, product documentation.',
          'R. Rajamani, Vehicle Dynamics and Control, 2nd ed., Springer, 2012.',
          'H. B. Pacejka, Tire and Vehicle Dynamics, 3rd ed., Butterworth-Heinemann, 2012.',
          'T. D. Gillespie, Fundamentals of Vehicle Dynamics, SAE International, 1992.',
          'W. F. Milliken, D. L. Milliken, Race Car Vehicle Dynamics, SAE International, 1995.',
          'M. Abe, Vehicle Handling Dynamics, 2nd ed., Butterworth-Heinemann, 2015.',
          'E. Fiala, Seitenkräfte am rollenden Luftreifen, VDI-Zeitschrift 96, 1954.',
          'C. C. MacAdam, Application of an optimal preview control for simulation of closed-loop automobile driving, IEEE Trans. Systems, Man, and Cybernetics, 11(6), 1981.',
          'ISO 8855, Road vehicles — Vehicle dynamics and road-holding ability — Vocabulary.',
          'ISO 7401, Road vehicles — Lateral transient response test methods — Open-loop test methods.',
          'ISO 4138, Passenger cars — Steady-state circular driving behaviour — Open-loop test methods.',
          'ISO 3888-1, Passenger cars — Test track for a severe lane-change manoeuvre — Part 1: Double lane-change.',
          'ISO 3888-2, Passenger cars — Test track for a severe lane-change manoeuvre — Part 2: Obstacle avoidance.',
          'U.S. NHTSA, FMVSS No. 126, Electronic stability control systems (49 CFR 571.126); UN GTR No. 8.',
          'UNECE Regulation No. 13-H, Braking of passenger cars (definition of MFDD).',
        ] },
      ],
    },
    {
      id: 'symbols', title: { ko: '16. 기호표', en: '16. Nomenclature' }, blocks: [
        TABLE([{ ko: '기호', en: 'Symbol' }, { ko: '의미', en: 'Meaning' }, { ko: '단위', en: 'Unit' }], [
          ['$m, I_{zz}$', { ko: '질량, 요 관성 모멘트', en: 'mass, yaw moment of inertia' }, 'kg, kg·m²'],
          ['$a, b, L$', { ko: 'CG–전축, CG–후축 거리, 휠베이스', en: 'CG to front/rear axle, wheelbase' }, 'm'],
          ['$w_f, w_r, h$', { ko: '전·후 윤거, 무게중심 높이', en: 'front/rear track, CG height' }, 'm'],
          ['$v_x, v_y, r$', { ko: '종·횡 속도, 요 레이트', en: 'longitudinal/lateral velocity, yaw rate' }, 'm/s, rad/s'],
          ['$β, ψ$', { ko: '차체 슬립각, 요 각', en: 'body sideslip, heading' }, 'rad'],
          ['$δ_{sw}, δ_f, δ_r, i_s$', { ko: '조향휠각, 전·후륜 조향각, 조향 기어비', en: 'steering-wheel, front/rear road-wheel angle, steering ratio' }, 'rad, –'],
          ['$α_i, F_{z,i}$', { ko: '슬립각, 수직하중', en: 'slip angle, normal load' }, 'rad, N'],
          ['$C_{αf}, C_{αr}$', { ko: '축 코너링 강성 (정적 하중)', en: 'axle cornering stiffness (static load)' }, 'N/rad'],
          ['$μ, μ_s/μ_p$', { ko: '최대 마찰계수, 미끄럼/최대 비', en: 'peak friction, sliding-to-peak ratio' }, '–'],
          ['$B, C, D, E$', { ko: 'Magic Formula 계수', en: 'Magic Formula coefficients' }, '–'],
          ['$λ_f, τ_{LT}$', { ko: '전축 횡하중이동 분담률, 하중이동 시정수', en: 'front lateral load-transfer share, load-transfer time constant' }, '–, s'],
          ['$K, v_{ch}, v_{crit}$', { ko: '언더스티어 구배, 특성·임계 속도', en: 'understeer gradient, characteristic/critical speed' }, 'rad/(m/s²), m/s'],
          ['$ω_n, ζ$', { ko: '요 고유진동수, 감쇠비', en: 'yaw natural frequency, damping ratio' }, 'rad/s, –'],
        ]),
      ],
    },
  ];

  // ---------------------------------------------------------------------------
  // Figure: dual-track model (original artwork)
  // ---------------------------------------------------------------------------
  function dualTrackFigure() {
    const W = 760, H = 370;
    const sv = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Dual-track vehicle model', style: 'width:100%;height:auto;display:block;max-width:760px;margin:0 auto' });
    const col = { ink: 'var(--ink)', ink2: 'var(--ink-2)', ink3: 'var(--ink-3)', acc: 'var(--accent)', f: 'var(--series-2)', body: 'var(--surface-2)', line: 'var(--line-strong)' };
    const cx = 370, cy = 182, k = 92;               // CG position, px per metre (schematic, not to scale)
    const a = 1.4, b = 1.65, wf = 1.9, wr = 1.9, delta = 16 * Math.PI / 180;
    const X = (x) => cx + x * k, Y = (y) => cy - y * k;
    const add = (tag, attrs) => { const e = s(tag, attrs); sv.appendChild(e); return e; };
    const text = (x, y, str, o) => {
      const t = add('text', Object.assign({ x, y, 'font-size': 15, fill: col.ink2, 'font-family': 'var(--font-sans)' }, o || {}));
      const m = /^([A-Za-zαβδψλ]+)_(.*)$/.exec(str);
      if (m) { t.appendChild(s('tspan', { 'font-style': 'italic', text: m[1] })); t.appendChild(s('tspan', { 'baseline-shift': 'sub', 'font-size': 11, text: m[2] })); }
      else t.appendChild(s('tspan', { 'font-style': o && o['font-style'] === 'normal' ? 'normal' : 'italic', text: str }));
      return t;
    };
    const arrow = (x1, y1, x2, y2, color, w) => {
      add('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': w || 2 });
      const ang = Math.atan2(y2 - y1, x2 - x1), hl = 9;
      add('path', { d: `M${x2},${y2} L${x2 - hl * Math.cos(ang - 0.4)},${y2 - hl * Math.sin(ang - 0.4)} L${x2 - hl * Math.cos(ang + 0.4)},${y2 - hl * Math.sin(ang + 0.4)} Z`, fill: color });
    };
    // body, axles
    add('rect', { x: X(-b - 0.55), y: Y(1.2), width: (a + b + 1.15) * k, height: 2.4 * k, rx: 18, fill: col.body, stroke: col.line, 'stroke-width': 1.5 });
    add('line', { x1: X(a), y1: Y(wf / 2), x2: X(a), y2: Y(-wf / 2), stroke: col.line, 'stroke-width': 1.5 });
    add('line', { x1: X(-b), y1: Y(wr / 2), x2: X(-b), y2: Y(-wr / 2), stroke: col.line, 'stroke-width': 1.5 });
    // wheels and their force arrows (positive directions: Fx along the wheel, Fy to its left)
    const wheels = [
      { x: a, y: wf / 2, d: delta, n: 'fl', fx: [6, -8], fy: [-44, -2] }, { x: a, y: -wf / 2, d: delta, n: 'fr', fx: [6, 18], fy: [8, 8] },
      { x: -b, y: wr / 2, d: 0, n: 'rl', fx: [6, -8], fy: [-44, -2] }, { x: -b, y: -wr / 2, d: 0, n: 'rr', fx: [6, 18], fy: [8, 8] },
    ];
    for (const w of wheels) {
      const g = s('g', { transform: `translate(${X(w.x)},${Y(w.y)}) rotate(${(-w.d * 180) / Math.PI})` });
      g.appendChild(s('rect', { x: -0.33 * k, y: -0.11 * k, width: 0.66 * k, height: 0.22 * k, rx: 3, fill: col.ink2 }));
      if (w.d) g.appendChild(s('line', { x1: -0.6 * k, y1: 0, x2: 0.95 * k, y2: 0, stroke: col.ink3, 'stroke-dasharray': '4 3' }));
      sv.appendChild(g);
      const c = Math.cos(w.d), sn = Math.sin(w.d);
      const px = X(w.x), py = Y(w.y);
      const fxL = 0.85 * k, fyL = 0.55 * k;
      arrow(px, py, px + fxL * c, py - fxL * sn, col.f, 2.2);
      arrow(px, py, px - fyL * sn, py - fyL * c, col.f, 2.2);
      text(px + fxL * c + w.fx[0], py - fxL * sn + w.fx[1], `F_x,${w.n}`);
      text(px - fyL * sn + w.fy[0], py - fyL * c + w.fy[1], `F_y,${w.n}`);
    }
    // steer angle on the front-left wheel
    const fx = X(a), fy = Y(wf / 2), R0 = 0.72 * k;
    add('path', { d: `M${fx + R0},${fy} A${R0},${R0} 0 0,0 ${fx + R0 * Math.cos(delta)},${fy - R0 * Math.sin(delta)}`, fill: 'none', stroke: col.ink2 });
    add('line', { x1: fx, y1: fy, x2: fx + 0.95 * k, y2: fy, stroke: col.ink3, 'stroke-dasharray': '2 3' });
    text(fx + R0 + 6, fy - 2, 'δ_fl');
    // CG, axes, velocity, sideslip, yaw rate
    arrow(X(0), Y(0), X(0.8), Y(0), col.acc, 1.8);
    arrow(X(0), Y(0), X(0), Y(0.7), col.acc, 1.8);
    text(X(0.8) - 4, Y(0) + 20, 'x', { fill: col.acc });
    text(X(0) - 16, Y(0.7) + 6, 'y', { fill: col.acc });
    const beta = 0.32, vlen = 1.05;
    arrow(X(0), Y(0), X(vlen * Math.cos(beta)), Y(vlen * Math.sin(beta)), col.ink, 1.8);
    text(X(vlen * Math.cos(beta)) + 6, Y(vlen * Math.sin(beta)) + 2, 'v');
    const rb = 0.55 * k;
    add('path', { d: `M${X(0) + rb},${Y(0)} A${rb},${rb} 0 0,0 ${X(0) + rb * Math.cos(beta)},${Y(0) - rb * Math.sin(beta)}`, fill: 'none', stroke: col.ink });
    text(X(0) + rb + 5, Y(0) - 4, 'β');
    const rr = 0.36 * k;
    add('path', { d: `M${X(0) - rr},${Y(0) + 4} A${rr},${rr} 0 1,0 ${X(0) + 2},${Y(0) + rr}`, fill: 'none', stroke: col.ink, 'stroke-width': 1.5 });
    add('path', { d: `M${X(0) - rr - 5},${Y(0)} l5,7 l5,-7 z`, fill: col.ink });
    text(X(0) - rr - 20, Y(0) + 4, 'r');
    add('circle', { cx: X(0), cy: Y(0), r: 6, fill: col.ink });
    text(X(0) - 34, Y(0) - 12, 'CG', { 'font-style': 'normal' });
    // dimensions
    const dimY = Y(-1.2) + 26;
    const hdim = (x1, x2, label) => {
      arrow((x1 + x2) / 2, dimY, x1, dimY, col.ink3, 1); arrow((x1 + x2) / 2, dimY, x2, dimY, col.ink3, 1);
      text((x1 + x2) / 2 - 5, dimY - 7, label, { fill: col.ink3 });
    };
    hdim(X(-b), X(0), 'b'); hdim(X(0), X(a), 'a');
    const vdim = (x, y1, y2, label, left) => {
      arrow(x, (y1 + y2) / 2, x, y1, col.ink3, 1); arrow(x, (y1 + y2) / 2, x, y2, col.ink3, 1);
      text(left ? x - 30 : x + 8, (y1 + y2) / 2 + 5, label, { fill: col.ink3 });
    };
    vdim(X(a + 0.55) + 26, Y(wf / 2), Y(-wf / 2), 'w_f');
    vdim(X(-b - 0.55) - 22, Y(wr / 2), Y(-wr / 2), 'w_r', true);
    return sv;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function renderBlock(b) {
    if (b.p) return h('p', null, itx(b.p));
    if (b.h3) return h('h3', null, tx(b.h3));
    if (b.eq) return h('div', { class: 'eq' }, VD.mathml.tex(b.eq, true));
    if (b.note) return h('p', { class: 'callout' }, itx(b.note));
    if (b.ul) return h('ul', null, b.ul.map((it) => h('li', null, itx(it))));
    if (b.refs) return h('ol', { class: 'refs' }, b.refs.map((r) => h('li', null, r)));
    if (b.table) {
      return h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, b.table.head.map((c) => h('th', null, tx(c))))),
        h('tbody', null, b.table.rows.map((r) => h('tr', null, r.map((c) => h('td', null, cell(c))))))));
    }
    if (b.fig) return h('figure', null, b.fig === 'dualtrack' ? dualTrackFigure() : null, h('figcaption', null, itx(b.cap)));
    return null;
  }

  function mount(el) {
    el.classList.add('theory');
    const tocLinks = [];
    const toc = h('nav', { class: 'toc', 'aria-label': 'Contents' }, h('ol', null, SECTIONS.map((sec) => {
      const a = h('a', { href: '#theory', 'data-id': sec.id }, tx(sec.title));
      a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById('doc-' + sec.id).scrollIntoView({ block: 'start' }); });
      tocLinks.push(a);
      return h('li', null, a);
    })));
    const doc = h('article', { class: 'doc' },
      h('h1', null, tx('모델 이론과 사용 설명', 'Model theory and reference')),
      h('p', { class: 'lead' }, tx('평면 3DOF 차량 동역학 모델의 수식, 가정, 시험 절차, 검증과 한계',
        'Equations, assumptions, test procedures, verification and limitations of the planar 3DOF vehicle model')),
      SECTIONS.map((sec) => h('section', { id: 'doc-' + sec.id }, h('h2', null, tx(sec.title)), sec.blocks.map(renderBlock))),
      h('p', { class: 'muted', style: { marginTop: '40px', fontSize: 'var(--fs-sm)' } },
        `Vehicle Dynamics Workbench ${VD.version} · MIT License`));
    const scroller = h('div', { class: 'main', style: { padding: 0 } }, doc);
    el.append(h('div', { class: 'sidebar toc-wrap' }, toc), scroller);
    // highlight the section in view
    const obs = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) {
        const id = en.target.id.slice(4);
        tocLinks.forEach((a) => a.classList.toggle('on', a.dataset.id === id));
      }
    }, { root: scroller, rootMargin: '0px 0px -75% 0px' });
    SECTIONS.forEach((sec) => obs.observe(document.getElementById('doc-' + sec.id)));
  }

  VD.views = VD.views || {};
  VD.views.theory = { mount, SECTIONS };
})(globalThis.VD = globalThis.VD || {});
