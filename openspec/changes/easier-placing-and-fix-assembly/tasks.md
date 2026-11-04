## 1. Fix assembly engine

- [x] 1.1 Add `src/engine/fixAssembly.js` (blocks, near pairs, partner and mover, ICP with Horn's method, seating) and the `fix_assembly` action in `src/engine/actions.js`
- [x] 1.2 Add `scripts/check-fix-assembly.mjs`: offset + tilted beam over pinned plate is lined up from either side; pressed-in case ends clear and seated; smaller block moves; nothing near gives an error; locked block isn't moved; verify it exits 0

## 2. Tools menu

- [x] 2.1 Add `src/components/ToolsMenu.jsx` (Fix assembly item, disabled reason) and put it in the toolbar beside Build; run `fix_assembly` through `handleRunSmartAction`

## 3. Clicked part lands in view

- [x] 3.1 Register `viewSpot(bbox, pointer)` from Viewport3D; use it in the library click path

## 4. Drag a library part into the view

- [x] 4.1 Library pointer drag in App (6 px threshold, name chip, add on entering the view with a merge key, `placeRequest`); `setInstances` passes `mergeWindowMs`
- [x] 4.2 Placing mode in Viewport3D: follow, pose at hovered fit, hole snap for parts without inserts, drop ignored, click to insert/drop, Esc cancels through App
- [x] 4.3 Try it in the app (headless Chrome on a throwaway server): pin dragged onto a beam hole, wheel steps its fit, click inserts as one step "Add … into …"; gear dragged in and Esc leaves no part and no step; beam dropped free is one step "Add …"; clicked plate lands in view; Fix assembly from a pin lines up a lifted, tilted beam

## 5. Wrap-up

- [x] 5.1 Update `features.md`
- [x] 5.2 Run every `node scripts/check-*.mjs` and `npm run build`
