## MODIFIED Requirements

### Requirement: Entering and leaving Rotate mode
Right-clicking the selected part SHALL switch between Move and Rotate mode. With a group or several parts selected, right-clicking any selected part SHALL do the same, and the rings turn the whole set about its centre. A right-click counts only when the pointer moves less than 5 px between press and release and a selected part is anywhere under the pointer (including behind another part); a right-drag SHALL keep panning the camera and SHALL NOT change the mode. The browser's context menu SHALL NOT open over the viewport. Right-clicking a part that is not selected, or empty space, SHALL do nothing. The `E` key, the toolbar Rotate button and the assistant's viewport setting `transformMode: 'rotate'` SHALL enter the same Rotate mode; the `W` key and the toolbar Move button SHALL leave it.

#### Scenario: Right-click the selected part
- **WHEN** a beam is selected in Move mode and the user right-clicks it
- **THEN** Rotate mode is on, the Move arrows are gone, and the rotation rings are shown around the beam

#### Scenario: Right-click a selected group
- **WHEN** a group is selected in Move mode and the user right-clicks one of its parts
- **THEN** Rotate mode is on and the rings are shown around the group's centre

#### Scenario: Right-click again
- **WHEN** Rotate mode is on and the user right-clicks the selected part
- **THEN** Move mode is on again and the Move arrows are shown

#### Scenario: Right-drag pans
- **WHEN** the user holds the right button on the selected part and drags 40 px
- **THEN** the camera pans and the mode does not change

#### Scenario: No browser menu
- **WHEN** the user right-clicks anywhere in the viewport
- **THEN** the browser's context menu does not appear

#### Scenario: Keyboard shortcut
- **WHEN** a part is selected and the user presses `E`
- **THEN** the same rotation rings appear as with a right-click

### Requirement: When rotation is refused
The system SHALL show no rotation rings and SHALL show a message, without moving anything, when a selected part is locked ("Part is locked") or when Explode view is on. In those cases a right-click SHALL NOT switch the mode. A part held by pins or shafts on more than one axis line SHALL still show the X, Y and Z rings about its own hole grid, like a free part; whether the turn is kept is decided when it ends (see "Overlaps and saving").

#### Scenario: Locked part
- **WHEN** the user right-clicks a selected part that is locked
- **THEN** the mode does not change, no rings appear, and a message says the part is locked

#### Scenario: Held in two places
- **WHEN** the selected beam has pins in two of its holes that are also in another beam, and the user right-clicks it
- **THEN** Rotate mode is on and the X, Y and Z rings are shown around the beam

#### Scenario: Next part can turn
- **WHEN** Rotate mode is on (entered with `E`) with a locked part selected, and the user selects a free part
- **THEN** rings appear around the free part

### Requirement: Overlaps and saving
Turning SHALL NOT be stopped by other parts while the ring is dragged or the wheel turns: when the part (or a part of the turning set) overlaps a part outside it, it SHALL be shown as overlapping. When the turn ends (a finished drag, a typed angle, or a pause in wheel turning) and the part or set overlaps a part it did not overlap when the turn began, the turn SHALL be put back: every turned part returns to where it was, the ring's angle goes back, nothing is saved, no history step is made, and a message says "Can't turn there: it would overlap another part. Put back." Otherwise the turn SHALL be saved the same way releasing a drag is: saved to the assembly, synced to the server, kept as the last valid pose only when not overlapping, and the aligned-hole highlights recomputed. Which joints hold the part SHALL be worked out again after each save.

#### Scenario: Turned into another part
- **WHEN** the user swings a pinned beam into a neighboring beam and lets go
- **THEN** the beam goes back to where it was, nothing is saved, and a message says it would overlap another part

#### Scenario: Saved like a drag
- **WHEN** the user finishes a ring drag that ends clear of other parts
- **THEN** the part's new rotation and position are in the saved assembly state and sent to the server

#### Scenario: Turned onto a joint
- **WHEN** a free part is turned so one of its pins ends up inside a beam hole, and the drag ends
- **THEN** the part now counts as held, and only that joint's ring is shown
