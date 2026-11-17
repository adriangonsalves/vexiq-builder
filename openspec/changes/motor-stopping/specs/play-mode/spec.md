## MODIFIED Requirements

### Requirement: Motor throttles
The Play panel SHALL list every Smart Motor with a throttle that runs from full reverse through stop to full forward. A throttle's position SHALL set the motor's target speed, up to 120 rpm either way, with torque limited to the Smart Motor's stall torque. While running, a motor SHALL also brake a load that drives its shaft faster than the target speed, up to its stall torque, so a load running ahead of it (a weight being lowered) SHALL NOT drive it past its top speed. Releasing or centring a throttle SHALL stop that motor unless that motor's Keep option is enabled. Selecting a motor's row SHALL highlight that motor in the view. Each motor SHALL have an independent Keep checkbox so the user can keep individual motor throttles at their set values.

Each Smart Motor SHALL have a stopping mode, saved with the motor in the build, that sets what it does when its throttle is at stop:
- **Coast**: the shaft SHALL turn freely, slowed only a little by the motor's own gears (far less than Brake).
- **Brake** (the default for a motor with no mode set): the shaft SHALL be resisted in proportion to how fast it is turned, up to the stall torque at the motor's top speed and nothing when it is still, so a steady load turns it slowly.
- **Hold**: the motor SHALL drive the shaft back to the angle where it stopped, up to its stall torque, so a load below the stall torque SHALL NOT turn it; a load above the stall torque SHALL turn it.

Each motor's row in the Play panel SHALL show its stopping mode and let the user change it by tap or click; the change SHALL be saved with the build and undo like other edits. The stopping mode SHALL be settable and reported over MCP.

#### Scenario: Half throttle reverse
- **WHEN** the user drags a motor's throttle halfway toward reverse
- **THEN** its shaft turns backward at about 60 rpm, if nothing blocks it

#### Scenario: Per-motor Hold checkbox
- **WHEN** the user checks Keep (formerly labelled Hold) on a motor's row and releases its throttle slider
- **THEN** that motor keeps running at the chosen speed while other motors without Keep spring back to stop

#### Scenario: A lowering load can't overspeed the motor
- **WHEN** gravity is on and a motor runs in reverse to lower a weight hanging from its spool
- **THEN** the shaft turns at no more than its top speed

#### Scenario: Coast lets the load go
- **WHEN** a winch motor set to Coast has wound its rope to pull an arm over against a band or belt, and its throttle is released
- **THEN** the band pulls the arm back, turning the spool backward

#### Scenario: Brake lets the load creep back
- **WHEN** the same winch's motor is set to Brake and its throttle is released
- **THEN** the arm creeps back, far slower than under Coast

#### Scenario: Hold keeps the load where it stopped
- **WHEN** the same winch's motor, or one that has lifted a weight on a rope, is set to Hold and its throttle is released
- **THEN** the arm or weight stays where it was, for as long as the throttle stays at stop

#### Scenario: A light load under Brake
- **WHEN** a motor set to Brake is released holding a load that pulls on its shaft with far less than its stall torque (a few grams on a spool)
- **THEN** the load moves so slowly it looks held

#### Scenario: Hold returns after a knock
- **WHEN** a motor set to Hold is stopped and something turns its shaft a little, then lets go
- **THEN** the shaft turns back to the angle where it stopped

#### Scenario: Hold gives way past stall torque
- **WHEN** a motor set to Hold is stopped and a load turns its shaft with more than its stall torque
- **THEN** the shaft turns

#### Scenario: Choosing a stopping mode
- **WHEN** the user taps a motor's stopping mode on its Play panel row and picks Hold
- **THEN** the motor holds from then on, the build saves Hold for that motor, and Undo puts the previous mode back

#### Scenario: Starters that hold
- **WHEN** the user opens the Rope lift or Rope winch starter
- **THEN** its motor's stopping mode is Hold

#### Scenario: Stopping mode over MCP
- **WHEN** a client calls update_part on a Smart Motor with a stopping mode of coast, brake or hold
- **THEN** the motor's mode is saved, get_assembly reports it, and any other value, or the mode on a part that isn't a Smart Motor, is refused with a message

### Requirement: Collisions block motion and stall motors
Solid parts in different bodies SHALL NOT pass through each other. When a collision stops a driven body, everything linked to it (shaft group, meshed gears, chained sprockets, the motor) SHALL stop too. When a moving linkage impacts a hard stop, it SHALL display an inertia-scaled elastic wobble that naturally damps according to the moving assembly's mass rather than stopping abruptly. A motor commanded to turn that has stayed below a small fraction of its target speed for a short time SHALL be shown as stalled on its throttle row and on the motor in the view, and SHALL clear when it turns again. Parts whose outlines already overlap on entry (a tight fit, a shaft in a hole) SHALL NOT count as blocking; parts that merely touch SHALL.

A motor stopped by pressing into something SHALL be freed by running it the other way or by releasing its throttle (it then stops by its stopping mode). Running back out of a press, the motor SHALL NOT be stopped again by the brief knock of starting back, while what it pressed on is still in contact; only pressing deeper than it did while stopped, for a moment, SHALL stop it again.

#### Scenario: Arm hits the frame
- **WHEN** a motor raises an arm until the arm presses on the chassis
- **THEN** the arm stops with an elastic wobble, the motor's row and the motor are marked stalled, and reversing the throttle moves the arm back and clears the mark

#### Scenario: Linkage beams meet
- **WHEN** a motor raises an arm whose upper and lower beams come together before it reaches anything else
- **THEN** the motor stops as soon as the beams press into each other, shows as stalled, and the arm does not swing on through them

#### Scenario: Wound right up, then reversed
- **WHEN** a winch has wound its rope until the load is pulled against the spool and the motor stalls, and the throttle is then reversed (with or without a stop in between)
- **THEN** the motor turns back and pays the rope out, and is not marked stalled

#### Scenario: Claw closes after opening
- **WHEN** a claw motor opens the claw until it stalls at its stops, then runs the other way
- **THEN** the claw closes until its tips meet and the motor stalls there
