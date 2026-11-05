## 1. Path model

- [x] 1.1 Before changing anything, record the link poses, link counts and sprocket turns of every case in `scripts/check-chain-builder.mjs` to a fixture. Verify the fixture is written.
- [x] 1.2 Replace `outerLoop` in `src/utils/chainPath.js` with gift wrapping over circles that returns stops (a circle may repeat). Verify:
  - every recorded case gives identical poses;
  - Flop's 8T–16T–8T (centres at -206.4, -168.3, -28.6 mm on one line) gives a loop with the 16 Tooth twice.
- [x] 1.3 Move enclosed and crossing handling to stops; make a sprocket cut by both straight runs wrapped on both without asking; a bent run that would pass through a selected sprocket wraps it there and meshes (one turn seats every wrap). Verify the motor-sprocket and bent-run-meets-a-sprocket scenarios.

## 2. Obstacles

- [x] 2.1 Add the band slice of a part's model (BVH-limited), its convex hull, simplification to 12 corners, and a per-model cache. Verify the Double Offset Corner Connector's slice outline matches its model in the chain's plane.
- [x] 2.2 Treat a selected non-sprocket, non-standoff part as one obstacle unit of corner guides in routing and bending. Verify the chain-past-a-crossbar scenario (Flop's 2x20 Beam): no link overlaps it; and the obstacle-clear-of-the-chain scenario.
- [x] 2.3 Ignore a selected part that doesn't cross the plane, with a reason. Verify the obstacle-out-of-plane scenario.

## 3. Parts in the way

- [x] 3.1 Run the collision pass on planned links and return `blockedBy` (id, label, run). Verify the unselected-bracket scenario.

## 4. App and MCP

- [x] 4.1 Over-or-under dialog: obstacle rows with highlight, and an "in the way" note; Build menu hover text names blocking parts. Verify in headless Chrome on the Flop drive and an obstacle case.
- [x] 4.2 `build_chain`:
  - `instanceIds` accepts any parts;
  - a sprocket on two runs is listed with side `both`;
  - `needsRoute` includes obstacles;
  - the reply has `wrapped[*].side`, `obstacles` and `blockedBy`.
  
  Verify with `scripts/check-mcp-tools.mjs`.

## 5. Wrap-up

- [x] 5.1 Add all spec scenarios to `scripts/check-chain-builder.mjs`, and verify it exits 0.
- [x] 5.2 Update `features.md` and the chain line in `AGENTS.md` (both runs, a bent run wrapping a sprocket it meets, obstacles, `blockedBy`).
- [ ] 5.3 Run every `node scripts/check-*.mjs` and `npm run build`. Verify all pass.
