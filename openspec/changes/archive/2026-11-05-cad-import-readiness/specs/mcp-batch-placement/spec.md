## ADDED Requirements

### Requirement: Port ids in inserts
An `insert`'s `sourcePort` and `into.port` SHALL accept a connection point's stable id or its alias (see connection-points). The reply SHALL name the ports used by their stable ids. An id that matches no point on the part SHALL fail the call as a missing port does today, and the reply SHALL list the part's stable ids.

#### Scenario: Insert by stable id
- **WHEN** an item inserts a 30 Degree Corner Connector's peg into a Bumper Switch's top-face hole by its stable id
- **THEN** the connector is seated in that hole and the reply names both points by their stable ids

### Requirement: Tight fits in placement replies
A `place_parts` item whose only contacts are tight fits (see tight-fits) SHALL have status `placed` and a `tightFits` list naming the other parts. It SHALL NOT be rejected by `rejectIntersecting`.

#### Scenario: Tight-fit item with rejectIntersecting
- **WHEN** `rejectIntersecting` is true and one item only tight-fits against a beam
- **THEN** the call saves, and that item is `placed` with the beam in its `tightFits`
