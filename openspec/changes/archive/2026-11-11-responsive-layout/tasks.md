## 1. Layout size

- [x] 1.1 Add `useLayoutSize()` hook (matchMedia, 700 / 1180 px) and set `data-layout` on `.app-shell`
- [x] 1.2 Check that resizing across both boundaries keeps build, selection, camera and open dialogs

## 2. Shared panels

- [x] 2.1 Place the library aside by grid area per layout (no extraction needed)
- [x] 2.2 Place the Outline + inspector aside by grid area per layout; large layout exactly as before
- [x] 2.3 Keep the viewport mounted in the same place in the tree for all sizes

## 3. Icon toolbar

- [x] 3.1 Use lucide icons for undo, redo, select, tools, move, rotate, snap/explode, view, file, settings
- [x] 3.2 Icon-only form (44 px, aria-label + tooltip, labels hidden by CSS) for `FileMenu`, `SelectMenu`, `ToolsMenu`, `ToolbarMenu`, `ViewMenu`
- [x] 3.3 Clamp `PopoverMenu` to the screen and give it a max height with scrolling
- [x] 3.4 Medium: floating toolbar over the viewport, top-centre; move HUD pills clear of it
- [x] 3.5 Small: fixed full-width top toolbar that scrolls sideways; submenus anchor below the tapped button

## 4. Medium side panel

- [x] 4.1 Single side panel holding Library and Outline (now tabs, see 4b.1)
- [x] 4.2 `sidePanelView` outline ↔ properties with Back, scroll position kept, return on empty selection

## 4b. Revisions after first review

- [x] 4b.1 Medium side panel: Library / Outline tabs instead of a top/bottom split
- [x] 4b.2 Medium toolbar never wraps: docks across the top and scrolls when it doesn't fit beside the side panel
- [x] 4b.3 Library filters fold behind one button on medium and small; grid view keeps 3 columns

## 5. Small drawers

- [x] 5.1 `Drawer` bottom sheet with pin button; Library and Outline buttons along the bottom, one drawer open at a time
- [x] 5.2 Unpinned drawer closes on viewport tap or part added; pinned drawer shrinks the viewport instead of covering it
- [x] 5.3 Remember pin state per drawer in localStorage (try/catch)
- [x] 5.4 Properties open inside the Outline drawer with Back

## 6. Extras and checks

- [x] 6.1 Hide the shortcuts strip on medium and small
- [x] 6.2 Make Audit, Settings, History, Explode panel and dialogs fit and scroll at 360 px wide
- [x] 6.3 Screenshot the app at 390, 820, 1024 and 1440 px wide and compare with the spec scenarios
- [x] 6.4 Update `features.md` with the medium and small layouts
