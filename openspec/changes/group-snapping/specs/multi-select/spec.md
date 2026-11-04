## MODIFIED Requirements

### Requirement: Acting on several parts
With more than one part selected, Delete SHALL delete every selected part as one history step, and Clone SHALL copy every selected part, keeping their places relative to one another, as one history step, with the copies selected. Hide and lock from the Select menu or keyboard SHALL apply to every selected part as one step. The Inspector SHALL hide the per-part fields that don't apply to several parts (label, color, mating, gear train, fastening), and SHALL show the position and turn controls for the set (see part-groups). Double-clicking a selected part of the set SHALL mate the whole set: with the mate arrows, or with hole picking limited to the pins that face the hole (see group-snapping: "Double-clicking a set mates it" and "Hole picking for a set"). Copy-insert (Ctrl/Cmd + double-click) SHALL NOT start while more than one part is selected.

#### Scenario: Delete several
- **WHEN** four parts are selected and the user presses Delete
- **THEN** all four are removed and one undo brings all four back

#### Scenario: Clone several
- **WHEN** a beam and its two pins are selected and the user clicks Clone
- **THEN** a copy of the beam and pins appears offset by one pitch, the copies are selected, and the pins still sit in the copied beam's holes

#### Scenario: Copy-insert stays single-part
- **WHEN** a group is selected and the user Ctrl+double-clicks a hole
- **THEN** nothing is inserted and the message says copies are inserted one part at a time
