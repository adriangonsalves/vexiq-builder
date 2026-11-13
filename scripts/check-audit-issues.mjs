/**
 * Node check for src/utils/auditIssues.js: the audit's findings as a plain list of issues, so the
 * dialog can say what the warnings are. Run: node scripts/check-audit-issues.mjs   (exits 1 on failure)
 */
import fs from 'node:fs';
import { auditAssembly } from '../mcp/assembly-engine.mjs';
import { auditIssues, problemCount } from '../src/utils/auditIssues.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const audit = {
  collisions: [{ instanceId: 'a', label: 'Beam', collidingWith: ['Plate', 'Pin'] }],
  floatingFasteners: [{ instanceId: 'f', label: 'Pin 9' }],
  halfSeatedFasteners: [
    { instanceId: 'h', label: 'Pin 3', seatedIn: [{ part: 'Beam', instanceId: 'a', ports: ['hole_1'] }], nearMiss: [{ instanceId: 'c', part: 'Arm', port: 'hole_2', lineMm: 0.31, angleDeg: 0 }] },
    { instanceId: 'h2', label: 'Pin 4', seatedIn: [{ part: 'Beam', instanceId: 'a', ports: ['hole_2'] }], nearMiss: [] }
  ],
  unsecuredParts: [{ instanceId: 'u', label: 'Gear' }],
  underSecuredHeavyParts: [{ instanceId: 'm', label: 'Motor', fastenerCount: 1, minFastenersRequired: 2 }],
  disconnectedIslands: [[{ instanceId: 'x', label: 'Wheel' }, { instanceId: 'y', label: 'Hub' }]],
  protrudingShafts: [{ instanceId: 's', label: 'Shaft' }],
  singlePinPivotParts: [{ instanceId: 'p', label: 'Stop' }],
  tightFits: [{ instanceId: 't', label: 'Pivot Standoff', withInstanceId: 'b', withLabel: 'Pivot Beam' }]
};
const issues = auditIssues(audit);
check('one issue per finding, in audit order', issues.map((i) => i.kind).join() === 'collision,floating,half-seated,half-seated,unsecured,heavy,island,protruding,single-pin,tight-fit', issues.map((i) => i.kind).join());
check('every problem counts, a single-pin or tight-fit note does not', problemCount(issues) === 8 && issues.at(-2).level === 'note' && issues.at(-1).level === 'note');
check('a tight fit names both parts and selects them', issues.at(-1).title === 'Pivot Standoff is a tight fit with Pivot Beam' && issues.at(-1).parts.length === 2);
check('a collision names what it overlaps', issues[0].detail.includes('Plate, Pin'));
check('a half-seated pin names the part it is in', issues[2].detail.includes('Beam'));
check('an island lists all its parts and selects them', issues[6].parts.length === 2 && issues[6].title === '2 parts not joined to the rest');
check('a half-seated pin says which hole is how far off', issues[2].detail.includes('Arm hole_2 is 0.31 mm off its line'), issues[2].detail);
check('  and offers Fix assembly from the part it sits in first, then the pin', issues[2].fixIds.join() === 'a,h', issues[2].fixIds.join());
check('  with no hole near, it says so but still offers the fix (Fix assembly reaches further)', issues[3].detail.includes('No other hole is near') && issues[3].fixIds.join() === 'a,h2', issues[3].fixIds.join());
check('an overlap offers Fix assembly on the part; a note or island offers none', issues[0].fixIds.join() === 'a' && issues.at(-2).fixIds.length === 0 && issues[6].fixIds.length === 0);
check('no audit gives no issues', auditIssues(null).length === 0 && auditIssues({}).length === 0);

// The real build: the warnings the dialog reports are exactly the audit's problems
const state = JSON.parse(fs.readFileSync(new URL('../public/assembly-state.json', import.meta.url), 'utf8'));
const real = auditAssembly(state);
const list = auditIssues(real);
check('real build: sound exactly when there are no problems', real.isMechanicallySound === (problemCount(list) === 0), `${real.isMechanicallySound} vs ${problemCount(list)}`);

// Tight fits in the audit itself: listed apart from overlaps, and the build is still sound
{
  const { findPart } = await import('../mcp/assembly-engine.mjs');
  const at = (instanceId, label, query, position, rotation) => ({ instanceId, label, partId: findPart(query).id, position, rotation, visible: true });
  const pivot = auditAssembly({
    instances: [
      at('b', 'Pivot Beam', '228-2500-015', [-125.074, 57.616, -41.275], [0, 0, -20.863]),
      at('s', 'Pivot Standoff', '228-2500-064', [-225.425, 96.15, -31.755], [0, 0, -169.284])
    ]
  });
  check('audit: a standoff 0.53 mm off a beam hole is one tight fit, no overlap', pivot.collisionCount === 0 && pivot.tightFitCount === 1, JSON.stringify(pivot.tightFits));
  check('  naming the standoff and the beam', [pivot.tightFits[0]?.label, pivot.tightFits[0]?.withLabel].sort().join() === 'Pivot Beam,Pivot Standoff');
  check('  and the tight fit is not a problem in the dialog', problemCount(auditIssues(pivot).filter((i) => i.kind === 'tight-fit')) === 0);

  // A Smart Motor tilted 0.9° off its shaft (openspec precise-placement), from the 90° gear test rig
  const shaft = at('ws', 'Worm shaft', '4x Pitch Shaft', [121.999, 65.4, -0.005], [8.53, -90, 0]);
  const motorAt = (rotation, position) => ({ ...at('m', 'Smart Motor #2', 'VEX IQ Smart Motor', position, rotation), socketAngleDeg: -22.63 });
  const tilted = auditAssembly({ instances: [shaft, motorAt([-180, -0.9, 90], [137.904, 55.875, -0.031])] });
  check('audit: a motor 0.9° off its shaft is listed', tilted.tiltedMotorCount === 1 && Math.abs(tilted.tiltedMotors[0].angleDeg - 0.9) < 0.1 && tilted.tiltedMotors[0].shaft === 'Worm shaft', JSON.stringify(tilted.tiltedMotors));
  const tiltIssue = auditIssues(tilted).find((i) => i.kind === 'tilted-motor');
  check('  as a problem naming the shaft, fixable from the motor', tiltIssue?.level === 'problem' && /Smart Motor #2 is tilted 0\.9\d?° off Worm shaft/.test(tiltIssue.title) && tiltIssue.fixIds[0] === 'm', JSON.stringify(tiltIssue));
  const { settlePlacedInstance, applyPosePatches } = await import('../mcp/assembly-engine.mjs');
  const before = [shaft, motorAt([-180, -0.9, 90], [137.904, 55.875, -0.031])];
  const squared = applyPosePatches(before, settlePlacedInstance(before[1], before).patches);
  check('  a squared motor is not listed', auditAssembly({ instances: squared }).tiltedMotorCount === 0);
}

console.log(failures === 0 ? '\nAll audit issue checks passed.' : `\n${failures} audit issue check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
