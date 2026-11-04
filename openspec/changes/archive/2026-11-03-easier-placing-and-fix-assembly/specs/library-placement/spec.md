## Purpose

Where a part added from the library appears, and placing a part dragged from the library straight into a hole.

## ADDED Requirements

### Requirement: A clicked part lands in view
Clicking a part in the library SHALL add it at a clear spot near the middle of the main view: on the plane through the camera's orbit point facing the camera, rounded to the 1-pitch world grid, with its box (plus 2 mm) not touching any visible part's box and all of it inside the view. Spots are tried from the orbit point outward. When none is clear, the part SHALL be added at the orbit point. This SHALL hold whether or not a part is selected. Parts added with a given position (MCP, copies, starters) SHALL be unchanged.

#### Scenario: Camera turned away from the build
- **WHEN** the user has orbited the camera to look at an empty corner and clicks a 1x6 Beam in the library
- **THEN** the beam appears in the middle of the view, not beside the build out of sight

#### Scenario: View full of parts
- **WHEN** the middle of the view is covered by a chassis and the user clicks a pin
- **THEN** the pin appears in view next to the chassis, not inside it

### Requirement: Dragging a library part into the view places it
Pressing on a library card or tile and moving more than 6 px SHALL start a drag that shows the part's name by the pointer. When the pointer reaches the 3D view, the part SHALL be added under the pointer and selected, and placing SHALL start:
- the part follows the pointer, keeping its turn and its distance from the camera;
- when the pointer is near a hole face, axle end or other target it fits (the hole-picking targets and fits), the part SHALL be shown in place at that hole's first fit, and the wheel, `R` and `Shift+R` SHALL step through the fits;
- a part with no pins, shafts or bores SHALL pull onto lined-up holes while it follows, as a drag does;
- a banner names the part and the controls.

Letting go of the drag SHALL NOT end placing. After that, moving the pointer still moves the part; a drag with a button held turns the camera and does not.
A click on a highlighted fit SHALL insert the part as hole picking does. A click anywhere else SHALL leave the part where it is shown. `Esc`, selecting another part, or anything else that ends hole picking SHALL remove the part. Dropping the drag outside the view before it reaches the view SHALL add nothing.
Adding and placing the part SHALL be one history step ("Add <part> into <receiving part>", or "Add <part>"); removing it with `Esc` SHALL leave no step.

#### Scenario: Pin into a beam
- **WHEN** the user drags a 0x2 Connector Pin from the library over a beam hole, lets go, and clicks
- **THEN** the pin is seated in that hole and the history has one new step, "Add 0x2 Connector Pin #1 into …"

#### Scenario: Scrub fits after the drop
- **WHEN** a corner connector has been dropped over a beam hole and the user scrolls the wheel
- **THEN** the connector steps to its next fit at that hole and the camera does not zoom

#### Scenario: Cancel
- **WHEN** the user drags a gear into the view and presses `Esc`
- **THEN** the gear is gone and the history has no new step

#### Scenario: Drop somewhere free
- **WHEN** the user drags a 4x8 Plate into an empty part of the view, lets go and clicks
- **THEN** the plate stays where it was shown, as one step "Add 4x8 Plate #1"
