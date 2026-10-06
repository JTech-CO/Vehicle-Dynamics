# Changelog

## 1.0.0 (2026-10-06)

First release. Merges the two legacy programs (`legacy/`) into one static application.

- Nonlinear planar 3DOF vehicle model (dual/single track) following MathWorks Vehicle Body 3DOF, with Magic Formula / Fiala / linear tires, load sensitivity, LLTD-based load transfer, combined slip, ABS (rear select-low), TCS, ESC, driveline, brakes and aerodynamics
- Eleven test procedures: ISO 7401 step and sine, FMVSS 126 sine with dwell, NHTSA SIS, ISO 4138 constant radius, ISO 3888-1/-2, slalom, braking (μ-split), acceleration, custom steering table
- Linear analysis: steady-state gains, Bode plots, root locus, natural frequency and damping, step response
- Real-time driving simulator with keyboard/gamepad/touch input, test courses, telemetry and recording
- Multi-run comparison, parameter sweeps, CSV/JSON/PNG/MATLAB export, run import
- Bilingual (Korean/English) interface, light/dark themes, in-app theory documentation with MathML
- Dependency-free verification suite (`npm test`, 27 checks) and GitHub Actions workflow
- README assets generated from the physics core (`npm run docs`): eight result charts in light/dark themes, preset benchmark table, local SVG badges
