## Why

The app only runs under `npm run dev`, because the Vite dev server does real work: it saves the build, runs the smart actions (fasten, mate, gear trains, chains, mirror, joint graph, audit) and works out explode plans. That means nobody can try the builder without cloning the repo. A static version that any web host can serve (GitHub Pages, Netlify, Cloudflare Pages) would let people use it from a link.

## What Changes

- Split `mcp/assembly-engine.mjs` into a **browser-safe core** (catalog lookup, collision meshes, audit, mating, gear meshing, chain building, mirroring, joint graph, explode plan, blueprint SVG) and a **Node layer** (state file, settings file, app sync, `AsyncLocalStorage`) that the MCP server and dev bridge keep using. The core gets its part meshes and catalog from a provider the caller sets, instead of reading `public/` with `fs`.
- Add an **engine Web Worker** for the browser that loads the core, fetches the meshes it needs, and answers the same actions as `/api/assembly/action` today, with progress messages for explode plans.
- Put the app's server calls behind one **backend** module with two versions:
  - **bridge** (dev, today's behaviour): `/api/assembly`, `/api/assembly/action`, `/api/settings`, the event stream and screenshots;
  - **static**: smart actions run in the engine worker, settings stay in local storage, builds stay in the build library (IndexedDB, which already exists), and there is no event stream or screenshot relay.
- Add `npm run build:static`, which builds the static site into `dist-static/` with a configurable base path and copies only the files the site needs (`catalog.json`, `part-metadata.json`, `models/`).
- On the static site, hide what only works with a local server: the MCP status badge, the Assistant (MCP) section in Settings, and anything that waits for the assistant.
- `npm run dev`, the MCP server and every MCP tool keep working exactly as now.

## Capabilities

### New Capabilities
- `static-site`: the app can be built and served as plain files with no server code. It covers the static build command, smart actions and explode plans running in the browser, saving and settings without a server, hiding the MCP-only parts of the interface, and loading part meshes for the engine on demand.

### Modified Capabilities
<!-- None: dev-mode behaviour, the MCP tools and the existing specs stay as they are. The static
     site's differences (no Assistant section, no MCP badge) are described in static-site. -->

## Impact

- **Code:** `mcp/assembly-engine.mjs` (split), new `src/engine/` (browser core entry + worker), new `src/backend/` (bridge and static versions), `src/App.jsx` (six `fetch('/api/...')` calls and the `EventSource` move behind the backend), `vite.config.js` (static build mode; the bridge imports the Node layer), `mcp/explode-worker.mjs` and `mcp/vexiq-mcp-server.mjs` (new import paths).
- **Build:** new `build:static` script and `dist-static/` output (git-ignored). Site size is about 100 MB, mostly the 482 part models in `public/models/`.
- **Checks:** existing `scripts/check-*.mjs` must still pass. A new check runs the core with an in-memory mesh provider (no `fs`) to prove it doesn't depend on Node.
- **Dependencies:** none added.
- **Out of scope:** hosting or deploy setup for a specific provider, compressing the models, sharing builds by link, and any assistant/MCP features on the static site.
