/**
 * The assembly engine's core: catalog lookup, collision meshes, audit, mating, gear meshing, chain
 * building, mirroring, joint graph and explode plans. It uses no Node APIs, so the browser's engine
 * worker runs it as well as the MCP server and the dev bridge. The catalog and part meshes come
 * from sources the caller sets (setCatalogSource, setMeshSource); mcp/assembly-engine.mjs sets
 * them from public/ and adds the state file, settings and app sync.
 */
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import {
  COLLAR_NAME_PATTERN,
  collectWorldFeatures,
  getLocalFeatures,
  findAlignedOpenings,
  findNearSeatedPairs,
  findSeatedPairs,
  findTooWideInserts,
  measureOpeningDepths,
  measureOpeningPassRadii,
  measureOpeningSurfaces,
  measurePinEnds,
  measureShaftProfiles,
  planMates
} from '../utils/pinHoleAlignment.js';
import { hubFrame, hubMatrix, splitHubTriangles } from '../utils/motorHub.js';
import { isMeshingGear, meshTurn, quaternionToEulerDeg, turnQuaternion, worldToothed } from '../utils/gearMeshing.js';
import { groupOf, shaftGroups, squareFitRoll, turnGroup } from '../utils/shaftGroups.js';
import { settlePlacement, turnAboutLine } from '../utils/placementFit.js';
import { isTireOnHub } from '../utils/tireFit.js';
import { seatedBatteryBay } from '../utils/batteryBay.js';
import { areChainNeighbours, isChainFit, isChainPart, isGripperOnLink, isLink, isLinkOnSprocket, unsupportedBends } from '../utils/chainFit.js';
import { applyPatches, groupParts } from '../utils/partGroups.js';
import { buildChainPath, chainMessage, nextChainName } from '../utils/chainPath.js';
import { buildExplodePlan } from '../utils/explodePlan.js';

export const VEX_PITCH_MM = 12.7;

let catalogCache = null;
let catalogById = null;
const bvhCache = new Map(); // partId -> { colGeo, localBox }
const deepBvhCache = new Map(); // partId -> the same, pulled in TIGHT_FIT_MM further

export const COLLISION_CLEARANCE_MM = 0.38;
// Contacts that only reach this much deeper than the collision mesh's clearance are tight fits
export const TIGHT_FIT_MM = 0.5;

/**
 * Where the engine gets the part catalog and each part's GLB file. Node reads them from public/
 * (see the defaults below); the browser's engine worker fetches them and passes them in.
 * `catalogSource()` returns the catalog array (the same array while it hasn't changed);
 * `meshSource(part)` returns the part's GLB as an ArrayBuffer (or Uint8Array), or null when it
 * isn't loaded yet, which throws a MissingMeshError so the caller can load it and try again.
 */
let catalogSource = () => {
  throw new Error('No catalog source set (call setCatalogSource)');
};
let meshSource = () => null;

export function setCatalogSource(source) {
  catalogSource = source;
  catalogCache = null;
}

export function setMeshSource(source) {
  meshSource = source;
}

/** A part's GLB isn't available from the mesh source yet. */
export class MissingMeshError extends Error {
  constructor(part) {
    super(`The model for ${part.name || part.id} isn't loaded`);
    this.name = 'MissingMeshError';
    this.partId = part.id;
    this.modelUrl = part.modelUrl;
  }
}

export function getCatalog() {
  const catalog = catalogSource();
  if (catalog !== catalogCache) {
    catalogCache = catalog;
    catalogById = new Map(catalog.map((p) => [p.id, p]));
  }
  return { catalog: catalogCache, catalogById };
}

/**
 * A part's connection point by its stable id or an alias (an id from before stable ids, such as
 * `hole_14`; openspec connection-points). Null when the part has none by that id.
 */
export function findPort(part, id) {
  const key = String(id ?? '').trim();
  if (!key) return null;
  const ports = part?.ports || [];
  return ports.find((p) => p.portId === key) || ports.find((p) => p.aliases?.includes(key)) || null;
}

/** A feature id from a port id or alias, keeping a split opening's `@lo` / `@hi` half. */
function featureIdFor(part, id) {
  if (id == null) return id;
  const [, base, half = ''] = String(id).trim().match(/^(.*?)(@lo|@hi)?$/);
  const port = findPort(part, base);
  return port ? `${port.portId}${half}` : id;
}

/** The error for a port id a part doesn't have, listing the ids it does have. */
export function unknownPortError(part, label, id) {
  const ids = (part?.ports || []).map((p) => p.portId);
  const shown = ids.length > 80 ? `${ids.slice(0, 80).join(', ')}, … (${ids.length} in all)` : ids.join(', ');
  return `"${label}" has no port "${id}". Its ports: ${shown || 'none'}`;
}

export function findPart(query) {
  const { catalog, catalogById } = getCatalog();
  if (!query) return null;
  if (catalogById.has(query)) return catalogById.get(query);
  const q = String(query).trim().toLowerCase();
  return (
    catalog.find((p) => p.partNumber.toLowerCase() === q) ||
    catalog.find((p) => p.name.toLowerCase() === q) ||
    catalog.find((p) => p.partNumber.toLowerCase().includes(q)) ||
    catalog.find((p) => p.name.toLowerCase().includes(q)) ||
    null
  );
}

/**
 * Parses a part's binary GLB file from public/models/ and builds a position-welded
 * inward-eroded MeshBVH (0.38mm clearance) so pins/shafts pass cleanly through holes
 * while solid intersections are detected accurately.
 */
// A part's GLB triangles as stored (positions, normals, indices)
function readPartGlb(part) {
  const data = meshSource(part);
  if (!data) throw new MissingMeshError(part);
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const binOffset = bytes.byteOffset + 20 + jsonLen + 8;

  const posBv = gltf.bufferViews[0];
  const normBv = gltf.bufferViews[1];
  const idxBv = gltf.bufferViews[2];

  const pos = new Float32Array(bytes.buffer, binOffset + posBv.byteOffset, posBv.byteLength / 4);
  const norm = new Float32Array(bytes.buffer, binOffset + normBv.byteOffset, normBv.byteLength / 4);
  const IdxType = gltf.accessors[2].componentType === 5125 ? Uint32Array : Uint16Array;
  const idx = new IdxType(bytes.buffer, binOffset + idxBv.byteOffset, idxBv.byteLength / IdxType.BYTES_PER_ELEMENT);
  return { pos, norm, idx };
}

const rawBvhCache = new Map(); // partId -> BufferGeometry with a BVH over the unshrunk mesh

/** BVH over a part's real (unshrunk) mesh, for measurements too fine for the collision mesh. */
export function getPartRawGeometry(part) {
  if (!rawBvhCache.has(part.id)) {
    const { pos, idx } = readPartGlb(part);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
    geo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
    geo.boundsTree = new MeshBVH(geo);
    rawBvhCache.set(part.id, geo);
  }
  return rawBvhCache.get(part.id);
}

export function getPartCollisionBvh(part) {
  if (!bvhCache.has(part.id)) bvhCache.set(part.id, buildCollisionBvh(part, COLLISION_CLEARANCE_MM));
  return bvhCache.get(part.id);
}

/** The collision mesh pulled in a further TIGHT_FIT_MM, to tell tight fits from overlaps. */
export function getPartDeepCollisionBvh(part) {
  if (!deepBvhCache.has(part.id)) {
    deepBvhCache.set(part.id, buildCollisionBvh(part, COLLISION_CLEARANCE_MM + TIGHT_FIT_MM));
  }
  return deepBvhCache.get(part.id);
}

function buildCollisionBvh(part, clearanceMm) {
  const { pos, norm, idx } = readPartGlb(part);
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

  const colGeo = new THREE.BufferGeometry();
  colGeo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  colGeo.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
  colGeo.computeBoundingBox();
  colGeo.boundsTree = new MeshBVH(colGeo);

  // The Smart Motor's drive hub turns (socketAngleDeg), so collisions use it as its own piece
  const frame = hubFrame(part);
  let pieces = [{ geo: colGeo, hub: false }];
  if (frame) {
    const split = splitHubTriangles(pos, idx, frame);
    if (split.hub.length) {
      pieces = [
        { triangles: split.body, hub: false },
        { triangles: split.hub, hub: true }
      ].map(({ triangles, hub }) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', colGeo.getAttribute('position'));
        geo.setIndex(new THREE.BufferAttribute(triangles, 1));
        geo.computeBoundingBox();
        geo.boundsTree = new MeshBVH(geo);
        return { geo, hub };
      });
    }
  }

  return { colGeo, localBox: colGeo.boundingBox.clone(), pieces, hubFrame: frame };
}

export function buildWorldMatrix(position, rotationDeg) {
  const pos = new THREE.Vector3(position[0], position[1], position[2]);
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(rotationDeg[0] || 0),
    THREE.MathUtils.degToRad(rotationDeg[1] || 0),
    THREE.MathUtils.degToRad(rotationDeg[2] || 0),
    'XYZ'
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);
  const scale = new THREE.Vector3(1, 1, 1);
  return new THREE.Matrix4().compose(pos, quat, scale);
}

/** Distance to a part's real surface along a ray in part-local mm, or null on a miss. */
function rawRaycast(part) {
  const geo = getPartRawGeometry(part);
  const ray = new THREE.Ray();
  return (o, d) => {
    ray.origin.set(o[0], o[1], o[2]);
    ray.direction.set(d[0], d[1], d[2]);
    return geo.boundsTree.raycastFirst(ray, THREE.DoubleSide)?.distance ?? null;
  };
}

const isShaftPart = (part) => getPartMeasurements(part).profiles.size > 0;

/** Collision pieces of an instance, a turned motor hub with its local matrix (and its inverse). */
function posedPieces(bvh, instance) {
  const deg = Number(instance.socketAngleDeg) || 0;
  return bvh.pieces.map((p) => {
    if (!p.hub || !deg) return { geo: p.geo };
    const local = hubMatrix(bvh.hubFrame, deg);
    return { geo: p.geo, local, inverse: local.clone().invert() };
  });
}

const meshesHit = (piecesA, piecesB, matBtoA) => {
  const pieceMat = new THREE.Matrix4();
  return piecesA.some((a) =>
    piecesB.some((b) => {
      pieceMat.copy(matBtoA);
      if (a.inverse) pieceMat.premultiply(a.inverse);
      if (b.local) pieceMat.multiply(b.local);
      return a.geo.boundsTree.intersectsGeometry(b.geo, pieceMat);
    })
  );
};

/**
 * Checks if a candidate instance (partId, position, rotation) intersects any other
 * visible instance in the assembly list. Returns { isIntersecting, collidingWith, tightFits }:
 * a pair whose meshes meet but no longer do once pulled in a further TIGHT_FIT_MM is a tight
 * fit, not an overlap.
 */
export function checkCandidateCollision(candidate, instances) {
  const { catalogById } = getCatalog();
  const partA = catalogById.get(candidate.partId);
  if (!partA) return { isIntersecting: false, collidingWith: [], tightFits: [] };

  const bvhA = getPartCollisionBvh(partA);
  const { localBox: boxA } = bvhA;
  const piecesA = posedPieces(bvhA, candidate);
  const matA = buildWorldMatrix(candidate.position, candidate.rotation);
  const worldBoxA = boxA.clone().applyMatrix4(matA);
  const invMatA = matA.clone().invert();
  const matBtoA = new THREE.Matrix4();

  const collidingWith = [];
  const tightFits = [];
  let deepA = null;
  let featuresA = null; // only worked out when a shaft and a hole meet

  for (const other of instances) {
    if (other.instanceId === candidate.instanceId) continue;
    if (other.visible === false) continue;
    const partB = catalogById.get(other.partId);
    if (!partB) continue;

    const bvhB = getPartCollisionBvh(partB);
    const { localBox: boxB } = bvhB;
    const matB = buildWorldMatrix(other.position, other.rotation);
    const worldBoxB = boxB.clone().applyMatrix4(matB);

    if (!worldBoxA.intersectsBox(worldBoxB)) continue;
    if (isTireOnHub(partA, matA, partB, matB)) continue;
    if (isChainFit(partA, matA, partB, matB)) continue;

    matBtoA.multiplyMatrices(invMatA, matB);
    let hit = meshesHit(piecesA, posedPieces(bvhB, other), matBtoA);
    let tight = false;
    if (hit) {
      deepA ||= posedPieces(getPartDeepCollisionBvh(partA), candidate);
      tight = !meshesHit(deepA, posedPieces(getPartDeepCollisionBvh(partB), other), matBtoA);
    }
    // The shrunk meshes miss small overlaps, like a shaft's cap inside a hole it can't pass
    if ((!hit || tight) && (isShaftPart(partA) || isShaftPart(partB))) {
      featuresA ||= worldFeaturesFor(candidate);
      if (findTooWideInserts(featuresA, worldFeaturesFor(other)).length > 0) {
        hit = true;
        tight = false;
      }
    }
    if (hit) {
      (tight ? tightFits : collidingWith).push({
        instanceId: other.instanceId,
        label: other.label,
        partNumber: partB.partNumber
      });
    }
  }

  return {
    isIntersecting: collidingWith.length > 0,
    collidingWith,
    tightFits
  };
}

/** True when the candidate meets any part, tight fits included: for moves that stop at first contact. */
export function touchesAny(candidate, instances) {
  const col = checkCandidateCollision(candidate, instances);
  return col.isIntersecting || col.tightFits.length > 0;
}

export function buildDefaultStarterState() {
  const { catalog } = getCatalog();
  const findByPartNum = (num) => catalog.find((p) => p.partNumber === num);
  const beam = findByPartNum('228-2500-025') || catalog.find((p) => p.name.includes('2x8 Beam')) || catalog[0];
  const pin = findByPartNum('228-2500-086') || catalog.find((p) => p.name.includes('0x2 Connector Pin'));
  const shaft = findByPartNum('228-2500-258') || catalog.find((p) => p.name.includes('4x Pitch Shaft'));
  const gear = findByPartNum('228-2500-215') || catalog.find((p) => p.name.includes('36 Tooth Gear'));

  const instances = [];
  if (beam) {
    instances.push({
      instanceId: 'inst-starter-beam',
      partId: beam.id,
      label: `${beam.name} #1`,
      position: [0, 12.7, 0],
      rotation: [0, 0, 0],
      lastValidPosition: [0, 12.7, 0],
      lastValidRotation: [0, 0, 0],
      isIntersecting: false,
      color: beam.defaultColor,
      visible: true,
      locked: false
    });
  }
  if (pin) {
    instances.push({
      instanceId: 'inst-starter-pin',
      partId: pin.id,
      label: `${pin.name} #1`,
      position: [6.35, 6.35, 3.175],
      rotation: [0, 180, 0],
      lastValidPosition: [6.35, 6.35, 3.175],
      lastValidRotation: [0, 180, 0],
      isIntersecting: false,
      color: pin.defaultColor,
      visible: true,
      locked: false
    });
  }
  if (shaft) {
    instances.push({
      instanceId: 'inst-starter-shaft',
      partId: shaft.id,
      label: `${shaft.name} #1`,
      position: [-19.05, 6.35, 0],
      rotation: [0, 0, 0],
      lastValidPosition: [-19.05, 6.35, 0],
      lastValidRotation: [0, 0, 0],
      isIntersecting: false,
      color: shaft.defaultColor,
      visible: true,
      locked: false
    });
  }
  if (gear) {
    instances.push({
      instanceId: 'inst-starter-gear',
      partId: gear.id,
      label: `${gear.name} #1`,
      position: [-19.05, 6.35, 12.7],
      rotation: [0, 0, 0],
      lastValidPosition: [-19.05, 6.35, 12.7],
      lastValidRotation: [0, 0, 0],
      isIntersecting: false,
      color: '#dc2626',
      visible: true,
      locked: false
    });
  }

  return {
    version: '1.0',
    updatedAt: new Date().toISOString(),
    selectedId: instances[0]?.instanceId || null,
    viewport: {
      transformMode: 'translate',
      snapPitchFactor: 0.5,
      rotationSnapDeg: 15,
      showGrid: true,
      showConnectors: true,
      focusTrigger: 1
    },
    instances
  };
}

/**
 * Transforms a placed instance's indexed semantic `ports[]` into world coordinates and axes.
 */
export function getWorldPortsForInstance(instance) {
  const { catalogById } = getCatalog();
  const part = catalogById.get(instance.partId);
  if (!part || !Array.isArray(part.ports)) return [];

  const mat = buildWorldMatrix(instance.position, instance.rotation);
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(instance.rotation[0] || 0),
    THREE.MathUtils.degToRad(instance.rotation[1] || 0),
    THREE.MathUtils.degToRad(instance.rotation[2] || 0),
    'XYZ'
  );
  const quat = new THREE.Quaternion().setFromEuler(euler);

  return part.ports.map((p) => {
    const worldOrigin = new THREE.Vector3(...p.origin).applyMatrix4(mat);
    const worldAxis = new THREE.Vector3(...p.axis).applyQuaternion(quat).normalize();
    return {
      ...p,
      worldOrigin: [
        Number(worldOrigin.x.toFixed(3)),
        Number(worldOrigin.y.toFixed(3)),
        Number(worldOrigin.z.toFixed(3))
      ],
      worldAxis: [
        Number(worldAxis.x.toFixed(4)),
        Number(worldAxis.y.toFixed(4)),
        Number(worldAxis.z.toFixed(4))
      ]
    };
  });
}

const COLLISION_EROSION_MM = COLLISION_CLEARANCE_MM; // getPartCollisionBvh erodes meshes inward by this much
const measurementCache = new Map(); // partId -> { surfaces, pinEnds, depths }

/**
 * Mesh measurements of a catalog part for the shared fit rules in src/utils/pinHoleAlignment.js:
 * opening faces (`surfaces`), which pin ends stick out (`pinEnds`) and real opening depths
 * (`depths`), measured on the engine's eroded collision mesh (distances are corrected for the
 * erosion). Cached per part id.
 */
export function getPartMeasurements(part) {
  if (measurementCache.has(part.id)) return measurementCache.get(part.id);
  const { colGeo } = getPartCollisionBvh(part);
  const ray = new THREE.Ray();
  const firstHit = (o, d) => {
    ray.origin.set(o[0], o[1], o[2]);
    ray.direction.set(d[0], d[1], d[2]);
    return colGeo.boundsTree.raycastFirst(ray, THREE.DoubleSide);
  };
  const raycast = (o, d) => {
    const hit = firstHit(o, d);
    return hit ? Math.max(0, hit.distance - COLLISION_EROSION_MM) : null;
  };
  const surfaces = measureOpeningSurfaces(part, raycast);
  const measured = {
    surfaces,
    pinEnds: measurePinEnds(part, (o, d) => {
      const hit = firstHit(o, d);
      return hit ? { distance: hit.distance, normal: hit.face.normal.toArray() } : null;
    }),
    depths: measureOpeningDepths(part, raycast, surfaces),
    // Hole and shaft widths come from the real mesh: shrinking leaves a 0.8 mm cap a sliver
    passRadii: measureOpeningPassRadii(part, rawRaycast(part)),
    profiles: measureShaftProfiles(part, rawRaycast(part))
  };
  measurementCache.set(part.id, measured);
  return measured;
}

/** World pins/shafts/openings of a placed instance, with measured faces, pin ends and depths. */
export function worldFeaturesFor(instance) {
  const part = getCatalog().catalogById.get(instance.partId);
  if (!part) return [];
  return collectWorldFeatures(
    part,
    buildWorldMatrix(instance.position, instance.rotation),
    instance.instanceId,
    getPartMeasurements(part)
  );
}

const round2 = (n) => Number(n.toFixed(2)) + 0;

/**
 * A part's connection points in its own frame, with measured depths: openings (pin holes, shaft
 * bores, the motor socket, collar holes) with their open span and depth, and pins/pegs/shafts
 * with their span and which ends stick out of the part. Span values are t = dot(point, axis).
 */
export function describePartConnections(part) {
  const identity = new THREE.Matrix4();
  const features = collectWorldFeatures(part, identity, part.id, getPartMeasurements(part));
  const portById = new Map((part.ports || []).map((p) => [p.portId, p]));
  return features.map((f) => {
    const axis = f.axis.toArray().map(round2);
    const lo = f.start.dot(f.axis);
    const hi = f.end.dot(f.axis);
    // The indexed point (a split opening's `@lo` / `@hi` half belongs to its port)
    const port = portById.get(f.featureId.replace(/@(lo|hi)$/, ''));
    const entry = {
      port: f.featureId,
      ...(port?.aliases?.length ? { aliases: port.aliases } : {}),
      kind: f.kind,
      ...(port?.shape ? { shape: port.shape } : {}),
      ...(port?.faces ? { faces: port.faces } : {}),
      origin: f.origin.toArray().map(round2),
      axis,
      span: [round2(Math.min(lo, hi)), round2(Math.max(lo, hi))]
    };
    if (port?.type === 'shaft') {
      entry.ends = port.ends;
      if (port.stop) entry.stop = port.stop;
    }
    if (f.kind === 'pin') {
      const atLo = lo <= hi ? f.freeAtStart : f.freeAtEnd;
      const atHi = lo <= hi ? f.freeAtEnd : f.freeAtStart;
      entry.sticksOut = atLo && atHi ? 'both' : atHi ? 'hi' : atLo ? 'lo' : 'none';
    } else if (f.kind !== 'shaft') {
      entry.depthMm = round2(Math.abs(hi - lo));
      entry.through = Boolean(f.through);
    }
    return entry;
  });
}

/**
 * Finds all coaxial, adjacent `pin_hole` pairs between two placed instances (`instA` and `instB`)
 * and computes the exact world position, rotation, and recommended connector pin (`1x1` or `1x2`).
 */
export function findMatchingPinHoles(instA, instB) {
  const portsA = getWorldPortsForInstance(instA).filter((p) => p.type === 'pin_hole');
  const portsB = getWorldPortsForInstance(instB).filter((p) => p.type === 'pin_hole');
  const matches = [];

  for (const pa of portsA) {
    const axA = new THREE.Vector3(...pa.worldAxis);
    const origA = new THREE.Vector3(...pa.worldOrigin);

    for (const pb of portsB) {
      const axB = new THREE.Vector3(...pb.worldAxis);
      if (Math.abs(axA.dot(axB)) < 0.99) continue; // Axes must be parallel

      const diff = new THREE.Vector3().subVectors( new THREE.Vector3(...pb.worldOrigin), origA );
      const axialDist = diff.dot(axA);
      const perpVec = diff.clone().addScaledVector(axA, -axialDist);
      const perpDist = perpVec.length();

      if (perpDist > 0.65) continue; // Holes must be coaxial within 0.65mm
      const absAxial = Math.abs(axialDist);
      if (absAxial < 1.5 || absAxial > 14.5) continue; // Adjacent 0.5P..1.0P beam/flange layers

      // Compute pin shoulder position (midpoint between hole centers for through-holes, or entry interface)
      const midPoint = origA.clone().addScaledVector(axA, axialDist * 0.5);

      // Compute Euler XYZ rotation that aligns pin's local +Z [0,0,1] with axA
      let rot = [0, 0, 0];
      if (Math.abs(axA.y) > 0.99) rot = [90, 0, 0];
      else if (Math.abs(axA.x) > 0.99) rot = [0, 90, 0];

      matches.push({
        portIdA: pa.portId,
        portIdB: pb.portId,
        worldPosition: [
          Number(midPoint.x.toFixed(3)),
          Number(midPoint.y.toFixed(3)),
          Number(midPoint.z.toFixed(3))
        ],
        worldRotation: rot,
        axialDistanceMm: Number(absAxial.toFixed(2)),
        recommendedPinPartNumber: absAxial > 7.5 ? '228-2500-061' : '228-2500-060'
      });
    }
  }

  return matches;
}

/**
 * Audits the entire assembly across 6 mechanical & kinematic dimensions:
 * 1) Solid mesh intersections (`collisions`)
 * 2) Floating and half-seated fasteners (`floatingFasteners`, `halfSeatedFasteners`)
 * 3) Unsecured parts & Single-Pin Pivot warnings (`unsecuredParts`, `singlePinPivotParts`, `underSecuredHeavyParts`)
 * 4) Full Mechanical Connectivity Graph & Disconnected Island detection (`connectedComponentCount`, `disconnectedIslands`)
 * 5) Shaft Protrusion / Overhang check (`protrudingShafts`)
 * 6) Kinematic Drivetrain Power Tracing from Smart Motors -> Shafts -> Meshing Gears -> Wheels (`kinematics`)
 *
 * Parts count as joined only through seated joints: a pin, peg or shaft inside a matching opening
 * (the shared fit rules in src/utils/pinHoleAlignment.js, on measured hole depths), never through
 * bounding boxes that merely overlap. `joints` lists what every fastener is seated in.
 */
/**
 * The joints between parts, shared by the audit and jointGraph: every visible part's world box and
 * features, which fasteners are seated in which parts, and the part-to-part joins (pegs, battery bay,
 * meshing gears, captive clamps). Parts count as joined only through seated joints.
 */
function findJoints(state) {
  const { catalogById } = getCatalog();
  const visible = (state.instances || []).filter((i) => i.visible !== false);

  const rawWorldBoxes = new Map();
  const expandedWorldBoxes = new Map();
  const nonFasteners = [];
  const fasteners = [];
  const featuresById = new Map();

  for (const inst of visible) {
    const part = catalogById.get(inst.partId);
    if (!part) continue;

    const mat = buildWorldMatrix(inst.position, inst.rotation);
    const rawBox = new THREE.Box3(
      new THREE.Vector3(...part.bbox.min),
      new THREE.Vector3(...part.bbox.max)
    ).applyMatrix4(mat);
    rawWorldBoxes.set(inst.instanceId, rawBox);

    // Expand box slightly (0.6mm) so flush surface-mounted parts register for the clamp rule below
    expandedWorldBoxes.set(inst.instanceId, rawBox.clone().expandByScalar(0.6));
    featuresById.set(inst.instanceId, worldFeaturesFor(inst));

    if (isFastenerPart(part, featuresById.get(inst.instanceId))) {
      fasteners.push({ inst, part, mat });
    } else {
      nonFasteners.push({ inst, part, mat });
    }
  }

  const fastenerById = new Map(fasteners.map((f) => [f.inst.instanceId, f]));
  const labelOf = (id) => visible.find((i) => i.instanceId === id)?.label || id;

  // Seated joints between every pair of parts whose boxes touch
  const seatedPairs = []; // { insertOwner, openingOwner, insert, opening, overlapMm }
  for (let i = 0; i < visible.length; i++) {
    const a = visible[i];
    const boxA = rawWorldBoxes.get(a.instanceId);
    if (!boxA) continue;
    for (let j = i + 1; j < visible.length; j++) {
      const b = visible[j];
      const boxB = rawWorldBoxes.get(b.instanceId);
      if (!boxB || !boxA.clone().expandByScalar(1).intersectsBox(boxB)) continue;
      for (const pair of findSeatedPairs(featuresById.get(a.instanceId), featuresById.get(b.instanceId))) {
        seatedPairs.push({
          insertOwner: pair.insert.instanceId,
          openingOwner: pair.opening.instanceId,
          insert: pair.insert,
          opening: pair.opening,
          overlapMm: pair.overlapMm
        });
      }
    }
  }

  // What each fastener is seated in; integral pegs (e.g. corner connector pegs) join parts directly
  const seatedIn = new Map(fasteners.map((f) => [f.inst.instanceId, new Map()])); // fastener -> partId -> [ports]
  const directJoints = []; // [holderId, otherId] from integral pegs and parts held on parts
  for (const p of seatedPairs) {
    const insertIsFastener = fastenerById.has(p.insertOwner);
    const openingIsFastener = fastenerById.has(p.openingOwner);
    if (insertIsFastener && !openingIsFastener) {
      const ports = seatedIn.get(p.insertOwner);
      if (!ports.has(p.openingOwner)) ports.set(p.openingOwner, []);
      ports.get(p.openingOwner).push(p.opening.featureId);
    } else if (!insertIsFastener && !openingIsFastener) {
      directJoints.push([p.insertOwner, p.openingOwner]);
    }
  }

  const fastenerCountByPartInstance = new Map(nonFasteners.map((n) => [n.inst.instanceId, 0]));
  const floatingFasteners = [];
  const halfSeatedFasteners = [];
  const joints = [];
  const adjacency = new Map(nonFasteners.map((n) => [n.inst.instanceId, new Set()]));
  // Part-to-part joins with nothing between them (pegs, battery bay, meshing gears, clamps); the graph
  // keeps these as edges, while joins through a fastener go through the fastener's own node
  const directEdges = [];
  const link = (idA, idB, direct = true) => {
    adjacency.get(idA)?.add(idB);
    adjacency.get(idB)?.add(idA);
    if (direct) directEdges.push([idA, idB]);
  };

  // The holes a fastener nearly sits in (a little off their line or tilted), outside the parts it is
  // already seated in: [{ instanceId, part, port, lineMm, angleDeg }], nearest first
  const nearMissesFor = (fastener, alreadyIn) => {
    const mine = featuresById.get(fastener.inst.instanceId);
    const boxF = rawWorldBoxes.get(fastener.inst.instanceId).clone().expandByScalar(5);
    const out = [];
    for (const n of nonFasteners) {
      if (alreadyIn.has(n.inst.instanceId) || !boxF.intersectsBox(rawWorldBoxes.get(n.inst.instanceId))) continue;
      for (const m of findNearSeatedPairs(mine, featuresById.get(n.inst.instanceId), { maxLineMm: 4.5, maxAngleDeg: 20, maxGapMm: 4 })) {
        out.push({
          instanceId: n.inst.instanceId,
          part: n.inst.label,
          port: m.opening.featureId,
          lineMm: Number(m.lineMm.toFixed(2)),
          angleDeg: Number(m.angleDeg.toFixed(1))
        });
      }
    }
    return out.sort((a, b) => a.lineMm + a.angleDeg * 0.2 - (b.lineMm + b.angleDeg * 0.2));
  };

  for (const f of fasteners) {
    const ports = seatedIn.get(f.inst.instanceId);
    const partners = [...ports.keys()];
    const seatedList = partners.map((id) => ({ part: labelOf(id), instanceId: id, ports: ports.get(id) }));
    joints.push({ instanceId: f.inst.instanceId, label: f.inst.label, seatedIn: seatedList });
    if (partners.length <= 1) {
      // Holes this fastener nearly sits in (a little off their line), so the report can say which and by how much
      const nearMiss = nearMissesFor(f, new Set(partners));
      if (partners.length === 0) {
        floatingFasteners.push({ instanceId: f.inst.instanceId, label: f.inst.label, engagedWith: [], nearMiss });
      } else {
        halfSeatedFasteners.push({ instanceId: f.inst.instanceId, label: f.inst.label, seatedIn: seatedList, nearMiss });
      }
    } else {
      for (let i = 0; i < partners.length; i++) {
        fastenerCountByPartInstance.set(partners[i], (fastenerCountByPartInstance.get(partners[i]) || 0) + 1);
        for (let j = i + 1; j < partners.length; j++) link(partners[i], partners[j], false);
      }
    }
  }
  const pegJointsByKey = new Map(); // "holder|other" -> { part, joinedTo, pegs }
  for (const [idA, idB] of directJoints) {
    fastenerCountByPartInstance.set(idA, (fastenerCountByPartInstance.get(idA) || 0) + 1);
    fastenerCountByPartInstance.set(idB, (fastenerCountByPartInstance.get(idB) || 0) + 1);
    link(idA, idB);
    const key = `${idA}|${idB}`;
    if (!pegJointsByKey.has(key)) pegJointsByKey.set(key, { part: labelOf(idA), joinedTo: labelOf(idB), pegs: 0 });
    pegJointsByKey.get(key).pegs += 1;
  }
  const pegJoints = [...pegJointsByKey.values()];

  // A battery in its brain's bay is held by the bay's latch: joined to the brain and fully mounted
  const batteryBays = [];
  for (const battery of nonFasteners) {
    for (const brain of nonFasteners) {
      if (!seatedBatteryBay(battery.part, battery.mat, brain.part, brain.mat)) continue;
      link(battery.inst.instanceId, brain.inst.instanceId);
      const required = battery.part.mountingRules?.minFastenersRequired || 1;
      fastenerCountByPartInstance.set(battery.inst.instanceId, Math.max(fastenerCountByPartInstance.get(battery.inst.instanceId) || 0, required));
      batteryBays.push({ battery: battery.inst.label, brain: brain.inst.label, batteryId: battery.inst.instanceId, brainId: brain.inst.instanceId });
    }
  }

  // Chain and track (openspec chain-track-builder): links join their neighbours and the sprockets
  // they sit on, grippers the tread links they plug into. A chain held by a sprocket with no bend
  // away from one counts as mounted; one left bending in mid-air (a sprocket moved) does not.
  const chainBends = [];
  const chainJoins = []; // [a, b]: links that are neighbours, or a gripper and its link
  const chainParts = nonFasteners.filter((n) => isChainPart(n.part));
  if (chainParts.length) {
    const sprockets = nonFasteners.filter((n) => n.part.gearSpecs?.gearType === 'sprocket');
    const standoffs = fasteners.filter((f) => f.part.fastenerSpecs?.fastenerType === 'standoff');
    const parent = new Map(chainParts.map((c) => [c.inst.instanceId, c.inst.instanceId]));
    const find = (id) => (parent.get(id) === id ? id : find(parent.get(id)));
    const join = (a, b) => parent.set(find(a), find(b));
    const held = new Set();
    for (let i = 0; i < chainParts.length; i++) {
      const a = chainParts[i];
      for (let j = i + 1; j < chainParts.length; j++) {
        const b = chainParts[j];
        if (!rawWorldBoxes.get(a.inst.instanceId).intersectsBox(rawWorldBoxes.get(b.inst.instanceId))) continue;
        if (
          areChainNeighbours(a.part, a.mat, b.part, b.mat) ||
          isGripperOnLink(a.part, a.mat, b.part, b.mat) ||
          isGripperOnLink(b.part, b.mat, a.part, a.mat)
        ) {
          link(a.inst.instanceId, b.inst.instanceId);
          join(a.inst.instanceId, b.inst.instanceId);
          chainJoins.push([a.inst.instanceId, b.inst.instanceId]);
        }
      }
      for (const s of sprockets) {
        if (!isLinkOnSprocket(a.part, a.mat, s.part, s.mat)) continue;
        link(a.inst.instanceId, s.inst.instanceId);
        held.add(a.inst.instanceId);
      }
    }
    const loose = unsupportedBends(
      chainParts.filter((c) => isLink(c.part)).map((c) => ({ id: c.inst.instanceId, part: c.part, matrix: c.mat })),
      [...sprockets, ...standoffs].map((s) => ({ part: s.part, matrix: s.mat }))
    );
    const heldRoots = new Set([...held].map(find));
    const looseRoots = new Set([...loose].map(find));
    for (const c of chainParts) {
      const root = find(c.inst.instanceId);
      if (!heldRoots.has(root) || looseRoots.has(root)) continue;
      const required = c.part.mountingRules?.minFastenersRequired || 1;
      fastenerCountByPartInstance.set(c.inst.instanceId, Math.max(fastenerCountByPartInstance.get(c.inst.instanceId) || 0, required));
    }
    for (const root of looseRoots) {
      const ids = chainParts.filter((c) => find(c.inst.instanceId) === root && loose.has(c.inst.instanceId)).map((c) => c.inst.instanceId);
      chainBends.push({ linkIds: ids, links: ids.map(labelOf) });
    }
  }

  // Kinematic Gear-Meshing & Motor-to-Wheel Power Tracing
  const placedGears = nonFasteners
    .filter((nf) => nf.part.gearSpecs != null)
    .map((nf) => {
      const ports = getWorldPortsForInstance(nf.inst);
      const bore = ports.find((p) => p.type === 'shaft_bore') || ports[0];
      const worldCenter = new THREE.Vector3(...nf.part.bbox.center).applyMatrix4(nf.mat);
      const worldAxis = bore
        ? new THREE.Vector3(...bore.worldAxis).normalize()
        : new THREE.Vector3(0, 0, 1);
      return {
        ...nf,
        worldCenter,
        worldAxis,
        teeth: nf.part.gearSpecs.teeth,
        pitchRadiusMm: nf.part.gearSpecs.pitchRadiusMm
      };
    });

  // Add gear-to-gear mesh edges to both kinematic graph and structural connectivity graph
  const meshedGearPairs = [];
  for (let i = 0; i < placedGears.length; i++) {
    for (let j = i + 1; j < placedGears.length; j++) {
      const gA = placedGears[i];
      const gB = placedGears[j];
      if (Math.abs(gA.worldAxis.dot(gB.worldAxis)) < 0.98) continue;

      const diff = new THREE.Vector3().subVectors(gB.worldCenter, gA.worldCenter);
      const axialOffset = Math.abs(diff.dot(gA.worldAxis));
      if (axialOffset > 6.5) continue;

      const radialVec = diff.clone().addScaledVector(gA.worldAxis, -diff.dot(gA.worldAxis));
      const radialDist = radialVec.length();
      const expectedDist = gA.pitchRadiusMm + gB.pitchRadiusMm;

      if (Math.abs(radialDist - expectedDist) <= 2.0) {
        meshedGearPairs.push([gA, gB]);
        link(gA.inst.instanceId, gB.inst.instanceId);
      }
    }
  }

  // Detect captive structural clamps (where two fastener-connected beams clamp opposing top/bottom faces of a third part)
  for (const nfTarget of nonFasteners) {
    const tBox = expandedWorldBoxes.get(nfTarget.inst.instanceId);
    if (!tBox) continue;
    const touchingNeighbors = nonFasteners.filter((other) => {
      if (other.inst.instanceId === nfTarget.inst.instanceId) return false;
      const oBox = expandedWorldBoxes.get(other.inst.instanceId);
      return oBox && tBox.intersectsBox(oBox);
    });
    for (let i = 0; i < touchingNeighbors.length; i++) {
      for (let j = i + 1; j < touchingNeighbors.length; j++) {
        const a = touchingNeighbors[i].inst.instanceId;
        const b = touchingNeighbors[j].inst.instanceId;
        // If `a` and `b` are already fastened to each other and both flush-contact `nfTarget`, they form a captive clamp around `nfTarget`
        if (adjacency.get(a)?.has(b)) {
          link(a, nfTarget.inst.instanceId);
          link(b, nfTarget.inst.instanceId);
        }
      }
    }
  }

  return {
    visible,
    rawWorldBoxes,
    nonFasteners,
    fasteners,
    featuresById,
    labelOf,
    seatedPairs,
    seatedIn,
    fastenerCountByPartInstance,
    floatingFasteners,
    halfSeatedFasteners,
    joints,
    adjacency,
    directEdges,
    directJoints,
    pegJoints,
    batteryBays,
    chainBends,
    chainJoins,
    placedGears,
    meshedGearPairs
  };
}

/** The graph from findJoints: every visible part a node, an edge from each fastener to each part it is seated in, plus the direct joins. */
function graphFromJoints(found, { pinnedOnly = false } = {}) {
  const edges = [];
  for (const [fastenerId, ports] of found.seatedIn) for (const partId of ports.keys()) edges.push([fastenerId, partId]);
  const seen = new Set();
  // Pinned only: a pin, shaft or peg in a hole; no gear meshes, battery bays or parts that only touch
  for (const [a, b] of pinnedOnly ? found.directJoints : found.directEdges) {
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (a === b || seen.has(key)) continue;
    seen.add(key);
    edges.push([a, b]);
  }
  return { nodes: found.visible.map((i) => i.instanceId), edges };
}

/**
 * The assembly's joint graph (openspec outliner-part-groups): `{ nodes: [instanceId], edges: [[a, b]] }`.
 * Fasteners are nodes of their own, so walking it steps beam -> pin -> plate. The audit's connected
 * parts come from the same graph, so Select Connected and the audit can't disagree. With
 * `pinnedOnly`, the only edges are pins, shafts and integral pegs seated in holes (Shift+Ctrl+wheel).
 */
export function jointGraph(state, { pinnedOnly = false } = {}) {
  return graphFromJoints(findJoints(state), { pinnedOnly });
}

const SHAFT_TYPES = new Set(['straight_shaft', 'capped_shaft', 'motor_shaft']);
const PIN_TYPES = new Set(['connector_pin', 'standoff']);

/**
 * Which way a seated shaft can't slide out of its opening (openspec explode-view): moving the insert
 * along +axis sweeps every section below the opening's top through it, and along -axis every section
 * above its bottom. A section too wide for the opening (a motor shaft's stop ring) blocks that way.
 */
function tooWideBlocks(insert, opening) {
  if (!insert.profile || !Number.isFinite(opening.passRadius)) return null;
  const v = new THREE.Vector3().subVectors(opening.origin, insert.origin);
  const along = v.dot(insert.axis);
  const lateral = Math.sqrt(Math.max(0, v.lengthSq() - along * along));
  const ta = new THREE.Vector3().subVectors(opening.start, insert.origin).dot(insert.axis);
  const tb = new THREE.Vector3().subVectors(opening.end, insert.origin).dot(insert.axis);
  const [oMin, oMax] = ta <= tb ? [ta, tb] : [tb, ta];
  const wide = (s) => s.r + lateral > opening.passRadius + 0.05;
  const plus = insert.profile.some((s) => s.t < oMax - 0.1 && wide(s));
  const minus = insert.profile.some((s) => s.t > oMin + 0.1 && wide(s));
  return plus || minus ? { plus, minus } : null;
}

/** Collision meshes of a placed part in its own frame: [{ geo, local }] (a turned motor hub has a local matrix). */
export function collisionPiecesFor(instance) {
  const part = getCatalog().catalogById.get(instance.partId);
  if (!part) return [];
  return posedPieces(getPartCollisionBvh(part), instance).map((p) => ({ geo: p.geo, local: p.local || null }));
}

/**
 * What the explode plan (src/utils/explodePlan.js) needs from the build: every visible part with its
 * kind and world box, the seated pairs with their axes, how deep each pin sits in each part, the
 * direct joins, battery bays and the ways a shaft's stop ring can't go. Plain data, except `parts[].matrix`.
 */
export function explodeInputs(state) {
  const { catalogById } = getCatalog();
  const found = findJoints(state);
  const parts = [];
  for (const inst of found.visible) {
    const part = catalogById.get(inst.partId);
    const box = found.rawWorldBoxes.get(inst.instanceId);
    if (!part || !box) continue;
    const type = part.fastenerSpecs?.fastenerType;
    const isFastener = found.fasteners.some((f) => f.inst.instanceId === inst.instanceId);
    const kind = COLLAR_NAME_PATTERN.test(part.name || '')
      ? 'part'
      : SHAFT_TYPES.has(type)
        ? 'shaft'
        : PIN_TYPES.has(type) || isFastener
          ? 'pin'
          : 'part';
    parts.push({
      id: inst.instanceId,
      partId: inst.partId,
      name: part.name,
      label: inst.label || part.name,
      partNumber: part.partNumber,
      kind,
      groupId: inst.groupId || null,
      position: inst.position,
      rotation: inst.rotation,
      matrix: buildWorldMatrix(inst.position, inst.rotation),
      box: { min: box.min.toArray(), max: box.max.toArray() }
    });
  }
  const pairs = found.seatedPairs.map((p) => ({
    insertOwner: p.insertOwner,
    openingOwner: p.openingOwner,
    axis: p.insert.axis.toArray(),
    depthMm: Math.max(0, p.overlapMm ?? 0),
    blocks: tooWideBlocks(p.insert, p.opening)
  }));
  // Battery bays, meshing gears and clamps join parts without an axis
  const direct = found.directEdges.map(([a, b]) => [a, b]);
  const bays = found.batteryBays.map((b) => ({ battery: b.batteryId, brain: b.brainId }));
  const tires = [];
  for (const a of found.nonFasteners) {
    for (const b of found.nonFasteners) {
      if (a !== b && isTireOnHub(a.part, a.mat, b.part, b.mat) && /tire/i.test(a.part.name)) tires.push([a.inst.instanceId, b.inst.instanceId]);
    }
  }
  // A chain or track comes off in one piece
  const chains = found.chainJoins;
  return { parts, pairs, direct, bays, tires, chains };
}

/** The explode plan for a build and direction choice ('x' | 'y' | 'z' | 'all'), from the collision meshes. */
/** What an explode plan depends on: the visible parts' places, groups and socket turns, and the direction. */
export const explodeKey = (instances, mode) =>
  `${mode}|${JSON.stringify(
    (instances || [])
      .filter((i) => i.visible !== false)
      .map((i) => [i.instanceId, i.partId, i.position, i.rotation, i.groupId || null, i.socketAngleDeg || 0])
  )}`;

export function explodePlanFor(state, mode = 'all', options = {}) {
  const input = explodeInputs(state);
  const byId = new Map((state.instances || []).map((i) => [i.instanceId, i]));
  for (const p of input.parts) p.meshes = collisionPiecesFor(byId.get(p.id));
  // The shrunk meshes miss a shaft section inside a hole too narrow for it (as the audit does)
  const features = new Map();
  const featuresAt = (id, o) => {
    if (!features.has(id)) features.set(id, worldFeaturesFor(byId.get(id)));
    const shift = new THREE.Vector3(...o);
    return features.get(id).map((f) => ({ ...f, origin: f.origin.clone().add(shift), start: f.start.clone().add(shift), end: f.end.clone().add(shift) }));
  };
  input.tooWide = (a, b, oa, ob) => findTooWideInserts(featuresAt(a, oa), featuresAt(b, ob)).length > 0;
  return buildExplodePlan(input, mode, options);
}

export function auditAssembly(state) {
  const found = findJoints(state);
  const {
    visible,
    rawWorldBoxes,
    nonFasteners,
    fasteners,
    featuresById,
    seatedPairs,
    seatedIn,
    fastenerCountByPartInstance,
    floatingFasteners,
    halfSeatedFasteners,
    joints,
    pegJoints,
    batteryBays,
    chainBends,
    placedGears,
    meshedGearPairs
  } = found;

  const collisions = [];
  const tightFits = []; // one entry per pair: contacts within TIGHT_FIT_MM, not overlaps
  for (const inst of visible) {
    const col = checkCandidateCollision(inst, visible);
    if (col.isIntersecting) {
      collisions.push({
        instanceId: inst.instanceId,
        label: inst.label,
        collidingWith: col.collidingWith.map((c) => c.label)
      });
    }
    for (const t of col.tightFits) {
      if (inst.instanceId < t.instanceId || !visible.some((v) => v.instanceId === t.instanceId)) {
        tightFits.push({ instanceId: inst.instanceId, label: inst.label, withInstanceId: t.instanceId, withLabel: t.label });
      }
    }
  }

  // Detect unsecured parts, under-secured heavy parts, and single-pin pivot structural parts
  const unsecuredParts = [];
  const underSecuredHeavyParts = [];
  const singlePinPivotParts = [];

  for (const nf of nonFasteners) {
    const count = fastenerCountByPartInstance.get(nf.inst.instanceId) || 0;
    const minReq = nf.part.mountingRules?.minFastenersRequired || 1;
    const isRotatingComponent =
      nf.part.gearSpecs != null ||
      nf.part.category === 'Wheels & Treads' ||
      nf.part.category === 'Shafts, Spacers & Collars';

    if (count === 0) {
      unsecuredParts.push({
        instanceId: nf.inst.instanceId,
        label: nf.inst.label,
        partNumber: nf.part.partNumber
      });
    } else if (nf.part.mountingRules?.massClass === 'heavy' && count < minReq) {
      underSecuredHeavyParts.push({
        instanceId: nf.inst.instanceId,
        label: nf.inst.label,
        fastenerCount: count,
        minFastenersRequired: minReq
      });
    } else if (!isRotatingComponent && count === 1 && nonFasteners.length > 2) {
      singlePinPivotParts.push({
        instanceId: nf.inst.instanceId,
        label: nf.inst.label,
        fastenerCount: 1,
        warning: 'Structural/electronic part is held by only 1 fastener and can pivot freely.'
      });
    }
  }

  // Shaft Protrusion / Overhang beyond the outer faces of the parts it is seated in (collars included)
  const boxCorners = (box) => {
    const out = [];
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
      }
    }
    return out;
  };
  const protrudingShafts = [];
  for (const f of fasteners) {
    const shaftFeature = featuresById.get(f.inst.instanceId).find((x) => x.kind === 'shaft');
    if (!shaftFeature) continue;
    const partners = new Set(
      seatedPairs.filter((p) => p.insertOwner === f.inst.instanceId && p.insert === shaftFeature).map((p) => p.openingOwner)
    );
    if (partners.size === 0) continue;

    const axis = shaftFeature.axis;
    const shaftT = [shaftFeature.start.dot(axis), shaftFeature.end.dot(axis)];
    const openingT = [...partners].flatMap((id) => boxCorners(rawWorldBoxes.get(id)).map((c) => c.dot(axis)));
    const negOverhangMm = Number(Math.max(0, Math.min(...openingT) - Math.min(...shaftT)).toFixed(2));
    const posOverhangMm = Number(Math.max(0, Math.max(...shaftT) - Math.max(...openingT)).toFixed(2));
    // Allow up to 4.5mm for flush Capped Shaft caps (3.18mm) or Motor Shaft collars
    if (negOverhangMm > 4.5 || posOverhangMm > 4.5) {
      protrudingShafts.push({
        instanceId: f.inst.instanceId,
        label: f.inst.label,
        negOverhangMm,
        posOverhangMm,
        maxAllowedFlushCapMm: 4.5
      });
    }
  }

  // Connected parts: walk the joint graph through fasteners, then list the non-fasteners of each piece
  const graph = graphFromJoints(found);
  const neighbours = new Map(graph.nodes.map((id) => [id, []]));
  for (const [a, b] of graph.edges) {
    neighbours.get(a)?.push(b);
    neighbours.get(b)?.push(a);
  }
  const nonFastenerById = new Map(nonFasteners.map((n) => [n.inst.instanceId, n]));
  const visited = new Set();
  const components = [];
  for (const nf of nonFasteners) {
    const startId = nf.inst.instanceId;
    if (visited.has(startId)) continue;
    const comp = [];
    const queue = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const curr = queue.shift();
      const item = nonFastenerById.get(curr);
      if (item) comp.push({ instanceId: curr, label: item.inst.label });
      for (const nxt of neighbours.get(curr) || []) {
        if (!visited.has(nxt)) {
          visited.add(nxt);
          queue.push(nxt);
        }
      }
    }
    components.push(comp);
  }
  components.sort((a, b) => b.length - a.length);
  const disconnectedIslands = components.length > 1 ? components.slice(1) : [];

  // Trace rotational power from each Smart Motor -> Shafts -> Gears -> Wheels
  const motors = nonFasteners.filter(
    (nf) =>
      nf.part.partNumber === '228-2560' || nf.part.name.toLowerCase().includes('smart motor')
  );
  const wheels = nonFasteners.filter(
    (nf) =>
      nf.part.category === 'Wheels & Treads' || nf.part.name.toLowerCase().includes('wheel')
  );
  const shaftFasteners = fasteners.filter((f) => featuresById.get(f.inst.instanceId).some((x) => x.kind === 'shaft'));

  // A part is on a shaft when the shaft is seated in one of its openings
  const shaftToCoaxialParts = new Map();
  const partToCoaxialShafts = new Map();
  for (const sf of shaftFasteners) {
    const coaxialList = [...(seatedIn.get(sf.inst.instanceId)?.keys() || [])]
      .map((id) => nonFastenerById.get(id))
      .filter(Boolean);
    for (const ep of coaxialList) {
      if (!partToCoaxialShafts.has(ep.inst.instanceId)) partToCoaxialShafts.set(ep.inst.instanceId, []);
      partToCoaxialShafts.get(ep.inst.instanceId).push(sf);
    }
    shaftToCoaxialParts.set(sf.inst.instanceId, coaxialList);
  }

  const allDrivenWheelIds = new Set();
  const motorDriveChains = [];

  for (const m of motors) {
    const startShafts = partToCoaxialShafts.get(m.inst.instanceId) || [];
    const visitedShafts = new Set();
    const visitedGears = new Set();
    const drivenWheelsForMotor = [];
    const gearSequence = [];
    const q = [];

    for (const s of startShafts) {
      visitedShafts.add(s.inst.instanceId);
      q.push({ type: 'shaft', obj: s, ratio: 1.0 });
    }

    while (q.length > 0) {
      const curr = q.shift();
      if (curr.type === 'shaft') {
        const coax = shaftToCoaxialParts.get(curr.obj.inst.instanceId) || [];
        for (const cp of coax) {
          if (wheels.some((w) => w.inst.instanceId === cp.inst.instanceId)) {
            allDrivenWheelIds.add(cp.inst.instanceId);
            if (!drivenWheelsForMotor.some((w) => w.instanceId === cp.inst.instanceId)) {
              drivenWheelsForMotor.push({
                instanceId: cp.inst.instanceId,
                label: cp.inst.label,
                driveRatio: Number(curr.ratio.toFixed(2))
              });
            }
          }
          const gObj = placedGears.find((g) => g.inst.instanceId === cp.inst.instanceId);
          if (gObj && !visitedGears.has(gObj.inst.instanceId)) {
            visitedGears.add(gObj.inst.instanceId);
            gearSequence.push(gObj.inst.label);
            q.push({ type: 'gear', obj: gObj, ratio: curr.ratio });
          }
        }
      } else if (curr.type === 'gear') {
        // Traverse to coaxial shafts of this gear
        const coaxShafts = partToCoaxialShafts.get(curr.obj.inst.instanceId) || [];
        for (const cs of coaxShafts) {
          if (!visitedShafts.has(cs.inst.instanceId)) {
            visitedShafts.add(cs.inst.instanceId);
            q.push({ type: 'shaft', obj: cs, ratio: curr.ratio });
          }
        }
        // Traverse to meshed gears
        for (const [gA, gB] of meshedGearPairs) {
          let nextGear = null;
          if (gA.inst.instanceId === curr.obj.inst.instanceId) nextGear = gB;
          else if (gB.inst.instanceId === curr.obj.inst.instanceId) nextGear = gA;
          if (nextGear && !visitedGears.has(nextGear.inst.instanceId)) {
            visitedGears.add(nextGear.inst.instanceId);
            gearSequence.push(nextGear.inst.label);
            const nextRatio = curr.ratio * (curr.obj.teeth / nextGear.teeth);
            q.push({ type: 'gear', obj: nextGear, ratio: nextRatio });
          }
        }
      }
    }

    motorDriveChains.push({
      motorInstanceId: m.inst.instanceId,
      motorLabel: m.inst.label,
      motorShafts: startShafts.map((s) => s.inst.label),
      gearsInChain: gearSequence,
      drivenWheels: drivenWheelsForMotor
    });
  }

  const unpoweredWheels = wheels
    .filter((w) => !allDrivenWheelIds.has(w.inst.instanceId))
    .map((w) => ({
      instanceId: w.inst.instanceId,
      label: w.inst.label
    }));

  return {
    totalInstances: visible.length,
    isMechanicallySound:
      collisions.length === 0 &&
      floatingFasteners.length === 0 &&
      halfSeatedFasteners.length === 0 &&
      unsecuredParts.length === 0 &&
      underSecuredHeavyParts.length === 0 &&
      disconnectedIslands.length === 0 &&
      protrudingShafts.length === 0,
    collisionCount: collisions.length,
    collisions,
    tightFitCount: tightFits.length,
    tightFits,
    floatingFastenerCount: floatingFasteners.length,
    floatingFasteners,
    halfSeatedFastenerCount: halfSeatedFasteners.length,
    halfSeatedFasteners,
    unsecuredPartCount: unsecuredParts.length,
    unsecuredParts,
    underSecuredHeavyPartCount: underSecuredHeavyParts.length,
    underSecuredHeavyParts,
    singlePinPivotCount: singlePinPivotParts.length,
    singlePinPivotParts,
    connectedComponentCount: components.length,
    disconnectedIslandCount: disconnectedIslands.length,
    disconnectedIslands,
    protrudingShaftCount: protrudingShafts.length,
    protrudingShafts,
    joints,
    pegJoints,
    batteryBays,
    // Chains or tracks that bend away from any sprocket: their links are counted unsecured
    chainBends,
    kinematics: {
      motorCount: motors.length,
      meshedGearPairCount: meshedGearPairs.length,
      totalWheelCount: wheels.length,
      drivenWheelCount: allDrivenWheelIds.size,
      unpoweredWheels,
      motorDriveChains
    }
  };
}

const FASTENER_TYPES = new Set(['connector_pin', 'standoff', 'straight_shaft', 'capped_shaft', 'motor_shaft']);

/**
 * Fasteners are the parts that join others: pins, standoffs and shafts (by their catalog fastener
 * type), plus pin parts with no fastener data that carry only pins. Rubber Shaft Collars are held
 * parts (rings on a shaft), even though the catalog tags them as shafts.
 */
function isFastenerPart(part, features) {
  if (COLLAR_NAME_PATTERN.test(part.name || '')) return false;
  if (FASTENER_TYPES.has(part.fastenerSpecs?.fastenerType)) return true;
  return (
    part.category === 'Pins & Standoffs' &&
    features.length > 0 &&
    features.every((f) => f.kind === 'pin' || f.kind === 'shaft')
  );
}

/**
 * Helper: Builds a clean cardinal-aligned rotation quaternion that maps local unit vector `localAxis`
 * to world unit vector `worldAxis`, then applies `rollDeg` around `worldAxis`.
 */
export function buildAxisAlignedQuaternion(localAxisArr, worldAxisArr, rollDeg = 0) {
  const aS = new THREE.Vector3(...localAxisArr).normalize();
  const aT = new THREE.Vector3(...worldAxisArr).normalize();

  const cardinalCandidates = [
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, 1)
  ];

  // Prefer a shared cardinal axis perpendicular to BOTH aS and aT so horizontal parts stay horizontal
  const sharedPerp = cardinalCandidates.find(
    (c) => Math.abs(c.dot(aS)) < 0.1 && Math.abs(c.dot(aT)) < 0.1
  );

  let uS;
  let uT;
  if (sharedPerp) {
    uS = sharedPerp.clone();
    uT = sharedPerp.clone();
  } else {
    uS = cardinalCandidates.find((c) => Math.abs(c.dot(aS)) < 0.9).clone();
    uS.addScaledVector(aS, -uS.dot(aS)).normalize();
    uT = cardinalCandidates.find((c) => Math.abs(c.dot(aT)) < 0.9).clone();
    uT.addScaledVector(aT, -uT.dot(aT)).normalize();
  }

  const vS = new THREE.Vector3().crossVectors(aS, uS).normalize();
  const vT = new THREE.Vector3().crossVectors(aT, uT).normalize();

  // Basis matrices: M_world * M_local^T maps (uS, vS, aS) -> (uT, vT, aT)
  const mLocal = new THREE.Matrix4().makeBasis(uS, vS, aS);
  const mWorld = new THREE.Matrix4().makeBasis(uT, vT, aT);
  const mAlign = new THREE.Matrix4().multiplyMatrices(mWorld, mLocal.clone().transpose());
  const qAlign = new THREE.Quaternion().setFromRotationMatrix(mAlign);

  if (rollDeg) {
    const qRoll = new THREE.Quaternion().setFromAxisAngle(
      aT,
      THREE.MathUtils.degToRad(Number(rollDeg) || 0)
    );
    qAlign.premultiply(qRoll);
  }

  return qAlign;
}

/**
 * Computes the 3D world position and Euler [rx, ry, rz] rotation that coaxially mates
 * `sourcePortId` on `sourcePart` to `targetPortId` on placed `targetInst`.
 */
export function computeMateTransform(
  sourcePart,
  sourcePortId,
  targetInst,
  targetPortId,
  options = {}
) {
  const targetPorts = getWorldPortsForInstance(targetInst);
  if (!targetPorts.length) {
    return { error: `Target instance "${targetInst.label}" has no indexed semantic ports.` };
  }

  let tPort = null;
  if (typeof targetPortId === 'number') {
    tPort = targetPorts[Math.min(Math.max(targetPortId, 0), targetPorts.length - 1)];
  } else if (typeof targetPortId === 'string' && targetPortId.trim()) {
    const targetPart = getCatalog().catalogById.get(targetInst.partId);
    const id = findPort(targetPart, targetPortId)?.portId;
    tPort = id && targetPorts.find((p) => p.portId === id);
    if (!tPort) return { error: unknownPortError(targetPart, targetInst.label, targetPortId) };
  }
  if (!tPort) {
    tPort = targetPorts.find((p) => p.type !== 'shaft') || targetPorts[0];
  }

  // A shaft's own axis point is for describing it, not a default to mate by
  const sPorts = (Array.isArray(sourcePart.ports) ? sourcePart.ports : []).filter((p) => p.type !== 'shaft');
  let sPort = null;
  if (typeof sourcePortId === 'string' && sourcePortId.trim()) {
    sPort = findPort(sourcePart, sourcePortId);
    if (!sPort) return { error: unknownPortError(sourcePart, sourcePart.name, sourcePortId) };
  } else if (typeof sourcePortId === 'number') {
    sPort = sPorts[Math.min(Math.max(sourcePortId, 0), sPorts.length - 1)];
  }

  // If no sourcePortId specified (or part is a shaft/pin withlocal Z axis), synthesize or pick best port
  if (!sPort) {
    sPort =
      sPorts.find((p) => p.type === 'shaft_bore' || p.type === 'shaft_socket') ||
      sPorts.find((p) => p.type === 'pin_peg') ||
      sPorts[0] || {
        portId: 'local_origin_z',
        type: 'pin_peg',
        origin: [0, 0, 0],
        axis: [0, 0, 1]
      };
  }

  const flipAxis = Boolean(options.flipAxis);
  const rollDeg = Number(options.rollDeg) || 0;
  const axialOffsetMm = Number(options.axialOffsetMm) || 0;

  const worldTargetOrigin = new THREE.Vector3(...tPort.worldOrigin);
  const worldTargetAxis = new THREE.Vector3(...tPort.worldAxis).normalize();
  const desiredWorldAxis = flipAxis
    ? worldTargetAxis.clone().negate()
    : worldTargetAxis.clone();

  const quat = buildAxisAlignedQuaternion(sPort.axis, desiredWorldAxis, rollDeg);
  const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
  const rotation = [
    Number(THREE.MathUtils.radToDeg(euler.x).toFixed(2)),
    Number(THREE.MathUtils.radToDeg(euler.y).toFixed(2)),
    Number(THREE.MathUtils.radToDeg(euler.z).toFixed(2))
  ];

  // Rotate source port's local origin into world space
  const rotatedSourcePortOrigin = new THREE.Vector3(...sPort.origin).applyQuaternion(quat);

  const worldPositionVec = worldTargetOrigin
    .clone()
    .addScaledVector(worldTargetAxis, axialOffsetMm)
    .sub(rotatedSourcePortOrigin);

  const position = [
    Number(worldPositionVec.x.toFixed(3)),
    Number(worldPositionVec.y.toFixed(3)),
    Number(worldPositionVec.z.toFixed(3))
  ];

  return {
    position,
    rotation,
    sourcePort: sPort,
    targetPort: tPort
  };
}

/**
 * Builds a meshed gear train along a supporting beam (`supportBeamId`) starting at `startPortId`.
 * Automatically calculates center-to-center pitch spacing `(N1 + N2)/24 * 12.7mm`,
 * finds the matching beam holes, alternates gear tooth phase (`phaseOffsetDeg`) to prevent
 * tooth clashes, and optionally inserts flush shafts through each gear.
 */
export function buildMeshedGearTrain(state, options = {}) {
  const {
    supportBeamId,
    outerSupportBeamId = null,
    startPortId = null,
    gears = [],
    shaftPartQuery = null,
    axialOffsetMm = null
  } = options;

  const beamInst = (state.instances || []).find((i) => i.instanceId === supportBeamId);
  if (!beamInst) {
    return { error: `Support beam instance "${supportBeamId}" not found in assembly.` };
  }

  const outerBeamInst = outerSupportBeamId
    ? (state.instances || []).find((i) => i.instanceId === outerSupportBeamId)
    : null;

  const beamPorts = getWorldPortsForInstance(beamInst).filter((p) => p.type === 'pin_hole');
  if (!beamPorts.length) {
    return { error: `Support beam "${beamInst.label}" has no indexed pin_hole ports.` };
  }

  // Pick start port
  let currentPort =
    (startPortId && beamPorts.find((p) => p.portId === findPort(getCatalog().catalogById.get(beamInst.partId), startPortId)?.portId)) || beamPorts[0];

  const holeAxis = new THREE.Vector3(...currentPort.worldAxis).normalize();

  // Compute gear plane axial offset along holeAxis
  let computedAxialOffset = axialOffsetMm !== null ? Number(axialOffsetMm) : 12.7;
  if (axialOffsetMm === null && outerBeamInst) {
    const diff = new THREE.Vector3(...outerBeamInst.position).sub(
      new THREE.Vector3(...beamInst.position)
    );
    computedAxialOffset = Number((diff.dot(holeAxis) * 0.5).toFixed(3));
  }

  const resolvedGears = [];
  for (const g of gears) {
    const query = typeof g === 'string' ? g : g.partQuery;
    const part = findPart(query);
    if (!part) {
      return { error: `Could not find gear part matching "${query}".` };
    }
    resolvedGears.push({
      part,
      spec: part.gearSpecs || { teeth: 36, pitchRadiusMm: 19.05, phaseOffsetDeg: 5 },
      customShaftQuery: typeof g === 'object' ? g.shaftQuery : null,
      label: typeof g === 'object' ? g.label : null
    });
  }

  // Determine stepping direction along beam ports from startPort
  const startOrigin = new THREE.Vector3(...currentPort.worldOrigin);
  const sameRowPorts = beamPorts.filter((p) => {
    const ax = new THREE.Vector3(...p.worldAxis);
    if (Math.abs(ax.dot(holeAxis)) < 0.99) return false;
    // Same Y or perpendicular height row within 1.0mm
    return Math.abs(p.worldOrigin[1] - currentPort.worldOrigin[1]) < 1.0;
  });

  // Direction vector pointing toward the majority of remaining holes in the same row
  let stepDir = new THREE.Vector3(1, 0, 0);
  if (sameRowPorts.length > 1) {
    const furthest = sameRowPorts.reduce((best, p) => {
      const d = new THREE.Vector3(...p.worldOrigin).distanceTo(startOrigin);
      return d > best.dist ? { port: p, dist: d } : best;
    }, { port: currentPort, dist: 0 });
    if (furthest.dist > 1) {
      stepDir = new THREE.Vector3(...furthest.port.worldOrigin).sub(startOrigin);
      stepDir.addScaledVector(holeAxis, -stepDir.dot(holeAxis)).normalize();
    }
  }
  if (options.reverseDirection) {
    stepDir.negate();
  }

  const placedGears = [];
  const placedShafts = [];
  const workingInstances = [...(state.instances || [])];
  let cumulativeDist = 0;

  for (let i = 0; i < resolvedGears.length; i++) {
    const { part: gearPart, spec, customShaftQuery, label } = resolvedGears[i];
    if (i > 0) {
      const prevSpec = resolvedGears[i - 1].spec;
      const centerStepMm = Number((prevSpec.pitchRadiusMm + spec.pitchRadiusMm).toFixed(3));
      cumulativeDist += centerStepMm;

      // Find hole on supportBeam matching startOrigin + cumulativeDist * stepDir
      const targetPos = startOrigin.clone().addScaledVector(stepDir, cumulativeDist);
      let bestPort = null;
      let bestDist = Infinity;
      for (const cand of sameRowPorts) {
        const d = new THREE.Vector3(...cand.worldOrigin).distanceTo(targetPos);
        if (d < bestDist) {
          bestDist = d;
          bestPort = cand;
        }
      }
      if (!bestPort || bestDist > 2.0) {
        return {
          error: `No matching pin_hole found on "${beamInst.label}" at distance ${cumulativeDist}mm for gear #${i + 1} (${gearPart.name}).`
        };
      }
      currentPort = bestPort;
    }

    // Each gear turns to its measured meshing turn against the previous gear (openspec gear-meshing)
    const mate = computeMateTransform(gearPart, null, beamInst, currentPort.portId, {
      axialOffsetMm: computedAxialOffset,
      rollDeg: 0
    });
    let chosenMate = { ...mate, rollDeg: 0 };
    const prevGear = placedGears[placedGears.length - 1]?.instance;
    const toothedOf = (inst) => worldToothed(getCatalog().catalogById.get(inst.partId), inst.position, inst.rotation, inst.instanceId);
    const meshed = prevGear ? meshTurn(worldToothed(gearPart, mate.position, mate.rotation), [toothedOf(prevGear)]) : null;
    if (meshed && Math.abs(meshed.turnDeg) >= 0.005) {
      chosenMate = {
        ...mate,
        rotation: quaternionToEulerDeg(turnQuaternion(mate.rotation, meshed.axis, meshed.turnDeg)),
        rollDeg: meshed.turnDeg
      };
    }
    const chosenCol = checkCandidateCollision(
      { instanceId: `inst-gear-${Date.now()}-${i}`, partId: gearPart.id, position: chosenMate.position, rotation: chosenMate.rotation, visible: true },
      workingInstances
    );

    const gearInst = {
      instanceId: `inst-${Date.now()}-gear-${i + 1}`,
      partId: gearPart.id,
      label: label || `${gearPart.name} #${i + 1}`,
      position: chosenMate.position,
      rotation: chosenMate.rotation,
      lastValidPosition: chosenMate.position,
      lastValidRotation: chosenMate.rotation,
      isIntersecting: chosenCol.isIntersecting,
      color: i % 2 === 0 ? '#dc2626' : '#2563eb',
      visible: true,
      locked: false
    };
    workingInstances.push(gearInst);
    placedGears.push({
      instance: gearInst,
      beamPortId: currentPort.portId,
      rollDeg: chosenMate.rollDeg,
      teeth: spec.teeth,
      pitchRadiusMm: spec.pitchRadiusMm,
      ...(prevGear ? { meshedWith: meshed ? prevGear.label : null } : {})
    });

    // Optional shaft insertion through this gear
    const shaftQ = customShaftQuery || shaftPartQuery;
    if (shaftQ) {
      const shaftPart = findPart(shaftQ);
      if (shaftPart) {
        // Align shaft with outer beam if present so cap sits flush outside outer beam
        const refBeam = outerBeamInst || beamInst;
        const refPorts = getWorldPortsForInstance(refBeam).filter((p) => p.type === 'pin_hole');
        const matchingRefPort =
          refPorts.find(
            (p) =>
              Math.abs(p.worldOrigin[0] - currentPort.worldOrigin[0]) < 0.8 &&
              Math.abs(p.worldOrigin[1] - currentPort.worldOrigin[1]) < 0.8
          ) || currentPort;

        const targetBeamForShaft = outerBeamInst && matchingRefPort !== currentPort ? outerBeamInst : beamInst;
        // Test flipAxis false vs true and +/-3.175mm cap offset for collision-free flush seating
        let bestShaftMate = null;
        for (const flip of [false, true]) {
          for (const offset of [-3.175, 3.175, 0]) {
            const sMate = computeMateTransform(
              shaftPart,
              null,
              targetBeamForShaft,
              matchingRefPort.portId,
              {
                flipAxis: flip,
                axialOffsetMm: offset,
                rollDeg: 0
              }
            );
            // A square shaft turns to fit the gear's square bore
            const shaftFeature = worldFeaturesFor({ instanceId: 'shaft', partId: shaftPart.id, ...sMate }).find((f) => f.kind === 'shaft');
            const gearBore = worldFeaturesFor(gearInst).find((f) => f.kind === 'shaft_bore');
            const fitDeg = squareFitRoll(shaftFeature, gearBore);
            if (fitDeg) Object.assign(sMate, turnAboutLine(sMate, shaftFeature.axis, shaftFeature.origin, fitDeg));
            const tempS = {
              instanceId: `inst-${Date.now()}-shaft-${i + 1}`,
              partId: shaftPart.id,
              position: sMate.position,
              rotation: sMate.rotation,
              visible: true
            };
            const sCol = checkCandidateCollision(tempS, workingInstances);
            if (!sCol.isIntersecting) {
              bestShaftMate = { ...sMate, isIntersecting: false };
              break;
            }
            if (!bestShaftMate) {
              bestShaftMate = { ...sMate, isIntersecting: sCol.isIntersecting };
            }
          }
          if (bestShaftMate && !bestShaftMate.isIntersecting) break;
        }

        if (bestShaftMate) {
          const shaftInst = {
            instanceId: `inst-${Date.now()}-shaft-${i + 1}`,
            partId: shaftPart.id,
            label: `${shaftPart.name} (Gear #${i + 1})`,
            position: bestShaftMate.position,
            rotation: bestShaftMate.rotation,
            lastValidPosition: bestShaftMate.position,
            lastValidRotation: bestShaftMate.rotation,
            isIntersecting: bestShaftMate.isIntersecting,
            color: shaftPart.defaultColor,
            visible: true,
            locked: false
          };
          workingInstances.push(shaftInst);
          placedShafts.push(shaftInst);
        }
      }
    }
  }

  return {
    ok: true,
    placedGears,
    placedShafts,
    workingInstances
  };
}

/**
 * Mirrors a set of placed instances across a symmetry plane ("X", "Y", or "Z") at `planeOffsetMm`.
 * Each part gets its mirror pose (mirrorPose: exact for parts with a symmetry plane, the closest
 * turned pose for left- or right-handed ones) and a label with Left/Right and L/R swapped.
 * Overlaps are checked against the parts already placed.
 */
export function mirrorSubassembly(state, options = {}) {
  const { catalogById } = getCatalog();
  const {
    instanceIds = [],
    mirrorPlane = 'Z',
    planeOffsetMm = 0
  } = options;

  const axisIdx = mirrorPlane.toUpperCase() === 'X' ? 0 : mirrorPlane.toUpperCase() === 'Y' ? 1 : 2;
  const sourceInstances = instanceIds.length
    ? (state.instances || []).filter((i) => instanceIds.includes(i.instanceId))
    : (state.instances || []).filter((i) => Math.abs(i.position[axisIdx] - planeOffsetMm) > 0.5);

  const workingInstances = [...(state.instances || [])];
  const mirroredInstances = [];

  for (let idx = 0; idx < sourceInstances.length; idx++) {
    const src = sourceInstances[idx];
    const part = catalogById.get(src.partId);
    if (!part) continue;
    const pose = mirrorPose(part, src, axisIdx, planeOffsetMm);
    const mirroredInst = {
      instanceId: `inst-${Date.now()}-mir-${idx + 1}`,
      partId: src.partId,
      label: mirrorLabel(src.label),
      position: pose.position,
      rotation: pose.rotation,
      color: src.color,
      visible: src.visible,
      locked: false,
      ...(src.socketAngleDeg !== undefined ? { socketAngleDeg: src.socketAngleDeg } : {}),
      ...(pose.exact ? {} : { mirrorApproximate: true })
    };
    const { isIntersecting } = checkCandidateCollision(mirroredInst, workingInstances);
    mirroredInst.isIntersecting = isIntersecting;
    mirroredInst.lastValidPosition = isIntersecting ? null : [...pose.position];
    mirroredInst.lastValidRotation = isIntersecting ? null : [...pose.rotation];

    workingInstances.push(mirroredInst);
    mirroredInstances.push(mirroredInst);
  }

  return {
    ok: true,
    mirroredCount: mirroredInstances.length,
    mirroredInstances,
    workingInstances
  };
}

/**
 * Generates a 3-view Orthographic Engineering Blueprint SVG (Top XZ, Side XY, Front ZY)
 * at `public/assembly-blueprint.svg` along with spatial envelope, ground clearance,
 * and left/right symmetry diagnostics.
 */
export function generateOrthographicViews(state) {
  const { catalogById } = getCatalog();
  const visible = (state.instances || []).filter((i) => i.visible !== false);
  const audit = auditAssembly(state);

  const items = [];
  const overallBox = new THREE.Box3();

  let wheelMinY = Infinity;
  let chassisMinY = Infinity;

  for (const inst of visible) {
    const part = catalogById.get(inst.partId);
    if (!part) continue;

    const mat = buildWorldMatrix(inst.position, inst.rotation);
    const box = new THREE.Box3(
      new THREE.Vector3(...part.bbox.min),
      new THREE.Vector3(...part.bbox.max)
    ).applyMatrix4(mat);

    overallBox.union(box);

    const center = new THREE.Vector3();
    box.getCenter(center);

    const isWheel =
      part.category === 'Wheels & Treads' || part.name.toLowerCase().includes('wheel');
    const isFastener =
      part.category === 'Pins & Standoffs' ||
      (part.category === 'Shafts, Spacers & Collars' &&
        part.name.toLowerCase().includes('shaft'));

    if (isWheel) {
      if (box.min.y < wheelMinY) wheelMinY = box.min.y;
    } else if (!isFastener) {
      if (box.min.y < chassisMinY) chassisMinY = box.min.y;
    }

    items.push({
      inst,
      part,
      box,
      center,
      isWheel,
      isFastener,
      isGear: part.gearSpecs != null
    });
  }

  if (items.length === 0) {
    overallBox.min.set(-100, 0, -100);
    overallBox.max.set(100, 100, 100);
  }

  const sizeVec = new THREE.Vector3();
  overallBox.getSize(sizeVec);

  const overallEnvelopeMm = {
    min: [
      Number(overallBox.min.x.toFixed(2)),
      Number(overallBox.min.y.toFixed(2)),
      Number(overallBox.min.z.toFixed(2))
    ],
    max: [
      Number(overallBox.max.x.toFixed(2)),
      Number(overallBox.max.y.toFixed(2)),
      Number(overallBox.max.z.toFixed(2))
    ],
    size: [
      Number(sizeVec.x.toFixed(2)),
      Number(sizeVec.y.toFixed(2)),
      Number(sizeVec.z.toFixed(2))
    ],
    pitchSize: [
      Number((sizeVec.x / VEX_PITCH_MM).toFixed(2)),
      Number((sizeVec.y / VEX_PITCH_MM).toFixed(2)),
      Number((sizeVec.z / VEX_PITCH_MM).toFixed(2))
    ]
  };

  // Symmetry Check across Z = 0 (Left vs Right)
  const nonFastenerItems = items.filter((it) => !it.isFastener);
  const leftItems = nonFastenerItems.filter((it) => it.center.z < -2.0);
  const rightItems = nonFastenerItems.filter((it) => it.center.z > 2.0);
  const centerItems = nonFastenerItems.filter((it) => Math.abs(it.center.z) <= 2.0);
  const unmirroredLeftRight = [];

  for (const lItem of leftItems) {
    const hasMatch = rightItems.some(
      (rItem) =>
        rItem.part.partNumber === lItem.part.partNumber &&
        Math.abs(Math.abs(rItem.center.x) - Math.abs(lItem.center.x)) <= 2.5 &&
        Math.abs(rItem.center.y - lItem.center.y) <= 2.5 &&
        Math.abs(rItem.center.z + lItem.center.z) <= 2.5
    );
    if (!hasMatch) {
      unmirroredLeftRight.push(lItem.inst.label);
    }
  }

  const groundClearanceMm =
    wheelMinY < Infinity && chassisMinY < Infinity
      ? Number((chassisMinY - wheelMinY).toFixed(2))
      : null;

  // Helper to render one orthographic panel inside the SVG
  function renderOrthoPanel({
    title,
    subtitle,
    panelX,
    panelY,
    panelW,
    panelH,
    uKey,
    vKey,
    depthKey,
    depthDir,
    flipV
  }) {
    const pad = 34;
    const drawW = panelW - pad * 2;
    const drawH = panelH - pad * 2 - 22;

    const minU = overallBox.min[uKey] - 15;
    const maxU = overallBox.max[uKey] + 15;
    const minV = overallBox.min[vKey] - 15;
    const maxV = overallBox.max[vKey] + 15;

    const spanU = Math.max(maxU - minU, 50);
    const spanV = Math.max(maxV - minV, 50);
    const scale = Math.min(drawW / spanU, drawH / spanV);

    const midU = (minU + maxU) * 0.5;
    const midV = (minV + maxV) * 0.5;
    const cx = panelX + panelW * 0.5;
    const cy = panelY + 24 + (panelH - 24) * 0.5;

    const mapU = (u) => Number((cx + (u - midU) * scale).toFixed(2));
    const mapV = (v) =>
      Number((cy + (flipV ? -(v - midV) : v - midV) * scale).toFixed(2));

    const lines = [];
    lines.push(
      `<rect x="${panelX}" y="${panelY}" width="${panelW}" height="${panelH}" rx="10" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>`
    );
    lines.push(
      `<text x="${panelX + 14}" y="${panelY + 22}" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="13" font-weight="700">${title}</text>`
    );
    lines.push(
      `<text x="${panelX + panelW - 14}" y="${panelY + 22}" text-anchor="end" fill="#64748b" font-family="monospace" font-size="11">${subtitle}</text>`
    );

    // Draw 12.7mm VEX Pitch Grid lines
    const startPitchU = Math.ceil(minU / VEX_PITCH_MM);
    const endPitchU = Math.floor(maxU / VEX_PITCH_MM);
    for (let pu = startPitchU; pu <= endPitchU; pu++) {
      const gx = mapU(pu * VEX_PITCH_MM);
      const isZero = pu === 0;
      lines.push(
        `<line x1="${gx}" y1="${panelY + 32}" x2="${gx}" y2="${panelY + panelH - 10}" stroke="${isZero ? '#38bdf8' : '#1e293b'}" stroke-width="${isZero ? '1.2' : '0.6'}" ${isZero ? 'stroke-dasharray="4 3"' : ''}/>`
      );
    }

    const startPitchV = Math.ceil(minV / VEX_PITCH_MM);
    const endPitchV = Math.floor(maxV / VEX_PITCH_MM);
    for (let pv = startPitchV; pv <= endPitchV; pv++) {
      const gy = mapV(pv * VEX_PITCH_MM);
      const isZero = pv === 0;
      lines.push(
        `<line x1="${panelX + 10}" y1="${gy}" x2="${panelX + panelW - 10}" y2="${gy}" stroke="${isZero ? '#38bdf8' : '#1e293b'}" stroke-width="${isZero ? '1.2' : '0.6'}" ${isZero ? 'stroke-dasharray="4 3"' : ''}/>`
      );
    }

    // Sort items back-to-front along depthKey
    const sorted = [...items].sort(
      (a, b) => (a.center[depthKey] - b.center[depthKey]) * depthDir
    );

    for (const item of sorted) {
      const x1 = mapU(item.box.min[uKey]);
      const x2 = mapU(item.box.max[uKey]);
      const y1 = mapV(item.box.min[vKey]);
      const y2 = mapV(item.box.max[vKey]);
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.max(Math.abs(x2 - x1), 2);
      const rh = Math.max(Math.abs(y2 - y1), 2);

      const isColliding = Boolean(item.inst.isIntersecting);
      const fill = isColliding ? '#ef4444' : item.inst.color || item.part.defaultColor || '#64748b';
      const stroke = isColliding ? '#fca5a5' : '#020617';
      const opacity = item.isFastener ? '0.92' : item.isWheel ? '0.82' : '0.88';

      // If gear or wheel viewed face-on (where rw and rh are approximately equal circular diameter)
      if ((item.isGear || item.isWheel) && Math.abs(rw - rh) < Math.max(rw, rh) * 0.18) {
        const cU = mapU(item.center[uKey]);
        const cV = mapV(item.center[vKey]);
        const rPx = Number(((rw + rh) * 0.25).toFixed(2));
        lines.push(
          `<circle cx="${cU}" cy="${cV}" r="${rPx}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1.2" ${isColliding ? 'stroke-dasharray="3 2"' : ''}/>`
        );
        if (item.isGear && item.part.gearSpecs?.pitchRadiusMm) {
          const pitchRPx = Number((item.part.gearSpecs.pitchRadiusMm * scale).toFixed(2));
          lines.push(
            `<circle cx="${cU}" cy="${cV}" r="${pitchRPx}" fill="none" stroke="#f472b6" stroke-width="1" stroke-dasharray="3 2"/>`
          );
        }
      } else {
        const cornerR = item.isFastener ? 1.5 : 3;
        lines.push(
          `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${cornerR}" fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="1" ${isColliding ? 'stroke-dasharray="3 2"' : ''}/>`
        );
      }
    }

    return lines.join('\n');
  }

  const svgParts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 820" width="1200" height="820" style="background:#020617;">`,
    `<rect width="1200" height="820" fill="#020617"/>`,
    `<text x="24" y="34" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="18" font-weight="800">VEX IQ 3D ASSEMBLY — ORTHOGRAPHIC ENGINEERING BLUEPRINT &amp; MECHANICAL AUDIT</text>`,
    `<text x="1176" y="34" text-anchor="end" fill="${audit.isMechanicallySound ? '#4ade80' : '#f87171'}" font-family="monospace" font-size="13" font-weight="700">${audit.isMechanicallySound ? '● MECHANICALLY SOUND (0 ISSUES)' : '▲ AUDIT WARNINGS DETECTED'}</text>`,
    renderOrthoPanel({
      title: '1. TOP VIEW (X-Z PLANE)',
      subtitle: 'Looking down -Y · Dashed cyan = Centerlines (X=0, Z=0)',
      panelX: 20,
      panelY: 50,
      panelW: 570,
      panelH: 370,
      uKey: 'x',
      vKey: 'z',
      depthKey: 'y',
      depthDir: 1,
      flipV: false
    }),
    renderOrthoPanel({
      title: '2. SIDE VIEW (X-Y PLANE)',
      subtitle: 'Looking along +Z · Dashed pink = Gear Pitch Circles',
      panelX: 610,
      panelY: 50,
      panelW: 570,
      panelH: 370,
      uKey: 'x',
      vKey: 'y',
      depthKey: 'z',
      depthDir: 1,
      flipV: true
    }),
    renderOrthoPanel({
      title: '3. FRONT VIEW (Z-Y PLANE)',
      subtitle: 'Looking along +X · Track Width &amp; Flush Shaft Envelope',
      panelX: 20,
      panelY: 435,
      panelW: 570,
      panelH: 365,
      uKey: 'z',
      vKey: 'y',
      depthKey: 'x',
      depthDir: -1,
      flipV: true
    }),
    // Panel 4: Engineering & Audit Telemetry Card
    `<rect x="610" y="435" width="570" height="365" rx="10" fill="#0f172a" stroke="#1e293b" stroke-width="1.5"/>`,
    `<text x="628" y="462" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="14" font-weight="700">4. 6-STAGE MECHANICAL &amp; KINEMATIC AUDIT TELEMETRY</text>`,
    `<text x="628" y="492" fill="#94a3b8" font-family="monospace" font-size="12">Total Placed Parts:       <tspan fill="#f8fafc" font-weight="700">${audit.totalInstances}</tspan></text>`,
    `<text x="628" y="516" fill="#94a3b8" font-family="monospace" font-size="12">Envelope (mm):            <tspan fill="#38bdf8" font-weight="700">${overallEnvelopeMm.size.join(' × ')} mm (${overallEnvelopeMm.pitchSize.join('P × ')}P)</tspan></text>`,
    `<text x="628" y="540" fill="#94a3b8" font-family="monospace" font-size="12">Ground Clearance:         <tspan fill="#f8fafc" font-weight="700">${groundClearanceMm !== null ? `${groundClearanceMm} mm above tire contact` : 'N/A'}</tspan></text>`,
    `<text x="628" y="564" fill="#94a3b8" font-family="monospace" font-size="12">Left/Right Z-Symmetry:    <tspan fill="${unmirroredLeftRight.length === 0 ? '#4ade80' : '#fbbf24'}" font-weight="700">${unmirroredLeftRight.length === 0 ? `Symmetric (${leftItems.length}L / ${centerItems.length}C / ${rightItems.length}R)` : `${unmirroredLeftRight.length} unmirrored`}</tspan></text>`,
    `<text x="628" y="596" fill="#94a3b8" font-family="monospace" font-size="12">1. Solid Collisions:      <tspan fill="${audit.collisionCount === 0 ? '#4ade80' : '#f87171'}" font-weight="700">${audit.collisionCount}</tspan></text>`,
    `<text x="628" y="620" fill="#94a3b8" font-family="monospace" font-size="12">2. Floating Fasteners:    <tspan fill="${audit.floatingFastenerCount === 0 ? '#4ade80' : '#f87171'}" font-weight="700">${audit.floatingFastenerCount}</tspan></text>`,
    `<text x="628" y="644" fill="#94a3b8" font-family="monospace" font-size="12">3. Unsecured / Heavy:     <tspan fill="${audit.unsecuredPartCount === 0 && audit.underSecuredHeavyPartCount === 0 ? '#4ade80' : '#f87171'}" font-weight="700">${audit.unsecuredPartCount} unsecured · ${audit.underSecuredHeavyPartCount} under-pinned heavy</tspan></text>`,
    `<text x="628" y="668" fill="#94a3b8" font-family="monospace" font-size="12">4. Connectivity Graph:    <tspan fill="${audit.disconnectedIslandCount === 0 ? '#4ade80' : '#f87171'}" font-weight="700">${audit.connectedComponentCount} unified component (${audit.disconnectedIslandCount} islands)</tspan></text>`,
    `<text x="628" y="692" fill="#94a3b8" font-family="monospace" font-size="12">5. Protruding Shafts:     <tspan fill="${audit.protrudingShaftCount === 0 ? '#4ade80' : '#f87171'}" font-weight="700">${audit.protrudingShaftCount} (all shafts flush &lt;= 4.5mm)</tspan></text>`,
    `<text x="628" y="716" fill="#94a3b8" font-family="monospace" font-size="12">6. Kinematic Drivetrain:  <tspan fill="${audit.kinematics.unpoweredWheels.length === 0 ? '#4ade80' : '#fbbf24'}" font-weight="700">${audit.kinematics.motorCount} Motors → ${audit.kinematics.meshedGearPairCount} Meshed Gear Pairs → ${audit.kinematics.drivenWheelCount}/${audit.kinematics.totalWheelCount} Driven Wheels</tspan></text>`,
    `</svg>`
  ];

  return {
    ok: true,
    svg: svgParts.join('\n'),
    overallEnvelopeMm,
    groundClearanceMm,
    symmetry: {
      isLeftRightSymmetric: unmirroredLeftRight.length === 0,
      leftPartCount: leftItems.length,
      centerPartCount: centerItems.length,
      rightPartCount: rightItems.length,
      unmirroredParts: unmirroredLeftRight
    },
    auditSummary: {
      isMechanicallySound: audit.isMechanicallySound,
      collisionCount: audit.collisionCount,
      floatingFastenerCount: audit.floatingFastenerCount,
      unsecuredPartCount: audit.unsecuredPartCount,
      underSecuredHeavyPartCount: audit.underSecuredHeavyPartCount,
      disconnectedIslandCount: audit.disconnectedIslandCount,
      protrudingShaftCount: audit.protrudingShaftCount,
      kinematics: audit.kinematics
    }
  };
}




/** Short form of an auditAssembly result: counts, plus the names of the parts behind each problem. */
export function summarizeAudit(audit) {
  const names = (list) => list.map((x) => x.label);
  return {
    isMechanicallySound: audit.isMechanicallySound,
    collisionCount: audit.collisionCount,
    tightFitCount: audit.tightFitCount,
    floatingFastenerCount: audit.floatingFastenerCount,
    halfSeatedFastenerCount: audit.halfSeatedFastenerCount,
    unsecuredPartCount: audit.unsecuredPartCount,
    underSecuredHeavyPartCount: audit.underSecuredHeavyPartCount,
    disconnectedIslandCount: audit.disconnectedIslandCount,
    protrudingShaftCount: audit.protrudingShaftCount,
    drivenWheelCount: audit.kinematics.drivenWheelCount,
    totalWheelCount: audit.kinematics.totalWheelCount,
    problems: Object.fromEntries(
      Object.entries({
        collisions: audit.collisions.map((c) => `${c.label} x ${c.collidingWith.join(', ')}`),
        tightFits: audit.tightFits.map((t) => `${t.label} x ${t.withLabel}`),
        floating: names(audit.floatingFasteners),
        halfSeated: names(audit.halfSeatedFasteners),
        unsecured: names(audit.unsecuredParts),
        underSecuredHeavy: names(audit.underSecuredHeavyParts),
        disconnected: audit.disconnectedIslands.map((island) => island.map((p) => p.label).join(', ')),
        protruding: names(audit.protrudingShafts),
        undrivenWheels: names(audit.kinematics.unpoweredWheels)
      }).filter(([, v]) => v.length > 0)
    )
  };
}

/**
 * Chain or track round the selected sprockets (openspec chain-track-builder), as the app's Tools → Chain builder
 * and the build_chain tool do it: link (and gripper) instances made into one new "Chain N" /
 * "Track N" group, and each loop sprocket turned with its shaft group so its teeth sit in the chain.
 * `instanceIds` default to the selection. Returns { error } or { instances (all, new state),
 * groupId, name, newIds, result (buildChainPath), message, turned: [instanceId] }.
 */
export function buildChain(state, { kind = 'chain', instanceIds = null, route = null, grippers = true, attachment = null, attachmentEvery = 1, slack = 'lower', name = null } = {}) {
  const { catalog, catalogById } = getCatalog();
  if (kind !== 'chain' && kind !== 'track') return { error: 'kind must be "chain" or "track".' };
  const ids = Array.isArray(instanceIds) && instanceIds.length ? instanceIds : state.selectedIds?.length ? state.selectedIds : state.selectedId ? [state.selectedId] : [];
  const byId = new Map(state.instances.map((i) => [i.instanceId, i]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) return { error: `Not in the build: ${unknown.join(', ')}` };
  const chosen = ids.map((id) => byId.get(id)).filter((i) => i.visible !== false);
  const res = buildChainPath(
    chosen.map((i) => ({ instanceId: i.instanceId, label: i.label, meta: catalogById.get(i.partId), position: i.position, rotation: i.rotation })),
    { kind, route, grippers: kind === 'track' && grippers !== false, attachment, attachmentEvery, slack: slack === 'upper' ? 'upper' : 'lower', metaByPartNumber: (pn) => catalog.find((p) => p.partNumber === pn) }
  );
  if (!res.ok) return { error: res.error, ...(res.needsRoute ? { needsRoute: res.needsRoute } : {}) };

  // Turn each loop sprocket, with its axle and the parts on it, so a tooth gap sits at a pivot
  let instances = state.instances;
  const visible = instances.filter((i) => i.visible !== false);
  const groups = shaftGroups(
    visible.map((i) => ({ instanceId: i.instanceId, features: worldFeaturesFor(i), hasHub: Boolean(catalogById.get(i.partId)?.hubSpecs) }))
  );
  const turned = new Set();
  for (const t of res.sprocketTurns) {
    const axis = new THREE.Vector3(...t.axis);
    const current = new Map(instances.map((i) => [i.instanceId, i]));
    const group = groupOf(groups, t.instanceId);
    let patches;
    if (group) {
      const deg = t.deg * (Math.sign(axis.dot(group.axis)) || 1);
      patches = turnGroup(
        group,
        deg,
        (id) => current.get(id),
        (id) => worldFeaturesFor(current.get(id)).find((f) => f.kind === 'shaft_socket')?.axis || null
      );
    } else {
      const pose = turnAboutLine(current.get(t.instanceId), axis, new THREE.Vector3(...t.point), t.deg);
      patches = [{ instanceId: t.instanceId, position: pose.position, rotation: pose.rotation }];
    }
    instances = applyPosePatches(instances, patches);
    for (const pch of patches) turned.add(pch.instanceId);
  }

  // The new parts, labeled like other added parts ("Chain Link #12")
  const stamp = Date.now().toString(36);
  const counts = new Map();
  const newInstances = [...res.links, ...res.grippers].map((pose, i) => {
    const part = catalogById.get(pose.partId);
    const n = (counts.get(part.id) ?? instances.filter((x) => x.partId === part.id).length) + 1;
    counts.set(part.id, n);
    return {
      instanceId: `inst-${stamp}-${kind}-${i + 1}-${Math.random().toString(36).slice(2, 6)}`,
      partId: part.id,
      label: `${part.name} #${n}`,
      position: pose.position,
      rotation: pose.rotation,
      lastValidPosition: pose.position,
      lastValidRotation: pose.rotation,
      isIntersecting: false,
      color: part.defaultColor,
      visible: true,
      locked: false
    };
  });
  instances = [...instances, ...newInstances];
  const newIds = newInstances.map((i) => i.instanceId);
  const groupName = typeof name === 'string' && name.trim() ? name.trim() : nextChainName(instances, kind);
  const made = groupParts(instances, newIds, groupName);
  instances = applyPatches(instances, made.patches);
  const labelOf = (id) => instances.find((i) => i.instanceId === id)?.label || id;
  const others = [...turned].filter((id) => !res.onLoop.includes(id));
  let message = chainMessage(res, labelOf);
  if (others.length) message += ` Turned with the sprockets: ${others.map(labelOf).join(', ')}.`;
  return {
    instances,
    groupId: made.groupId,
    name: groupName,
    newIds,
    result: res,
    wrapped: res.wrapped,
    leftOut: res.leftOut,
    message,
    turned: [...turned]
  };
}

/**
 * The placement step (src/utils/placementFit.js) for `placed` among `instances` (it must be one of
 * them, at its placed pose): square fit, meshing, shaft-group turns and Smart Motor hubs, exactly as
 * the app does. Returns its { patches, messages, squareFit, mesh }.
 */
export function settlePlacedInstance(placed, instances, receivingId = null) {
  const { catalogById } = getCatalog();
  return settlePlacement({
    placedId: placed.instanceId,
    instances,
    receivingId,
    partOf: (i) => catalogById.get(i.partId),
    featuresOf: worldFeaturesFor
  });
}

/** `instances` with the pose patches of a placement step applied (new objects for changed parts). */
export function applyPosePatches(instances, patches) {
  if (!patches?.length) return instances;
  return instances.map((inst) => {
    const patch = patches.find((p) => p.instanceId === inst.instanceId);
    if (!patch) return inst;
    const { instanceId, ...fields } = patch;
    return { ...inst, ...fields };
  });
}

/**
 * Places a list of parts into a copy of `state` (see the place_parts tool). Items are resolved in
 * order; an item may name an earlier item by its `ref`. Each item gives either an absolute
 * `position` / `rotation` or an `insert` (placed into an opening and pushed in until contact).
 * With `mirror`, every item is also placed as its mirror image. Overlaps are checked once all items
 * are in, against old and new parts alike. Nothing is written here.
 * Returns { error: { index, ref, reason } } or { instances, placed, audit }.
 */
export function placeParts(state, items, options = {}) {
  const working = [...(state.instances || [])];
  const refs = new Map(); // ref -> instance
  const placed = []; // { index, ref, inst, stoppedAgainst, notes, rollReplaced?, turnedOthers? }
  const turnedIds = new Set(); // existing parts the placement step turned
  const fail = (index, ref, reason) => ({ error: { index, ref: ref ?? null, reason } });
  if (!Array.isArray(items) || items.length === 0) return fail(null, null, 'parts must be a non-empty list');

  const newId = (() => {
    const stamp = Date.now();
    let n = 0;
    return () => `inst-${stamp}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  })();
  const resolveInstance = (into) => {
    if (into?.ref !== undefined) return refs.get(into.ref) || null;
    if (into?.instanceId) return working.find((i) => i.instanceId === into.instanceId) || null;
    return null;
  };

  for (let index = 0; index < items.length; index++) {
    const item = items[index] || {};
    const part = item.partQuery ? findPart(item.partQuery) : null;
    if (!part) return fail(index, item.ref, `part not found: "${item.partQuery}"`);
    if (item.ref !== undefined && refs.has(item.ref)) return fail(index, item.ref, `ref "${item.ref}" is used twice`);

    const sameCount = working.filter((i) => i.partId === part.id).length;
    const inst = {
      instanceId: newId(),
      partId: part.id,
      label: item.label || `${part.name} #${sameCount + 1}`,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      color: item.color || part.defaultColor,
      visible: true,
      locked: false
    };
    let stoppedAgainst;
    let preTurned = false;
    let otherFits = [];
    let usedPorts = null;

    if (item.insert) {
      const target = resolveInstance(item.insert.into);
      if (!target) return fail(index, item.ref, 'insert.into must name an existing instanceId or an earlier ref');
      const pose = insertIntoOpening(part, item.insert, target, working, inst.instanceId);
      if (pose.error) return fail(index, item.ref, pose.error);
      inst.position = pose.position;
      inst.rotation = pose.rotation;
      stoppedAgainst = pose.stoppedAgainst;
      preTurned = pose.preTurned;
      usedPorts = pose.ports;
      // A part that fits more than one way (flipped, rolled) gets the others listed, unless the
      // caller already chose with flip / rollDeg
      if (item.insert.flip === undefined && item.insert.rollDeg === undefined) {
        otherFits = otherInsertFits(part, item.insert, target, working, inst.instanceId, pose);
      }
    } else {
      if (!Array.isArray(item.position) || item.position.length !== 3) {
        return fail(index, item.ref, 'give either position [x, y, z] (mm) or insert');
      }
      inst.position = item.position.map((n) => Number(Number(n).toFixed(3)));
      inst.rotation = Array.isArray(item.rotation) && item.rotation.length === 3
        ? item.rotation.map((r) => Number(Number(r).toFixed(2)))
        : [0, 0, 0];
    }

    working.push(inst);
    // The placement step: square fit, mesh, shaft groups, motor hubs (openspec gear-meshing)
    const settled = settlePlacedInstance(inst, working, item.insert ? resolveInstance(item.insert.into)?.instanceId : null);
    const own = settled.patches.find((p) => p.instanceId === inst.instanceId);
    if (own) Object.assign(inst, own);
    const others = settled.patches.filter((p) => p.instanceId !== inst.instanceId);
    for (const patch of others) {
      const at = working.findIndex((w) => w.instanceId === patch.instanceId);
      const { instanceId, ...fields } = patch;
      if (at >= 0) Object.assign((working[at] = { ...working[at] }), fields);
      // Earlier items of this call keep pointing at their (turned) instance
      for (const p of placed) if (p.inst.instanceId === patch.instanceId) p.inst = working[at];
      for (const [r, v] of refs) if (v.instanceId === patch.instanceId) refs.set(r, working[at]);
      turnedIds.add(patch.instanceId);
    }
    if (item.ref !== undefined) refs.set(item.ref, inst);
    const rollGiven = item.insert?.rollDeg !== undefined || Array.isArray(item.rotation);
    placed.push({
      index,
      ref: item.ref,
      inst,
      stoppedAgainst,
      ...(usedPorts ? { ports: usedPorts } : {}),
      ...(otherFits.length ? { otherFits } : {}),
      notes: settled.messages,
      ...((own?.rotation || preTurned) && rollGiven ? { rollReplaced: true } : {}),
      ...(others.length ? { turnedOthers: others.map((p) => working.find((w) => w.instanceId === p.instanceId)?.label || p.instanceId) } : {})
    });
  }

  if (options.mirror) {
    const mirrored = mirrorPlacedParts(placed, options.mirror);
    if (mirrored.error) return fail(null, null, mirrored.error);
    for (const m of mirrored.items) {
      working.push(m.inst);
      placed.push(m);
    }
  }

  for (const p of placed) {
    const { isIntersecting, collidingWith, tightFits } = checkCandidateCollision(p.inst, working);
    p.inst.isIntersecting = isIntersecting;
    p.inst.lastValidPosition = isIntersecting ? null : [...p.inst.position];
    p.inst.lastValidRotation = isIntersecting ? null : [...p.inst.rotation];
    p.collidingWith = collidingWith.map((c) => c.label);
    p.tightFits = tightFits.map((c) => c.label);
  }
  for (const id of turnedIds) {
    const inst = working.find((w) => w.instanceId === id);
    if (!inst || placed.some((p) => p.inst === inst)) continue;
    inst.isIntersecting = checkCandidateCollision(inst, working).isIntersecting;
    if (!inst.isIntersecting) {
      inst.lastValidPosition = [...inst.position];
      inst.lastValidRotation = [...inst.rotation];
    }
  }

  return {
    instances: working,
    placed,
    audit: summarizeAudit(auditAssembly({ ...state, instances: working }))
  };
}

const SHAPE_CELL_MM = 0.75; // shape signatures compare occupied cells of this size
const SAME_SHAPE_MIN = 0.85; // share of cells two poses must have in common to look the same

/** Cells a part's collision mesh occupies under a world matrix (a reflection is fine too). */
function shapeCells(part, matrix) {
  const cells = new Set();
  const v = new THREE.Vector3();
  for (const { geo } of getPartCollisionBvh(part).pieces) {
    const pos = geo.attributes.position;
    const stride = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      cells.add(`${Math.round(v.x / SHAPE_CELL_MM)},${Math.round(v.y / SHAPE_CELL_MM)},${Math.round(v.z / SHAPE_CELL_MM)}`);
    }
  }
  return cells;
}

const shapeSignature = (part, position, rotation) => shapeCells(part, buildWorldMatrix(position, rotation));

/** Share of cells two shapes have in common (1 = the same). */
function shapeOverlap(a, b) {
  let common = 0;
  for (const c of a) if (b.has(c)) common++;
  return common / Math.max(a.size, b.size, 1);
}

const sameShape = (a, b) => shapeOverlap(a, b) >= SAME_SHAPE_MIN;

/**
 * True when two poses of a part fill the same space (a 2x12 Beam turned end for end in place):
 * nearly every sampled point of its surface at pose `a` lies on its surface at pose `b`.
 */
export function looksTheSame(part, a, b, toleranceMm = 0.3) {
  const geo = getPartRawGeometry(part);
  const pos = geo.attributes.position;
  const aToB = buildWorldMatrix(b.position, b.rotation).invert().multiply(buildWorldMatrix(a.position, a.rotation));
  const stride = Math.max(1, Math.floor(pos.count / 2000));
  const v = new THREE.Vector3();
  const target = {};
  let on = 0;
  let n = 0;
  for (let i = 0; i < pos.count; i += stride) {
    v.fromBufferAttribute(pos, i).applyMatrix4(aToB);
    n++;
    if (geo.boundsTree.closestPointToPoint(v, target)?.distance <= toleranceMm) on++;
  }
  return n > 0 && on / n >= 0.98;
}

/**
 * The other ways `part` goes into the same opening: led with the other end (`flip`) and rolled in
 * quarter turns, keeping those that fit without overlapping and don't look the same as the chosen
 * pose or each other (a round pin rolled is still the same pin). Returns [{ flip, rollDeg, ... }].
 */
function otherInsertFits(part, insert, target, others, instanceId, chosen) {
  const measured = getPartMeasurements(part);
  const targetFeatures = worldFeaturesFor(target);
  // How many pins sit in openings between the part and the target at a pose
  const seatedCount = (pose) =>
    findSeatedPairs(collectWorldFeatures(part, buildWorldMatrix(pose.position, pose.rotation), instanceId, measured), targetFeatures).length;
  const chosenSeated = seatedCount(chosen);
  // Rolling a pin or shaft about its own axis changes nothing that matters (square fits are turned
  // by the placement step); turning it end for end can (capped shafts and pins)
  const fastener = isFastenerPart(part, collectWorldFeatures(part, new THREE.Matrix4(), instanceId, measured));
  const seen = [shapeSignature(part, chosen.position, chosen.rotation)];
  const fits = [];
  for (const flip of [false, true]) {
    for (const rollDeg of fastener ? [0] : [0, 90, 180, 270]) {
      if (!flip && rollDeg === 0) continue;
      const pose = insertIntoOpening(part, { ...insert, flip, rollDeg }, target, others, instanceId);
      if (pose.error) continue;
      if (seatedCount(pose) < chosenSeated) continue;
      const candidate = { instanceId, partId: part.id, label: part.name, position: pose.position, rotation: pose.rotation, visible: true };
      if (checkCandidateCollision(candidate, others).isIntersecting) continue;
      const signature = shapeSignature(part, pose.position, pose.rotation);
      if (seen.some((s) => sameShape(s, signature))) continue;
      seen.push(signature);
      fits.push({ flip, rollDeg, position: pose.position, rotation: pose.rotation, ...(pose.stoppedAgainst ? { stoppedAgainst: pose.stoppedAgainst } : {}) });
    }
  }
  return fits;
}

const INSERT_START_GAP_MM = 1; // the item starts this far outside the target before moving in
const INSERT_STEP_MM = 0.5;
const INSERT_BACK_OFF_MM = 0.002;

/** Picks a feature by port id; a split opening (`<id>@lo` / `<id>@hi`) is picked by side. */
function pickFeature(features, port, side) {
  if (!port) return null;
  const exact = features.find((f) => f.featureId === port);
  if (exact) return exact;
  const parts = features.filter((f) => f.featureId.startsWith(`${port}@`));
  if (parts.length === 0) return null;
  return parts.find((f) => f.featureId.endsWith(side < 0 ? '@lo' : '@hi')) || parts[0];
}

/**
 * Pose for placing `part` by inserting one of its features into `target`'s port (see place_parts):
 * line the axes up with the item 1 mm outside on `fromSide`, then move straight in until it first
 * touches another part in `others` — the double-click mating rule (planMates + contact search, the
 * 0.25-pitch flush seat preference, and a back-off so the saved pose never overlaps).
 * Returns { position, rotation, stoppedAgainst } or { error }.
 */
function insertIntoOpening(part, insert, target, others, instanceId) {
  const measured = getPartMeasurements(part);
  const local = collectWorldFeatures(part, new THREE.Matrix4(), instanceId, measured);
  const targetFeatures = worldFeaturesFor(target);
  const targetPart = getCatalog().catalogById.get(target.partId);
  const port = featureIdFor(targetPart, insert.into?.port);

  const sideArg = insert.fromSide === '-' ? -1 : insert.fromSide === '+' ? 1 : null;
  const targetFeature = pickFeature(targetFeatures, port, sideArg ?? 1);
  if (!targetFeature) return { error: unknownPortError(targetPart, target.label, insert.into?.port) };
  // Blind openings open toward +axis (`@lo` halves toward -axis); through ones default to +
  const side = sideArg ?? (targetFeature.featureId.endsWith('@lo') ? -1 : 1);

  const isInsert = (f) => f.kind === 'pin' || f.kind === 'shaft';
  let source;
  if (insert.sourcePort) {
    source = pickFeature(local, featureIdFor(part, insert.sourcePort), -side);
    if (!source) return { error: unknownPortError(part, part.name, insert.sourcePort) };
  } else {
    source = isInsert(targetFeature)
      ? local.find((f) => !isInsert(f) && f.through) || local.find((f) => !isInsert(f))
      : local.find((f) => f.kind === 'shaft') || local.find((f) => f.kind === 'pin');
    if (!source) return { error: `"${part.name}" has nothing that fits "${port}"` };
  }
  if (isInsert(source) === isInsert(targetFeature)) {
    return { error: `"${source.featureId}" and "${port}" are both ${isInsert(source) ? 'pins/shafts' : 'openings'}` };
  }

  // Which way the source's local axis must point. The item travels along -side * targetAxis.
  //  - pin/peg: lead with an end that sticks out (hi when it can), so +u points along the travel;
  //  - capped shaft: lead with the plain end (lo), so +u points back toward the approach side;
  //  - blind opening (socket): its mouth (hi end) must face the travel direction;
  //  - through opening or plain shaft: keep +u along the target axis.
  const a = targetFeature.axis.clone();
  const travel = a.clone().multiplyScalar(-side);
  let uWorld;
  if (source.kind === 'pin') uWorld = source.freeAtEnd !== false || !source.freeAtStart ? travel : travel.clone().negate();
  else if (source.kind === 'shaft') uWorld = part.fastenerSpecs?.hasEndCap ? travel.clone().negate() : a;
  else if (!source.through) uWorld = source.featureId.endsWith('@lo') ? travel.clone().negate() : travel;
  else uWorld = a;
  if (insert.flip) uWorld.negate();
  const q = buildAxisAlignedQuaternion(source.axis.toArray(), uWorld.toArray(), Number(insert.rollDeg) || 0);
  const euler = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  let rotation = [euler.x, euler.y, euler.z].map((r) => Number(THREE.MathUtils.radToDeg(r).toFixed(2)) + 0);

  // Start pose: on the target's axis line, leading end 1 mm outside the target feature on `side`
  const placedAt = (position) => ({ instanceId, partId: part.id, label: part.name, position, rotation, visible: true });
  const featureAt = (position) =>
    collectWorldFeatures(part, buildWorldMatrix(position, rotation), instanceId, measured).find((f) => f.featureId === source.featureId);
  const at0 = featureAt([0, 0, 0]);
  const tOf = (f) => [f.start.dot(a), f.end.dot(a)];
  const tTarget = tOf(targetFeature);
  const tSource = tOf(at0);
  const targetFace = side > 0 ? Math.max(...tTarget) : Math.min(...tTarget);
  const sourceLead = side > 0 ? Math.min(...tSource) : Math.max(...tSource);
  const toLine = targetFeature.origin.clone().sub(at0.origin);
  toLine.addScaledVector(a, -toLine.dot(a));
  const start = toLine.addScaledVector(a, targetFace + side * INSERT_START_GAP_MM - sourceLead);

  const startFeatures = collectWorldFeatures(part, buildWorldMatrix(start.toArray(), rotation), instanceId, measured);
  const pair = findAlignedOpenings(startFeatures, targetFeatures).find((p) =>
    isInsert(source)
      ? p.featureId === targetFeature.featureId && p.insertFeatureId === source.featureId
      : p.instanceId === instanceId && p.featureId === source.featureId && p.insertFeatureId === targetFeature.featureId
  );
  if (!pair) return { error: `"${source.featureId}" can't go into "${target.label}" ${port} from the ${side > 0 ? '+' : '-'} side` };
  const plan = planMates([pair], instanceId)[0];

  const pos = start.clone().add(plan.lateral);
  // Moves stop at first contact, so a tight fit counts here too
  const collidesAt = (vec) => {
    const col = checkCandidateCollision(placedAt(vec.toArray()), others);
    const touching = [...col.collidingWith, ...col.tightFits];
    return { isIntersecting: touching.length > 0, collidingWith: touching };
  };
  const startHit = collidesAt(pos);
  if (startHit.isIntersecting) {
    return { error: `the start pose outside ${port} already touches ${startHit.collidingWith.map((c) => c.label).join(', ')}` };
  }
  // Keep looking for contact while the insert is still in the opening; a blind opening's measured
  // floor is a hard stop (end-on contact between the eroded meshes is only seen ~0.76 mm too deep)
  const blind = !(isInsert(source) ? targetFeature : source).through;
  const sweep = blind ? plan.travelMm : Math.max(plan.travelMm, plan.sweepMm ?? 0);
  // Turn as the placement step will before moving in, so teeth or square flats don't stop it short:
  // a gear at the first point of its path where it meshes, anything else at the end of its travel
  const settleAt = (d) => {
    const at = pos.clone().addScaledVector(plan.direction, d).toArray().map((n) => Number(n.toFixed(3)));
    const moving = placedAt(at);
    return { at, settled: settlePlacedInstance(moving, [...others, moving], target.instanceId) };
  };
  let chosen = null;
  if (isMeshingGear(part)) {
    for (let d = 0; d <= sweep && !chosen; d += Math.max(1.5, sweep / 40)) {
      const probe = settleAt(d);
      if (probe.settled.mesh) chosen = probe;
    }
  }
  chosen ||= settleAt(plan.travelMm);
  const own = chosen.settled.patches.find((p) => p.instanceId === instanceId && p.rotation);
  if (own) {
    rotation = own.rotation;
    pos.add(new THREE.Vector3(...own.position).sub(new THREE.Vector3(...chosen.at)));
  }

  const lastClear = pos.clone();
  let final = null;
  let stoppedAgainst = null;
  for (let d = Math.min(INSERT_STEP_MM, sweep); d > 0; d = Math.min(d + INSERT_STEP_MM, sweep)) {
    const probe = pos.clone().addScaledVector(plan.direction, d);
    const hit = collidesAt(probe);
    if (hit.isIntersecting) {
      stoppedAgainst = hit.collidingWith.map((c) => c.label).join(', ');
      const lo = lastClear.clone();
      const hi = probe.clone();
      for (let i = 0; i < 10; i++) {
        const mid = lo.clone().lerp(hi, 0.5);
        if (collidesAt(mid).isIntersecting) hi.copy(mid);
        else lo.copy(mid);
      }
      final = lo;
      // Prefer a clean 0.25-pitch coordinate on the dominant axis within 0.95 mm, if it is clear
      const axisKey = ['x', 'y', 'z'].reduce((best, k) => (Math.abs(plan.direction[k]) > Math.abs(plan.direction[best]) ? k : best), 'x');
      const dir = Math.sign(plan.direction[axisKey]);
      const quarter = VEX_PITCH_MM * 0.25;
      const qVal = Number(((dir > 0 ? Math.floor((final[axisKey] + 0.05) / quarter) : Math.ceil((final[axisKey] - 0.05) / quarter)) * quarter).toFixed(3));
      if (Math.abs(final[axisKey] - qVal) <= 0.95 && (qVal - pos[axisKey]) * dir >= -0.01) {
        const candidate = final.clone();
        candidate[axisKey] = qVal;
        if (!collidesAt(candidate).isIntersecting) final = candidate;
      }
      break;
    }
    lastClear.copy(probe);
    if (d >= sweep) break;
  }
  if (!final) final = pos.clone().addScaledVector(plan.direction, plan.travelMm);

  // Rounding to 0.001 mm can land on the touching side: back off along the move until clear
  const roundVec = (vec) => new THREE.Vector3(...vec.toArray().map((n) => Number(n.toFixed(3)) + 0));
  let rounded = roundVec(final);
  for (let i = 0; i < 50 && collidesAt(rounded).isIntersecting; i++) {
    final.addScaledVector(plan.direction, -INSERT_BACK_OFF_MM);
    rounded = roundVec(final);
  }
  // The points used, by stable id (a split opening's `@lo` / `@hi` half named by its port)
  const portOf = (featureId) => featureId.replace(/@(lo|hi)$/, '');
  return {
    position: rounded.toArray(),
    rotation,
    stoppedAgainst: stoppedAgainst || 'flush with far face',
    preTurned: Boolean(own),
    ports: { source: portOf(source.featureId), into: portOf(targetFeature.featureId) }
  };
}
/**
 * Mirror image of a placed part across world plane x_i = offsetMm, as a proper pose. A mirror image
 * of a part is the part reflected; a real part can only be turned, so it is reflected once more
 * through one of its own middle planes x_k = c (L): with world reflection S, R' = S R L and
 * t' = S(R (2c e_k) + t). Of the three planes, one whose pins and openings land on the true mirror
 * image's wins (exact), then the one whose shape matches it best (a left- or right-handed part, or a
 * surface pattern that isn't symmetric). Returns { position, rotation, exact }.
 */
function mirrorPose(part, inst, axisIdx, offsetMm) {
  const R = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(...inst.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ')
  );
  const S = new THREE.Matrix4().makeScale(...[0, 1, 2].map((i) => (i === axisIdx ? -1 : 1)));
  const worldMirror = new THREE.Matrix4().makeTranslation(...[0, 1, 2].map((i) => (i === axisIdx ? 2 * offsetMm : 0))).multiply(S);
  const target = shapeCells(part, worldMirror.clone().multiply(buildWorldMatrix(inst.position, inst.rotation)));
  // The original's pins and openings reflected: a mirror pose is exact when its own land on these
  const reflectedEnds = worldFeaturesFor(inst).map((f) => ({ kind: f.kind, ends: [f.start.clone().applyMatrix4(worldMirror), f.end.clone().applyMatrix4(worldMirror)] }));
  const sameEnds = (p, q) =>
    (p[0].distanceTo(q[0]) <= 0.3 && p[1].distanceTo(q[1]) <= 0.3) || (p[0].distanceTo(q[1]) <= 0.3 && p[1].distanceTo(q[0]) <= 0.3);
  const portsMatch = (position, rotation) => {
    const own = worldFeaturesFor({ ...inst, position, rotation });
    return own.length === reflectedEnds.length && own.every((f) => reflectedEnds.some((g) => g.kind === f.kind && sameEnds([f.start, f.end], g.ends)));
  };
  let best = null;
  for (const k of [0, 1, 2]) {
    const L = new THREE.Matrix4().makeScale(...[0, 1, 2].map((i) => (i === k ? -1 : 1)));
    const Rp = new THREE.Matrix4().multiplyMatrices(S, R).multiply(L);
    const center = (part.bbox.min[k] + part.bbox.max[k]) / 2;
    const shift = new THREE.Vector3().setComponent(k, 2 * center).applyMatrix4(R);
    const t = new THREE.Vector3(...inst.position).add(shift).applyMatrix4(S);
    t.setComponent(axisIdx, t.getComponent(axisIdx) + 2 * offsetMm);
    const e = new THREE.Euler().setFromRotationMatrix(Rp, 'XYZ');
    const position = t.toArray().map((n) => Number(n.toFixed(3)) + 0);
    const rotation = [e.x, e.y, e.z].map((r) => Number(THREE.MathUtils.radToDeg(r).toFixed(2)) + 0);
    const ports = portsMatch(position, rotation);
    const score = shapeOverlap(target, shapeCells(part, buildWorldMatrix(position, rotation)));
    if (!best || (ports && !best.ports) || (ports === best.ports && score > best.score)) best = { position, rotation, ports, score };
  }
  return { position: best.position, rotation: best.rotation, exact: best.ports };
}

/** Swaps Left/Right and a standalone L/R in a label (keeping case), or adds " (mirror)" when it has neither. */
function mirrorLabel(label) {
  const pattern = /\b(left|right)\b|\b[LR]\b/gi;
  if (!/\b(left|right)\b|\b[LR]\b/i.test(label)) return `${label} (mirror)`;
  return label.replace(pattern, (w) => {
    if (w.length === 1) return w === 'L' ? 'R' : w === 'R' ? 'L' : w;
    const swap = /left/i.test(w) ? 'right' : 'left';
    if (w === w.toUpperCase()) return swap.toUpperCase();
    if (w[0] === w[0].toUpperCase()) return swap[0].toUpperCase() + swap.slice(1);
    return swap;
  });
}

/**
 * Mirror images of the items placed by placeParts across `mirror.plane` at `mirror.offsetMm`.
 * An item that is its own mirror image (e.g. a plate centered on the plane) is not doubled.
 * Returns { items: [{ index, ref, inst, mirrorApproximate }] } or { error }.
 */
function mirrorPlacedParts(placed, mirror) {
  const axisIdx = 'XYZ'.indexOf(String(mirror.plane || '').toUpperCase());
  if (axisIdx < 0) return { error: 'mirror.plane must be X, Y or Z' };
  const offsetMm = Number(mirror.offsetMm) || 0;
  const { catalogById } = getCatalog();
  const items = [];
  const stamp = Date.now();
  for (const p of placed) {
    const part = catalogById.get(p.inst.partId);
    const pose = mirrorPose(part, p.inst, axisIdx, offsetMm);
    const mirroredInst = { ...p.inst, instanceId: `inst-${stamp}-m${items.length.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, position: pose.position, rotation: pose.rotation };
    // New parts are added outside any group
    delete mirroredInst.groupId;
    delete mirroredInst.groupName;
    // Its own mirror image: every feature lands where the original's are
    const original = worldFeaturesFor(p.inst).map((f) => [f.start, f.end]);
    const image = worldFeaturesFor(mirroredInst).map((f) => [f.start, f.end]);
    const isSelf =
      original.length > 0 &&
      image.every(([a, b]) => original.some(([c, d]) => (a.distanceTo(c) < 0.05 && b.distanceTo(d) < 0.05) || (a.distanceTo(d) < 0.05 && b.distanceTo(c) < 0.05)));
    if (isSelf) continue;
    mirroredInst.label = mirrorLabel(p.inst.label);
    items.push({
      index: p.index,
      ref: p.ref !== undefined ? `${p.ref}#mirror` : undefined,
      inst: mirroredInst,
      ...(pose.exact ? {} : { mirrorApproximate: true })
    });
  }
  return { items };
}
