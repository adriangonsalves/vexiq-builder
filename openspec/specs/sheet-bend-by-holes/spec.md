# sheet-bend-by-holes Specification

## Purpose

Lets the builder bend a plastic sheet by marking one of its holes and then a hole on another part, so the sheet curves onto that part with as many holes lined up as possible.

## Requirements

### Requirement: Mark a sheet hole to start bending
The system SHALL let the builder start bending with Tools → Bend sheet when a plastic sheet (2x12, 6x6, 6x12) is selected alone, or when a hole of a plastic sheet is the marked target (Alt+click), in which case that hole is already the hole to bend from. While bending, the nearest hole under the cursor SHALL light up and a plain click (no Alt) SHALL pick it; the first click on a sheet hole marks it as the hole to bend from. The marked hole's row (the line of the sheet's holes parallel to a bend direction, through that hole) SHALL be the row that gets anchored. The mark SHALL be shown in its own colour, SHALL NOT change the assembly or the selection, and SHALL be cleared by `Esc`, by clicking it again, or when the sheet is hidden, removed or undone away.

#### Scenario: Mark a hole on the sheet
- **WHEN** bending has started and the user clicks a hole of a 6x12 Plastic Sheet
- **THEN** that hole is marked and the banner says to click a hole on the part to bend onto

#### Scenario: Start from a selected hole
- **WHEN** a hole of a plastic sheet is the marked target and the user chooses Tools → Bend sheet
- **THEN** that hole is already the marked sheet hole and only the other hole is left to pick

#### Scenario: Not a sheet
- **WHEN** only a beam is selected and the user opens Tools → Bend sheet
- **THEN** the menu item is unavailable and says why

### Requirement: Pick a hole on another part to bend onto
With a sheet hole marked, a click on a hole of any other visible part (including another sheet) SHALL bend the sheet so the marked hole sits on that hole and shall show it as a preview. The rows of the sheet already held by pins or other parts SHALL stay flat, and no row other than the marked hole's row SHALL be anchored. The sheet SHALL keep the shape rules of sheet bending (length, thickness, minimum 3 mm radius, at most 1 mm stretch, no twist).

#### Scenario: Bend onto a beam
- **WHEN** a sheet is pinned along one row, a hole in its row 4 is marked, and the user Alt+clicks a hole of `2x10 Beam #1 (Copy)` within reach
- **THEN** the sheet is shown flat through its pinned row and curved so row 4 lies on that beam face, with the marked hole on the picked hole

#### Scenario: Middle of the sheet is not anchored
- **WHEN** the marked sheet hole is in row 6 and the beam is within reach of row 6
- **THEN** only row 6 is anchored; the sheet's middle rows between the pinned row and row 6 follow the curve and are not pinned to the beam

### Requirement: The fit with the most holes lined up is shown first
The system SHALL consider each face of the picked part and each way the sheet can curve, SHALL count the holes of the marked row that line up with the part's holes along the line (within 1 mm), and SHALL show first the fit with the most holes lined up, then the least bending, then the least stretch. The mouse wheel, `R` and `Shift+R` SHALL step through the other fits that work, and the banner SHALL say the position and the holes matched (for example "Fit 2 of 3: 4 holes line up"). Fits where the sheet up to the anchored row would pass through another part SHALL be left out.

#### Scenario: Two faces
- **WHEN** a beam's two faces both work but the upper face lines up 5 holes and the lower face 3
- **THEN** the upper face is shown first as "Fit 1 of 2: 5 holes line up"

#### Scenario: Step to another fit
- **WHEN** the user scrolls the mouse wheel during the preview
- **THEN** the next fit is shown and the banner updates

### Requirement: Keep or cancel the bend
Enter or the banner's Keep button SHALL keep the shown fit as one history step ("Bend <sheet>"), moving the pins in the sheet's moving rows with it, and SHALL clear the marks. Clicking another hole while a fit is shown SHALL pick that hole instead. The banner SHALL name the face the sheet lies on (upper face, lower face). `Esc` SHALL cancel the preview with no history step and keep the sheet hole marked.

#### Scenario: Keep
- **WHEN** a fit is shown and the user presses Enter or clicks Keep
- **THEN** the sheet is bent, one undo step flattens it again

#### Scenario: Cancel
- **WHEN** a fit is shown and the user presses `Esc`
- **THEN** the sheet is flat as before, no history step is added, and the sheet hole is still marked

### Requirement: Say why when it can't bend
When no fit works, the system SHALL change nothing and SHALL say why, in a message that stays until the builder closes it: no row of the sheet pinned yet, the part's holes not parallel to the sheet's rows, out of reach by a number of millimetres, too tight a bend, or the sheet would pass through a named part.

#### Scenario: Out of reach
- **WHEN** the picked hole is 40 mm further than the sheet can reach
- **THEN** a message says "out of reach by 40.0 mm" and the sheet is not changed

### Requirement: Selection dialog and MCP keep working
Selecting a sheet and another part and choosing Tools → Bend sheet with no hole marked SHALL open the existing choices dialog. The MCP `bend_sheet` tool SHALL accept optional `sheetPortId` and `targetPortId` and bend as above, replying with the number of holes lined up; calls without them SHALL behave as before.

#### Scenario: Dialog as before
- **WHEN** a sheet and a beam are selected and no hole is marked and the user chooses Bend sheet
- **THEN** the dialog lists the ways to anchor the sheet to the beam

#### Scenario: MCP by hole
- **WHEN** `bend_sheet` is called with `sheetId`, `sheetPortId`, `targetId` and `targetPortId`
- **THEN** the sheet is bent with that hole on that hole and the reply gives `holesMatched`
