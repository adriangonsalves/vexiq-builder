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
Fix assembly SHALL treat each set of parts joined to one another by pins, pegs and shafts seated in holes, together with the other members of any group they are in, as a block. Gears that only mesh and parts that only touch SHALL NOT join blocks. It SHALL look near the selected part (its box grown by 20 mm) for pairs between its block and another block: a pin, peg or shaft and a hole it fits, or two holes a shaft fits, whose axes are within 20°, whose lines are within 4.5 mm of each other, and which are within 4 mm of each other along the line or overlap. The block with the most such pairs is the partner. When no other block has any, it SHALL look inside the selected part's own block: the selected part and the parts hanging only off it, against the rest of the block. Pairs that are already lined up SHALL be used to keep their parts lined up; inside one block they also let a part that only sits short of, or pressed into, its holes be seated. When nothing is found, nothing SHALL move and a message SHALL say no nearly-lined-up pins or holes were found near the part.

#### Scenario: Male or female part selected
- **WHEN** a plate with four pins sits 1.2 mm off and 3° tilted from the holes of a beam, and the user selects either the beam or one of the plate's pins and chooses Fix assembly
- **THEN** the same four pairs are found and lined up

#### Scenario: Nothing near
- **WHEN** the selected part has no pins or holes near another block's
- **THEN** nothing moves and the message says nothing was found to line up

#### Scenario: A part resting against another is its own block
- **WHEN** a claw only touches the crank arm it should be pinned to, and the user chooses Fix assembly on the arm
- **THEN** the claw is a block of its own, the smaller one, and it moves onto the arm

### Requirement: Lining up and seating
Fix assembly SHALL move the block with fewer parts (the selected part's block on a tie; never a block with a locked part) as one rigid piece, turning and moving it so that every found pair shares one line, at any angle. Pairs that can't be brought within 0.2 mm of their line together with the others SHALL be left out, worst first. A fit that ends within 1.5° of square with the part it goes onto SHALL be made square when every pair still lines up. A fix that would turn the block more than 25° or move it more than 10 mm SHALL NOT be made. When all the pairs' lines are parallel, the block SHALL then slide along them: out to the nearest spot within 4 mm where it overlaps nothing, if it overlaps; otherwise in until it touches the other block, no further than its pins or shafts reach the far side of their holes, or its holes meet the other holes' faces. It SHALL settle where the parts it touches sit a whole number of quarter pitches apart when that spot is clear and within 0.95 mm, and a block already touching SHALL NOT be pushed further. When nothing would move, a message SHALL say the part is already lined up and seated.

A meshed gear SHALL NOT move: a gear meshed with a gear or rack that stays where it is (as Play mode links them, by the gear-meshing and right-angle-gears rules) keeps its pose. When the block that would move holds such a gear, it SHALL NOT be moved as one piece. Instead these SHALL be tried, none holding a locked part, a meshed gear or only part of a group: the parts of the other block held rigidly with each part the pairs line up with (as when a fix would overlap), moved as one piece; and, in either block, the parts joined to the rest only through a shaft running through a round hole, which SHALL only slide along that shaft and turn about it, the shaft staying where it is. A piece SHALL NOT be used when its move would change, by more than 0.1 mm, how deep any pin or peg joining it to the rest of its block is seated (a shaft through a round hole may slide). The one that leaves the fewest new overlaps SHALL move, then the one that turns least, then the one with fewest parts, and the message SHALL say why the first block didn't move ("moving <block> would have taken <gear> out of mesh with <gear>"). When none lines the pairs up, nothing SHALL move and a message SHALL name the part that is out of line, the part it should meet, how far off it is (mm and degrees), and the gear that keeps it there.

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

#### Scenario: Slide a beam along a gear's shaft
- **WHEN** a 2x9 Beam rides on the shaft of a 36 Tooth Gear meshed with a worm on a Smart Motor's shaft, a 1x1 corner connector hangs on the beam by one peg, its pin is 0.6 mm off a motor hole along that shaft's direction, and the user chooses Fix assembly on the pin
- **THEN** the beam, connector and pin slide together along the gear's shaft until the pin lines up with the motor hole; the connector stays seated on the beam as deep as it was; both shafts, the gear and the worm stay where they are, and the message says moving the motor would have taken the worm out of mesh with the 36 Tooth Gear

#### Scenario: A seated peg isn't pressed in to line up
- **WHEN** the only piece that could line the pins up rigidly is a connector that would have to move along the peg it sits on in a beam
- **THEN** that piece isn't used

#### Scenario: Nothing can move without breaking a mesh
- **WHEN** a pin is 0.6 mm off a motor hole, the motor is locked, and the beam carrying the pin is grouped with the shaft of a gear meshed with the motor's worm
- **THEN** nothing moves and the message names the pin and the motor, says how far out of line it is, and names the gears in the way

### Requirement: Lining up after a pin goes in
After a pin, peg or shaft is put into a hole (double-click mate, Join, hole picking, the marked target, or a copy), the system SHALL look for another hole on a different block that the same part's pins, pegs or shafts nearly reach: lines within 1 mm, axes within 3°, and within 4 mm along the line or overlapping. When it finds one, it SHALL line the parts up by the rules of "Lining up and seating", using the pin just inserted and the holes it went into as pairs that must stay lined up, and SHALL save the result in the same history step as the insert, so one undo takes back both. The message SHALL say what moved (for example "Inserted 0x2 Connector Pin #4 into 1x Wide, 1x1 Corner Connector #1 and lined up VEX IQ Smart Motor #2"). When nothing may move, the insert SHALL still be kept and the message SHALL add which part is out of line and by how much. Holes further off than that SHALL be left alone. It SHALL NOT leave parts overlapping, and SHALL NOT pull a part off a shaft or pin it is on, however far that joint is from the inserted part: when the only way to line the holes up would, nothing else SHALL move and the message SHALL say so.

#### Scenario: Pin joins the motor too
- **WHEN** a 0x2 Connector Pin is double-clicked into a corner connector hole and a Smart Motor hole on another block is 0.6 mm and 0.9° off the pin's line, with a part free to move
- **THEN** the pin goes into the connector, the free part moves so the pin is also in the motor hole, and it's one history step

#### Scenario: Too far to count
- **WHEN** a pin goes into a hole and the nearest other hole is 2 mm off its line
- **THEN** only the insert happens and nothing else moves

#### Scenario: Can't move
- **WHEN** a pin goes in and the nearly-lined-up hole is on a block that can't move without moving a meshed gear, and the pin's own block can't either
- **THEN** the pin stays in, nothing else moves, and the message says which part is out of line and by how much

### Requirement: A Smart Motor sits square on its shaft
A Smart Motor whose drive socket holds a shaft SHALL sit with the socket's axis on the shaft's line. The motor body SHALL NOT be moved to get there: the shaft, with everything fixed on it by square holes (its shaft group), SHALL be turned and moved onto the socket's line instead, keeping its turn about its own line and how deep it sits in the socket. This SHALL happen when a motor or a shaft is placed so a socket holds a shaft within 3° and 1 mm of its line, and in Fix assembly and "Lining up after a pin goes in" before lining up holes. The shaft SHALL be left as it is, with a message naming why, when a part of its group is locked, when the shaft or a part of its group is held by anything other than the motor and its group (a beam hole, a pin), or when a gear of its group meshes with a gear outside it. The audit SHALL list a motor tilted off its shaft by more than 0.2°, naming the shaft and the angle.

#### Scenario: A free shaft turns into the motor
- **WHEN** a Smart Motor is placed on a 4x Pitch Shaft carrying a 36 Tooth Gear, held by nothing else, and the socket is 0.9° off the shaft
- **THEN** the shaft and the gear turn about the socket onto its line; the motor body doesn't move

#### Scenario: The motor's hub turn is kept
- **WHEN** a Smart Motor on a shaft has its hub turned to fit the shaft's flats
- **THEN** squaring the shaft keeps that hub angle and the shaft's turn about its own line

#### Scenario: A meshed shaft isn't moved
- **WHEN** the shaft in a tilted motor carries a worm meshed with a 36 Tooth Gear
- **THEN** nothing moves, and the message says turning the shaft would take the worm out of mesh

#### Scenario: A shaft held by a beam isn't moved
- **WHEN** the shaft in a tilted motor also runs through a beam hole
- **THEN** nothing moves, and the message names the beam

#### Scenario: Audit shows a tilted motor
- **WHEN** a saved build has a Smart Motor 0.9° off its shaft
- **THEN** the audit lists it as tilted 0.9° off that shaft

### Requirement: A gear train is laid out again
When a shaft is put into a gear, or a gear is put on, the gear train it belongs to (spur gears meshed with one another) SHALL be laid out again from its start before anything else is tried. Fix assembly chosen on a gear or a shaft carrying one SHALL do the same when it finds nothing else to line up. The start is the gear on a Smart Motor's shaft, else a gear whose shaft is held by a beam or plate. Going outward from the start along the meshes, each gear SHALL first move sideways, with its shaft and anything fixed on it, onto the hole of a beam or plate that is within 1.5 mm of its axis and gives the meshing distance from the gear before it (within the 1 mm the meshing rule allows). It SHALL then turn, with its shaft group, to mesh with the gear before it. A gear SHALL only move when its shaft group is made only of gears, shafts, collars and spacers, is not locked, and isn't held by a beam, plate, pin or motor; otherwise it only turns. A gear on a motor's shaft SHALL NOT turn. Beams, plates and motors SHALL NEVER move. The layout SHALL be kept only when it changes something and makes no new overlap; it SHALL be one history step with the insert (or the Fix assembly step), and the message SHALL name each gear moved onto a hole.

#### Scenario: Shaft into a gear just off its hole
- **WHEN** a 36 Tooth Gear meshed with a 24 Tooth Gear lies 0.5 mm off a 2x20 Beam hole, and a shaft is put into the gear
- **THEN** the gear and the shaft move onto the hole and turn to mesh with the 24 Tooth Gear; the shaft is in the beam hole; the beam, the Smart Motor and the motor's gear don't move

#### Scenario: A gear on a held shaft only turns
- **WHEN** the next gear of the train is on a shaft already through a beam hole
- **THEN** it turns to mesh and doesn't move

#### Scenario: Loose on this beam
- **WHEN** a 24 Tooth Gear and a 36 Tooth Gear are laid out on a staggered 2x20 Beam's nearest holes for them (32.39 mm apart, the ideal being 31.75 mm)
- **THEN** they are counted as meshed, 0.64 mm loose
