/**
 * Node check for src/engine/ (openspec static-lite-site): the engine core runs with no Node APIs,
 * given only an in-memory catalog and meshes, as the browser's engine worker runs it, and gives the
 * same replies as the Node engine (mcp/assembly-engine.mjs, which reads public/) for every action.
 * Run: node scripts/check-engine-core.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// In a worker thread: a module graph of its own with only src/engine/ loaded, so the Node engine's
// fs sources are never set there. The catalog and the meshes arrive in workerData.
if (!isMainThread) {
  const { setCatalogSource, setMeshSource, MissingMeshError } = await import('../src/engine/core.js');
  const { runAction } = await import('../src/engine/actions.js');
  const { catalog, meshes, withheld } = workerData;
  setCatalogSource(() => catalog);
  setMeshSource((part) => (part.id === withheld ? null : meshes[part.id] || null));
  parentPort.on('message', ({ id, action, state, params }) => {
    try {
      parentPort.postMessage({ id, reply: runAction(action, state, params) });
    } catch (err) {
      parentPort.postMessage({ id, error: err.message, missing: err instanceof MissingMeshError ? err.partId : undefined });
    }
  });
} else {
  let failures = 0;
  const check = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
    if (!ok) failures += 1;
  };

  // 1. Nothing src/engine/ imports, however deep, is a Node module
  const nodeImports = [];
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const [, spec] of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/gm)) {
      if (spec.startsWith('.')) walk(path.resolve(path.dirname(file), spec));
      else if (spec.startsWith('node:') || ['fs', 'path', 'url', 'worker_threads', 'async_hooks'].includes(spec)) {
        nodeImports.push(`${path.relative(ROOT, file)}: ${spec}`);
      }
    }
    if (/\bprocess\.(env|cwd)|\bBuffer\./.test(src)) nodeImports.push(`${path.relative(ROOT, file)}: uses process or Buffer`);
  };
  walk(path.join(ROOT, 'src/engine/actions.js'));
  check(`src/engine/ uses no Node APIs (${seen.size} modules)`, nodeImports.length === 0, nodeImports.join(', '));

  // 2. The same replies from the core with in-memory sources as from the Node engine
  const node = await import('../mcp/assembly-engine.mjs');
  const { runAction } = await import('../src/engine/actions.js');
  const { catalog } = node.getCatalog();
  const byName = (name) => catalog.find((p) => p.name === name);
  const meshes = {};
  for (const p of catalog) meshes[p.id] = new Uint8Array(fs.readFileSync(path.join(ROOT, 'public', p.modelUrl.replace(/^\//, ''))));

  const drivetrain = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'drivetrain.json'), 'utf8'));
  const sprocket = (instanceId, x) => ({ instanceId, partId: byName('24 Tooth Sprocket').id, label: instanceId, position: [x, 0, 0], rotation: [0, 0, 0], visible: true });
  const sprockets = { instances: [sprocket('s1', 0), sprocket('s2', 120)] };
  const cases = [
    ['joint_graph', drivetrain, {}],
    ['joint_graph', drivetrain, { pinnedOnly: true }],
    ['audit_and_blueprint', drivetrain, {}],
    ['mirror_subassembly', drivetrain, { instanceIds: ['Left Inner Rail', 'Left Outer Rail', 'Left Front Gear'], mirrorPlane: 'Z', planeOffsetMm: 0 }],
    ['auto_fasten', drivetrain, { instanceIdA: 'Top Plate', instanceIdB: 'ALL' }],
    ['mate_parts', drivetrain, { sourceInstanceId: 'Left Standoff 1', sourcePortId: 'peg_1', targetInstanceId: 'Left Inner Rail', targetPortId: 'hole_3' }],
    ['mesh_gear_train', drivetrain, { supportBeamId: 'Left Outer Rail', startPortId: 'hole_2', gears: ['228-2500-213', '228-2500-213'] }],
    ['build_chain', sprockets, { kind: 'chain', instanceIds: ['s1', 's2'] }],
    ['build_chain', sprockets, { kind: 'track', instanceIds: ['s1', 's2'], attachment: 'short-flap' }],
    ['no_such_action', drivetrain, {}]
  ];

  // Ids made from the time and a random number, and times, differ run to run
  const norm = (reply) =>
    JSON.stringify(reply, (k, v) =>
      k === 'updatedAt' ? undefined : typeof v === 'string' ? v.replace(/(inst|group)-[a-z0-9]+-[a-z0-9-]+/g, 'ID') : v
    );

  const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { catalog, meshes } });
  let nextId = 0;
  const pending = new Map();
  worker.on('message', (msg) => {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  });
  const inWorker = (w, action, state, params) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      w.postMessage({ id, action, state, params });
    });

  for (const [action, state, params] of cases) {
    const label = `${action}${Object.keys(params).length ? ` ${JSON.stringify(params).slice(0, 60)}` : ''}`;
    const expected = runAction(action, structuredClone(state), params);
    const got = await inWorker(worker, action, structuredClone(state), params);
    if (got.error) {
      check(`same reply in memory: ${label}`, false, got.error);
      continue;
    }
    check(`same reply in memory: ${label}`, norm(got.reply) === norm(expected), `${expected.message || expected.error || ''}`);
  }
  await worker.terminate();

  // 3. A part whose mesh isn't loaded stops the action with that part's id, and nothing else
  const withheld = byName('36 Tooth Gear').id;
  const partial = new Worker(fileURLToPath(import.meta.url), { workerData: { catalog, meshes, withheld } });
  partial.on('message', (msg) => {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  });
  const missing = await inWorker(partial, 'audit_and_blueprint', drivetrain, {});
  check('a missing mesh throws MissingMeshError naming the part', missing.missing === withheld, JSON.stringify(missing).slice(0, 120));
  await partial.terminate();

  // The audit's blueprint picture comes back as text, with no file written by the core
  const ortho = runAction('audit_and_blueprint', drivetrain, {}).ortho;
  check('the blueprint comes back as SVG text', typeof ortho.svg === 'string' && ortho.svg.startsWith('<svg') && !ortho.blueprintFilePath);

  console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
}
