## MODIFIED Requirements

### Requirement: When rotation is refused
The system SHALL show no rotation rings and SHALL show a message, without moving anything, when a selected part is locked ("Part is locked") or when Explode view is on. In those cases a right-click SHALL NOT switch the mode. A part held by pins or shafts on more than one axis line SHALL still show the X, Y and Z rings about its own hole grid, like a free part; whether the turn is kept is decided when it ends (see "Overlaps and saving").

When those axis lines are parallel (within 2°) and all lie in one row (one plane, every line within 0.25 mm of it), the part SHALL instead turn about the row: the turning point SHALL be on the line that runs along the row, square to the pins, crossing every held line, placed along the pins at the middle of where each pin, peg or shaft overlaps its opening (the average over the joints). A turn of 180° about that line SHALL leave every held pin, peg or shaft in its opening. The ring for that line SHALL replace the world ring it is within 2° of; when it is within 2° of none, it SHALL be shown as a fourth ring. The other rings SHALL turn about the same point. The turning point SHALL stay the same until the selection changes or Rotate mode is entered again, as for a free part.

#### Scenario: Locked part
- **WHEN** the user right-clicks a selected part that is locked
- **THEN** the mode does not change, no rings appear, and a message says the part is locked

#### Scenario: Held in two places
- **WHEN** the selected beam has pins in two of its holes that are also in another beam, and the user right-clicks it
- **THEN** Rotate mode is on and the X, Y and Z rings are shown around the beam

#### Scenario: Next part can turn
- **WHEN** Rotate mode is on (entered with `E`) with a locked part selected, and the user selects a free part
- **THEN** rings appear around the free part

#### Scenario: Flip a corner connector on its pegs
- **WHEN** a 2x Wide, 2x2 Corner Connector has both pegs in two holes of a 2x4 Beam, and the user turns it 180° with the ring along the row of pegs
- **THEN** both pegs are back in the same two holes, now from the other face of the beam, and the turn is kept with no overlap

#### Scenario: Turning point at the pins' depth
- **WHEN** a part is held by two pins in a row that sit 3.2 mm deep in a 6.35 mm thick beam
- **THEN** the turning point is on the row's line at the middle of that 3.2 mm overlap, not on the half-pitch grid

#### Scenario: Not a row
- **WHEN** a plate is held by three pins whose lines are not all in one plane
- **THEN** the X, Y and Z rings turn about the plate's hole grid as before

#### Scenario: Tilted row
- **WHEN** a part held by a row of pins is turned 30° about the pins' axis, so the row isn't along any world axis
- **THEN** a fourth ring is shown for the row's line, and the X, Y and Z rings turn about the same point

### Requirement: Anchor axes for the selected ring
When exactly one part is selected, it shows the X, Y and Z rings (it is free, or held on two or more axis lines), and a ring is selected, the system SHALL highlight every **anchor axis** of the part that is parallel to that ring's axis (within 2°). An anchor axis is a line through one of the part's own holes, pins, pegs or shafts, each line once; the axis lines that hold the part (as worked out in "What holds a part") are anchor axes too. Each highlighted anchor axis SHALL be drawn as a line in the joint highlight colour (orange) along it, reaching past the part's bounding box, thinner and fainter than the turning axis, and SHALL be clickable; a line that holds the part SHALL be drawn stronger than one through a hole that holds nothing; the anchor axis (or default-centre line) under the pointer SHALL be drawn thicker and brighter. The line that the ring turns about right now SHALL be drawn as the ring's turning axis instead of as an anchor. When the rings have been moved off the part's default centre (see "Moving the rings onto an anchor axis"), the line through the default centre along the ring's axis SHALL also be shown, drawn dashed, so the user can go back to it. No anchor axes SHALL be shown when no ring is selected, when no anchor is parallel to the selected ring, for a part held on one axis line, or for a group or multi-selection.

#### Scenario: Plate held by pins along Z
- **WHEN** a plate held by three pins whose axes run along world Z is in Rotate mode and the user clicks the Z ring
- **THEN** the three pin axes are highlighted in orange, stronger than the lines through the plate's other holes

#### Scenario: Which line is chosen
- **WHEN** the plate's Z ring is selected and the pointer rests on one pin's axis
- **THEN** the Z turning axis is drawn thick with a glow, and that pin's axis is drawn thicker and brighter than the other lines

#### Scenario: Ring with no parallel anchors
- **WHEN** a 1x6 Beam's ring that runs along the beam's length is selected (no hole runs that way)
- **THEN** no anchor axes are shown, only that ring's turning axis

#### Scenario: Unselecting the ring
- **WHEN** anchor axes are shown and the user presses Esc
- **THEN** the ring is unselected and the anchor axes go away

#### Scenario: Free part
- **WHEN** a free 1x6 Beam's ring along its holes is selected
- **THEN** a line through each of its six holes is shown, and clicking the end hole's line and turning the ring swings the beam about that hole
