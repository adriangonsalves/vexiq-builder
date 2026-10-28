## MODIFIED Requirements

### Requirement: Opening a file replaces the history
Opening a `.vexiq.json` file (File → Load… → Open from computer…) SHALL add it to the library as a new build with the file's parts and history, and make it the current build (see build-library). The build that was open SHALL stay in the library with its own history. The timeline SHALL show the opened build's history.

#### Scenario: Open another build
- **WHEN** the user has a build with history and opens a different file
- **THEN** the timeline shows the opened file's history, not the previous build's, and the previous build with its history is still in the library
