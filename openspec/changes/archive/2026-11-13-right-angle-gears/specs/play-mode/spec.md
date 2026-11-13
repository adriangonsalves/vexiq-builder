## MODIFIED Requirements

### Requirement: Gears and chains link by tooth ratio
Two gears that mesh SHALL turn in opposite directions with speeds in the inverse ratio of their tooth counts. A gear meshing a rack SHALL move the rack along its length by the gear's pitch travel. Two sprockets joined by a chain or track SHALL turn the same direction in the inverse ratio of their tooth counts. Chain and track links SHALL move with the body that holds their sprockets, and a track on a single sprocket SHALL also run round its loop in the direction the sprocket turns, one link per tooth, with its flaps and grippers; the links of a chain on several sprockets SHALL NOT run round.

Gears that mesh at 90° (see right-angle-gears) SHALL be linked too:
- two bevel gears, and a crown gear with a spur gear, SHALL turn with speeds in the inverse ratio of their tooth counts, each in the direction that keeps the teeth moving together where they meet;
- a worm SHALL turn its spur gear by one tooth for each turn of the worm (for a single thread; by as many teeth as the worm has threads otherwise), in the direction set by the way its thread winds;
- a worm SHALL drive one way only: the spur gear SHALL NOT turn the worm. A motor whose train reaches a worm from the gear's side SHALL stall, and a load on the gear's side (an arm's weight, another part pushing) SHALL NOT turn the gear or the worm. On entry, Play mode SHALL list such a motor with a message saying a worm can only be turned from its own shaft.

#### Scenario: 12 to 36 tooth reduction
- **WHEN** a motor turns a 12 Tooth Gear at 120 rpm that meshes a 36 Tooth Gear
- **THEN** the 36 Tooth Gear turns the opposite way at 40 rpm

#### Scenario: Chain drive
- **WHEN** an 8 Tooth sprocket turns, chained to a 16 Tooth sprocket
- **THEN** the 16 Tooth sprocket turns the same way at half the speed and the chain links stay where they are on the frame

#### Scenario: Intake track on one sprocket
- **WHEN** the intake motor turns the sprocket carrying a track of 8 tread links, and the tower lifts the intake
- **THEN** the track runs round its loop with the sprocket, and goes up with the intake instead of staying behind

#### Scenario: Bevel gears turn a corner
- **WHEN** a motor turns an 18 Tooth Bevel Gear at 120 rpm that meshes another 18 Tooth Bevel Gear on a shaft at 90°
- **THEN** the second shaft turns at 120 rpm, and the teeth of the two gears move the same way where they meet

#### Scenario: Crown gear reduction
- **WHEN** a motor turns a 12 Tooth Gear at 120 rpm that meshes the 36 Tooth Crown Gear
- **THEN** the crown gear's shaft turns at 40 rpm

#### Scenario: Worm drives its gear
- **WHEN** a motor turns a Worm Gear at 120 rpm that meshes a 36 Tooth Gear
- **THEN** the 36 Tooth Gear turns at 120/36 rpm, and reversing the motor reverses the gear

#### Scenario: Gear can't drive the worm
- **WHEN** a motor turns a 36 Tooth Gear that meshes a Worm Gear on a free shaft
- **THEN** the motor shows as stalled, neither turns, and the entry list says a worm can only be turned from its own shaft

#### Scenario: Worm holds an arm
- **WHEN** gravity is on, an arm hangs from the shaft of a 36 Tooth Gear driven by a worm, and the motor is stopped
- **THEN** the arm stays where it is
