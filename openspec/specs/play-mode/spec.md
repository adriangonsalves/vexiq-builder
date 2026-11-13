# play-mode Specification

## Purpose
Play mode lets a builder run the robot's Smart Motors and watch the mechanism move: shafts, gears, chains and hinged parts turn as the real pieces would, until parts collide and the motor stalls.

## Requirements

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

### Requirement: Motor throttles
The Play panel SHALL list every Smart Motor with a throttle that runs from full reverse through stop to full forward. A throttle's position SHALL set the motor's target speed, up to 120 rpm either way, with torque limited to the Smart Motor's stall torque. Releasing or centring a throttle SHALL stop that motor unless that motor's Hold option is enabled. Selecting a motor's row SHALL highlight that motor in the view. Each motor SHALL have an independent Hold checkbox so the user can hold individual motor throttles at their set values.

#### Scenario: Half throttle reverse
- **WHEN** the user drags a motor's throttle halfway toward reverse
- **THEN** its shaft turns backward at about 60 rpm, if nothing blocks it

#### Scenario: Per-motor Hold checkbox
- **WHEN** the user checks Hold on a motor's row and releases its throttle slider
- **THEN** that motor keeps running at the chosen speed while other motors without Hold spring back to stop

### Requirement: Limit speed by load
The Play panel SHALL provide a global toggle to limit motor speed by mechanical load. When enabled, maximum motor speed SHALL drop above 1.4 W mechanical power draw according to $(1.4 / \tau_\text{load}) \times 9.55\text{ rpm}$, tapering smoothly to 0 at the motor's stall torque of 0.414 N·m. Mechanical load torque calculation SHALL account for gravitational weight along the mechanism's kinematic chain, internal joint friction, and drivetrain rolling load proportional to the robot's total weight.

#### Scenario: Lifting heavy arm vs lowering
- **WHEN** Limit speed by load is enabled and the user raises an arm against gravity
- **THEN** the arm motor speed decreases proportionally to the gravitational load torque, and lowering the arm with gravity encounters lower load torque and runs faster

#### Scenario: Drivetrain motor loaded by robot weight
- **WHEN** Limit speed by load is enabled and drivetrain motors turn the wheels
- **THEN** the motor speeds reflect the load imposed by supporting and rolling the robot's weight

### Requirement: Simulate gravity
The Play panel SHALL provide a global toggle to simulate gravity. When enabled, unanchored parts and unsupported cantilever bodies SHALL fall under gravitational acceleration onto a ground plane collider at the robot's base. Mechanisms lifting masses SHALL experience opposing gravitational torque, while lowering mechanisms SHALL be assisted by gravity. Batteries correctly positioned in brain battery bays (both Gen 1 and Gen 2) SHALL be held rigidly by their bay latch and SHALL NOT fall out.

#### Scenario: Unanchored parts fall to the floor
- **WHEN** Simulate gravity is turned on and a build contains a loose part
- **THEN** the loose part drops onto the floor below the robot rather than staying suspended in mid-air

#### Scenario: Battery mated in brain
- **WHEN** Simulate gravity is turned on and a battery is seated in its brain's battery bay
- **THEN** the battery remains latched to the brain and moves rigidly with it

### Requirement: Collisions block motion and stall motors
Solid parts in different bodies SHALL NOT pass through each other. When a collision stops a driven body, everything linked to it (shaft group, meshed gears, chained sprockets, the motor) SHALL stop too. When a moving linkage impacts a hard stop, it SHALL display an inertia-scaled elastic wobble that naturally damps according to the moving assembly's mass rather than stopping abruptly. A motor commanded to turn that has stayed below a small fraction of its target speed for a short time SHALL be shown as stalled on its throttle row and on the motor in the view, and SHALL clear when it turns again. Parts whose outlines already overlap on entry (a tight fit, a shaft in a hole) SHALL NOT count as blocking; parts that merely touch SHALL.

#### Scenario: Arm hits the frame
- **WHEN** a motor raises an arm until the arm presses on the chassis
- **THEN** the arm stops with an elastic wobble, the motor's row and the motor are marked stalled, and reversing the throttle moves the arm back and clears the mark

#### Scenario: Linkage beams meet
- **WHEN** a motor raises an arm whose upper and lower beams come together before it reaches anything else
- **THEN** the motor stops as soon as the beams press into each other, shows as stalled, and the arm does not swing on through them

### Requirement: Unsupported parts reported
On entry, Play mode SHALL list what it could not set up (a gear whose square doesn't fit its shaft, a part joined by nothing, a gear mesh too far off to link), and SHALL still run the rest.

#### Scenario: Loose part
- **WHEN** a gear sits on no shaft
- **THEN** Play mode lists it as loose and holds it still

### Requirement: What holds still
With no floor, the largest piece of the robot (parts joined by hinges), and every piece with a Smart Motor driving a shaft, SHALL hold one of its bodies still: the one carrying the most such motors, else the largest. A piece joined to none of those SHALL stay still, SHALL NOT block other parts, and SHALL be listed.

#### Scenario: Tower not joined to the base
- **WHEN** a tower carrying the arm motor isn't detected as joined to the base
- **THEN** the tower holds still and the arm moves, not the other way round

### Requirement: Fastener holding strength
Play mode SHALL rate every joint the drop test can break from one table of holding strengths. Each value in the table SHALL be marked as assumed or measured.
- A pin, peg or standoff end SHALL grip each part it sits in by an amount that grows with the depth it is seated in that part. Only the part at the tip of that end SHALL add the extra hold of the snap ridge.
- Two parts joined by a pin SHALL separate only when the parts on one side slide off their end of the pin. The hold against that is the total grip of every part that must slide. A way off SHALL be blocked when a cap is at that end or the pin's shoulder sits between those parts and that end. The joint SHALL hold up to the weakest way off that isn't blocked.
- A Rubber Shaft Collar SHALL hold only by friction along its shaft, a few newtons and far less than a fully seated pin end.
- Spacers and washers on a shaft SHALL hold nothing when pulled; they SHALL only push back when pressed.
- A square shaft in a square opening SHALL resist turning and sideways load but SHALL NOT resist sliding along the shaft. A shaft in a round hole SHALL resist only sideways load.
- Every pin and peg joint SHALL also have a sideways strength, and prying (a part tipping on its face edge) SHALL load it as pull. Joints round a shaft (round holes, square fits, the Smart Motor socket) SHALL NOT fail sideways; they let go only by sliding off the end of the shaft.
- A tire on its hub, and a Gen 1 battery in its Brain, SHALL be held as one piece that a drop doesn't separate.
- Weak variants of pins and standoffs SHALL hold less than their regular versions.

#### Scenario: Deeper seating holds more
- **WHEN** the same pin end sits 3 mm deep in one build and 6 mm deep in another
- **THEN** the 6 mm seat holds more pull than the 3 mm seat

#### Scenario: A longer pin doesn't grip one part harder
- **WHEN** a 1x1 pin and the short end of a 1x2 pin each sit fully in the same beam
- **THEN** both ends hold the same pull against that beam

#### Scenario: Capped side can't let go
- **WHEN** two plates are joined by a capped pin and pulled apart along the pin
- **THEN** the plate under the cap stays on the pin, and the joint gives way only when the pin pulls out of the other plate

#### Scenario: Collar slides before pins let go
- **WHEN** a wheel held on its shaft by a Rubber Shaft Collar and a beam held by fully seated pins take the same pull along their axes
- **THEN** the collar slides at a much lower force than the pins pull out

### Requirement: Parts bend under impact
During a drop, beams, plates and shafts SHALL flex according to their length, width, thickness and material, so long, thin or unbraced parts bend more than short, thick or braced ones. Bending SHALL both soften the impact (spreading it over more time) and load the joints at a bent part's ends with prying.

#### Scenario: A heavier load pries harder
- **WHEN** the same arm, held to the frame by the same two pins, carries a Smart Motor at its tip in one build and a light block in another, and both are dropped from the same height
- **THEN** the pins at the arm's root take more load with the Smart Motor

#### Scenario: Bending softens the hit
- **WHEN** the same arm carrying the same weight is dropped once as it is and once made ten times stiffer
- **THEN** the stiffer arm's root pins take more load, because the flexing arm spreads the hit over more time

#### Scenario: Bracing protects an arm
- **WHEN** the same cantilevered arm is dropped with and without a brace beam from its end back to the frame
- **THEN** the braced arm's root pins take less load, and at a height where the unbraced arm's pins pop the braced arm's hold

### Requirement: Impact loads and joint failure
On floor impact, Play mode SHALL work out the load in every joint from the whole robot at once: each structural part SHALL decelerate by its own mass and the joints and bending parts that tie it to the rest, and the floor SHALL push only on parts that touch it.
- Each joint's load SHALL be split into pull along its axis, sideways load and prying. A joint SHALL fail when those loads together pass its strength.
- A pin, peg or collar pulled harder than it grips SHALL slide out gradually (a pin gripping less the further it has slid) and SHALL let go only once it has slid its whole seated depth (a collar: the rest of its shaft); a joint pushed sideways past its strength SHALL let go at once.
- A joint that fails during the impact SHALL stop carrying load at once, and its load SHALL pass to the joints still holding during the same impact.
- The result SHALL depend only on the build, the drop height and the landing. Moving or turning the whole build in space before Play mode SHALL NOT change which joints break, and a mirrored build SHALL break in the mirrored places.
- A higher drop with the same landing SHALL never break fewer joints or give a lower peak joint load.

#### Scenario: Moving the build changes nothing
- **WHEN** the same robot is dropped from 0.5 m flat, once where it was built and once moved 200 mm sideways
- **THEN** the same joints break, with the same forces to within 1%

#### Scenario: Mirrored build breaks in mirrored places
- **WHEN** a robot and its mirror image are dropped from the same height, the first on its left side and the second on its right side
- **THEN** each joint that breaks in one has its mirror partner break in the other

#### Scenario: Load passes to the joints that are left
- **WHEN** one of two pins holding an arm pulls out during an impact
- **THEN** the other pin carries the arm's load for the rest of that impact and is checked against its strength under that larger load

#### Scenario: Collars slide on side landings
- **WHEN** a wheel held on its shaft by a Rubber Shaft Collar is dropped from 0.5 m flat, and again from 0.5 m on the side that throws the wheel along its shaft
- **THEN** the collar doesn't move on the flat landing and is pushed along its shaft on the side landing, coming off only if pushed the rest of the shaft's length

#### Scenario: A brief pull loosens, a sustained pull removes
- **WHEN** a pin or collar is pulled harder than it grips for only part of the time it would take to slide out
- **THEN** it slides part way out and holds, and the report lists it as loosened with how far it slid; only a pull that lasts until it has slid out its whole seated depth (for a collar, the rest of its shaft) makes it let go

### Requirement: Drop and crash simulation
The Play panel SHALL provide a **Drop test** control with a selectable drop height (from gentle drops such as `0.15 m` up to severe drops such as `1.5 m`), a selectable landing (**Flat**, **Front**, **Back**, **Left side**, **Right side** or **Corner**, using the build's own directions with +X as Front, matching the view cube), a **Drop** action and a **Reset** action. Triggering a drop SHALL turn the robot so it lands as chosen, lift it to the chosen height above the floor, release the whole robot under gravity, and work out joint loads on first floor contact (see "Impact loads and joint failure"):
- Any part or subassembly left with no unbroken joints to the rest of its body SHALL detach into an independent rigid body that falls, tumbles and bounces on the floor, leaving with the speed and spin it had at the end of the impact. Parts fitted onto a square shaft SHALL stay on their shaft unless what holds them along it fails.
- Any part or subassembly reduced from two or more pin lines to a single pin line SHALL become a hinged body that swings under gravity about the remaining pin.
- The Play panel SHALL report:
  - the number of joints broken and parts detached
  - the peak deceleration of the robot in g and the peak joint load in newtons
  - for each broken joint, how it failed (pulled out, pried out, slid off or sheared) and its load against its strength
  - weak spots: joints that used 70% or more of their strength, or slid part way out, without breaking
- Hovering a reported joint or part SHALL highlight it.
- A **Highlight loose parts** option SHALL light up every part that came off and every part left hanging by a single pin line, for as long as the drop lasts; the report SHALL list the hanging parts.
- A **Slow motion** choice SHALL play the drop at real time, or 2, 4 or 8 times slower.
- While any holding strength or stiffness in use is an assumed value, the Drop test section SHALL say the strengths are estimates.
- Pieces that broke away SHALL collide with the rest of the robot once they move apart, so a loose part never passes through the parts it came off.
- Triggering **Reset** (or leaving Play mode) SHALL restore all broken joints and return every part to its assembled pose without modifying the build or undo history.

#### Scenario: Gentle drop survives intact
- **WHEN** a well-braced robot (such as Clawbot) is dropped flat from `0.15 m` or `0.30 m`, or Flop from `0.15 m`
- **THEN** the robot lands, remains fully assembled with zero broken joints and zero detached parts, and reports its peak deceleration and peak joint load

#### Scenario: Flop at 0.30 m keeps every part
- **WHEN** Flop is dropped flat from `0.30 m`
- **THEN** no part comes off (with the assumed strengths a pin or two may pry loose; recheck once strengths are measured)

#### Scenario: High drop pops weak pins and detaches parts
- **WHEN** a robot with a heavy cantilevered subassembly (such as Clawbot's wrist and claw) is dropped flat from `1.5 m`
- **THEN** the joints whose load passes their strength break, the subassembly they held detaches and falls independently, and the panel lists each broken joint with how it failed

#### Scenario: Weak spots shown when nothing breaks
- **WHEN** a drop leaves the robot intact but some joints used 70% or more of their strength
- **THEN** the panel lists those joints as weak spots, and hovering one highlights it

#### Scenario: Landing choice changes what is loaded
- **WHEN** the same robot is dropped from the same height once **Flat** and once on its **Left side**
- **THEN** each drop lands on the chosen face and the reported loads differ between the two

#### Scenario: Estimates notice
- **WHEN** the strength table still holds assumed values and the user opens the Drop test section
- **THEN** the section says the strengths are estimates

#### Scenario: Loose parts don't pass through the robot
- **WHEN** a hard drop knocks the Brain loose and it swings or falls against the plates it sat on
- **THEN** it stops against them instead of passing through (allowing a few millimetres where the collision outlines are simplified)

#### Scenario: Highlighting loose parts
- **WHEN** **Highlight loose parts** is on and a drop knocks parts off or leaves some hanging by one pin
- **THEN** those parts are lit up in the view until Reset, and the report lists the hanging ones

#### Scenario: Resetting or closing Play mode after a crash
- **WHEN** the user runs a drop test that detaches parts and then clicks **Reset** or closes Play mode
- **THEN** all parts return to their original assembled positions and the build history is unchanged
