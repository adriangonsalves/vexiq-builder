## Purpose

Lets the user run the library's ropes on a build the way real VEX IQ rope is used: each end tab held on a pin, shaft or spool, the cord passing over pulleys and round parts, and spare rope wound on a spool. The user sees how much rope the route uses, how much is spare and how many turns are on the spool.

## ADDED Requirements

### Requirement: Rope parts
These library parts SHALL be ropes: the 12x, 20x, 24x, 48x and 120x Pitch Rope.

Each rope SHALL have these sizes, measured from its own model:
- its **length**, from the hole of one end tab to the hole of the other (292.1 mm for the 24x Pitch Rope: 23 pitches);
- its **cord thickness** (about 1.2 mm);
- its **end tab**: the flat moulded piece at each end with one round hole.

A rope does not stretch. Each rope part SHALL offer only its two tab holes as connection points, and SHALL be centred on its own middle.

A rope copy with no route SHALL stay the straight rope it is today, and its tab holes SHALL take pins as any hole does. A rope copy with a route SHALL be drawn as a round cord along its path at its measured thickness, with an end tab at each held end, in its own colour.

#### Scenario: Straight rope still places
- **WHEN** the user drags a 24x Pitch Rope from the library into the view
- **THEN** it is placed as the straight rope it is today, with no route

#### Scenario: Length from the model
- **WHEN** the app reads the 24x Pitch Rope
- **THEN** its length is 292.1 mm, hole to hole

#### Scenario: Only the tab holes connect
- **WHEN** the user looks at the connection points of a 12x, 20x, 48x or 120x Pitch Rope
- **THEN** it has two, one in each end tab, and none on the cord

### Requirement: Spool parts
The 1x Wide Spool and the 2x Wide Spool SHALL be spools. Each SHALL have:
- a **square bore** that a square shaft fits and turns, so the spool belongs to that shaft's group;
- a **pocket** in one end, round the shaft's line, where one rope end tab sits with the shaft through the tab's hole;
- a **drum** between its two flanges that rope winds on, with a width, a core radius (7.5 mm) and a flange radius (12.55 mm), measured from its model.

How much rope fits SHALL follow from those sizes: the turns in one layer are the drum's width divided by the cord thickness, each further layer sits one cord thickness further out, and layers stop at the flange.

A spool SHALL be placed on a shaft as other square-bore parts are. A spool with no shaft SHALL still take a rope, but the audit SHALL say the rope end in its pocket isn't held.

#### Scenario: Spool on a shaft
- **WHEN** the user places a 2x Wide Spool on a 4x Pitch Shaft
- **THEN** it seats on the shaft by its square bore and turns with the shaft in Play mode

#### Scenario: Turns that fit
- **WHEN** the app reads the 2x Wide Spool, whose drum is about 21 mm wide
- **THEN** about 17 turns of rope fit in its first layer, each about 51 mm of rope

### Requirement: Where a rope end goes
Each end of a routed rope SHALL be one of:
- **on a post:** the tab's hole on the round shank of a pin or connector pin, on a standoff's body, or on a shaft past the parts on it. The tab SHALL sit at the place along the post the user points at, flat against the nearest part on that post, and SHALL be free to turn on it;
- **in a pocket:** the tab in a spool's pocket, on the spool's shaft;
- **free:** held by nothing.

An end SHALL be named by its part and its feature in that part's own frame, so it moves and turns with the part. A post already filled along its whole free length, or covered by another part, SHALL NOT be offered. A pocket that already holds a rope SHALL NOT be offered.

A rope SHALL have at least one held end. A rope with one free end SHALL hang straight down from its last spot.

#### Scenario: End on a shaft
- **WHEN** the user picks the free part of Swish's catapult arm shaft, beside its Rubber Shaft Collar, as a rope's end
- **THEN** the tab is drawn on the shaft against the collar, with the shaft through its hole

#### Scenario: End in a spool
- **WHEN** the user picks a 2x Wide Spool as a rope's first end
- **THEN** the tab is drawn in the spool's pocket and the cord leaves through the flange

#### Scenario: Pocket taken
- **WHEN** a spool's pocket already holds a rope and the user starts another rope
- **THEN** that spool's pocket is not offered as an end

#### Scenario: Free end
- **WHEN** the user picks a spool as the first end and finishes without picking a second end
- **THEN** the rope is placed with its far end hanging straight down from the spool

### Requirement: Spots a rope passes
Between its ends a rope SHALL touch only **spots**, each one feature of one part:
- **groove:** a pulley's groove (the .5x Pitch Idler Pulley and the 10, 20, 30 and 40 mm Pulleys);
- **post:** a standoff's body, a pin's shank, or a shaft's free end;
- **edge:** a rounded end or a straight edge of a beam, plate or bracket;
- **drum:** a spool's drum, when the rope's end is in that spool's pocket.

These SHALL be the same spots, with the same names, that rubber bands use, plus the spool's drum. A rope SHALL NOT use tooth gaps or rims.

A rope SHALL be able to pass any number of spots, in the order given, on any number of different parts. A route of at least 12 spots SHALL work. The same spot MAY be on a route more than once; a later pass SHALL lie beside the earlier one along the groove or post, or one cord thickness further out when there is no room beside it.

The rope SHALL go round each groove and post one way or the other (its **side**):
- when the user taps a groove or post, the side SHALL be the side of it they tapped;
- when no side is given (over MCP, or by Rope between these), the side SHALL be the one facing away from the middle of the spots before and after it, which is the side a rope pulled tight would press on;
- the user SHALL be able to flip the side of any spot afterwards.

The side SHALL be kept as the way the rope turns round the spot's own axis, so it stays the same when a free pulley spins. A rope MAY wrap a groove or post more than once (1 to 3 times).

#### Scenario: Idler pulley
- **WHEN** the user points at a .5x Pitch Idler Pulley while routing a rope
- **THEN** its groove lights up as one spot

#### Scenario: Three pulleys on three parts
- **WHEN** the user taps a pin on the chassis, an idler pulley on an arm, a second idler pulley on a tower, a third on the chassis, and a pin on a slider
- **THEN** the rope passes all three grooves in that order, each on the side tapped

#### Scenario: Same pulley twice
- **WHEN** a route names one pulley's groove twice, with another pulley between
- **THEN** the rope passes that groove twice, the second pass lying beside the first

#### Scenario: Side by default
- **WHEN** `place_rope` is given a pin below a pulley, the pulley's groove with no side, and a second pin below it
- **THEN** the rope goes over the top of the pulley

#### Scenario: Flip a side
- **WHEN** the user flips the side of a pulley in the middle of a route
- **THEN** the rope goes round the other side of that pulley, and its used length updates

#### Scenario: Round a beam's end
- **WHEN** the user clicks a beam's rounded end between a rope's two ends
- **THEN** the rope bends round that end and nowhere else on the beam

### Requirement: How a rope's path is found
A rope's path SHALL follow from its **route**: its first end, its spots in order with the side and wraps for each, its second end, and its winding (turns and direction) when an end is in a spool.

The rope SHALL run from each spot to the next the shortest clear way, as a tight string would, bending only on spots in its route and on the outer corners of parts between them, by the same rule rubber bands follow. Unlike a band, a rope SHALL run one way only, from one end to the other, never back.

A part no way round clears SHALL be reported, and the rope SHALL NOT be placed through it.

#### Scenario: Straight between two ends
- **WHEN** a rope's route is a spool's pocket and a shaft 220 mm away with nothing between
- **THEN** the rope runs straight from the drum to the shaft

#### Scenario: Over a pulley
- **WHEN** a rope's route is a pin, an idler pulley's groove above it, and a second pin below and to one side
- **THEN** the rope runs up from the first pin, over the top of the groove, and down to the second pin

#### Scenario: Round a part in the way
- **WHEN** a beam lies across the straight line between a rope's two ends
- **THEN** the rope bends round the beam's nearest clear corner, and the beam is added to the route as a bend

### Requirement: Rope length, spare and slack
A rope's **used length** SHALL be the length of its path from end to end. Its **spare** SHALL be its length minus its used length.

- A rope shorter than its route SHALL be refused, with the shortest rope that fits named.
- Spare on a rope with an end in a spool SHALL be wound on that spool (see "Winding on a spool").
- Spare that isn't wound SHALL be **slack**: the rope SHALL be drawn sagging downward by that much along its longest free run, and the panel and Inspector SHALL give the slack in millimetres.
- **Choose for me** SHALL pick the shortest rope that fits the route. When the route ends in a spool, it SHALL pick the shortest rope that fits with at least one full turn on the spool.

#### Scenario: Rope too short
- **WHEN** the user chooses a 12x Pitch Rope (139.7 mm) for a route 225 mm long
- **THEN** the rope is refused and the message names the 20x Pitch Rope as the shortest that fits

#### Scenario: Slack with no spool
- **WHEN** a 24x Pitch Rope is routed pin, pulley, pin along a path 270 mm long
- **THEN** it is placed with 22 mm of slack, drawn sagging on its longest run, and the panel says "22 mm slack"

#### Scenario: Choose for me on a winch
- **WHEN** the route runs from a 2x Wide Spool to a shaft 225 mm away and the size is Choose for me
- **THEN** the 24x Pitch Rope is used, with its spare wound on the spool

### Requirement: Winding on a spool
A rope with an end in a spool's pocket SHALL carry its **turns** (how many times it goes round the drum) and its **winding direction** (which way round).

- With no turns, the rope SHALL leave the drum straight toward its next spot.
- Each turn SHALL take up one drum circumference of rope at its layer's radius. Turns SHALL lie side by side across the drum, starting at the pocket's end, and start a new layer when a layer is full.
- When a rope is placed, all its spare SHALL be wound, to the nearest quarter turn below; what is left SHALL be slack.
- The user SHALL be able to set fewer turns, down to none, with the rest becoming slack, and to flip the winding direction.
- More turns than the spare allows, or than the drum holds, SHALL NOT be offered.

The coils SHALL be drawn on the drum.

#### Scenario: Swish's rope wound
- **WHEN** a 24x Pitch Rope runs from Swish's 2x Wide Spool to the arm shaft along a path about 225 mm long
- **THEN** about 67 mm is spare, the rope is placed with 1.25 turns on the drum, and the coils are drawn beside the pocket

#### Scenario: Fewer turns
- **WHEN** the user steps that rope's turns down from 1.25 to 0.25
- **THEN** one turn's length (about 51 mm) becomes slack and is drawn sagging

#### Scenario: Flip winding
- **WHEN** the user flips the winding direction of a rope with one turn on its spool
- **THEN** the rope goes round the drum the other way and leaves it from the other side

#### Scenario: Long rope, second layer
- **WHEN** a 120x Pitch Rope is wound on a 2x Wide Spool
- **THEN** the turns past the first full layer are drawn in a second layer on top of it

### Requirement: Rope builder
**Tools → Rope builder** SHALL start rope picking in the 3D view, with a panel listing the five rope lengths and **Choose for me** (the size until the user picks one).

While picking:
- The single end or spot nearest the pointer SHALL light up, with its name ("spool pocket", "pin", "groove").
- A click or tap SHALL add it. The first SHALL be the rope's first end. Each one after SHALL be a spot the rope passes, until the user finishes. Clicking a spool after the first end SHALL make its pocket the second end and finish.
- **Done** or **Enter** SHALL finish. If the last thing added is a post, it SHALL become the rope's second end; otherwise the second end SHALL be free.
- **R** or the mouse wheel SHALL step to the next nearby spot and **Shift+R** to the one before. The panel SHALL have **Next** and **Back** buttons that do the same, so no keyboard is needed.
- **Backspace** or the panel's **Undo last** SHALL take off the last one added. **Esc** or **Cancel** SHALL leave without changing the build.
- After the first end, a see-through rope SHALL show the route the rope would really take, bends round parts included, to the lit spot or the pointer.

The panel SHALL show, as the route grows: the rope's length, the used length, and the spare as turns on the spool or millimetres of slack. When a rope would be too short it SHALL say so and name the one that fits. When the route has a spool, the panel SHALL show a **Turns on spool** stepper and a **Flip winding** switch. Each spot in the panel's list SHALL have a **Flip side** button and a wraps control.

Every control SHALL work by tap on a tablet or phone, with touch targets as large as the Band builder's. Finishing SHALL be one history step named for the rope and its ends, for example "Rope: 24x from Spool to Arm shaft".

#### Scenario: Winch rope in three taps
- **WHEN** the user opens Rope builder, taps Swish's 2x Wide Spool, taps the catapult arm's shaft, and taps Done
- **THEN** a 24x Pitch Rope is added from the spool's pocket to the shaft with its spare wound, as one history step, and one undo removes it

#### Scenario: Lift rope over a pulley
- **WHEN** the user taps a pin on Huey's claw carriage, the idler pulley on the middle stage, a pin on the fixed stage, and Done
- **THEN** a rope is added from the first pin over the pulley to the second pin, and the panel gives its slack

#### Scenario: Block and tackle
- **WHEN** the user taps a pin on a fixed beam, a pulley on a hanging block, a pulley on the fixed beam, a second pulley on the block, a second pulley on the fixed beam, then a spool, and taps Done
- **THEN** one rope is added through all four pulleys in that order, ending in the spool's pocket with its spare wound

#### Scenario: No keyboard
- **WHEN** a user on a tablet taps a crowded spot and the wrong one lights up
- **THEN** tapping **Next** in the panel steps to the next nearby spot

#### Scenario: Cancel
- **WHEN** the user has tapped two spots and taps Cancel
- **THEN** the build is unchanged and no history step is added

### Requirement: Rope between selected parts
With exactly two parts selected, at least one of them able to hold a rope end, the context toolbar and Tools menu SHALL offer **Rope between these**. It SHALL place a rope from the first part's nearest end spot to the second's, choosing the size as Choose for me does, and bending round parts in the way.

#### Scenario: Spool and shaft selected
- **WHEN** the user selects a spool and a shaft and chooses Rope between these
- **THEN** a rope is placed from the spool's pocket to the shaft, as one history step

### Requirement: Editing a rope
A selected routed rope SHALL show a handle at each end and each spot. Dragging a handle to another end place or spot SHALL move it there and route the rope again, as one history step. Dragging an end's handle off every part SHALL make that end free.

The Inspector SHALL show for a routed rope: its size, used length, spare, slack, each end and spot, and, with a spool, **Turns on spool** and **Flip winding**. Changing them SHALL be one history step each.

**Tools → Flatten** SHALL take a rope off its route and leave it as a straight rope at the same place.

#### Scenario: Move an end
- **WHEN** the user drags a rope's end handle from one pin to another pin
- **THEN** the rope ends on the second pin, its used length and spare update, and one undo puts it back

#### Scenario: Flatten
- **WHEN** the user selects a routed rope and chooses Flatten
- **THEN** it becomes a straight rope with no route

### Requirement: Ropes follow their parts
When a part a rope is on moves, turns, is hidden or is removed (in the app, over MCP, or by an action), the rope SHALL be routed again in the same history step:
- turns on its spool SHALL be kept, and the change in used length SHALL go to slack first;
- if the route grows past the rope's length with no slack left, turns SHALL come off the spool to make up the length;
- if the rope is still too short, it SHALL stay on its route, drawn in the warning colour and marked "too short by N mm";
- an end whose part is removed SHALL become free; a rope left with no held end SHALL go back to a straight rope, with a message.

#### Scenario: Arm moved away
- **WHEN** the part holding a rope's far end is moved 30 mm further from the spool and the rope has 1.25 turns wound
- **THEN** the rope follows it, about 30 mm comes off the spool, and the step is one undo

#### Scenario: Moved too far
- **WHEN** a part is moved so the route is 20 mm longer than the rope with nothing left on the spool
- **THEN** the rope is drawn in the warning colour, marked "too short by 20 mm", and the audit lists it

#### Scenario: Pin removed
- **WHEN** the pin holding a rope's second end is deleted
- **THEN** that end becomes free and the rope hangs from its last spot

### Requirement: Mirror and duplicate carry ropes
Duplicating or mirroring a selection that holds a rope and the parts of its route SHALL give the copy its own rope on the copied parts. A mirrored rope SHALL wind the mirrored way round its spool. A rope copied without the parts of its route SHALL be a straight rope.

#### Scenario: Mirror a lift
- **WHEN** the user mirrors the left side of Huey's lift, rope included, to the right side
- **THEN** the right side has its own rope from its pin, over its pulley, to its pin

### Requirement: Saving ropes
A rope's route, turns, winding direction and path SHALL be saved with the build, in starters, the build library and history, and SHALL be restored exactly on load. A saved route that names a part or feature no longer present SHALL load with that end free, or as a straight rope when no end is left, with a message. A build saved before ropes had routes SHALL open unchanged.

#### Scenario: Reload a build
- **WHEN** a build with Swish's wound rope is saved and opened again
- **THEN** the rope is on the same ends with the same turns

#### Scenario: Ratchet winch starter
- **WHEN** the user opens File → Starter → Ratchet winch
- **THEN** its 24x Pitch Rope has one end in the spool's pocket, is wound on the drum, and its other end hangs free

### Requirement: Ropes in the audit
The audit SHALL treat a routed rope as follows:
- a rope with a held end SHALL count as held, not as a loose part;
- a rope end on a post or in a pocket, and coils on a drum, SHALL NOT be reported as overlaps;
- a rope too short for its route, a rope end in the pocket of a spool with no shaft, and a rope path that passes through a part SHALL each be listed.

#### Scenario: Clean winch
- **WHEN** the audit runs on a winch with a rope wound on its spool and ending on a shaft
- **THEN** the rope is not listed as loose and nothing about it is listed as an overlap

### Requirement: Rope over MCP
The MCP server SHALL have a `place_rope` tool taking:
- `ropePartId` (or an existing rope's `instanceId`; left out, the size is chosen as Choose for me does);
- `from` and `to`, each `{ instanceId, feature }`, where `feature` names a post (`post:body`, `post:pin`), a spool's `pocket`, or `free` (`to` may be left out, meaning free);
- `via`, an ordered list of any length of `{ instanceId, feature, turn, wraps }` naming grooves, posts and edges as `place_band` names them, where `turn` is `1` or `-1` (which way the rope goes round the spot's own axis) and may be left out for the default side;
- optional `turns` and `winding` (`"over"` or `"under"`), when an end is in a spool;
- optional `allowShort`, to place a rope too short for its route anyway.

With `from` and no `list`, it SHALL place or route the rope again, bending round parts in the way as the app does, and return its length, used length, spare, slack, turns, the `turn` it used at each spot and the bends it added. A rope too short SHALL be refused with the size that fits. With `list: true`, or with only an `instanceId`, it SHALL change nothing and return the end places and spots within reach, named as the tool takes them.

`get_assembly` and `get_part_details` SHALL report a rope's route, used length, spare, slack and turns. The browser's MCP tools SHALL offer the same tool.

#### Scenario: Winch rope over MCP
- **WHEN** `place_rope` is called with `from` Swish's spool `pocket` and `to` the arm shaft's `post:body`
- **THEN** a 24x Pitch Rope is placed, and the reply gives its used length, spare and turns

#### Scenario: List the spots on a spool
- **WHEN** `place_rope` is called with only a spool's instance id and `list: true`
- **THEN** it returns the spool's `pocket` and `drum`, and changes nothing

#### Scenario: Too short over MCP
- **WHEN** `place_rope` is called with a 12x Pitch Rope and a route 225 mm long
- **THEN** nothing is placed and the reply names the rope that fits
