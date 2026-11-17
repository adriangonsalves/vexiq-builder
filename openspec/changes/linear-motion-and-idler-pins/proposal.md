## Why

Hero Bot Huey (2025-26) is in the Robots starters, but in Play mode its lift doesn't move and its back wheels don't turn. Two kinds of joint that real VEX IQ builds use are not understood by the app:

- **Linear motion parts.** Huey's lift is a 1x18 Beam with 1x6 Continuous Linear Motion Rack Gears snapped onto it, sliding through 2x Pitch Linear Motion Brackets pinned to the fixed stage, and driven by 12 Tooth Gears on the racks. The rack has no pin holes (it clips onto the beam), and the bracket holds the beam without a pin (the beam slides in its channel). The app joins parts only by pins, pegs and shafts, so it lists the racks as unsecured, sees the moving stage as loose, and the lift motor drives nothing.
- **Idler pins.** Each side of Huey's drive reaches its back wheel through a 36 Tooth and a 48 Tooth Gear that spin on 0x2 Idler Pins in their square centre holes. The app seats a pin only in a round hole, so those gears count as held by nothing and the gear train stops there.

## What Changes

- **A rack clipped onto a beam is joined to it.** A Continuous Linear Motion Rack Gear lying along a 1x-wide beam, in the seat it clips into, is fixed to that beam: held in the audit, one body with the beam in Play.
- **A beam in a Linear Motion Bracket slides.** A beam (with or without a rack on it) lying in the channel of a 2x Pitch Linear Motion Bracket (Side Mount) or a 1x Pitch Linear Motion Bracket (Snap) is held by the bracket and free to move along the channel only. The audit counts it as held and says it slides. In Play it is a slide between the two bodies, stopping where parts meet at either end.
- **A gear drives a rack on a sliding body.** In Play, a gear meshed with a rack moves the body the rack is on along its slide, by the rack's travel per turn. Today a rack moves only when nothing but its gear holds it.
- **An idler pin holds a gear and lets it turn.** The smooth end of an idler pin (0x2, 0x3, 1x1, 1x2, weak and smooth kinds) in the centre hole of a gear, sprocket, pulley or wheel holds that part: held in the audit, a turning joint in Play, so gear trains run through idler gears.
- **Huey** is the test robot: its four racks are held, its lift motor raises and lowers the Middle Stage between its stops, and all four wheels turn.
- **Help pages are left out of this change** on the owner's request; a task lists them as held back.

Not in this change:
- New tools for placing linear motion parts (pushing a rack onto a beam, or a bracket onto a beam, with one tap). Parts placed by hand, by MCP poses or by CAD import are recognised where they sit. Listed as a follow-up.
- The Claw Mount sliding in its rails on the Middle Stage and hanging on its ropes (openspec rope-and-spool tasks 7.5, 8.2 to 8.4). That is built after this change, on the lift this change makes move.
- The older Rack Gear (228-2500-216) in its Linear Slide (228-2500-217), unless it falls out of the same rule at no extra cost.

## Capabilities

### New Capabilities
- `linear-motion`: racks clipped onto beams, beams sliding in linear motion brackets, and how the audit reports them.
- `idler-pins`: an idler pin holding a gear, sprocket, pulley or wheel by its centre hole, free to turn.

### Modified Capabilities
- `play-mode`: slides between bodies from linear motion brackets, gears driving racks on sliding bodies, and parts turning on idler pins.

## Impact

- Part data: `scripts/measure-part-geometry.mjs` and `scripts/index-part-metadata.mjs` measure the rack's clip seat and each bracket's channel into `public/part-metadata.json` / `public/catalog.json` (the two brackets, the continuous rack, and the idler pins' smooth ends).
- Engine: `src/engine/core.js` (joints found for the audit and for Play: `seatedPairs`, unsecured parts, islands, `playInputs`), `src/utils/pinHoleAlignment.js` (what a pin end can sit in).
- Play: `src/sim/bodyGraph.js` (bodies, hinges, sliders, rack links), `src/sim/physics.js` (the slide joint and its stops, the rack drive), `src/sim/kinematic.js` (the no-physics fallback).
- Audit wording: `src/utils/auditIssues.js`; MCP replies in `mcp/vexiq-mcp-server.mjs` (`audit_assembly`, `get_part_details`).
- Checks: a new `scripts/check-linear-motion.mjs`; additions to `check-play-mode.mjs`, `check-audit-issues.mjs`, `check-starter-assemblies.mjs` and `check-gear-meshing.mjs`. The Huey starter (`src/starters/huey.js`) is the fixture.
- Everything runs in the browser; nothing needs a server.
