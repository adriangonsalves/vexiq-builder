# copy-insert Specification

## Purpose

Lets the user stamp copies of the selected pin, peg or shaft part into holes anywhere in the model with Shift+Ctrl/Cmd+click, previewing with Shift+Ctrl/Cmd held which holes each copy would fill, so many identical pins can be added quickly.

## Requirements

### Requirement: Copy preview while Shift+Ctrl or Shift+Cmd is held
While the selected part has at least one pin, peg or shaft, or is a bore part (see hole-pick-insert: a part whose only fittings are shaft bores or sockets, like a gear or wheel hub), and the user holds Shift with Ctrl, or Shift with Cmd on macOS, the system SHALL treat the cursor like hole picking does. The target nearest the cursor, within about 24 screen pixels, SHALL be found on any visible part other than the selected one, with the one nearest the camera winning: a hole face that one of the part's pins, pegs or shafts fits, or for a bore part, an axle's end or a hole face that a shaft fits. For that target, the system SHALL show the best fit from the same fit rules as hole picking (see hole-pick-insert):
- a see-through copy of the part at the fit's pose, just outside the face;
- a cyan ring on the hovered hole and on every other hole the fit's pins would go into;
- a red marker for each pin that would land on no hole.

A hole that already has a part in it SHALL be shown taken (grey); an axle is never taken. The mouse wheel SHALL step through the fits while a target is lit. `R` is not used here: with Ctrl or Cmd held it would be the browser's reload shortcut. Over a lit target the wheel SHALL step fits rather than grow the selection by joints; away from any target Shift+Ctrl/Cmd+wheel SHALL grow the selection as before. Ctrl or Cmd alone SHALL NOT start the preview (Ctrl/Cmd+click picks one part, see multi-select). A short status line SHALL say which part and fit is shown. Releasing Shift or the modifier, moving away from any target, or changing the selection SHALL clear the preview. The preview SHALL NOT change the assembly, and SHALL NOT run during a drag, in Explode view, during hole picking or while mate arrows are shown.

#### Scenario: Shift+Ctrl over a beam hole
- **WHEN** a 0x2 Connector Pin is selected and the user holds Shift+Ctrl with the cursor near a beam hole
- **THEN** that hole is ringed cyan and a see-through pin is shown lined up just outside it

#### Scenario: Pattern lit
- **WHEN** a 2x Wide 2x2 Corner Connector (two pegs) is selected and the user holds Shift+Ctrl over a beam hole where both pegs fit
- **THEN** both holes the pegs would go into are ringed cyan

#### Scenario: Gear copies onto axles
- **WHEN** a 24 Tooth Gear is selected and the user holds Shift+Ctrl with the cursor near the end of an axle
- **THEN** the axle's end is ringed and a see-through gear is shown just past it, turned to fit the axle

#### Scenario: Release
- **WHEN** the user lets go of Ctrl or Shift
- **THEN** the rings, copy and markers disappear and nothing has changed

### Requirement: Shift+Ctrl/Cmd+click inserts a copy and starts stamping
A click with Shift and Ctrl, or Shift and Cmd, held, while a hole is lit and not taken, SHALL add a new copy of the selected part:
- **Pose:** the copy goes at the shown fit's pose, then is pushed in along the hole until it first touches another part, with the same contact rules as hole picking. The original part SHALL NOT move.
- **Name and look:** the copy SHALL be a new part, named after its catalog part with the next free number (for example "0x2 Connector Pin #7"), with the original's color, visible and unlocked.
- **History:** the insert SHALL be one history step labeled "Insert copy of <original> into <receiving part>", so one undo removes the copy.
- **Selection:** the original SHALL stay selected.
- **Stamping:** after a copy goes in, Stamp copies SHALL turn on (see context-toolbar), so plain clicks on lit holes go on inserting copies after the keys are let go, until it is turned off (`Esc`, the bar's cross, tapping Stamp copies, or a selection change).

If the hole is taken, or the start pose just outside the face overlaps another part, nothing SHALL be added, and the same messages as hole picking SHALL be shown ("That hole already has a part in it", "The way in is blocked"). Ctrl/Cmd+double-click SHALL NOT insert a copy.

#### Scenario: Stamp three pins
- **WHEN** a 0x2 Connector Pin is selected, the user Shift+Ctrl+clicks a free beam hole, lets go of the keys and clicks two more free beam holes
- **THEN** Stamp copies is on, three new pins are seated in those holes, the original pin has not moved and is still selected, and the history has three "Insert copy of …" steps

#### Scenario: Undo a copy
- **WHEN** the user presses Ctrl/Cmd+Z after a copy insert
- **THEN** the copy is removed and the original is unchanged

#### Scenario: Taken hole
- **WHEN** the user Shift+Ctrl+clicks a hole that already has a pin in it
- **THEN** nothing is added, Stamp copies stays off and the message says the hole already has a part in it

#### Scenario: Part without pins
- **WHEN** a beam is selected and the user holds Shift+Ctrl over a hole
- **THEN** no preview appears, and Shift+Ctrl+click adds nothing
