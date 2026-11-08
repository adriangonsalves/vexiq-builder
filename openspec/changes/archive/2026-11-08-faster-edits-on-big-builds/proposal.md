## Why

On a big robot (the Clawbot, Flop) simple edits stalled the app: hiding, showing, colouring or selecting a part took a second or more, and the view stuttered while anything was selected. Three things did needless work on every edit:

- The overlap check ran again for every part and tested every touching pair's meshes again, even pairs where neither part had moved.
- Every part's material was flagged for a rebuild whenever its look was set, and the selection outline's pass saw a different light setup from the normal pass, so three.js reworked every part's material on every frame while anything was selected.
- The part library rebuilt all its cards (several hundred) on every edit to the build.

## What Changes

- **Overlap answers are reused:** each pair of parts keeps its last overlap answer with both parts' poses, hub angles and collision shapes. While none of those change, the answer is reused instead of testing the meshes again. Each part's world box is also kept until it moves. The store is cleared when the catalog changes or it grows past 200,000 pairs.
- **Materials rebuild only when needed:** setting a part's colour, opacity or selection look no longer rebuilds its material; only a switch between solid and see-through does.
- **Same lights in the outline pass:** the lights are on the selection layer too, so the outline pass and the normal pass share one light setup and nothing is reworked per frame while parts are selected.
- **Library cards made once:** the library's cards are made again only when the list of parts or the List/Grid view changes, not on every edit to the build.

No behaviour changes: overlaps marked, colours, selection and the library look and act as before.

## Capabilities

### New Capabilities
- `edit-responsiveness`: edits that don't move parts (hide, show, colour, select) stay quick on big builds, and selecting doesn't slow the view.

### Modified Capabilities

## Impact

- `src/components/Viewport3D.jsx`: pair answer store and world box cache in `checkGroupCollision`; `applyGroupAppearance` only flags a material when see-through changes; lights enabled on `SELECT_LAYER`.
- `src/App.jsx`: library cards built in a `useMemo`, calling the latest handlers through a ref.
