## MODIFIED Requirements

### Requirement: Pins and shafts pull onto matching holes
While dragging, when one of the moving part's pins or shafts comes within 3.5 mm (sideways) of the axis line of a hole on another part that it fits (the same fit rules as the hole highlights), the part SHALL be pulled so they share that line. The reverse also applies: one of the moving part's holes onto another part's pin or shaft. The two must be parallel within 5° (a pair between 0.1° and 5° off is first straightened, see "Small tilts are straightened while dragging") and within 12 pitch (152.4 mm) of each other along the line, the same reach as the hole highlights. The pull SHALL move the part only along the dragged axes, except for a sideways miss, which SHALL be closed directly so a part that drifted off a pattern clicks back in. That sideways miss SHALL be at most 1 mm, or at most 3.5 mm when at least one other pair of the moving part (pin, shaft or hole) would be put on its line by the same move, within 0.25 mm. Dragged axes that run along the hole's line SHALL stay on the pitch steps. The pull works at any part angle, because it uses the real hole lines. When several pairs are in reach, the smallest pull SHALL win; pulls within 0.25 mm of each other SHALL go to the pair nearer along the line.

#### Scenario: Shaft back into its hole
- **WHEN** a shaft 0.78 mm off its original hole's line (0.58 mm in X, 0.53 mm in Y) is dragged a little along X
- **THEN** it lands exactly on the hole's line in both X and Y

#### Scenario: Angled plate
- **WHEN** a shaft is dragged near a hole of a plate tilted 30°
- **THEN** it lands on that hole's line

#### Scenario: Far along the line
- **WHEN** a shaft is dragged 0.3 mm off the line of a beam hole that is 33 mm away along the line
- **THEN** it is pulled onto that line (it was too far away before, at a 2 pitch reach)

#### Scenario: Brain pushed onto its pins
- **WHEN** a Robot Brain with Battery whose side holes are 2.7 mm off (in Z) from eight brain pins is dragged along X, the pins' line, toward them
- **THEN** it is pulled 2.7 mm in Z so all eight holes line up with the pins

#### Scenario: One pair only
- **WHEN** a shaft whose only pairing hole is 2 mm off sideways is dragged along that hole's line
- **THEN** it is not pulled sideways

### Requirement: Holes pull onto other parts' holes
While dragging, when one of the moving part's holes comes within 3.5 mm (sideways) of the axis line of a hole on another part, and a shaft would fit both, the part SHALL be pulled so the two holes share that line. Holes a shaft fits are pin holes, shaft bores, the Smart Motor's drive socket and rubber collar holes; any two of them pair. The same limits and rules as for pins apply: parallel within 5° (straightened first when off by more than 0.1°), within 12 pitch (152.4 mm) along the line, pull along the dragged axes plus the sideways settle (1 mm, or 3.5 mm when another pair agrees within 0.25 mm), and pitch steps kept along the line. When several pairs are in reach, the smallest pull SHALL win; pulls within 0.25 mm of each other SHALL go to the pair nearer along the line.

#### Scenario: Corner connector against a beam
- **WHEN** a 2x Wide 2x2 Corner Connector is dragged along a beam with its holes 2 mm off the beam's holes and its face 1 mm from the beam
- **THEN** it is pulled so its holes line up with the beam's holes

#### Scenario: Two beams
- **WHEN** a 1x6 Beam is dragged over another 1x6 Beam (parallel, faces 3 mm apart) with its holes 1.5 mm off
- **THEN** it is pulled so their holes line up

#### Scenario: Two beams dragged along their hole lines
- **WHEN** a 1x6 Beam is dragged toward another 1x6 Beam along their hole lines, with its holes 2.5 mm off sideways
- **THEN** it is pulled sideways so all its holes line up with the other beam's holes

#### Scenario: Gear over a beam hole
- **WHEN** a 36 Tooth Gear is dragged across a beam so its center bore comes within 3 mm of a beam hole's line
- **THEN** the gear's bore is pulled onto that line

#### Scenario: Gear high above a beam hole
- **WHEN** a 12 Tooth Gear is dragged 33 mm above a beam, with its bore 0.27 mm off a beam hole's line
- **THEN** the gear's bore is pulled onto that line and the hole is highlighted

#### Scenario: Motor socket onto a beam hole
- **WHEN** a Smart Motor is dragged against a beam so its drive socket comes within 3 mm of a beam hole's line
- **THEN** the motor is pulled so the socket lines up with that hole, ready for an axle through the beam into the motor

## ADDED Requirements

### Requirement: Small tilts are straightened while dragging
While dragging, when the moving part's nearest matching pair (pin, peg or shaft and hole, or hole and hole, by the same fit and reach rules as the hole pulls) is more than 0.1° and less than 5° off parallel, the system SHALL first turn the part by that small angle, about the point of its own matched pin, peg, shaft or hole, so the two axes are exactly parallel, and then apply the usual hole pull. When several pairs need the same turn (within 0.5°), that turn SHALL win over a single pair's; otherwise the pair needing the smallest sideways pull wins. Pairs 5° or more off parallel SHALL NOT turn the part or pull it. The turn SHALL be worked out from the pose the drag started with, so it does not add up over a drag. Holding Alt SHALL turn straightening off with the other hole pulls. On release, the straightened pose is the dropped pose: it goes through the usual slide to a clear spot, and when the part is later put back to its last clear pose, the straightening is undone with the rest of the move.

#### Scenario: Tilted beam onto pins
- **WHEN** a 1x6 Beam tilted 3° is dragged onto two pins standing in a plate, its holes within the pull distance of the pins' lines
- **THEN** the beam turns square to the pins, lines up, and drops onto them with nothing overlapping

#### Scenario: Deliberate angle left alone
- **WHEN** a beam angled 20° on purpose is dragged across a plate's holes
- **THEN** it is not turned and not pulled

#### Scenario: Several pins agree
- **WHEN** a part's three pins are all 2° off the same plate's holes in the same way, and one other pin is 4° off a different part's hole
- **THEN** the part turns by the 2° the three pins share

#### Scenario: Alt keeps the tilt
- **WHEN** the user holds Alt while dragging the 3°-tilted beam onto the pins
- **THEN** it keeps its tilt and is not pulled
