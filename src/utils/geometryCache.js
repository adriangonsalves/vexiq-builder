import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshBVH } from 'three-mesh-bvh';
import { hubFrame, splitHubTriangles, subGeometry } from './motorHub.js';

const loader = new GLTFLoader();
export const RUBBER_MATERIAL_NAME = 'rubber';
export const RUBBER_COLOR = '#1c1f22';
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
function createErodedCollisionGeometry(srcGeo, clearanceMm = 0.38) {
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
      part.modelUrl,
      (gltf) => {
        const geometries = [];
        const collisionGeometries = [];
        const localBox = new THREE.Box3();
        const frame = hubFrame(part);
        const hub = { frame, renderIndices: [], collisionIndices: [] };

        gltf.scene.traverse((child) => {
          if (child.isMesh && child.geometry) {
            const renderGeo = child.geometry.clone();
            // Black rubber bodies (omni wheel rollers) keep their own colour (convert-worker.mjs)
            if (child.material?.name === RUBBER_MATERIAL_NAME) renderGeo.userData.rubber = true;
            if (child.material?.name?.startsWith('step:')) {
              renderGeo.userData.fixedColor = child.material.name.slice(5);
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
              collisionGeometries.push(createErodedCollisionGeometry(piece.geo, 0.38));
            }
          }
        });

        resolve({ geometries, collisionGeometries, localBox, hub: hub.renderIndices.length ? hub : null });
      },
      undefined,
      (err) => reject(err)
    );
  });

  partAssetCache.set(part.id, promise);
  return promise;
}
