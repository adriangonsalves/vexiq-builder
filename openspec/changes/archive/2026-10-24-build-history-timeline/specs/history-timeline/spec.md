## Purpose

Shows a build's history as a timeline the user can turn on, scrub and play, so they can watch how a robot was put together, whether by hand or over MCP, and jump back to any point.

## ADDED Requirements

### Requirement: Showing and hiding the timeline
A History button in the toolbar SHALL show or hide a timeline along the bottom of the 3D view. The timeline SHALL be hidden by default, and whether it is shown SHALL be remembered across reloads in this browser. Hiding the timeline SHALL return the view to the current step.

#### Scenario: Turn it on
- **WHEN** the user clicks History
- **THEN** the timeline appears below the 3D view and the button shows as active

### Requirement: What the timeline shows
The timeline SHALL show one mark per step along the current line, from the first step to the last, in order. The current step SHALL be highlighted. Steps from MCP SHALL look different from steps made in the app, steps from in-page assistants, and steps from smart actions. Where another branch splits off, the timeline SHALL show a branch marker. Hovering a mark SHALL show its label, time, source and part counts. The timeline SHALL show the step number and total (for example "Step 37 of 120"). With thousands of steps the marks SHALL still fit the width, and the timeline SHALL stay responsive.

#### Scenario: Build made over MCP
- **WHEN** the history has 3 steps from the user and 2 from MCP
- **THEN** the timeline shows 5 marks, and the 2 MCP marks are marked as MCP

#### Scenario: Hover
- **WHEN** the user hovers a mark
- **THEN** a tip shows, for example, "place_parts: 72 parts · MCP · 10:42"

### Requirement: Scrubbing to a past point
Dragging the timeline handle, or clicking a mark, SHALL show the build as it was after that step. Stopping on a step SHALL make it the current step, as if undo or redo had been pressed that many times. The camera SHALL stay where it is while scrubbing.

#### Scenario: Scrub back
- **WHEN** the user drags the handle from step 40 back to step 10
- **THEN** the view shows the build after step 10, and redo would go to step 11

### Requirement: Part-by-part playback inside a step
A step that adds, removes or changes more than one part SHALL have one position on the timeline for each part, between its own mark and the previous one, so scrubbing through it shows the parts one at a time in the order the step lists them. While the handle is inside a step, the view SHALL be a read-only preview: parts can't be selected, moved or changed, and a banner SHALL say so and offer to go to the step's end. Releasing the handle inside a step SHALL keep the preview until the user moves to a step's start or end.

#### Scenario: Watch a place_parts call
- **WHEN** the user scrubs through the step for a `place_parts` call that placed 72 parts
- **THEN** the parts appear one at a time in the order they were listed in the call

#### Scenario: Trying to edit in the middle of a step
- **WHEN** the handle is halfway through a 72-part step and the user tries to drag a part
- **THEN** nothing moves, and the banner offers to go to the step's end

### Requirement: Play
A Play button SHALL replay the build from the start of the current line to its last step, moving through every step and every part inside multi-part steps at an even pace, with a speed choice (for example 1×, 2×, 4×). Pause SHALL stop on the position reached. Playing SHALL leave the current step at the last step when it finishes. Any edit, undo or redo SHALL stop playback.

#### Scenario: Replay a build
- **WHEN** the user presses Play on a build of 120 steps
- **THEN** the view shows the robot being built from empty, step by step, and ends on the finished build

### Requirement: Editing after scrubbing back
When the current step is not the last one and the user changes the build, the change SHALL start a new branch from the current step (see build-history), and the timeline SHALL switch to that new branch. The steps after the current step SHALL stay available through the branch marker.

#### Scenario: Fix an early mistake
- **WHEN** the user scrubs back to step 10 and moves a part
- **THEN** the timeline now ends at a new step 11, and a branch marker at step 10 leads to the old steps 11 onward

### Requirement: Switching branches
Clicking a branch marker SHALL list the branches that split off at that step, with each branch's first label, length and time. Choosing one SHALL make it the current line and move to its last step.

#### Scenario: Go back to the other version
- **WHEN** the user clicks the branch marker at step 10 and picks the older branch
- **THEN** the timeline shows that branch and the build is as it was at the end of it
