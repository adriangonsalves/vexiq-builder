## MODIFIED Requirements

### Requirement: File menu
The toolbar SHALL have a File drop-down in place of the Starter, Save and Load buttons, with:
- **New**;
- **Starter ▸**, a submenu listing every starter build by name, under two headings: **Robots** for whole robots and **Assemblies** for pieces of a robot;
- **Load…**;
- **Export**;
- **Delete this build…**: asks first ("Delete <name>? This can't be undone."), then deletes the current build from the browser's storage as Delete in the library does.

Starters SHALL be defined as a list of named part layouts, each marked as a robot or an assembly, so more can be added without changing the menu. A heading with no starters under it SHALL NOT be shown. The menu SHALL open and close like the other toolbar drop-downs, and the headings SHALL NOT be choosable.

#### Scenario: File menu contents
- **WHEN** the user opens the File menu
- **THEN** it shows New, Starter ▸, Load…, Export and Delete this build…, and hovering or clicking Starter shows "Sample starter"

#### Scenario: Starter sections
- **WHEN** the user opens File → Starter
- **THEN** the heading "Robots" is followed by Speedbot 2.0, BaseBot, Clawbot and Flop, and the heading "Assemblies" is followed by Sample starter, Ratchet winch, Simple drivetrain, Simple arm and Simple claw

#### Scenario: Delete the open build from the File menu
- **WHEN** the user picks File → Delete this build… on "Build #2" and confirms
- **THEN** "Build #2" is removed from the browser's storage, and the most recently changed other build is shown (or a new empty build if none is left)

#### Scenario: Cancel a delete
- **WHEN** the user picks File → Delete this build… and cancels
- **THEN** nothing changes

## ADDED Requirements

### Requirement: Clawbot assemblies
The Assemblies section SHALL offer three pieces taken from the Clawbot starter, each made of the Clawbot's own parts with the same names, colours and places relative to one another, and each held in one group named after it:
- **Simple drivetrain**: both sides of the chassis with their beams, blocks, bearings and pins; both drive motors with their pins; the wheels, tires, hubs, axles, washers, lock beams and collars; and the front and rear crossbeams with their pins.
- **Simple arm**: the tower uprights, spacers, braces and their pins; the arm motor and its pins; the arm shafts and shaft stops; the 12 and 36 tooth gears and the gear pin; the arm beams; and the arm standoffs.
- **Simple claw**: the arm-tip corners and wrist pins; the wrist plate, wrist centre connector, wrist corners and their pins; the claw base plate, beams, standoffs and pins; the claw motor and its pins; the claw shafts and spacers; the crank arms, jaw beams and tips; and the traction links.

The Robot Brain and its connectors and pins SHALL be in none of them. Every other Clawbot part SHALL be in exactly one of the three. Each assembly SHALL rest on the floor where it opens. Like every starter, each SHALL open as a new build or be added to the open build (see add-to-build).

#### Scenario: Open the drivetrain
- **WHEN** the user picks File → Starter → Simple drivetrain with an empty build open
- **THEN** a new build "Simple drivetrain" shows the chassis with its four wheels and two drive motors, as one group, with no Robot Brain

#### Scenario: Pieces cover the Clawbot
- **WHEN** the parts of Simple drivetrain, Simple arm and Simple claw are put together with the Robot Brain and its connectors and pins
- **THEN** they are exactly the Clawbot's parts, each once

#### Scenario: Build a Clawbot from the pieces
- **WHEN** the user opens Simple drivetrain, then adds Simple arm and Simple claw to it
- **THEN** the build has three groups, "Simple drivetrain", "Simple arm" and "Simple claw", none overlapping, ready to move into place
