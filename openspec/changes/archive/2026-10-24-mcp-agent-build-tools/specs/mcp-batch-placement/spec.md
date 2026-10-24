## Purpose

Lets an agent build an assembly in a few MCP calls: place a list of parts at once, try a layout without saving it, place parts by inserting them into holes instead of computing positions, and mirror one side onto the other, all with short replies.

## ADDED Requirements

### Requirement: Place a list of parts in one call
The server SHALL offer a `place_parts` tool that takes `parts`, a list of items. Each item has a `partQuery`, an optional `ref` (a name that later items in the same call can point to), `label` and `color`, and either an absolute `position` (mm) and `rotation` (Euler XYZ degrees) or an `insert` (see "Place by inserting into a hole"). Items SHALL be processed in order. The whole list SHALL be checked together, and the assembly saved once. An item that overlaps another part SHALL still be placed, marked as overlapping, as `place_part` does today, unless `rejectIntersecting: true` is given; then nothing is saved and the reply says which items overlapped. An item that can't be resolved (unknown part, bad ref, missing port) SHALL make the whole call fail without saving, naming the item and the reason.

#### Scenario: Forty parts at once
- **WHEN** an agent calls `place_parts` with 40 items at absolute positions
- **THEN** all 40 are added, the assembly is saved once, and the reply lists each item's ref, new instance id and status

#### Scenario: Unknown part in the list
- **WHEN** item 7 of 20 names a part that doesn't exist
- **THEN** nothing is added and the reply says item 7's part was not found

#### Scenario: Reject overlaps
- **WHEN** `rejectIntersecting` is true and two items overlap each other
- **THEN** nothing is saved and the reply names both items and what they overlap

### Requirement: Short replies with one audit
The `place_parts` reply SHALL contain, per item, only its ref (or index), instance id, label, status (`placed` or `overlapping`) and what it overlaps. Once for the whole call, it SHALL also contain the audit summary:
- whether the assembly is mechanically sound;
- counts of overlaps, floating and half-seated fasteners, unsecured parts and disconnected groups;
- driven and undriven wheels;
- the names of the parts behind any problem.

Full positions and rotations SHALL be included only with `verbose: true`.

#### Scenario: Reply size
- **WHEN** 65 parts are placed without problems
- **THEN** the reply has one short line per part plus one audit summary, and no per-part position or rotation arrays

### Requirement: Check without saving
With `dryRun: true`, `place_parts` SHALL do everything it does normally, including inserting, mirroring, overlap checks and the audit of the resulting assembly, and return the same reply, but SHALL NOT change the saved assembly or the app. The reply SHALL say it was a dry run. Item positions and rotations SHALL be included in a dry-run reply so the agent can read the computed poses.

#### Scenario: Try a layout
- **WHEN** an agent calls `place_parts` with `dryRun: true` for a drivetrain
- **THEN** the reply shows the overlaps and audit for the assembly with those parts added, and `get_assembly` afterwards shows the assembly unchanged

### Requirement: Place by inserting into a hole
An item's `insert` SHALL say which of the item's own features goes into which opening:
- `sourcePort`: the item's pin, peg, shaft or opening (port id), defaulting to its main shaft, peg or bore;
- `into`: an existing `instanceId` or an earlier item's `ref`, and that part's `port`;
- optional `rollDeg` around the shared axis;
- optional `fromSide` (`+` or `-` along the target opening's axis), defaulting to the open side for a blind opening and `+` for a through one.

The server SHALL line the two axes up, start the item just outside the opening on that side, and move it straight in until it first touches another part. This uses the same contact rule as double-click mating: the flush stop, the stop when nothing is touched, and backing off so the saved pose never overlaps. A pin or shaft SHALL go through to the far side of a through opening if nothing stops it sooner. The reply SHALL say what the item stopped against, or that it stopped flush with the far face.

#### Scenario: Pin into a beam
- **WHEN** an item inserts a 0x2 Connector Pin's peg into hole_3 of a placed 1x6 Beam from the `+` side
- **THEN** the pin ends seated with its cap on the beam face, and the reply says it stopped against the beam

#### Scenario: Shaft into the motor
- **WHEN** an item inserts a 4x Pitch Capped Shaft into a Smart Motor's drive socket
- **THEN** the shaft goes in until it touches the socket bottom, and the motor and shaft are seated together

#### Scenario: Wheel onto an earlier item
- **WHEN** item 2 inserts a wheel hub's bore over the shaft from item 1 (`into: { ref: 'axle', port: 'shaft' }`)
- **THEN** the hub slides on along the shaft until it touches the next part

#### Scenario: Nothing to hit
- **WHEN** a plain shaft is inserted into a lone beam's through hole
- **THEN** it stops with its leading end flush with the beam's far face

### Requirement: Mirror in the same call
`place_parts` SHALL accept `mirror: { plane: 'X' | 'Y' | 'Z', offsetMm }`. When given, every item SHALL also be placed as its exact mirror image across that plane: every pin, peg, shaft and opening of the mirrored part lands where the mirror image of the original's would be. This is possible for any part that is symmetric across some plane of its own. A part with no such plane (a left- or right-handed part) SHALL get the closest pose `mirror_subassembly` would choose, marked `mirrorApproximate` in the reply. An item that is its own mirror image (for example a plate centered on the plane) SHALL be placed once, not doubled. Mirrored items SHALL be labeled from the original (for example "Left Rail" becomes "Right Rail" when the label contains Left or Right, otherwise "(mirror)" is added). They SHALL be checked and audited with the rest. A mirrored insert SHALL mirror the final pose of its original, not be inserted again.

#### Scenario: Build one side, get both
- **WHEN** an agent places the left half of a drivetrain with `mirror: { plane: 'Z', offsetMm: 0 }`
- **THEN** the right half is placed as its mirror image, the motors face the right way, and the audit covers both halves

#### Scenario: Corner connector stays right side up
- **WHEN** a corner connector whose flange is on top is mirrored across Z
- **THEN** the mirrored connector's flange is also on top, so pins above it still go into its holes

#### Scenario: Part on the mirror plane
- **WHEN** a plate centered on z = 0 is in a call with `mirror: { plane: 'Z', offsetMm: 0 }`
- **THEN** only one plate is placed
