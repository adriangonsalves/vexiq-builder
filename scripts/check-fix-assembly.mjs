/**
 * Node check for Fix assembly (openspec easier-placing-and-fix-assembly): two blocks of parts nearly
 * mated are lined up and seated, from either side, the smaller block moves, and nothing near is said.
 * Run: node scripts/check-fix-assembly.mjs   (exits 1 on any failure)
 */
import * as THREE from 'three';
import { checkCandidateCollision, placeParts, buildWorldMatrix, jointGraph } from '../mcp/assembly-engine.mjs';
import { runAction } from '../src/engine/actions.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// A 4x8 plate with two 1x1 pins, and a 1x6 beam pushed onto them
const built = placeParts({ instances: [] }, [
  { ref: 'plate', partQuery: '4x8 Plate', label: 'Plate', position: [0, 0, 0], rotation: [0, 0, 0] },
  { ref: 'pin1', partQuery: '1x1 Connector Pin', label: 'Pin 1', insert: { into: { ref: 'plate', port: 'hole_3' }, fromSide: '+' } },
  { ref: 'pin2', partQuery: '1x1 Connector Pin', label: 'Pin 2', insert: { into: { ref: 'plate', port: 'hole_2' }, fromSide: '+' } },
  { ref: 'beam', partQuery: '1x6 Beam', label: 'Beam', insert: { sourcePort: 'hole_3', into: { ref: 'pin1', port: 'peg_1' }, fromSide: '-' } }
]);
if (built.error) {
  console.log('FAIL  building the test scene ->', JSON.stringify(built.error));
  process.exit(1);
}
const good = built.instances ?? built.state?.instances ?? built.workingInstances;
const id = (label) => good.find((i) => i.label === label).instanceId;
const graphOk = jointGraph({ instances: good });
const joined = (a, b) => graphOk.edges.some(([x, y]) => (x === id(a) && y === id(b)) || (x === id(b) && y === id(a)));
check('test scene: the beam sits on both pins', joined('Pin 1', 'Beam') && joined('Pin 2', 'Beam'), JSON.stringify(good.map((i) => [i.label, i.position, i.rotation])));

const matrixOf = (inst) => buildWorldMatrix(inst.position, inst.rotation);
const poseError = (a, b) => {
  const pa = new THREE.Vector3(...a.position);
  const pb = new THREE.Vector3(...b.position);
  const qa = new THREE.Quaternion().setFromRotationMatrix(matrixOf(a));
  const qb = new THREE.Quaternion().setFromRotationMatrix(matrixOf(b));
  return { mm: pa.distanceTo(pb), deg: THREE.MathUtils.radToDeg(qa.angleTo(qb)) };
};

/** The beam knocked off: turned `deg` about a tilted axis through its centre and moved by `offset`. */
const knock = (deg, offset) =>
  good.map((i) => {
    if (i.label !== 'Beam') return i;
    const turn = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0.4, 0.3).normalize(), THREE.MathUtils.degToRad(deg));
    const c = new THREE.Vector3(...i.position);
    const m = new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z).premultiply(turn).premultiply(new THREE.Matrix4().makeTranslation(c.x + offset[0], c.y + offset[1], c.z + offset[2]));
    const matrix = matrixOf(i).premultiply(new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4()));
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    matrix.decompose(p, q, new THREE.Vector3());
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return { ...i, position: p.toArray(), rotation: [e.x, e.y, e.z].map((r) => THREE.MathUtils.radToDeg(r)) };
  });

const goodBeam = good.find((i) => i.label === 'Beam');
const fixFrom = (instances, label) => runAction('fix_assembly', { instances }, { instanceId: instances.find((i) => i.label === label).instanceId });

// 1. Off sideways, tilted and lifted: fixed from the beam (female) and from a pin (male)
for (const from of ['Beam', 'Pin 1', 'Plate']) {
  const knocked = knock(3, [1.2, -0.8, 1.5]);
  const reply = fixFrom(knocked, from);
  const beam = reply.state?.instances.find((i) => i.label === 'Beam');
  const err = beam ? poseError(beam, goodBeam) : null;
  check(
    `tilted 3°, 1.4 mm off, 1.5 mm up, fixed from ${from}: the beam is back on its pins`,
    reply.ok && err.mm < 0.1 && err.deg < 0.05,
    reply.ok ? `${err.mm.toFixed(3)} mm, ${err.deg.toFixed(3)}°; ${reply.message}` : reply.error
  );
  if (from === 'Beam') {
    check('  only the beam moved', reply.ok && reply.moved.length === 1 && reply.moved[0] === id('Beam'), JSON.stringify(reply.moved));
    check('  one recorded step with its own label', reply.record === true && /^Fix assembly: Beam onto /.test(reply.stepLabel), reply.stepLabel);
    check('  the beam overlaps nothing', reply.ok && beam.isIntersecting === false);
    const graph = jointGraph(reply.state);
    const ids = reply.state.instances;
    const has = (a, b) => graph.edges.some(([x, y]) => [x, y].includes(ids.find((i) => i.label === a).instanceId) && [x, y].includes(ids.find((i) => i.label === b).instanceId));
    check('  the beam is joined to both pins again', has('Pin 1', 'Beam') && has('Pin 2', 'Beam'));
  }
}

// 1b. A bigger tilt at an odd angle
{
  const knocked = knock(12, [-1.8, 1.1, 2.2]);
  const reply = fixFrom(knocked, 'Beam');
  const beam = reply.state?.instances.find((i) => i.label === 'Beam');
  const err = beam ? poseError(beam, goodBeam) : null;
  check('tilted 12°, 2.1 mm off, 2.2 mm up: lined up and seated', reply.ok && err.mm < 0.1 && err.deg < 0.05 && !beam.isIntersecting, reply.ok ? `${err.mm.toFixed(3)} mm, ${err.deg.toFixed(3)}°` : reply.error);
}

// 1b2. Lifted clear of the pins' tops, 3° tilted: comes down onto the pins and onto the plate
{
  const knocked = knock(3, [1.6, -1.1, 6.6]);
  const reply = fixFrom(knocked, 'Pin 1');
  const beam = reply.state?.instances.find((i) => i.label === 'Beam');
  const err = beam ? poseError(beam, goodBeam) : null;
  check('lifted 6.6 mm above its pins: brought down and seated on the plate', reply.ok && err.mm < 0.01 && err.deg < 0.05, reply.ok ? `${err.mm.toFixed(3)} mm` : reply.error);
}

// 1c. Already right: nothing to do
{
  const reply = fixFrom(good, 'Beam');
  check('already seated: says so and changes nothing', !reply.ok && /already lined up/.test(reply.error), reply.error || reply.message);
}

// 2. Pressed in: 0.4 mm too deep and 0.7 mm off sideways
{
  const knocked = knock(0, [0.7, 0, -0.4]);
  const before = checkCandidateCollision(knocked.find((i) => i.label === 'Beam'), knocked).isIntersecting;
  const reply = fixFrom(knocked, 'Beam');
  const beam = reply.state?.instances.find((i) => i.label === 'Beam');
  const err = beam ? poseError(beam, goodBeam) : null;
  check('pressed in 0.4 mm and 0.7 mm off: overlapping before', before);
  check('  ends clear, on the pins and seated', reply.ok && !beam.isIntersecting && err.mm < 0.4 && err.deg < 0.05, reply.ok ? `${err.mm.toFixed(3)} mm` : reply.error);
}

// 3. Nothing near: the beam lifted well away
{
  const far = good.map((i) => (i.label === 'Beam' ? { ...i, position: [i.position[0], i.position[1] + 60, i.position[2] + 60] } : i));
  const reply = fixFrom(far, 'Beam');
  check('nothing near: no change and a message', !reply.ok && /No pins or holes near Beam/.test(reply.error), reply.error);
}

// 4. A locked beam: the plate block moves instead
{
  const knocked = knock(2, [0.6, 0.5, 0]).map((i) => (i.label === 'Beam' ? { ...i, locked: true } : i));
  const reply = fixFrom(knocked, 'Beam');
  const beam = knocked.find((i) => i.label === 'Beam');
  const movedIds = new Set(reply.moved || []);
  const plate = reply.state?.instances.find((i) => i.label === 'Plate');
  check('locked beam: the plate and its pins move instead', reply.ok && !movedIds.has(beam.instanceId) && movedIds.has(id('Plate')) && movedIds.size === 3, reply.error || JSON.stringify([...movedIds]));
  // Relative pose of beam to plate matches the good one
  if (reply.ok) {
    const rel = (b, p) => matrixOf(p).invert().multiply(matrixOf(b));
    const want = rel(goodBeam, good.find((i) => i.label === 'Plate'));
    const got = rel(beam, plate);
    const pw = new THREE.Vector3().setFromMatrixPosition(want);
    const pg = new THREE.Vector3().setFromMatrixPosition(got);
    check('  the beam ends on the pins relative to the plate', pw.distanceTo(pg) < 0.1, `${pw.distanceTo(pg).toFixed(3)} mm`);
  }
}

// 5. Too far to be a fix: refuse
{
  const knocked = knock(0, [3.4, 0, 0]);
  const reply = fixFrom(knocked, 'Beam');
  const beam = reply.state?.instances.find((i) => i.label === 'Beam');
  // 3.4 mm sideways is within reach: it's still lined up
  const err = beam ? poseError(beam, goodBeam) : null;
  check('3.4 mm sideways (within reach) is lined up', reply.ok && err.mm < 0.1, reply.ok ? `${err.mm.toFixed(3)}` : reply.error);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll fix-assembly checks passed');
process.exit(failures ? 1 : 0);
