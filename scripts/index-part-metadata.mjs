import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  getCatalog,
  findPart,
  getPartCollisionBvh,
  buildWorldMatrix,
  VEX_PITCH_MM
} from '../mcp/assembly-engine.mjs';
import { getLocalFeatures, SHAFT_FASTENER_TYPES } from '../src/utils/pinHoleAlignment.js';
import {
  measureMotorHub,
  measureOpeningShape,
  measureRack,
  measureShaftFlat,
  measureSpurGear
} from './measure-part-geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT_DIR, 'public', 'catalog.json');
const METADATA_PATH = path.join(ROOT_DIR, 'public', 'part-metadata.json');

/**
 * Extracts ALL cylindrical surfaces (radius 1.4mm..6.5mm) from a STEP file without the 256 limit.
 */
function extractAllStepCylinders(stepFilePath) {
  if (!fs.existsSync(stepFilePath)) return [];
  const stepText = fs.readFileSync(stepFilePath, 'utf8');

  const points = new Map();
  const dirs = new Map();
  const axes = new Map();
  const cylinders = [];

  const ptRegex =
    /#(\d+)\s*=\s*CARTESIAN_POINT\s*\([^,]*,\s*\(\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*\)\s*\)/g;
  let m;
  while ((m = ptRegex.exec(stepText)) !== null) {
    points.set(m[1], [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]);
  }

  const dirRegex =
    /#(\d+)\s*=\s*DIRECTION\s*\([^,]*,\s*\(\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*\)\s*\)/g;
  while ((m = dirRegex.exec(stepText)) !== null) {
    dirs.set(m[1], [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]);
  }

  const axisRegex =
    /#(\d+)\s*=\s*AXIS2_PLACEMENT_3D\s*\([^,]*,\s*#(\d+)\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/g;
  while ((m = axisRegex.exec(stepText)) !== null) {
    axes.set(m[1], { pt: m[2], zDir: m[3], xDir: m[4] });
  }

  const cylRegex =
    /#(\d+)\s*=\s*CYLINDRICAL_SURFACE\s*\([^,]*,\s*#(\d+)\s*,\s*([-\d.Ee+]+)\s*\)/g;
  while ((m = cylRegex.exec(stepText)) !== null) {
    const axis = axes.get(m[2]);
    const radius = parseFloat(m[3]);
    if (!axis || radius < 1.4 || radius > 6.5) continue;
    const pt = points.get(axis.pt);
    const dir = dirs.get(axis.zDir);
    if (!pt || !dir) continue;
    cylinders.push({
      origin: [Number(pt[0].toFixed(3)), Number(pt[1].toFixed(3)), Number(pt[2].toFixed(3))],
      axis: [Number(dir[0].toFixed(3)), Number(dir[1].toFixed(3)), Number(dir[2].toFixed(3))],
      radius: Number(radius.toFixed(3))
    });
  }
  return cylinders;
}

/**
 * Canonicalizes a 3D unit axis vector so opposite directions map to the same positive canonical axis.
 */
function canonicalizeAxis(axis) {
  const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  let ax = axis[0] / len;
  let ay = axis[1] / len;
  let az = axis[2] / len;

  // Snap near-cardinal axes
  if (Math.abs(ax) > 0.999) {
    ax = Math.sign(ax);
    ay = 0;
    az = 0;
  } else if (Math.abs(ay) > 0.999) {
    ax = 0;
    ay = Math.sign(ay);
    az = 0;
  } else if (Math.abs(az) > 0.999) {
    ax = 0;
    ay = 0;
    az = Math.sign(az);
  }

  // Flip sign so the dominant component is always positive
  if (ax < -0.001 || (Math.abs(ax) <= 0.001 && (ay < -0.001 || (Math.abs(ay) <= 0.001 && az < -0.001)))) {
    ax = -ax;
    ay = -ay;
    az = -az;
  }

  return [Number(ax.toFixed(4)), Number(ay.toFixed(4)), Number(az.toFixed(4))];
}

/**
 * Groups raw STEP cylinders that lie along the same coaxial 3D line.
 */
function groupCoaxialCylinders(cylinders, bbox) {
  const groups = new Map();

  for (const cyl of cylinders) {
    const axis = canonicalizeAxis(cyl.axis);
    const [ox, oy, oz] = cyl.origin;
    const dot = ox * axis[0] + oy * axis[1] + oz * axis[2];
    // Perpendicular foot of origin onto the line from [0,0,0]
    const px = ox - dot * axis[0];
    const py = oy - dot * axis[1];
    const pz = oz - dot * axis[2];

    // Quantize perpendicular position to 0.25mm grid
    const key = `${axis[0].toFixed(2)},${axis[1].toFixed(2)},${axis[2].toFixed(2)}@${(
      Math.round(px * 4) / 4
    ).toFixed(2)},${(Math.round(py * 4) / 4).toFixed(2)},${(Math.round(pz * 4) / 4).toFixed(2)}`;

    let g = groups.get(key);
    if (!g) {
      g = {
        axis,
        perpOrigin: [Number(px.toFixed(3)), Number(py.toFixed(3)), Number(pz.toFixed(3))],
        tValues: [],
        radii: new Set(),
        hasLockingRidge: false, // r ~ 2.0..2.45mm
        hasPinBore: false       // r ~ 2.95..3.30mm
      };
      groups.set(key, g);
    }
    g.tValues.push(dot);
    g.radii.add(Number(cyl.radius.toFixed(2)));
    if (cyl.radius >= 1.95 && cyl.radius <= 2.48) g.hasLockingRidge = true;
    if (cyl.radius >= 2.95 && cyl.radius <= 3.32) g.hasPinBore = true;
  }

  const result = [];
  for (const g of groups.values()) {
    if (!g.hasLockingRidge && !g.hasPinBore) continue;
    const minT = Math.min(...g.tValues);
    const maxT = Math.max(...g.tValues);
    const midT = (minT + maxT) / 2;

    // Also clamp/project against part bounding box along cardinal axes
    let boxMinT = minT;
    let boxMaxT = maxT;
    if (g.axis[0] === 1) {
      boxMinT = bbox.min[0];
      boxMaxT = bbox.max[0];
    } else if (g.axis[1] === 1) {
      boxMinT = bbox.min[1];
      boxMaxT = bbox.max[1];
    } else if (g.axis[2] === 1) {
      boxMinT = bbox.min[2];
      boxMaxT = bbox.max[2];
    }

    result.push({
      axis: g.axis,
      perpOrigin: g.perpOrigin,
      midOrigin: [
        Number((g.perpOrigin[0] + midT * g.axis[0]).toFixed(3)),
        Number((g.perpOrigin[1] + midT * g.axis[1]).toFixed(3)),
        Number((g.perpOrigin[2] + midT * g.axis[2]).toFixed(3))
      ],
      minT: Number(minT.toFixed(3)),
      maxT: Number(maxT.toFixed(3)),
      boxMinT: Number(boxMinT.toFixed(3)),
      boxMaxT: Number(boxMaxT.toFixed(3)),
      radii: [...g.radii].sort((a, b) => a - b),
      hasLockingRidge: g.hasLockingRidge,
      hasPinBore: g.hasPinBore
    });
  }

  return result;
}

/**
 * Returns Euler XYZ rotation (in degrees) that aligns local +Z [0, 0, 1] with target `axis`.
 */
function eulerFromZAxis(axis) {
  if (Math.abs(axis[2]) > 0.99) return [0, 0, 0];
  if (Math.abs(axis[1]) > 0.99) return [90, 0, 0];
  if (Math.abs(axis[0]) > 0.99) return [0, 90, 0];

  const zVec = new THREE.Vector3(0, 0, 1);
  const targetVec = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(zVec, targetVec);
  const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
  return [
    Number(THREE.MathUtils.radToDeg(euler.x).toFixed(2)),
    Number(THREE.MathUtils.radToDeg(euler.y).toFixed(2)),
    Number(THREE.MathUtils.radToDeg(euler.z).toFixed(2))
  ];
}

/**
 * Fast direct MeshBVH probe check between a probe geometry (at world Pos + Rot) and target part's BVH.
 */
function probeIntersectsPart(probeBvh, probePos, probeRotDeg, partBvh) {
  const matProbe = buildWorldMatrix(probePos, probeRotDeg);
  const worldBoxProbe = probeBvh.localBox.clone().applyMatrix4(matProbe);
  if (!worldBoxProbe.intersectsBox(partBvh.localBox)) return false;
  return partBvh.colGeo.boundsTree.intersectsGeometry(probeBvh.colGeo, matProbe);
}

/**
 * Infers gear & sprocket mechanical specifications from part name and bounding box.
 */
function inferGearSpecs(part) {
  if (part.category !== 'Gears, Sprockets & Pulleys') return null;
  const toothMatch = part.name.match(/(\d+)\s*Tooth/i);
  const teeth = toothMatch ? parseInt(toothMatch[1], 10) : null;
  const lower = part.name.toLowerCase();

  let gearType = 'spur';
  if (lower.includes('bevel')) gearType = 'bevel';
  else if (lower.includes('crown')) gearType = 'crown';
  else if (lower.includes('worm')) gearType = 'worm';
  else if (lower.includes('rack')) gearType = 'rack';
  else if (lower.includes('sprocket')) gearType = 'sprocket';
  else if (lower.includes('pulley')) gearType = 'pulley';
  else if (lower.includes('differential')) gearType = 'differential';

  // Standard VEX IQ spur gear module is 12 teeth per 1.0x Pitch (12.7mm) diameter -> pitchRadius = (teeth / 24) * 12.7
  const pitchRadiusMm =
    teeth && gearType === 'spur'
      ? Number(((teeth / 24) * VEX_PITCH_MM).toFixed(3))
      : Number((Math.max(part.bbox.size[0], part.bbox.size[1]) / 2).toFixed(3));

  const phaseOffsetDeg = teeth ? Number((180 / teeth).toFixed(3)) : 0;

  return {
    gearType,
    teeth,
    pitchRadiusMm,
    phaseOffsetDeg,
    boreAxis: [0, 0, 1]
  };
}

/**
 * Infers fastener / standoff / shaft shoulder & engagement metadata.
 */
function inferFastenerSpecs(part) {
  const lower = part.name.toLowerCase();
  const [minX, minY, minZ] = part.bbox.min;
  const [maxX, maxY, maxZ] = part.bbox.max;

  if (lower.includes('connector pin')) {
    return {
      fastenerType: 'connector_pin',
      axis: [0, 0, 1],
      shoulderZ: 0,
      sideNegZ_mm: Number(Math.abs(minZ).toFixed(2)),
      sidePosZ_mm: Number(Math.abs(maxZ).toFixed(2)),
      sideNegZ_pitch: Number((Math.abs(minZ) / (VEX_PITCH_MM * 0.5)).toFixed(1)) * 0.5,
      sidePosZ_pitch: Number((Math.abs(maxZ) / (VEX_PITCH_MM * 0.5)).toFixed(1)) * 0.5,
      totalLengthMm: part.bbox.size[2]
    };
  }

  if (lower.includes('standoff') && !lower.includes('connector')) {
    const pinLen = 6.14;
    const bodyStartZ = Number((minZ + pinLen).toFixed(2));
    const bodyEndZ = Number((maxZ - pinLen).toFixed(2));
    return {
      fastenerType: 'standoff',
      axis: [0, 0, 1],
      shoulderNegZ: bodyStartZ,
      shoulderPosZ: bodyEndZ,
      bodyLengthMm: Number(Math.max(0, bodyEndZ - bodyStartZ).toFixed(2)),
      pinLengthMm: pinLen,
      totalLengthMm: part.bbox.size[2]
    };
  }

  if (lower.includes('shaft')) {
    const isCapped = lower.includes('capped');
    const isMotorShaft = lower.includes('motor') && !lower.includes('bushing');
    return {
      fastenerType: isMotorShaft ? 'motor_shaft' : isCapped ? 'capped_shaft' : 'straight_shaft',
      axis: [0, 0, 1],
      hasEndCap: isCapped || isMotorShaft,
      capShoulderZ: isCapped || isMotorShaft ? 0 : null,
      usableSpanZ: [Number(minZ.toFixed(2)), Number(maxZ.toFixed(2))],
      totalLengthMm: part.bbox.size[2]
    };
  }

  return null;
}

/**
 * Determines how the CAD file's local origin [0,0,0] relates to its bounding box.
 */
function classifyOriginType(part) {
  const [cx, cy, cz] = part.bbox.center;
  const distFromCenter = Math.hypot(cx, cy, cz);
  if (distFromCenter < 1.0) return 'centered';
  const [minX, minY, minZ] = part.bbox.min;
  const [maxX, maxY, maxZ] = part.bbox.max;
  if (Math.abs(maxY) < 1.0 || Math.abs(minY) < 1.0) return 'mounting_face';
  if (Math.abs(maxZ - 6.14) < 0.5 || Math.abs(maxZ - 0.8) < 0.5 || Math.abs(maxZ - 2.29) < 0.5) {
    return 'end_shoulder';
  }
  return 'offset';
}

/**
 * Assigns structural mass class and minimum recommended pin count so the assembly auditor
 * knows whether a component is properly secured.
 */
function classifyMountingRules(part) {
  const lower = part.name.toLowerCase();
  if (lower.includes('smart motor') || lower.includes('robot brain') || lower.includes('robot battery') || lower.includes('controller')) {
    return { massClass: 'heavy', minFastenersRequired: 4 };
  }
  if (part.category === 'Electronics & Motion' || part.category === 'Beams & Plates') {
    return { massClass: 'medium', minFastenersRequired: 2 };
  }
  return { massClass: 'light', minFastenersRequired: 1 };
}

function buildStepFileMap(dir, map = new Map()) {
  if (!fs.existsSync(dir)) return map;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      buildStepFileMap(full, map);
    } else if (entry.name.toLowerCase().endsWith('.step')) {
      map.set(entry.name, full);
    }
  }
  return map;
}

/**
 * Measured gear teeth, rack teeth, square bores and shafts and the Smart Motor hub (see
 * scripts/measure-part-geometry.mjs). Adds fields to `gearSpecs`, `fastenerSpecs` and the shaft
 * ports in place; returns rackSpecs and hubSpecs for parts that have them. Parts that should have
 * been measured but couldn't be are added to `unmeasured`.
 */
function measureShapes(part, ports, gearSpecs, fastenerSpecs, cylinders, unmeasured) {
  const features = getLocalFeatures({ ...part, ports, fastenerSpecs });
  const featureById = new Map(features.map((f) => [f.featureId, f]));
  let rackSpecs = null;
  let hubSpecs = null;

  if (gearSpecs?.gearType === 'spur') {
    const m = measureSpurGear(part, gearSpecs.teeth);
    if (m.measured) Object.assign(gearSpecs, m);
    else {
      gearSpecs.measured = false;
      if (gearSpecs.teeth && m.reason !== 'not a meshing gear') unmeasured.push(`${part.name}: ${m.reason}`);
    }
    // The gear's own center hole, whether or not a port was found for it (the idler gear has none)
    const z = part.bbox.center[2];
    gearSpecs.boreShape = measureOpeningShape(part, {
      origin: [0, 0, z],
      axis: [0, 0, 1],
      tMin: part.bbox.min[2],
      tMax: part.bbox.max[2]
    }).shape;
  } else if (gearSpecs?.gearType === 'rack') {
    const m = measureRack(part);
    if (m.measured) rackSpecs = m;
    else unmeasured.push(`${part.name}: ${m.reason}`);
  }

  for (const port of ports) {
    if (port.type !== 'shaft_bore' && port.type !== 'shaft_socket') continue;
    const f = featureById.get(port.portId);
    const shape = f ? measureOpeningShape(part, f) : { shape: 'round' };
    port.shape = shape.shape;
    if (shape.shape === 'square') port.squarePhaseDeg = shape.squarePhaseDeg;
    if (port.type === 'shaft_socket' && part.partNumber === '228-2560' && shape.shape === 'square') {
      hubSpecs = measureMotorHub(part, f, shape, cylinders);
      if (!hubSpecs) unmeasured.push(`${part.name}: drive hub not found`);
    }
  }

  if (SHAFT_FASTENER_TYPES.has(fastenerSpecs?.fastenerType)) {
    const flat = measureShaftFlat(part, fastenerSpecs.usableSpanZ);
    fastenerSpecs.shape = flat ? 'square' : 'round';
    if (flat) fastenerSpecs.squarePhaseDeg = flat.squarePhaseDeg;
  }
  return { rackSpecs, hubSpecs };
}

async function main() {
  const t0 = Date.now();
  const { catalog } = getCatalog();
  const stepFileMap = buildStepFileMap(path.join(ROOT_DIR, 'VEX-IQ-All-Parts'));
  buildStepFileMap(path.join(ROOT_DIR, 'VEX-IQ-All-Control'), stepFileMap);

  const refPinPart = findPart('228-2500-060');   // 1x1 Connector Pin
  const refShaftPart = findPart('228-2500-117'); // 2x Pitch Shaft
  const refPinBvh = getPartCollisionBvh(refPinPart);
  const refShaftBvh = getPartCollisionBvh(refShaftPart);

  const metadataById = {};
  let totalVerifiedPorts = 0;
  const unmeasured = [];

  for (let idx = 0; idx < catalog.length; idx++) {
    const part = catalog[idx];
    const partBvh = getPartCollisionBvh(part);

    const stepPath =
      stepFileMap.get(path.basename(part.file)) ||
      path.join(ROOT_DIR, part.file);

    const rawCylinders = fs.existsSync(stepPath)
      ? extractAllStepCylinders(stepPath)
      : part.cylinders || [];

    const coaxialGroups = groupCoaxialCylinders(rawCylinders, part.bbox);
    const ports = [];
    let holeCounter = 1;
    let boreCounter = 1;
    let pegCounter = 1;

    // 1. Classify coaxial cylinder groups using empirical MeshBVH Pin & Shaft probes
    for (const g of coaxialGroups) {
      const rot = eulerFromZAxis(g.axis);
      const [px, py, pz] = g.perpOrigin;
      const isThrough = Math.abs(g.boxMaxT - g.boxMinT) <= 13.5;
      const midT = isThrough
        ? Number(((g.boxMinT + g.boxMaxT) / 2).toFixed(3))
        : Number(((g.minT + g.maxT) / 2).toFixed(3));

      // Radial offset direction perpendicular to g.axis
      const radVec = Math.abs(g.axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];

      // A 1x1 Connector Pin has its center shoulder flange at local z=0 and two 6.14mm legs on -Z and +Z.
      // So when seated in a hole centered at t_hole, the pin center sits at t_hole ± 3.175mm (or on the entry face boxMinT / boxMaxT).
      const pinTestTs = [
        midT - 3.175,
        midT + 3.175,
        g.minT - 0.15,
        g.maxT + 0.15,
        g.boxMinT - 0.15,
        g.boxMaxT + 0.15
      ];

      let pinVerified = false;
      let holeOriginT = midT;

      for (const pt of pinTestTs) {
        const pinPos = [
          Number((px + pt * g.axis[0]).toFixed(3)),
          Number((py + pt * g.axis[1]).toFixed(3)),
          Number((pz + pt * g.axis[2]).toFixed(3))
        ];
        const shiftedPinPos = [
          pinPos[0] + radVec[0] * 2.6,
          pinPos[1] + radVec[1] * 2.6,
          pinPos[2] + radVec[2] * 2.6
        ];
        if (
          !probeIntersectsPart(refPinBvh, pinPos, rot, partBvh) &&
          probeIntersectsPart(refPinBvh, shiftedPinPos, rot, partBvh)
        ) {
          pinVerified = true;
          // If blind hole on a thick body, record the entry surface coordinate
          if (!isThrough) {
            holeOriginT = Math.abs(pt - g.boxMaxT) < Math.abs(pt - g.boxMinT) ? g.boxMaxT : g.boxMinT;
          }
          break;
        }
      }

      let verifiedType = null;
      let verifiedPos = [
        Number((px + holeOriginT * g.axis[0]).toFixed(3)),
        Number((py + holeOriginT * g.axis[1]).toFixed(3)),
        Number((pz + holeOriginT * g.axis[2]).toFixed(3))
      ];

      if (pinVerified && (g.hasLockingRidge || g.hasPinBore)) {
        verifiedType = 'pin_hole';
      } else {
        // Test if a 2x Pitch Shaft passes through or into the bore
        const shaftPos = [
          Number((px + midT * g.axis[0]).toFixed(3)),
          Number((py + midT * g.axis[1]).toFixed(3)),
          Number((pz + midT * g.axis[2]).toFixed(3))
        ];
        const shiftedShaftPos = [
          shaftPos[0] + radVec[0] * 2.6,
          shaftPos[1] + radVec[1] * 2.6,
          shaftPos[2] + radVec[2] * 2.6
        ];
        if (
          !probeIntersectsPart(refShaftBvh, shaftPos, rot, partBvh) &&
          probeIntersectsPart(refShaftBvh, shiftedShaftPos, rot, partBvh)
        ) {
          verifiedType = g.hasLockingRidge && g.hasPinBore ? 'pin_hole' : 'shaft_bore';
          verifiedPos = shaftPos;
        }
      }

      if (verifiedType && verifiedPos) {
        const id =
          verifiedType === 'pin_hole'
            ? `hole_${holeCounter++}`
            : `bore_${boreCounter++}`;
        ports.push({
          portId: id,
          type: verifiedType,
          origin: verifiedPos,
          axis: g.axis,
          through: isThrough,
          spanMm: [g.minT, g.maxT],
          pitchCoord: [
            Number((verifiedPos[0] / VEX_PITCH_MM).toFixed(2)),
            Number((verifiedPos[1] / VEX_PITCH_MM).toFixed(2)),
            Number((verifiedPos[2] / VEX_PITCH_MM).toFixed(2))
          ],
          verified: true
        });
      } else if (
        part.category === 'Pins & Standoffs' ||
        part.category === 'Connectors & Brackets'
      ) {
        // Male connector peg / stud
        ports.push({
          portId: `peg_${pegCounter++}`,
          type: 'pin_peg',
          origin: g.midOrigin,
          axis: g.axis,
          spanMm: [g.minT, g.maxT],
          verified: true
        });
      }
    }

    // 2. Check center shaft bore [0, 0, cZ] on Gears, Wheels, Pulleys, Collars, Spacers if not already found
    if (
      part.category === 'Gears, Sprockets & Pulleys' ||
      part.category === 'Wheels & Treads' ||
      part.category === 'Shafts, Spacers & Collars'
    ) {
      const hasCenterBore = ports.some(
        (p) => Math.hypot(p.origin[0], p.origin[1]) < 1.5
      );
      if (!hasCenterBore && !part.name.toLowerCase().includes('shaft')) {
        const centerPos = [0, 0, Number(part.bbox.center[2].toFixed(3))];
        const shaftFits = !probeIntersectsPart(refShaftBvh, centerPos, [0, 0, 0], partBvh);
        if (shaftFits) {
          ports.unshift({
            portId: 'center_shaft_bore',
            type: 'shaft_bore',
            origin: centerPos,
            axis: [0, 0, 1],
            through: true,
            spanMm: [part.bbox.min[2], part.bbox.max[2]],
            pitchCoord: [0, 0, 0],
            verified: true
          });
        }
      }
    }

    // 3. Dedicated Smart Motor (228-2560) & Robot Brain (228-2540) verified socket/flange ports
    if (part.partNumber === '228-2560') {
      ports.unshift({
        portId: 'motor_drive_socket',
        type: 'shaft_socket',
        origin: [-9.525, 0, 0],
        axis: [0, 1, 0],
        through: false,
        maxDepthMm: 4.7,
        pitchCoord: [-0.75, 0, 0],
        verified: true
      });
    } else if (part.partNumber === '228-2540') {
      // Ensure all 16 verified horizontal side mounting holes (z = ±38.0, y = -6.35) are explicitly indexed
      const brainSideXs = [-44.45, -31.75, -19.05, -6.35, 6.35, 19.05, 31.75, 44.45];
      for (const side of [
        { tag: 'left', z: -38.0, axis: [0, 0, 1] },
        { tag: 'right', z: 38.0, axis: [0, 0, 1] }
      ]) {
        brainSideXs.forEach((bx, i) => {
          const exists = ports.some(
            (p) =>
              Math.abs(p.origin[0] - bx) < 1 &&
              Math.abs(p.origin[1] - -6.35) < 1 &&
              Math.abs(p.origin[2] - side.z) < 4
          );
          if (!exists) {
            ports.push({
              portId: `brain_${side.tag}_mount_${i + 1}`,
              type: 'pin_hole',
              origin: [bx, -6.35, side.z],
              axis: side.axis,
              through: false,
              depthMm: 6.35,
              pitchCoord: [Number((bx / VEX_PITCH_MM).toFixed(2)), -0.5, side.z / VEX_PITCH_MM],
              verified: true
            });
          }
        });
      }
    }

    totalVerifiedPorts += ports.length;

    const pitchSize = [
      Number((part.bbox.size[0] / VEX_PITCH_MM).toFixed(2)),
      Number((part.bbox.size[1] / VEX_PITCH_MM).toFixed(2)),
      Number((part.bbox.size[2] / VEX_PITCH_MM).toFixed(2))
    ];
    const originType = classifyOriginType(part);
    const gearSpecs = inferGearSpecs(part);
    const fastenerSpecs = inferFastenerSpecs(part);
    const mountingRules = classifyMountingRules(part);
    const { rackSpecs, hubSpecs } = measureShapes(part, ports, gearSpecs, fastenerSpecs, rawCylinders, unmeasured);

    const portCounts = {
      total: ports.length,
      pinHoles: ports.filter((p) => p.type === 'pin_hole').length,
      shaftBores: ports.filter((p) => p.type === 'shaft_bore' || p.type === 'shaft_socket').length,
      pinPegs: ports.filter((p) => p.type === 'pin_peg').length
    };

    const metaEntry = {
      id: part.id,
      partNumber: part.partNumber,
      name: part.name,
      category: part.category,
      pitchSize,
      originType,
      gearSpecs,
      ...(rackSpecs ? { rackSpecs } : {}),
      fastenerSpecs,
      ...(hubSpecs ? { hubSpecs } : {}),
      mountingRules,
      portCounts,
      ports
    };

    metadataById[part.id] = metaEntry;

    // Also attach summary + ports to catalog entry for instant UI / MCP access
    part.pitchSize = pitchSize;
    part.originType = originType;
    part.gearSpecs = gearSpecs;
    if (rackSpecs) part.rackSpecs = rackSpecs;
    part.fastenerSpecs = fastenerSpecs;
    if (hubSpecs) part.hubSpecs = hubSpecs;
    part.mountingRules = mountingRules;
    part.portCounts = portCounts;
    part.ports = ports;
  }

  fs.writeFileSync(
    METADATA_PATH,
    JSON.stringify(
      {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        partCount: catalog.length,
        totalVerifiedPorts,
        parts: metadataById
      },
      null,
      2
    )
  );

  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2));

  if (unmeasured.length) {
    console.log(`Couldn't measure ${unmeasured.length} part(s); they won't be turned to mesh or fit:`);
    for (const u of unmeasured) console.log(`  ${u}`);
  }
  console.log(
    `Indexed ${catalog.length} parts with ${totalVerifiedPorts} verified semantic ports in ${(
      (Date.now() - t0) /
      1000
    ).toFixed(2)}s.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
