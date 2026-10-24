## Why

Double-click mating only works when the selected part's pin or shaft already lines up with a hole (within 0.25 mm). A part that is off to the side, turned the wrong way, or headed for a plate at an angle has to be dragged and rotated into line first, which is slow and easy to get slightly wrong. The user should be able to say "put it in that hole" and have the part turned and inserted.

## What Changes

- **Pick a hole.** Double-clicking a selected part that has pins, pegs or shafts but nothing lined up now starts *hole picking* instead of showing "Nothing lined up to mate with".
  - A banner explains the controls, and the move/rotate gizmo is hidden.
  - The camera can still be moved.
- **Hover highlight.** While picking, the hole nearest the cursor that the part's pins or shafts fit is highlighted.
  - The face under the cursor sets which side the part comes in from.
  - A hole that already has a pin or shaft in it is shown as taken.
- **Preview.** A see-through copy of the part shows it turned and lined up with the hovered hole, just outside it.
  - Its pin or shaft axis is turned onto the hole's axis, whatever angle the part was at before.
  - With several pins, the same pattern is shown on the receiving part, turned with that part's orientation (a plate at 30° gets the pattern at 30°).
  - Each pin is marked green when it lands in a hole and red when it doesn't.
- **Fits.** The fit with the most pins in holes is shown first. The mouse wheel (or `R`) steps through the other fits: which pin goes in the hovered hole, and the pattern's turn in 90° steps around the hole.
- **Insert.** Clicking turns the part, places it, and pushes it in until it touches, the same way double-click mating stops.
  - It is one history step ("Insert <part> into <receiving part>").
  - A fit with red pins can still be inserted; the part is then marked overlapping if a pin hits solid material.
- **Leave.** `Esc`, clicking empty space, or selecting another part leaves picking without changing anything.
- **Out of scope:**
  - A selected part with holes being picked onto pins already in the model (e.g. a beam onto placed pins). Deciding which of the beam's holes goes onto which pin needs its own design.
  - An MCP tool for this. Agents already have `place_parts` with `insert`.

## Capabilities

### New Capabilities
- `hole-pick-insert`: entering and leaving hole picking, hover highlights and taken holes, the lined-up preview with the projected pin pattern, stepping through fits, and inserting with one undoable step.

### Modified Capabilities
- `pin-mating`: double-clicking a selected part with no mate directions starts hole picking when the part has pins, pegs or shafts, instead of only showing a message.

## Impact

- `src/utils/pinHoleAlignment.js`: new pure functions that work out a part's pose for a picked hole (turn the insert's axis onto the hole's, roll the pattern with the receiving part), list and rank fits, and check which pins land in holes. Checked from Node in `scripts/check-pin-hole-alignment.mjs`.
- `src/components/Viewport3D.jsx`:
  - the pick mode (double-click entry, hover hit-testing of hole faces, highlight, ghost preview, pin markers);
  - wheel and `R` cycling, click to insert reusing the mating sweep, leaving the mode.
- `src/App.jsx`: banner text, insert step label, and `Esc` / selection handling while picking.
- `src/styles.css`: banner and marker styles.
- `features.md`.
- No new dependencies; the saved format is unchanged.
