## ADDED Requirements

### Requirement: Parts on idler pins turn
In Play mode a gear, sprocket, pulley or wheel held by an idler pin in its centre hole SHALL turn freely about the pin on the body the pin is in, and SHALL mesh, chain and carry bands and ropes as a part on a free shaft does. It SHALL NOT be reported as "isn't held on anything".

#### Scenario: Huey's drive
- **WHEN** Huey's left drive motor runs forward in Play mode
- **THEN** the front wheel and, through the 36 and 48 Tooth idler gears, the back wheel on that side both turn, at the speeds their tooth counts give (48 to 24: twice the motor's speed, the same way round as each other)

### Requirement: Bodies joined by a slide move along it
In Play mode two bodies joined by a linear motion slide SHALL move against each other only along the slide's direction, with no tilt or twist, and SHALL stop where parts meet at either end of the travel. A rack clipped to a beam SHALL be part of that beam's body. A body held only by a slide SHALL NOT be reported as loose or as not joined to the robot.

With gravity on, a sliding body that nothing drives or holds SHALL slide down until it meets its stop. With gravity off it SHALL stay where it is.

#### Scenario: Stage at rest
- **WHEN** Play mode starts on Huey with gravity off
- **THEN** the Middle Stage stays where it is, level, and nothing is listed as loose because of the lift

#### Scenario: Stops
- **WHEN** the Middle Stage is driven up until it can go no further
- **THEN** it stops within 3 mm of the travel the audit gives, and the lift motor is shown as stalled

### Requirement: A gear drives a rack on a sliding body
In Play mode a gear meshed with a rack SHALL move the body the rack is on along its slide by the rack's travel per turn of the gear, and a force on that body SHALL turn the gear back the same way. This SHALL hold when the rack's body is joined to the gear's body by a slide, as well as when the rack is held by nothing but its gear.

A stopped motor SHALL hold the body through the gear and rack according to its stopping mode (openspec motor-stopping): Hold keeps it up under gravity, Brake lets it creep, Coast lets it fall.

#### Scenario: Huey's lift rises
- **WHEN** Huey's lift motor runs forward for one turn of the 12 Tooth Gears in Play mode
- **THEN** the Middle Stage rises by one turn's travel of a 12 Tooth Gear on the rack (about 39.9 mm) within 2 mm, and both sides rise together

#### Scenario: Lift lowered
- **WHEN** the lift motor is reversed
- **THEN** the Middle Stage comes down by the same rule and stops at its lower stop

#### Scenario: Lift held
- **WHEN** gravity is on, the lift motor's stopping mode is Hold, and the motor is stopped part way up
- **THEN** the Middle Stage stays within 1 mm of where it stopped

#### Scenario: No physics
- **WHEN** Play mode runs without the physics engine
- **THEN** the Middle Stage still follows the lift motor by the same travel per turn, between its stops
