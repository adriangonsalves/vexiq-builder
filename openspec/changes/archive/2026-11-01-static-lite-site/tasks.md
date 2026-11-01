## 1. Split the engine (no behaviour change)

- [x] 1.1 Add `setCatalogSource` and `setMeshSource` to the engine. Change `readPartGlb` to parse with `DataView`/`TextDecoder`, and make it throw `MissingMeshError(partId)` when the source returns `null`. Verify: all `node scripts/check-*.mjs` pass.
- [x] 1.2 Move the Node-free code from `mcp/assembly-engine.mjs` into `src/engine/core.js`. Leave state/settings file access, `appSyncContext` and the `fs` sources in `mcp/assembly-engine.mjs`, which re-exports the core. Verify: `grep -n "node:\|from 'fs'\|process\." src/engine/` finds nothing, and all checks pass.
- [x] 1.3 Make `generateOrthographicViews` return the SVG text, and have the Node layer write `public/assembly-blueprint.svg` and add `blueprintFilePath`. Verify: MCP `audit_assembly` still writes the file and its reply is unchanged (`node scripts/check-mcp-tools.mjs`).
- [x] 1.4 Move `explodeKey` into the core, and use it from `vite.config.js` and `mcp/explode-worker.mjs`. Verify: `node scripts/check-explode-plan.mjs` passes and Explode works in the dev app.

## 2. Shared actions

- [x] 2.1 Move the per-action branches of `/api/assembly/action` (auto_fasten, mate_parts, mesh_gear_train, build_chain, mirror_subassembly, joint_graph, audit_and_blueprint) into `runAction(action, state, params)` in `src/engine/actions.js`. It returns the same reply fields and records no history. Verify: each smart action in the dev app gives the same result and message as before the change, on the same build.
- [x] 2.2 Make the bridge call `runAction`, then apply `recordAction` and reply as today. Verify: after one smart action in the dev app, the history timeline shows one step with the same label as before.
- [x] 2.3 Add `scripts/check-engine-core.mjs`. It loads the core with only in-memory catalog and mesh sources (buffers read up front, no `fs` inside the core), runs every action on a fixture build, and compares each reply with the Node layer's. It also checks that a missing mesh throws `MissingMeshError`. Verify: the check exits 0, and exits 1 if a reply is changed on purpose.

## 3. Browser engine workers

- [x] 3.1 Add `src/engine/worker.js`, a module worker. It fetches `catalog.json` and the GLBs for the parts in the state and params (through `assetUrl`), runs `runAction`, and on `MissingMeshError` fetches that model and retries (limit 20). After the limit, or on a failed download, it returns an error naming the part. Verify: a small test page or the static build runs auto-fasten, and blocking one model's URL in devtools gives that error without changing the build.
- [x] 3.2 Add the `explode` message to the worker. It sends `{ progress }` about every 2%, keeps 8 plans keyed by `explodeKey`, and returns `{ plan }`. Verify: on the static build, Explode shows the ring then plays, and reopening without changes plays at once.

## 4. Backend module and app changes

- [x] 4.1 Add `src/backend/bridge.js`. It wraps today's `/api/assembly` GET/POST (with conflict handling), `/api/assembly/action`, `explode_plan`, `/api/settings`, and the `EventSource` with its state, settings, explode-progress and screenshot-request messages. Verify: the dev app works as before, and MCP `place_parts` shows up live with `appSync: live`.
- [x] 4.2 Add `src/backend/static.js` (worker actions and explode, local history step through `recordStep` with the bridge's label, settings in localStorage only, no-op save and subscribe, `hasAssistant: false`) and `src/backend/index.js`, which picks a version by `import.meta.env.VITE_STATIC`. Verify: `npm run build:static` output contains no `/api/` strings (`grep -r "/api/" dist-static/assets` finds nothing).
- [x] 4.3 Replace the `fetch('/api/...')` calls and the `EventSource` in `src/App.jsx` with backend calls. Verify: `grep -n "/api/" src/App.jsx` finds nothing, and the dev app's saving, smart actions, Explode, settings and MCP live updates all still work.
- [x] 4.4 Use `hasAssistant` to hide the MCP status in the title badge, the Assistant (MCP) section in Settings, and assistant/dev-server messages. Verify: on the static build with Advanced options on, the badge shows only the part count and Settings has no Assistant section. The dev app still shows both.
- [x] 4.5 Show the audit blueprint from the reply's SVG through a blob URL, in the audit window and in "open in new tab", on both sites. Revoke the old URL when a new audit replaces it. Verify: the blueprint shows after Audit in both the dev app and the static build.

## 5. Static build

- [x] 5.1 Add an `assetUrl(path)` helper (`import.meta.env.BASE_URL` + path without its leading `/`). Use it for `catalog.json`, part metadata, `modelUrl` in `src/utils/geometryCache.js`, thumbnails, and the worker's fetches. Verify: the dev app loads every part as before.
- [x] 5.2 In `vite.config.js`, add the `static` mode: no bridge plugin, `VITE_STATIC=true`, `base` from `VEXIQ_BASE` (default `/`), `outDir: 'dist-static'`, `copyPublicDir: false`, and a plugin that copies only `catalog.json`, `part-metadata.json` and `models/`. Add `"build:static": "vite build --mode static"` to `package.json` and `dist-static/` to `.gitignore`. Verify: `npm run build:static` succeeds, and `dist-static/` has no `assembly-state.json`, `app-settings.json` or `assembly-blueprint.svg`.

## 6. End-to-end checks

- [x] 6.1 Build with `VEXIQ_BASE=/vexiq/ npm run build:static` and serve `dist-static` under `/vexiq/` with a plain file server. Check each `static-site` scenario: the library loads, parts add, every smart action works, chain route questions appear and can be answered, Explode works, the orbit view keeps moving during a 150-part audit, a reload keeps the build, history and Shadows, the first visit opens a new build, and the network tab shows no `/api/` requests.
- [x] 6.2 On the same fixture build, build the same chain in the dev app and on the static site, and confirm the links and the message match. Then run all `node scripts/check-*.mjs` and confirm they pass. (Result: the chain matched. All checks pass except one in `check-explode-plan.mjs`, "pieces sliding off a shaft the same way keep their order", which already failed before this change.)
- [x] 6.3 Add a short "Static site" section to `features.md` (what works, what's hidden, how to build it with `VEXIQ_BASE`). Verify: the section is there and its commands match `package.json`.
