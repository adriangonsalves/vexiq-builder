## Why

Some official STEP files colour their pieces in more than one colour. The metal motor shafts (2x, 3x and 4x Pitch Motor Shaft) are white with a red stop ring. In the app they are drawn in a single colour, so the ring can't be seen, and it's the part of the shaft that shows which way round it goes. The converter only keeps one extra colour: near-black rubber.

A scan of all 468 STEP files in `VEX-IQ-All-Parts/` (2026-10-27) found 11 with more than one colour: the three metal motor shafts, four ropes, the 200 mm omni wheel, the weak shock absorber and the two Ant antennas. 39 files have one colour and 418 have none.

The 11 control parts in `VEX-IQ-All-Control/` (one subfolder each) are mostly multi-colour. 7 of them are:
- Smart Motor (228-2560): dark body, grey, dark red
- Robot Brain (228-2540): dark body, grey
- Cable Pack (228-2780): grey, orange, black
- Touch Sensor (228-3010), Distance Sensor (228-3011), Color Sensor (228-3012) and Gyro Sensor (228-3014): grey body, darker grey

The Controller, Battery, Radio and Bumper Switch have one colour each. The **VEX IQ Robot Brain with Battery** part (228-2540 + 228-2604) is built from the brain, so it picks up the brain's colours.

## What Changes

- The converter keeps every colour body in a STEP file that has more than one colour, not just black rubber. Each body becomes its own colour group in the part's model file, in the colour the STEP file gives it.
- The body with the most faces counts as the part's main body. It still takes the part's colour (the default, or one the user picks). Every other colour body keeps its STEP colour.
- The 3D view and the parts-list thumbnails both draw those extra colours. The thumbnail lifts very dark colours so they can still be seen, as it does now.
- Black rubber keeps working as it does now. It becomes one case of the general rule.
- Non-plastic metal shafts (motor shafts, capped shafts, standard axles) render with a reflective metallic silver finish (`#e2e8f0`, `metalness: 0.85`, `roughness: 0.22`), while their accent bodies (such as the motor shaft red stop ring) stay in their distinct STEP colours.
- STEP files with one colour or none don't change. Using a single STEP colour as the part's default colour is left for later.
- Re-run `npm run convert` so the 11 multi-colour parts and the 7 multi-colour control parts (plus Robot Brain with Battery) get rebuilt.

## Capabilities

### New Capabilities
- `step-part-colors`: parts keep the extra colours their STEP files give them, in the 3D view and in thumbnails.

### Modified Capabilities
<!-- none -->

## Impact

- `scripts/convert-worker.mjs`: group meshes by colour, not just into rubber and everything else.
- `src/utils/geometryCache.js`, `src/components/Viewport3D.jsx`, `src/components/PartThumbnail.jsx`: read each group's colour, in place of the single rubber flag.
- `public/models/*.glb` for the 19 rebuilt parts, plus `public/parts-catalog.json` if their sizes change.
- Saved builds don't change. Their colours still apply to the main body.
