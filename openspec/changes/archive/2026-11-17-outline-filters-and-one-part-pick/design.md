## Context

- **3D clicks** (`src/components/Viewport3D.jsx`, pointer-up): Shift (or Select mode) calls `onSelect(front, { additive: true, exact: e.altKey || exactPick })`; `exact` is already the "just this part, not its group" path used by Shift+Alt+click and the bar's One part of a group, and App's select handler honours it. Plain clicks go through a pending select (`cancelPendingSelect`) that waits for a possible double-click.
- **Ctrl/Cmd today**: holding it with one selected part that has pins, pegs or shafts starts the copy preview (`startCopy`, pick mode `copy`). In that mode a Ctrl/Cmd pointer-up goes to `handleCopyPointerUp`, which records the first click and inserts a copy on the second within `DOUBLE_CLICK_WINDOW_MS` and 6 px. With no copy preview (nothing selected, several selected, or a part without inserts), a Ctrl/Cmd click currently falls through to the plain-click path. `handleDoubleClick` returns early for Ctrl/Cmd (never mates) and, with several parts selected, says copies are one part at a time.
- **macOS**: Ctrl+click fires a `contextmenu` and, in Chrome and Safari, a pointer event with `button: 0` and `ctrlKey`; the app treats right-click as pan. The Outliner already uses Cmd on macOS, Ctrl elsewhere.
- **Outliner** (`src/components/AssemblyOutliner.jsx`): `allRows` builds folders and loose rows; `filterRows` narrows them by `partMatches` (label, catalog name, part number), keeping a folder whose name matches (then all its parts show) or any of whose listed parts match. `shownCount` drives the title "N / M".

## Goals / Non-Goals

**Goals:**
- Ctrl/Cmd+click toggles one part without breaking Ctrl/Cmd+double-click copy insert.
- Filters reuse the search's row narrowing, so folders, counts and range-select keep working.

**Non-Goals:**
- Changing what the search text matches (it keeps label, catalog name and part number).
- Filters in the Library panel, saved filter sets, or filtering the 3D view (hidden-ness stays per part).
- Touch: the bar's One part of a group already covers it; no new touch gesture.

## Decisions

1. **Which modifier**: `e.metaKey` on macOS, `e.ctrlKey` elsewhere (same test the Outliner and help shots use: `navigator.platform` / `userAgentData` Mac check). On macOS a Ctrl+click stays a right-click and selects nothing. *Alternative*: accept either key everywhere. Rejected: on a Mac Ctrl+click would both pan/context and select.

2. **Waiting for a double-click**: a single Ctrl/Cmd+click on a part schedules `select(front, { additive: true, exact: true })` through the same pending-select timer plain clicks use (the double-click window). Both paths that can see the second click cancel it: `handleCopyPointerUp` when it detects the second click (copy preview on), and `handleDoubleClick` for Ctrl/Cmd (copy preview off). So a Ctrl/Cmd+double-click never changes the selection, and a single one toggles after about 300 ms. *Alternative*: toggle at once and undo it on the double-click. Rejected: the toggle would change the copy source (the copy preview copies the selected part) between the two clicks.

3. **Copy preview after the toggle**: once two or more parts are selected the copy preview can't run (one part at a time), as today. Toggling back to one part lets it run again. No change to `startCopy`.

4. **Electronics**: catalog category `Electronics & Motion` and the name starts with "VEX IQ " (motors, brains, batteries, sensors, radio, controller, cable pack). That leaves out the plastic motor shafts and motor support caps in the same category. Kept as one pure function `isElectronics(meta)` so the list is easy to change.

5. **Filter helper** `src/utils/outlineFilter.js` (pure): `partPasses(inst, meta, { query, electronics, locked, hidden, color })` and `colorsInBuild(instances)` (distinct colours, by count, most used first). The Outliner's `partMatches` becomes `partPasses`; with filters on, a folder is kept only when a listed part passes (a folder name match alone no longer keeps it, so the Electronics filter can't be defeated by a folder called "Motors"); with only a search, today's folder-name rule stays. While open, a filtered folder lists only passing parts. A check script covers it.

6. **Chips UI**: a row of small toggle buttons (`role="switch"`/`aria-pressed`) under the search box, wrapping on wide panels and `overflow-x: auto` with `flex-wrap: nowrap` under 600 px. Colour opens a small swatch popover (reuses `.picked-color-menu` styles) listing only colours in the build plus "Any colour" to clear. Filter state lives in the component (React state), so it isn't saved. `Esc` in the search box keeps clearing only the text; a **Clear filters** link shows while any chip is on.

7. **Select shown**: replaces the selection with the ids of every passing part in list order (closed folders count their passing parts), via `onSelectIds(ids)`, not group-expanded; App's selection logic takes the ids as given (as the Outliner's row-in-folder click does).

## Risks / Trade-offs

- [A ~300 ms wait before a Ctrl/Cmd+click shows] → the same wait plain clicks already have where a double-click is possible; acceptable.
- [Ctrl+click on Windows inside the copy preview is a common slip when aiming at a hole] → a single click there now toggles a part; the help page names Ctrl/Cmd+double-click for copies. If it's a problem, a Ctrl/Cmd+click on a lit free hole could be left out of toggling (open question).
- [Electronics by name prefix] → if a future part breaks the rule, the function is the one place to fix.

## Open Questions

- Should a single Ctrl/Cmd+click that lands on a lit free hole (copy preview on) skip the toggle, since it was most likely half of a copy double-click? Can be decided after trying it; doesn't change the tasks.
