## Context

See proposal.md for why. Today:

- `mcp/assembly-engine.mjs` (about 2,700 lines) holds all the geometry work. Most of it is plain JavaScript on three.js, three-mesh-bvh and `src/utils/*`, which already run in the browser. The Node-only parts are few: `fs` reads of `public/catalog.json` and of each part's GLB (`readPartGlb`, which also uses `Buffer.readUInt32LE` / `toString`), `fs` writes of the state file and `assembly-blueprint.svg`, settings reads, and `AsyncLocalStorage` (`appSyncContext`) for per-call MCP bookkeeping.
- `vite.config.js` holds the dev bridge. Its `/api/assembly/action` handler does more than call the engine: each action's branch (lines ~236–560) checks inputs, calls engine functions, builds the reply message, and, through `recordAction`, records the change as one history step on top of the saved file.
- Explode plans run in a Node worker thread (`mcp/explode-worker.mjs` → `explodePlanFor`), with a cache of 8 plans keyed by the visible parts.
- `src/App.jsx` talks to the server in six places (`/api/assembly` GET/POST, `/api/assembly/action` ×3, `/api/settings` GET/POST), plus an `EventSource` on `/api/assembly/events` and the screenshot reply. Builds already save themselves to IndexedDB (`src/utils/buildLibrary.js`), and settings already have a localStorage copy, so the browser side of saving mostly exists.
- The catalog's `modelUrl` values start with `/` (`/models/…glb`), and the audit window loads `/assembly-blueprint.svg`, a file the server writes.

## Goals / Non-Goals

**Goals:**
- One engine codebase used by the MCP server, the dev bridge and the browser, so the dev app and the static site give the same results.
- The static bundle has no bridge code and makes no `/api` requests.
- MCP tools, `npm run dev` and the existing checks don't change behaviour.

**Non-Goals:**
- Making the engine async throughout. The synchronous engine stays; the browser side feeds it meshes before and during a call (Decision 2).
- Speeding up the engine or shrinking models.
- Running the MCP server against the static site.

## Decisions

### 1. Core in `src/engine/`, Node layer stays at `mcp/assembly-engine.mjs`

Move everything that doesn't need Node into `src/engine/core.js` (split into a few files if it helps reading). `mcp/assembly-engine.mjs` becomes the Node layer: it sets up the core's catalog and mesh sources from `fs`, keeps `readAssemblyState` / `writeAssemblyState` / `appSyncContext` / `readAppSettings`, writes the blueprint file, and re-exports the core's functions. That way `mcp/vexiq-mcp-server.mjs`, `vite.config.js` and the `scripts/check-*.mjs` keep their imports.

*Alternative:* keep the core under `mcp/` and import it from `src/`. Rejected: `src/` is what Vite bundles and where shared browser code already lives (`src/utils`); the core belongs with it.

### 2. Meshes and catalog come from sources the caller sets; misses are fetched and retried

The core gets two setters: `setCatalogSource(() => catalogArray)` and `setMeshSource((part) => ArrayBuffer | null)`. `readPartGlb` parses with `DataView` and `TextDecoder` instead of `Buffer`. When the mesh source returns `null`, the core throws a `MissingMeshError` carrying the part id.

- **Node:** both sources read from `public/` with `fs` (the catalog keeps today's reload-on-change check).
- **Browser worker:** before running an action, it fetches the GLBs for every distinct part in the state and in the action's parameters. If the core still throws `MissingMeshError` (an action that adds parts, such as auto-fasten pins or chain links), the worker fetches that model and runs the action again from the same input, up to a fixed number of tries. Fetched buffers are kept for the visit.

*Alternative:* make every geometry function async. Rejected: it touches hundreds of call sites in collision and audit code, and changes behaviour for the MCP server too. Retry is safe because actions are pure functions of `(state, params)` in the browser (Decision 3).

### 3. One shared `runAction`; history is recorded by the caller

Move the per-action branches out of `vite.config.js` into `src/engine/actions.js`: `runAction(action, state, params) → { ok, state?, message?, graph?, audit?, ortho?, needsRoute?, … }`, with the same reply fields the bridge sends now. It doesn't read or write files and doesn't record history.

- **Bridge:** calls `runAction`, then applies `recordAction` (merge with the saved file, one history step) as today, and replies.
- **Static:** the app gets the reply from the worker and records the step itself with `recordStep` from `src/utils/buildHistory.js`, using the same label the bridge uses (`${action}: ${summarize(ops)}` or the action's own label).

That way the two paths can't drift in their geometry, and a check can compare them (task 6.2).

### 4. `generateOrthographicViews` returns the SVG text

The core returns `{ …, svg }` instead of writing a file. The Node layer writes `public/assembly-blueprint.svg` and adds `blueprintFilePath`, so MCP replies don't change. In the app, the audit window shows the SVG from the reply through a blob URL (on both sites), in place of `/assembly-blueprint.svg?t=…`.

### 5. A `backend` module chosen at build time

`src/backend/index.js` exports one interface, and `import.meta.env.VITE_STATIC` picks the version, so the static bundle leaves the bridge out:

| Method | bridge (dev) | static |
|---|---|---|
| `loadInitialState()` | `GET /api/assembly` | `null` (the build library opens the current build) |
| `saveState(payload)` | `POST /api/assembly` with conflict handling | no-op (the build library already auto-saves) |
| `runAction(action, state, params)` | `POST /api/assembly/action` | engine worker + local history step |
| `explodePlan(state, mode, onProgress)` | `explode_plan` action + SSE progress | explode worker |
| `loadSettings()` / `saveSettings(s)` | `/api/settings` + localStorage copy | localStorage only |
| `subscribe(handlers)` | `EventSource` (state, settings, progress, screenshot requests) | no-op |
| `hasAssistant` | `true` | `false` |

`App.jsx` swaps its `fetch`/`EventSource` calls for these. `hasAssistant` hides the MCP badge and the Assistant section in Settings.

*Alternative:* a runtime check ("is `/api` there?"). Rejected: it adds a failing request on every static load, ships the bridge code anyway, and can mistake a slow dev server for a static host.

### 6. Two browser workers: actions and explode

`src/engine/worker.js` is a module worker that loads the core and answers `{ id, kind: 'action' | 'explode', … }` with `{ id, progress }` and `{ id, result | error }`. The backend starts **two** of them, one for actions and one for explode plans, so a long plan doesn't hold up a quick fasten (this matches the dev setup, where explode has its own thread). The explode worker keeps the same 8-plan cache and key as `vite.config.js` (move `explodeKey` into the core so both use it). Each worker keeps its own mesh buffers; the browser's HTTP cache means a model is downloaded only once.

### 7. Static build: `vite build --mode static`

`npm run build:static` runs `vite build --mode static`. In that mode `vite.config.js`:
- leaves out `vexiqMcpBridgePlugin`;
- defines `VITE_STATIC=true`, sets `base` from `VEXIQ_BASE` (default `/`), and `build.outDir: 'dist-static'`;
- sets `build.copyPublicDir: false`, and a small plugin copies only `catalog.json`, `part-metadata.json` and `models/` from `public/`.

Asset URLs go through one helper, `assetUrl(path)` = `import.meta.env.BASE_URL` + path without its leading `/`. It's used for `catalog.json`, part-metadata, each `modelUrl` in `geometryCache.js` and the worker's fetches. In dev, `BASE_URL` is `/`, so nothing changes.

## Risks / Trade-offs

- **[The two paths drift apart]** → One `runAction` (Decision 3), plus a check that runs a fixture build through the Node path and through the core with an in-memory mesh source and compares the replies.
- **[Something Node-only hides in the core]** → A check imports the core with only in-memory sources and runs every action. The static build fails if anything pulls in `node:` modules (Vite reports it).
- **[First action on a big build is slow on the static site]** (each worker downloads and builds collision meshes for every part in it) → Models are already cached by the browser from drawing the view. The worker keeps its BVHs for the visit. The action button shows the busy state it already has.
- **[Memory]**: two workers each hold collision meshes → acceptable at today's build sizes. If it becomes a problem, the explode worker can be started on first use and stopped when the panel closes.
- **[Retry on missing mesh runs part of an action twice]** → Actions are pure in the worker, so a retry gives the same result. The try limit stops a loop and reports the part, as the spec asks.
- **[Site size ~100 MB]** → Within the free limits of common static hosts. Compressing models is left for later (see proposal, out of scope).

## Migration Plan

Nothing to migrate: dev mode keeps its files and behaviour, and the static site starts with whatever is in each visitor's browser. To roll back, delete `dist-static/` and stop publishing it. The refactor (Decisions 1–4) can land and be checked in dev before the static build exists.

## Open Questions

- Which host to publish to first (GitHub Pages, Netlify, Cloudflare Pages). This only changes the `VEXIQ_BASE` value and a deploy step, not the work here.
