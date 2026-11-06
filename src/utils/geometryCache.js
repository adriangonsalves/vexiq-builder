import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH } from 'three-mesh-bvh';
import { hubFrame, splitHubTriangles, subGeometry } from './motorHub.js';
import { assetUrl } from './assetUrl.js';
import { baseOf, isDerivedPartId, shapeMeshArrays } from './shapedParts.js';
import { bendCurve, bendPoint } from './sheetBend.js';

const loader = new GLTFLoader();
export const RUBBER_MATERIAL_NAME = 'rubber';
export const RUBBER_COLOR = '#1c1f22';
export const METAL_SHAFT_COLOR = '#e2e8f0';

export function isMetalShaftName(name) {
  const lower = (name || '').toLowerCase();
  return (
    (lower.includes('shaft') || lower.includes('axle')) &&
    !lower.includes('plastic') &&
    !lower.includes('collar') &&
    !lower.includes('bushing') &&
    !lower.includes('washer') &&
    !lower.includes('spacer')
  );
}

/** The clear plastic sheets (2x12, 6x6 and 6x12): drawn see-through, tinted and glossy. */
export function isClearPlasticPart(part) {
  return /Plastic (PET )?Sheet/.test(part?.name || '');
}

export function isMetalPart(part) {
  return Boolean(part?.isMetal || isMetalShaftName(part?.name));
}
// partId -> Promise<{ geometries, collisionGeometries, localBox, hub }>; `hub` is set for the Smart
// Motor: { frame, renderIndices, collisionIndices } naming the hub pieces of each list (motorHub.js)
const partAssetCache = new Map();

/**
 * Creates a position-welded inward-eroded copy of a BufferGeometry for collision testing.
 * Because B-Rep CAD meshes split vertices along sharp face seams, we first average vertex normals
 * across coincident 3D positions before moving vertices inward (-weldedNormal * clearanceMm).
 * This shrinks outer pin/shaft snap lips and widens inner hole walls so pins and axles pass
 * cleanly through holes without false surface-grazing collisions while catching all solid overlaps.
 */
const COLLISION_CLEARANCE_MM = 0.38;
const TIGHT_FIT_MM = 0.5;

function createErodedCollisionGeometry(srcGeo, clearanceMm = COLLISION_CLEARANCE_MM) {
  const geo = srcGeo.clone();
  if (!geo.attributes.normal) {
    geo.computeVertexNormals();
  }
  const posAttr = geo.attributes.position;
  const normAttr = geo.attributes.normal;

  if (posAttr && normAttr && posAttr.count === normAttr.count) {
    const pos = posAttr.array;
    const norm = normAttr.array;

    // Average normals across coincident 3D vertices (quantized to 0.01mm)
    const weldedNormals = new Map();
    for (let i = 0; i < pos.length; i += 3) {
      const key = `${Math.round(pos[i] * 100)},${Math.round(pos[i + 1] * 100)},${Math.round(
        pos[i + 2] * 100
      )}`;
      let acc = weldedNormals.get(key);
      if (!acc) {
        acc = [0, 0, 0];
        weldedNormals.set(key, acc);
      }
      acc[0] += norm[i];
      acc[1] += norm[i + 1];
      acc[2] += norm[i + 2];
    }

    const newPos = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      const key = `${Math.round(pos[i] * 100)},${Math.round(pos[i + 1] * 100)},${Math.round(
        pos[i + 2] * 100
      )}`;
      const [sx, sy, sz] = weldedNormals.get(key);
      const len = Math.hypot(sx, sy, sz) || 1;
      newPos[i] = pos[i] - (sx / len) * clearanceMm;
      newPos[i + 1] = pos[i + 1] - (sy / len) * clearanceMm;
      newPos[i + 2] = pos[i + 2] - (sz / len) * clearanceMm;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  }

  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.boundsTree = new MeshBVH(geo);
  return geo;
}

/**
 * Loads a part's GLB file once and caches both its render geometries and its BVH-accelerated
 * collision geometries.
 */
export function loadPartAsset(part) {
  if (partAssetCache.has(part.id)) {
    return partAssetCache.get(part.id);
  }

  const promise = new Promise((resolve, reject) => {
    loader.load(
      assetUrl(part.modelUrl),
      (gltf) => {
        const geometries = [];
        const collisionGeometries = [];
        const localBox = new THREE.Box3();
        const frame = hubFrame(part);
        const hub = { frame, renderIndices: [], collisionIndices: [] };

        gltf.scene.traverse((child) => {
          if (child.isMesh && child.geometry) {
            let renderGeo = child.geometry.clone();
            // A shaped copy (openspec shaped-parts-and-sheet-bending): the catalog model in its shape
            if (part.basePartId) renderGeo = shapedGeometry(part, renderGeo);
            // Black rubber bodies (omni wheel rollers) keep their own colour (convert-worker.mjs)
            if (child.material?.name === RUBBER_MATERIAL_NAME) renderGeo.userData.rubber = true;
            if (child.material?.name?.startsWith('step:')) {
              renderGeo.userData.fixedColor = child.material.name.slice(5);
            }
            if (isMetalPart(part)) {
              renderGeo.userData.isMetal = true;
            }
            if (!renderGeo.attributes.normal) {
              renderGeo.computeVertexNormals();
            }
            renderGeo.computeBoundingBox();
            if (renderGeo.boundingBox) {
              localBox.union(renderGeo.boundingBox);
            }
            // The Smart Motor's drive hub is split off so it can be turned (motorHub.js)
            const split = frame ? splitHubTriangles(renderGeo.attributes.position.array, renderGeo.index?.array, frame) : null;
            const pieces = split?.hub.length
              ? [
                  { geo: subGeometry(renderGeo, split.body), hub: false },
                  { geo: subGeometry(renderGeo, split.hub), hub: true }
                ].filter((piece) => piece.geo)
              : [{ geo: renderGeo, hub: false }];
            for (const piece of pieces) {
              Object.assign(piece.geo.userData, renderGeo.userData);
              if (piece.hub) {
                hub.renderIndices.push(geometries.length);
                hub.collisionIndices.push(collisionGeometries.length);
              }
              geometries.push(piece.geo);
              collisionGeometries.push(createErodedCollisionGeometry(piece.geo, COLLISION_CLEARANCE_MM));
            }
          }
        });

        // Pulled in a further TIGHT_FIT_MM, built on first use: a contact the normal collision
        // mesh sees but this one doesn't is a tight fit, not an overlap (engine/core.js)
        let deep = null;
        const deepCollisionGeometries = () =>
          (deep ||= geometries.map((g) => createErodedCollisionGeometry(g, COLLISION_CLEARANCE_MM + TIGHT_FIT_MM)));

        resolve({ geometries, collisionGeometries, deepCollisionGeometries, localBox, hub: hub.renderIndices.length ? hub : null });
      },
      undefined,
      (err) => reject(err)
    );
  });

  partAssetCache.set(part.id, promise);
  // Shaped parts come and go as bends change: keep only the most recent ones
  const shaped = [...partAssetCache.keys()].filter(isDerivedPartId);
  if (shaped.length > SHAPED_ASSETS_MAX) partAssetCache.delete(shaped[0]);
  return promise;
}

const SHAPED_ASSETS_MAX = 60;

// A catalog geometry turned into the shaped part's (positions and normals; materials stay)
function shapedGeometry(part, geo) {
  const pos = geo.attributes.position.array;
  const norm = geo.attributes.normal?.array || new Float32Array(pos.length);
  const idx = geo.index ? geo.index.array : Uint32Array.from({ length: pos.length / 3 }, (_, i) => i);
  const shaped = shapeMeshArrays(part, pos, norm, idx);
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(shaped.pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(shaped.norm, 3));
  out.setIndex(new THREE.BufferAttribute(shaped.idx, 1));
  Object.assign(out.userData, geo.userData);
  return out;
}

// The printed lattice on clear plastic sheets (public/sheet-patterns.json, from scripts/extract-sheet-patterns.mjs)
let sheetPatterns = null;
const patternGeometryCache = new Map(); // part id (shaped parts too) -> Promise<BufferGeometry | null>
const PATTERN_STEP_MM = 1; // longer lines are cut so they follow a bend

/**
 * A clear sheet's printed pattern as line segments in its own frame, bent with the sheet when it is a
 * shaped part; null for parts without one.
 */
export function loadSheetPattern(part) {
  if (!isClearPlasticPart(part)) return Promise.resolve(null);
  if (patternGeometryCache.has(part.id)) return patternGeometryCache.get(part.id);
  const promise = (async () => {
    sheetPatterns ||= fetch(assetUrl('/sheet-patterns.json')).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const base = baseOf(part);
    const entry = (await sheetPatterns)[base.id];
    if (!entry?.segments?.length) return null;
    const src = entry.segments;
    const curve = part.shape ? bendCurve(base, part.shape) : null;
    const out = [];
    for (let i = 0; i < src.length; i += 6) {
      const a = [src[i], src[i + 1], src[i + 2]];
      const b = [src[i + 3], src[i + 4], src[i + 5]];
      const n = curve ? Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / PATTERN_STEP_MM)) : 1;
      let prev = curve ? bendPoint(curve, a) : a;
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        const next = curve ? bendPoint(curve, q) : q;
        out.push(...prev, ...next);
        prev = next;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    return geo;
  })();
  patternGeometryCache.set(part.id, promise);
  if (isDerivedPartId(part.id)) {
    const shaped = [...patternGeometryCache.keys()].filter(isDerivedPartId);
    if (shaped.length > SHAPED_ASSETS_MAX) patternGeometryCache.delete(shaped[0]);
  }
  return promise;
}
