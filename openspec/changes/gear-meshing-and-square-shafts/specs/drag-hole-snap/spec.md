## MODIFIED Requirements

### Requirement: Pins and shafts pull onto matching holes
While dragging, when one of the moving part's pins or shafts comes within 3.5 mm (sideways) of the axis line of a hole on another part that it fits (the same fit rules as the hole highlights), the part SHALL be pulled so they share that line. The reverse also applies: one of the moving part's holes onto another part's pin or shaft. The two must be parallel within 2° and within 12 pitch (152.4 mm) of each other along the line, the same reach as the hole highlights. The pull SHALL move the part only along the dragged axes, except for a sideways miss of up to 1 mm, which SHALL be closed directly so a part that drifted slightly off a pattern clicks back in. Dragged axes that run along the hole's line SHALL stay on the pitch steps. The pull works at any part angle, because it uses the real hole lines. When several pairs are in reach, the smallest pull SHALL win; pulls within 0.25 mm of each other SHALL go to the pair nearer along the line.

#### Scenario: Shaft back into its hole
- **WHEN** a shaft 0.78 mm off its original hole's line (0.58 mm in X, 0.53 mm in Y) is dragged a little along X
- **THEN** it lands exactly on the hole's line in both X and Y

#### Scenario: Angled plate
- **WHEN** a shaft is dragged near a hole of a plate tilted 30°
- **THEN** it lands on that hole's line

#### Scenario: Far along the line
- **WHEN** a shaft is dragged 0.3 mm off the line of a beam hole that is 33 mm away along the line
- **THEN** it is pulled onto that line (it was too far away before, at a 2 pitch reach)

### Requirement: Holes pull onto other parts' holes
While dragging, when one of the moving part's holes comes within 3.5 mm (sideways) of the axis line of a hole on another part, and a shaft would fit both, the part SHALL be pulled so the two holes share that line. Holes a shaft fits are pin holes, shaft bores, the Smart Motor's drive socket and rubber collar holes; any two of them pair. The same limits and rules as for pins apply: parallel within 2°, within 12 pitch (152.4 mm) along the line, pull along the dragged axes plus the 1 mm settle, and pitch steps kept along the line. When several pairs are in reach, the smallest pull SHALL win; pulls within 0.25 mm of each other SHALL go to the pair nearer along the line.

#### Scenario: Corner connector against a beam
- **WHEN** a 2x Wide 2x2 Corner Connector is dragged along a beam with its holes 2 mm off the beam's holes and its face 1 mm from the beam
- **THEN** it is pulled so its holes line up with the beam's holes

#### Scenario: Two beams
- **WHEN** a 1x6 Beam is dragged over another 1x6 Beam (parallel, faces 3 mm apart) with its holes 1.5 mm off
- **THEN** it is pulled so their holes line up

#### Scenario: Gear over a beam hole
- **WHEN** a 36 Tooth Gear is dragged across a beam so its center bore comes within 3 mm of a beam hole's line
- **THEN** the gear's bore is pulled onto that line

#### Scenario: Gear high above a beam hole
- **WHEN** a 12 Tooth Gear is dragged 33 mm above a beam, with its bore 0.27 mm off a beam hole's line
- **THEN** the gear's bore is pulled onto that line and the hole is highlighted

#### Scenario: Motor socket onto a beam hole
- **WHEN** a Smart Motor is dragged against a beam so its drive socket comes within 3 mm of a beam hole's line
- **THEN** the motor is pulled so the socket lines up with that hole, ready for an axle through the beam into the motor
