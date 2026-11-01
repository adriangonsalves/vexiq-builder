/**
 * Works out explode plans (openspec explode-view) off the dev server's main thread, so the bridge
 * keeps answering while a plan is built. Keeps the engine's meshes loaded between plans.
 * Messages in: { id, state, mode }; out: { id, progress } (0..1, every 2% or so), then { id, plan }
 * or { id, error }.
 */
import { parentPort } from 'node:worker_threads';
import { explodePlanFor } from './assembly-engine.mjs';

parentPort.on('message', ({ id, state, mode }) => {
  let last = 0;
  const progress = (f) => {
    if (f < last + 0.02) return;
    last = f;
    parentPort.postMessage({ id, progress: f });
  };
  try {
    parentPort.postMessage({ id, plan: explodePlanFor(state, mode, { progress }) });
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message || String(err) });
  }
});
