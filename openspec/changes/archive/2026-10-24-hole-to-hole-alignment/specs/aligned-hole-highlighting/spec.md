## ADDED Requirements

### Requirement: Highlight holes lined up with the moving part's holes
When the moving or selected part has a hole that lines up with a hole of another part, and a shaft would fit both, the system SHALL highlight the other part's hole. Holes a shaft fits are pin holes, shaft bores, the Smart Motor's drive socket and rubber collar holes. Lining up uses the same alignment rule as pins and shafts: axes parallel within 2° and within 0.25 mm, and within 12 × pitch along the axis. The ring SHALL use the same color and look as other highlights and sit on the other hole's face toward the moving part, as the existing ring rules say.

A hole-to-hole highlight SHALL show only while the two parts are apart along the axis: the holes' spans don't overlap, and moving the part about 0.9 mm toward the other part (just past the collision check's 0.76 mm contact tolerance) wouldn't make it touch anything. Hole faces are often recessed into their parts, so the parts' surfaces decide, not the hole faces. The highlight goes away once the parts touch, as a pin/shaft highlight does once the pin enters the hole. Holes of the same part never pair with each other.

#### Scenario: Corner connector over a beam
- **WHEN** a 2x Wide 2x2 Corner Connector is moved so two of its holes line up with two beam holes 5 mm away
- **THEN** both beam holes are ringed on the face toward the connector

#### Scenario: Stacked flush
- **WHEN** the connector's face touches the beam with the holes lined up
- **THEN** those beam holes are no longer ringed

#### Scenario: Motor against a beam
- **WHEN** a Smart Motor is moved toward a beam with its drive socket lined up with a beam hole 4 mm away
- **THEN** that beam hole is ringed on its face toward the motor
