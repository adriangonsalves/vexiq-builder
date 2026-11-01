# chain-track-builder Specification

## Purpose
Lets the user wrap a chain (VEX IQ Chain Links) or a tank track (Tank Tread Attachment Links, with optional Traction Link rubber grippers) round two or more sprockets in one step, grouped as one component.

## Requirements

### Requirement: Build menu
The toolbar SHALL have a **Build** menu, next to the Select menu, with the items **Chain builder** and **Track builder**. Both items SHALL be available only when the selection holds two or more sprockets that can carry one chain (see "Which sprockets can carry a chain"); otherwise they SHALL be greyed out and their hover text SHALL say what is missing (for example "Select two or more sprockets in one plane"). Standoffs in the selection SHALL take part as chain guides (see "Standoffs as chain guides") but SHALL NOT count toward the two sprockets. Other parts in the selection that are neither sprockets nor standoffs SHALL be ignored. The menu SHALL be unavailable while the history shows an earlier point (preview), as other edits are.

#### Scenario: Two sprockets selected
- **WHEN** a 16 Tooth Sprocket and a 32 Tooth Sprocket on parallel axles in one plane are selected and the user opens the Build menu
- **THEN** Chain builder and Track builder can be picked

#### Scenario: One sprocket selected
- **WHEN** only one sprocket is selected and the user opens the Build menu
- **THEN** both items are greyed out and their hover text asks for two or more sprockets

#### Scenario: One sprocket and a standoff
- **WHEN** one sprocket and one standoff are selected and the user opens the Build menu
- **THEN** both items are greyed out and their hover text asks for two or more sprockets

#### Scenario: Spur gears selected
- **WHEN** two 36 Tooth Gears are selected and the user opens the Build menu
- **THEN** both items are greyed out and their hover text says chain and track fit sprockets, not gears

### Requirement: Which sprockets can carry a chain
Selected sprockets and standoff guides SHALL carry one chain only when their axles are parallel (within 2°) and the chain's plane passes through them: sprockets' tooth rings within 1 mm of the same plane along the axle, and each standoff's body reaching across that plane. No two of them SHALL overlap (centres closer than the sum of their outer radii). The chain SHALL go round the outside of the set, touching each part on its outer boundary. A selected part inside that outer loop, between two of its runs, is **enclosed**: for a chain it SHALL be wrapped as the user chooses (see "Over or under an enclosed part"); for a track it SHALL be left out and named in the message with the reason that tracks only go round the outside. A selected sprocket on the outer loop is **crossing** when a straight run between its neighbours (the outer loop without it) would pass through it; for a chain it SHALL also be wrapped as the user chooses, and for a track it SHALL stay on the outside without asking. A standoff on the outer loop SHALL never be asked about; standoffs are asked about only when enclosed. Parts that aren't selected SHALL never join the chain. Fewer than two sprockets on the loop SHALL be refused with a message.

#### Scenario: Sprocket out of plane
- **WHEN** two sprockets are selected whose axles are parallel but one sits 6 mm further along its axle
- **THEN** the Build menu items are greyed out and their hover text says the sprockets are not in one plane

#### Scenario: Enclosed sprocket with a chain
- **WHEN** three sprockets in a row on one beam are selected, the middle one smaller than the outer two and below the line joining their tops, and the user picks Chain builder
- **THEN** the app asks whether the chain goes over or under the middle sprocket before building

#### Scenario: Sprocket inside the loop
- **WHEN** the same three sprockets are selected and the user picks Track builder
- **THEN** the track wraps the two outer sprockets and the message names the middle one as left out because tracks only go round the outside

#### Scenario: Crossing sprocket with a chain
- **WHEN** a 16 Tooth, a 40 Tooth and a 24 Tooth Sprocket are selected, the 24 Tooth between the other two along the chain and higher, its centre 3.7 mm past the straight run joining the 16 Tooth and the 40 Tooth, and the user picks Chain builder
- **THEN** the app asks whether the chain goes over or under the 24 Tooth before building

#### Scenario: Corner sprocket clear of the run
- **WHEN** three sprockets set out in a wide triangle are selected, so no straight run between two of them would touch the third, and the user picks Chain builder
- **THEN** the chain is built round all three without asking

#### Scenario: Standoff on the outer loop
- **WHEN** two sprockets and a standoff sticking out past the run between them are selected and the user picks Chain builder
- **THEN** the chain wraps the outside of the standoff without asking

#### Scenario: Standoff out of reach
- **WHEN** two sprockets and a 0.5x Pitch Standoff are selected and the standoff ends 3 mm short of the chain's plane
- **THEN** the Build menu items are greyed out and their hover text says the standoff doesn't reach the chain

### Requirement: Wrap a chain
Chain builder SHALL place a closed loop of `Chain Link` parts round the parts on the loop. On each sprocket the links' pivots SHALL sit on its pitch circle at its tooth gaps; on a standoff the links SHALL rest on its round body; between parts the links SHALL run in straight lines along the lines that touch both parts. A part wrapped from inside the loop (the outer parts) and a part wrapped from outside the loop (an enclosed part the chain bends round) SHALL both be touched on the side the chain passes. Sprockets with different tooth counts SHALL be wrapped the same way. Every link SHALL be in the parts' plane, facing the same way as its neighbours, with its outer side away from the inside of the loop. Each sprocket on the loop SHALL be turned about its axle, together with every part that turns with it (its axle and parts seated on that axle), so its teeth sit between the chain's pivots; standoffs SHALL NOT be turned. A slack chain SHALL hang on a run between two outer parts (the lower or upper such run, as the user picks; see "Whole number of links"); only when every run touches an enclosed part SHALL the longest run take the slack. Where the chain rests on a standoff a link MAY turn as far as the round post makes it (it has no teeth to spread the bend), but no link SHALL cut into the standoff's body; everywhere else the no-kink rule of "Whole number of links" holds. No link SHALL sit inside any selected sprocket's pitch circle (in its teeth), on any run. When no upper run can hang the slack without a kink (a short or steep run would fold it), the upper run SHALL NOT be offered and the slack SHALL hang on the lower run. The new links SHALL NOT count as overlapping the parts they wrap or one another.

#### Scenario: Two sprockets, different sizes
- **WHEN** an 8 Tooth Sprocket and a 24 Tooth Sprocket are selected and the user picks Chain builder
- **THEN** a closed chain of Chain Links wraps both sprockets, curving round each at its own size, with two straight runs between them

#### Scenario: Three sprockets in a triangle
- **WHEN** three sprockets set out in a triangle are selected and the user picks Chain builder
- **THEN** one chain goes round all three, with three straight runs

#### Scenario: Standoff on the outside
- **WHEN** two sprockets and a standoff that sticks out past the line joining their tops are selected and the user picks Chain builder
- **THEN** the chain's top run passes over the standoff, resting on its body, and the standoff is not turned

### Requirement: Whole number of links
A chain SHALL be made of a whole number of links (VEX IQ links are all alike, so odd counts are fine). A chain can't stretch, so the builder SHALL use the fewest links that reach all the way round: never more than 0.75 mm shorter than the path (the play in its joints), and at most one link longer. Links SHALL stay 6.35 mm apart (eased by at most 0.2 mm per link). Every run but one SHALL be straight. A chain longer than the path SHALL hang on one run as a catenary sagging toward the floor (world −Y): the run facing the floor, or the run facing up (hanging down into the loop) when the user picks the upper run; when the sprockets lie flat it SHALL sag outward on the longest run instead. When the hanging run would drop 1 mm or more below its straight line and the sprockets stand up, Chain builder and Track builder SHALL ask which run holds the slack (Lower run or Upper run, remembered while the page is open); otherwise Chain builder SHALL build without asking. A hanging run SHALL leave and meet its sprockets where it bends least, and no link SHALL sink into a sprocket's teeth. No link SHALL turn more than a tooth step of the smallest loop sprocket, so the chain has no kinks where a run meets a sprocket. The message SHALL say how much longer or shorter the true path is and which sprocket to move and by how much for an exact fit, and when the chain is more than half a link longer it SHALL say it will sag.

#### Scenario: Exact fit
- **WHEN** two 16 Tooth Sprockets are 8 pitches apart (101.6 mm) and the user picks Chain builder
- **THEN** the chain is built with the path's exact number of links (48) and the message reports no gap

#### Scenario: Never too tight
- **WHEN** the path round two sprockets is 3 mm longer than 48 links
- **THEN** the chain is built with 49 links, 3.35 mm longer than the path, the bottom run hangs in a smooth curve toward the floor while the top run stays straight, and the message names the sprocket to move about 1.7 mm away for an exact fit

#### Scenario: Slack on the upper run
- **WHEN** the path round two standing sprockets is 3 mm longer than 48 links and the user picks Chain builder, then **Upper run**
- **THEN** 49 links are built, the bottom run is straight and the top run hangs down into the loop, lowest near the middle

#### Scenario: A little slack on a long run
- **WHEN** the chain is 0.74 mm longer than the path round three standing sprockets with a 140 mm run
- **THEN** the builder asks where the slack goes, since that run would droop about 10 mm

#### Scenario: Nothing to ask
- **WHEN** the chain fits snugly (no run droops 1 mm), or the sprockets lie flat
- **THEN** Chain builder builds without asking where the slack goes

#### Scenario: Within the chain's play
- **WHEN** the path round two sprockets is 0.3 mm longer than 48 links
- **THEN** the chain is built with 48 links and the message reports 0.3 mm short, with no sag

#### Scenario: Just inside the chain's play
- **WHEN** the path round three sprockets is 0.55 mm longer than 65 links
- **THEN** the chain is built with 65 links, straight on every run, with no sag

### Requirement: Wrap a track with rubber grippers
Track builder SHALL first ask, in a small dialog, which **attachment** to plug into the tread links (None, Traction Link, Short Intake Flap, Medium Intake Flap or Long Intake Flap; default Traction Link) and, unless None, **every** how many tread links, with a slider from 1 to 20 (default 1, every link); both SHALL be remembered for the next time while the page is open. It SHALL then build the outer loop as Chain builder does, with `Tank Tread, Attachment Link` parts in place of Chain Links (they share the Chain Link's pivots). A track SHALL only go round the outside of sprockets and standoffs: it SHALL NOT ask about or bend round enclosed parts, and each enclosed part SHALL be left out and named in the message as left out because tracks only go round the outside. The chosen attachment SHALL be plugged into the two holes of every Nth tread link round the loop (links 0, N, 2N, …), facing the outer side of the loop, so the pads or flaps point away from the sprockets all round; when the link count isn't a multiple of N, the last gap SHALL be shorter and the message SHALL say so. With None, the track SHALL be tread links only. Attachments SHALL count as held by their tread links, SHALL NOT be collisions with them, and SHALL come apart with the track in Explode. Canceling the dialog SHALL build nothing.

#### Scenario: Track with grippers
- **WHEN** two 24 Tooth Sprockets are selected, the user picks Track builder, leaves Traction Link and every 1 and picks Build
- **THEN** a loop of Tank Tread Attachment Links wraps the sprockets with a Traction Link in every link, all facing outward

#### Scenario: Intake flaps every 4th link
- **WHEN** the user picks Track builder, chooses Long Intake Flap and sets the slider to 4
- **THEN** a Long Intake Flap sits in every 4th tread link, pointing out of the loop, and the message names the flaps and the spacing

#### Scenario: Track without grippers
- **WHEN** the user picks Track builder and chooses None
- **THEN** only Tank Tread Attachment Links are placed and the slider isn't shown

#### Scenario: Track over a standoff
- **WHEN** two sprockets and a standoff on the outer loop are selected and the user builds a track
- **THEN** the track's inner face rests on the standoff and the grippers face away from it

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
The audit SHALL count each link of a chain or track group as held: its links are joined to one another in a loop and the loop to every sprocket it wraps, for the connectivity check (no islands) and for the unpinned-parts check. Traction Links SHALL count as held by the tread links they plug into. Links touching the sprockets or standoffs they wrap (from inside or outside the loop), neighbouring links, and grippers in their links SHALL NOT be reported as collisions. A chain group whose links no longer sit on any sprocket (for example after a sprocket was moved) SHALL be reported as unsecured.

#### Scenario: Clean audit with a chain
- **WHEN** a build whose sprockets are on held axles gets a chain from Chain builder and the user runs the audit
- **THEN** the audit reports no unpinned chain links, no islands from the chain and no collisions between the chain and its sprockets

#### Scenario: Chain bent round an idler
- **WHEN** a chain is built under an enclosed sprocket and over a standoff, and the user runs the audit
- **THEN** the audit reports no collisions between the chain and that sprocket or standoff

#### Scenario: Sprocket moved away
- **WHEN** the user moves a sprocket 20 mm away after building a chain round it, and runs the audit
- **THEN** the audit reports the chain's links as no longer seated on that sprocket

### Requirement: Build a chain over MCP
The MCP server SHALL offer a `build_chain` tool that takes `kind` (`chain` or `track`), the parts' `instanceIds` (sprockets and standoffs; default: the current selection), `route` (chain only: an object mapping each enclosed part's and crossing sprocket's instance id to `"over"` or `"under"`), `attachment` (track only: `"none"`, `"traction"`, `"short-flap"`, `"medium-flap"` or `"long-flap"`, default `"traction"`), `attachmentEvery` (track only, 1 to 20, default 1), `grippers` (track only, the older form: `false` is `"none"`, `true` is `"traction"` every 1) and an optional group `name`. It SHALL follow the same rules as the Build menu and produce the same parts, group and single history step, and SHALL refuse with the same messages. A chain call with an enclosed part or crossing sprocket missing from `route` SHALL build nothing and reply with each such part's id and label and that it needs `"over"` or `"under"`. Its reply SHALL give the group id and name, the link and attachment counts, the parts on the loop and how each enclosed part was wrapped, any left out and why, the length gap in mm, the sprockets it turned, and the usual placement check summary.

#### Scenario: Track over MCP
- **WHEN** a client calls `build_chain` with `kind: "track"` and two sprocket ids
- **THEN** the app shows a new "Track N" group with grippers, and the reply lists the link and gripper counts and the gap

#### Scenario: Gears refused over MCP
- **WHEN** a client calls `build_chain` with two spur gear ids
- **THEN** the call fails with a message that chain and track fit sprockets, not gears

#### Scenario: Route missing over MCP
- **WHEN** a client calls `build_chain` with `kind: "chain"` for three sprockets in a row whose middle one is enclosed, and no `route`
- **THEN** nothing is built and the reply names the middle sprocket as needing `"over"` or `"under"`

#### Scenario: Route given over MCP
- **WHEN** the client calls again with `route: { "<middle id>": "under" }`
- **THEN** the chain is built with its top run passing under the middle sprocket, and the reply says the middle sprocket is wrapped under

### Requirement: Standoffs as chain guides
A selected standoff SHALL act as a smooth round guide for a chain or track when its axle is parallel to the sprockets' (within 2°) and its body reaches across the chain's plane. The links SHALL rest on its body (their pivots one link-half-height out from its surface) at any angle, since it has no teeth. A standoff on the outer loop SHALL be wrapped like a sprocket; an enclosed standoff SHALL be handled as any enclosed part. A selected standoff that is not parallel or doesn't reach the chain's plane SHALL make the Build menu items greyed out with hover text naming it and the reason.

#### Scenario: Chain resting on a standoff
- **WHEN** a chain is built over a 1x Pitch Standoff on the outer loop
- **THEN** the links touching the standoff rest on its round body with no gap and no overlap

#### Scenario: Standoff at an angle
- **WHEN** two sprockets and a standoff whose axle is at 90° to theirs are selected
- **THEN** the Build menu items are greyed out and their hover text says the standoff's axle isn't parallel to the sprockets'

### Requirement: Over or under an enclosed part
When Chain builder is picked and the selection has enclosed parts or crossing sprockets, the app SHALL open a dialog listing each of them by name before building. While a part's row is focused or hovered, that part SHALL be highlighted in the 3D view; the first part SHALL be highlighted when the dialog opens. Each row SHALL offer two choices, **Under** and **Over**, with no default, and a hint saying which one wraps round the part's outside:
- for an enclosed part, **Under**: the run above the part bends down and passes under it; **Over**: the return run below the part bends up and passes over it;
- for a crossing sprocket that sticks out above the run it crosses, **Over** wraps round its top as the outer loop does, and **Under** keeps that run below it, passing under it; for one that sticks out below, **Under** wraps round its bottom and **Over** keeps the run above it.
"Above" SHALL mean the in-plane direction of world up (+Y); when the parts lie flat (the plane's normal within 17° of world Y), it SHALL mean toward world −Z. The Build button SHALL be available only when every listed part has a choice. Canceling SHALL build nothing. The highlight SHALL end when the dialog closes. The choices SHALL be remembered per part while the page is open and offered again next time. Several enclosed parts on the same run SHALL all be wrapped by that run, in order along it.

#### Scenario: Ask about an enclosed sprocket
- **WHEN** two 24 Tooth Sprockets and an 8 Tooth Sprocket between them, inside the loop, are selected and the user picks Chain builder
- **THEN** a dialog lists the 8 Tooth Sprocket with Over and Under, the 8 Tooth Sprocket is highlighted, and Build stays unavailable until one is picked

#### Scenario: Under
- **WHEN** the user picks Under for the 8 Tooth Sprocket and Build
- **THEN** the chain's top run dips down, wraps round the underside of the 8 Tooth Sprocket and rises back to the next sprocket, and the 8 Tooth Sprocket is turned so its teeth sit in the chain

#### Scenario: Over
- **WHEN** the user picks Over instead
- **THEN** the chain's bottom run rises, wraps round the top of the 8 Tooth Sprocket and drops back, and the top run stays straight

#### Scenario: Enclosed standoff
- **WHEN** two sprockets and a standoff inside the loop are selected and the user picks Chain builder
- **THEN** the dialog lists the standoff and highlights it, and after Under the top run rests on the underside of the standoff

#### Scenario: Unselected part inside the loop
- **WHEN** a standoff inside the loop is not selected
- **THEN** the dialog doesn't list it and the chain doesn't touch it

#### Scenario: Under a crossing sprocket
- **WHEN** the user picks Under for the 24 Tooth Sprocket in "Crossing sprocket with a chain" and Build
- **THEN** the top run passes beneath the 24 Tooth, touching it from below, and the chain still wraps the 16 Tooth and the 40 Tooth

#### Scenario: Over a crossing sprocket
- **WHEN** the user picks Over instead
- **THEN** the chain wraps round the top of the 24 Tooth, as it does without asking today

### Requirement: Say why a chain can't be built
When the chosen parts and route can't make a chain, nothing SHALL be built and the message SHALL name the part involved and the reason. At least these cases SHALL be refused with their reason:
- a run, as bent, would pass through a selected part it doesn't wrap;
- a bent run would touch or cross another run of the same chain;
- an enclosed part is chosen so that an outer sprocket or standoff would no longer touch the chain;
- an enclosed part is too close to an outer part for the chain to pass between them.
The Build menu hover text and the MCP reply SHALL use the same reasons.

#### Scenario: Bent run hits another part
- **WHEN** two enclosed standoffs sit one above the other, the user picks Under for the upper one and Over for the lower one, and they are so close that the two bent runs would meet
- **THEN** nothing is built and the message says the chain's runs would touch between those two standoffs

#### Scenario: Outer sprocket loses the chain
- **WHEN** an enclosed sprocket sits so low that bending the top run under it would lift the chain off an outer sprocket
- **THEN** nothing is built and the message names the outer sprocket as no longer touching the chain with that route
