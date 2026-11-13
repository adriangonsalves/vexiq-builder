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

### Requirement: Gears just out of mesh snap into mesh when placed
When a bevel, crown or worm gear, or a spur gear paired with a crown or worm, is placed (dragged and released, double-click mated, hole picked, put into the marked target, copy inserted, or placed by the assistant) within 3 mm of meshing at 90° with a gear it can mesh with, the system SHALL move the gears into mesh by sliding them along their own axes: the placed gear first, and the partner gear too when the placed gear alone can't close the gap. The slides SHALL be no more than 3 mm each, SHALL leave every shaft where it is, and SHALL then turn the placed gear to mesh as usual. A gear SHALL NOT be slid when it is locked or held by anything other than the shaft through its bore. When slides along the two axes can't bring the gears within meshing reach (the shafts themselves are out of line), nothing SHALL slide and Play mode SHALL keep reporting them as out of mesh. The snap SHALL be part of the placement's history step and its message SHALL say so, for example "Slid 18 Tooth Bevel Gear #2 1.2 mm along its shaft to mesh with 18 Tooth Bevel Gear #1".

#### Scenario: Bevel gears 1.4 mm apart
- **WHEN** an 18 Tooth Bevel Gear on one shaft is dropped so its cone point is 1.2 mm along its own axis and 0.7 mm along the other gear's axis from the other gear's cone point
- **THEN** it slides 1.2 mm along its shaft, the other gear slides 0.7 mm along its own shaft, both shafts stay where they are, and Play mode links them

#### Scenario: Shafts out of line
- **WHEN** a bevel gear is placed near another whose shaft line misses its cone point by 2 mm sideways to both axes
- **THEN** nothing slides and the gears stay out of mesh

#### Scenario: Further than 3 mm
- **WHEN** a bevel gear is placed 4 mm from meshing
- **THEN** nothing slides

### Requirement: Meshed gears shown on the selected gear
While one gear is selected (outside Play and Explode), every gear meshed with it SHALL be outlined and tinted green, and every gear within 3 mm of meshing with it at 90° but out of mesh outlined and tinted amber, so it can be seen whether gears that look close really mesh. The outlines SHALL follow the parts as they move and go when the selection changes. Nothing SHALL be shown for parts other than gears.

#### Scenario: A meshed pair
- **WHEN** a 36 Tooth Gear meshed with a 24 Tooth Gear is selected
- **THEN** the 24 Tooth Gear is outlined in green

#### Scenario: Close but not meshed
- **WHEN** an 18 Tooth Bevel Gear 1.4 mm out of mesh with another is selected
- **THEN** the other bevel gear is outlined in amber
