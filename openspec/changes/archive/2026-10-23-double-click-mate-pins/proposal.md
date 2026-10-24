## Why

The aligned-hole highlighting shows when a pin or shaft lines up with a hole, but the user still has to drag the part the rest of the way in and watch for the flush stop. Once the rings are showing, the app already knows where the part should go, so a double-click should finish the joint. Parts with pins pointing different ways (for example the Triple 2x Wide, 2x2 Corner Connector, with pins along +X and +Z) can line up in more than one direction at once, so the user needs a way to pick which one.

## What Changes

- Double-clicking the selected part, while at least one of its pins or shafts lines up with an opening (rings showing), mates it: the part moves straight along the shared axis until it touches the receiving part (pin cap or shoulder against the face, shaft against the bottom of the motor socket). It works both ways, matching the highlighting: a pin or shaft goes into another part's opening, or a beam or gear moves onto pins or shafts already placed.
- Before moving, the part is shifted sideways by the small amount needed (up to 0.25 mm) so the pin or shaft is exactly on the opening's axis.
- If nothing stops the move (a plain shaft sliding through beams and gears, or a gear sliding along a shaft), the part stops when the leading end is flush with the far face of the last lined-up opening in that direction.
- If the part can mate in more than one direction, double-click shows one large arrow per direction instead of moving. Clicking an arrow mates that way. The arrows go away on Esc, on clicking anywhere else, on starting a drag, or when the selection changes.
- **Pins only project and mate the way they stick out.** Today a pin's highlight line runs through the part's body, so a corner connector also lights holes on its body side. Each pin end is now checked against the part's 3D model; an end buried in the body projects nothing. Double-ended pins (connector pins) keep both directions, and shafts are unchanged. This narrows the existing highlighting slightly.
- The result goes through the same path as a drag release: position saved, synced to the server, and the rings update. Short feedback appears in the existing action message area ("Mated with 1x6 Beam", "Nothing lined up to mate with", "Can't mate: already touching").

Assumptions recorded for review:
- Only translation along the axis plus the tiny sideways correction; the part is never rotated (the 2° alignment tolerance is left as is).
- Double-click on a locked part, in Explode view, or with no lined-up openings does nothing except the feedback message.
- If several openings line up in the same direction, they are mated together in one move (for example a pin through two stacked beams).
- There is no undo in the app today; this change does not add one.

## Capabilities

### New Capabilities
- `pin-mating`: Double-click to mate the selected part with the parts its pins or shafts line up with: direction choice with arrows, where the move stops, sideways correction, feedback, and how the result is saved.

### Modified Capabilities
- `aligned-hole-highlighting`: the alignment rule gains a direction condition, so a pin only lines up through the end that sticks out of its part.

## Impact

- `src/utils/pinHoleAlignment.js`:
  - which pin ends stick out, measured once per part from the 3D model;
  - grouping the lined-up pairs into mate directions;
  - how far a mate may travel.
- `src/components/Viewport3D.jsx`:
  - a double-click handler;
  - the direction arrows overlay, with hover and click;
  - a sweep along the chosen direction using the existing BVH collision check and flush-boundary bisection;
  - hiding the gizmo while the arrows are showing.
- `src/App.jsx`: pass a callback for mate feedback into the existing `actionFeedback` message.
- `scripts/check-pin-hole-alignment.mjs`: new cases for which pin ends stick out and for mate directions and travel.
- `features.md` and `design.md` updated.
- No changes to the catalog, the MCP engine, the server API, or the saved state format.
