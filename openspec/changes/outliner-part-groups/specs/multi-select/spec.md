## Purpose

Lets the user select more than one part at a time, by clicking or by following the joints between parts, so several parts can be grouped, hidden, locked, deleted, moved or turned together.

## ADDED Requirements

### Requirement: Selection holds several parts
The selection SHALL be a set of parts, possibly empty, with one of them, the one selected last, as the primary part. Every selected part SHALL be highlighted in the 3D view and its row highlighted in the Outliner, with the primary part shown more strongly. In the 3D view a selected part SHALL also get a thick contour around its outline, light with a dark rim so it shows on parts of any color, visible through parts in front of it. Selecting a part that belongs to a group from the 3D view SHALL select the whole group (see part-groups). Everything that works on one part (the position and rotation fields, color, label, hole picking, mating, copy-insert, the assistant's `selectedId`) SHALL keep working on the primary part when exactly one part is selected. Changing the selection SHALL NOT create a history step. Parts that are deleted, or that disappear on undo, SHALL drop out of the selection.

#### Scenario: Two parts highlighted
- **WHEN** a beam is selected and the user Shift+clicks a plate
- **THEN** both are highlighted in the 3D view and the Outliner, and the plate is the primary part

#### Scenario: Undo removes a selected part
- **WHEN** two parts are selected, one of them was just added, and the user presses undo
- **THEN** the added part is gone and only the other part stays selected

### Requirement: Shift+click in the 3D view
In the 3D view, a click with Shift held on a part SHALL add it to the selection, or remove it if it is already selected; a Shift+click on empty space SHALL leave the selection as it is. A plain click SHALL keep its current behavior: it replaces the selection with the clicked part, and a click on empty space clears the selection. Ctrl/Cmd+click SHALL NOT be used for selecting in the 3D view, because Ctrl/Cmd is used by copy-insert and Ctrl+click on macOS is a right-click.

#### Scenario: Add with Shift
- **WHEN** a beam is selected and the user Shift+clicks a pin
- **THEN** the beam and the pin are both selected

#### Scenario: Remove with Shift
- **WHEN** a beam and a pin are selected and the user Shift+clicks the pin
- **THEN** only the beam stays selected

#### Scenario: Plain click replaces
- **WHEN** three parts are selected and the user clicks a fourth without Shift
- **THEN** only the fourth part is selected

### Requirement: Selecting in the Outliner
In the Assembly Outliner, a plain click on a row SHALL select only that row's part or group. Ctrl+click, or Cmd+click on macOS, SHALL add or remove that row. While Select mode is on, every row SHALL have a checkbox, and a plain click on a row or its checkbox SHALL add or remove its part (a folder's: its whole group, shown mixed when only some of its parts are selected) without changing the rest of the selection; with Select mode off the checkboxes SHALL NOT be shown. Shift+click SHALL select every part between the primary part and the clicked row in build order, adding them to the selection. Clicking a part's row inside a group folder SHALL select just that part, not the whole group.

The selected parts SHALL be listed first, under a "Selected (N)" heading with a Clear button, in build order: a wholly selected group as its folder, and a selected part of a partly selected group as its own row naming the group. The other parts SHALL follow under "Other parts".

#### Scenario: Checkbox adds and removes
- **WHEN** Select mode is on, a beam is selected, and the user ticks a plate's checkbox, then unticks the beam's
- **THEN** the plate is added while the beam stays selected, and then only the plate is selected

#### Scenario: Selected parts on top
- **WHEN** the user selects two parts far down the list
- **THEN** both rows show at the top under "Selected (2)", highlighted

#### Scenario: Ctrl/Cmd+click a row
- **WHEN** one row is selected and the user Cmd+clicks another row
- **THEN** both rows are selected

#### Scenario: Range
- **WHEN** row 3 is selected and the user Shift+clicks row 7
- **THEN** rows 3 to 7 are selected

### Requirement: Box select
The Select menu SHALL have a Box select mode, also toggled with `B`. While it is on, a left-drag in the 3D view that does not start on the Move arrows or a rotate ring SHALL draw a rectangle instead of turning the camera, and on release SHALL select the visible parts in it: dragged left to right, the parts wholly inside the rectangle; dragged right to left, every part it touches (the two are drawn differently). A part in a group SHALL bring in its whole group. The parts SHALL replace the selection, or be added to it with Shift held or while Select mode is on. A short drag SHALL count as a click. The camera SHALL NOT move while a box is drawn; right-drag panning and wheel zoom keep working. Esc SHALL turn Box select off, and it SHALL NOT be saved with the build.

#### Scenario: Box around parts
- **WHEN** Box select is on and the user drags left to right around two beams
- **THEN** the two beams, and nothing only partly inside the box, are selected

#### Scenario: Touching box
- **WHEN** the user drags right to left across the edge of a plate
- **THEN** the plate is selected

### Requirement: Selection count
While at least one part is selected, the 3D view SHALL show how many parts are selected (for example "3 parts selected") with a Clear button that unselects everything. With nothing selected it SHALL not be shown.

#### Scenario: Count shown
- **WHEN** the user selects three parts
- **THEN** the 3D view shows "3 parts selected"

### Requirement: Select menu and Select mode
The toolbar SHALL have a Select menu with: Select mode (on/off), Select Connected, Select All, Select None, Invert Selection, Group and Ungroup. While Select mode is on, a plain click on a part in the 3D view SHALL add or remove it, as Shift+click does, and a click on empty space SHALL leave the selection as it is; the toolbar SHALL show that Select mode is on. Dragging the Move arrows or rotate rings, right-click and double-click SHALL keep their usual behavior. Select mode SHALL turn off with Esc or from the menu, and SHALL NOT be saved with the build. `Ctrl/Cmd+A` SHALL select every visible part, and Esc with Select mode off SHALL clear the selection, both only when focus is not in a text field.

#### Scenario: Select mode clicks
- **WHEN** the user turns Select mode on and clicks three parts in turn
- **THEN** all three are selected

#### Scenario: Esc leaves Select mode
- **WHEN** Select mode is on and the user presses Esc
- **THEN** Select mode turns off and the selection stays

#### Scenario: Invert
- **WHEN** 2 of 10 visible parts are selected and the user picks Invert Selection
- **THEN** the other 8 are selected

### Requirement: Select Connected
Select Connected, from the Select menu or the `C` key, SHALL select every visible part joined to any selected part, directly or through other parts, by seated pins, pegs and shafts, using the same joint rules as the assembly audit's connectivity check. The fasteners (pins, standoffs, shafts) seated in those parts SHALL be selected too. Parts that only touch or overlap, with nothing seated between them, SHALL NOT count as joined. A Smart Motor driving a shaft, a battery seated in the brain's bay, and gears or wheels on a shaft SHALL count as joined, as they do in the audit. With nothing selected, Select Connected SHALL do nothing and say "Select a part first". When the joints can't be worked out (for example the MCP bridge is not running), the selection SHALL stay as it was and a message SHALL say so. A short message SHALL say how many parts were selected.

#### Scenario: Select a drive side
- **WHEN** one side plate of a drivetrain is selected and the user presses `C`
- **THEN** the plate, its motor, shafts, wheels, spacers, collars and every pin and beam pinned to it are selected, and parts only touching it are not

#### Scenario: Loose part
- **WHEN** a beam with nothing pinned to it is selected and the user picks Select Connected
- **THEN** only that beam stays selected and the message says 1 part is selected

### Requirement: Acting on several parts
With more than one part selected, Delete SHALL delete every selected part as one history step, and Clone SHALL copy every selected part, keeping their places relative to one another, as one history step, with the copies selected. Hide and lock from the Select menu or keyboard SHALL apply to every selected part as one step. The Inspector SHALL hide the per-part fields that don't apply to several parts (label, color, mating, gear train, fastening), and SHALL show the position and turn controls for the set (see part-groups). Hole picking, the mate arrows, double-click mating and copy-insert SHALL NOT start while more than one part is selected.

#### Scenario: Delete several
- **WHEN** four parts are selected and the user presses Delete
- **THEN** all four are removed and one undo brings all four back

#### Scenario: Clone several
- **WHEN** a beam and its two pins are selected and the user clicks Clone
- **THEN** a copy of the beam and pins appears offset by one pitch, the copies are selected, and the pins still sit in the copied beam's holes

### Requirement: Move and turn several parts without grouping
When more than one part is selected and they are not one group, the Move arrows, the rotate rings, the Inspector's set position and nudge buttons, and the quick 90° turns SHALL move or turn every selected part together, keeping their places relative to one another, exactly as for a group (see part-groups: "A group moves and turns as one"), with no need to group them first. Each drag, typed value or nudge run SHALL be one history step labeled with the part count (for example "Move 5 parts", "Turn 5 parts"). The parts SHALL stay ungrouped afterwards.

#### Scenario: Drag a loose selection
- **WHEN** a beam and two pins are selected with Shift+click, not grouped, and the user drags the X arrow 12.7 mm
- **THEN** all three move 12.7 mm along X in one step, the pins stay in the beam's holes, and no group is made

#### Scenario: Turn a loose selection
- **WHEN** three loose parts are selected and the user clicks the quick 90° turn about Z
- **THEN** all three turn together about the centre of their combined bounding box

### Requirement: Expand and contract the selection by joints
With at least one part selected and the pointer over the 3D view, holding Shift and turning the mouse wheel away from the user SHALL expand the selection one layer per wheel notch: every part directly joined to a selected part, by the same joints Select Connected uses, SHALL be added. A pin, peg or shaft SHALL count as its own layer step, so from a beam the first layer adds the pins seated in it and the next adds the parts those pins go into. A part in a group SHALL bring in its whole group, and the group counts as one step. Turning the wheel toward the user SHALL contract the selection by taking off the last layer added, down to the parts selected when expanding began; it SHALL NOT take off those parts. When a layer adds nothing new, a further expand SHALL do nothing. A short message SHALL show the layer and part count (for example "Layer 2 · 17 parts").

The parts selected when expanding began and the layers added SHALL be remembered until the selection is changed some other way (a click, the Outliner, a menu item, a key, or MCP); after that, Shift+wheel starts again from the new selection. Shift+wheel SHALL NOT zoom the camera. It SHALL NOT act while hole picking, while the copy-insert preview is shown, or while a rotate ring is selected, where the wheel keeps its current use, and it SHALL do nothing with nothing selected. Expanding and contracting SHALL NOT create history steps. When the joints can't be worked out, the selection SHALL stay as it was and a message SHALL say so.

#### Scenario: Expand two layers
- **WHEN** a 2x8 beam with four pins in it is selected and the user scrolls away twice with Shift held
- **THEN** after the first notch the beam and its four pins are selected, and after the second the plates those pins go into are selected too

#### Scenario: Contract
- **WHEN** the selection has been expanded two layers and the user scrolls toward themselves once with Shift held
- **THEN** the second layer is taken off and the beam and its pins stay selected

#### Scenario: Can't contract past the start
- **WHEN** the selection is back at the parts selected when expanding began and the user scrolls toward themselves with Shift held
- **THEN** nothing changes

#### Scenario: Click starts again
- **WHEN** the user has expanded from a beam, then clicks a motor and scrolls away with Shift held
- **THEN** the selection grows from the motor, not from the beam
