## Purpose

Lets the user spread the robot apart with a slider, so each part slides out along a direction it can really move and the robot can be scrubbed between assembled and fully apart without any parts passing through each other.

## ADDED Requirements

### Requirement: Opening and closing the Explode panel
The toolbar's Explode button and the `X` key SHALL open the Explode panel when it is closed and close it when it is open. Explode SHALL always take the robot apart every way the parts come apart (there is no direction choice). While the take-apart is being worked out, the panel SHALL show a ring that fills up with a percentage and no slider; once it is worked out, a slider from 0% (assembled) to 100% (fully apart). Closing the panel (its Close button, the toolbar button, `X`, or `Esc`) SHALL put every part back at its assembled spot. The Off / X / Y / Z / All drop-down SHALL be gone, and `X` SHALL NOT cycle through the directions.

#### Scenario: Open from the toolbar
- **WHEN** the Explode panel is closed and the user clicks the toolbar's Explode button
- **THEN** the panel opens, shows the ring until the take-apart is worked out, then shows the slider playing from 0%

#### Scenario: Close with Esc
- **WHEN** the panel is open at 60% and nothing else is using `Esc` (no mate arrows shown)
- **THEN** the panel closes and every part is back at its assembled spot

#### Scenario: X toggles the panel
- **WHEN** the panel is open and the user presses `X`
- **THEN** the panel closes; pressing `X` again opens it

### Requirement: Play on open
When the panel opens, once the take-apart is worked out, the slider SHALL move from 0% to 100% over about 2.5 seconds, moving the parts with it. Grabbing the slider during the play SHALL stop the play at that point and hand the slider to the user. A save from another open tab SHALL NOT stop the play or change this tab's slider.

#### Scenario: Full play
- **WHEN** the user opens the panel and does nothing
- **THEN** about 2.5 seconds later the slider is at 100% and the robot is fully apart

#### Scenario: Grab during the play
- **WHEN** the play is at 40% and the user presses on the slider
- **THEN** the play stops and the slider follows the pointer from there

### Requirement: The slider sets how far apart the parts are
Every part's shown position SHALL depend only on the build and the slider value, so the same slider value always shows the same picture, and dragging back shows the same motion in reverse. At 0% every part SHALL be at its assembled spot. Moving the slider SHALL NOT change any part's saved position or rotation, and SHALL NOT add a history step. Parts SHALL keep their rotation while exploded; only their position changes.

#### Scenario: Back and forth
- **WHEN** the user drags the slider from 30% to 80% and back to 30%
- **THEN** every part is where it was the first time the slider was at 30%

#### Scenario: Saved positions untouched
- **WHEN** the user drags the slider to 100% and closes the panel
- **THEN** every part's saved position is unchanged and the history has no new step

### Requirement: Parts slide out the way they come apart
Each piece SHALL slide out in a straight line along a direction it can move without passing through the parts it is joined to: along the axis of a pin or shaft it sits on when that way is clear, otherwise along one of the main axes. A motor shaft SHALL NOT slide out through a hole its stop ring can't pass. The base piece (the Robot Brain when there is one, otherwise the largest part) SHALL NOT move. Each piece SHALL carry the parts held on it: while a piece moves, the parts held on it move with it by the same amount.

#### Scenario: Wheel stack on a shaft
- **WHEN** a shaft through a plate carries a spacer, a wheel and a rubber shaft collar, and the slider is at 100%
- **THEN** the shaft, spacer, wheel and collar are spread along the shaft's own axis, away from the plate, in that order, with a gap between each

#### Scenario: Beam on pins
- **WHEN** a beam is held to a plate by pins and the slider is at 100%
- **THEN** the beam has moved along the pins' axis, not sideways

#### Scenario: Motor shaft ring
- **WHEN** a motor shaft's stop ring sits between a plate and a Smart Motor
- **THEN** the shaft does not slide out through the plate's hole on the ring's side

### Requirement: Big pieces first, then the small ones
As the slider goes up, a piece SHALL NOT start moving apart from the piece it is held on before that piece has started moving. Pieces held on the base start first and carry everything held on them; the parts held on those pieces then spread out from them, down to the smallest parts last. Each piece SHALL travel far enough that the parts it carries have room to spread without reaching the piece it came off.

#### Scenario: Side plate before its wheel
- **WHEN** the slider goes from 0% upward on a build with a side plate holding a motor, a shaft and a wheel
- **THEN** the side plate starts moving first with the motor, shaft and wheel still on it, and the wheel starts sliding off the shaft only after the shaft has started moving off the motor

### Requirement: No overlaps at any slider value
At every slider value, no two shown parts SHALL overlap that don't already overlap when assembled (for example a tire on its hub). This SHALL hold during the play and while the user drags, not only at 100%.

#### Scenario: Scrub the Clawbot
- **WHEN** the saved Clawbot build is exploded and the slider is checked at every 1% from 0% to 100%
- **THEN** no two parts overlap at any of those values except pairs that overlap when assembled

### Requirement: What moves as one piece
These SHALL move as one piece and never apart from each other: the parts of a group; a pin or standoff and the part it sits deeper in (on a tie, the larger part); a tire and its hub. Shafts SHALL move as pieces of their own. The battery SHALL slide out of the brain's bay along the bay's axis. Hidden parts SHALL NOT be shown or moved and SHALL NOT block other parts.

#### Scenario: Pin stays in its part
- **WHEN** a pin sits 2/3 of its length in a beam and 1/3 in a plate, and the slider is at 100%
- **THEN** the pin is still seated in the beam and the beam has slid off the plate along the pin's axis

#### Scenario: Group as one
- **WHEN** a group of five parts is exploded
- **THEN** the five parts keep their places relative to each other at every slider value

#### Scenario: Battery out of its bay
- **WHEN** the battery sits in the brain's bay and the slider is at 100%
- **THEN** the battery has slid out of the bay along the bay's axis

### Requirement: Explode view while the slider is above 0%
While the panel is open, editing that Explode blocks today SHALL stay blocked: moving, turning, hole picking and the copy preview, with the same messages. No lines SHALL be drawn from moved parts back to their assembled spots: the slider's motion shows where each part came from. Selecting parts, hiding parts, the camera and the 4-View side views SHALL keep working and SHALL show the exploded positions. Hiding or showing a part, or any change to the build (undo, redo, an MCP edit), SHALL work out the explode again and keep the current direction and slider value.

#### Scenario: Move is blocked
- **WHEN** the panel is open and the user tries to drag a part
- **THEN** the part doesn't move and the Move arrows are not shown

#### Scenario: Build changes while open
- **WHEN** the panel is open at 70% and an MCP edit adds a part
- **THEN** the explode is worked out again with the new part and shown at 70%

### Requirement: Assistant control and saved view
The MCP `configure_viewport` tool SHALL accept `explodeMode` (`off` closes the panel, `all` opens it) and `explodeAmount` (0 to 1, the slider value). Setting either from MCP SHALL NOT play the slider: it SHALL go straight to the given value (1 when only `explodeMode` is given). Whether the panel is open and the slider value SHALL be saved with the rest of the view state and come back when the build is opened.

#### Scenario: Screenshot half exploded
- **WHEN** an assistant calls `configure_viewport` with `explodeMode: 'all'` and `explodeAmount: 0.5`, then `capture_screenshot`
- **THEN** the screenshot shows the robot at the 50% slider position, with no play

#### Scenario: Close from MCP
- **WHEN** an assistant calls `configure_viewport` with `explodeMode: 'off'`
- **THEN** the panel closes and every part is at its assembled spot
