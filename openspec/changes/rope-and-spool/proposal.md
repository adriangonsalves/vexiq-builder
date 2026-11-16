## Why

The library has five ropes (12x, 20x, 24x, 48x and 120x Pitch Rope), two spools (1x Wide and 2x Wide) and the .5x Pitch Idler Pulley, but a rope is only a straight, stiff stick. It can't be run from one part to another, wound on a spool or passed over a pulley, and in Play mode it does nothing. The Ratchet winch starter shows the gap: its spool turns, holds and releases, but the 24x Pitch Rope beside it sticks straight up and pulls nothing. The ratchet-and-pawl change left "rope that winds and pulls" as its own change. This is it.

Two VEX Hero Bots use rope in the two ways robots use it (both measured from VEX's CAD, see design.md):

- **Winding (Swish, 2024-2025).** One 24x Pitch Rope. One end tab sits in a pocket in the end of the 2x Wide Spool, held by the winch's shaft passing through the tab's hole. The cord leaves through the spool's flange and runs about 220 mm up to the catapult arm, where the other end tab sits on the arm's 3x Pitch Motor Shaft. The winch winds the rope to pull the arm down against its rubber bands, the ratchet holds it, and the release lets it fire.
- **Lifting (Huey, 2025-2026).** Two 24x Pitch Ropes, one each side, and no spool. Each runs from a pin on the claw carriage, up over a .5x Pitch Idler Pulley on the lift's middle stage, and down to a pin on the fixed stage. The motor raises the middle stage by rack gears; the rope makes the carriage rise twice as far.

Today the CAD import places Swish's and Huey's ropes as straight sticks through other parts and leaves out the pieces VEX drew bent.

## What Changes

- **Ropes become routed parts.** A rope copy carries its route: where each end is held, the spots it passes between, and how much of it is wound on a spool. It is drawn as a thin cord along that route with its two end tabs. A rope with no route stays the straight rope it is today.
- **Rope ends.** Each end tab's hole goes on a pin, a standoff or a shaft, or into a spool's pocket on the spool's shaft. An end may also be left free; the rope then hangs from its last spot.
- **Spots between the ends:** pulley grooves (the idler pulley and the 10 to 40 mm pulleys), standoffs, pin shanks, shaft ends, beam edges and a spool's drum. These are the same spots rubber bands use, plus the two spool spots.
- **Any number of pulleys, on any parts.** One rope can pass as many pulleys, posts and edges as the builder taps, in order, on as many different parts of the robot as needed, including the same pulley twice. That covers a single lift pulley (Huey), a rope led round corners to a far-off arm, and a block and tackle that trades distance for force.
- **Spools get real data:** a square bore so a shaft drives them, the pocket that holds a rope end, and the drum the rope winds on (how wide, how thick, how many turns fit).
- **Tools → Rope builder**, built like the Band builder: pick a rope length (or **Choose for me**), tap where the first end goes, tap any pulleys or parts it passes, tap where the other end goes. A see-through rope shows the route after every tap. The panel shows the rope's length, how much the route uses and how much is spare.
- **Winding in the build.** Spare rope goes onto the spool by itself. The panel has one stepper, **Turns on spool**, and one switch for which way it winds (**Over** / **Under**).
- **Rope too short or slack.** A rope shorter than its route is refused with the length that fits. Spare rope with no spool hangs as slack and the panel says how much.
- **Editing.** A selected rope shows a handle at each end and each spot. The Inspector shows length, spare, turns and direction. Flatten takes it off its route. A rope follows its parts when they move.
- **Mirror, duplicate, save and history** carry ropes, as they carry bands.
- **Play mode:**
  - A rope pulls only when it is tight, and doesn't stretch.
  - A spool winds rope on and off as it turns. The coils are drawn. The rope's pull turns the spool back, so a ratchet has something to hold and a release has something to let go.
  - A rope pulls on every part it is connected to: the part holding each end, the part carrying each pulley, post or edge it bends round, and its spool. The pull is the same all along the rope, and each part is pulled along the directions the rope leaves it. So a middle stage that rises lifts Huey's carriage twice as far, a pulley on an arm drags that arm, and a block and tackle with four runs lifts with a quarter of the pull.
  - A part held to the robot only by a rope (a lift carriage, a hook) hangs on it instead of being listed as loose.
  - Ropes are redrawn every frame.
- **MCP:** a new `place_rope` tool, and `get_assembly` / `get_part_details` report a rope's route, spare length and turns.
- **CAD import:** the pieces VEX draws for one rope (the straight library rope, a bent piece, a loose end tab) are joined into one routed rope. The report lists each rope's ends, spots, spare length and turns. Swish and Huey are the test robots.
- **Ratchet winch starter:** its rope is held in the spool's pocket and wound, with its other end free, ready to be tied to a build.
- **Help, features.md and AGENTS.md** gain rope pages and notes.

Out of scope:
- Knots, rope tied round a part, and rope cut to length. VEX IQ ropes have fixed lengths and moulded end tabs.
- Rope friction on pulleys and posts, and pulleys spinning as rope passes over them.
- Rope colliding with parts in Play mode. A rope touches only the spots on its route.
- Belts driving pulleys, which the rubber-bands change left for later.
- Smart cables and the Cable Anchor.

## Capabilities

### New Capabilities
- `rope-routing`: placing, routing, winding, editing and drawing ropes. Covers rope and spool parts, rope ends and spots, the route and its length, winding on a spool, the Rope builder, editing, following parts, mirror and duplicate, saving, the audit and the `place_rope` MCP tool.

### Modified Capabilities
- `play-mode`: ropes pull when tight, on every part they touch (ends, pulleys, posts, edges and the spool), with one pull along the whole rope; spools wind them; bodies held only by a rope hang on it; and ropes are redrawn as parts move.
- `cad-import`: ropes drawn in VEX's CAD are imported as routed ropes instead of straight sticks and left-out pieces.

## Impact

- **Depends on two changes still open:** `rubber-bands` (spots, the path solver, the Band builder's picking, band pull in Play) and `ratchet-and-pawl` (the winch that holds and releases). This change builds on their code as it stands; neither needs to be archived first.
- `scripts/measure-part-geometry.mjs`, `scripts/convert-parts.mjs`, `public/catalog.json`, `public/part-metadata.json`: spool bore, pocket and drum; rope length, cord and tab sizes; the stray port on four rope parts; the 20x rope's off-centre origin; the idler pulley's groove.
- New `src/utils/ropePath.js` (rope sizes, ends, spool spots, length and winding), `src/utils/ropeShape.js` (the `rope` shape kind), `src/utils/ropeRoute.js` (stringing a rope on a build, following parts), `src/engine/ropeRouting.js` (`place_rope`). They reuse `bandPath.js`, `bandStrand.js` and `bandHull.js` for spots and for the way round parts.
- `src/utils/shapedParts.js`: register the `rope` kind. `src/utils/bandSpotTable.js` / `bandPath.js`: spool drum and pocket spots.
- `src/engine/actions.js`, `src/engine/core.js`, `src/engine/fixAssembly.js`: the rope action, following parts, and the audit (a rope end on a pin is held; coils on a drum aren't an overlap).
- `src/components/Viewport3D.jsx`, new `RopeBuilderPanel.jsx`, `ToolsMenu.jsx`, `SetInspector.jsx`, `src/help/controls.js`.
- `src/sim/bodyGraph.js`, `src/sim/physics.js`, `src/sim/playRunner.js`, `src/sim/kinematic.js`, new `src/sim/ropeStrength.js`.
- `mcp/vexiq-mcp-server.mjs`, `src/utils/webMcpTools.js`: `place_rope`.
- `scripts/import-cad.mjs`, `scripts/cad-meshes.mjs`, `public/cad-frames.json`: rope pieces and joining them.
- `src/starters/assemblies/ratchet-winch.js`, `scripts/make-ratchet-template.mjs`.
- New `scripts/check-ropes.mjs` with fixtures `scripts/fixtures/swish-rope.json` and `huey-lift.json`; additions to `check-play-mode.mjs`, `check-mcp-tools.mjs`, `check-cad-import.mjs` and `check-starter-assemblies.mjs`.
- Help pages (`src/help/pages/`), `coverage.json`, pictures; `features.md`; a line in `AGENTS.md`.
- **Who builds this:** design.md is written to be followed step by step. It names the functions to reuse, the data each new piece stores, the sums for winding and for the rope's pull, the test rigs with the numbers they must reach, and the order of work.
- Everything runs in the browser. No server part, no new dependencies. Builds saved before this change open unchanged: a rope with no route stays straight.
