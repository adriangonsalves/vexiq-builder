## Why

The drop test (change `drop-crash-simulator`) decides which pins break with one hand-tuned formula applied at first floor contact. The formula ignores how deep each pin sits, rates pins by total length instead of grip in each part, gives capped pins and rubber collars the wrong strengths, leaves out bending (the main way real pins pry loose), changes its answer when the robot is moved in space (`sideBias` on the sign of x/z), and lowers the load after each break instead of passing it to the pins that are left. Its constants were tuned until the checks passed, so the checks confirm the tuning, not the behaviour.

## What Changes

- **One table of holding strengths** (`src/sim/fastenerStrength.js`), plain data, each value tagged `assumed` until measured:
  - A pin end grips its part with a snap-ridge amount (tip part only) plus an amount for every mm seated in that part, so deeper seating holds more.
  - Two parts on a pin come apart only when the parts on one side slide off their end of the pin. A cap at that end, or the pin's shoulder sitting between them and that end, blocks that way. A capped pin is stronger only because its capped side can't let go.
  - Rubber collars hold a few newtons by friction. Spacers and washers hold nothing, they only push.
  - Each pin and peg also has a sideways strength, and prying loads it as pull. Parts round a shaft only come off the shaft's end. Tires stay on their hubs and the Gen 1 battery in its Brain.
- **Bending:** beams, plates and shafts flex according to their length, width, thickness and material. Long, thin, unbraced parts bend more, which softens the hit and pries the pins at their ends.
- **Impact solved as a whole robot:** at first floor contact, every structural part gets its own mass, every joint and bending part acts as a spring, and the floor pushes back only where parts touch it. The ~40 ms of the impact is stepped finely. Each part decelerates on its own, so a heavy arm on a flexing beam keeps moving and pries its pins. A joint pushed sideways past its strength fails at once; a pin or collar pulled past its grip slides out over time, so a brief jolt loosens it and a sustained or harder pull removes it. A failed joint's load moves to the joints that are left during the same impact.
- **Landing choice:** Flat, Front, Back, Left side, Right side or Corner, using the view cube's directions (+X is Front).
- **Watching it:** slow motion at 2, 4 or 8 times slower, an option to highlight the parts that came loose, and broken-off pieces that collide with the rest of the robot instead of passing through it.
- **Report:** each broken joint says how it failed (pulled out, pried out, slid off, sheared) with its force against its strength. Joints that used 70% or more of their strength are listed as weak spots even when nothing breaks. The panel says the strengths are estimates while any table value is still `assumed`.
- **BREAKING (internal):** delete the old formula and every tuned constant behind it: the candidate subassembly search, `aCrash`, `bottomOutBoost`, the whip mass, the pry and axial shares, `sideBias`, the 0.85 cascade factor and the made-up pop-off kicks. Detached pieces leave with the velocities from the impact solve. `playInputs`' single `pulloutN` per seat gives way to per-seat grip details.
- **Checks test behaviour:**
  - Moving the robot doesn't change the result, and a mirrored robot breaks in mirrored places.
  - Deeper seating always holds more.
  - A higher drop never does less damage.
  - A braced arm survives where the same arm unbraced doesn't.
  - Collars slide on side landings, not flat ones.
  - A capped pin holds its capped side.
- **TODO, measure real forces:** every strength and stiffness starts as a stated assumption. A short set of luggage-scale pulls on real parts (listed in design.md) replaces them, and each measured value is tagged `measured`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `play-mode`: replaces the requirement "Fastener pullout strength and ABS impact compliance" with holding-strength, bending and impact-load requirements, and changes "Drop and crash simulation" (landing choice, failure kinds, weak spots, estimate notice, failure during the impact instead of cascade passes).

## Impact

- New `src/sim/fastenerStrength.js` (the table and the grip rules) and `src/sim/impact.js` (the impact solve; no Rapier, runs in node).
- `src/engine/core.js` `playInputs`: per seat, which end of the insert it's on, whether it's the tip part, the cap and shoulder positions, and the depth seated.
- `src/sim/bodyGraph.js`: joints carry kind, pull/sideways/prying strengths and stiffness instead of one `pulloutN`. Pins are kept in order along their axis.
- `src/sim/physics.js`: the drop code shrinks to setting the landing pose, detecting contact, calling `impact.js` and splitting bodies. About 700 lines of formula are removed.
- `src/components/PlayPanel.jsx`, `src/App.jsx`: landing selector, failure kinds, weak spots, estimate notice.
- `scripts/check-play-mode.mjs`: drop checks rewritten. New `scripts/check-impact.mjs` covers the solve on small hand-made builds.
- `features.md` and the play-mode spec text describing the old numbers.
- `drop-crash-simulator` should be archived first: its spec is already merged into `openspec/specs/play-mode/spec.md`, and this change edits that merged text.
- Out of scope (go to `openspec/follow-ups.md`): the two speed rules under load and gravity, the 62% rolling load and the 25% gravity boost, and second impacts after a bounce.
