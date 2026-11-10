## MODIFIED Requirements

### Requirement: Importing a VEX CAD assembly
A script SHALL take an instructions.online project id or link, or a saved copy of the project's data, and build it in the app through the MCP server:
- it SHALL clear the build first only when asked;
- every library part SHALL be converted with the frame table and placed in batches, then grouped per CAD subassembly;
- each part SHALL get a label unique in the build, made from its subassembly and CAD instance name, so parts with the same CAD name in different subassemblies or chains can be told apart;
- parts not in the library (cables, cable plugs, game pieces, sensors the library lacks) SHALL be left out;
- rubber bands and belts SHALL be handled as follows:
  - Each one VEX's CAD shows stretched, visible in the finished view, SHALL be placed as a band. Its route SHALL come from the spots its mesh touches, in order round its loop, with side and gaps read from the mesh.
  - Stand-in bands hidden in the finished view SHALL be left out.
  - A band whose spots can't all be found SHALL be left out with the reason;
- two parts of the same type at the same pose SHALL be placed once.

It SHALL end with a report: parts placed, parts left out and why, duplicates dropped, part types placed by an unchecked rule, each band with its spots and stretch, and the audit summary.

#### Scenario: Herobot Flop
- **WHEN** the script imports project `4063-2026-2027_viqrc_herobot_flop`
- **THEN** the library parts are placed in Drive Train, Tower and Intake groups with unique labels; cables and the game piece are listed as left out; the rubber band, if VEX's CAD shows it stretched and visible in the finished view, is placed on its spots, and otherwise it is listed as left out with the reason; the two duplicate 2x12 Beams are listed and placed once; and no part is lost when the user then clicks in the app

#### Scenario: Same name in two chains
- **WHEN** two chains in the CAD both have links named `228-2500-230-29`
- **THEN** both links are placed, with different labels

#### Scenario: Hero Bot Swish bands
- **WHEN** the script imports `4094-viqc 2024-2025 hero bot swish`
- **THEN** six bands are placed and reported:
  - two #117B bands, each from a Catapult Arm standoff to a chassis Connector Pin;
  - two #117B bands across the intake, each round two standoffs at each end and through the inner sprockets' gaps lined up with them;
  - two 2x30 mm Square Silicone Belts from the Release Mechanism's right-angle beams to the pawl's Connector Pin.
- **AND** the hidden stand-in bands, including the #32, are not placed
