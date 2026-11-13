## Why

Building a small test rig for the 90° gears showed three places where putting parts exactly where they belong is harder than it should be:

- Turning a part held by a row of pins (a corner connector's pegs in a beam) a half turn doesn't leave the pins in their holes, because the ring turns about a point on the half-pitch grid, not about the row.
- A marked hole only helps parts clicked in the library (and beams). A part already in the scene can't be sent to it: double-clicking it joins it to whatever it happens to line up with.
- A pin that should join two parts goes into one and misses the other by a fraction of a millimetre (0.64 mm and 0.9° in the rig: a motor tilted on its shaft and a beam left 0.58 mm off along another shaft). The app refuses without saying why, and nothing lines the parts up without risking a gear mesh.

## What Changes

- **Half turn about a row of pins.** A part held on two or more parallel joint lines that lie in one row turns about the line along that row, at the middle of where the pins sit in their holes, so a 180° turn puts every pin back in its hole.
- **Double-click a scene part into the marked hole.** With a hole or pin end marked, double-clicking a part (or tapping Join with it selected) puts it into the mark at its best fit, with the wheel bar for other fits. This comes before mating with whatever it lines up with.
- **Pins line up the part they nearly reach.** When a pin, peg or shaft goes in and another hole is nearly on its line (within 1 mm and 3°), the app moves a part so both holes line up, as Fix assembly does. A meshed gear never moves: the part that moves is one that can, a loose block or a block that slides along or turns around the shaft it's on. When nothing can move, a message names the part that's out and by how much.
- **A Smart Motor sits square on its shaft.** The motor body stays put; the shaft and what's fixed on it turn into the socket, unless the shaft is held elsewhere or carries a meshed gear (then a message says why).
- **Gears snap into mesh and show it.** 90° gears placed within 3 mm of meshing slide along their shafts into mesh, and selecting a gear outlines the gears it meshes with.
- Dropped from the request: stamping with Ctrl+double-click on a Mac (Ctrl+click is a right-click there; Cmd+double-click and the Stamp copies button work).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `rotate-mode`: "When rotation is refused" changes for parts held in a row: their rings turn about the row's line at the pins' depth.
- `pin-mating`: "Double-click mates in the only direction" puts the part into the marked hole first when one is marked.
- `context-toolbar`: "Join" does the same with a mark set.
- `fix-assembly`: "Lining up and seating" never moves a meshed gear and can slide a block along its shaft; new requirements for lining up after a pin goes in and for keeping a motor square on its shaft (the shaft turns into the motor; the motor body stays).
- `gear-meshing`: 90° gears within 3 mm of meshing slide into mesh along their shafts when placed; gears meshed with the selected gear are outlined green (near misses amber).

## Impact

- `src/components/Viewport3D.jsx`: rotate setup (row pivot and ring), double-click and Join with a target, the insert paths (mate, pick, target, copy) calling the line-up.
- `src/engine/fixAssembly.js`: mesh-safe moves, sliding along a shaft, motor squaring, a near-pair line-up entry point usable after an insert.
- `src/utils/placementFit.js`: squaring a motor when it goes onto a shaft.
- `src/utils/gearMeshing.js`: used to find meshed gears (no change expected).
- Checks: `scripts/check-fix-assembly.mjs`, `scripts/check-pin-hole-alignment.mjs`, and a new rotate-pivot case; features.md.
- All of it runs in the browser; nothing needs a server.
- Depends on the target from the open `target-hole-placement` change (Alt+click / Mark a hole), which is already built.
