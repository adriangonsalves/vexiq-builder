# rotate-mode Specification

## Purpose

Lets the user turn the selected part with rings drawn around it, entered by right-clicking the part, so a part held by one pin or shaft swings around that joint while a free part turns around its own center, with visible, snapped and typeable angles.

## Requirements

### Requirement: Entering and leaving Rotate mode
Right-clicking the selected part SHALL switch between Move and Rotate mode. With a group or several parts selected, right-clicking any selected part SHALL do the same, and the rings turn the whole set about its centre. A right-click counts only when the pointer moves less than 5 px between press and release and a selected part is anywhere under the pointer (including behind another part); a right-drag SHALL keep panning the camera and SHALL NOT change the mode. The browser's context menu SHALL NOT open over the viewport. Right-clicking a part that is not selected, or empty space, SHALL do nothing. The `E` key, the context bar's Rotate button (see context-toolbar) and the assistant's viewport setting `transformMode: 'rotate'` SHALL enter the same Rotate mode; the `W` key and the context bar's Move button SHALL leave it.

#### Scenario: Right-click the selected part
- **WHEN** a beam is selected in Move mode and the user right-clicks it
- **THEN** Rotate mode is on, the Move arrows are gone, and the rotation rings are shown around the beam

#### Scenario: Right-click a selected group
- **WHEN** a group is selected in Move mode and the user right-clicks one of its parts
- **THEN** Rotate mode is on and the rings are shown around the group's centre

#### Scenario: Right-click again
- **WHEN** Rotate mode is on and the user right-clicks the selected part
- **THEN** Move mode is on again and the Move arrows are shown

#### Scenario: Right-drag pans
- **WHEN** the user holds the right button on the selected part and drags 40 px
- **THEN** the camera pans and the mode does not change

#### Scenario: No browser menu
- **WHEN** the user right-clicks anywhere in the viewport
- **THEN** the browser's context menu does not appear

#### Scenario: Keyboard shortcut
- **WHEN** a part is selected and the user presses `E`
- **THEN** the same rotation rings appear as with a right-click

#### Scenario: Context bar button
- **WHEN** a part is selected and the user taps Rotate on the context bar
- **THEN** the same rotation rings appear as with a right-click

### Requirement: When rotation is refused
The system SHALL show no rotation rings and SHALL show a message, without moving anything, when a selected part is locked ("Part is locked") or when Explode view is on. In those cases a right-click SHALL NOT switch the mode. A part held by pins or shafts on more than one axis line SHALL still show the X, Y and Z rings about its own hole grid, like a free part; whether the turn is kept is decided when it ends (see "Overlaps and saving").

#### Scenario: Locked part
- **WHEN** the user right-clicks a selected part that is locked
- **THEN** the mode does not change, no rings appear, and a message says the part is locked

#### Scenario: Held in two places
- **WHEN** the selected beam has pins in two of its holes that are also in another beam, and the user right-clicks it
- **THEN** Rotate mode is on and the X, Y and Z rings are shown around the beam

#### Scenario: Next part can turn
- **WHEN** Rotate mode is on (entered with `E`) with a locked part selected, and the user selects a free part
- **THEN** rings appear around the free part

### Requirement: What holds a part
A part SHALL count as held by a joint when one of its pins or its shaft sits inside another part's opening, or when another part's pin or shaft sits inside one of its openings. The same rules as the aligned-hole highlighting decide which pins and shafts fit which openings and when their axes line up (within 2° and 0.25 mm); "inside" means the pin or shaft and the opening overlap along the axis by more than 0.05 mm. Joints whose axes are on the same line SHALL count as one axis line. Any joint counts, whether or not the other part is itself held.

#### Scenario: Pin in a beam
- **WHEN** a Connector Pin has been mated into a beam hole and the pin is selected
- **THEN** the pin is held on one axis line, the hole's axis

#### Scenario: Shaft through a beam and a gear
- **WHEN** a selected shaft passes through a beam hole and a gear's bore on the same axis
- **THEN** it is held on one axis line

#### Scenario: Pin lined up but not inserted
- **WHEN** a pin is lined up above a beam hole (the hole is highlighted) but not inside it
- **THEN** the pin is not held

#### Scenario: Beam with two pins
- **WHEN** a selected beam has pins standing in two different holes
- **THEN** it is held on two axis lines

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

### Requirement: Held part turns around its joint
When the selected part is held on exactly one axis line, the system SHALL show a single ring around that line, centered on the point of the line closest to the part's center. Dragging it SHALL turn the part around that line, so each held pin or shaft stays on its opening's axis and at the same depth.

#### Scenario: Swing a beam on a pin
- **WHEN** a beam is held by one pin through its end hole and the user drags its ring 45°
- **THEN** the beam swings 45° around the pin's axis and the pin is still in the hole

#### Scenario: One ring only
- **WHEN** a held part is in Rotate mode
- **THEN** exactly one ring is shown and it is centered on the joint's axis

### Requirement: Angles shown, snapped and typed
Each ring SHALL show a label with the angle turned around it since Rotate mode started for this part (0° at the start, shown from −180° to 180°). While a ring is dragged, the system SHALL shade the slice between the start and the current angle. Rings SHALL show tick marks at each snap angle. Dragging and wheel turning SHALL snap the ring's angle to multiples of the Rotation Snap setting (15°, 45° or 90°); with Free, the angle follows the pointer without snapping. Clicking a ring's label SHALL let the user type an angle; Enter SHALL turn the part to exactly that angle around that ring (not snapped), and Esc or clicking away SHALL cancel the edit. A value that is not a number SHALL be ignored. The angles SHALL start at 0° again when the selection changes or Rotate mode is entered again.

#### Scenario: Snap to 15°
- **WHEN** Rotation Snap is 15° and the user drags a ring to about 37°
- **THEN** the part is turned 30° or 45°, whichever is nearer, and the label reads that angle

#### Scenario: Free angle
- **WHEN** Rotation Snap is Free and the user drags a ring to 37.4°
- **THEN** the part is turned 37.4°

#### Scenario: Type an angle
- **WHEN** the user clicks the Z ring's label, types 22.5 and presses Enter
- **THEN** the part turns so the Z label reads 22.5°

#### Scenario: Cancel typing
- **WHEN** the user types a value into a label and presses Esc
- **THEN** the part does not move and the label shows the previous angle

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

### Requirement: Overlaps and saving
Turning SHALL NOT be stopped by other parts while the ring is dragged or the wheel turns: when the part (or a part of the turning set) overlaps a part outside it, it SHALL be shown as overlapping. When the turn ends (a finished drag, a typed angle, or a pause in wheel turning) and the part or set overlaps a part it did not overlap when the turn began, the turn SHALL be put back: every turned part returns to where it was, the ring's angle goes back, nothing is saved, no history step is made, and a message says "Can't turn there: it would overlap another part. Put back." Otherwise the turn SHALL be saved the same way releasing a drag is: saved to the assembly, synced to the server, kept as the last valid pose only when not overlapping, and the aligned-hole highlights recomputed. Which joints hold the part SHALL be worked out again after each save.

#### Scenario: Turned into another part
- **WHEN** the user swings a pinned beam into a neighboring beam and lets go
- **THEN** the beam goes back to where it was, nothing is saved, and a message says it would overlap another part

#### Scenario: Saved like a drag
- **WHEN** the user finishes a ring drag that ends clear of other parts
- **THEN** the part's new rotation and position are in the saved assembly state and sent to the server

#### Scenario: Turned onto a joint
- **WHEN** a free part is turned so one of its pins ends up inside a beam hole, and the drag ends
- **THEN** the part now counts as held, and only that joint's ring is shown

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
