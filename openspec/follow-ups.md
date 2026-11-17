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


## From right-angle-gears (in progress 2026-11-12)

1. **Differential Gear housings:** the bevel gears inside the Differential Gear and Differential Gear (High Strength) don't seat or mesh, and Play mode doesn't turn the two axles through them. The housings aren't measured as gears.
2. **Loose spur gears jumping into mesh beside spur gears:** only 90° pairs jump to a mesh spot when dragged near their partner; two spur gears still get their position from holes and shafts and only turn their teeth.
3. **context-toolbar's Join requirement doesn't mention gears:** Join is Auto Join for a gear with a 90° partner within 40 mm and moves it to its nearest mesh spot (specified in right-angle-gears "Joining a gear to its partner"). Add a cross-reference line the next time the context-toolbar spec changes.

## From in-app-help (round three, 2026-11-12)

1. **Advanced options and Keep branches (for you to decide):** with Keep branches chosen, turning Advanced options off leaves branching on, because `isLinearHistory` in `src/utils/appSettings.js` ignores the switch. Settings then says undone steps are dropped, which isn't true. The app-settings spec doesn't settle it, so nothing was changed.
2. **"Snap & Mate to Port" in the app vs the guide's ban on "Port" (for you to decide):** the guide calls it "Snap & Mate". Either rename it in the app or allow the exact title on the `advanced-tools` page.
3. **Stereo full screen has no way out by touch.** Only Esc leaves it. A small on-screen exit button is needed.
4. **Two belt chips are both labelled "2x30 mm belt"** (silicone and rubber), so Show me and the pages can't tell them apart. Give them different labels.
5. **The Track builder says "Traction Link" but its message says "grippers".** Pick one word.
6. **Decided, keep as it is (the user tried it): Help from a modal dialog works only with the `?` key.** The toolbar is behind a modal dialog (Settings, builder dialogs, Bend sheet), so a mouse or touch user can use the dialog's own question mark but not the toolbar Help button. `?` now opens Help on top of the dialog; a touch user has no key. Consider a Help button inside each modal dialog.
7. **The Turn step choice is only seen by Help when it is open at the moment Help opens.** Selecting the toolbar Help button closes the choice first, so only `?` opens Help on it.
8. **Throttle and Hold (Play mode) are one control per motor.** Show me flashes the first one on screen.
9. **Group name, Hide all and Lock all are in Properties, not the Outline.** The pages that name them under the Outline should say Properties; check in group 7.
10. **Pages not yet fitted to the app's real part names for context:** six look-alike parts (Landing Gear Beam and Panel, Ball Pin Bushing, Shaft Bushing, Scarab Thrust Washer, XL Turntable Ring Gear Bushing) are given no kind on purpose, so selecting them opens Help as if nothing were selected.
11. **Spec scenario "Open from the toolbar" says Help opens on home with a part selected**, which conflicts with "A gear selected" (opens Gears). The code follows "Help opens on what you're doing"; the older scenario's wording needs updating when the change is archived.
12. **Idea:** short animations for steps that are hard to show in a still picture (the chain sagging, a band stretching, Play mode); the offline download is about 105 MB, so pictures should stay small.
13. **A page inside a closed section loads its pictures only when opened** (browser lazy loading), so the first open of a section may show a blank picture for a moment on a slow connection.
14. **Group name box: Esc keeps the typed name and also unselects the group** (`SetInspector.jsx`). Expected: Esc puts the old name back.
15. **Attempt Fix on a "holds only one part" row says "Lined up…"**, but the warning count stays the same after Refresh.
16. **The view cube's Show me chip finds nothing in 4-View** (its marker is hidden there).
17. **Gear train builder: the default start hole fails** ("No matching pin_hole found") on a 2x10 beam; it works only from a beam end.
18. **Smart Assembly hole lists show raw ids** like `hole.thru.14_-2_0` (Advanced options).
19. **On a phone the history branch list runs a few pixels past the right edge.**
20. **The capture driver's `text:` spec can't find a button that has an icon as well as text** (`scripts/help-shots/app.mjs`).
21. **The help-content spec's Explode entry names direction choices the app doesn't have**; the page is right, so fix the spec text when archiving.
22. **Read-through still to finish** (in-app-help tasks 6.2–6.9, 7.2, 7.3): touch passes on the Basics pages and on the six Mechanisms pages (6.4, 6.5: pins, shafts, gears, chain, bands, sheets were followed by mouse only); not yet tried in the app: the Chain builder Slack on / Over-Under windows, Track builder Build, Belt round these, picking sheet holes by hand, Smart Motor on four pins and the omni wheel / lock beam, Play mode "Stalled"; the shortcuts and troubleshooting sample; `words`; reading every page at 420 and 390 px; tapping every Show me chip.

## From ratchet-and-pawl (collected during groups 4–5; to be sorted in task 7.4)

1. **A pawl dragged tip-first onto its pin stops at the ratchet.** The tip runs into the teeth on the way, so the drag stops short of the pin and the swing-on never happens. Pointing away from the ratchet it works. A see-through preview of the swung pawl while dragging (as gears get near a mesh spot) would fix it.
2. **A pawl pinned twice to a loose beam reads as locked.** The audit counts every pin joining the pawl to another part as a pivot, but pawl and beam still swing together on the one frame pin, and Play mode ties the ratchet to that swinging body.
3. **Ratchets and the pawl are still read as gears in places:** the fastener rule counts the pawl as a turning part (`isRotatingComponent` in `src/engine/core.js`, from its `gearSpecs`), and band and chain routing treat ratchets as toothed (`src/engine/bandStrand.js`, `src/engine/bandRouting.js`, `src/utils/chainPath.js`).
4. **Emulated finger taps on the context bar's Join count as a hold when rendering is slow** (headless Chrome with software rendering): the 500 ms tip timer fires before the finger lifts, so the press is dropped. Real taps on a tablet are expected to be fine.
5. **A Smart Motor released from a long stall overshoots** (about 270 rpm for a moment) because its built-up push carries over; seen when a lifted pawl lets a stalled ratchet go.
6. **A pawl pushed onto a long pin (1x2) used to land turned but above the teeth.** Fixed in groups 4–5 (`turnAndPushIn`, `pawlHoldsAt`); kept here as a note that the pre-push turn is worked out at the end of the travel, so other parts pushed onto pins that stop short may show the same thing.
7. **Double-clicking a selected part in Rotate mode lands on the rotate rings**, so it doesn't mate; in Move mode it does.
8. **In the fallback engine (no physics) a ratchet turned the held way jams at once**, with none of the up-to-one-tooth slack the physics gives.

## From add-build-to-build (archived 2026-11-15)

1. **The Ratchet winch starter's belts point at parts it doesn't have.** Their routes name `import-249`, `import-23`, … (ids from the CAD import), not the starter's own `inst-ratchet-winch-N`. They show because the stored path is kept. Adding a build leaves ids it doesn't know unchanged, so in a build made by CAD import one of those names could match a real part. Fix the starter data (`src/starters/assemblies/ratchet-winch.js`) to use its own ids.
2. **A one-part build added to another comes in as a loose part**, not a group (a group needs two or more parts).
3. **Adding while another tab is open** wasn't checked: the static preview has no bridge, and the live server shares the user's open build. The add is an ordinary history step, so it should reach other tabs like any change.


## From rope-and-spool and motor-stopping (collected 2026-11-16)

1. **Huey's lift doesn't run in Play: linear motion parts aren't joints.** The 1x6 Continuous Linear Motion Rack Gear and the Linear Motion brackets snap on with no pin holes, so the library gives them no ports, the audit lists them as unsecured, no rack link forms and the lift motor can't raise the Middle Stage. Needs a change of its own. The rope side is ready: both ropes import and pull.
2. **The slider rule for a carriage held by ropes** (rope-and-spool tasks 7.5, 8.2 to 8.4, design decision 10) waits on item 1, where it can be checked on a lift that moves. Tried without it on Huey: the stages are pushed out of their tight fits, tilt 3° to 5° and jam. A carriage carrying its own motor (Huey's Claw Mount) is held still today, not hung on its ropes.
3. **VEX keeps some parts in different frames from robot to robot.** `cad-frames.json` now holds a robot's own placement under `projects[<id>]` (23 part types for Huey). A new robot needs `node scripts/fit-cad-frames.mjs <project> --write` before importing.
4. **The imported Huey has 25 overlaps and 13 unsecured parts**, none of them ropes; not looked into.
5. **`place_rope` can't bend a rope round a round post in its way**, only round the corners of beams and plates: it says to pick the post as a spot. The import does this by itself.
6. **A block hanging on two ropes, or on two frictionless pulleys, rocks and doesn't settle** (about 5° each way; rig R5 swings 4 mm about its rope length). Real pulleys have friction; ours have none.
7. **Motor shafts are too light.** A shaft with nothing on it is about 6.6e-7 kg·m² and the motor adds no rotor weight, so a sudden twist, or one past stall, spins it too far. Giving the motor a rotor broke four Play checks when tried; it may deserve its own change.
8. **Hold on a geared shaft** misjudges a twist put straight on the shaft's own gear, and the Clawbot arm in Hold bounces about 4° and rests about 1.7° short (gears are coupled by speed only).
9. **A spool driven through gears isn't held for its rope** by an idle motor; only a spool on the motor's own shaft is.
10. **Rope strength is assumed, not measured** (`src/sim/ropeStrength.js`), and pulleys don't turn as the rope runs over them.
11. **Rigs not built:** R2 (arm, band and rope to a fixed pin), R6 (three pulleys on three bodies) and R7 (pulley on an arm); the travel halves of R4 and R5 (100 mm wound lifts 50 and 25 mm); the spool's back-torque against `T ×` leaving radius.
12. **Rope builder in the app:** the Rope lift starter has no pulley, so "Lift rope over a pulley" was checked over a standoff; a tap on a small pulley's side picks the side only when it lands well off its middle, else the tight side is used and Flip side corrects it.
13. **Undo of a stopping-mode change** from the Play panel wasn't tried in the app (it is checked through the tools).
14. **Help for ropes and stopping modes** (rope-and-spool 4.2, 10.2, 10.3; motor-stopping 6.2) was left out on request, apart from one line each on the saving and context bar pages.
15. **Idler gears on idler pins aren't held, so Huey's back wheels don't turn.** Each side of Huey's drive runs motor gear (48) to front wheel (24) directly, and through two idler gears (36 and 48 Tooth) to the back wheel. Those idlers spin on 0x2 Idler Pins in their square bores. The library treats an idler pin as an ordinary peg that only seats in a round hole, so the gear counts as "not held on anything" and stops the train there. Needs a rule: an idler pin's smooth end in a gear's or pulley's bore holds it and lets it turn.
16. **The import used to drop omni wheels** drawn as a hub with rollers (Huey, Swish): fixed 2026-11-17 by treating a CAD number the frame table maps to a library part as that part.
