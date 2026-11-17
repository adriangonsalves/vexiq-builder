/**
 * Imports an official VEX CAD assembly (an instructions.online / Cadasio project) into the app
 * through the MCP server (openspec cad-import-readiness, cad-import).
 *
 *   node scripts/import-cad.mjs <project id | instructions.online link | saved project .json>
 *        [--clear] [--dry-run] [--save project.json] [--report report.json] [--lift <mm>]
 *
 * --clear empties the build first. --dry-run converts and prints the report without placing.
 * --save keeps the downloaded project data for later runs. --lift raises every part (default: the
 * lowest part rests on the floor, y = 0).
 *
 * Every library part is converted with public/cad-frames.json (src/engine/cadFrames.js), placed in
 * batches with place_parts (structural parts before pins), then grouped per top subassembly. A sheet
 * whose frame entry says `"bend": "pins"` is laid on the pins that hold it and bent through the rest
 * (openspec shaped-parts-and-sheet-bending), and placed bent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { cadPoseToApp, frameEntryFor } from '../src/engine/cadFrames.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BATCH = 80;
const DUPLICATE_MM = 0.5;
const DUPLICATE_DEG = 1;
const PART_NUMBER = /^(228-\d{4}(-\d{3,4})?)/;

// Rubber bands and belts (openspec rubber-bands): strung on the spots VEX's band touches
const BAND_NUMBERS = new Set(['228-2500-468', '228-2500-470', '228-2500-474', '228-2500-475', '228-2500-1225', '228-2500-221', '228-2500-222', '228-2500-223', '228-2500-224']);

// Ropes (openspec rope-and-spool): VEX draws one rope as several pieces (a straight library rope, a
// bent piece named for it, loose end tabs); they are joined and strung as one rope (importRopes)
const ROPE_NUMBERS = new Set(['228-2500-430', '228-2500-436', '228-2500-438', '228-2500-442', '228-2500-448']);
const isRopePiece = (w, tail) => ROPE_NUMBERS.has(basePartNumber(w.cadPartNumber)) || /rope/i.test(w.cadPartNumber) || /rope/i.test(tail);

// Kinds of CAD parts the library doesn't have, with the reason given in the report
const NOT_IN_LIBRARY = [
  { test: /^6P6C|cable/i, reason: 'cable plug' },
  { test: /wire/i, reason: 'cable' },
  { test: /^rubber band/i, reason: 'rubber band' },
  { test: /^228-9136/, reason: 'game piece' }
];

/** Project id from an id, an instructions.online link (…?id=<id>) or a Cadasio link. */
export function projectIdFrom(arg) {
  const m = String(arg).match(/[?&]id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : String(arg).trim();
}

/** The project's viewer data with its instruction steps, from a saved file or downloaded from Cadasio. */
export async function loadProject(arg) {
  if (fs.existsSync(arg)) return JSON.parse(fs.readFileSync(arg, 'utf8'));
  const id = projectIdFrom(arg);
  const url = `https://api.cadasio.com/api/getProjectViewer?id=${encodeURIComponent(id)}&withSteps=true&hostname=instructions.online`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download project "${id}" (${res.status})`);
  return res.json();
}

const matrixOf = (s) => {
  const v = String(s).split(',').map(Number);
  return [v.slice(0, 4), v.slice(4, 8), v.slice(8, 12), v.slice(12, 16)];
};
const mul4 = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, x, k) => s + x * B[k][j], 0)));
const IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];

/**
 * Each part's state in the finished build: the instruction steps run in order up to the step named
 * "Completed View" (or every step when there is none; the steps after it are exploded and showcase
 * views). Map(node id -> { visible?, position?: {x, y, z}, rotation?: {x, y, z, w} }), position and
 * rotation in the node's parent frame, CAD units. Empty when the project has no steps.
 */
export function finalStepState(project) {
  const order = project.orderedSteps || [];
  const done = order.map((id) => project.steps?.[id]?.name).findLastIndex((n) => /^completed view$/i.test(String(n || '').trim()));
  const out = new Map();
  for (const id of done >= 0 ? order.slice(0, done + 1) : order) {
    for (const [node, props] of Object.entries(project.steps?.[id]?.properties || {})) out.set(node, { ...(out.get(node) || {}), ...props });
  }
  return out;
}

/** A node's own transform (row-vector form) with the final step's position and turn, when it has them. */
function localMatrix(r, state) {
  const m = matrixOf(r.transform);
  if (state?.rotation) {
    // Row-vector form: row i is where the turn takes axis i (column i of the quaternion's matrix)
    const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(state.rotation.x, state.rotation.y, state.rotation.z, state.rotation.w)).elements;
    for (let i = 0; i < 3; i++) m[i] = [R[4 * i], R[4 * i + 1], R[4 * i + 2], 0];
  }
  if (state?.position) m[3] = [state.position.x, state.position.y, state.position.z, 1];
  return m;
}

/**
 * The project's parts as the instructions finish them: every node whose component is a VEX part
 * number (or a leaf), with its CAD part number, instance path, top subassembly, hidden flag (hidden
 * in the CAD, or in the finished build's view: `hiddenBySteps`) and world matrix (row-vector form).
 * Poses come from the CAD (`poses: 'cad'`, the default): the finished view nudges some parts a few
 * millimetres without the pins in them (Flop's slanted beams, its brain's pins), so it is a picture,
 * not a fit; `poses: 'steps'` uses it anyway. `isLibraryPart(partNumber)`: when given, a node with
 * children whose part number the library lacks (a kit's subassembly) is walked into.
 */
export function walkAssembly(project, { poses = 'cad', isLibraryPart = null } = {}) {
  const a = project.assemblyStructure;
  const versions = a.rootVersions || {};
  const final = finalStepState(project);
  const out = [];
  const walk = (node, parent, top, stepsHide) => {
    const r = node.rootReference;
    const state = final.get(r.id);
    const m = mul4(poses === 'steps' ? localMatrix(r, state) : matrixOf(r.transform), parent);
    const hiddenBySteps = stepsHide || state?.visible === false;
    const v = versions[r.childVersionId] || {};
    const comp = String(v.versionComponentName || '').split(' [')[0];
    const kids = node.children || [];
    // A kit's subassembly (Swish's "228-7980 VEX IQ Catapult Arm") carries a part number but is made of
    // library parts: walked into when the library doesn't have its number
    const kit = kids.length && isLibraryPart && !isLibraryPart(basePartNumber(comp));
    if ((PART_NUMBER.test(comp) && !comp.startsWith('228-9136-000-') && !kit) || !kids.length) {
      out.push({ cadPartNumber: comp, path: r.name, top: top || r.name, hidden: Boolean(r.hidden) || hiddenBySteps, hiddenBySteps, matrix: m });
      return;
    }
    for (const c of kids) walk(c, m, top || r.name, hiddenBySteps);
  };
  for (const c of a.children || []) walk(c, IDENTITY, null, false);
  return { parts: out, scaleFactor: a.scaleFactor || 1 };
}

/**
 * The VEX part number of a CAD component name: at its start ("228-2500-470 Bent 1^…" -> "228-2500-470")
 * or in brackets ("2x30 mm Square Silicone Band (228-2500-1225) Bent^…" -> "228-2500-1225").
 */
export function basePartNumber(comp) {
  const s = String(comp);
  return s.match(PART_NUMBER)?.[1] || s.match(/\((228-\d{4}-\d{3,4})\)/)?.[1] || s;
}

/** "IQ Hero Bot Drive Train-1" -> "Drive Train"; "228-7980 VEX IQ Catapult Arm-1" -> "Catapult Arm". */
export function subassemblyName(top) {
  return (
    String(top || 'Robot')
      .split('/')[0]
      .replace(/^IQ Hero Bot /, '')
      .replace(/^228-\d{4}(-\d{3,4})? (VEX IQ )?/, '')
      .replace(/-\d+$/, '') || 'Robot'
  );
}

const quatOf = (rot) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));

/**
 * Converts the walked parts to place_parts items. Returns { items, leftOut, duplicates, unchecked }.
 * `catalog`: the library; `frames`: cad-frames.json's frames; `projectId`: the project's id, for the
 * frames VEX changed in that robot's CAD; `looksTheSame(part, poseA, poseB)`:
 * whether two poses fill the same space (the engine's; default: the same turn within 1°).
 */
export function convertParts(walked, { catalog, frames, liftMm = null, looksTheSame = null, projectId = null }) {
  const byNumber = new Map(catalog.map((p) => [p.partNumber, p]));
  const byName = new Map(catalog.map((p) => [p.name, p]));
  const leftOut = [];
  const unchecked = new Set();
  const converted = [];
  const bandParts = [];
  const ropeParts = [];
  for (const w of walked.parts) {
    const tail = w.path.split('/').pop();
    if (w.hidden) {
      leftOut.push({ path: w.path, cadPartNumber: w.cadPartNumber, reason: w.hiddenBySteps ? 'hidden by the instructions' : 'hidden in the CAD' });
      continue;
    }
    // A band or belt VEX's CAD shows stretched: strung on its spots after the parts are placed
    // (openspec rubber-bands; importBands)
    const bandPn = basePartNumber(w.cadPartNumber);
    if (BAND_NUMBERS.has(bandPn) && byNumber.has(bandPn)) {
      bandParts.push({ w, lib: byNumber.get(bandPn), sub: subassemblyName(w.top) });
      continue;
    }
    // A rope piece: joined with the other pieces of its rope and strung after the parts are placed
    if (isRopePiece(w, tail)) {
      const ropePn = basePartNumber(w.cadPartNumber);
      ropeParts.push({ w, lib: ROPE_NUMBERS.has(ropePn) && w.cadPartNumber === ropePn ? byNumber.get(ropePn) || null : null, named: [...ROPE_NUMBERS].find((n) => w.cadPartNumber.startsWith(n)) || null, sub: subassemblyName(w.top) });
      continue;
    }
    const kind = NOT_IN_LIBRARY.find((k) => k.test.test(w.cadPartNumber) || k.test.test(tail));
    const entry = frameEntryFor(frames, w.cadPartNumber, projectId);
    const lib = byNumber.get(entry.library || w.cadPartNumber) || byName.get(entry.library);
    if (kind || !lib) {
      leftOut.push({ path: w.path, cadPartNumber: w.cadPartNumber, reason: kind ? kind.reason : 'not in the library' });
      continue;
    }
    // A part made of several bodies in CAD (plastic sheets): one body stands for the part
    if (entry.onlyName && !new RegExp(entry.onlyName).test(tail)) {
      leftOut.push({ path: w.path, cadPartNumber: w.cadPartNumber, reason: 'another body of a part already placed' });
      continue;
    }
    if (entry.source === 'default') unchecked.add(w.cadPartNumber);
    const pose = cadPoseToApp(w.matrix, lib, entry, { scaleFactor: walked.scaleFactor });
    converted.push({ w, lib, pose, sub: subassemblyName(w.top) });
  }

  // Two of the same part at the same pose: placed once
  const duplicates = [];
  const kept = [];
  for (const c of converted) {
    const sameTurn = (k) => THREE.MathUtils.radToDeg(quatOf(k.pose.rotation).angleTo(quatOf(c.pose.rotation))) <= DUPLICATE_DEG;
    const same = kept.find(
      (k) =>
        k.lib.id === c.lib.id &&
        Math.hypot(...k.pose.position.map((v, i) => v - c.pose.position[i])) <= DUPLICATE_MM &&
        (sameTurn(k) || Boolean(looksTheSame?.(c.lib, k.pose, c.pose)))
    );
    if (same) duplicates.push({ path: c.w.path, sameAs: same.w.path, part: c.lib.name });
    else kept.push(c);
  }

  // Resting on the floor unless a lift is given: the lowest point of any part's box at y = 0
  let lift = liftMm;
  if (lift === null) {
    let lowest = Infinity;
    for (const c of kept) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(...c.pose.position), quatOf(c.pose.rotation), new THREE.Vector3(1, 1, 1));
      const box = new THREE.Box3(new THREE.Vector3(...c.lib.bbox.min), new THREE.Vector3(...c.lib.bbox.max)).applyMatrix4(m);
      lowest = Math.min(lowest, box.min.y);
    }
    lift = Number.isFinite(lowest) ? -lowest : 0;
  }

  // Labels unique in the build: "<subassembly>: <instance>", with the parent node when it would repeat
  const labelOf = (c, withParent) => {
    const segs = c.w.path.split('/');
    const tail = segs.pop();
    const parent = withParent && segs.length > 1 ? `${segs.pop()}/` : '';
    return `${c.sub}: ${parent}${tail}`;
  };
  const counts = new Map();
  for (const c of kept) counts.set(labelOf(c, false), (counts.get(labelOf(c, false)) || 0) + 1);
  const used = new Set();
  const items = kept.map((c) => {
    let label = counts.get(labelOf(c, false)) > 1 ? labelOf(c, true) : labelOf(c, false);
    for (let n = 2; used.has(label); n++) label = `${labelOf(c, true)} #${n}`;
    used.add(label);
    return {
      partQuery: c.lib.id,
      label,
      position: [c.pose.position[0], Number((c.pose.position[1] + lift).toFixed(3)), c.pose.position[2]],
      rotation: c.pose.rotation,
      subassembly: c.sub,
      isPin: c.lib.category === 'Pins & Standoffs',
      ...(frameEntryFor(frames, c.w.cadPartNumber, projectId).bend === 'pins' ? { bendThroughPins: true } : {})
    };
  });
  // Structural parts first, pins after, so pins go into parts already there
  items.sort((a, b) => Number(a.isPin) - Number(b.isPin));
  return { items, leftOut, duplicates, unchecked: [...unchecked].sort(), liftMm: Number(lift.toFixed(3)), bandParts, ropeParts };
}

/** A stdio client for the MCP server, as any agent would use it. */
export function startMcp(env = process.env) {
  const srv = spawn('node', [path.join(ROOT, 'mcp', 'vexiq-mcp-server.mjs')], { cwd: ROOT, env, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '';
  let nextId = 1;
  const pending = new Map();
  srv.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    }
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      srv.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const call = async (name, args = {}) => {
    const r = await request('tools/call', { name, arguments: args });
    const text = r.result?.content?.find((c) => c.type === 'text')?.text ?? '';
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
    if (r.error || r.result?.isError) throw new Error(`${name}: ${r.error?.message || data?.error || text}`);
    return data;
  };
  return {
    ready: request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'import-cad', version: '1' } }),
    call,
    close: () => srv.kill()
  };
}

/** Places the items in batches, groups them per subassembly and returns the audit summary. */
export async function placeItems(items, { clear = false, env, bands = [], ropes = [] } = {}) {
  const mcp = startMcp(env);
  await mcp.ready;
  try {
    if (clear) await mcp.call('clear_assembly', { mode: 'empty' });
    const idsBySub = new Map();
    const idOfItem = new Map(); // `import-<k>` (the item's id while routing bands) -> placed id
    let placed = 0;
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const res = await mcp.call('place_parts', {
        parts: batch.map(({ partQuery, label, position, rotation, shape }) => ({ partQuery, label, position, rotation, ...(shape ? { shape } : {}) })),
        keepPoses: true
      });
      res.parts.forEach((p, k) => {
        const sub = batch[k].subassembly;
        if (!idsBySub.has(sub)) idsBySub.set(sub, []);
        idsBySub.get(sub).push(p.instanceId);
        idOfItem.set(`import-${i + k}`, p.instanceId);
      });
      placed += res.parts.length;
    }
    // Bands, strung on the placed parts as VEX's CAD has them
    const strung = [];
    for (const b of bands) {
      if (b.error) continue;
      try {
        const res = await mcp.call('place_band', {
          bandPartId: b.partQuery,
          label: b.label,
          spots: b.spots.map((s) => ({ ...s, instanceId: idOfItem.get(s.instanceId) })),
          ignoreInWay: true,
          back: 'straight'
        });
        strung.push({ label: b.label, stretch: res.stretch, state: res.stretchState, passesThrough: res.passesThrough || [] });
        if (!idsBySub.has(b.sub)) idsBySub.set(b.sub, []);
        idsBySub.get(b.sub).push(res.instanceId);
      } catch (err) {
        b.error = err.message;
      }
    }
    // Ropes, each from its pieces in VEX's CAD
    const strungRopes = [];
    for (const r of ropes) {
      if (r.error) continue;
      const ref = (e) => (e ? { ...e, instanceId: idOfItem.get(e.instanceId) } : undefined);
      try {
        const res = await mcp.call('place_rope', {
          ropePartId: r.partQuery,
          label: r.label,
          from: ref(r.from),
          ...(r.to ? { to: ref(r.to) } : {}),
          via: r.via.map(ref),
          ...(r.winding ? { winding: r.winding } : {}),
          allowShort: true
        });
        strungRopes.push({ label: r.label, usedMm: res.usedMm, turns: res.turns, slackMm: res.slackMm, tooShortMm: res.tooShortMm || 0 });
        if (!idsBySub.has(r.sub)) idsBySub.set(r.sub, []);
        idsBySub.get(r.sub).push(res.instanceId);
      } catch (err) {
        r.error = err.message;
      }
    }
    for (const [name, ids] of idsBySub) if (ids.length >= 2) await mcp.call('group_parts', { instanceIds: ids, name });
    const audit = await mcp.call('audit_assembly');
    return { placed, groups: [...idsBySub].map(([name, ids]) => ({ name, parts: ids.length })), audit, strungBands: strung, strungRopes };
  } finally {
    mcp.close();
  }
}

/**
 * The route of each band VEX's CAD shows stretched (openspec rubber-bands): its mesh's points, the
 * spots of the converted parts near them, and routeFromPoints. Parts are named by their item's
 * index (`import-<k>`) until they're placed. Returns [{ label, partQuery, sub, spots, names, stretch,
 * state } | { label, error }].
 */
export async function importBands(project, walked, converted, { source }) {
  if (!converted.bandParts.length) return [];
  const { getCatalog, partOf, buildWorldMatrix } = await import('../mcp/assembly-engine.mjs');
  const { bandSpec, partSpots, routeFromPoints, worldSpot } = await import('../src/utils/bandPath.js');
  const { stringBand } = await import('../src/utils/bandRoute.js');
  const { partsInWay } = await import('../src/engine/bandRouting.js');
  const { bandPiecesOf, dracoDecoder, nodesByPath, projectArchive } = await import('./cad-meshes.mjs');
  const { catalogById } = getCatalog();
  // A saved copy of the project names it by its id
  const meshDir = await projectArchive(fs.existsSync(String(source)) ? project.id : source);
  const decode = await dracoDecoder({ faces: true });
  const nodes = nodesByPath(project);
  const instances = converted.items.map((it, k) => ({ instanceId: `import-${k}`, partId: it.partQuery, label: it.label, position: it.position, rotation: it.rotation, visible: true, ...(it.shape ? { shape: it.shape } : {}) }));
  const out = [];
  for (const { w, lib, sub: cadSub } of converted.bandParts) {
    // A band at the top of the CAD (not in a subassembly) goes in a "Bands" group
    const sub = w.path.includes('/') ? cadSub : 'Bands';
    const bands = bandPiecesOf(w, nodes.get(w.path), { meshDir, decode, scaleFactor: walked.scaleFactor, liftMm: converted.liftMm });
    const spec = bandSpec(lib);
    bands.forEach((pts, n) => {
      const label = `${sub}: ${lib.name}${bands.length > 1 ? ` #${n + 1}` : ''} (${w.path.split('/').pop().split('^')[0]})`;
      const points = [];
      for (let i = 0; i < pts.length; i += 3) points.push([pts[i], pts[i + 1], pts[i + 2]]);
      const box = new THREE.Box3().setFromPoints(points.map((p) => new THREE.Vector3(...p))).expandByScalar(30);
      const candidates = [];
      for (const inst of instances) {
        const part = partOf(inst);
        if (!part?.bbox) continue;
        const m = buildWorldMatrix(inst.position, inst.rotation);
        if (!box.intersectsBox(new THREE.Box3(new THREE.Vector3(...part.bbox.min), new THREE.Vector3(...part.bbox.max)).applyMatrix4(m))) continue;
        for (const s of partSpots(part)) if (s.kind !== 'gaphook' && !s.hidden) candidates.push({ ref: { instanceId: inst.instanceId, label: inst.label, feature: s.feature }, spot: worldSpot(s, m) });
      }
      const route = routeFromPoints(points, candidates, { thickMm: spec.thickMm });
      if (new Set(route.map((s) => `${s.ref.instanceId}|${s.ref.feature}`)).size < 2) {
        out.push({ label, error: `couldn't find two spots it touches (found ${route.length})` });
        return;
      }
      // Each spot's side as VEX's band touches it, in that part's own frame
      const spots = route.map((s) => {
        const inst = instances.find((i) => i.instanceId === s.ref.instanceId);
        const q = new THREE.Quaternion().setFromRotationMatrix(buildWorldMatrix(inst.position, inst.rotation)).invert();
        return { instanceId: s.ref.instanceId, feature: s.ref.feature, side: s.side, wraps: 1, ...(s.wrapDir ? { wrap: new THREE.Vector3(...s.wrapDir).applyQuaternion(q).toArray().map((x) => Number(x.toFixed(4)) + 0) } : {}) };
      });
      // A run that passes through a part goes round it on the side VEX's band does (VEX draws its
      // arm bands curving a few mm off parts in their way): that part's nearest spot joins the route
      const bandInst = { instanceId: 'import-band', partId: lib.id, position: [0, 0, 0], rotation: [0, 0, 0] };
      let strung = stringBand(bandInst, spots, instances, partOf);
      const added = [];
      for (let round = 0; round < 8 && !strung.error; round++) {
        const hits = partsInWay(strung.contacts, instances, new Set(spots.map((x) => x.instanceId)), {});
        if (!hits.length) break;
        const h = hits[0];
        const inst = instances.find((i) => i.instanceId === h.instanceId);
        const m = buildWorldMatrix(inst.position, inst.rotation);
        let best = null;
        for (const sp of partSpots(partOf(inst))) {
          if (sp.kind === 'gaphook' || sp.kind === 'rim' || sp.shape !== 'circle' || sp.hidden) continue;
          const w = worldSpot(sp, m);
          const d = h.at.clone().sub(w.center);
          d.addScaledVector(w.axis, -d.dot(w.axis));
          if (!best || d.length() < best.d) best = { sp, w, d: d.length() };
        }
        if (!best) break;
        // The side: where VEX's band points near this spot lie, seen along its axis
        const near = points.map((p) => new THREE.Vector3(...p)).filter((p) => p.distanceTo(h.at) < 25);
        const towards = near.reduce((acc, p) => acc.add(p.clone().sub(best.w.center)), new THREE.Vector3());
        towards.addScaledVector(best.w.axis, -towards.dot(best.w.axis));
        const q = new THREE.Quaternion().setFromRotationMatrix(m).invert();
        const entry = { instanceId: inst.instanceId, feature: best.sp.feature, side: 'out', wraps: 1, ...(towards.lengthSq() > 1e-6 ? { wrap: towards.normalize().applyQuaternion(q).toArray().map((x) => Number(x.toFixed(4)) + 0) } : {}) };
        spots.splice(h.run + 1, 0, entry);
        added.push(`${inst.label.split(': ').pop()} ${best.sp.label}`);
        strung = stringBand(bandInst, spots, instances, partOf);
      }
      const names = [...new Map(route.map((s) => [`${s.ref.instanceId}|${s.ref.feature}`, `${s.ref.label.split(': ').pop()} ${s.spot.label}`])).values()];
      names.push(...added.map((a) => `${a} (in the way)`));
      out.push({ label, partQuery: lib.id, sub, spots, names, folded: route.length > names.length, stretch: strung.error ? null : strung.stretch, state: strung.error ? null : strung.state });
    });
  }
  void catalogById;
  return out;
}

/**
 * The ropes VEX's CAD shows (openspec rope-and-spool, design decision 11). Rope pieces that touch are
 * one rope. Its size is the library rope among them; its ends are the tabs that sit on a post or in a
 * spool's pocket; its spots are the grooves and posts its cord lies on, in order from one end to the
 * other, each on the side VEX drew. Returns [{ label, partQuery, sub, from, to, via, winding, names,
 * usedMm, turns, slackMm, shortMm, sizeChosen, pieces }] or [{ label, error, pieces }].
 */
export async function importRopes(project, walked, converted, { source, keepPoints = false }) {
  if (!converted.ropeParts?.length) return [];
  const { partOf, buildWorldMatrix } = await import('../mcp/assembly-engine.mjs');
  const { partSpots, spotByFeature, worldSpot } = await import('../src/utils/bandPath.js');
  const { endPlaces, ropeSpec, spoolSpec, suggestRope } = await import('../src/utils/ropePath.js');
  const { stringRope } = await import('../src/utils/ropeRoute.js');
  const { appMeshPoints, dracoDecoder, nodesByPath, projectArchive, thin } = await import('./cad-meshes.mjs');
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
  const byNumber = new Map(catalog.map((p) => [p.partNumber, p]));
  const meshDir = await projectArchive(fs.existsSync(String(source)) ? project.id : source);
  const decode = await dracoDecoder({ faces: true });
  const nodes = nodesByPath(project);
  const instances = converted.items.map((it, k) => ({ instanceId: `import-${k}`, partId: it.partQuery, label: it.label, position: it.position, rotation: it.rotation, visible: true, ...(it.shape ? { shape: it.shape } : {}) }));
  const V = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  const triples = (flat) => {
    const out = [];
    for (let i = 0; i < flat.length; i += 3) out.push(new THREE.Vector3(flat[i], flat[i + 1], flat[i + 2]));
    return out;
  };

  // Each piece's bodies: cord (long and thin) and tabs (about 8 x 11.5 x 4.6 mm); the small ball at a
  // cord's end is neither
  const pieces = converted.ropeParts.map((rp) => {
    const bodies = appMeshPoints(rp.w, nodes.get(rp.w.path), { meshDir, decode, scaleFactor: walked.scaleFactor, liftMm: converted.liftMm, sampleMm: 0.5, byBody: true }) || [];
    const cord = [];
    const tabs = [];
    for (const b of bodies) {
      const pts = triples(thin(Array.from(b), 0.75));
      const size = new THREE.Box3().setFromPoints(pts).getSize(new THREE.Vector3()).toArray().sort((x, y) => x - y);
      if (size[2] > 20) cord.push(...pts);
      else if (size[2] >= 9 && size[2] <= 14 && size[0] >= 3.5) tabs.push({ points: pts, centre: pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length) });
    }
    return { ...rp, cord, tabs, all: [...cord, ...tabs.flatMap((t) => t.points)] };
  });

  // Pieces whose points come within 3 mm are one rope
  const cellsOf = (pts) => new Set(pts.map((p) => `${Math.round(p.x / 3)},${Math.round(p.y / 3)},${Math.round(p.z / 3)}`));
  const cells = pieces.map((p) => cellsOf(p.all));
  const touch = (a, b) => {
    for (const k of cells[a]) {
      const [x, y, z] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) if (cells[b].has(`${x + dx},${y + dy},${z + dz}`)) return true;
    }
    return false;
  };
  const group = pieces.map((_, i) => i);
  const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) if (find(a) !== find(b) && touch(a, b)) group[find(b)] = find(a);
  const ropes = new Map();
  pieces.forEach((p, i) => {
    if (!ropes.has(find(i))) ropes.set(find(i), []);
    ropes.get(find(i)).push(p);
  });

  // Where a tab sits: a post through its hole, or a spool's pocket
  const world = instances.map((inst) => {
    const part = partOf(inst);
    const m = part ? buildWorldMatrix(inst.position, inst.rotation) : null;
    return { inst, part, m, box: part?.bbox ? new THREE.Box3(V(part.bbox.min), V(part.bbox.max)).applyMatrix4(m).expandByScalar(8) : null };
  });
  const seatOf = (tab) => {
    let best = null;
    for (const { inst, part, m, box } of world) {
      if (!box || !box.containsPoint(tab.centre)) continue;
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      for (const place of endPlaces(part)) {
        if (place.kind === 'pocket') {
          const d = V(place.center).applyMatrix4(m).distanceTo(tab.centre);
          if (d <= 7 && (!best || d - 10 < best.score)) best = { score: d - 10, end: { instanceId: inst.instanceId, feature: 'pocket' }, inst };
          continue;
        }
        const spot = worldSpot(spotByFeature(part, place.feature), m);
        const axis = spot.axis.clone().normalize();
        const rel = tab.centre.clone().sub(spot.center);
        const at = rel.dot(axis);
        if (at < Math.min(...spot.span) - 2 || at > Math.max(...spot.span) + 2) continue;
        const off = rel.addScaledVector(axis, -at).length();
        if (off > 5) continue;
        // The post goes through the tab's hole: no tab point on its line
        const nearest = Math.min(...tab.points.map((p) => p.clone().sub(spot.center).cross(axis).length()));
        if (nearest < 0.8 || nearest > 4) continue;
        if (!best || off < best.score) best = { score: off, end: { instanceId: inst.instanceId, feature: place.feature, at: Number(at.toFixed(2)) }, inst };
      }
      void q;
    }
    return best;
  };

  const out = [];
  for (const parts of ropes.values()) {
    const straight = parts.find((p) => p.lib);
    const named = parts.find((p) => p.named);
    const sub = (straight || parts.find((p) => p.w.path.includes('/')) || parts[0]).sub;
    const pieceNames = parts.map((p) => p.w.path.split('/').pop().split('^')[0].trim());
    const cord = parts.flatMap((p) => p.cord);
    const seats = parts.flatMap((p) => p.tabs).map((t) => ({ tab: t, seat: seatOf(t) })).filter((x) => x.seat).sort((a, b) => a.seat.score - b.seat.score);
    let lib = straight?.lib || (named ? byNumber.get(named.named) : null) || null;
    const baseLabel = `${sub}: ${lib ? lib.name : 'rope'}`;
    if (!seats.length || !cord.length) {
      out.push({ label: baseLabel, error: !cord.length ? 'no cord was found among its pieces' : 'no end was found on a pin, standoff, shaft or spool', pieces: pieceNames });
      continue;
    }
    // Two ends at most, and not the same place twice
    const ends = [];
    for (const s of seats) if (ends.length < 2 && !ends.some((e) => e.seat.end.instanceId === s.seat.end.instanceId && e.seat.end.feature === s.seat.end.feature)) ends.push(s);
    // A spool's pocket is the rope's first end
    ends.sort((a, b) => Number(b.seat.end.feature === 'pocket') - Number(a.seat.end.feature === 'pocket'));
    const from = ends[0].seat.end;
    const to = ends[1]?.seat.end || null;
    const endIds = new Set(ends.map((e) => e.seat.end.instanceId));

    // How far along the cord each point is from the first end (steps through touching 2 mm cubes)
    const key = (p) => `${Math.round(p.x / 2)},${Math.round(p.y / 2)},${Math.round(p.z / 2)}`;
    const cubes = new Map();
    for (const p of [...cord, ...parts.flatMap((x) => x.tabs.flatMap((t) => t.points))]) if (!cubes.has(key(p))) cubes.set(key(p), Infinity);
    let queue = [key(ends[0].tab.centre)];
    if (!cubes.has(queue[0])) queue = [key(ends[0].tab.points[0])];
    cubes.set(queue[0], 0);
    while (queue.length) {
      const next = [];
      for (const k of queue) {
        const [x, y, z] = k.split(',').map(Number);
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
          const n = `${x + dx},${y + dy},${z + dz}`;
          if (cubes.get(n) === Infinity) {
            cubes.set(n, cubes.get(k) + 1);
            next.push(n);
          }
        }
      }
      queue = next;
    }
    const along = (p) => cubes.get(key(p));

    // The grooves and posts the cord lies on
    const cordBox = new THREE.Box3().setFromPoints(cord).expandByScalar(15);
    const touched = [];
    for (const { inst, part, m, box } of world) {
      if (!box || endIds.has(inst.instanceId) || !cordBox.intersectsBox(box)) continue;
      for (const s of partSpots(part)) {
        if (s.hidden || s.shape !== 'circle' || !['groove', 'post'].includes(s.kind)) continue;
        const spot = worldSpot(s, m);
        const axis = spot.axis.clone().normalize();
        const radius = s.kind === 'groove' && Number.isFinite(s.grooveRadiusMm) ? s.grooveRadiusMm : spot.radius;
        const [lo, hi] = [Math.min(...spot.span) - 1, Math.max(...spot.span) + 1];
        const hits = [];
        let deep = 0;
        for (const p of cord) {
          const d = p.clone().sub(spot.center);
          const t = d.dot(axis);
          if (t < lo || t > hi) continue;
          const r = d.addScaledVector(axis, -t).length();
          if (r < radius - 1) deep++;
          else if (r <= radius + 2.4) hits.push(p);
        }
        if (hits.length < 5 || deep > Math.max(2, hits.length * 0.1)) continue;
        touched.push({ kind: s.kind, centre: spot.center.clone(), axis, radius, span: [lo + 1, hi - 1], ref: { instanceId: inst.instanceId, feature: s.feature }, name: `${inst.label} ${s.label} (${part.name})`, hits: hits.length, along: Math.min(...hits.map(along).filter(Number.isFinite), Infinity) });
      }
    }
    // One spot a part: the one with the most cord on it
    const bestOf = new Map();
    for (const t of touched) if (!bestOf.has(t.ref.instanceId) || bestOf.get(t.ref.instanceId).hits < t.hits) bestOf.set(t.ref.instanceId, t);
    // A post on a touched groove's own line is the pin that pulley turns on
    const axleOf = (t) => t.kind === 'post' && touched.some((g) => g.kind === 'groove' && Math.abs(g.axis.dot(t.axis)) > 0.999 && g.centre.clone().sub(t.centre).cross(t.axis).length() < 1);
    let spots = [...bestOf.values()].filter((t) => Number.isFinite(t.along) && !axleOf(t)).sort((a, b) => a.along - b.along);

    // Strung each way round its spots (and each winding): the one lying closest to VEX's cord. A spot
    // the tight rope doesn't press on was only passed by, and goes.
    const spoolInst = from.feature === 'pocket' ? instances.find((i) => i.instanceId === from.instanceId) : null;
    const spool = spoolInst ? spoolSpec(partOf(spoolInst)) : null;
    const spoolM = spoolInst ? buildWorldMatrix(spoolInst.position, spoolInst.rotation) : null;
    const spoolAxis = spool ? V(spool.axis).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(spoolM)).normalize() : null;
    const spoolAt = spool ? new THREE.Vector3().setFromMatrixPosition(spoolM) : null;
    const probe = lib || byNumber.get('228-2500-448');
    const ropeInst = { instanceId: 'import-rope', partId: probe.id, position: [0, 0, 0], rotation: [0, 0, 0] };
    const coarse = triples(thin(cord.flatMap((p) => [p.x, p.y, p.z]), 2));
    const fit = (strung) => {
      let sum = 0;
      let n = 0;
      // The tight line through its contacts (no sag), a point every 3 mm
      const line = strung.contacts.flatMap((c, k) => (k === 0 ? [V(c.b)] : k === strung.contacts.length - 1 ? [V(c.a)] : [V(c.a), V(c.b)]));
      const sampled = [];
      for (let k = 0; k + 1 < line.length; k++) {
        const steps = Math.max(1, Math.ceil(line[k].distanceTo(line[k + 1]) / 3));
        for (let j = 0; j < steps; j++) sampled.push(line[k].clone().lerp(line[k + 1], j / steps));
      }
      for (const p of sampled) {
        if (spool) {
          const d = p.clone().sub(spoolAt);
          if (d.addScaledVector(spoolAxis, -d.dot(spoolAxis)).length() < spool.flangeRadiusMm + 2) continue;
        }
        let best = Infinity;
        for (const c of coarse) best = Math.min(best, c.distanceToSquared(p));
        best = Math.sqrt(best);
        sum += best;
        n++;
      }
      return n ? sum / n : 30;
    };
    const tryAll = (list) => {
      let best = null;
      const n = Math.min(list.length, 5);
      for (let mask = 0; mask < 1 << n; mask++) {
        for (const winding of spool ? [1, -1] : [1]) {
          const via = list.map((s, k) => ({ ...s.ref, wraps: 1, ...(k < n ? { turn: mask & (1 << k) ? 1 : -1 } : {}) }));
          const strung = stringRope(ropeInst, { ends: [from, to], via, spool: spool ? { winding } : null }, instances, partOf, { allowShort: true });
          if (strung.error) {
            if (!best) best = { error: strung.error, buried: strung.buried };
            continue;
          }
          const miss = fit(strung);
          if (!best || best.error || miss < best.miss - 1e-6) best = { strung, via, winding, miss };
        }
      }
      return best;
    };
    // Which of the touched spots the rope really goes round, and in what order: VEX draws a rope's
    // slack as a bulge that can lie against a post the tight rope never touches, and the two legs of
    // a rope over a pulley lie too close together to tell the order from the cord alone. Every choice
    // and order of up to four spots is strung; one is ruled out when the rope would be too short, would
    // barely bend at a spot, or would run through a touched post it leaves out. Of the rest, the one
    // lying closest to VEX's cord, each spot costing 1 mm (so a spot stays only when it helps).
    const segGap = (p1, q1, p2, q2) => {
      const d1 = q1.clone().sub(p1);
      const d2 = q2.clone().sub(p2);
      const r = p1.clone().sub(p2);
      const [a, e, f] = [d1.dot(d1), d2.dot(d2), d2.dot(r)];
      const [b, c] = [d1.dot(d2), d1.dot(r)];
      const den = a * e - b * b;
      let sN = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      let tN = e > 1e-9 ? (b * sN + f) / e : 0;
      if (tN < 0) { tN = 0; sN = a > 1e-9 ? Math.min(1, Math.max(0, -c / a)) : 0; } else if (tN > 1) { tN = 1; sN = a > 1e-9 ? Math.min(1, Math.max(0, (b - c) / a)) : 0; }
      return p1.clone().addScaledVector(d1, sN).distanceTo(p2.clone().addScaledVector(d2, tN));
    };
    const cutsPost = (strung, t) => {
      const [p, q] = [t.centre.clone().addScaledVector(t.axis, t.span[0]), t.centre.clone().addScaledVector(t.axis, t.span[1])];
      const c = strung.contacts;
      for (let k = 0; k + 1 < c.length; k++) if (segGap(V(c[k].b), V(c[k + 1].a), p, q) < t.radius - 0.3) return true;
      return false;
    };
    const orders = (list) => (list.length <= 1 ? [list] : list.flatMap((x, i) => orders(list.filter((_, j) => j !== i)).map((rest) => [x, ...rest])));
    const posts = spots.filter((t) => t.kind === 'post');
    const lengthMm = lib ? ropeSpec(lib).lengthMm : Infinity;
    let got = null;
    let fallback = null;
    const pool = spots.slice(0, 4);
    for (let mask = 0; mask < 1 << pool.length; mask++) {
      const chosen = pool.filter((_, k) => mask & (1 << k));
      for (const order of orders(chosen)) {
        const t = tryAll(order);
        if (!t) continue;
        if (t.error) {
          if (!fallback) fallback = t;
          continue;
        }
        const score = t.miss + order.length;
        if (!fallback || fallback.error || score < fallback.score) fallback = { ...t, score, spots: order };
        if (t.strung.usedMm > lengthMm + 1) continue;
        if (order.some((_, k) => (t.strung.contacts[k + 1]?.wrapDeg ?? 0) < 5)) continue;
        if (posts.some((x) => !order.includes(x) && cutsPost(t.strung, x))) continue;
        if (!got || score < got.score) got = { ...t, score, spots: order };
      }
    }
    got = got || fallback;
    if (got?.spots) spots = got.spots;
    if (!got || got.error) {
      out.push({ label: baseLabel, error: got?.error || "couldn't string it", pieces: pieceNames });
      continue;
    }
    // No library rope among the pieces: the shortest that fits the route
    let sizeChosen = false;
    if (!lib) {
      const pick = suggestRope(got.strung.usedMm, spool);
      lib = pick ? byNumber.get(pick.partNumber) : probe;
      sizeChosen = true;
    }
    const final = stringRope({ ...ropeInst, partId: lib.id }, { ends: [from, to], via: got.via, spool: spool ? { winding: got.winding } : null }, instances, partOf, { allowShort: true });
    const nameOf = (e) => {
      const inst = instances.find((i) => i.instanceId === e.instanceId);
      return `${inst.label}${e.feature === 'pocket' ? ' pocket' : ''} (${partOf(inst).name})`;
    };
    out.push({
      label: `${sub}: ${lib.name}`,
      partQuery: lib.id,
      sub,
      from,
      to,
      via: got.via,
      winding: spool ? (got.winding === -1 ? 'under' : 'over') : null,
      names: { from: nameOf(from), to: to ? nameOf(to) : null, via: spots.map((s) => s.name) },
      usedMm: Number(final.usedMm.toFixed(1)),
      turns: final.turns,
      slackMm: Number(final.slackMm.toFixed(1)),
      shortMm: final.short ? Number((-final.spareMm).toFixed(1)) : 0,
      missMm: Number(got.miss.toFixed(2)),
      sizeChosen,
      pieces: pieceNames,
      ...(keepPoints ? { points: thin(cord.flatMap((p) => [p.x, p.y, p.z]), 2) } : {})
    });
  }
  return out;
}

/**
 * Sheets bent in VEX CAD (`bendThroughPins`), laid on the pins that hold them and bent through the rest
 * with the engine, in item order so a later sheet stacks on an earlier one. Changes the sheet items'
 * pose and adds their shape; returns [{ label, anchored, unanchored, error }] for the report.
 */
export async function bendImportedSheets(items) {
  const { getCatalog } = await import('../mcp/assembly-engine.mjs');
  const { bendSheetOnPins } = await import('../src/engine/sheetBending.js');
  const { catalogById } = getCatalog();
  const instances = items.map((it, k) => ({ instanceId: `import-${k}`, partId: it.partQuery, label: it.label, position: it.position, rotation: it.rotation, visible: true }));
  const sheets = items.map((it, k) => (it.bendThroughPins ? k : -1)).filter((k) => k >= 0);
  const others = new Set(sheets);
  let state = { instances: instances.filter((_, k) => !others.has(k)) };
  const results = [];
  for (const k of sheets) {
    const it = items[k];
    const pinIds = instances
      .filter((inst, j) => items[j].subassembly === it.subassembly && /Sheet Pin/.test(catalogById.get(inst.partId)?.name || ''))
      .map((inst) => inst.instanceId);
    const r = bendSheetOnPins(state, { sheetPartId: it.partQuery, label: it.label, pinIds });
    if (r.error) {
      results.push({ label: it.label, error: r.error });
      continue;
    }
    Object.assign(it, { position: r.position, rotation: r.rotation, ...(r.shape ? { shape: r.shape } : {}) });
    state = { instances: [...state.instances, { ...instances[k], position: r.position, rotation: r.rotation, shape: r.shape }] };
    results.push({ label: it.label, anchored: r.anchored, unanchored: r.unanchored });
  }
  return results;
}

/** The report as plain lines. */
export function reportLines(r) {
  const lines = [];
  lines.push(`Placed ${r.placed ?? r.items.length} parts${r.groups ? ` in ${r.groups.map((g) => `${g.name} (${g.parts})`).join(', ')}` : ''}, raised ${r.liftMm} mm to rest on the floor.`);
  const why = new Map();
  for (const l of r.leftOut) why.set(l.reason, [...(why.get(l.reason) || []), l.cadPartNumber || l.path]);
  lines.push(`Left out ${r.leftOut.length}:`);
  for (const [reason, list] of why) lines.push(`  ${reason} (${list.length}): ${[...new Set(list)].join(', ')}`);
  lines.push(`Duplicates dropped ${r.duplicates.length}${r.duplicates.length ? ':' : '.'}`);
  for (const d of r.duplicates) lines.push(`  ${d.path} (same place as ${d.sameAs})`);
  lines.push(r.unchecked.length ? `Placed by the unchecked box-centre rule: ${r.unchecked.join(', ')}` : 'Every part type has a checked frame entry.');
  for (const b of r.bentSheets || []) {
    if (b.error) {
      lines.push(`Sheet placed flat: ${b.error}.`);
      continue;
    }
    const rows = b.anchored.map((a) => `row ${a.row} on ${a.on}${a.stretchMm ? ` (stretched ${a.stretchMm.toFixed(2)} mm)` : ''}`);
    lines.push(`Bent ${b.label}: ${rows.join(', ') || 'held rows only'}.`);
    for (const u of b.unanchored) lines.push(`  not anchored on ${u.on}: ${u.reason}`);
  }
  for (const b of r.ropes || []) {
    if (b.error) lines.push(`Rope left out: ${b.label}: ${b.error} (pieces: ${b.pieces.join(', ')}).`);
    else {
      const spare = b.shortMm ? `too short by ${b.shortMm} mm` : b.turns ? `${b.turns} turns on the spool${b.slackMm > 0.5 ? `, ${b.slackMm} mm slack` : ''}` : `${b.slackMm} mm slack`;
      lines.push(`Rope ${b.label}${b.sizeChosen ? ' (no library rope among its pieces: the shortest that fits)' : ''}: from ${b.names.from}${b.names.via.length ? ` over ${b.names.via.join(', ')}` : ''} to ${b.names.to || 'a free end'}; ${b.usedMm} mm used, ${spare}. Pieces joined: ${b.pieces.join(', ')}.`);
    }
  }
  for (const b of r.bands || []) {
    if (b.error) lines.push(`Band left out: ${b.label}: ${b.error}.`);
    else lines.push(`Band ${b.label}: round ${b.names.join(', ')}${b.folded ? ' (folded out and back)' : ''}${b.stretch ? `, ${b.stretch.toFixed(2)}× (${b.state})` : ''}.`);
  }
  if (r.audit) {
    const a = r.audit;
    lines.push(`Audit: ${a.collisionCount} overlapping, ${a.tightFitCount} tight fits, ${a.floatingFastenerCount} floating and ${a.halfSeatedFastenerCount} half-seated fasteners, ${a.unsecuredPartCount} unsecured parts.`);
  }
  return lines;
}

async function main(argv) {
  const args = argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  const source = args.find((a, i) => !a.startsWith('--') && !['--save', '--report', '--lift'].includes(args[i - 1]));
  if (!source) {
    console.log('Usage: node scripts/import-cad.mjs <project id | link | saved .json> [--clear] [--dry-run] [--save file] [--report file] [--lift mm]');
    process.exit(1);
  }
  const project = await loadProject(source);
  if (value('--save')) fs.writeFileSync(value('--save'), JSON.stringify(project));
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
  const frames = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'cad-frames.json'), 'utf8')).frames;
  const lift = value('--lift');
  const { looksTheSame } = await import('../mcp/assembly-engine.mjs');
  const libraryNumbers = new Set(catalog.map((p) => p.partNumber));
  const walked = walkAssembly(project, { isLibraryPart: (n) => libraryNumbers.has(n) });
  const converted = convertParts(walked, { catalog, frames, liftMm: lift === null ? null : Number(lift), looksTheSame, projectId: project.id || null });
  converted.bentSheets = await bendImportedSheets(converted.items);
  converted.bands = await importBands(project, walked, converted, { source });
  converted.ropes = await importRopes(project, walked, converted, { source });
  const result = flag('--dry-run') ? converted : { ...converted, ...(await placeItems(converted.items, { clear: flag('--clear'), bands: converted.bands, ropes: converted.ropes })) };
  for (const line of reportLines(result)) console.log(line);
  if (value('--report')) fs.writeFileSync(value('--report'), JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
