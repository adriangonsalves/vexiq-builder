# edit-responsiveness Specification

## Purpose
Edits that don't move parts (hide, show, colour, select) stay quick on big builds, and having parts selected doesn't slow the view.

## Requirements

### Requirement: Overlap answers reused while parts don't change
When the overlap check runs again, a pair of parts whose world poses, motor hub angles and collision shapes are all unchanged since the pair was last tested SHALL reuse that answer instead of testing the meshes again. Any move, turn, hub turn or change of shape of either part SHALL test the pair again. The stored answers SHALL be cleared when the part catalog changes and SHALL NOT grow past 200,000 pairs. The overlaps marked SHALL be the same as without reuse.

#### Scenario: Hiding a part on a big build
- **WHEN** a robot of several hundred parts is open and the user hides one part
- **THEN** the overlap check reuses the answers for every unchanged pair, the edit finishes without a noticeable pause, and the same parts are marked overlapping as before

#### Scenario: Moving a part tests it again
- **WHEN** a part that was clear is moved into another part
- **THEN** the pair is tested again and both are marked overlapping

### Requirement: Selecting and colouring don't rebuild materials
Changing a part's colour, opacity or selection look SHALL NOT rebuild its material; only a change between solid and see-through SHALL. The selection outline pass and the normal pass SHALL use the same light setup, so having parts selected SHALL NOT cause materials to be rebuilt on every frame.

#### Scenario: View stays smooth with a selection
- **WHEN** parts are selected and the user turns the camera
- **THEN** the view turns as smoothly as with nothing selected, and the selection outline looks the same as before

### Requirement: Library cards not rebuilt on build edits
The part library's cards SHALL be made again only when the list of parts shown or the List/Grid view changes, not when the build is edited.

#### Scenario: Colouring a part
- **WHEN** the user colours a part in the build
- **THEN** the library's cards are not made again, and dragging, clicking to add and tile tips still work
