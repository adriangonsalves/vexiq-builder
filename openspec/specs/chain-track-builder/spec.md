# chain-track-builder Specification

## Purpose
Lets the user wrap a chain (VEX IQ Chain Links) or a tank track (Tank Tread Attachment Links, with optional Traction Link rubber grippers) round two or more sprockets in one step, grouped as one component.

## Requirements

### Requirement: Build menu
The toolbar SHALL have a **Build** menu, next to the Select menu, with the items **Chain builder** and **Track builder**. Both items SHALL be available only when the selection holds two or more sprockets that can carry one chain (see "Which sprockets can carry a chain"); otherwise they SHALL be greyed out and their hover text SHALL say what is missing (for example "Select two or more sprockets in one plane"). Parts in the selection that are not sprockets SHALL be ignored. The menu SHALL be unavailable while the history shows an earlier point (preview), as other edits are.

#### Scenario: Two sprockets selected
- **WHEN** a 16 Tooth Sprocket and a 32 Tooth Sprocket on parallel axles in one plane are selected and the user opens the Build menu
- **THEN** Chain builder and Track builder can be picked

#### Scenario: One sprocket selected
- **WHEN** only one sprocket is selected and the user opens the Build menu
- **THEN** both items are greyed out and their hover text asks for two or more sprockets

#### Scenario: Spur gears selected
- **WHEN** two 36 Tooth Gears are selected and the user opens the Build menu
- **THEN** both items are greyed out and their hover text says chain and track fit sprockets, not gears

### Requirement: Which sprockets can carry a chain
Selected sprockets SHALL carry one chain only when their axles are parallel (within 2°) and their tooth rings lie in one plane (centres within 1 mm of the same plane along the axle). No two of them SHALL overlap (centres closer than the sum of their outer radii). The chain SHALL go round the outside of the sprockets, touching each sprocket on the outer boundary of the set; a selected sprocket that the loop doesn't touch SHALL be left out of the chain and named in the message. Fewer than two sprockets on the loop SHALL be refused with a message.

#### Scenario: Sprocket out of plane
- **WHEN** two sprockets are selected whose axles are parallel but one sits 6 mm further along its axle
- **THEN** the Build menu items are greyed out and their hover text says the sprockets are not in one plane

#### Scenario: Sprocket inside the loop
- **WHEN** three sprockets in a row on one beam are selected, the middle one smaller than the outer two and below the line joining their tops and bottoms
- **THEN** the chain wraps the two outer sprockets and the message names the middle one as not touched by the chain

### Requirement: Wrap a chain
Chain builder SHALL place a closed loop of `Chain Link` parts round the sprockets on the loop. On each sprocket the links' pivots SHALL sit on its pitch circle at its tooth gaps; between sprockets the links SHALL run in straight lines along the lines that touch both sprockets. Sprockets with different tooth counts SHALL be wrapped the same way. Every link SHALL be in the sprockets' plane, facing the same way as its neighbours. Each sprocket on the loop SHALL be turned about its axle, together with every part that turns with it (its axle and parts seated on that axle), so its teeth sit between the chain's pivots. The new links SHALL NOT count as overlapping the sprockets they wrap or one another.

#### Scenario: Two sprockets, different sizes
- **WHEN** an 8 Tooth Sprocket and a 24 Tooth Sprocket are selected and the user picks Chain builder
- **THEN** a closed chain of Chain Links wraps both sprockets, curving round each at its own size, with two straight runs between them

#### Scenario: Three sprockets in a triangle
- **WHEN** three sprockets set out in a triangle are selected and the user picks Chain builder
- **THEN** one chain goes round all three, with three straight runs

### Requirement: Whole number of links
A chain SHALL be made of a whole number of links (VEX IQ links are all alike, so odd counts are fine). A chain can't stretch, so the builder SHALL use the fewest links that reach all the way round: never more than 0.75 mm shorter than the path (the play in its joints), and at most one link longer. Links SHALL stay 6.35 mm apart (eased by at most 0.2 mm per link). Every run but one SHALL be straight. A chain longer than the path SHALL hang on one run as a catenary sagging toward the floor (world −Y): the run facing the floor, or the run facing up (hanging down into the loop) when the user picks the upper run; when the sprockets lie flat it SHALL sag outward on the longest run instead. When the chain is more than half a link longer than the path and the sprockets stand up, Chain builder and Track builder SHALL ask which run holds the slack (Lower run or Upper run, remembered while the page is open); otherwise Chain builder SHALL build without asking. A hanging run SHALL leave and meet its sprockets where it bends least, and no link SHALL sink into a sprocket's teeth. No link SHALL turn more than a tooth step of the smallest loop sprocket, so the chain has no kinks where a run meets a sprocket. The message SHALL say how much longer or shorter the true path is and which sprocket to move and by how much for an exact fit, and when the chain is more than half a link longer it SHALL say it will sag.

#### Scenario: Exact fit
- **WHEN** two 16 Tooth Sprockets are 8 pitches apart (101.6 mm) and the user picks Chain builder
- **THEN** the chain is built with the path's exact number of links (48) and the message reports no gap

#### Scenario: Never too tight
- **WHEN** the path round two sprockets is 3 mm longer than 48 links
- **THEN** the chain is built with 49 links, 3.35 mm longer than the path, the bottom run hangs in a smooth curve toward the floor while the top run stays straight, and the message names the sprocket to move about 1.7 mm away for an exact fit

#### Scenario: Slack on the upper run
- **WHEN** the path round two standing sprockets is 3 mm longer than 48 links and the user picks Chain builder, then **Upper run**
- **THEN** 49 links are built, the bottom run is straight and the top run hangs down into the loop, lowest near the middle

#### Scenario: Nothing to ask
- **WHEN** the chain fits within half a link, or the sprockets lie flat
- **THEN** Chain builder builds without asking where the slack goes

#### Scenario: Within the chain's play
- **WHEN** the path round two sprockets is 0.3 mm longer than 48 links
- **THEN** the chain is built with 48 links and the message reports 0.3 mm short, with no sag

#### Scenario: Just inside the chain's play
- **WHEN** the path round three sprockets is 0.55 mm longer than 65 links
- **THEN** the chain is built with 65 links, straight on every run, with no sag

### Requirement: Wrap a track with rubber grippers
Track builder SHALL first ask, in a small dialog, whether to add rubber grippers (a checkbox, remembered for the next time while the page is open), then build the same loop as Chain builder with `Tank Tread, Attachment Link` parts in place of Chain Links (they share the Chain Link's pivots). With grippers on, a `Traction Link` SHALL be plugged into the two holes of every tread link, its pad on the outer side of the loop, so the grippers face away from the sprockets all round. With grippers off, the track SHALL be tread links only. Canceling the dialog SHALL build nothing.

#### Scenario: Track with grippers
- **WHEN** two 24 Tooth Sprockets are selected, the user picks Track builder, leaves "Add rubber grippers" ticked and picks Build
- **THEN** a loop of Tank Tread Attachment Links wraps the sprockets with a Traction Link in every link, all facing outward

#### Scenario: Track without grippers
- **WHEN** the user picks Track builder and unticks "Add rubber grippers"
- **THEN** only Tank Tread Attachment Links are placed

### Requirement: Chain and track as one group and one step
The links (and grippers) a builder places SHALL be made into one new group named "Chain N" or "Track N", using the next free number for that kind, and the group SHALL be selected. The sprockets SHALL NOT join the group. Placing the parts, grouping them and turning the sprockets SHALL be one history step, labeled with what was built (for example "Chain builder: 48 Chain Links round 2 sprockets"); one undo SHALL remove the whole chain or track and turn the sprockets back. The action message SHALL say how many parts were placed and any gap or left-out sprocket.

#### Scenario: Undo a track
- **WHEN** the user builds a track with grippers and presses undo once
- **THEN** every tread link and gripper of that track is gone and the sprockets are back at their earlier turn

#### Scenario: Group in the Outliner
- **WHEN** the user builds a chain in a build that has no other chain
- **THEN** the Outliner shows a folder "Chain 1" holding the new Chain Links, and the sprockets stay outside it

### Requirement: Sprocket tooth measurements
Every sprocket in the parts library SHALL have measured tooth data: its tooth count, pitch radius for VEX IQ chain (6.35 mm between pivots), the angle of a tooth gap about its axle, and the axial span of its teeth. The chain builder SHALL use these measured values. `get_part_details` SHALL report them.

#### Scenario: Pitch radius of a 16 Tooth Sprocket
- **WHEN** a client asks `get_part_details` for the 16 Tooth Sprocket
- **THEN** its tooth data shows 16 teeth and a pitch radius of about 16.27 mm

### Requirement: Chain and track in the audit
The audit SHALL count each link of a chain or track group as held: its links are joined to one another in a loop and the loop to every sprocket it wraps, for the connectivity check (no islands) and for the unpinned-parts check. Traction Links SHALL count as held by the tread links they plug into. Links touching the sprockets they wrap, neighbouring links, and grippers in their links SHALL NOT be reported as collisions. A chain group whose links no longer sit on any sprocket (for example after a sprocket was moved) SHALL be reported as unsecured.

#### Scenario: Clean audit with a chain
- **WHEN** a build whose sprockets are on held axles gets a chain from Chain builder and the user runs the audit
- **THEN** the audit reports no unpinned chain links, no islands from the chain and no collisions between the chain and its sprockets

#### Scenario: Sprocket moved away
- **WHEN** the user moves a sprocket 20 mm away after building a chain round it, and runs the audit
- **THEN** the audit reports the chain's links as no longer seated on that sprocket

### Requirement: Build a chain over MCP
The MCP server SHALL offer a `build_chain` tool that takes `kind` (`chain` or `track`), the sprockets' `instanceIds` (default: the current selection), `grippers` (track only, default true) and an optional group `name`. It SHALL follow the same rules as the Build menu and produce the same parts, group and single history step, and SHALL refuse with the same messages. Its reply SHALL give the group id and name, the link and gripper counts, the sprockets on the loop and any left out, the length gap in mm, the sprockets it turned, and the usual placement check summary.

#### Scenario: Track over MCP
- **WHEN** a client calls `build_chain` with `kind: "track"` and two sprocket ids
- **THEN** the app shows a new "Track N" group with grippers, and the reply lists the link and gripper counts and the gap

#### Scenario: Gears refused over MCP
- **WHEN** a client calls `build_chain` with two spur gear ids
- **THEN** the call fails with a message that chain and track fit sprockets, not gears
