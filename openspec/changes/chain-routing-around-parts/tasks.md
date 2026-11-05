## 1. Path model

- [ ] 1.1 Before changing anything, record the link poses, link counts and sprocket turns of every case in `scripts/check-chain-builder.mjs` to a fixture. Verify the fixture is written.
- [ ] 1.2 Replace `outerLoop` in `src/utils/chainPath.js` with gift wrapping over circles that returns stops (a circle may repeat). Verify:
  - every recorded case gives identical poses;
  - Flop's 8T–16T–8T (centres at -206.4, -168.3, -28.6 mm on one line) gives a loop with the 16 Tooth twice.
- [ ] 1.3 Move enclosed and crossing handling to stops; add the `both` route; make a sprocket cut by both straight runs wrapped on both without asking. Verify the motor-sprocket and Both-idler scenarios.

## 2. Obstacles

- [ ] 2.1 Add the band slice of a part's model (BVH-limited), its convex hull, simplification to 12 corners, and a per-model cache. Verify the Double Offset Corner Connector's slice outline matches its model in the chain's plane.
- [ ] 2.2 Treat a selected non-sprocket, non-standoff part as one obstacle unit of corner guides in routing and bending. Verify the chain-past-a-corner-connector scenario: no link overlaps the connector.
- [ ] 2.3 Ignore a selected part that doesn't cross the plane, with a reason. Verify the obstacle-out-of-plane scenario.

## 3. Parts in the way

- [ ] 3.1 Run the collision pass on planned links and return `blockedBy` (id, label, run). Verify the unselected-bracket scenario.

## 4. App and MCP

- [ ] 4.1 Over-or-under dialog: the Both choice where valid, obstacle rows with highlight, and an "in the way" note; Build menu hover text names blocking parts. Verify in headless Chrome on the Flop drive and an obstacle case.
- [ ] 4.2 `build_chain`:
  - `instanceIds` accepts any parts;
  - `route` accepts `"both"`;
  - `needsRoute` includes obstacles;
  - the reply has `wrapped[*].side`, `obstacles` and `blockedBy`.
  
  Verify with `scripts/check-mcp-tools.mjs`.

## 5. Wrap-up

- [ ] 5.1 Add all spec scenarios to `scripts/check-chain-builder.mjs`, and verify it exits 0.
- [ ] 5.2 Update `features.md` and the chain line in `AGENTS.md` (both runs, Both, obstacles, `blockedBy`).
- [ ] 5.3 Run every `node scripts/check-*.mjs` and `npm run build`. Verify all pass.
