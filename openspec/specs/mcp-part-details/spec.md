# mcp-part-details Specification

## Purpose

Gives an agent the part facts it needs to plan a placement in a short `get_part_details` reply: size, every hole, peg and bore with its real direction and depth, and which way pegs stick out.

## Requirements

### Requirement: Compact part details by default
`get_part_details` SHALL by default return:
- id, name, part number and category;
- size and local bounding box in mm;
- what the local origin is;
- gear and fastener specs when present;
- a list of connection points.

Each connection point SHALL have its port id, kind (pin hole, shaft bore, shaft socket, collar hole, pin/peg, shaft), local position, local axis direction, and its usable span along that axis in mm. For openings the span SHALL be the measured depth (see "Hole depth comes from the 3D model" in mcp-fit-audit), with whether it goes through. For pegs it SHALL say which end or ends stick out of the part. The reply SHALL NOT include the raw cylinder list, mesh counts or connector counts unless `verbose: true` is given, which SHALL return the current full reply plus the connection points.

#### Scenario: Smart Motor
- **WHEN** an agent asks for the VEX IQ Smart Motor's details
- **THEN** the reply lists the drive socket (local axis +Y, 4.7 mm deep), each face pin hole with its depth, hole_1 and hole_8 as blind from the front face and not open at the back, with no cylinder list, and the reply is under 8,000 characters

#### Scenario: Corner connector pegs
- **WHEN** an agent asks for the 1x Wide, 1x1 Corner Connector's details
- **THEN** its peg is listed as sticking out on its +Z end only

#### Scenario: Full data on request
- **WHEN** an agent asks with `verbose: true`
- **THEN** the reply also contains the cylinder list and the other fields returned today
