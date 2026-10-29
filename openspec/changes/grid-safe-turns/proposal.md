## Why

Turning a free part in Rotate mode can push its holes off the pitch grid, and after that nothing puts them back. In the current scene the Robot Brain with Battery was turned 90° about its bounding-box centre, which on that part sits 2.7 mm from its hole grid. The turn moved the brain 2.7 mm in X and Z, so its side holes no longer lined up with the eight brain pins. Every later drag kept the offset: pitch steps count from where the drag started, and hole snap only closes a 1 mm sideways miss while dragging along the pins' line. The brain could only be fitted by typing its position.

## What Changes

- **A free part turns about a point on its own hole grid.** That point is the one nearest the bounding-box centre that sits on the same half-pitch (6.35 mm) grid as the part's holes: a hole centre, a point midway between two holes, or the centre of four holes, whichever is closest. A 90° turn (or any multiple) then leaves every hole on that grid. A part with no holes, or one tilted so its holes don't run along the world axes, keeps turning about its bounding-box centre.
- **Hole snap closes a bigger sideways miss when a pattern agrees.** While dragging, the miss that can be closed straight across rises from 1 mm to 3.5 mm when two or more pins, shafts or holes of the moving part all line up with the same offset. A single pair keeps the 1 mm limit.
- **A lined-up part slides along the line into place.** After a hole pull has lined a part up, if a pitch step leaves it pressed into the parts it is going onto, it slides along the line (up to a quarter pitch) to the nearest spot where nothing overlaps; when it is held between parts on both sides, it goes to the middle. What looks lined up now drops into place, which matters for kids building with it. Alt still turns every hole pull off for exact placement.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `rotate-mode`: "Free part turns around its center" turns about the nearest point on the part's hole grid instead of the exact bounding-box centre.
- `drag-hole-snap`: "Pins and shafts pull onto matching holes" and "Holes pull onto other parts' holes" allow a 3.5 mm sideways settle when two or more pairs agree; new requirement "A lined-up part slides along the line into a clear spot".

## Impact

- `src/components/Viewport3D.jsx`: `refreshRotateSetup` picks the free-part pivot from the part's hole lines; `snapDragToHoles` also returns the line it snapped to, and the drag handler slides the part along it when it overlaps.
- `src/utils/pinHoleAlignment.js`: new pure `gridPivot(features, center)`; `findHoleSnap` / `moveOntoLine` take the settle limit and count pairs that agree; new pure `clearSpotAlongLine`.
- `scripts/check-pin-hole-alignment.mjs`: cases for both.
- The current scene isn't changed by this; the brain still needs moving to `[0, 69.7, 0]` once.
