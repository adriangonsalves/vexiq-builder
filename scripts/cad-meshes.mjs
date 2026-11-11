/**
 * VEX CAD (Cadasio / instructions.online) part meshes in Node: the project's archive downloaded once
 * (cached in .cache/cad-projects/), its Draco meshes decoded, and a walked part's mesh points in the
 * app's frame (mm). Shared by fit-cad-frames.mjs, import-cad.mjs (bands) and make-band-fixture.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { projectIdFrom } from './import-cad.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'cad-projects');
const API = 'https://api.cadasio.com/api';

// CAD is Y up with the front along +Z; the app has the front along +X (src/engine/cadFrames.js)
const CAD_TO_APP = new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);

/** The project's archive (project data and a zip of Draco meshes), downloaded once; returns the mesh folder. */
export async function projectArchive(projectArg) {
  const id = projectIdFrom(projectArg);
  const latest = await (await fetch(`${API}/getLatestProjectVersionOnline?projectId=${encodeURIComponent(id)}`)).json();
  if (!latest?.hasFile) throw new Error(`Project "${id}" has no downloadable version`);
  const file = `${latest.projectId}_${latest.version}.zip`;
  const local = path.join(CACHE, file);
  if (!fs.existsSync(local)) {
    const signed = (await (await fetch(`${API}/getSignedUrlViewer?fileName=${file}&projectId=${latest.projectId}&subFolder=versions`)).text()).replace(/^"|"$/g, '');
    const res = await fetch(signed);
    if (!res.ok) throw new Error(`Couldn't download ${file} (${res.status})`);
    fs.mkdirSync(CACHE, { recursive: true });
    fs.writeFileSync(local, Buffer.from(await res.arrayBuffer()));
  }
  const meshDir = path.join(CACHE, `${latest.projectId}_${latest.version}`);
  if (!fs.existsSync(meshDir)) {
    fs.mkdirSync(meshDir, { recursive: true });
    execFileSync('unzip', ['-o', '-q', local, 'mesh.zip', '-d', meshDir]);
    execFileSync('unzip', ['-o', '-q', path.join(meshDir, 'mesh.zip'), '-d', meshDir]);
    fs.rmSync(path.join(meshDir, 'mesh.zip'));
  }
  return meshDir;
}

/**
 * three's Draco decoder, loaded in Node: returns decode(file) -> Float32Array of xyz. With
 * `{ faces: true }`, decode(file) returns { points, index } (index: Uint32Array, three per triangle).
 */
export async function dracoDecoder({ faces = false } = {}) {
  const lib = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'draco', 'draco_decoder.js');
  const ctx = { console, WebAssembly, setTimeout, Math, Date, Promise, ArrayBuffer, Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array };
  vm.createContext(ctx);
  vm.runInContext(`${fs.readFileSync(lib, 'utf8')}\nthis.DracoDecoderModule = DracoDecoderModule;`, ctx);
  const draco = await ctx.DracoDecoderModule();
  return (file) => {
    const bytes = new Uint8Array(fs.readFileSync(file));
    const decoder = new draco.Decoder();
    const buffer = new draco.DecoderBuffer();
    buffer.Init(bytes, bytes.length);
    const mesh = new draco.Mesh();
    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    if (!status.ok()) throw new Error(`${path.basename(file)}: ${status.error_msg()}`);
    const attr = decoder.GetAttribute(mesh, decoder.GetAttributeId(mesh, draco.POSITION));
    const arr = new draco.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, attr, arr);
    const points = new Float32Array(arr.size());
    for (let i = 0; i < points.length; i++) points[i] = arr.GetValue(i);
    let index = null;
    if (faces) {
      const n = mesh.num_faces();
      index = new Uint32Array(n * 3);
      const ia = new draco.DracoInt32Array();
      for (let f = 0; f < n; f++) {
        decoder.GetFaceFromMesh(mesh, f, ia);
        index[3 * f] = ia.GetValue(0);
        index[3 * f + 1] = ia.GetValue(1);
        index[3 * f + 2] = ia.GetValue(2);
      }
      draco.destroy(ia);
    }
    [arr, mesh, buffer, decoder].forEach((o) => draco.destroy(o));
    return faces ? { points, index } : points;
  };
}

/** A CAD transform string (row-vector form, point · M) as three's column-form Matrix4. */
export const matrixOf = (s) => {
  const v = String(s).split(',').map(Number);
  return new THREE.Matrix4().set(v[0], v[4], v[8], v[12], v[1], v[5], v[9], v[13], v[2], v[6], v[10], v[14], 0, 0, 0, 1);
};

/** Every assembly node by its instance path (`rootReference.name`). */
export function nodesByPath(project) {
  const byPath = new Map();
  const walk = (node) => {
    byPath.set(node.rootReference.name, node);
    for (const c of node.children || []) walk(c);
  };
  for (const c of project.assemblyStructure.children || []) walk(c);
  return byPath;
}

/** A node's meshes as [{ versionId, matrix }], each matrix taking that mesh into the node's own frame. */
export function nodeMeshes(node) {
  const meshes = [];
  const collect = (n, rel) => {
    const kids = n.children || [];
    if (!kids.length) meshes.push({ versionId: n.rootReference.childVersionId, matrix: rel });
    for (const c of kids) collect(c, rel.clone().multiply(matrixOf(c.rootReference.transform)));
  };
  collect(node, new THREE.Matrix4());
  return meshes;
}

/**
 * A walked part's mesh points in the app's frame (mm, lifted by `liftMm` in y), as a Float32Array of
 * xyz, or null when its meshes aren't in the archive. `walkedPart.matrix` is its world matrix in
 * row-vector form (import-cad.mjs walkAssembly). With `sampleMm` (and a decoder made with
 * `{ faces: true }`), the triangles are filled with points about that far apart, so long flat faces
 * aren't only their corners. With `byBody`, returns one array per mesh body instead.
 */
export function appMeshPoints(walkedPart, node, { meshDir, decode, scaleFactor, liftMm = 0, sampleMm = null, byBody = false }) {
  const w = new THREE.Matrix4().set(...walkedPart.matrix.flat()).transpose();
  const bodies = [];
  const v = new THREE.Vector3();
  for (const m of nodeMeshes(node)) {
    const file = path.join(meshDir, `${m.versionId}.drc`);
    if (!fs.existsSync(file)) continue;
    const decoded = decode(file);
    const pts = decoded.points || decoded;
    const full = w.clone().multiply(m.matrix);
    const app = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i += 3) {
      v.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(full).divideScalar(scaleFactor).applyMatrix4(CAD_TO_APP);
      app[i] = v.x;
      app[i + 1] = v.y + liftMm;
      app[i + 2] = v.z;
    }
    const out = Array.from(app);
    if (sampleMm && decoded.index) {
      const ix = decoded.index;
      const P = (k) => [app[3 * k], app[3 * k + 1], app[3 * k + 2]];
      for (let t = 0; t < ix.length; t += 3) {
        const [a, b, c] = [P(ix[t]), P(ix[t + 1]), P(ix[t + 2])];
        const len = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]));
        const n = Math.ceil(len / sampleMm);
        if (n <= 1) continue;
        for (let i = 0; i <= n; i++)
          for (let j = 0; j <= n - i; j++) {
            const u = i / n;
            const q = j / n;
            out.push(a[0] + u * (b[0] - a[0]) + q * (c[0] - a[0]), a[1] + u * (b[1] - a[1]) + q * (c[1] - a[1]), a[2] + u * (b[2] - a[2]) + q * (c[2] - a[2]));
          }
      }
    }
    bodies.push(Float32Array.from(out));
  }
  if (!bodies.length) return null;
  if (byBody) return bodies;
  const all = new Float32Array(bodies.reduce((s, b) => s + b.length, 0));
  let o = 0;
  for (const b of bodies) {
    all.set(b, o);
    o += b.length;
  }
  return all;
}

const VOXEL_MM = 1.5;

/** CAD part numbers of rubber bands and belts. */
export const BAND_PART_NUMBERS = new Set(['228-2500-468', '228-2500-470', '228-2500-474', '228-2500-475', '228-2500-1225', '228-2500-221', '228-2500-222', '228-2500-223', '228-2500-224']);

/**
 * Points split into pieces that touch (neighbouring `cell` mm cubes): one CAD part can hold several
 * bands (Swish's two intake bands are bodies of one part).
 */
export function pieces(points, cell = VOXEL_MM) {
  const key = (i) => `${Math.round(points[i] / cell)},${Math.round(points[i + 1] / cell)},${Math.round(points[i + 2] / cell)}`;
  const cells = new Map();
  for (let i = 0; i < points.length; i += 3) {
    const k = key(i);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(i);
  }
  const seen = new Set();
  const out = [];
  for (const start of cells.keys()) {
    if (seen.has(start)) continue;
    seen.add(start);
    const stack = [start];
    const piece = [];
    while (stack.length) {
      const k = stack.pop();
      for (const i of cells.get(k)) piece.push(points[i], points[i + 1], points[i + 2]);
      const [x, y, z] = k.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const n = `${x + dx},${y + dy},${z + dz}`;
            if (cells.has(n) && !seen.has(n)) {
              seen.add(n);
              stack.push(n);
            }
          }
    }
    out.push(piece);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** One point per `cell` mm cube, rounded to 0.01 mm. */
export function thin(points, cell = VOXEL_MM) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < points.length; i += 3) {
    const key = `${Math.round(points[i] / cell)},${Math.round(points[i + 1] / cell)},${Math.round(points[i + 2] / cell)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(+points[i].toFixed(2), +points[i + 1].toFixed(2), +points[i + 2].toFixed(2));
  }
  return out;
}


/**
 * A visible band or belt's pieces as VEX's CAD draws them stretched: one array of points (app frame,
 * mm, one per 1.5 mm cube) per band, its mesh's triangles filled so straight runs aren't only their
 * ends. One CAD part can hold several bands (Swish's two intake bands are bodies of one part).
 */
export function bandPiecesOf(walkedPart, node, { meshDir, decode, scaleFactor, liftMm = 0 }) {
  const bodies = appMeshPoints(walkedPart, node, { meshDir, decode, scaleFactor, liftMm, sampleMm: 0.5, byBody: true });
  if (!bodies) return [];
  return bodies
    .flatMap((b) => pieces(thin(b, 0.75), 0.75))
    .map((p) => thin(p))
    .filter((p) => p.length >= 3 * 50);
}
