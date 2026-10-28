## Context

`occt-import-js` returns one mesh per STEP body, each with a `color` (no per-face colours in these files). `buildGlbFromOcctResult` puts near-black meshes in a second primitive with a material named `rubber`. `geometryCache.js` turns that into `geo.userData.rubber`. `Viewport3D` and `PartThumbnail` then use a fixed black material for it. Everything else is one primitive with no material, and the app colours it with the part colour.

## Goals / Non-Goals

**Goals:** keep every STEP colour in the 11 multi-colour files, in the 3D view and in thumbnails, while the main body still takes the part colour.

**Non-Goals:** using the colour from single-colour STEP files as the default colour; per-face colours; letting the user recolour the extra bodies.

## Decisions

- **Group by colour.** Round each mesh colour to 8-bit RGB. Meshes with the same colour go in one primitive. The group with the most faces is the main body and comes first, with no material, as now. Every other group gets a material named `step:#rrggbb` with that `baseColorFactor`. Near-black groups keep the name `rubber`, so rubber keeps its rougher material. One primitive per colour keeps the draw count low; the omni wheel has 3 colours across 30+ meshes.
- **Main body = most faces.** On the motor shaft the white shaft has 34 faces and the red ring 12. On the omni wheel the grey frame has 580. This beats "largest volume", which isn't available without extra work.
- **App side.** `geometryCache` sets `userData.fixedColor = '#rrggbb'` for `step:` materials and keeps `userData.rubber` for rubber. Viewport and thumbnail build one material per fixed colour, and the thumbnail runs it through `thumbnailColor`. The existing `mesh.userData.fixedColor` check in Viewport3D already keeps recolouring off those meshes.
- **Cache.** `convert-parts.mjs` skips parts that already have a GLB. The 11 files must be forced: delete their GLBs, or add a converter version to the cache key so `npm run convert` rebuilds them.

- **Control parts.** Same rule. The Smart Motor's dark red (46,4,7) and the cable's black (18,18,18) are above the rubber limit (0.06), so they become `step:` colours, not rubber. Main bodies by face count: motor 334-face dark body, brain 1549-face dark body, cable 538-face grey, sensors 155–254-face grey. The Brain with Battery part is built from the brain and battery GLBs, so it must be rebuilt after them.
- **Reflective metallic silver for non-plastic shafts.** Non-plastic shafts (motor shafts, capped shafts, standard axles) are detected via `isMetalPart` / `isMetalShaftName` and assigned `category: 'Shafts, Spacers & Collars'`, `defaultColor: '#e2e8f0'`, and rendered with physical metallic parameters (`metalness: 0.85`, `roughness: 0.22`). Plastic shafts retain standard plastic parameters (`metalness: 0.12`, `roughness: 0.38`). The motor shaft red stop ring remains intact as a `step:#a40508` accent.
- **Scan subfolders.** `VEX-IQ-All-Control/` keeps each part in its own subfolder; the check script must walk subfolders, as `convert-parts.mjs` already does.

## Risks / Trade-offs

- [Rope or shock absorber main body picked wrong] → check each of the 11 by screenshot; add an override list if one is wrong.
- [Thumbnail cache key is `id|defaultColor`] → old thumbnails aren't stored between sessions, so a reload is enough.
