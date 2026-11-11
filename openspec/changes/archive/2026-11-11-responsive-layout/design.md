## Context

`App.jsx` renders `.app-shell` → `header.topbar` (brand, toolbar groups, menus) and `.workspace-grid` (340 px `panel-left` library | viewport | 330 px `panel-right` with `AssemblyOutliner` above the inspector). Sizes are fixed in `styles.css`; there are no width-based rules today. Menus are built on `PopoverMenu`.

## Goals / Non-Goals

**Goals:** usable medium and small layouts with every command still reachable; large layout untouched.
**Non-Goals:** touch gestures (separate spec); redesigning panel contents.

## Decisions

- **One size value in React, not only CSS.** A `useLayoutSize()` hook reads `matchMedia('(max-width: 699px)')` and `('(max-width: 1179px)')` and returns `'small' | 'medium' | 'large'`. The structure differs between sizes (floating toolbar, drawers, back step), so CSS alone isn't enough; CSS still handles sizing via a `data-layout` attribute on `.app-shell`. Breakpoints: 700 px puts every iPad portrait (≥744) in medium and phones in small; 1180 px puts iPad Air/Pro landscape in medium, where three columns are too tight.
- **Same elements, different placement.** The library aside, the viewport and the right aside (Outline + inspector) stay where they are in the tree in every size; CSS grid areas on `data-layout` place them (split side panel on medium, drawers on small). Nothing is extracted or rendered twice, and the viewport is never remounted, so camera and scene survive. The bottom drawer buttons are added after the right aside, so the other children keep their positions.
- **Icon-only toolbar by CSS.** Button text is wrapped in `.btn-text` and drop-down arrows marked `.btn-caret`; medium/small hide them and size buttons to 44 px. Each button has an `aria-label`. The existing `PopoverMenu` (already clamped to the window) is the submenu; it gets a max height with scrolling. The floating toolbar is centred without a CSS transform, since a transformed ancestor would carry the fixed-position menus off screen.
- **Outline ↔ properties.** A `sidePanelView` state (`'outline' | 'properties'`) used only on medium/small. Outline row click sets it to `'properties'`; Back or empty selection sets `'outline'`. Outline scroll position is kept in a ref and restored.
- **Drawers.** A `Drawer` component (bottom sheet, ~60% height, pin button). Pinned state per drawer in `localStorage` (`vexiq.drawerPinned.library/outline`, wrapped in try/catch). When pinned, the shell grid adds a row so the viewport resizes instead of being covered; the viewport's existing resize observer handles the canvas.
- **Icons:** the app's existing lucide icons (File gets a folder icon, Snap a magnet), no new dependency.

- **Tabs on medium.** A `sideTab` state ('library' | 'outline'); a tab bar is added to the grid (after the other children) and the inactive aside is hidden by CSS. Both asides share one grid cell.
- **Docking the medium toolbar.** The toolbar stays on one row (`nowrap`); its content width (`scrollWidth`) is compared with the room beside the side panel. When it doesn't fit, `data-toolbar="docked"` puts it in the top grid row, scrolling sideways like the small layout. A 16 px margin stops it flickering at the boundary.

## Risks / Trade-offs

- [Two layouts render different trees] → keep the size switch at the shell level only; panel components are shared.
- [Floating toolbar covers part of the view on medium] → place it top-centre, away from the view cube and HUD pills; HUD moves down by its height.
- [Some menus are long on a phone] → submenus get a max height and scroll.

## Open Questions

- None.
