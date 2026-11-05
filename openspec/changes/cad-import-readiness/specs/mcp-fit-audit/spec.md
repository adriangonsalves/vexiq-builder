## ADDED Requirements

### Requirement: Tight fits are listed apart from overlaps
`audit_assembly` SHALL list tight fits (see tight-fits) separately from overlaps, each with the two parts' labels. Tight fits SHALL NOT make the assembly unsound and SHALL NOT count toward the overlap count. The summary in `place_parts` replies SHALL include the tight-fit count.

#### Scenario: Tight fit in the audit
- **WHEN** a standoff passes 0.53 mm off a beam's hole and nothing else is wrong
- **THEN** the audit has no overlaps, lists one tight fit naming the standoff and the beam, and the assembly is mechanically sound

### Requirement: Shafts are checked along their indexed axis
The audit SHALL use each shaft's indexed axis and ends (see connection-points) to decide which openings a shaft is seated in, and how far it sticks out past the last part it passes through.

#### Scenario: Capped shaft through a gear
- **WHEN** a 4x Pitch Capped Shaft passes through two spacers, a 12 Tooth Gear's bore and a 2x8 Beam's hole
- **THEN** the audit lists the shaft as seated in all four, and the gear as on that shaft
