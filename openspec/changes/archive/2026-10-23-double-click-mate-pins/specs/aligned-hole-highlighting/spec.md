## MODIFIED Requirements

### Requirement: Which parts match which openings
The system SHALL recognize two kinds of inserts and four kinds of openings, and SHALL only pair an insert with an opening it can actually go into:
- a **pin** (`pin_peg` port, or, for a pin part in Pins & Standoffs that has no stored pin but is pin-shaped (at most 6.5 mm across, longest along its Z axis, such as the 2x3 Smooth Idler Pin), a pin along its length through its center) matches **pin holes** (`pin_hole`) only;
- a **shaft** (a part whose catalog shaft type is `straight_shaft`, `capped_shaft`, or `motor_shaft`, other than a Rubber Shaft Collar) matches **pin holes**, **shaft bores** (`shaft_bore`), the **motor drive socket** (`shaft_socket`), and **rubber collar holes**.

Rubber Shaft Collars MUST be treated as openings (their shaft hole), never as shafts, even though the catalog tags them as shafts.

#### Scenario: Pin over a gear's center bore
- **WHEN** a Connector Pin's axis lines up with the center shaft bore of a 36 Tooth Gear
- **THEN** that bore is not highlighted

#### Scenario: Shaft over a beam hole
- **WHEN** a 4x Pitch Shaft's axis lines up with a round hole in a 1x6 Beam
- **THEN** that beam hole counts as a match

#### Scenario: Shaft over a gear bore
- **WHEN** a shaft's axis lines up with the center shaft bore of a 36 Tooth Gear
- **THEN** that bore counts as a match

#### Scenario: Shaft over the motor socket
- **WHEN** a shaft's axis lines up with the drive socket of a Smart Motor
- **THEN** that socket counts as a match

#### Scenario: Rubber collar is not a shaft
- **WHEN** a Rubber Shaft Collar is dragged over beam holes
- **THEN** no beam holes are highlighted because of the collar

#### Scenario: Rubber collar hole lines up with a shaft
- **WHEN** a Rubber Shaft Collar's hole lines up with a placed shaft and the collar is not yet on the shaft
- **THEN** the collar's hole counts as a match

#### Scenario: Pin part with no stored pin
- **WHEN** a 2x3 Smooth Idler Pin's axis lines up with a beam hole
- **THEN** that hole counts as a match

### Requirement: Alignment rule
An insert and an opening that match, on two different visible parts, SHALL count as aligned when all of the following hold in world space:
- their axes are parallel or anti-parallel within 2°;
- the perpendicular distance between the two axis lines is at most 0.25 mm;
- the axial gap between the insert's length and the opening's depth along the shared axis is at most 12 × pitch (152.4 mm), where an overlap counts as a gap of 0.
- for a pin, the opening lies on a side where that pin actually sticks out of its part. Each pin end is checked against the part's 3D model; an end buried in the part's body (for example the body side of a corner connector's pin) projects nothing. Double-ended pins such as connector pins, idler pins (both the snap end and the smooth free-spinning end) and male–male standoffs project from both ends. Shafts project from both ends. Until a part's 3D model has loaded, or when neither end of a pin can be confirmed from the model, both ends of that pin count.

#### Scenario: Pin directly above a hole
- **WHEN** a 0x2 Connector Pin is placed 20 mm above a beam hole with its axis on the hole's axis
- **THEN** the pin and that hole count as aligned

#### Scenario: Insert offset sideways from the opening
- **WHEN** a pin's or shaft's axis is parallel to an opening's axis but 1 mm to the side
- **THEN** they do not count as aligned

#### Scenario: Insert tilted relative to the opening
- **WHEN** a pin's or shaft's axis passes through an opening's center but is tilted 10° from the opening's axis
- **THEN** they do not count as aligned

#### Scenario: Opening too far along the axis
- **WHEN** an opening lies on a pin's or shaft's axis line but more than 152.4 mm beyond its end
- **THEN** they do not count as aligned

#### Scenario: Insert and opening on the same part
- **WHEN** a part has both a pin and a hole that are coaxial with each other
- **THEN** that pair is never treated as aligned

#### Scenario: Corner connector pin, hole on the body side
- **WHEN** a beam hole lies on the axis of a 1x Wide, 1x1 Corner Connector's pin, but on the side of the connector's body rather than the side the pin sticks out
- **THEN** they do not count as aligned

#### Scenario: Corner connector pin, hole on the pin side
- **WHEN** a beam hole lies on the same pin's axis on the side the pin sticks out
- **THEN** they count as aligned

#### Scenario: Pins pointing two ways
- **WHEN** a Triple 2x Wide, 2x2 Corner Connector (pins on its +X, +Z and −Z faces) has beams lined up with its +X pins and with its +Z pins
- **THEN** holes on both beams count as aligned, and holes on its −X body side do not

#### Scenario: Double-ended connector pin
- **WHEN** a 1x1 Connector Pin has a beam lined up on each side along its axis
- **THEN** holes on both beams count as aligned

#### Scenario: Idler pin smooth end
- **WHEN** a 0x3 Idler Pin stands below a beam hole with its smooth (free-spinning) end facing the beam
- **THEN** the pin and that hole count as aligned
