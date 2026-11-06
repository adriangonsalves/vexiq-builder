# viewport-lighting Specification

## Purpose
TBD - created by archiving change explode-spread-and-lighting. Update Purpose after archive.

## Requirements

### Requirement: Key light turns with the camera
The 3D view SHALL be lit mainly by one light from over the viewer's shoulder (up and to the right of the camera) that turns with the camera, so the faces turned toward the viewer are brighter than the sides from every angle. Each pane of the four-view layout SHALL be lit from its own camera. With Shadows on, every pane SHALL use the main view's light, which the shadow is drawn for.

#### Scenario: Orbit to the back
- **WHEN** the user turns the camera to look at the robot from behind
- **THEN** the faces toward the camera are lit as brightly as the front faces were from the front

### Requirement: Little even light, no colour cast
Light coming evenly from all round SHALL be well under the main light, and SHALL be neutral grey, so black and dark grey parts look black and grey, not blue.

#### Scenario: Black plate
- **WHEN** a black plate is shown
- **THEN** it looks black or dark grey, without a blue tint

### Requirement: Matte plastic, reflective metal
Plastic parts SHALL be matte. Room reflections (Settings → Display) SHALL show on metal at the chosen strength and on plastic at about a third of it.

#### Scenario: Reflection slider
- **WHEN** the user raises Reflection brightness
- **THEN** metal shafts get brighter reflections, and plastic only a little
