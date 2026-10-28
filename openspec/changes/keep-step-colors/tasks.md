## 1. Converter

- [ ] 1.1 In `scripts/convert-worker.mjs`, group meshes by 8-bit colour; main group (most faces) first with no material; near-black groups → `rubber`; others → `step:#rrggbb` material
- [ ] 1.2 Make `npm run convert` rebuild every multi-colour part: the 11 in `VEX-IQ-All-Parts/` and the 7 in `VEX-IQ-All-Control/` (Smart Motor, Robot Brain, Cable Pack, Touch/Distance/Color/Gyro sensors), via a converter version in the cache check or by deleting their GLBs
- [ ] 1.3 Rebuild the Robot Brain with Battery part after the brain, so it carries the brain's colours
- [ ] 1.4 Add `scripts/check-step-colors.mjs`: walk both STEP folders (including subfolders), list files with more than one colour, and check each GLB has a material for every extra colour

## 2. App

- [ ] 2.1 `src/utils/geometryCache.js`: set `userData.fixedColor` from `step:` materials, keep `userData.rubber`
- [ ] 2.2 `src/components/Viewport3D.jsx`: one material per fixed colour; recolouring leaves them alone
- [ ] 2.3 `src/components/PartThumbnail.jsx`: draw fixed colours through `thumbnailColor`

## 3. Check

- [ ] 3.1 Run `npm run convert` and `npm run index-metadata` (link the STEP folders in a worktree first)
- [ ] 3.2 Screenshot each of the rebuilt parts and their thumbnails; confirm the motor shaft ring is red, omni wheel rollers are still black, and the Smart Motor, brain, sensors and cable show their colours
- [ ] 3.3 Run `node scripts/check-*.mjs`
