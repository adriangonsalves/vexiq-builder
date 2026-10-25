/**
 * Node check for src/utils/pinHoleAlignment.js against real catalog data.
 * Run: node scripts/check-pin-hole-alignment.mjs   (exits 1 on any failure)
 */
import * as THREE from 'three';
import { auditAssembly, buildWorldMatrix, checkCandidateCollision, findPart, getPartCollisionBvh, getPartMeasurements, worldFeaturesFor } from '../mcp/assembly-engine.mjs';
import fs from 'node:fs';
import {
  EXCLUDED_PART_NAMES,
  collectWorldFeatures,
  findAlignedOpenings,
  findEngagedJoints,
  findHoleSnap,
  findSeatedPairs,
  insertLeadEnds,
  insertPose,
  isOpeningTaken,
  listInsertFits,
  openFaces,
  getLocalFeatures,
  measureOpeningDepths,
  measureOpeningSurfaces,
  measurePinEnds,
  planMates,
  mateAction,
  holesFilledByFit
} from '../src/utils/pinHoleAlignment.js';

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

let nextId = 0;
const place = (name, position = [0, 0, 0], rotation = [0, 0, 0]) => {
  const meta = part(name);
  const instanceId = `${name}#${nextId++}`;
  return {
    meta,
    instanceId,
    features: collectWorldFeatures(meta, buildWorldMatrix(position, rotation), instanceId)
  };
};

const local = (name, kind) => getLocalFeatures(part(name)).find((f) => f.kind === kind);
const featureById = (placed, featureId) => placed.features.find((f) => f.featureId === featureId);
const near = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
const dot3v = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fmt = (hits) => JSON.stringify(hits.map((h) => `${h.instanceId}:${h.featureId}`));

/** Highlights for `selected` given the other placed parts. */
const highlights = (selected, others) =>
  findAlignedOpenings(selected.features, others.flatMap((o) => o.features));
const has = (hits, placed, featureId) =>
  hits.some((h) => h.instanceId === placed.instanceId && h.featureId === featureId);
const hitOf = (hits, placed, featureId) =>
  hits.find((h) => h.instanceId === placed.instanceId && h.featureId === featureId);
/** Ring drawn on the facing face: face coordinate `axisIndex` ≈ value, rim radius ≈ radiusMm. */
const ringAt = (hit, axisIndex, value, radiusMm) =>
  Boolean(hit) && near(hit.face.getComponent(axisIndex), value) && near(hit.radiusMm, radiusMm);
const ringDetail = (hit) => (hit ? JSON.stringify({ face: hit.face.toArray(), radiusMm: hit.radiusMm }) : 'no hit');

/**
 * Places a +Z insert part (identity rotation) on a +Z opening's axis so the insert's lower end
 * sits `gapMm` above the opening's top face (negative gap = that far inside).
 */
const placeAboveOpening = (name, kind, opening, openingTopZ, gapMm) => {
  const f = local(name, kind);
  return place(name, [
    opening.origin.x - f.origin[0],
    opening.origin.y - f.origin[1],
    openingTopZ + gapMm - f.tMin
  ]);
};

// ---------------------------------------------------------------------------
// 1.2 Local extents at the identity pose
// ---------------------------------------------------------------------------
{
  const peg = local('0x2 Connector Pin', 'pin');
  check(
    '0x2 Connector Pin peg extent is clamped inside bbox z [-6.26, 6.14]',
    peg && peg.tMin >= -6.26 - 1e-6 && peg.tMax <= 6.14 + 1e-6,
    JSON.stringify(peg)
  );
  const shaft = local('4x Pitch Shaft', 'shaft');
  check(
    '4x Pitch Shaft extent is [-24.51, 24.51]',
    shaft && near(shaft.tMin, -24.51) && near(shaft.tMax, 24.51),
    JSON.stringify(shaft)
  );
  const socket = local('VEX IQ Smart Motor', 'shaft_socket');
  check(
    'Smart Motor socket extent is [-4.7, 0.13] (face moved out to the motor surface)',
    socket && near(socket.tMin, -4.7) && near(socket.tMax, 0.13),
    JSON.stringify(socket)
  );
  const collarFeatures = getLocalFeatures(part('Rubber Shaft Collar'));
  const collarHole = collarFeatures.find((f) => f.kind === 'collar_hole');
  check(
    'Rubber Shaft Collar has one collar_hole along ±Y at x≈4.091, z≈8.095 and no shaft',
    collarFeatures.length === 1 &&
      collarHole &&
      near(Math.abs(collarHole.axis[1]), 1) &&
      near(collarHole.origin[0], 4.091) &&
      near(collarHole.origin[2], 8.095),
    JSON.stringify(collarFeatures)
  );
}

// ---------------------------------------------------------------------------
// 1.3 / 2.1 Pins
// ---------------------------------------------------------------------------
const beam = place('1x6 Beam');
const beamHole = featureById(beam, 'hole_2');
const beamHoleLocal = getLocalFeatures(beam.meta).find((f) => f.featureId === 'hole_2');
const beamTop = beamHoleLocal.tMax; // beam at identity, hole axis +Z

{
  const pinLocal = local('0x2 Connector Pin', 'pin');
  const above = placeAboveOpening('0x2 Connector Pin', 'pin', beamHole, beamTop, 20);
  let hits = highlights(above, [beam]);
  check('Pin 20 mm above a 1x6 Beam hole -> that hole', hits.length === 1 && has(hits, beam, 'hole_2'), fmt(hits));
  check('  ring is on the top face (z = 3.05) at the 3.175 mm rim', ringAt(hitOf(hits, beam, 'hole_2'), 2, 3.05, 3.175), ringDetail(hitOf(hits, beam, 'hole_2')));
  {
    const h = hitOf(hits, beam, 'hole_2');
    check(
      '  through hole: far face on the bottom (z = -3.05), outward points up toward the pin',
      h && h.farFace && near(h.farFace.z, -3.05) && near(h.outward.z, 1),
      h ? JSON.stringify({ farFace: h.farFace?.toArray(), outward: h.outward.toArray() }) : 'no hit'
    );
  }

  const sideways = place('0x2 Connector Pin', [
    beamHole.origin.x + 1,
    beamHole.origin.y,
    beamTop + 20 - pinLocal.tMin
  ]);
  hits = highlights(sideways, [beam]);
  check('Pin 1 mm to the side -> nothing', hits.length === 0, fmt(hits));

  // Tilted 10° about X, with its axis line still passing through the hole center
  const rot = [10, 0, 0];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(THREE.MathUtils.degToRad(10), 0, 0, 'XYZ'));
  const axisW = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const originW = new THREE.Vector3(...pinLocal.origin).applyQuaternion(q);
  const tiltedPos = beamHole.origin.clone().addScaledVector(axisW, 20).sub(originW);
  hits = highlights(place('0x2 Connector Pin', tiltedPos.toArray(), rot), [beam]);
  check('Pin tilted 10° through the hole center -> nothing', hits.length === 0, fmt(hits));

  hits = highlights(placeAboveOpening('0x2 Connector Pin', 'pin', beamHole, beamTop, 140), [beam]);
  check('Hole 140 mm past the pin tip (within 12 pitch) -> hole', has(hits, beam, 'hole_2'), fmt(hits));
  hits = highlights(placeAboveOpening('0x2 Connector Pin', 'pin', beamHole, beamTop, 160), [beam]);
  check('Hole 160 mm past the pin tip (beyond 12 pitch = 152.4 mm) -> nothing', hits.length === 0, fmt(hits));

  hits = highlights(placeAboveOpening('0x2 Connector Pin', 'pin', beamHole, beamTop, 0), [beam]);
  check('Pin end exactly on the hole face -> hole', has(hits, beam, 'hole_2'), fmt(hits));

  hits = highlights(placeAboveOpening('0x2 Connector Pin', 'pin', beamHole, beamTop, -0.5), [beam]);
  check('Pin tip 0.5 mm into the hole -> nothing', hits.length === 0, fmt(hits));

  const flushSeated = place('0x2 Connector Pin', [beamHole.origin.x, beamHole.origin.y, 3.175]);
  hits = highlights(flushSeated, [beam]);
  check('Pin seated in the hole (z = +3.175 flush pose) -> nothing', hits.length === 0, fmt(hits));

  // Reverse direction: beam selected, pin already placed under one of its holes
  const pinBelow = place('0x2 Connector Pin', [
    beamHole.origin.x,
    beamHole.origin.y,
    beamHoleLocal.tMin - 15 - pinLocal.tMax
  ]);
  hits = highlights(beam, [pinBelow]);
  check('Beam selected over a placed pin -> that beam hole', hits.length === 1 && has(hits, beam, 'hole_2'), fmt(hits));
  check('  ring is on the face toward the pin (bottom, z = -3.05)', ringAt(hitOf(hits, beam, 'hole_2'), 2, -3.05, 3.175), ringDetail(hitOf(hits, beam, 'hole_2')));

  // 12x12 Plate holes are stored as [1, 2.286]; a pin from below must still ring the bottom face
  const plate = place('12x12 Plate');
  const plateHole = featureById(plate, 'hole_1');
  const pinUnderPlate = place('0x2 Connector Pin', [plateHole.origin.x, plateHole.origin.y, -3.05 - 10 - pinLocal.tMax]);
  hits = highlights(pinUnderPlate, [plate]);
  check('Pin 10 mm below a 12x12 Plate hole -> ring on the plate bottom face (z = -3.05)', ringAt(hitOf(hits, plate, 'hole_1'), 2, -3.05, 3.175), ringDetail(hitOf(hits, plate, 'hole_1')));
  const pinIntoPlate = place('0x2 Connector Pin', [plateHole.origin.x, plateHole.origin.y, -3.05 + 0.5 - pinLocal.tMax]);
  hits = highlights(pinIntoPlate, [plate]);
  check('Pin tip 0.5 mm into the plate bottom face -> nothing', !has(hits, plate, 'hole_1'), fmt(hits));

  for (const name of ['1x Pitch Standoff', '1x Wide, 1x1 Corner Connector']) {
    hits = highlights(placeAboveOpening(name, 'pin', beamHole, beamTop, 10), [beam]);
    check(`${name} above a beam hole -> hole`, has(hits, beam, 'hole_2'), fmt(hits));
    hits = highlights(placeAboveOpening(name, 'pin', beamHole, beamTop, -3), [beam]);
    check(`${name} seated in the hole -> nothing`, !has(hits, beam, 'hole_2'), fmt(hits));
  }

  const gear = place('36 Tooth Gear');
  const gearBore = featureById(gear, 'center_shaft_bore');
  hits = highlights(placeAboveOpening('0x2 Connector Pin', 'pin', gearBore, 3.18, 10), [gear]);
  check('Pin over a 36 Tooth Gear center bore -> nothing', hits.length === 0, fmt(hits));
}

// ---------------------------------------------------------------------------
// 2.1 Shafts
// ---------------------------------------------------------------------------
{
  let hits = highlights(placeAboveOpening('4x Pitch Shaft', 'shaft', beamHole, beamTop, 10), [beam]);
  check('4x Pitch Shaft above a beam hole -> hole', hits.length === 1 && has(hits, beam, 'hole_2'), fmt(hits));

  hits = highlights(placeAboveOpening('4x Pitch Shaft', 'shaft', beamHole, beamTop, -0.5), [beam]);
  check('Shaft end 0.5 mm into the hole -> nothing', hits.length === 0, fmt(hits));

  // Beam A at z=0 (shaft through it), beam B at z=40 (not reached yet)
  const beamB = place('1x6 Beam', [0, 0, 40]);
  const shaftThroughA = place('4x Pitch Shaft', [beamHole.origin.x, beamHole.origin.y, -10]);
  hits = highlights(shaftThroughA, [beam, beamB]);
  check(
    'Shaft through beam A, lined up with beam B -> only beam B hole',
    hits.length === 1 && has(hits, beamB, 'hole_2'),
    fmt(hits)
  );

  const gear = place('36 Tooth Gear');
  const gearBore = featureById(gear, 'center_shaft_bore');
  hits = highlights(placeAboveOpening('4x Pitch Shaft', 'shaft', gearBore, 3.18, 10), [gear]);
  check('Shaft above a 36 Tooth Gear bore -> bore', hits.length === 1 && has(hits, gear, 'center_shaft_bore'), fmt(hits));
  check('  ring is on the gear top face (z = 3.18) at the 2.5 mm rim', ringAt(hitOf(hits, gear, 'center_shaft_bore'), 2, 3.18, 2.5), ringDetail(hitOf(hits, gear, 'center_shaft_bore')));

  const gearHigh = place('36 Tooth Gear', [0, 0, 30]);
  const shaftBelow = place('4x Pitch Shaft', [0, 0, 0]);
  hits = highlights(gearHigh, [shaftBelow]);
  check('Gear selected over a placed shaft -> its bore', hits.length === 1 && has(hits, gearHigh, 'center_shaft_bore'), fmt(hits));

  // Smart Motor socket: origin [-9.525, 0, 0], axis +Y, face at y = 0. Shaft rotated so +Z -> +Y.
  const motor = place('VEX IQ Smart Motor');
  const shaftLocal = local('4x Pitch Shaft', 'shaft');
  const shaftAboveMotor = place('4x Pitch Shaft', [-9.525, 5 - shaftLocal.tMin, 0], [-90, 0, 0]);
  hits = highlights(shaftAboveMotor, [motor]);
  check('Shaft lined up with Smart Motor socket, outside -> socket', has(hits, motor, 'motor_drive_socket'), fmt(hits));
  check('  ring is on the motor top face (y = 0.13)', ringAt(hitOf(hits, motor, 'motor_drive_socket'), 1, 0.13, 2.5), ringDetail(hitOf(hits, motor, 'motor_drive_socket')));
  check('  blind socket: no far-face ring', hitOf(hits, motor, 'motor_drive_socket')?.farFace === null, ringDetail(hitOf(hits, motor, 'motor_drive_socket')));

  const shaftInMotor = place('4x Pitch Shaft', [-9.525, -3 - shaftLocal.tMin, 0], [-90, 0, 0]);
  hits = highlights(shaftInMotor, [motor]);
  check('Shaft inserted in Smart Motor socket -> nothing', !has(hits, motor, 'motor_drive_socket'), fmt(hits));
}

// ---------------------------------------------------------------------------
// 2.1 Rubber collars
// ---------------------------------------------------------------------------
{
  const collar = place('Rubber Shaft Collar', [beamHole.origin.x, beamHole.origin.y, 20]);
  let hits = highlights(collar, [beam]);
  check('Rubber Shaft Collar selected over beam holes -> nothing', hits.length === 0, fmt(hits));

  // Collar hole runs along ±Y through x=4.091, z=8.095, collar spans y in [3.09, 9.44].
  const shaftLocal = local('4x Pitch Shaft', 'shaft');
  const shaftAlongY = place('4x Pitch Shaft', [4.091, 9.44 + 6 - shaftLocal.tMin, 8.095], [-90, 0, 0]);
  const collarAtOrigin = place('Rubber Shaft Collar');
  hits = highlights(collarAtOrigin, [shaftAlongY]);
  check(
    'Rubber Shaft Collar hole lined up with a placed shaft, outside -> collar_hole',
    hits.length === 1 && has(hits, collarAtOrigin, 'collar_hole'),
    fmt(hits)
  );
  check('  ring is on the collar face toward the shaft (y = 9.44) at the 1.575 mm rim', ringAt(hitOf(hits, collarAtOrigin, 'collar_hole'), 1, 9.44, 1.575), ringDetail(hitOf(hits, collarAtOrigin, 'collar_hole')));
}

// ---------------------------------------------------------------------------
// 7.5 Rings projected onto the measured mesh surface
// ---------------------------------------------------------------------------
const COLLISION_EROSION_MM = 0.38; // engine BVH is eroded like the browser's collision meshes
const surfacesOf = (name) => {
  const { colGeo } = getPartCollisionBvh(part(name));
  return measureOpeningSurfaces(part(name), (o, d) => {
    const hit = colGeo.boundsTree.raycastFirst(
      new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...d)),
      THREE.DoubleSide
    );
    return hit ? Math.max(0, hit.distance - COLLISION_EROSION_MM) : null;
  });
};
const placeMeasured = (name, position = [0, 0, 0], rotation = [0, 0, 0]) => {
  const meta = part(name);
  const instanceId = `${name}#${nextId++}`;
  return {
    meta,
    instanceId,
    features: collectWorldFeatures(meta, buildWorldMatrix(position, rotation), instanceId, { surfaces: surfacesOf(name) })
  };
};
{
  const beamSurf = surfacesOf('1x6 Beam').get('hole_2');
  check(
    '1x6 Beam hole_2 measured faces sit inside the bbox faces (recess around the rim), symmetric',
    beamSurf && beamSurf.hi < 3.05 - 0.2 && beamSurf.hi > 1.5 && near(beamSurf.lo, -beamSurf.hi, 0.05),
    JSON.stringify(beamSurf)
  );
  const socketSurf = surfacesOf('VEX IQ Smart Motor').get('motor_drive_socket');
  check('Smart Motor socket measured face is clamped to the motor top (≤ 0.13)', socketSurf && socketSurf.hi <= 0.13 + 1e-6, JSON.stringify(socketSurf));

  const mBeam = placeMeasured('1x6 Beam');
  const pinLocal = local('0x2 Connector Pin', 'pin');
  const hole = featureById(mBeam, 'hole_2');
  const atSurface = place('0x2 Connector Pin', [hole.origin.x, hole.origin.y, beamSurf.hi + 2 - pinLocal.tMin]);
  let hits = highlights(atSurface, [mBeam]);
  check(
    'Pin 2 mm above the measured beam surface -> ring drawn on that surface (z = measured face)',
    ringAt(hitOf(hits, mBeam, 'hole_2'), 2, beamSurf.hi, 3.175),
    ringDetail(hitOf(hits, mBeam, 'hole_2'))
  );
  check(
    '  far-face ring on the measured bottom surface (z = measured lo)',
    near(hitOf(hits, mBeam, 'hole_2')?.farFace?.z ?? NaN, beamSurf.lo),
    JSON.stringify(hitOf(hits, mBeam, 'hole_2')?.farFace?.toArray())
  );
  const pastBboxFace = place('0x2 Connector Pin', [hole.origin.x, hole.origin.y, (3.05 + beamSurf.hi) / 2 - pinLocal.tMin]);
  hits = highlights(pastBboxFace, [mBeam]);
  check('Pin tip below the bbox face but above the measured surface -> ring still shown', has(hits, mBeam, 'hole_2'), fmt(hits));
  const intoSurface = place('0x2 Connector Pin', [hole.origin.x, hole.origin.y, beamSurf.hi - 0.5 - pinLocal.tMin]);
  hits = highlights(intoSurface, [mBeam]);
  check('Pin tip 0.5 mm past the measured surface -> nothing', !has(hits, mBeam, 'hole_2'), fmt(hits));
}

// ---------------------------------------------------------------------------
// double-click-mate-pins 1.1 Which pin ends stick out (measured on the mesh)
// ---------------------------------------------------------------------------
const pinEndsOf = (name) => {
  const { colGeo } = getPartCollisionBvh(part(name));
  return measurePinEnds(part(name), (o, d) => {
    const hit = colGeo.boundsTree.raycastFirst(
      new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...d)),
      THREE.DoubleSide
    );
    return hit ? { distance: hit.distance, normal: hit.face.normal.toArray() } : null;
  });
};
const placeFull = (name, position = [0, 0, 0], rotation = [0, 0, 0]) => {
  const meta = part(name);
  const instanceId = `${name}#${nextId++}`;
  return {
    meta,
    instanceId,
    features: collectWorldFeatures(meta, buildWorldMatrix(position, rotation), instanceId, {
      surfaces: surfacesOf(name),
      pinEnds: pinEndsOf(name)
    })
  };
};
{
  const ends = (name) => Object.fromEntries([...pinEndsOf(name).entries()].map(([id, e]) => [id, `${e.lo ? 'lo' : '-'}/${e.hi ? 'hi' : '-'}`]));
  const expectEnds = (name, expected) => {
    const got = ends(name);
    check(`Pin ends of ${name}: ${JSON.stringify(expected)}`, JSON.stringify(got) === JSON.stringify(expected), JSON.stringify(got));
  };
  // +X pegs stick out +X only; the Z pegs have pins on both the +Z and −Z faces ("Triple")
  expectEnds('Triple 2x Wide, 2x2 Corner Connector', { peg_1: '-/hi', peg_2: 'lo/hi', peg_3: 'lo/hi', peg_4: '-/hi' });
  expectEnds('1x Wide, 1x1 Corner Connector', { peg_1: '-/hi' });
  expectEnds('Small Chassis Corner Connector', { peg_1: 'lo/-', peg_2: '-/hi' });
  expectEnds('1x1 Connector Pin', { peg_1: 'lo/hi' });
  expectEnds('1x Pitch Standoff', { peg_1: 'lo/hi' }); // male–male: pin, 12.7mm body, pin
  // Idler pins: the smooth (free-spinning) end has inward-facing triangles; both ends still go into holes
  for (const name of ['0x2 Idler Pin', '0x2 Idler Pin (Weak)', '0x3 Idler Pin', '0x3 Smooth Idler Pin (Weak)', '1x1 Idler Pin', '1x2 Idler Pin']) {
    expectEnds(name, { peg_1: 'lo/hi' });
  }
  // No stored peg: a stand-in pin along local Z, both ends
  expectEnds('2x3 Smooth Idler Pin', { pin_body: 'lo/hi' });
  expectEnds('0x2 Connector Pin with Spherical Cap', { peg_1: '-/hi' }); // ball cap end doesn't insert

  // Every pin part has a pin that projects from at least one end (or both, when unmeasured)
  const { catalog } = await import('../mcp/assembly-engine.mjs').then((m) => m.getCatalog());
  const pinParts = catalog.filter((p) => p.category === 'Pins & Standoffs' && /\bpin\b/i.test(p.name));
  const missing = pinParts.filter((p) => {
    const pins = getLocalFeatures(p).filter((x) => x.kind === 'pin');
    if (pins.length === 0) return true;
    const measured = pinEndsOf(p.name);
    return pins.every((x) => measured.has(x.featureId) && !measured.get(x.featureId).lo && !measured.get(x.featureId).hi);
  });
  check(`All ${pinParts.length} pin parts have a pin that projects from at least one end`, missing.length === 0, missing.map((p) => p.name).join(', '));
}

// ---------------------------------------------------------------------------
// double-click-mate-pins 1.3 Alignment respects which pin ends stick out
// ---------------------------------------------------------------------------
{
  // 1x Wide, 1x1 Corner Connector: peg line x=y=0, sticks out +Z (tip 6.14), body down to -12.55.
  // Beam hole_2 (local x=-19.05) lands on x=0 with the beam at x=19.05.
  const cc = placeFull('1x Wide, 1x1 Corner Connector');
  const beamBelow = place('1x6 Beam', [19.05, 0, -12.55 - 10 - 3.05]);
  const beamAbove = place('1x6 Beam', [19.05, 0, 6.14 + 10 + 3.05]);
  let hits = highlights(cc, [beamBelow]);
  check('Corner connector pin, beam on its body side -> nothing', hits.length === 0, fmt(hits));
  hits = highlights(cc, [beamAbove]);
  check('Corner connector pin, beam on the side it sticks out -> hole', has(hits, beamAbove, 'hole_2'), fmt(hits));

  const pin11 = placeFull('1x1 Connector Pin');
  const up = place('1x6 Beam', [19.05, 0, 15]);
  const down = place('1x6 Beam', [19.05, 0, -15]);
  hits = highlights(pin11, [up, down]);
  check('1x1 Connector Pin between two beams -> both holes', has(hits, up, 'hole_2') && has(hits, down, 'hole_2'), fmt(hits));

  // Triple: +X pegs on lines (y=0, z=-19.05) and (y=0, z=-6.35); a beam turned 90° about Y has holes
  // along X at world z = -38.1 - localX, i.e. hole_1 -> z=-6.35, hole_2 -> z=-19.05.
  const triple = placeFull('Triple 2x Wide, 2x2 Corner Connector');
  const beamPX = place('1x6 Beam', [25.19 + 10 + 3.05, 0, -38.1], [0, 90, 0]);
  const beamNX = place('1x6 Beam', [-6.2 - 10 - 3.05, 0, -38.1], [0, 90, 0]);
  hits = highlights(triple, [beamPX, beamNX]);
  check(
    'Triple corner connector with beams on +X and −X -> only the +X beam (hole_1, hole_2)',
    hits.length === 2 && has(hits, beamPX, 'hole_1') && has(hits, beamPX, 'hole_2'),
    fmt(hits)
  );
}

  // The user's case: 0x3 Idler Pin under a beam with its smooth end up -> hole, and a mate plan
{
  const idler = placeFull('0x3 Idler Pin', [-19.05, 0, -3.05 - 15 - 6.2]);
  const beamAboveIdler = place('1x6 Beam');
  const hits = highlights(idler, [beamAboveIdler]);
  check('0x3 Idler Pin below a beam, smooth end up -> hole and one mate direction (+Z)', has(hits, beamAboveIdler, 'hole_2') && planMates(hits, idler.instanceId).length === 1, fmt(hits));
}

// ---------------------------------------------------------------------------
// double-click-mate-pins 2.1 Mate planning: directions, travel, sideways correction
// ---------------------------------------------------------------------------
{
  const vecNear = (a, b, tol = 0.01) => a.distanceTo(new THREE.Vector3(...b)) <= tol;
  const pinLocal = local('0x2 Connector Pin', 'pin');
  const beamA = place('1x6 Beam');
  const hole = featureById(beamA, 'hole_2');

  const zp = 20 + 3.05 - pinLocal.tMin; // pin's lower end 20mm above the beam top
  const pinAbove = place('0x2 Connector Pin', [hole.origin.x, hole.origin.y, zp]);
  let plans = planMates(highlights(pinAbove, [beamA]), pinAbove.instanceId);
  check(
    'Pin above a beam: one direction (−Z), travel takes the pin end to the beam bottom face',
    plans.length === 1 && vecNear(plans[0].direction, [0, 0, -1]) && near(plans[0].travelMm, zp + pinLocal.tMin + 3.05),
    JSON.stringify(plans.map((p) => ({ d: p.direction.toArray(), t: p.travelMm })))
  );

  check(
    'Pin above a beam: keeps looking for contact until its top end reaches the beam bottom face (sweep)',
    plans.length === 1 && near(plans[0].sweepMm, zp + pinLocal.tMax + 3.05) && plans[0].sweepMm > plans[0].travelMm,
    JSON.stringify(plans.map((p) => ({ travel: p.travelMm, sweep: p.sweepMm })))
  );

  const beamB = place('1x6 Beam', [0, 0, -6.35]);
  plans = planMates(highlights(pinAbove, [beamA, beamB]), pinAbove.instanceId);
  check('Pin over two stacked beams: one direction with both pairs', plans.length === 1 && plans[0].pairs.length === 2, JSON.stringify(plans.map((p) => p.pairs.length)));

  const pinBelow = place('0x2 Connector Pin', [hole.origin.x, hole.origin.y, -3.05 - 15 - pinLocal.tMax]);
  plans = planMates(highlights(beamA, [pinBelow]), beamA.instanceId);
  check('Beam selected over a placed pin: one direction toward the pin (−Z)', plans.length === 1 && vecNear(plans[0].direction, [0, 0, -1]), JSON.stringify(plans.map((p) => p.direction.toArray())));

  const triple = placeFull('Triple 2x Wide, 2x2 Corner Connector');
  const beamPX = place('1x6 Beam', [25.19 + 10 + 3.05, 0, -38.1], [0, 90, 0]);
  const beamPZ = place('1x6 Beam', [6.35, 0, 6.14 + 10 + 3.05]); // holes at x=0 and x=12.7
  plans = planMates(highlights(triple, [beamPX, beamPZ]), triple.instanceId);
  const dirs = plans.map((p) => p.direction.toArray().map((c) => Math.round(c)));
  check(
    'Triple corner connector with beams on +X and +Z: two directions, +X and +Z',
    plans.length === 2 && dirs.some((d) => d.join() === '1,0,0') && dirs.some((d) => d.join() === '0,0,1'),
    JSON.stringify(dirs)
  );

  const gear = place('36 Tooth Gear');
  const beamOverGear = place('1x6 Beam', [6.35, 0, 15]);
  const shaft = place('4x Pitch Shaft', [0, 0, 60]);
  plans = planMates(highlights(shaft, [gear, beamOverGear]), shaft.instanceId);
  check(
    'Shaft over a beam and a gear: travel puts the shaft end flush with the gear far face',
    plans.length === 1 && near(plans[0].travelMm, (60 - 24.51) - -3.18),
    JSON.stringify(plans.map((p) => p.travelMm))
  );

  const gearHigh = place('36 Tooth Gear', [0, 0, 60]);
  const shaftLow = place('4x Pitch Shaft', [0, 0, 0]);
  plans = planMates(highlights(gearHigh, [shaftLow]), gearHigh.instanceId);
  check(
    'Gear selected over a placed shaft: travel puts the shaft top flush with the gear top face',
    plans.length === 1 && vecNear(plans[0].direction, [0, 0, -1]) && near(plans[0].travelMm, (60 + 3.18) - 24.51),
    JSON.stringify(plans.map((p) => ({ d: p.direction.toArray(), t: p.travelMm })))
  );

  const pinOff = place('0x2 Connector Pin', [hole.origin.x + 0.2, hole.origin.y, zp]);
  plans = planMates(highlights(pinOff, [beamA]), pinOff.instanceId);
  check('Pin 0.2 mm off axis: sideways correction of 0.2 mm back onto the axis', plans.length === 1 && vecNear(plans[0].lateral, [-0.2, 0, 0], 0.005), JSON.stringify(plans.map((p) => p.lateral.toArray())));
}

// ---------------------------------------------------------------------------
// mcp-agent-build-tools 1.2 Measured opening depths (blind / through / split)
// ---------------------------------------------------------------------------
{
  const measuredFeatures = (name) => {
    const meta = part(name);
    const { colGeo } = getPartCollisionBvh(meta);
    const raycast = (o, d) => {
      const hit = colGeo.boundsTree.raycastFirst(new THREE.Ray(new THREE.Vector3(...o), new THREE.Vector3(...d)), THREE.DoubleSide);
      return hit ? Math.max(0, hit.distance - COLLISION_EROSION_MM) : null;
    };
    const surfaces = surfacesOf(name);
    const depths = measureOpeningDepths(meta, raycast, surfaces);
    return collectWorldFeatures(meta, new THREE.Matrix4(), name, { surfaces, depths });
  };
  const spanLen = (f) => f.start.distanceTo(f.end);
  const show = (fs) => JSON.stringify(fs.map((f) => ({ id: f.featureId, len: +spanLen(f).toFixed(2), through: f.through })));

  const motor = measuredFeatures('VEX IQ Smart Motor');
  const hole1 = motor.filter((f) => f.featureId.startsWith('hole_1') && !/^hole_1\d/.test(f.featureId));
  check(
    'Smart Motor hole_1 (listed as through) is one blind hole from the front face (~9 mm), closed at the back',
    hole1.length === 1 && hole1[0].featureId === 'hole_1' && !hole1[0].through && spanLen(hole1[0]) > 7 && spanLen(hole1[0]) < 11 && hole1[0].end.y > -2,
    show(hole1)
  );
  // Made-up 10 mm block with a hole listed as through but solid for z in [-1, 1]
  const block = {
    name: 'Test Block', category: 'Beams & Plates',
    bbox: { min: [-5, -5, -5], max: [5, 5, 5] },
    ports: [{ portId: 'hole_1', type: 'pin_hole', origin: [0, 0, 0], axis: [0, 0, 1], through: true, spanMm: [-5, 5] }]
  };
  const blockRay = (o, d) => (d[2] < 0 ? o[2] - 1 : -1 - o[2]); // first solid at z = +1 coming down, z = -1 coming up
  const blockFeatures = collectWorldFeatures(block, new THREE.Matrix4(), 'block', { depths: measureOpeningDepths(block, blockRay) });
  check(
    'Hole blocked in the middle splits into @lo and @hi blind openings, 4 mm deep each',
    blockFeatures.length === 2 && blockFeatures.every((f) => !f.through && Math.abs(spanLen(f) - 4) < 0.01) && blockFeatures.some((f) => f.featureId === 'hole_1@lo') && blockFeatures.some((f) => f.featureId === 'hole_1@hi'),
    show(blockFeatures)
  );
  const socket = motor.filter((f) => f.featureId.startsWith('motor_drive_socket'));
  check(
    'Smart Motor drive socket stays one blind opening about 4.7 mm deep',
    socket.length === 1 && socket[0].featureId === 'motor_drive_socket' && !socket[0].through && Math.abs(spanLen(socket[0]) - 4.7) <= 0.6,
    show(socket)
  );
  const beamHole = measuredFeatures('1x6 Beam').filter((f) => f.featureId.startsWith('hole_2'));
  check('1x6 Beam hole_2 stays one through opening', beamHole.length === 1 && beamHole[0].featureId === 'hole_2' && beamHole[0].through, show(beamHole));
  const gearBore = measuredFeatures('36 Tooth Gear').filter((f) => f.featureId.startsWith('center_shaft_bore'));
  check('36 Tooth Gear bore stays one through opening', gearBore.length === 1 && gearBore[0].through, show(gearBore));
}

// ---------------------------------------------------------------------------
// right-click-rotate-mode 1.2 Engaged joints (what holds a part)
// ---------------------------------------------------------------------------
{
  const joints = (selected, others) => findEngagedJoints(selected.features, others.flatMap((o) => o.features)).lines;
  const linesDetail = (lines) => JSON.stringify(lines.map((l) => ({ origin: l.origin.toArray(), axis: l.axis.toArray(), pairs: l.pairs.length })));
  const beamA = place('1x6 Beam');
  const hole = featureById(beamA, 'hole_2');
  const pinLocal = local('0x2 Connector Pin', 'pin');

  const seated = place('0x2 Connector Pin', [hole.origin.x, hole.origin.y, 3.175]);
  let lines = joints(seated, [beamA]);
  check(
    'Pin seated in a beam hole: held on 1 line, the hole axis',
    lines.length === 1 && Math.abs(lines[0].axis.z) > 0.999 && near(lines[0].origin.x, hole.origin.x) && near(lines[0].origin.y, hole.origin.y),
    linesDetail(lines)
  );

  const above = place('0x2 Connector Pin', [hole.origin.x, hole.origin.y, 3.05 + 5 - pinLocal.tMin]);
  lines = joints(above, [beamA]);
  check(
    'Pin 5 mm above a beam hole: not held, and the hole is still highlighted',
    lines.length === 0 && has(highlights(above, [beamA]), beamA, 'hole_2'),
    linesDetail(lines)
  );

  const gear = place('36 Tooth Gear');
  const beamOverGear = place('1x6 Beam', [6.35, 0, 15]); // hole_1 at x = 0, over the gear bore
  const shaft = place('4x Pitch Shaft', [0, 0, 6]);
  lines = joints(shaft, [gear, beamOverGear]);
  check('Shaft through a beam hole and a gear bore: held on 1 line with 2 pairs', lines.length === 1 && lines[0].pairs.length === 2, linesDetail(lines));

  const hole4 = featureById(beamA, 'hole_4');
  const pinA = place('0x2 Connector Pin', [hole.origin.x, hole.origin.y, 3.175]);
  const pinB = place('0x2 Connector Pin', [hole4.origin.x, hole4.origin.y, 3.175]);
  lines = joints(beamA, [pinA, pinB]);
  check('Beam with pins seated in two holes: held on 2 lines', lines.length === 2, linesDetail(lines));
  lines = joints(beamA, [pinA]);
  check('Beam with one pin seated: held on 1 line', lines.length === 1, linesDetail(lines));

  const beamLow = place('1x6 Beam', [0, 0, -6.35]);
  const pinThrough = place('0x2 Connector Pin', [hole.origin.x, hole.origin.y, -3.175]);
  lines = joints(pinThrough, [beamA, beamLow]);
  check('Pin seated in two stacked beams: held on 1 line with 2 pairs', lines.length === 1 && lines[0].pairs.length === 2, linesDetail(lines));
}

// ---------------------------------------------------------------------------
// 2.2 Confirm each collar's chosen cylinder is its real hole (design.md §7)
// ---------------------------------------------------------------------------
const collarHoleIsReal = (name) => {
  const meta = part(name);
  const hole = getLocalFeatures(meta).find((f) => f.kind === 'collar_hole');
  if (!hole) return { ok: false, detail: 'no collar_hole feature' };
  const { colGeo } = getPartCollisionBvh(meta);
  const axis = new THREE.Vector3(...hole.axis);
  const origin = new THREE.Vector3(...hole.origin);
  const t0 = origin.dot(axis);
  const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(axis, u);
  const misses = [];
  for (const frac of [0.3, 0.5, 0.7]) {
    const t = hole.tMin + (hole.tMax - hole.tMin) * frac;
    const point = origin.clone().addScaledVector(axis, t - t0);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const dir = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang));
      const hit = colGeo.boundsTree.raycastFirst(new THREE.Ray(point, dir), THREE.DoubleSide);
      if (!hit || hit.distance < 1.2 || hit.distance > 2.4) {
        misses.push(`t=${t.toFixed(2)} ang=${Math.round((ang * 180) / Math.PI)} hit=${hit ? hit.distance.toFixed(2) : 'none'}`);
      }
    }
  }
  return { ok: misses.length === 0, detail: misses.slice(0, 6).join('; ') };
};

for (const name of ['Rubber Shaft Collar', 'Rubber Shaft Collar v1']) {
  if (EXCLUDED_PART_NAMES.has(name)) {
    const features = getLocalFeatures(part(name));
    check(`${name} is excluded and returns no features`, features.length === 0, JSON.stringify(features));
    continue;
  }
  const { ok, detail } = collarHoleIsReal(name);
  check(`${name} chosen cylinder is a real ~1.5 mm hole (radial walls at 1.2–2.4 mm)`, ok, detail);
}

// ---------------------------------------------------------------------------
// Hole snapping while dragging (findHoleSnap)
// ---------------------------------------------------------------------------
{
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);
  const deg = THREE.MathUtils.degToRad;
  // How far the moved feature's line ends up from the target line
  const missAfter = (snap) => {
    const { insert, opening, offset } = snap;
    const moved = insert.instanceId === opening.instanceId ? null : insert;
    const from = moved.origin.clone().add(selectedMovesInsert(snap) ? offset : new THREE.Vector3());
    const to = opening.origin.clone().add(selectedMovesInsert(snap) ? new THREE.Vector3() : offset);
    const d = to.sub(from);
    return Math.sqrt(Math.max(0, d.lengthSq() - d.dot(opening.axis) ** 2));
  };
  let selectedId = null;
  const selectedMovesInsert = (snap) => snap.insert.instanceId === selectedId;
  const snapFor = (selected, others, dirs) => {
    selectedId = selected.instanceId;
    return findHoleSnap(selected.features, others.flatMap((o) => o.features), dirs);
  };

  // Rail like the drivetrain's: axles at wheel-radius height (y = 23.87, off the world grid)
  const rail = place('2x12 Beam', [0, 23.87, 72.65]);
  const hole = featureById(rail, 'hole_22'); // center row, x = 25.4
  const shaftAt = (x, y, z = 90) => place('4x Pitch Shaft', [x, y, z]);

  let snap = snapFor(shaftAt(25.4 + 2, 23.87), [rail], [X]);
  check('drag along X: shaft 2 mm off a hole is pulled onto it', snap && near(snap.offset.x, -2, 0.01) && near(snap.offset.y, 0) && missAfter(snap) < 0.01, JSON.stringify(snap?.offset));
  snap = snapFor(shaftAt(25.4, 23.87 + 1.5), [rail], [Y]);
  check('drag along Y: lands on y = 23.87 (off the world grid)', snap && near(23.87 + 1.5 + snap.offset.y, hole.origin.y, 0.01), JSON.stringify(snap?.offset));
  snap = snapFor(shaftAt(25.4 + 1, 23.87 + 1.5), [rail], [X]);
  check('drag along X only, 1.5 mm Y miss (over the 1 mm settle): no snap', !snap, JSON.stringify(snap?.offset));
  snap = snapFor(shaftAt(25.4 + 0.578, 23.87 - 0.529), [rail], [X]);
  check('drag along X only, 0.53 mm Y miss: settles onto the hole (both axes)', snap && near(snap.offset.x, -0.578) && near(snap.offset.y, 0.529) && missAfter(snap) < 0.01, JSON.stringify(snap?.offset));
  snap = snapFor(shaftAt(25.4 + 1, 23.87 + 1.5), [rail], [X, Y]);
  check('plane drag (X and Y): both misses closed', snap && near(snap.offset.x, -1) && near(snap.offset.y, -1.5) && missAfter(snap) < 0.01, JSON.stringify(snap?.offset));
  snap = snapFor(shaftAt(25.4 + 5, 23.87), [rail], [X]);
  check('5 mm from a hole (holes are 6.35 mm apart): pulled only to a hole within 3.5 mm', !snap || (Math.abs(snap.offset.x) <= 3.5 && missAfter(snap) < 0.01), JSON.stringify(snap?.offset));
  snap = snapFor(shaftAt(25.4 + 2, 23.87, 72.65 + 60), [rail], [X]); // near end ~32 mm from the rail
  check('a shaft over 2 pitch along the hole line from the rail is not pulled', !snap, JSON.stringify(snap?.offset));
  snap = snapFor(shaftAt(25.4 + 2, 23.87, 72.65 + 45), [rail], [X]); // near end ~17 mm from the rail
  check('a shaft 17 mm along the hole line from the rail is pulled', snap && near(snap.offset.x, -2), JSON.stringify(snap?.offset));
  snap = snapFor(shaftAt(25.4 + 2, 23.87), [rail], [Z]);
  check('dragging along the hole line (Z), 2 mm off: not pulled across', !snap, JSON.stringify(snap?.offset));
  snap = snapFor(shaftAt(25.4 + 0.578, 23.87 - 0.529), [rail], [Z]);
  check('dragging along the hole line (Z), 0.78 mm off: settles onto it', snap && near(snap.offset.x, -0.578) && near(snap.offset.y, 0.529) && near(snap.offset.z, 0), JSON.stringify(snap?.offset));

  // Angled plate: rail turned 30° about Y, so its holes point 30° off Z; shaft turned the same way
  const tilted = place('2x12 Beam', [10, 30, 50], [0, 30, 0]);
  const tHole = featureById(tilted, 'hole_22');
  const sideways = new THREE.Vector3(1, 0, 0).applyAxisAngle(Y, deg(30)); // across the hole, in XZ
  const tShaftPos = tHole.origin.clone().addScaledVector(tHole.axis, 20).addScaledVector(sideways, 2.2);
  const tShaft = place('4x Pitch Shaft', tShaftPos.toArray(), [0, 30, 0]);
  snap = snapFor(tShaft, [tilted], [X]);
  check('angled plate (30°): dragging along world X still lands the shaft on the hole line', snap && missAfter(snap) < 0.01, JSON.stringify(snap?.offset));
  snap = snapFor(tShaft, [tilted], [X, Y, Z]);
  check('angled plate, free drag: moved straight across onto the hole line', snap && missAfter(snap) < 0.01 && near(snap.offset.dot(tHole.axis), 0, 0.01), JSON.stringify(snap?.offset));
  const turned = place('2x12 Beam', [0, 0, 0], [0, 0, 37]); // turned in its own plane: holes still along Z
  const tHole2 = featureById(turned, 'hole_22');
  snap = snapFor(place('4x Pitch Shaft', [tHole2.origin.x + 1.2, tHole2.origin.y - 0.8, 20]), [turned], [X, Y]);
  check('plate turned 37° in its plane: plane drag lands on an off-grid hole', snap && missAfter(snap) < 0.01, JSON.stringify(snap?.offset));

  // Dragging a part with holes onto a pin that is already placed
  const pin = place('0x2 Connector Pin', [25.4, 23.87, 70]);
  const beam = place('2x12 Beam', [1.6, 23.87, 72.65]);
  snap = snapFor(beam, [pin], [X]);
  check('dragging a beam: its hole is pulled onto a placed pin', snap && near(snap.offset.x, -1.6, 0.01) && snap.opening.instanceId === beam.instanceId, JSON.stringify(snap?.offset));
}

// ---------------------------------------------------------------------------
// Parts too wide for a hole: a capped shaft's cap must not pass a beam hole
// ---------------------------------------------------------------------------
{
  const inst = (id, name, position, rotation = [0, 0, 0]) => ({ instanceId: id, label: id, partId: part(name).id, position, rotation });
  const beam = inst('beam', '2x16 Beam', [0, 0, 0]); // holes along Z, faces at z = ±3.05, lip at |z| <= 2.25
  const capped = (z) => inst('shaft', '2x Pitch Capped Shaft', [25.4, 0, z]); // cap from z to z + 0.8
  const collides = (a, list) => checkCandidateCollision(a, list).isIntersecting;
  check('capped shaft through a beam hole, cap on the outside face: clear', !collides(capped(3.05), [beam]));
  check('  cap sunk into the shallow counterbore at the face: clear', !collides(capped(2.4), [beam]));
  for (const z of [1.5, 0, -1.5, -2.6]) {
    check(`  cap inside the hole's narrow section (shoulder at z = ${z}): collides`, collides(capped(z), [beam]));
  }
  check('  cap all the way through and past the far face: clear (only the path is blocked)', !collides(capped(-3.9), [beam]));

  const gear = inst('gear', '36 Tooth Gear', [25.4, 0, 0]);
  check('cap inside a 36T gear\'s square bore: collides', collides(capped(0), [gear]));
  check('cap resting on the gear face: clear', !collides(capped(3.3), [gear]));

  const plain = (z) => inst('plain', '4x Pitch Shaft', [25.4, 0, z]);
  check('plain 4x shaft through a beam hole and a gear bore: never flagged', [-20, -5, 0, 5, 20].every((z) => !collides(plain(z), [beam, inst('gear2', '36 Tooth Gear', [25.4, 0, 8])])));
  const collar = inst('collar', 'Rubber Shaft Collar', [25.4 - 4.09, 8.1, -3.09 + 10], [90, 0, 0]);
  check('plain shaft through a rubber collar (made to grip): not flagged', !collides(plain(0), [collar]));

  const state = JSON.parse(fs.readFileSync(new URL('./fixtures/drivetrain.json', import.meta.url), 'utf8'));
  const audit = auditAssembly(state);
  check('drivetrain fixture (shafts through holes, gears and the motor) still has no collisions', audit.collisionCount === 0 && audit.isMechanicallySound, JSON.stringify(audit.collisions).slice(0, 200));
}

// ---------------------------------------------------------------------------
// Picking a hole (pick-hole-insert): pose, fits, faces, taken holes
// ---------------------------------------------------------------------------
{
  const deg = THREE.MathUtils.degToRad;
  const inst = (id, name, position, rotation = [0, 0, 0]) => ({ instanceId: id, label: id, partId: part(name).id, position, rotation });
  const quatOf = (rotation) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(deg), 'XYZ'));
  const posed = (name, pose, id = 'sel') => collectWorldFeatures(part(name), pose.matrix, id, getPartMeasurements(part(name)));
  const lineMiss = (a, b) => {
    const d = b.origin.clone().sub(a.origin);
    return Math.sqrt(Math.max(0, d.lengthSq() - d.dot(b.axis) ** 2));
  };
  const leadPointOf = (feature, end) => (end === 'hi' ? feature.end : feature.start);

  // 1.1 pose
  const tilted = inst('tilted', '2x12 Beam', [10, 20, 30], [30, 0, 0]);
  const tHole = worldFeaturesFor(tilted).find((f) => f.featureId === 'hole_22');
  const faces = openFaces(tHole);
  const pin = part('0x2 Connector Pin');
  const pinEnds = insertLeadEnds(pin, getLocalFeatures(pin)[0], getPartMeasurements(pin)).map((e) => e.end);
  for (const [i, face] of faces.entries()) {
    const pose = insertPose({ partMeta: pin, measured: getPartMeasurements(pin), featureId: 'peg_1', end: pinEnds[0], face: face.point, outward: face.outward, receivingQuaternion: quatOf(tilted.rotation) });
    const peg = posed('0x2 Connector Pin', pose).find((f) => f.kind === 'pin');
    const tip = leadPointOf(peg, pinEnds[0]);
    check(
      `pick: upright pin into a beam tilted 30° (face ${i + 1} of 2): on the hole axis, tip 1 mm outside that face`,
      Math.abs(peg.axis.dot(tHole.axis)) > 0.99999 && lineMiss(peg, tHole) < 0.01 && tip.distanceTo(face.point.clone().addScaledVector(face.outward, 1)) < 0.01,
      JSON.stringify({ miss: lineMiss(peg, tHole), tip: tip.toArray(), want: face.point.clone().addScaledVector(face.outward, 1).toArray() })
    );
  }
  const capped = part('2x Pitch Capped Shaft');
  const cappedEnds = insertLeadEnds(capped, getLocalFeatures(capped)[0]);
  check('pick: a capped shaft only leads with its uncapped end', cappedEnds.length === 1 && cappedEnds[0].end === 'lo');
  const sPose = insertPose({ partMeta: capped, featureId: 'shaft', end: 'lo', face: faces[0].point, outward: faces[0].outward, receivingQuaternion: quatOf(tilted.rotation) });
  const sFeature = posed('2x Pitch Capped Shaft', sPose).find((f) => f.kind === 'shaft');
  const out = (p) => p.clone().sub(faces[0].point).dot(faces[0].outward);
  check('  it goes in shaft-first: the cap end stays outside, farther out than the tip', near(out(sFeature.start), 1, 0.01) && out(sFeature.end) > out(sFeature.start) + 20, JSON.stringify([out(sFeature.start), out(sFeature.end)]));
  const motor = inst('motor', 'VEX IQ Smart Motor', [0, 0, 0], [0, 0, 90]);
  const socket = worldFeaturesFor(motor).find((f) => f.kind === 'shaft_socket');
  const socketFaces = openFaces(socket);
  const motorBox = new THREE.Box3(new THREE.Vector3(...part('VEX IQ Smart Motor').bbox.min), new THREE.Vector3(...part('VEX IQ Smart Motor').bbox.max)).applyMatrix4(buildWorldMatrix(motor.position, motor.rotation));
  const mPose = insertPose({ partMeta: capped, featureId: 'shaft', end: 'lo', face: socketFaces[0].point, outward: socketFaces[0].outward, receivingQuaternion: quatOf(motor.rotation) });
  check('pick: the Smart Motor socket offers one face, and a shaft comes in from outside the motor', socketFaces.length === 1 && !motorBox.containsPoint(mPose.leadPoint), JSON.stringify(mPose.leadPoint.toArray()));

  // 1.3 faces and taken holes
  const rail = inst('rail', '2x12 Beam', [0, 0, 0]);
  const railFeatures = worldFeaturesFor(rail);
  const rHole = railFeatures.find((f) => f.featureId === 'hole_22');
  check('pick: a beam hole offers 2 faces, pointing out of the beam both ways', openFaces(rHole).length === 2 && near(openFaces(rHole)[0].outward.dot(openFaces(rHole)[1].outward), -1));
  const seated = worldFeaturesFor(inst('pinIn', '0x2 Connector Pin', [rHole.origin.x, rHole.origin.y, 0]));
  const above = worldFeaturesFor(inst('pinUp', '0x2 Connector Pin', [rHole.origin.x, rHole.origin.y, 20]));
  check('pick: a hole with a seated pin is taken', isOpeningTaken(rHole, seated));
  check('  a pin 5+ mm above it does not take it', !isOpeningTaken(rHole, above));

  // 1.2 fits
  const corner = part('2x Wide, 2x2 Corner Connector');
  const turned = inst('turned', '2x12 Beam', [0, 0, 0], [0, 0, 30]);
  const turnedFeatures = worldFeaturesFor(turned);
  const fitsAt = (holeId, beam = turned, feats = turnedFeatures, name = '2x Wide, 2x2 Corner Connector') => {
    const opening = feats.find((f) => f.featureId === holeId);
    const face = openFaces(opening).find((f) => f.outward.z > 0);
    return listInsertFits({ partMeta: part(name), measured: getPartMeasurements(part(name)), instanceId: 'sel', hovered: { opening, face }, receivingQuaternion: quatOf(beam.rotation), otherFeatures: feats, currentQuaternion: new THREE.Quaternion() });
  };
  let fits = fitsAt('hole_31'); // centre hole
  const best = fits[0];
  const beamX = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), deg(30));
  const pegLine = best && best.markers[0] ? best.markers[0].point.clone().sub(openFaces(turnedFeatures.find((f) => f.featureId === 'hole_31')).find((f) => f.outward.z > 0).point).normalize() : null;
  check('pick: corner connector into a beam turned 30°: best fit has both pegs in holes', best && best.green === 2 && best.total === 2, JSON.stringify(fits.map((f) => [f.featureId, f.roll, f.green, f.total])));
  check('  and its peg line runs along the beam\'s 30° hole row', pegLine && Math.abs(pegLine.dot(beamX)) > 0.999, JSON.stringify(pegLine?.toArray()));
  fits = fitsAt('hole_26'); // last centre hole, x = 63.5 along the beam
  check('pick: at the beam\'s last hole the best fit still has 2 in holes, and another fit has 1 green + 1 red', fits[0]?.green === 2 && fits.some((f) => f.green === 1 && f.total === 2), JSON.stringify(fits.map((f) => [f.featureId, f.roll, f.green])));
  const pinFits = fitsAt('hole_31', turned, turnedFeatures, '0x2 Connector Pin');
  check('pick: a single pin\'s 4 rolls collapse to one fit per leading end', pinFits.length === pinEnds.length, `${pinFits.length} fits, ${pinEnds.length} ends`);
  // Hole patterns not square to the receiving part: the angled face of a 30° corner connector
  // (poses from a real scene where the 2x3 corner connector couldn't be lined up before)
  {
    const recv = inst('angled', '2x Wide, 30 Degree Left 1x2 Corner Connector', [-15.011, 44.131, 378.096], [0, 0, -45]);
    const sel = inst('sel', '2x Wide, 2x3 Corner Connector', [-19.26, 39.661, 352.696], [-90, 45, -90]);
    const recvFeatures = worldFeaturesFor(recv);
    const opening = recvFeatures.find((f) => f.featureId === 'hole_1');
    const selPart = part('2x Wide, 2x3 Corner Connector');
    const results = openFaces(opening).map((face) => {
      const fit = listInsertFits({ partMeta: selPart, measured: getPartMeasurements(selPart), instanceId: 'sel', hovered: { opening, face }, receivingQuaternion: quatOf(recv.rotation), otherFeatures: recvFeatures, currentQuaternion: quatOf(sel.rotation) })[0];
      const at = (d) => ({ ...sel, position: fit.position.clone().addScaledVector(fit.direction, d).toArray(), rotation: fit.rotationDeg });
      let d = 0;
      while (d < fit.sweepMm && !checkCandidateCollision(at(d + 0.25), [recv]).isIntersecting) d += 0.25;
      return { green: fit.green, seated: findSeatedPairs(worldFeaturesFor(at(d)), recvFeatures).length, overlap: checkCandidateCollision(at(d), [recv]).isIntersecting };
    });
    check(
      'pick: 2x3 corner connector into the angled holes of a 30° corner connector: best fit has both pegs in holes, from either face',
      results.every((r) => r.green === 2),
      JSON.stringify(results)
    );
    check('  pushed in, both pegs end up seated and nothing overlaps', results.every((r) => r.seated === 2 && !r.overlap), JSON.stringify(results));
  }

  // A part with pins pointing two ways: only pins parallel to the anchor are marked
  const twoWay = (() => {
    const { catalog } = { catalog: JSON.parse(fs.readFileSync(new URL('../public/catalog.json', import.meta.url), 'utf8')) };
    return catalog.find((p) => {
      const pins = getLocalFeatures(p).filter((f) => f.kind === 'pin');
      return pins.length >= 2 && pins.some((a) => pins.some((b) => Math.abs(dot3v(a.axis, b.axis)) < 0.5));
    });
  })();
  if (twoWay) {
    const tFits = fitsAt('hole_31', turned, turnedFeatures, twoWay.name);
    const parallelOnly = tFits.every((fit) => {
      const world = collectWorldFeatures(twoWay, new THREE.Matrix4().compose(fit.position, fit.quaternion, new THREE.Vector3(1, 1, 1)), 'sel', getPartMeasurements(twoWay));
      const anchorAxis = world.find((w) => w.featureId === fit.featureId).axis;
      return fit.markers.every((m) => Math.abs(world.find((w) => w.featureId === m.featureId).axis.dot(anchorAxis)) > 0.999);
    });
    check(`pick: ${twoWay.name} (pins two ways): only pins parallel to the anchor are marked`, tFits.length > 0 && parallelOnly, `${tFits.length} fits`);
  } else {
    check('pick: found a part with pins pointing two ways for the parallel-only check', false);
  }
}

// ---------------------------------------------------------------------------
// Hole-to-hole alignment (hole-to-hole-alignment)
// ---------------------------------------------------------------------------
{
  const inst = (id, name, position, rotation = [0, 0, 0]) => ({ instanceId: id, label: id, partId: part(name).id, position, rotation });
  const X = new THREE.Vector3(1, 0, 0);
  const beam = inst('beam', '2x12 Beam', [0, 0, 0]); // holes along Z, top face z = 3.05
  const beamF = worldFeaturesFor(beam);
  // 2x2 corner connector turned so its holes point down at the beam; its lowest point is 6.2 below its origin
  const cc = (x, gapMm) => inst('cc', '2x Wide, 2x2 Corner Connector', [x, 0, 3.05 + gapMm + 6.2], [90, 0, 0]);

  // 1.1 rings
  let al = findAlignedOpenings(worldFeaturesFor(cc(6.35, 5)), beamF);
  check(
    'hole-to-hole: corner connector 5 mm above a beam: its two lined-up holes ring the beam holes, on the face toward it',
    al.length === 2 && al.every((a) => a.pairKind === 'hole' && a.outward.z > 0.999 && a.face.z > 0),
    JSON.stringify(al.map((a) => [a.pairKind, a.featureId, a.insertFeatureId, a.face.z.toFixed(2)]))
  );
  const pushedIn = inst('cc', '2x Wide, 2x2 Corner Connector', [6.35, 0, 6.2], [90, 0, 0]);
  check('  holes that overlap along the axis (pushed into each other) are not offered', findAlignedOpenings(worldFeaturesFor(pushedIn), beamF).every((a) => a.pairKind !== 'hole'));
  check('  holes of the same part never pair', findAlignedOpenings(beamF, beamF).length === 0);
  const motorAt = (dx, gapMm) => inst('motor', 'VEX IQ Smart Motor', [25.4 + 9.525 + dx, 0, 3.05 + gapMm], [-90, 0, 0]); // socket facing down
  al = findAlignedOpenings(worldFeaturesFor(motorAt(0, 4)), beamF);
  check(
    'hole-to-hole: a Smart Motor 4 mm above a beam lines its drive socket up with a beam hole (and its mounting holes too)',
    al.some((a) => a.insertFeatureId === 'motor_drive_socket' && a.featureId === 'hole_22' && a.pairKind === 'hole') && al.length > 1,
    JSON.stringify(al.map((a) => [a.featureId, a.insertFeatureId]))
  );
  check(
    '  pin/shaft cases keep pairKind "insert"',
    findAlignedOpenings(worldFeaturesFor(inst('pin', '0x2 Connector Pin', [25.4, 0, 12])), beamF).every((a) => a.pairKind === 'insert')
  );

  // 1.2 drag pull
  const snapX = (sel) => findHoleSnap(worldFeaturesFor(sel), beamF, [X]);
  let snap = snapX(cc(6.35 + 2, 1));
  check('hole-to-hole snap: corner connector 2 mm off along X, 1 mm above: pulled onto the beam holes', snap && near(snap.offset.x, -2) && near(snap.offset.y, 0) && near(snap.offset.z, 0), JSON.stringify(snap?.offset));
  const lower = inst('lower', '1x6 Beam', [0, 0, 0]);
  const upper = inst('upper', '1x6 Beam', [1.5, 0, 6.1 + 3]);
  snap = findHoleSnap(worldFeaturesFor(upper), worldFeaturesFor(lower), [X]);
  check('hole-to-hole snap: a 1x6 Beam 1.5 mm off over another, faces 3 mm apart: pulled into line', snap && near(snap.offset.x, -1.5), JSON.stringify(snap?.offset));
  snap = snapX(inst('gear', '36 Tooth Gear', [25.4 + 3, 0, 3.05 + 3.175 + 2]));
  check('hole-to-hole snap: a 36T gear bore 3 mm from a beam hole line: pulled onto it', snap && near(snap.offset.x, -3), JSON.stringify(snap?.offset));
  snap = snapX(motorAt(3, 3));
  check('hole-to-hole snap: a Smart Motor 3 mm off with its socket over a beam hole: pulled so the socket lines up', snap && near(snap.offset.x, -3), JSON.stringify(snap?.offset));

  // 1.3 stacking plans
  const start = cc(6.35, 5);
  const plans = planMates(findAlignedOpenings(worldFeaturesFor(start), beamF), 'cc');
  check('hole-to-hole plan: one direction, straight down at the beam', plans.length === 1 && plans[0].direction.z < -0.999 && plans[0].pairs.length === 2, JSON.stringify(plans.map((p) => p.direction.toArray())));
  // Run it like mateSelected: step until contact (or travel), the part must end flush on the beam
  const at = (d) => ({ ...start, position: [start.position[0], start.position[1], start.position[2] - d] });
  let d = 0;
  while (d < plans[0].sweepMm && !checkCandidateCollision(at(d + 0.05), [beam]).isIntersecting) d += 0.05;
  // Contact is found on the shrunk collision meshes (0.38 mm per part), so flat faces register within 0.76 mm, as for pin caps
  check('  stacking stops with the connector resting on the beam (5 mm down, within the 0.76 mm contact tolerance), not overlapping', d >= 5 - 0.06 && d <= 5.76 && !checkCandidateCollision(at(d), [beam]).isIntersecting, `${d.toFixed(2)} mm`);
  // A direction with both kinds of pair keeps the longer travel
  const pinPair = { pairKind: 'insert', insertInstanceId: 'cc', outward: new THREE.Vector3(0, 0, 1), start: new THREE.Vector3(0, 0, -3), end: new THREE.Vector3(0, 0, 3), insertStart: new THREE.Vector3(5, 0, 8), insertEnd: new THREE.Vector3(5, 0, 18), origin: new THREE.Vector3(0, 0, 0), insertOrigin: new THREE.Vector3(5, 0, 13), insertAxis: new THREE.Vector3(0, 0, 1) };
  const holePair = { ...pinPair, pairKind: 'hole', insertStart: new THREE.Vector3(0, 0, 6), insertEnd: new THREE.Vector3(0, 0, 9), insertOrigin: new THREE.Vector3(0, 0, 7.5) };
  const mixed = planMates([pinPair, holePair], 'cc');
  check('  a direction with a pin pair and a hole pair gets one plan with the longer travel', mixed.length === 1 && near(mixed[0].travelMm, 11) && near(mixed[0].sweepMm, 21), JSON.stringify(mixed.map((p) => [p.travelMm, p.sweepMm])));
}

// ---------------------------------------------------------------------------
// What double-click does when pins and holes line up (mateAction)
// ---------------------------------------------------------------------------
{
  const inst = (id, name, position, rotation = [0, 0, 0]) => ({ instanceId: id, label: id, partId: part(name).id, position, rotation });
  const ccName = '2x Wide, 2x2 Corner Connector';
  const hasPins = getLocalFeatures(part(ccName)).some((f) => f.kind === 'pin');
  const beam = inst('beam', '2x12 Beam', [0, 0, 0]);
  // Holes over the beam, pegs pointing sideways at nothing
  const cc = inst('cc', ccName, [6.35, 0, 3.05 + 5 + 6.2], [90, 0, 0]);
  const ccF = worldFeaturesFor(cc);
  let plans = planMates(findAlignedOpenings(ccF, worldFeaturesFor(beam)), 'cc');
  check('double-click: corner connector with only its holes lined up -> stacking arrow plus hole picking', mateAction(plans, hasPins) === 'arrows+pick', `${mateAction(plans, hasPins)} (${plans.length} plans)`);
  // Also a second beam standing in front of its pegs (pegs point -Y), holes along Y, 4 mm away
  const pegs = ccF.filter((f) => f.kind === 'pin');
  // A beam turned upright (Rx 90: its holes run along Y) whose +6.35 row holes sit on the pegs' lines,
  // its face 4 mm beyond the peg tips
  const tipY = Math.min(...pegs.flatMap((f) => [f.start.y, f.end.y]));
  const wall = inst('wall', '2x12 Beam', [0, tipY - 4 - 3.05, pegs[0].origin.z - 6.35], [90, 0, 0]);
  const wallHoleNear = worldFeaturesFor(wall).some((h) => h.kind === 'pin_hole' && Math.abs(h.axis.y) > 0.99 && Math.hypot(h.origin.x - pegs[0].origin.x, h.origin.z - pegs[0].origin.z) < 0.01);
  plans = planMates(findAlignedOpenings(ccF, [...worldFeaturesFor(beam), ...worldFeaturesFor(wall)]), 'cc');
  check(
    'double-click: pegs lined up with one beam and holes with another (different directions) -> two arrows',
    wallHoleNear && plans.length === 2 && mateAction(plans, hasPins) === 'arrows',
    JSON.stringify({ wallHoleNear, plans: plans.map((p) => [p.direction.toArray().map((v) => +v.toFixed(2)), p.pairs.map((x) => x.pairKind)]) })
  );
  check('double-click: a lone pin lined up with one hole -> mate now', mateAction(planMates(findAlignedOpenings(worldFeaturesFor(inst('pin', '0x2 Connector Pin', [25.4, 0, 12])), worldFeaturesFor(beam)), 'pin'), true) === 'mate');
  check('double-click: a beam over a beam (no pins) -> stack now', mateAction(planMates(findAlignedOpenings(worldFeaturesFor(inst('b2', '2x12 Beam', [0, 0, 10])), worldFeaturesFor(beam)), 'b2'), false) === 'mate');
  check('double-click: nothing lined up -> pick (with pins) or nothing (without)', mateAction([], true) === 'pick' && mateAction([], false) === 'none');
}

// ---------------------------------------------------------------------------
// Quick copy-insert: holes a fit fills (holesFilledByFit)
// ---------------------------------------------------------------------------
{
  const inst = (id, name, position, rotation = [0, 0, 0]) => ({ instanceId: id, label: id, partId: part(name).id, position, rotation });
  const beamF = worldFeaturesFor(inst('beam', '2x12 Beam', [0, 0, 0]));
  const opening = beamF.find((f) => f.featureId === 'hole_31');
  const face = openFaces(opening).find((f) => f.outward.z > 0);
  const fitsFor = (name) =>
    listInsertFits({ partMeta: part(name), measured: getPartMeasurements(part(name)), instanceId: 'sel', hovered: { opening, face }, receivingQuaternion: new THREE.Quaternion(), otherFeatures: beamF, currentQuaternion: new THREE.Quaternion() });
  const ccBest = fitsFor('2x Wide, 2x2 Corner Connector')[0];
  const ccHoles = holesFilledByFit(ccBest, { opening, face });
  check(
    'copy-insert: a corner connector\'s best fit fills 2 beam holes, the hovered one and its pattern neighbour 12.7 mm away',
    ccHoles.length === 2 && ccHoles[0] === opening && near(ccHoles[1].origin.distanceTo(opening.origin), 12.7, 0.01),
    JSON.stringify(ccHoles.map((h) => h.featureId))
  );
  const pinHoles = holesFilledByFit(fitsFor('0x2 Connector Pin')[0], { opening, face });
  check('copy-insert: a single pin fills 1 hole', pinHoles.length === 1 && pinHoles[0] === opening);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
