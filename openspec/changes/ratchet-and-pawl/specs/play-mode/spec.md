## ADDED Requirements

### Requirement: Ratchets turn one way
In Play mode a ratchet held by a pawl SHALL turn freely in its free direction and SHALL NOT turn the other way relative to the part the pawl is pinned to.
- Turning the free way, the pawl SHALL rock on its pin as each tooth passes under its tip, and SHALL add a small drag between the ratchet and the part holding the pawl.
- Turned the held way by a motor, with the pawl's holder fixed to the frame, the ratchet SHALL stop and the motor SHALL show as stalled.
- A load on the ratchet's shaft the held way (a band, an arm's weight with gravity on, another part pushing) SHALL NOT turn it, with the motor stopped or not.
- When the pawl's holder can move, pushing the ratchet the held way SHALL carry the holder along with it.
- A pawl SHALL stay on the teeth while a band or belt pulls it there, or its weight does with gravity on, and otherwise SHALL stay where it was on entry. A pawl pushed clear of the teeth by another part SHALL let the ratchet turn both ways until it drops back.
- A pawl held by two or more pins SHALL lock the ratchet both ways.
- A pawl facing the wrong way SHALL hold nothing.

On entry, Play mode SHALL list a pawl facing the wrong way and a pawl that locks its ratchet both ways.

#### Scenario: Free direction
- **WHEN** a motor turns a shaft carrying a 16 Tooth Ratchet in its free direction at 120 rpm, with a pawl pinned to the frame
- **THEN** the shaft turns at about 120 rpm and the pawl rocks over the teeth 16 times per turn

#### Scenario: Held direction stalls the motor
- **WHEN** the same motor is run the other way
- **THEN** the shaft turns no more than one tooth, stops, and the motor shows as stalled

#### Scenario: Ratchet holds a load
- **WHEN** a rubber band pulls an arm on the ratchet's shaft the held way and the throttle is at stop
- **THEN** the arm stays where it is

#### Scenario: Lifting the pawl lets go
- **WHEN** a second motor swings a beam that pushes the pawl clear of the teeth while the band pulls the arm
- **THEN** the arm swings back the held way, and it is held again once the beam moves off and the pawl drops back onto the teeth

#### Scenario: Pawl on two pins
- **WHEN** the pawl is pinned through two holes and a motor turns the ratchet either way
- **THEN** the motor stalls both ways and the entry list says the pawl can't lift

### Requirement: Gears on a swinging arm
Two meshing gears whose shafts are held by different bodies, one of which swings about the other gear's shaft, SHALL stay in mesh as the arm swings: the gear on the arm SHALL roll round the gear on the pivot shaft, turning by the tooth ratio measured relative to the arm. The force between the teeth SHALL act on the arm as well as on the gears, so a gear that can't turn on the arm carries the arm round with the gear that drives it.

#### Scenario: Arm held still
- **WHEN** a 36 Tooth Gear on a motor shaft meshes a 36 Tooth Gear on an arm that pivots on the motor shaft, and the arm is pinned to the frame
- **THEN** the arm's gear turns the opposite way at the motor's speed, as before this change

#### Scenario: Gear locked to the arm
- **WHEN** the arm is free to swing and its gear is locked to it
- **THEN** running the motor swings the arm at the motor's speed, the same way, with the gears staying in mesh

#### Scenario: Arm swung by something else
- **WHEN** the motor shaft is held still and something else swings the arm through 90°
- **THEN** the arm's 36 Tooth Gear turns 90° relative to the arm, rolling round the still gear without the teeth passing through each other

### Requirement: Gears come into and out of mesh
Two spur gears of the same tooth size on parallel shafts in the same plane, held by bodies that can move relative to each other, SHALL drive each other by tooth ratio whenever their centres are at mesh distance (within the mesh tolerance), and SHALL NOT while they are further apart. Such gears SHALL NOT be pushed closer than mesh distance: a gear swung against its partner stops there. As two gears come together, one SHALL slip by no more than half a tooth so their teeth fit. This SHALL apply to gears already in mesh on entry whose centres can move apart, and to gears apart on entry.

#### Scenario: Swinging into mesh
- **WHEN** an arm carrying a turning 36 Tooth Gear swings until that gear is 38.1 mm from another 36 Tooth Gear on a free shaft
- **THEN** the arm stops there and the second gear starts turning the opposite way at the same speed

#### Scenario: Swinging out of mesh
- **WHEN** the arm then swings away
- **THEN** the second gear is no longer driven and can turn freely

#### Scenario: Fixed gears unchanged
- **WHEN** two meshing gears are both on shafts held by the frame
- **THEN** they drive each other exactly as before this change

### Requirement: Ratchet release on a swinging arm
A build made the way Hero Bot Swish's winch is made SHALL run as the real one does: a motor shaft with a gear; an arm free to swing on that shaft, carrying a second shaft with a gear in mesh with the motor's gear and a ratchet; a pawl pinned to the arm holding that ratchet; and a third shaft with a gear the arm's gear can swing into.

#### Scenario: Winding
- **WHEN** the motor runs the way that turns the arm's shaft in the ratchet's free direction
- **THEN** the arm swings toward the third shaft, its gear drops into mesh, the arm stays there, and the third shaft turns for as long as the motor runs

#### Scenario: Holding
- **WHEN** the throttle is put to stop while something pulls the third shaft backward
- **THEN** the third shaft does not turn back and the arm stays in mesh

#### Scenario: Releasing
- **WHEN** the motor is run the other way
- **THEN** the arm swings away with the motor shaft, its gear leaves the third shaft's gear, and the third shaft turns freely under whatever pulls it

#### Scenario: Swish winch
- **WHEN** Hero Bot Swish is imported and its two winch motors are run forward, stopped, then reversed
- **THEN** the release arm swings into mesh and the spool turns, the spool stops with the motors, and on reverse the arm lifts out and the spool is no longer driven
