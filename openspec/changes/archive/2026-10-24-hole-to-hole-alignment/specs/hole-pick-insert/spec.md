## MODIFIED Requirements

### Requirement: Starting and leaving hole picking
Hole picking SHALL start when the user double-clicks a selected part that has no mate directions and has at least one pin, peg or shaft (see pin-mating). It SHALL also start, alongside the mate arrows, when the part's mate directions come only from hole-to-hole pairs and its pins, pegs or shafts line up with nothing. Then clicking an arrow mates along it and ends picking, and clicking a highlighted hole inserts and removes the arrows. It SHALL NOT start for a locked part or in Explode view (the existing messages apply).
While picking:
- a banner SHALL name the part and the controls (point at a hole, wheel or `R` for other fits, click to insert, `Esc` to cancel);
- the move/rotate gizmo SHALL be hidden;
- the camera SHALL still orbit, pan and zoom, except that the wheel steps through fits while a hole is highlighted;
- the part SHALL stay where it is until a hole is clicked.

Picking SHALL end without changing anything when the user presses `Esc`, clicks where no hole is highlighted, selects another part (in the viewport or the Outliner), changes Move/Rotate mode, turns Explode view on, or when the selected part is changed or removed by undo, redo, the timeline or MCP.

#### Scenario: Start
- **WHEN** a 0x2 Connector Pin is selected far from any beam and the user double-clicks it
- **THEN** the banner appears, the gizmo is hidden, and nothing moves

#### Scenario: Cancel
- **WHEN** the user is picking and presses `Esc`
- **THEN** the banner and preview go away, the gizmo comes back, and the history has no new step

#### Scenario: Picking alongside an arrow
- **WHEN** a corner connector whose holes line up with a beam (pegs lined up with nothing) is double-clicked
- **THEN** the picking banner appears together with the stacking arrow
