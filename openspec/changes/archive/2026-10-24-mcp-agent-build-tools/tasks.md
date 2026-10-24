## 1. Test seam and shared measurements

- [x] 1.1 Make `STATE_PATH` in `mcp/assembly-engine.mjs` honor `VEXIQ_STATE_PATH` (design.md §10). Create `scripts/check-mcp-tools.mjs` with the harness: temp state file, stub bridge on a free port (fake browser count, canned screenshot), server spawned with both env vars, a JSON-RPC helper, and PASS/FAIL output like `check-pin-hole-alignment.mjs`. Verify a first check: `tools/list` returns the existing 15 tools and `public/assembly-state.json` is untouched (same checksum before and after).
- [x] 1.2 Add `measureOpeningDepths(partMeta, raycast)` to `src/utils/pinHoleAlignment.js` and the `@lo` / `@hi` split in `collectWorldFeatures` when `measured.depths` is given (design.md §2). Export `COLLAR_NAME_PATTERN` and a `findSeatedPairs(featuresA, featuresB)` built on the existing `pairRoles` / `coaxialSpans` helpers. Add check cases to `scripts/check-pin-hole-alignment.mjs`:
  - Smart Motor hole_1 → one blind opening from the front face (about 9 mm), closed at the back (its back mark is under 1 mm);
  - a made-up part whose through hole is blocked in the middle (stub raycast) splits into `@lo` and `@hi`;
  - the drive socket stays one blind opening about 4.7 mm deep;
  - a 1x6 Beam hole stays through;
  - a 36 Tooth Gear bore stays through;
  - all existing checks still pass.
- [x] 1.3 Add `getPartMeasurements(part)` (cached per part id) and `worldFeaturesFor(instance)` to the engine, using the eroded BVH for `surfaces`, `pinEnds` and `depths` (design.md §1). Verify in the check script that `worldFeaturesFor` on a placed Smart Motor reports the split back holes and a seated pin's pair through `findSeatedPairs`.

## 2. Fit audit (`mcp-fit-audit`)

- [x] 2.1 Rewrite role sorting and engagement in `auditAssembly` on seated joints (design.md §3):
  - fastener roles from `fastenerSpecs`, collars as held parts;
  - joints, floating and half-seated fasteners;
  - integral-peg joints;
  - graph, fastener counts, power tracing, and overhang with collars.

  Keep gear meshing and clamping. Verify in `check-mcp-tools.mjs` via `audit_assembly` on fixture states:
  - the plate-pins-above-flange case reports the 8 pins half-seated and not sound;
  - a pin through two beams joins them;
  - motor → shaft → hub reports the wheel driven;
  - a shaft 1 mm beside a gear bore doesn't carry the gear;
  - a pin in open air on one side is half-seated;
  - corner connector pegs join it to the beam;
  - a collar on an axle end is neither floating nor overhanging;
  - the 65-part drivetrain in `openspec/changes/mcp-agent-build-tools/fixtures/drivetrain.json` (copied to `scripts/fixtures/drivetrain.json`) is still sound with 8 driven wheels.
- [x] 2.2 Verify the depth rule end to end: a 0x2 Connector Pin pushed 6 mm into the back of the Smart Motor at hole_1 collides, and one in a face hole doesn't (`checkCandidateCollision`); a pin touching the back mark is not counted as seated by the audit. Add these as check cases.

## 3. Part details (`mcp-part-details`)

- [x] 3.1 Implement the compact `get_part_details` reply with `connections` and the `verbose` option (design.md §7). Verify in `check-mcp-tools.mjs`:
  - Smart Motor: socket axis +Y and about 4.7 mm deep, hole_1 / hole_8 blind from the front face and closed at the back, no `cylinders`, reply under 8,000 characters;
  - 1x Wide, 1x1 Corner Connector: peg `sticksOut: 'hi'`;
  - `verbose: true` includes `cylinders`.

## 4. Batch placement (`mcp-batch-placement`)

- [x] 4.1 Add `placeParts` to the engine for absolute items, refs, combined overlap checks, `rejectIntersecting`, the error-without-saving path, and the summarized audit. Add the `place_parts` tool with the compact reply and `verbose` (design.md §4). Verify:
  - 40 absolute items are saved in one write (file modified once) with one line each;
  - an unknown part at item 7 saves nothing and names item 7;
  - two overlapping items with `rejectIntersecting` save nothing and are both named.
- [x] 4.2 Add `dryRun`: same reply plus poses, nothing written, reply says dry run. Verify `get_assembly` is unchanged after a dry run, and the stub bridge received no POST.
- [x] 4.3 Add insert items (design.md §5): source and target features, line-up outside the opening, `planMates`, the 0.5 mm sweep with bisection, flush-seat preference and back-off, and `stoppedAgainst` in the reply. Verify:
  - 0x2 Connector Pin into a 1x6 Beam hole from `+` ends seated with its cap on the face, stoppedAgainst the beam, and not overlapping;
  - 4x Pitch Capped Shaft into the Smart Motor socket ends at the socket bottom and is seated with the motor;
  - a wheel hub inserted over the shaft from an earlier item's ref slides on until it touches;
  - a plain shaft through a lone beam stops flush with the far face.
- [x] 4.4 Add `mirror` (design.md §6): exact mirrored poses from each part's own symmetry plane (`mirrorSubassembly`'s pose plus `mirrorApproximate` only for left- or right-handed parts), items that are their own mirror image placed once, Left↔Right relabeling or " (mirror)", `#mirror` refs, all checked and audited. Verify that placing the drivetrain fixture's left half plus the top plate with `mirror: { plane: 'Z', offsetMm: 0 }` gives the same audit as the full fixture: sound, 8 driven wheels, 0 overlaps, and motors on both sides seated with their axles.

## 5. App link (`mcp-app-link`)

- [x] 5.1 Make the bridge's POST `/api/assembly` reply include `browserClients`. Make `writeAssemblyState` return `{ state, appSync, hint }`, and have `handleJsonRpcMessage` add `appSync` and the hint to every result of a call that wrote state (design.md §8). Verify with the stub bridge:
  - stopped → `saved-to-file-only` with the `npm run dev` hint;
  - zero browsers → `no-browser` with the address;
  - one browser → `live`;
  - covered for `place_part`, `place_parts`, `update_part` and `configure_viewport`.
- [x] 5.2 Add the bridge's `/api/assembly/screenshot` and `/api/assembly/screenshot-result` round trip: pending map, 409 with no browser, 504 after 10 s, request sent to the most recent client. Add the `capture_screenshot` tool, returning image content, with `handleJsonRpcMessage` passing `content` through (design.md §9). Verify with the stub bridge:
  - an image content item with `mimeType: 'image/png'`;
  - the no-browser error with its hint;
  - a timeout error when the stub never answers.
- [x] 5.3 In the app, route `screenshot-request` SSE messages in `App.jsx` to a capture callback registered by `Viewport3D.jsx` (`onRegisterScreenshot`), and POST the result back. The capture renders synchronously at the requested size with overlays, gizmos and selection tint hidden, using a temporary framed camera for `iso` / `front` / `top` / `side`, then restores everything. Verify in the running app (`npm run dev` plus a browser):
  - `capture_screenshot` with `view: 'iso'` returns a 1024 × 768 PNG of the whole drivetrain;
  - the user's camera position and target are unchanged afterwards;
  - no gizmo or hole rings appear in the image while a part is selected.

## 6. Wrap-up

- [x] 6.1 Update `features.md` (MCP tools section: `place_parts`, dry run, insert, mirror, compact part details, `appSync`, `capture_screenshot`, the fit audit) and the project `design.md` (audit on seated joints, measured depths, the screenshot round trip). Verify both describe the behavior in this change's specs.
- [x] 6.2 Run `npm run build`, `node scripts/check-pin-hole-alignment.mjs` and `node scripts/check-mcp-tools.mjs`; all pass. Then rebuild the drivetrain through MCP with `place_parts` (left half plus `mirror`), and confirm it takes at most 5 tool calls, the audit is sound, and `capture_screenshot` shows it.
