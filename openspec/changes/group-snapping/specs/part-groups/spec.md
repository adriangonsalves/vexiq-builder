## MODIFIED Requirements

### Requirement: A group moves and turns as one
When a group, or several loose parts, is selected, the Move arrows SHALL be shown at the centre of the selected parts' combined bounding box and the rotate rings at a point on the set's own hole grid near that centre, and dragging them SHALL move or turn every selected part together, keeping their places relative to one another. The snap settings SHALL apply to the move and turn of the whole set. The Inspector SHALL show the centre's position in mm and pitch, which can be typed and nudged with the nudge buttons, and the quick 90° turn buttons SHALL turn the set about the same hole-grid point as the rings. Parts in the moving set SHALL NOT count as overlapping one another; if the set ends up overlapping a part outside it, the parts it overlaps SHALL be marked as overlapping, as for a single part. How a set keeps its hole grid, pulls onto holes while dragged, is fitted, settles or is put back on release, and is mated by double-click and hole picking is set out in group-snapping. A set with any locked or hidden part SHALL show no Move arrows or rings and SHALL say "Part is locked" or "Some parts are hidden" when the user tries to move it. Each drag, typed value or nudge run SHALL be one history step covering every part that moved, labeled with the group's name (for example "Move Left Drive") or the part count ("Move 5 parts").

#### Scenario: Drag a group
- **WHEN** "Left Drive" is selected and the user drags its X arrow 25.4 mm
- **THEN** all its parts move 25.4 mm along X, and one undo moves them all back

#### Scenario: Turn a group
- **WHEN** "Claw" is selected and the user clicks the quick 90° turn about Y
- **THEN** every part of "Claw" turns 90° about a vertical line through a point on its hole grid near its centre, and pins stay in their holes

#### Scenario: Locked part in the group
- **WHEN** a group with one locked part is selected
- **THEN** no Move arrows are shown and trying to move it says "Part is locked"
