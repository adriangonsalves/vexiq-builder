## Context

Motors in Play are driven in `src/sim/physics.js` `driveMotors(throttles, dt)`: each step a torque about the motor's hinge, applied as equal and opposite turns on the motor's body (A) and its shaft body (B), with `inertia` the pair's reduced inertia about the axis (gear trains included). Blocking by contact is `checkBlocked` / `pressDepth`. On the rope-and-spool branch (uncommitted) these were changed while testing ropes:

- the driven push now restarts only when the throttle changes way, so a running motor brakes a load running ahead of it;
- at throttle 0 a "deadbeat" brake cancels the shaft's speed each step plus a smoothed estimate of the load seen over the last step (`holdLoad`), capped at stall torque. That holds any load below stall torque, which is really Hold, not Brake;
- `heldByMotors()` also lists an idle motor's own shaft while it has torque to spare, so ropes treat it as fixed and their turning on it (`ropeTorque`) counts against stall torque (`holdSat`);
- releasing the throttle clears a block; backing out lasts until clear for 0.25 s while running (`clearFor`), and a deeper press must last 0.1 s (`BACK_OUT_PRESS`) to block again.

These become this change's work. The Play check "reversing closes the claw until the tips meet" fails since the backing-out change (−15° / −4°: the right tip doesn't close past 0).

Motors reach the sim through `playInputs` (`src/engine/core.js`) → `buildBodyGraph` → `graph.motors` (`{ id, label, hinge }`). Instances already carry motor-only fields (`socketAngleDeg`).

## Goals / Non-Goals

**Goals:**
- Three stopping modes that look different on a hanging load: Coast falls, Brake creeps, Hold stays.
- A mode change during Play takes effect at once, without leaving Play, and is saved and undoable.
- Today's motor fixes kept, and the claw check passing again.

**Non-Goals:**
- VEX's "max torque" percentage, motor timeouts, or position moves (spin to angle). Every mode is capped at the full stall torque, 0.414 N·m.
- Hold for a spool driven through gears: the rope budget covers the motor's own shaft only (as now); a geared spool takes the pull as a free body and the hold acts through the gears.
- Help page text and pictures (deferred while docs are skipped; listed as a task).

## Decisions

1. **Data: `stopping` on the motor's instance**, one of `'coast' | 'brake' | 'hold'`; absent means `'brake'` (VEX's default), so existing builds and starters need no change. `playInputs` passes it; `buildBodyGraph` puts it on each `graph.motors` entry. *Alternative:* a Play-only setting kept in panel state — rejected by the user: starters must be able to come set to Hold.

2. **Coast: a tenth of Brake's drag** (`COAST_DRAG` 0.1), the motor's own gears turning. *As built:* with no drag at all, the Rope lift's weight fell and spun the light spool up to 2,600 rpm, which wound the rope back like a yo-yo and threw the weight up again; a real motor's gearbox doesn't let it spin free like that.

3. **Brake: torque against speed, `τ = −STALL_TORQUE · ω / MOTOR_FREE_RAD_S`**, the torque of a shorted DC motor: stall torque at free speed, nothing at rest. Applied as an impulse capped at `inertia · |ω|`, so on a light shaft it can stop it but never turn it back. A steady load τ turns the shaft at `ω = τ · free / stall`: a load of a tenth of stall torque creeps at a tenth of top speed. *Alternative:* keep today's deadbeat brake for Brake — rejected by the user ("Brake creeps").

4. **Hold: today's deadbeat brake plus a pull back to the stop angle.** On entering stop, record the angle 0 and integrate the shaft's relative angle `θ += ω·dt` each step. Torque = `−(inertia·ω)/dt − holdLoad − inertia·θ/(dt·T_RETURN)` with `T_RETURN ≈ 0.15 s`, capped at ±stall torque. The return term is over a time, not one step, so it doesn't overshoot; the load estimate keeps a steady load from leaving an offset. The rope budget (`heldByMotors`, `ropeTorque`, `holdSat`) applies in Hold only. *Alternative:* a Rapier joint motor in position mode — rejected: motors are driven by impulses everywhere else, and mixing the two in one hinge would fight the gear-ratio and block logic.

   *As built:* the stopped-motor step runs after outside pushes and before the gear links (`stopMotors`), and its load estimate is measured across the physics step (`feltOverStep`), so a push or pull added earlier in the step is felt at once. The angle back to is read from the motor's and shaft's poses, not added up from speeds (adding up drifted on a geared arm). `HOLD_RETURN` is 0.3 s: 0.15 s rang on the Clawbot's geared arm. Brake and Coast solve the shaft's speed for the end of the step from the same load estimate; pushed by `c·ω` directly, the light shaft hit the "never more than stops it" cap every step, and Coast and Brake came out the same.
   Limits found: a motor's shaft in Play is only its plastic parts (a spool and shaft: 6.6×10⁻⁷ kg·m²), with nothing for the motor's own rotor turning through its gears. A twist arriving all at once, or one past stall torque, spins such a shaft far further than a real one (a 0.6 N·m knock: many turns in a thirtieth of a second). Adding a rotor inertia (2×10⁻⁵ kg·m² tried) fixed that but changed four unrelated Play checks (Flop's track lap and bumper stall, gears swinging out of mesh), so it was left for a spec of its own. Hold on a geared shaft also misjudges a twist applied straight to the shaft gear (the train is about 27 times heavier than the shaft alone); reading the speed shared over the whole train was tried and broke the gear checks, so the twist and knock checks load the held spool through its rope instead, as a real winch is loaded.

5. **Running motors keep the either-way push.** It's what a real speed controller does, whatever the stopping mode; the mode applies only at throttle 0.

6. **Blocks.** Letting go clears a block (the stopping mode takes over), and the backing-out allowance stays: `clearingDir = dir || −blocked`, cleared by 0.25 s of no press while running, re-blocked only by a press deeper than any while stopped, lasting 0.1 s. The claw regression is investigated first (task 3.1) before changing these numbers: the likely cause is the tips meeting while the allowance is still active, so their press never reads as "deeper for 0.1 s" against a reference raised during the open stall. A likely fix is to reset the reference depth to the current press when the motor has moved clearly away (turned a set angle back), rather than only after 0.25 s with no press.

   *As built (task 3.1):* the claw failed because the backing-out allowance from opening (the claw backing off its standoffs) was still active when the tips met, so for 0.1 s at a time the motor pushed the tips together instead of stopping, and the 1:1 crank gears slipped about 18°. Backing out now also ends once the shaft has turned 15° back (`BACK_OUT_TURN`); the knock it exists for (a spool turning into the load wound against it) comes in the first step of reversing.

7. **UI: a three-way choice on each motor's row, "When stopped: Coast · Brake · Hold"**, as chips under the throttle (one tap, each at least 32 px tall, the current one marked), with a short title on each ("spins freely", "slows it, a load creeps", "keeps it where it stopped"). Chosen over a single chip that cycles (hidden options) or a dropdown (two taps, small on phones). The existing "Hold" throttle checkbox is renamed **Keep** (same behaviour, `data-help` id kept) so "Hold" means one thing. A change goes through the normal `update_part` action (saved, undoable) and is pushed to the running sim with a new `physics.setStopping(motorId, mode)`, so Play doesn't restart.

8. **MCP:** `update_part` accepts `stopping` (`coast` / `brake` / `hold`); refused with a message on a part that isn't a Smart Motor, or for another value. `get_assembly` and `get_part_details` report `stopping` for Smart Motors (`brake` when unset). WebMCP's update_part gets the same field.

9. **Starters:** Rope lift and Rope winch set `stopping: 'hold'` on their motor; set through the starter helper in `src/starters.js` (the row format stays as is), so the template scripts don't change.

## Risks / Trade-offs

- [Brake creep depends on the shaft's load estimate and inertia; on a very light shaft the capped impulse acts like a hard stop] → the cap is `inertia·|ω|`, the most that stops it without reversing; the Brake scenario is checked on the Rope lift (heavy load) and a free spinning wheel (light).
- [Hold's return term can ring with the arm and gear trains] → return over `T_RETURN`, not one step; checked on the Clawbot arm (geared) and the Rope lift; the earlier spring-like hold rang on the Clawbot arm, which is how this was found.
- [Changing the default from today's hold-like brake to a creeping Brake changes rope checks just written] → those checks are updated to the mode they exercise (Rope lift and Rope winch starters are Hold).
- [Writing the build while in Play] → the mode change must not restart Play or move parts; `setStopping` updates the sim, and the stored instance change touches only `stopping`.
- [Renaming Hold to Keep] → the Help page and its control chip still say Hold until docs are done; noted in the docs task.

## Migration Plan

No migration: a motor without `stopping` is Brake. Builds saved with `stopping` open in older versions with the field ignored.

## Open Questions

- The exact `T_RETURN` and whether Brake needs a small floor torque to feel right on light shafts: tuned on the checks, without changing the specs.
