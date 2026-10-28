## 1. Converter

- [x] 1.1 In `scripts/convert-worker.mjs`, group meshes by 8-bit colour; main group (most faces) first with no material; near-black groups → `rubber`; others → `step:#rrggbb` material
- [x] 1.2 Make `npm run convert` rebuild every multi-colour part: the 11 in `VEX-IQ-All-Parts/` and the 7 in `VEX-IQ-All-Control/` (Smart Motor, Robot Brain, Cable Pack, Touch/Distance/Color/Gyro sensors), via a converter version in the cache check or by deleting their GLBs
- [x] 1.3 Rebuild the Robot Brain with Battery part after the brain, so it carries the brain's colours
- [x] 1.4 Add `scripts/check-step-colors.mjs`: walk both STEP folders (including subfolders), list files with more than one colour, and check each GLB has a material for every extra colour

## 2. App

- [x] 2.1 `src/utils/geometryCache.js`: set `userData.fixedColor` from `step:` materials, keep `userData.rubber`
- [x] 2.2 `src/components/Viewport3D.jsx`: one material per fixed colour; recolouring leaves them alone
- [x] 2.3 `src/components/PartThumbnail.jsx`: draw fixed colours through `thumbnailColor`

## 3. Check

- [x] 3.1 Run `npm run convert` and `npm run index-metadata` (link the STEP folders in a worktree first)
- [x] 3.2 Screenshot each of the rebuilt parts and their thumbnails; confirm the motor shaft ring is red, omni wheel rollers are still black, and the Smart Motor, brain, sensors and cable show their colours
- [x] 3.3 Run `node scripts/check-*.mjs`

## 4. Reflective Metallic Silver for Metal Shafts

- [x] 4.1 Update `scripts/convert-parts.mjs` and `public/catalog.json`: detect metal shafts (`isMetalShaftName`), set `category: 'Shafts, Spacers & Collars'`, `defaultColor: '#e2e8f0'`, and `isMetal: true`
- [x] 4.2 In `src/utils/geometryCache.js`, `src/components/Viewport3D.jsx`, and `src/components/PartThumbnail.jsx`: render non-plastic shafts with metallic reflective parameters (`metalness: 0.85`, `roughness: 0.22`), while preserving fixed accent rings
- [x] 4.3 Verify all check scripts and production build pass cleanly
