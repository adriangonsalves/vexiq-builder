## Purpose

Lets one copy of a part carry its own shape (a bent sheet now; wires, rubber bands and ropes later), and makes every part of the app and the MCP server use that shape instead of the catalog model.

## ADDED Requirements

### Requirement: A part copy can carry its own shape
A part copy in a build SHALL be able to hold a shape: a named kind (the first is a bent sheet) and that kind's settings. A copy with no shape SHALL behave exactly as before. Only part types that a shape kind accepts SHALL take that kind (a bent sheet: the 2x12, 6x6 and 6x12 Plastic Sheets). The shape SHALL be described in the part's own frame, so moving or turning the part moves its shape with it.

#### Scenario: Plain part unchanged
- **WHEN** a build with no shaped parts is loaded, edited and saved
- **THEN** it is saved and drawn exactly as before this change

#### Scenario: Shape moves with the part
- **WHEN** a bent sheet is moved 20 mm and turned 90°
- **THEN** its curve, holes and pins move and turn with it, and its bend is unchanged

#### Scenario: Wrong part type
- **WHEN** a bent-sheet shape is given to a beam
- **THEN** it is refused, saying that only plastic sheets can be bent

### Requirement: Everything uses the shaped part
For a copy with a shape, the viewport, overlap checks, the tight-fit check, measurements, hole positions and directions, the audit, pin seating and hole snapping, explode, screenshots and the MCP server SHALL all use the shaped part, not the catalog model. Two copies of the same part with different shapes SHALL each show and collide as their own shape.

#### Scenario: Pin in a bent row
- **WHEN** a sheet pin is put into a hole in a bent part of a sheet
- **THEN** it seats along that hole's bent direction and the audit counts it as seated

#### Scenario: Overlap on the bent part
- **WHEN** a beam is placed through the curved part of a bent sheet
- **THEN** the overlap check reports the beam and the sheet, and the same beam placed where the flat sheet would have been but the bent sheet is not reports no overlap

#### Scenario: Two sheets, two shapes
- **WHEN** a build has two 6x12 sheets, one flat and one bent
- **THEN** each is drawn and overlap-checked as its own shape

### Requirement: Shapes are saved, copied and in history
A shape SHALL be saved with the build, in starters and in library builds; copied with the part on copy, paste, duplicate and mirror (mirroring flips the shape with the part); recorded in build history as its own change ("Bend" in the timeline); and undone and redone like any other change. Removing a shape SHALL be a change too.

#### Scenario: Undo a bend
- **WHEN** a sheet is bent and the user presses Undo
- **THEN** the sheet is flat again with its holes back where they were, and Redo bends it again

#### Scenario: Reload
- **WHEN** a build with a bent sheet is saved and opened again, in the app or the static site
- **THEN** the sheet is bent the same way

### Requirement: Shape kinds can be added
Each shape kind SHALL be defined in one place that gives: which part types it accepts, how its settings are checked, the shaped mesh and holes from the catalog model and the settings, and a short description for the inspector and the MCP server. Drawing, overlap checks, saving, history and the MCP server SHALL work for a new kind without changes of their own.

#### Scenario: Shape kinds listed
- **WHEN** the MCP server describes a shaped part
- **THEN** it gives the shape's kind, its settings and its description, the same way for every kind
