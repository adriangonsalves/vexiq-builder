## Why

Builders want to test how well their VEX IQ robot holds together under a real-world drop or collision before building it physically. Right now Play mode treats any two-pin joint as infinitely strong, so a heavy subassembly cantilevered on two short `1x1` pins appears just as sturdy as one braced with long `2x2` pins, standoffs, or capped pins, or captured in a double-shear clevis.

## What Changes

- Add fastener pullout strength metadata (`pulloutN`) to Play mode's seated joint analysis (`playInputs` and `buildBodyGraph`), distinguishing **Rubber Shaft Collars** (~8 N friction slip threshold), short `1x1` connector pins and integral pegs (~20 N axial pullout force, with full engagement at `2.4 mm` for integral pegs and `5.0 mm` for discrete pins), longer `1x2`/`2x2`/`3x` pins and standoffs (~35–40 N pullout force), and capped pins (~80 N in the cap-stopped direction, ~20 N uncapped), scaled by engagement depth (`overlapMm`).
- Preserve the part-level fastener network (`pinJoints`, including `isCollar` friction collars while excluding free-spinning round-bore axle hinges) and square-shaft fitted pairs (`shaftPairs`) in `buildBodyGraph` so `physics.js` can evaluate directional joint loads, pop off rubber shaft collars (and slide wheels off axles when their retaining collars fail), and re-partition bodies.
- Add a **Drop / Crash Simulator** to Play mode's Rapier physics engine (`src/sim/physics.js`) that drops the whole robot from a configurable height (`0.15 m` to `1.5 m`) onto the floor with ABS plastic + tire impact compliance ($\Delta t \approx 14\text{ ms}$, restitution $\approx 0.26$), nonlinear tire/frame hard-stop bottoming-out above `0.45 m`, and damped elastic flex oscillation.
- Model directional joint mechanics during floor impact:
  - **Axial pullout vs. radial shear**: Horizontal pins carry vertical drop forces primarily in radial shear against the solid ABS pin wall rather than axial pullout.
  - **Vertical compression vs. hanging tension**: Subassemblies resting *on top of* vertical pins or standoffs are pushed into axial compression against the standoff/beam shoulder during primary impact, whereas subassemblies hanging *below* vertical pins experience direct axial pullout tension.
  - **Clevis / double-shear capture vs. single-sided cantilevers**: Subassemblies captured between left and right plates (`axialSpan > 20 mm`), multi-axis joints, or 3+ pin bridges across multiple parts resist prying and axial slide-out, while single-sided 2-pin lap-jointed cantilevers experience flexural plate whip.
  - **Free hinge rotation & multi-hinge load sharing**: Hinged mechanisms (such as a 4-bar arm/wrist) rotate freely about their hinge axis so in-plane torque does not pry the pin out, and parallel hinges supporting the same child body share the load across all supporting hinge pins.
- Dynamically split the body graph when pins pop out (across up to 3 cascade passes): any part or subassembly that loses all its pins detaches into a free-falling, bouncing dynamic rigid body, and any subassembly reduced to a single pin line becomes a hinged body that swings under gravity.
- Add **Drop test** controls to `PlayPanel` (drop height presets from `15 cm` to `1.5 m`, **Drop** button, **Reset** button, and crash summary showing popped pins, detached parts, and peak joint force, with viewport highlighting on hover).

## Capabilities

### New Capabilities

### Modified Capabilities
- `play-mode`: Add requirements for Drop / Crash testing in Play mode, fastener-specific pullout thresholds (~20 N for short pins/integral pegs, ~35–40 N for longer pins/standoffs, ~80 N for capped pins), ABS impact compliance, directional axial/shear/compression/clevis joint mechanics, dynamic joint breakage/part detachment, and crash reporting/reset in the Play panel.

## Impact

- `src/engine/core.js`: Compute fastener pullout force (`pulloutN`) and engagement depth (`overlapMm`) in `playInputs`.
- `src/sim/bodyGraph.js`: Expose breakable pin joint records (`pinJoints`) and square-shaft bonds (`shaftPairs`).
- `src/sim/physics.js` & `src/sim/playRunner.js`: Implement `drop(heightMeters)` and `resetDrop()`, whole-robot free-fall and floor impact with ABS flex, directional axial/shear/compression/clevis/hinge force evaluation, dynamic part detachment into independent rigid bodies, and `dropReport` status.
- `src/components/PlayPanel.jsx` & `src/App.jsx`: Add Drop test height controls, Drop/Reset buttons, crash summary, and broken/detached part highlighting.
- `scripts/check-play-mode.mjs`: Add automated verification for `1x1` vs `2x2` pin pullout, Clawbot survival at `0.15 m` and `0.30 m` drops, and pin pop-out / part detachment at `1.2 m` table drops.
