# Follow-ups

Low-priority items left open when a change was closed. Pick one up by proposing a change (`/opsx:propose`) or folding it into a related one.

## From outliner-part-groups (archived 2026-10-29)

1. **Select Connected uses the audit's clamp rule.** A part squeezed between two parts that are fastened to each other counts as joined, so one Shift+wheel layer from a lock beam also takes the tire, hub and collar, not only its pins. The multi-select spec says parts that only touch don't count. Decide whether expanding by layers should leave clamp joins out (they would then only come in through Select Connected).
2. **Toolbar wraps at about 1500 px** with advanced options on (the MCP badge plus the Select menu button).
3. **Shift+click (3D view) and Ctrl/Cmd+click (Outliner) still add or remove parts outside Select mode.** Outliner checkboxes and plain-click toggling are Select-mode only. Decide whether modifier keys should be Select-mode only too.
4. **Quick 90° turns (Inspector) and MCP `update_group` turns aren't put back when they end overlapping**; only ring turns are (rotate-mode "Overlaps and saving"). Inspector set moves (nudges, typed centre) also don't save overlap flags.
5. **Box select also picks parts hidden behind others** (like most CAD tools). Decide whether it should take only visible parts.
6. **Clawbot build:** the Claw group sits 0.58 mm too deep in the Wrist 4x4 Plate along X, and Wrist Chassis Corner R is 0.338 mm low in Y (its pegs miss the plate's holes). Fix: move Claw +0.58 mm in X; set Corner R y to 158.75. The group-snapping change stops this kind of drift for new moves.
7. **`explode-view` spec still names a toolbar button that moved into the Tools menu:** ~~`app-settings` lists "Audit & Blueprint" (and an Explode drop-down) as toolbar items (Audit is now a panel that slides up in the 3D view and Blueprint its own dialog, both in the Tools menu), and~~ (done in context-toolbar) `explode-view` "Opening and closing the Explode panel" says "the toolbar's Explode button". It is now Tools → Explode (ticked while open, shortcut `X`); update the requirement the next time that spec changes.

## From context-toolbar (in progress 2026-11-11)

1. **A left-hand side for the context bar on tablets and desktop:** a setting, kept in the browser, that puts the bar on the left edge for left-handed builders (a phone already puts it there; on bigger screens the Explode, Play and band panels live there, so they would have to move).
2. **Dragging a part from the library into the view by touch:** still mouse only (`startLibraryDrag` returns early for touch). By touch today: Mark a hole, then tap the part in the library.
3. **Choosing the working half in Stereo by touch:** the working half follows the hover only.
4. **Pinch and pan in the 4-View small views** by touch.
5. ~~**Thumb wheel direction vs. the mouse wheel:** the spec says dragging the bar's wheel up is the same as turning the mouse wheel away from you, and its scenario says dragging up goes from fit 1 to fit 3. In the view, turning the mouse wheel away steps fits and band spots *back* (and turns rings and grows layers *forward*), so both can't hold for fits. The bar's wheel goes up = next in every session; the mouse wheel over the view is unchanged. Decide whether the mouse wheel over the view should step fits the other way.~~ Decided: it doesn't matter (the fits are a loop you don't see as a list); left as it is.
6. **Stamp copies leaves the part's Move arrows on screen:** a tap that lands on the selected part's own arrow tip grabs the arrow instead of stamping. Hide the gizmo while Stamp copies is on?
7. **A finger tap on a rotate ring or anchor line drifts:** rings and anchor lines still treat a press that moves more than 5 px as a drag (hole picking and the band builder allow 12 px for touch). Emulated taps never drift, so check on a real tablet whether ring taps select reliably.

## From play-mode (in progress 2026-11-06)

1. **Flop's drive wheels don't turn in Play mode:** VEX's CAD leaves several wheels, hubs and sprockets 13–45° off their shaft's square flats (228-2500-233, -232, -1208, 228-2536), so Play mode lists them as not fitting and they spin freely. Either turn them to fit on import (the fit tools already turn axles to fit) or check whether those bores take a shaft every 45°.
2. **Clawbot starter:** the claw crank arms sit 30° off their square shafts and 1.1 mm out of mesh with each other, and the tower isn't detected as joined to the base, so the claw doesn't open and the claw piece is listed as loose.
3. **Flop's tower motor only reaches about 72 rpm** driving the intake linkage through its 10:1 train, with nothing touching (120 with the gear ties off). The linkage loop may be binding.
4. **The Smart Motor's hub doesn't turn on screen** in Play mode (the shaft and what it drives do).
5. **Play mode has no MCP tool,** so it can only be tried in the app.
6. **`fix-assembly` spec doesn't yet say Fix assembly tries the other side when the first move would make an overlap** (built, in `src/engine/fixAssembly.js` and `features.md`, with a check in `scripts/check-fix-assembly.mjs`). Add a requirement the next time that spec changes. Also not built yet: turning a shaft to fit a square bore that sits off its flats (the Clawbot's crank arms, 30°); turning the shaft alone works (tried in Node), but the shaft group counts the arm as a member, so only the shaft and the parts that already fit may be turned.
7. **Flop's battery** is a loose piece in Play mode (not joined to anything), so nothing collides with it; the Clawbot's right claw is loose for the same reason. Loose pieces block nothing because treating them as walls stopped the Clawbot's own arm on its unpinned claw. Joining them properly (a pin hole that doesn't line up, a battery not seated in its bay) would fix both.
8. **Intake flaps and tread links run round on screen but collide where they started** on their frame, so a flap swinging past a standoff is judged at its start position on the loop.

## From drop-load-network (2026-11-08)

1. **TODO: measure real forces.** Every value in `src/sim/fastenerStrength.js` is assumed. With a luggage scale that holds its peak reading (0.1 N steps), pull slowly, 5 times each, and record the median and spread; set `source: 'measured'` with the date.
   1. A 1x1 pin pulled out of a 2x beam, fully seated (snap ridge + friction).
   2. A 1x1 pin seated about half depth (a spacer limits it): friction per mm.
   3. The long end of a 1x2 pin through two beams: pull the outer beam off, then the inner one with the outer removed.
   4. A capped (0x2) pin joining two plates: pull the plain-end plate off, then try the capped plate.
   5. A Triple 2x Wide 2x2 Corner Connector peg out of a beam (the Clawbot's weak spot in the model).
   6. A Rubber Shaft Collar slid along a square shaft.
   7. Prying: a 2x8 beam on one pin, weight hung 50 mm out, add weight until it pops.
   8. A standoff pin end out of a beam.
   9. Stiffness: a 2x8 and a 2x16 beam clamped at one end, 100 g at the free end, deflection measured (sets the section factor).
   10. Weights: Brain, battery, Smart Motor, 2x8 beam, 4x8 plate, wheel with tire.
   11. End to end: drop a real Clawbot flat from 5, 15, 30 and 50 cm on a hard floor and note what comes loose, to compare with the app.
2. **Flop pries two pins loose at 30 cm flat** with today's assumed values: two 1x1 pins near its Brain (nothing comes off). The Clawbot is intact at 15 and 30 cm and Flop at 15 cm. Recheck once the measurements above are in; if real pins hold about what the table says, the model overstates the prying on those pins.
3. **The speed and gravity rules under load:** with only "Simulate gravity" on, a motor lowering an arm runs 20% faster than its top speed; drive wheels carry 62% of the robot's weight as rolling load even off the floor; turning gravity on adds 25% to weight. None have a stated reason.
4. **Only the first impact is worked out.** A corner landing that then slaps down flat underrates the slap; bounces and tumbles don't break anything more.
5. **A drop runs well below real time.** The frame with the impact holds the screen still for about 1 s on the Clawbot and 1.2 s on Flop (the solve, the split into pieces and setting up their collisions). After it, Flop's frames take about 65 ms each, because Rapier gets 12 passes per step during a drop so loose pieces don't sink into each other. Fewer passes (8) would be quicker, with a little more sinking in.
6. **Loose pieces can still sit 3–4 mm into each other after a hard drop.** Each part collides as a simplified outline that fills in its holes and gaps, so touching parts look slightly embedded. Closer outlines (split into a few convex pieces) would fix it at some cost.

