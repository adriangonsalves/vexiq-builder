## Purpose

Lets the user string the library's rubber bands and belts round the real parts they go on: standoffs, pins, shaft ends, pulleys, beam ends and single tooth gaps of gears and sprockets. The user says exactly which spots a band touches, in what order and on which side, and sees how far it stretches.

## ADDED Requirements

### Requirement: Band parts
These library parts SHALL be bands:
- Silicone Rubber Band #32, #64, Thin #64 and #117B;
- the 2x30 mm Square Silicone Belt;
- the 2x30, 40, 50 and 60 mm Rubber Belts.

Each band's **free length** SHALL be the length round the middle of its unstretched ring, measured from the part's own model. Its **thickness** SHALL also be measured from its model: the size across the band and along the post it sits on.

A band copy with no route SHALL stay the flat ring it is today. A band copy with a route SHALL be drawn as a round band along its path, at its measured thickness, in its own colour.

#### Scenario: Flat band still places
- **WHEN** the user drags a Silicone Rubber Band #32 from the library into the view
- **THEN** it is placed as the flat ring it is today, with no route

#### Scenario: Free length from the model
- **WHEN** the app reads the #117B band
- **THEN** its free length comes from the middle of its modelled ring, about 350 mm

### Requirement: Spots a band can go on
A band SHALL touch only **spots**: features of other parts that a real band can sit on or pass. Each spot SHALL be one feature of one part, never a whole part. The spot types SHALL be:
- **post:** the round body of a standoff, the round shank or head of a pin or connector pin, the round end of a shaft past its hole, or a round axle hub;
- **groove:** a pulley's groove, at its pitch radius;
- **rim:** the outside of a gear or sprocket, touching the tooth tips along the arc it wraps;
- **gap pass:** one tooth gap of a gear or sprocket, which the band goes through from one face of the part to the other;
- **gap hook:** one tooth gap the band is hooked into and leaves from;
- **edge:** a rounded end of a beam, plate or bracket (including a right-angle beam's corner), or a straight edge of one that a band hooks over;
- **anchor hook:** the hook of the Rubber Band Anchor.

A spot SHALL be named by its part and its feature in that part's own frame, so it moves and turns with the part. Gaps SHALL be numbered round each gear or sprocket from its own tooth phase. A spot covered by another part, or not reachable from outside, SHALL NOT be offered.

#### Scenario: Standoff between two sprockets
- **WHEN** the user points at the intake of Hero Bot Swish, where four 0.5x Pitch Standoffs sit between a pair of 24 Tooth Sprockets
- **THEN** each standoff is offered as its own post spot, and each tooth gap of the inner sprocket is offered as its own gap spot

#### Scenario: Pin shank between parts
- **WHEN** the user points at the 0x2 Connector Pin holding Swish's Short Low-Profile Pawl, where its shank shows between the pawl and the beam
- **THEN** the shank is offered as a post spot

#### Scenario: Right-angle beam corner
- **WHEN** the user points at the outer corner of a 2x3 Right Angle Beam
- **THEN** the corner is offered as an edge spot

### Requirement: How a band's path is found
A band's path SHALL follow from its **route**, which is:
- its spots in order round the loop;
- the side it passes each spot on (outside or inside the loop);
- the height it sits at along each post;
- the number of wraps on each spot (1 to 3);
- whether it crosses between two round spots (a figure-8).

**Outside** SHALL mean the band bends round the spot with the spot inside the bend, as a band stretched round a ring of posts does. **Inside** SHALL mean the band bends the other way, with the spot pressing into the loop. This meaning SHALL hold when the route isn't flat.

Between spots the band SHALL run in straight lines. It SHALL leave each round spot where its curve meets the next straight line, and SHALL pass a gap at that gap's centre. A band with more wraps on a spot SHALL go round that spot that many times.

On a smooth post, a band SHALL sit at the height the user picked, slid along the post toward its shortest path until it is stopped by:
- the end of the post;
- a head, shoulder or part on the post;
- another band already on it.

No straight run SHALL pass through a part. A run that would SHALL make that part a spot (see "Parts in the way").

#### Scenario: Two-post spring
- **WHEN** a #117B band's route is Swish's left Catapult Arm standoff, then the 0x3 Connector Pin in the Chassis 2x20 Beam, both outside
- **THEN** the band is a long loop with two straight runs between them, curving round each

#### Scenario: Through a tooth gap
- **WHEN** a #117B band's route on the right side of Swish's intake is the upper front standoff, then the inner 24 Tooth Sprocket's gap in line with it, then the left-side spots, then the gap in line with the upper back standoff, then that standoff
- **THEN** each of the band's two runs leaves its standoff and goes through the named gap, within 2 mm of VEX's CAD

#### Scenario: Two bands on one post
- **WHEN** a second band is added on a standoff that already carries one
- **THEN** it sits beside the first along the standoff, not inside it

### Requirement: Stretch and pull
A band's **stretch** SHALL be the length of its path divided by its free length.

The band SHALL be drawn, and the builder panel SHALL say, in one of four states:
- **slack:** grey, below 1.0;
- **snug:** green, up to 2.0;
- **tight:** amber, up to 3.0;
- **too far:** red, past 3.0.

The panel SHALL show the stretch, for example "1.6×", and the band's pull in newtons at that stretch. When the band is slack or too far, the panel SHALL name the library band or belt whose stretch on the same route would be closest to 1.5×. The thresholds and the pull SHALL be listed as assumed values, so they can be changed in one place.

#### Scenario: Swish arm band
- **WHEN** the two-post route of Swish's catapult arm band is used with a #117B band
- **THEN** it shows snug, at about 1.6×

#### Scenario: Band too small
- **WHEN** the same route is used with a 2x30 mm Square Silicone Belt
- **THEN** it shows too far, in red, and the panel suggests the #117B

### Requirement: Band builder
**Tools → Band builder** SHALL start band picking in the 3D view, with a panel listing the band and belt sizes and **Choose for me**. Choose for me SHALL pick the size closest to 1.5× when the loop is closed.

While picking:
- The single spot nearest the pointer SHALL light up. A gap's label SHALL show its number, for example "gap 7".
- **R** or the mouse wheel SHALL step to the next nearby spot, and **Shift+R** to the one before, so a 3 mm tooth gap can be reached without exact aim.
- A click SHALL add the lit spot to the route, at the height along the post where the pointer is.
- After the first spot, a see-through band SHALL run from the last spot to the pointer, coloured by stretch, and snapped through the lit spot when there is one.
- Clicking the first spot again, **Enter** or **Done** SHALL close the loop once it has two or more spots. Nothing else SHALL close it, so a route can have any number of spots.
- **Backspace** SHALL take off the last spot.
- **Esc** SHALL cancel without changing the build.

Each spot in the route SHALL have on-screen controls in the panel for side (outside or inside), wraps (1 to 3), and, between two round spots next to each other, cross. Hovering a spot in the view SHALL offer the same three controls beside it. Finishing SHALL be one history step labelled with the band and its spots, for example "Band: #117B round 2 spots (Catapult Arm standoff, Chassis pin)".

#### Scenario: Build a two-spot band
- **WHEN** the user picks Band builder, chooses #117B, clicks Swish's arm standoff and then the chassis pin, and presses Enter
- **THEN** the loop closes, the band is added as one history step, and one undo removes it

#### Scenario: Step to a tooth gap
- **WHEN** the pointer is over a 24 Tooth Sprocket's rim, gap 6 is lit, and the user presses R once
- **THEN** gap 7 is lit and the see-through band passes through it

#### Scenario: Flip to inside
- **WHEN** a route has three standoffs and the user sets the middle one to inside
- **THEN** the band goes round that standoff on the inside of the loop and its stretch updates

### Requirement: Routes from a start and an end
When the user has clicked only two spots and presses **Show routes** in the panel, or calls `place_band` without a full route, the app SHALL list the routes between them. Each listed route SHALL:
- touch only spots within reach;
- pass through no part;
- be snug or tight.

The routes SHALL be sorted by fewest spots, then by stretch closest to 1.5×. Each route SHALL be named in words, for example "round Standoff #3, 1.8×". R SHALL step the preview through them, and Enter SHALL keep the one shown. When no route fits, the panel SHALL say why, for example "every route stretches past 3×".

#### Scenario: Pick among routes
- **WHEN** the user clicks a pin on an arm and a pin on the chassis with a standoff partly in the way, and presses Show routes
- **THEN** the panel lists a route round the standoff's near side and one round its far side, the first is previewed, and R shows the second

### Requirement: Parts in the way
When a straight run of a band would pass through a part that is not in the route, the app SHALL ask whether the band goes over or under that part, as Chain builder does. The answer SHALL add that part's nearest spot to the route on the chosen side.

When the run would pass through the solid web of a gear or sprocket, the band SHALL instead go through the tooth gap that gives the shortest path. The gap SHALL be named in the panel, and R SHALL step it to the next gap.

#### Scenario: Default gap
- **WHEN** a band runs from a standoff between two sprockets toward the other side of the robot, and the straight line would cut the inner sprocket's web
- **THEN** it goes through the gap lined up with that standoff, as in VEX's CAD, and the panel names it

### Requirement: Ring close-up
When the route touches a gear, sprocket or pulley, the builder panel SHALL show a flat drawing of that part's face. The drawing SHALL include:
- each tooth gap as a numbered notch;
- each standoff, pin or shaft in or on it as a dot;
- the band's route drawn over it.

Clicking a notch SHALL add or remove that gap in the route, and the band in the view SHALL update at once. Clicking a dot SHALL add or remove that post. With two or more such parts, the panel SHALL let the user switch between them.

#### Scenario: Read the intake route
- **WHEN** Swish's upper intake band is selected and the right inner sprocket is shown in the close-up
- **THEN** the band's route is drawn through the two notches in line with the upper two standoffs, and round those standoffs' dots

### Requirement: Editing a band
When a band is selected:
- A handle SHALL show at each spot. Dragging a handle to another spot SHALL move that spot, with the see-through band shown while dragging.
- Dragging a point on a straight run onto a gear or sprocket rim SHALL add a gap pass there. It SHALL hop gap to gap as the pointer moves along the rim. Dragging it off the rim SHALL take the gap out.
- The Inspector SHALL show the band's size, free length, path length, stretch, pull, and each spot with its side and wraps. It SHALL let the user change the size, side, wraps and cross.

- **Tools → Flatten** SHALL take the band off its route and leave it as a flat ring where it is.
- Move and Rotate SHALL be greyed out for a band with a route, with the hover text "a band follows its spots: drag a handle". Delete SHALL remove it.

Each edit SHALL be one history step.

#### Scenario: Flatten a band
- **WHEN** a routed band is selected and the user picks Tools → Flatten
- **THEN** it becomes a flat ring at its position, in one history step

#### Scenario: Push into a gap
- **WHEN** the user drags the middle of a band's straight run onto a sprocket's rim and lets go over gap 11
- **THEN** the route gains a gap pass at gap 11 and the band goes through it

#### Scenario: Change the size
- **WHEN** the user changes a red 2x30 mm Square Silicone Belt on Swish's arm route to #117B in the Inspector
- **THEN** the band keeps its route, its stretch updates, and it turns green

### Requirement: Bands follow their parts
A band SHALL keep its route when the parts it touches move or turn. Its path SHALL be found again in the same history step as the move. When a part a band touches is removed or hidden, the band SHALL lose that spot. If fewer than two spots are left, it SHALL go back to a flat ring at its last position, and the message SHALL say so. A band SHALL NOT count as overlapping the parts on its route or other bands on the same spot.

#### Scenario: Move the arm
- **WHEN** the user turns Swish's catapult arm 20° on its hinge
- **THEN** the arm bands stay on the arm standoffs and chassis pins, longer, with their stretch updated

#### Scenario: Remove a pin
- **WHEN** the user removes the chassis pin of a two-spot band
- **THEN** the band goes back to a flat ring and the message says it lost a spot

### Requirement: Quick paths
With exactly two parts selected that each have a spot, **Tools → Band between these** SHALL open the Band builder with a route between their nearest spots already set. With two or more pulleys, hubs or sprockets on parallel axles selected, **Tools → Belt round these** SHALL set a route round the outside of all of them. Both SHALL then work like the Band builder.

#### Scenario: Belt round two pulleys
- **WHEN** a 10mm Pulley and a 30mm Pulley on parallel shafts are selected and the user picks Belt round these
- **THEN** the builder opens with a loop round both grooves, previewed with its stretch for the chosen size

### Requirement: Mirror and duplicate carry bands
Duplicate, Clone, copy-insert and library builds SHALL copy a band with its route, pointing at the copies of its parts when they are copied too. A band whose parts aren't all copied SHALL be copied as a flat ring.

Mirror SHALL mirror a band's route onto the mirrored parts. A gap SHALL map to the matching gap on the mirrored gear or sprocket, and inside and outside SHALL be kept.

#### Scenario: Mirror the intake
- **WHEN** the user mirrors the right half of Swish's intake with its bands
- **THEN** the mirrored band passes through the mirrored sprocket's matching gaps

### Requirement: Saving bands
A band's route and path SHALL be saved with the build, in starters, the build library and history, and SHALL be restored exactly on load. A saved route that names a part or feature no longer present SHALL load as a flat ring at its saved position, with a message.

#### Scenario: Reload a build
- **WHEN** a build with Swish's six bands is saved and opened again
- **THEN** all six bands are back on the same spots, with the same stretch

### Requirement: Band over MCP
The MCP server SHALL have a `place_band` tool taking:
- `bandPartId` (or an existing band's `instanceId`);
- `spots`, an ordered list of `{ instanceId, feature, side, wraps, height }`, where `feature` names a post, groove, rim, gap number, edge or anchor hook;
- an optional `cross`.

With two or more spots and no `list`, it SHALL place or reroute the band and return its stretch, pull, path length and any parts in the way. A part in the way that needs an over-or-under answer SHALL be returned as `needsRoute` and nothing placed. With one spot, or with `list: true`, it SHALL change nothing and return:
- the spots within reach of those parts, with their features named as the tool takes them;
- the routes it would list in the app.

`get_assembly` and `get_part_details` SHALL report a band's route, stretch and pull. The browser's MCP tools SHALL offer the same tool.

#### Scenario: List spots on a sprocket
- **WHEN** `place_band` is called with only a 24 Tooth Sprocket's instance id and `list: true`
- **THEN** it returns the sprocket's rim and its 24 gaps, numbered, and the posts on it, and changes nothing

#### Scenario: Route through gaps over MCP
- **WHEN** `place_band` is called with Swish's upper intake route, naming the inner sprocket's gaps in line with the upper standoffs as `gap:<k>` features
- **THEN** the band is placed through those gaps and its stretch is returned

#### Scenario: Two-spot band over MCP
- **WHEN** `place_band` is called with a #117B band and two spots, Swish's arm standoff and the chassis pin
- **THEN** the band is placed and its stretch is returned
