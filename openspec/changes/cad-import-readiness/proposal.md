## Why

Building the 2026-27 Herobot "Flop" from VEX's own CAD (607 parts) showed three gaps that turned a straight conversion into hours of guessing. Official CAD has many contacts of 0.3 to 0.5 mm that the overlap check reports as full overlaps. The app then deletes any flagged part that has no earlier clean pose as soon as anything is selected, which silently removed 25 parts (the brain, a gear, the intake shaft, beams and chain links). The part data has no holes for some faces (the Bumper Switch's top holes), no pegs on intake flaps, no axis for shafts, and hole ids that only reflect the order the indexer found them. And VEX's CAD places some parts by the centre of their box and others by their own origin, which no file records, so each part type had to be checked by trial.

## What Changes

- **Tight fits are not overlaps.** Contacts up to 0.5 mm deeper than the checker's current allowance are reported as tight fits: a warning, not an overlap. Placing, the audit, `place_parts` and Fix assembly all use the same rule.
- **Flagged parts are never deleted behind the user's back.** Only a part the user is placing or dragging in the app snaps back or is cancelled when something else is selected. A part placed by MCP, imported, or brought back by undo/redo stays where it is and keeps its overlap warning until it is moved or removed.
- **Complete connection points.** The indexer also finds:
  - holes on every face, including the electronics: Smart Motor, Bumper Switch top holes, brain and sensors;
  - the axis and two ends of every shaft;
  - the pegs of intake flaps and other attachments;
  - the Mini Standoff Connector's bore as a pin hole.
- **Stable port ids.** Every connection point gets an id built from where it is (kind, face and pitch position), so ids survive a re-index. Today's ids (`hole_14`) keep working as aliases in every tool. Each point also says its shape (round, square, socket), depth, and the face it opens on.
- **CAD frame table.** A table per part number gives the offset and turn between the library model and the frame official VEX CAD uses. It is seeded from what Flop proved: most parts are placed by their box centre; the Smart Motor (turned 180° about Z), 4x Pitch Motor Shaft, Double 2x Wide 2x2 Double Offset Corner Connector, Bumper Switch and brain by their own origin; the omni wheel and Long Intake Flap need a turn. A script grows the table by matching library meshes to Cadasio's per-part meshes (the servers behind instructions.online).
- **CAD import.** A script imports an instructions.online (Cadasio) project or a saved copy of its data. It converts every part with the frame table and places it through the MCP server in batches. Each part gets a unique label and a group per subassembly. The script reports parts it left out (cables, game pieces, parts not in the library) and duplicates (two of the same part at one pose).

## Capabilities

### New Capabilities
- `tight-fits`: how small contacts are told apart from overlaps, and when a flagged part may be moved back or removed.
- `connection-points`: what connection points every part has, their stable ids and aliases, and the facts given for each.
- `cad-import`: the CAD frame table, how it is extended, and importing an official VEX CAD assembly.

### Modified Capabilities
- `mcp-fit-audit`: a pin in the Mini Standoff Connector's bore counts as seated, shafts are checked along their indexed axis, and tight fits are listed apart from overlaps.
- `mcp-part-details`: the reply gives each point's stable id, aliases, shape and face.
- `mcp-batch-placement`: `insert` accepts stable ids and aliases, and a part that only tight-fits is reported as placed with a tight-fit note.

## Impact

- `src/engine/core.js`: overlap check (second, deeper test for tight fits), shaft features from indexed axes.
- `src/App.jsx`: `resolveIntersectingInstances` only acts on parts being placed in the app.
- `scripts/index-part-metadata.mjs`: face holes from every face, shaft axes, attachment pegs, stable ids and aliases; then `npm run index-metadata` to rewrite `public/catalog.json` and `public/part-metadata.json`.
- `mcp/vexiq-mcp-server.mjs`: alias lookup wherever a port id is read; part details, audit and `place_parts` replies.
- New `public/cad-frames.json`, `scripts/fit-cad-frames.mjs`, `scripts/import-cad.mjs`, and checks `scripts/check-tight-fits.mjs`, `scripts/check-connection-points.mjs`, `scripts/check-cad-import.mjs`.
- `AGENTS.md` (how to import VEX CAD) and `features.md`.
- Not in this change: chain builder routing round three sprockets in a line, or round arbitrary parts; a 2nd gen brain model; bending plastic sheets.
