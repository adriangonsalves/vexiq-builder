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

### Requirement: A bent run wraps a sprocket it comes into contact with
When a run of a chain, as bent round an enclosed part or an obstacle, would pass through a selected sprocket it doesn't wrap there, it SHALL wrap that sprocket too, on the side the sprocket lies, and its links SHALL sit in the sprocket's teeth. The sprocket SHALL then be turned once so its teeth sit in the chain on every run that wraps it. Only when that wrap can't be made (the runs would cross or touch, or another part would lose the chain) SHALL the chain be refused, naming the sprocket the run would pass through. There SHALL be no "Both" route choice: a tight chain can't touch a part between its two runs on both of them.

#### Scenario: A bent run meets a wheel sprocket
- **WHEN** a chain runs round an 8 Tooth and two 24 Tooth Sprockets, and bending the top run under an enclosed standoff brings it down onto the lower 24 Tooth
- **THEN** the top run wraps that 24 Tooth as well, the 24 Tooth is listed as wrapped on both runs, and one turn of it puts a tooth gap at every pivot on it

### Requirement: Selected parts as obstacles
A selected part that is neither a sprocket nor a standoff, and whose solid crosses the chain's plane, SHALL be an obstacle. The builder SHALL take the part's outline where it crosses the plane, across the width of a link, and treat it as a shape the chain bends round, the same way it bends round a standoff:
- an obstacle a straight run would pass through (its outline within a link's half-height of the run) SHALL be listed in the over-or-under dialog and in `needsRoute` over MCP; **Over** takes the chain above it and **Under** below it, one of them round its outside;
- an obstacle clear of every run, inside the loop or out, SHALL be left alone (the chain doesn't touch it) and named in the reply as not in the way;
- the links SHALL rest on the outline's corners with no link cutting into it by more than a tight contact (0.5 mm, as for tight fits), and the outline SHALL NOT be turned;
- a link leaving or reaching a sprocket beside an obstacle's corner MAY pass close to that sprocket's teeth, as the chain just leaving it does.

A selected part that doesn't cross the chain's plane SHALL be ignored, and named in the reply with that reason. For a track, an obstacle in a run's way SHALL be left out with the reason that tracks only go round the outside.

#### Scenario: Chain past a crossbar
- **WHEN** the three drive sprockets of the motor-sprocket scenario and Flop's 2x20 Beam, which crosses the top run just past the 16 Tooth, are selected, and the user picks Under for the beam
- **THEN** the top run dips under the beam as it leaves the 16 Tooth, no link overlaps the beam, the chain still has 65 links and sits in all three sprockets, and Over is refused because the 16 Tooth would no longer touch the chain

#### Scenario: Obstacle clear of the chain
- **WHEN** a Double Offset Corner Connector inside the loop, a few millimetres clear of both runs, is selected with the same sprockets
- **THEN** it isn't asked about, the chain is built as without it, and the reply says it isn't in the chain's way

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
- **WHEN** Flop's three drive sprockets are selected without the 2x20 Beam that crosses the top run
- **THEN** the Build menu hover text and the MCP reply name the beam as in the way of the run leaving the 16 Tooth, the chain is still built, and selecting the beam and choosing Under builds the chain clear of it
