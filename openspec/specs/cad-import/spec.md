# cad-import Specification

## Purpose
Turns an official VEX CAD assembly (an instructions.online / Cadasio project) into an app build directly, using a table of how each library part's model sits relative to the frame VEX's CAD uses for it.

## Requirements

### Requirement: CAD frame table
The project SHALL keep a table, per part number, of the offset and turn that take a part's pose in VEX's CAD to its pose in the app. Each entry SHALL say how it was found (`pins`: checked against seated pins and holes in a real build; `mesh`: matched against Cadasio's model of the part; `default`: the box-centre rule with no check) and the build it was checked on. It SHALL be seeded from the 2026-27 Herobot Flop:
- every part type that build checked, except those below, uses the box-centre rule;
- the Smart Motor (228-2560) uses its own origin, turned 180° about Z;
- the 4x Pitch Motor Shaft (228-2500-2238), the 4x and 5x Pitch Capped Shafts (228-2500-2223, -2225), the Bumper Switch (228-2677, offset -19.05, 0, 6.35 mm) and the Robot Brain use their own origin;
- the omni wheel (228-2536) needs a turn, and the Long Intake Flap (228-2500-242) a turn of 180° about Y with the offset 8.98, 12.03, 13.09 mm, which seats its pegs in the tread link holes.

A part number with no entry SHALL use the box-centre rule and be reported as unchecked.

#### Scenario: Motor from CAD
- **WHEN** a Smart Motor is converted from a VEX CAD pose
- **THEN** its four mounting pins from the same CAD file are seated in its holes and its motor shaft is in its drive socket

#### Scenario: Unknown part
- **WHEN** a part number with no table entry is converted
- **THEN** it is placed by the box-centre rule and listed as unchecked in the import report

### Requirement: Growing the table from CAD models
A script SHALL fetch a Cadasio project's per-part models and, for each part number, find the turn and offset that best lay the library model over the CAD model, writing `mesh` entries with how closely they match. It SHALL NOT overwrite a `pins` entry, and SHALL report part numbers whose best match is poor (more than 0.5 mm average distance) instead of writing them.

#### Scenario: New part type
- **WHEN** the script runs on a project that uses a part type missing from the table
- **THEN** the table gains a `mesh` entry for it with its match quality, and existing `pins` entries are unchanged

### Requirement: Importing a VEX CAD assembly
A script SHALL take an instructions.online project id or link, or a saved copy of the project's data, and build it in the app through the MCP server:
- it SHALL clear the build first only when asked;
- every library part SHALL be converted with the frame table and placed in batches, then grouped per CAD subassembly;
- each part SHALL get a label unique in the build, made from its subassembly and CAD instance name, so parts with the same CAD name in different subassemblies or chains can be told apart;
- parts not in the library (cables, cable plugs, rubber bands, game pieces, sensors the library lacks) SHALL be left out;
- two parts of the same type at the same pose SHALL be placed once.

It SHALL end with a report: parts placed, parts left out and why, duplicates dropped, part types placed by an unchecked rule, and the audit summary.

#### Scenario: Herobot Flop
- **WHEN** the script imports project `4063-2026-2027_viqrc_herobot_flop`
- **THEN** the library parts are placed in Drive Train, Tower and Intake groups with unique labels; cables, the rubber band and the game piece are listed as left out; the two duplicate 2x12 Beams are listed and placed once; and no part is lost when the user then clicks in the app

#### Scenario: Same name in two chains
- **WHEN** two chains in the CAD both have links named `228-2500-230-29`
- **THEN** both links are placed, with different labels
