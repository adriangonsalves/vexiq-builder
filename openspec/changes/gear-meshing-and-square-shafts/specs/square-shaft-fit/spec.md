## Purpose

Makes square axles and square holes fit at the right angle: their flat angles are measured from the models, axles turn to fit, an axle and the parts fixed on it turn together as a shaft group, and the Smart Motor's drive hub turns to take an axle at any angle, ready for a later motion simulation.

## ADDED Requirements

### Requirement: Measured square orientations
The part metadata SHALL record, measured from each model:
- for every shaft bore and shaft socket: whether it is square or round, and for square ones the angle of its flats about its axis (0–90°), from the part's reference direction for that axis;
- for every square axle (straight, capped and motor shafts): the angle of its flats about its axis, the same way;
- for the Smart Motor: the radius and depth of the hub around its drive socket, the piece that turns.

Re-running the indexer SHALL give the same values within 0.1°. A bore that could not be measured SHALL count as round: any axle angle fits it.

#### Scenario: Gear bore and axle measured
- **WHEN** the indexer runs
- **THEN** the 24 Tooth Gear's center bore is marked square with a flat angle, and a 4x Pitch Shaft has a flat angle

#### Scenario: Idler gear is round
- **WHEN** the indexer runs
- **THEN** the 36 Tooth Idler Gear's bore is marked round

### Requirement: Axles turn to fit square holes
When a square axle goes into, or through, a square bore or socket, it SHALL turn about its own axis by the smallest amount that lines its flats up with the hole's, a multiple of 90° apart. This SHALL happen for:
- dragging, with hole snapping, and on release;
- double-click mating;
- hole picking;
- Ctrl/Cmd copy insert;
- the assistant's `place_part` and `place_parts` (a given `rollDeg` is rounded to the nearest fitting roll, and the reply says so).

When the axle passes through several square holes whose flats disagree, it SHALL fit the first one it enters, and a message SHALL name the others. A round bore SHALL accept any angle.

The same SHALL hold the other way round. A part with a square bore going onto a placed axle turns about the axle's axis to fit it, unless it is a gear in mesh range, which turns its shaft group instead.

#### Scenario: Axle into a turned gear
- **WHEN** a 4x Pitch Shaft is mated into the square bore of a gear turned 22.5°
- **THEN** the shaft turns to match the bore's flats and slides in without overlapping

#### Scenario: Wheel onto an axle
- **WHEN** a wheel hub is picked onto a placed axle turned 10°
- **THEN** the wheel turns to fit the axle's flats

### Requirement: Shaft groups
A shaft group SHALL be:
- a square axle;
- every part with a square bore seated on that axle, along the axle within the bore;
- the Smart Motor hub whose socket holds the axle, if any.

Round-bore parts (idler gears, bearings) and pin holes SHALL NOT be in the group. When a shaft group turns, every member SHALL turn by the same angle about the axle's axis, and its position SHALL turn about that axis too. A motor hub in the group SHALL change only its own angle; the motor body stays put. The turn SHALL be one history step together with the placement that caused it. A part being dragged off its axle SHALL leave the group.

#### Scenario: Gear meshing on a loaded axle
- **WHEN** a 24 Tooth Gear is placed on an axle that already carries a wheel, next to a 48 Tooth Gear on another axle
- **THEN** the axle, the wheel and the new gear all turn by the same angle so the gears mesh, and the 48 Tooth Gear's axle does not move

#### Scenario: Undo
- **WHEN** the user undoes that placement
- **THEN** the gear is gone and the axle and wheel are back at their old angle

### Requirement: Smart Motor drive hub turns
The Smart Motor's drive hub SHALL be drawn as its own piece, around the square socket, and SHALL turn about the socket axis to its saved angle. A square axle going into the socket SHALL keep its own angle, and the hub SHALL turn to match it. This includes axles already holding gears that are meshed.

The hub angle:
- SHALL be stored on the motor instance as `socketAngleDeg` (0 when missing, so older saves load unchanged);
- SHALL be saved with the build and shown by the assistant's `get_assembly`;
- SHALL be part of the history;
- SHALL turn with its shaft group.

The motor's collision shape SHALL turn the hub's part with it, so a turned axle in a turned hub never counts as overlapping.

#### Scenario: Axle at an odd angle into the motor
- **WHEN** an axle turned 30° is mated into a Smart Motor's socket
- **THEN** the axle keeps its angle, the hub turns 30° to match, nothing overlaps, and the motor's saved `socketAngleDeg` is 30

#### Scenario: Reload keeps the hub angle
- **WHEN** the build is saved and reloaded
- **THEN** the motor hub is drawn at the same angle
