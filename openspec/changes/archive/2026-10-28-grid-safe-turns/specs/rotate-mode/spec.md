## MODIFIED Requirements

### Requirement: Free part turns around its center
When the selected part is not held, the system SHALL show three rings, one around each world axis (X, Y and Z), all centered on one turning point near the middle of the part, which stays fixed as the part turns. Dragging a ring SHALL turn the part around that ring's axis through that point.

The turning point SHALL be chosen so a turn of 90°, or any multiple of it, keeps every hole on the grid it was on:
- Start from the center of the part's own bounding box.
- For each world axis, find where the part's hole lines sit along that axis, measured on a 6.35 mm (half-pitch) grid. A hole line along X sets this for Y and Z, and so on. Offsets within 0.3 mm of each other count as one (CAD models are a little uneven). When the lines disagree, use the offset that most of them share; on a tie, the one nearest the world grid. When no hole line sets it for an axis, use the offset of another axis.
- The turning point SHALL be the point nearest the bounding-box center whose position along each world axis has that offset. It is always a hole centre, a point midway between two holes, or the centre of four holes, in the plane of each ring.
- When the part has no pin holes, shaft bores, sockets, pins, pegs or shafts, or when its hole lines are not within 2° of a world axis, the turning point SHALL be the bounding-box center.

The turning point SHALL be found when Rotate mode starts for the part and SHALL stay the same until the selection changes or Rotate mode is entered again.

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
