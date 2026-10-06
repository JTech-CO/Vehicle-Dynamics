# Verification

The physics core (`src/core/`) has no DOM dependency and loads unchanged in Node.js. `tests/run.js` is a dependency-free suite:

```bash
npm test          # or: node tests/run.js
```

## Checks

| # | Check | Criterion |
| --- | --- | --- |
| 1 | Magic Formula initial slope equals the cornering stiffness | 0.01 % |
| 2 | Magic Formula and Fiala peak force equal μ·Fz | 0.01 % |
| 3 | Lateral force opposes contact-patch sliding while reversing | sign |
| 4 | Longitudinal demand reduces lateral force; resultant within μ·Fz | friction ellipse |
| 5 | Nonlinear single track (linear tires, fixed speed) vs closed-form steady yaw rate and lateral acceleration | 0.3 % |
| 6 | Step-response time history vs linear model | normalised RMS 1 % |
| 7 | Dual track with proportional load sensitivity equals single track (MATLAB 3DOF equivalence) | 1 % |
| 8 | Load sensitivity with front-biased LLTD increases understeer | ordering |
| 9 | Steady cornering kinematics a_y = v·r | 0.2 % |
| 10 | Left/right steering gives mirrored responses | 1e-6 relative |
| 11 | Linear FRF at ω → 0 equals the steady-state gain | 1e-6 relative |
| 12 | Linear yaw-rate gain peaks at the characteristic speed | 1 % |
| 13 | Oversteering vehicle changes from stable to unstable across v_crit | eigenvalue sign |
| 14 | Coast-down deceleration equals drag + rolling resistance | 1 % |
| 15 | ABS straight braking MFDD ≈ η·μ·g | 0.88 to 0.95 g |
| 16 | Without ABS hard braking locks the wheels | lock state |
| 17 | μ-split braking yaws toward the high-μ side | sign |
| 18 | FMVSS 126: sedan with ESC passes | verdict |
| 19 | FMVSS 126: oversteering car without ESC fails | verdict |
| 20 | SIS understeer gradient vs linear theory at low a_y | 0.15 deg/g |
| 21 | μ-split braking with ABS (rear select-low) and ESC stays controllable | ψ < 20°, stop < 80 m |
| 22 | ISO 3888-1 lane widths and track length | exact |
| 23 | Closed-loop: sedan passes ISO 3888-1 at 80 km/h | verdict |
| 24 | Rollover-prone vehicle reports wheel lift on the skid pad | warning |
| 25 | Parameter sanitiser clamps values and drops unknown keys | - |
| 26 | Steering-table parser rejects malformed input | - |
| 27 | Every test procedure runs on every preset without diverging | finite states |

## Scope of verification

These checks establish internal consistency (against closed-form linear theory and physical limits) and the correctness of the evaluation logic. They do not replace validation against vehicle measurements or commercial simulation tools. Before engineering use, calibrate cornering stiffness, yaw inertia, roll-stiffness distribution and tire shape with measurements of the target vehicle, and compare a step-steer and a constant-radius test with measured data.
