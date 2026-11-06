## ADDED Requirements

### Requirement: Bent sheets from CAD
A plastic sheet that is bent in VEX CAD SHALL be imported bent. The import SHALL find the sheet's rows that sheet pins or other parts' holes go through, keep the first pinned rows flat, and anchor each later pinned row to the part its pins go into, as the Bend sheet tool would. A row up to 1 mm out of reach SHALL be anchored with the stretch the Bend sheet tool allows and listed in the report with the stretch; a row farther off SHALL be left unanchored (the sheet runs on from the row before) and listed with how far off it is. A body of a sheet that has no pins and lies apart from the build (VEX's flat copy of a bent sheet) SHALL be left out as now. A sheet that cannot be bent through its pinned rows at all SHALL be placed flat and listed in the report.

#### Scenario: Robot with bent sheets
- **WHEN** a VEX CAD robot with bent sheets is imported (the test robot is the 2026-27 Herobot Flop, with a 6x12 sheet bent over two beams and a 6x6 sheet stacked on it)
- **THEN** each bent sheet is placed bent through its pinned rows, sheets sharing a row are stacked, every sheet pin is seated, nothing overlaps, and the bent sheets lie within 1.5 mm on average of VEX's own sheet models

#### Scenario: Row just out of reach
- **WHEN** an imported sheet's pinned row is 0.6 mm farther than the sheet's length allows
- **THEN** the row is anchored with a 0.6 mm stretch, its pins are seated, and the report names the row and the 0.6 mm
