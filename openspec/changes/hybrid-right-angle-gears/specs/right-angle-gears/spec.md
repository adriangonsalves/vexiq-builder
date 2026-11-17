## MODIFIED Requirements

### Requirement: Measured tooth data for 90° gears
The part metadata SHALL record tooth data measured from each model, not guessed from its name.

For every bevel gear:
- the tooth count;
- the point on its axis where its teeth, carried on inward, would meet (its cone point);
- the angle of its tooth cone;
- the tooth phase: the angle about its axis of one tooth's center.

For the crown gear:
- the tooth count and tooth size;
- which face carries the teeth, the height of the tooth pitch plane along the axis, and the inner and outer radius of the tooth ring;
- the tooth phase.

For every hybrid gear (the 12, 24, 36, 48 and 60 Tooth Hybrid Gears and the 8, 16 and 24 Tooth High Strength Hybrid Gears), besides its spur gear data:
- which face its teeth carry on past (the face that meshes at 90°);
- how far past that face the teeth reach, and the stretch along its axis, past the plain face, where its teeth are whole enough to mesh at 90°, measured at its pitch radius.

For the worm gear:
- the distance from one thread to the next along its axis, and how far the thread advances in one turn;
- which way the thread winds;
- its pitch radius;
- the stretch of its length that carries thread;
- the thread phase: where along the axis the thread crest sits at the reference angle.

The measurement SHALL be repeatable: re-running the indexer on the same models gives the same values within 0.1° and 0.01 mm. A gear whose teeth could not be measured SHALL be marked unmeasured, the indexer SHALL name it, and it SHALL NOT be turned or moved to mesh.

#### Scenario: The four gears are measured
- **WHEN** the indexer runs
- **THEN** the 12 Tooth High Strength Bevel Gear, 18 Tooth Bevel Gear, 36 Tooth Crown Gear and Worm Gear records are marked measured and carry the values above

#### Scenario: Hybrid gears are measured
- **WHEN** the indexer runs
- **THEN** each of the eight hybrid gears records its extended face (+z on all of them) and its 90° tooth stretch, and a plain 24 Tooth Gear records none

#### Scenario: Re-running gives the same values
- **WHEN** the indexer runs twice on the same models
- **THEN** every recorded angle agrees within 0.1° and every length within 0.01 mm

#### Scenario: Differential housings are left alone
- **WHEN** the indexer runs
- **THEN** the Differential Gear and Differential Gear (High Strength) are not marked as meshing gears

### Requirement: Which gears mesh at 90°
Two parts SHALL be in mesh range at 90° only as one of these pairs, with their axes at 90° to each other within 2° and every distance below within 1.0 mm:

- **Bevel with bevel:** both have the same tooth count (two cones at 90° that meet along one line turn 1:1, so only equal tooth counts fit), their axes cross, and both cone points sit at the crossing point.
- **Crown with spur:** the spur gear has the crown gear's tooth size; the spur gear's axis crosses the crown gear's axis; the spur gear's teeth lie over the crown gear's tooth ring; and the spur gear's axis is its pitch radius above the crown gear's tooth pitch plane, on the toothed side.
- **Worm with spur:** the spur gear's tooth spacing equals the worm's thread spacing; the worm's axis lies in the middle plane of the spur gear's teeth; the two axes pass each other at a distance of the worm's pitch radius plus the spur gear's pitch radius; and the worm's thread reaches the spur gear's teeth: the threaded stretch overlaps the stretch of the worm's axis where the spur's tip circle comes within the worm's tip radius (about 8.7 mm either side of the closest point for a 36 Tooth Gear).

- **Hybrid with hybrid:** both are hybrid gears of the same tooth size (both standard or both high strength), of any tooth counts; their axes cross; each gear's extended face points toward the crossing point; and each gear's pitch circle passes through the other's 90° tooth stretch: the distance from a gear's center to the crossing point, less its partner's pitch radius, lies within that gear's 90° tooth stretch.

No other pairing SHALL mesh at 90° (a bevel gear with a spur gear, a worm with a bevel gear, two crown gears, a high strength spur gear with the crown or worm, a hybrid gear with a plain spur, crown, bevel or worm gear, a standard hybrid gear with a high strength one, two hybrid gears whose extended faces point away from the crossing, and so on). Hybrid gears side by side SHALL keep meshing as spur gears. Sprockets, ratchets and unmeasured gears never mesh.

In mesh range, the teeth mesh when a tooth of one part sits in a gap of the other where they meet. For a worm, the thread crest sits in a gap of the spur gear at the point where the two are closest.

#### Scenario: Two bevel gears in range
- **WHEN** two 18 Tooth Bevel Gears sit with their axes crossing at 90° and both cone points at the crossing point
- **THEN** they are in mesh range

#### Scenario: Bevel gears with different tooth counts
- **WHEN** a 12 Tooth High Strength Bevel Gear and an 18 Tooth Bevel Gear sit with their axes crossing at 90° and both cone points at the crossing point
- **THEN** they are not in mesh range and neither is turned

#### Scenario: Spur gear on the crown gear
- **WHEN** a 12 Tooth Gear stands on the toothed face of the 36 Tooth Crown Gear, its axis crossing the crown gear's axis at 90° and its teeth over the tooth ring
- **THEN** they are in mesh range

#### Scenario: Worm beside its gear
- **WHEN** a Worm Gear lies in the tooth plane of a 36 Tooth Gear, at 90° to its shaft, with the axes 25.4 mm apart (within 1.0 mm of the two pitch radii)
- **THEN** they are in mesh range

#### Scenario: Worm out of line
- **WHEN** the same Worm Gear is moved 4 mm along the 36 Tooth Gear's shaft, out of its tooth plane
- **THEN** they are not in mesh range

#### Scenario: Swish's intake gears
- **WHEN** a 24 Tooth Hybrid Gear and a 12 Tooth Hybrid Gear sit as on Swish's intake: axes crossing at 90°, both extended faces toward the crossing, the crossing 8.8 mm from the 24 Tooth's center and 16.0 mm from the 12 Tooth's
- **THEN** they are in mesh range

#### Scenario: Hybrid face turned away
- **WHEN** the 12 Tooth Hybrid Gear of that pair is flipped on its shaft so its extended face points away from the crossing
- **THEN** they are not in mesh range

#### Scenario: Hybrid with a plain spur gear at 90°
- **WHEN** a plain 24 Tooth Gear takes the 24 Tooth Hybrid Gear's place in that pair
- **THEN** they are not in mesh range

#### Scenario: Slanted shaft
- **WHEN** a bevel gear's axis is 80° from its partner's
- **THEN** they are not in mesh range

### Requirement: A placed gear turns to mesh at 90°
When a bevel gear, crown gear, worm gear, a spur gear next to a crown or worm gear, or a hybrid gear next to a hybrid gear at 90° ends up in mesh range of a 90° partner, it SHALL turn about its own axis by the smallest turn that makes the teeth mesh. This SHALL happen on the same placements as spur gears (see gear-meshing): dragging (while dragging and on release), double-click mating, hole picking, Ctrl/Cmd copy insert, and the assistant's `place_part` and `place_parts`.

The rest SHALL follow gear-meshing:
- only the part being placed turns; when it is fixed on an axle by a square hole, its whole shaft group turns instead;
- parts on other axles are not turned;
- with several partners in range (90° or parallel), the turn that leaves the largest tooth error smallest is used, and any partner left more than a quarter tooth off is named in a message;
- a turn made by hand in Rotate mode is kept;
- the turn is part of the placement's history step, and its message says what meshed, for example "Meshed Worm Gear #1 with 36 Tooth Gear #1 (turned 40°)";
- holding Alt while dragging, or Free move on the context bar, turns it off.

After the turn, the pair SHALL NOT be reported as overlapping.

#### Scenario: Bevel gear slid onto a shaft
- **WHEN** an 18 Tooth Bevel Gear is mated onto a shaft at 90° to the shaft of another 18 Tooth Bevel Gear and stops with its cone point on the other's
- **THEN** it turns so its teeth sit in the other's gaps, the message says it meshed, and the collision check finds no contact between the two

#### Scenario: Worm on a square shaft
- **WHEN** a Worm Gear already on a square shaft with a wheel is dragged into mesh range of a 24 Tooth Gear
- **THEN** on release the worm, its shaft and the wheel turn together, and the 24 Tooth Gear does not move

#### Scenario: Spur gear dropped on a crown gear
- **WHEN** a 12 Tooth Gear on a shaft is pushed down until it is in mesh range of a 36 Tooth Crown Gear
- **THEN** the 12 Tooth Gear turns to mesh and the crown gear stays as it was

#### Scenario: Hybrid gear slid onto a shaft
- **WHEN** a 12 Tooth Hybrid Gear is mated onto a shaft at 90° to a 24 Tooth Hybrid Gear's shaft and stops in mesh range, extended face toward it
- **THEN** it turns so its teeth sit in the other's gaps, the message says it meshed, and the collision check finds no contact between the two

#### Scenario: Out of range
- **WHEN** a bevel gear stops 3.5 mm short of the spot where the cone points meet (past the 3 mm that precise-placement slides gears into mesh from)
- **THEN** it is not turned

### Requirement: Mesh spots
For a gear and a partner it can mesh with at 90°, the mesh spots SHALL be the poses of the gear in which the pair is in mesh range and meshes, at each quarter turn round the partner's axis. The quarter turns SHALL be counted from the world axes when the partner's axis runs along a world axis, so that a shaft through the gear lines up with the hole grid, and otherwise from the partner's own reference direction.

- A bevel gear has 4 spots round a bevel partner.
- A spur gear has 4 spots on a crown gear's toothed face; a crown gear has 8 spots round a spur gear (4 directions, on either side of it).
- A worm has 4 spots round a spur gear, lying along the gear's edge; a spur gear has 4 spots round a worm. Along the worm's length, the spot SHALL keep the moved part's position where that already puts the meeting point on the thread, and otherwise put the meeting point at the middle of the thread.

- A hybrid gear has 4 spots round a hybrid partner, its extended face toward the partner's axis, at the distances that put each gear's pitch circle in the middle of the other's 90° tooth stretch.

A spot where the gear would overlap another part SHALL NOT be offered.

#### Scenario: Four spots round a bevel gear
- **WHEN** an 18 Tooth Bevel Gear stands with its axis along world Y and nothing near it
- **THEN** a second 18 Tooth Bevel Gear has four mesh spots, with its axis along +X, -X, +Z and -Z

#### Scenario: Four spots round a hybrid gear
- **WHEN** a 24 Tooth Hybrid Gear stands with its axis along world Y and nothing near it
- **THEN** a 12 Tooth Hybrid Gear has four mesh spots, with its axis along +X, -X, +Z and -Z, each on the 24 Tooth's extended side with its own extended face toward the 24 Tooth's axis

#### Scenario: Blocked spot
- **WHEN** a beam fills the space of one of those four spots
- **THEN** only the other three are offered

### Requirement: A loose gear jumps into mesh
While a single bevel, crown, worm, hybrid or spur gear is dragged and its center comes within 6.35 mm (half a pitch) of one of its mesh spots on another gear, the system SHALL show a see-through preview of the gear at the nearest such spot, and on release the gear SHALL move to that spot, turned and meshed. This SHALL work when nothing holds the gear: no shaft, pin or beam is needed, and they can be added afterwards.

- A hole snap SHALL win: when the drag is pulling the gear's bore or holes onto a line (see drag-hole-snap), no mesh spot preview is shown and the gear is not moved to a spot.
- Holding Alt, or Free move, SHALL turn the jump off.
- Dragging the gear back out of range before release SHALL remove the preview and leave the gear where it is dropped.
- A locked gear, a gear in a group being moved as a set, and Explode view SHALL NOT jump.
- The jump SHALL be one history step with a message naming both gears, for example "Meshed 18 Tooth Bevel Gear #2 with 18 Tooth Bevel Gear #1", and one undo SHALL put the gear back where the drag began.

A spur gear SHALL only jump to spots on a crown gear or a worm, and a hybrid gear to spots on those or on another hybrid gear. Two spur gears side by side (hybrid gears included) SHALL keep working as in gear-meshing, with no jump.

#### Scenario: Loose bevel gear dragged near another
- **WHEN** a loose 18 Tooth Bevel Gear, lying flat, is dragged to within 5 mm of a mesh spot on another 18 Tooth Bevel Gear and released
- **THEN** a preview shows at that spot during the drag, and on release the gear stands at the spot, at 90° to the other gear, with no contact between them

#### Scenario: Supports added later
- **WHEN** a shaft is then inserted through the jumped gear's square bore, and a beam is put on the shaft
- **THEN** the shaft turns to fit the bore, the gear stays meshed, and the audit lists the gear as on that shaft

#### Scenario: Loose worm
- **WHEN** a loose Worm Gear is dragged near the edge of a 36 Tooth Gear and released
- **THEN** it lies along the gear's edge in the gear's tooth plane, at 90° to the gear's shaft, with its thread in the gear's teeth

#### Scenario: Hole snap wins
- **WHEN** a bevel gear is dragged so its bore is pulled onto a beam hole's line while also within 5 mm of a mesh spot
- **THEN** it follows the hole, no spot preview is shown, and on release it only turns to mesh if it is in mesh range there

#### Scenario: Loose hybrid gear dragged near another
- **WHEN** a loose 12 Tooth Hybrid Gear is dragged to within 5 mm of a mesh spot on a 24 Tooth Hybrid Gear and released
- **THEN** it stands at the spot at 90° to the other gear, both extended faces toward the crossing, with no contact between them

#### Scenario: Two spur gears
- **WHEN** a loose 24 Tooth Gear is dragged near a 48 Tooth Gear, away from any hole
- **THEN** no preview is shown and it is not moved
