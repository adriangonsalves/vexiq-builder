## Why

VEX IQ Hybrid Gears turn a drive through 90° by meshing with each other, as well as meshing side by side like spur gears. Hero Bot Swish's intake works this way: the intake motor's 24 Tooth Hybrid Gear drives a 12 Tooth Hybrid Gear at a right angle, which turns the roller through a chain. The 90° gear work (archived `2026-11-13-right-angle-gears`) only covers bevel, crown and worm gears, so the app treats the two hybrid gears as parts in each other's way: Swish's intake can't turn in Play mode, and a builder can't put two hybrid gears in mesh at 90° except by eye.

## What Changes

- **Measured hybrid teeth.** The part data records each hybrid gear's extended teeth: on every hybrid gear the teeth carry on about 3 mm past one face (the +z face), with a sloped top, and that face is the one that meshes at 90°. Measured from the models for the 12, 24, 36, 48 and 60 Tooth Hybrid Gears and the 8, 16 and 24 Tooth High Strength Hybrid Gears. Hybrid gears still mesh side by side as spur gears, as today.
- **A fourth 90° pair: hybrid with hybrid.** Two hybrid gears of the same tooth size (both standard, or both high strength) mesh at 90° when their shafts cross, both extended faces point at the crossing, and each gear's pitch circle passes through the other's extended teeth. Any tooth counts pair (24 with 12 on Swish).
- **The same tools as the other 90° pairs:** a hybrid gear placed on a shaft in mesh range turns so its teeth fit; a loose hybrid gear jumps into mesh beside another (drag, double-click the partner, Join); `mesh_right_angle` lists and places the spots; the audit reports the pair as meshed, not overlapping.
- **Play mode turns them** by their tooth counts, the speed ratio and direction worked out from the meshing maths as for the other 90° pairs.
- **Swish's intake turns.** With its intake motor running, the roller turns in Play mode. This is the check the change is done against.

Not in this change:
- a hybrid gear meshing at 90° with a plain spur gear, a crown gear or a bevel gear;
- a standard hybrid gear with a high strength one (different tooth sizes);
- hybrid gears meshing at angles other than 90°.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `right-angle-gears`: the measured tooth data covers the hybrid gears' extended teeth; "Which gears mesh at 90°" gains the hybrid-with-hybrid pair; placing, mesh spots, the loose-gear jump, joining, the mesh report and `mesh_right_angle` cover it.
- `play-mode`: "Gears and chains link by tooth ratio" also covers hybrid gears meshed at 90°.

## Impact

- **Part data:** `scripts/measure-part-geometry.mjs` (new hybrid face measurement), `scripts/index-part-metadata.mjs`, then `public/catalog.json` and `public/part-metadata.json` regenerated with `npm run index-metadata`. Hybrid gears keep `gearType: 'spur'`; the 90° data is added beside it.
- **Meshing maths:** `src/utils/gearMeshing.js` (pair rule, contact point, tooth phase, mesh spots).
- **Engine, assistant and app:** `src/engine/core.js` (mesh list, audit, `mesh_right_angle`), `mcp/vexiq-mcp-server.mjs` and `src/utils/webMcpTools.js` (tool text), `src/utils/placementFit.js` and `src/components/Viewport3D.jsx` only if their guards need the new pair.
- **Play mode:** `src/sim/bodyGraph.js` (the new mesh kind as a link).
- **Checks and docs:** `scripts/check-right-angle-gears.mjs`, `scripts/check-play-mode.mjs` (Swish's intake), the gears Help page (`src/help/pages/gears.md`) and its coverage, and the "Gears at 90°" line in `AGENTS.md`.
- Everything runs in the browser; nothing needs a server. No new dependencies.
