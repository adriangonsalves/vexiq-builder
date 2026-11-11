## MODIFIED Requirements

### Requirement: Medium layout uses a floating icon toolbar
In the medium layout the top toolbar SHALL be replaced by a floating toolbar over the 3D view, on a single row. Its buttons SHALL show icons only, at least 44 × 44 px, each with an accessible name and a tooltip. Every command reachable from the large toolbar SHALL still be reachable. Commands that are grouped in a menu on the large toolbar (File, Select, Tools, Snap, View) SHALL open as a submenu from one icon; undo and redo SHALL be direct buttons. The Move and Rotate mode buttons are not on this toolbar in any layout: they are on the context bar in the 3D view (see context-toolbar). When the 3D view is too narrow for the floating toolbar's single row, the toolbar SHALL NOT wrap: it SHALL dock across the top of the window and scroll sideways, as in the small layout, while the side panel stays. It SHALL float again once the row fits.

#### Scenario: Opening Tools on a tablet
- **WHEN** the user taps the Tools icon in the medium layout
- **THEN** a submenu opens listing the same tools as the large layout's Tools menu

#### Scenario: Submenu closes
- **WHEN** a submenu is open and the user picks an item, taps outside it, or presses Escape
- **THEN** the submenu closes

#### Scenario: Toolbar doesn't hide what it opens
- **WHEN** a submenu opens near the edge of the screen
- **THEN** the whole submenu stays on screen

#### Scenario: Narrowing the window
- **WHEN** the medium-layout window narrows until the floating toolbar no longer fits beside the side panel
- **THEN** the toolbar docks across the top and scrolls sideways, and the side panel stays

#### Scenario: Narrowing further
- **WHEN** the window narrows below 700 px
- **THEN** the full small layout takes over (drawers instead of the side panel)

#### Scenario: Move and Rotate on a tablet
- **WHEN** the app is in the medium layout
- **THEN** the floating toolbar has no Move or Rotate button and the context bar on the right edge of the 3D view has both
