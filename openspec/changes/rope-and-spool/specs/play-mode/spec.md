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
- a drum wound in Play past the turns it holds SHALL keep winding, drawn full to the flange, and Play mode SHALL list "… is over full".

The turns on the spool SHALL be shown as coils on the drum, updated as it winds. Leaving Play mode SHALL put the turns back as they were in the build.

#### Scenario: Winding pulls the arm
- **WHEN** a motor turns a spool whose rope runs to a hinged arm held up by rubber bands
- **THEN** the coils on the drum grow and the arm is pulled toward the spool, stretching the bands

#### Scenario: Motor stops with no ratchet
- **WHEN** the motor of that winch is released (its throttle not kept) and nothing else holds the spool
- **THEN** the arm does what the motor's stopping mode allows (openspec motor-stopping): with Hold it stays where it is; with Brake the bands pull it back slowly as the rope pays out; with Coast they pull it back quickly
- **AND WHEN** the motor then runs in reverse
- **THEN** the bands pull the arm back and the spool turns backward as the rope pays out

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
