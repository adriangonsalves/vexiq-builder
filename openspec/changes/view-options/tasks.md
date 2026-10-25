## 0. Before starting

- [ ] 0.1 Make sure quick-copy-insert is committed, then bring this branch up to date with it (rebase or merge). Verify `git log` shows its commit and `npm run build` passes.

## 1. Groundwork (`src/components/Viewport3D.jsx`), no visible change

- [ ] 1.1 Replace every use of the captured `camera` in the init effect with the active camera (`cameraRef.current`). Add `useCamera(cam)`, which swaps `orbit.object`, `transform.camera` and the overlay scaling camera (design.md §1). Verify: `npm run build` passes, and in the app (with the user's go-ahead, backing up and restoring `public/assembly-state.json`) orbit, select, drag snapping, double-click mating, hole picking, Rotate mode and the copy preview behave as before.
- [ ] 1.2 Add the input layer `inputEl` over the main pane, and move OrbitControls, TransformControls and every pointer, wheel, dblclick and context-menu listener, rect and cursor use onto it. The canvas gets `pointer-events: none` (design.md §2). Verify: the same app checks as 1.1 pass in Single layout, and `grep -n "renderer.domElement"` only shows renderer setup and screenshot code.
- [ ] 1.3 Change the render loop to per-pane scissor rendering with `renderView(rect, camera, overlays)` (design.md §3), still with one pane. Verify: the picture is the same as before, and resizing the window keeps it sharp and undistorted.

## 2. Perspective / orthographic (camera-views)

- [ ] 2.1 Add the orthographic camera, and the switch that keeps target, direction and apparent size. Make Frame (`F`) work by zoom when orthographic (design.md §1). Verify in the app: `P` toggles with the parts keeping their place and size; zooming orthographic never clips the front parts; `F` frames in both.
- [ ] 2.2 Re-run the editing checks in orthographic: drag snapping, mating, hole picking, Rotate mode with typed angles, the copy preview, Explode. Verify each works as in perspective.

## 3. Axis views and view cube (camera-views)

- [ ] 3.1 Add `animateViewTo(direction, up)` (300 ms, about the target, keeping distance or zoom), and App keys `P`, `1/2/3` and Shift+`1/2/3` via `e.code`, ignored in text fields (design.md §6–7). Verify: `1` front with +Y up, Shift+`2` bottom with +X at the top, `2` top with +X at the top, in both projections.
- [ ] 3.2 Build the view cube scene (26 regions, labels), draw it in the main pane's top-right corner, add hover highlight, and handle capture-phase clicks that only consume hits on the cube (design.md §6). Verify: clicking the Top face, an edge and the +X+Y+Z corner turns to those views; clicking a part just beside the cube selects it; the cube follows orbiting.

## 4. Four-view layout (four-view-layout)

- [ ] 4.1 Add the layout state, and the 70/30 split with three stacked small panes and HTML labels "X · Front", "Y · Top", "Z · Side" (design.md §3). Verify: picking 4-View shows the panes, picking Single restores the full view with the same camera, and resizing keeps the split.
- [ ] 4.2 Add the small orthographic cameras with auto-framing, wheel zoom about the pointer, drag pan, and `F` resetting them to auto (design.md §4). Hide the gizmo, rings, arrows, pick/copy overlay, hole highlights and cube in them. Verify: dragging a part in the main view moves it in the small views; the gizmo shows only in the main view; zooming a small view leaves the main view alone; clicks there change nothing; `F` reframes.

## 5. Stereo (stereo-view)

- [ ] 5.1 Add the stereo layout with `THREE.StereoCamera`: half-pane aspect, focus at the target distance, separation of distance/30 × depth, cross-eyed swap, and perspective forced while the saved projection is kept (design.md §5). Verify: two half-width images centered on the target; zooming from 600 mm to 150 mm cuts the separation about 4×; Cross-eyed swaps the halves; leaving stereo from orthographic is orthographic again.
- [ ] 5.2 Input in stereo: orbit, pan and zoom across both halves; click selection ray-cast per half; gizmo, rings, mating, picking, copy preview and cube off, with a status message on double-click or right-click; `syncGizmos()` on leaving. Verify: selecting a beam in either half highlights it in both with no gizmo; picking Single brings the gizmo back.

## 6. App, saving, MCP, docs

- [ ] 6.1 `src/App.jsx`: the toolbar Persp/Ortho button and layout segmented control, plus the Cross-eyed toggle and Depth slider shown in stereo; the settings saved in `viewport` and loaded with defaults; props passed down. Verify: reload keeps orthographic + 4-View; switching settings adds no history steps.
- [ ] 6.2 `mcp/vexiq-mcp-server.mjs`: `configure_viewport` accepts and validates `projection`, `viewLayout`, `stereoCrossEyed`, `stereoDepth` and `viewAlong` (as a trigger), rejecting bad values with the allowed list. Check `vite.config.js` passes them through. Add cases to `scripts/check-mcp-tools.mjs`. Verify: `node scripts/check-mcp-tools.mjs` passes, and with the app open, `viewAlong: '+y'` turns the camera to the top view.
- [ ] 6.3 `capture_screenshot` 'current' renders only the main camera (orthographic aware, no stereo, no cube) (design.md §8). Verify: a 'current' screenshot in orthographic 4-View is a single orthographic image of the main view.
- [ ] 6.4 Update `features.md` (projection, axis keys, view cube, layouts, stereo, MCP fields) and the shortcuts bar (`P`, `1/2/3`). Run `npm run build`, `node scripts/check-pin-hole-alignment.mjs`, `node scripts/check-history.mjs` and `node scripts/check-mcp-tools.mjs`; all pass.
