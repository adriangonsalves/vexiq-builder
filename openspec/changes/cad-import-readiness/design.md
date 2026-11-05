## Context

See proposal.md for why. Facts that shape the approach:

- The overlap check (`checkCandidateCollision` in `src/engine/core.js`) already tests each part's mesh pulled in by 0.38 mm along its surface normals (`getPartCollisionBvh`), so contacts up to about 0.76 mm combined are ignored. Flop's leftover contacts were deeper than that, but not by much.
- `resolveIntersectingInstances` in `src/App.jsx` runs on every selection change, add, copy and clone. It moves every flagged part back to `lastValidPosition`, or drops it when that is null. MCP placements save `lastValidPosition: null` when they overlap, so they are dropped on the user's next click.
- Port ids come from counters in `scripts/index-part-metadata.mjs` (`hole_${holeCounter++}`, `peg_${pegCounter++}`), so they follow detection order. Shafts get no ports. Attachments only have `chainSpecs.seatInLink`; the tread link has `gripperHoles`. The Bumper Switch's top holes are in the cylinder list but were never turned into ports.
- The Flop build established the CAD-to-app conversion: VEX CAD (Cadasio) poses are 4x4 row-vector matrices in mm × 0.2141688 (the project's `scaleFactor`), Y up, robot front +Z. App world = C · pose, with C taking CAD +Z to app +X, CAD +Y to app +Y and CAD +X to app −Z. Per part, the library model relates to the CAD model by `p_lib = Q · p_cad + o`.
- three.js ships a Draco decoder (`node_modules/three/examples/jsm/libs/draco`), which Cadasio's per-part meshes use.

## Goals / Non-Goals

**Goals:**
- One overlap rule shared by the app, the MCP server and the audit.
- Port ids that never change for an unchanged part, with today's ids still accepted.
- A frame table that is data, not code, so new entries need no code change.

**Non-Goals:**
- Changing how insert or mating moves stop (they still stop at first contact).
- A general mesh-to-mesh registration library; the matching script only needs to choose among 24 quarter turns and two origin rules, then refine.
- Importing anything other than Cadasio projects (no STEP assembly import).

## Decisions

### Tight fits: a second, deeper test, only when the first one hits
When the 0.38 mm test finds a hit, test the pair again against meshes pulled in a further 0.5 mm (0.88 mm in all), built and cached the same way. A hit there is an overlap; no hit is a tight fit. `checkCandidateCollision` returns `collidingWith` (overlaps only) and a new `tightFits` list. The `isIntersecting` flag and everything that reads it are unchanged.
- *Rejected: raise 0.38 to 0.88 everywhere.* This would also change where hole-pick and mating moves stop, and would hide small real interference with no trace. Kept separate, a tight fit is still reported.
- *Rejected: measure the true overlap depth.* It costs far more than a second check on a cached, pre-shrunk mesh, and only the threshold matters.
- The deeper mesh is only checked for pairs that already hit, so normal placements cost the same as today.

### Only the part being placed in the app can be dropped
`resolveIntersectingInstances` gets the set of ids of the app's current placing session: the part being dragged, dropped from the library, hole-picked, copied or cloned. It moves back or drops only those ids. Every other flagged part keeps its pose and flag.
- *Rejected: save the source of each part (`placedBy: 'mcp'`) and skip those.* That adds a saved field and still drops a user's own part brought back by undo. The rule "only what you are placing right now" needs no new saved data.

### Stable id format: `<kind>.<face>.<x>_<y>_<z>`
- **kind:** `hole` (round pin hole), `sq` (square hole), `bore` (shaft bore), `socket`, `peg`, `shaft`.
- **face:** the signed local axis of the face the opening is on (`+x` … `-z`), or `thru` for a through hole.
- **position:** in quarter pitches (3.175 mm), rounded to whole numbers.

A clash within a part gets `#2`, `#3` in a stable order (by axis, then position). Today's id is kept in `aliases`. One shared lookup, `findPort(part, id)` in `core.js`, accepts either form, and every tool and action uses it. Replies give the stable id.
- *Rejected: number holes by row and column on each face.* Plates with offsets and angled connectors don't have one grid per face, so position-based ids are the only rule that holds for every part.
- Using whole quarter pitches makes ids readable and keeps them unchanged under the small measurement noise between indexing runs.

### Filling in missing points
- **Face holes:** turn every cylinder in the part's cylinder list with a pin-hole or square-hole radius that has no port yet into a candidate. Keep it if a reference pin probe fits from its open face (the same probe the indexer already uses for bores). This finds the Bumper Switch's top holes and similar faces without hand lists. The existing hand-written brain mounts stay.
- **Shafts:** one `shaft` port from the long axis of the box, with both end positions. Cross-section comes from the name (square unless the part name says round). The cap or stop-ring end comes from the `end_shoulder` origin type.
- **Attachment pegs:** derived, not measured: the tread link's `gripperHoles`, taken into the attachment's frame through its `seatInLink`, become the attachment's pegs. This keeps pegs and the track builder's seat consistent by construction.
- **Mini Standoff Connector:** its bore is typed `pin_hole`, since a pin is what goes in it.

### CAD frame table in `public/cad-frames.json`
Keyed by part number: `{ rule: 'centre' | 'origin', turn: [x, y, z] (degrees, about the part's box centre), offsetMm: [x, y, z], source: 'pins' | 'mesh' | 'default', checkedOn, meanErrorMm? }`. Conversion: `o` = box centre (centre rule) or `offsetMm` (origin rule); `Q` from `turn`. App pose = C · M_cad · Qᵀ · (p − o). The seed entries are the Flop findings listed in the cad-import spec.
- *Rejected: putting the frame into `catalog.json`.* The catalog is rewritten by `npm run index-metadata`. A separate file keeps hand-checked entries safe from re-indexing and easy to review.

### Mesh matching script: `scripts/fit-cad-frames.mjs`
1. Download the project archive the instructions.online offline cache uses (via `getProjectVersion`, then the project zip). Cache it under the job or a gitignored folder.
2. Decode each part version's Draco mesh.
3. For each part number, sample both meshes. Try both origin rules and all 24 quarter turns, scoring by mean nearest-point distance. Refine the best with a few rounds of point-to-point fitting.
4. Write `mesh` entries whose mean error is at most 0.5 mm. Report the rest. Never overwrite `pins` entries.

### Import script: `scripts/import-cad.mjs`
Reuses the conversion above.
- Walk the assembly tree; stop at nodes whose component name is a part number.
- Skip a fixed list of non-library kinds, and any part number not in the catalog.
- Drop duplicates: same part number with poses within 0.5 mm and 1°.
- Label `<subassembly>: <instance path tail>`, adding the parent node name when it would repeat.
- Place through the MCP server in batches of 80, structural parts before pins.
- Group per top-level subassembly, run the audit, and print the report.

It drives the server over stdio like any MCP client, so it goes through the same checks and history as an agent would.

## Risks / Trade-offs

- [A real 0.5 mm interference is now only a warning] → Tight fits are listed in the audit and replies, never hidden. The limit is one constant, easy to tighten.
- [Re-indexing changes some old ids, if detection order shifts while aliases are rebuilt] → Aliases are taken from the current `catalog.json` before re-indexing, by matching each new point to the old point at the same position. A check fails if any old id is lost.
- [Cadasio's data format or URLs change] → Import also accepts a saved copy of the project data. The frame table keeps working without the network.
- [Mesh matching picks a mirror-symmetric wrong turn for symmetric parts] → For symmetric parts any best-scoring turn gives the same shape. Where the hole layout breaks the symmetry, a `pins` check on a real build overrides it.
- [Fetching a project from instructions.online] → Only projects the user names are fetched. Nothing is uploaded.

## Migration Plan

1. Land the overlap and drop-rule changes; they need no data change.
2. Re-index with `npm run index-metadata`, keeping aliases. Existing builds keep working because nothing saved refers to port ids by number except history labels, which are text.
3. Add `cad-frames.json`, then the import and matching scripts.

Rollback: revert the commit and re-index. Saved builds are unaffected.

## Open Questions

- The exact archive URL pattern for a project zip comes from `projectCache.js` on instructions.online. It is confirmed when the matching script is written; it doesn't affect the specs.
