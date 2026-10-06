# Model reference

This document summarises the equations implemented in `src/core/`. The in-app **Theory** tab contains the same material in Korean and English with rendered equations and a figure.

## 1. Frames and signs

ISO 8855: vehicle frame at the centre of gravity (CG) with $x$ forward, $y$ left, $z$ up. Yaw rate $r$, steer angle $\delta$ and sideslip $\beta$ are positive counter-clockwise (left turn). Earth frame $X, Y$, heading $\psi$. Slip angle as in MATLAB *Vehicle Body 3DOF*: $\alpha = \arctan(v_{yw}/|v_{xw}|)$, so $F_y \approx -C_\alpha \alpha$.

## 2. Equations of motion (`model.js`)

$$m(\dot v_x - r v_y) = \sum_i F_{x,i} + F_{a,x}$$

$$m(\dot v_y + r v_x) = \sum_i F_{y,i}$$

$$I_{zz}\dot r = \sum_i (x_i F_{y,i} - y_i F_{x,i})$$

$$\dot X = v_x\cos\psi - v_y\sin\psi,\quad \dot Y = v_x\sin\psi + v_y\cos\psi,\quad \dot\psi = r$$

Wheel positions $(x_i, y_i) = (a, \pm w_f/2), (-b, \pm w_r/2)$. The single-track variant uses $w_f = w_r = 0$ and no lateral load transfer. *Fixed speed* sets $\dot v_x = 0$ (MATLAB "External longitudinal velocity").

State vector (12): $[X, Y, \psi, v_x, v_y, r, \bar F_x, \bar F_y, \alpha_{fl}, \alpha_{fr}, \alpha_{rl}, \alpha_{rr}]$.

## 3. Steering and wheel kinematics

$\delta_f = \delta_{sw}/i_s$, $\delta_r = k_{rs}\delta_f$. Ackermann: $\delta^{geo}_{in,out} = \arctan(L/(R \mp w_f/2))$, $R = L/\tan|\delta_f|$, blended with parallel steer by $A_{ck}$.

$$v_{x,i} = v_x - r y_i,\qquad v_{y,i} = v_y + r x_i$$

$$v_{xw,i} = v_{x,i}\cos\delta_i + v_{y,i}\sin\delta_i,\qquad v_{yw,i} = -v_{x,i}\sin\delta_i + v_{y,i}\cos\delta_i$$

$$\alpha_{ss,i} = \arctan\frac{v_{yw,i}}{\max(|v_{xw,i}|, v_{tol})},\qquad \dot\alpha_i = \frac{\max(|v_{w,i}|, v_{tol})}{\sigma}(\alpha_{ss,i} - \alpha_i)$$

## 4. Normal loads

$$F_{z,f} = \frac{m g b - h\bar F_x}{L} + \varepsilon_f F_D,\qquad F_{z,r} = \frac{m g a + h\bar F_x}{L} + (1-\varepsilon_f)F_D$$

$$F_{z,fl/fr} = \frac{F_{z,f}}{2} \mp \frac{\lambda_f h\bar F_y}{w_f},\qquad F_{z,rl/rr} = \frac{F_{z,r}}{2} \mp \frac{(1-\lambda_f) h\bar F_y}{w_r}$$

$$\tau_{LT}\dot{\bar F}_x = \sum_i F_{x,i} - \bar F_x,\qquad \tau_{LT}\dot{\bar F}_y = \sum_i F_{y,i} - \bar F_y$$

$\lambda_f = 0.5$ reproduces the MATLAB dual-track block. Loads are clipped at zero and a wheel-lift warning is issued.

## 5. Tires (`tire.js`)

Load sensitivity: $C_{\alpha,i} = C_{\alpha0,i}(F_{z,i}/F_{z0,i})^{n_C}$, $\mu_i = \mu_{0,i}\mu_{road}(F_{z,i}/F_{z0,i})^{-k_\mu}$, where $C_{\alpha0} = C_{\alpha f}/2$ or $C_{\alpha r}/2$ at the static wheel load $F_{z0}$.

Pure lateral force:
- Linear: $F_{y0} = -C_\alpha\alpha$
- Fiala: $F_{y0} = -C_\alpha t + \frac{C_\alpha^2}{3\mu F_z}|t|t - \frac{C_\alpha^3}{27\mu^2F_z^2}t^3$ for $|t| < 3\mu F_z/C_\alpha$, else $-\mu F_z\,\mathrm{sgn}\,\alpha$, with $t = \tan\alpha$
- Magic Formula: $F_{y0} = -D\sin(C\arctan(B\alpha - E(B\alpha - \arctan B\alpha)))$, $D = \mu F_z$, $B = C_\alpha/(CD)$

Combined slip with a longitudinal demand $F_{x,dem}$ (no wheel-spin state):
- adhesion $|F_{x,dem}| \le \mu F_z$: $F_x = F_{x,dem}$, $F_y = F_{y0}\sqrt{1 - (F_x/\mu F_z)^2}$
- ABS/TCS regulation: $F_x = \mathrm{sgn}(F_{x,dem})\,\eta\mu F_z$, $F_y = F_{y0}\sqrt{1-\eta^2}$
- lock-up: force $-\mu_s F_z\,\mathbf v_w/\max(|\mathbf v_w|, v_\varepsilon)$
- wheel spin: force $\mu_s F_z\,(s v_s, -v_{yw})/\sqrt{v_s^2 + v_{yw}^2}$, $v_s = \kappa_s\max(|v_{xw}|, 1)$

ABS is "individual front + rear select-low". With TCS off the differentials behave as open differentials.

## 6. Driveline, brakes, resistances

$F_t = \theta\min(F_{t,max}, P_{max}/v_x)$ split by drive layout; brake force by pedal and front bias; handbrake on the rear only (bypasses ABS); rolling resistance $f_r F_z$; aerodynamic drag $F_{a,x} = -\tfrac12\rho C_d A_f v_x|v_x|$ and downforce $F_D = -\tfrac12\rho C_l A_f v_x^2$.

## 7. Linear single-track model (`linear.js`)

$$\dot v_y = -\frac{C_f + C_r}{m v}v_y - \left(v + \frac{aC_f - bC_r}{mv}\right)r + \frac{C_f + k_{rs}C_r}{m}\delta_f$$

$$\dot r = -\frac{aC_f - bC_r}{I_{zz}v}v_y - \frac{a^2C_f + b^2C_r}{I_{zz}v}r + \frac{aC_f - k_{rs}bC_r}{I_{zz}}\delta_f$$

$$K = \frac{m}{L}\left(\frac{b}{C_f} - \frac{a}{C_r}\right),\quad \frac{r}{\delta_f}\Big|_{ss} = \frac{v}{L + Kv^2},\quad v_{ch} = \sqrt{L/K},\quad v_{crit} = \sqrt{-L/K},\quad SM = \frac{bC_r - aC_f}{(C_f + C_r)L}$$

Eigenvalues from $\lambda^2 - \mathrm{tr}(A)\lambda + \det A = 0$; frequency response $G(j\omega) = C(j\omega I - A)^{-1}B + D$ for yaw rate, lateral acceleration and sideslip per steering-wheel angle.

## 8. Driver model and ESC (`control.js`)

Path following: $\delta_f = (L + Kv^2)\kappa(s + vT_{ff}) - k_a\frac{L + Kv^2}{v^2}(e_y + x_{la}\sin e_\psi) - k_i\int e_y\,dt$, followed by a 0.1 s first-order lag and a 1000 °/s rate limit.

ESC: $r_{ref} = \mathrm{clamp}(v\delta_f/(L + Kv^2), \pm 0.85\mu g/v)$, $\Delta M_z = -K_{ESC}I_{zz}(e - \mathrm{sgn}(e)e_{th})$ when $|e| = |r - r_{ref}| > e_{th}$. Oversteer → outer front wheel braked, understeer → inner rear; if the wheel is at its ABS limit the opposite wheel of the axle is released instead. Engine torque is cut while active.

## 9. Test procedures (`maneuvers.js`)

| Test | Standard | Key settings | Metrics |
| --- | --- | --- | --- |
| Step steer | ISO 7401 | 80 km/h, 500 °/s, SWA calibrated to $a_{y,ss}$ = 4 m/s² | steady gains, response time (t₅₀→90 %), peak time, overshoot, TB |
| Sinusoidal | ISO 7401 | continuous sine | gain/phase of $r, a_y, \beta$ vs linear model |
| Sine with dwell | FMVSS 126 / GTR 8 | 80 km/h coast, 0.7 Hz, 500 ms dwell, ≤ 6.5A, ≤ 270° | YRR(1.00 s) ≤ 35 %, YRR(1.75 s) ≤ 20 %, displacement(1.07 s) ≥ 1.83 m |
| SIS | NHTSA | 80 km/h, 13.5 °/s | A at 0.3 g (regression 0.1–0.375 g), $K$ |
| Constant radius | ISO 4138 | R 40 m, speed ramp | handling diagram, $K$, β gradient, limit $a_y$ |
| Double lane change | ISO 3888-1 | widths 1.1W+0.25 / 1.2W+0.25 / 1.3W+0.25 m, offset 3.5 m | boundary violations |
| Obstacle avoidance | ISO 3888-2 | widths 1.1W+0.25 / W+1 / max(1.3W+0.25, 3) m, offset 1 m | boundary violations |
| Slalom | — | 18 m cone pitch | cone contacts |
| Braking | ECE R13-H | 100 km/h, optional μ-split | stopping distance, MFDD, yaw deviation |
| Acceleration | — | full throttle | 0–100 km/h |
| Custom | — | steering table | generic maxima |

Assumptions: the ISO 3888 offset reference boundaries follow common practice (3888-1: between right-hand boundaries; 3888-2: lane 1 left to lane 3 right); FMVSS 126 GVWR is approximated by the test mass.

## 10. Numerics (`sim.js`)

Fixed-step RK4 (default 1 ms) with zero-order hold on inputs; driver model and ESC update once per step; outputs stored at 100 Hz by default and re-evaluated at each stored sample. Brake and rolling-resistance forces are regularised with $\mathrm{sat}(v_{xw}/v_\varepsilon)$ near standstill; the slip-angle denominator is floored at $v_{tol}$.

## 11. Mapping to MATLAB Vehicle Body 3DOF

| This app | MATLAB parameter |
| --- | --- |
| `m`, `Izz`, `a`, `b`, `h` | Mass, Izz, a, b, h |
| `wf`, `wr` | track width w |
| `Cf/2`, `Cr/2` | Cy_f, Cy_r (per wheel; use the static wheel load as Fznom) |
| `sigma` | sigma_f, sigma_r |
| `Cd`, `Cl`, `Af`, `rho` | Cd, Cl, Af, Pabs/Tair |
| `vTol` (0.5 m/s) | xdot_tol |

To reproduce the MATLAB block: tire model *Linear*, `nC = 1`, `kMu = 0`, front LLTD 50 %.
