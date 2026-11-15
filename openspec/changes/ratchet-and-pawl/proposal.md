## Why

The library has the 16 Tooth Ratchet, the 40 Tooth Ratchet and the Short Low-Profile Pawl, but the app treats them as plain shapes: nothing helps a builder seat a pawl on a ratchet, the audit says nothing about them, and in Play mode a ratchet turns both ways. Hero Bot Swish (VEX's 2024-2025 robot) is built round one: its winch can't be shown working today.

How Swish uses it (read from VEX's CAD, `Catapult Winch`):
- Two Smart Motors turn a shaft with two 36 Tooth Gears.
- A small arm made of two 3x4 Plates swings freely on that shaft. It carries a second shaft with two 36 Tooth Gears (always in mesh with the motor's gears) and a 16 Tooth Ratchet between them.
- A Short Low-Profile Pawl is pinned to the arm by one pin and pulled onto the ratchet by a silicone belt, so the second shaft can turn only one way relative to the arm.
- Motors forward: the second shaft spins freely under the pawl, the arm swings down, and its gears drop into mesh with the 36 Tooth Gears on the spool's shaft. The spool winds.
- Motors stopped: the load tries to turn the spool back, the pawl catches, and the tooth forces push the arm further into mesh, so the winch holds.
- Motors reversed: the pawl has locked the second shaft to the arm, so the whole arm turns with the motor shaft, its gears lift out of mesh, and the spool is free. That is the release.

## What Changes

- **Measured teeth for ratchets and the pawl.** The part data records each ratchet's tooth count, tooth size, which way its teeth lean, and the pawl's tip, measured from the models.
- **A rule for when a pawl holds a ratchet,** and which way the ratchet can still turn. A pawl facing the wrong way (the teeth would push it off) is recognised and reported.
- **Set pawl (Tools menu).** With a pawl selected, the builder double-clicks a ratchet (or uses Tools → Set pawl, or the Join button on a tablet). The pawl jumps to a spot where one of its holes lines up with a hole on a nearby part and its tip rests in the teeth. The pin and the band are added afterwards.
- **A pawl placed by hand swings onto its ratchet.** A pawl put on a pin next to a ratchet turns about that pin until its tip rests on the teeth, the way gears turn to mesh today.
- **An arrow shows which way the ratchet turns** while the pawl or ratchet is selected.
- **The audit lists each ratchet and pawl:** which way it holds, a pawl facing the wrong way, a pawl held by two pins (it can't lift, so the ratchet is locked), and a pawl with nothing pressing it onto the teeth.
- **Play mode runs ratchets.** The ratchet turns one way and the pawl rides over the teeth; the other way it catches. If what holds the pawl can move, it is carried along. A pawl lifted clear of the teeth lets go.
- **Play mode runs the Swish release.** Gears on a swinging arm roll round the gear on the arm's pivot shaft, and gears that swing together come into mesh and drive each other, then let go when they swing apart.
- **The assistant gets a `set_pawl` tool** that lists the spots and places the pawl.

Not in this change:
- The winch rope. The 24x Pitch Rope stays a rigid shape, so the spool turns but doesn't pull the catapult arm down, and releasing it doesn't fire the arm. Rope that winds and pulls is its own change.
- Running Play mode from the assistant's tools.
- Ratchets driving gears by their teeth (ratchet teeth only take pawls).

## Capabilities

### New Capabilities
- `ratchet-pawl`: measured data for ratchets and the pawl, the rule for when a pawl holds a ratchet and which way, setting a pawl on a ratchet (in the app and for the assistant), the direction arrow, and what the audit reports.

### Modified Capabilities
- `play-mode`: adds ratchets that turn one way, gears carried on a swinging arm, and gears that come into and out of mesh while playing.

## Impact

- **Part data:** `scripts/measure-part-geometry.mjs`, `scripts/index-part-metadata.mjs`, then `public/catalog.json` and `public/part-metadata.json` regenerated with `npm run index-metadata`.
- **Rules:** a new `src/utils/ratchetPawl.js`; `src/utils/placementFit.js` (swinging a placed pawl); `src/utils/auditIssues.js` and `src/engine/core.js` (audit lines, the new tool, pawl contact not counted as an overlap).
- **App:** `src/components/ToolsMenu.jsx`, `src/components/Viewport3D.jsx` (double-click on a ratchet, the arrow), `src/utils/contextToolbarItems.js` (Join for a pawl).
- **Assistant:** `mcp/vexiq-mcp-server.mjs`, `src/utils/webMcpTools.js`.
- **Play mode:** `src/sim/bodyGraph.js`, `src/sim/physics.js`, `src/sim/kinematic.js`, `src/sim/playRunner.js`, `src/components/PlayPanel.jsx` (entry list).
- **Checks and docs:** a new `scripts/check-ratchet-pawl.mjs` with a Swish winch fixture, additions to `scripts/check-play-mode.mjs` and `scripts/check-mcp-tools.mjs`, Help pages (`gears.md`, `play-mode.md`, coverage, pictures), `features.md`, and a line in `AGENTS.md`.
- Everything runs in the browser; nothing needs a server. No new dependencies.
