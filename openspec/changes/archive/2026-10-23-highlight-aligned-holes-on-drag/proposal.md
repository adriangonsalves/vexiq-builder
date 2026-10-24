## Why

Most joints in a VEX IQ build are a pin pushed into a hole or a shaft passed through holes, gears, wheels, and motors. Today, lining these up while dragging means orbiting the camera or switching views, because the hole is usually hidden behind the part being moved or behind other parts. Showing which openings a pin or shaft currently lines up with, visible through solid parts, lets the user line up a joint from any camera angle.

## What Changes

- While a part is dragged with the Move or Rotate gizmo, every opening on another visible part that lines up with one of the dragged part's pins or shafts is highlighted:
  - a pin (`pin_peg`) lines up with round pin holes (`pin_hole`);
  - a shaft lines up with round pin holes, gear/wheel/pulley bores (`shaft_bore`), the Smart Motor drive socket (`shaft_socket`), and the hole in a Rubber Shaft Collar.
- The reverse also works: when the dragged part has openings, those that line up with a pin or shaft on another visible part are highlighted (for example, dragging a beam over placed pins, sliding a gear or rubber collar onto a placed shaft, or moving a motor over a shaft).
- Highlights draw on top of all geometry (not hidden by parts in front), so alignment can be seen without changing the view.
- Highlights stay visible while the part remains selected after the drag ends, and update when the selected part moves by other means (Inspector nudge buttons, Snap & Mate, MCP updates).
- An opening is highlighted only while the pin or shaft is still outside it. As soon as the pin or shaft starts to enter that opening, its highlight is removed. Other openings further along the same line stay highlighted until they are entered too.
- Highlights clear when the part is deselected, hidden, or the view is exploded.

Assumptions recorded for review:
- Pins match only round pin holes. Shafts match pin holes, shaft bores, the motor socket, and rubber collar holes. Hole-to-hole alignment between two beams is out of scope.
- The catalog tags both Rubber Shaft Collars as shafts, but they are rings that slide onto a shaft. They are treated as openings, using the shaft-hole cylinder in their catalog data, and never as shafts. If the check script shows the cylinder chosen for Rubber Shaft Collar v1 is not its real hole, v1 is left out.
- Highlights are always on; they are not tied to the existing `Axes` (connector overlay) toggle.
- Openings already filled by a different pin or shaft are still highlighted if they line up and the moving part is still outside them; occupancy is not checked.

## Capabilities

### New Capabilities
- `aligned-hole-highlighting`: Live, see-through highlighting of openings (pin holes, shaft bores, motor sockets, rubber collar holes) that line up with pins or shafts on the selected/dragged part (in both directions), including which parts match which openings, when a pin or shaft counts as entered, and when highlights appear, update, and clear.

### Modified Capabilities
<!-- None: openspec/specs/ has no existing capabilities. -->

## Impact

- `src/components/Viewport3D.jsx`: new alignment check and highlight overlay; hooks into the gizmo `objectChange` / `dragging-changed` handlers and the instance-sync effect.
- New helper module `src/utils/pinHoleAlignment.js` for the alignment math, so it can be checked from Node.
- Uses existing `public/catalog.json` data: `ports` (`pin_peg`, `pin_hole`, `shaft_bore`, `shaft_socket`, with `origin`, `axis`, `spanMm`, `maxDepthMm`), `fastenerSpecs` (`fastenerType`, `axis`, `usableSpanZ`) for shafts, `cylinders` for the Rubber Shaft Collars, and `bbox`. No catalog or indexer changes.
- `features.md` and `design.md` updated to describe the feature (per the repo's keep-docs-updated rule).
- No changes to the MCP engine, server, API, or saved assembly state.
