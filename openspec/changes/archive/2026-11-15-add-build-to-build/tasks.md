## 1. Merge helper

- [x] 1.1 List every field on a placed part that holds another part's id (bands, chains, tracks, bent sheets) by reading `partGroups.js` `copiedBand`, the chain builder and `shapedParts.js`; write the list at the top of the new helper as a comment. Done when each one is named with the file it comes from.
- [x] 1.2 Extend `spotBesideBuild` (or add a set version beside it) to give the offset for a whole set's box: clear by one pitch in +X, centred in Z, height kept, half-pitch grid. Verify with a check case: two boxes that overlapped no longer do.
- [x] 1.3 Write `addBuildAsGroup(instances, incoming, name, bboxOf)`: new ids, remapped references from 1.1, one new group with a unique name, labels renumbered, offset from 1.2; returns the new parts and their ids. Verify with `scripts/check-add-to-build.mjs` covering each scenario of "Adding a build as a group" (existing parts untouched, unique ids and labels, group name "X" then "X 2", incoming groups merged, band still strung, no overlap between the sets).
- [x] 1.4 In the same check, add Flop and the ratchet winch starter to the Clawbot and confirm chain and band reports match the originals, and `addBuildAsGroup` with no incoming parts returns nothing to add.

## 2. The question

- [x] 2.1 Build `OpenOrAddDialog` (title "Open <name>", buttons "Open by itself" and "Add to this build", Cancel; Esc and outside tap cancel; first button focused; fits a 360 px wide screen with touch-size buttons). Verify in the app at desktop and phone widths.
- [x] 2.2 In `App.jsx`, hold a pending pick and make `handleStarterBuild`, `handleOpenBuild` and `handleOpenFile` show the dialog when the open build has parts, and go straight to today's path when it has none. A file is read and checked before the dialog shows. Verify each scenario of "Open or add question" in the app.
- [x] 2.3 Wire "Add to this build": call the helper, apply as one step labeled "Add <name>", select the new group, close the library dialog, frame the view, show "Added <name>"; show "Nothing to add" for an empty build. Verify: one undo removes it, the build keeps its name, the library gains no build, and a second tab shows the added group (second tab not checked: see openspec/follow-ups.md).

## 3. Checks and docs

- [x] 3.1 Run every `node scripts/check-*.mjs`; all exit 0.
- [x] 3.2 Update `src/help/pages/saving.md` with the question and a short "Build with a teammate" part (Export, pass the file, Load… → Open from computer… → Add to this build), its `tags:` and `answers:`, `src/help/coverage.json`, a control chip in `src/help/controls.js` if the dialog needs one, and retake its pictures. Verify with `check-help.mjs`, `check-help-tags.mjs` and `check-help-context.mjs`.
- [x] 3.3 Update `features.md` (File menu and library section) and the menu item hints in `FileMenu.jsx` and `LibraryDialog.jsx` so they no longer say a pick always starts a new build. Verify by reading the hints in the app.
- [x] 3.4 Full pass in the app on a tablet-size window: add a starter, a saved build and a file to a build with parts; move the added group into place; undo. Verify with `audit_assembly` and screenshots from two views that nothing overlaps after the add.
