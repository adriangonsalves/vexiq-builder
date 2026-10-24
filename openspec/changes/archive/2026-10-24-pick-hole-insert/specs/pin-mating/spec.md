## MODIFIED Requirements

### Requirement: Double-click mates in the only direction
When the user double-clicks the selected part and it has exactly one mate direction, the system SHALL mate it in that direction immediately. The double-click counts when the selected part is anywhere under the pointer, including behind another part. When the selected part is under the pointer but another part is in front, a single click SHALL wait one double-click interval (about 350 ms) before selecting the front part, so the two clicks of a double-click don't move the selection away. Double-clicking SHALL NOT mate when the part is locked, when Explode view is on, or when the double-click lands on a gizmo arrow, plane or ring handle. When the selected part has no mate directions, a double-click SHALL start hole picking (see hole-pick-insert) if the part has at least one pin, peg or shaft, and otherwise SHALL leave the part where it is and show a message.

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
