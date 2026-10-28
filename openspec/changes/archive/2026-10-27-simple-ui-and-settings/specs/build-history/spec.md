## MODIFIED Requirements

### Requirement: Branches are kept
The History setting (see app-settings) SHALL decide what happens when the user undoes one or more steps and then makes a new change:
- **Linear** (the default): the undone steps SHALL be dropped from the history and the new change becomes the next step. Undo and redo work as before as long as no change is made after undoing.
- **Keep branches** (shown with advanced options on): the undone steps SHALL stay in the history as a branch, and the new change SHALL start a new branch from that point. Redo SHALL follow the branch that was most recently used. The user SHALL be able to switch to any branch and continue from it. No step SHALL ever be deleted by undo, redo, scrubbing or branching.

The setting SHALL apply to every writer: the app, the assistant's MCP tools and the app's bridge. Branches already in a history, from before or from a time branches were kept, SHALL stay and can still be switched to in either mode.

#### Scenario: Edit after undo (linear)
- **WHEN** the History setting is Linear and the user adds parts A, B and C, undoes twice, then adds part D
- **THEN** the build has A and D, redo is unavailable, and B and C are no longer in the history

#### Scenario: Edit after undo
- **WHEN** the History setting is Keep branches and the user adds parts A, B and C, undoes twice, then adds part D
- **THEN** the build has A and D, and the history still holds the branch with B and C, which the user can switch to and get A, B and C back

#### Scenario: Undo and redo without changes
- **WHEN** the History setting is Linear and the user undoes three steps and redoes two
- **THEN** the build is as it was one step before the end, and one more redo brings back the last step
