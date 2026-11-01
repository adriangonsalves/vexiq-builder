/**
 * The assembly engine for Node (the MCP server, the dev bridge and the checks): the browser-safe
 * core in src/engine/core.js, with its catalog and meshes read from public/, plus the saved
 * assembly file, the app settings file, the blueprint file and app sync.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOps, diffParts, fromLegacy, loadHistory, recordStep, summarize } from '../src/utils/buildHistory.js';
import { isLinearHistory, normalizeSettings } from '../src/utils/appSettings.js';
import { syncSelection } from '../src/utils/partGroups.js';
import {
  buildDefaultStarterState,
  generateOrthographicViews as orthographicViews,
  setCatalogSource,
  setMeshSource
} from '../src/engine/core.js';

export * from '../src/engine/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const CATALOG_PATH = path.join(ROOT_DIR, 'public', 'catalog.json');
// VEXIQ_STATE_PATH lets checks run against a temporary assembly file instead of the user's
export const STATE_PATH = process.env.VEXIQ_STATE_PATH || path.join(ROOT_DIR, 'public', 'assembly-state.json');
// The app's settings (openspec app-settings), shared with the app through its bridge
export const SETTINGS_PATH = process.env.VEXIQ_SETTINGS_PATH || path.join(ROOT_DIR, 'public', 'app-settings.json');

/** The app's settings, read fresh on every call (defaults when the file is missing or bad). */
export function readAppSettings() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')));
  } catch {
    return normalizeSettings(null);
  }
}

// catalog.json and models/ read from public/, the catalog read again when the file changes
let catalogMtimeMs = 0;
let fileCatalog = null;
setCatalogSource(() => {
  const stat = fs.statSync(CATALOG_PATH);
  if (!fileCatalog || stat.mtimeMs !== catalogMtimeMs) {
    fileCatalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    catalogMtimeMs = stat.mtimeMs;
  }
  return fileCatalog;
});
setMeshSource((part) => fs.readFileSync(path.join(ROOT_DIR, 'public', part.modelUrl.replace(/^\//, ''))));

/**
 * Writes a blueprint's picture (`ortho.svg`, from the core's generateOrthographicViews) to
 * public/assembly-blueprint.svg, and returns the blueprint with `blueprintFilePath` and
 * `blueprintUrl` in place of the picture (or alongside it with `keepSvg`).
 */
export function writeBlueprint(ortho, { keepSvg = false } = {}) {
  const { ok, svg, ...rest } = ortho;
  const blueprintFilePath = path.join(ROOT_DIR, 'public', 'assembly-blueprint.svg');
  fs.writeFileSync(blueprintFilePath, svg);
  return { ok, blueprintFilePath, blueprintUrl: '/assembly-blueprint.svg', ...rest, ...(keepSvg ? { svg } : {}) };
}

/** The blueprint and its summary, with the picture written to public/assembly-blueprint.svg. */
export function generateOrthographicViews(state, options) {
  return writeBlueprint(orthographicViews(state), options);
}

// The saved state with its history (files without one get a "Starting assembly" step), or null
function readStateFile() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      if (data && Array.isArray(data.instances)) {
        const history = loadHistory(data.history, data.instances);
        return { ...data, history, historyRev: history.rev };
      }
    }
  } catch {
    // fallback in readAssemblyState
  }
  return null;
}

export function readAssemblyState() {
  let state = readStateFile();
  if (!state) {
    const starter = buildDefaultStarterState();
    const history = fromLegacy(starter.instances);
    state = { ...starter, history, historyRev: history.rev };
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }
  // The parts this tool call started from, so its change can be recorded (and rebased) as one step
  const store = appSyncContext.getStore();
  if (store && !store.baseInstances) store.baseInstances = JSON.parse(JSON.stringify(state.instances));
  return state;
}

/**
 * Per tool call: whether the open app received the last saved change. The MCP server runs each
 * call inside `appSyncContext.run(store, ...)`; writeAssemblyState fills `store.appSync`
 * ('live' | 'no-browser' | 'saved-to-file-only') and `store.appHint`. The server also puts the
 * tool's name and a call id in the store, so the call's change is recorded as one history step
 * (`store.historyStep`, `store.historyBranched`).
 */
export const appSyncContext = new AsyncLocalStorage();

export const appUrl = () => `http://localhost:${process.env.VEXIQ_APP_PORT || 5173}`;

// "<tool>: <summary>", e.g. "place_parts: 72 parts"; clearing says only the tool
// `stepLabel`: the tool's own wording (e.g. "Move Left Drive"), used instead of the op summary
function mcpStepLabel(toolName, ops, stepLabel) {
  if (stepLabel) return toolName ? `${toolName}: ${stepLabel}` : stepLabel;
  if (!toolName) return summarize(ops);
  if (toolName === 'clear_assembly') {
    return ops.every((op) => op.op === 'remove') ? 'clear_assembly' : 'clear_assembly: starter';
  }
  return `${toolName}: ${summarize(ops)}`;
}

/**
 * Saves the state and tells the open app. Unless `recordHistory` is false (undo/redo, which pass
 * their own moved history), the change is recorded as one step on top of the saved history. When
 * the app changed the parts while this call ran, the call's own change is applied on top of the
 * app's instead of overwriting it.
 */
export async function writeAssemblyState(nextState, options = {}) {
  const { notifyVite = true, recordHistory = true, stepLabel } =
    typeof options === 'boolean' ? { notifyVite: options } : options;
  const store = appSyncContext.getStore();
  let instances = nextState.instances || [];
  let history = nextState.history;

  if (recordHistory) {
    const saved = readStateFile() || { instances: [], history: fromLegacy([]) };
    const base = store?.baseInstances || saved.instances;
    if (diffParts(base, saved.instances).length > 0) {
      instances = applyOps(saved.instances, diffParts(base, instances));
    }
    const recorded = recordStep(saved.history, saved.instances, instances, {
      source: 'mcp',
      label: (ops) => mcpStepLabel(store?.toolName, ops, stepLabel),
      mergeKey: store?.callId ? `mcp:${store.callId}` : undefined,
      mergeWindowMs: Infinity,
      linear: isLinearHistory(readAppSettings())
    });
    history = recorded.history;
    if (store) {
      store.baseInstances = JSON.parse(JSON.stringify(instances));
      if (recorded.step) store.historyStep = recorded.step.label;
      if (recorded.branched) store.historyBranched = true;
    }
  }

  const state = syncSelection({
    ...nextState,
    instances,
    history,
    historyRev: history?.rev ?? 0,
    updatedAt: new Date().toISOString()
  });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  if (notifyVite) {
    const store = appSyncContext.getStore();
    try {
      const res = await fetch(`${appUrl()}/api/assembly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mcp-source': 'mcp-server' },
        body: JSON.stringify(state)
      });
      const reply = await res.json().catch(() => ({}));
      if (store) {
        // An older bridge doesn't report browserClients; assume someone is watching
        const browsers = typeof reply.browserClients === 'number' ? reply.browserClients : 1;
        store.appSync = browsers > 0 ? 'live' : 'no-browser';
        store.appHint = browsers > 0 ? undefined : `No browser has the app open. Open ${appUrl()} to see it.`;
      }
    } catch {
      // Vite server isn't running or reachable; file state is already persisted
      if (store) {
        store.appSync = 'saved-to-file-only';
        store.appHint = "The app isn't running, so this was only saved to the file. Start it with `npm run dev`.";
      }
    }
  }
  return state;
}
