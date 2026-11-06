## Purpose

Lets a plastic sheet be bent the way it is on a real robot: held flat on its pinned rows and curved onto rows of holes on other parts, with the Bend sheet tool in the app and `bend_sheet` in the MCP server.

## ADDED Requirements

### Requirement: How a sheet bends
A bent sheet SHALL bend only along lines parallel to one set of its hole rows (across its width or along its length), never twisting. Its shape SHALL be:
- flat through the rows that were pinned before the first bend (the held rows);
- between each anchored row and the one before it, one smooth curve that leaves each row in line with the sheet there and is exactly as long as the sheet between those holes (12.7 mm per row), with the least bending that allows;
- straight past the last anchored row, to the sheet's edge.

The sheet SHALL keep its thickness and its real length; it SHALL NOT stretch, except where a row just misses (see below). Its holes SHALL follow the sheet, each pointing straight through the sheet where it is. A curve that would bend tighter than 3 mm radius SHALL be refused.

#### Scenario: Length is kept
- **WHEN** a 6x12 sheet is bent across its width through anchored rows that are all within reach
- **THEN** its length measured along the curve is 75.9 mm, within 0.1 mm, and the distance along the curve between any two hole rows is 12.7 mm per row

#### Scenario: Smooth at a row
- **WHEN** a sheet is anchored at row 4 and row 6
- **THEN** the sheet has no corner at row 4: the direction of the sheet just before and just after the row differs by less than 1°

#### Scenario: Too tight
- **WHEN** an anchor would need the sheet to fold back on itself in one row's length
- **THEN** that anchor is not offered, or is refused with "the sheet would have to bend too tightly"

### Requirement: Finding where a sheet can be anchored
Given a sheet and a target part, the app SHALL list every way a later row of the sheet can be anchored to that part's holes:
- the sheet's held rows are its rows that already have pins in them or line up with another part's holes; with none, it SHALL say to pin one row of the sheet first;
- the bend lines are parallel to the held rows; when the held holes are a single hole, both directions are tried;
- a choice is a sheet row past the held rows (or past the last anchored row), a line of the target's holes parallel to that row to within 3°, every sheet hole in the row that lands on the target lining up with a target hole to within 1 mm along the row, and the face of the target the sheet would lie on;
- the row must be within reach: a smooth curve (no tighter than 3 mm radius) must fit in the sheet's length between the rows plus at most 1 mm of stretch;
- only the sheet up to the anchored row must be clear of other parts; what the rest of the sheet past that row runs into is noted with the choice (a later anchor bends it clear);
- choices whose sheet would pass through the target or another part SHALL be left out, with a count of how many were left out and why.

Each choice SHALL be named by the sheet row and the target and face, for example "sheet row 4 → 1x12 Beam, upper face", and say how far off it is when it is not exact.

#### Scenario: Beam two rows on
- **WHEN** a 6x12 sheet pinned flat on its first two rows is asked for choices on a 1x12 Beam lying parallel to its rows, whose holes line up with the sheet's row 4 within reach
- **THEN** "sheet row 4 → 1x12 Beam" on the face toward the sheet is among the choices, with how far off it is

#### Scenario: No pinned row
- **WHEN** a sheet with no pins and no lined-up holes is asked for choices
- **THEN** no choices are listed and the reply says to pin one row of the sheet first

#### Scenario: Target at an angle
- **WHEN** the target's row of holes is 10° off parallel to the sheet's rows
- **THEN** it is not offered, and the reply says the sheet would have to twist

### Requirement: A row that just misses
A choice up to 1 mm farther than the sheet reaches SHALL be offered, marked with how far off it is. When it is applied, the piece of sheet between that row and the one before it SHALL stretch by the miss, so the row's holes land on the target's and its pins seat as usual; the stretch SHALL be shown in the choice, kept with the bend, and reported by the inspector and the MCP server. A row farther off than 1 mm SHALL be refused with how far off it is. When the target part is held only by this sheet (nothing else is pinned to it), the refusal SHALL offer to move the target part to the sheet instead.

#### Scenario: 0.6 mm short
- **WHEN** a sheet already anchored at row 4 is anchored at row 6 on a beam 0.6 mm farther than the sheet reaches
- **THEN** the sheet is bent with the piece from row 4 to row 6 stretched 0.6 mm, row 6's holes line up with the beam's, its sheet pins are seated, and the stretch is reported

#### Scenario: Loose beam moved
- **WHEN** a row is 4 mm out of reach of a beam that nothing else holds, and the user chooses to move the beam
- **THEN** the beam moves 4 mm to meet the sheet's row and the sheet is anchored to it

### Requirement: Stacked sheets
When another sheet already lies on the target face where the row lands, the new sheet SHALL lie on top of it, one sheet thickness plus 0.1 mm farther from the face, so both are pinned through the same holes without overlapping. Any number of sheets MAY be stacked this way.

#### Scenario: Sheet over a sheet
- **WHEN** a 6x6 sheet is anchored at its row 6 on a 1x6 Beam where a 6x12 sheet's row already lies
- **THEN** the 6x6 lies on the 6x12 with a 0.1 mm gap, the overlap check reports nothing between the two sheets, and one sheet pin per hole goes through both

### Requirement: Sheets flex where they press
A plastic sheet that presses into another part SHALL count as a tight fit, not an overlap, when the sheet would have to flex at most 1.5 mm along its own normal to clear that part; deeper SHALL be an overlap. Two sheets pinned through the same holes (stacked) SHALL count their contact as a tight fit. This applies everywhere overlaps are checked (placing, the audit, Bend sheet's clearance), for flat and bent sheets alike.

#### Scenario: Sheet edge on a plate
- **WHEN** a bent sheet's edge passes 1 mm into the end of a side plate
- **THEN** the overlap check lists the plate as a tight fit and reports no overlap

#### Scenario: Sheet through a beam
- **WHEN** a sheet is bent so it would pass through the middle of a beam
- **THEN** the overlap check reports the beam as an overlap, and Bend sheet leaves that choice out naming the beam

### Requirement: Bend sheet tool
The Tools menu SHALL have Bend sheet, available when a plastic sheet and one other part are selected. It SHALL:
- highlight every choice's row of target holes in the viewport and list the choices by name;
- show the bent sheet for the choice the user points at or picks, before anything changes;
- apply the picked choice as one change, which can be undone;
- be usable again on the same sheet to anchor further rows, each anchor bending the sheet only past the rows already anchored;
- offer Flatten for a bent sheet, which removes its bend;
- say why when there are no choices.

Parts pinned only in the moving part of the sheet SHALL move with it.

#### Scenario: Pick a highlighted row
- **WHEN** the user selects a sheet and a beam, opens Tools → Bend sheet, and clicks a highlighted row
- **THEN** the sheet is shown bent onto that row, and Apply bends it as one step in the history

#### Scenario: Two anchors
- **WHEN** a sheet is anchored at row 4 to one beam, then Bend sheet is used again with a second beam
- **THEN** only rows past row 4 are offered, and applying one keeps the sheet's shape up to row 4 unchanged

#### Scenario: Flatten
- **WHEN** the user chooses Flatten on a bent sheet
- **THEN** the sheet is flat again through its held rows, as one change

### Requirement: Bend sheets through the MCP server
The MCP server SHALL have a `bend_sheet` tool that, for a sheet and a target part, lists the choices as Bend sheet would (with each choice's sheet row, target holes, face and how far off it is), applies one named choice (or a given sheet row and target holes), moves a loose target when asked, or flattens a sheet. It SHALL check the result like other placement tools and report overlaps. `get_assembly` and `get_part_details` SHALL report a sheet's bend.

#### Scenario: List then bend
- **WHEN** a client calls `bend_sheet` for a pinned sheet and a beam without a choice, then again naming "sheet row 4"
- **THEN** the first reply lists the choices and changes nothing; the second bends the sheet and the audit shows no overlaps
