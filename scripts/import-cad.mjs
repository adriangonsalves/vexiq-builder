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
 * batches with place_parts (structural parts before pins), then grouped per top subassembly.
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

/** The project's viewer data, from a saved file or downloaded from Cadasio. */
export async function loadProject(arg) {
  if (fs.existsSync(arg)) return JSON.parse(fs.readFileSync(arg, 'utf8'));
  const id = projectIdFrom(arg);
  const url = `https://api.cadasio.com/api/getProjectViewer?id=${encodeURIComponent(id)}&withSteps=false&hostname=instructions.online`;
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
 * The project's parts: every node whose component is a VEX part number (or a leaf), with its CAD
 * part number, instance path, top subassembly, hidden flag and world matrix (row-vector form).
 */
export function walkAssembly(project) {
  const a = project.assemblyStructure;
  const versions = a.rootVersions || {};
  const out = [];
  const walk = (node, parent, top) => {
    const r = node.rootReference;
    const m = mul4(matrixOf(r.transform), parent);
    const v = versions[r.childVersionId] || {};
    const comp = String(v.versionComponentName || '').split(' [')[0];
    const kids = node.children || [];
    if ((PART_NUMBER.test(comp) && !comp.startsWith('228-9136-000-')) || !kids.length) {
      out.push({ cadPartNumber: comp, path: r.name, top: top || r.name, hidden: Boolean(r.hidden), matrix: m });
      return;
    }
    for (const c of kids) walk(c, m, top || r.name);
  };
  for (const c of a.children || []) walk(c, IDENTITY, null);
  return { parts: out, scaleFactor: a.scaleFactor || 1 };
}

/** "IQ Hero Bot Drive Train-1" -> "Drive Train". */
export function subassemblyName(top) {
  return String(top || 'Robot').split('/')[0].replace(/^IQ Hero Bot /, '').replace(/-\d+$/, '') || 'Robot';
}

const quatOf = (rot) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));

/**
 * Converts the walked parts to place_parts items. Returns { items, leftOut, duplicates, unchecked }.
 * `catalog`: the library; `frames`: cad-frames.json's frames; `looksTheSame(part, poseA, poseB)`:
 * whether two poses fill the same space (the engine's; default: the same turn within 1°).
 */
export function convertParts(walked, { catalog, frames, liftMm = null, looksTheSame = null }) {
  const byNumber = new Map(catalog.map((p) => [p.partNumber, p]));
  const byName = new Map(catalog.map((p) => [p.name, p]));
  const leftOut = [];
  const unchecked = new Set();
  const converted = [];
  for (const w of walked.parts) {
    const tail = w.path.split('/').pop();
    if (w.hidden) {
      leftOut.push({ path: w.path, cadPartNumber: w.cadPartNumber, reason: 'hidden in the CAD' });
      continue;
    }
    const kind = NOT_IN_LIBRARY.find((k) => k.test.test(w.cadPartNumber) || k.test.test(tail));
    const entry = frameEntryFor(frames, w.cadPartNumber);
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
      isPin: c.lib.category === 'Pins & Standoffs'
    };
  });
  // Structural parts first, pins after, so pins go into parts already there
  items.sort((a, b) => Number(a.isPin) - Number(b.isPin));
  return { items, leftOut, duplicates, unchecked: [...unchecked].sort(), liftMm: Number(lift.toFixed(3)) };
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
export async function placeItems(items, { clear = false, env } = {}) {
  const mcp = startMcp(env);
  await mcp.ready;
  try {
    if (clear) await mcp.call('clear_assembly', { mode: 'empty' });
    const idsBySub = new Map();
    let placed = 0;
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const res = await mcp.call('place_parts', {
        parts: batch.map(({ partQuery, label, position, rotation }) => ({ partQuery, label, position, rotation }))
      });
      res.parts.forEach((p, k) => {
        const sub = batch[k].subassembly;
        if (!idsBySub.has(sub)) idsBySub.set(sub, []);
        idsBySub.get(sub).push(p.instanceId);
      });
      placed += res.parts.length;
    }
    for (const [name, ids] of idsBySub) if (ids.length >= 2) await mcp.call('group_parts', { instanceIds: ids, name });
    const audit = await mcp.call('audit_assembly');
    return { placed, groups: [...idsBySub].map(([name, ids]) => ({ name, parts: ids.length })), audit };
  } finally {
    mcp.close();
  }
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
  const converted = convertParts(walkAssembly(project), { catalog, frames, liftMm: lift === null ? null : Number(lift), looksTheSame });
  const result = flag('--dry-run') ? converted : { ...converted, ...(await placeItems(converted.items, { clear: flag('--clear') })) };
  for (const line of reportLines(result)) console.log(line);
  if (value('--report')) fs.writeFileSync(value('--report'), JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv).catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
