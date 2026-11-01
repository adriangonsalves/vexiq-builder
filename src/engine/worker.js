/**
 * The engine in the browser (openspec static-lite-site): runs the smart actions and explode plans
 * off the page's main thread, with the catalog and part models fetched from the site.
 * Messages in:  { id, kind: 'action', action, state, params } or { id, kind: 'explode', state, mode }.
 * Messages out: { id, progress } (explode, 0..1, every 2% or so), then { id, result } or { id, error }.
 * Actions are pure here (nothing is saved or recorded), so an action that needs a model that isn't
 * loaded yet is run again from the same input once the model is in.
 */
import { MissingMeshError, explodeKey, explodePlanFor, getCatalog, setCatalogSource, setMeshSource } from './core.js';
import { runAction } from './actions.js';
import { assetUrl } from '../utils/assetUrl.js';

const MAX_TRIES = 20; // an action that keeps asking for new models stops after this many
const PLANS_KEPT = 8;

const meshes = new Map(); // partId -> ArrayBuffer, kept for the visit
let catalog = null;
let catalogLoading = null;
const plans = new Map(); // explodeKey -> plan, the oldest dropped past PLANS_KEPT

setCatalogSource(() => catalog);
setMeshSource((part) => meshes.get(part.id) || null);

function loadCatalog() {
  catalogLoading ||= fetch(assetUrl('catalog.json'))
    .then((res) => {
      if (!res.ok) throw new Error(`Couldn't load the part catalog (${res.status})`);
      return res.json();
    })
    .then((data) => {
      catalog = data;
    })
    .catch((err) => {
      catalogLoading = null;
      throw err;
    });
  return catalogLoading;
}

const loadingMeshes = new Map(); // partId -> Promise, so a model is fetched once
function loadMesh(part) {
  if (meshes.has(part.id)) return Promise.resolve();
  if (!loadingMeshes.has(part.id)) {
    const promise = fetch(assetUrl(part.modelUrl))
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        meshes.set(part.id, buf);
      })
      .catch((err) => {
        throw new Error(`Couldn't load the model for ${part.name} (${err.message})`);
      })
      .finally(() => loadingMeshes.delete(part.id));
    loadingMeshes.set(part.id, promise);
  }
  return loadingMeshes.get(part.id);
}

/** Runs `work` once the models of the state's parts are in, fetching any others it asks for. */
async function withMeshes(state, work) {
  const { catalogById } = getCatalog();
  const parts = [...new Set((state.instances || []).map((i) => i.partId))].map((id) => catalogById.get(id)).filter(Boolean);
  await Promise.all(parts.map(loadMesh));
  for (let tries = 1; ; tries += 1) {
    try {
      return work();
    } catch (err) {
      if (!(err instanceof MissingMeshError) || tries >= MAX_TRIES) throw err;
      await loadMesh(catalogById.get(err.partId));
    }
  }
}

function explodePlan(state, mode, onProgress) {
  const key = explodeKey(state.instances, mode);
  if (plans.has(key)) return plans.get(key);
  let last = 0;
  const progress = (f) => {
    if (f < last + 0.02) return;
    last = f;
    onProgress(f);
  };
  const plan = explodePlanFor(state, mode, { progress });
  plans.set(key, plan);
  if (plans.size > PLANS_KEPT) plans.delete(plans.keys().next().value);
  return plan;
}

self.onmessage = async ({ data }) => {
  const { id, kind } = data;
  try {
    await loadCatalog();
    let result;
    if (kind === 'action') {
      result = await withMeshes(data.state, () => runAction(data.action, structuredClone(data.state), data.params || {}));
    } else if (kind === 'explode') {
      const state = { instances: data.state.instances };
      result = await withMeshes(state, () => explodePlan(state, data.mode, (progress) => self.postMessage({ id, progress })));
    } else {
      throw new Error(`Unknown message: ${kind}`);
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err?.message || String(err) });
  }
};
