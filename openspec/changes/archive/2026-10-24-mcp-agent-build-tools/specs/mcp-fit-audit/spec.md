## Purpose

Makes the MCP server's assembly audit report what is really fastened: a pin, peg or shaft holds two parts together only when it sits inside a matching hole on each, so an agent can trust a passing audit.

## ADDED Requirements

### Requirement: Fastening means seated in real holes
`audit_assembly` SHALL treat a pin, peg or shaft as joining two parts only when it is seated in a matching opening on each of them. Seated means:
- it pairs with the opening under the same rules the aligned-hole highlighting uses (a pin fits pin holes; a shaft fits pin holes, shaft bores, the motor drive socket and rubber collar holes);
- the axes line up within 2° and 0.25 mm;
- the two overlap along the axis by more than 0.05 mm.

Bounding boxes that merely overlap or touch SHALL NOT count as a joint. The connectivity graph, the per-part fastener counts and the motor-to-wheel power tracing SHALL all use these seated joints. Gear meshing and clamping between two fastened parts SHALL still count as they do today.

#### Scenario: Pins beside the holes
- **WHEN** a plate's pins sit in the plate's holes but stop above a connector's flange without entering its holes
- **THEN** the audit does not count the plate as fastened to the connector

#### Scenario: Pin through two beams
- **WHEN** a Connector Pin is seated in a hole of each of two beams
- **THEN** the audit counts the two beams as joined by that pin

#### Scenario: Shaft drives a wheel
- **WHEN** a shaft is seated in a Smart Motor's drive socket and in a wheel hub's bore
- **THEN** power tracing reports that wheel as driven by that motor

#### Scenario: Shaft beside a bore
- **WHEN** a shaft runs 1 mm to the side of a gear's bore, so their boxes overlap but the axes do not line up
- **THEN** the gear is not counted as on that shaft

### Requirement: Each fastener's joints are listed
The audit SHALL return, for every pin, peg and shaft, which part and which opening it is seated in, and SHALL list every fastener that is seated in fewer than two parts:
- **floating:** seated in no other part;
- **half-seated:** seated on one side only.

A peg that is part of a larger part (such as a corner connector's pegs) SHALL be checked the same way, with the part that carries it counting as one side. `isMechanicallySound` SHALL be false when any fastener is floating or half-seated.

#### Scenario: Half-seated pin
- **WHEN** a Connector Pin is seated in one beam and its other end is in open air
- **THEN** the audit lists it as half-seated, names the beam it is in, and the assembly is not mechanically sound

#### Scenario: Corner connector pegs
- **WHEN** both pegs of a 2x Wide, 2x2 Corner Connector are seated in a beam's holes
- **THEN** the audit lists the connector as joined to that beam by two pegs

### Requirement: Hole depth comes from the 3D model
Wherever the server checks seating or reports a hole, an opening's extent along its axis SHALL be the depth measured on the part's 3D model, from each face to the first solid surface inside. When the catalog says an opening goes through but the model is solid partway, the opening SHALL be treated as a blind opening from each face that is open at least 1 mm deep: two blind openings when both faces are, one when only one is. A face whose opening is less than 1 mm deep SHALL be treated as closed. When nothing can be measured, the catalog value SHALL be used.

#### Scenario: Smart Motor back holes
- **WHEN** the Smart Motor's hole_1, which the catalog lists as going through, is measured
- **THEN** the back face counts as closed there (the model shows only a mark about 0.4 mm deep), the hole is a blind hole about 9 mm deep from the front face, and a pin pushed 6 mm into the back collides with the motor

#### Scenario: Blocked in the middle
- **WHEN** an opening listed as through is open 4 mm from each face with solid between
- **THEN** it is treated as two blind openings, each 4 mm deep

#### Scenario: Real through hole
- **WHEN** a beam's hole is measured
- **THEN** it is open from face to face, and a pin through it is seated along the beam's full thickness

### Requirement: Rubber shaft collars are held parts
The audit SHALL treat Rubber Shaft Collars as parts held on a shaft, through their collar hole, and never as shafts or fasteners. A collar seated on a shaft SHALL count as fastened by that shaft. A collar SHALL count toward the parts a shaft passes through when checking shaft overhang.

#### Scenario: Collar on an axle end
- **WHEN** a Rubber Shaft Collar sits on the end of an axle, just outside a wheel hub
- **THEN** the collar is not reported as floating, and the axle's end inside the collar is not reported as overhanging
