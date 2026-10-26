## Why

The viewport has one perspective camera that can only be turned by orbiting. That makes some checks hard:
- lining parts up square along an axis;
- seeing whether a beam is straight from the side;
- judging depth on a crowded build.

CAD tools solve this with orthographic views, one-click axis views, several views at once, and (for depth) stereo pairs. This change adds those to the viewport.

## What Changes

- **Perspective / orthographic toggle.** A toolbar button and the `P` key switch the main view between perspective and orthographic (no vanishing point, parallel edges stay parallel). The view keeps the same target, direction and apparent size when switching. Orbit, pan, zoom, Frame (`F`) and every editing tool work the same in both.
- **Axis views and a view cube.**
  - `1`, `2`, `3` turn the camera to look along X, Y or Z. Shift+`1/2/3` looks from the opposite side.
  - A small labeled cube sits in a corner of the main view and turns with the camera. Clicking one of its faces, edges or corners turns the camera to that view (6 axis views, 12 edge views, 8 corner views). The turn is a short animation about the current target, keeping the distance.
- **Four-view layout.**
  - One large working view, with three smaller orthographic views beside it: along X (front), Y (top) and Z (side).
  - The small views follow the build as it changes. They frame the whole visible build until zoomed or panned with the wheel or a drag. `F` reframes them.
  - They are view only: no selecting or editing there, and no gizmos, rings, arrows or pick previews drawn in them. The selected part's highlight still shows.
  - Every tool keeps working in the large view.
- **Stereo layout.**
  - The view is split into two side-by-side images of the same scene, taken from two eye positions a small distance apart horizontally.
  - The separation follows the distance from the camera to the orbit target (about 1/30 of it), so depth stays comfortable at any zoom. A depth setting scales it.
  - The two images line up at the target, so the target appears at screen depth.
  - By default the left image is the left eye's view (parallel viewing, phone VR viewers). A **Cross-eyed** toggle swaps the images, because when crossing your eyes the right eye looks at the left image.
  - Stereo always uses perspective.
  - Stereo is a full workbench: moving with snapping, Rotate mode, mating, hole picking and Ctrl-copy all work in whichever half the pointer is over. The gizmo and other aids are drawn in both pictures, so they are seen in depth.
- **Hide side panels.** A toolbar toggle hides the parts library and Inspector, so the viewport (and the stereo pair, without full screen) takes the full width.
  - A **Full screen** button fills the whole screen with the pair, hiding everything else, for easier viewing. `Esc` leaves it.
- **Shadows (optional).** A Shadows toggle, off by default, makes the main light cast soft, subtle shadows. Parts shade each other, and the build casts a faint shadow on the ground under it, so surfaces look less flat. It shows in every view and layout.
- **Ambient occlusion (optional).** A separate AO toggle, off by default, darkens creases and inside corners where faces meet. It works alone or with Shadows, so the two can be compared before deciding whether to keep both.
- **Saving and MCP.** AO, shadows, projection, layout, cross-eyed and stereo depth are saved with the other viewport settings and restored on load. They don't create history steps. `configure_viewport` gains:
  - `projection`, `viewLayout`, `stereoCrossEyed` and `stereoDepth`;
  - a one-shot `viewAlong` (e.g. `"+x"`, `"-y"`) that turns the user's camera like the axis keys.
- **Out of scope:**
  - Editing in the small views or in stereo.
  - Red/cyan (anaglyph) glasses and VR headsets.
  - Saving the camera position itself.

## Capabilities

### New Capabilities
- `camera-views`:
  - the perspective/orthographic toggle;
  - axis views by key;
  - the clickable view cube;
  - saving the view settings and setting them over MCP.
- `four-view-layout`: the large working view plus three view-only orthographic X/Y/Z views: framing, zoom and pan, and what is drawn in them.
- `stereo-view`: side-by-side stereo pairs, separation that follows the distance, the depth setting, the cross-eyed swap, distraction-free full screen, and what input works while stereo is on.

- `render-ambient-occlusion`: the optional ambient occlusion effect that darkens creases and inside corners, toggled separately from shadows; saved and set over MCP.
- `render-shadows`: the optional shadow pass (what casts and receives, the ground shadow, subtlety, following changes, every view), saved and set over MCP.

### Modified Capabilities
(none: the history spec already says viewport settings don't create steps, and the new settings fall under it)

## Impact

- `src/components/Viewport3D.jsx`, the bulk of the work:
  - a second (orthographic) camera that the controls, ray casts and overlays can switch to;
  - an input layer over the main view, so pointer math uses the main view's area instead of the whole canvas;
  - drawing several views per frame with one renderer;
  - the view cube;
  - the stereo cameras.
- `src/App.jsx`:
  - the toolbar controls (projection, layout, stereo options);
  - the keys `P`, `1/2/3` and Shift+`1/2/3`;
  - the new viewport settings in save and load.
- `src/index.css` (or the app's stylesheet): pane layout and labels.
- `mcp/vexiq-mcp-server.mjs`: new `configure_viewport` fields. `vite.config.js` passes them through like the existing viewport fields.
- `features.md`.
- No new dependencies. three.js already has `OrthographicCamera` and `StereoCamera`.
