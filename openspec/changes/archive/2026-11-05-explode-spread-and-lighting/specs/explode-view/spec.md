## ADDED Requirements

### Requirement: Spread out for big or locked builds
A build of more than 300 shown parts, or one whose planned explode would move fewer than half its parts, SHALL be spread out instead of planned. Up to 40% of the slider each group SHALL move away from the robot's middle as a whole (a piece whose parts are in two groups goes with the group most of them are in); after that each piece SHALL move straight out from its group's middle, further the further out it starts. A build without groups SHALL spread its pieces from the robot's middle over the whole slider. No piece SHALL move down. At 100% no two shown parts SHALL overlap: a piece still meeting another is pushed further out along its way. On the way out parts MAY pass through each other.

#### Scenario: Flop spreads out
- **WHEN** the Flop starter (593 parts in five groups) is exploded
- **THEN** it is spread out in under 15 s, every part moves, at 40% each group has moved as a whole, and no part has moved down

#### Scenario: Fully apart without overlaps
- **WHEN** the Flop starter is exploded and the slider is at 100%
- **THEN** no two parts overlap

## MODIFIED Requirements

### Requirement: No overlaps at any slider value
In a planned explode, at every slider value, no two shown parts SHALL overlap that don't already overlap when assembled (for example a tire on its hub). This SHALL hold during the play and while the user drags, not only at 100%. A spread-out build only guarantees this at 100%.

#### Scenario: Scrub the Clawbot
- **WHEN** the Clawbot starter is exploded and the slider is checked at every 1% from 0% to 100%
- **THEN** no two parts overlap at any of those values except pairs that overlap when assembled

### Requirement: What moves as one piece
These SHALL move as one piece and never apart from each other: a pin or standoff and the part it sits deeper in (on a tie, the larger part); a tire and its hub; a chain or track's links. In a planned explode the parts of a group SHALL also move as one piece; in a spread-out build a group moves as one only up to 40% of the slider. Shafts SHALL move as pieces of their own in a planned explode. The battery SHALL slide out of the brain's bay along the bay's axis. Hidden parts SHALL NOT be shown or moved and SHALL NOT block other parts.

#### Scenario: Pin stays in its part
- **WHEN** a pin sits 2/3 of its length in a beam and 1/3 in a plate, and the slider is at 100%
- **THEN** the pin is still seated in the beam and the beam has slid off the plate along the pin's axis

#### Scenario: Group as one
- **WHEN** a group of five parts in a build that is planned is exploded
- **THEN** the five parts keep their places relative to each other at every slider value

#### Scenario: Battery out of its bay
- **WHEN** the battery sits in the brain's bay and the slider is at 100%
- **THEN** the battery has slid out of the bay along the bay's axis
