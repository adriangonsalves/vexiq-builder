## Why

Much of what the 3D view can do is reached by holding a key, turning the mouse wheel, right-clicking, double-clicking or hovering: Alt marks a hole, Alt swaps the Move arrows to the world's axes and turns hole pulling off, Ctrl/Cmd + double-click stamps a copy, Shift + wheel grows the selection, the wheel or `R` steps through fits. Nothing on screen says so, so builders only find these when told, and on a tablet or phone most of them can't be done at all (a survey of the view's input found 57 separate gestures; setting a target, the copy preview, stepping through fits, growing the selection and picking a band spot are all out of reach by touch). The tablet and phone layouts were built with touch input left for later; this is that work.

## What Changes

- **A context bar in the 3D view:** a small column of icon buttons on the right edge of the view, below the view cube. It shows what can be done right now and changes with what is selected and which mode is on. Every button is a picture of what it does.
- **Move and Rotate move into the bar** and leave the top toolbar, in every layout. `W`, `E` and right-click on the selected part still work.
- **Held keys become buttons that stay on.** Each key-only gesture gets a button that does the same thing with a tap, and the button lights while its key is held, so the bar also teaches the shortcut:
  - **Add to selection** (Shift + click; the existing Select mode)
  - **Mark a hole** (Alt + click: sets the target for the next library part)
  - **Join** (double-click: mate, pick a hole, slide a battery into the brain)
  - **Stamp copies** (Ctrl/Cmd + double-click)
  - **World arrows** (Alt: Move arrows and Rotate rings on the world's axes), shown only while one part's arrows or rings are on screen
  - **Free move** (Alt while dragging: no pull onto holes)
  - **Grow selection** (Shift + wheel, and pins only with Shift + Ctrl/Cmd + wheel)
  - **One part of a group** (Shift + Alt + click)
  - **Turn step** (15°, 45°, 90°, Free). This setting exists today but has no control anywhere.
- **Duplicate and Delete on the bar** whenever something is selected (`D` and `Del`). On a tablet or phone they are otherwise two taps away, in the Outline.
- **The bar turns into a wheel.** Whenever the mouse wheel steps through something instead of zooming (fits while hole picking, placing, stamping or bending; a selected rotate ring; selection layers; nearby band spots), the bar is replaced by a thumb wheel seen edge-on with the current value beside it (for example "2 / 6"), a tick to keep and a cross to cancel. Dragging the wheel does what the mouse wheel does. The mouse wheel keeps working and the bar's wheel turns with it.
- **Touch taps show first, then place.** A finger can't hover, so in hole picking, placing and stamping the first tap on a hole lights it and shows the fit, and the tick (or a second tap on the same hole) puts the part in. A tap that misses every hole no longer cancels. Marking a hole, picking a bend hole and picking a band spot work with one tap.
- **Tips:** resting the mouse on a bar button shows its name, one line on what it does and its shortcut. Pressing and holding a button on a touch screen shows the same without the shortcut.
- **Messages match the input:** banners that say "wheel or R", "Ctrl/Cmd + double-click" or "Esc" name taps and the bar's buttons instead when the view was last used by touch.
- **View options on tablets and phones:** the top toolbar's View button is shown in the tablet and phone layouts in every view layout (today it shows only in Stereo, and the cube's menu needs a right-click).
- Everything runs in the browser. Nothing new is saved with the build, and no button on the bar adds a history step by itself.

## Out of scope

- Dragging a part from the library into the view by touch (it stays mouse only; by touch: mark a hole, then tap the part in the library).
- Camera gestures (one finger turns, two fingers zoom and pan already work), and pinch or pan in the 4-View small views.
- Choosing the working picture in Stereo by touch.
- Hide, Lock and Colour buttons on the bar (they have buttons in the Outline already).
- Moving the bar to the left edge on desktop and tablets (a phone puts it there, clear of the view cube), or dragging it around.
- The keyboard shortcuts strip under the view on desktop (kept as it is).

## Capabilities

### New Capabilities
- `context-toolbar`: the context bar in the 3D view: where it sits, which buttons it shows in each situation, how each stands in for a held key, right-click, double-click or the wheel, the thumb wheel, tips, and how touch taps preview before they place.

### Modified Capabilities
- `app-settings`: "Compact toolbar" no longer lists Move and Rotate, shows the View button on tablet and phone layouts, and its list is brought up to date with the Select and Tools menus that have since replaced the Explode drop-down and the Audit & Blueprint button.
- `rotate-mode`: "Entering and leaving Rotate mode" names the context bar's Move and Rotate buttons instead of the toolbar's.
- `view-cube-menu`: "Right-click view menu" shows the toolbar's View button in the medium and small layouts always, not only in Stereo.
- `responsive-layout`: "Medium layout uses a floating icon toolbar" keeps undo and redo as direct buttons but no longer Move and Rotate. This capability is still in the unarchived `responsive-layout` change, so that change has to be archived before this one.

## Impact

- `src/components/Viewport3D.jsx`: the pointer, wheel and key handlers. Alt, Ctrl/Cmd and Shift are read straight from events and from a ref today; each needs a second source (the bar). Touch taps need the hover step run at the tap point, and the view has to report what it is doing (picking, fits, ring selected) and take commands (next fit, keep, cancel, join), which it can't today.
- `src/App.jsx`: top toolbar (Move/Rotate out, View button on small layouts), new bar state, held-key tracking, banner text.
- New `src/components/ContextToolbar.jsx`, a thumb wheel, a tip, and a set of custom icons; `src/styles.css` (the bar gets its own sizing; the 44 px touch rules are scoped to the top bar today).
- `src/components/useBandBuilder.js` / `BandBuilderPanel.jsx`: spot stepping from the bar, tap to pick.
- No change to the MCP server, saved builds or the engine. No new dependency.
- Overlaps with open changes: `rubber-bands` task 4.6 (touch check of the band builder), `group-snapping` (edits the same drag and pick handlers in `Viewport3D.jsx`; its set hole picking gets the wheel bar for free), `target-hole-placement` (touch was left out of it; this adds the button).
