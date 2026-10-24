## 1. Hole pairs in the alignment math (`src/utils/pinHoleAlignment.js`)

- [x] 1.1 Add `holeRoles` (a shaft fits both openings) and `pairOf` (design.md §1). Add the hole variant of the aligned/apart test and `pairKind` to `findAlignedOpenings` results (design.md §2). Add check cases to `scripts/check-pin-hole-alignment.mjs`:
  - a 2x Wide 2x2 Corner Connector with two holes lined up 5 mm above a 2x12 Beam: both beam holes are returned with `pairKind: 'hole'`, on the beam face toward the connector;
  - holes whose spans overlap along the axis: none (the flush case depends on contact and is checked in the app, task 2.1);
  - a Smart Motor 4 mm from a beam with its drive socket lined up with a beam hole: that beam hole is returned;
  - holes of the same part never pair;
  - existing pin/shaft cases are unchanged (all earlier checks pass).
- [x] 1.2 Make `findHoleSnap` use `pairOf` (design.md §3). Check cases:
  - the corner connector dragged along X with its holes 2 mm off the beam's, face 1 mm away: pulled exactly onto them;
  - a 1x6 Beam over another 1x6 Beam, 1.5 mm off, faces 3 mm apart: pulled;
  - a 36 Tooth Gear's bore 3 mm from a beam hole's line: pulled;
  - a Smart Motor dragged toward a beam with its socket 3 mm off a beam hole's line: pulled onto it.
- [x] 1.3 Make `planMates` give hole pairs a travel and sweep equal to the face gap (design.md §4). Check cases:
  - the corner connector 5 mm above the beam has one plan pointing at the beam; run like `mateSelected`, it stops resting on the beam (5 mm, within the 0.76 mm contact tolerance), not overlapping;
  - a corner connector whose pegs line up with one beam and whose holes line up with another beam in the same direction gets one plan with the longer travel.

## 2. Viewport (`src/components/Viewport3D.jsx`)

- [x] 2.1 `mateSelected`: "Stacked on <labels>" when the plan has only hole pairs (design.md §4). `dropTouchingHolePairs` drops hole rings once the parts touch (design.md §2). Verify in the app (headless browser, scene of a beam and a corner connector):
  - dragging the connector near the beam pulls its holes into line, and holding Alt doesn't;
  - rings show on the beam holes while apart;
  - double-clicking stacks it flush with "Stacked on …", not overlapping, and the rings go away;
  - a pin then mated through a shared hole goes through both parts.

- [ ] 2.2 Double-click with pins and holes (design.md §5):
  - `mateAction` decides between mate, arrows, arrows plus picking, picking, or nothing;
  - stacking arrows run alongside hole picking for parts whose pins line up with nothing;
  - clicks go to an arrow first, then a highlighted hole, otherwise end both;
  - `Esc` ends both.

  Node checks: a corner connector with only its holes lined up gives `arrows+pick`; pegs and holes lined up with two beams in different directions give two arrows; a lone pin mates; a beam on a beam stacks; nothing lined up picks or does nothing. Verify in the app: double-click that corner connector to see the arrow and the picking banner; clicking the arrow stacks it, and clicking a highlighted hole elsewhere inserts it by a peg and removes the arrow.

  Archived with this task open: the code and Node checks are done; the in-app check of the arrow plus picking was not run (the user chose to close without it).

## 3. Docs and checks

- [x] 3.1 Update `features.md`: drag snapping, rings and double-click stacking for holes. Run `npm run build`, `node scripts/check-pin-hole-alignment.mjs`, `node scripts/check-history.mjs` and `node scripts/check-mcp-tools.mjs`; all pass, including the audit cases, which must be unaffected because hole pairs are not fastenings.
