## Why

A part held by pins or shafts on more than one axis line gets the X, Y and Z rings around its own hole-grid centre, so there is no way to swing it about one of the pins that hold it — the user has to turn it and then move it back onto the joint. The rings also don't show which line the part will turn about, so it's hard to tell before dragging where the part will end up.

## What Changes

- Choosing a ring (hovering it, clicking it to select it, or dragging it) draws its **turning axis**: a line through the rings' centre along the ring's axis, in the ring's colour, so the user sees the line the part will turn about.
- When a ring is selected on a held part, every **anchor axis** — a joint line that holds the part (see "What holds a part") and runs parallel to that ring's axis — is highlighted as a clickable line. The line of the part's own default centre is shown as well, so the user can go back.
- Clicking a highlighted anchor axis moves the rings' centre onto that line (the point on it nearest the part's centre). Dragging, typing an angle or using the wheel on that ring then turns the part about that joint, so the pin or shaft on that line stays in its opening.
- The chosen centre stays in the part's frame until the selection changes, Rotate mode is entered again, or another anchor (or the default centre) is clicked. Ring angle labels keep counting; moving the centre doesn't reset them.
- Turns about an anchor still go through the existing overlap check on release.
- Assumptions: anchors are worked out for one selected part only (groups and multi-selections keep turning about their centre); the single Joint ring of a part held on exactly one line already turns about its anchor and only gains the turning-axis line.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `rotate-mode`: rings show the axis they turn about; a held part's rings can be moved onto any of its anchor axes that is parallel to the chosen ring.

## Impact

- `src/components/Viewport3D.jsx`: the Rotate gizmo (`createRotateGizmo`) gains an axis line and anchor-line overlays with picking; `refreshRotateSetup` keeps the joint lines from `findEngagedJoints` and a chosen pivot; ring pointer handling picks anchor lines.
- `src/utils/pinHoleAlignment.js`: possibly a small helper to filter joint lines parallel to an axis (tested in `scripts/check-pin-hole-alignment.mjs`).
- `features.md`: Rotate mode section.
- No change to saved assembly format, MCP tools or history steps.
