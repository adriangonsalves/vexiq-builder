# fix-assembly Specification

## Purpose

Lines up two blocks of parts that are nearly but not quite mated, on the user's word, from the Tools menu.

## Requirements

### Requirement: Tools menu
The toolbar SHALL have a **Tools** menu with a **Fix assembly** item, and below it the **Chain builder** and **Track builder…** items that were the Build menu (same availability and hover text as before); the separate Build button SHALL go. The item SHALL be greyed out, with the reason as its hover text, when no part is selected, while a past point of the history is shown, or while another action runs. With several parts selected, it SHALL work from the first selected part.

#### Scenario: Nothing selected
- **WHEN** no part is selected and the user opens Tools
- **THEN** Fix assembly is greyed out and says to select a part first

### Requirement: Finding what to fix
Fix assembly SHALL treat each set of parts joined to one another (the joins Select Connected follows), together with the other members of any group they are in, as a block. It SHALL look near the selected part (its box grown by 20 mm) for pairs between its block and another block: a pin, peg or shaft and a hole it fits, or two holes a shaft fits, whose axes are within 20°, whose lines are within 4.5 mm of each other, and which are within 4 mm of each other along the line or overlap. The block with the most such pairs is the partner. When no other block has any, it SHALL look inside the selected part's own block: the selected part and the parts hanging only off it, against the rest of the block. Pairs that are already lined up SHALL be used to keep their parts lined up; inside one block they also let a part that only sits short of, or pressed into, its holes be seated. When nothing is found, nothing SHALL move and a message SHALL say no nearly-lined-up pins or holes were found near the part.

#### Scenario: Male or female part selected
- **WHEN** a plate with four pins sits 1.2 mm off and 3° tilted from the holes of a beam, and the user selects either the beam or one of the plate's pins and chooses Fix assembly
- **THEN** the same four pairs are found and lined up

#### Scenario: Nothing near
- **WHEN** the selected part has no pins or holes near another block's
- **THEN** nothing moves and the message says nothing was found to line up

### Requirement: Lining up and seating
Fix assembly SHALL move the block with fewer parts (the selected part's block on a tie; never a block with a locked part) as one rigid piece, turning and moving it so that every found pair shares one line, at any angle. Pairs that can't be brought within 0.2 mm of their line together with the others SHALL be left out, worst first. A fit that ends within 1.5° of square with the part it goes onto SHALL be made square when every pair still lines up. A fix that would turn the block more than 25° or move it more than 10 mm SHALL NOT be made. When all the pairs' lines are parallel, the block SHALL then slide along them: out to the nearest spot within 4 mm where it overlaps nothing, if it overlaps; otherwise in until it touches the other block, no further than its pins or shafts reach the far side of their holes, or its holes meet the other holes' faces. It SHALL settle where the parts it touches sit a whole number of quarter pitches apart when that spot is clear and within 0.95 mm, and a block already touching SHALL NOT be pushed further. When nothing would move, a message SHALL say the part is already lined up and seated.
The fix SHALL be one history step, "Fix assembly: <moved part or group> onto <other part>", saved with the moved parts' overlap flags, and a message SHALL say how many pins and holes were lined up and how many parts moved.

#### Scenario: Pressed in
- **WHEN** a beam on a plate's pins is 0.4 mm too deep and 0.7 mm off sideways
- **THEN** the beam's holes end on the pins' lines, the beam overlaps nothing, and it touches the plate

#### Scenario: The smaller block moves
- **WHEN** a 3-part arm is nearly on a 40-part chassis and the user selects a chassis part
- **THEN** the arm moves and the chassis stays where it was

#### Scenario: Undo
- **WHEN** the user presses Undo after Fix assembly
- **THEN** every moved part is back where it was
