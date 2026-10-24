/**
 * Node check for src/utils/pinHoleAlignment.js against real catalog data.
 * Run: node scripts/check-pin-hole-alignment.mjs   (exits 1 on any failure)
 */
import * as THREE from 'three';
import { buildWorldMatrix, findPart, getPartCollisionBvh } from '../mcp/assembly-engine.mjs';
import {
  EXCLUDED_PART_NAMES,
  collectWorldFeatures,
  findAlignedOpenings,
  findEngagedJoints,
  getLocalFeatures,
  measureOpeningDepths,
  measureOpeningSurfaces,
  measurePinEnds,
  planMates
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

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
