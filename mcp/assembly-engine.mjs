import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const CATALOG_PATH = path.join(ROOT_DIR, 'public', 'catalog.json');
export const STATE_PATH = path.join(ROOT_DIR, 'public', 'assembly-state.json');
export const VEX_PITCH_MM = 12.7;

let catalogCache = null;
let catalogById = null;
let catalogMtimeMs = 0;
const bvhCache = new Map(); // partId -> { colGeo, localBox }

export function getCatalog() {
  const stat = fs.statSync(CATALOG_PATH);
  if (!catalogCache || stat.mtimeMs !== catalogMtimeMs) {
    catalogCache = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    catalogById = new Map(catalogCache.map((p) => [p.id, p]));
    catalogMtimeMs = stat.mtimeMs;
  }
  return { catalog: catalogCache, catalogById };
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
export function getPartCollisionBvh(part) {
  if (bvhCache.has(part.id)) {
    return bvhCache.get(part.id);
  }

  const glbPath = path.join(ROOT_DIR, 'public', part.modelUrl.replace(/^\//, ''));
  const buf = fs.readFileSync(glbPath);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  const binOffset = 20 + jsonLen + 8;

  const posBv = gltf.bufferViews[0];
  const normBv = gltf.bufferViews[1];
  const idxBv = gltf.bufferViews[2];

  const pos = new Float32Array(
    buf.buffer,
    buf.byteOffset + binOffset + posBv.byteOffset,
    posBv.byteLength / 4
  );
  const norm = new Float32Array(
    buf.buffer,
    buf.byteOffset + binOffset + normBv.byteOffset,
    normBv.byteLength / 4
  );
  const IdxType = gltf.accessors[2].componentType === 5125 ? Uint32Array : Uint16Array;
  const idx = new IdxType(
    buf.buffer,
    buf.byteOffset + binOffset + idxBv.byteOffset,
    idxBv.byteLength / IdxType.BYTES_PER_ELEMENT
  );

  const clearanceMm = 0.38;
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

  const entry = { colGeo, localBox: colGeo.boundingBox.clone() };
  bvhCache.set(part.id, entry);
  return entry;
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

/**
 * Checks if a candidate instance (partId, position, rotation) intersects any other
 * visible instance in the assembly list. Returns { isIntersecting, collidingWith: [...] }.
 */
export function checkCandidateCollision(candidate, instances) {
  const { catalogById } = getCatalog();
  const partA = catalogById.get(candidate.partId);
  if (!partA) return { isIntersecting: false, collidingWith: [] };

  const { colGeo: geoA, localBox: boxA } = getPartCollisionBvh(partA);
  const matA = buildWorldMatrix(candidate.position, candidate.rotation);
  const worldBoxA = boxA.clone().applyMatrix4(matA);
  const invMatA = matA.clone().invert();
  const matBtoA = new THREE.Matrix4();

  const collidingWith = [];

  for (const other of instances) {
    if (other.instanceId === candidate.instanceId) continue;
    if (other.visible === false) continue;
    const partB = catalogById.get(other.partId);
    if (!partB) continue;

    const { colGeo: geoB, localBox: boxB } = getPartCollisionBvh(partB);
    const matB = buildWorldMatrix(other.position, other.rotation);
    const worldBoxB = boxB.clone().applyMatrix4(matB);

    if (!worldBoxA.intersectsBox(worldBoxB)) continue;

    matBtoA.multiplyMatrices(invMatA, matB);
    if (geoA.boundsTree.intersectsGeometry(geoB, matBtoA)) {
      collidingWith.push({
        instanceId: other.instanceId,
        label: other.label,
        partNumber: partB.partNumber
      });
    }
  }

  return {
    isIntersecting: collidingWith.length > 0,
    collidingWith
  };
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

export function readAssemblyState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      if (data && Array.isArray(data.instances)) {
        return data;
      }
    }
  } catch {
    // fallback below
  }
  const initial = buildDefaultStarterState();
  fs.writeFileSync(STATE_PATH, JSON.stringify(initial, null, 2));
  return initial;
}

export async function writeAssemblyState(nextState, notifyVite = true) {
  const state = {
    ...nextState,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

  if (notifyVite) {
    try {
      const port = process.env.VEXIQ_APP_PORT || 5173;
      await fetch(`http://localhost:${port}/api/assembly`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-mcp-source': 'mcp-server' },
        body: JSON.stringify(state)
      });
    } catch {
      // Vite server might not be running or reachable; file state is already persisted
    }
  }
  return state;
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
 * 2) Unconnected / floating fasteners (`floatingFasteners`)
 * 3) Unsecured parts & Single-Pin Pivot warnings (`unsecuredParts`, `singlePinPivotParts`, `underSecuredHeavyParts`)
 * 4) Full Mechanical Connectivity Graph & Disconnected Island detection (`connectedComponentCount`, `disconnectedIslands`)
 * 5) Shaft Protrusion / Overhang check (`protrudingShafts`)
 * 6) Kinematic Drivetrain Power Tracing from Smart Motors -> Shafts -> Meshing Gears -> Wheels (`kinematics`)
 */
export function auditAssembly(state) {
  const { catalogById } = getCatalog();
  const visible = (state.instances || []).filter((i) => i.visible !== false);

  const collisions = [];
  const rawWorldBoxes = new Map();
  const expandedWorldBoxes = new Map();
  const nonFasteners = [];
  const fasteners = [];

  for (const inst of visible) {
    const part = catalogById.get(inst.partId);
    if (!part) continue;

    const col = checkCandidateCollision(inst, visible);
    if (col.isIntersecting) {
      collisions.push({
        instanceId: inst.instanceId,
        label: inst.label,
        collidingWith: col.collidingWith.map((c) => c.label)
      });
    }

    const mat = buildWorldMatrix(inst.position, inst.rotation);
    const rawBox = new THREE.Box3(
      new THREE.Vector3(...part.bbox.min),
      new THREE.Vector3(...part.bbox.max)
    ).applyMatrix4(mat);
    rawWorldBoxes.set(inst.instanceId, rawBox);

    // Expand box slightly (0.6mm) so flush surface-mounted parts register engagement with pins/shafts
    const expBox = rawBox.clone().expandByScalar(0.6);
    expandedWorldBoxes.set(inst.instanceId, expBox);

    const isFastener =
      part.category === 'Pins & Standoffs' ||
      (part.category === 'Shafts, Spacers & Collars' &&
        part.name.toLowerCase().includes('shaft')) ||
      part.name.toLowerCase().includes('shaft');

    if (isFastener) {
      fasteners.push({ inst, part, mat });
    } else {
      nonFasteners.push({ inst, part, mat });
    }
  }

  const fastenerCountByPartInstance = new Map(nonFasteners.map((n) => [n.inst.instanceId, 0]));
  const floatingFasteners = [];
  const engagedByFastener = new Map();

  // Adjacency list for the mechanical connectivity graph over nonFasteners
  const adjacency = new Map(nonFasteners.map((n) => [n.inst.instanceId, new Set()]));

  for (const f of fasteners) {
    const { inst } = f;
    const engagedParts = [];
    const fBox = expandedWorldBoxes.get(inst.instanceId);

    for (const nf of nonFasteners) {
      const nfBox = expandedWorldBoxes.get(nf.inst.instanceId);
      if (nfBox && fBox && nfBox.intersectsBox(fBox)) {
        engagedParts.push(nf);
      }
    }

    engagedByFastener.set(inst.instanceId, engagedParts);

    if (engagedParts.length < 2) {
      floatingFasteners.push({
        instanceId: inst.instanceId,
        label: inst.label,
        engagedWith: engagedParts.map((e) => e.inst.label)
      });
    } else {
      for (let i = 0; i < engagedParts.length; i++) {
        const idA = engagedParts[i].inst.instanceId;
        fastenerCountByPartInstance.set(idA, (fastenerCountByPartInstance.get(idA) || 0) + 1);
        for (let j = i + 1; j < engagedParts.length; j++) {
          const idB = engagedParts[j].inst.instanceId;
          adjacency.get(idA)?.add(idB);
          adjacency.get(idB)?.add(idA);
        }
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

  // Check Shaft Protrusion / Overhang beyond outermost engaged parts
  const protrudingShafts = [];
  for (const f of fasteners) {
    const isShaft =
      f.part.fastenerSpecs?.fastenerType === 'shaft' ||
      f.part.name.toLowerCase().includes('shaft');
    if (!isShaft) continue;

    const engaged = engagedByFastener.get(f.inst.instanceId) || [];
    if (engaged.length === 0) continue;

    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(f.inst.rotation[0] || 0),
      THREE.MathUtils.degToRad(f.inst.rotation[1] || 0),
      THREE.MathUtils.degToRad(f.inst.rotation[2] || 0),
      'XYZ'
    );
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const shaftAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(quat).normalize();

    const pMinWorld = new THREE.Vector3(0, 0, f.part.bbox.min[2]).applyMatrix4(f.mat);
    const pMaxWorld = new THREE.Vector3(0, 0, f.part.bbox.max[2]).applyMatrix4(f.mat);
    const t0 = pMinWorld.dot(shaftAxis);
    const t1 = pMaxWorld.dot(shaftAxis);
    const shaftMinT = Math.min(t0, t1);
    const shaftMaxT = Math.max(t0, t1);

    let engagedMinT = Infinity;
    let engagedMaxT = -Infinity;

    for (const ep of engaged) {
      const box = rawWorldBoxes.get(ep.inst.instanceId);
      if (!box) continue;
      const corners = [
        new THREE.Vector3(box.min.x, box.min.y, box.min.z),
        new THREE.Vector3(box.min.x, box.min.y, box.max.z),
        new THREE.Vector3(box.min.x, box.max.y, box.min.z),
        new THREE.Vector3(box.min.x, box.max.y, box.max.z),
        new THREE.Vector3(box.max.x, box.min.y, box.min.z),
        new THREE.Vector3(box.max.x, box.min.y, box.max.z),
        new THREE.Vector3(box.max.x, box.max.y, box.min.z),
        new THREE.Vector3(box.max.x, box.max.y, box.max.z)
      ];
      for (const c of corners) {
        const proj = c.dot(shaftAxis);
        if (proj < engagedMinT) engagedMinT = proj;
        if (proj > engagedMaxT) engagedMaxT = proj;
      }
    }

    const negOverhangMm = Number(Math.max(0, engagedMinT - shaftMinT).toFixed(2));
    const posOverhangMm = Number(Math.max(0, shaftMaxT - engagedMaxT).toFixed(2));
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
        adjacency.get(gA.inst.instanceId)?.add(gB.inst.instanceId);
        adjacency.get(gB.inst.instanceId)?.add(gA.inst.instanceId);
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
          adjacency.get(a)?.add(nfTarget.inst.instanceId);
          adjacency.get(b)?.add(nfTarget.inst.instanceId);
          adjacency.get(nfTarget.inst.instanceId)?.add(a);
          adjacency.get(nfTarget.inst.instanceId)?.add(b);
        }
      }
    }
  }

  // Connected Components BFS over nonFasteners
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
      const item = nonFasteners.find((x) => x.inst.instanceId === curr);
      if (item) comp.push({ instanceId: curr, label: item.inst.label });
      for (const nxt of adjacency.get(curr) || []) {
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
  const shaftFasteners = fasteners.filter(
    (f) =>
      f.part.fastenerSpecs?.fastenerType === 'shaft' ||
      f.part.name.toLowerCase().includes('shaft')
  );

  // Map each shaft to its coaxial engaged gears, wheels, and motors
  const shaftToCoaxialParts = new Map();
  const partToCoaxialShafts = new Map();

  for (const sf of shaftFasteners) {
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(sf.inst.rotation[0] || 0),
      THREE.MathUtils.degToRad(sf.inst.rotation[1] || 0),
      THREE.MathUtils.degToRad(sf.inst.rotation[2] || 0),
      'XYZ'
    );
    const shaftAxis = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(new THREE.Quaternion().setFromEuler(euler))
      .normalize();
    const shaftPos = new THREE.Vector3(...sf.inst.position);

    const engaged = engagedByFastener.get(sf.inst.instanceId) || [];
    const coaxialList = [];

    for (const ep of engaged) {
      // Check if ep has a shaft_socket, shaft_bore, or center coaxial with shaftAxis
      const ports = getWorldPortsForInstance(ep.inst);
      const centerWorld = new THREE.Vector3(...ep.part.bbox.center).applyMatrix4(ep.mat);
      const candidates = [
        ...ports.map((p) => new THREE.Vector3(...p.worldOrigin)),
        centerWorld
      ];
      const isCoaxial = candidates.some((pt) => {
        const d = pt.clone().sub(shaftPos);
        const perp = d.clone().addScaledVector(shaftAxis, -d.dot(shaftAxis));
        return perp.length() <= 2.2;
      });
      if (isCoaxial) {
        coaxialList.push(ep);
        if (!partToCoaxialShafts.has(ep.inst.instanceId)) {
          partToCoaxialShafts.set(ep.inst.instanceId, []);
        }
        partToCoaxialShafts.get(ep.inst.instanceId).push(sf);
      }
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
      unsecuredParts.length === 0 &&
      underSecuredHeavyParts.length === 0 &&
      disconnectedIslands.length === 0 &&
      protrudingShafts.length === 0,
    collisionCount: collisions.length,
    collisions,
    floatingFastenerCount: floatingFasteners.length,
    floatingFasteners,
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
    tPort = targetPorts.find((p) => p.portId === targetPortId.trim());
  }
  if (!tPort) {
    tPort = targetPorts[0];
  }

  const sPorts = Array.isArray(sourcePart.ports) ? sourcePart.ports : [];
  let sPort = null;
  if (typeof sourcePortId === 'string' && sourcePortId.trim()) {
    sPort = sPorts.find((p) => p.portId === sourcePortId.trim());
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
    (startPortId && beamPorts.find((p) => p.portId === startPortId)) || beamPorts[0];

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

    // Try phase angles (starting with alternating phaseOffsetDeg) to guarantee zero collision with previous gear
    const basePhase = i % 2 === 1 ? spec.phaseOffsetDeg || 5 : 0;
    const candidateRolls = [basePhase, 0, spec.phaseOffsetDeg || 5, 3.75, 7.5, 15];
    let chosenMate = null;
    let chosenCol = null;

    for (const roll of candidateRolls) {
      const mate = computeMateTransform(gearPart, null, beamInst, currentPort.portId, {
        axialOffsetMm: computedAxialOffset,
        rollDeg: roll
      });
      const tempInst = {
        instanceId: `inst-gear-${Date.now()}-${i}`,
        partId: gearPart.id,
        position: mate.position,
        rotation: mate.rotation,
        visible: true
      };
      const col = checkCandidateCollision(tempInst, workingInstances);
      if (!col.isIntersecting) {
        chosenMate = { ...mate, rollDeg: roll };
        chosenCol = col;
        break;
      }
      if (!chosenMate) {
        chosenMate = { ...mate, rollDeg: roll };
        chosenCol = col;
      }
    }

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
      pitchRadiusMm: spec.pitchRadiusMm
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
                rollDeg: chosenMate.rollDeg
              }
            );
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
 * Automatically compensates for asymmetric VEX IQ parts (`end_shoulder` Capped Shafts, Standoffs,
 * `1x2 Connector Pins`, and `mounting_face` Smart Motors) and verifies each mirrored instance with `MeshBVH`.
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

    // Reflect position across mirrorPlane = planeOffsetMm
    const reflPos = [...src.position];
    reflPos[axisIdx] = Number((2 * planeOffsetMm - src.position[axisIdx]).toFixed(3));

    // Candidate rotations to test (handles symmetric parts, 180-flipped Z-axis pins/shafts, and Y-axis motors)
    const r = src.rotation || [0, 0, 0];
    const candidateRotations = [
      [...r],
      [Number(((r[0] + 180) % 360).toFixed(2)), r[1], r[2]],
      [r[0], Number(((r[1] + 180) % 360).toFixed(2)), r[2]],
      [Number((-r[0]).toFixed(2)), Number(((180 - r[1]) % 360).toFixed(2)), r[2]],
      [Number((-r[0]).toFixed(2)), r[1], Number(((180 - r[2]) % 360).toFixed(2))]
    ];

    // If part is asymmetric and its world center was shifted by origin offset, prioritize rotations that mirror its world bounding box center cleanly!
    const srcMat = buildWorldMatrix(src.position, src.rotation);
    const srcWorldCenter = new THREE.Vector3(...part.bbox.center).applyMatrix4(srcMat);
    const desiredMirroredCenter = srcWorldCenter.clone();
    desiredMirroredCenter.setComponent(
      axisIdx,
      2 * planeOffsetMm - srcWorldCenter.getComponent(axisIdx)
    );

    // Sort candidateRotations by how closely they place the mirrored part's bbox.center at desiredMirroredCenter
    const scoredCandidates = candidateRotations.map((candRot) => {
      const m = buildWorldMatrix(reflPos, candRot);
      const c = new THREE.Vector3(...part.bbox.center).applyMatrix4(m);
      return {
        rot: candRot,
        centerError: c.distanceTo(desiredMirroredCenter)
      };
    });
    scoredCandidates.sort((a, b) => a.centerError - b.centerError);

    let chosenRot = scoredCandidates[0].rot;
    let chosenCol = { isIntersecting: false, collidingWith: [] };

    for (const cand of scoredCandidates) {
      const temp = {
        instanceId: `inst-mirror-${Date.now()}-${idx}`,
        partId: src.partId,
        position: reflPos,
        rotation: cand.rot,
        visible: true
      };
      const col = checkCandidateCollision(temp, workingInstances);
      if (!col.isIntersecting && cand.centerError < 1.5) {
        chosenRot = cand.rot;
        chosenCol = col;
        break;
      }
    }

    // Generate mirrored label (e.g. Left <-> Right or Front <-> Rear)
    let newLabel = src.label;
    if (/left/i.test(newLabel)) newLabel = newLabel.replace(/Left/g, 'Right').replace(/left/g, 'right');
    else if (/right/i.test(newLabel)) newLabel = newLabel.replace(/Right/g, 'Left').replace(/right/g, 'left');
    else if (/front/i.test(newLabel)) newLabel = newLabel.replace(/Front/g, 'Rear').replace(/front/g, 'rear');
    else if (/rear/i.test(newLabel)) newLabel = newLabel.replace(/Rear/g, 'Front').replace(/rear/g, 'front');
    else newLabel = `${src.label} (Mirrored)`;

    const mirroredInst = {
      instanceId: `inst-${Date.now()}-mir-${idx + 1}`,
      partId: src.partId,
      label: newLabel,
      position: reflPos,
      rotation: chosenRot,
      lastValidPosition: reflPos,
      lastValidRotation: chosenRot,
      isIntersecting: chosenCol.isIntersecting,
      color: src.color,
      visible: src.visible,
      locked: false
    };

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

  const blueprintPath = path.join(ROOT_DIR, 'public', 'assembly-blueprint.svg');
  fs.writeFileSync(blueprintPath, svgParts.join('\n'));

  return {
    ok: true,
    blueprintFilePath: blueprintPath,
    blueprintUrl: '/assembly-blueprint.svg',
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



