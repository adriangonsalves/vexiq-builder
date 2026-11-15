## Context

All three ways of opening a build end in `switchToBuild` in `src/App.jsx` (`handleStarterBuild`, `handleOpenBuild`, `handleOpenFile`), which saves the open build and replaces parts and history. Groups are a `groupId` and `groupName` on each part (`src/utils/partGroups.js`); a group holds parts only, never other groups. `cloneSet` already copies a set of parts with new ids and keeps bands strung by remapping the ids they point at (`copiedBand`). `spotBesideBuild` finds a clear spot in front of the build for one new part. Everything is in the browser; no server is involved.

## Goals / Non-Goals

**Goals:**
- One question, two buttons, same in all three places.
- Adding is an ordinary change to the open build: one history step, saved by itself, seen by other tabs and the assistant like any other step.

**Non-Goals:**
- Live editing by two students at once, or any sharing service.
- Groups inside groups.
- An MCP tool for adding a build.
- Snapping the added group onto the build; the student moves it into place with the group tools that exist.

## Decisions

1. **Ask after the pick, not with extra menu items.** A second "Add starter ▸" submenu and a second button on every library row would double the menu for a choice most students make rarely. One dialog after the pick keeps the menus as they are. Skipped when the open build is empty, so a first-time user never sees it.

2. **One shared dialog component** (`OpenOrAddDialog`) driven by a pending pick held in `App.jsx` state: `{ name, load }`, where `load()` returns the parts (and, for opening by itself, the full record). The three handlers set the pending pick instead of calling `switchToBuild`; the dialog's buttons call either the existing path or the new add path. A file is read and checked before the question is shown, so a bad file fails first.

3. **A pure helper does the merge** (`addBuildAsGroup(instances, incoming, name, bboxOf)` beside the group helpers): new instance ids through an id map, bands remapped with `copiedBand` as `cloneSet` does, every part given the one new `groupId` and `groupName`, labels renumbered to the next free "<part name> #N", and the whole set shifted by one offset. Being pure, it can be checked by a Node script without the app. Before writing it, list every field on a part that holds another part's id (bands do; check chain, track and bent-sheet data) and remap each.

4. **One group, incoming groups merged into it.** Groups can't nest, and the request is for the added build to arrive as a group. Keeping the incoming groups would leave the added build as several unrelated folders that can't be moved as one piece. Alternative considered: keep them with a name prefix ("Claw / Left jaw"); rejected as it loses the one-piece move. The student can ungroup and regroup after placing it.

5. **Where it lands:** the union box of the open build's visible parts and the union box of the incoming parts; shift the incoming set along +X (the front) so its box clears the build's by one pitch, centre it across (Z), keep its height (Y), round the offset to the half-pitch grid. This is `spotBesideBuild` applied to a set's box rather than one part's; extend that function rather than writing a second one.

6. **History and library:** the add goes through the normal `setInstances(..., { label: 'Add <name>' })`, so undo, autosave and the shared state need nothing new. The incoming history is dropped. For a file, nothing is written to the library.

7. **View settings of the incoming build are ignored** when adding; the open build keeps its own.

## Risks / Trade-offs

- [A big add (Flop, 594 parts) into a big build is slow to draw] → nothing new compared with opening Flop; note the time in the check and leave it.
- [Merging groups loses the added build's folders] → stated in Help; the source build still has them.
- [A part field pointing at another part is missed and a band or chain comes loose] → the check script adds Flop and the ratchet winch starter and compares band and chain reports before and after.
- [The question annoys students who only ever open] → it never shows on an empty build, and "Open by itself" is the first, default button.
