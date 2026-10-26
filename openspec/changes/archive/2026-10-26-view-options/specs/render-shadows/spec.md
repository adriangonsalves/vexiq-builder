## Purpose

An optional, subtle shadow pass that makes the build look less flat: parts shade each other and cast a soft shadow on a floor patch under the build. It is off by default and is saved with the view settings.

## ADDED Requirements

### Requirement: Shadows option
A toolbar toggle named Shadows SHALL turn shadows on and off. It SHALL be off by default.

When shadows are on:
- the main light SHALL cast soft shadows from every visible part onto other parts and onto itself;
- a soft-edged dark floor patch SHALL appear level with the lowest visible part, fading out toward its edge, with the build's shadow falling on it (on the black background, a shadow on nothing wouldn't show);
- the lighting SHALL shift slightly toward the main light (a little less even fill light, a little more main light), so faces turned toward and away from the light read more clearly;
- shadows SHALL be subtle: a shadowed area keeps most of its brightness from the fill light, and only part of the main light's share is blocked;
- shadows SHALL follow parts as they are moved, dragged, mated, hidden, exploded or undone;
- the shadowed area SHALL cover the whole visible build at any size, from one pin to a full robot, with no visible speckles or stripes on flat faces.

The gizmo, rotate rings, mate arrows, hole highlights, pick and copy previews, the view cube and the explode trace lines SHALL never cast shadows.

Shadows SHALL show in every view: perspective and orthographic, the four-view small views, both stereo pictures and stereo full screen. They SHALL show in screenshots of the main view too.

When shadows are off, the picture SHALL look exactly as it did before this option existed.

#### Scenario: Turn shadows on
- **WHEN** the user clicks Shadows with a robot on screen
- **THEN** the parts shade each other where one blocks the main light, and a soft shadow appears on a dark floor patch under the robot

#### Scenario: Shadows follow a drag
- **WHEN** shadows are on and the user drags a beam
- **THEN** the beam's shadow moves with it while it is dragged

#### Scenario: Off by default
- **WHEN** a build without a saved shadows setting opens
- **THEN** shadows are off and the picture is unchanged

### Requirement: Shadows setting saved and set over MCP
The shadows setting SHALL be saved with the other viewport settings and restored on load. It SHALL NOT create a history step. The assistant's viewport tool SHALL accept `shadows` (true or false) and SHALL reject other values with a message. The browser tool SHALL accept it too.

#### Scenario: Reload keeps shadows
- **WHEN** the user turns shadows on and reloads
- **THEN** shadows are on

#### Scenario: Assistant turns shadows on
- **WHEN** the assistant calls the viewport tool with `shadows: true`
- **THEN** the open app shows shadows, and no history step is added
