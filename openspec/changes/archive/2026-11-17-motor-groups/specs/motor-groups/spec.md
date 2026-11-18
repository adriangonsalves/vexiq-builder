## Purpose

Lets the user put Smart Motors together in a named motor group, each motor turning the same way as the group or the opposite way, so that in Play mode the group is driven by one control, as a VEXcode motor group is.

## ADDED Requirements

### Requirement: Make and break up a motor group
Group motors, from the Select menu and from the Outliner's Selected box, SHALL make the Smart Motors in the selection into a new motor group when the selection holds two or more Smart Motors; other selected parts SHALL be ignored. It SHALL be unavailable, and shown as unavailable, with fewer than two Smart Motors selected. The group SHALL be named "Motor group N", using the smallest N no motor group uses. A motor SHALL be in at most one motor group: motors already in another motor group SHALL move into the new one, and a motor group left with fewer than two motors SHALL be broken up. Motor groups SHALL be separate from part groups: making, changing or breaking up a motor group SHALL NOT change any part group, and grouping or ungrouping parts SHALL NOT change any motor group. Each motor's row in a motor group SHALL have a button to take it out of the group, and the group SHALL have a button to break it up. No part SHALL move. Each of these SHALL be one history step and SHALL work by tap as well as click.

#### Scenario: Group the drive motors
- **WHEN** the user selects the part groups "Left Drive" and "Right Drive", each holding one Smart Motor, and picks Group motors
- **THEN** a motor group "Motor group 1" holds the two motors, and "Left Drive" and "Right Drive" are unchanged

#### Scenario: Not enough motors
- **WHEN** the selection holds one Smart Motor and some beams
- **THEN** Group motors is shown as unavailable

#### Scenario: Taking out the second-last motor
- **WHEN** a motor group holds two motors and the user takes one out
- **THEN** the motor group is gone, and one undo brings it back with both motors

#### Scenario: Moving a motor to a new group
- **WHEN** one motor of the three-motor group "Lift" is selected with another motor, and the user picks Group motors
- **THEN** the new group holds those two motors and "Lift" keeps its other two

### Requirement: Each motor's direction
Each motor in a motor group SHALL turn either the **same** way as the group or the **opposite** way. When a motor group is made, the first motor in build order SHALL be same, and every other motor SHALL be opposite when its drive shaft points the opposite way to the first motor's and same otherwise. The user SHALL be able to flip any motor between same and opposite by tap or click, as one history step. A motor that leaves a group SHALL lose its direction.

#### Scenario: A mirrored drive starts right
- **WHEN** the user groups a left drive motor and the right drive motor mirrored from it
- **THEN** the left motor is same and the right motor is opposite, and in Play mode pushing the group's throttle forward drives the robot straight ahead

#### Scenario: Flipping a motor
- **WHEN** the user taps the right motor's direction button in the group
- **THEN** it reads Same, and one undo makes it Opposite again

### Requirement: Motor groups in the Outliner
The Assembly Outliner SHALL show a "Motor groups" section above the parts list when the build has any motor group, with one folder row per motor group, in the order of each group's first motor. A folder row SHALL show an open/close arrow, the group's name, its motor count and a break-up button; opened, it SHALL list its motors indented, each with its direction button (Same or Opposite) and a take-out button. Clicking or tapping a folder row SHALL select every motor in the group (only the motors, not the rest of any part groups they are in); clicking a motor's row SHALL select that motor. The group's name SHALL be renamable from its folder row, by tap as well as click, as one history step; an empty name SHALL be refused and the old name kept. Motors in a motor group SHALL still be listed in their usual place in the parts list as well. Folders SHALL start closed, and their open state SHALL NOT be saved with the build.

#### Scenario: Open the drive group
- **WHEN** the user opens the folder "Drive" in the Motor groups section
- **THEN** its two motors are listed under it, one reading Same and one Opposite

#### Scenario: Rename
- **WHEN** the user renames "Motor group 1" to "Drive"
- **THEN** the folder and the Play panel row show "Drive"

### Requirement: A motor group is one control in Play mode
In the Play panel, each motor group SHALL show as one row, named after the group, with one throttle, one Keep checkbox and one stopping mode; the motors in a motor group SHALL NOT get rows of their own, and motors in no motor group SHALL keep their own rows. Moving the group's throttle SHALL give every same motor that throttle and every opposite motor the reversed throttle, together. Letting go, Keep, and the double-click to stop SHALL act on the whole group as on a single motor's row. Choosing the group's stopping mode SHALL set it on every motor in the group, as one history step; when its motors' modes differ, no mode SHALL show as chosen until one is picked. The row SHALL show Stalled when any of its motors is stalled, and otherwise the speed of its fastest motor. Hovering or selecting the row SHALL light up every motor in the group in the view. The row SHALL open, by tap as well as click, to list its motors with their direction buttons, and flipping one there SHALL take effect at once and be saved with the build as one history step, as the stopping mode is. The rest of the build SHALL stay read-only in Play mode.

#### Scenario: Driving straight with one throttle
- **WHEN** the build has the motor group "Drive" (left motor same, right motor opposite) and the user pushes its throttle to full forward
- **THEN** both motors turn at about 120 rpm, in opposite directions about their own shafts, and the robot moves straight

#### Scenario: One stalled motor
- **WHEN** one motor of "Drive" is blocked and stalls while the other turns
- **THEN** the "Drive" row shows Stalled

#### Scenario: Ungrouped motors keep their own rows
- **WHEN** the build has "Drive" with two motors and a third motor on an arm in no motor group
- **THEN** the Play panel shows two rows: "Drive" and the arm motor

#### Scenario: Fixing a spinning robot while playing
- **WHEN** the robot spins in place under the "Drive" throttle and the user opens the row and flips one motor's direction
- **THEN** the robot drives straight from then on, and the change is still there after leaving Play mode

### Requirement: Motor groups are saved and shared
A motor's motor group and direction SHALL be saved with the build, in the build file, the build library and the history, and SHALL be kept when the build is sent to or changed by the MCP server. Deleting a motor SHALL take it out of its motor group (breaking up a group left with fewer than two motors). A copy of a motor, made by Clone, copy and paste or mirroring, SHALL be in no motor group. Builds saved before motor groups existed SHALL load with no motor groups. The assistant's view of the assembly (`get_assembly`) SHALL list each motor's motor group id, name and direction. An MCP tool SHALL make a motor group from given motors (with an optional name and the motors to set opposite), set a motor's direction, rename a group, take motors out and break a group up, each as one history step, refusing parts that aren't Smart Motors with a message.

#### Scenario: Reload keeps the group
- **WHEN** the user makes the motor group "Drive" and reloads the page
- **THEN** "Drive" is in the Motor groups section with the same motors and directions

#### Scenario: Making a group over MCP
- **WHEN** a client asks the motor group tool to group two Smart Motors named "Drive" with the second set opposite
- **THEN** the group appears in the app's outline, `get_assembly` reports both motors in "Drive" with their directions, and one undo removes it

#### Scenario: Not a motor
- **WHEN** a client asks the motor group tool to group a Smart Motor and a beam
- **THEN** the call is refused with a message naming the beam, and nothing changes
