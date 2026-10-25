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
- **Input:** `inputEl` covers both halves. OrbitControls works across it, since orbit and pan don't depend on the pointer's position, and zoom is about the target.
- **Selecting:** a click is converted to the NDC of the half it falls in, and ray-cast with that half's eye camera.
- **Editing off:** on entering stereo, the transform is detached and `transform.enabled` set to false, rotate rings and the view cube are hidden, and the double-click, right-click and Ctrl paths return early with a status message. Leaving stereo calls `syncGizmos()`.
- *Alternative:* toe-in (two cameras turned toward the target). Rejected: vertical parallax at the edges causes eye strain. The off-axis setup in StereoCamera avoids it.

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

## Risks / Trade-offs

- **[Many handlers read the captured `camera` and `renderer.domElement`]** → This is one mechanical pass over the file, with a check after it: every existing scenario (drag snapping, mating, picking, Rotate mode, copy preview) is re-run in Single + perspective before any layout work starts (tasks group 1).
- **[Four renders per frame in four-view]** → The three small views skip shadows (they're orthographic outlines, so shadows add little), and run at the same pixel ratio. If the frame rate drops on large builds, the small views can render every second frame. That's a contained follow-up, with no spec change.
- **[OrbitControls with an orthographic camera zooms by `zoom`, not distance]** → Frame and the projection switch convert between distance and zoom explicitly (§1). The stereo separation uses the perspective camera's distance only.
- **[Top view with OrbitControls]** → Looking straight down sits at the polar limit. OrbitControls clamps it to a tiny epsilon, which is visually exact. The +X-up roll is set through the azimuth.
- **[Cube corner covers part of the scene]** → Only drawn cube pixels catch clicks (§6). The cube is small, and sits in a corner without HUD pills.
- **[Stereo comfort varies by person]** → The depth setting (0.25–3) covers this. The default 1/30 rule is a common comfortable choice.
- **[Merging with quick-copy-insert]** → Apply this change after that one is committed. Its handlers then move onto `inputEl` in the same pass.
