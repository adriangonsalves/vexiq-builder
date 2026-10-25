## Purpose

Shows one large working view next to three smaller orthographic views along X, Y and Z. The user can check alignment from the front, top and side while working in the main view.

## ADDED Requirements

### Requirement: Four-view layout
A toolbar layout choice SHALL switch between Single, Four-view and Stereo.

In Four-view, the viewport SHALL show:
- the large working view on the left, taking most of the width;
- three smaller views stacked on the right, each labeled:
  - "X · Front", looking from +X;
  - "Y · Top", looking down from +Y with +X at the top;
  - "Z · Side", looking from +Z.

The small views SHALL always be orthographic, whatever the main view's projection. The large view SHALL keep its camera, projection and every tool, exactly as in Single.

When the window or panel is resized, all four views SHALL resize with it, keeping the split.

#### Scenario: Turn on four-view
- **WHEN** the user picks Four-view
- **THEN** the main view shrinks to the left, and three labeled front, top and side views appear on its right, showing the build

#### Scenario: Back to single
- **WHEN** the user picks Single
- **THEN** the small views go away and the main view fills the viewport again with the same camera

### Requirement: Small views follow the build
Each small view SHALL show the same parts as the main view, in the same state:
- positions, colors, hidden parts and Explode offsets;
- the selected part's highlight;
- the grid;
- a part being dragged in the main view, which SHALL show in the small views as it moves.

They SHALL NOT draw:
- the Move gizmo or the rotate rings and their labels;
- mate arrows;
- the hole-picking or copy preview (rings, see-through copy, markers);
- the view cube.

Until the user zooms or pans a small view, it SHALL frame all visible parts with a small margin, and reframe when parts are added, removed, moved or hidden.

#### Scenario: Drag shows in all views
- **WHEN** the user drags a beam along X in the main view
- **THEN** the beam moves in the front and top views as it is dragged

#### Scenario: Gizmo only in the main view
- **WHEN** a part is selected in Move mode
- **THEN** the Move gizmo is drawn only in the large view, and the part's highlight shows in all four

### Requirement: Small views are view only
In a small view:
- the mouse wheel SHALL zoom about the pointer;
- dragging with any button SHALL pan.

Clicks and double-clicks SHALL NOT select, edit, mate or pick, and keys SHALL act as they do elsewhere. After a zoom or pan, the view SHALL stop reframing by itself. Frame (`F`) SHALL reframe all three small views on all visible parts, as well as framing the main view.

#### Scenario: Zoom a small view
- **WHEN** the user scrolls over the top view
- **THEN** only the top view zooms, about the pointer, and the main view does not change

#### Scenario: Click in a small view
- **WHEN** the user clicks a part in the side view
- **THEN** the selection does not change

#### Scenario: Reframe
- **WHEN** the user has zoomed the front view and presses `F`
- **THEN** the front view frames the whole build again and goes back to reframing as the build changes
