## MODIFIED Requirements

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
