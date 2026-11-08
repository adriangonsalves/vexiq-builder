import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  getCatalog,
  findPart,
  getPartCollisionBvh,
  getPartRawGeometry,
  buildWorldMatrix,
  VEX_PITCH_MM
} from '../mcp/assembly-engine.mjs';
import { getLocalFeatures, measurePinEnds, SHAFT_FASTENER_TYPES, THIN_PART_MAX_MM } from '../src/utils/pinHoleAlignment.js';
import {
  measureMotorHub,
  measureOpeningShape,
  measureRack,
  measureShaftFlat,
  measureSpurGear,
  measureSprocket
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

  // A file made of placed pieces (an assembly) gives each piece's surfaces in that piece's own
  // frame; the model the app shows has every piece moved into place, so the cylinders must be too.
  const placementsOf = stepPiecePlacements(stepText, points, dirs, axes);

  const cylRegex =
    /#(\d+)\s*=\s*CYLINDRICAL_SURFACE\s*\([^,]*,\s*#(\d+)\s*,\s*([-\d.Ee+]+)\s*\)/g;
  const p = new THREE.Vector3();
  const d = new THREE.Vector3();
  while ((m = cylRegex.exec(stepText)) !== null) {
    const axis = axes.get(m[2]);
    const radius = parseFloat(m[3]);
    if (!axis || radius < 1.4 || radius > 6.5) continue;
    const pt = points.get(axis.pt);
    const dir = dirs.get(axis.zDir);
    if (!pt || !dir) continue;
    for (const matrix of placementsOf(m[1])) {
      p.set(...pt).applyMatrix4(matrix);
      d.set(...dir).transformDirection(matrix);
      cylinders.push({
        origin: [Number(p.x.toFixed(3)), Number(p.y.toFixed(3)), Number(p.z.toFixed(3))],
        axis: [Number(d.x.toFixed(3)), Number(d.y.toFixed(3)), Number(d.z.toFixed(3))],
        radius: Number(radius.toFixed(3))
      });
    }
  }
  return cylinders;
}

/**
 * For a STEP assembly: returns `placementsOf(entityId)`, the matrices (piece frame -> whole part)
 * for the piece whose shape holds that entity, one per place the piece is used. Pieces are joined by
 * REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION (an ITEM_DEFINED_TRANSFORMATION of two
 * placements: the piece's place in the parent and its origin in its own frame) and by plain
 * SHAPE_REPRESENTATION_RELATIONSHIPs (same frame). A single-body file gives the identity.
 */
function stepPiecePlacements(stepText, points, dirs, axes) {
  const IDENTITY = [new THREE.Matrix4()];
  if (!/REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION/.test(stepText)) return () => IDENTITY;

  // Every entity's references, and the item lists of the shape representations
  const refs = new Map();
  const repItems = new Map();
  const entityRegex = /#(\d+)\s*=\s*([\s\S]*?);\s*(?=#\d+\s*=|ENDSEC)/g;
  let m;
  while ((m = entityRegex.exec(stepText)) !== null) {
    const body = m[2];
    refs.set(m[1], [...body.matchAll(/#(\d+)/g)].map((r) => r[1]));
    // Shape representations only (colour/style "presentation" records point at the same geometry)
    const rep = /^\s*\w*SHAPE_REPRESENTATION\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)/.exec(body);
    if (rep) repItems.set(m[1], [...rep[1].matchAll(/#(\d+)/g)].map((r) => r[1]));
  }

  const placement = (id) => {
    const a = axes.get(id);
    const origin = points.get(a?.pt);
    if (!a || !origin) return new THREE.Matrix4();
    const z = new THREE.Vector3(...(dirs.get(a.zDir) || [0, 0, 1])).normalize();
    let x = new THREE.Vector3(...(dirs.get(a.xDir) || [1, 0, 0]));
    x = x.sub(z.clone().multiplyScalar(x.dot(z)));
    if (x.lengthSq() < 1e-9) x = new THREE.Vector3(Math.abs(z.x) < 0.9 ? 1 : 0, Math.abs(z.x) < 0.9 ? 0 : 1, 0).sub(z.clone().multiplyScalar(Math.abs(z.x) < 0.9 ? z.x : z.y));
    x.normalize();
    const y = new THREE.Vector3().crossVectors(z, x);
    return new THREE.Matrix4().makeBasis(x, y, z).setPosition(...origin);
  };

  // child rep -> [{ parent rep, matrix child frame -> parent frame }]; same-frame links both ways
  const parents = new Map();
  const sameFrame = new Map();
  const addSame = (a, b) => {
    if (!sameFrame.has(a)) sameFrame.set(a, []);
    sameFrame.get(a).push(b);
  };
  const transformed = /#\d+\s*=\s*\(\s*REPRESENTATION_RELATIONSHIP\s*\([^,]*,[^,]*,\s*#(\d+)\s*,\s*#(\d+)\s*\)\s*REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION\s*\(\s*#(\d+)\s*\)/g;
  while ((m = transformed.exec(stepText)) !== null) {
    const [, rep1, rep2, transformId] = m;
    const t = /ITEM_DEFINED_TRANSFORMATION\s*\([^,]*,[^,]*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/.exec(
      stepText.slice(stepText.search(new RegExp(`#${transformId}\\s*=`)))
    );
    if (!t) continue;
    const [, item1, item2] = t;
    // item1 is the piece's place in the parent: the parent is the rep that lists it
    const parent = repItems.get(rep2)?.includes(item1) && !repItems.get(rep1)?.includes(item1) ? rep2 : rep1;
    const child = parent === rep1 ? rep2 : rep1;
    const matrix = placement(item1).multiply(placement(item2).invert());
    if (!parents.has(child)) parents.set(child, []);
    parents.get(child).push({ parent, matrix });
  }
  const plain = /#\d+\s*=\s*SHAPE_REPRESENTATION_RELATIONSHIP\s*\([^,]*,[^,]*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/g;
  while ((m = plain.exec(stepText)) !== null) {
    addSame(m[1], m[2]);
    addSame(m[2], m[1]);
  }

  // All matrices from a rep's frame to the whole part (several when a piece is used several times)
  const toRootCache = new Map();
  const toRoot = (rep, seen = new Set()) => {
    if (toRootCache.has(rep)) return toRootCache.get(rep);
    seen.add(rep);
    const group = [rep];
    for (let i = 0; i < group.length; i++) {
      for (const other of sameFrame.get(group[i]) || []) if (!group.includes(other)) group.push(other);
    }
    const out = [];
    for (const r of group) {
      for (const { parent, matrix } of parents.get(r) || []) {
        if (seen.has(parent)) continue;
        for (const up of toRoot(parent, new Set(seen))) out.push(up.clone().multiply(matrix));
      }
    }
    const result = out.length ? out : IDENTITY;
    toRootCache.set(rep, result);
    return result;
  };

  // Which rep each entity's geometry belongs to: walk down from each rep's items
  const owner = new Map();
  for (const [rep, items] of repItems) {
    const stack = [...items];
    while (stack.length) {
      const id = stack.pop();
      if (owner.has(id)) continue;
      owner.set(id, rep);
      for (const r of refs.get(id) || []) stack.push(r);
    }
  }
  return (entityId) => (owner.has(entityId) ? toRoot(owner.get(entityId)) : IDENTITY);
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
function groupCoaxialCylinders(cylinders, bbox, thinRing = false) {
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
    let minT = Math.min(...g.tValues);
    let maxT = Math.max(...g.tValues);
    // All of a hole's surfaces placed on one face gives no length; through a spacer or washer (no
    // thicker than half a pitch along the hole) the hole runs its whole thickness
    const k = g.axis.findIndex((a) => Math.abs(a) === 1);
    if (thinRing && maxT - minT < 0.01 && k >= 0 && bbox.max[k] - bbox.min[k] <= VEX_PITCH_MM / 2 + 0.1) {
      minT = Math.min(bbox.min[k] * g.axis[k], bbox.max[k] * g.axis[k]);
      maxT = Math.max(bbox.min[k] * g.axis[k], bbox.max[k] * g.axis[k]);
    }
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
/**
 * The stretch [tStart, tEnd] of a coaxial group's line where the part is a peg the size of a pin's
 * leg: looking in at the line from 4.6 mm away (in open air) in four directions, every look either
 * meets an outer surface 1.9-2.6 mm from the line or passes through (the slot of a split peg, as on
 * a pin's legs), and at least one opposite pair meets it. Looking in, not out, so a hole through a
 * beam doesn't count (those points are inside the beam).
 * Null when that stretch is shorter than 2.5 mm. `hit(origin, dir)` -> { distance, leaving } | null.
 */
function measurePegSpan(hit, g, bbox) {
  const STEP = 0.25;
  const axis = new THREE.Vector3(...g.axis);
  const u = new THREE.Vector3(...(Math.abs(axis.x) < 0.9 ? [1, 0, 0] : [0, 1, 0])).projectOnPlane(axis).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);
  const dirs = [u, v, u.clone().negate(), v.clone().negate()].map((d) => d.toArray());
  const corners = [];
  for (const x of [bbox.min[0], bbox.max[0]]) for (const y of [bbox.min[1], bbox.max[1]]) for (const z of [bbox.min[2], bbox.max[2]]) corners.push(x * axis.x + y * axis.y + z * axis.z);
  const [tLo, tHi] = [Math.min(...corners), Math.max(...corners)];
  let best = null;
  let runStart = null;
  for (let t = tLo + STEP / 2; t <= tHi + STEP / 2; t += STEP) {
    const c = g.perpOrigin.map((p, i) => p + t * g.axis[i]);
    const looks = dirs.map((d) => {
      const h = hit(c.map((p, i) => p + d[i] * 4.6), d.map((x) => -x));
      if (!h || h.distance > 4.6 + 2.6) return 'through';
      return !h.leaving && h.distance >= 4.6 - 2.6 && h.distance <= 4.6 - 1.9 ? 'peg' : 'other';
    });
    const solid =
      t <= tHi &&
      !looks.includes('other') &&
      ((looks[0] === 'peg' && looks[2] === 'peg') || (looks[1] === 'peg' && looks[3] === 'peg'));
    if (solid && runStart === null) runStart = t;
    if (!solid && runStart !== null) {
      if (!best || t - runStart > best[1] - best[0]) best = [runStart - STEP / 2, t - STEP / 2];
      runStart = null;
    }
  }
  return best && best[1] - best[0] >= 2.5 ? best : null;
}

function probeIntersectsPart(probeBvh, probePos, probeRotDeg, partBvh) {
  const matProbe = buildWorldMatrix(probePos, probeRotDeg);
  const worldBoxProbe = probeBvh.localBox.clone().applyMatrix4(matProbe);
  if (!worldBoxProbe.intersectsBox(partBvh.localBox)) return false;
  return partBvh.colGeo.boundsTree.intersectsGeometry(probeBvh.colGeo, matProbe);
}

// A pin hole's wall: rays out from its axis that all hit within this radius (a pin bore is at most
// ~3.3 mm, counterbores included), sampled every WALL_STEP_MM along the axis
const WALL_MAX_RADIUS_MM = 3.6;
const WALL_STEP_MM = 0.05;
const WALL_RAYS = 8;
const WALL_MIN_LENGTH_MM = 0.2; // plastic sheets are 0.25 mm thick
const WALL_SEARCH_MM = 3.2; // the STEP anchor can sit on a face up to a rim's depth from the wall

/**
 * Where a pin hole's wall really runs along its axis, measured on the part's mesh. Used when all of
 * a hole's STEP surfaces are placed on one face, which gives it no length (the 2nd gen omni wheel's
 * holes, plastic sheets, truss plates). Walks out both ways from `anchorT` while every ray out from
 * the axis meets the part within WALL_MAX_RADIUS_MM. Returns [minT, maxT], or null when no wall is
 * found (a shallower stub than WALL_MIN_LENGTH_MM counts as none).
 */
function measureHoleWallSpan(raycast, perpOrigin, axis, anchorT, bbox) {
  const ax = new THREE.Vector3(...axis);
  const u = new THREE.Vector3()
    .crossVectors(ax, Math.abs(ax.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
    .normalize();
  const v = new THREE.Vector3().crossVectors(ax, u);
  const dirs = Array.from({ length: WALL_RAYS }, (_, i) => {
    const a = (i / WALL_RAYS) * Math.PI * 2;
    return u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).toArray();
  });
  const walled = (t) => {
    const c = new THREE.Vector3(...perpOrigin).addScaledVector(ax, t).toArray();
    return dirs.every((d) => {
      const dist = raycast(c, d);
      return dist != null && dist <= WALL_MAX_RADIUS_MM;
    });
  };
  const k = axis.findIndex((a) => Math.abs(a) === 1);
  const [tLo, tHi] = k >= 0 ? [Math.min(bbox.min[k] * axis[k], bbox.max[k] * axis[k]), Math.max(bbox.min[k] * axis[k], bbox.max[k] * axis[k])] : [-Infinity, Infinity];
  // The STEP anchor often sits on a face or a wider rim, so start at the nearest wall either side of it
  let start;
  for (let d = 0; d <= WALL_SEARCH_MM && start === undefined; d += WALL_STEP_MM) {
    start = [anchorT - d, anchorT + d].find((t) => t >= tLo && t <= tHi && walled(t));
  }
  if (start === undefined) return null;
  let lo = start;
  while (lo - WALL_STEP_MM >= tLo && walled(lo - WALL_STEP_MM)) lo -= WALL_STEP_MM;
  let hi = start;
  while (hi + WALL_STEP_MM <= tHi && walled(hi + WALL_STEP_MM)) hi += WALL_STEP_MM;
  if (hi - lo < WALL_MIN_LENGTH_MM) return null;
  return [Number(lo.toFixed(3)), Number(hi.toFixed(3))];
}

/**
 * Chain and tank tread parts (openspec chain-track-builder), read off their models: a link's roller
 * pivot is its origin and the next pivot is 6.35 mm along its −Z, the pivot axis is X and +Y is the
 * outer side of the loop. A tread link takes a Traction Link's two pegs in holes on its +Y face; the
 * gripper's model isn't centred, so `seatInLink` is its position in the tread link's frame (no turn).
 * The Intake Flaps (openspec chain-over-under, track attachments) plug into the same two holes with
 * the same pegs; their seats put each flap's peg tips where the Traction Link's sit (read off the
 * models: tips at the model's lowest y, 12.7 mm apart), flap pointing out of the loop.
 */
const CHAIN_LINK = { pitchMm: 6.35, pivots: [[0, 0, 0], [0, 0, -6.35]], pivotAxis: [1, 0, 0], outward: [0, 1, 0] };
const CHAIN_SPECS = {
  '228-2500-230': { role: 'chain_link', ...CHAIN_LINK },
  '228-2500-231': { role: 'tread_link', ...CHAIN_LINK, gripperHoles: [[-6.35, 8.636, 0], [6.35, 8.636, 0]] },
  '228-2500-239': { role: 'gripper', seatInLink: [-6.73, 4.086, -18.2] },
  '228-2500-240': { role: 'attachment', seatInLink: [-1.453, 7.413, -18.9] },
  '228-2500-241': { role: 'attachment', seatInLink: [-1.154, 9.849, -18.9] },
  '228-2500-242': { role: 'attachment', seatInLink: [-8.942, -2.51, -13.087] }
};

/**
 * Infers gear & sprocket mechanical specifications from part name and bounding box.
 */
function inferGearSpecs(part) {
  if (part.category !== 'Gears, Sprockets & Pulleys') return null;
  if (CHAIN_SPECS[part.partNumber]) return null; // a chain link, not a toothed part
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

const PIN_BLOCK_RADIUS_MM = 2.8; // wider than this about the pin's axis, a ring can't pass through a pin hole

/**
 * Where a connector pin or standoff can't slide through a hole (play mode's drop test, openspec
 * drop-load-network): `blockersZ`, the z spans of its mesh wider than PIN_BLOCK_RADIUS_MM about its
 * axis (a 1x1's middle shoulder, a 0x2's end cap, a standoff's body), and `tipsZ`, its two ends.
 */
function addPinBlockers(part, fastenerSpecs, rawRaycast) {
  if (!fastenerSpecs || (fastenerSpecs.fastenerType !== 'connector_pin' && fastenerSpecs.fastenerType !== 'standoff')) return;
  const raycast = rawRaycast();
  const reach = Math.max(-part.bbox.min[0], part.bbox.max[0], -part.bbox.min[1], part.bbox.max[1]) + 2;
  const STEP = 0.2;
  const [zMin, zMax] = [part.bbox.min[2], part.bbox.max[2]];
  const blockers = [];
  for (let z = zMin + STEP / 2; z < zMax; z += STEP) {
    // Widest of four sides: a pin's split leaves gaps one side, a cap is round all the way
    let r = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const hit = raycast([dx * reach, dy * reach, z], [-dx, -dy, 0]);
      if (hit !== null) r = Math.max(r, reach - hit);
    }
    if (r <= PIN_BLOCK_RADIUS_MM) continue;
    const last = blockers[blockers.length - 1];
    if (last && z - last[1] <= STEP * 1.5) last[1] = z;
    else blockers.push([z, z]);
  }
  fastenerSpecs.blockersZ = blockers.map(([lo, hi]) => [Number((lo - STEP / 2).toFixed(2)), Number((hi + STEP / 2).toFixed(2))]);
  fastenerSpecs.tipsZ = [Number(zMin.toFixed(2)), Number(zMax.toFixed(2))];
}

/** A peg's span never reaches past its own part (a few pins' cylinder groups ran far off the mesh). */
function clampPegSpans(part, ports) {
  if (part.category !== 'Pins & Standoffs') return;
  for (const p of ports) {
    if (p.type !== 'pin_peg' || !p.spanMm) continue;
    const ts = [];
    for (const x of [part.bbox.min[0], part.bbox.max[0]])
      for (const y of [part.bbox.min[1], part.bbox.max[1]])
        for (const z of [part.bbox.min[2], part.bbox.max[2]]) ts.push(x * p.axis[0] + y * p.axis[1] + z * p.axis[2]);
    const lo = Math.max(p.spanMm[0], Math.min(...ts));
    const hi = Math.min(p.spanMm[1], Math.max(...ts));
    if (lo === p.spanMm[0] && hi === p.spanMm[1]) continue;
    // The point sits on the axis at the middle of the span
    const offAxis = p.origin.map((v, i) => v - (p.origin[0] * p.axis[0] + p.origin[1] * p.axis[1] + p.origin[2] * p.axis[2]) * p.axis[i]);
    p.spanMm = [Number(lo.toFixed(3)), Number(hi.toFixed(3))];
    p.origin = offAxis.map((v, i) => Number((v + ((lo + hi) / 2) * p.axis[i]).toFixed(3)));
  }
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
  } else if (gearSpecs?.gearType === 'sprocket') {
    const m = measureSprocket(part, gearSpecs.teeth);
    if (m.measured) Object.assign(gearSpecs, m);
    else {
      gearSpecs.measured = false;
      unmeasured.push(`${part.name}: ${m.reason}`);
    }
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

const FACE_TOL_MM = 0.3; // a hole's surfaces within this of a face of the part's box reach that face
const QUARTER_PITCH_MM = VEX_PITCH_MM / 4;
const MINI_STANDOFF_CONNECTOR = '228-2500-170';
const MISSING_HOLE_MM = 2; // a through hole listed this far short of a face may run on to it
const PEG_INTO_LINK_MAX_MM = 6; // an attachment's peg reaches at most this far into a tread link hole

const signedAxisName = (axis, sign = 1) => {
  const k = [0, 1, 2].reduce((best, i) => (Math.abs(axis[i]) > Math.abs(axis[best]) ? i : best), 0);
  return `${axis[k] * sign >= 0 ? '+' : '-'}${'xyz'[k]}`;
};
const along = (point, axis) => point[0] * axis[0] + point[1] * axis[1] + point[2] * axis[2];
const boxRangeAlong = (bbox, axis) => {
  const ts = [];
  for (const x of [bbox.min[0], bbox.max[0]]) for (const y of [bbox.min[1], bbox.max[1]]) for (const z of [bbox.min[2], bbox.max[2]]) ts.push(along([x, y, z], axis));
  return [Math.min(...ts), Math.max(...ts)];
};
const perpDistance = (point, linePoint, axis) => {
  const d = point.map((v, i) => v - linePoint[i]);
  const t = along(d, axis);
  return Math.hypot(...d.map((v, i) => v - t * axis[i]));
};
const isParallel = (a, b) => Math.abs(along(a, b)) > 0.999;

/**
 * Holes on a face that are too shallow for a whole pin leg (the Bumper Switch's top holes take a
 * corner connector's peg): for each end of a pin-hole line that reaches a face of the part's box
 * and has no port at that face yet, push a 1x1 Connector Pin in from the face as far as it goes
 * clear. A hole is at least 2.5 mm deep, with walls (the pin moved 2.6 mm sideways meets the part).
 */
/**
 * How far a 1x1 Connector Pin goes into a hole line from the face at `faceT` (`out`: +1 when the
 * face is at the line's + end), and whether the hole has walls there (the pin moved 2.6 mm sideways
 * meets the part). At most a pin leg's length.
 */
function pinDepthFrom(g, faceT, out, refPinBvh, partBvh) {
  const halfLen = Math.max(-refPinBvh.localBox.min.z, refPinBvh.localBox.max.z);
  const rot = eulerFromZAxis(g.axis);
  const radVec = Math.abs(g.axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const pinAt = (depth, shift = 0) => g.perpOrigin.map((v, i) => v + (faceT + out * (halfLen - depth)) * g.axis[i] + radVec[i] * shift);
  let depth = 0;
  while (depth + 0.25 <= halfLen && !probeIntersectsPart(refPinBvh, pinAt(depth + 0.25), rot, partBvh)) depth += 0.25;
  return { depth, walled: probeIntersectsPart(refPinBvh, pinAt(depth, 2.6), rot, partBvh) };
}

/**
 * The face a blind hole opens on: the one a pin goes into deeper; on a tie the face the hole's
 * surfaces reach when they reach only one, else `fallback` (the face nearer the pin that fitted).
 */
function entryFace(g, fallback, refPinBvh, partBvh) {
  const dMax = pinDepthFrom(g, g.boxMaxT, 1, refPinBvh, partBvh).depth;
  const dMin = pinDepthFrom(g, g.boxMinT, -1, refPinBvh, partBvh).depth;
  if (Math.abs(dMax - dMin) > 0.5) return dMax > dMin ? g.boxMaxT : g.boxMinT;
  const reachesMax = Math.abs(g.maxT - g.boxMaxT) < FACE_TOL_MM;
  const reachesMin = Math.abs(g.minT - g.boxMinT) < FACE_TOL_MM;
  if (reachesMax !== reachesMin) return reachesMax ? g.boxMaxT : g.boxMinT;
  return fallback;
}

function addFaceHoles(part, groups, ports, refPinBvh, partBvh) {
  for (const g of groups) {
    if (!g.hasLockingRidge && !g.hasPinBore) continue;
    const [lo, hi] = boxRangeAlong(part.bbox, g.axis);
    const onLine = ports.filter((p) => (p.type === 'pin_hole' || p.type === 'shaft_bore') && isParallel(p.axis, g.axis) && perpDistance(p.origin, g.perpOrigin, g.axis) < 0.5);
    for (const [faceT, out] of [[hi, 1], [lo, -1]]) {
      if (Math.abs((out > 0 ? g.maxT : g.minT) - faceT) >= FACE_TOL_MM) continue;
      if (onLine.some((p) => p.through || Math.abs(along(p.origin, g.axis) - faceT) < 1)) continue;
      const { depth, walled } = pinDepthFrom(g, faceT, out, refPinBvh, partBvh);
      if (depth < 2.5 || !walled) continue;
      const origin = g.perpOrigin.map((v, i) => Number((v + faceT * g.axis[i]).toFixed(3)));
      ports.push({
        portId: null,
        type: 'pin_hole',
        origin,
        axis: g.axis,
        through: false,
        spanMm: [faceT - out * depth, faceT].sort((a, b) => a - b).map((t) => Number(t.toFixed(3))),
        pitchCoord: origin.map((v) => Number((v / VEX_PITCH_MM).toFixed(2))),
        verified: true,
        foundFrom: 'face'
      });
    }
  }
}

const lineOf = (origin, axis) => ({ axis, perpOrigin: origin.map((v, i) => v - along(origin, axis) * axis[i]) });

/** A pin hole in an end of a pin or standoff part along its Z axis, where a pin goes in at least 2.5 mm between walls. */
function addEndHoles(part, ports, refPinBvh, partBvh) {
  if (part.category !== 'Pins & Standoffs') return;
  const g = lineOf([0, 0, 0], [0, 0, 1]);
  for (const [faceT, out] of [[part.bbox.max[2], 1], [part.bbox.min[2], -1]]) {
    if (ports.some((p) => p.type === 'pin_hole' && isParallel(p.axis, g.axis) && perpDistance(p.origin, [0, 0, 0], g.axis) < 0.5 && Math.abs(along(p.origin, g.axis) - faceT) < 1)) continue;
    const { depth, walled } = pinDepthFrom(g, faceT, out, refPinBvh, partBvh);
    if (depth < 2.5 || !walled) continue;
    // The part's own peg on this line ends where the hole begins
    const holeEnd = faceT - out * depth;
    for (const q of ports) {
      if (q.type !== 'pin_peg' || !isParallel(q.axis, g.axis) || perpDistance(q.origin, [0, 0, 0], g.axis) >= 0.5) continue;
      const span = (q.spanMm || [part.bbox.min[2], part.bbox.max[2]]).map((t) => Math.max(part.bbox.min[2], Math.min(part.bbox.max[2], t)));
      if (out < 0) span[0] = Math.max(span[0], holeEnd);
      else span[1] = Math.min(span[1], holeEnd);
      q.spanMm = span.map((t) => Number(t.toFixed(3)));
      q.origin = [0, 0, Number(((span[0] + span[1]) / 2).toFixed(3))];
    }
    ports.push({
      portId: null,
      type: 'pin_hole',
      origin: [0, 0, Number(faceT.toFixed(3))],
      axis: [0, 0, 1],
      through: false,
      spanMm: [faceT - out * depth, faceT].sort((a, b) => a - b).map((t) => Number(t.toFixed(3))),
      pitchCoord: [0, 0, Number((faceT / VEX_PITCH_MM).toFixed(2))],
      verified: true
    });
  }
}

/**
 * A through hole whose listed length (from its STEP surfaces) stops short of one of the part's faces
 * runs on to that face when a pin pushed in from the face reaches the listed part.
 */
function extendThroughHoles(part, ports, refPinBvh, partBvh) {
  for (const p of ports) {
    if (p.type !== 'pin_hole' || !p.through || !p.spanMm?.every((t) => Math.abs(t) < 1000)) continue;
    // A peg on the same line (a corner connector's) fills the rest of it
    if (ports.some((q) => q.type === 'pin_peg' && isParallel(q.axis, p.axis) && perpDistance(q.origin, p.origin, p.axis) < 0.5)) continue;
    const g = lineOf(p.origin, p.axis);
    const [lo, hi] = boxRangeAlong(part.bbox, p.axis);
    // Through holes of thinner parts already run their whole thickness (getLocalFeatures)
    if (hi - lo <= THIN_PART_MAX_MM) continue;
    const span = [...p.spanMm];
    for (const [faceT, out, k] of [[hi, 1, 1], [lo, -1, 0]]) {
      // A short gap is the recess round a hole's rim, kept as it is
      const gap = Math.abs(faceT - span[k]);
      if (gap < MISSING_HOLE_MM) continue;
      const { depth } = pinDepthFrom(g, faceT, out, refPinBvh, partBvh);
      if (depth >= gap - FACE_TOL_MM) span[k] = Number(faceT.toFixed(3));
    }
    p.spanMm = span;
  }
}

/**
 * Pegs of a part that plugs into a Tank Tread Attachment Link: the link's attachment holes taken
 * into the part's frame through its seat (the track builder places it at the link's turn, moved by
 * seatInLink), so pegs and the builder's seat agree. A peg already found on the mesh is kept.
 */
function addAttachmentPegs(part, ports) {
  const seat = CHAIN_SPECS[part.partNumber]?.seatInLink;
  const link = Object.values(CHAIN_SPECS).find((s) => s.role === 'tread_link');
  if (!seat || !link) return;
  const axis = link.outward;
  for (const hole of link.gripperHoles) {
    const face = hole.map((v, i) => v - seat[i]);
    if (ports.some((p) => p.type === 'pin_peg' && isParallel(p.axis, axis) && perpDistance(p.origin, face, axis) < 0.5)) continue;
    const faceT = along(face, axis);
    const depth = Math.min(PEG_INTO_LINK_MAX_MM, faceT - boxRangeAlong(part.bbox, axis)[0]);
    const origin = face.map((v, i) => Number((v - (depth / 2) * axis[i]).toFixed(3)));
    ports.push({
      portId: null,
      type: 'pin_peg',
      origin,
      axis: [...axis],
      spanMm: [faceT - depth, faceT].map((t) => Number(t.toFixed(3))),
      verified: true,
      foundFrom: 'tread link seat'
    });
  }
}

/**
 * A shaft's own point: its axis (local Z), both ends, its cross-section, and for a capped or motor
 * shaft which end has the cap or stop ring, found as the end nearer the part of the shaft wider than
 * its body (looking in at the axis from the side).
 */
function addShaftPort(part, ports, fastenerSpecs, rawRaycast) {
  if (!SHAFT_FASTENER_TYPES.has(fastenerSpecs?.fastenerType) || /collar|bushing/i.test(part.name)) return;
  const [zMin, zMax] = [part.bbox.min[2], part.bbox.max[2]];
  const port = {
    portId: null,
    type: 'shaft',
    origin: [0, 0, Number(((zMin + zMax) / 2).toFixed(3))],
    axis: [0, 0, 1],
    ends: [[0, 0, zMin], [0, 0, zMax]],
    spanMm: [zMin, zMax],
    lengthMm: Number((zMax - zMin).toFixed(2)),
    shape: fastenerSpecs.shape || 'square',
    verified: true
  };
  if (fastenerSpecs.hasEndCap) {
    const reach = Math.max(-part.bbox.min[0], part.bbox.max[0]) + 2;
    const raycast = rawRaycast();
    const widths = [];
    for (let z = zMin + 0.1; z < zMax; z += 0.2) {
      const hit = raycast([reach, 0, z], [-1, 0, 0]);
      widths.push({ z, r: hit === null ? 0 : reach - hit });
    }
    const body = widths.map((w) => w.r).sort((a, b) => a - b)[Math.floor(widths.length / 2)];
    const wide = widths.filter((w) => w.r > body + 0.4);
    if (wide.length) {
      const zs = wide.map((w) => w.z);
      const [lo, hi] = [Math.min(...zs), Math.max(...zs)];
      const capEnd = zMax - hi < lo - zMin ? 'max' : 'min';
      port.stop = {
        kind: fastenerSpecs.fastenerType === 'motor_shaft' ? 'stop_ring' : 'cap',
        end: capEnd === 'max' ? '+z' : '-z',
        spanMm: [Number(lo.toFixed(2)), Number(hi.toFixed(2))]
      };
    }
  }
  ports.push(port);
}

const KIND_BY_TYPE = { pin_hole: 'hole', shaft_bore: 'bore', shaft_socket: 'socket', pin_peg: 'peg', shaft: 'shaft' };

/**
 * Each point's shape and the face or faces it opens on (signed local axes). Depth is the socket's
 * own; an opening's real depth is measured on the mesh where it is used (getPartMeasurements).
 */
function describePorts(part, ports, fastenerSpecs, partBvh) {
  // Which ends of each peg stick out, measured as the engine does (getPartMeasurements)
  ports.forEach((p, i) => {
    p.portId ||= `new_${i}`;
  });
  const ray = new THREE.Ray();
  const pinEnds = measurePinEnds({ ...part, ports, fastenerSpecs }, (o, d) => {
    ray.origin.set(o[0], o[1], o[2]);
    ray.direction.set(d[0], d[1], d[2]);
    const hit = partBvh.colGeo.boundsTree.raycastFirst(ray, THREE.DoubleSide);
    return hit ? { distance: hit.distance, normal: hit.face.normal.toArray() } : null;
  });
  for (const p of ports) {
    const axis = p.axis;
    const t0 = along(p.origin, axis);
    const span = p.spanMm && p.spanMm.every(Number.isFinite) && Math.abs(p.spanMm[1] - p.spanMm[0]) < 1000 ? p.spanMm : null;
    if (p.type === 'shaft') {
      p.faces = ['+z', '-z'];
      continue;
    }
    if (p.type === 'shaft_socket') {
      p.shape = p.shape || 'square';
      p.faces = [signedAxisName(axis)];
      p.depthMm = p.maxDepthMm;
      continue;
    }
    if (p.type === 'pin_hole') p.shape = 'round';
    if (p.type === 'shaft_bore' && p.shape === 'square') p.kindName = 'sq';
    const [lo, hi] = boxRangeAlong(part.bbox, axis);
    if (p.type === 'pin_peg') {
      p.shape = 'round';
      // The ends that stick out (both when they can't be measured)
      const ends = pinEnds.get(p.portId) || { lo: true, hi: true };
      p.faces = [...(ends.hi ? [signedAxisName(axis)] : []), ...(ends.lo ? [signedAxisName(axis, -1)] : [])];
      if (!p.faces.length) p.faces = [signedAxisName(axis), signedAxisName(axis, -1)];
      continue;
    }
    if (p.through) {
      p.faces = [signedAxisName(axis), signedAxisName(axis, -1)];
      continue;
    }
    // Blind: it opens at the end of its span nearer its origin (the entry face)
    const ref = span ? (span[0] + span[1]) / 2 : (lo + hi) / 2;
    p.faces = [signedAxisName(axis, t0 >= ref ? 1 : -1)];
  }
}

const quarterPitches = (v) => {
  const n = Math.round(v / QUARTER_PITCH_MM);
  return n === 0 ? 0 : n;
};

/**
 * Ids from where each point is: <kind>.<face>.<x>_<y>_<z> (quarter pitches; face 'thru' for a
 * through hole or a peg sticking out both ways), '#2', '#3' on a clash, in a fixed order. Each point
 * keeps the ids it had in the last index as aliases: the old point on the same line, of the same
 * type, nearest along it. Old ids with no point now go to `lost`.
 */
function assignStableIds(part, ports, oldPorts, lost) {
  for (const p of ports) {
    const kind = p.kindName || KIND_BY_TYPE[p.type] || p.type;
    delete p.kindName;
    p.kind = kind;
    const face = p.faces.length > 1 ? 'thru' : p.faces[0];
    p.portId = `${kind}.${face}.${p.origin.map(quarterPitches).join('_')}`;
  }
  const key = (p) => [p.axis.map((v) => v.toFixed(3)).join(','), ...p.origin.map((v) => v.toFixed(3))].join('|');
  const byId = new Map();
  for (const p of [...ports].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))) {
    const n = (byId.get(p.portId) || 0) + 1;
    byId.set(p.portId, n);
    if (n > 1) p.portId = `${p.portId}#${n}`;
  }

  // Aliases: match old points to new ones on the same line, nearest first
  const pairs = [];
  oldPorts.forEach((o, oi) => {
    ports.forEach((p, pi) => {
      if (o.type !== p.type && !(part.partNumber === MINI_STANDOFF_CONNECTOR && o.type === 'shaft_bore')) return;
      if (!isParallel(o.axis, p.axis) || perpDistance(o.origin, p.origin, p.axis) > 0.5) return;
      pairs.push({ oi, pi, d: Math.hypot(...o.origin.map((v, i) => v - p.origin[i])) });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const usedOld = new Set();
  const usedNew = new Set();
  for (const { oi, pi } of pairs) {
    if (usedOld.has(oi) || usedNew.has(pi)) continue;
    usedOld.add(oi);
    usedNew.add(pi);
    const o = oldPorts[oi];
    const p = ports[pi];
    const aliases = [o.portId, ...(o.aliases || [])].filter((id) => id && id !== p.portId);
    if (aliases.length) p.aliases = [...new Set(aliases)];
  }
  // A shaft's feature was called `shaft` before it had a point of its own
  for (const p of ports) if (p.type === 'shaft') p.aliases = [...new Set(['shaft', ...(p.aliases || [])])];
  oldPorts.forEach((o, oi) => {
    if (!usedOld.has(oi)) lost.push(`${part.name}: ${[o.portId, ...(o.aliases || [])].join(', ')}`);
  });
  // Unused fields of the search
  for (const p of ports) delete p.foundFrom;
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
  // Today's ports, before this run replaces them: their ids live on as aliases (assignStableIds)
  const oldPortsById = new Map(catalog.map((part) => [part.id, structuredClone(part.ports || [])]));
  const lostIds = [];

  for (let idx = 0; idx < catalog.length; idx++) {
    const part = catalog[idx];
    const partBvh = getPartCollisionBvh(part);
    // Raycasts on the part's real (not shrunk) mesh, built only when a hole needs measuring
    let partRaycast = null;
    const rawRaycast = () => {
      if (partRaycast) return partRaycast;
      const geo = getPartRawGeometry(part);
      const ray = new THREE.Ray();
      partRaycast = (o, d) => {
        ray.origin.set(o[0], o[1], o[2]);
        ray.direction.set(d[0], d[1], d[2]);
        return geo.boundsTree.raycastFirst(ray, THREE.DoubleSide)?.distance ?? null;
      };
      return partRaycast;
    };
    // First hit on the real mesh as { distance, leaving } (leaving: the ray started inside the solid)
    let partHit = null;
    const rawHit = () => {
      if (partHit) return partHit;
      const geo = getPartRawGeometry(part);
      const ray = new THREE.Ray();
      partHit = (o, d) => {
        ray.origin.set(o[0], o[1], o[2]);
        ray.direction.set(d[0], d[1], d[2]);
        const hit = geo.boundsTree.raycastFirst(ray, THREE.DoubleSide);
        return hit ? { distance: hit.distance, leaving: hit.face.normal.dot(ray.direction) > 0 } : null;
      };
      return partHit;
    };

    const stepPath =
      stepFileMap.get(path.basename(part.file)) ||
      path.join(ROOT_DIR, part.file);

    const rawCylinders = fs.existsSync(stepPath)
      ? extractAllStepCylinders(stepPath)
      : part.cylinders || [];

    const coaxialGroups = groupCoaxialCylinders(rawCylinders, part.bbox, /\b(spacer|washer)\b/i.test(part.name));
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
          // If blind hole on a thick body, record the entry surface coordinate: the face its
          // surfaces reach when they reach only one, else the face nearer the pin that fitted
          if (!isThrough) {
            const nearer = Math.abs(pt - g.boxMaxT) < Math.abs(pt - g.boxMinT) ? g.boxMaxT : g.boxMinT;
            holeOriginT = entryFace(g, nearer, refPinBvh, partBvh);
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
        const span =
          verifiedType === 'pin_hole' && g.maxT - g.minT < 0.01
            ? measureHoleWallSpan(rawRaycast(), g.perpOrigin, g.axis, g.minT, part.bbox) || [g.minT, g.maxT]
            : [g.minT, g.maxT];
        ports.push({
          portId: id,
          type: verifiedType,
          origin: verifiedPos,
          axis: g.axis,
          through: isThrough,
          spanMm: span,
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
      } else if (g.hasPinBore) {
        // Any other part: a solid round peg of pin size standing on the part (the Traction Link's
        // two pegs that push into a connector's holes), found from the mesh itself
        const span = measurePegSpan(rawHit(), g, part.bbox);
        if (span) {
          const midT = (span[0] + span[1]) / 2;
          ports.push({
            portId: `peg_${pegCounter++}`,
            type: 'pin_peg',
            origin: g.perpOrigin.map((v, i) => Number((v + midT * g.axis[i]).toFixed(3))),
            axis: g.axis,
            spanMm: span.map((t) => Number(t.toFixed(3))),
            verified: true
          });
        }
      }
    }

    // 2. Check center shaft bore [0, 0, cZ] on Gears, Wheels, Pulleys, Collars, Spacers if not already found
    if (
      part.category === 'Gears, Sprockets & Pulleys' ||
      part.category === 'Wheels & Treads' ||
      part.category === 'Shafts, Spacers & Collars'
    ) {
      // Wheels turn about their thinnest side: Z for nearly all, Y for the 2nd gen omni wheel
      const size = part.bbox.size;
      const yThinnest = size[1] < size[2] - 1 && size[1] < size[0] - 1;
      const a = part.category === 'Wheels & Treads' && yThinnest ? 1 : 2;
      const axis = [0, 0, 0];
      axis[a] = 1;
      const hasCenterBore = ports.some((p) => Math.hypot(...p.origin.filter((_, i) => i !== a)) < 1.5);
      if (!hasCenterBore && !part.name.toLowerCase().includes('shaft')) {
        const centerPos = [0, 0, 0];
        centerPos[a] = Number(part.bbox.center[a].toFixed(3));
        const shaftFits = !probeIntersectsPart(refShaftBvh, centerPos, eulerFromZAxis(axis), partBvh);
        if (shaftFits) {
          ports.unshift({
            portId: 'center_shaft_bore',
            type: 'shaft_bore',
            origin: centerPos,
            axis,
            through: true,
            spanMm: [part.bbox.min[a], part.bbox.max[a]],
            pitchCoord: [0, 0, 0],
            verified: true
          });
        }
      }
    }

    // 3. Dedicated Smart Motor (228-2560) & Robot Brain (228-2540, with or without battery) verified socket/flange ports
    if (part.partNumber === '228-2560') {
      ports.unshift({
        portId: 'motor_drive_socket',
        type: 'shaft_socket',
        origin: [-9.525, 0, 0],
        axis: [0, 1, 0],
        through: false,
        // VEX's current Smart Motor model: the socket floor is 8.6 mm below its face (the library's
        // 2013 mesh is shallower; isShaftInMotorSocket lets a shaft reach the real floor)
        maxDepthMm: 8.6,
        pitchCoord: [-0.75, 0, 0],
        verified: true
      });
    } else if (part.partNumber.startsWith('228-2540')) {
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

    // 4. Shallow holes on a face that a whole pin leg can't go into (the Bumper Switch's top holes)
    addFaceHoles(part, coaxialGroups, ports, refPinBvh, partBvh);
    // 5. A pin goes into the Mini Standoff Connector's bore
    if (part.partNumber === MINI_STANDOFF_CONNECTOR) {
      for (const port of ports) if (port.type === 'shaft_bore') port.type = 'pin_hole';
    }
    // 5b. A pin hole in the end of a standoff part (the Standoff Extender's body end), and through
    // holes whose listed length stops short of a face a pin goes in from (Cable Anchor)
    addEndHoles(part, ports, refPinBvh, partBvh);
    extendThroughHoles(part, ports, refPinBvh, partBvh);
    // 6. Intake flaps and grippers: the pegs that plug into a tread link's attachment holes
    addAttachmentPegs(part, ports);

    totalVerifiedPorts += ports.length;

    const pitchSize = [
      Number((part.bbox.size[0] / VEX_PITCH_MM).toFixed(2)),
      Number((part.bbox.size[1] / VEX_PITCH_MM).toFixed(2)),
      Number((part.bbox.size[2] / VEX_PITCH_MM).toFixed(2))
    ];
    const originType = classifyOriginType(part);
    const gearSpecs = inferGearSpecs(part);
    const fastenerSpecs = inferFastenerSpecs(part);
    addPinBlockers(part, fastenerSpecs, rawRaycast);
    clampPegSpans(part, ports);
    const mountingRules = classifyMountingRules(part);
    const { rackSpecs, hubSpecs } = measureShapes(part, ports, gearSpecs, fastenerSpecs, rawCylinders, unmeasured);
    // 7. Shafts: their axis, ends, cross-section and cap or stop ring
    addShaftPort(part, ports, fastenerSpecs, rawRaycast);
    // Facts for every point, then ids from where each point is, keeping today's ids as aliases
    describePorts(part, ports, fastenerSpecs, partBvh);
    assignStableIds(part, ports, oldPortsById.get(part.id) || [], lostIds);

    const portCounts = {
      total: ports.length,
      pinHoles: ports.filter((p) => p.type === 'pin_hole').length,
      shaftBores: ports.filter((p) => p.type === 'shaft_bore' || p.type === 'shaft_socket').length,
      pinPegs: ports.filter((p) => p.type === 'pin_peg').length,
      shafts: ports.filter((p) => p.type === 'shaft').length
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
      ...(CHAIN_SPECS[part.partNumber] ? { chainSpecs: CHAIN_SPECS[part.partNumber] } : {}),
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
    if (CHAIN_SPECS[part.partNumber]) part.chainSpecs = CHAIN_SPECS[part.partNumber];
    else delete part.chainSpecs;
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

  if (lostIds.length) {
    console.log(`${lostIds.length} port id(s) of the last index have no point now:`);
    for (const l of lostIds) console.log(`  ${l}`);
    process.exitCode = 1;
  }
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
