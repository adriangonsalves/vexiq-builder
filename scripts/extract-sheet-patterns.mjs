/**
 * The printed lattice on VEX IQ plastic sheets (the honeycomb with a ring round each hole), taken from
 * a VEX CAD project's edge lines for the sheet's flat body, into public/sheet-patterns.json in each
 * library sheet's own frame. The 3D view draws it on clear sheets, bent with them.
 *
 *   node scripts/extract-sheet-patterns.mjs [project id]   (default: the 2026-27 Herobot Flop)
 *
 * Needs the project cached by scripts/fit-cad-frames.mjs (.cache/cad-projects/) with its edges.zip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { loadProject } from './import-cad.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.argv[2] || '4063-2026-2027_viqrc_herobot_flop';
// The flat body of each sheet in that project, and the library part it is
const SOURCES = [
  { library: '228-2500-2712', body: /228-7711-712 Split Bodies-3$/ },
  { library: '228-2500-2711', body: /228-7711-711 Split Bodies-2$/ }
];

const cache = path.join(ROOT, '.cache', 'cad-projects');
const zip = fs.readdirSync(cache).find((f) => f.endsWith('.zip'));
if (!zip) throw new Error('No cached project: run node scripts/fit-cad-frames.mjs <project> first');
const edgesDir = path.join(cache, `${zip.replace(/\.zip$/, '')}_edges`);
if (!fs.existsSync(edgesDir)) {
  fs.mkdirSync(edgesDir, { recursive: true });
  execFileSync('unzip', ['-o', '-q', path.join(cache, zip), 'edges.zip', '-d', edgesDir]);
  execFileSync('unzip', ['-o', '-q', path.join(edgesDir, 'edges.zip'), '-d', edgesDir]);
}
const project = await loadProject(process.argv[3] || PROJECT);
const scale = project.assemblyStructure.scaleFactor || 1;
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
const colOf = (s) => {
  const v = String(s).split(',').map(Number);
  return new THREE.Matrix4().set(v[0], v[4], v[8], v[12], v[1], v[5], v[9], v[13], v[2], v[6], v[10], v[14], 0, 0, 0, 1);
};
const nodes = [];
const walk = (n) => {
  nodes.push(n);
  (n.children || []).forEach(walk);
};
project.assemblyStructure.children.forEach(walk);

const out = {};
for (const src of SOURCES) {
  const part = catalog.find((p) => p.partNumber === src.library);
  const node = nodes.find((n) => src.body.test(n.rootReference.name));
  if (!part || !node) throw new Error(`${src.library}: no part or no body`);
  // Every edge line of the body's pieces, in the body's frame, in mm (pairs of points)
  const pts = [];
  for (const child of node.children || []) {
    const file = path.join(edgesDir, `${child.rootReference.childVersionId}.json`);
    if (!fs.existsSync(file)) continue;
    const m = colOf(child.rootReference.transform);
    const s = JSON.parse(fs.readFileSync(file, 'utf8')).hardEdges?.instanceStart || [];
    for (let i = 0; i + 5 < s.length; i += 6) {
      pts.push(new THREE.Vector3(s[i], s[i + 1], s[i + 2]).applyMatrix4(m).divideScalar(scale));
      pts.push(new THREE.Vector3(s[i + 3], s[i + 4], s[i + 5]).applyMatrix4(m).divideScalar(scale));
    }
  }
  // Into the library sheet's frame: box centre to box centre, longest axis to x, thinnest to y
  const box = new THREE.Box3().setFromPoints(pts);
  const size = box.getSize(new THREE.Vector3()).toArray();
  const centre = box.getCenter(new THREE.Vector3());
  const order = [0, 1, 2].sort((a, b) => size[b] - size[a]); // long, short, thin
  const lib = part.bbox;
  const libCentre = [0, 1, 2].map((k) => (lib.min[k] + lib.max[k]) / 2);
  const map = (p, flipX, flipZ) => {
    const d = p.clone().sub(centre).toArray();
    return [libCentre[0] + d[order[0]] * flipX, libCentre[1] + d[order[2]], libCentre[2] + d[order[1]] * flipZ];
  };
  // The flip that puts the pattern's hole rings on the library's holes
  const holes = part.ports.filter((p) => p.type === 'pin_hole').map((p) => p.origin);
  let best = null;
  for (const fx of [1, -1]) {
    for (const fz of [1, -1]) {
      let miss = 0;
      for (const h of holes) {
        let near = Infinity;
        for (let i = 0; i < pts.length; i += 7) {
          const q = map(pts[i], fx, fz);
          near = Math.min(near, Math.abs(Math.hypot(q[0] - h[0], q[2] - h[2]) - 3.2));
        }
        miss += near;
      }
      if (!best || miss < best.miss) best = { fx, fz, miss };
    }
  }
  // The lines lie on three levels across the thickness: the sheet's two faces (its outline and hole
  // rims, as many on each) and the pattern, a layer just off one face. The pattern goes on that face
  // of the library sheet, nudged 0.02 mm off it.
  const level = (q) => Math.round(map(q, best.fx, best.fz)[1] * 10) / 10;
  const counts = new Map();
  for (const q of pts) counts.set(level(q), (counts.get(level(q)) || 0) + 1);
  const [patternLevel] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
  const faces = [...counts.keys()].filter((k) => k !== patternLevel);
  const above = faces.every((k) => patternLevel > k);
  const y = above ? lib.max[1] + 0.02 : lib.min[1] - 0.02;
  const flat = [];
  for (let i = 0; i < pts.length; i += 2) {
    if (level(pts[i]) !== patternLevel || level(pts[i + 1]) !== patternLevel) continue;
    const a = map(pts[i], best.fx, best.fz);
    const b = map(pts[i + 1], best.fx, best.fz);
    flat.push(...[a[0], y, a[2], b[0], y, b[2]].map((v) => Math.round(v * 100) / 100));
  }
  out[part.id] = { partNumber: src.library, source: `${PROJECT}: ${node.rootReference.name}`, holeMissMm: Number((best.miss / holes.length).toFixed(2)), segments: flat };
  console.log(`${part.name}: ${flat.length / 6} pattern lines on its ${above ? 'top' : 'bottom'} face (of ${pts.length / 2}); hole rings within ${(best.miss / holes.length).toFixed(2)} mm of the library's holes`);
}
fs.writeFileSync(path.join(ROOT, 'public', 'sheet-patterns.json'), JSON.stringify(out));
console.log(`Wrote public/sheet-patterns.json (${(fs.statSync(path.join(ROOT, 'public', 'sheet-patterns.json')).size / 1024).toFixed(0)} kB)`);
