## ADDED Requirements

### Requirement: A sprocket wrapped by both runs
A selected sprocket SHALL be wrapped by both runs of a chain when, with the other parts on the loop, the straight top run past it would cut through its teeth (tip circle plus a link half-height) and so would the straight bottom run. The top run SHALL bend round its top and the bottom run round its bottom, touching it from inside the loop on both. This SHALL happen without asking, for chains and for tracks. The sprocket SHALL be turned so its teeth sit in the chain on both runs, and the link count SHALL cover the extra length round it.

#### Scenario: Motor sprocket between two wheel sprockets
- **WHEN** an 8 Tooth, a 16 Tooth and an 8 Tooth Sprocket are selected in a line, with the 16 Tooth in the middle (Flop's drive: centres 38.1 mm and 139.7 mm apart), and the user picks Chain builder
- **THEN** one chain is built without a dialog, its top run rising over the 16 Tooth and its bottom run dipping under it, every link outside all three tooth rings, and all three sprockets turned to sit in the chain

#### Scenario: Same layout over MCP
- **WHEN** a client calls `build_chain` with `kind: "chain"` and the three sprockets' ids and no `route`
- **THEN** the chain is built and the reply lists the 16 Tooth as wrapped on both runs

#### Scenario: Track on the same sprockets
- **WHEN** the user picks Track builder for the same three sprockets
- **THEN** the track also wraps the 16 Tooth on both runs

### Requirement: Both as a route choice
For an enclosed part or crossing sprocket that one run could pass by while the other wraps it, and that both runs could also wrap, the over-or-under dialog SHALL offer **Both** beside **Over** and **Under**, and `build_chain`'s `route` SHALL accept `"both"`. With Both, the top run SHALL bend round the part's top and the bottom run round its bottom. Both SHALL be offered only when both runs can reach the part without lifting the chain off another part on the loop.

#### Scenario: Both for an enclosed idler
- **WHEN** two 24 Tooth Sprockets and a 16 Tooth Sprocket on the line between their centres are selected, and the user picks Both for the 16 Tooth
- **THEN** the top run dips to touch the 16 Tooth from above, the bottom run rises to touch it from below, and the 16 Tooth is turned to sit in both runs

### Requirement: Selected parts as obstacles
A selected part that is neither a sprocket nor a standoff, and whose solid crosses the chain's plane, SHALL be an obstacle. The builder SHALL take the part's outline where it crosses the plane, across the width of a link, and treat it as a shape the chain bends round, the same way it bends round a standoff:
- an obstacle a straight run would pass through, or one inside the loop, SHALL be listed in the over-or-under dialog and in `needsRoute` over MCP;
- **Under** and **Over** SHALL mean the same as for an enclosed part;
- the links SHALL rest on the outline's corners with no link cutting into it, and the outline SHALL NOT be turned.

A selected part that doesn't cross the chain's plane SHALL be ignored, and named in the reply with that reason.

#### Scenario: Chain past a corner connector
- **WHEN** the three drive sprockets of the motor-sprocket scenario and a Double 2x Wide, 2x2 Double Offset Corner Connector whose end sits in the bottom run's path are selected, and the user picks Under for the connector
- **THEN** the bottom run bends below the connector's end, no link overlaps the connector, and the chain still sits in all three sprockets

#### Scenario: Obstacle out of the plane
- **WHEN** a beam that lies wholly beside the chain's plane is selected with the sprockets
- **THEN** the chain is built as without it, and the reply says the beam doesn't reach the chain's plane

### Requirement: Parts a run would pass through
After a chain or track is planned, the builder SHALL check each straight run and each wrap against every part in the build that isn't on the loop or selected as an obstacle. Before building, any part a link would overlap SHALL be named:
- in the Build menu hover text;
- in the dialog;
- in the MCP reply as `blockedBy`, with each part's id, label and the run it is on.

The chain SHALL still be built when the user confirms. Tight contacts (see tight-fits in cad-import-readiness) SHALL NOT be named.

#### Scenario: Unselected bracket in the way
- **WHEN** a chain is planned between two sprockets and an unselected beam end sits across the bottom run
- **THEN** the dialog and the MCP reply name the beam as in the bottom run's way, and selecting the beam and choosing Under builds the chain clear of it
