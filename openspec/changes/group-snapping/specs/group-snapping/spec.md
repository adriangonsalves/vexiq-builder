## Purpose

Makes moving and turning a group, or several selected parts, as dependable as moving one part: the set stays on its own hole grid, pulls onto the holes it is dragged to, and never ends a move pressed into another part without the user seeing it.

## ADDED Requirements

### Requirement: A set keeps its own hole grid
Moving a set (a group or several selected parts) SHALL keep every part on the hole grid the set was on before the move. Drags and nudges SHALL move it in whole snap steps from where it was, as they do now. A centre value typed in the Inspector SHALL move the set by the whole number of snap steps that brings its centre nearest the typed value, and the field SHALL then show the centre's actual new value. With snap set to Free, typed values and drags SHALL move the set exactly as given. Turning a set (rotate rings, quick 90° turns) SHALL turn it about a point on the set's own hole grid near its centre, so that turns in multiples of 90° keep its holes on that grid. A set SHALL NOT be snapped to the world grid or to any other part's grid; lining up with other parts happens through their holes (see "A dragged set pulls onto holes").

#### Scenario: Typed centre stays on the grid
- **WHEN** snap is 0.5P, a group's centre X is 147.32 mm, and the user types 160
- **THEN** the group moves 12.7 mm (two 6.35 mm steps, the nearest to 12.68 mm), its parts' holes stay on the grid they were on, and the field shows 160.02

#### Scenario: Four quarter turns
- **WHEN** the user turns a group 90° about Y four times with the quick turn button
- **THEN** every part is back exactly where it started

#### Scenario: Turn keeps holes on the grid
- **WHEN** a group whose bounding-box centre is not on its hole grid is turned 90° about Y
- **THEN** its parts' holes are still on the grid they were on before, so it can still be pinned to the plate it came off

### Requirement: A dragged set pulls onto holes
While the Move arrows drag a set, its parts' pins, pegs, shafts and openings SHALL be matched against the openings, pins, pegs and shafts of visible parts outside the set, by the same rules as dragging one part: matching kinds, axes parallel within 2°, within the same pull distance and reach along the line. When a match is found, the whole set SHALL jump by the move that lines that pair up. When several pairs need the same move (within 0.25 mm), that move SHALL win over a single pair; otherwise the nearest pair wins. Parts inside the set SHALL NOT pull on one another. The set's parts SHALL keep their places relative to one another. Holding Alt while dragging SHALL turn the pull off, as for one part. The aligned-hole highlights SHALL show the pairs the set lines up with.

#### Scenario: Claw onto the wrist plate
- **WHEN** the user drags the "Claw" group, whose two 1x1 pins and corner-connector pegs face the Wrist 4x4 Plate's holes, to within a couple of millimetres of them
- **THEN** the whole Claw jumps so its pins and pegs are on the plate's hole lines

#### Scenario: Pairs inside the set ignored
- **WHEN** a group holds a beam and the pins seated in it, and is dragged
- **THEN** the beam and its pins never pull on each other

#### Scenario: Alt drags freely
- **WHEN** the user holds Alt while dragging a group near matching holes
- **THEN** the group does not jump onto them

### Requirement: A set lands clear or goes back
When a drag of a set ends: if the set is lined up on a hole line (it pulled onto holes) but overlaps a part outside it, it SHALL slide along that line to the nearest spot where it overlaps nothing, within the same reach as for one part. If it overlaps a part outside it that it did not overlap when the drag began, and no clear spot is found, the set SHALL go back to where it was before the drag, nothing SHALL be saved, no history step SHALL be made, and a message SHALL say "Can't place it there: it would overlap another part. Put back." Otherwise the move SHALL be saved as one step, as now. Overlaps with outside parts SHALL still be shown while dragging. Parts inside the set SHALL NOT count as overlapping one another.

#### Scenario: Pressed onto pins
- **WHEN** a group snaps onto a plate's hole lines one snap step too deep, so its pins' shoulders overlap the plate, and the user lets go
- **THEN** the group slides back along the line until its pins sit flush on the plate, and that is saved as one step

#### Scenario: Dropped into a part
- **WHEN** the user drops a group inside another beam without lining up with any hole
- **THEN** the group goes back to where it was before the drag, with the message, and no step is added

#### Scenario: Already overlapping
- **WHEN** a group that already overlaps a part is dragged a step and still overlaps that same part
- **THEN** the move is saved as usual, so the user can drag it free

### Requirement: The assistant follows the grid rules
The MCP `update_group` tool SHALL apply the same grid rules: `moveCentreTo` SHALL move the set by the whole number of snap steps (from the app's current snap setting; exact with Free) nearest the given centre, and its reply SHALL give the centre actually reached; `turn` SHALL turn about the point on the set's own hole grid used by the app. `moveBy` SHALL keep moving by exactly the distance given. The tool SHALL NOT pull sets onto holes.

#### Scenario: moveCentreTo on the grid
- **WHEN** snap is 0.5P and the assistant calls `update_group` with `moveCentreTo` 2 mm away from a whole number of steps
- **THEN** the set moves by the nearest whole number of 6.35 mm steps and the reply gives the centre it reached

#### Scenario: Turn on the hole grid
- **WHEN** the assistant turns a group 90° about Y four times with `update_group`
- **THEN** every part is back exactly where it started
