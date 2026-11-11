/**
 * Checks rubber bands and belts (openspec rubber-bands): band sizes measured from the models, the
 * spots on parts, the path solver, stretch, and Hero Bot Swish's six bands (scripts/fixtures/
 * swish-bands.json, made by scripts/make-band-fixture.mjs) routed and solved against VEX's meshes.
 * Run: node scripts/check-bands.mjs   (exits 1 on failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT_DIR, buildWorldMatrix, getCatalog, getPartRawGeometry, getPartCollisionBvh } from '../mcp/assembly-engine.mjs';
import { BAND_SPECS, bandSpec, partSpots, routeFromPoints, solveBandPath, stretchOf, suggestBand, worldSpot } from '../src/utils/bandPath.js';
import { BAND_STRETCH, bandPullN, stretchState } from '../src/sim/bandStrength.js';
import { followBands, instanceMatrix, stringBand } from '../src/utils/bandRoute.js';
import { normalizeShape, shapedPart, shapeError } from '../src/utils/shapedParts.js';
import { partOf } from '../mcp/assembly-engine.mjs';
import { placeBand, rerouteBands } from '../src/engine/bandRouting.js';
import { bandOverlaps } from '../src/engine/bandFit.js';
import { partWrapEdges } from '../src/engine/bandHull.js';
import { routeHalf } from '../src/engine/bandStrand.js';
import { auditAssembly, checkCandidateCollision, mirrorSubassembly } from '../mcp/assembly-engine.mjs';
import { cloneSet } from '../src/utils/partGroups.js';
import { buildBodyGraph } from '../src/sim/bodyGraph.js';
import { createPhysics } from '../src/sim/physics.js';
import { createPlayRunner } from '../src/sim/playRunner.js';
import { createKinematic } from '../src/sim/kinematic.js';
import { getPartRawGeometry as rawGeo, playInputs } from '../mcp/assembly-engine.mjs';

let failed = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed++;
};
const { catalog, catalogById } = getCatalog();
const byNumber = (pn) => catalog.find((p) => p.partNumber === pn);
const byName = (name) => catalog.find((p) => p.name === name);
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'swish-bands.json'), 'utf8'));

// --- 1.2 Band sizes from the models ---
for (const [pn, spec] of Object.entries(BAND_SPECS)) {
  const part = byNumber(pn);
  if (!part) {
    check(`band ${pn} is in the library`, false);
    continue;
  }
  const a = getPartRawGeometry(part).attributes.position.array;
  const s = part.bbox.size;
  const ax = s.indexOf(Math.min(...s));
  const [u, v] = [0, 1, 2].filter((i) => i !== ax);
  const c = part.bbox.center;
  let rmin = Infinity;
  let rmax = 0;
  for (let i = 0; i < a.length; i += 3) {
    const r = Math.hypot(a[i + u] - c[u], a[i + v] - c[v]);
    rmin = Math.min(rmin, r);
    rmax = Math.max(rmax, r);
  }
  const free = Math.PI * (rmin + rmax);
  check(`${part.name}: free length, width and thickness match its model`, Math.abs(free - spec.freeMm) < 0.5 && Math.abs(s[ax] - spec.widthMm) < 0.1 && Math.abs(rmax - rmin - spec.thickMm) < 0.1, `${free.toFixed(1)} mm free, ${s[ax].toFixed(2)} wide, ${(rmax - rmin).toFixed(2)} thick`);
}
check('#117B free length is about 350 mm', Math.abs(BAND_SPECS['228-2500-470'].freeMm - 350) < 10);
check('2x30 belt free length is about 94 mm', Math.abs(BAND_SPECS['228-2500-1225'].freeMm - 94) < 1);

// --- Swish fixture: spots the bands wrap ---
const v3 = (a) => new THREE.Vector3(...a);
const bandPoints = (b) => {
  const out = [];
  for (let i = 0; i < b.points.length; i += 3) out.push([b.points[i], b.points[i + 1], b.points[i + 2]]);
  return out;
};
const instances = fixture.parts.map((p, k) => ({ ...p, instanceId: `swish-${k}` }));
/** Every spot (not gap hooks) on fixture parts near the band, in world space. */
function candidatesNear(points) {
  const box = new THREE.Box3().setFromPoints(points.map(v3)).expandByScalar(30);
  const out = [];
  for (const inst of instances) {
    const part = catalogById.get(inst.partId);
    const m = buildWorldMatrix(inst.position, inst.rotation);
    if (!box.intersectsBox(new THREE.Box3(v3(part.bbox.min), v3(part.bbox.max)).applyMatrix4(m))) continue;
    for (const s of partSpots(part)) if (s.kind !== 'gaphook' && !s.hidden) out.push({ ref: { instanceId: inst.instanceId, label: inst.label, feature: s.feature }, spot: worldSpot(s, m) });
  }
  return out;
}
const tail = (label) => label.split(': ').pop();
const routes = fixture.bands.map((b) => {
  const spec = bandSpec(catalogById.get(b.partId));
  const pts = bandPoints(b);
  return { band: b, spec, pts, route: routeFromPoints(pts, candidatesNear(pts), { thickMm: spec.thickMm }) };
});
for (const r of routes) console.log(`      ${r.band.path.split('/').pop().slice(0, 50)}: ${r.route.map((s) => `${tail(s.ref.label)} ${s.ref.feature} ${s.side}`).join(' -> ')}`);

const armBands = routes.filter((r) => /470 Bent [12]/.test(r.band.path));
const intake = routes.filter((r) => /catapultbot/.test(r.band.path));
const latch = routes.filter((r) => r.band.cadPartNumber === '228-2500-1225');
check('Swish has two arm bands, two intake bands and two latch belts', armBands.length === 2 && intake.length === 2 && latch.length === 2);
const distinct = (r) => [...new Set(r.route.map((s) => `${tail(s.ref.label).replace(/-\d+$/, '')} ${s.ref.feature}`))].sort();
const foldedRoute = (r) => r.route.length === 2 * new Set(r.route.map((s) => `${s.ref.instanceId}|${s.ref.feature}`)).size - 2;
for (const r of armBands) {
  check(
    `arm band ${r.band.path.match(/Bent \d/)[0]}: from a Catapult Arm standoff under a chassis 2x20 Beam, round another's bottom edge, to a chassis 0x3 Connector Pin and back`,
    foldedRoute(r) && distinct(r).join() === ['228-2500-030 edge:side+', '228-2500-030 edge:side-', '228-2500-065 post:body', '228-2500-087 post:pin'].join(),
    distinct(r).join(', ')
  );
}
// 1.3 Gap numbers in each sprocket's own frame, and the latch belt's spots on the right-angle beam
const gapsOf = (r) => [...new Set(r.route.filter((s) => s.spot.kind === 'gap').map((s) => Number(s.ref.feature.split(':')[1])))].sort((a, b) => a - b);
const upper = intake.find((r) => r.route.some((s) => /064-[1258]$/.test(s.ref.label)));
const lower = intake.find((r) => r.route.some((s) => /064-[3467]$/.test(s.ref.label)));
check('upper intake band: four upper standoffs, and gaps 17 and 23 on both inner sprockets', upper && upper.route.filter((s) => s.spot.kind === 'post').length === 4 && gapsOf(upper).join() === '17,23' && upper.route.filter((s) => s.spot.kind === 'gap').length === 4, upper ? `gaps ${gapsOf(upper)}` : 'not found');
check('lower intake band: four lower standoffs, and gaps 5 and 11 on both inner sprockets', lower && lower.route.filter((s) => s.spot.kind === 'post').length === 4 && gapsOf(lower).join() === '5,11' && lower.route.filter((s) => s.spot.kind === 'gap').length === 4, lower ? `gaps ${gapsOf(lower)}` : 'not found');
for (const r of latch) {
  check(
    `latch belt ${r.band.path.slice(-1)}: folded from a 1x Pitch Standoff round the 2x3 Right Angle Beam's two rounded ends to the pawl's 0x2 Connector Pin and back`,
    foldedRoute(r) && distinct(r).join() === ['228-2500-065 post:body', '228-2500-086 post:pin', '228-2500-145 edge:hole.thru.0_0_0', '228-2500-145 edge:hole.thru.4_0_0'].join(),
    distinct(r).join(', ')
  );
}

// --- 2.1 Spots on parts ---
const sprocket = byName('24 Tooth Sprocket');
const sprSpots = partSpots(sprocket);
check('a 24 Tooth Sprocket lists its rim and 24 gaps', sprSpots.filter((s) => s.kind === 'rim').length === 1 && sprSpots.filter((s) => s.kind === 'gap').length === 24 && sprSpots.filter((s) => s.kind === 'gaphook').length === 24);
check('a 0.5x Pitch Standoff lists one post (its body)', partSpots(byName('0.5x Pitch Standoff')).length === 1 && partSpots(byName('0.5x Pitch Standoff'))[0].feature === 'post:body');
const beam6 = partSpots(byName('1x6 Beam'));
check('a 1x6 Beam lists its two rounded ends', beam6.filter((s) => s.kind === 'edge' && s.label === 'end').length === 2, beam6.map((s) => s.feature).join(', '));
check('a 10mm Pulley lists its groove', partSpots(byName('10mm Pulley')).some((s) => s.kind === 'groove' && Math.abs(s.radius - 7.3) < 0.01));
check('a band has no spots of its own', partSpots(byNumber('228-2500-470')).length === 0);
check('the Rubber Band Anchor has its hook (from the hand table)', partSpots(byNumber('228-2500-157')).some((s) => s.kind === 'hook'));

// --- 2.2 The path solver ---
const post = (x, y, r, extra = {}) => ({ shape: 'circle', center: [x, y, 0], axis: [0, 0, 1], radius: r, span: [-3, 3], side: 'out', ...extra });
{
  const t = 1.5;
  const R = 3 + t / 2;
  const p = solveBandPath([post(0, 0, 3), post(100, 0, 3)], { thickMm: t });
  check('two parallel posts give the flat-belt length', Math.abs(p.lengthMm - (200 + 2 * Math.PI * R)) < 0.01, `${p.lengthMm.toFixed(3)} vs ${(200 + 2 * Math.PI * R).toFixed(3)}`);
  const pa = solveBandPath([post(0, 0, 10), post(80, 0, 10, { cross: true })], { thickMm: t });
  const Rs = 2 * (10 + t / 2);
  const crossed = 2 * Math.sqrt(80 * 80 - Rs * Rs) + Rs * (Math.PI + 2 * Math.asin(Rs / 80));
  check('a crossed belt between two pulleys takes the inner tangents', Math.abs(pa.lengthMm - crossed) < 0.05, `${pa.lengthMm.toFixed(3)} vs ${crossed.toFixed(3)}`);
  const w2 = solveBandPath([post(0, 0, 3, { wraps: 2 }), post(100, 0, 3)], { thickMm: t });
  check('2 wraps add one turn round that post', Math.abs(w2.lengthMm - p.lengthMm - 2 * Math.PI * R) < 0.01);
  const tri = solveBandPath([post(0, 0, 3), post(100, 0, 3), post(50, 80, 3)], { thickMm: t });
  const triLen = 100 + 2 * Math.hypot(50, 80) + 2 * Math.PI * R;
  check('three posts: the band goes round the outside', Math.abs(tri.lengthMm - triLen) < 0.05, `${tri.lengthMm.toFixed(2)} vs ${triLen.toFixed(2)}`);
  const inner = solveBandPath([post(0, 0, 3), post(50, 10, 3, { side: 'in' }), post(100, 0, 3), post(50, 80, 3)], { thickMm: t });
  check('a post set to inside pushes the band in (longer than going round the outside of the rest)', inner.lengthMm > tri.lengthMm + 1);
}

// --- 2.3 Stretch and pull ---
const findSpot = (labelTail, feature) => {
  const inst = instances.find((i) => i.label.endsWith(labelTail));
  return { ...worldSpot(partSpots(catalogById.get(inst.partId)).find((s) => s.feature === feature), buildWorldMatrix(inst.position, inst.rotation)), side: 'out' };
};
const B117 = BAND_SPECS['228-2500-470'];
const armTwo = solveBandPath([findSpot('228-2500-065-9', 'post:body'), findSpot('228-2500-087-5', 'post:pin')], { thickMm: B117.thickMm, widthMm: B117.widthMm });
const s117 = stretchOf(B117, armTwo.lengthMm);
check("Swish's arm band from standoff to pin is snug at about 1.6× with a #117B", stretchState(s117) === 'snug' && Math.abs(s117 - 1.6) < 0.15, `${s117.toFixed(2)}×`);
const belt = BAND_SPECS['228-2500-1225'];
const sBelt = stretchOf(belt, armTwo.lengthMm);
const sug = suggestBand(armTwo.lengthMm);
check('the same route with a 2x30 mm Square Silicone Belt is too far, and the #117B is suggested', stretchState(sBelt) === 'too far' && sug[0] === '228-2500-470', `${sBelt.toFixed(2)}×, suggests ${sug[1].name}`);
check('pull grows with stretch and is zero when slack', bandPullN('228-2500-470', 354, 300) === 0 && bandPullN('228-2500-470', 354, 600) > bandPullN('228-2500-470', 354, 500));
check('stretch states: slack, snug, tight, too far', ['slack', 'snug', 'tight', 'too far'].join() === [0.9, 1.5, 2.5, 3.5].map(stretchState).join());
check('stretch limits are listed as assumed values', Object.values(BAND_STRETCH).every((e) => e.source === 'assumed'));

// --- 2.4 Swish's routes solved, against VEX's own band meshes ---
for (const r of routes) {
  const path = solveBandPath(r.route.map((s) => ({ ...s.spot, side: s.side, wrapDir: s.wrapDir, key: `${s.ref.instanceId}|${s.ref.feature}` })), { thickMm: r.spec.thickMm, widthMm: r.spec.widthMm });
  const P = path.points;
  const d = r.pts.map((q) => {
    const p = v3(q);
    let best = Infinity;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      const ab = P[(i + 1) % P.length].clone().sub(a);
      const t = ab.lengthSq() ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / ab.lengthSq())) : 0;
      best = Math.min(best, a.clone().addScaledVector(ab, t).distanceTo(p));
    }
    // A point on the band's surface lies up to half its width from its middle line
    return Math.max(0, best - Math.hypot(r.spec.widthMm, r.spec.thickMm) / 2);
  });
  d.sort((a, b) => a - b);
  const median = d[Math.floor(d.length / 2)];
  const p90 = d[Math.floor(d.length * 0.9)];
  const arm = /470 Bent [12]/.test(r.band.path);
  const name = r.band.path.split('/').pop().replace(/\^.*?(-\d+)?(#\d)?$/, (m, a, b) => `${a || ''}${b || ''}`);
  // VEX draws the arm bands sagging in a free curve between the chassis and the arm, touching
  // nothing, where a stretched band runs straight: most of the band still lies on the solved path
  if (arm) check(`${name}: solved path lies on VEX's band (median within 4 mm; VEX draws a free curve where a stretched band runs straight)`, median <= 4, `median ${median.toFixed(2)} mm, 90% within ${p90.toFixed(2)} mm, ${stretchOf(r.spec, path.lengthMm).toFixed(2)}×`);
  else check(`${name}: solved path lies within 2 mm of VEX's band (90% of it; 2.5 mm for the folded latch belts)`, p90 <= (r.band.cadPartNumber === '228-2500-1225' ? 2.5 : 2), `median ${median.toFixed(2)} mm, 90% within ${p90.toFixed(2)} mm, ${stretchOf(r.spec, path.lengthMm).toFixed(2)}×`);
}

// --- 3.1 The band shape kind ---
const toEntry = (s) => {
  const inst = instances.find((i) => i.instanceId === s.ref.instanceId);
  const q = new THREE.Quaternion().setFromRotationMatrix(instanceMatrix(inst)).invert();
  return { instanceId: s.ref.instanceId, feature: s.ref.feature, side: s.side, wraps: 1, ...(s.wrapDir ? { wrap: v3(s.wrapDir).applyQuaternion(q).toArray().map((n) => Number(n.toFixed(4))) } : {}) };
};
const swishState = { instances: instances.map((i) => ({ ...i, visible: true })) };
const upperEntries = upper.route.map(toEntry);
const newBand = (pn) => ({ instanceId: `band-${pn}`, partId: byNumber(pn).id, label: byNumber(pn).name, position: [0, 0, 0], rotation: [0, 0, 0], visible: true });
const strungUpper = stringBand(newBand('228-2500-470'), upperEntries, swishState.instances, partOf);
check('a #117B strung round the upper intake route', !strungUpper.error && strungUpper.shape.route.length === 8, strungUpper.error || `${strungUpper.stretch.toFixed(2)}×`);
const shaped = shapedPart(byNumber('228-2500-470'), strungUpper.shape);
const reloaded = shapedPart(byNumber('228-2500-470'), JSON.parse(JSON.stringify(normalizeShape(strungUpper.shape))));
check('a saved band shape reloads to the same box', shaped.bbox && JSON.stringify(shaped.bbox) === JSON.stringify(reloaded.bbox) && shaped.id === reloaded.id, JSON.stringify(shaped.bbox.size));
check('a band part with no shape stays a flat ring', shapedPart(byNumber('228-2500-468'), null) === byNumber('228-2500-468'));
check('only bands can be strung', shapeError(byName('1x6 Beam'), strungUpper.shape) === 'Only rubber bands and belts can be strung.');
check("a strung band's box spans the intake (about 210 mm across)", Math.abs(Math.max(...shaped.bbox.size) - 215) < 12, `${Math.max(...shaped.bbox.size).toFixed(1)} mm`);

// --- 3.2 place_band ---
const placed = placeBand(swishState, { bandPartId: byNumber('228-2500-470').id, spots: upperEntries });
check('place_band strings a new #117B through the intake gaps', placed.ok && placed.state.instances.length === swishState.instances.length + 1, placed.error || placed.message);
const noGaps = upperEntries.filter((s) => !s.feature.startsWith('gap:'));
const auto = placeBand(swishState, { bandPartId: byNumber('228-2500-470').id, spots: noGaps });
const autoGaps = auto.ok ? [...new Set(auto.route.filter((s) => s.feature.startsWith('gap:')).map((s) => s.feature))].sort() : [];
// Each run that would cut a sprocket's web goes through the gap that makes the band shortest: next
// to the one VEX uses (within two teeth; the band's own side of the standoff decides the rest)
const near24 = (k, ks) => ks.some((j) => Math.min(Math.abs(k - j), 24 - Math.abs(k - j)) <= 2);
const autoK = auto.ok ? auto.route.filter((s) => s.feature.startsWith('gap:')).map((s) => Number(s.feature.split(':')[1])) : [];
check("without the gaps, runs cutting through the inner sprockets' webs go through gaps on their own, next to VEX's", auto.ok && autoK.length >= 2 && autoK.every((k) => near24(k, [17, 23])), auto.error || `gaps ${autoGaps}`);
const armEntries = [
  { instanceId: instances.find((i) => i.label.endsWith('228-2500-065-9')).instanceId, feature: 'post:body' },
  { instanceId: instances.find((i) => i.label.endsWith('228-2500-087-5')).instanceId, feature: 'post:pin' }
];
const arm = placeBand(swishState, { bandPartId: byNumber('228-2500-470').id, spots: armEntries });
// Two clicks across Swish's crowded chassis: placed overlapping nothing, or refused changing nothing
const armOverlaps = arm.ok ? checkCandidateCollision(arm.state.instances.find((i) => i.instanceId === arm.instanceId), arm.state.instances).collidingWith : [];
check("a band whose straight run crosses Swish's chassis is wound round the parts overlapping nothing, or refused with nothing changed", arm.ok ? armOverlaps.length === 0 : !arm.state && Array.isArray(arm.needsRoute), arm.ok ? `${arm.message} overlaps: ${armOverlaps.map((c) => c.label).join(', ')}` : arm.error);

// A small build (scripts/fixtures/band-wrap.json): bands between pins and standoffs wrap the beams
// and corner connector in their way, and a pin buried in the parts it joins is refused
{
  const wrap = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'band-wrap.json'), 'utf8'));
  const W = { instances: wrap.instances };
  const id = (tail) => wrap.instances.find((i) => i.instanceId.endsWith(tail)).instanceId;
  const pairs = [
    ['739-zqal', 'post:pin', '297-cp2r', 'post:body'],
    ['297-cp2r', 'post:body', '837-wbyr', 'post:body'],
    ['739-zqal', 'post:pin', '837-wbyr', 'post:body', '228-2500-222']
  ];
  for (const [a, fa, b, fb, pn = '228-2500-468'] of pairs) {
    const r = placeBand(W, { bandPartId: byNumber(pn).id, spots: [{ instanceId: id(a), feature: fa }, { instanceId: id(b), feature: fb }] });
    const col = r.ok ? checkCandidateCollision(r.state.instances.find((i) => i.instanceId === r.instanceId), r.state.instances) : null;
    check(`a #32 from ${a} to ${b} wraps the parts between them and overlaps nothing`, r.ok && r.addedInWay.length > 0 && col.collidingWith.length === 0, r.error || `${r.message} overlaps: ${col.collidingWith.map((c) => c.label).join(', ')}`);
  }
  // Under both beams from one standoff to the other, back the same way: just those four spots
  const under = placeBand(W, { bandPartId: byNumber('228-2500-468').id, back: 'same', spots: [{ instanceId: id('837-wbyr'), feature: 'post:body' }, { instanceId: id('825-dqdw'), feature: 'edge:side-' }, { instanceId: id('868-i11q'), feature: 'edge:side-' }, { instanceId: id('297-cp2r'), feature: 'post:body' }] });
  const underCol = under.ok ? checkCandidateCollision(under.state.instances.find((i) => i.instanceId === under.instanceId), under.state.instances).collidingWith : [];
  const onlyBeams = (r) => r.ok && r.route.every((x) => /837-wbyr|297-cp2r|825-dqdw|868-i11q/.test(x.instanceId)) && r.route.filter((x) => /825-dqdw|868-i11q/.test(x.instanceId)).every((x) => x.feature === 'wrap' || /^edge:/.test(x.feature));
  check('a band from one standoff to the other under both beams, back the same way, bends only on those two beams and overlaps nothing', onlyBeams(under) && !underCol.length, under.error || `${under.message} overlaps: ${underCol.map((c) => c.label).join(', ')}`);
  const underAuto = placeBand(W, { bandPartId: byNumber('228-2500-468').id, spots: [{ instanceId: id('837-wbyr'), feature: 'post:body' }, { instanceId: id('825-dqdw'), feature: 'edge:side-' }, { instanceId: id('868-i11q'), feature: 'edge:side-' }, { instanceId: id('297-cp2r'), feature: 'post:body' }] });
  check('the same four clicks with no back given come back the same way by themselves (two hooks, two edges)', onlyBeams(underAuto) && !underAuto.state.instances.find((i) => i.instanceId === underAuto.instanceId).isIntersecting, underAuto.error || underAuto.message);
  const buried = placeBand(W, { bandPartId: byNumber('228-2500-468').id, spots: [{ instanceId: id('387-8sct'), feature: 'post:pin' }, { instanceId: id('297-cp2r'), feature: 'post:body' }] });
  check('a pin with nothing sticking out of the parts it joins is refused, saying so', !buried.ok && /sticks out/.test(buried.error), buried.error || buried.message);
}
// --- 9.1 Routing rework (design decision 11): fold by default, no overlaps, no slack bands ---
// The deepest any point of a band's strip (middle, corners, side middles, every 1 mm) sits inside
// each part's collision mesh, in mm
function stripDepth(band, instances) {
  const spec = bandSpec(partOf({ ...band, shape: undefined }));
  const P = band.shape.path.points.map((p) => new THREE.Vector3(p[0] + band.position[0], p[1] + band.position[1], p[2] + band.position[2]));
  const U = band.shape.path.ups.map((u) => new THREE.Vector3(...u));
  const samples = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    const L = a.distanceTo(b);
    if (L < 1e-3) continue;
    const t = b.clone().sub(a).normalize();
    const up = U[i].clone().addScaledVector(t, -U[i].dot(t)).normalize();
    const ac = new THREE.Vector3().crossVectors(t, up).normalize();
    for (let k = 0, n = Math.max(1, Math.ceil(L)); k < n; k++) {
      const q = a.clone().lerp(b, k / n);
      for (const [x, y] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) samples.push(q.clone().addScaledVector(up, x * (spec.widthMm / 2 - 0.05)).addScaledVector(ac, y * (spec.thickMm / 2 - 0.05)));
    }
  }
  const out = {};
  const ray = new THREE.Ray();
  const hit = { point: new THREE.Vector3(), distance: 0 };
  for (const inst of instances) {
    if (inst.instanceId === band.instanceId || inst.shape?.kind === 'band') continue;
    const part = partOf(inst);
    if (!part?.bbox) continue;
    const inv = buildWorldMatrix(inst.position, inst.rotation).clone().invert();
    const box = new THREE.Box3(new THREE.Vector3(...part.bbox.min), new THREE.Vector3(...part.bbox.max));
    const got = getPartCollisionBvh(part);
    const pieces = (Array.isArray(got) ? got : got?.pieces || [got]).map((g) => g?.geo || g).filter((g) => g?.boundsTree);
    let max = 0;
    for (const p of samples) {
      const l = p.clone().applyMatrix4(inv);
      if (!box.containsPoint(l)) continue;
      let votes = 0;
      for (const d of [[1, 0.013, 0.007], [0.011, 1, 0.005], [0.009, 0.004, 1]]) {
        ray.origin.copy(l);
        ray.direction.set(...d).normalize();
        let c = 0;
        for (const g of pieces) c += g.boundsTree.raycast(ray, THREE.DoubleSide).length;
        if (c % 2) votes++;
      }
      if (votes < 2) continue;
      for (const g of pieces) {
        const r = g.boundsTree.closestPointToPoint(l, hit);
        if (r) max = Math.max(max, r.distance);
      }
    }
    if (max > 0) out[inst.instanceId] = max;
  }
  return out;
}
{
  const wrap = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'band-wrap.json'), 'utf8'));
  const W = { instances: wrap.instances };
  const id = (tail) => wrap.instances.find((i) => i.instanceId.endsWith(tail)).instanceId;
  const BELT40 = '228-2500-222';
  const key = (s) => `${s.instanceId}|${s.feature}`;
  // The way back is the way out's middle entries reversed: [A, m1..mk, B, mk..m1]
  const folded = (route) => {
    const n = route.length;
    if (n < 2 || n % 2) return n === 2;
    const k = (n - 2) / 2;
    const out = route.slice(1, k + 1).map(key);
    const back = route.slice(k + 2).map(key).reverse();
    return out.length === back.length && out.every((x, i) => x === back[i]);
  };
  const cases = [
    ['a', BELT40, '837-wbyr', 'post:body', '739-zqal', 'post:pin', 'A'],
    ['b', '228-2500-468', '297-cp2r', 'post:body', '837-wbyr', 'post:body', 'A'],
    ['c', '228-2500-468', '739-zqal', 'post:pin', '297-cp2r', 'post:body', 'A'],
    ['d', '228-2500-470', '297-cp2r', 'post:body', '837-wbyr', 'post:body', 'B']
  ];
  for (const [name, pn, a, fa, b, fb, stage] of cases) {
    const r = placeBand(W, { bandPartId: byNumber(pn).id, spots: [{ instanceId: id(a), feature: fa }, { instanceId: id(b), feature: fb }] });
    const band = r.ok ? r.state.instances.find((i) => i.instanceId === r.instanceId) : null;
    const depth = band ? stripDepth(band, r.state.instances) : {};
    const deepest = Math.max(0, ...Object.values(depth));
    const spots = r.ok ? new Set(r.route.map(key)).size : 0;
    const limit = stage === 'A' ? 0.5 : 0.3;
    const noBox = r.ok && !r.route.some((s) => /^box:/.test(s.feature));
    check(`[stage ${stage}] case (${name}) ${a} -> ${b}: comes back the way it went, at most 5 spots, ${limit} mm deep at most${stage === 'B' ? ', no box edges' : ''}`, r.ok && folded(r.route) && spots <= 5 && deepest <= limit && (stage === 'A' || noBox), r.error || `${r.route.map((s) => `${s.instanceId.slice(-4)} ${s.feature}`).join(' > ')}; ${r.stretch}x; deepest ${deepest.toFixed(2)} mm`);
  }
  for (const pn of ['228-2500-470', '228-2500-468']) {
    const spots = [{ instanceId: id('837-wbyr'), feature: 'post:body' }, { instanceId: id('739-zqal'), feature: 'post:pin' }];
    const r = placeBand(W, { bandPartId: byNumber(pn).id, spots });
    const loose = placeBand(W, { bandPartId: byNumber(pn).id, spots, allowSlack: true });
    check(`[stage A] a ${BAND_SPECS[pn].name} on case (a) is refused as slack with a smaller size named, and placed with allowSlack`, !r.ok && /loose|slack/i.test(r.error || '') && r.suggestion && loose.ok, r.ok ? `placed at ${r.stretch}x` : r.error);
  }
}
// --- 9.4 One overlap rule for bands ---
{
  const wrap = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'band-wrap.json'), 'utf8'));
  const W = { instances: wrap.instances };
  const id = (tail) => wrap.instances.find((i) => i.instanceId.endsWith(tail)).instanceId;
  const good = [
    ['228-2500-222', [['837-wbyr', 'post:body'], ['739-zqal', 'post:pin']]],
    ['228-2500-468', [['297-cp2r', 'post:body'], ['837-wbyr', 'post:body']]],
    ['228-2500-468', [['739-zqal', 'post:pin'], ['297-cp2r', 'post:body']]]
  ];
  for (const [pn, spots] of good) {
    const r = placeBand(W, { bandPartId: byNumber(pn).id, spots: spots.map(([t, f]) => ({ instanceId: id(t), feature: f })) });
    const band = r.ok ? r.state.instances.find((i) => i.instanceId === r.instanceId) : null;
    const t0 = Date.now();
    const over = band ? bandOverlaps(band, r.state.instances) : null;
    check(`overlap rule: the band ${spots.map(([t]) => t).join(' -> ')} overlaps nothing, its own parts included`, over && !over.length, r.error || `${JSON.stringify(over)} in ${Date.now() - t0} ms`);
  }
  const through = placeBand(W, { bandPartId: byNumber('228-2500-222').id, ignoreInWay: true, allowSlack: true, spots: [{ instanceId: id('837-wbyr'), feature: 'post:body' }, { instanceId: id('739-zqal'), feature: 'post:pin' }] });
  const tb = through.ok ? through.state.instances.find((i) => i.instanceId === through.instanceId) : null;
  const tOver = tb ? bandOverlaps(tb, through.state.instances) : [];
  const tAudit = tb ? auditAssembly({ instances: through.state.instances }) : null;
  check('overlap rule: the audit reports the band strung through beam dqdw, and the band is flagged', tb?.isIntersecting === true && JSON.stringify(tAudit?.collisions || []).includes(id('825-dqdw')), JSON.stringify(tAudit?.collisions || []).slice(0, 300));
  check('overlap rule: a band strung straight through beam dqdw is reported against it', tOver.some((o) => o.instanceId === id('825-dqdw')), through.error || JSON.stringify(tOver));
  let st = swishState;
  const ids = [];
  for (const r of routes) {
    const res = placeBand(st, { bandPartId: byNumber(/1225/.test(r.band.path) ? '228-2500-1225' : '228-2500-470').id, spots: r.route.map(toEntry), ignoreInWay: true });
    if (res.ok) {
      st = res.state;
      ids.push(res.instanceId);
    }
  }
  if (process.env.BAND_DEBUG) for (const bid of ids) { const b = st.instances.find((i) => i.instanceId === bid); console.log('   ', b.label, b.shape.route.map((x) => `${st.instances.find((i) => i.instanceId === x.instanceId)?.label.split(': ').pop()} ${x.feature}`).join(' > '), JSON.stringify(bandOverlaps(b, st.instances).map((o) => [o.label.split(': ').pop(), o.depthMm]))); }
  const found = ids.flatMap((bid) => bandOverlaps(st.instances.find((i) => i.instanceId === bid), st.instances).map((o) => o.label));
  const unknown = found.filter((l) => !/1253-[16]\b/.test(l));
  check('overlap rule: the six Swish bands overlap nothing but the two known corner connectors', ids.length === 6 && !unknown.length, `${ids.length} bands; ${found.join(', ') || 'none'}`);
}
// --- 9.9 The outer corners a band bends round ---
{
  const want = { '2x14 Beam': 64, '2x Wide, 2x2 Corner Connector (Weak)': 43, '2x3 Right Angle Beam': 62, '4x8 Plate': 52 };
  for (const [name, n] of Object.entries(want)) {
    const part = byName(name);
    const t0 = Date.now();
    const edges = part ? partWrapEdges(part).filter((e) => e.a) : [];
    const ms = Date.now() - t0;
    // No edge's middle, moved 0.5 mm out, is inside the part
    const geo = getPartCollisionBvh(part);
    const pieces = (Array.isArray(geo) ? geo : geo?.pieces || [geo]).map((g) => g?.geo || g).filter((g) => g?.boundsTree);
    const ray = new THREE.Ray();
    const inside = edges.filter((e) => {
      const m = v3(e.a).add(v3(e.b)).multiplyScalar(0.5).addScaledVector(v3(e.out), 0.5);
      let votes = 0;
      for (const d of [[1, 0.013, 0.007], [0.011, 1, 0.005], [0.009, 0.004, 1]]) {
        ray.origin.copy(m);
        ray.direction.set(...d).normalize();
        let c = 0;
        for (const g of pieces) c += g.boundsTree.raycast(ray, THREE.DoubleSide).length;
        if (c % 2) votes++;
      }
      return votes >= 2;
    });
    let corners = true;
    if (name === '2x14 Beam') {
      const longest = [...edges].sort((x, y) => v3(y.a).distanceTo(v3(y.b)) - v3(x.a).distanceTo(v3(x.b))).slice(0, 4);
      const box = part.bbox;
      const longAxis = box.size.indexOf(Math.max(...box.size));
      corners = longest.every((e) => {
        const m = v3(e.a).add(v3(e.b)).multiplyScalar(0.5).toArray();
        return [0, 1, 2].filter((k) => k !== longAxis).every((k) => Math.min(Math.abs(m[k] - box.min[k]), Math.abs(m[k] - box.max[k])) < 1);
      });
    }
    check(`${name}: ${n} outer corners within 10%, none inside it${name === '2x14 Beam' ? ', the four longest on its box\'s long corners' : ''}`, Math.abs(edges.length - n) <= n * 0.1 && !inside.length && corners, `${edges.length} edges, ${inside.length} inside, ${ms} ms`);
  }
  const standoff = byName('0.25x Pitch Standoff');
  check('a 0.25x Pitch Standoff has no straight corners and gives its post instead', partWrapEdges(standoff).every((e) => e.circle) && partWrapEdges(standoff).some((e) => e.circle === 'post:body'));
}
// --- 9.10 A bend round one corner of a part, carried by the route ---
{
  const wrap = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'band-wrap.json'), 'utf8'));
  const inst = (tail) => wrap.instances.find((i) => i.instanceId.endsWith(tail));
  const beam = inst('825-dqdw');
  const m = instanceMatrix(beam);
  const so = v3(inst('837-wbyr').position);
  const pin = v3(inst('739-zqal').position);
  const mid = so.clone().add(pin).multiplyScalar(0.5);
  const lineDist = (e) => new THREE.Line3(v3(e.a).applyMatrix4(m), v3(e.b).applyMatrix4(m)).closestPointToPoint(mid, true, new THREE.Vector3()).distanceTo(mid);
  const corner = partWrapEdges(partOf(beam)).filter((e) => e.a && v3(e.a).distanceTo(v3(e.b)) > 100).sort((x, y) => lineDist(x) - lineDist(y))[0];
  const route = [
    { instanceId: beam.instanceId.replace('825-dqdw', '825-dqdw'), feature: 'wrap', line: [corner.a, corner.b], wrap: corner.out, side: 'out', wraps: 1, auto: true }
  ];
  const full = [{ instanceId: inst('837-wbyr').instanceId, feature: 'post:body', side: 'out', wraps: 1 }, route[0], { instanceId: inst('739-zqal').instanceId, feature: 'post:pin', side: 'out', wraps: 1 }, { ...route[0] }];
  const bandI = { instanceId: 'b-wrap', partId: byNumber('228-2500-222').id, position: [0, 0, 0], rotation: [0, 0, 0], visible: true };
  const s1 = stringBand(bandI, full, wrap.instances, partOf);
  const onLine = (st) => {
    const c = st.contacts[1];
    const L = new THREE.Line3(v3(corner.a).applyMatrix4(instanceMatrix(st.beam)), v3(corner.b).applyMatrix4(instanceMatrix(st.beam)));
    return [c.a, c.b].map((p) => L.closestPointToPoint(v3(p), true, new THREE.Vector3()).distanceTo(v3(p)));
  };
  s1.beam = beam;
  const moved = wrap.instances.map((i) => (i.instanceId === beam.instanceId ? { ...i, position: [i.position[0], i.position[1] + 10, i.position[2]] } : i));
  const s2 = stringBand(bandI, full, moved, partOf);
  s2.beam = moved.find((i) => i.instanceId === beam.instanceId);
  const shift = !s1.error && !s2.error ? v3(s2.contacts[1].a).distanceTo(v3(s1.contacts[1].a)) : NaN;
  const d1 = s1.error ? [99] : onLine(s1);
  check('a route bending round a beam\'s corner solves, touches that corner, and follows the beam when it moves 10 mm across its corner (along it, the band just slides)', !s1.error && !s2.error && Math.max(...d1) < 1 + Math.SQRT2 + 1.5 && Math.abs(shift - 10) < 1.5 && s1.shape.route[1].line && s1.shape.route[1].auto, s1.error || `contact ${d1.map((d) => d.toFixed(2)).join('/')} mm off the corner, moved ${shift.toFixed(2)} mm`);
}
// --- 9.11 One half of a band, the shortest clear way round the real corners ---
{
  const wrap = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'band-wrap.json'), 'utf8'));
  const W = { instances: wrap.instances };
  const id = (tail) => wrap.instances.find((i) => i.instanceId.endsWith(tail)).instanceId;
  const bandOf = (pn) => ({ instanceId: 'b-half', partId: byNumber(pn).id, position: [0, 0, 0], rotation: [0, 0, 0], visible: true });
  const halfCase = (pn, a, fa, b, fb, test, name) => {
    const A = { instanceId: id(a), feature: fa, side: 'out', wraps: 1 };
    const B = { instanceId: id(b), feature: fb, side: 'out', wraps: 1 };
    const t0 = Date.now();
    const r = routeHalf(W, bandOf(pn), A, B, { fold: true });
    const ms = Date.now() - t0;
    let detail = r.error || (r.blockedBy ? `blocked by ${r.blockedBy.map((x) => x.label).join(', ')}` : '');
    let ok = false;
    if (r.bends) {
      const half = [A, ...r.bends, B];
      const st = stringBand(bandOf(pn), [...half, ...half.slice(1, -1).reverse()], W.instances, partOf);
      const band = { ...bandOf(pn), position: st.position, rotation: st.rotation, shape: st.shape };
      const deepest = Math.max(0, ...Object.values(stripDepth(band, W.instances)));
      ok = test(r.bends, st) && deepest <= 0.3 && ms < 300;
      detail = `${r.bends.length} bends on ${r.bends.map((x) => x.instanceId.slice(-4)).join(', ')}, ${st.lengthMm.toFixed(1)} mm, deepest ${deepest.toFixed(2)} mm, ${ms} ms`;
    }
    check(name, ok, detail);
  };
  halfCase('228-2500-468', '297-cp2r', 'post:body', '837-wbyr', 'post:body', (bends, st) => bends.length >= 2 && bends.length <= 4 && bends.every((x) => /i11q|dqdw/.test(x.instanceId)) && st.lengthMm <= 368.5, 'a #32 from standoff to standoff bends only on the two beams\' corners (2 to 4 bends), no longer than before, 0.3 mm deep at most, under 300 ms');
  halfCase('228-2500-222', '837-wbyr', 'post:body', '739-zqal', 'post:pin', (bends) => bends.length >= 1 && bends.length <= 3 && bends.every((x) => /dqdw|umxw/.test(x.instanceId)), 'a 2x40 belt from standoff to pin bends 1 to 3 times, on the beam or the corner connector, 0.3 mm deep at most, under 300 ms');
}
// --- 9.13 Other way round ---
{
  const wrap = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'band-wrap.json'), 'utf8'));
  const W = { instances: wrap.instances };
  const id = (tail) => wrap.instances.find((i) => i.instanceId.endsWith(tail)).instanceId;
  const spots = [{ instanceId: id('297-cp2r'), feature: 'post:body' }, { instanceId: id('837-wbyr'), feature: 'post:body' }];
  const listed = placeBand(W, { bandPartId: byNumber('228-2500-468').id, spots, list: true });
  const ways = listed.routes || [];
  const placedWays = ways.slice(0, 2).map((w) => placeBand(W, { bandPartId: byNumber('228-2500-468').id, spots, alternative: w.alternative }));
  const clear = placedWays.every((r) => r.ok && !r.state.instances.find((i) => i.instanceId === r.instanceId).isIntersecting);
  const sig = (r) => r.route.filter((x) => x.feature === 'wrap').map((x) => x.line.flat().join(',')).join(';');
  check('standoff to standoff has two or more ways round, bending on different corners, each clear', ways.length >= 2 && clear && sig(placedWays[0]) !== sig(placedWays[1]), ways.map((w) => w.name).join(' | ') || listed.error);
}
// --- 9.14 A band routed again when its parts move ---
{
  const wrap = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'band-wrap.json'), 'utf8'));
  const id = (tail) => wrap.instances.find((i) => i.instanceId.endsWith(tail)).instanceId;
  const r = placeBand({ instances: wrap.instances }, { bandPartId: byNumber('228-2500-222').id, spots: [{ instanceId: id('837-wbyr'), feature: 'post:body' }, { instanceId: id('739-zqal'), feature: 'post:pin' }] });
  let inst = r.ok ? r.state.instances : [];
  const bandId = r.instanceId;
  const step = (moveId, d) => {
    const after = inst.map((i) => (i.instanceId === moveId ? { ...i, position: i.position.map((c, k) => c + d[k]) } : i));
    const fol = followBands(inst, after, partOf);
    const re = rerouteBands(fol.instances, fol.changed);
    inst = re.instances;
    const band = inst.find((i) => i.instanceId === bandId);
    return { over: bandOverlaps(band, inst), band, rerouted: re.changed.includes(bandId) };
  };
  const one = r.ok ? step(id('825-dqdw'), [0, 0, 12.7]) : null;
  const two = r.ok ? step(id('837-wbyr'), [0, 0, 12.7]) : null;
  // The beam moved 40 mm down: the corners the band bent round are out of its way
  const three = r.ok ? step(id('825-dqdw'), [0, -40, 0]) : null;
  check('moving the beam the band bends round out of its way routes it again, shorter, overlapping nothing', three && three.rerouted && !three.over.length, three ? `${JSON.stringify(three.over)}; routed again ${three.rerouted}; ${three.band.shape.route.map((x) => `${x.instanceId.slice(-4)} ${x.feature}`).join(' > ')}` : '');
  check('a band follows its beam moving 12.7 mm along its length, then its standoff to the next hole, overlapping nothing each time', r.ok && one && !one.over.length && two && !two.over.length && two.band.shape.picks?.length === 2, r.error || `${JSON.stringify(one?.over)} ${JSON.stringify(two?.over)}; routed again ${one?.rerouted}/${two?.rerouted}`);
}
// A band round three standoffs, one in a hole of the far corner connector and one in a hole of the
// other beam: the line between those two runs down both holes, which a band can't thread
{
  const wrap = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'band-wrap.json'), 'utf8'));
  const so3 = {"instanceId":"inst-1794353205311-0bly","partId":"0-25x-pitch-standoff-228-2500-063-5","label":"0.25x Pitch Standoff #3","position":[61.303,26.483,18.097],"rotation":[0,-90,0],"visible":true};
  const W = { instances: [...wrap.instances.filter((i) => !i.instanceId.endsWith('739-zqal') && !i.shape), so3] };
  const id = (tail) => W.instances.find((i) => i.instanceId.endsWith(tail)).instanceId;
  const r = placeBand(W, { bandPartId: byNumber('228-2500-470').id, spots: ['837-wbyr', '297-cp2r', so3.instanceId.slice(-9)].map((t) => ({ instanceId: id(t), feature: 'post:body' })) });
  const band = r.ok ? r.state.instances.find((i) => i.instanceId === r.instanceId) : null;
  check('a #117B round three standoffs on two beams and a corner connector is placed, snug, overlapping nothing', r.ok && !band.isIntersecting && r.stretchState === 'snug' && !bandOverlaps(band, r.state.instances).length, r.error || `flagged ${band?.isIntersecting}, depths ${JSON.stringify(Object.fromEntries(Object.entries(stripDepth(band, r.state.instances)).map(([k, v]) => [k.slice(-4), Number(v.toFixed(2))])))}`);
}
// Clawbot (scripts/fixtures/band-clawbot.json): a band from a standoff on one side beam to one on the
// other may not squeeze through the 0.3 mm slits between the side beams and the beams above and below
// them; it goes over the top beams, and the other way round goes under the bottom beams
{
  const claw = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'fixtures', 'band-clawbot.json'), 'utf8'));
  const C = { instances: claw.instances };
  const ways = [0, 1].map((k) => placeBand(C, { bandPartId: claw.band, spots: claw.picks, alternative: k }));
  const midY = (r) => {
    const b = r.state.instances.find((i) => i.instanceId === r.instanceId);
    // Where the band crosses the middle of the robot (its runs between the two sides, at z = 0)
    const P = b.shape.path.points.map((p) => p.map((c, k) => c + b.position[k]));
    const ys = [];
    P.forEach((p, i) => {
      const q = P[(i + 1) % P.length];
      if ((p[2] > 0) !== (q[2] > 0)) ys.push(p[1] + ((q[1] - p[1]) * (0 - p[2])) / (q[2] - p[2]));
    });
    return ys.length ? ys.reduce((a, y) => a + y, 0) / ys.length : NaN;
  };
  const pressOf = (r) => {
    const rep = {};
    bandOverlaps(r.state.instances.find((i) => i.instanceId === r.instanceId), r.state.instances, { report: rep });
    return Math.max(...Object.entries(rep).filter(([k]) => /Top Beam|Bottom Beam/.test(k)).map(([, v]) => v), -9);
  };
  const ok = ways.every((r) => r.ok);
  // Its two strands run side by side, one each side of the standoffs, not crossing over each other
  const strandsX = (r) => {
    const b = r.state.instances.find((i) => i.instanceId === r.instanceId);
    const P = b.shape.path.points.map((p) => p.map((c, k) => c + b.position[k]));
    const at = (zc) => {
      const xs = [];
      P.forEach((p, i) => {
        const q = P[(i + 1) % P.length];
        if ((p[2] > zc) !== (q[2] > zc)) xs.push(p[0] + ((q[0] - p[0]) * (zc - p[2])) / (q[2] - p[2]));
      });
      return xs.sort((x, y) => x - y);
    };
    return [at(-40), at(40)];
  };
  if (ok) {
    const [left, right] = strandsX(ways[0]);
    check('Clawbot: the band\'s two strands run side by side across the robot, not crossed', left.length === 2 && right.length === 2 && Math.abs(left[0] - right[0]) < 1 && Math.abs(left[1] - right[1]) < 1 && left[1] - left[0] > 5, `x at one side ${left.map((x) => x.toFixed(1)).join(', ')}, at the other ${right.map((x) => x.toFixed(1)).join(', ')}`);
    // A new size for the placed band: its part, colour and name change with it
    const bandNow = ways[0].state.instances.find((i) => i.instanceId === ways[0].instanceId);
    const resized = placeBand(ways[0].state, { instanceId: bandNow.instanceId, bandPartId: byNumber('228-2500-224').id, spots: claw.picks, allowSlack: true });
    const rb = resized.ok ? resized.state.instances.find((i) => i.instanceId === bandNow.instanceId) : null;
    check('changing a placed band\'s size changes its part, colour and name', rb && rb.partId === byNumber('228-2500-224').id && rb.color === byNumber('228-2500-224').defaultColor && rb.label === byNumber('228-2500-224').name, resized.error || `${rb?.color} ${rb?.label}`);
  }
  check('Clawbot: a band between the side-beam standoffs keeps out of the slits beside the side beams, over the top beams first and under the bottom beams the other way round',
    ok && pressOf(ways[0]) < 0.3 && pressOf(ways[1]) < 0.3 && midY(ways[0]) > 38 && midY(ways[1]) < 0.1,
    ok ? `over: ${ways[0].stretch}× at y ${midY(ways[0]).toFixed(1)}, presses ${pressOf(ways[0]).toFixed(2)}; under: ${ways[1].stretch}× at y ${midY(ways[1]).toFixed(1)}, presses ${pressOf(ways[1]).toFixed(2)}` : ways.map((r) => r.error).join(' / '));
}
const listing = placeBand(swishState, { bandPartId: byNumber('228-2500-470').id, spots: [{ instanceId: instances.find((i) => i.label.endsWith('228-2500-235-2')).instanceId, feature: 'rim' }], list: true });
check('listing a sprocket gives its rim, 24 gaps and nearby posts, and changes nothing', listing.ok && !listing.state && listing.spots.filter((s) => s.kind === 'gap' && s.label.endsWith('235-2')).length === 24 && listing.spots.some((s) => s.kind === 'post'));

// --- 3.3 Bands follow their parts ---
{
  const withBand = placed.state.instances;
  const bandId = placed.instanceId;
  const sprocketIds = upper.route.filter((s) => s.spot.kind === 'gap').map((s) => s.ref.instanceId);
  const moved = withBand.map((i) => (sprocketIds.includes(i.instanceId) || upper.route.some((s) => s.ref.instanceId === i.instanceId && /064/.test(i.label)) ? { ...i, position: [i.position[0] + 10, i.position[1], i.position[2]] } : i));
  const fol = followBands(withBand, moved, partOf);
  const before = withBand.find((i) => i.instanceId === bandId);
  const after = fol.instances.find((i) => i.instanceId === bandId);
  check('moving the parts a band is on moves the band with them', fol.changed.includes(bandId) && Math.abs(after.position[0] - before.position[0] - 10) < 0.5, `${(after.position[0] - before.position[0]).toFixed(2)} mm`);
  const removed = withBand.filter((i) => !sprocketIds.includes(i.instanceId) && !upper.route.some((s) => s.ref.instanceId === i.instanceId));
  const gone = followBands(withBand, removed, partOf);
  check('removing every part a band is on turns it back into a flat ring', gone.flattened.length === 1 && !gone.instances.find((i) => i.instanceId === bandId).shape);
  check('a change that touches no band leaves the parts as they are', followBands(withBand, withBand, partOf).instances === withBand);
}

// --- 3.4 Mirror, clone and duplicate carry bands ---
{
  const st = placed.state;
  const bandId = placed.instanceId;
  const band = st.instances.find((i) => i.instanceId === bandId);
  const partIds = [...new Set(band.shape.route.map((s) => s.instanceId))];
  const mir = mirrorSubassembly(st, { instanceIds: [...partIds, bandId], mirrorPlane: 'X', planeOffsetMm: 400 });
  const mBand = mir.mirroredInstances.find((i) => i.partId === band.partId);
  const gapWorld = (inst, insts) =>
    inst.shape.route
      .filter((s) => s.feature.startsWith('gap:'))
      .map((s) => {
        const host = insts.find((i) => i.instanceId === s.instanceId);
        const sp = worldSpot(partSpots(partOf(host)).find((x) => x.feature === s.feature), buildWorldMatrix(host.position, host.rotation));
        return sp.center.clone().addScaledVector(sp.radial, sp.rootMm);
      });
  const want = gapWorld(band, st.instances).map((p) => new THREE.Vector3(800 - p.x, p.y, p.z));
  const got = mBand?.shape ? gapWorld(mBand, mir.workingInstances) : [];
  const miss = want.length && got.length === want.length ? Math.max(...want.map((w) => Math.min(...got.map((g) => g.distanceTo(w))))) : Infinity;
  check("mirroring the intake with its band: the mirrored band goes through the mirrored sprockets' matching gaps", Boolean(mBand?.shape) && mBand.shape.route.every((s) => partIds.every((id) => id !== s.instanceId)) && miss < 1, `${miss.toFixed(2)} mm`);
  const clones = cloneSet(st.instances, [...partIds, bandId], [0, 0, 300]);
  const cBand = clones.find((c) => c.partId === band.partId);
  const cloneIds = new Set(clones.map((c) => c.instanceId));
  check('cloning a band with its parts keeps it strung, on the copies', Boolean(cBand?.shape) && cBand.shape.route.every((s) => cloneIds.has(s.instanceId)));
  const alone = cloneSet(st.instances, [bandId], [0, 0, 300])[0];
  check('a band copied without its parts is a flat ring', !alone.shape);
}

// --- 3.5 Bands in overlap checks and the audit ---
{
  const st = placed.state;
  const band = st.instances.find((i) => i.instanceId === placed.instanceId);
  const col = checkCandidateCollision(band, st.instances);
  check("a band doesn't overlap the parts it's strung on", col.collidingWith.length === 0 && col.tightFits.length === 0, col.collidingWith.map((c) => c.label).join(', '));
  // A second #117B (6.3 mm) has no room beside the first on a 6.35 mm standoff, and says so; a 2 mm
  // belt fits beside it, and two bands on one spot are not an overlap
  const full = placeBand(st, { bandPartId: byNumber('228-2500-470').id, spots: upperEntries });
  check('a second wide band on standoffs already full is refused, saying there is no room beside the first', !full.ok && /no room left beside/.test(full.error || ''), full.error || 'placed');
  const second = placeBand(st, { bandPartId: byNumber('228-2500-224').id, spots: upperEntries, allowSlack: true });
  const b2 = second.state?.instances.find((i) => i.instanceId === second.instanceId);
  check('two bands on the same spots are not an overlap', second.ok && b2 && checkCandidateCollision(b2, second.state.instances).collidingWith.length === 0, second.error || '');
  const ids = new Set([band.instanceId]);
  const audit = auditAssembly({ instances: st.instances.filter((i) => ids.has(i.instanceId) || band.shape.route.some((s) => s.instanceId === i.instanceId)) });
  const mentions = JSON.stringify(audit).includes(band.instanceId) || JSON.stringify(audit).includes(band.label);
  check('the audit reports nothing about a strung band', !mentions, mentions ? JSON.stringify(audit).slice(0, 300) : '');
}

// --- 6.1 / 6.2 Play mode ---
{
  // Swish's arm bands, from the arm standoff to the chassis pin (round whatever is in the way, over)
  // Swish's arm bands, on the routes read from VEX's CAD
  let st = swishState;
  for (const r of armBands) {
    const placedArm = placeBand(st, { bandPartId: byNumber('228-2500-470').id, spots: r.route.map(toEntry), ignoreInWay: true });
    if (placedArm.ok) st = placedArm.state;
  }
  const withIntake = placeBand(st, { bandPartId: byNumber('228-2500-470').id, spots: upperEntries });
  st = withIntake.ok ? withIntake.state : st;
  const g = buildBodyGraph(playInputs(st));
  const arms = g.bands.filter((b) => b.elements.some((e) => instances.find((i) => i.instanceId === e.instanceId)?.label.endsWith('228-2500-065-9')));
  const intakeBand = g.bands.find((b) => b.id === withIntake.instanceId);
  check('Play: a band is no body of its own, and the arm bands pull on two bodies', g.bands.length === 3 && !g.bodies.some((b) => b.parts.some((id) => g.bands.some((x) => x.id === id))) && arms.length === 1 && arms[0].pulls, `${g.bands.length} bands`);
  check('Play: the intake band, all on the intake shaft and its sprockets, pulls on nothing', intakeBand && !intakeBand.pulls, intakeBand ? intakeBand.bodies.join(',') : 'missing');
  const byIdSt = new Map(st.instances.map((i) => [i.instanceId, i]));
  const phys = await createPhysics(g, st.instances, { points: (pid) => rawGeo(partOf(byIdSt.get(pid))).attributes.position.array });
  const so = byIdSt.get(instances.find((i) => i.label.endsWith('228-2500-065-9')).instanceId);
  const pin = byIdSt.get(instances.find((i) => i.label.endsWith('228-2500-087-5')).instanceId);
  const armBody = arms[0].bodies[arms[0].elements.findIndex((e) => e.instanceId === so.instanceId)];
  const gap0 = v3(so.position).distanceTo(v3(pin.position));
  for (let t = 0; t < 1.5; t += 1 / 30) phys.step(1 / 30, new Map());
  const gap1 = v3(so.position).applyMatrix4(phys.deltas().get(armBody)).distanceTo(v3(pin.position));
  check('Play: with nothing holding it, the catapult arm swings toward the chassis pin its bands pull to', gap1 < gap0 - 2, `${gap0.toFixed(1)} -> ${gap1.toFixed(1)} mm`);
  // The runner redraws a band's strip each frame and puts it back afterwards
  const bandInst = byIdSt.get(arms[0].id);
  const geo0 = new THREE.BufferGeometry();
  const mat0 = new THREE.MeshStandardMaterial({ color: 0x123456 });
  const mesh = new THREE.Mesh(geo0, mat0);
  mesh.userData.isPartMesh = true;
  const group = new THREE.Group();
  group.add(mesh);
  const runner = createPlayRunner(g, st.instances, phys);
  const meshMap = new Map([[bandInst.instanceId, group]]);
  runner.frame(meshMap, 0);
  runner.frame(meshMap, 100);
  const redrawn = mesh.geometry !== geo0 && mesh.geometry.attributes.position.count > 0;
  const tinted = mesh.material !== mat0;
  runner.dispose();
  check('Play: a band is redrawn every frame in its stretch colour, and put back on leaving', redrawn && tinted && mesh.geometry === geo0 && mesh.material === mat0);
  const kin = createKinematic(g);
  check('Play without physics still runs with bands in the build', typeof kin.step === 'function');
  // The intake's roller turning: the intake band's strip turns with it, staying in its gaps. (The
  // imported Swish's drivetrain doesn't link its intake motor to the roller, so the roller's body is
  // turned 30° about its axle directly; the redraw is the same whatever turns it.)
  {
    const rollerBody = intakeBand.bodies[0];
    const gapEl = intakeBand.elements.find((e) => e.feature === 'gap:17');
    const turn = new THREE.Matrix4()
      .makeTranslation(...gapEl.center)
      .multiply(new THREE.Matrix4().makeRotationAxis(v3(gapEl.axis).normalize(), THREE.MathUtils.degToRad(30)))
      .multiply(new THREE.Matrix4().makeTranslation(...v3(gapEl.center).negate().toArray()));
    const bInst = byIdSt.get(intakeBand.id);
    // How far the strip lies from gap 17 with the roller at `m`
    const stripToGap = (m) => {
      const run2 = createPlayRunner(g, st.instances, { step() {}, deltas: () => new Map([[rollerBody, m]]), spin: () => 0, status: () => ({}) });
      const mesh2 = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
      mesh2.userData.isPartMesh = true;
      const grp2 = new THREE.Group();
      grp2.add(mesh2);
      run2.frame(new Map([[intakeBand.id, grp2]]), 0);
      const gapNow = v3(gapEl.center).addScaledVector(v3(gapEl.radial), gapEl.rootMm + 0.75).applyMatrix4(m);
      const pos = mesh2.geometry.attributes.position;
      let nearest = Infinity;
      for (let i = 0; i < pos.count; i++) nearest = Math.min(nearest, new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).add(v3(bInst.position)).distanceTo(gapNow));
      run2.dispose();
      return nearest;
    };
    const atRest = stripToGap(new THREE.Matrix4());
    const turned = stripToGap(turn);
    check('Play: as the intake roller turns, the intake band turns with it, staying in its gaps', atRest < 5 && Math.abs(turned - atRest) < 0.5, `strip ${atRest.toFixed(2)} mm from gap 17 at rest, ${turned.toFixed(2)} mm turned 30°`);
  }
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll band checks passed');

export { routes, candidatesNear, instances, check, BAND_STRETCH, bandPullN, stretchState, solveBandPath, stretchOf, suggestBand, byName };
