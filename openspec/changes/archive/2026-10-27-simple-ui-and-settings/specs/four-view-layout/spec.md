## MODIFIED Requirements

### Requirement: Four-view layout
A layout choice in the view cube's menu (see view-cube-menu) SHALL switch between Single, Four-view and Stereo. In Stereo, where the cube is hidden, the same menu SHALL open from a View button in the toolbar.

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
