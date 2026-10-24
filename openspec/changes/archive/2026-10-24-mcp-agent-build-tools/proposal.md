## Why

Building a 65-part drivetrain through the MCP server took about 70 tool calls plus a side script, because the server could not be trusted to say whether parts actually fit. The audit counts two parts as fastened when their bounding boxes overlap, so it passed a top plate whose 8 pins were not in any hole. Some part data is wrong: the Smart Motor's back holes are listed as going through but are about 2 mm deep. Parts go in one at a time, at hand-computed positions and rotations, and every change is saved immediately. The server also never says when the app isn't open, so the user couldn't see the result. These fixes let an agent build an assembly in a handful of reliable calls.

## What Changes

- **Real fit check in `audit_assembly`.** A pin, peg or shaft counts as fastening two parts only when it actually sits inside a matching hole on each of them, using the same matching rules as the aligned-hole highlighting. The audit lists each fastener's seated joints and flags fasteners seated on only one side ("half-seated"). Bounding-box overlap no longer counts as a joint. **BREAKING** for audit results: assemblies that passed by overlap alone now report floating or half-seated fasteners.
- **Correct hole depths and part roles.** Hole depth comes from the 3D model, not only the catalog. A hole listed as going through but blocked inside becomes two shallow holes, one on each face, each with its real depth. Rubber shaft collars count as parts held on a shaft, not as shafts, wherever the audit sorts parts.
- **New `place_parts` tool.** Places a list of parts in one call and returns one short summary: per-part id and status, then one combined collision and audit result.
- **Check-only mode.** `place_parts` takes `dryRun: true`, which reports the same result without saving anything.
- **Relative placement.** A `place_parts` item can say "put this part's peg or shaft into that hole and push it in until it touches", like double-click mating, instead of giving a position and rotation. The hole can be on a placed part or an earlier item in the same call. Optional roll angle, and which side of the hole to come from.
- **Mirroring in one call.** `place_parts` takes a `mirror` option that also places the mirror image of every item across a plane, with the same part-specific corrections `mirror_subassembly` uses.
- **Compact `get_part_details`.** By default it returns size, each hole, peg and bore with its position, direction and real depth, and which way each peg sticks out. The raw cylinder list and the other old fields come back only with `verbose: true`. **BREAKING** for callers that read `cylinders` without asking for it.
- **App connection status.** Every tool that changes the assembly says whether the open app received the change, or whether it was only saved to the file because the app isn't running or no browser has it open.
- **New `capture_screenshot` tool.** Returns a picture of the 3D view from the open app, either from the current camera or a standard view (iso, front, top, side) framed on the whole assembly, without moving the user's camera. If no browser has the app open, it says so.

## Capabilities

### New Capabilities
- `mcp-fit-audit`: how the audit decides what is fastened (seated joints, half-seated fasteners), real hole depths from the model, and how collars are treated.
- `mcp-batch-placement`: the `place_parts` tool, with its check-only mode, relative placement into holes, mirroring, and compact replies.
- `mcp-part-details`: the compact `get_part_details` reply and its `verbose` option.
- `mcp-app-link`: reporting whether the open app received each change, and the `capture_screenshot` tool.

### Modified Capabilities
<!-- None: aligned-hole-highlighting and pin-mating describe the browser app; their rules are reused here, not changed. -->

## Impact

- `mcp/vexiq-mcp-server.mjs`: new `place_parts` and `capture_screenshot` tools, compact `get_part_details`, an app-status line on writing tools, and image results in replies.
- `mcp/assembly-engine.mjs`:
  - audit rewritten around seated joints;
  - hole-depth measurement on the engine's collision meshes;
  - push-until-contact placement;
  - batch placement, with mirroring reused from `mirrorSubassembly`;
  - `writeAssemblyState` reports app delivery;
  - the state file path can be overridden for tests.
- `src/utils/pinHoleAlignment.js`: new pure hole-depth measurement next to `measureOpeningSurfaces`, so the server and the app share one rule.
- `vite.config.js`: a status endpoint (how many browsers are connected) and a screenshot request/response round trip over the existing event stream.
- `src/App.jsx` and `src/components/Viewport3D.jsx`: answer screenshot requests by rendering the requested view and sending back the image.
- New `scripts/check-mcp-tools.mjs`: a Node check that drives the server over its stdio protocol against a temporary state file.
- `features.md` and `design.md`: document the new tools.
- No new dependencies.
