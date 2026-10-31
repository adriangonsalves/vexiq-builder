## 1. Recent list helpers

- [x] 1.1 Add `src/utils/recentParts.js` with `DECAY = 0.9`, `MAX_RECENT = 20`, `recordUse(entries, partId)`, `loadRecent(storage)` and `saveRecent(storage, entries)` as in design ("Recent list: scores that fade with each add"), taking the storage object as an argument so Node can test it; verify with the checks in 1.2
- [x] 1.2 Add `scripts/check-recent-parts.mjs` (same `check()` style as `check-build-library.mjs`) covering: five uses of A then one of B ranks A first; A once then B once ranks B first; three uses of A then 40 adds spread over other parts ranks A below a part used several times in those adds or drops it; 21 different parts once each keeps 20 and drops the first; bad JSON, a wrong `version` and a throwing storage all load as `[]`; save then load round-trips; verify `node scripts/check-recent-parts.mjs` exits 0

## 2. Thumbnails at two sizes

- [ ] 2.1 In `src/components/PartThumbnail.jsx`, render at 200 px (2x a 100 px grid tile) and add a `size` prop (default 72) that sets the `<img>` width/height and the `.part-thumb-box` size; verify in the app that List thumbnails look the same size as before and are at least as sharp, and that a part's thumbnail is still redrawn after changing its default colour

## 3. Library Grid view

- [ ] 3.1 Add the `libraryView` state in `src/App.jsx`, read from and saved to `localStorage` `vexiq.libraryView` in try/catch (anything but `'grid'` is List), and a List / Grid switch (lucide `List` and `LayoutGrid` icons) in the library title row; verify the switch flips the view, Grid survives a reload, and with the key removed the app opens in List
- [ ] 3.2 Render Grid as `.part-tile` buttons holding only `<PartThumbnail size={100}>` in a `.catalog-list.grid` laid out with `repeat(auto-fill, minmax(96px, 1fr))`, deferring off-screen tiles with `content-visibility: auto`, each with `aria-label={part.name}`; clicking calls the same add handler as List; verify three tiles per row in the 340 px panel, search and category pills narrow the tiles, the header count matches, the no-match message shows, and clicking a tile adds and selects the part with the usual label and history step
- [ ] 3.3 Add the single floating hover label (part name, part number on a second line) shown ~250 ms after `pointerenter`/`focus` on a tile, placed under the tile (above near the panel bottom), kept inside the panel's left and right edges, hidden on `pointerleave`/`blur`/scroll; verify hovering a middle tile, a rightmost-column tile and a bottom-row tile shows the full label, Tab focus shows it, and it never stays behind after leaving

## 4. Recent filter

- [ ] 4.1 Add `recentEntries` state from `loadRecent(localStorage)` and `handleLibraryAdd(part)` that calls `handleAddPart(part)` and, when it returns an instance, records and saves the use; point both List cards and Grid tiles at it; verify adding a part from the library updates `localStorage` `vexiq.recentParts`, while an MCP `place_part`, `D` duplicate, Ctrl/Cmd copy-insert, loading a starter and undo/redo leave it unchanged
- [ ] 4.2 Put a `Recent (n)` pill before `All` (count of entries found in `catalogMap`); when selected, list the entries' catalog parts in score order, still narrowed by the search box, in either view, with an empty-state message saying parts added from the library show up here; verify the spec scenarios "Recent shows used parts", "Empty Recent" and "Part gone from catalog" (add a fake id to the stored list by hand) in the app, and that Recent is unchanged after opening another build from the library and reloading

## 5. Outliner search

- [ ] 5.1 Add `outlinerQuery` state and a search box (same `.search-box` look, clear button, `Esc` clears) under the Outliner title; filter rows by label, catalog name or part number, ignoring case and outer spaces; show `(shown / total)` in the title while searching and a no-match message; verify the spec scenarios "Find by label", "Find by catalog name" (relabel four collars with `update_part`), "Find by part number", "No match" and "Clear"
- [ ] 5.2 Confirm the search leaves the build alone: with a search hiding the selected part, it stays selected and in the Inspector; show/hide and lock still work on filtered rows; Clear All still removes every part; a part placed over MCP that matches appears in the filtered list; `get_history` shows no new step from typing in the box

## 6. Base name of the selected part

- [ ] 6.1 Show a second `.instance-row-base` line (`name · partNumber`, or "Unknown part (partId)") on the selected Outliner row only; verify with a part relabelled "Left drive motor" over MCP that its row shows "VEX IQ Smart Motor · 228-2560", and that selecting another part moves the line
- [ ] 6.2 Show the same line at the top of the Inspector body, before Position, outside the advanced-only sections; verify it shows with advanced options off and on

## 7. Wrap-up

- [x] 7.1 Update `features.md` ("Live 3D Part Thumbnails & Search" and the Outliner) for Grid, the hover label, Recent and the Outliner search and base name; verify the text matches what the app does
- [ ] 7.2 Run every `node scripts/check-*.mjs` and `npm run build`; verify all exit 0, then look at both panels at the 340 / 330 px widths in the app (dark and light themes if both exist) for clipped text or overflow
