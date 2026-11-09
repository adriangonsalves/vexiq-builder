## MODIFIED Requirements

### Requirement: A clicked part lands in view
Clicking a part in the library SHALL add it at a clear spot near the middle of the main view: on the plane through the camera's orbit point facing the camera, rounded to the 1-pitch world grid, with its box (plus 2 mm) not touching any visible part's box and all of it inside the view. Spots are tried from the orbit point outward. When none is clear, the part SHALL be added at the orbit point. This SHALL hold whether or not a part is selected. When a target hole or pin end is set (see target-hole-placement), the clicked part SHALL instead be placed at the target, in position choosing. Parts added with a given position (MCP, copies, starters) SHALL be unchanged.

#### Scenario: Camera turned away from the build
- **WHEN** the user has orbited the camera to look at an empty corner and clicks a 1x6 Beam in the library
- **THEN** the beam appears in the middle of the view, not beside the build out of sight

#### Scenario: View full of parts
- **WHEN** the middle of the view is covered by a chassis and the user clicks a pin
- **THEN** the pin appears in view next to the chassis, not inside it

#### Scenario: Target set
- **WHEN** a beam hole is the target and the user clicks a pin in the library
- **THEN** the pin is shown at the target hole, not at a clear spot in view
