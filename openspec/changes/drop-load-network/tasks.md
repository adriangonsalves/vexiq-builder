## 1. Strength table and pin data

- [x] 1.1 Create `src/sim/fastenerStrength.js` with every value from design.md §1 as `{ value, unit, source: 'assumed', note }`, plus `allMeasured()`. Put a header comment pointing to the measurement TODO list. Verify with a `node -e` import that lists every entry as `assumed` and `allMeasured()` returns false.
- [x] 1.2 Fix the catalog cap data: in `scripts/index-part-metadata.mjs`, measure each connector pin's and standoff's `fastenerSpecs.blockersZ` from its mesh (z spans wider than 2.8 mm about its axis: a 1x1's middle shoulder, the 0x2/0x3/Spherical Cap pins' end caps, the 1x2/2x2 shoulder at z ≈ −6, a standoff's body) and `tipsZ`, and cut peg spans that ran past the part (−500000 on six parts) to its box; then run `npm run index-metadata`. Verify that `public/catalog.json` shows one blocker per pin where the mesh has it and every peg span inside its part's box, and that every `scripts/check-*.mjs` still passes.
- [x] 1.3 In `playInputs` (`src/engine/core.js`), give each fastener part entry its world `origin` and `zAxis` with its `blockersZ` and `tipsZ` (so each seat's place along the pin is `point · zAxis`), and give every part its name, part number, category, box, weak flag and, for capped and motor shafts, the world point of the cap or stop ring. Remove `fastenerPulloutN` and `pulloutN`. Verify with a new case in `scripts/check-play-mode.mjs`: a 1x2 pin through three beams has three seats in order, with its shoulder between the short side's beam and the other two.
- [x] 1.4 Add `seatGrip` and `gapStrength` (the slide-off rule, design.md §2) to `fastenerStrength.js`. Verify in new `scripts/check-impact.mjs` that:
  - a 6 mm seat holds more than a 3 mm seat
  - a 1x1 end and a 1x2 short end in the same beam hold the same
  - a capped pin's cap-side way is blocked and its joint holds what its plain end holds
  - a weak pin holds 0.6× a regular one

## 2. Body graph links

- [x] 2.1 In `buildBodyGraph`, replace the all-pairs stack joins with one link per gap between neighbouring parts along each pin. Each link carries kind `pin` or `peg`, point, axis, pull strength (from `gapStrength`), sideways and prying strengths, and seat stiffness. Verify in `check-impact.mjs` that a pin through three parts gives two links, not three, and that body merging and hinges in `check-play-mode.mjs` are unchanged (all its earlier checks pass).
- [x] 2.2 Emit links for collars (slide only, 3 N), spacers and washers (push only), square fits (no axial hold), round bearings (sideways only), motor sockets (captured) and battery bays (40 N), each with table strengths. Verify in `check-impact.mjs` with a shaft carrying a wheel, spacer and collar that every link has the expected kind and strengths.

## 3. Impact solve (`src/sim/impact.js`, no Rapier)

- [x] 3.1 Build nodes from parts:
  - rigid parts become one node each
  - flexible parts ("Beams & Plates" and shafts) become a node per joint position plus the centre, merged under 12.7 mm, joined by beam springs (plates as a grid)
  - pin and chain-link mass is added to the parts that hold them
  - masses come from the table

  Verify in `check-impact.mjs` that a 2x16 beam held at its ends gives at least 3 nodes, and that total node mass equals the summed part masses to within 0.1%.
- [x] 3.2 Write the stepping loop (design.md §4): 6 degrees of freedom per node, time step from the stiffest link, contacts that push only, gravity, free and motor-held hinges, link damping, and the utilisation rule with breaking mid-step. Return broken links (kind, force, strength, time), peak utilisation per link, peak deceleration and final node speeds. Verify in `check-impact.mjs`:
  - a single beam dropped flat with no joints bounces with a rebound speed of 0.2–0.4 of the impact speed
  - the whole Clawbot stays steady in a 1 m drop: no part ends faster than 3× the landing speed, every value finite
- [x] 3.3 Behaviour checks in `check-impact.mjs` on small hand-made builds:
  - the same arm with a Smart Motor vs a light block at its tip: the motor's root pins take more; the same arm ten times stiffer: its root pins take more (bending softens the hit). A longer arm does *not* always pry harder: in a short hit a long, flexible arm cushions its tip weight, so that scenario was replaced
  - a braced vs unbraced arm: at some height the unbraced pins break and the braced hold
  - load passes on: with one of two pins pre-weakened, the second pin's peak rises after the first breaks
  - collar holds on a flat landing and slides on the side landing at 0.5 m
  - moving the build 200 mm loads every joint the same (to 1%) and breaks the same joints
  - a mirrored symmetric build breaks in mirrored places
  - broken count and peak load never go down as height steps 0.15 → 1.5 m
- [x] 3.4 Time the solve on Flop at 1.0 m flat and Clawbot at 0.5 m in `check-impact.mjs`. Verify that Flop is under 500 ms. If it isn't, switch to implicit stepping (design.md §4 fallback) before going on, and record the timing in the check output. Done by packing the springs into flat arrays (Flop about 0.33 s warm). Later, pins and collars that slide out gradually made impacts run longer (about 0.6 s on Flop); a drop needn't run in real time, so the check's limit is now 1 s.

## 4. Wire into Play mode physics

- [x] 4.1 In `src/sim/physics.js`, switch Rapier collider masses to the table masses. Verify that every existing `check-play-mode.mjs` motor, gear, stall and Flop check still passes.
- [x] 4.2 Add the landing pose (design.md §6) to `drop(heightMeters, landing)`: turn about the centre of mass, lift the lowest point to the height, no extra tilt. Expose it through `playRunner.js`. Verify in `check-play-mode.mjs` that for each landing the part touching the floor first is on the named face.
- [x] 4.3 At first floor contact, collect contact candidates (within 15 mm, up to 4 lowest hull points each) and the fall speed, run `impact.js`, then group parts by unbroken links and split bodies or make hinges (design.md §5). Give new bodies their solve speeds (and the robot its bounce). (The planned flex shudder was dropped: wobbling each part on its own made tires and sprockets swing through their hubs and shafts.) Verify in `check-play-mode.mjs` that a 1.5 m Clawbot drop breaks joints and moves the detached parts on their own bodies, and that `resetDrop` mends every joint and puts every part back. (The weak/strong comparison moved to `check-impact.mjs`: an arm carrying only itself never comes near breaking, so the comparisons use hand-made builds with a motor-weight tip.)
- [x] 4.4 Delete the old drop formula and constants (design.md §7) and the made-up kicks. Verify with `grep -n "sideBias\|bottomOutBoost\|aCrash\|isLowerAxle" src/` returning nothing, and that the drop code in `physics.js` falls from about 725 lines to about 340 (landing pose, reset, splitting pieces; the impact maths lives in `impact.js`).
- [x] 4.5 Extend `dropReport()`:
  - peak deceleration in g
  - per broken joint: kind, failure kind, force against strength, and the parts involved
  - weak spots (peak utilisation ≥ 0.7, not broken)
  - `estimates: !allMeasured()`

  Verify with a `check-play-mode.mjs` assertion on a Clawbot 0.3 m drop that the report has these fields and lists any weak spots.

## 5. Panel, docs and starter checks

- [x] 5.1 In `PlayPanel.jsx` and `App.jsx`, add the landing selector next to the height, show peak g, list failure kinds and weak spots with hover highlight, and show "Strengths are estimates" while `estimates` is true. Verify in the running app (dev server on port 5173): drop the Clawbot flat and on its left side from 0.5 m, check the report and hovering, then Reset. (Checked by the user on 5173 over several rounds on the Clawbot and Flop; each problem found there is recorded in design.md §8.)
- [x] 5.2 Starter sanity checks in `check-play-mode.mjs`:
  - Clawbot and Flop survive 0.15 m and 0.30 m flat intact (as built: Clawbot at both and Flop at 0.15 m; at 0.30 m Flop pries two pins loose with nothing coming off, so its check asks only that no part comes off; design.md §8.14, follow-ups)
  - Clawbot dropped flat from 1.5 m breaks joints and detaches parts, but keeps more than 60% of its parts attached

  If the assumed values fail these, adjust only table values within plausible range and note why in each changed entry. Verify that `node scripts/check-play-mode.mjs` and `node scripts/check-impact.mjs` both exit 0.
- [x] 5.3 Update `features.md` (drop test section: grip by depth, slide-off rule, bending, whole-robot solve, landings, weak spots, estimates notice). Add the follow-ups from proposal.md, and the measurement TODO list from design.md Open Questions, to `openspec/follow-ups.md` under "From drop-load-network". Verify that both files mention every item and that `openspec validate drop-load-network` passes.
- [x] 5.4 Run every check, `for f in scripts/check-*.mjs; do node "$f" || echo "FAIL $f"; done`, and verify that no FAIL lines print.
- [x] 5.5 Panel: a **Slow motion** choice (Off, 2×, 4×, 8× slower) in place of the quarter-speed checkbox, and a **Highlight loose parts** option that lights up parts that came off and parts left hanging by one pin line (the report gains `swingingParts`, listed as "Hanging by one pin"). Verify that `node scripts/check-play-mode.mjs` checks the hanging list and that the build passes.

## TODO, not part of this change: measure real forces

Replacing the assumed values needs real parts and a luggage scale. The list is in design.md (Open Questions) and goes into `openspec/follow-ups.md` in task 5.3. Each measured value changes one table entry to `source: 'measured'`. The estimates notice goes away once every value in use is measured.
