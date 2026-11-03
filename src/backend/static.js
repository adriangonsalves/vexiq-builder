/**
 * The app's backend on the static site (openspec static-lite-site): no server. Smart actions and
 * explode plans run in engine workers (src/engine/worker.js), builds live in the browser's build
 * library (IndexedDB), and settings in localStorage (kept by the app itself).
 */
import { actionStepLabel, recordStep, summarize } from '../utils/buildHistory.js';
import { getBuild, libraryAvailable, listBuilds } from '../utils/buildLibrary.js';

export const hasAssistant = false;

/** Offline use and installing the app (openspec offline-app) need the static site's file list. */
export const hasOffline = true;

/**
 * One engine worker, started on first use. `ask(message, onProgress)` resolves to the worker's
 * result or rejects with its error.
 */
function engineWorker() {
  let worker = null;
  let nextId = 0;
  const pending = new Map(); // id -> { resolve, reject, onProgress }
  return (message, onProgress) => {
    if (!worker) {
      worker = new Worker(new URL('../engine/worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.id);
        if (!job) return;
        if ('progress' in data) return job.onProgress?.(data.progress);
        pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error));
        else job.resolve(data.result);
      };
      worker.onerror = (event) => {
        for (const job of pending.values()) job.reject(new Error(event.message || 'the engine stopped'));
        pending.clear();
        worker = null;
      };
    }
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, ...message });
    });
  };
}

// Actions and explode plans in workers of their own, so a long plan doesn't hold up a quick fasten
const actionWorker = engineWorker();
const explodeWorker = engineWorker();

/** The build that was open: the library's most recently saved one (every switch saves), or null. */
export async function loadState() {
  if (!libraryAvailable()) return null;
  try {
    const [latest] = await listBuilds();
    const saved = latest && (await getBuild(latest.id));
    if (!saved) return null;
    return { ...saved, build: { id: saved.id, name: saved.name } };
  } catch {
    return null;
  }
}

/** The build library saves the build; there is nothing else to save to. */
export async function saveState() {
  return null;
}

/**
 * A smart action's reply. A change is recorded as one history step on top of `history`, as the dev
 * bridge records it on the saved build, so the reply's state carries the new history.
 */
export async function runAction(action, state, params = {}, { history, linear = true } = {}) {
  const reply = await actionWorker({ kind: 'action', action, state, params });
  const { record, stepLabel, unknownAction, ...rest } = reply;
  if (record && history && rest.state) {
    const recorded = recordStep(history, state.instances, rest.state.instances, {
      source: 'action',
      label: (stepOps) => actionStepLabel(action, stepLabel, summarize(stepOps)),
      linear
    });
    Object.assign(rest.state, { history: recorded.history, historyRev: recorded.history.rev });
  }
  return rest;
}

export function explodePlan(instances, mode, onProgress) {
  return explodeWorker({ kind: 'explode', state: { instances }, mode }, onProgress);
}

/** Settings stay in this browser (the app keeps its own copy in localStorage). */
export async function loadSettings() {
  return null;
}

export function saveSettings() {}

/** No assistant or other writers to listen to. */
export function subscribe() {
  return () => {};
}

export function sendScreenshot() {}
