## MODIFIED Requirements

### Requirement: Editing after scrubbing back
When the current step is not the last one and the user changes the build, the History setting SHALL apply (see build-history):
- **Linear:** the steps after the current step SHALL be dropped, and the timeline SHALL end at the new step.
- **Keep branches:** the change SHALL start a new branch from the current step, and the timeline SHALL switch to that new branch. The steps after the current step SHALL stay available through the branch marker.

#### Scenario: Fix an early mistake (linear)
- **WHEN** the History setting is Linear and the user scrubs back to step 10 and moves a part
- **THEN** the timeline now ends at a new step 11, and the old steps 11 onward are gone

#### Scenario: Fix an early mistake
- **WHEN** the History setting is Keep branches and the user scrubs back to step 10 and moves a part
- **THEN** the timeline now ends at a new step 11, and a branch marker at step 10 leads to the old steps 11 onward
