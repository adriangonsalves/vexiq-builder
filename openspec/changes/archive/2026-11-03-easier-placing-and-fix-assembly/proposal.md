## Why

Putting parts together takes more steps than it should. A part clicked in the library lands beside the build, often outside what the camera shows, so the user has to hunt for it. Getting a new part onto holes means adding it, finding it, selecting it and double-clicking it to start hole picking. And two blocks of parts that end up nearly lined up (pins a millimetre off their holes, a few degrees tilted, or pressed a little into each other) can only be fixed by careful dragging and turning, which is exactly what the user finds hard.

## What Changes

- **A clicked library part lands in view.** Clicking a part in the library adds it at a clear spot near the middle of what the camera shows (not overlapping any part, inside the view), whatever is selected.
- **Dragging a library part into the view starts placing it.** The part is added where the pointer enters the view and follows the pointer. Near a hole it fits, it jumps onto that hole at its first fit (the same fits as hole picking); the wheel or `R` steps through the fits; a click puts it in. Letting go of the drag keeps placing, so the user can carry on with plain pointer moves. A click away from any hole drops the part where it is; `Esc` takes the part away again. Adding and placing is one history step. Parts with no pins, shafts or bores (beams, plates, the brain) follow the pointer and pull onto lined-up holes like a drag does.
- **Tools → Fix assembly.** A new **Tools** menu in the toolbar, which also takes over the Build menu's Chain builder and Track builder (one button instead of two). With one part selected, Fix assembly looks for pins, pegs, shafts and holes of that part's block that are close to matching features of another block (up to 4.5 mm off their line, 20° tilted, 4 mm apart along the line, or pushed into each other), lines all of them up at once by turning and moving the smaller of the two blocks, and then slides it along the shared line until it is seated without overlapping. A block is the parts joined to each other (the same joins as Select Connected) plus the members of any group they are in. It is one history step, undoable.

## Capabilities

### New Capabilities
- `library-placement`: where a part clicked in the library lands, and placing a part dragged in from the library.
- `fix-assembly`: lining up two nearly-mated blocks from the Tools menu.

### Modified Capabilities
<!-- hole-pick-insert's fits, insert and banner are reused unchanged; the placing session is a new mode on top of them, specified in library-placement. -->

## Impact

- `src/App.jsx`: library click and drag handlers, the Tools menu, `fix_assembly` action call, a cancel handler for a dragged-in part.
- `src/components/Viewport3D.jsx`: a view-spot helper registered with App; a placing mode on the hole-picking session (part follows the pointer, posed at the hovered fit, drop on release ignored, click to place, Esc to cancel).
- New `src/components/ToolsMenu.jsx`; the Build button in `src/components/BuildMenu.jsx` goes (its dialogs stay).
- New `src/engine/fixAssembly.js` and the `fix_assembly` action in `src/engine/actions.js` (runs in the dev bridge and the browser engine).
- New `scripts/check-fix-assembly.mjs`.
- `src/App.jsx` `setInstances` passes a merge window so the add and the placing make one step.
- `features.md`.
- Not in this change: an MCP tool for Fix assembly; dragging existing parts from the Outliner.
