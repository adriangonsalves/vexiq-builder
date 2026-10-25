## Why

Pinning a build together means adding many identical pins: dozens of connector pins, standoffs or shafts. Today each one has to be added from the library or duplicated, then dragged or picked into its hole one at a time. With a pin already selected, the user should be able to point at holes and stamp copies into them.

## What Changes

- **Ctrl preview.** With a part that has pins, pegs or shafts selected, holding **Ctrl**, or **Cmd** on macOS where Ctrl+click is a right-click, turns on copy preview. Hovering near a hole face of any other visible part does three things:
  - it rings that hole and every other hole the copy's pins would go into, in cyan;
  - it shows a see-through copy at the best fit, using the same fit rules as hole picking (pattern turned with the receiving part, best fit first);
  - it marks pins that would land on no hole in red.
- **Fits.** The mouse wheel steps through other fits while Ctrl is held over a hole. `R` isn't used here, because Ctrl+R / Cmd+R reloads the browser. Releasing Ctrl clears the preview.
- **Insert a copy.** Ctrl+double-clicking a lit hole adds a new copy of the selected part and pushes it into the hole until it touches, exactly like a hole-picking insert:
  - the original stays where it is and stays selected, so more copies can be stamped straight away;
  - each copy is its own part, named after the catalog part with the next number (e.g. "0x2 Connector Pin #7"), with the original's color;
  - each copy is one history step ("Insert copy of … into …").
- **Refusals.** A hole that already has a part in it, or a way in that is blocked, is refused with the same messages as hole picking, and nothing is added.
- **Plain clicks unchanged.** Clicks and double-clicks without Ctrl or Cmd keep their current behavior (select, mate, hole picking).
- **Out of scope:** an MCP tool, and copying a selected part that has no pins, pegs or shafts.

## Capabilities

### New Capabilities
- `copy-insert`: the Ctrl/Cmd preview (lit holes, see-through copy, markers, fit cycling), Ctrl/Cmd+double-click to insert a copy, refusals, the copy's name and color, and keeping the original selected.

### Modified Capabilities
- `pin-mating`: a double-click with Ctrl or Cmd held never mates or starts hole picking; it inserts a copy instead (see copy-insert).

## Impact

- `src/components/Viewport3D.jsx`:
  - a copy preview that reuses the hole-picking overlay, hover search and `listInsertFits`, active while the modifier is held;
  - double-click detection from pointer events (so it works with Ctrl on macOS);
  - working out a copy's final pose with the push-in sweep without moving the original;
  - a new `onInsertCopy(sourceId, pose, label)` prop.
- `src/App.jsx`: `onInsertCopy` adds the copy as one history step, with the next catalog number and the original's color, keeping the selection.
- `src/utils/pinHoleAlignment.js`: `holesFilledByFit(fit)` lists the hole for each green pin, so they can be ringed.
- `scripts/check-pin-hole-alignment.mjs`, `features.md`.
- No saved-format change.
