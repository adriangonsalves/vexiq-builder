## MODIFIED Requirements

### Requirement: Selecting a group
A plain click, Shift+click or Select-mode click on any part of a group in the 3D view SHALL select or deselect the whole group, all its parts together; Shift+Alt+click, and a single Ctrl+click (Cmd+click on macOS), SHALL add or remove just the clicked part. Clicking a folder row in the Outliner SHALL select the whole group. Clicking a part's row inside an open folder SHALL select just that part, which can then be edited on its own with every single-part tool. Select Connected SHALL select whole groups when any of their parts is reached.

#### Scenario: Click a grouped part
- **WHEN** the user clicks a wheel that belongs to "Left Drive"
- **THEN** every part of "Left Drive" is highlighted and the Inspector shows the group

#### Scenario: Edit one part inside
- **WHEN** the user opens "Left Drive" and clicks the row "Rubber Shaft Collar #2"
- **THEN** only that collar is selected and can be moved on its own

#### Scenario: Ctrl/Cmd+click one grouped part
- **WHEN** nothing is selected and the user Cmd+clicks the motor that belongs to "Left Drive"
- **THEN** only that motor is selected, and no other part of "Left Drive" is highlighted
