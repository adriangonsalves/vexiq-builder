# gear-meshing Specification

## Purpose
Makes spur gears and racks mesh when they are placed: each part's real tooth positions are measured from its model, and a gear being placed turns about its own axis so its teeth fall into its neighbours' gaps and its bore can reach the hole it belongs in.

## Requirements

### Requirement: Measured tooth data
The part metadata SHALL record tooth data measured from each model, not guessed from its name.

For every spur gear:
- the tooth count;
- the tip radius;
- the pitch radius, derived from the measured size and tooth count, so the 34DP gears get their true size;
- the tooth spacing along the pitch circle;
- the tooth phase: the angle about the bore axis, from the part's reference direction for that axis, of one tooth's center.

For every linear motion rack:
- its tooth direction;
- the position of one tooth's center along it;
- the tooth spacing;
- the offset of its pitch line.

The measurement SHALL be repeatable: re-running the indexer on the same models gives the same values within 0.1° and 0.01 mm. A gear whose teeth could not be measured SHALL be marked unmeasured, and it SHALL NOT be turned to mesh.

#### Scenario: 24 and 48 tooth gears measured
- **WHEN** the indexer runs
- **THEN** the 24 Tooth Gear and 48 Tooth Gear records have a tooth phase, a pitch radius of 12.7 mm and 25.4 mm, and the same tooth spacing

#### Scenario: 34DP gear sized from its model
- **WHEN** the indexer runs
- **THEN** the 36 Tooth Gear (34DP) has a pitch radius matching its measured size, not the standard gears' 19.05 mm

### Requirement: Meshing rule
Two spur gears SHALL be in mesh range when:
- their axes are parallel within 2°;
- their gear planes overlap along the axis;
- the distance between their axes is within 1.0 mm of the sum of their pitch radii.

A spur gear and a rack SHALL be in mesh range when:
- the gear's axis is parallel to the rack's teeth, within 2°;
- the gear's planes overlap the rack's along that axis;
- the gear's axis is its pitch radius away from the rack's pitch line, within 1.0 mm.

In mesh range, the teeth mesh when, at the point where the two pitch lines touch, a tooth of one part faces a gap of the other. The meshing turn SHALL be the turn of the gear about its own axis, the smallest of the possible turns, that achieves this.

#### Scenario: Gears in mesh
- **WHEN** a 24 Tooth Gear is turned to mesh with a 48 Tooth Gear whose axis is 38.1 mm away
- **THEN** no teeth overlap: the collision check finds no contact between the two gears

#### Scenario: Gear on a rack
- **WHEN** a 12 Tooth Gear is placed with its axis one pitch radius above a linear motion rack's pitch line
- **THEN** it turns so a tooth sits in a rack gap, with no contact

#### Scenario: Out of range
- **WHEN** a gear is placed 3 mm further away than the sum of the pitch radii
- **THEN** it is not turned

### Requirement: Gears turn to mesh when placed
When a spur gear ends up in mesh range of other gears or racks, it SHALL turn by its meshing turn. This SHALL happen when it is placed by:
- **dragging:** continuously while dragging, so tooth clashes don't hold it short of a hole it is pulled onto, and on release;
- double-click mating;
- hole picking;
- Ctrl/Cmd copy insert;
- the assistant's `place_part`, `place_parts` and `mesh_gear_train`.

When the gear is fixed on an axle by a square hole, its whole shaft group SHALL turn instead (see square-shaft-fit).

With several neighbours in mesh range, the turn SHALL be the one that leaves the largest tooth-to-gap error smallest. Any neighbour still more than a quarter tooth off SHALL be named in a message, for example "Couldn't mesh with 36 Tooth Gear #2 as well". Parts on other axles SHALL NOT be turned.

Turning a gear by hand in Rotate mode SHALL NOT be undone by meshing. Meshing only happens on the placements above.

A turn made on a placement SHALL be part of that placement's history step. It SHALL say so in the step's message, for example "Meshed 24 Tooth Gear #1 with 48 Tooth Gear #1 (turned 7.5°)".

#### Scenario: The misplaced 24 tooth gear
- **WHEN** the user drags "24 Tooth Gear #1" so its bore is pulled onto the backplate hole 38.1 mm from "48 Tooth Gear #1"'s axis
- **THEN** it turns to mesh while dragging, reaches the hole (at y 12.7), and nothing overlaps on release

#### Scenario: Mating meshes
- **WHEN** a gear lined up above a shaft beside another gear is double-clicked
- **THEN** it slides on and turns to mesh

#### Scenario: Two neighbours that can't both mesh
- **WHEN** a gear is placed between two gears whose phases leave no turn that suits both
- **THEN** it meshes with the closer one and the message names the other

#### Scenario: Hand turn kept
- **WHEN** the user turns a meshed gear by 5° with the Rotate rings
- **THEN** it stays at the turned angle

### Requirement: MCP uses measured meshing
`mesh_gear_train` SHALL place each gear at its measured meshing turn instead of trying candidate rolls. `place_part` and `place_parts` SHALL mesh placed spur gears as above. When a `rollDeg` is given for a gear in mesh range, it SHALL be replaced by the nearest meshing turn, and the reply SHALL say so. Replies SHALL list each gear meshed and each neighbour it couldn't mesh with.

#### Scenario: Gear train meshed
- **WHEN** `mesh_gear_train` places a 12, 36 and 60 tooth gear along a beam
- **THEN** each gear meshes with the previous one and the audit finds no overlaps between them

#### Scenario: Roll replaced
- **WHEN** `place_parts` inserts a 24 Tooth Gear with `rollDeg: 3` into a hole in mesh range of a 48 Tooth Gear
- **THEN** the gear is placed at its meshing turn and the reply notes the roll was changed to mesh
