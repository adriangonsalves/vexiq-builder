## Context

Hiding, showing, colouring or selecting a part re-runs the overlap check for every part. On a 300+ part robot most pairs are unchanged between two such edits, so nearly all the mesh tests were repeats. Separately, three.js rebuilds a material's shader whenever `needsUpdate` is set or the light setup it was built for changes.

## Decisions

- **Key a pair's answer on what it depends on.** Each answer is stored under the two part ids (sorted, so either order finds it) and the tight-fit flag, with each part's world matrix, motor hub angle and collision geometry objects. A reuse needs all of them to match exactly. Comparing 16 numbers per part is far cheaper than a mesh test, and any move, turn, hub turn or shape change (a bent sheet) misses the store and tests again. Alternative: clearing per part on every change. Rejected: it needs every code path that moves a part to remember to clear it.
- **Quick rejections run before the store.** Box overlap, tire-on-hub, chain fit and shaft-in-motor-socket are checked first as before, so the store only holds pairs that reach the mesh test.
- **Cap the store.** It is cleared at 200,000 pairs and whenever the catalog map changes, so it can't grow without limit or hold answers for old shapes.
- **Rebuild a material only when solid/see-through changes.** Colour, emissive and opacity are uniforms and take effect without a rebuild; `transparent` and `depthWrite` change the shader, so only those flag `needsUpdate`.
- **Put the lights on the selection layer.** The outline mask pass renders only `SELECT_LAYER`. With the lights off that layer, each frame alternated between two light setups and every material was rebuilt twice per frame. Enabling the lights on that layer changes nothing visible (the mask pass ignores lighting) and keeps one setup.
- **Memoise the library cards.** The cards depend on the filtered catalog and the view; their handlers are read through a ref so they always call the current functions without making the cards depend on them.

## Risks / Trade-offs

- [A change the store doesn't key on (a new kind of shape) would reuse a stale answer.] → The key includes the collision geometry objects themselves, so anything that replaces a part's shape misses it; a new kind of change must either replace those objects or be added to the key.
- [Memory] → Each entry holds two 16-number matrices; the 200,000 cap bounds it at a few tens of MB in the worst case.
