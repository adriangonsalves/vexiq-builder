## 1. Math (`src/utils/pinHoleAlignment.js`)

- [x] 1.1 Make `listInsertFits` record, for each green marker, the opening it matched (`marker.opening`). Add `holesFilledByFit(fit, hovered)`, which returns the hovered opening plus each green marker's opening (design.md §2). Check cases in `scripts/check-pin-hole-alignment.mjs`:
  - a 2x2 corner connector over a beam: the best fit lists 2 holes, the hovered one and its neighbor in the pattern;
  - a single pin lists 1;
  - all earlier checks still pass.

## 2. Viewport (`src/components/Viewport3D.jsx`)

- [x] 2.1 Generalize the picking state into a session with `kind` (design.md §1). The copy session starts and ends on Ctrl/Meta (keydown/keyup, pointer `ctrlKey`/`metaKey`, blur) and only runs when allowed. It reuses hover, fits and the overlay; the overlay's ring becomes a pool that lights every hole from `holesFilledByFit`, with the taken hole grey. Add a status line via `onPickStatus` for copy sessions (no gizmo hiding). Verify in the app with a selected pin:
  - holding Ctrl or Meta near a beam hole lights it and shows the see-through copy;
  - a corner connector lights both holes;
  - releasing the key clears everything and adds no history step.
- [x] 2.2 Factor `sweepToContact` out of `mateSelected`, and add `computeCopyPose(fit)` (design.md §4). Verify `mateSelected` behavior is unchanged: the pick-insert and mate scenarios from earlier changes still pass in the app, with the user's go-ahead before any browser test.
- [x] 2.3 Detect the double-click from pointer events with Ctrl/Meta (design.md §3), and stop the `dblclick` handler from acting when Ctrl/Meta is held. On a lit, untaken hole, compute the pose and call `onInsertCopy`. A taken or blocked hole shows the message. Verify in the app:
  - with a pin selected, Ctrl+double-clicking three free beam holes adds three seated pins, and the original stays put and selected;
  - Meta works the same;
  - a taken hole adds nothing and shows the message;
  - a lined-up selected pin Ctrl+double-clicked on itself does not mate.

## 3. App and docs

- [x] 3.1 `src/App.jsx`: `onInsertCopy` per design.md §5 (next catalog number, original's color, one history step "Insert copy of … into …", selection unchanged, feedback message). Verify one undo removes the copy and nothing else.
- [x] 3.2 Update `features.md` (a quick copy-insert section and the shortcuts bar hint "Ctrl/Cmd + double-click: insert a copy"). Run `npm run build`, `node scripts/check-pin-hole-alignment.mjs`, `node scripts/check-history.mjs` and `node scripts/check-mcp-tools.mjs`; all pass.
