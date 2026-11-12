# responsive-layout Specification

## Purpose
TBD - created by archiving change responsive-layout. Update Purpose after archive.

## Requirements

### Requirement: Layout size follows the window width
The app SHALL choose a layout size from the window's width: **small** below 700 px, **medium** from 700 px up to 1180 px, and **large** at 1180 px and above. It SHALL switch size as soon as the width crosses a boundary (window resize or device rotation) without reloading, and without losing the build, the selection, the camera or an open dialog. The large layout SHALL stay as it is today.

#### Scenario: iPad in landscape
- **WHEN** the app opens in a window 1024 px wide
- **THEN** it uses the medium layout

#### Scenario: Phone in portrait
- **WHEN** the app opens in a window 390 px wide
- **THEN** it uses the small layout

#### Scenario: Rotating keeps work
- **WHEN** a part is selected and the device turns from portrait (820 px) to landscape (1180 px)
- **THEN** the layout changes from medium to large and the same part is still selected with the camera unchanged

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

### Requirement: Medium layout has one side panel with tabs
In the medium layout the left and right panels SHALL be replaced by a single side panel with two tabs, **Library** and **Outline**; the chosen tab fills the whole panel height. The 3D view SHALL take the rest of the width. The chosen tab SHALL be kept when the layout changes size and back.

#### Scenario: Switching tabs
- **WHEN** the Library tab is showing and the user taps the Outline tab
- **THEN** the Outline fills the side panel and the Library is hidden

#### Scenario: Adding a part
- **WHEN** the user adds a part from the Library tab
- **THEN** it is placed exactly as in the large layout and appears in the Outline tab

### Requirement: Library filters fold away on smaller layouts
In the medium and small layouts the library's category filters SHALL be folded behind one button that shows the chosen category; tapping it SHALL show the filters, and choosing a category SHALL apply it and fold them again. The library's grid view SHALL show 3 columns in these layouts. The large layout SHALL keep the filters always shown.

#### Scenario: Phone in landscape
- **WHEN** the library shows in a window 844 × 390 px
- **THEN** one filter button sits under the search box and the parts start right below it

#### Scenario: Choosing a category
- **WHEN** the user opens the filters and picks "Pins & Standoffs"
- **THEN** the library shows only those parts, the filters fold away and the button reads "Pins & Standoffs"

#### Scenario: Grid columns
- **WHEN** the grid view is on in the medium or small layout
- **THEN** parts show 3 to a row

### Requirement: Properties open from the Outline with a way back
In the medium and small layouts, choosing an item in the Outline SHALL replace the Outline with that item's properties (the same fields and actions as the large layout's inspector). The properties view SHALL show a Back control that returns to the Outline at the same scroll position. Selecting a part in the 3D view SHALL NOT by itself leave the Outline. Clearing the selection while properties are shown SHALL return to the Outline.

#### Scenario: Editing a part's position
- **WHEN** the user taps a part in the Outline
- **THEN** the Outline is replaced by that part's properties with a Back control at the top

#### Scenario: Going back
- **WHEN** the user taps Back in the properties view
- **THEN** the Outline returns, scrolled where it was, and the part stays selected

#### Scenario: Selection cleared
- **WHEN** properties are shown and the selection is cleared (Escape or "Unselect")
- **THEN** the Outline returns

### Requirement: Small layout has a fixed top toolbar
In the small layout the toolbar SHALL be fixed across the top of the screen with icon-only buttons (same commands and submenus as the medium toolbar). When the buttons don't fit the width, the toolbar SHALL scroll sideways rather than wrap or hide commands. The 3D view SHALL fill all the space between the toolbar and the bottom buttons.

#### Scenario: Narrow phone
- **WHEN** the window is 360 px wide and the toolbar's buttons need more width
- **THEN** the toolbar scrolls sideways and every button can be reached

#### Scenario: Submenu from a scrolled toolbar
- **WHEN** the user opens a submenu from a button scrolled partly into view
- **THEN** the submenu appears below that button, fully on screen

### Requirement: Small layout opens Library and Outline as drawers
In the small layout two buttons along the bottom of the screen, Library and Outline, SHALL each open a drawer that slides up over the 3D view; tapping the button of an open drawer SHALL close it, and only one drawer SHALL be open at a time. Each drawer SHALL have a pin control. An unpinned drawer SHALL close when the user taps the 3D view or adds a part from the Library. A pinned drawer SHALL stay open and the 3D view SHALL shrink to the space above it rather than being covered. The pinned state of each drawer SHALL be remembered between visits. Properties SHALL open inside the Outline drawer as described above.

#### Scenario: Picking a part
- **WHEN** the Library drawer is open and unpinned and the user adds a part
- **THEN** the part is placed and the drawer closes

#### Scenario: Pinned drawer
- **WHEN** the user pins the Outline drawer and then taps the 3D view
- **THEN** the drawer stays open and the 3D view sits above it, not under it

#### Scenario: Switching drawers
- **WHEN** the Outline drawer is open and the user taps the Library button
- **THEN** the Outline drawer closes and the Library drawer opens

#### Scenario: Pin remembered
- **WHEN** the user pins the Library drawer and reloads the app on the same device
- **THEN** opening the Library drawer opens it pinned

### Requirement: Desktop-only extras are hidden on smaller layouts
In the medium and small layouts the keyboard shortcuts strip SHALL be hidden. Overlays (Audit, Settings, History timeline, Explode panel, dialogs) SHALL fit within the screen in every layout, scrolling inside themselves when taller than the space they have.

#### Scenario: Audit on a phone
- **WHEN** the user opens Audit in the small layout
- **THEN** the audit panel fits the screen width and scrolls inside itself
