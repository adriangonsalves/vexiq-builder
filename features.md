# VEX IQ 3D Robot Modeler — Features & Capabilities (`features.md`)

> **Last Updated:** 2026-10-23  
> **Scope:** Complete user-facing, manual CAD, automated assembly, validation, and AI/MCP capabilities of the VEX IQ 3D Robot Modeler.

---

## 1. 478-Part VEX IQ CAD Library & Semantic Catalog

- **Complete Official Part Coverage (`479` Parts):**
  - Converted from STEP CAD models (`VEX-IQ-All-Parts` & `VEX-IQ-All-Control`) into centered, millimeter-accurate `.glb` meshes (`public/models/`) and indexed in [`public/catalog.json`](file:///Users/adriangonsalves/projects/vexiq_builder/public/catalog.json) + [`public/part-metadata.json`](file:///Users/adriangonsalves/projects/vexiq_builder/public/part-metadata.json).
  - **Categories:**
    - `Beams & Plates` (1x/2x/4x Beams, Specialty Beams, Corner Connectors, Plates)
    - `Pins & Standoffs` (0x2, 0x3, 1x1, 1x2, 2x2 Capped/Uncapped Connector Pins, Standoffs)
    - `Shafts & Collars` (Pitch Shafts, Capped Shafts, Motor Shafts, Rubber/Set-Screw Collars, Bushings)
    - `Gears & Sprockets` (12T, 24T, 36T, 48T, 60T Spur, Crown, Bevel, Differential, Worm Gears, Sprockets)
    - `Wheels &Hubs` (200mm Omni-Directional, Traction, Balloon Tires, Hubs)
    - `Control & Electronics` (Gen 1 & Gen 2 Robot Brain, Smart Motors, Battery, Optical/Distance/Bumper/Touch LED/Gyro Sensors, Controller)
    - `Pneumatics & Linear Motion` (Pneumatic Cylinders, Solenoids, Air Tanks, Fittings, Linear Racks/Sliders)
  - **Black rubber stays black:** STEP bodies coloured near-black (like the rollers of the 2nd gen `200mm Travel Omni-Directional Wheel`, 228-2536) are stored as a second "rubber" piece of the part's model (`scripts/convert-worker.mjs`, `hasRubber` in the catalog). The 3D view and thumbnails draw that piece black whatever colour the part is given; the rest of the part takes the part colour as usual.
  - **Adding a part:** put its STEP file in `VEX-IQ-All-Parts/`, then run `npm run convert` (only new files are converted) and `npm run index-metadata`. A wheel whose thinnest side is Y (like the 2nd gen omni wheel) gets its centre bore along Y.
- **Live 3D Part Thumbnails & Search:**
  - Interactive category filter pills with part counts.
  - Instant search by part name, VEX part number (`228-2500-...`), or category.
  - On-demand WebGL thumbnail rendering ([`src/components/PartThumbnail.jsx`](file:///Users/adriangonsalves/projects/vexiq_builder/src/components/PartThumbnail.jsx)) with viewport visibility deferral (`content-visibility: auto`).
  - 72 px thumbnails (rendered at 2x) on a light tile, framed to each part's size as seen from the thumbnail angle (short parts aren't cropped, long racks aren't tiny). Very dark parts are lifted to a mid tone in thumbnails only (the 3D view keeps real colors) and every part gets dark outlines, extra dense on near-white connectors, so holes and edges read. A thumbnail is redrawn whenever its part's default color changes. Long part names wrap to two lines.
- **4,137 BVH-Verified Semantic Connection Ports:**
  - Every part is indexed with typed, raycast-verified local connection ports:
    - `pin_hole` (Cyan) — $\varnothing 4.8\text{ mm}$ round pin holes with through/blind classification and axial span `spanMm`.
    - `shaft_bore` (Pink) — Square shaft through-bores on gears, wheels, pulleys, and lock plates.
    - `shaft_socket` (Purple) — Blind square shaft sockets inside Smart Motors and Brains.
    - `pin_peg` (Yellow) — Insertable cylindrical pegs on Connector Pins and Standoffs with shoulder/cap geometry (`fastenerSpecs`).
- **Measured gear, rack and square-shaft data** (`scripts/measure-part-geometry.mjs`, run by `npm run index-metadata`): rays cast at the real mesh every 0.25° and fitted for their repeating pattern, so the values come from the models, not the names. Angles are about each axis from a shared reference direction (`src/utils/axisFrame.js`), so the app and the MCP engine read them the same way.
  - Spur gears (`gearSpecs`): `measured`, tooth count, tip and root radius, tooth size (`diametralPitch` 16 for high strength, 24 standard, 34 for the 34DP pair) and from it `moduleMm`, `pitchRadiusMm`, `toothSpacingMm`, the tooth phase `toothPhaseDeg` (the angle of one tooth's center), the tooth band along the axis `faceSpanMm`, and `boreShape` (square or round, e.g. the idler gear is round). Ratchets, ring gears and toothed non-gears are left unmeasured and never turn to mesh; the indexer lists them.
  - Linear motion racks (`rackSpecs`): length direction, tooth face normal, tooth axis, tooth spacing and the offset of one tooth, tip and pitch lines, length and tooth band.
  - Shaft bores and sockets get `shape` (`square` / `round`) and the square's flat angle `squarePhaseDeg`; square shafts get `fastenerSpecs.shape` and `squarePhaseDeg`. A bore that can't be measured counts as round.
  - The Smart Motor gets `hubSpecs` (`radiusMm`, `faceOffsetMm`, `depthMm`): the drive hub around its square socket, the piece that turns.

---

## 2. Interactive 3D Viewport & Physical Contact Snapping

- **VEX Pitch Grid (`1x Pitch = 12.7 mm = 0.5"`):**
  - Dual-resolution floor grid (`12.7 mm` major lines in blue, `6.35 mm` half-pitch minor lines in slate).
  - Selectable pitch snap increments in the toolbar's **Snap** drop-down: **`1P` (`12.7 mm`)**, **`0.5P` (`6.35 mm`)**, **`0.25P` (`3.175 mm`)**, and **`Free`**.
  - Rotation snap setting (`15°`, `45°`, `90°`, or `Free`), kept in the saved viewport state and settable by the assistant (there is no toolbar control for it yet).
- **Move Gizmo: Axis Arrows + Plane-Drag Handles:**
  - Selecting a part in Move mode (`W`) shows red/green/blue **axis arrows** (drag along `X`, `Y`, or `Z`) plus three large, outlined, color-coded **plane squares**:
    - **Blue `XY` square** — drag within the front/back (vertical) plane; `Z` stays fixed.
    - **Red `YZ` square** — drag within the side (vertical) plane; `X` stays fixed.
    - **Green `XZ` square** — drag along the ground plane; height `Y` stays fixed.
  - The hovered/active plane highlights yellow. Plane handles auto-hide when viewed edge-on (where in-plane dragging would be unstable).
  - Plane drags use the same VEX pitch snapping and BVH flush-contact detent as axis drags.
  - **Pitch steps count from where the drag started**, not from the world origin. A part that starts lined up with holes, even holes off the world grid like axles at wheel-radius height (`y = 23.87 mm`), moves in whole steps and stays on the hole pattern.
  - **Hole snapping:**
    - While dragging, a pin, shaft or hole of the moving part that comes within `3.5 mm` of a matching hole, pin or shaft on another part is pulled onto that part's axis line. The two must be parallel within `2°` and within 12 pitch (`152.4 mm`) of each other along the line, the same reach as the hole rings, so a gear dragged well above a beam still snaps onto the hole below. When two pulls are within `0.25 mm` of each other, the hole nearer along the line wins.
    - A small sideways miss of up to `1 mm`, on axes not being dragged or when dragging along the hole's line, is settled too. A part that drifted slightly off a hole pattern then clicks back into its hole, for example after snapping into a gear's pin hole that's turned for meshing.
    - Apart from that settle, the pull only moves the part along the axes being dragged.
    - It works at any angle, because it uses the real hole lines, not the grid. Plates turned in their own plane or tilted on another axis snap the same way.
    - Dragged axes that run along the hole's line stay on the pitch grid, so a shaft can still be slid in and out in steps.
    - **Holes pull onto holes too:** a hole of the moving part pulls onto a hole of another part when a shaft would fit both (pin holes, shaft bores, the Smart Motor's drive socket, rubber collar holes). This lines up a corner connector or a beam against a beam, a gear's bore over a beam hole, or a motor's socket over a beam hole for an axle through the beam. The same 3.5 mm / 2 pitch / 1 mm settle rules apply.
    - Hold **`Alt`** while dragging to move without hole snapping.
  - **Shaft caps don't pass through holes:**
    - Collision meshes are shrunk `0.38 mm` per part so pins and shafts fit their holes. That hid small overlaps, such as a capped shaft's cap (radius about `2.37 mm`) in a beam hole (about `2.10 mm`).
    - Each shaft part's width along its length and each hole's widest pass-through are now measured on the real mesh. A shaft lined up with a hole (within `1 mm`) collides when a section of it inside the hole is wider than the hole lets through.
    - This applies to drags, nudges, MCP placement and the audit.
    - Square shafts in square gear bores and shafts in rubber collars are not affected.
    - Drags and nudges also check the path, so a whole grid step can't carry a cap past a hole's lip: the shaft stops with the cap resting on the lip.
- **Rotate Mode: Rings Around the Part:**
  - **Right-click the selected part** (it can be behind another part) to switch between Move and Rotate; `E` and the toolbar **Rotate** button open the same mode, `W` / **Move** leave it. Right-drag still pans the camera, and the browser menu never opens over the viewport.
  - A part that isn't held by anything gets three flat rings, **red `X`**, **green `Y`** and **blue `Z`**, centered on the middle of the part. Dragging a ring turns the part around that world axis through its center, so any orientation can be reached.
  - A part **held by a pin or shaft** (one of its pins or its shaft is inside another part's hole, or another part's pin or shaft is inside one of its holes) gets **one orange ring** around that joint's axis. Dragging it swings the part around the pin or shaft, which stays in its hole. Joints on the same axis line (a shaft through a beam and a gear, a pin through two stacked beams) count as one.
  - A part held on **two or more axis lines** can't be turned: no rings, and the Inspector says "Can't rotate: held by pins or shafts on more than one axis". Locked parts ("Part is locked") and Explode view ("Can't rotate in Explode view") are refused too.
  - Rings always go around the whole part and keep a steady size on screen when zooming out. Tick marks show the snap angles; while dragging, the turned slice is shaded.
  - Each ring has an **angle label** (e.g. `Z 30°`, `↻ 45°` for a joint) counting the turn since Rotate mode started for this part, shown from `−180°` to `180°`. Dragging snaps to the rotation snap setting (`Free` follows the pointer). **Click a label to type an angle**; `Enter` turns the part to exactly that angle, `Esc` or clicking away cancels.
  - **Click a ring** to select it (it brightens): the **mouse wheel** then turns the part one snap step per notch (`5°` when `Free`) instead of zooming. Click the ring again, click elsewhere, or press `Esc` to unselect it.
  - Turning isn't blocked by other parts: an overlap is shown and saved as overlapping like any other move. Every finished drag, typed angle, or pause in wheel turning is saved and synced like a drag release, and which joints hold the part is worked out again.
- **BVH Physical Flush Contact Boundary Snapping (Contact Detent):**
  - When moving parts with the **3D Move Gizmo** (`W`) or **Inspector Nudge Buttons** (`-X/+X`, `-Y/+Y`, `-Z/+Z`), the translation solver automatically detects physical contact boundaries using a **10-step BVH binary search** + **`0.25P` (`3.175 mm`) sub-pitch flush seat detection**.
  - Pushing a connector pin into a beam or plate stops **flush** when the pin's flat cap/shoulder contacts the plate surface (`z = ±3.175 mm`) instead of stepping into the solid wall of the beam.
  - Continuing to drag past the contact detent releases the part so it can pass through to the other side when desired.
- **Aligned Hole Highlighting (See-Through):**
  - While a part is selected or dragged (Move `W` or Rotate `E`), every opening that lines up with one of its pins or its shaft is marked with an **orange ring** on the hole's rim, projected onto the receiving part's actual surface on the side where the pin or shaft will enter (e.g. the recessed floor around a beam hole), shown as a **solid ring on the surface at both faces** of the receiving part (only the entry face for the blind motor socket), plus a **faint see-through ring** at the entry face that shows through any parts in front, so alignment is visible without changing the camera view. Rings match each opening's rim (pin holes `3.175 mm`, bores and the motor socket `2.5 mm`, collar hole `1.575 mm`).
  - **Pins** (`pin_peg`) light up round **pin holes** (`pin_hole`). **Shafts** light up pin holes, **gear/wheel/pulley bores** (`shaft_bore`), the **Smart Motor drive socket** (`shaft_socket`), and the hole in a **Rubber Shaft Collar**.
  - Works both ways: dragging a beam, gear, wheel, motor, or rubber collar lights up its own openings that line up with pins or shafts already placed.
  - "Lined up" means axes within `2°`, axis lines within `0.25 mm`, and the opening within `12P` (`152.4 mm`) of the pin or shaft along the axis.
  - Pins only project the way they stick out of their part: each pin end is checked against the 3D model, so a corner connector no longer lights holes on its body side, while connector pins, idler pins (snap end and smooth end) and male–male standoffs project both ways. Every pin part works, including the 2x3 Smooth Idler Pin, which has no pin in the catalog data.
  - A ring shows only while the pin or shaft is still outside that opening; it disappears as soon as the pin or shaft reaches the surface the ring is drawn on (more openings further along the same line stay lit until reached). Through holes in beams, plates, and gears work from either side.
  - Rings stay while the part remains selected (including after Inspector nudges, Snap & Mate, and MCP updates) and clear on deselect, when the part is hidden, or in Explode view. Highlighting never moves parts or changes saved state.
- **Double-Click Mating:**
  - With rings showing, **double-click the selected part** (it can be behind another part) to finish the joint: it is shifted sideways onto the hole's axis (at most `0.25 mm`), then moved straight along the axis until it touches the receiving part (pin cap or shoulder on the face, shaft at the bottom of the motor socket), using the same flush-contact stop as dragging. It keeps going while the pin or shaft is still in the holes, so a pin goes all the way in even after its tip comes out the far side. The saved position is checked so the part never ends up overlapping. It is never rotated.
  - Works both ways: a pin or shaft goes into the lined-up holes, or a beam, gear, or motor moves onto lined-up pins and shafts. Holes lined up in the same direction mate together.
  - **Holes lined up with holes** (hole to hole, when a shaft would fit both) also get rings while the parts are apart. Double-clicking **stacks** the part along the hole axis until it rests on the other part ("Stacked on …"), ready to pin. The rings go away once the parts touch (closer than about `0.9 mm`, the collision check's contact tolerance).
  - **A part with both pins and holes:**
    - When its pins and its holes line up in different directions, double-click shows one arrow per direction.
    - When only its holes line up and its pins line up with nothing, double-click shows the stacking arrow and starts hole picking for the pins at the same time. Click the arrow to stack, or point at any hole and click to insert the part by a pin there. `Esc` or an empty click cancels both.
  - If nothing is touched while the pin or shaft is in the holes (a plain shaft through beams and gears, a gear onto a shaft), the part stops when the leading end is flush with the far face of the last lined-up hole.
  - Parts that can mate in more than one direction (e.g. the **Triple 2x Wide, 2x2 Corner Connector**, with pins on `+X`, `+Z` and `−Z`) show **one large orange arrow per direction** instead, and the gizmo hides. **Click an arrow** to mate that way; `Esc`, clicking elsewhere, or a selection change cancels.
  - The result is saved and synced like a drag release, and a message appears in the Inspector ("Mated with …", "Nothing lined up to mate with", "Part is locked", "Can't mate: already touching another part").
- **Pick a hole (double-click with nothing lined up):**
  - Double-clicking a selected part that has pins, pegs or shafts but lines up with nothing starts **hole picking**. A cyan banner shows the controls and the gizmo hides; the camera still moves.
  - **Hover** near a hole face, within about `24 px`, to ring it in cyan. The face you point at is the side the part goes in from. A hole that already has a pin or shaft in it rings grey and says so.
  - **Bore parts** (gears, wheel hubs, pulleys, sprockets, the Smart Motor: no pins or shafts, but a shaft bore or socket) start picking the same way. Their targets are the two ends of other parts' axles (the part slides onto the axle until it touches something) and hole faces a shaft fits (the bore lines up with the hole and the part rests on the face). The preview is turned to fit a square axle, and a gear is shown at its meshing turn when it meshes along its way in. The banner leaves out the pin count, and an axle end is never "taken". Ctrl/Cmd copy insert works for them too.
  - A **see-through cyan copy** shows the part turned onto the hole's axis whatever angle it was at, its tip `1 mm` outside the face. Its roll follows the receiving part: a pattern on a plate turned 30° is shown turned 30°.
  - Other pins pointing the same way are marked **green** (a hole lines up) or **red** (none does). The banner reads, for example, "Fit 1 of 8 · 2 of 2 pins in holes".
  - The best fit (most pins in holes, then the smallest turn) comes first. The **mouse wheel** or **`R`** / **`Shift+R`** steps through the others: which pin goes in the hole, which end leads, 90° rolls, and **pattern rolls**. A pattern roll is the exact turn that puts another pin on a parallel hole. Holes are searched out to the part's own widest pin spread across the axis and within 2 pitch along it, so hole rows that aren't square to their part (like the angled face of a 30° corner connector) can still be filled. Pins and shafts that look the same at any roll get one roll; capped shafts always lead with the uncapped end.
  - **Click** to insert. The part is turned and placed, then pushed in until it touches, exactly like double-click mating (a shaft cap stops on the hole's lip). It is saved as one history step, "Insert … into …", so one undo restores it. Something in the way just outside the hole gives "The way in is blocked".
  - `Esc`, clicking where no hole is ringed, selecting another part, changing Move/Rotate or Explode, or the part being moved by undo or MCP ends picking without changes.
  - Parts without pins or shafts (beams, plates) still get "Nothing lined up to mate with". Picking a beam onto pins already in the model is a planned follow-up.
- **Quick copy insert (Ctrl/Cmd + double-click a hole):**
  - With a part that has pins, pegs or shafts selected, **hold Ctrl** (or **Cmd** on macOS) and point near a hole on any other part. The same hover and fits as hole picking are shown: a see-through copy at the best fit, green/red pin markers, and a **cyan ring on every hole the copy's pins would go into** (both holes for a two-peg corner connector). A hole that already has a part in it rings grey. The gizmo stays; a short status line names the part and the fit.
  - The **mouse wheel** steps through other fits. `R` isn't used, because Ctrl+R / Cmd+R reloads the browser.
  - **Ctrl/Cmd + double-click** adds a new copy, pushed in until it touches like a hole-picking insert. The original doesn't move and stays selected, so more copies can be stamped straight away. Each copy is named after its catalog part with the next free number ("0x2 Connector Pin #7"), keeps the original's color, and is one history step, "Insert copy of … into …".
  - A taken hole ("That hole already has a part in it") or a blocked way in ("The way in is blocked") adds nothing.
  - The double-click is read from the two presses, so it works on macOS where Ctrl+click arrives as a right-click. Clicks with Ctrl/Cmd held during the preview never change the selection or switch Move/Rotate, and a Ctrl/Cmd double-click never mates.
  - Letting go of the key, leaving the window, changing the selection or Explode ends the preview without changes. It doesn't run during a drag, hole picking or while mate arrows are shown.
- **Real-Time Concave Mesh Collision Detection (`three-mesh-bvh`):**
  - Uses inward-eroded (`0.38 mm` clearance) concave triangle meshes so pins and shafts pass cleanly through `4.8 mm` holes without false-positive bounding-box collisions, while true solid-body intersections are flagged immediately.
  - A **tire on its hub** isn't an overlap: tires are moulded smaller than the hub they stretch over, so a tire whose axis lines up with a hub's and whose width covers the hub's middle is left out of the check (`src/utils/tireFit.js`, shared by the app and the MCP engine).
  - Intersecting parts render in **transparent grey** (`opacity: 0.42`) with a top HUD warning and a one-click **Revert Pose / Cancel Placement** button.
  - Selecting another part automatically reverts any unplaced intersecting part to its `lastValidPosition` / `lastValidRotation`.
- **Multi-Axis Exploded View (`Off`, `X`, `Y`, `Z`, `All`):**
  - Non-destructively separates all visible parts radially or along a single axis (`X`, `Y`, or `Z`) with dashed cyan trace lines back to their true assembled coordinates.
  - Co-planar parts fan out symmetrically in single-axis explode mode so internal pins, shafts, and gears are clearly visible.
- **View options (the view cube's menu: right-click the cube; in Stereo, the toolbar's `View` button):**
  - **Perspective / orthographic:** `P` or the menu's Perspective / Orthographic. The view keeps its target, direction and size at the target when switching, and every tool (drag snapping, mating, hole picking, the copy preview, Rotate mode, Explode, Frame) works the same in both. Orthographic zoom never clips the parts in front.
  - **Axis views:** `1`, `2`, `3` turn the camera (in about 300 ms, keeping the target and distance or zoom) to look from +X (front), +Y (top, +X at the top of the picture) and +Z (side). `Shift+1/2/3` looks from the opposite side.
  - **View cube:** a labeled cube (+X Front, −X Back, +Y Top, −Y Bottom, ±Z) in the main view's top-right corner turns with the camera. Click a face for that axis view, an edge for the view halfway between two faces, or a corner for an even three-quarter view; hovering highlights the part under the pointer. **Double-click** a face, edge or corner to look from the opposite side. **Drag** on the cube to turn the view (as dragging empty space does; a press that moves under 5 px is a click). **Right-click** it for the view menu: Perspective / Orthographic, Single / 4-View / Stereo (with Cross-eyed, Depth and Full screen in Stereo), and the Grid and Axes switches. Clicks in its square but off the cube reach the parts behind it.
  - **4-View:** the working view takes the left 70%, with view-only orthographic `X · Front`, `Y · Top` and `Z · Side` views stacked on the right. They follow the build (moves, drags, Explode, hidden parts, the selection highlight) and frame all visible parts until zoomed (wheel, about the pointer) or panned (drag); `F` reframes them. Clicks there never select or edit, and the gizmo, rings, arrows, hole rings, pick previews and the cube are drawn only in the working view.
  - **Stereo:** two half-width pictures side by side, from eye positions beside the camera that meet at the orbit target (target at screen depth). The gap between the eyes is the distance to the target / 30 × `Depth` (0.25–3, default 1), so depth stays comfortable at any zoom. Default is parallel viewing (left picture = left eye, phone VR viewers); `Cross-eyed` swaps the pictures. Stereo always draws in perspective and keeps the Ortho setting for later. Stereo is a full workbench: work in either picture (the half under the pointer is the working one, judged from that picture's eye, and it only switches when no button is held and no drag or ring turn is under way). Selecting, the Move gizmo with drag snapping, Rotate mode with ring drags and typed angles, double-click mating, hole picking and Ctrl/Cmd copy insert all work as in Single, and the gizmo, rings, arrows and previews are drawn in both pictures so they're seen in depth. The view cube stays hidden in Stereo.
  - **Stereo full screen:** the `Full screen` button (shown in Stereo) fills the screen with just the pair: no toolbar, panels, timeline, pills or shortcuts bar, each picture half the screen wide. Where the browser refuses full screen (e.g. inside a frame) the pair still covers the whole window. A hint ("Esc to exit full screen") fades after about 3 s. Editing works as in Stereo. `Esc` ends hole picking, mate arrows or a selected ring first; otherwise it leaves full screen without deselecting, as does switching the layout (also over MCP). Full screen isn't saved.
  - **Wide view (`Wide` / `Panels` toggle in the toolbar):** hides the parts library and Inspector so the viewport takes the full width under the toolbar, in any layout, including Stereo without full screen. Remembered in this browser across reloads (not part of the build).
  - **Shadows (Settings → Display, off by default):** the main light casts soft, subtle shadows (a 4096² map fitted each frame to what the main view sees in Single and Stereo, so zooming in sharpens them, and to the whole build in 4-View; steady while orbiting; a small offset keeps flat faces clean with only a minimal lit gap at inside corners), so parts shade each other, and a dark floor patch fading out at its edge appears under the lowest part to catch the build's shadow. With shadows on the light shifts a little toward the main light for more contrast between faces; with them off the picture is exactly as before. Overlays (gizmo, rings, arrows, previews, cube) never cast. Shadows show in every projection and layout and in `current` screenshots; the map is drawn once per frame however many panes there are.
  - **Ambient occlusion (Settings → Display, off by default, separate from Shadows):** darkens creases and inside corners where faces meet (the base of hole rings, pocket corners, where a pin meets a plate, parts touching), fading out over about 4 mm; open flat faces keep their brightness. Uses three's GTAO pass per pane (main, small views, stereo halves) with the overlays drawn on top afterwards, so the gizmo, rings and arrows are never darkened and the see-through pick preview still hides behind parts. Works with or without Shadows, in every projection and layout; off gives exactly the old picture. It costs noticeably more GPU time than Shadows (most in 4-View, which runs it in all four views). MCP screenshots don't include AO.
  - Projection, layout, cross-eyed, depth, shadows and AO are saved with the viewport settings and add no history steps. The camera position itself isn't saved.
- **Semantic Port & Axis Overlay (`Axes` Toggle):**
  - Renders color-coded 3D axis lines and origin markers (`pin_hole`, `shaft_bore`, `shaft_socket`, `pin_peg`) directly over each part in the viewport.
- **Keyboard Shortcuts:**
  - `W`: Move Tool (`translate`)
  - `E`: Rotate Tool (`rotate`)
  - Right-click the selected part: switch between Move and Rotate
  - `Esc` (with a ring selected): unselect the ring
  - `X`: Cycle Explode View (`off` → `x` → `y` → `z` → `all`)
  - `D` / `Cmd+D`: Duplicate selected part
  - `F`: Focus camera on selected part (or full assembly); also reframes the 4-View small views
  - `P`: Perspective / orthographic
  - `1` / `2` / `3`: Look from +X (front) / +Y (top) / +Z (side); with `Shift`, from the opposite side
  - `Del` / `Backspace`: Delete selected part
  - `Esc`: Hide mate arrows if shown; otherwise exit Explode mode / revert intersecting part & deselect
  - Double-click selected part: Mate with lined-up holes / pins (shows direction arrows when there is more than one way); with nothing lined up, pick any hole to insert into (a gear, hub or pulley: an axle end or hole to go onto)

---

## 2a. Gear Meshing, Square Shafts & the Motor Hub

- **Gears turn to mesh** (`src/utils/gearMeshing.js`): a measured spur gear in mesh range of another gear or a rack turns about its own axis by the smallest turn (at most half a tooth) that puts its teeth in the other's gaps.
  - Mesh range: axes parallel within 2°, tooth bands overlapping along the axis, the same tooth size, and centers within 1.0 mm of the sum of the pitch radii (for a rack: one pitch radius from its pitch line, over its length).
  - While dragging, the gear turns continuously, so tooth clashes no longer hold it short of the hole it is pulled onto; it turns again on release. Alt (no hole snapping) also turns this off.
  - Also on double-click mating, hole picking and Ctrl/Cmd copy insert; for these the turn is worked out where the gear first meshes along its way in, so it can slide down an axle past another gear.
  - With several neighbours, the turn that leaves the largest error smallest wins (ties: the nearest neighbour); any neighbour still more than a quarter tooth off is named ("Couldn't mesh with 36 Tooth Gear #2 as well"). A gear held by a pin off its own axis isn't turned.
  - Turning a gear by hand in Rotate mode is never undone: meshing only happens when a part is placed.
- **Square axles fit square holes** (`src/utils/shaftGroups.js`): a square axle going into a square bore or socket turns by the smallest amount that lines its flats up with the hole's; a part with a square bore going onto an axle turns to fit it. When an axle passes several square holes whose flats disagree, it fits the one it was put into and a message names the others. Round bores take any angle. Hole picking and the copy preview show square axles at the four fitting turns, and a gear at its meshing turn.
- **Shaft groups:** a square axle, every part seated on it by a square bore, and a Smart Motor hub holding it turn together. When a gear placed on a loaded axle meshes, its whole group turns (positions turn about the axle too) and parts on other axles stay put. Round-bore parts (idler gears, bearings) and pin holes aren't in groups.
- **Smart Motor hub:** the motor's drive hub is split off its model when it loads (`src/utils/motorHub.js`) and drawn, and collided, turned by the instance's `socketAngleDeg` (0 when missing, so older saves load unchanged). An axle going into the socket keeps its angle and the hub turns to match. The angle is saved with the build, part of the history, shown by `get_assembly`, and turns with its shaft group.
- **One step:** the placement's own move and every turn it caused (other group members, the hub) are one history step, labeled with what happened, e.g. "Move 24 Tooth Gear #1. Meshed 24 Tooth Gear #1 with 48 Tooth Gear #1 (turned −5.5°)". The same text shows as the action message.
- The app and the MCP engine share the placement step (`src/utils/placementFit.js`), so both place parts identically. The collision meshes (shrunk 0.38 mm) can't see a square axle turned wrong in a square hole (its corners overlap only ~0.6 mm), so square fits are made by angle, not found by collision.

---

## 2b. Simple Mode, Settings & the Compact Toolbar

- **Simple by default, for young builders:** the toolbar holds Undo / Redo / History, Move / Rotate, the **Snap** and **Explode** drop-downs (each shows its current choice; `X` still cycles Explode), Focus, Wide, the **File** menu, Audit & Blueprint and a **Settings** gear, with the open build's name beside the title. View options are in the view cube's menu (see above).
- **Settings panel (gear button; Esc, the close button or a click outside closes it):**
  - **Display:** Shadows, Ambient occlusion.
  - **History:** Linear (the default) or Keep branches; the choice shows with advanced options on.
  - **Assistant (MCP):** let the assistant change the build, on by default; shown with advanced options on. Off: every MCP tool that would change the build (place, update, remove, mate, fasten, mesh, mirror, clear, undo, redo, configure the view, screenshots) replies that the assistant is turned off in Settings and changes nothing; reading tools (search, part details, get_assembly, get_history, audit, orthographic views) still answer. The app's bridge refuses the assistant's pushes (HTTP 423), and the in-browser WebMCP tools refuse too.
  - **Advanced options:** one switch, off by default. On, it shows the Inspector's **Smart Assembly & Fastening** and **CAD & Semantic Metadata** sections, the MCP status badge, and the History and Assistant settings.
  - Settings apply at once and add no history steps. History, Assistant and Advanced are saved in `public/app-settings.json` (not in git, not part of the build), shared with the MCP server and every open tab; Shadows and AO stay in the saved viewport settings so the assistant can still set them.
- **Messages over the view:** action messages ("Mated with …", "Meshed … (turned …)", "Nothing lined up to mate with", errors) show in a strip at the top of the 3D view and fade after about 4 s, whether or not a part is selected or advanced options are on.

---

## 3. Manual CAD Inspector & Smart Assembly Tools

Located in the right-hand **Part Inspector** ([`src/App.jsx`](file:///Users/adriangonsalves/projects/vexiq_builder/src/App.jsx)) whenever a part is selected:

1. **Precision Transform & Nudge Controls:**
   - Direct numeric `X`, `Y`, `Z` inputs in millimeters with live VEX Pitch (`P`) readout.
   - Contact-aware `-X`, `+X`, `-Y`, `+Y`, `-Z`, `+Z` Nudge buttons that step by the active Pitch setting and automatically stop flush at physical contact boundaries.
   - Direct `X`, `Y`, `Z` Euler degree inputs plus one-click **Rotate X/Y/Z +90°** flip buttons.
   - 11 VEX IQ color swatches (including Connector White, the default for Connectors & Brackets) plus a custom hex color picker.
2. **⚡ Auto-Fasten Joint (Pins):**
   - Automatically scans all verified `pin_hole` ports between the selected part and either a specific partner part or **`ALL` touching parts**.
   - Finds coaxial overlapping holes (`collinearDist <= 1.2 mm`), measures total stack thickness (`2P` vs `3P+`), selects the appropriate VEX Connector Pin (`1x1`, `0x2`, or `1x2`), computes the exact shoulder seating depth, and verifies zero BVH collisions before inserting up to `maxPins` pins.
3. **🎯 Snap & Mate to Port (`mate_parts`):**
   - Declaratively snaps any source port on the selected part (or `Auto` primary bore/socket/hole) to any target port on another placed part.
   - Supports one-click **Flip Axis (`180°`)**, **Roll Angle** (`0°`, `5°` for 36T gear meshing, `45°`, `90°`, `180°`), and **Axial Offset** (`0 mm`, `±3.18 mm` / `±0.25P`, `±6.35 mm` / `±0.5P`, `±12.7 mm` / `±1P`).
4. **⚙️ Mesh Gear Train Builder (`mesh_gear_train`):**
   - Builds a complete, phase-synchronized gear train along any selected structural beam starting at a chosen `pin_hole` port.
   - Presets include `3 × 36T (1:1)`, `5 × 36T (Full Side)`, `2 × 36T`, `12T → 36T (1:3 Torque)`, and `60T → 36T (1.67:1 Speed)`.
   - Automatically alternates gear roll angles (`180° / teeth`) to prevent tooth-on-tooth clashes, centers gears between inner and outer rails, and optionally inserts `3x Pitch Shafts` (`228-2500-2221`).
5. **🪞 Symmetry Mirror (`mirror_subassembly`):**
   - Mirrors the selected part (or the entire half-assembly) across `Z = 0` (`Left ↔ Right`) or `X = 0` (`Front ↔ Rear`).
   - Each part is turned to its mirror image (shared with `place_parts` `mirror`): of the three turns that reflect the part through one of its own middle planes, the one whose pins and openings land on the true mirror image's wins, then the one whose shape matches best. Offset connectors, rubber collars, motors and capped shafts come out the right way round; parts whose surface pattern or tread isn't symmetric get the closest turn with their holes in place, and parts with no exact mirror are flagged `mirrorApproximate`.
   - Labels swap `Left`/`Right` and a standalone `L`/`R` (`Omni Collar L` → `Omni Collar R`), or get ` (mirror)` when they have neither.
6. **CAD & Semantic Metadata Readout:**
   - Displays live placement status (`Placed (Clear)` vs `Intersecting`), Part Number, Category, Origin Type (`centered`, `offset_flange`, `asymmetric`), bounding box in `mm` and VEX Pitch (`P`), port breakdown (`pinHoles`, `shaftBores`, `pinPegs`), Gear Specs (`teeth`, `pitchRadiusMm`), Fastener Specs, and Heavy-Part Mounting Rules.

---

## 4. 6-Stage Mechanical & Kinematic Audit + 3-View Blueprint Modal

Accessible via the **Audit & Blueprint** button in the top toolbar (and via MCP tools `audit_assembly` / `capture_viewport_views`):

- **6-Stage Engineering Verification (`isMechanicallySound`):**
  1. **Solid Collisions (`collisionCount`):** Pairwise concave BVH mesh intersection check across all visible parts.
  2. **Floating & Half-Seated Fasteners (`floatingFastenerCount`, `halfSeatedFastenerCount`):** A pin, peg or shaft only counts as joining parts when it actually **sits inside a matching hole** on each of them (same matching rules as the aligned-hole highlighting: axes within `2°` and `0.25 mm`, overlapping along the axis by more than `0.05 mm`). Parts whose boxes merely touch don't count. A fastener seated in no part is *floating*; seated on one side only, it's *half-seated*. `joints` lists what every fastener sits in, and `pegJoints` lists parts joined by their own pegs (e.g. corner connectors).
  3. **Unsecured & Heavy Parts (`unsecuredPartCount`, `underSecuredHeavyPartCount`):** Checks that every non-fastener part has $\ge 1$ seated fastener or peg, and heavy components (Brain, Smart Motors, Battery) meet their `minFastenersRequired` threshold. Rubber Shaft Collars count as parts held on a shaft, not as shafts.
  4. **Connectivity Graph (`connectedComponentCount`, `disconnectedIslandCount`):** Builds the graph from seated joints, meshed gears and clamped parts to verify the robot forms a single unified assembly (`0` disconnected islands).
  5. **Shaft Protrusions (`protrudingShaftCount`):** Flags shafts reaching more than `4.5 mm` past the outer faces of the parts they sit in (collars included).
  - **Real hole depths:** hole depths are measured on each part's 3D model. A hole listed as going through but blocked inside is treated as a blind hole from each face that is open at least `1 mm` deep; for example, the Smart Motor's back face only has `~0.4 mm` marks, not holes.
  6. **Kinematic Drivetrain Trace (`kinematics`):** Traces torque transmission from each `Smart Motor` $\rightarrow$ `Motor Shaft` $\rightarrow$ `Driver Gear` $\rightarrow$ `Meshed Idler/Driven Gears` $\rightarrow$ `Driven Shafts` $\rightarrow$ `Driven Wheels`.
- **Interactive Issue Callouts:**
  - Any flagged part appears as a clickable pill in the Audit dialog; clicking it selects the part, closes the modal, and focuses the 3D camera directly on the offending component.
- **3-View Orthographic Engineering Blueprint (`/assembly-blueprint.svg`):**
  - Generates and embeds a high-resolution `1600×1050` SVG engineering drawing showing **TOP (`X–Z`)**, **SIDE (`X–Y`)**, and **FRONT (`Z–Y`)** true-scale orthographic projections with part outlines, holes, pitch grids, and callout badges.

---

## 5. Dual MCP Integration (Node Stdio MCP + Browser WebMCP) & Persistence

- **Node Stdio MCP Server ([`mcp/vexiq-mcp-server.mjs`](file:///Users/adriangonsalves/projects/vexiq_builder/mcp/vexiq-mcp-server.mjs)):**
  - Exposes 20 tools to external AI agents (`search_parts`, `get_part_details`, `get_assembly`, `place_part`, `place_parts`, `update_part`, `align_part_to_hole`, `mate_parts`, `auto_fasten_joint`, `mesh_gear_train`, `mirror_subassembly`, `audit_assembly`, `capture_viewport_views`, `capture_screenshot`, `remove_part`, `clear_assembly`, `configure_viewport`, `get_history`, `undo`, `redo`).
  - **Build history over MCP:**
    - Every tool call that changes parts is one history step labeled with the tool and a summary, for example `place_parts: 72 parts`. One undo removes the whole call.
    - Calls that change nothing (`dryRun`, refused `rejectIntersecting`, reading tools, `configure_viewport`) add no step.
    - Replies to changing calls include `historyStep`, plus `historyNote` when the change started a new branch.
    - `get_history` lists the current line's steps (label, source, time, part counts) and where branches split off.
    - `undo` / `redo` move through the history without adding steps.
    - `get_assembly` reports only `history: { currentStep, totalSteps }`.
  - Synchronizes live with the browser UI in real time over Server-Sent Events (`/api/assembly/events`) and REST (`/api/assembly`).
  - **`place_parts`:** places a whole list of parts in one call and replies with one line per part plus one audit summary.
    - Each item gives either a position and rotation, or an **insert**: put this part's pin, peg, shaft or bore into a hole of a placed part or of an earlier item (`ref`), and push it straight in until it touches something, like double-click mating.
    - **Other fits:** when an inserted part also fits another way that looks different (turned end for end, or rolled a quarter turn), the reply lists them in `otherFits` with a note to check the part faces the right way. Only fits with as many pins seated and no overlap are listed; pins and shafts are only checked end for end. `insert.flip: true` leads with the other end, and giving `flip` or `rollDeg` stops the list.
    - `dryRun: true` checks a layout without saving it, and `rejectIntersecting: true` saves nothing if anything overlaps.
    - `mirror: { plane, offsetMm }` also places every item's exact mirror image, using each part's own symmetry. Left/Right are swapped in labels, and parts centered on the plane aren't doubled.
  - **Meshing and square fits over MCP:** `place_part` and `place_parts` run the same placement step as the app (square fit, meshing, shaft-group turns, motor hub). A given `rotation` / insert `rollDeg` is replaced by the fitting or meshing turn when one applies, and the reply says so (`rotationReplaced` / `rollReplaced`); replies list `notes` (meshes, neighbours it couldn't mesh with, hub turns) and `turnedOthers`. `mesh_gear_train` spaces gears by their measured pitch radii, turns each to its meshing turn against the previous one (reported as `rollDeg` and `meshedWith`), and turns its shafts to fit the gears' square bores. `get_part_details` includes `rackSpecs` and `hubSpecs`.
  - **`get_part_details`:** returns a compact list of each part's connection points (position, axis, usable span, measured depth, through or blind, which way pegs stick out). The raw catalog record comes back only with `verbose: true`.
  - **App status:** every tool that changes the assembly reports `appSync`: `live` (the open app got it), `no-browser` (the app is running but nobody has it open) or `saved-to-file-only` (the app isn't running), with a hint.
  - **`capture_screenshot`:** returns a PNG of the 3D view rendered by the open app, either from the user's camera or a framed view: `iso` (front-right, above), `iso-front-left`, `iso-back-right`, `iso-back-left`, `front`, `back`, `left`, `right` (= `side`), `top`, `bottom`, or any `direction: [x, y, z]` (+X is the front, +Z the right side). Every open tab is asked and the most complete picture wins; the reply carries a `warning` when even that tab is still loading parts or shows a different build than the saved one (reload it). Gizmos, hole rings and the selection tint are left out, and the user's camera isn't moved. `current` is the main view's own camera (orthographic when set) as one picture, without the 4-View small views, the stereo pair or the view cube; the standard views are always perspective.
  - **`configure_viewport` view options:** `projection` (`perspective` | `orthographic`), `viewLayout` (`single` | `four` | `stereo`), `stereoCrossEyed`, `stereoDepth` (0.25–3), `shadows` and `ambientOcclusion` (true/false) and a one-shot `viewAlong` (`+x` … `-z`) that turns the open app's camera like the `1/2/3` keys. Unknown or out-of-range values are refused with the allowed values. The browser WebMCP `configure_viewport` takes the same options.
- **Browser W3C WebMCP (`navigator.modelContext` in [`src/utils/webMcpTools.js`](file:///Users/adriangonsalves/projects/vexiq_builder/src/utils/webMcpTools.js)):**
  - Registers in-page tools for browser-hosted AI assistants.
- **Builds save themselves (File menu and library):**
  - Every build is kept in the browser's storage (IndexedDB `vexiq-builds`, `src/utils/buildLibrary.js`), saved about a second after each change with its parts, its own undo history, its view settings and a small picture. There is no Save button; reloading opens the build that was open.
  - Builds are named **Build #1**, **Build #2**, …; the open build's name is beside the title, click it to rename (Enter keeps, Esc cancels; no history step).
  - **File → New** starts an empty build; **File → Starter ▸** lists the starters (`src/starters.js`: "Sample starter" and "Speedbot 2.0", the VEX IQ 2nd gen Speed Build 2.0 from its build instructions with all 42 parts except the two Smart Cables; the brain's model includes the battery. More like drivetrains and claws can be added there) and starts a new build from one. The build that was open stays saved.
  - **File → Load…** shows every saved build, newest first, with its picture, name, when it changed and its part count: **Open** (or double-click), **Rename**, **Duplicate** ("<name> copy") and **Delete** (asks first; deleting the open build opens the most recent other one, or a new empty one). **Open from computer…** adds a `.vexiq.json` file as a new build named after the file.
  - **File → Export** downloads the open build as `<name>.vexiq.json`: its history, with overlapping parts left out and a closing "Leave out overlapping parts" step, as before. A file without history (saved before the history feature) opens with one "Starting assembly" step.
  - **File → Delete this build…** removes the open build from this browser (asks first).
  - The open build's id and name are saved with the build state in `public/assembly-state.json` (`build: { id, name }`), so every tab and the assistant work on the same build: switching or renaming in one tab shows in the others, and the assistant's changes are saved into the open build. On the first start, the build that was open before the library existed becomes "Build #1".
  - The library lives in each browser; Export moves builds between computers. Without browser storage (some private modes), New, Starter and Export still work.

## 5a. Build History, Undo/Redo & Timeline

Shared history code: [`src/utils/buildHistory.js`](file:///Users/adriangonsalves/projects/vexiq_builder/src/utils/buildHistory.js). Timeline: [`src/components/HistoryTimeline.jsx`](file:///Users/adriangonsalves/projects/vexiq_builder/src/components/HistoryTimeline.jsx). Checks: `node scripts/check-history.mjs`.

- **Steps:**
  - Every change to the parts becomes one step with a label, a time and a source: `app`, `mcp`, `assistant` (in-page WebMCP) or `action` (smart actions).
  - Recorded changes: add, move, rotate, mate, delete, duplicate, recolor, hide/show, lock/unlock, clear, starter, and moving an overlapping part back.
  - Not recorded: selection, the camera, explode view, viewport settings, and the app's own overlap-flag updates.
  - Steps store only what changed, so long histories stay small.
- **Typing:** typing in an Inspector field, dragging the color picker, or repeated nudges on one part within 1 s merge into one step.
- **Undo / Redo:**
  - Unlimited, from the toolbar arrows or **Ctrl/Cmd+Z** and **Shift+Ctrl/Cmd+Z** / **Ctrl+Y**.
  - In text fields those keys keep their normal text editing.
  - After undo or redo, the moved parts' overlap status is checked again.
- **Linear or branches (Settings → History, advanced options):** by default history is linear: undoing and then making a change drops the undone steps, like most apps. With **Keep branches**, the undone steps stay as a branch and nothing is ever deleted. The choice applies to the app, its bridge and the assistant's MCP tools alike; branches already in a history stay switchable either way.
- **Timeline (History button, clock icon):**
  - A bar under the 3D view with one mark per step, colored by source (App blue, MCP amber, Assistant purple, Smart action green), plus "Step N of M" and hover tips with the label, source, time and part counts.
  - Click or drag to go to any step.
  - A step that touched many parts, such as one `place_parts` call, plays its parts one at a time while you scrub through it. The view is read-only part-way through a step, with a **Go to end of step** button.
  - **Play** (1×/2×/4×) replays the build from the start. Any edit, undo, redo or MCP change stops playback.
  - Branch markers open a menu to switch to another branch.
  - Whether the timeline is shown is remembered in this browser.
- **Sync:**
  - The app, the MCP server and smart actions all record into the same saved history.
  - A browser save built on an older history (an MCP step landed in between) is refused with `409`. The app then takes the saved build and puts its change on top, so neither side loses a step.
  - Each browser tab has its own id, so open tabs stay in step with each other.

---

## 6. OpenSpec Spec-Driven Development (SDD) Framework

- **AI-Native Spec-Driven Development (`openspec/`):**
  - Integrated via `@fission-ai/openspec` with multi-agent workflows configured in `.agents/`, `.claude/`, and `.cursor/`.
  - Directory structure:
    - `openspec/specs/`: Source-of-truth living project specifications.
    - `openspec/changes/`: Proposed change sets, delta specifications, designs, and task checklists.
    - `openspec/config.yaml`: Workflow schema configuration (`schema: spec-driven`).
  - Available slash workflows:
    - `/opsx-propose`: Create and align on structured proposals, delta specs, and tasks before writing code.
    - `/opsx-apply`: Apply and implement an approved change proposal.
    - `/opsx-archive`: Verify and archive completed changes into living project specs.
    - `/opsx-explore`: Explore ideas and codebase capabilities.
    - `/opsx-onboard`: Interactive onboarding for understanding existing specs.
    - `/opsx-sync`: Synchronize delta specs with main specs.
    - `/opsx-update`: Update and maintain existing change proposals.

