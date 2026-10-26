## Purpose

Lets the user switch the main view between perspective and orthographic, and turn the camera straight onto an axis or a standard corner view with keys or a clickable view cube. The settings are saved with the file and can be set over MCP.

## ADDED Requirements

### Requirement: Perspective and orthographic projection
The main view SHALL have two projections: perspective (the default) and orthographic, where parallel edges stay parallel at any depth. A toolbar button and the `P` key SHALL switch between them. The button SHALL show which one is active.

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
- **THEN** the view becomes orthographic, the parts stay centered where they were at about the same size, and the toolbar shows Orthographic

#### Scenario: Edit in orthographic
- **WHEN** the view is orthographic and the user drags a pin with the Move gizmo near a beam hole
- **THEN** the pin snaps to the hole and a double-click mates it, as in perspective

#### Scenario: Zoom in orthographic
- **WHEN** the view is orthographic and the user scrolls the wheel
- **THEN** the view zooms in or out about the same target, without the parts being clipped at the front

### Requirement: Axis views by key
The keys `1`, `2` and `3` SHALL turn the main camera to look along the X, Y and Z axes:
- `1` from the +X side (front);
- `2` from the +Y side (top);
- `3` from the +Z side (side).

With Shift held, they SHALL look from the opposite side (−X, −Y, −Z).

The turn SHALL:
- keep the orbit target and the distance to it (or, in orthographic, the zoom);
- animate over about 300 ms;
- for the top and bottom views, put +X at the top of the picture.

A keyed view SHALL work in either projection, and SHALL NOT change the projection. The keys SHALL do nothing while focus is in a text field.

#### Scenario: Front view
- **WHEN** the user presses `1`
- **THEN** the camera turns smoothly to look from +X toward the target, with +Y up

#### Scenario: Bottom view
- **WHEN** the user presses Shift+`2`
- **THEN** the camera looks up from below (−Y), with +X at the top of the picture

### Requirement: Clickable view cube
The main view SHALL show a small cube in one corner. The cube SHALL:
- have labeled faces (+X Front, −X Back, +Y Top, −Y Bottom, +Z, −Z);
- turn with the camera, so it always shows the current view direction;
- stay the same size on screen, draw above the scene, and never block the parts behind its corner area from being selected outside the cube itself.

Clicking the cube SHALL turn the camera like the axis keys:
- a face looks straight along that axis;
- an edge looks from halfway between its two faces;
- a corner looks from the diagonal between its three faces.

Hovering a face, edge or corner SHALL highlight it.

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

### Requirement: Hide side panels
A toolbar toggle SHALL hide and show the two side panels (the parts library on the left and the Inspector on the right), so the viewport takes the full width under the toolbar. It SHALL work in every layout: Single, four-view, and Stereo, without needing full screen. The viewport, its panes and the stereo pair SHALL resize at once, and the camera SHALL keep its view.

The choice SHALL be remembered in this browser across reloads. It is not part of the saved build. When the panels are hidden, the toggle SHALL remain in the toolbar to bring them back.

#### Scenario: Wide stereo without full screen
- **WHEN** Stereo is on and the user clicks the hide-panels toggle
- **THEN** both side panels disappear, the stereo pair spreads across the full width under the toolbar, and editing still works

#### Scenario: Panels come back
- **WHEN** the panels are hidden and the user clicks the toggle again
- **THEN** the parts library and Inspector are back, and the viewport shrinks to fit between them

### Requirement: View settings saved and set over MCP
These settings SHALL be saved with the other viewport settings and restored when the build loads:
- the projection;
- the layout (single, four-view, stereo);
- the stereo cross-eyed choice;
- the stereo depth.

Changing them SHALL NOT create history steps. A save without them SHALL load as perspective, single view, parallel stereo, depth 1.

The assistant's viewport tool SHALL accept:
- `projection` ('perspective' | 'orthographic');
- `viewLayout` ('single' | 'four' | 'stereo');
- `stereoCrossEyed` (true/false);
- `stereoDepth` (0.25 to 3);
- `viewAlong` ('+x' | '-x' | '+y' | '-y' | '+z' | '-z'), which turns the user's camera once, like the axis keys.

Out-of-range or unknown values SHALL be rejected with a message naming the allowed values. Settings changed over MCP SHALL appear in an open app without a reload.

#### Scenario: Reload keeps the layout
- **WHEN** the user turns on orthographic and the four-view layout, then reloads
- **THEN** the app opens orthographic in the four-view layout

#### Scenario: Assistant turns the camera
- **WHEN** the assistant calls the viewport tool with `viewAlong: '+y'`
- **THEN** the open app's camera turns to the top view

#### Scenario: No history step
- **WHEN** the user switches projection and layout several times
- **THEN** the history has no new steps
