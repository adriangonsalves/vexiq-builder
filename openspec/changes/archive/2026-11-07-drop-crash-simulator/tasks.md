## 1. Fastener Pullout Metadata & Body Graph Pin Network

- [x] 1.1 Update `playInputs` in `src/engine/core.js` to compute and include `pulloutN` (20 N for short `1x1` pins and integral pegs with `2.4 mm` full-depth threshold, 35–40 N for longer `1x2`/`2x2`/`3x` pins and standoffs, 80 N for capped pins on the cap side, scaled by `overlapMm`) on each `seated` entry and `pulloutN` on `parts`; verify via `node scripts/check-play-mode.mjs`.
- [x] 1.2 Update `buildBodyGraph` in `src/sim/bodyGraph.js` to emit `pinJoints` (`[{ id, a, b, pinIds, axis, point, pulloutN }]`, excluding round-bore shaft joins) and `shaftPairs` (`[[shaftId, memberId]]` for square-shaft fits) preserving the part-level fastener network inside merged rigid bodies; verify in `node scripts/check-play-mode.mjs`.

## 2. Drop & Crash Physics Engine

- [x] 2.1 Implement `drop(heightMeters)` and `resetDrop()` in `src/sim/physics.js` (and expose them on `src/sim/playRunner.js`): move the floor collider to a dedicated ground body, lift the robot by `heightMeters` with a slight drop tilt, let all robot bodies fall under gravity with ABS restitution, and restore poses on `resetDrop()`; verify in `node scripts/check-play-mode.mjs`.
- [x] 2.2 Implement ABS impact compliance ($\Delta t = 14\text{ ms}$), directional per-pin force evaluation (axial tension vs. radial shear, vertical compression vs. hanging tension, clevis/boxed capture vs. single-sided cantilever whip, free hinge rotation, and multi-hinge load sharing), cascade pin breakage, and dynamic body splitting in `src/sim/physics.js` so parts whose pins exceed `pulloutN` detach into independent dynamic bodies (or single-pin hinges) while square-shaft assemblies stay bonded; verify with `1x1` vs `2x2` pin tests and Clawbot `0.15 m` / `0.30 m` survival vs. `1.2 m` detachment in `node scripts/check-play-mode.mjs`.

## 3. Play Panel UI & Verification

- [x] 3.1 Add **Drop test** controls to `src/components/PlayPanel.jsx` and wire them in `src/App.jsx` (drop height selector, **Drop** button, **Reset** button, crash summary badge/list, and hover highlighting of detached parts); verify that all `node scripts/check-*.mjs` checks pass.
