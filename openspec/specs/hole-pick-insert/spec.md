# hole-pick-insert Specification

## Purpose

Lets the user insert the selected pin, peg or shaft part into any hole in the model by pointing at the hole, turning and lining the part up automatically, including parts with several pins whose pattern is matched to the receiving part's orientation.

## Requirements

### Requirement: Starting and leaving hole picking
Hole picking SHALL start when the user double-clicks a selected part that has no mate directions and has at least one pin, peg or shaft (see pin-mating). It SHALL also start, alongside the mate arrows, when the part's mate directions come only from hole-to-hole pairs and its pins, pegs or shafts line up with nothing. Then clicking an arrow mates along it and ends picking, and clicking a highlighted hole inserts and removes the arrows. It SHALL NOT start for a locked part or in Explode view (the existing messages apply).
While picking:
- a banner SHALL name the part and the controls (point at a hole, wheel or `R` for other fits, click to insert, `Esc` to cancel);
- the move/rotate gizmo SHALL be hidden;
- the camera SHALL still orbit, pan and zoom, except that the wheel steps through fits while a hole is highlighted;
- the part SHALL stay where it is until a hole is clicked.

Picking SHALL end without changing anything when the user presses `Esc`, clicks where no hole is highlighted, selects another part (in the viewport or the Outliner), changes Move/Rotate mode, turns Explode view on, or when the selected part is changed or removed by undo, redo, the timeline or MCP.

#### Scenario: Start
- **WHEN** a 0x2 Connector Pin is selected far from any beam and the user double-clicks it
- **THEN** the banner appears, the gizmo is hidden, and nothing moves

#### Scenario: Cancel
- **WHEN** the user is picking and presses `Esc`
- **THEN** the banner and preview go away, the gizmo comes back, and the history has no new step

#### Scenario: Picking alongside an arrow
- **WHEN** a corner connector whose holes line up with a beam (pegs lined up with nothing) is double-clicked
- **THEN** the picking banner appears together with the stacking arrow

### Requirement: Hovering a hole
While picking, the system SHALL highlight the one hole under or nearest the cursor, within about 24 screen pixels of one of its faces, that at least one of the selected part's pins, pegs or shafts fits, using the same fit rules as the hole highlights:
- a pin or peg fits pin holes;
- a shaft fits pin holes, shaft bores, the Smart Motor socket and rubber collar holes.

Holes on hidden parts and on the selected part itself SHALL NOT be offered. When several hole faces are near the cursor, the one nearest the camera SHALL win. The highlighted face SHALL decide the side the part comes in from: the part goes in through that face. A hole that already has a pin or shaft seated in it SHALL be shown as taken, in a different color, and clicking it SHALL do nothing except show a message saying it already has a part in it.

#### Scenario: Hover a beam hole
- **WHEN** the user moves the cursor over the top face of a hole in a beam
- **THEN** that hole's top rim is highlighted and the part is previewed coming in from above

#### Scenario: Other side
- **WHEN** the user turns the camera and hovers the same hole's bottom face
- **THEN** the preview comes in from below

#### Scenario: Taken hole
- **WHEN** the user hovers a hole that already has a connector pin in it
- **THEN** the hole is shown as taken, and clicking it shows "That hole already has a part in it" without moving anything

### Requirement: Lined-up preview
For a highlighted hole, the system SHALL show a see-through copy of the selected part, posed as follows.
- **Axis:** one of its pins, pegs or shafts (the anchor) is on the hole's axis, pointing in through the highlighted face, with the end that goes in just outside the face. That end must be an end that sticks out of its part.
- **Turn:** the part is turned as needed for this, whatever its current orientation.
- **Roll:** the roll around the hole's axis is set relative to the receiving part. The selected part's own axes are lined up with the receiving part's axes across the hole, then turned by a multiple of 90° around the hole's axis. A pattern on a receiving part turned 30° is therefore shown turned 30°.
- **Markers:** every other pin, peg or shaft of the selected part that points the same way as the anchor (parallel within 2°) is marked where its axis meets the plane of the highlighted face. Green means a matching hole on another part lines up with it at that pose; red means none does. The anchor is always green. Pins pointing other ways, like a corner connector's pegs on its other face, are not marked or counted.

#### Scenario: Pin into an angled plate
- **WHEN** an upright 0x2 Connector Pin is picked into a hole of a plate turned 30° about the X axis
- **THEN** the preview shows the pin tilted 30°, lined up with the hole, outside its face

#### Scenario: Pattern turned with the receiving part
- **WHEN** a 2x2 corner connector (two pegs 12.7 mm apart) standing upright is picked into a beam turned 30° in its own plane
- **THEN** the preview's two pegs lie along the beam's 30° line of holes, both marked green

#### Scenario: Pin with no hole
- **WHEN** a part with two pegs is picked into the last hole of a beam so that the second peg falls past the beam's end
- **THEN** the anchor peg is green and the second peg is red

### Requirement: Choosing among fits
For a highlighted hole, the system SHALL work out every fit: each of the selected part's pins, pegs or shafts that fits the hole and has an end sticking out on the side going in, combined with each of the four 90° rolls. It SHALL also search the holes parallel to the highlighted one, out to the selected part's widest pin spread across the axis (the largest distance from the pin going in to another parallel pin, plus the 0.25 mm alignment tolerance) and within 2 pitch along the axis. It SHALL add every roll that puts another of the part's parallel pins exactly on such a hole. That way a hole pattern that is not square to the receiving part, like the angled face of a 30° corner connector, can still be filled. Fits SHALL be ordered by how many pins land in holes (most first), then by the smallest change from the part's current orientation. The first fit SHALL be previewed. The mouse wheel or `R` SHALL step to the next fit, and `Shift+R` to the previous one. The banner SHALL say which fit is shown and how many pins land in holes (for example "Fit 2 of 8 · 2 of 2 pins in holes"). Fits that give the same pose SHALL be listed once. Moving to another hole SHALL start again from that hole's best fit.

#### Scenario: Best fit first
- **WHEN** a corner connector is picked into a beam hole where only one roll puts both pegs in holes
- **THEN** that roll is shown first with both pegs green

#### Scenario: Pattern at an angle to the receiving part
- **WHEN** a 2x Wide 2x3 Corner Connector (two pegs 12.7 mm apart) is picked into one of the two angled holes of a 2x Wide 30 Degree Left 1x2 Corner Connector, whose hole line runs 30° off the part's own axes
- **THEN** the first fit has both pegs green, and inserting it seats both pegs

#### Scenario: Step through fits
- **WHEN** the user scrolls the wheel once while a hole is highlighted
- **THEN** the next fit is previewed and the camera does not zoom

### Requirement: Inserting
Clicking a highlighted hole that is not taken SHALL:
1. turn the selected part and place it at the previewed pose, just outside the face;
2. push it in along the hole's axis until it first touches another part, using the same contact and flush rules as double-click mating;
3. end picking.

The insert SHALL be saved as one history step labeled "Insert <part> into <receiving part>", so one undo puts the part back where and how it was. A fit with red pins SHALL still be inserted. If the part then overlaps another part, it SHALL be saved and shown as overlapping, as after any drag. If the part already overlaps something at the starting pose outside the face, nothing SHALL move and a message SHALL say the way in is blocked.

#### Scenario: Insert a pin
- **WHEN** the user clicks a highlighted beam hole while picking for a 0x2 Connector Pin
- **THEN** the pin turns to the hole's axis, goes in, stops with its cap on the beam face, and the history gains "Insert 0x2 Connector Pin #1 into 2x12 Beam #1"

#### Scenario: Undo an insert
- **WHEN** the user presses Ctrl/Cmd+Z after an insert
- **THEN** the part is back at its old position and rotation

#### Scenario: Insert a capped shaft
- **WHEN** a 2x Pitch Capped Shaft is picked into a beam hole from one face
- **THEN** it slides in shaft-first and stops with its cap resting on the hole's lip

#### Scenario: Way in blocked
- **WHEN** the starting pose just outside the face overlaps another part (e.g. a wall right next to the hole)
- **THEN** nothing moves and the message says the way in is blocked
