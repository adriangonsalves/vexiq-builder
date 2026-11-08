/**
 * Node check for the drop test's joint strengths and impact solve (openspec drop-load-network):
 * src/sim/fastenerStrength.js (grip and the slide-off rule), the body graph's joints, and
 * src/sim/impact.js (the network of parts and springs) on small hand-made builds and the starters.
 * Run: node scripts/check-impact.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT_DIR, getPartRawGeometry, partOf, playInputs } from '../mcp/assembly-engine.mjs';
import { buildBodyGraph } from '../src/sim/bodyGraph.js';
import { STRENGTH, allMeasured, gapStrengths, jointSpec, seatGrip, snapGrip } from '../src/sim/fastenerStrength.js';
import { buildImpactModel, landingQuaternion, solveImpact } from '../src/sim/impact.js';
import { starterById } from '../src/starters.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'catalog.json'), 'utf8'));
const P = (pn) => catalog.find((p) => p.partNumber === pn).id;
const BEAM_2X8 = '228-2500-023';
const PIN_1X1 = '228-2500-060';
const PIN_1X2 = '228-2500-061';
const PIN_0X2 = '228-2500-086';

// --- The table ------------------------------------------------------------------------------------
{
  const entries = Object.entries(STRENGTH);
  check(
    `strength table: ${entries.length} entries, each with a value, unit, source and note, all still assumed`,
    entries.length > 20 && entries.every(([, e]) => Number.isFinite(e.value) && e.unit && e.note && e.source === 'assumed') && allMeasured() === false
  );
}

// --- Grip and the slide-off rule ----------------------------------------------------------------
{
  check('deeper seating holds more: a 6 mm seat grips more than a 3 mm seat', seatGrip({ depthMm: 6 }) > seatGrip({ depthMm: 3 }));
  const weak = gapStrengths({ seats: [{ part: 'A', t: -3, depthMm: 4.8 }, { part: 'B', t: 3, depthMm: 4.8 }], blockers: [[-1, 1]], weak: true })[0];
  const strong = gapStrengths({ seats: [{ part: 'A', t: -3, depthMm: 4.8 }, { part: 'B', t: 3, depthMm: 4.8 }], blockers: [[-1, 1]] })[0];
  check('a weak pin holds 0.6× a regular one', near(weak.pullN, 0.6 * strong.pullN), JSON.stringify({ weak, strong }));
  // A capped pin: the plate under the cap can't slide off, so the joint holds what its plain end holds
  const capped = gapStrengths({ seats: [{ part: 'A', t: -3, depthMm: 4.8 }, { part: 'B', t: 3, depthMm: 4.8 }], blockers: [[-6.3, -5.5]] })[0];
  check(
    'a capped pin: its capped side is blocked, so the joint gives way only at its plain end, holding what that end grips',
    capped.way === 'high' && near(capped.pullN, seatGrip({ depthMm: 4.8 }) + snapGrip({})),
    JSON.stringify(capped)
  );
  // Long end of a pin through two parts: the outer part slides off alone, or both together
  const long = gapStrengths({ seats: [{ part: 'A', t: -9, depthMm: 5 }, { part: 'B', t: -3, depthMm: 5 }, { part: 'C', t: 3, depthMm: 5 }], blockers: [[-0.9, 0.9]] });
  check(
    'a pin through three parts: two gaps, the outer part on the long end slides off alone, and the shoulder stops the inner one',
    long.length === 2 && long[0].a === 'A' && long[0].way === 'low' && near(long[0].pullN, seatGrip({ depthMm: 5 }) + snapGrip({})) && long[1].a === 'B',
    JSON.stringify(long)
  );
}

// --- On real parts: a longer pin doesn't grip one part harder, and the cap is found on the mesh ------
const beams = (pinPn, z, rot = [0, 0, 0], extra = []) => ({
  instances: [
    { instanceId: 'A', partId: P(BEAM_2X8), label: 'A', position: [0, 0, 0], rotation: [0, 0, 0] },
    { instanceId: 'B', partId: P(BEAM_2X8), label: 'B', position: [0, 0, 6.35], rotation: [0, 0, 0] },
    { instanceId: 'C', partId: P(BEAM_2X8), label: 'C', position: [0, 0, 12.7], rotation: [0, 0, 0] },
    { instanceId: 'pin', partId: P(pinPn), label: 'pin', position: [-44.45, 6.35, z], rotation: rot },
    ...extra
  ]
});
{
  const one = buildBodyGraph(playInputs(beams(PIN_1X1, 3.175)));
  const longPin = buildBodyGraph(playInputs(beams(PIN_1X2, 9.525)));
  const ab1 = one.joints.find((j) => j.kind === 'pin' && j.a === 'A' && j.b === 'B');
  const ab2 = longPin.joints.find((j) => j.kind === 'pin' && j.a === 'A' && j.b === 'B');
  check(
    'a 1x1 pin and a 1x2 pin\'s short end, each fully in the same beam, hold the same pull against it',
    ab1 && ab2 && near(ab1.pullN, ab2.pullN, 0.02),
    JSON.stringify({ ab1: ab1?.pullN, ab2: ab2?.pullN })
  );
  const pins = longPin.joints.filter((j) => j.kind === 'pin');
  check('a 1x2 pin through three beams makes two joints (one per gap), not three', pins.length === 2, JSON.stringify(pins.map((j) => `${j.a}-${j.b}`)));
  const cap = buildBodyGraph(playInputs(beams(PIN_0X2, 3.175)));
  const capFlipped = buildBodyGraph(playInputs(beams(PIN_0X2, 3.175, [180, 0, 0])));
  const cj = cap.joints.find((j) => j.kind === 'pin');
  const cf = capFlipped.joints.find((j) => j.kind === 'pin');
  // Whichever way it's turned, the beam under the cap (A at z 0 when upright, B when flipped) stays on
  const under = (j, g) => (j.way === 'low' ? j.b : j.a);
  check('a 0x2 capped pin: the beam under its cap is the one that stays on, whichever way the pin is turned', cj && cf && under(cj) === 'A' && under(cf) === 'B', JSON.stringify({ cj, cf }));
}

// --- Joints along a shaft: collar, square fit, round holes, neighbours pressing -----------------------
const claw = { instances: starterById('clawbot').build(catalog) };
const clawGraph = buildBodyGraph(playInputs(claw));
{
  const label = (id) => clawGraph.partInfo[id]?.label;
  const axle = Object.keys(clawGraph.partInfo).find((id) => label(id) === 'Front Axle R');
  const on = clawGraph.joints.filter((j) => j.a === axle || j.b === axle);
  const kinds = new Set(on.map((j) => j.kind));
  const collar = on.find((j) => j.kind === 'collar');
  const square = on.find((j) => j.kind === 'square');
  const bearing = on.find((j) => j.kind === 'bearing');
  const pushes = clawGraph.joints.filter((j) => j.kind === 'push');
  check(
    'Clawbot front axle: round holes carry it sideways only, the wheel fits its square, the collar holds by friction, neighbours only push',
    kinds.has('bearing') && kinds.has('square') && kinds.has('collar') && collar.slipN === STRENGTH.collarSlipN.value && square.k.axial === 0 && bearing.k.axial === 0 && bearing.k.twist === 0 && pushes.length > 10 && pushes.every((j) => j.pushOnly),
    JSON.stringify([...kinds])
  );
  check(
    'a collar slides at a fraction of what a fully seated pin end holds',
    jointSpec('collar').slipN < 0.25 * (seatGrip({ depthMm: 4.8 }) + snapGrip({})),
    `${jointSpec('collar').slipN} N`
  );
  const tires = clawGraph.joints.filter((j) => j.kind === 'tire');
  check('each tire is held all round on its hub, and a Gen 1 battery in its brain, as one piece', tires.length === 2 && tires.every((j) => j.pullN === Infinity) && jointSpec('bay').pullN === Infinity);
}

// --- The network ---------------------------------------------------------------------------------
/** A hand-made build: parts as boxes (mm), all in one body, with joints between them. */
function handBuild(parts, joints) {
  const instances = parts.map((p) => ({ instanceId: p.id, partId: p.id, label: p.id, position: p.pos, rotation: p.rot || [0, 0, 0] }));
  const partInfo = Object.fromEntries(
    parts.map((p) => [p.id, { label: p.id, name: p.name, partNumber: '', category: p.category, box: { min: p.size.map((s) => -s / 2), max: p.size.map((s) => s / 2) }, weak: false }])
  );
  const graph = {
    bodies: [{ id: 'b0', parts: parts.map((p) => p.id) }],
    fixed: ['b0'],
    loose: [],
    pins: [],
    still: [],
    links: [],
    partInfo,
    joints: joints.map((j, i) => ({ id: `j${i}`, pinIds: [], ...j, ...jointSpec(j.kind, { pullN: j.pullN, depthMm: j.depthMm ?? 4.8 }) }))
  };
  return { graph, instances };
}
const pinPull = seatGrip({ depthMm: 4.8 }) + snapGrip({});
const drop = (build, height, landing = 'flat', points = null) => {
  const rot = new THREE.Matrix4().makeRotationFromQuaternion(landingQuaternion(landing));
  const model = buildImpactModel({ ...build, deltaOf: () => rot, pointsOf: points });
  return { model, result: solveImpact(model, { speed: Math.sqrt(2 * 9.81 * height) }) };
};
{
  // A 2x16 beam held at both ends on two posts
  const build = handBuild(
    [
      { id: 'beam', name: '2x16 Beam', category: 'Beams & Plates', size: [202.9, 6.1, 25.1], pos: [0, 40, 0] },
      { id: 'postL', name: 'Post', category: 'Connectors & Brackets', size: [12, 37, 12], pos: [-95.25, 18.5, 0] },
      { id: 'postR', name: 'Post', category: 'Connectors & Brackets', size: [12, 37, 12], pos: [95.25, 18.5, 0] }
    ],
    [
      { kind: 'pin', a: 'postL', b: 'beam', point: [-95.25, 37, 0], axis: [0, 1, 0], pullN: pinPull },
      { kind: 'pin', a: 'postR', b: 'beam', point: [95.25, 37, 0], axis: [0, 1, 0], pullN: pinPull }
    ]
  );
  const { model } = drop(build, 0.1);
  const beamNodes = model.nodesOf.get('beam');
  const nodeMass = model.nodes.reduce((s, n) => s + n.m, 0);
  check(`a 2x16 beam held at its ends flexes: ${beamNodes.length} nodes along it, joined by bending springs`, beamNodes.length >= 3 && model.conns.some((c) => c.kind === 'beam'));
  const { partMassKg } = await import('../src/sim/fastenerStrength.js');
  const partsMass = build.graph.bodies[0].parts.reduce((s, id) => s + partMassKg({ name: build.graph.partInfo[id].name, size: build.graph.partInfo[id].box.max.map((v, k) => v - build.graph.partInfo[id].box.min[k]) }), 0);
  check('the nodes carry the parts\' whole mass (within 0.1%)', near(nodeMass, partsMass, 1e-3), `${nodeMass} vs ${partsMass}`);
}
{
  // A lone beam dropped flat bounces back at a share of its landing speed
  const build = handBuild([{ id: 'beam', name: '2x8 Beam', category: 'Beams & Plates', size: [101.3, 6.1, 25.1], pos: [0, 0, 0] }], []);
  const speed = Math.sqrt(2 * 9.81 * 0.3);
  const { result } = drop(build, 0.3);
  const rebound = result.partVelocity.beam.v[1] / speed;
  check(`a lone beam dropped flat bounces back at ${rebound.toFixed(2)} of its landing speed (0.2–0.4)`, rebound >= 0.2 && rebound <= 0.4, JSON.stringify(result.partVelocity.beam));
}
{
  // The whole Clawbot stays steady: nothing ends faster than three times the landing speed
  const byId = new Map(claw.instances.map((i) => [i.instanceId, i]));
  const points = (id) => getPartRawGeometry(partOf(byId.get(id)))?.attributes.position.array;
  const speed = Math.sqrt(2 * 9.81 * 1.0);
  const { result } = drop({ graph: clawGraph, instances: claw.instances }, 1.0, 'flat', points);
  const fastest = Math.max(...Object.values(result.partVelocity).map((p) => Math.hypot(...p.v)));
  const finite = Object.values(result.partVelocity).every((p) => [...p.v, ...p.w].every(Number.isFinite));
  check(`Clawbot 1 m drop: the solve stays steady (fastest part ${fastest.toFixed(2)} m/s against ${speed.toFixed(2)} m/s landing, all values finite)`, finite && fastest < 3 * speed);
}

// --- Behaviour on hand-made builds ---------------------------------------------------------------
/**
 * A long Brain-weight base on two tires with an arm on a short riser at one end, held to the riser by two pins at its
 * root and reaching out over the base (clear of it) to a Smart Motor at its tip; `long` makes the arm a
 * 2x16 instead of a 2x8, `brace` adds a post from the base up under the arm's tip, `dx` moves the whole
 * build, `mirror` builds it the other way round. Joints j0 and j1 are the arm's root pins.
 */
function armBuild({ long = false, brace = false, dx = 0, mirror = false, rootPull = [pinPull, pinPull], tip: tipName = 'Smart Motor' } = {}) {
  const sx = mirror ? -1 : 1;
  const len = long ? 202.9 : 101.3;
  const tip = 25.4 + len;
  const X = (x) => sx * x + dx;
  const parts = [
    { id: 'base', name: 'VEX IQ Robot Brain Gen 2', category: 'Electronics & Motion', size: [300, 30, 60], pos: [X(100), 0, 0] },
    { id: 'riser', name: 'Riser', category: 'Electronics & Motion', size: [25.4, 20, 25], pos: [X(38.1), 25, 0] },
    { id: 'arm', name: long ? '2x16 Beam' : '2x8 Beam', category: 'Beams & Plates', size: [len, 6.1, 25.1], pos: [X(25.4 + len / 2), 38.05, 0] },
    { id: 'motor', name: tipName, category: 'Electronics & Motion', size: [40, 30, 40], pos: [X(tip - 20), 56.1, 0] }
  ];
  const joints = [
    { kind: 'pin', a: 'riser', b: 'arm', point: [X(31.75), 35, 0], axis: [0, 1, 0], pullN: rootPull[0] },
    { kind: 'pin', a: 'riser', b: 'arm', point: [X(44.45), 35, 0], axis: [0, 1, 0], pullN: rootPull[1] },
    { kind: 'pin', a: 'arm', b: 'motor', point: [X(tip - 26.35), 41.1, 0], axis: [0, 1, 0], pullN: pinPull },
    { kind: 'pin', a: 'arm', b: 'motor', point: [X(tip - 13.65), 41.1, 0], axis: [0, 1, 0], pullN: pinPull },
    { kind: 'pin', a: 'base', b: 'riser', point: [X(31.75), 15, 0], axis: [0, 1, 0], pullN: 1000 },
    { kind: 'pin', a: 'base', b: 'riser', point: [X(44.45), 15, 0], axis: [0, 1, 0], pullN: 1000 },
    { kind: 'tire', a: 'tireA', b: 'base', point: [X(0), -47, 0], axis: [0, 0, 1] },
    { kind: 'tire', a: 'tireB', b: 'base', point: [X(200), -47, 0], axis: [0, 0, 1] }
  ];
  // It stands on two tires, as a robot lands on its wheels
  parts.push({ id: 'tireA', name: 'Tire (200 mm Travel)', category: 'Wheels & Treads', size: [64, 64, 20], pos: [X(0), -47, 0] });
  parts.push({ id: 'tireB', name: 'Tire (200 mm Travel)', category: 'Wheels & Treads', size: [64, 64, 20], pos: [X(200), -47, 0] });
  if (brace) {
    parts.push({ id: 'brace', name: 'Post', category: 'Electronics & Motion', size: [12.7, 20, 12.7], pos: [X(tip - 50), 25, 0] });
    joints.push({ kind: 'pin', a: 'base', b: 'brace', point: [X(tip - 50), 15, 0], axis: [0, 1, 0], pullN: pinPull });
    joints.push({ kind: 'pin', a: 'brace', b: 'arm', point: [X(tip - 50), 35, 0], axis: [0, 1, 0], pullN: pinPull });
  }
  return handBuild(parts, joints);
}
const rootUse = (r) => Math.max(r.peakUse.j0 || 0, r.peakUse.j1 || 0);
const rootBroken = (r) => r.broken.some((b) => b.jointId === 'j0' || b.jointId === 'j1');
{
  const heavy = drop(armBuild({ long: true }), 0.1).result;
  const light = drop(armBuild({ long: true, tip: 'Light Block' }), 0.1).result;
  check(`a heavier load pries harder: with a Smart Motor at its tip the arm's root pins use ${Math.round(rootUse(heavy) * 100)}%, with a light block ${Math.round(rootUse(light) * 100)}%`, rootUse(heavy) > rootUse(light));
  // Bending softens the hit: the same arm ten times stiffer takes more at its root
  const keep = ['absE', 'beamMaxK', 'beamMaxRotK'].map((k) => [k, STRENGTH[k].value]);
  for (const [k, v] of keep) STRENGTH[k].value = v * 10;
  const stiff = drop(armBuild({ long: true }), 0.1).result;
  for (const [k, v] of keep) STRENGTH[k].value = v;
  check(`bending softens the hit: the arm made ten times stiffer uses ${Math.round(rootUse(stiff) * 100)}% at its root, as it is ${Math.round(rootUse(heavy) * 100)}%`, rootUse(stiff) > rootUse(heavy));
}
{
  // The lowest height at which the unbraced 2x16 arm's root pins let go; braced, they hold there
  let height = null;
  for (const h of [0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.2]) {
    if (rootBroken(drop(armBuild({ long: true }), h).result)) {
      height = h;
      break;
    }
  }
  const braced = height && drop(armBuild({ long: true, brace: true }), height).result;
  check(
    `bracing protects an arm: at ${height} m the unbraced arm's root pins let go, the braced arm's hold (${braced ? Math.round(rootUse(braced) * 100) : '?'}%)`,
    height !== null && braced && !rootBroken(braced)
  );
  // Load passes to the joint that's left: one root pin made weak lets go, and the other then carries more
  const base = drop(armBuild({ long: true }), 0.05).result;
  const weakened = drop(armBuild({ long: true, rootPull: [0.5, pinPull] }), 0.05).result;
  check(
    `load passes on: with one root pin giving way in the impact (slid ${weakened.slidMm.j0 || 'all the way'} mm), the other uses ${Math.round((weakened.peakUse.j1 || 0) * 100)}% of its strength instead of ${Math.round((base.peakUse.j1 || 0) * 100)}%`,
    (weakened.broken.some((b) => b.jointId === 'j0') || weakened.slidMm.j0 > 0) && (weakened.peakUse.j1 || 0) > (base.peakUse.j1 || 0)
  );
  // The result depends only on the build: moving it, or mirroring it, changes nothing
  const h = height || 0.5;
  const calm = Math.max(0.05, h / 2);
  const same = (x, y) => Object.entries(x.peakUse).every(([id, use]) => near(Math.min(1, use), Math.min(1, y.peakUse[id] || 0), 0.01));
  const sameBroken = (x, y) => x.broken.map((b) => b.jointId).sort().join() === y.broken.map((b) => b.jointId).sort().join();
  const [here, moved, mirrored] = [{}, { dx: 200 }, { mirror: true }].map((o) => drop(armBuild({ long: true, ...o }), calm).result);
  const [hereB, movedB, mirroredB] = [{}, { dx: 200 }, { mirror: true }].map((o) => drop(armBuild({ long: true, ...o }), h).result);
  check(
    `moving the build 200 mm loads every joint the same (to 1%, ${calm} m) and breaks the same joints (${hereB.broken.length} at ${h} m)`,
    same(here, moved) && sameBroken(hereB, movedB),
    JSON.stringify({ here: here.peakUse, moved: moved.peakUse })
  );
  check('a mirrored build loads every joint the same and breaks in the mirrored places', same(here, mirrored) && sameBroken(hereB, mirroredB), JSON.stringify({ here: here.peakUse, mirrored: mirrored.peakUse }));
  // Higher never does less
  let lastCount = -1;
  let lastUse = -1;
  let monotonic = true;
  const seen = [];
  for (const hh of [0.15, 0.3, 0.5, 0.8, 1.0, 1.5]) {
    const r = drop(armBuild({ long: true }), hh).result;
    const use = Math.min(1, Math.max(0, ...Object.values(r.peakUse)));
    seen.push(`${hh} m: ${r.broken.length} broken, ${use.toFixed(2)}`);
    if (r.broken.length < lastCount || use < lastUse - 1e-6) monotonic = false;
    lastCount = r.broken.length;
    lastUse = use;
  }
  check('a higher drop never breaks fewer joints or loads the busiest joint less', monotonic, seen.join('; '));
}
{
  // A gear on a shaft sticking out of the Brain, held on by a rubber collar; a bumper reaches further out
  const build = handBuild(
    [
      { id: 'base', name: 'VEX IQ Robot Brain Gen 2', category: 'Electronics & Motion', size: [100, 30, 60], pos: [0, 0, 0] },
      { id: 'shaft', name: '4x Pitch Shaft', category: 'Shafts, Spacers & Collars', size: [3.18, 3.18, 50], pos: [0, 0, 45] },
      { id: 'gear', name: '36 Tooth Gear', category: 'Gears, Sprockets & Pulleys', size: [48, 48, 6.35], pos: [0, 0, 40] },
      { id: 'collar', name: 'Rubber Shaft Collar', category: 'Shafts, Spacers & Collars', size: [11, 11, 6], pos: [0, 0, 47] },
      { id: 'bumper', name: 'Bumper', category: 'Connectors & Brackets', size: [20, 20, 60], pos: [40, 0, 60] }
    ],
    [
      { kind: 'bearing', a: 'shaft', b: 'base', point: [0, 0, 30], axis: [0, 0, 1] },
      { kind: 'square', a: 'shaft', b: 'gear', point: [0, 0, 40], axis: [0, 0, 1] },
      { kind: 'collar', a: 'shaft', b: 'collar', point: [0, 0, 47], axis: [0, 0, 1] },
      { kind: 'push', a: 'shaft', b: 'base', point: [0, 0, 24], axis: [0, 0, 1] },
      { kind: 'push', a: 'base', b: 'gear', point: [0, 0, 35], axis: [0, 0, 1] },
      { kind: 'push', a: 'gear', b: 'collar', point: [0, 0, 43.5], axis: [0, 0, 1] },
      { kind: 'pin', a: 'base', b: 'bumper', point: [34, 0, 30], axis: [0, 0, 1], pullN: pinPull },
      { kind: 'pin', a: 'base', b: 'bumper', point: [46, 0, 30], axis: [0, 0, 1], pullN: pinPull }
    ]
  );
  const flat = drop(build, 0.5, 'flat').result;
  const side = drop(build, 0.5, 'right').result;
  const slid = (r) => r.slidMm.j2 || (r.broken.some((b) => b.jointId === 'j2') ? 99 : 0);
  check(
    `a collar holds on a flat landing (${Math.round((flat.peakUse.j2 || 0) * 100)}%, not moved) and is pushed ${slid(side)} mm along its shaft when a side landing throws its gear outward`,
    !slid(flat) && slid(side) > 0,
    JSON.stringify({ flat: flat.slidMm, side: side.slidMm, broken: side.broken })
  );
  // It comes off only when pushed the rest of the shaft: with the shaft ending right at it, a harder side landing takes it off
  const shortShaft = { ...build, graph: { ...build.graph, joints: build.graph.joints.map((j) => (j.kind === 'collar' ? { ...j, travelM: 0.001 } : j)) } };
  const off = drop(shortShaft, 1.0, 'right').result;
  check('a collar at the very end of its shaft comes off when a side landing pushes it that last millimetre', off.broken.some((b) => b.jointId === 'j2' && b.failure === 'slid off'), JSON.stringify(off.broken));
}
{
  // Each landing turns its face straight down
  const down = new THREE.Vector3(0, -1, 0);
  const faces = { flat: [0, -1, 0], front: [1, 0, 0], back: [-1, 0, 0], left: [0, 0, -1], right: [0, 0, 1] };
  check('each landing turns its face of the build straight down', Object.entries(faces).every(([l, f]) => new THREE.Vector3(...f).applyQuaternion(landingQuaternion(l)).distanceTo(down) < 1e-9));
}

// --- The body graph as the app gets it: from the dev server, as JSON (an infinite strength arrives as null)
{
  const byId = new Map(claw.instances.map((i) => [i.instanceId, i]));
  const points = (id) => getPartRawGeometry(partOf(byId.get(id)))?.attributes.position.array;
  const fromServer = JSON.parse(JSON.stringify(clawGraph));
  const direct = drop({ graph: clawGraph, instances: claw.instances }, 1.0, 'flat', points).result;
  const viaJson = drop({ graph: fromServer, instances: claw.instances }, 1.0, 'flat', points).result;
  check(
    `the body graph sent as JSON (as the dev server sends it) drops the same: ${viaJson.broken.length} joints let go against ${direct.broken.length}`,
    viaJson.broken.length === direct.broken.length && Math.abs(viaJson.peakG - direct.peakG) < 0.01,
    JSON.stringify({ viaJson: viaJson.broken.slice(0, 3) })
  );
}

// --- Speed ------------------------------------------------------------------------------------------
{
  const flop = { instances: starterById('flop').build(catalog) };
  const flopGraph = buildBodyGraph(playInputs(flop));
  const byId = new Map(flop.instances.map((i) => [i.instanceId, i]));
  const points = (id) => getPartRawGeometry(partOf(byId.get(id)))?.attributes.position.array;
  const time = () => {
    const t0 = Date.now();
    const { result } = drop({ graph: flopGraph, instances: flop.instances }, 1.0, 'flat', points);
    return { ms: Date.now() - t0, result };
  };
  const first = time();
  const warm = time();
  // A corner landing tilts every part off the world's axes: the solve still holds steady (it once ran away)
  const corner = drop({ graph: flopGraph, instances: flop.instances }, 1.5, 'corner', points).result;
  check(
    `Flop 1.5 m corner landing stays steady (${corner.peakG.toFixed(0)} g, ${corner.broken.length} joints let go, step ${corner.dt * 1e6} µs)`,
    !corner.unsteady && Number.isFinite(corner.peakG) && Object.values(corner.partVelocity).every((p) => [...p.v, ...p.w].every(Number.isFinite))
  );
  // Nothing on a shaft leaves it sideways: a part round a shaft or a motor's socket can't break that way
  check('a part on a shaft, and a motor shaft in its socket, can only come off by sliding along it', jointSpec('bearing').shearN === Infinity && jointSpec('square').shearN === Infinity && jointSpec('socket').shearN === Infinity && !corner.broken.some((b) => ['bearing', 'square', 'socket'].includes(b.kind)));
  check(`Flop (${flop.instances.length} parts) 1 m drop worked out in ${warm.ms} ms once warmed up, under 1 s (first ${first.ms} ms; ${warm.result.nodeCount} nodes, ${warm.result.springCount} springs, ${warm.result.steps} steps)`, warm.ms < 1000);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll impact checks passed');
process.exit(failures ? 1 : 0);
