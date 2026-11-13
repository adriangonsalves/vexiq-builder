## MODIFIED Requirements

### Requirement: Double-click mates in the only direction
When a hole or pin end is marked as the target (Alt+click or Mark a hole) and the user double-clicks a part other than the one the target is on, the system SHALL first make that part the selection and put it into the target, before any of the rules below: it SHALL be shown at its best free fit at the target, the bar SHALL turn into the wheel bar so the wheel, `R` or `Shift+R` step through the other fits, and a click SHALL keep it there as one history step, "Move <part> into <receiving part>", after which the target is cleared; `Esc` SHALL put it back where it was with no history step and keep the target. This SHALL apply to any part that fits the target (pins, pegs, shafts, bore parts, and parts with only holes), whether or not it is lined up with something else, and the part SHALL leave whatever holes it was in. When it has no free fit at the target, nothing SHALL move, the target SHALL stay, a message SHALL say "No free fit for <part> at this hole" (or "… on this pin" / "… on this shaft"), and the double-click SHALL NOT go on to mate. A locked part, Explode view or a double-click with Ctrl or Cmd held SHALL NOT use the target.

When no target is marked, or the double-clicked part is the one the target is on: when the user double-clicks the selected part and it has exactly one mate direction, the system SHALL mate it in that direction immediately. The double-click counts when the selected part is anywhere under the pointer, including behind another part. When the selected part is under the pointer but another part is in front, a single click SHALL wait one double-click interval (about 350 ms) before selecting the front part, so the two clicks of a double-click don't move the selection away. Double-clicking SHALL NOT mate when the part is locked, when Explode view is on, or when the double-click lands on a gizmo arrow, plane or ring handle. A double-click with Ctrl or Cmd held SHALL NOT mate, show arrows or start hole picking; it inserts a copy of the selected part instead (see copy-insert). When the selected part has no mate directions, a double-click SHALL start hole picking (see hole-pick-insert) if the part has at least one pin, peg or shaft, and otherwise SHALL leave the part where it is and show a message. When the part's only mate direction comes from hole-to-hole pairs alone, and the part has pins, pegs or shafts that line up with nothing, a double-click SHALL NOT mate immediately. Instead it SHALL show the direction's arrow (see "Arrows to choose between several directions") and start hole picking at the same time, so the user can either stack along the holes or insert the pins elsewhere.

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

#### Scenario: Nothing lined up, part has pins or shafts
- **WHEN** the user double-clicks a selected pin or capped shaft that has no mate directions
- **THEN** nothing moves and hole picking starts

#### Scenario: Nothing to mate with
- **WHEN** the user double-clicks a selected beam (no pins, pegs or shafts) that has no mate directions
- **THEN** nothing moves and a message says nothing is lined up to mate with

#### Scenario: Holes lined up, pins not
- **WHEN** the user double-clicks a selected corner connector whose flange holes line up with a beam's holes but whose pegs line up with nothing
- **THEN** nothing moves yet: an arrow shows the stacking direction, and hole picking starts for the pegs

#### Scenario: Ctrl+double-click on the selected part
- **WHEN** the user Ctrl+double-clicks a selected pin that lines up with a beam hole
- **THEN** the pin itself does not move or mate; with a hole lit, a copy is inserted there instead

#### Scenario: Scene part into the marked hole
- **WHEN** a hole on a Smart Motor is marked and the user double-clicks a 0x2 Connector Pin already standing in a beam
- **THEN** the pin becomes the selection and is shown seated in the motor's marked hole, the bar shows its fits, and a click keeps it there as one step "Move 0x2 Connector Pin #4 into VEX IQ Smart Motor #2"

#### Scenario: The mark wins over a lined-up hole
- **WHEN** a hole is marked and the user double-clicks a pin that also lines up with another beam hole
- **THEN** the pin goes to the marked hole, not the lined-up one

#### Scenario: No free fit at the mark
- **WHEN** a hole boxed in by other parts is marked and the user double-clicks a 2x4 Beam whose every fit there would overlap them
- **THEN** nothing moves, the mark stays, and the message says there is no free fit for the beam at this hole

#### Scenario: Esc keeps the mark
- **WHEN** a scene part is shown at the marked hole and the user presses `Esc`
- **THEN** the part is back where it was, no history step is added, and the mark is still set
