# VEX IQ 3D Robot Modeler — Features & Capabilities (`features.md`)

> **Last Updated:** 2026-10-23  
> **Scope:** Complete user-facing, manual CAD, automated assembly, validation, and AI/MCP capabilities of the VEX IQ 3D Robot Modeler.

---

## 1. 478-Part VEX IQ CAD Library & Semantic Catalog

- **Complete Official Part Coverage (`478` Parts):**
  - Converted from STEP CAD models (`VEX-IQ-All-Parts` & `VEX-IQ-All-Control`) into centered, millimeter-accurate `.glb` meshes (`public/models/`) and indexed in [`public/catalog.json`](file:///Users/adriangonsalves/projects/vexiq_builder/public/catalog.json) + [`public/part-metadata.json`](file:///Users/adriangonsalves/projects/vexiq_builder/public/part-metadata.json).
  - **Categories:**
    - `Beams & Plates` (1x/2x/4x Beams, Specialty Beams, Corner Connectors, Plates)
    - `Pins & Standoffs` (0x2, 0x3, 1x1, 1x2, 2x2 Capped/Uncapped Connector Pins, Standoffs)
    - `Shafts & Collars` (Pitch Shafts, Capped Shafts, Motor Shafts, Rubber/Set-Screw Collars, Bushings)
    - `Gears & Sprockets` (12T, 24T, 36T, 48T, 60T Spur, Crown, Bevel, Differential, Worm Gears, Sprockets)
    - `Wheels &Hubs` (200mm Omni-Directional, Traction, Balloon Tires, Hubs)
    - `Control & Electronics` (Gen 1 & Gen 2 Robot Brain, Smart Motors, Battery, Optical/Distance/Bumper/Touch LED/Gyro Sensors, Controller)
    - `Pneumatics & Linear Motion` (Pneumatic Cylinders, Solenoids, Air Tanks, Fittings, Linear Racks/Sliders)
- **Live 3D Part Thumbnails & Search:**
  - Interactive category filter pills with part counts.
  - Instant search by part name, VEX part number (`228-2500-...`), or category.
  - On-demand WebGL thumbnail rendering ([`src/components/PartThumbnail.jsx`](file:///Users/adriangonsalves/projects/vexiq_builder/src/components/PartThumbnail.jsx)) with viewport visibility deferral (`content-visibility: auto`).
  - Near-white parts (connectors) are drawn with stronger, denser outlines so their shape reads on the dark card; a thumbnail is redrawn whenever its part's default color changes.
- **4,137 BVH-Verified Semantic Connection Ports:**
  - Every part is indexed with typed, raycast-verified local connection ports:
    - `pin_hole` (Cyan) — $\varnothing 4.8\text{ mm}$ round pin holes with through/blind classification and axial span `spanMm`.
    - `shaft_bore` (Pink) — Square shaft through-bores on gears, wheels, pulleys, and lock plates.
    - `shaft_socket` (Purple) — Blind square shaft sockets inside Smart Motors and Brains.
    - `pin_peg` (Yellow) — Insertable cylindrical pegs on Connector Pins and Standoffs with shoulder/cap geometry (`fastenerSpecs`).

---

## 2. Interactive 3D Viewport & Physical Contact Snapping

- **VEX Pitch Grid (`1x Pitch = 12.7 mm = 0.5"`):**
  - Dual-resolution floor grid (`12.7 mm` major lines in blue, `6.35 mm` half-pitch minor lines in slate).
  - Selectable pitch snap increments in the top toolbar: **`1P` (`12.7 mm`)**, **`0.5P` (`6.35 mm`)**, **`0.25P` (`3.175 mm`)**, and **`Free`**.
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
    - While dragging, a pin, shaft or hole of the moving part that comes within `3.5 mm` of a matching hole, pin or shaft on another part is pulled onto that part's axis line. The two must be parallel within `2°` and within 2 pitch (`25.4 mm`) of each other along the line.
    - A small sideways miss of up to `1 mm`, on axes not being dragged or when dragging along the hole's line, is settled too. A part that drifted slightly off a hole pattern then clicks back into its hole, for example after snapping into a gear's pin hole that's turned for meshing.
    - Apart from that settle, the pull only moves the part along the axes being dragged.
    - It works at any angle, because it uses the real hole lines, not the grid. Plates turned in their own plane or tilted on another axis snap the same way.
    - Dragged axes that run along the hole's line stay on the pitch grid, so a shaft can still be slid in and out in steps.
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
  - If nothing is touched while the pin or shaft is in the holes (a plain shaft through beams and gears, a gear onto a shaft), the part stops when the leading end is flush with the far face of the last lined-up hole.
  - Parts that can mate in more than one direction (e.g. the **Triple 2x Wide, 2x2 Corner Connector**, with pins on `+X`, `+Z` and `−Z`) show **one large orange arrow per direction** instead, and the gizmo hides. **Click an arrow** to mate that way; `Esc`, clicking elsewhere, or a selection change cancels.
  - The result is saved and synced like a drag release, and a message appears in the Inspector ("Mated with …", "Nothing lined up to mate with", "Part is locked", "Can't mate: already touching another part").
- **Pick a hole (double-click with nothing lined up):**
  - Double-clicking a selected part that has pins, pegs or shafts but lines up with nothing starts **hole picking**. A cyan banner shows the controls and the gizmo hides; the camera still moves.
  - **Hover** near a hole face, within about `24 px`, to ring it in cyan. The face you point at is the side the part goes in from. A hole that already has a pin or shaft in it rings grey and says so.
  - A **see-through cyan copy** shows the part turned onto the hole's axis whatever angle it was at, its tip `1 mm` outside the face. Its roll follows the receiving part: a pattern on a plate turned 30° is shown turned 30°.
  - Other pins pointing the same way are marked **green** (a hole lines up) or **red** (none does). The banner reads, for example, "Fit 1 of 8 · 2 of 2 pins in holes".
  - The best fit (most pins in holes, then the smallest turn) comes first. The **mouse wheel** or **`R`** / **`Shift+R`** steps through the others: which pin goes in the hole, which end leads, 90° rolls, and **pattern rolls**. A pattern roll is the exact turn that puts another pin on a parallel hole. Holes are searched out to the part's own widest pin spread across the axis and within 2 pitch along it, so hole rows that aren't square to their part (like the angled face of a 30° corner connector) can still be filled. Pins and shafts that look the same at any roll get one roll; capped shafts always lead with the uncapped end.
  - **Click** to insert. The part is turned and placed, then pushed in until it touches, exactly like double-click mating (a shaft cap stops on the hole's lip). It is saved as one history step, "Insert … into …", so one undo restores it. Something in the way just outside the hole gives "The way in is blocked".
  - `Esc`, clicking where no hole is ringed, selecting another part, changing Move/Rotate or Explode, or the part being moved by undo or MCP ends picking without changes.
  - Parts without pins or shafts (beams, plates) still get "Nothing lined up to mate with". Picking a beam onto pins already in the model is a planned follow-up.
- **Real-Time Concave Mesh Collision Detection (`three-mesh-bvh`):**
  - Uses inward-eroded (`0.38 mm` clearance) concave triangle meshes so pins and shafts pass cleanly through `4.8 mm` holes without false-positive bounding-box collisions, while true solid-body intersections are flagged immediately.
  - Intersecting parts render in **transparent grey** (`opacity: 0.42`) with a top HUD warning and a one-click **Revert Pose / Cancel Placement** button.
  - Selecting another part automatically reverts any unplaced intersecting part to its `lastValidPosition` / `lastValidRotation`.
- **Multi-Axis Exploded View (`Off`, `X`, `Y`, `Z`, `All`):**
  - Non-destructively separates all visible parts radially or along a single axis (`X`, `Y`, or `Z`) with dashed cyan trace lines back to their true assembled coordinates.
  - Co-planar parts fan out symmetrically in single-axis explode mode so internal pins, shafts, and gears are clearly visible.
- **Semantic Port & Axis Overlay (`Axes` Toggle):**
  - Renders color-coded 3D axis lines and origin markers (`pin_hole`, `shaft_bore`, `shaft_socket`, `pin_peg`) directly over each part in the viewport.
- **Keyboard Shortcuts:**
  - `W`: Move Tool (`translate`)
  - `E`: Rotate Tool (`rotate`)
  - Right-click the selected part: switch between Move and Rotate
  - `Esc` (with a ring selected): unselect the ring
  - `X`: Cycle Explode View (`off` → `x` → `y` → `z` → `all`)
  - `D` / `Cmd+D`: Duplicate selected part
  - `F`: Focus camera on selected part (or full assembly)
  - `Del` / `Backspace`: Delete selected part
  - `Esc`: Hide mate arrows if shown; otherwise exit Explode mode / revert intersecting part & deselect
  - Double-click selected part: Mate with lined-up holes / pins (shows direction arrows when there is more than one way); with nothing lined up, pick any hole to insert into

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
   - Automatically applies BVH collision compensation (`±180°` roll / yaw search) for asymmetric parts such as Smart Motors, capped pins, and corner brackets.
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
    - `dryRun: true` checks a layout without saving it, and `rejectIntersecting: true` saves nothing if anything overlaps.
    - `mirror: { plane, offsetMm }` also places every item's exact mirror image, using each part's own symmetry. Left/Right are swapped in labels, and parts centered on the plane aren't doubled.
  - **`get_part_details`:** returns a compact list of each part's connection points (position, axis, usable span, measured depth, through or blind, which way pegs stick out). The raw catalog record comes back only with `verbose: true`.
  - **App status:** every tool that changes the assembly reports `appSync`: `live` (the open app got it), `no-browser` (the app is running but nobody has it open) or `saved-to-file-only` (the app isn't running), with a hint.
  - **`capture_screenshot`:** returns a PNG of the 3D view rendered by the open app, either from the user's camera or a framed `iso` / `front` / `top` / `side` view. Gizmos, hole rings and the selection tint are left out, and the user's camera isn't moved.
- **Browser W3C WebMCP (`navigator.modelContext` in [`src/utils/webMcpTools.js`](file:///Users/adriangonsalves/projects/vexiq_builder/src/utils/webMcpTools.js)):**
  - Registers in-page tools for browser-hosted AI assistants.
- **Import / Export & Auto-Save:**
  - Saves valid assemblies to `localStorage` (`vexiq_builder_assembly_v2`) and `.vexiq-assembly-state.json`, plus supports `.vexiq.json` file export (`Save`) and import (`Load`).
  - The build history is saved with the build: `history` and `historyRev` fields in `public/assembly-state.json` and in exported `.vexiq.json` files (export `version: '1.1'`). localStorage keeps parts only.
  - Overlapping parts are left out of an export, as before, and the saved history then ends with a "Leave out overlapping parts" step, so replaying a file's history always gives exactly its parts.
  - Opening a file replaces the build and its history. A file without history (saved before this feature) opens with one "Starting assembly" step.

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
- **Branches:** undoing and then making a change keeps the undone steps as a branch. Nothing is ever deleted.
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

