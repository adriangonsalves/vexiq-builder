## Purpose

Play mode lets a builder run the robot's Smart Motors and watch the mechanism move: shafts, gears, chains and hinged parts turn as the real pieces would, until parts collide and the motor stalls.

## ADDED Requirements

### Requirement: Entering and leaving Play mode
Tools SHALL offer **Play mode**. While it is on, the assembly SHALL NOT be editable (no placing, moving, deleting or history steps) and a Play panel SHALL show. Leaving Play mode SHALL put every part back in the pose it had on entry, and SHALL add nothing to the build history.

#### Scenario: Leaving restores the build
- **WHEN** the user runs a motor so an arm swings, then leaves Play mode
- **THEN** every part is back where it was before Play mode started, and undo history is unchanged

#### Scenario: Editing is blocked
- **WHEN** Play mode is on and the user tries to drag a part
- **THEN** the part does not move in the build

### Requirement: Rigid bodies from pin joins
Parts SHALL be grouped into rigid bodies: two parts joined through two or more pins (or one pin plus another fixed join, such as a standoff or a corner connector peg) SHALL move as one body. Pins and fasteners SHALL move with the body they hold.

#### Scenario: Plate and beam on two pins
- **WHEN** a beam is pinned to a plate through two holes
- **THEN** in Play mode the beam and plate never move relative to each other

### Requirement: Single pin joins are hinges
Where a part, or a rigid body, is held to the rest through exactly one pin, Play mode SHALL let it turn about that pin's axis and SHALL NOT let it slide off or tilt.

#### Scenario: Arm on one pin
- **WHEN** a beam is held to a plate by one pin and a gear train pushes on it
- **THEN** the beam swings about the pin's axis and stays on the pin

### Requirement: Shaft groups turn together
Each shaft group (a square shaft with every part whose square bore fits it, and the Smart Motor socket holding it) SHALL turn as one body about the shaft's axis. Where the group passes through round holes in other bodies, it SHALL turn freely in them and SHALL NOT slide along the axis. A part on the shaft with a round bore, or whose square doesn't line up with the shaft's, SHALL NOT be driven by it.

#### Scenario: Wheel on a driven shaft
- **WHEN** a motor turns a shaft that carries a wheel through a square bore
- **THEN** the wheel turns at the shaft's speed

#### Scenario: Idler on a round bore
- **WHEN** a shaft turns through a 36 Tooth Idler Gear's round bore
- **THEN** the idler is not turned by the shaft (only by gears it meshes with)

#### Scenario: Square not aligned
- **WHEN** a gear's square bore sits on a shaft at an angle that isn't a multiple of 90° from the shaft's flats
- **THEN** Play mode warns that the gear doesn't fit the shaft and the gear is not driven by it

### Requirement: Gears and chains link by tooth ratio
Two gears that mesh SHALL turn in opposite directions with speeds in the inverse ratio of their tooth counts. A gear meshing a rack SHALL move the rack along its length by the gear's pitch travel. Two sprockets joined by a chain or track SHALL turn the same direction in the inverse ratio of their tooth counts. Chain and track links SHALL stay where they are.

#### Scenario: 12 to 36 tooth reduction
- **WHEN** a motor turns a 12 Tooth Gear at 120 rpm that meshes a 36 Tooth Gear
- **THEN** the 36 Tooth Gear turns the opposite way at 40 rpm

#### Scenario: Chain drive
- **WHEN** an 8 Tooth sprocket turns, chained to a 16 Tooth sprocket
- **THEN** the 16 Tooth sprocket turns the same way at half the speed and the chain links don't move

### Requirement: Motor throttles
The Play panel SHALL list every Smart Motor with a throttle that runs from full reverse through stop to full forward. A throttle's position SHALL set the motor's target speed, up to 120 rpm either way, with torque limited to the Smart Motor's stall torque. Releasing or centring a throttle SHALL stop that motor. Selecting a motor's row SHALL highlight that motor in the view.

#### Scenario: Half throttle reverse
- **WHEN** the user drags a motor's throttle halfway toward reverse
- **THEN** its shaft turns backward at about 60 rpm, if nothing blocks it

### Requirement: Collisions block motion and stall motors
Solid parts in different bodies SHALL NOT pass through each other. When a collision stops a driven body, everything linked to it (shaft group, meshed gears, chained sprockets, the motor) SHALL stop too. A motor commanded to turn that has stayed below a small fraction of its target speed for a short time SHALL be shown as stalled on its throttle row and on the motor in the view, and SHALL clear when it turns again. Parts already touching or in a tight fit on entry SHALL NOT count as blocking.

#### Scenario: Arm hits the frame
- **WHEN** a motor raises an arm until the arm presses on the chassis
- **THEN** the arm stops, the motor's row and the motor are marked stalled, and reversing the throttle moves the arm back and clears the mark

### Requirement: Unsupported parts reported
On entry, Play mode SHALL list what it could not set up (a gear whose square doesn't fit its shaft, a part joined by nothing, a gear mesh too far off to link), and SHALL still run the rest.

#### Scenario: Loose part
- **WHEN** a gear sits on no shaft
- **THEN** Play mode lists it as loose and holds it still
