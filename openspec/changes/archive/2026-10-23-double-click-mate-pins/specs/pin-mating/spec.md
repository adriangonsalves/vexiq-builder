## Purpose

Lets the user finish a pin or shaft joint with a double-click once the aligned-hole highlights show it lines up, moving the selected part straight in until it seats, and choosing a direction with arrows when more than one is possible.

## ADDED Requirements

### Requirement: Mate directions come from the current highlights
The system SHALL derive the possible mate directions for the selected part from exactly the pin/shaft-to-opening pairs that the aligned-hole highlighting currently shows. Each pair gives one direction of travel for the selected part along the pair's shared axis: toward the opening when the selected part holds the pin or shaft, and toward the pin or shaft when the selected part holds the opening. Directions within 2° of each other SHALL count as one direction, and all pairs in that direction mate together in one move.

#### Scenario: Pin above a beam
- **WHEN** the selected Connector Pin lines up with one beam hole below it
- **THEN** there is exactly one mate direction, pointing down toward the beam

#### Scenario: Pin over two stacked beams
- **WHEN** the selected pin lines up with holes in two stacked beams below it
- **THEN** there is one mate direction, and mating in it uses both holes

#### Scenario: Beam over placed pins
- **WHEN** the selected beam's holes line up with pins already standing below it
- **THEN** there is one mate direction, pointing down toward the pins

#### Scenario: Corner connector with pins two ways
- **WHEN** the selected Triple 2x Wide, 2x2 Corner Connector has its +X pins lined up with one beam's holes and its +Z pins lined up with another beam's holes (nothing lined up with its −Z pins)
- **THEN** there are two mate directions, +X and +Z

#### Scenario: Nothing lined up
- **WHEN** no highlights are showing for the selected part
- **THEN** there are no mate directions

### Requirement: Double-click mates in the only direction
When the user double-clicks the selected part and it has exactly one mate direction, the system SHALL mate it in that direction immediately. The double-click counts when the selected part is anywhere under the pointer, including behind another part. When the selected part is under the pointer but another part is in front, a single click SHALL wait one double-click interval (about 350 ms) before selecting the front part, so the two clicks of a double-click don't move the selection away. Double-clicking SHALL NOT mate when the part is locked, when Explode view is on, or when the double-click lands on a gizmo arrow, plane or ring handle.

#### Scenario: Double-click a lined-up pin
- **WHEN** the user double-clicks a selected pin that lines up with one beam hole
- **THEN** the pin moves into the hole and stops seated

#### Scenario: Selected part hidden behind another part
- **WHEN** the selected pin is behind a beam from the current camera view, lined up with one of the beam's holes, and the user double-clicks where the pin is
- **THEN** the pin mates; the selection does not switch to the beam

#### Scenario: Single click on the part in front
- **WHEN** the selected pin is behind a beam and the user single-clicks there
- **THEN** after the double-click interval the beam becomes selected, as with any click

#### Scenario: Locked part
- **WHEN** the user double-clicks a selected part that is locked
- **THEN** nothing moves and a message says the part is locked

#### Scenario: Nothing to mate with
- **WHEN** the user double-clicks a selected part that has no mate directions
- **THEN** nothing moves and a message says nothing is lined up to mate with

### Requirement: Arrows to choose between several directions
When the user double-clicks the selected part and it has more than one mate direction, the system SHALL NOT move the part. Instead it SHALL show one large arrow per mate direction, starting at the part and pointing the way it would move, visible through other parts, and SHALL hide the move/rotate gizmo while the arrows are shown. Hovering an arrow SHALL highlight it. Clicking an arrow SHALL mate in that direction and remove the arrows. Pressing Esc, clicking anywhere other than an arrow, starting a drag, or changing the selection SHALL remove the arrows without moving anything.

#### Scenario: Two directions
- **WHEN** the user double-clicks a corner connector with mate directions +X and +Z
- **THEN** two large arrows appear, one pointing +X and one pointing +Z, and the gizmo is hidden

#### Scenario: Pick an arrow
- **WHEN** the user clicks the +Z arrow
- **THEN** the connector mates in +Z, the arrows disappear, and the gizmo comes back

#### Scenario: Cancel with Esc
- **WHEN** arrows are showing and the user presses Esc
- **THEN** the arrows disappear, nothing moves, and the part stays selected

#### Scenario: Click elsewhere
- **WHEN** arrows are showing and the user clicks on another part or empty space
- **THEN** the arrows disappear and nothing moves (the click selects or deselects as usual)

### Requirement: The move stops at contact
Mating SHALL first shift the selected part sideways by the small offset (at most the 0.25 mm alignment tolerance) that puts the pin or shaft exactly on the opening's axis, using the nearest lined-up pair in that direction. It SHALL then move the part straight along the direction until it first touches another part, and stop at the touching position (the same flush-contact boundary the drag uses, including its 0.25 × pitch flush seat). It SHALL keep looking for contact for as long as the pin or shaft is still inside one of the lined-up openings (until its trailing end would leave the far face of the farthest one), even after its leading end has come out the far side. The saved position MUST NOT overlap any part: if rounding the position puts it into contact, the part is backed off along the move until it is clear. The part SHALL NOT be rotated.

#### Scenario: Pin cap seats on the beam face
- **WHEN** a 0x2 Connector Pin above a beam hole is mated
- **THEN** it stops with its cap resting on the beam face, not inside the beam, and the part is not marked as intersecting

#### Scenario: Pin goes all the way in
- **WHEN** a 0x2 Connector Pin, turned cap-up, is mated down into a beam, so its tip comes out the bottom of the beam before the cap reaches the top face
- **THEN** it keeps going until the cap touches the beam, rather than stopping when its tip is flush with the bottom face

#### Scenario: No overlap after mating
- **WHEN** any mate completes
- **THEN** the part is not intersecting anything at its saved position (it is not shown as transparent/overlapping)

#### Scenario: Shaft bottoms out in the motor socket
- **WHEN** a shaft lined up above a Smart Motor's drive socket is mated
- **THEN** it stops when it touches the actual bottom of the socket

#### Scenario: Sideways correction
- **WHEN** a pin is 0.2 mm off the hole's axis (within the alignment tolerance) and is mated
- **THEN** it ends exactly on the hole's axis

#### Scenario: Already touching
- **WHEN** the part already intersects another part at its current pose
- **THEN** nothing moves and a message says it can't mate because it is already touching another part

### Requirement: Moves with nothing to stop them
If nothing is touched in the whole range searched for contact (while the pin or shaft is still in a lined-up opening), the move SHALL stop when the leading end of the pin or shaft is flush with the far face of the farthest lined-up opening in that direction. When the selected part holds the opening (for example a gear moving onto a placed shaft), this means the part stops where the shaft's end is flush with the far face of its farthest lined-up opening.

#### Scenario: Shaft through a beam and a gear
- **WHEN** a plain shaft lined up above a beam hole and a gear bore is mated
- **THEN** it stops with its lower end flush with the far face of the gear bore

#### Scenario: Gear onto a shaft
- **WHEN** a selected gear lined up above a placed plain shaft is mated
- **THEN** it slides down until the shaft's top end is flush with the gear's far face

### Requirement: Result is saved like a drag
A completed mate SHALL update the part's position the same way releasing a drag does: the new position is saved as the last valid pose, synced to the server, and the highlights recompute (mated pairs no longer show rings). A short message SHALL report the result, naming the part(s) mated with.

#### Scenario: Message and highlights after mating
- **WHEN** a pin is mated into a beam hole
- **THEN** a message reads like "Mated with 1x6 Beam", the ring on that hole disappears, and the saved assembly state has the pin's new position

#### Scenario: Server sync
- **WHEN** a mate completes
- **THEN** the new position is sent to the assembly server just like a drag release
