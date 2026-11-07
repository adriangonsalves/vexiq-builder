## 1. Body graph (pure)

- [x] 1.1 Add `src/sim/bodyGraph.js`: count pin joins per part pair from `jointGraph`, merge pairs with ≥2 fixing joins into bodies; verify in `scripts/check-play-mode.mjs` that a beam on two pins merges with its plate and a beam on one pin doesn't
- [x] 1.2 Add shaft groups as bodies (from `shaftGroups`), with axle joints where a shaft passes through round holes; verify a round-bore idler is left out of its shaft's body and a misaligned square gear gives a warning
- [x] 1.3 Add single-pin hinges between bodies; verify the hinge axis equals the pin axis
- [x] 1.4 Add gear links (with tooth counts and sign) from `gearMeshing.js`, rack links, and chain links from `chainFit.js`; verify a 12→36 pair gives ratio 3 opposite, 8→16 chain gives ratio 2 same direction
- [x] 1.5 Collect setup warnings (loose parts, unfitted squares, off meshes); verify each case in the check script

## 2. Play mode shell and kinematic pass

- [x] 2.1 Add Play mode state and a Tools menu entry; block editing and history while on; verify dragging does nothing and leaving restores poses with history unchanged
- [x] 2.2 Add the Play panel: one throttle per Smart Motor (−1..1, springs to centre on release), row hover highlights the motor, setup warnings list; verify on a phone-width layout too
- [x] 2.3 Kinematic driver: walk motor speed through shaft bodies and ratio links and turn part meshes each frame without touching the store; verify gears in a three-gear train spin at the right speeds and directions on screen

## 3. Rapier physics

- [x] 3.1 Add `@dimforge/rapier3d-compat`, load it on demand, add its WASM to the offline manifest and static build; verify `node scripts/check-offline-manifest.mjs` passes and the editor start-up bundle doesn't include it
- [x] 3.2 Build convex-hull colliders per part type (cached, split for plates and C-channels), compound per body, masses from volume; verify body counts and masses in the check script on Flop
- [x] 3.3 Create Rapier bodies, revolute joints for hinges and axles with contacts disabled between joined bodies, skip list for pairs overlapping on entry; verify Flop at rest stays still for 10 s with no throttle
- [x] 3.4 Motor joints: velocity motor with 0.4 N·m limit driven by throttle; verify a free shaft reaches ~120 rpm at full throttle
- [x] 3.5 Ratio solver each substep for gears, racks and chains; verify a gear train stays at its ratio within 1% under load
- [x] 3.6 Stall detection and display on throttle row and motor; verify an arm driven into the chassis stops, shows stalled, and clears on reverse
- [x] 3.7 Fall back to the kinematic pass with a notice if Rapier fails to load

## 4. Finish

- [x] 4.1 Describe Play mode in `features.md`; run all `node scripts/check-*.mjs` and confirm they pass
- [x] 4.2 Try it on Flop and a clawbot from more than one view; note collider tuning left over in `openspec/follow-ups.md`
