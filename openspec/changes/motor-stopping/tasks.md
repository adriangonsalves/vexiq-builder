## 1. Data and plumbing

- [x] 1.1 `stopping` on Smart Motor instances (`'coast' | 'brake' | 'hold'`, absent = brake): `playInputs` (`src/engine/core.js`) passes it and `buildBodyGraph` puts it on each `graph.motors` entry. Verify with a case in `node scripts/check-play-mode.mjs`: a motor with no field reads `brake`, one set to `hold` reads `hold`.
- [x] 1.2 `update_part` takes `stopping` in `src/engine/actions.js`, the MCP server's schema and handler, and `src/utils/webMcpTools.js`; refused with a message for another value or a part that isn't a Smart Motor; `get_assembly` and `get_part_details` report it for Smart Motors. Verify with cases in `node scripts/check-mcp-tools.mjs` for each value, a bad value, a non-motor part, and undo restoring the previous mode.

## 2. Stopping modes in the sim

- [x] 2.1 Coast: a tenth of Brake's drag (decision 2). Verify in `check-ropes.mjs` on the Rope winch set to Coast: released, the belt pulls the arm back more than 25° in 2 s.
- [x] 2.2 Brake: `τ = −stall · ω / free speed`, solved for the end of the step (decision 3), replacing today's hold-like brake as the default. Verify in `check-ropes.mjs` on the Rope winch set to Brake: released, the arm creeps back at least 2° in 2 s but under a quarter as far as under Coast; in `check-play-mode.mjs` the Clawbot's free drive shaft stops within 0.5 s.
- [x] 2.3 Hold: today's deadbeat brake plus the return to the stop angle over `HOLD_RETURN` (decision 4), with the rope budget (`heldByMotors`, `ropeTorque`, `holdSat`) in Hold only. Verify in `check-ropes.mjs` on the Rope winch set to Hold: released, the arm stays within 0.5°; the arm twisted against the rope with 0.5 N·m moves under 2°; a hard knock past stall pulls rope off and the motor winds back within 3°. On the Rope lift set to Hold the weight stays put. In `check-play-mode.mjs`, the Clawbot arm stopped mid-swing in Hold bounces back no more than 5° and comes back within 2.5°.
- [x] 2.4 `physics.setStopping(motorId, mode)` changes a running sim's mode at once, holding from where the shaft is if switched to Hold. Verify in `check-ropes.mjs`: the Rope winch arm coasting back, switched to Hold, stops within 1°.

## 3. Blocks and the claw

- [x] 3.1 Find why "reversing closes the claw until the tips meet" fails (−15° / −4°) since the backing-out change, and fix it without breaking "Wound right up, then reversed" (Rope lift and Rope winch). Verify: all of `node scripts/check-play-mode.mjs` and `node scripts/check-ropes.mjs` pass, including the claw check, and the cause and fix are noted under design decision 6.
- [x] 3.2 Verify the moved fixes as this change's scenarios: "A lowering load can't overspeed the motor" (Rope lift reversing under 130 rpm) and "Wound right up, then reversed" with and without a stop in between, in `check-ropes.mjs`.

## 4. Play panel

- [x] 4.1 Each motor row gets "When stopped: Coast · Brake · Hold" chips under the throttle (decision 7), working by tap, at least 32 px tall, current one marked; a choice goes through `update_part` (saved, undoable) and `physics.setStopping`, without restarting Play. Verify in the app (static preview 5174): pick Hold on the Rope lift's motor, release the throttle, the weight stays; Undo shows Brake again; screenshots at 390 px and 800 px wide.
- [x] 4.2 Rename the throttle "Hold" checkbox to **Keep** (title and label; `data-help` id unchanged). Verify in the app and with `node scripts/check-help-context.mjs`.

## 5. Starters

- [x] 5.1 Rope lift and Rope winch set `stopping: 'hold'` on their motor through `ropeStarter` in `src/starters.js`. Verify in `node scripts/check-starter-assemblies.mjs` (mode is hold) and that their Play checks in `check-ropes.mjs` pass.
- [x] 5.2 In rope-and-spool, set the scenario "Motor stops with no ratchet" (its `specs/play-mode/spec.md`) to name the mode (in Hold the arm stays; in Brake it creeps back; in reverse the belt pulls it back) and mark its tasks 7.8, 7.9 and the held-spool part of 7.11 as moved here. Verify with `openspec validate rope-and-spool` and `openspec validate motor-stopping`.

## 6. Wrap-up

- [x] 6.1 Run every `node scripts/check-*.mjs`; all pass.
- [ ] 6.2 Help (deferred while docs are skipped; do only when the user asks): the Play page explains the three modes and Keep, its `tags:`/`answers:` and `coverage.json`, control chips in `src/help/controls.js`, pictures retaken; `check-help*.mjs` pass.
