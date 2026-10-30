# drag-hole-snap Specification

## Purpose

Makes dragging a part with the Move gizmo land on the hole patterns of the parts around it: pitch steps follow the part's own position, and pins, shafts and holes are pulled onto nearby matching holes, whatever angle the parts are at.

## Requirements

### Requirement: Pitch steps count from where the drag started
While dragging with the Move gizmo with a pitch snap on (1P, 0.5P or 0.25P), each dragged axis SHALL move in whole steps from the part's position when the drag started, not from the world origin. Axes not being dragged SHALL keep their starting value. The 0.25P flush stop against another part SHALL also count its quarter steps from the last position where the part was clear.

#### Scenario: Axle off the world grid
- **WHEN** a shaft at y = 23.87 mm (an axle at wheel-radius height) is dragged up with 0.5P snap
- **THEN** it moves through y = 30.22, 36.57, … and not 25.4, 31.75

### Requirement: Pins and shafts pull onto matching holes
While dragging, when one of the moving part's pins or shafts comes within 3.5 mm (sideways) of the axis line of a hole on another part that it fits (the same fit rules as the hole highlights), the part SHALL be pulled so they share that line. The reverse also applies: one of the moving part's holes onto another part's pin or shaft. The two must be parallel within 2° and within 12 pitch (152.4 mm) of each other along the line, the same reach as the hole highlights. The pull SHALL move the part only along the dragged axes, except for a sideways miss, which SHALL be closed directly so a part that drifted off a pattern clicks back in. That sideways miss SHALL be at most 1 mm, or at most 3.5 mm when at least one other pair of the moving part (pin, shaft or hole) would be put on its line by the same move, within 0.25 mm. Dragged axes that run along the hole's line SHALL stay on the pitch steps. The pull works at any part angle, because it uses the real hole lines. When several pairs are in reach, the smallest pull SHALL win; pulls within 0.25 mm of each other SHALL go to the pair nearer along the line.

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
While dragging, when one of the moving part's holes comes within 3.5 mm (sideways) of the axis line of a hole on another part, and a shaft would fit both, the part SHALL be pulled so the two holes share that line. Holes a shaft fits are pin holes, shaft bores, the Smart Motor's drive socket and rubber collar holes; any two of them pair. The same limits and rules as for pins apply: parallel within 2°, within 12 pitch (152.4 mm) along the line, pull along the dragged axes plus the sideways settle (1 mm, or 3.5 mm when another pair agrees within 0.25 mm), and pitch steps kept along the line. When several pairs are in reach, the smallest pull SHALL win; pulls within 0.25 mm of each other SHALL go to the pair nearer along the line.

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

### Requirement: A lined-up part slides along the line into a clear spot
While dragging, when a hole pull has lined the moving part up on a line and the part then overlaps another part, the system SHALL move it along that line to the nearest position where it overlaps nothing, looking up to a quarter pitch (3.175 mm) either way, or half a pitch step if the snap setting is larger. When that clear spot is less than 2 mm long, because the part is held between parts on both sides (like a brain between its pins), the part SHALL go to the middle of the spot; otherwise it SHALL stop at the spot's near edge, just touching. When there is no clear spot within reach, the part SHALL stay where the drag put it and show as overlapping, as before. The slide SHALL NOT carry a shaft's cap past a hole it can't go through. Holding Alt SHALL turn it off with the other hole pulls.

#### Scenario: Brain onto its pins
- **WHEN** a Robot Brain with Battery lined up on its eight pins is dragged along X to a pitch step at x = -0.475 mm, where it presses into four of the pins
- **THEN** it slides to x = 0, in the middle between the pins on both sides, with nothing overlapping and all eight pins in its holes

#### Scenario: Too far from a clear spot
- **WHEN** the nearest clear position along the line is 5.4 mm away
- **THEN** the part stays where the drag put it and shows as overlapping

#### Scenario: Alt held
- **WHEN** the user holds Alt while dragging the same brain
- **THEN** it is not slid and shows as overlapping at x = -0.475 mm

### Requirement: Alt turns snapping off
Holding Alt while dragging SHALL turn off every hole pull (pins, shafts and holes). Pitch steps still apply.

#### Scenario: Placing between holes on purpose
- **WHEN** the user holds Alt while dragging a beam near another beam's holes
- **THEN** the beam is not pulled, and moves in pitch steps from where the drag started
