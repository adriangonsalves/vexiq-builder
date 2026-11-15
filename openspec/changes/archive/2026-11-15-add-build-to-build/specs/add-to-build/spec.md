## Purpose

Lets students bring separately made builds together: a starter, a saved build or a build file can be added into the open build as one new group, so each student can work on a sub-assembly and join them later.

## ADDED Requirements

### Requirement: Open or add question
When the user opens a starter, a saved build from the library, or a build file from the computer, and the open build has at least one part, the app SHALL ask before doing anything. The question SHALL name the build being opened and offer exactly two choices and a way to cancel:
- **Open by itself**: the open build stays saved and the chosen build is shown, as before this change;
- **Add to this build**: the chosen build is added into the open build (see "Adding a build as a group").

Cancel, Esc, or tapping outside SHALL close the question and change nothing. When the open build has no parts, the app SHALL NOT ask and SHALL open the chosen build by itself. The two choices SHALL be large buttons that work by mouse, keyboard and touch, and the question SHALL fit on a phone screen.

#### Scenario: Starter with parts on screen
- **WHEN** the open build has parts and the user picks File → Starter → Clawbot
- **THEN** a question "Open Clawbot" is shown with the buttons "Open by itself" and "Add to this build", and nothing has changed yet

#### Scenario: Empty build
- **WHEN** the open build has no parts and the user picks File → Starter → Clawbot
- **THEN** no question is shown and a new build "Clawbot" opens

#### Scenario: Cancel
- **WHEN** the question is shown and the user presses Esc
- **THEN** the question closes and the open build is unchanged

#### Scenario: Open by itself
- **WHEN** the user opens "Build #1" from the library with "Build #2" open and picks "Open by itself"
- **THEN** "Build #1" is shown, and "Build #2" with its parts is still in the library

### Requirement: Adding a build as a group
"Add to this build" SHALL put a copy of every part of the chosen build into the open build as one new group. The group SHALL be named after the chosen build (the starter's name, the saved build's name, or the file's name without `.vexiq.json`), with a number added when a group of that name already exists ("Claw", "Claw 2"). The added parts SHALL keep their places relative to one another, their colours, shapes, hidden states, and any chains, tracks, rubber bands and belts strung on them. Groups inside the chosen build SHALL become part of the one new group. Locked parts SHALL come in unlocked, so the group can be moved into place. The parts already in the open build SHALL NOT move or change.

The new group SHALL be set down as one piece beside the parts already in the build, with at least one pitch of space, on the half-pitch grid and at the height it was built, so that it overlaps nothing. It SHALL be selected and the view SHALL be framed to show the whole build. The open build SHALL keep its name, and the library dialog SHALL close.

Adding SHALL be one history step labeled "Add <name>", so one undo removes every added part. The chosen build's own history SHALL NOT be brought in. The build the parts came from SHALL NOT be changed, and no new build SHALL be added to the library.

#### Scenario: Add a starter
- **WHEN** the open build "Drive base" has 40 parts and the user picks File → Starter → Sample starter → "Add to this build"
- **THEN** the build is still "Drive base", its 40 parts are where they were, a group "Sample starter" with the starter's parts sits beside them touching none of them, and the group is selected

#### Scenario: Add a teammate's file
- **WHEN** the user picks Load… → Open from computer…, chooses `claw.vexiq.json` and picks "Add to this build"
- **THEN** a group "claw" with the file's parts is added to the open build, and no build named "claw" appears in the library

#### Scenario: Add a saved build
- **WHEN** the user clicks Open on "Arm" in the library and picks "Add to this build"
- **THEN** a group "Arm" is added to the open build, the dialog closes, and the library's "Arm" is unchanged

#### Scenario: One undo
- **WHEN** the user adds "Clawbot" to the open build and presses undo once
- **THEN** every added part is gone and the build is as it was before

#### Scenario: Same build added twice
- **WHEN** the user adds the starter "Sample starter" twice
- **THEN** the build has the groups "Sample starter" and "Sample starter 2", neither overlapping the other, and no two parts share a label

#### Scenario: Locked parts come in unlocked
- **WHEN** the user adds a file in which one part is locked
- **THEN** every added part is unlocked and the new group can be moved

#### Scenario: Build with groups and bands
- **WHEN** the user adds a build that has two groups and a rubber band strung between two of its parts
- **THEN** all its parts are in one new group and the band is still strung on the added copies of those two parts

### Requirement: A build that can't be added
When the chosen build can't be read, or has no parts, "Add to this build" SHALL show a short message and change nothing.

#### Scenario: Empty build chosen
- **WHEN** the user opens an empty saved build and picks "Add to this build"
- **THEN** a message says there is nothing to add and the open build is unchanged
