## ADDED Requirements

### Requirement: A rack clipped onto a beam is joined to it
A Continuous Linear Motion Rack Gear (228-2500-1473) SHALL count as joined to a beam when it lies in its clip seat on that beam: its length along the beam's length, its seat faces against the beam's faces within 0.5 mm, and at least one pitch (12.7 mm) of the rack over the beam. No pin is needed.

A rack joined this way SHALL be treated as fixed to the beam everywhere joints are used: the audit SHALL NOT list it as unsecured or as an island, and moving, grouping and Play mode SHALL treat it as held by the beam. Two racks end to end on one beam SHALL each be joined to the beam.

A rack that is near a beam but not in its seat (turned, offset by more than 0.5 mm, or teeth toward the beam) SHALL NOT be joined, and the audit SHALL list it as unsecured as it does today.

#### Scenario: Huey's racks
- **WHEN** the Huey starter is audited
- **THEN** its four 1x6 Continuous Linear Motion Rack Gears are each joined to the 1x18 Beam they sit on, and none is listed as unsecured

#### Scenario: Rack lying loose beside a beam
- **WHEN** a continuous rack is moved 3 mm off the beam it was clipped to
- **THEN** it is no longer joined to the beam and the audit lists it as unsecured

### Requirement: A beam in a linear motion bracket is held and slides
A beam SHALL count as held by a 2x Pitch Linear Motion Bracket (Side Mount) (228-2500-1469) or a 1x Pitch Linear Motion Bracket (Snap) (228-2500-1470) when it lies in the bracket's channel: the beam's length along the channel, the beam's cross-section inside the channel within 0.5 mm, and the bracket somewhere along the beam's length. A rack clipped onto that beam SHALL NOT stop it counting.

The joint SHALL be a slide: the beam and everything fixed to it may move along the channel and in no other way, relative to the bracket and everything fixed to the bracket. Several brackets along one beam, or on two parallel beams of one sliding assembly, SHALL make one slide, not a locked joint. Brackets whose channels are not parallel on the same two assemblies SHALL lock them, and the audit SHALL say so.

For the audit, a part held only by slides SHALL count as held (not unsecured, not an island) and the audit SHALL list each slide: the two groups of parts it joins, its direction, and how far it can travel each way before parts meet.

#### Scenario: Huey's middle stage
- **WHEN** the Huey starter is audited
- **THEN** the Elevator Middle Stage is held on the Elevator Holder by one slide along the lift's direction through its six brackets, and is not listed as a separate island

#### Scenario: Travel
- **WHEN** the audit lists Huey's lift slide
- **THEN** it gives the travel up and down from where the stage sits, each within 3 mm of where a part of the stage first meets a part of the holder

#### Scenario: Beam beside a bracket
- **WHEN** a beam lies next to a bracket but outside its channel
- **THEN** no slide is made and the audit reports the parts as it does today

### Requirement: Linear motion sizes come from the parts' models
The clip seat of the continuous rack and the channel of each linear motion bracket (its direction, cross-section and length, in the part's own frame) SHALL be measured from the parts' models when part metadata is built, and stored with the part, as rack teeth and spool sizes are. A part whose seat or channel can't be measured SHALL be reported when metadata is built and SHALL make no joints.

#### Scenario: Metadata built
- **WHEN** part metadata is built
- **THEN** the two brackets and the continuous rack each carry their measured channel or seat, and `get_part_details` shows it
