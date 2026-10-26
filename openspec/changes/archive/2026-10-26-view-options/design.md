## Context

See proposal.md for the motivation. How the viewport works today (`src/components/Viewport3D.jsx`):
- **One camera.** A single `PerspectiveCamera` (45°, near 1, far 5000) is created in the init effect and stored in `cameraRef`. Many handlers inside that effect read the local `camera` variable directly: ray casts, `projectToCanvas`, the arrow and rotate-gizmo scaling, angle labels and the render loop. Other code reads `cameraRef.current`: hover picking, Frame (`F`) and screenshots.
- **One canvas.** One `WebGLRenderer` canvas fills `.viewport-canvas`. All pointer math uses `renderer.domElement.getBoundingClientRect()`, and so do OrbitControls and TransformControls internally (about 35 references to `renderer.domElement`).
- **Every frame** renders `scene` once with `camera`. The overlays (hole highlights, mate arrows, the pick/copy overlay, the rotate gizmo) are objects in the same scene. The TransformControls helper is too.
- **Saved settings.** Viewport settings go through App's save (`viewport: { transformMode, … focusTrigger }`), the Vite bridge, and the MCP server's `configure_viewport`, which merges with the saved `viewport` object. `focusTrigger` is a counter that fires a one-shot camera action. The same pattern fits `viewAlong`.
- **Screenshots.** `capture_screenshot` clones the camera for 'current', and uses a perspective clone for the standard views.
- **Dependency on another change.** This worktree branches from `f806338`. The quick-copy-insert change, still uncommitted in the main checkout, adds the copy session to the same file. It should be committed and merged before applying this change, so the new input layer covers the copy preview's handlers too.

## Goals / Non-Goals

**Goals:**
- Every existing tool keeps working in the main view, in both projections and in the four-view layout, with no per-tool changes beyond reading the active camera and the main view's area.
- One WebGL context, so part meshes are uploaded to the GPU once.

**Non-Goals:**
- Changing camera controls, beyond using the existing OrbitControls with an orthographic camera.
- Rendering only when something changes (the loop keeps rendering every frame).

## Decisions

### 1. An active camera, read through one getter
Keep both a `PerspectiveCamera` and an `OrthographicCamera`, and make `cameraRef.current` the active one.
- **Code:** every handler in the init effect replaces the captured `camera` with `cameraRef.current`. A `useCamera(cam)` helper swaps `orbit.object`, `transform.camera`, and the cameras used for the arrow and rotate-gizmo scaling.
- **Switching** copies the position, target and up vector. Going from perspective to orthographic, the frustum is set so the target depth keeps its size: `height = 2 · distance · tan(fov/2)`, with `zoom = 1`. Going back, the distance is set from the ortho height divided by the zoom.
- **Orthographic near/far** are −5000 and 5000 around the camera, which sits at the orbit distance. Zooming in never clips the parts in front. OrbitControls zooms an orthographic camera through `camera.zoom`. Frame (`F`) sets the zoom for orthographic, and the distance for perspective.
- *Alternative:* recreating the controls on each switch. Rejected: TransformControls holds the attached object and drag state, and OrbitControls holds damping state. Swapping `.object` and `.camera` is supported and keeps them.

### 2. An input layer over the main view
Add an absolutely positioned `div` (`inputEl`) over the main view's rectangle. It receives every pointer event, the canvas gets `pointer-events: none`, and OrbitControls and TransformControls are built on `inputEl`.
- **Code:** all `renderer.domElement` rect, listener and cursor uses in the handlers move to `inputEl`, so pointer math is relative to the main view's area. In Single layout, `inputEl` covers the whole viewport, so nothing changes. The `dblclick`, `wheel` and context-menu handlers move with it.
- **Small views** each get their own overlay `div` for zoom and pan, with no other listeners.
- **Stereo:** `inputEl` covers both halves (see §5).
- *Alternative:* separate canvases and renderers per view. Rejected: each WebGL context needs its own copy of every geometry (the models are about 80 MB), and the views couldn't share BVH-backed meshes.
- *Alternative:* keep one input element and convert coordinates in each handler. Rejected: TransformControls and OrbitControls read the element's rect themselves.

### 3. Many views per frame with scissor rendering
The renderer keeps one canvas sized to the whole viewport. Each frame runs `renderView(rect, camera, { overlays })` per pane:
- `setViewport` and `setScissor` (in device pixels) are set to the pane's rectangle.
- The active camera's aspect matches the main pane.
- Overlays are shown or hidden per pane. The small views and the stereo halves hide the TransformControls helper, the rotate gizmo, the arrow and pick overlays, and the view cube. Hole highlights also stay out of the small views, to keep them uncluttered.
- Selection tint and Explode stay, since they live on the part materials and positions.
- Angle labels (DOM) are only placed for the main pane.

The four-view split is a 70/30 width split. The three small panes stack on the right, separated by 4 px gaps; the pane labels are HTML.

### 4. Small views: orthographic cameras that frame themselves
There is one `OrthographicCamera` per small view, with fixed directions (+X, +Y with up = +X, +Z), matching `capture_screenshot`'s front/top/side.
- **Auto-framing:** while a view is auto, each frame (or on part changes) it fits the visible parts' box projected onto the view plane, plus a 10% margin. This reuses the box logic from Frame.
- **Manual:** a wheel zooms about the pointer (adjusting zoom and position), and a drag pans. Either one sets `auto = false`.
- **Frame (`F`)** sets all three back to auto.
- *Alternative:* OrbitControls per small view with rotation off. Rejected: it binds to one element and brings damping and touch handling not needed here. Zoom-about-pointer and pan are each about 20 lines.

### 5. Stereo with `THREE.StereoCamera`
`StereoCamera.update(perspectiveCamera)` builds off-axis (parallel, not toed-in) left and right cameras that converge at `camera.focus`.
- **Each frame:** `focus = distance to orbit target`, `eyeSep = focus / 30 · stereoDepth`, and the perspective camera's aspect is set to the half-pane aspect before the update.
- **Swap:** left half = `cameraL` and right half = `cameraR`, or the other way round with Cross-eyed.
- **Projection:** stereo always uses the perspective camera. The saved projection is untouched and is reapplied when the layout leaves stereo.
- **Input (working half):** `inputEl` covers one half, the working half. That makes every existing pointer path work unchanged in stereo, as long as it asks for the *pointer camera* (the working half's eye) instead of the main camera. TransformControls also builds its pointer from `inputEl`'s rect.
  - **The pointer camera** covers: ray casts (`setRayFromEvent`), `projectToCanvas` for ring drags and angle labels, the hole-pick and copy hover, and `transform.camera`.
  - **OrbitControls** keeps driving the central perspective camera that the eyes follow.
  - **Eye cameras:** they come from `StereoCamera` with `matrixAutoUpdate` off. Their world position is read from `matrixWorld`, never from `.position`. Their `fov` is copied from the main camera so the gizmo has the same size in both eyes, and `projectionMatrixInverse` is refreshed each frame.
  - **Switching halves:** a `pointermove` on the container, with no button held and no drag, ring turn or other gesture under way, moves `inputEl` (and the pointer camera) to the other half. Moving `inputEl` only changes its style, not the canvas size, so nothing flickers.
- **Overlays:** they are drawn in both halves, so the gizmo, rings and previews are seen in depth. Angle labels are placed in the working half, offset by its position in the viewport.
- *Earlier version:* stereo was view-only. `inputEl` covered both halves, clicks were mapped per half, and editing was turned off. It was replaced at the user's request for a full workbench in stereo.

### 5b. Hide side panels
App holds a `panelsHidden` flag, remembered in `localStorage` (wrapped in try/catch, since the store can be unavailable). It adds `panels-hidden` to `.workspace-grid`: one column, with both `.panel`s `display: none`. The viewport's ResizeObserver resizes the canvas and panes. The toggle sits in the toolbar's View group, so it is always reachable.
- *Alternative:* toe-in (two cameras turned toward the target). Rejected: vertical parallax at the edges causes eye strain. The off-axis setup in StereoCamera avoids it.

### 5a. Stereo full screen
App holds an `immersive` flag. It is not saved, and it is cleared whenever the layout leaves stereo.
- **Entering:** turning it on adds `viewport-immersive` to the viewport element (`position: fixed; inset: 0; z-index` above everything). It also calls `document.documentElement.requestFullscreen()`, ignoring a refusal.
  - The fixed overlay covers the toolbar, panels, timeline, HUD pills and shortcuts bar, which are all outside the viewport element. So distraction-free works even where the browser refuses full screen.
  - The canvas and panes follow through the existing ResizeObserver.
- **Leaving:**
  - `fullscreenchange` back to no element clears the flag. In real full screen, the browser handles `Esc` that way.
  - In the window-only fallback, App's `Esc` handler clears it first and returns, so `Esc` doesn't deselect.
  - Clearing the flag calls `document.exitFullscreen()` when still in full screen.
- **Hint:** an App-rendered pill above the overlay, with a CSS fade-out after 3 s.
- *Alternative:* full screen on the viewport element alone. Rejected: when the browser refuses it, nothing would be hidden. The overlay gives the same result either way.

### 6. View cube in its own scene
A small `Scene` holds the cube: 26 region meshes (6 faces, 12 edges, 8 corners), built from a beveled box split into regions, with canvas-texture labels. It has its own orthographic camera.
- **Drawing:** each frame, the cube's camera takes the main camera's orientation (quaternion, looking at the origin from a fixed distance). The cube is drawn last into a 110 px square in the main pane's top-right corner (`autoClear` off, depth cleared first), so it is always on top.
- **Clicks:** a pointerdown inside that square is ray-cast against the cube scene first, ahead of the ring and gizmo handlers (capture phase). A hit starts the camera turn, and stops the event from reaching selection, orbit and the gizmo. A miss inside the square falls through, so the parts behind it can still be picked where the cube isn't drawn.
- **Hover** highlights the region under the pointer.
- **Turning:** a region's direction is the normalized sum of its face normals. `animateViewTo(direction, up)` slerps the camera's offset from the target over 300 ms (damping is off during it). The keys and `viewAlong` use the same function. Top and bottom use up = +X; the rest use +Y.
- **Hidden** in stereo, in the small views and in screenshots.

### 7. Settings flow
App state gains `projection`, `viewLayout`, `stereoCrossEyed` and `stereoDepth`, plus a `viewAlongTrigger` of `{ dir, n }`.
- **Saving:** they're saved in `viewport`, loaded with defaults when missing, and passed to Viewport3D as props.
- **MCP:** `configure_viewport` validates the new fields, merges them like the others, and turns `viewAlong` into `viewAlongTrigger.n + 1`.
- **History:** none of these touch `instances`, so the history recorder ignores them.
- **Keys:** `P`, and `1/2/3` read through `e.code` (Digit1–3), so Shift works on any keyboard layout. They go in App's key handler, next to `W`/`E`/`X`/`F`, and skip text fields like the others.
- **Toolbar:** a Persp/Ortho toggle button, and a three-way layout segmented control (Single / 4-View / Stereo). When Stereo is on, a Cross-eyed toggle and a Depth slider (0.25–3, step 0.25) are added.

### 8. Screenshots
`capture_screenshot`:
- **'current':** renders only the main pane's camera at the requested size. The aspect or ortho frustum is adapted to the image, and stereo is ignored (a single perspective image).
- **Standard views:** unchanged.
- **During capture:** the view cube is hidden.

### 9. Shadows
The key light (`dirLight1`, from above at the front right) casts a shadow map. The renderer already has `shadowMap.enabled` and `PCFSoftShadowMap`.
- **Turning it on:** sets `dirLight1.castShadow`, and shows a floor patch at the lowest visible part's bottom.
  - The patch is a dark slate Lambert plane with a radial alpha fade, receiving shadows. An invisible `ShadowMaterial` catcher was tried first, but the viewport background is black, so a shadow on it didn't show.
  - It also shifts the light levels slightly: ambient 0.65→0.5, hemisphere 0.65→0.55, key 1.1→1.35. This adds contrast between faces.
  - Turning it off restores all of this. Three recompiles the part materials when the number of shadow-casting lights changes, so "off" is exactly the old picture.
- **What casts and receives:** part meshes get `castShadow` and `receiveShadow` when they are created. No overlay mesh sets `castShadow`, so overlays never cast. Overlays drawn with `depthTest: false` don't receive either.
- **Subtlety:** only the key light (1.1) is blocked. Ambient (0.65), hemisphere (0.65) and the blue fill (0.55) still light shadowed areas, and `shadow.intensity` is 0.75 on top of that.
- **Fit:** each frame with shadows on, the light sits on its direction at 2R from the center of the visible parts' bounding sphere, and the floor patch moves with it. The 4096² shadow map then covers:
  - **Single and Stereo:** only what the main view sees. The main camera's view volume is cut to the depths where the build and floor lie, mapped into light space, and intersected with the light-space bounds of the build plus floor, with a 5% margin (10% in stereo, for the offset eyes). Zooming in therefore gives finer shadows.
  - **Four-view:** the whole build plus floor, since its small views show everything.
  - **Depth:** the depth range always covers every caster, so parts off screen still cast into view.
  - **Steadiness:** the area's size goes in quarter-octave steps and its center snaps to whole texels, so shadow edges don't shimmer while orbiting or zooming.
- **Offset:** `bias` is −0.0002 and `normalBias` is 0.75 texel. This is about half the first version's 1.5 texels at 2048. It keeps flat faces free of speckles while narrowing the lit gap that the offset leaves where a wall meets a floor (e.g. at the base of a hole's ring).
- **Multi-pane cost:** `shadowMap.autoUpdate = false`, and `needsUpdate = true` once per frame before the first pane, so four-view and stereo draw the map once, not once per pane. Screenshots set `needsUpdate` before rendering.
- *Alternative:* screen-space ambient occlusion (GTAO). It shades creases well, but it is a post-process per pane, interacts with the scissor panes and the depth-test-off overlays, and costs much more. Shadow maps answer the "flat" look and stay simple. AO can follow later as its own option.

### 10. Ambient occlusion
three's `GTAOPass`, run through an `EffectComposer` (`RenderPass` → `GTAOPass` → `OutputPass`) per pane slot: main, the three small views and the two stereo halves.
- **Composers:** each slot's composer is created on first use and resized when its pane changes size. It renders into the pane: the last pass draws to the screen with the renderer's viewport and scissor set to the pane.
- **Per pane:**
  - the pass camera is set to that pane's camera;
  - the `PERSPECTIVE_CAMERA` define is switched, with a material recompile, when the pane's camera type changes;
  - the stereo eyes get fresh `projectionMatrixInverse` each frame.
- **Overlays:** they are hidden during the composer render, so they neither cause nor get darkening. A depth-only pass of the scene content (parts, grid, floor) then refills the pane's depth buffer, and the overlays are drawn on top. Overlays that ignore depth (gizmo, rings, arrows, hole rings) still draw through parts, and the depth-tested see-through preview is still hidden behind parts.
- **What causes darkening:** GTAO only draws meshes into its normal/depth buffer, so grid, edge and trace lines never darken anything.
- **Settings** in scene units (mm): radius about 4 mm, thickness about 2 mm, 16 samples, denoised. Tuned by eye on beams and connectors.
- **Off:** the plain `renderView` path, so off is exactly the old picture.
- **Screenshots:** stay on the plain path (no AO), to keep them simple and fast.
- *Alternative:* SSAOPass. It is older, noisier and needs more tuning. GTAO is three's current recommended pass and includes denoising.

## Risks / Trade-offs

- **[Many handlers read the captured `camera` and `renderer.domElement`]** → This is one mechanical pass over the file, with a check after it: every existing scenario (drag snapping, mating, picking, Rotate mode, copy preview) is re-run in Single + perspective before any layout work starts (tasks group 1).
- **[Four renders per frame in four-view]** → The three small views skip shadows (they're orthographic outlines, so shadows add little), and run at the same pixel ratio. If the frame rate drops on large builds, the small views can render every second frame. That's a contained follow-up, with no spec change.
- **[OrbitControls with an orthographic camera zooms by `zoom`, not distance]** → Frame and the projection switch convert between distance and zoom explicitly (§1). The stereo separation uses the perspective camera's distance only.
- **[Top view with OrbitControls]** → Looking straight down sits at the polar limit. OrbitControls clamps it to a tiny epsilon, which is visually exact. The +X-up roll is set through the azimuth.
- **[Cube corner covers part of the scene]** → Only drawn cube pixels catch clicks (§6). The cube is small, and sits in a corner without HUD pills.
- **[Stereo comfort varies by person]** → The depth setting (0.25–3) covers this. The default 1/30 rule is a common comfortable choice.
- **[Merging with quick-copy-insert]** → Apply this change after that one is committed. Its handlers then move onto `inputEl` in the same pass.
