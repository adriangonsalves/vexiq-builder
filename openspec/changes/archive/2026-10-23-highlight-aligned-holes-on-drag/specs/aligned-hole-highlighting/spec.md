## Purpose

Shows the user, live and through solid parts, which openings line up with the pins and shafts of the part they are moving, so pin-to-hole and shaft-to-hole joints can be lined up from any camera angle.

## ADDED Requirements

### Requirement: Which parts match which openings
The system SHALL recognize two kinds of inserts and four kinds of openings, and SHALL only pair an insert with an opening it can actually go into:
- a **pin** (`pin_peg` port) matches **pin holes** (`pin_hole`) only;
- a **shaft** (a part whose catalog shaft type is `straight_shaft`, `capped_shaft`, or `motor_shaft`, other than a Rubber Shaft Collar) matches **pin holes**, **shaft bores** (`shaft_bore`), the **motor drive socket** (`shaft_socket`), and **rubber collar holes**.

Rubber Shaft Collars MUST be treated as openings (their shaft hole), never as shafts, even though the catalog tags them as shafts.

#### Scenario: Pin over a gear's center bore
- **WHEN** a Connector Pin's axis lines up with the center shaft bore of a 36 Tooth Gear
- **THEN** that bore is not highlighted

#### Scenario: Shaft over a beam hole
- **WHEN** a 4x Pitch Shaft's axis lines up with a round hole in a 1x6 Beam
- **THEN** that beam hole counts as a match

#### Scenario: Shaft over a gear bore
- **WHEN** a shaft's axis lines up with the center shaft bore of a 36 Tooth Gear
- **THEN** that bore counts as a match

#### Scenario: Shaft over the motor socket
- **WHEN** a shaft's axis lines up with the drive socket of a Smart Motor
- **THEN** that socket counts as a match

#### Scenario: Rubber collar is not a shaft
- **WHEN** a Rubber Shaft Collar is dragged over beam holes
- **THEN** no beam holes are highlighted because of the collar

#### Scenario: Rubber collar hole lines up with a shaft
- **WHEN** a Rubber Shaft Collar's hole lines up with a placed shaft and the collar is not yet on the shaft
- **THEN** the collar's hole counts as a match

### Requirement: Alignment rule
An insert and an opening that match, on two different visible parts, SHALL count as aligned when all of the following hold in world space:
- their axes are parallel or anti-parallel within 2°;
- the perpendicular distance between the two axis lines is at most 0.25 mm;
- the axial gap between the insert's length and the opening's depth along the shared axis is at most 4 × pitch (50.8 mm), where an overlap counts as a gap of 0.

#### Scenario: Pin directly above a hole
- **WHEN** a 0x2 Connector Pin is placed 20 mm above a beam hole with its axis on the hole's axis
- **THEN** the pin and that hole count as aligned

#### Scenario: Insert offset sideways from the opening
- **WHEN** a pin's or shaft's axis is parallel to an opening's axis but 1 mm to the side
- **THEN** they do not count as aligned

#### Scenario: Insert tilted relative to the opening
- **WHEN** a pin's or shaft's axis passes through an opening's center but is tilted 10° from the opening's axis
- **THEN** they do not count as aligned

#### Scenario: Opening too far along the axis
- **WHEN** an opening lies on a pin's or shaft's axis line but more than 50.8 mm beyond its end
- **THEN** they do not count as aligned

#### Scenario: Insert and opening on the same part
- **WHEN** a part has both a pin and a hole that are coaxial with each other
- **THEN** that pair is never treated as aligned

### Requirement: Openings are highlighted only while the insert is outside
An aligned opening SHALL be highlighted only while the pin or shaft is still completely outside it. As soon as the insert's length along the shared axis overlaps the opening's depth by more than 0.05 mm, that opening MUST NOT be highlighted. Each opening is judged on its own, so other aligned openings that the insert has not yet reached stay highlighted.

#### Scenario: Pin starts to enter the hole
- **WHEN** the user drags an aligned pin until its tip just enters the hole
- **THEN** that hole's highlight disappears

#### Scenario: Shaft starts to enter the hole
- **WHEN** the user drags an aligned shaft until its end just enters a beam hole
- **THEN** that hole's highlight disappears

#### Scenario: Insert pulled back out
- **WHEN** the user drags a pin or shaft back along its axis until it no longer overlaps the opening
- **THEN** that opening is highlighted again

#### Scenario: Shaft through a stack
- **WHEN** a shaft lines up with holes in two parallel beams and has entered only the first beam
- **THEN** the first beam's hole is not highlighted and the second beam's hole is highlighted

#### Scenario: Touching the face is still outside
- **WHEN** a pin's end sits exactly on a hole's face without going in
- **THEN** that hole is still highlighted

#### Scenario: Fully assembled pin selected
- **WHEN** the user selects a pin that is already inside every hole it lines up with
- **THEN** no holes are highlighted

### Requirement: Highlight openings aligned with the moving part's pins and shafts
When the selected part has one or more pins or is a shaft, the viewport SHALL highlight every matching opening on other visible parts that is aligned with it and that it has not entered.

#### Scenario: Dragging a pin over a beam
- **WHEN** the user drags a Connector Pin with the Move gizmo until its axis lines up with a hole in a placed beam
- **THEN** that beam hole is highlighted while the pin stays aligned and outside the hole

#### Scenario: Several holes in a stack
- **WHEN** a pin lines up with holes in two stacked beams, both within reach, and has entered neither
- **THEN** both holes are highlighted

#### Scenario: Dragging a shaft toward a frame and gear
- **WHEN** the user drags a shaft so it lines up with a beam hole and a gear's bore behind it
- **THEN** both the beam hole and the gear bore are highlighted

#### Scenario: Moving out of alignment
- **WHEN** the user keeps dragging so the pin or shaft no longer lines up with the opening
- **THEN** that opening's highlight is removed

### Requirement: Highlight the moving part's openings aligned with placed pins and shafts
When the selected part has one or more openings, the viewport SHALL highlight each of those openings that is aligned with a matching pin or shaft on another visible part and that the pin or shaft has not entered.

#### Scenario: Dragging a beam over placed pins
- **WHEN** the user drags a beam so one of its holes lines up with a pin already standing on a plate
- **THEN** that hole on the dragged beam is highlighted

#### Scenario: Dragging a gear onto a placed shaft
- **WHEN** the user drags a gear so its center bore lines up with a placed shaft that does not yet pass through it
- **THEN** the gear's bore is highlighted

#### Scenario: Dragging a motor over a placed shaft
- **WHEN** the user drags a Smart Motor so its drive socket lines up with a placed shaft
- **THEN** the motor's socket is highlighted

#### Scenario: Part with both pins and holes
- **WHEN** the selected part has both pins and holes (for example a corner connector)
- **THEN** both rules apply at the same time and every qualifying opening is highlighted

### Requirement: Solid rings on the surface, faint ring through parts
Each highlighted opening SHALL be shown in two ways:
- a solid ring drawn on the receiving part's surface, at each face of the opening (both faces for a through opening, only the entry face for a blind opening such as the motor socket), hidden by parts in front of it like any other surface;
- a faint (about 30% opacity) ring at the entry face (the face toward the pin or shaft), drawn on top of all part geometry so the opening can still be found when it is behind the selected part or other parts, from any camera angle.

#### Scenario: Entry face in view
- **WHEN** an aligned hole's entry face is visible from the camera
- **THEN** a solid ring is shown on that face

#### Scenario: Entry face pointing away from the camera
- **WHEN** the beam is selected and the placed pin lined up with its hole is behind the beam
- **THEN** a solid ring is shown on the beam face toward the camera, and a faint ring shows the entry face through the beam

#### Scenario: Hole hidden behind the dragged part
- **WHEN** an aligned hole is directly behind the part being dragged from the current camera view
- **THEN** the hole's faint ring is still visible on screen

#### Scenario: Hole inside a stack of plates
- **WHEN** an aligned hole is in a plate covered by another plate
- **THEN** only the faint ring is visible, through the covering plate

#### Scenario: Blind socket
- **WHEN** a Smart Motor's drive socket is highlighted
- **THEN** only the entry-face rings are drawn (no ring at the socket's inner end)

### Requirement: Highlight ring sits on the opening's rim at the face toward the insert
Each highlighted opening SHALL be marked with a ring that lies on the opening's rim (sized to the opening's edge, not drawn smaller inside it), facing along the opening's axis, on the face of the part where the pin or shaft will enter — the face pointing toward that pin or shaft. This applies in both directions (when the opening is on another part, and when it is on the selected part). The ring MUST NOT be drawn at the middle of the hole's depth, and no marker is drawn at the hole's center. The highlight color MUST be distinct from the existing selection, collision, and `Axes` overlay colors.

A through hole in a part that is at most 7 mm thick along the hole's axis (beams, plates, gears) SHALL be treated as running from one face of the part to the other, so a pin or shaft approaching from either side gets the ring on its own side.

Once the receiving part's 3D model has loaded, the ring SHALL be projected onto that part's actual surface just outside the rim, on the side facing the pin or shaft (for example the recessed floor around a beam hole, or the thin web around a gear's spoke holes), rather than floating at the part's outer bounding box. The same surface position SHALL be used for the "outside the opening" test, so the ring disappears exactly when the pin or shaft reaches the surface it is drawn on. Until the model has loaded, or if no surface is found, the ring uses the face position from the catalog data.

#### Scenario: Ring on the recessed surface around a beam hole
- **WHEN** a pin is lined up above a beam hole whose rim is recessed below the beam's outer face
- **THEN** the ring lies on the recessed surface around the rim, not at the outer face

#### Scenario: Pin between the outer face and the recessed surface
- **WHEN** a pin's tip is below the beam's outer face but still above the recessed surface around the hole
- **THEN** the ring is still shown

#### Scenario: Model still loading
- **WHEN** a part's 3D model has not finished loading
- **THEN** its rings use the catalog face position, and move onto the measured surface once the model loads

#### Scenario: Ring on the top face of a beam
- **WHEN** a pin lined up above a beam hole is selected
- **THEN** a ring lies on the rim of that hole on the beam's top face, not halfway through the beam

#### Scenario: Pin approaching from the other side
- **WHEN** the selected beam has a placed pin lined up below one of its holes
- **THEN** the ring lies on that hole's rim on the beam's bottom face

#### Scenario: Plate hole from below
- **WHEN** a pin is lined up below a 12x12 Plate hole
- **THEN** the ring lies on the hole's rim on the plate's bottom face, and it disappears as soon as the pin's tip passes that face

#### Scenario: Ring sized to the opening
- **WHEN** a gear's center shaft bore and a beam pin hole are both highlighted
- **THEN** each ring matches the rim of its own opening (the bore's ring is smaller than the pin hole's)

### Requirement: When highlights are shown, updated, and cleared
Highlights SHALL be computed for the currently selected part only, and SHALL:
- update continuously while the part is dragged with the Move or Rotate gizmo;
- remain shown after the drag ends for as long as the part stays selected;
- update when the selected part's position or rotation changes by any other means (Inspector nudge buttons, Snap & Mate, MCP or server updates) or when other parts are added, moved, hidden, or removed;
- clear when the part is deselected, the selected part is hidden, or Explode view is turned on.

#### Scenario: Release after lining up
- **WHEN** the user lines up a pin with a hole and releases the mouse before the pin enters it
- **THEN** the hole stays highlighted while the pin remains selected

#### Scenario: Deselect
- **WHEN** the user clicks empty space or presses Esc to deselect
- **THEN** all highlights are removed

#### Scenario: Nudge into alignment
- **WHEN** the user uses the Inspector +X button and the selected pin ends up aligned with a hole
- **THEN** that hole becomes highlighted

#### Scenario: Explode view
- **WHEN** the user turns on Explode view while highlights are shown
- **THEN** all highlights are removed

#### Scenario: Rotating into alignment
- **WHEN** the user rotates a selected pin or shaft with the Rotate gizmo until its axis lines up with an opening
- **THEN** that opening becomes highlighted during the rotation

### Requirement: Highlighting does not change the assembly
Highlighting SHALL be display-only. It MUST NOT move, snap, or rotate parts, MUST NOT change saved assembly state, and MUST NOT affect collision checks or part selection by clicking.

#### Scenario: Clicking through a highlight
- **WHEN** the user clicks on a spot where a highlight ring is drawn over a part
- **THEN** selection behaves exactly as if the highlight were not there

#### Scenario: Saved state unchanged
- **WHEN** highlights are shown and the assembly is saved or synced to the server
- **THEN** the saved state contains no highlight data and part positions are unchanged
