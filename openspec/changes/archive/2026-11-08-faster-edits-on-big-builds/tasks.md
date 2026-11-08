## 1. Overlap check

- [x] 1.1 Keep each pair's overlap answer with both parts' world matrices, hub angles and collision shapes in `checkGroupCollision` (`src/components/Viewport3D.jsx`), reuse it while all match, clear it when the catalog changes or it passes 200,000 pairs
- [x] 1.2 Keep each part's world box until its matrix or local box changes
- [x] 1.3 Verify on the Clawbot that hiding, colouring and selecting marks the same overlaps as before and no longer stalls

## 2. Materials and lights

- [x] 2.1 `applyGroupAppearance` flags `needsUpdate` only when `transparent` or `depthWrite` changes
- [x] 2.2 Enable the ambient, hemisphere and main lights on `SELECT_LAYER`; verify the view no longer stutters while parts are selected and the outline looks the same

## 3. Library

- [x] 3.1 Build the library cards in a `useMemo` on the filtered catalog and view, with handlers read through a ref (`src/App.jsx`); verify drag, click-to-add and tile tips still work in List and Grid
