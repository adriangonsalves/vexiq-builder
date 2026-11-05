## Purpose

Gives every library part a complete, stable list of connection points (holes, bores, sockets, pegs and shaft axes), so an agent can say "this point of this part goes into that point of that part" and the audit can check every joint.

## ADDED Requirements

### Requirement: Every face's holes are indexed
The part index SHALL list every pin hole, square hole and socket that opens on any face of a part, including electronics (Smart Motor, Bumper Switch, Touch LED, Robot Brain, Robot Battery, Color, Distance, Gyro and Touch sensors), not only the holes found on a part's main faces today. A Mini Standoff Connector's bore SHALL be listed as a pin hole. Points listed today SHALL stay listed.

#### Scenario: Bumper Switch top holes
- **WHEN** the VEX IQ Bumper Switch's connection points are listed
- **THEN** they include the four holes on its top face at ±6.35 mm, ±6.35 mm, opening upward, as well as the holes on its base listed today

#### Scenario: Mini Standoff Connector
- **WHEN** a 1x1 Connector Pin is pushed into a Mini Standoff Connector's bore
- **THEN** the pin counts as seated in a pin hole of the connector

### Requirement: Shafts have an axis
Every shaft (plain, capped and motor shafts) SHALL have a shaft connection point: its axis, its two ends, its cross-section (square or round), and for a capped or motor shaft which end has the cap or stop ring.

#### Scenario: 4x Pitch Motor Shaft
- **WHEN** the 4x Pitch Motor Shaft's connection points are listed
- **THEN** there is one shaft point along its length with both end positions, a square cross-section, and the stop ring marked at its short end

### Requirement: Attachments have pegs
Intake flaps, traction links and other parts that plug into tread links SHALL list their pegs, matching the holes they go into on a Tank Tread Attachment Link.

#### Scenario: Long Intake Flap
- **WHEN** the Long Intake Flap's connection points are listed
- **THEN** it has two pegs that line up with the two attachment holes of a Tank Tread Attachment Link when the flap is in its track-builder seat

### Requirement: Stable ids with aliases
Every connection point SHALL have an id built from its kind, the face it opens on and its position in quarter pitches, so the same point keeps the same id when parts are indexed again (for example `hole.+z.4_-2_0`: a pin hole opening on the +Z face at 4, -2, 0 quarter pitches). Each point SHALL also keep the id it has today as an alias. Every tool and action that takes a port id SHALL accept either form, and replies SHALL give the stable id. Ids SHALL be unique within a part.

#### Scenario: Old id still works
- **WHEN** an agent inserts a pin into a 2x20 Beam's `hole_14`
- **THEN** the insert works as before, and the reply names the hole by its stable id

#### Scenario: Re-index keeps ids
- **WHEN** the part index is built again after an unrelated part is added to the library
- **THEN** every existing point of the 2x20 Beam has the same stable id as before

### Requirement: Facts for every point
Each connection point SHALL give its kind, local position and axis, the face it opens on (or both faces for a through hole), its shape (round, square, socket, or the shaft's cross-section), its measured depth, and its pitch position.

#### Scenario: Smart Motor socket
- **WHEN** the Smart Motor's drive socket is listed
- **THEN** it is a square socket opening on the front face, 8.6 mm deep, as in VEX's current Smart Motor model
