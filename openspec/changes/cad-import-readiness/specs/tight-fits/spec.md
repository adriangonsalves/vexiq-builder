## Purpose

Tells small contacts apart from real overlaps, so builds taken from official CAD (which has many contacts of a few tenths of a millimetre) are not flagged everywhere, and makes sure a flagged part is never deleted without the user acting on it.

## ADDED Requirements

### Requirement: Tight fits are not overlaps
When two parts' solids meet, the check SHALL test them again with each part's surface pulled in a further 0.5 mm. If they no longer meet, the contact SHALL be a **tight fit**: the part is not marked as overlapping, and the contact is reported as a tight fit with the other part's label. If they still meet, it SHALL be an overlap as today. Every place that checks overlaps SHALL use this rule: placing and moving parts in the app, `place_part`, `place_parts` (including dry runs and inserts), `update_part`, `mate_parts`, Fix assembly and `audit_assembly`. Insert and mating moves SHALL still stop at first contact as they do today; the rule only changes what counts as overlapping after a part is placed.

#### Scenario: Pivot standoff 0.53 mm off its hole
- **WHEN** a 0.5x Pitch Standoff passes through two beams' holes and its axis is 0.53 mm off the third beam's hole it also passes through
- **THEN** it is placed without an overlap flag, and the reply and the audit list a tight fit between the standoff and that beam

#### Scenario: Real overlap
- **WHEN** a 2x12 Beam is placed exactly on top of another 2x12 Beam
- **THEN** both are reported as overlapping, not as a tight fit

### Requirement: Flagged parts stay put unless the user is placing them
A part marked as overlapping SHALL be moved back to its last clean pose, or removed when it has none, only when it is the part the user is placing or dragging in the app at that moment (a library drop, a drag, a hole-pick insert, a copy or clone the user is placing). Selecting, deselecting, adding another part, undo, redo, the history timeline and app sync SHALL NOT move back or remove any other flagged part. A part placed or changed by MCP, by CAD import, or brought back by undo or redo SHALL keep its pose and its overlap flag until it is moved, fixed or removed. The Inspector SHALL keep showing the overlap warning and what the part overlaps.

#### Scenario: MCP part survives a click
- **WHEN** `place_parts` places a brain that overlaps a beam, and the user then clicks another part in the app
- **THEN** the brain stays where it was placed, still marked as overlapping, and no "Cancel placement" history step is made

#### Scenario: User's own drop still snaps back
- **WHEN** the user drops a beam from the library onto another beam so they overlap, and then clicks elsewhere
- **THEN** the dropped beam is removed as today, with a "Cancel placement" step
