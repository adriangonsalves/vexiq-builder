## Purpose

How the Assembly Outliner on the right helps the user find parts in a build and tell which catalog part each one is, even after it has been given its own label.

## ADDED Requirements

### Requirement: Outliner search
The Assembly Outliner SHALL have a search box under its title. Typing in it SHALL show only the rows whose label, catalog part name or part number contains the typed text, ignoring case and spaces at either end. The title SHALL show the shown and total counts while a search is active (for example "Assembly Outliner (3 / 42)") and only the total otherwise. A clear button SHALL empty the box, and `Esc` while the box has focus SHALL do the same. When nothing matches, the list SHALL say that no parts match the search.

#### Scenario: Find by label
- **WHEN** the build has a part labelled "Left drive motor" and the user types "left drive"
- **THEN** only rows whose label, part name or part number contains "left drive" are shown, including that part

#### Scenario: Find by catalog name
- **WHEN** an MCP build labelled its four collars "Front-left collar", "Front-right collar", "Rear-left collar" and "Rear-right collar" and the user types "rubber shaft"
- **THEN** all four rows are shown, because their catalog part is the Rubber Shaft Collar

#### Scenario: Find by part number
- **WHEN** the user types "228-2560"
- **THEN** every VEX IQ Smart Motor in the build is shown

#### Scenario: No match
- **WHEN** the user types "zzz"
- **THEN** no rows are shown, the list says no parts match, and the title reads "(0 / N)" for a build of N parts

#### Scenario: Clear
- **WHEN** a search is active and the user clicks the clear button
- **THEN** every row is shown again and the title shows only the total

### Requirement: Search leaves the build alone
The search SHALL only change which rows are shown. It SHALL NOT change the selection, hide parts in the 3D view, or add history steps, and it SHALL NOT be saved with the build. A selected part that the search hides SHALL stay selected. The row buttons (show/hide, lock) SHALL work the same on rows shown by a search. **Clear All** SHALL still remove every part in the build, not only the shown rows. The list SHALL update as parts are added, removed or relabelled while a search is active, including changes from MCP, undo and redo.

#### Scenario: Selection kept
- **WHEN** a 1x6 Beam is selected and the user types "pin"
- **THEN** the beam's row is hidden, the beam stays selected in the 3D view and the Inspector still shows it

#### Scenario: New matching part appears
- **WHEN** the search is "collar" and an MCP client places a Rubber Shaft Collar
- **THEN** its row appears in the filtered list

### Requirement: Base name of the selected part
The selected part's Outliner row SHALL show a second, smaller line under its label with the catalog part name and part number (for example "Rubber Shaft Collar · 228-2500-143"). Rows that aren't selected SHALL keep a single line. The Part Inspector SHALL show the same catalog name and part number at the top of its body for the selected part, whether advanced options are on or off. When the part's catalog entry can't be found, both places SHALL say the part is unknown and show its part id.

#### Scenario: Custom label
- **WHEN** the user selects a part labelled "Left drive motor"
- **THEN** its row shows "Left drive motor" and under it "VEX IQ Smart Motor · 228-2560", and the Inspector shows "VEX IQ Smart Motor · 228-2560" at the top

#### Scenario: Default label
- **WHEN** the user selects "1x6 Beam #2"
- **THEN** its row also shows "1x6 Beam · 228-2500-005" under the label

#### Scenario: Selection moves
- **WHEN** the user selects another part
- **THEN** the second line moves to the newly selected row and the previous row goes back to one line
