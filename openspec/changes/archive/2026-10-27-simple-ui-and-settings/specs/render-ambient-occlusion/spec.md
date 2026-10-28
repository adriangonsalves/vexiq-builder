## MODIFIED Requirements

### Requirement: Ambient occlusion option
An Ambient occlusion switch in the Settings panel's Display section (see app-settings) SHALL turn ambient occlusion on and off. It SHALL be off by default and independent of the Shadows toggle: any of the four combinations SHALL work.

When it is on:
- inside corners, creases and gaps between nearby faces of parts SHALL be darkened softly, fading out over a few millimetres from the corner;
- open, flat faces SHALL keep their brightness;
- the darkening SHALL show contact between parts that touch;
- grid lines, edge lines, the explode trace lines and every overlay SHALL neither cause nor receive darkening;
- overlays that draw through parts (the gizmo, rotate rings, mate arrows, hole highlights) SHALL still draw through them, and overlays hidden behind parts (the see-through pick or copy preview) SHALL still be hidden the same way;
- the effect SHALL show in every view: perspective and orthographic, the four-view small views, both stereo pictures and stereo full screen;
- every tool SHALL work exactly as with it off.

Screenshots for the assistant SHALL NOT include ambient occlusion.

When it is off, the picture SHALL be exactly as it was without this option.

#### Scenario: Turn AO on
- **WHEN** the user turns Ambient occlusion on in Settings with a beam on screen
- **THEN** the base of each hole's raised ring and the inside corners of the beam's pockets are darker, and its flat faces are unchanged

#### Scenario: Independent of shadows
- **WHEN** the user turns AO on with Shadows off, and then turns Shadows on
- **THEN** AO alone shows corner darkening without cast shadows, and both together show both

#### Scenario: Gizmo stays on top
- **WHEN** AO is on and a part is selected in Move mode
- **THEN** the Move gizmo is drawn over the parts as before, with no darkening around it
