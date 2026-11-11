/**
 * Grows public/cad-frames.json by matching library meshes to the per-part meshes of a VEX CAD
 * project on instructions.online (openspec cad-import-readiness, cad-import).
 *
 *   node scripts/fit-cad-frames.mjs <project id | instructions.online link> [--write] [--only pn,pn]
 *
 * Downloads the project's archive once (cached in .cache/cad-projects/), decodes each part's Draco
 * mesh, and for each CAD part number tries the 24 quarter turns, lining up the two models' box
 * centres, then refines the offset. The best fit is written as a `mesh` entry when its mean distance
 * is at most 0.5 mm (with --write); a `pins` entry is never replaced. Without --write it only reports,
 * including how each existing entry compares with the best fit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { getPartRawGeometry } from '../mcp/assembly-engine.mjs';
import { frameOffset, frameTurn } from '../src/engine/cadFrames.js';
import { loadProject, projectIdFrom, walkAssembly } from './import-cad.mjs';
import { dracoDecoder, nodeMeshes, nodesByPath, projectArchive } from './cad-meshes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAMES_PATH = path.join(ROOT, 'public', 'cad-frames.json');
const MAX_MEAN_MM = 0.5;
const SAMPLES = 1500;

/**
 * For each CAD part number, its first instance's meshes as [{ versionId, matrix }], each matrix
 * taking that mesh into the part node's own frame.
 */
function meshesByPartNumber(project, walked) {
  const versions = project.assemblyStructure.rootVersions || {};
  const byPath = nodesByPath(project);
  const out = new Map();
  for (const p of walked.parts) {
    if (out.has(p.cadPartNumber) || p.hidden) continue;
    const node = byPath.get(p.path);
    if (!node) continue;
    const meshes = nodeMeshes(node);
    if (meshes.some((m) => versions[m.versionId])) out.set(p.cadPartNumber, meshes);
  }
  return out;
}

/** The 24 quarter turns, as XYZ degrees. */
function quarterTurns() {
  const seen = [];
  const turns = [];
  for (const x of [0, 90, 180, 270]) {
    for (const y of [0, 90, 180, 270]) {
      for (const z of [0, 90, 180, 270]) {
        const m = frameTurn({ turn: [x, y, z] });
        const key = m.elements.map((v) => Math.round(v)).join(',');
        if (seen.includes(key)) continue;
        seen.push(key);
        turns.push([x, y, z].map((d) => (d > 180 ? d - 360 : d)));
      }
    }
  }
  return turns;
}

const boxOf = (points) => new THREE.Box3().setFromArray(points);

/** Mean distance from the CAD points, moved by (Q, o), to the library part's surface. */
function meanDistance(geo, points, Q, o) {
  const v = new THREE.Vector3();
  const hit = {};
  let sum = 0;
  const residual = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 3) {
    v.set(points[i], points[i + 1], points[i + 2]).applyMatrix4(Q).add(o);
    geo.boundsTree.closestPointToPoint(v, hit);
    sum += hit.distance;
    residual.add(hit.point.clone().sub(v));
  }
  const n = points.length / 3;
  return { mean: sum / n, shift: residual.divideScalar(n) };
}

/** Best (turn, offset) laying the CAD points on the library part, with its mean distance. */
function fitPart(libPart, cadPoints) {
  const geo = getPartRawGeometry(libPart);
  const libCentre = new THREE.Vector3(...libPart.bbox.center);
  const cadCentre = boxOf(cadPoints).getCenter(new THREE.Vector3());
  let best = null;
  for (const turn of quarterTurns()) {
    const Q = frameTurn({ turn });
    const o = libCentre.clone().sub(cadCentre.clone().applyMatrix4(Q));
    const { mean } = meanDistance(geo, cadPoints, Q, o);
    if (!best || mean < best.mean) best = { turn, Q, o, mean };
  }
  // Refine the offset: move by the mean pull toward the surface until it settles
  for (let i = 0; i < 15; i++) {
    const { mean, shift } = meanDistance(geo, cadPoints, best.Q, best.o);
    best.mean = mean;
    if (shift.length() < 0.005) break;
    best.o.add(shift);
  }
  best.mean = meanDistance(geo, cadPoints, best.Q, best.o).mean;
  return best;
}

/** An entry for a fit: the box-centre rule when the offset is the library box centre, else origin. */
function entryOf(fit, libPart, cadPn, mapped, projectId) {
  const centre = new THREE.Vector3(...libPart.bbox.center);
  const turn = fit.turn.some((d) => d !== 0) ? { turn: fit.turn } : {};
  const placement =
    fit.o.distanceTo(centre) <= 0.3
      ? { rule: 'centre', ...turn }
      : { rule: 'origin', ...turn, offsetMm: fit.o.toArray().map((v) => Number(v.toFixed(2)) + 0) };
  return { ...(mapped ? { library: mapped } : {}), ...placement, source: 'mesh', checkedOn: projectId, meanErrorMm: Number(fit.mean.toFixed(3)) };
}

/** Largest distance between where two (Q, o) put the corners of the library part's box (mm). */
function cornerGap(libPart, Qa, oa, Qb, ob) {
  // p_lib = Q · p_cad + o, so a CAD point lands at Qa⁻¹(p - oa) under a, at Qb⁻¹(p - ob) under b
  let worst = 0;
  const ia = Qa.clone().transpose();
  const ib = Qb.clone().transpose();
  for (const x of [libPart.bbox.min[0], libPart.bbox.max[0]]) {
    for (const y of [libPart.bbox.min[1], libPart.bbox.max[1]]) {
      for (const z of [libPart.bbox.min[2], libPart.bbox.max[2]]) {
        const p = new THREE.Vector3(x, y, z);
        const a = p.clone().sub(oa).applyMatrix4(ia);
        const b = p.clone().sub(ob).applyMatrix4(ib);
        worst = Math.max(worst, a.distanceTo(b));
      }
    }
  }
  return worst;
}

async function main(argv) {
  const args = argv.slice(2);
  const source = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--only');
  if (!source) {
    console.log('Usage: node scripts/fit-cad-frames.mjs <project id | link> [--write] [--only pn,pn]');
    process.exit(1);
  }
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
  const projectId = projectIdFrom(source);
  const project = await loadProject(source);
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
  const libraryNumbers = new Set(catalog.map((p) => p.partNumber));
  const walked = walkAssembly(project, { isLibraryPart: (n) => libraryNumbers.has(n) });
  const meshDir = await projectArchive(source);
  const decode = await dracoDecoder();
  const table = JSON.parse(fs.readFileSync(FRAMES_PATH, 'utf8'));
  const frames = table.frames;
  const scale = walked.scaleFactor;

  const written = [];
  const poor = [];
  const compared = [];
  for (const [cadPn, meshes] of meshesByPartNumber(project, walked)) {
    if (only && !only.includes(cadPn)) continue;
    const existing = frames[cadPn];
    const libPart = catalog.find((p) => p.partNumber === (existing?.library || cadPn) || p.name === existing?.library);
    if (!libPart) continue;
    // The part's CAD model in mm, in its node's frame
    const all = [];
    for (const m of meshes) {
      const file = path.join(meshDir, `${m.versionId}.drc`);
      if (!fs.existsSync(file)) continue;
      const pts = decode(file);
      const v = new THREE.Vector3();
      for (let i = 0; i < pts.length; i += 3) all.push(...v.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(m.matrix).divideScalar(scale).toArray());
    }
    if (!all.length) continue;
    const step = Math.max(1, Math.floor(all.length / 3 / SAMPLES));
    const sample = [];
    for (let i = 0; i < all.length; i += 3 * step) sample.push(all[i], all[i + 1], all[i + 2]);
    const fit = fitPart(libPart, sample);
    const entry = entryOf(fit, libPart, cadPn, existing?.library, projectId);

    if (existing && existing.source !== 'mesh') {
      // How the existing entry compares: the same placement, or one that fits as well (a symmetric part)
      const Qe = frameTurn(existing);
      const oe = frameOffset(existing, libPart);
      const gap = cornerGap(libPart, Qe, oe, fit.Q, fit.o);
      const existingMean = meanDistance(getPartRawGeometry(libPart), sample, Qe, oe).mean;
      compared.push({ cadPn, source: existing.source, gapMm: gap, existingMeanMm: existingMean, bestMeanMm: fit.mean, best: entry, agrees: gap <= 0.5 || existingMean <= fit.mean + 0.05 });
      continue;
    }
    if (fit.mean > MAX_MEAN_MM) {
      poor.push({ cadPn, meanErrorMm: Number(fit.mean.toFixed(3)) });
      continue;
    }
    frames[cadPn] = entry;
    written.push(cadPn);
  }

  for (const c of compared) {
    console.log(
      `${c.agrees ? 'agrees ' : 'DIFFERS'} ${c.cadPn} (${c.source}): ${c.gapMm.toFixed(2)} mm apart; mean distance ${c.existingMeanMm.toFixed(3)} mm as entered, ${c.bestMeanMm.toFixed(3)} mm at best` +
        (c.agrees ? '' : `; best: ${JSON.stringify({ rule: c.best.rule, turn: c.best.turn, offsetMm: c.best.offsetMm })}`)
    );
  }
  console.log(`${compared.filter((c) => c.agrees).length} of ${compared.length} existing entries agree with the meshes.`);
  if (poor.length) console.log(`Poor matches, not written (over ${MAX_MEAN_MM} mm): ${poor.map((p) => `${p.cadPn} ${p.meanErrorMm} mm`).join(', ')}`);
  if (args.includes('--write')) {
    fs.writeFileSync(FRAMES_PATH, `${JSON.stringify(table, null, 1)}\n`);
    console.log(`Wrote ${written.length} mesh entries: ${written.join(', ') || 'none'}`);
  } else if (written.length) {
    console.log(`Would write ${written.length} mesh entries (run with --write): ${written.join(', ')}`);
  }
}

main(process.argv).catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
