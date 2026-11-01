import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  auditAssembly,
  buildChain,
  buildMeshedGearTrain,
  checkCandidateCollision,
  computeMateTransform,
  findMatchingPinHoles,
  findPart,
  generateOrthographicViews,
  getCatalog,
  jointGraph,
  mirrorSubassembly
} from './mcp/assembly-engine.mjs';
import { applyOps, diffParts, loadHistory, mergeBrowserSave, recordStep, summarize } from './src/utils/buildHistory.js';
import { syncSelection } from './src/utils/partGroups.js';
import { MCP_OFF_MESSAGE, isLinearHistory, normalizeSettings } from './src/utils/appSettings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Explode plans already worked out (openspec explode-view), by build and direction choice
const explodePlans = new Map();
const EXPLODE_PLANS_KEPT = 8;
let explodeWorker = null;
let explodeJobId = 0;
const explodeJobs = new Map(); // job id -> { resolve, reject, mode }
let onExplodeProgress = null; // (mode, fraction) -> tell the browser tabs how far a plan has got
const pendingPlans = new Map(); // key -> Promise<plan>, so the same plan is worked out once
/** The plan for a build and direction, from the explode worker (started on first use, kept running). */
function explodePlanFromWorker(state, mode) {
  const key = explodeKey(state.instances, mode);
  if (explodePlans.has(key)) return Promise.resolve(explodePlans.get(key));
  if (pendingPlans.has(key)) return pendingPlans.get(key);
  if (!explodeWorker) {
    explodeWorker = new Worker(new URL('./mcp/explode-worker.mjs', import.meta.url), { env: process.env });
    explodeWorker.on('message', ({ id, plan, error, progress }) => {
      const job = explodeJobs.get(id);
      if (progress !== undefined) {
        if (job) onExplodeProgress?.(job.mode, progress);
        return;
      }
      explodeJobs.delete(id);
      if (job) (error ? job.reject(new Error(error)) : job.resolve(plan));
    });
    explodeWorker.on('error', (err) => {
      for (const job of explodeJobs.values()) job.reject(err);
      explodeJobs.clear();
      explodeWorker = null;
    });
  }
  const id = ++explodeJobId;
  const promise = new Promise((resolve, reject) => explodeJobs.set(id, { resolve, reject, mode }))
    .then((plan) => {
      explodePlans.set(key, plan);
      if (explodePlans.size > EXPLODE_PLANS_KEPT) explodePlans.delete(explodePlans.keys().next().value);
      if (plan.unplaced.length) console.warn(`[explode] ${plan.unplaced.length} overlap(s) left in the ${mode} plan`, plan.unplaced);
      return plan;
    })
    .finally(() => pendingPlans.delete(key));
  pendingPlans.set(key, promise);
  explodeWorker.postMessage({ id, state: { instances: state.instances }, mode });
  return promise;
}
const explodeKey = (instances, mode) =>
  `${mode}|${JSON.stringify(
    (instances || [])
      .filter((i) => i.visible !== false)
      .map((i) => [i.instanceId, i.partId, i.position, i.rotation, i.groupId || null, i.socketAngleDeg || 0])
  )}`;
// VEXIQ_STATE_PATH (as for the MCP engine) lets a test server use its own build file
const STATE_FILE = process.env.VEXIQ_STATE_PATH || path.join(__dirname, 'public', 'assembly-state.json');
// App settings shared with the MCP server (openspec app-settings); VEXIQ_SETTINGS_PATH as for the engine
const SETTINGS_FILE = process.env.VEXIQ_SETTINGS_PATH || path.join(__dirname, 'public', 'app-settings.json');

function readSettingsFile() {
  try {
    return normalizeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return normalizeSettings(null);
  }
}

/**
 * Vite plugin providing a live two-way HTTP + Server-Sent Events (SSE) bridge
 * between the VEX IQ MCP Server (mcp/vexiq-mcp-server.mjs) and the 3D browser UI,
 * plus /api/assembly/action for manual UI invocation of declarative CAD tools.
 */
function vexiqMcpBridgePlugin() {
  const sseClients = new Set();

  // The saved state with its history (a file without one gets a "Starting assembly" step), or null
  function readSaved() {
    try {
      if (!fs.existsSync(STATE_FILE)) return null;
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (!data || !Array.isArray(data.instances)) return null;
      const history = loadHistory(data.history, data.instances);
      return { ...data, history, historyRev: history.rev };
    } catch {
      return null;
    }
  }

  // How far the explode plan being worked out has got, for the Explode panel's ring
  onExplodeProgress = (mode, fraction) => {
    const msg = `data: ${JSON.stringify({ type: 'explode-progress', mode, fraction })}\n\n`;
    for (const client of sseClients) client.write(msg);
  };

  // Settings changed in one tab reach the others as a `settings` event
  function broadcastSettings(settings, clientId = undefined) {
    const msg = `data: ${JSON.stringify({ type: 'settings', clientId, settings })}\n\n`;
    for (const client of sseClients) client.write(msg);
  }

  // clientId: the browser tab that sent the change, so only that tab skips its own echo
  function broadcastState(payload, source = 'ui-action', clientId = undefined) {
    payload = syncSelection(payload);
    fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
    const msg = `data: ${JSON.stringify({ source, clientId, state: payload })}\n\n`;
    for (const client of sseClients) {
      client.write(msg);
    }
  }

  return {
    name: 'vexiq-mcp-bridge',
    configureServer(server) {
      // When the server restarts (vite.config.js changed) or stops: stop the explode worker, and end
      // the open event streams so the tabs reconnect to the new server instead of hanging on this one
      server.httpServer?.once('close', () => {
        explodeWorker?.terminate();
        explodeWorker = null;
        for (const job of explodeJobs.values()) job.reject(new Error('the server restarted'));
        explodeJobs.clear();
        pendingPlans.clear();
        for (const client of sseClients) client.end();
        sseClients.clear();
      });
      // Load the explode worker's meshes and work out the saved build's plan in the background, so
      // opening Explode the first time doesn't wait for it
      setTimeout(() => {
        try {
          const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
          if (saved?.instances?.length) explodePlanFromWorker(saved, 'all').catch(() => {});
        } catch {
          // no saved build yet
        }
      }, 1500);
      server.middlewares.use('/api/assembly/events', (req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        res.write(':\n\n');
        sseClients.add(res);

        req.on('close', () => {
          sseClients.delete(res);
        });
      });

      server.middlewares.use('/api/settings', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'GET') {
          res.end(JSON.stringify(readSettingsFile()));
          return;
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
          return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const settings = normalizeSettings({ ...readSettingsFile(), ...JSON.parse(body || '{}') });
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
            broadcastSettings(settings, req.headers['x-client-id']);
            res.end(JSON.stringify({ ok: true, settings }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      });

      server.middlewares.use('/api/assembly/action', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const { action, state: clientState, params = {} } = JSON.parse(body || '{}');
            const state =
              clientState && Array.isArray(clientState.instances)
                ? clientState
                : fs.existsSync(STATE_FILE)
                  ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
                  : { instances: [] };

            const { catalogById } = getCatalog();

            // A smart action's change is one history step (source 'action'), applied on top of the
            // saved build. Fills in nextState's parts and history so the reply carries them too.
            const baseInstances = state.instances;
            const recordAction = (nextState, stepLabel = null) => {
              const saved = readSaved();
              if (!saved) return nextState;
              const ops = diffParts(baseInstances, nextState.instances);
              const instances =
                diffParts(baseInstances, saved.instances).length > 0 ? applyOps(saved.instances, ops) : nextState.instances;
              const { history } = recordStep(saved.history, saved.instances, instances, {
                source: 'action',
                label: (stepOps) => stepLabel || `${action}: ${summarize(stepOps)}`,
                linear: isLinearHistory(readSettingsFile())
              });
              return Object.assign(nextState, { instances, history, historyRev: history.rev });
            };

            if (action === 'auto_fasten') {
              const instA = state.instances.find((i) => i.instanceId === params.instanceIdA);
              if (!instA) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, error: 'Selected part not found.' }));
                return;
              }

              // Support fastening against one specific part or ALL compatible touching parts
              const targetCandidates = params.instanceIdB && params.instanceIdB !== 'ALL'
                ? state.instances.filter((i) => i.instanceId === params.instanceIdB)
                : state.instances.filter((i) => {
                    if (i.instanceId === instA.instanceId || i.visible === false) return false;
                    const p = catalogById.get(i.partId);
                    return p && p.category !== 'Pins & Standoffs';
                  });

              const maxPins = Math.max(1, Number(params.maxPins) || 12);
              const placedPins = [];
              const nextInstances = [...state.instances];

              for (const instB of targetCandidates) {
                if (placedPins.length >= maxPins) break;
                const matches = findMatchingPinHoles(instA, instB);

                for (const m of matches) {
                  if (placedPins.length >= maxPins) break;
                  const pinPart =
                    findPart(params.pinPartNumber || m.recommendedPinPartNumber) ||
                    findPart('228-2500-060');
                  if (!pinPart) continue;

                  const baseRot = m.worldRotation;
                  const flippedRot = [baseRot[0], (baseRot[1] + 180) % 360, baseRot[2]];
                  let chosenCandidate = null;

                  for (const rotCandidate of [baseRot, flippedRot]) {
                    const candidate = {
                      instanceId: `inst-pin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      partId: pinPart.id,
                      label: `Auto ${pinPart.name} (${instA.label} ↔ ${instB.label})`,
                      position: m.worldPosition,
                      rotation: rotCandidate,
                      lastValidPosition: m.worldPosition,
                      lastValidRotation: rotCandidate,
                      isIntersecting: false,
                      color: params.color || '#0284c7',
                      visible: true,
                      locked: false
                    };
                    const col = checkCandidateCollision(candidate, nextInstances);
                    if (!col.isIntersecting) {
                      chosenCandidate = candidate;
                      break;
                    }
                  }

                  if (chosenCandidate) {
                    nextInstances.push(chosenCandidate);
                    placedPins.push(chosenCandidate);
                  }
                }
              }

              const nextState = {
                ...state,
                selectedId:
                  placedPins.length > 0
                    ? placedPins[placedPins.length - 1].instanceId
                    : state.selectedId,
                instances: nextInstances,
                updatedAt: new Date().toISOString()
              };

              if (placedPins.length > 0) {
                broadcastState(recordAction(nextState), 'mcp-server');
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: true,
                  pinsPlacedCount: placedPins.length,
                  placedPins,
                  state: nextState,
                  message:
                    placedPins.length > 0
                      ? `Inserted ${placedPins.length} collision-verified connector pin(s).`
                      : 'No unoccupied coaxial pin hole pairs found (or holes are already pinned).'
                })
              );
              return;
            }

            if (action === 'mate_parts') {
              const targetInst = state.instances.find(
                (i) => i.instanceId === params.targetInstanceId
              );
              const existingInst = state.instances.find(
                (i) => i.instanceId === params.sourceInstanceId
              );
              if (!targetInst || !existingInst) {
                res.setHeader('Content-Type', 'application/json');
                res.end(
                  JSON.stringify({ ok: false, error: 'Source or target part instance not found.' })
                );
                return;
              }

              const sourcePart = catalogById.get(existingInst.partId);
              const mate = computeMateTransform(
                sourcePart,
                params.sourcePortId,
                targetInst,
                params.targetPortId,
                {
                  flipAxis: Boolean(params.flipAxis),
                  rollDeg: Number(params.rollDeg) || 0,
                  axialOffsetMm: Number(params.axialOffsetMm) || 0
                }
              );

              if (mate.error) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, error: mate.error }));
                return;
              }

              const updated = {
                ...existingInst,
                position: mate.position,
                rotation: mate.rotation
              };
              const col = checkCandidateCollision(updated, state.instances);
              updated.isIntersecting = col.isIntersecting;
              if (!col.isIntersecting) {
                updated.lastValidPosition = [...mate.position];
                updated.lastValidRotation = [...mate.rotation];
              }

              const nextInstances = state.instances.map((i) =>
                i.instanceId === updated.instanceId ? updated : i
              );
              const nextState = {
                ...state,
                selectedId: updated.instanceId,
                instances: nextInstances,
                updatedAt: new Date().toISOString()
              };
              broadcastState(recordAction(nextState), 'mcp-server');

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: true,
                  isIntersecting: col.isIntersecting,
                  collidingWith: col.collidingWith,
                  instance: updated,
                  state: nextState,
                  message: col.isIntersecting
                    ? `Mated ${updated.label} to ${targetInst.label} (warning: intersects ${col.collidingWith.map((c) => c.label).join(', ')}; try flipping axis or adjusting offset).`
                    : `Mated ${updated.label} (${mate.sourcePort.portId}) → ${targetInst.label} (${mate.targetPort.portId}) cleanly.`
                })
              );
              return;
            }

            if (action === 'mesh_gear_train') {
              const gearRes = buildMeshedGearTrain(state, {
                supportBeamId: params.supportBeamId,
                outerSupportBeamId: params.outerSupportBeamId || null,
                startPortId: params.startPortId,
                gears: params.gears || ['228-2500-214', '228-2500-214', '228-2500-214'],
                shaftPartQuery: params.shaftPartQuery || null,
                axialOffsetMm:
                  params.axialOffsetMm !== undefined && params.axialOffsetMm !== ''
                    ? Number(params.axialOffsetMm)
                    : null,
                reverseDirection: Boolean(params.reverseDirection)
              });

              if (gearRes.error) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, error: gearRes.error }));
                return;
              }

              const nextState = {
                ...state,
                selectedId:
                  gearRes.placedGears.length > 0
                    ? gearRes.placedGears[gearRes.placedGears.length - 1].instance.instanceId
                    : state.selectedId,
                instances: gearRes.workingInstances,
                updatedAt: new Date().toISOString()
              };
              broadcastState(recordAction(nextState), 'mcp-server');

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: true,
                  gearsPlacedCount: gearRes.placedGears.length,
                  shaftsPlacedCount: gearRes.placedShafts.length,
                  state: nextState,
                  message: `Placed ${gearRes.placedGears.length} meshed gears and ${gearRes.placedShafts.length} shafts.`
                })
              );
              return;
            }

            if (action === 'build_chain') {
              // Chain or track builder (openspec chain-track-builder): one step labeled with what was built
              const built = buildChain(state, {
                kind: params.kind,
                instanceIds: Array.isArray(params.instanceIds) ? params.instanceIds : null,
                grippers: params.grippers !== false,
                slack: params.slack === 'upper' ? 'upper' : 'lower',
                name: params.name || null
              });
              res.setHeader('Content-Type', 'application/json');
              if (built.error) {
                res.end(JSON.stringify({ ok: false, error: built.error }));
                return;
              }
              const nextState = {
                ...state,
                instances: built.instances,
                selectedIds: built.newIds,
                selectedId: built.newIds.at(-1),
                updatedAt: new Date().toISOString()
              };
              broadcastState(recordAction(nextState, built.message.split('. ')[0]), 'mcp-server');
              res.end(JSON.stringify({ ok: true, state: nextState, groupId: built.groupId, name: built.name, message: built.message }));
              return;
            }

            if (action === 'mirror_subassembly') {
              const mirRes = mirrorSubassembly(state, {
                instanceIds: Array.isArray(params.instanceIds) ? params.instanceIds : [],
                mirrorPlane: params.mirrorPlane || 'Z',
                planeOffsetMm: Number(params.planeOffsetMm) || 0
              });

              const nextState = {
                ...state,
                selectedId:
                  mirRes.mirroredInstances.length > 0
                    ? mirRes.mirroredInstances[mirRes.mirroredInstances.length - 1].instanceId
                    : state.selectedId,
                instances: mirRes.workingInstances,
                updatedAt: new Date().toISOString()
              };
              if (mirRes.mirroredCount > 0) {
                broadcastState(recordAction(nextState), 'mcp-server');
              }

              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: true,
                  mirroredCount: mirRes.mirroredCount,
                  state: nextState,
                  message: `Mirrored ${mirRes.mirroredCount} part(s) across ${params.mirrorPlane || 'Z'} = ${Number(params.planeOffsetMm) || 0}mm.`
                })
              );
              return;
            }

            // The joints between parts, for Select Connected and expanding the selection (openspec outliner-part-groups)
            if (action === 'joint_graph') {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true, graph: jointGraph(state, { pinnedOnly: Boolean(params.pinnedOnly) }) }));
              return;
            }

            // How the build comes apart for the Explode slider, worked out with the engine's
            // collision meshes (openspec explode-view)
            if (action === 'explode_plan') {
              const mode = ['x', 'y', 'z', 'all'].includes(params.mode) ? params.mode : 'all';
              explodePlanFromWorker(state, mode).then(
                (plan) => {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ ok: true, plan }));
                },
                (err) => {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ ok: false, error: err.message }));
                }
              );
              return;
            }

            if (action === 'audit_and_blueprint') {
              const audit = auditAssembly(state);
              const ortho = generateOrthographicViews(state);
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  ok: true,
                  audit,
                  ortho
                })
              );
              return;
            }

            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: `Unknown action: ${action}` }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: err.message }));
          }
        });
      });

      // Screenshot round trip: the MCP server asks for a picture, the most recently connected browser
      // renders it and posts it back. Registered before '/api/assembly', which would match these too.
      const pendingShots = new Map(); // requestId -> { res, timer }
      const readJson = (req) =>
        new Promise((resolve) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              resolve(JSON.parse(body || '{}'));
            } catch {
              resolve({});
            }
          });
        });
      const sendJson = (res, status, payload) => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
      };

      // The visible parts of the saved build, to compare with what a tab drew
      const savedVisibleIds = () => new Set((readSaved()?.instances || []).filter((i) => i.visible !== false).map((i) => i.instanceId));
      const shotIsComplete = (status) => {
        if (!status || status.partsLoading > 0) return false;
        const saved = savedVisibleIds();
        return status.instanceIds.length === saved.size && status.instanceIds.every((id) => saved.has(id));
      };
      // Answers with the most complete picture the tabs sent, saying what is wrong with it if anything
      const finishShot = (requestId) => {
        const pending = pendingShots.get(requestId);
        if (!pending) return;
        pendingShots.delete(requestId);
        clearTimeout(pending.timer);
        const shots = pending.replies.filter((r) => r.png);
        if (!shots.length) {
          const error = pending.replies.find((r) => r.error)?.error;
          return sendJson(pending.res, pending.replies.length ? 500 : 504, {
            ok: false,
            error: error || 'The app did not send a screenshot within 10 seconds'
          });
        }
        const saved = savedVisibleIds();
        const missing = (s) => (s ? s.partsLoading + [...saved].filter((id) => !s.instanceIds.includes(id)).length : saved.size);
        const best = shots.reduce((a, b) => (missing(b.status) < missing(a.status) ? b : a));
        const s = best.status;
        let warning;
        if (s && !shotIsComplete(s)) {
          const stale = s.instanceIds.length !== saved.size || s.instanceIds.some((id) => !saved.has(id));
          warning = stale
            ? `The open tab shows a different build than the saved one (${s.instanceIds.length} parts drawn, ${saved.size} saved). Reload the app tab.`
            : `${s.partsLoading} part(s) were still loading in the browser and are missing from the picture. Try again in a moment, or reload the app tab if it keeps happening.`;
        }
        sendJson(pending.res, 200, { ok: true, png: best.png, ...(warning ? { warning } : {}), tabs: pending.asked });
      };

      server.middlewares.use('/api/assembly/screenshot-result', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        const { requestId, png, error, status } = await readJson(req);
        const pending = pendingShots.get(requestId);
        if (pending) {
          pending.replies.push({ png, error, status });
          // Every open tab is asked; a complete picture (nothing loading, the saved build) answers at once
          if (png && shotIsComplete(status)) finishShot(requestId);
          else if (pending.replies.length >= pending.asked) finishShot(requestId);
        }
        sendJson(res, 200, { ok: true });
      });

      server.middlewares.use('/api/assembly/screenshot', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' });
        const request = await readJson(req);
        const clients = [...sseClients];
        if (!clients.length) return sendJson(res, 409, { ok: false, error: 'No browser has the app open' });
        const requestId = `shot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timer = setTimeout(() => finishShot(requestId), 10000);
        pendingShots.set(requestId, { res, timer, asked: clients.length, replies: [] });
        for (const client of clients) client.write(`data: ${JSON.stringify({ type: 'screenshot-request', requestId, ...request })}\n\n`);
      });

      server.middlewares.use('/api/assembly', (req, res, next) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          const saved = readSaved();
          if (saved) {
            // Save the history if it had to be started or reconciled, so every writer shares one
            const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            if (raw.history?.rev !== saved.history.rev || !raw.history) {
              fs.writeFileSync(STATE_FILE, JSON.stringify(saved, null, 2));
            }
            res.end(JSON.stringify(saved));
          } else {
            res.end(JSON.stringify({ instances: [] }));
          }
          return;
        }

        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              const source = req.headers['x-mcp-source'] || 'unknown';
              // The assistant turned off in Settings: the open app takes nothing from it
              if (source !== 'browser' && readSettingsFile().mcpEnabled === false) {
                res.statusCode = 423;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ ok: false, error: MCP_OFF_MESSAGE }));
                return;
              }
              let payload = { ...parsed, updatedAt: new Date().toISOString() };
              if (source === 'browser') {
                // Keep the saved history when the browser sends only parts; refuse a save built on
                // an older history (an MCP step landed in between) so no step is overwritten
                const merged = mergeBrowserSave(readSaved(), payload);
                if (merged.conflict) {
                  res.statusCode = 409;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ ok: false, conflict: true, state: merged.state }));
                  return;
                }
                payload = merged.state;
              }
              broadcastState(payload, source, req.headers['x-client-id']);

              res.setHeader('Content-Type', 'application/json');
              // browserClients tells the MCP server whether anyone has the app open to see the change
              res.end(JSON.stringify({ ok: true, browserClients: sseClients.size }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ ok: false, error: err.message }));
            }
          });
          return;
        }

        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), vexiqMcpBridgePlugin()],
  server: {
    port: 5173,
    host: true
  }
});
