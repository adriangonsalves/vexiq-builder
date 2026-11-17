## ADDED Requirements

### Requirement: Importing ropes
The import script SHALL place each rope VEX's CAD shows as one routed rope.

VEX draws one rope as several pieces: a straight library rope (228-2500-430, 436, 438, 442 or 448), often running on past where the real rope turns; a bent piece named for the rope ("228-2500-438 bent …", "Lift Rope"); and loose end tabs ("228-2500-ROPE-OVERMOLD-MASTER"). The script SHALL treat these as rope pieces, and SHALL:
- join pieces that touch, or that share a pulley, into one rope;
- take the rope's size from the library rope among its pieces, and when there is none, the shortest library rope that fits the route, saying so in the report;
- take each end from the end tab that sits on a pin, standoff or shaft, or in a spool's pocket;
- take the spots between from the parts the cord touches, in order from one end to the other, with the side read from the pieces;
- leave out any length of a straight piece that runs on past the last spot or end it touches;
- wind the spare on the spool when an end is in one, and otherwise leave it as slack;
- not place any rope piece as a part of its own, and not list rope pieces as "not in the library".

A rope with no end that can be found SHALL be left out with the reason. A rope shorter than the route read from the CAD SHALL be placed on that route and reported as too short.

The report SHALL list each rope: its size, its ends and spots, its used length, and its turns or slack.

#### Scenario: Hero Bot Swish rope
- **WHEN** the script imports `4094-viqc 2024-2025 hero bot swish`
- **THEN** one 24x Pitch Rope is placed in the Catapult Winch group, from the 2x Wide Spool's pocket (on the winch's 4x Pitch Shaft) to the Catapult Arm's 3x Pitch Motor Shaft, with its spare wound on the spool
- **AND** no straight rope is placed through the arm, and the bent piece and the loose end tab are not listed as left out

#### Scenario: Hero Bot Huey ropes
- **WHEN** the script imports `4063-2025-2026_viqrc_hero_bot_huey`
- **THEN** two 24x Pitch Ropes are placed, one each side, each from a 0x2 Connector Pin on the Claw Mount, over a .5x Pitch Idler Pulley on the Elevator Middle Stage (and the 0.5x Pitch Standoff just below it that the rope bears on), to a 0x2 Connector Pin on the Elevator Holder
- **AND** the report gives each rope's slack, and the straight pieces' length above the pulleys is left out

#### Scenario: Rope end not found
- **WHEN** a rope's pieces touch no pin, standoff, shaft or spool at either end
- **THEN** the rope is left out and the report says no end was found
