## 1. Turning point

- [x] 1.1 Add `gridPivot(features, center, { gridMm })` to `src/utils/pinHoleAlignment.js` following design decision 1; verify with new cases in `scripts/check-pin-hole-alignment.mjs`: a 1x6 Beam returns its own centre, the Robot Brain with Battery at [184.15, 69.7, 0] turned 180° about Y returns a point with x = 184.15 and z = 0, a 30°-tilted plate and a Chain Link return the box centre, a tire on an off-grid axle returns a point on its axle line
- [ ] 1.2 Use `gridPivot` for the free-part pivot in `refreshRotateSetup` (`src/components/Viewport3D.jsx`), feeding it the selected part's world features; verify the check case "brain turned a quarter turn" by turning the brain in the app and reading its position in the Inspector ([184.15, 69.7, 0] unchanged)
- [x] 1.3 Add a check that turns a free brain, beam and plate by 90° four times about each axis through `gridPivot` and confirms every hole line ends on the 6.35 mm grid offsets it started on; verify `node scripts/check-pin-hole-alignment.mjs` exits 0

## 2. Hole snap settle

- [x] 2.1 Add `HOLE_SNAP_PATTERN_SETTLE_MM = 3.5` and change `moveOntoLine` to take the settle limit as an argument; verify existing check cases still pass
- [x] 2.2 In `findHoleSnap`, compute moves with the 3.5 mm settle, count agreeing pairs (within 0.25 mm, nearest 64 pairs), and drop over-1 mm moves with no agreeing pair; verify new cases: the current scene's brain 2.7 mm off, dragged along X, snaps by [0, -0.08, 2.7]; a lone shaft 2 mm off dragged along its hole line does not snap; two 1x6 beams 2.5 mm off dragged along their hole lines snap
- [x] 2.4 Add `clearSpotAlongLine` to `pinHoleAlignment.js` and, in the drag handler, slide a lined-up overlapping part along the snapped line to the nearest clear spot (middle of a spot under 2 mm), cached per snapped pose, skipped with Alt or when a cap would cross a lip; verify check cases: a brain pressed into its eight pins at x = -0.475 and x = 2.7 settles at x = 0 with all eight seated, no clear spot within reach gives null, a wide clear spot gives its near edge
- [x] 2.3 Run every `node scripts/check-*.mjs`; then in the app drag the scene's brain (moved back to z = -2.7 first) along X onto its pins, confirm it lines up with no overlap and `audit_assembly` reports all eight brain pins seated
