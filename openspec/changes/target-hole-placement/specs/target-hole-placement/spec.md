## Purpose

Lets the builder mark the hole or pin end where the next part goes, with Alt+hover and Alt+click, and add a library part straight into it, choosing among the fits that don't overlap other parts.

## ADDED Requirements

### Requirement: Alt+hover lights a target
While Alt (Option on macOS) is held, the system SHALL light the one target nearest the cursor, within about 24 screen pixels, on any visible part. A target is either a face of a hole (a pin hole, shaft bore, motor socket or collar hole) or an end of a pin, peg or shaft that sticks out of the parts it sits in. When several are near the cursor, the one nearest the camera SHALL win. No part needs to be selected, and the lit target SHALL NOT depend on the selected part. A hole that already has a part seated in it SHALL be lit as taken (grey). The light SHALL go away when Alt is let go or the cursor moves away from every target. It SHALL NOT be shown during a drag, while a part is being placed or hole picked, while mate arrows are shown, in Explode view, or while a box is being drawn, and it SHALL NOT change the assembly.

#### Scenario: Hover a beam hole
- **WHEN** nothing is selected and the user holds Alt with the cursor near the top face of a free beam hole
- **THEN** that hole's top rim is lit

#### Scenario: Hover a pin end
- **WHEN** a connector pin stands half out of a plate and the user holds Alt with the cursor near its free end
- **THEN** the pin's free end is lit

#### Scenario: Let go
- **WHEN** a hole is lit and the user lets go of Alt
- **THEN** the light goes away and nothing has changed

### Requirement: Alt+click sets the target
An Alt+click (without Shift) while a target that isn't taken is lit SHALL set it as the target: it SHALL stay marked in a colour of its own, different from the hole highlights, the copy preview rings and the pin markers, after Alt is let go. Alt+click SHALL NOT change the selection. Alt+click on another target SHALL move the target there; Alt+click on the target itself, or `Esc` when nothing is being placed, SHALL clear it. Alt+click on a taken hole SHALL set nothing and show "That hole already has a part in it". The target SHALL follow its part when the part moves or turns, and SHALL be cleared when its part is hidden, removed, or taken away by undo, redo, the timeline or MCP, or when a part is seated in the target hole. The target SHALL NOT be saved with the build or in history. Shift+Alt+click SHALL keep selecting a single part of a group.

#### Scenario: Set a target
- **WHEN** the user Alt+clicks a lit beam hole and lets go of Alt
- **THEN** the hole stays marked as the target and the selection is unchanged

#### Scenario: Clear the target
- **WHEN** a target is set and the user presses `Esc`
- **THEN** the target mark goes away

#### Scenario: Taken hole
- **WHEN** the user Alt+clicks a hole that already has a pin in it
- **THEN** no target is set and the message says the hole already has a part in it

#### Scenario: Target moves with its part
- **WHEN** a hole of a beam is the target and the user drags the beam 2 pitch along
- **THEN** the target mark moves with the beam's hole

### Requirement: Fits at the target
For a library part and a target, the system SHALL list the part's fits there:
- **Target hole, part with pins, pegs or shafts that fit it:** each such insert pushed into the hole, at each 90° roll relative to the receiving part (the hole-picking fit rules, including square-shaft flats and parallel holes for patterns at an angle).
- **Target hole, bore part:** the part's bore lined up with the hole and the part on that face, when a shaft fits the hole (the hole-picking bore rules).
- **Target hole, part with holes but nothing to plug into it:** one of the part's holes lined up with the target hole, its face flat on the target face, at each 90° roll relative to the receiving part. A part with pins or pegs that fit nothing in the hole but holes that line up SHALL get these fits too when it has no plug fit.
- **Target pin, peg or shaft end, part with holes it fits:** one of the part's holes on the target's axis, slid onto it from that end, at each 90° roll (a square shaft takes the rolls that line up the flats); a bore part's bore on a shaft end as in hole picking.

Each fit SHALL be judged at its seated pose: pushed in or slid on until it first touches another part, with the contact, flush and tight-fit rules of hole picking. A fit whose seated pose overlaps another part SHALL be left out. Fits giving the same pose SHALL be listed once. Fits SHALL be ordered by how many of the part's pins, pegs, shafts or holes line up with matching openings or inserts on other parts (most first), then by the smallest turn from the part's library orientation.

#### Scenario: Pin into a target hole
- **WHEN** a beam hole is the target and the user clicks the 0x2 Connector Pin in the library
- **THEN** the pin is shown seated in that hole

#### Scenario: Beam onto a target pin
- **WHEN** a pin sticking out of a plate is the target and the user clicks a 1x6 Beam in the library
- **THEN** the beam is shown slid onto the pin, flat on the plate

#### Scenario: Plate lined up on a target hole
- **WHEN** a beam hole is the target and the user clicks a 4x8 Plate in the library
- **THEN** the plate is shown lying flat on the beam's face with one of its corner holes over the target hole

#### Scenario: Overlapping fit left out
- **WHEN** a beam hole next to a standing wall is the target and a roll of a corner connector would put its other face into the wall
- **THEN** that roll is not offered

### Requirement: Corner holes for parts with many holes
When the part being placed has holes and no pins, pegs or shafts, and more than four of its holes face the same way, only its corner holes on that face SHALL be used as the hole that meets the target: the holes at the corners of the smallest rectangle, in the part's own axes, that holds the centres of that face's holes (for a single row, its two end holes). A part with four or fewer holes facing a way SHALL use all of them.

#### Scenario: Beam's end holes
- **WHEN** a hole is the target and a 1x12 Beam is placed there
- **THEN** only fits with one of the beam's two end holes on the target are listed

#### Scenario: Plate's corners
- **WHEN** a hole is the target and a 4x8 Plate is placed there
- **THEN** only fits with one of the plate's four corner holes on the target are listed

### Requirement: Placing at the target
With a target set, clicking a part in the library SHALL add the part, select it, and show it at its first fit at the target, in position choosing:
- the part SHALL stay at the target and SHALL NOT follow the pointer;
- the mouse wheel or `R` SHALL step to the next fit and `Shift+R` to the previous one, without zooming;
- the camera SHALL still orbit and pan;
- a banner SHALL name the part and the receiving part, say which fit is shown and how many there are ("Fit 2 of 6"), and name the controls.

A click in the view (not a drag) SHALL keep the shown fit, as one history step labelled "Add <part> into <receiving part>", and clear the target. `Esc`, selecting another part, or anything else that ends placing SHALL remove the part, leave no history step, and keep the target. Clicking another library part while placing SHALL remove the one being placed and place the new one at the target. When the part has no fit at the target, or every fit overlaps, nothing SHALL be added, the target SHALL stay, and a message SHALL say so ("No free fit for <part> at this hole" or "… on this pin").

#### Scenario: Scrub and finalise
- **WHEN** a corner connector is shown at the target and the user scrolls the wheel twice and clicks in the view
- **THEN** the connector stays at the third fit, the history has one step "Add … into …", and the target is cleared

#### Scenario: Cancel
- **WHEN** a gear is shown at the target and the user presses `Esc`
- **THEN** the gear is gone, the history has no new step, and the target is still marked

#### Scenario: No free fit
- **WHEN** the target is a hole boxed in by parts on every side and the user clicks a 4x8 Plate in the library
- **THEN** nothing is added, the target stays, and the message says there is no free fit for the plate at this hole
