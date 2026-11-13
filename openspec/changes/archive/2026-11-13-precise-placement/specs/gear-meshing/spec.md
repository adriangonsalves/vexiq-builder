## ADDED Requirements

### Requirement: Gears just out of mesh snap into mesh when placed
When a bevel, crown or worm gear, or a spur gear paired with a crown or worm, is placed (dragged and released, double-click mated, hole picked, put into the marked target, copy inserted, or placed by the assistant) within 3 mm of meshing at 90° with a gear it can mesh with, the system SHALL move the gears into mesh by sliding them along their own axes: the placed gear first, and the partner gear too when the placed gear alone can't close the gap. The slides SHALL be no more than 3 mm each, SHALL leave every shaft where it is, and SHALL then turn the placed gear to mesh as usual. A gear SHALL NOT be slid when it is locked or held by anything other than the shaft through its bore. When slides along the two axes can't bring the gears within meshing reach (the shafts themselves are out of line), nothing SHALL slide and Play mode SHALL keep reporting them as out of mesh. The snap SHALL be part of the placement's history step and its message SHALL say so, for example "Slid 18 Tooth Bevel Gear #2 1.2 mm along its shaft to mesh with 18 Tooth Bevel Gear #1".

#### Scenario: Bevel gears 1.4 mm apart
- **WHEN** an 18 Tooth Bevel Gear on one shaft is dropped so its cone point is 1.2 mm along its own axis and 0.7 mm along the other gear's axis from the other gear's cone point
- **THEN** it slides 1.2 mm along its shaft, the other gear slides 0.7 mm along its own shaft, both shafts stay where they are, and Play mode links them

#### Scenario: Shafts out of line
- **WHEN** a bevel gear is placed near another whose shaft line misses its cone point by 2 mm sideways to both axes
- **THEN** nothing slides and the gears stay out of mesh

#### Scenario: Further than 3 mm
- **WHEN** a bevel gear is placed 4 mm from meshing
- **THEN** nothing slides

### Requirement: Meshed gears shown on the selected gear
While one gear is selected (outside Play and Explode), every gear meshed with it SHALL be outlined and tinted green, and every gear within 3 mm of meshing with it at 90° but out of mesh outlined and tinted amber, so it can be seen whether gears that look close really mesh. The outlines SHALL follow the parts as they move and go when the selection changes. Nothing SHALL be shown for parts other than gears.

#### Scenario: A meshed pair
- **WHEN** a 36 Tooth Gear meshed with a 24 Tooth Gear is selected
- **THEN** the 24 Tooth Gear is outlined in green

#### Scenario: Close but not meshed
- **WHEN** an 18 Tooth Bevel Gear 1.4 mm out of mesh with another is selected
- **THEN** the other bevel gear is outlined in amber
