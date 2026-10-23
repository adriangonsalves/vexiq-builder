import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {
  auditAssembly,
  buildMeshedGearTrain,
  checkCandidateCollision,
  computeMateTransform,
  findMatchingPinHoles,
  findPart,
  generateOrthographicViews,
  getCatalog,
  mirrorSubassembly
} from './mcp/assembly-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'public', 'assembly-state.json');

/**
 * Vite plugin providing a live two-way HTTP + Server-Sent Events (SSE) bridge
 * between the VEX IQ MCP Server (mcp/vexiq-mcp-server.mjs) and the 3D browser UI,
 * plus /api/assembly/action for manual UI invocation of declarative CAD tools.
 */
function vexiqMcpBridgePlugin() {
  const sseClients = new Set();

  function broadcastState(payload, source = 'ui-action') {
    fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
    const msg = `data: ${JSON.stringify({ source, state: payload })}\n\n`;
    for (const client of sseClients) {
      client.write(msg);
    }
  }

  return {
    name: 'vexiq-mcp-bridge',
    configureServer(server) {
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
                broadcastState(nextState, 'mcp-server');
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
              broadcastState(nextState, 'mcp-server');

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
              broadcastState(nextState, 'mcp-server');

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
                broadcastState(nextState, 'mcp-server');
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

      server.middlewares.use('/api/assembly', (req, res, next) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          if (fs.existsSync(STATE_FILE)) {
            res.end(fs.readFileSync(STATE_FILE, 'utf8'));
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
              const payload = {
                ...parsed,
                updatedAt: new Date().toISOString()
              };
              const source = req.headers['x-mcp-source'] || 'unknown';
              broadcastState(payload, source);

              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ ok: true }));
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
