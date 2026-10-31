## ADDED Requirements

### Requirement: A ring shows the axis it turns about
While a ring is hovered, selected or dragged, the system SHALL draw that ring's turning axis: a straight line in the ring's colour through the rings' centre, along the ring's axis, reaching past the part's bounding box on both sides. It SHALL be drawn over the parts, like the rings. Only one turning axis SHALL be shown at a time: the dragged ring's, else the selected ring's, else the hovered ring's. While its ring is selected or dragged, the turning axis SHALL be drawn thicker and with a soft glow, so it stands out from the anchor axes and from a merely hovered ring's axis. It SHALL be shown for every ring, including the single Joint ring of a part held on one axis line and the rings of a group or multi-selection. It SHALL go away when no ring is hovered, selected or dragged, and when Rotate mode ends.

#### Scenario: Hover a ring
- **WHEN** a free beam is in Rotate mode and the pointer rests on the Y ring
- **THEN** a green line along world Y is drawn through the rings' centre

#### Scenario: Selected ring wins over hover
- **WHEN** the X ring is selected and the pointer rests on the Z ring
- **THEN** only the X ring's turning axis is shown

#### Scenario: Joint ring
- **WHEN** a beam held by one pin is in Rotate mode and the user drags its ring
- **THEN** the turning axis drawn is the pin's axis line

#### Scenario: Nothing chosen
- **WHEN** the pointer leaves the rings and no ring is selected or dragged
- **THEN** no turning axis is shown

### Requirement: Anchor axes for the selected ring
When exactly one part is selected, it is held on two or more axis lines (it shows the X, Y and Z rings), and a ring is selected, the system SHALL highlight every **anchor axis** of the part that is parallel to that ring's axis (within 2°). An anchor axis is one of the axis lines that hold the part, as worked out in "What holds a part". Each highlighted anchor axis SHALL be drawn as a line in the joint highlight colour (orange) along the joint, reaching past the part's bounding box, thinner and fainter than the turning axis, and SHALL be clickable; the anchor axis (or default-centre line) under the pointer SHALL be drawn thicker and brighter. The line that the ring turns about right now SHALL be drawn as the ring's turning axis instead of as an anchor. When the rings have been moved off the part's default centre (see "Moving the rings onto an anchor axis"), the line through the default centre along the ring's axis SHALL also be shown, drawn dashed, so the user can go back to it. No anchor axes SHALL be shown when no ring is selected, when no anchor is parallel to the selected ring, for a part held on one axis line, or for a group or multi-selection.

#### Scenario: Plate held by pins along Z
- **WHEN** a plate held by three pins whose axes run along world Z is in Rotate mode and the user clicks the Z ring
- **THEN** the three pin axes are highlighted in orange

#### Scenario: Which line is chosen
- **WHEN** the plate's Z ring is selected and the pointer rests on one pin's axis
- **THEN** the Z turning axis is drawn thick with a glow, and that pin's axis is drawn thicker and brighter than the other pin's

#### Scenario: Ring with no parallel anchors
- **WHEN** the same plate's X ring is selected
- **THEN** no anchor axes are shown, only the X ring's turning axis

#### Scenario: Unselecting the ring
- **WHEN** anchor axes are shown and the user presses Esc
- **THEN** the ring is unselected and the anchor axes go away

#### Scenario: Free part
- **WHEN** a free beam's Y ring is selected
- **THEN** no anchor axes are shown

### Requirement: Moving the rings onto an anchor axis
Clicking a highlighted anchor axis (pressing and releasing on it without moving the pointer 5 px or more) SHALL move the centre of all the rings to the point on that axis nearest the centre of the part's bounding box. The part SHALL NOT move. The selected ring SHALL stay selected, the clicked line SHALL become its turning axis, and the anchor axes SHALL be shown again for the new centre. Turning that ring afterwards (dragging, typing an angle or the mouse wheel) SHALL turn the part about the anchor axis, so the pin or shaft on that axis stays on it and at the same depth. Clicking the dashed default-centre line SHALL move the rings back to the part's default centre. The ring angle labels SHALL NOT be reset by moving the centre. The chosen centre SHALL stay fixed in the part's frame across turns until another anchor or the default line is clicked, the selection changes, or Rotate mode is entered again; then it goes back to the default centre. When the part is no longer held on two or more axis lines after a turn is saved, its rings SHALL be shown as described for a free part or a part held on one axis line. Clicking an anchor axis SHALL NOT change the selection or switch between Move and Rotate, and a click on an anchor axis takes priority over a ring or part behind it.

#### Scenario: Swing a plate about one of its pins
- **WHEN** a plate held by two pins along Z is in Rotate mode, the user selects the Z ring, clicks the first pin's axis and drags the Z ring 90°
- **THEN** the plate turns 90° about the first pin's axis, the first pin is still in its hole, and the Z label reads 90°

#### Scenario: Turn into the other pin
- **WHEN** that turn ends with the plate overlapping a part it did not overlap before
- **THEN** the turn is put back as for any other turn and the rings stay on the chosen anchor axis

#### Scenario: Back to the default centre
- **WHEN** the rings are on a pin's axis and the user clicks the dashed line
- **THEN** the rings move back to the part's default centre and the part does not move

#### Scenario: Other rings move too
- **WHEN** the rings have been moved onto a pin's axis along Z and the user selects the X ring
- **THEN** the X ring is centred on the same point, and anchor axes parallel to X (if any) are highlighted

#### Scenario: New selection
- **WHEN** the rings are on an anchor axis and the user selects another part and then the first part again
- **THEN** the first part's rings are at its default centre

## MODIFIED Requirements

### Requirement: Free part turns around its center
When the selected part is not held, the system SHALL show three rings, one around each world axis (X, Y and Z), all centered on one turning point near the middle of the part, which stays fixed as the part turns. Dragging a ring SHALL turn the part around that ring's axis through that point.

The turning point SHALL be chosen so a turn of 90°, or any multiple of it, keeps every hole on the grid it was on:
- Start from the center of the part's own bounding box.
- For each world axis, find where the part's hole lines sit along that axis, measured on a 6.35 mm (half-pitch) grid. A hole line along X sets this for Y and Z, and so on. Offsets within 0.3 mm of each other count as one (CAD models are a little uneven). When the lines disagree, use the offset that most of them share; on a tie, the one nearest the world grid. When no hole line sets it for an axis, use the offset of another axis.
- The turning point SHALL be the point nearest the bounding-box center whose position along each world axis has that offset. It is always a hole centre, a point midway between two holes, or the centre of four holes, in the plane of each ring.
- When the part has no pin holes, shaft bores, sockets, pins, pegs or shafts, or when its hole lines are not within 2° of a world axis, the turning point SHALL be the bounding-box center.

The turning point SHALL be found when Rotate mode starts for the part and SHALL stay the same until the selection changes or Rotate mode is entered again. A part held on two or more axis lines SHALL use the same default turning point, and the user MAY move it onto one of the part's anchor axes (see "Moving the rings onto an anchor axis").

#### Scenario: Turn a free beam around Y
- **WHEN** a free 1x6 Beam is in Rotate mode and the user drags the Y ring a quarter turn
- **THEN** the beam turns 90° around the world Y axis, its center stays where it was, and its holes are still on the same 6.35 mm grid

#### Scenario: Any orientation
- **WHEN** the user turns a free part with the X ring and then the Z ring
- **THEN** both turns are applied one after the other

#### Scenario: Brain turned a quarter turn
- **WHEN** a free Robot Brain with Battery at [184.15, 69.7, 0], turned 180° about Y, is turned to 90° with the Y ring
- **THEN** it stays at [184.15, 69.7, 0], and its side holes are at z = ±6.35, ±19.05, ±31.75 and ±44.45, in line with pins at those places

#### Scenario: Part with no holes
- **WHEN** a free Chain Link (no holes, pins or shafts) is in Rotate mode
- **THEN** the rings are centered on the center of its bounding box

#### Scenario: Tire on an off-grid axle
- **WHEN** a free Tire (200 mm Travel) whose centre bore is at y = 23.87 mm (wheel-radius height) is in Rotate mode
- **THEN** the turning point is on the bore's line, so turning it about that line leaves it where it is

#### Scenario: Tilted part
- **WHEN** a free plate turned 30° about Y is in Rotate mode
- **THEN** the rings are centered on the center of its bounding box

### Requirement: Mouse wheel turns a selected ring
Clicking a ring (without dragging) SHALL select it and highlight it. While a ring is selected, the mouse wheel over the viewport SHALL turn the part around that ring by one snap step per wheel notch (5° when Rotation Snap is Free), in the direction of the scroll, and SHALL NOT zoom the camera. Clicking the selected ring again, clicking anywhere other than a ring or a shown anchor axis or default-centre line, pressing Esc, changing the selection or leaving Rotate mode SHALL unselect the ring, after which the wheel zooms again. Clicking an anchor axis or the default-centre line SHALL keep the ring selected.

#### Scenario: Scroll to turn
- **WHEN** Rotation Snap is 15°, the user clicks the X ring and scrolls three notches
- **THEN** the part turns 45° around X and the camera does not zoom

#### Scenario: Unselect the ring
- **WHEN** a ring is selected and the user presses Esc
- **THEN** the ring is no longer highlighted, the part stays selected, and the wheel zooms the camera

#### Scenario: Scroll after choosing an anchor
- **WHEN** the Z ring is selected, the user clicks a pin's anchor axis and scrolls two notches with Rotation Snap at 45°
- **THEN** the ring is still selected and the part turns 90° about the pin's axis
