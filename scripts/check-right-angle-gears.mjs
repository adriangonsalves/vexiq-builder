/**
 * Node check for gears that mesh at 90° (openspec right-angle-gears): the measured tooth data, the
 * pair rules and turns in src/utils/gearMeshing.js, mesh spots, and turning on placement
 * (src/utils/placementFit.js), against real catalog data and the MCP engine's collision meshes.
 * Run: node scripts/check-right-angle-gears.mjs   (exits 1 on any failure)
 */
import * as THREE from 'three';
import { auditAssembly, checkCandidateCollision, findPart, getPartRawGeometry, worldFeaturesFor } from '../mcp/assembly-engine.mjs';
import { refAxes } from '../src/utils/axisFrame.js';
import { settlePlacement } from '../src/utils/placementFit.js';
import {
  canTurnToMesh,
  meshRatio,
  meshRelation,
  meshSpots,
  meshTurn,
  quaternionToEulerDeg,
  rightAnglePair,
  turnQuaternion,
  worldToothed
} from '../src/utils/gearMeshing.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const part = (name) => {
  const p = findPart(name);
  if (!p || p.name !== name) throw new Error(`Catalog part not found: ${name}`);
  return p;
};
let nextId = 1;
const inst = (p, position, rotation = [0, 0, 0], label = null) => {
  const n = nextId++;
  return { instanceId: `i${n}`, partId: p.id, label: label || `${p.name} #${n}`, position, rotation, visible: true };
};
const toothed = (i) => worldToothed(findPart(i.partId), i.position, i.rotation, i.instanceId);
const collides = (a, others) => checkCandidateCollision(a, others).isIntersecting;
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;
const vec = (a) => new THREE.Vector3(...a);
/** An instance at a spot's pose. */
const atSpot = (p, spot, label) => inst(p, spot.position.toArray().map((x) => +x.toFixed(4)), quaternionToEulerDeg(spot.quaternion), label);
/** The instance turned by `deg` about its own Z axis (through its origin). */
const spun = (i, deg) => {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...i.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return { ...i, rotation: quaternionToEulerDeg(turnQuaternion(q, axis, deg)) };
};
const moved = (i, by) => ({ ...i, position: vec(i.position).add(by).toArray() });

const BEVEL18 = part('18 Tooth Bevel Gear');
const BEVEL12 = part('12 Tooth High Strength Bevel Gear');
const CROWN = part('36 Tooth Crown Gear');
const WORM = part('Worm Gear');
const G12 = part('12 Tooth Gear');
const G24 = part('24 Tooth Gear');
const G36 = part('36 Tooth Gear');
const HS24 = part('24 Tooth High Strength Hybrid Gear');
const SHAFT = part('4x Pitch Shaft');
const HUB = part('Small Wheel Hub (44 mm)');
const BEAM = part('1x2 Beam');
const Y_UP = [-90, 0, 0]; // local +Z to world +Y
const X_OUT = [0, 90, 0]; // local +Z to world +X

// --- Measured tooth data -------------------------------------------------------------------------
{
  for (const p of [BEVEL18, BEVEL12, CROWN, WORM]) check(`${p.name} is measured`, p.gearSpecs.measured === true, JSON.stringify(p.gearSpecs));
  for (const p of [BEVEL18, BEVEL12]) {
    const g = p.gearSpecs;
    check(
      `${p.name}: cone point at the origin, a tooth phase, a face span (cone ${g.coneAngleDeg}°)`,
      near(g.conePointZ, 0) && Number.isFinite(g.toothPhaseDeg) && g.faceSpanMm?.length === 2 && Math.abs(g.coneAngleDeg - 45) < 3,
      JSON.stringify(g)
    );
  }
  const c = CROWN.gearSpecs;
  check(
    '36 Tooth Crown Gear: 36 teeth on its −z face, standard tooth size, a tooth ring and phase',
    c.teeth === 36 && c.toothFace === -1 && c.diametralPitch === 24 && c.ringRadiiMm[0] < c.ringRadiiMm[1] && Number.isFinite(c.toothPhaseDeg),
    JSON.stringify(c)
  );
  const w = WORM.gearSpecs;
  check(
    'Worm Gear: one thread, standard spacing, pitch radius on the grid (6.35 mm), a winding direction and phase',
    w.starts === 1 && near(w.threadSpacingMm, 3.325) && near(w.leadMm, 3.325) && near(w.pitchRadiusMm, 6.35) && Math.abs(w.hand) === 1 && Number.isFinite(w.threadPhaseMm),
    JSON.stringify(w)
  );
  for (const name of ['Differential Gear', 'Differential Gear (High Strength)']) {
    check(`${name} is not a meshing gear`, !canTurnToMesh(part(name)));
  }

  // The winding direction: turning the worm by +30° about +Z moves the crest seen from a fixed
  // direction by hand·lead·30/360 along Z (read off the model itself)
  const geo = getPartRawGeometry(WORM);
  const ray = new THREE.Ray();
  const [u] = refAxes(new THREE.Vector3(0, 0, 1));
  const crestAt = (turnDeg) => {
    // A fixed world direction u, seen in the part's frame after it turned by turnDeg
    const dir = u.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(-turnDeg));
    const level = w.tipRadiusMm - 0.15 * (w.tipRadiusMm - w.rootRadiusMm);
    let start = null;
    for (let z = 1; z < 18; z += 0.01) {
      ray.origin.copy(dir).multiplyScalar(12).setZ(z);
      ray.direction.copy(dir).negate();
      const d = geo.boundsTree.raycastFirst(ray, THREE.DoubleSide)?.distance;
      const high = d != null && 12 - d >= level;
      if (high && start == null) start = z;
      if (!high && start != null && start > 1.01) return (start + z) / 2;
      if (!high) start = null;
    }
    return null;
  };
  const z0 = crestAt(0);
  const z30 = crestAt(30);
  const spacing = w.threadSpacingMm;
  const shift = ((((z30 - z0) % spacing) + 1.5 * spacing) % spacing) - spacing / 2;
  check(
    `turning the worm +30° moves its crest by hand·lead·30/360 (${(w.hand * w.leadMm * 30) / 360} mm; seen ${shift.toFixed(3)} mm)`,
    Math.abs(shift - (w.hand * w.leadMm * 30) / 360) < 0.05
  );
}

// --- Which gears mesh at 90° ---------------------------------------------------------------------
const bevelA = inst(BEVEL18, [0, 0, 0], Y_UP, '18 Tooth Bevel Gear #1');
const bevelSpots = meshSpots(BEVEL18, { position: [30, 30, 30], rotation: [0, 0, 0] }, toothed(bevelA), BEVEL18);
const bevelB = atSpot(BEVEL18, bevelSpots[0], '18 Tooth Bevel Gear #2');
{
  check('two 18 Tooth Bevel Gears with cone points together at 90° are in mesh range', meshRelation(toothed(bevelB), toothed(bevelA)) !== null);

  const odd = inst(BEVEL12, [0, 0, 0], X_OUT);
  check('a 12 Tooth High Strength and an 18 Tooth Bevel Gear with cone points together are not in mesh range', meshRelation(toothed(odd), toothed(bevelA)) === null);
  check('  and no turn is made', meshTurn(toothed(odd), [toothed(bevelA)]) === null);

  const crown = inst(CROWN, [0, 0, 0]);
  const onCrown = atSpot(G12, meshSpots(G12, { position: [0, 30, -20], rotation: X_OUT }, toothed(crown), CROWN)[0]);
  check('a 12 Tooth Gear standing on the crown gear\'s teeth is in mesh range', meshRelation(toothed(onCrown), toothed(crown)) !== null);

  const g36 = inst(G36, [0, 0, 0]);
  const wormSpot = meshSpots(WORM, { position: [30, 0, 0], rotation: X_OUT }, toothed(g36), G36)[0];
  const worm = atSpot(WORM, wormSpot);
  const wt = toothed(worm);
  const n = new THREE.Vector3().crossVectors(wt.axis, toothed(g36).axis).normalize();
  const apart = Math.abs(wt.center.clone().sub(toothed(g36).faceMid).dot(n));
  check(
    `a worm in the 36 Tooth Gear's tooth plane, axes ${apart.toFixed(2)} mm apart, is in mesh range`,
    near(apart, 25.4, 0.01) && Math.abs(wt.center.clone().sub(toothed(g36).faceMid).dot(toothed(g36).axis)) < 0.01 && meshRelation(wt, toothed(g36)) !== null
  );
  check('the worm moved 4 mm along the gear\'s shaft is not in mesh range', meshRelation(toothed(moved(worm, vec([0, 0, 4]))), toothed(g36)) === null);

  // A bevel tilted 10° about the line across both axes, about the shared cone point
  const bt = toothed(bevelB);
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().crossVectors(bt.axis, toothed(bevelA).axis).normalize(), THREE.MathUtils.degToRad(10));
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...bevelB.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
  const slanted = { ...bevelB, rotation: quaternionToEulerDeg(tilt.multiply(q)) };
  check('a bevel gear whose axis is 80° from its partner\'s is not in mesh range', meshRelation(toothed(slanted), toothed(bevelA)) === null);
  check('a bevel gear 3 mm short of the shared cone point is not in mesh range', meshRelation(toothed(moved(bevelB, bt.axis.clone().multiplyScalar(-3))), toothed(bevelA)) === null);

  // Pairs that never mesh at 90°
  const never = [
    [BEVEL18, G36],
    [WORM, BEVEL18],
    [CROWN, CROWN],
    [HS24, CROWN],
    [WORM, HS24],
    [part('24 Tooth Sprocket'), WORM],
    [BEVEL12, BEVEL18]
  ];
  for (const [a, b] of never) check(`${a.name} and ${b.name} never mesh at 90°`, rightAnglePair(a, b) === null);
  for (const [a, b] of [[BEVEL18, BEVEL18], [BEVEL12, BEVEL12], [G12, CROWN], [CROWN, G24], [WORM, G36], [G24, WORM]]) {
    check(`${a.name} and ${b.name} can mesh at 90°`, rightAnglePair(a, b) !== null);
  }
}

// --- Meshing leaves no contact -------------------------------------------------------------------
{
  const cases = [
    ['18 Tooth Bevel Gear', BEVEL18, BEVEL18, Y_UP, [0, 0, 0]],
    ['12 Tooth High Strength Bevel Gear', BEVEL12, BEVEL12, Y_UP, [0, 0, 0]],
    ['12 Tooth Gear on the crown', G12, CROWN, [0, 0, 0], X_OUT],
    ['crown on a 12 Tooth Gear', CROWN, G12, X_OUT, [0, 0, 0]],
    ['worm on a 24 Tooth Gear', WORM, G24, [0, 0, 0], X_OUT],
    ['worm on a 36 Tooth Gear', WORM, G36, [0, 0, 0], X_OUT],
    ['24 Tooth Gear on a worm', G24, WORM, X_OUT, [0, 0, 0]]
  ];
  for (const [label, moving, fixed, fixedRot, startRot] of cases) {
    let clean = true;
    let offHits = true;
    let count = 0;
    for (const spin of [0, 7, 13]) {
      const a = spun(inst(fixed, [0, 0, 0], fixedRot), spin);
      for (const s of meshSpots(moving, { position: [30, 30, 30], rotation: startRot }, toothed(a), fixed)) {
        count++;
        const b = atSpot(moving, s);
        if (collides(b, [a])) clean = false;
        // Half a tooth off must touch, or the check above proves nothing
        const half = { ...b, rotation: quaternionToEulerDeg(turnQuaternion(s.quaternion, s.axis, 180 / toothed(b).teeth)) };
        if (!collides(half, [a])) offHits = false;
      }
    }
    check(`${label}: meshed at every spot (${count}) with no contact`, count > 0 && clean);
    check(`${label}: half a tooth off, the teeth touch`, offHits);
  }
}

// --- Mesh spots ----------------------------------------------------------------------------------
{
  const dirs = bevelSpots.map((s) => s.axis.toArray().map((x) => Math.round(x)).join(','));
  check(
    'four spots round a Y-axis bevel gear, with the second gear\'s axis along ±X and ±Z',
    bevelSpots.length === 4 && ['1,0,0', '-1,0,0', '0,0,1', '0,0,-1'].every((d) => dirs.includes(d)),
    dirs.join(' ')
  );
  // Every spot meshes, within a quarter tooth
  const allSpots = [
    ...bevelSpots.map((s) => [BEVEL18, s, bevelA]),
    ...(() => {
      const g = inst(G12, [0, 0, 0]);
      return meshSpots(CROWN, { position: [0, 0, 30], rotation: [0, 0, 0] }, toothed(g), G12).map((s) => [CROWN, s, g]);
    })()
  ];
  check(
    'every spot is in mesh range, less than a quarter tooth off',
    allSpots.every(([p, s, partner]) => {
      const r = meshRelation(toothed(atSpot(p, s)), toothed(partner));
      return r && Math.abs(r.errorTeeth(meshPhase(atSpot(p, s)))) < 0.25;
    })
  );
  const g12 = inst(G12, [0, 0, 0]);
  check('a crown gear has eight spots round a spur gear', meshSpots(CROWN, { position: [0, 0, 30], rotation: [0, 0, 0] }, toothed(g12), G12).length === 8);

  // A beam where spot 1 would be: callers drop spots that collide
  const beam = inst(BEAM, bevelSpots[0].center.toArray(), [0, 0, 0]);
  const free = bevelSpots.filter((s) => !collides(atSpot(BEVEL18, s), [beam]));
  check('with a beam in one spot, three are left', free.length === 3, `${free.length}`);

  // Along the worm's length the spot keeps the moved part's place when the meeting point is on the thread
  const g36 = inst(G36, [0, 0, 0]);
  const first = meshSpots(WORM, { position: [30, 0, 0], rotation: X_OUT }, toothed(g36), G36)[0];
  const shiftedPos = first.position.clone().addScaledVector(first.axis, -3);
  const kept = meshSpots(WORM, { position: shiftedPos.toArray(), rotation: quaternionToEulerDeg(first.quaternion) }, toothed(g36), G36)[0];
  check('a worm 3 mm along its length from the middle keeps its place along the gear', kept.position.distanceTo(shiftedPos) < 0.01);
  const far = first.position.clone().addScaledVector(first.axis, -30);
  const back = meshSpots(WORM, { position: far.toArray(), rotation: quaternionToEulerDeg(first.quaternion) }, toothed(g36), G36)[0];
  check('a worm far off its thread goes to the middle of its thread', back.position.distanceTo(first.position) < 0.01);
}

// --- Turning on placement ------------------------------------------------------------------------
{
  const settle = (placedId, instances) => settlePlacement({ placedId, instances, partOf: (i) => findPart(i.partId), featuresOf: worldFeaturesFor });
  const apply = (instances, patches) =>
    instances.map((i) => {
      const p = patches.find((q) => q.instanceId === i.instanceId);
      return p ? { ...i, ...p } : i;
    });
  const byId = (list, i) => list.find((x) => x.instanceId === i.instanceId);

  // A bevel gear stopped at the shared cone point, 4° off its meshing turn
  const off = { ...spun(bevelB, 4), label: '18 Tooth Bevel Gear #2' };
  const r1 = settle(off.instanceId, [bevelA, off]);
  const after1 = apply([bevelA, off], r1.patches);
  check(
    'a bevel gear stopping at the shared cone point turns to mesh, with no contact',
    r1.patches.length === 1 && r1.patches[0].instanceId === off.instanceId && !collides(byId(after1, off), [bevelA]),
    JSON.stringify(r1.patches)
  );
  check('  the message says it meshed', /^Meshed 18 Tooth Bevel Gear #2 with 18 Tooth Bevel Gear #1 \(turned -?[\d.]+°\)/.test(r1.messages[0] || ''), r1.messages.join(' | '));
  check('  placing it again changes nothing', settle(off.instanceId, after1).patches.length === 0);

  const short = moved(off, toothed(off).axis.clone().multiplyScalar(-3.5));
  check('a bevel gear 3.5 mm short (past the 3 mm snap) is not turned', settle(short.instanceId, [bevelA, short]).patches.length === 0);

  // A worm on a square shaft with a wheel, dropped beside a 24 Tooth Gear
  const g24 = inst(G24, [0, 0, 0], [0, 0, 0], '24 Tooth Gear #1');
  const spot = meshSpots(WORM, { position: [30, 0, 0], rotation: X_OUT }, toothed(g24), G24)[0];
  const meshed = atSpot(WORM, spot);
  const axis = spot.axis;
  const mid = vec(meshed.position).addScaledVector(axis, 9.525);
  const shaft = { ...spun(inst(SHAFT, mid.toArray(), meshed.rotation), 7), label: 'Worm shaft' };
  const wheel = { ...spun(inst(HUB, mid.clone().addScaledVector(axis, -20).toArray(), meshed.rotation), 7), label: 'Wheel' };
  const worm = { ...spun(meshed, 7 + 20), label: 'Worm Gear #1' };
  const scene = [g24, shaft, wheel, worm];
  const r2 = settle(worm.instanceId, scene);
  const after2 = apply(scene, r2.patches);
  const ids = new Set(r2.patches.map((p) => p.instanceId));
  const rel = meshRelation(toothed(byId(after2, worm)), toothed(g24));
  check(
    'a worm on a square shaft with a wheel: the worm, its shaft and the wheel turn; the 24 Tooth Gear stays',
    ids.has(worm.instanceId) && ids.has(shaft.instanceId) && ids.has(wheel.instanceId) && !ids.has(g24.instanceId),
    JSON.stringify([...ids])
  );
  check(
    '  the worm meshes with no contact',
    rel && Math.abs(rel.errorTeeth(meshPhase(byId(after2, worm)))) < 0.01 && !collides(byId(after2, worm), [g24]),
    r2.messages.join(' | ')
  );

  // A 12 Tooth Gear on a shaft pushed down onto the crown gear
  const crown = inst(CROWN, [0, 0, 0], [0, 0, 0], '36 Tooth Crown Gear #1');
  const cs = meshSpots(G12, { position: [0, 30, -20], rotation: X_OUT }, toothed(crown), CROWN)[0];
  const g12 = { ...spun(atSpot(G12, cs), 5), label: '12 Tooth Gear #1' };
  const axle = { ...inst(SHAFT, g12.position, g12.rotation), label: 'Axle' };
  const r3 = settle(g12.instanceId, [crown, axle, g12]);
  const after3 = apply([crown, axle, g12], r3.patches);
  const ids3 = new Set(r3.patches.map((p) => p.instanceId));
  check(
    'a 12 Tooth Gear on a shaft dropped on the crown gear turns (with its shaft) to mesh; the crown stays',
    ids3.has(g12.instanceId) && ids3.has(axle.instanceId) && !ids3.has(crown.instanceId) && !collides(byId(after3, g12), [crown]),
    JSON.stringify(r3)
  );
}

// --- The audit -----------------------------------------------------------------------------------
{
  const meshedB = atSpot(BEVEL18, bevelSpots[0], '18 Tooth Bevel Gear #2');
  const report = auditAssembly({ instances: [bevelA, meshedB] });
  check(
    'two meshed bevel gears: the audit lists the pair as meshing, with no overlap between them',
    report.collisionCount === 0 && report.kinematics.meshedGearPairs.some((p) => p.kind === 'bevel'),
    JSON.stringify({ collisions: report.collisions, pairs: report.kinematics.meshedGearPairs })
  );
  const g36 = inst(G36, [0, 0, 0], [0, 0, 0], '36 Tooth Gear #1');
  const spot = meshSpots(WORM, { position: [30, 0, 0], rotation: X_OUT }, toothed(g36), G36)[0];
  const outward = new THREE.Vector3(spot.center.x, spot.center.y, 0).normalize();
  const far = { ...atSpot(WORM, spot, 'Worm Gear #1'), position: spot.position.clone().addScaledVector(outward, 2).toArray() };
  const near2 = auditAssembly({ instances: [g36, far] }).kinematics.nearMeshPairs;
  check('a worm 2 mm too far from its gear is reported 2 mm out of mesh', near2.length === 1 && near2[0].offMm === 2, JSON.stringify(near2));
}

// --- Speed ratios from the meshing rule ----------------------------------------------------------
{
  const a = inst(G12, [0, 0, 0]);
  let b = inst(G36, [25.4, 0, 0]);
  b = { ...b, rotation: quaternionToEulerDeg(turnQuaternion(b.rotation, ...(() => { const m = meshTurn(toothed(b), [toothed(a)]); return [m.axis, m.turnDeg]; })())) };
  const r = meshRatio(toothed(a), toothed(b));
  check(`12 to 36 tooth spur gears: ratio ${r?.toFixed(4)} = −1/3`, near(r, -1 / 3, 1e-3));
}

function meshPhase(i) {
  const t = toothed(i);
  return THREE.MathUtils.radToDeg(Math.atan2(t.toothDir.dot(refAxes(t.axis)[1]), t.toothDir.dot(refAxes(t.axis)[0])));
}

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
