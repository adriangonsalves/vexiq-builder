## MODIFIED Requirements

### Requirement: Shift+click in the 3D view
In the 3D view, a click with Shift held on a part SHALL add it to the selection, or remove it if it is already selected; a Shift+click on empty space SHALL leave the selection as it is. A plain click SHALL keep its current behavior: it replaces the selection with the clicked part, and a click on empty space clears the selection. A single Ctrl+click (Cmd+click on macOS, where Ctrl+click is a right-click) on a part SHALL add or remove just that part, never its whole group, as Shift+Alt+click does; a Ctrl/Cmd+click on empty space SHALL leave the selection as it is. Ctrl/Cmd+click SHALL NOT be used for selecting in any other way. A Ctrl/Cmd+double-click SHALL keep inserting a copy as before, and its first click SHALL NOT change the selection; the selection change of a single Ctrl/Cmd+click SHALL therefore wait until a double-click can no longer follow.

#### Scenario: Add with Shift
- **WHEN** a beam is selected and the user Shift+clicks a pin
- **THEN** the beam and the pin are both selected

#### Scenario: Remove with Shift
- **WHEN** a beam and a pin are selected and the user Shift+clicks the pin
- **THEN** only the beam stays selected

#### Scenario: Plain click replaces
- **WHEN** three parts are selected and the user clicks a fourth without Shift
- **THEN** only the fourth part is selected

#### Scenario: Ctrl/Cmd+click adds one part of a group
- **WHEN** the right drive motor is selected and the user Cmd+clicks the left drive motor, which is in the group "Left Drive"
- **THEN** the two motors are selected and no other part of "Left Drive" is

#### Scenario: Ctrl/Cmd+click removes one part
- **WHEN** the whole group "Claw" is selected and the user Ctrl+clicks one of its beams
- **THEN** every part of "Claw" but that beam stays selected

#### Scenario: Ctrl/Cmd+double-click still copies
- **WHEN** a pin is selected and the user holds Cmd and double-clicks a lit free hole on a beam
- **THEN** a copy of the pin goes in the hole, and the beam is not added to the selection

### Requirement: Selecting in the Outliner
In the Assembly Outliner, a plain click on a row SHALL select only that row's part or group. Ctrl+click, or Cmd+click on macOS, SHALL add or remove that row. While Select mode is on, every row SHALL have a checkbox, and a plain click on a row or its checkbox SHALL add or remove its part (a folder's: its whole group, shown mixed when only some of its parts are selected) without changing the rest of the selection; with Select mode off the checkboxes SHALL NOT be shown. Shift+click SHALL add every row between the primary part's row and the clicked row, in the order the list shows: a group folder in the range brings in its whole group, and a part's row inside an open folder counts as its folder, so Shift+click selects several groups. Shift+Alt+click SHALL instead add every single part between the primary part and the clicked part, inside one group or across groups (a closed folder's parts counting where the folder is). Clicking a part's row inside a group folder SHALL select just that part, not the whole group.

Selecting SHALL NOT move rows: every part stays in its place in the list (group folders first, then loose parts, otherwise in build order), highlighted when selected; a folder with only some of its parts selected SHALL say how many. While anything is selected, a "Selected (N)" box above the list SHALL list the selection again (a wholly selected group as its folder, a selected part of a partly selected group as its own row naming the group). The box SHALL open and close from its heading, and the choice SHALL be remembered in this browser. A plain click on a row in the box SHALL make it the primary part without changing the selection and scroll the list to it; Ctrl/Cmd+click or the row's X SHALL unselect it. The box heading SHALL have actions for the whole selection, each one history step: hide/show, lock/unlock, colour (the part colours plus a custom colour), clone, delete, and Clear.

Under the search box the Outliner SHALL show filter chips, each turned on and off by tap or click: **Electronics** (Smart Motors, robot brains, batteries, sensors, the radio, the controller and cables; not motor shafts or motor support caps), **Locked**, **Hidden**, and **Colour**, which opens a menu of the colours the build's parts use and filters to the one picked. With one or more chips on, the list SHALL show only the parts that match every chip on and the search text: a folder SHALL stay when any of its parts match, and while open SHALL list only those parts; the title count SHALL read "matching / all" as it does for a search. A chip that is on SHALL look on, and a Colour chip that is on SHALL show its colour. Filters SHALL change only the list, never the build or the selection, and SHALL NOT be saved with the build. While a search or a filter is on, a **Select shown** button SHALL replace the selection with every part the list shows, each as a single part (not whole groups unless all their parts are shown); with nothing shown it SHALL be unavailable. On a phone the chips SHALL fit in one row that scrolls sideways.

#### Scenario: Checkbox adds and removes
- **WHEN** Select mode is on, a beam is selected, and the user ticks a plate's checkbox, then unticks the beam's
- **THEN** the plate is added while the beam stays selected, and then only the plate is selected

#### Scenario: Selected parts stay in place
- **WHEN** the user selects two parts far down the list
- **THEN** both rows stay where they were, highlighted, and the "Selected (2)" box above the list names them

#### Scenario: Colour several parts
- **WHEN** three parts are selected and the user picks red in the Selected box's colour menu
- **THEN** all three turn red in one history step

#### Scenario: Close the Selected box
- **WHEN** the user closes the Selected box and reloads
- **THEN** the box shows only its heading and actions until opened again

#### Scenario: Ctrl/Cmd+click a row
- **WHEN** one row is selected and the user Cmd+clicks another row
- **THEN** both rows are selected

#### Scenario: Range
- **WHEN** row 3 is selected and the user Shift+clicks row 7
- **THEN** rows 3 to 7 are selected

#### Scenario: Range of groups
- **WHEN** group folder G1 is selected and the user Shift+clicks folder G3, with G2 between them
- **THEN** every part of G1, G2 and G3 is selected

#### Scenario: Range of single parts across groups
- **WHEN** G1 and G2 are open, the last part of G1 is selected, and the user Shift+Alt+clicks the first part of G2
- **THEN** just those two parts are selected, not the rest of either group

#### Scenario: Electronics filter finds the motors
- **WHEN** the Simple drivetrain is open and the user turns on Electronics
- **THEN** the list shows the two Smart Motors (in their folder) and no pins or motor shafts, and the title reads "2 / 84"

#### Scenario: Search and filter together
- **WHEN** the build has a brain and two motors labelled "Left Motor" and "Right Motor", pins labelled "Left Motor Pin hole_6", and the user types "left" with Electronics on
- **THEN** only "Left Motor" is listed

#### Scenario: Hidden filter and Select shown
- **WHEN** five parts are hidden, the user turns on Hidden and presses Select shown
- **THEN** those five parts are selected, and turning Hidden off leaves them selected

#### Scenario: Colour filter
- **WHEN** the build has red, blue and grey parts and the user picks red from the Colour chip
- **THEN** only the red parts are listed and the chip shows red

#### Scenario: Filters aren't saved
- **WHEN** the user turns on Locked and reloads the page
- **THEN** no filter is on
