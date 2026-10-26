## 0. Before starting

- [x] 0.1 Make sure quick-copy-insert is committed, then bring this branch up to date with it (rebase or merge). Verify `git log` shows its commit and `npm run build` passes.

## 1. Groundwork (`src/components/Viewport3D.jsx`), no visible change

- [x] 1.1 Replace every use of the captured `camera` in the init effect with the active camera (`cameraRef.current`). Add `useCamera(cam)`, which swaps `orbit.object`, `transform.camera` and the overlay scaling camera (design.md §1). Verify: `npm run build` passes, and in the app (with the user's go-ahead, backing up and restoring `public/assembly-state.json`) orbit, select, drag snapping, double-click mating, hole picking, Rotate mode and the copy preview behave as before.
- [x] 1.2 Add the input layer `inputEl` over the main pane, and move OrbitControls, TransformControls and every pointer, wheel, dblclick and context-menu listener, rect and cursor use onto it. The canvas gets `pointer-events: none` (design.md §2). Verify: the same app checks as 1.1 pass in Single layout, and `grep -n "renderer.domElement"` only shows renderer setup and screenshot code.
- [x] 1.3 Change the render loop to per-pane scissor rendering with `renderView(rect, camera, overlays)` (design.md §3), still with one pane. Verify: the picture is the same as before, and resizing the window keeps it sharp and undistorted.

## 2. Perspective / orthographic (camera-views)

- [x] 2.1 Add the orthographic camera, and the switch that keeps target, direction and apparent size. Make Frame (`F`) work by zoom when orthographic (design.md §1). Verify in the app: `P` toggles with the parts keeping their place and size; zooming orthographic never clips the front parts; `F` frames in both.
- [x] 2.2 Re-run the editing checks in orthographic: drag snapping, mating, hole picking, Rotate mode with typed angles, the copy preview, Explode. Verify each works as in perspective.

## 3. Axis views and view cube (camera-views)

- [x] 3.1 Add `animateViewTo(direction, up)` (300 ms, about the target, keeping distance or zoom), and App keys `P`, `1/2/3` and Shift+`1/2/3` via `e.code`, ignored in text fields (design.md §6–7). Verify: `1` front with +Y up, Shift+`2` bottom with +X at the top, `2` top with +X at the top, in both projections.
- [x] 3.2 Build the view cube scene (26 regions, labels), draw it in the main pane's top-right corner, add hover highlight, and handle capture-phase clicks that only consume hits on the cube (design.md §6). Verify: clicking the Top face, an edge and the +X+Y+Z corner turns to those views; clicking a part just beside the cube selects it; the cube follows orbiting.

## 4. Four-view layout (four-view-layout)

- [x] 4.1 Add the layout state, and the 70/30 split with three stacked small panes and HTML labels "X · Front", "Y · Top", "Z · Side" (design.md §3). Verify: picking 4-View shows the panes, picking Single restores the full view with the same camera, and resizing keeps the split.
- [x] 4.2 Add the small orthographic cameras with auto-framing, wheel zoom about the pointer, drag pan, and `F` resetting them to auto (design.md §4). Hide the gizmo, rings, arrows, pick/copy overlay, hole highlights and cube in them. Verify: dragging a part in the main view moves it in the small views; the gizmo shows only in the main view; zooming a small view leaves the main view alone; clicks there change nothing; `F` reframes.

## 5. Stereo (stereo-view)

- [x] 5.1 Add the stereo layout with `THREE.StereoCamera`: half-pane aspect, focus at the target distance, separation of distance/30 × depth, cross-eyed swap, and perspective forced while the saved projection is kept (design.md §5). Verify: two half-width images centered on the target; zooming from 600 mm to 150 mm cuts the separation about 4×; Cross-eyed swaps the halves; leaving stereo from orthographic is orthographic again.
- [x] 5.2 Input in stereo: orbit, pan and zoom across both halves; click selection ray-cast per half; gizmo, rings, mating, picking, copy preview and cube off, with a status message on double-click or right-click; `syncGizmos()` on leaving. Verify: selecting a beam in either half highlights it in both with no gizmo; picking Single brings the gizmo back.

## 6. App, saving, MCP, docs

- [x] 6.1 `src/App.jsx`: the toolbar Persp/Ortho button and layout segmented control, plus the Cross-eyed toggle and Depth slider shown in stereo; the settings saved in `viewport` and loaded with defaults; props passed down. Verify: reload keeps orthographic + 4-View; switching settings adds no history steps.
- [x] 6.2 `mcp/vexiq-mcp-server.mjs`: `configure_viewport` accepts and validates `projection`, `viewLayout`, `stereoCrossEyed`, `stereoDepth` and `viewAlong` (as a trigger), rejecting bad values with the allowed list. Check `vite.config.js` passes them through. Add cases to `scripts/check-mcp-tools.mjs`. Verify: `node scripts/check-mcp-tools.mjs` passes, and with the app open, `viewAlong: '+y'` turns the camera to the top view.
- [x] 6.3 `capture_screenshot` 'current' renders only the main camera (orthographic aware, no stereo, no cube) (design.md §8). Verify: a 'current' screenshot in orthographic 4-View is a single orthographic image of the main view.
- [x] 6.4 Update `features.md` (projection, axis keys, view cube, layouts, stereo, MCP fields) and the shortcuts bar (`P`, `1/2/3`). Run `npm run build`, `node scripts/check-pin-hole-alignment.mjs`, `node scripts/check-history.mjs` and `node scripts/check-mcp-tools.mjs`; all pass.

## 7. Stereo full screen (stereo-view)

- [x] 7.1 App `immersive` state, the Full screen button (shown in Stereo), the `viewport-immersive` overlay, the browser full-screen request, the exit paths (`fullscreenchange`, `Esc` without deselecting, leaving Stereo) and the fading hint (design.md §5a). Verify in the app: the pair fills the window with no toolbar, panels, pills or shortcuts bar; each half takes half the width; orbit and select still work; `Esc` restores the normal screen with the selection kept; switching the layout over MCP leaves full screen.
- [x] 7.2 Add full screen to `features.md`. Run `npm run build` and the three check scripts; all pass.

## 8. Shadows (render-shadows)

- [x] 8.1 Viewport: part meshes cast and receive; a `shadows` prop toggles `dirLight1.castShadow` and the ground catcher; the shadow camera, catcher and bias are fitted each frame; the map is drawn once per frame across panes and before screenshots (design.md §9). Verify in the app: off looks pixel-identical to before; on shows part-on-part shading and a ground shadow under the build; a dragged part's shadow follows; four-view and stereo show shadows; no speckles on the faces of a beam.
- [x] 8.2 App `shadows` state, a Shadows toolbar toggle, save/load in `viewport` (default off), the WebMCP option; the MCP `configure_viewport` `shadows` field with validation and cases in `scripts/check-mcp-tools.mjs`; `features.md`. Verify: reload keeps it; no history steps; `node scripts/check-mcp-tools.mjs` passes; `npm run build` and the other checks pass.

## 9. Ambient occlusion (render-ambient-occlusion)

- [x] 9.1 Viewport: an `ambientOcclusion` prop; per-pane composers (`RenderPass` → `GTAOPass` → `OutputPass`) drawn into each pane with the overlays hidden, then a depth refill and the overlays on top; the camera and its perspective/orthographic define set per pane; tuned radius and thickness (design.md §10). Verify in the app: off is pixel-identical to before; on darkens the base of hole rings and pocket corners while flat faces keep their brightness; the gizmo draws over parts undarkened; the hole-pick preview is still hidden behind parts in front; it works with and without Shadows, orthographic, four-view and stereo; dragging, mating and picking still work.
- [x] 9.2 App `ambientOcclusion` state, an AO toolbar toggle, save/load (default off), the WebMCP and MCP `ambientOcclusion` field with validation and check cases, `features.md`. Verify: reload keeps it; no history steps; `npm run build` and the three check scripts pass.

## 10. Wide view and stereo workbench

- [x] 10.1 App `panelsHidden` (remembered in localStorage), a toolbar toggle, and the `panels-hidden` grid class (design.md §5b). Verify in the app: the panels hide and come back; the viewport and the stereo pair take the full width without full screen; reload keeps the choice.
- [x] 10.2 Stereo workbench (design.md §5): `inputEl` over the working half; a pointer camera (the working eye) for ray casts, canvas projection, hover and `transform.camera`; switching halves on pointer move with no gesture under way; eye `fov` matched; overlays in both halves; angle labels offset to the working half. Remove the stereo editing locks and the "Editing is off" message. Verify in the app, in both halves: select, gizmo drag with hole snapping, Rotate mode with a typed angle, double-click mating, hole picking and Ctrl/Cmd copy insert; the gizmo draws in both pictures; full screen works the same; Single, four-view and orthographic are unchanged (re-run the earlier checks).
- [x] 10.3 Update `features.md` (stereo editing, hide panels). Run `npm run build` and the three check scripts; all pass.
