## ADDED Requirements

### Requirement: Bands pull on the parts they touch
In Play mode, each band with a route SHALL pull the bodies holding its spots. At each spot it SHALL pull along the directions its path leaves that spot, with a force set by its stretch (the assumed band stiffness). A slack band SHALL pull with no force. A band whose spots are all on one body SHALL pull on nothing. A band SHALL NOT be a body of its own, and SHALL NOT collide.

When the physics couldn't start and parts only turn by gear ratio, bands SHALL NOT pull. If bands are present, Play mode SHALL list them as "bands don't pull without physics".

#### Scenario: Arm pulled down
- **WHEN** Swish's two arm bands stretch from the catapult arm to the chassis and Play mode runs, with nothing holding the arm up
- **THEN** the arm swings toward the chassis until something stops it

#### Scenario: Band on one body
- **WHEN** a band's spots are all on beams pinned into one rigid body
- **THEN** the band pulls on nothing and the body doesn't move because of it

### Requirement: Bands redrawn as parts move
In Play mode, each band with a route SHALL be redrawn every frame from its route and the current poses of its spots' parts, keeping its gaps as its sprockets turn. Its stretch colour SHALL update as it is redrawn. Leaving Play mode SHALL put every band back as it was in the build.

#### Scenario: Intake turns
- **WHEN** Swish's intake motor runs in Play mode
- **THEN** the intake bands turn with the sprockets, staying in their gaps and on their standoffs
