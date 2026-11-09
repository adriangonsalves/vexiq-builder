## Why

Adding a part exactly where it belongs takes several steps today: click it in the library (it lands somewhere in view), then drag it near the hole or double-click it to pick a hole, then step through fits, some of which push the part into its neighbours. Dragging from the library is quicker but the part follows the pointer, so the hole has to be found while dragging. Builders usually know the hole first ("the next part goes here"), so they should be able to mark that hole and have the next part go straight into it.

## What Changes

- **Alt+hover lights a target.** While Alt is held (Option on macOS) and nothing is being dragged or placed, the hole face or sticking-out pin/shaft end nearest the cursor, on any visible part, is lit. No part needs to be selected.
- **Alt+click sets the target.** The lit hole face or pin end stays marked in its own colour after Alt is let go. Alt+click on it again, or `Esc`, clears it. Alt+click elsewhere moves it. A hole that already has a part in it can't be set (message). The target moves with its part, and goes away if its part is hidden, removed or undone away.
- **A library click goes straight into the target.** With a target set, clicking a part in the library adds it already posed at the target, in position choosing:
  - a part with pins, pegs or shafts plugs one of them into a target hole;
  - a part with holes slides one of them onto a target pin or shaft end;
  - a bore part (gear, hub, sprocket) goes onto a target shaft end or a hole a shaft fits, as hole picking does;
  - a part with neither pins for a target hole nor holes for a target pin (a beam or plate on a target hole) lines one of its holes up with the target hole and lies flat on that face, ready to be pinned.
- **Only fits that don't overlap.** Every fit is worked out at its seated pose and fits that would overlap another part are left out. The best fit is shown first (most pins or holes lined up, then the smallest turn). The mouse wheel, `R` and `Shift+R` step through the rest; the banner says "Fit 2 of 6".
- **Corner holes for beams and plates.** For a part that only has holes and has more than four on a face, only its corner holes are offered as the hole that meets the target (the two end holes of a beam, the four corners of a plate), so the list stays short. All holes for other parts.
- **One more click finalises.** A click in the view keeps the shown fit as one history step ("Add <part> into <receiving part>") and clears the target. `Esc` removes the part (no history step) and keeps the target. When no fit is free, nothing is added and a message says so.
- Library drag, the Ctrl copy preview, double-click hole picking and Shift+Alt+click selection are unchanged.

Out of scope for now: using the target for a part already in the build, MCP tools, touch devices (no Alt key), and choosing holes other than the corners for beams and plates.

## Capabilities

### New Capabilities
- `target-hole-placement`: marking a hole or pin end as the target with Alt+hover and Alt+click, and placing the next library part into it by choosing among fits that don't overlap.

### Modified Capabilities
- `library-placement`: a clicked part goes to the target, in position choosing, when a target is set, instead of landing at a clear spot in view.

## Impact

- `src/components/Viewport3D.jsx`: Alt hover and target marker (alongside the existing Ctrl copy preview hover and pick overlay), a placing session started at the target that doesn't follow the pointer, overlap filtering of fits, finalising on click.
- `src/utils/pinHoleAlignment.js`: fits for a part's holes onto a target pin end, hole-to-hole fits on a target face, corner-hole selection; reuses `listInsertFits`, `listBoreFits`, `insertPose`, `isOpeningTaken`.
- `src/App.jsx`: `handleLibraryAdd` asks the viewport to place at the target when one is set; banner text.
- `features.md`: describe the target and Alt+click.
- New checks in `scripts/check-pin-hole-alignment.mjs` for the new fit lists and corner holes.
