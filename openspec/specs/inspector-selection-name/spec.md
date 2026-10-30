# inspector-selection-name Specification

## Purpose
Makes the Part Inspector say plainly what it is showing, so the user always knows which part, group or set of parts the fields below will change.

## Requirements

### Requirement: Inspector header names the selection
The Part Inspector header SHALL name what is selected:
- **One part:** its label (for example "2x12 Beam #3"), and under it the catalog part name and part number (for example "2x12 Beam · 228-2500-005"). When the part is inside a group, the group's name SHALL also be shown (for example "in Left Drive").
- **A group:** the group's name and how many parts it holds (for example "Left Drive · 14 parts").
- **Several loose parts:** how many are selected (for example "5 parts selected").
- **Nothing:** the existing hint text, with no name.

The name SHALL update as soon as the selection changes, and a long label SHALL be cut short with an ellipsis and shown in full on hover. The Clone and Delete buttons SHALL stay in the header.

#### Scenario: One part selected
- **WHEN** the user clicks "2x12 Beam #3" in the 3D view
- **THEN** the Inspector header shows "2x12 Beam #3" with its catalog name and part number under it

#### Scenario: Part inside a group
- **WHEN** the user picks "0x2 Connector Pin #4" from inside the "Left Drive" folder in the Outliner
- **THEN** the header shows "0x2 Connector Pin #4" and says it is in "Left Drive"

#### Scenario: Group selected
- **WHEN** the user clicks a part that belongs to the 14-part group "Left Drive"
- **THEN** the header shows "Left Drive · 14 parts"

#### Scenario: Several parts selected
- **WHEN** five loose parts are selected
- **THEN** the header shows "5 parts selected"
