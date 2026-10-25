## Context

See proposal.md for the motivation. Hole picking (`Viewport3D`: `startPick`, `updatePickHover`, `renderPick`, `cyclePickFit`, `pickClick`; the pick overlay; `listInsertFits` / `openFaces` / `isOpeningTaken` in `pinHoleAlignment.js`) already does almost everything this needs:
- finding the hole face near the cursor;
- ranking fits, with patterns turned to the receiving part;
- a see-through copy with green/red markers;
- pushing in with `mateSelected`.

The differences are that it moves the selected part itself, and it starts with a double-click on that part.

Facts that shape the design:
- App adds parts through `setInstances(..., { label })`, one history step per call. `handleAddPart` numbers parts `"<name> #<n>"` from the count of the same catalog part.
- Double-clicks currently come from the canvas `dblclick` event. On macOS, Ctrl+click is turned into a right-click (`contextmenu`), so Ctrl+double-click may never reach `dblclick`.
- `mateSelected` sweeps the selected group and commits through `onUpdateTransform`. A copy has no group yet: it only gets one after App adds it and its mesh loads.

## Goals / Non-Goals

**Goals:**
- Reuse the picking code paths for hovering, fits and the overlay, so the copy preview and hole picking behave the same.
- One history step per copy, with the original untouched.

**Non-Goals:**
- Selected parts without inserts (beams).
- Multi-hole batch insert in one gesture.
- An MCP tool.

## Decisions

### 1. Copy preview as a mode of the picking session
The picking state is generalized into a session with `kind: 'pick' | 'copy'`.
- **Starting:** a copy session starts when the modifier goes down (keydown Control/Meta, or a pointermove with `ctrlKey`/`metaKey`) while a part with inserts is selected and nothing else is active. That means no drag, no picking, no arrows, no Explode, and focus not in a text field.
- **Ending:** it ends on keyup of the modifier, window blur, a selection change, or Explode.
- **Shared:** `updatePickHover`, `cyclePickFit` and the overlay are shared.
- **Differences from picking:** a copy session doesn't hide the gizmo, doesn't show the picking banner (App shows a short status line instead), and does nothing on a single click. Clicks with the modifier held never change the selection or toggle Move/Rotate, since they're part of the copy gesture.
- **Fits:** only the wheel steps through fits. `R` would be Ctrl+R / Cmd+R, the browser's reload, which pages can't reliably block.
- **Taken holes:** after an insert, the session marks that hole taken right away. Its candidates and the other parts' features are rebuilt when the part list changes, since the new copy's mesh loads a moment later.

### 2. Light every hole the copy fills
`holesFilledByFit(fit, otherFeatures)` returns, for the anchor and each green marker, the opening its pin lines up with. The fit already tests green with `linesCoincide`; it now also records which opening matched. The overlay's ring part becomes a small pool, so it can show several cyan rings (and the grey taken ring) at once.

### 3. Double-click from pointer events
The viewport tracks the last pointerup: time, position, and whether it was a click (less than 5 px of travel).
- A second click within 350 ms and 6 px, with Ctrl or Meta held, while a copy session has a lit, untaken hole and a fit, is a copy-insert.
- Detection uses `pointerdown`/`pointerup` with `button === 0` or, on macOS with Ctrl, `button === 2` (since Chrome reports a right button for Ctrl+click there). The canvas already blocks `contextmenu`.
- The `dblclick` handler ignores events with Ctrl or Meta held, so a modified double-click never mates (pin-mating change).

### 4. Final pose without moving the original
`computeCopyPose(fit)`:
1. Temporarily move the original group to the fit's start pose.
2. Check the way in: an overlap there means "The way in is blocked".
3. Sweep along `fit.direction` like `mateSelected` (0.5 mm steps, flush bisection, back-off), using `checkGroupCollision`. The original's real spot is empty during the test; that only matters if a copy would collide with the original, which it can't do while the original sits elsewhere.
4. Read the final position and rotation, and restore the original group's position and quaternion.

The sweep loop is factored out of `mateSelected` into `sweepToContact(group, start, direction, travelMm, sweepMm)`, which both use.

### 5. App adds the copy
A new `onInsertCopy(sourceId, { position, rotation }, receivingLabel)` prop. App:
1. builds a copy of the source instance: new id, `label = "<catalog name> #<count of that part + 1>"`, the same color, `visible: true`, `locked: false`, `isIntersecting: false`, and `lastValid*` set to the pose;
2. calls `setInstances(prev => [...prev, copy], { label: \`Insert copy of ${source.label} into ${receivingLabel}\` })`;
3. leaves `selectedId` alone;
4. shows "Inserted <copy label> into <receiving>".

## Risks / Trade-offs

- **[Ctrl on macOS is right-click]** → Cmd is accepted as well, and pointer-based detection accepts the Ctrl+click right-button report. This needs checking in a real browser on macOS. The headless check covers both modifiers.
- **[Holding Ctrl while using other shortcuts (Ctrl+Z, Ctrl+D)]** → The preview only shows; it changes nothing. The key handlers for those shortcuts are unchanged, and the session ends on keyup.
- **[Copy collides with the original]** → Impossible unless the hole is right next to the original. If it happens, the copy is still added, and the viewport's overlap recheck marks it as overlapping when its mesh loads.
- **[A ring pool instead of one ring]** → A small change to the overlay that picking also uses. Picking keeps showing one ring.
