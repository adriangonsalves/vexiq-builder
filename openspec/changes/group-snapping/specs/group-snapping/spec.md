## Purpose

Makes moving and turning a group, or several selected parts, as dependable as moving one part: the set stays on its own hole grid, pulls onto the nearby holes it is dragged to, is fitted onto them when let go, and never ends a move pressed into another part without the user seeing it.

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
While the Move arrows drag a set, its parts' pins, pegs, shafts and openings SHALL be matched against the openings, pins, pegs and shafts of visible parts outside the set, by the same rules as dragging one part (matching kinds, axes parallel within 5°, the same 3.5 mm sideways pull and settle rules), except that the two SHALL be within 25.4 mm (1 inch) of each other along the line, not the 152.4 mm a single part reaches. Only the set's free outer features SHALL take part: an opening of a set part with a pin, peg or shaft of another set part seated in it SHALL be left out, and a set pin, peg or shaft SHALL be left out when no part of its length is outside the set's own openings it is seated in. A pull that would put the set back exactly where the drag started (within 0.25 mm) SHALL NOT be taken until the set has, during this drag, once been more than 3.5 mm from its start; the next best pull, if any, is taken instead. A pair between 0.1° and 5° off parallel SHALL first turn the whole set, about the point of its matched pin, peg, shaft or hole, so the axes are exactly parallel, with the same choice rules as for one part (see drag-hole-snap: "Small tilts are straightened while dragging"); pairs 5° or more off SHALL NOT turn or pull it. When a match is found, the whole set SHALL jump by the move that lines that pair up. When several pairs need the same move (within 0.25 mm), that move SHALL win over a single pair; otherwise the nearest pair wins. Parts inside the set SHALL NOT pull on one another. The set's parts SHALL keep their places relative to one another. Holding Alt while dragging SHALL turn the pull off, as for one part. The aligned-hole highlights SHALL show the pairs the set lines up with.

#### Scenario: Claw onto the wrist plate
- **WHEN** the user drags the "Claw" group, whose two 1x1 pins and corner-connector pegs face the Wrist 4x4 Plate's holes, to within a couple of millimetres of them
- **THEN** the whole Claw jumps so its pins and pegs are on the plate's hole lines

#### Scenario: Tilted group straightened
- **WHEN** the "Claw" group is 2° off square to the Wrist 4x4 Plate and is dragged onto it
- **THEN** the whole Claw turns square to the plate and its pins and pegs line up with the plate's holes

#### Scenario: Pairs inside the set ignored
- **WHEN** a group holds a beam and the pins seated in it, and is dragged
- **THEN** the beam and its pins never pull on each other

#### Scenario: Filled holes and buried pins left out
- **WHEN** a group holds a 1x6 Beam with a pin through each end hole, one pin sticking out 6 mm on one side and the other cut flush on both faces by a second beam of the group, and is dragged over a plate
- **THEN** the sticking-out pin and the four empty holes of the beam can pull onto the plate, and the two filled holes and the flush pin never do

#### Scenario: Out of reach along the line
- **WHEN** a group is dragged so one of its pins is 0.3 mm off the line of a plate hole that is 30 mm away along that line
- **THEN** the group is not pulled (one part in the same place would be)

#### Scenario: Sliding off its pins doesn't stick
- **WHEN** snap is Free and a group seated on a plate's pins is dragged sideways, across the pins' line, 2 mm and then 5 mm
- **THEN** it is not pulled back onto the pins at 2 mm, and at 5 mm it stays where it is dragged, overlap shown

#### Scenario: Pushed back on after leaving
- **WHEN** a group is pulled off its pins 10 mm along their line and then dragged back toward them
- **THEN** it pulls onto the same pins again

#### Scenario: Alt drags freely
- **WHEN** the user holds Alt while dragging a group near matching holes
- **THEN** the group does not jump onto them

### Requirement: A set lands clear or goes back
When a drag of a set ends, these SHALL happen in order:
1. If the set is lined up on a hole line (it pulled onto holes) but overlaps a part outside it, it SHALL slide along that line to the nearest spot where it overlaps nothing, within the same reach as for one part.
2. The set SHALL be fitted (see "A set is fitted on release").
3. If it then overlaps a part outside it that it did not overlap when the drag began, the set SHALL go back to where it was before the drag, undoing any straightening turn and fit too, nothing SHALL be saved, no history step SHALL be made, and a message SHALL say "Can't place it there: it would overlap another part. Put back."

Otherwise the move (with any fit) SHALL be saved as one step, as now. Overlaps with outside parts SHALL still be shown while dragging. Parts inside the set SHALL NOT count as overlapping one another.

#### Scenario: Pressed onto pins
- **WHEN** a group snaps onto a plate's hole lines one snap step too deep, so its pins' shoulders overlap the plate, and the user lets go
- **THEN** the group slides back along the line until its pins sit flush on the plate, and that is saved as one step

#### Scenario: Dropped into a part
- **WHEN** the user drops a group inside another beam without lining up with any hole
- **THEN** the group goes back to where it was before the drag, with the message, and no step is added

#### Scenario: Already overlapping
- **WHEN** a group that already overlaps a part is dragged a step and still overlaps that same part
- **THEN** the move is saved as usual, so the user can drag it free

### Requirement: A set is fitted on release
When a drag of a set ends and the set has, during this drag, once been more than 3.5 mm from its start, the system SHALL run the Fix assembly fit on the set as the moving block, against the visible parts outside it, from the pose it was dropped at (after the slide of step 1). It SHALL use Fix assembly's rules for pairing (axes within 20°, lines within 4.5 mm, within 4 mm along the line or overlapping), for lining up (one rigid turn and move of the whole set, outliers dropped, made square when within 1.5°), for its limits (more than 25° or 10 mm is not done) and for seating (out of an overlap to the nearest clear spot within 4 mm, or in until it touches, at whole quarter pitches). Unlike Tools → Fix assembly, the set SHALL always be the part that moves, and it SHALL be fitted even when it holds only some members of a group whose other members are outside it. When no pairs are found, the pairs are already lined up and seated, or the fit is over the limits, the set SHALL stay as dropped and no message about the fit SHALL be shown. A fit that is made SHALL be part of the drag's one history step, and the step's label SHALL say how many pins and holes it lined up (e.g. "Move Claw. Lined up 6 pins and holes with Wrist 4x4 Plate"). Alt held at release SHALL skip the fit, as it skips the pulls.

#### Scenario: Dropped a little tilted and short
- **WHEN** the "Claw" group is dropped 3° off square to the Wrist 4x4 Plate, its pins 2 mm short of the plate and 1.5 mm off its hole lines
- **THEN** it is turned square, lined up and pushed in until it sits on the plate, saved as one "Move Claw" step that names the plate

#### Scenario: Too far for a fit
- **WHEN** a group is dropped 30° off from any part it could fit
- **THEN** it stays where it was dropped (or is put back if it overlaps something new), with no fit message

#### Scenario: Small nudge kept
- **WHEN** snap is Free and a group seated on pins is dragged 2 mm sideways and let go
- **THEN** it is not fitted back onto the pins (it is put back only if it now overlaps them)

### Requirement: Moving part of a group
Moving some, but not all, members of a named group (a selection of two or more parts made from the Outliner) SHALL NOT change any part's `groupId` or `groupName`. The members not selected SHALL stay where they are and SHALL count as parts outside the set: overlaps with them are shown and put back like any other, and the set can pull onto and be fitted to their holes. A single selected member of a group SHALL follow the single-part drag rules.

#### Scenario: Two parts of the Claw dragged out
- **WHEN** two parts of the "Claw" group are selected in the Outliner and dragged along their pins' line until clear of the rest of the Claw
- **THEN** they move, the other Claw parts stay where they were, and all of them, moved or not, are still in the Claw group

#### Scenario: Through a member's pins
- **WHEN** a plate and a beam of a group are selected in the Outliner and dragged sideways through pins of the same group that are not selected
- **THEN** the overlap is shown while dragging and on release the two parts are put back with the message

### Requirement: Set drags stay responsive
Dragging a set SHALL work out its pins and holes once, at drag start, and only shift them while dragging. Overlap marking while dragging and the overlap tests on release SHALL give the same result as testing every member against every outside part. Stopping at contact SHALL happen only on release (the slide and the fit), not while dragging.

#### Scenario: Big group near the chassis
- **WHEN** the 45-part "Claw" group is dragged back and forth for several seconds right next to the robot's chassis
- **THEN** the drag keeps up with the pointer, and the overlap marks shown are the same as a full check of every Claw part would give

### Requirement: The assistant follows the grid rules
The MCP `update_group` tool SHALL apply the same grid rules: `moveCentreTo` SHALL move the set by the whole number of snap steps (from the app's current snap setting; exact with Free) nearest the given centre, and its reply SHALL give the centre actually reached; `turn` SHALL turn about the point on the set's own hole grid used by the app. `moveBy` SHALL keep moving by exactly the distance given. The tool SHALL NOT pull sets onto holes.

#### Scenario: moveCentreTo on the grid
- **WHEN** snap is 0.5P and the assistant calls `update_group` with `moveCentreTo` 2 mm away from a whole number of steps
- **THEN** the set moves by the nearest whole number of 6.35 mm steps and the reply gives the centre it reached

#### Scenario: Turn on the hole grid
- **WHEN** the assistant turns a group 90° about Y four times with `update_group`
- **THEN** every part is back exactly where it started

### Requirement: Double-clicking a set mates it
Double-clicking any selected part of a set (a group or several selected parts) SHALL mate the whole set, keeping its parts' places relative to one another. When some of the set's free outer pins, pegs, shafts or holes are lined up with matching ones on parts outside the set (on the same line within 0.25 mm and 2°, and within 25.4 mm of each other along the line), the system SHALL work out the push directions as for one part: one direction SHALL push the set straight in; several SHALL show one mate arrow per direction, and clicking one pushes the set that way. A push SHALL move the set along the direction until a part of the set touches a part outside it, or until the lined-up pins are all the way in, and SHALL stop with the touching parts flush, as one part's push does. After the push, unless Alt is held, the set SHALL be fitted with Fix assembly's rules as in "A set is fitted on release" (squared up and seated onto the parts it went onto), as part of the same step, and the overlap test SHALL be made on the poses as they are saved. When nothing is lined up, double-click SHALL start hole picking for the set (see "Hole picking for a set"); when the set has no free pins, pegs or shafts either, a message SHALL say "Turn or move the group so its pins face the part to mate it to". A set with a locked or hidden part SHALL NOT be mated and SHALL say why. Each mate SHALL be one history step labeled "Mate <set> onto <part>", and a push that would end in a new overlap SHALL leave the set where it was with "Can't place it there: it would overlap another part. Put back."

#### Scenario: Claw pushed onto the wrist plate
- **WHEN** the "Claw" group is held 8 mm off the Wrist 4x4 Plate with its pins on the plate's hole lines, and the user double-clicks a Claw part
- **THEN** the whole Claw moves straight in until it sits on the plate, as one "Mate Claw onto Wrist 4x4 Plate" step

#### Scenario: Fitted after the push
- **WHEN** two corner connectors are picked into a plate hole and the push leaves one of them pressed slightly into the plate
- **THEN** the fit seats them clear of the plate in the same step, and the audit shows no overlap

#### Scenario: Two directions
- **WHEN** a set's pins line up with a plate below and its holes with a beam beside it
- **THEN** double-click shows two mate arrows, and clicking one pushes the whole set that way

#### Scenario: Too far along the line
- **WHEN** a group's pins are on a plate's hole lines but 40 mm away along them
- **THEN** double-click does not push it; it starts hole picking instead

### Requirement: Hole picking for a set
Hole picking for a set SHALL only use the set's free outer pins, pegs and shafts whose free end already points within 30° of straight into a hole: for each, the end that sticks out of the set (not into another set part) is the leading end. Only hole faces of parts outside the set that some leading end points within 30° of straight into SHALL get a ring; others SHALL get none. Pointing at a ringed hole SHALL list one fit per leading end within 30° of it: the set turned by the smallest turn (at most 30°) that makes that end point straight into the hole, about the end's point, and moved so the end waits just outside the face on the hole's line. The set SHALL NOT be turned about the hole's line, except by the turn that fits a square shaft's flats to a square hole. Fits SHALL be ordered by how many of the set's other leading ends (after the fit's turn) land on the lines of holes of outside parts (most first), then by the smallest turn, then the smallest move; markers SHALL show each leading end green when it lands on a hole and red when it doesn't. R, Shift+R and the wheel SHALL step through the fits, as for one part. The preview SHALL be a see-through copy of the whole set at the fit. Clicking SHALL put the set at the fit and push it in as in "Double-clicking a set mates it", as one history step labeled "Insert <set> into <part>"; a fit that would overlap something on the way in SHALL say "The way in is blocked" and leave the set where it was. Esc or a click on empty space SHALL end picking with no change. A single selected part SHALL keep today's hole picking (any pin, either end, every quarter turn).

#### Scenario: Only facing pins
- **WHEN** a group has four pins pointing down and two pointing sideways, and hole picking starts
- **THEN** only holes whose faces the downward pins or the sideways pins point into (within 30°) get rings, and pointing at a top-face hole of a plate below lists only the downward pins' fits

#### Scenario: Tilted 20°
- **WHEN** a group's downward pins are tilted 20° and the user points at a plate hole below and clicks
- **THEN** the group turns 20° so its pins point straight into the plate, and is pushed in until it sits on the plate

#### Scenario: Pattern first
- **WHEN** a group's four downward pins are 12.7 mm apart and the user points at a plate hole
- **THEN** the first fit is one where all four pins are over holes (four green markers), and R steps to the next fit

#### Scenario: Over 30°
- **WHEN** a group's only pins are tilted 40° from every hole line of the plate below
- **THEN** none of the plate's holes get rings, and the message asks to turn the group so its pins face the part
