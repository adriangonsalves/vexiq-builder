## ADDED Requirements

### Requirement: Ropes pull when tight
In Play mode, each rope with a route SHALL act on the bodies holding its ends and spots:
- while its path is shorter than the rope length it has to give (its length less what is wound on a spool), it SHALL be slack and pull with no force;
- once its path reaches that length it SHALL be tight: it SHALL pull each body along the directions its path leaves that body's spots, with whatever force is needed to stop the path growing longer, and it SHALL NOT stretch;
- a rope SHALL only pull, never push.

A rope whose ends and spots are all on one body SHALL pull on nothing. A rope SHALL NOT be a body of its own, and SHALL NOT collide. A rope with a free end SHALL pull on nothing.

When the physics couldn't start and parts only turn by gear ratio, ropes SHALL NOT pull. If routed ropes are present, Play mode SHALL list them as "ropes don't pull without physics".

#### Scenario: Tight rope holds an arm
- **WHEN** a hinged arm is pulled away from a fixed pin by a rubber band, and a rope runs from the arm to another fixed pin
- **THEN** the arm swings until the rope is tight and stops there, with the rope straight

#### Scenario: Rope pulls a part off its stop
- **WHEN** rubber bands press a hinged arm against a stop, and a spool starts winding a rope that pulls the arm away from that stop
- **THEN** within 0.5 s the rope pulls as hard as the bands need and the arm leaves the stop, moving as fast as the spool winds; the stop doesn't hold the rope back
- **AND WHEN** a rope instead pulls a part into something it can't pass
- **THEN** the pull stops growing and the part doesn't go through

#### Scenario: Slack rope does nothing
- **WHEN** a rope between two bodies has 20 mm of slack and the bodies move 10 mm apart
- **THEN** the rope doesn't pull and 10 mm of slack is left

#### Scenario: Rope on one body
- **WHEN** a rope's two ends are on pins in one rigid body
- **THEN** it pulls on nothing

### Requirement: Spools wind rope
In Play mode, a spool holding a rope end SHALL wind the rope as it turns against the body the rope runs to:
- turning in the winding direction SHALL take rope onto the drum, one layer's circumference for each turn, and turning back SHALL pay it out;
- a spool with no turns on it SHALL start winding whichever way it turns first, and a spool paying out past its last turn SHALL start winding the other way;
- the rope's pull SHALL turn the spool back with a torque of the pull times the radius the rope leaves the drum at, so whatever drives or holds the spool carries that load;
- winding SHALL stop when the rope can get no shorter (the part on its far end, or a part carrying a pulley, has met something it can't pass), and the motor driving it SHALL stall as against any block;
- a drum wound in Play past the turns it holds SHALL keep winding, drawn full to the flange, and Play mode SHALL list "… is over full";
- a spool turned through gears SHALL turn only as fast as its gears let it, in the same step the rope pulls: the gears and whatever drives them carry the rope's pull at once, so the spool SHALL NOT run ahead of its gears and then be pulled back, and a steady motor SHALL wind at a steady speed. This SHALL hold for any number of motors driving the gears, at any throttle, and with the gears fixed or on a part that swings them into mesh;
- teeth that have slipped SHALL slip back by no more than half a tooth: teeth that slipped further mesh in the nearest gap.

The turns on the spool SHALL be shown as coils on the drum, updated as it winds. Leaving Play mode SHALL put the turns back as they were in the build.

#### Scenario: Winding pulls the arm
- **WHEN** a motor turns a spool whose rope runs to a hinged arm held up by rubber bands
- **THEN** the coils on the drum grow and the arm is pulled toward the spool, stretching the bands

#### Scenario: Motor stops with no ratchet
- **WHEN** the motor of that winch is released (its throttle not kept) and nothing else holds the spool
- **THEN** the arm does what the motor's stopping mode allows (openspec motor-stopping): with Hold it stays where it is; with Brake the bands pull it back slowly as the rope pays out; with Coast they pull it back quickly
- **AND WHEN** the motor then runs in reverse
- **THEN** the bands pull the arm back and the spool turns backward as the rope pays out

#### Scenario: Winch gear on a swinging arm under load
- **WHEN** a spool is turned through a gear on a swinging arm that the motor swings into mesh (Swish's winch), and the rope pulls as hard as a stalled Smart Motor can wind
- **THEN** the gears stay in mesh and the spool turns only as fast as the gears allow; the spool spins freely only once the arm has swung the gear out

#### Scenario: Spool keeps pace with its motor
- **WHEN** a motor at 5% throttle winds a spool through a gear on a swinging arm, against a rope pulling a hinged arm held up by rubber bands
- **THEN** the spool turns at the motor's speed times the gear ratio within 5%, measured over each second, the rope's turns go up at that rate, the teeth have slipped less than half a tooth, and the arm comes down without a jump bigger than its travel in 0.1 s at that speed

#### Scenario: Wound into a stop, then released
- **WHEN** that winch, driven by one motor and again by two motors in a motor group, winds until the arm meets its stop and keeps winding until the motors stall, then runs in reverse at 5% throttle
- **THEN** within 1 s the gear on the swinging arm leaves mesh, the spool turns freely and the bands swing the arm up, with one motor and with two

#### Scenario: Slack spool at rest
- **WHEN** a spool holds a slack rope and nothing turns it
- **THEN** the spool stays still (under 1 rpm after 1 s)

#### Scenario: Swish winds, holds and fires
- **WHEN** Hero Bot Swish is imported and its winch motors run forward, stop, then run in reverse
- **THEN** forward winds the rope and pulls the catapult arm down against its bands; stopped, the pawl holds the spool and the arm stays down; reverse lifts the winch gears out of mesh, the spool spins freely, the rope pays out and the arm swings up until the rope is tight or the arm meets its stop

#### Scenario: Fully wound
- **WHEN** a spool winds until the part on the rope's far end meets the spool's frame
- **THEN** the spool stops and its motor is shown as stalled

#### Scenario: Paid out and wound the other way
- **WHEN** a spool with one turn keeps turning in the paying-out direction for two turns
- **THEN** the rope comes off the drum, then winds back on the other way round

### Requirement: A rope pulls on every part it touches
In Play mode, a rope SHALL slide freely over the grooves, posts and edges on its route, however many there are and whichever bodies they are on. Its one length SHALL be shared among all its runs, and a tight rope SHALL have one pull, the same along every run.

That pull SHALL act on every body the rope is connected to:
- on the body holding each end, at the end, along the run leaving it;
- on the body carrying each groove, post or edge, along both runs leaving that spot, each applied where that run leaves the spot, so the body is pushed along the line between the two runs and turned if that line misses its hinge;
- on the spool, along the run leaving the drum, at the point it leaves, which turns the spool back.

A body with several spots of one rope on it SHALL feel the sum of them. A body with spots of several ropes on it SHALL feel all the ropes. Bodies that are free to move SHALL move under these pulls as under any other force: a hinged arm SHALL swing, a slider SHALL slide, a shaft SHALL turn, and a motor in the way SHALL carry the load or stall.

A rope's pull SHALL be whatever keeps its path from growing past its length, up to an assumed strength limit. Under a steady load the path SHALL stay within 0.5 mm of the rope's length.

#### Scenario: Huey's lift doubles the travel
- **WHEN** Hero Bot Huey is imported, gravity is on, and its lift motor raises the middle stage by 50 mm once the ropes are tight
- **THEN** each rope stays tight over its idler pulley and the claw carriage rises 100 mm against the fixed stage, 50 mm against the middle stage

#### Scenario: Lift lowered
- **WHEN** the lift motor then lowers the middle stage
- **THEN** the carriage comes down under its own weight, twice as far as the middle stage, with the ropes tight

#### Scenario: Moving pulley halves the pull
- **WHEN** a rope runs from a fixed pin, down round a pulley on a hanging block, and up to a spool, with gravity on and the spool held
- **THEN** the rope's pull is half the block's weight (within 5%), and winding 100 mm of rope onto the spool raises the block 50 mm

#### Scenario: Block and tackle with four runs
- **WHEN** a rope runs from a fixed beam through two pulleys on a hanging block and two on the fixed beam to a spool, so four runs hold the block
- **THEN** the rope's pull is a quarter of the block's weight (within 5%), and winding 100 mm of rope raises the block 25 mm

#### Scenario: Pulleys on three bodies
- **WHEN** a rope runs from a pin on the frame, round a pulley on one hinged arm, round a pulley on a second hinged arm, round a pulley on the frame, to a slider, and the slider is driven away so the rope goes tight
- **THEN** both arms swing toward the line of the rope as it straightens, each pulled along the line between its two runs, and the slider's motor carries the rope's pull

#### Scenario: Pulley on an arm
- **WHEN** a rope from a spool passes one pulley on a hinged arm and ends on a fixed pin beyond it, and the spool winds
- **THEN** the arm is pulled toward the side the rope bends to, although neither end of the rope is on the arm

#### Scenario: Two ropes on one body
- **WHEN** Huey's carriage hangs on its left and right ropes
- **THEN** each rope carries half the carriage's weight (within 10%) and the carriage stays level

### Requirement: Parts held only by a rope
A body joined to the rest of the build by no pin or shaft, but holding a rope's end or a spot on a rope's route, SHALL be part of Play mode and SHALL NOT be listed as loose:
- it SHALL be pulled by its ropes;
- with gravity on it SHALL fall until its ropes are tight or something stops it; with gravity off it SHALL stay where it is while its ropes are slack;
- when the parts round it let it move along one line only (a carriage between its rails), it SHALL slide along that line and SHALL NOT tilt, twist or leave it, and SHALL stop where it meets a part at either end of its travel;
- otherwise it SHALL hang and swing from its rope, and collide as other moving bodies do.

When gravity is off and a body is held only by ropes, the Play panel SHALL show one line: "Turn on gravity so parts on ropes can come down."

#### Scenario: Carriage in its rails
- **WHEN** Huey enters Play mode
- **THEN** the claw carriage is not listed as loose, and it can move only up and down the middle stage

#### Scenario: Hook on a rope
- **WHEN** a 1x3 Large Crane Hook is pinned to the free tab of a rope wound on a spool, gravity is on, and the spool pays out
- **THEN** the hook goes down as the rope pays out and comes up when the spool winds

#### Scenario: Gravity off
- **WHEN** gravity is off and a lift's middle stage is lowered
- **THEN** the carriage stays where it was, the ropes go slack, and the Play panel says to turn on gravity

### Requirement: Ropes redrawn as parts move
In Play mode, each rope with a route SHALL be redrawn every frame from its route, the current poses of its ends' and spots' parts, and the turns on its spool. A tight rope SHALL be drawn straight between its spots; a slack rope SHALL be drawn sagging by its slack. End tabs SHALL stay on their posts and turn to face along the rope. Leaving Play mode SHALL put every rope back as it was in the build.

#### Scenario: Rope follows the arm
- **WHEN** Swish's arm swings in Play mode
- **THEN** the rope stays on the spool and on the arm's shaft all the way, with no gap at either end

#### Scenario: Leave Play
- **WHEN** the user leaves Play mode after winding five turns onto a spool
- **THEN** the rope and its coils are as they were before Play, and the build has no new history step

### Requirement: Free-turning hardware holds still
In Play mode, a moving part made only of hardware (a free axle, a rubber collar, a spacer, a washer, a standoff or a pin) whose turning nothing uses (no gear, sprocket, pulley, wheel, chain, rope, band, ratchet or motor on it) SHALL be held to the part it hangs on, the one that holds still if there is one, else the biggest. An axle a part pivots on SHALL stay a pivot: only one of its joints is held. Nothing else in the build SHALL move differently because of it.

#### Scenario: Collars and standoffs at rest
- **WHEN** a build with a rubber collar on a free axle, an arm pivoting on a free axle, and standoffs pinned to the arm enters Play mode and nothing is driven
- **THEN** after 3 s none of them turns more than 1° in a second, and the arm still swings on its axle when pushed

#### Scenario: Swish still fires
- **WHEN** Hero Bot Swish winds, holds and fires as in "Swish winds, holds and fires", with its free hardware held
- **THEN** it fires as before, and its collars, standoffs and pivot axles don't spin
