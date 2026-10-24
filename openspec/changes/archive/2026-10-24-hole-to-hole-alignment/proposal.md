## Why

Holes only pull into line, show rings and mate when one side is a pin or shaft. Much of building is putting two parts with holes against each other first: a corner connector against a beam, two beams stacked, a gear over a beam hole. In those cases nothing lines up on its own. The user has to line the holes up by eye before a pin or shaft can join them.

## What Changes

- **Holes pull into line while dragging.** When a hole of the moving part comes within 3.5 mm (sideways) of a hole on another part, the part is pulled so the two holes share an axis, using the same rules and Alt override as pin/shaft hole snapping:
  - the holes are parallel within 2°;
  - the parts are within 2 pitch of each other along that axis.
- **Which holes pair.** Two holes pair when a shaft fits both: pin holes, shaft bores, the Smart Motor's drive socket and rubber collar holes, in any combination. An axle through a beam into a motor's socket, or through a collar beside a beam, needs those holes in line. A motor held against a beam therefore lines up its mounting holes and its socket with the beam's holes.
- **Rings for lined-up holes.** When a hole of the moving or selected part lines up with a hole of another part and the parts are not yet touching, the other part's hole gets the same orange ring as a pin/shaft pairing, on its face toward the moving part. Once the faces touch, the ring goes away, as it does when a pin enters a hole.
- **Double-click stacks.** Double-clicking the selected part with lined-up holes slides it along their axis until its face sits flat against the other part. It works with the existing direction arrows when there is more than one way, and with pin/shaft pairs in the same direction. The result is ready to pin.
- **Drag snapping gets a spec.** The drag snapping added earlier (pitch steps counted from the drag start, pulling onto pin/shaft holes, the 1 mm settle, Alt) is written up as a new capability together with the hole-to-hole pull.
- **Out of scope:** turning a part to match another part's angle (hole picking does that), and an MCP tool.

## Capabilities

### New Capabilities
- `drag-hole-snap`: snapping while dragging with the Move gizmo. Pitch steps are counted from the drag start, pins/shafts are pulled onto matching holes, holes are pulled onto other parts' holes, small misses are settled, and Alt turns it off.

### Modified Capabilities
- `aligned-hole-highlighting`: adds rings for holes that line up with the moving part's holes (hole to hole), shown until the faces touch.
- `pin-mating`: mate directions also come from hole-to-hole pairs, and a new rule says a stacking move stops when the faces touch.

## Impact

- `src/utils/pinHoleAlignment.js`:
  - a hole-to-hole pairing rule next to `pairRoles`;
  - `findHoleSnap` considers hole pairs;
  - `findAlignedOpenings` returns hole pairs, marked as such, while the faces are apart;
  - `planMates` gives hole pairs a travel equal to the gap between the faces.
- `src/components/Viewport3D.jsx`: no new interaction. The drag snap, rings and double-click already use those functions; only the mate message for stacks is new.
- `scripts/check-pin-hole-alignment.mjs`: new cases (corner connector over a beam, two beams, gear over a beam hole, motor socket onto a beam hole, flush stack).
- `features.md`.
- No saved-format change.
