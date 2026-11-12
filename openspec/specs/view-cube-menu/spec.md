# view-cube-menu Specification

## Purpose
Makes the view cube the place for view controls: drag it to turn the view, double-click a face to look from the other side, and right-click it for the view options that used to crowd the toolbar.

## Requirements

### Requirement: Dragging the cube turns the view
Pressing on the cube and dragging SHALL orbit the camera about the orbit target, as dragging empty space does, for as long as the button is held, even when the pointer leaves the cube. A press that moves less than 5 px before release SHALL count as a click, not a drag: it SHALL turn the camera to the face, edge or corner clicked, as before. A drag that starts on the cube SHALL never select, move or turn a part.

#### Scenario: Drag the cube
- **WHEN** the user presses on the cube's Front face and drags left
- **THEN** the view orbits as if dragging empty space, and no part is selected

#### Scenario: Small wobble is a click
- **WHEN** the user presses on the Top face and moves 3 px before releasing
- **THEN** the camera turns to look straight down

### Requirement: Double-click looks from the opposite side
Double-clicking a face of the cube SHALL turn the camera to look along the opposite face's axis (Front gives Back, Top gives Bottom, +Z gives −Z). Double-clicking an edge or corner SHALL turn to the diagonally opposite edge or corner. The first click of the double-click may start turning toward the clicked face; the second SHALL end on the opposite side.

#### Scenario: Double-click Top
- **WHEN** the user double-clicks the cube's Top face
- **THEN** the camera ends looking straight up from below, and the cube shows Bottom facing the user

### Requirement: Right-click view menu
Right-clicking the cube SHALL open a small menu next to it, with:
- **Projection:** Perspective or Orthographic (the active one marked);
- **Layout:** Single, 4-View or Stereo (the active one marked);
- with Stereo on: Cross-eyed, the stereo Depth slider and Full screen;
- **Grid** and **Axes** switches.

Choosing an item SHALL apply it at once. Choices SHALL close the menu, except switches and the slider, which leave it open. `Esc`, clicking outside the menu, or right-clicking elsewhere SHALL close it. The browser's own context menu SHALL NOT appear over the cube. The menu SHALL stay inside the window. A View button in the toolbar SHALL open the same menu. It SHALL be shown in Stereo, where the cube is hidden, and always in the medium and small layouts (see responsive-layout), where there may be no right mouse button; in the large layout outside Stereo it SHALL be hidden.

#### Scenario: Switch to orthographic from the cube
- **WHEN** the user right-clicks the cube and picks Orthographic
- **THEN** the view becomes orthographic and the menu closes

#### Scenario: Grid switch keeps the menu open
- **WHEN** the user right-clicks the cube and turns the Grid off
- **THEN** the grid disappears and the menu stays open with Grid unchecked

#### Scenario: Leave stereo
- **WHEN** Stereo is on in the large layout and the user opens the View button's menu and picks Single
- **THEN** the single view comes back with the cube, and the View button is hidden

#### Scenario: View options on a tablet
- **WHEN** the app is in the medium layout in Single view and the user taps the toolbar's View button
- **THEN** the same menu opens, and picking 4-View switches the layout
