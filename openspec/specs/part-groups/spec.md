# part-groups Specification

## Purpose
Lets the user gather parts into a named component, such as a drive side or a claw, that shows as one folder in the Assembly Outliner and is selected, moved and turned as one piece.

## Requirements

### Requirement: Group and ungroup
Group, from the Select menu or the `G` key, SHALL make the selected parts into a new group when two or more parts are selected. The group SHALL get a name "Group N", using the next free number, and SHALL be selected. Parts that were already in another group SHALL move into the new group, and a group left with fewer than two parts SHALL be dissolved. Ungroup, from the Select menu or `Shift+G`, SHALL dissolve every selected group; its parts SHALL stay where they are and stay selected. Group SHALL be unavailable with fewer than two parts selected and Ungroup unavailable when no selected part is in a group, and the menu SHALL show that. A group SHALL hold parts only, not other groups. Grouping and ungrouping SHALL NOT move any part.

#### Scenario: Make a group
- **WHEN** the user selects a plate, a motor and three pins, and presses `G`
- **THEN** a folder "Group 1" with those five parts appears in the Outliner and the group is selected

#### Scenario: Ungroup
- **WHEN** the group "Group 1" is selected and the user picks Ungroup
- **THEN** the folder disappears, its five parts show as loose rows in their places, and all five stay selected

#### Scenario: Regroup a part
- **WHEN** one part of the three-part group "Claw" is selected with two loose parts, and the user groups them
- **THEN** a new group holds those three parts and "Claw" keeps its other two parts

### Requirement: Group folders in the Outliner
Each group SHALL show in the Assembly Outliner as one folder row, listed before the loose parts and among the folders in the order of their first parts (among the selected rows when the whole group is selected, see multi-select), with an open/close arrow, its name, its part count, and hide and lock buttons. Its parts SHALL be listed indented under it while it is open. Folders SHALL start closed, and their open or closed state SHALL be remembered while the page is open but SHALL NOT be saved with the build. The hide button on a folder SHALL hide or show every part in the group, and the lock button SHALL lock or unlock every part, each as one history step; when only some parts are hidden or locked, the button SHALL show a mixed state and a click SHALL make all of them hidden or locked. The Outliner title count SHALL keep counting parts, not folders.

#### Scenario: Open a folder
- **WHEN** the user clicks the arrow on the closed folder "Left Drive"
- **THEN** its 14 parts are listed under it, indented

#### Scenario: Hide a group
- **WHEN** the user clicks the hide button on "Left Drive"
- **THEN** all 14 parts are hidden, and one undo shows them again

### Requirement: Selecting a group
A plain click, Shift+click or Select-mode click on any part of a group in the 3D view SHALL select or deselect the whole group, all its parts together. Clicking a folder row in the Outliner SHALL select the whole group. Clicking a part's row inside an open folder SHALL select just that part, which can then be edited on its own with every single-part tool. Select Connected SHALL select whole groups when any of their parts is reached.

#### Scenario: Click a grouped part
- **WHEN** the user clicks a wheel that belongs to "Left Drive"
- **THEN** every part of "Left Drive" is highlighted and the Inspector shows the group

#### Scenario: Edit one part inside
- **WHEN** the user opens "Left Drive" and clicks the row "Rubber Shaft Collar #2"
- **THEN** only that collar is selected and can be moved on its own

### Requirement: A group moves and turns as one
When a group, or several loose parts, is selected, the Move arrows and the rotate rings SHALL be shown at the centre of the selected parts' combined bounding box, and dragging them SHALL move or turn every selected part together, keeping their places relative to one another. The snap settings SHALL apply to the move and turn of the whole set. The Inspector SHALL show the centre's position in mm and pitch, which can be typed and nudged with the nudge buttons, and the quick 90° turn buttons SHALL turn the set about that centre. Parts in the moving set SHALL NOT count as overlapping one another; if the set ends up overlapping a part outside it, the parts it overlaps SHALL be marked as overlapping, as for a single part. Hole snap, flush stopping at contact, the mate arrows, double-click mating and hole picking SHALL NOT act on a set of parts. A set with any locked or hidden part SHALL show no Move arrows or rings and SHALL say "Part is locked" or "Some parts are hidden" when the user tries to move it. Each drag, typed value or nudge run SHALL be one history step covering every part that moved, labeled with the group's name (for example "Move Left Drive") or the part count ("Move 5 parts").

#### Scenario: Drag a group
- **WHEN** "Left Drive" is selected and the user drags its X arrow 25.4 mm
- **THEN** all its parts move 25.4 mm along X, and one undo moves them all back

#### Scenario: Turn a group
- **WHEN** "Claw" is selected and the user clicks the quick 90° turn about Y
- **THEN** every part of "Claw" turns 90° about the vertical line through the group's centre, and pins stay in their holes

#### Scenario: Locked part in the group
- **WHEN** a group with one locked part is selected
- **THEN** no Move arrows are shown and trying to move it says "Part is locked"

### Requirement: Clone, delete and rename a group
Clone with a group selected SHALL copy every part of the group into a new group named "<name> copy", offset by one pitch, selected. Delete SHALL delete every part of the group. Selecting a group SHALL show its name in an editable field in the Inspector; changing it SHALL rename the group. Each of these SHALL be one history step. An empty name SHALL be refused and the old name kept.

#### Scenario: Rename
- **WHEN** "Group 1" is selected and the user types "Left Drive" into the name field
- **THEN** the folder and the Inspector header show "Left Drive"

#### Scenario: Clone a group
- **WHEN** "Claw" is selected and the user clicks Clone
- **THEN** a new folder "Claw copy" with copies of all of Claw's parts appears, one pitch away, and is selected

### Requirement: Groups are saved and shared
A part's group SHALL be saved with the build, in the build file, the build library and the history, and SHALL be kept when the build is sent to or changed by the MCP server. The assistant's view of the assembly (`get_assembly`) SHALL list each part's group id and name. MCP tools that change a part SHALL keep its group; tools that add parts SHALL add them outside any group. Builds saved before groups existed SHALL load with no groups.

#### Scenario: Reload keeps groups
- **WHEN** the user makes the group "Left Drive" and reloads the page
- **THEN** the "Left Drive" folder is still in the Outliner with the same parts

#### Scenario: MCP move keeps group
- **WHEN** the MCP `update_part` tool moves a part that belongs to "Claw"
- **THEN** the part is still in "Claw" afterwards
