## Context

See proposal.md for why. What shapes the approach:

- **All 3D input lives in one component.** `src/components/Viewport3D.jsx` registers every pointer, wheel and key listener on `div.viewport-input` and `window` inside one setup effect (around lines 6142–6186). It uses Pointer Events throughout, with one native `dblclick` (mating) and no touch-specific code at all: no `pointerType` checks, no long-press.
- **Held keys are read in three ways.** `altKeyRef` (set by `trackAltKey`, 6006–6013) drives world axes (4289, 4572) and no-snap drags (5146, 5175, 5185, 5293, 2980). `e.altKey` drives the target hover and click (5713, 5772) and the exact pick (5728). `e.ctrlKey || e.metaKey` drives the copy preview (5767, 5873, 5656). `e.shiftKey || selectModeRef` drives additive picks (5727). Two props already stand in for a key: `selectMode` (Shift) and `holePicking` (Alt, for Bend sheet).
- **Hover does work a tap can't.** The target, Bend-sheet hole pick, band spot and copy preview all need a pointer move with no button down to light something before a click acts on it. A tap never produces that move, and `handlePointerLeave` (5997–6001) clears the lit state after every touch release. In hole picking a tap does work (`handlePointerUp` runs `updatePickHover` at the tap point, 5689–5691) but inserts at once with no preview.
- **App can't see what the view is doing.** Picking, placing, the copy preview, ring selection and mate arrows are refs inside Viewport3D. App only gets a sentence (`onPickStatus` → `pickStatus {text, tone}`) and four `onRegister*` hooks, none about interaction. `placeRequest` is set in App and never cleared there.
- **The wheel has five jobs**, decided in `handleWheelCapture` (5928–5984) in this order: grow selection (Shift), band spot, fits, ring, else camera zoom. Bend-by-holes fits have their own wheel listener in App (2420–2465).
- **Layout.** Left of the view: the Explode, Play and band panels (top 52, left 12) and, on tablets, the side panel. Top: HUD pills, the message strip and the tablet's floating toolbar. Bottom: full-width shortcuts strip, timeline, Audit panel (up to 42%), phone drawers. Top-right: the view cube (y 60–170, 110 px). The right edge below the cube is the only free edge, and on tablets and phones it is also the screen edge. The 44 px touch sizing is scoped to `.topbar` (styles.css 2494–2514).
- `rotationSnapDeg` (App.jsx 216) has no control anywhere.
- Everything here is client side. No server work.

### Survey: gestures a bar button has to stand in for

Out of the 57 gestures found, these need a key, wheel, right-click, double-click or hover, and so need something on screen:

| Today | What it does | Touch today | Stand-in |
|---|---|---|---|
| `W` / `E` / right-click the selection | Move / Rotate | top bar buttons | **Move**, **Rotate** on the bar |
| Shift + click | add or remove a part | Select menu → Select mode | **Add to selection** (same switch) |
| Shift + Alt + click | one part of a group | Outline row only | **One part of a group** |
| Alt + hover, Alt + click | light and set the target hole or pin end | impossible | **Mark a hole** |
| Alt held | Move arrows / rings on world axes | impossible | **World arrows** |
| Alt held while dragging | no hole pull, straighten or meshing | impossible | **Free move** |
| double-click the selection | mate, mate arrows, hole picking, set mate | unreliable (native `dblclick`) | **Join** |
| double-click a brain with a battery selected | slide the battery in | unreliable | **Join** |
| Ctrl/Cmd + hover, + double-click | copy preview, insert a copy | impossible | **Stamp copies** |
| wheel, `R`, `Shift+R` in picking / placing / copy | step fits | impossible | wheel bar (Fits) |
| wheel, `R`, `Shift+R`, `Enter`, `Esc` in Bend by holes | step, keep, drop the fit | Keep and Cancel only | wheel bar (Bend fits) |
| wheel with a ring selected | turn by snap steps | drag or typed angle only | wheel bar (Ring) |
| (none) | rotation snap 15/45/90/Free | no control | **Turn step** |
| Shift + wheel, Shift + Ctrl/Cmd + wheel | grow / shrink selection by layers | impossible | **Grow selection** → wheel bar (Layers) |
| wheel, `R` in the band builder | step to a nearby spot | impossible | wheel bar (Band spots) |
| hover then click a band spot | add a spot | impossible (tap adds nothing) | tap lights, second tap or tick adds |
| `Esc` in picking, arrows, ring | cancel | impossible | cross on the wheel bar |
| `D`, `Del` | duplicate, delete the selection | Outline → Selected box, or the Inspector behind the Outline | **Duplicate**, **Delete** |
| right-click the view cube | view options | impossible outside Stereo | View button on tablet and phone top bar |

Already fine by touch, so left alone: tap to select, gizmo and ring drags, ring and anchor-line taps, typed angles, mate arrow taps, box select (Select menu), the view cube's tap, drag and double-tap (timed in code, not native), one-finger orbit and two-finger zoom and pan (OrbitControls defaults), everything in menus and panels.

Not covered here (see proposal, Out of scope): library drag by touch (`startLibraryDrag` returns early for touch), the Stereo working half (hover only), pinch in the 4-View small views, double-click on a Play throttle.

### The bar's buttons and icons

Icons are 24 × 24, 1.75 px stroke, round caps, drawn in the style of the lucide set the app uses, so they sit next to lucide icons without looking foreign. Custom ones are needed where no lucide icon pictures the idea or where the fitting one is already used for something else (Magnet is Snap, Expand is Explode, Network is Select Connected, Crosshair is the pick pill, Pin is the drawer pin).

| Button | Stands in for | Kind | Icon | Tip line |
|---|---|---|---|---|
| Move | `W` | mode | lucide `Move` (as today) | Slide the part along its arrows |
| Rotate | `E`, right-click | mode | lucide `RotateCw` (as today) | Turn the part with its rings |
| Add to selection | Shift + click | switch | custom: pointer arrow with a small plus | Tap parts to add or take them out |
| Mark a hole | Alt + click | arms once | custom: a hole (ring) with four ticks round it, in the target's magenta; a filled dot while a target is set | Tap the hole or pin end the next part goes in |
| Join | double-click | action | custom: a pin with a short arrow pointing into a slot in a bar | Push the part into what it's lined up with, or pick a hole for it |
| Stamp copies | Ctrl/Cmd + double-click | switch | custom: a solid pin beside a dashed pin with a plus | Put a copy of this part in each hole you tap |
| World arrows | Alt | switch, two pictures | custom. Off: a tilted bar with two arrows tilted with it. On: the same tilted bar with the arrows upright | Arrows follow the room, not the part |
| Free move | Alt + drag | switch, two pictures | custom. Off: a pin above a hole with three short pull lines between them. On: the pin beside the hole, no lines, a slash through the hole | Stop parts jumping onto holes |
| Turn step | (none) | choice | custom: a quarter-circle wedge with the value ("15°") as text under it | How far each turn step goes |
| Grow selection | Shift + wheel | opens wheel | custom: a filled square with two outlined squares linked to it and a small plus | Add the parts joined to this one, layer by layer |
| One part of a group | Shift + Alt + click | arms once | custom: a dashed box round three squares, one filled | Pick a single part inside the group |
| Duplicate | `D` | action | lucide `Copy` (as the Inspector's Clone) | Make a copy next to it |
| Delete | `Del` | action | lucide `Trash2` (as the Inspector's Delete) | Remove it (Undo brings it back) |
| (wheel bar) wheel | mouse wheel | wheel | drawn: a short cylinder seen edge-on with ridges that scroll as it turns | — |
| (wheel bar) step up / down | `R` / `Shift+R` | action | lucide `ChevronUp` / `ChevronDown` | Next / previous |
| (wheel bar) tick | click, `Enter` | action | lucide `Check` | Put it in / Keep / Done |
| (wheel bar) cross | `Esc` | action | lucide `X` | Cancel |
| (wheel bar, Layers) Pins only | + Ctrl/Cmd | switch | custom: the Join pin on its own | Only follow pins and shafts |

Most buttons at once: eleven (one part with pins selected: Move, Rotate, Add to selection, Mark a hole, Join, Stamp copies, World arrows, Free move or Turn step, Grow selection, Duplicate, Delete). With nothing selected: four. A thin divider sits after Rotate, after Mark a hole, and before Duplicate.

World arrows follows the gizmo: it is shown only while a single part's arrows or rings are on screen (`transform.object` attached to one part in `Viewport3D.jsx`; App can tell from one part selected, not locked, visible, not a strung band, Explode off). The switch itself keeps its value while the button is away.

## Goals / Non-Goals

**Goals:**
- One place on screen that shows, and does by tap, everything in the survey table.
- No second code path: a bar button and its key drive the same branch in `Viewport3D.jsx`.
- Mouse and keyboard behaviour unchanged, apart from Move and Rotate leaving the top bar.
- Works in all three layout sizes without covering anything.

**Non-Goals:**
- A general touch-gesture layer (long-press on parts, double-tap handling, drag from the library).
- Changing fit rules, snapping rules, or anything in the engine or MCP server.
- Moving Snap, Focus or other top-bar items into the bar.
- Making the bar movable or configurable.

## Decisions

### 1. Right edge of the working view, below the cube
`ContextToolbar` is rendered inside `main.viewport-container` (already `position: relative`) as an absolutely placed column: `right: 12px; top: 182px`, with a bottom limit. In 4-View `right: calc(30% + 12px)`, matching `.viewport-hud-top`. The column wraps by CSS alone: when it runs out of height a second column appears to its left (a grid with `grid-auto-flow: column` and rows of one button's height, or a wrapping flex column; whichever keeps the bar's background as wide as its columns, since wrapping flex columns are known not to grow their box in some browsers). The room is measured: a `ResizeObserver` on the viewport container and on whichever bottom overlay is open (timeline, Audit panel, shortcuts strip) writes `--ctx-bar-bottom` on the container. When the room under the cube is under four buttons (a phone on its side), the bar starts at `top: 12px` and sits left of the cube instead (`right: 134px`).

z-index 18: above the band, Explode and Play panels (15, 16), below the Audit panel and message strip (20), the tablet toolbar (30) and phone drawers (40), so an open drawer covers it as it covers the view.

- *Why not the left edge:* the Explode, Play and band panels live there, and on tablets the view's left edge is 320 px in from the screen edge, out of thumb reach. The right edge is the screen edge on tablet and phone.
- *Why not a draggable palette:* more to learn, more to go wrong on a phone, and its position would have to be stored.
- *Why wrap, not scroll:* a scrolling bar hides buttons, which is the problem this change exists to fix.

### 2. Each key gets a second source, at the point where it is read
New `Viewport3D` props, mirrored into refs like the existing ones:

| Prop | Stands in for | Read where |
|---|---|---|
| `pointerTool`: `'select'` \| `'target'` \| `'stamp'` | Alt (target), Ctrl/Cmd (copy) | `'target'` OR'd with `e.altKey \|\| holePickingRef` at 5713 and 5772; `'stamp'` OR'd with `e.ctrlKey \|\| e.metaKey` at 5767, 5656, 5989 and in `handleDoubleClick`'s early return |
| `worldAxes` | Alt | 4289, 4572, 6010: `altKeyRef.current \|\| worldAxesRef.current` |
| `freeMove` | Alt | 5146, 5175, 5185, 5293, 2980: `altKeyRef.current \|\| freeMoveRef.current` |
| `exactPick` | Alt in Shift+Alt+click | 5728: `exact: e.altKey \|\| exactPickRef.current` |

Two small helpers (`worldAxesOn()`, `noSnapOn()`) replace the bare `altKeyRef.current` reads so the split is in one place. When `worldAxes` changes, the same side effects as `trackAltKey` run (set the gizmo's space, rebuild the ring setup), skipped mid-drag as today. `selectMode` stays as it is.

- *Why props, not synthetic key events:* dispatching a fake `keydown` for Alt would work for some reads and not others (the ones on `e.altKey` of a pointer event), and would fight real keys. Props are how `selectMode` and `holePicking` already work.
- *Why split Alt into two buttons:* the key does two unrelated things because keys are scarce. On a bar they can be two pictures, and a builder who wants world arrows with hole pulling still on can have it.

### 3. The view reports what it is doing, and takes commands
Two additions, both in the existing style:

- `onInteractionChange(state)`: called only when the state differs from the last one sent (shallow compare, so pointer moves don't re-render App). Shape: `{ session: null | 'fits' | 'arrows' | 'ring' | 'band', fitsKind: 'pick' | 'place' | 'target' | 'copy' | null, fit: { index, count } | null, lit: boolean, taken: boolean, ring: { label, angleDeg } | null, band: { nearby, name } | null }`. It is sent from the places that already call `emitPickStatus`, plus ring select/unselect, arrows shown/hidden and band hover changes.
- `onRegisterControls({ step(dir), commit(), cancel(), join(), ringDone() })`: `step` calls `cyclePickFit`, the ring's wheel turn or the band spot step, whichever session is running (the same branches as `handleWheelCapture`, pulled into one `stepSession(dir)` function that the wheel handler also calls). `commit` is `pickClick` on the lit target or the band pick. `cancel` runs the `Esc` branches at 5888–5917. `join` calls `handleMateRequest` for the selection, or `slideBatteryInto` for a battery with a free brain. `ringDone` unselects the ring.

App turns these, with its own Bend-by-holes and Grow-selection state, into one **stepper** object: `{ kind, readout, canStep, onStep, onCommit?, onCancel?, extras }`. `ContextToolbar` only knows the stepper, so adding a sixth wheel session later means building one more of these objects.

- *Why not lift the session state into React:* it changes on pointer moves and is read inside three.js callbacks; it is in refs for a reason. A change-only callback gives App what the bar needs without that cost.
- *Why not `useImperativeHandle`:* the file uses `onRegister*` callbacks for the same job already.

### 4. Held keys are tracked once, in App
A `useHeldKeys()` hook (window `keydown`, `keyup`, `blur`; ignores keys while typing in a field) returns `{ alt, shift, mod }`. The bar lights a button when `tappedOn || held`. Viewport3D keeps its own Alt tracking for its own reads; the hook is only for lighting buttons, so there is no risk of the two disagreeing about behaviour.

### 5. Which buttons show is a pure function
`src/utils/contextToolbarItems.js` exports `barItems({ selection, transformMode, locked, explode, playing, immersive, hasTarget, stepper, layout })` returning an ordered list of `{ id, state, disabledReason }`. No React, no DOM, so `scripts/check-context-toolbar.mjs` can assert every row of the spec's table. `ContextToolbar.jsx` maps ids to icon, name, tip and handler.

### 6. Touch taps: light first, place second
In `handlePointerUp`, for `e.pointerType !== 'mouse'`:

1. Run the hover step at the tap point first: `updateAltHover` (target tool or `holePicking`), `updateBandHover` (band builder), `updatePickHover` (fits; already done).
2. Fits and band: if the lit target is not the one that was lit before this tap, stop there (preview only). If it is the same, place. If nothing is near, return without touching the session.
3. Target tool and `holePicking`: act at once (setting a mark is harmless and has its own undo: tap it again).

`handlePointerLeave` ignores touch and pen pointers, so what a tap lit stays lit. The copy session starts from `pointerTool === 'stamp'` rather than from a key event, so it needs no pointer position to begin.

- *Why not place on the first tap:* that is what happens today in hole picking, and the part goes in at a fit the builder never saw. With a mouse the hover shows the fit first; two taps give touch the same look-then-place.
- *Why a missed tap does nothing:* a mouse shows the ring before the click, so a click away is a choice. A finger gets no ring first, so a near miss would throw away the session.
- *Why by `pointerType` per event, not a device setting:* laptops with touch screens use both. The rule follows the press, not the machine.

### 6a. Duplicate and Delete sit last, and don't ask
They call `handleDuplicateSelected` and `handleDeleteSelected` (App.jsx ~1644, ~1715), the handlers behind `D`, `Del` and the Inspector's buttons, so there is nothing new to build but the two buttons. Delete is the bottom button, below a divider and next to Duplicate rather than next to Join, so a thumb reaching for Join or the wheel is nowhere near it. No "are you sure": the key doesn't ask either, and Undo is in the top bar.

- *Why Duplicate as well as Stamp copies:* Duplicate puts a loose copy beside the part (any part, or a whole selection); Stamp copies puts copies into holes and only works for parts that plug in. Their icons differ (two overlapped sheets; a solid and a dashed pin).

### 7. One-shot buttons where the next step is somewhere else
Mark a hole and One part of a group turn themselves off after one use; Stamp copies and Add to selection stay on. After marking a hole the builder goes to the library, and after picking one part they work on it, so a mode left on would only swallow the next tap. Stamping and multi-select are done several times in a row.

### 8. The wheel
`ThumbWheel.jsx`: a 44 × 132 px (32 × 112 on desktop) element with `touch-action: none`. Pointer capture on press; every 24 px of travel calls `onStep(±1)` once; no momentum. Its ridges are a repeating gradient whose offset is `stepCount × 8 px`, animated, so it also turns when the step came from the mouse wheel or a key. `wheel` events on it step too (non-passive, `preventDefault`). A `ChevronUp` and `ChevronDown` button at its ends step once and are focusable, so keyboard and switch users can reach it. The read-out sits to the left of the wheel.

- *Why no momentum:* fits are few (often under ten) and each one moves a part; a flick that runs past the one wanted is worse than a few short drags.

### 9. Tips
`BarTip`: one absolutely placed element to the left of the hovered button, `role="tooltip"`, shown 500 ms after `pointerenter` (mouse) or on focus, and after a 500 ms hold for touch (the hold sets a flag so the following click is dropped). Keys are rendered with the existing `.kbd` style. Native `title` isn't used on the bar: it can't show keycaps, it is slow, and it doesn't exist on touch.

### 10. Banner text by input
A `lastPointerKind` ref (`'mouse'` | `'touch'`), set on every `pointerdown` in the view. `emitPickStatus`, the bend banner and the band hint take their controls sentence from a small table keyed by it (`"wheel or R for other fits, Esc to cancel"` ↔ `"turn the wheel for other fits, ✓ to put it in"`). The part of each message that says what is shown (part, target, "Fit 2 of 6") is shared.

### 11. Top toolbar
The `Transform Mode` group (App.jsx 2785–2808) is removed. The View button's condition changes from `viewLayout === 'stereo'` to `viewLayout === 'stereo' || layoutSize !== 'large'`. The medium toolbar gets about 96 px narrower, which also eases the wrap noted in `openspec/follow-ups.md`.

### 12. Styles
The bar gets its own class (`.ctx-bar`, `.ctx-btn`) using the `.hud-pill` look (dark, blurred, rounded). Size comes from `.app-shell[data-layout=medium|small] .ctx-btn` and `@media (pointer: coarse)`: 44 px; otherwise 32 px. On state is the accent fill plus an inset ring, so it doesn't rely on colour alone.

### 13. Phone: problems behind one button (added after testing on a phone)
On a phone the pills, banners and "done" strips covered much of the view, worst while scrubbing fits. In the small layout App leaves them out and gathers the warnings and errors into one list behind a warning button at the view's top left: live ones (a taken lit hole from `pickStatus` with tone `warning`, the selected part overlapping) are worked out each render, refusals (`actionFeedback` with `isError`) are kept until the list has been opened and closed. The wheel bar's read-out already names the fit, so nothing is lost by hiding the banner. Bend sheet by holes loses its banner's Stop on a phone, so while it waits for picks the bar shows a cross-only session (`bendPick`) on every layout.

### 15. On a phone the bar sits on the left
Testing on a phone showed the view cube taking much of the narrow view, so the bar under it landed over the middle of the build. In the small layout the bar moves to the left edge (`side: 'left'`), below the warning button: `left: 12px; top: 64px`, columns growing to the right (`direction: ltr`), its read-out, tips and the Turn step menu opening to its right. On a phone the band panel sits along the bottom, so the bar's bottom limit counts it too; the Explode and Play panels hide the bar. Tablets and desktop keep it on the right.

### 14. Auto Join and Manual Join
The view adds `join: 'auto' | 'manual' | null` to the interaction state: `auto` when `planMates` finds a plan for the selection (one part: from `lastAlignedRef`, kept live during drags; a set: the set's aligned openings, cached per selection and part list) or a selected battery fits a brain, else `manual`. It is sent from the aligned-hole update, so it follows drags. The bar swaps the icon, name and tip; what the button does is unchanged (`joinSelected`).

## Risks / Trade-offs

- [Eleven buttons is not a small bar] → buttons that don't apply are left out, so the common states are four (nothing selected) and nine to eleven (a part selected); dividers group them; the wheel bar replaces all of them during a session. At 44 px, eleven buttons need about 500 px, more than a tablet in landscape has under the cube, so a second column will be the usual sight there; task 4.4 checks it reads well. If it feels crowded in use, Grow selection and One part of a group are the two to move behind one "more" button.
- [Delete tapped by mistake] → it is the last button, below a divider; one Undo brings everything back.
- [The bar jumps as buttons come and go] → the order is fixed and the first four never move, so only the lower half changes, and only when the selection changes.
- [Splitting Alt across `altKeyRef` reads could miss one] → all reads go through two helper functions; task 2.6 greps for any bare `altKeyRef.current` left outside them.
- [`onInteractionChange` re-renders App during picking] → sent only on change; fit index and lit/not-lit change at human speed, not per frame.
- [Two taps feel slow for pins] → Stamp copies stays on, and the tick is under the thumb next to the wheel; marking a hole and bend picks stay one tap.
- [Free move left on by mistake: "my parts stopped snapping"] → its icon changes picture, not just colour; it resets on reload. If it proves a trap, turn it off on selection change.
- [`Viewport3D.jsx` is also being edited by `group-snapping`] → this change touches the handlers' entry points and adds helpers rather than rewriting drag code; do it after or rebased on that work.
- [Bar under the cube on short screens] → falls back to sitting beside the cube (Decision 1); checked at 844 × 390.
- [iOS Safari long-press shows its own callout] → `-webkit-touch-callout: none; user-select: none` on the bar.

## Migration Plan

1. Archive the finished `responsive-layout` change first, so its spec exists for this change's delta.
2. Build behind the normal dev flow; nothing is stored, so there is nothing to migrate and rolling back is reverting the commits.
3. On archive, strike the `app-settings` half of item 7 under "From outliner-part-groups" in `openspec/follow-ups.md` (the toolbar list is brought up to date here; the `explode-view` half stays).

## Open Questions

- Should the bar be able to sit on the left for left-handed builders? Would be a setting kept in the browser.
- Should the desktop shortcuts strip drop the entries the bar's tips now cover (Alt, Ctrl/Cmd)?
