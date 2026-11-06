## Why

The app is laid out for a desktop screen: a long toolbar of text menus across the top, the library on the left (340 px) and the outline and properties on the right (330 px). On an iPad the side panels squeeze the 3D view to a sliver, and on a phone the layout doesn't fit at all. People want to look at and tweak builds on tablets and phones.

## What Changes

- The layout picks one of three sizes from the window width: **large** (today's desktop layout, unchanged), **medium** (tablet) and **small** (phone). It switches live when the window is resized or the device is turned.
- **Medium:**
  - The top toolbar is replaced by a floating toolbar over the 3D view with larger, icon-only buttons (each with a label for screen readers and a tooltip). Grouped commands (File, Select, Tools, Snap/Explode, View) open as submenus from their icon.
  - The two side panels are replaced by one panel with two tabs, Library and Outline, each filling the panel.
  - Choosing an item in the Outline swaps the tab to that item's properties, with a Back button that returns to the Outline.
  - When the view gets too narrow for the floating toolbar on one row, it docks across the top and scrolls sideways (as on a phone) instead of wrapping; below 700 px the full phone layout takes over.
- **Small:**
  - The toolbar is fixed to the top of the screen at full width, icon-only; when the icons don't fit it scrolls sideways.
  - The 3D view fills the rest of the screen.
  - Two buttons along the bottom, Library and Outline, open each as a drawer sliding up over the 3D view. A drawer can be pinned so it stays open beside the view while you work; unpinned it closes after you add a part or tap the view.
  - Properties open inside the Outline drawer the same way as on medium, with Back.
- The keyboard shortcuts strip under the 3D view is hidden on medium and small.

## Out of scope

- Touch gestures (pinch, two-finger orbit, long-press, drag-to-place by touch). These get their own spec; this change only moves the layout.
- Any change to the large (desktop) layout.

## Capabilities

### New Capabilities
- `responsive-layout`: how the app's toolbar and panels are laid out at medium and small window sizes, and how the Library, Outline and properties are reached there.

### Modified Capabilities
<!-- none: existing specs describe panel contents, not where they sit on screen -->

## Impact

- `src/App.jsx` (topbar, `panel-left`, `panel-right`, inspector), `src/styles.css` (`.app-shell`, `.workspace-grid`, new size rules).
- Toolbar menus (`FileMenu`, `SelectMenu`, `ToolsMenu`, `ToolbarMenu`, `ViewMenu`, `PopoverMenu`) need an icon-only form and must open as submenus on the floating toolbar.
- `AssemblyOutliner` and the inspector move into a shared panel with a back step.
- No change to the MCP server or saved builds.
