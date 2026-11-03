import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { explodeKey, writeBlueprint } from './mcp/assembly-engine.mjs';
import { runAction } from './src/engine/actions.js';
import { actionStepLabel, applyOps, diffParts, loadHistory, mergeBrowserSave, recordStep, summarize } from './src/utils/buildHistory.js';
import { syncSelection } from './src/utils/partGroups.js';
import { MCP_OFF_MESSAGE, isLinearHistory, normalizeSettings } from './src/utils/appSettings.js';
import { SERVICE_WORKER_FILE, writeOfflineManifest } from './scripts/offline-manifest.mjs';

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
                label: (stepOps) => actionStepLabel(action, stepLabel, summarize(stepOps)),
                linear: isLinearHistory(readSettingsFile())
              });
              return Object.assign(nextState, { instances, history, historyRev: history.rev });
            };

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

            // Every other action is the engine's (src/engine/actions.js); a change is recorded here
            const { record, stepLabel, unknownAction, ...reply } = runAction(action, state, params);
            if (record) broadcastState(recordAction(reply.state, stepLabel), 'mcp-server');
            // The blueprint picture goes to public/ too, for MCP clients and the blueprint link
            if (reply.ortho) reply.ortho = writeBlueprint(reply.ortho, { keepSvg: true });
            if (unknownAction) res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(reply));
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

// The static site (openspec static-lite-site) takes only these from public/: no saved build,
// settings or blueprint
const STATIC_PUBLIC_FILES = ['catalog.json', 'part-metadata.json', 'models'];

/** Copies STATIC_PUBLIC_FILES into the static build (in place of all of public/). */
function copyStaticPublicFilesPlugin() {
  let outDir;
  return {
    name: 'vexiq-static-public-files',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    writeBundle() {
      for (const file of STATIC_PUBLIC_FILES) {
        fs.cpSync(path.join(__dirname, 'public', file), path.join(outDir, file), { recursive: true });
      }
    }
  };
}

// Offline use and installing (openspec offline-app): icons, the web app manifest and the service
// worker at the site root, and the file list with sizes and hashes that the app downloads from
const OFFLINE_DIR = path.join(__dirname, 'src', 'offline');
const APP_ICONS = [
  { src: 'icon-192.png', sizes: '192x192' },
  { src: 'icon-512.png', sizes: '512x512' },
  { src: 'icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' }
];
const APP_COLOR = '#111827'; // --bg-panel

/** Adds the files that make the static site installable and usable offline. */
function offlineAppPlugin() {
  let outDir;
  let base = '/';
  return {
    name: 'vexiq-offline-app',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      base = config.base;
    },
    transformIndexHtml() {
      return [
        { tag: 'link', attrs: { rel: 'manifest', href: `${base}manifest.webmanifest` }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'theme-color', content: APP_COLOR }, injectTo: 'head' },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base}icons/apple-touch-icon.png` }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: 'VEX IQ' }, injectTo: 'head' }
      ];
    },
    // After every other plugin has written its files, so the list has the copied models too
    closeBundle() {
      fs.mkdirSync(path.join(outDir, 'icons'), { recursive: true });
      for (const file of [...APP_ICONS.map((i) => i.src), 'apple-touch-icon.png']) {
        fs.copyFileSync(path.join(OFFLINE_DIR, 'icons', file), path.join(outDir, 'icons', file));
      }
      const webManifest = {
        name: 'VEX IQ Builder',
        short_name: 'VEX IQ',
        description: 'Build VEX IQ robots from the official parts.',
        start_url: base,
        scope: base,
        id: base,
        display: 'standalone',
        background_color: APP_COLOR,
        theme_color: APP_COLOR,
        icons: APP_ICONS.map(({ src, ...rest }) => ({ src: `icons/${src}`, type: 'image/png', ...rest }))
      };
      fs.writeFileSync(path.join(outDir, 'manifest.webmanifest'), JSON.stringify(webManifest, null, 2));
      fs.copyFileSync(path.join(OFFLINE_DIR, 'sw.js'), path.join(outDir, SERVICE_WORKER_FILE));
      const { files, total } = writeOfflineManifest(outDir);
      this.info?.(`offline-manifest.json: ${files.length} files, ${(total / 1e6).toFixed(1)} MB`);
    }
  };
}

export default defineConfig(({ mode }) =>
  mode === 'static'
    ? {
        // `npm run build:static`: plain files for any static host, at the base path VEXIQ_BASE
        plugins: [react(), copyStaticPublicFilesPlugin(), offlineAppPlugin()],
        base: process.env.VEXIQ_BASE || '/',
        define: { 'import.meta.env.VITE_STATIC': JSON.stringify('true') },
        worker: { format: 'es' },
        build: { outDir: 'dist-static', emptyOutDir: true, copyPublicDir: false }
      }
    : {
        plugins: [react(), vexiqMcpBridgePlugin()],
        server: {
          port: 5173,
          host: true
        }
      }
);
