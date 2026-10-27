# copy-insert Specification

## Purpose

Lets the user stamp copies of the selected pin, peg or shaft part into holes anywhere in the model with Ctrl/Cmd+double-click, previewing with Ctrl/Cmd held which holes each copy would fill, so many identical pins can be added quickly.

## Requirements

### Requirement: Copy preview while Ctrl or Cmd is held
While the selected part has at least one pin, peg or shaft, or is a bore part (see hole-pick-insert: a part whose only fittings are shaft bores or sockets, like a gear or wheel hub), and the user holds Ctrl, or Cmd on macOS, the system SHALL treat the cursor like hole picking does. The target nearest the cursor, within about 24 screen pixels, SHALL be found on any visible part other than the selected one, with the one nearest the camera winning: a hole face that one of the part's pins, pegs or shafts fits, or for a bore part, an axle's end or a hole face that a shaft fits. For that target, the system SHALL show the best fit from the same fit rules as hole picking (see hole-pick-insert):
- a see-through copy of the part at the fit's pose, just outside the face;
- a cyan ring on the hovered hole and on every other hole the fit's pins would go into;
- a red marker for each pin that would land on no hole.

A hole that already has a part in it SHALL be shown taken (grey); an axle is never taken. The mouse wheel SHALL step through the fits while a target is lit. `R` is not used here: with Ctrl or Cmd held it would be the browser's reload shortcut. A short status line SHALL say which part and fit is shown. Releasing the modifier, moving away from any target, or changing the selection SHALL clear the preview. The preview SHALL NOT change the assembly, and SHALL NOT run during a drag, in Explode view, during hole picking or while mate arrows are shown.

#### Scenario: Ctrl over a beam hole
- **WHEN** a 0x2 Connector Pin is selected and the user holds Ctrl with the cursor near a beam hole
- **THEN** that hole is ringed cyan and a see-through pin is shown lined up just outside it

#### Scenario: Pattern lit
- **WHEN** a 2x Wide 2x2 Corner Connector (two pegs) is selected and the user holds Ctrl over a beam hole where both pegs fit
- **THEN** both holes the pegs would go into are ringed cyan

#### Scenario: Gear copies onto axles
- **WHEN** a 24 Tooth Gear is selected and the user holds Ctrl with the cursor near the end of an axle
- **THEN** the axle's end is ringed and a see-through gear is shown just past it, turned to fit the axle

#### Scenario: Release
- **WHEN** the user lets go of Ctrl
- **THEN** the rings, copy and markers disappear and nothing has changed

### Requirement: Ctrl/Cmd+double-click inserts a copy
A double-click with Ctrl or Cmd held, while a hole is lit and not taken, SHALL add a new copy of the selected part:
- **Pose:** the copy goes at the shown fit's pose, then is pushed in along the hole until it first touches another part, with the same contact rules as hole picking. The original part SHALL NOT move.
- **Name and look:** the copy SHALL be a new part, named after its catalog part with the next free number (for example "0x2 Connector Pin #7"), with the original's color, visible and unlocked.
- **History:** the insert SHALL be one history step labeled "Insert copy of <original> into <receiving part>", so one undo removes the copy.
- **Selection:** the original SHALL stay selected, and the Ctrl/Cmd preview SHALL keep working, so more copies can be inserted straight away.

If the hole is taken, or the start pose just outside the face overlaps another part, nothing SHALL be added, and the same messages as hole picking SHALL be shown ("That hole already has a part in it", "The way in is blocked"). The double-click SHALL be detected from the two presses, so that Ctrl+click acting as a right-click on macOS doesn't stop it.

#### Scenario: Stamp three pins
- **WHEN** a 0x2 Connector Pin is selected and the user Ctrl+double-clicks three free beam holes in turn
- **THEN** three new pins are seated in those holes, the original pin has not moved and is still selected, and the history has three "Insert copy of …" steps

#### Scenario: Undo a copy
- **WHEN** the user presses Ctrl/Cmd+Z after a copy insert
- **THEN** the copy is removed and the original is unchanged

#### Scenario: Taken hole
- **WHEN** the user Ctrl+double-clicks a hole that already has a pin in it
- **THEN** nothing is added and the message says the hole already has a part in it

#### Scenario: Part without pins
- **WHEN** a beam is selected and the user holds Ctrl over a hole
- **THEN** no preview appears, and Ctrl+double-click does nothing
