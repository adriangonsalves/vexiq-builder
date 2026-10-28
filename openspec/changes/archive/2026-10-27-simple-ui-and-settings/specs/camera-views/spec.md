## MODIFIED Requirements

### Requirement: Perspective and orthographic projection
The main view SHALL have two projections: perspective (the default) and orthographic, where parallel edges stay parallel at any depth. The view cube's menu (see view-cube-menu) and the `P` key SHALL switch between them. The menu SHALL show which one is active.

On a switch, the view SHALL keep:
- the same orbit target and view direction;
- the same apparent size of things at the target's depth.

In both projections, these SHALL behave the same:
- orbit, pan and zoom;
- Frame (`F`);
- selecting, the Move gizmo and drag snapping;
- Rotate mode;
- mating, hole picking and the copy preview;
- hole highlights;
- the Explode view.

`P` SHALL do nothing while focus is in a text field.

#### Scenario: Switch to orthographic
- **WHEN** the user presses `P` in perspective
- **THEN** the view becomes orthographic, the parts stay centered where they were at about the same size, and the cube menu shows Orthographic

#### Scenario: Edit in orthographic
- **WHEN** the view is orthographic and the user drags a pin with the Move gizmo near a beam hole
- **THEN** the pin snaps to the hole and a double-click mates it, as in perspective

#### Scenario: Zoom in orthographic
- **WHEN** the view is orthographic and the user scrolls the wheel
- **THEN** the view zooms in or out about the same target, without the parts being clipped at the front

### Requirement: Clickable view cube
The main view SHALL show a small cube in one corner. The cube SHALL:
- have labeled faces (+X Front, −X Back, +Y Top, −Y Bottom, +Z, −Z);
- turn with the camera, so it always shows the current view direction;
- stay the same size on screen, draw above the scene, and never block the parts behind its corner area from being selected outside the cube itself.

Clicking the cube SHALL turn the camera like the axis keys:
- a face looks straight along that axis;
- an edge looks from halfway between its two faces;
- a corner looks from the diagonal between its three faces.

Hovering a face, edge or corner SHALL highlight it. Dragging on the cube, double-clicking a face and right-clicking the cube are described in view-cube-menu.

The cube SHALL be shown in single and four-view layouts. It SHALL NOT be shown in stereo, in the small views or in screenshots.

#### Scenario: Click the top face
- **WHEN** the user clicks the cube's Top face
- **THEN** the camera turns to look straight down, and the cube shows its Top face facing the user

#### Scenario: Click a corner
- **WHEN** the user clicks the corner shared by +X, +Y and +Z
- **THEN** the camera turns to an even three-quarter view from that corner

#### Scenario: Click beside the cube
- **WHEN** the user clicks a part just outside the cube's area
- **THEN** that part is selected as usual
