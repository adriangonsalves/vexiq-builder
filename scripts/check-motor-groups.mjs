/**
 * Node check for src/utils/motorGroups.js (openspec motor-groups): making, changing and breaking up
 * motor groups, each motor's starting direction, Play panel controls and throttle fan-out, copies.
 * Run: node scripts/check-motor-groups.mjs   (exits 1 on any failure)
 */
import {
  breakMotorGroup,
  controlStatus,
  controlThrottles,
  makeMotorGroup,
  motorGroupsOf,
  nextMotorGroupName,
  playControls,
  removeFromMotorGroup,
  renameMotorGroup,
  setMotorReversed,
  withoutMotorGroup
} from '../src/utils/motorGroups.js';
import { applyPatches, groupParts, groupsOf, ungroupParts, cloneSet } from '../src/utils/partGroups.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const MOTOR = { hubSpecs: { radiusMm: 4 }, ports: [{ type: 'shaft_socket', origin: [0, 0, 0], axis: [0, 1, 0] }] };
const BEAM = { ports: [] };
const meta = { motor: MOTOR, beam: BEAM };
const partOf = (inst) => meta[inst.partId];
const part = (id, partId, extra = {}) => ({ instanceId: id, partId, label: id, position: [0, 0, 0], rotation: [0, 0, 0], ...extra });
const motorIds = (g) => g?.motors.map((m) => m.id).join();
const tryMsg = (fn) => {
  try {
    fn();
    return '';
  } catch (e) {
    return e.message;
  }
};

// --- Make, regroup, take out, break up -------------------------------------------------------------
{
  // A left and a right drive, each a part group of a motor and a beam; the right motor faces the other way
  let parts = [part('mL', 'motor'), part('bL', 'beam'), part('mR', 'motor', { rotation: [180, 0, 0] }), part('bR', 'beam')];
  parts = applyPatches(parts, groupParts(parts, ['mL', 'bL'], 'Left Drive', { groupId: 'g-L' }).patches);
  parts = applyPatches(parts, groupParts(parts, ['mR', 'bR'], 'Right Drive', { groupId: 'g-R' }).patches);
  check('names: first motor group is "Motor group 1"', nextMotorGroupName(parts) === 'Motor group 1');

  check('not enough motors: one motor and beams is refused', tryMsg(() => makeMotorGroup(parts, ['mL', 'bL', 'bR'], partOf)) === 'A motor group needs two or more Smart Motors');

  const made = makeMotorGroup(parts, ['mL', 'bL', 'mR', 'bR'], partOf, { groupId: 'mg-1' });
  check('group the drive motors: named "Motor group 1"', made.name === 'Motor group 1');
  check('group the drive motors: only the motors join', made.motorIds.join() === 'mL,mR');
  parts = applyPatches(parts, made.patches);
  const g = motorGroupsOf(parts).get('mg-1');
  check('group the drive motors: the group holds both motors', motorIds(g) === 'mL,mR');
  const pg = groupsOf(parts);
  check('part groups untouched by making a motor group', pg.get('g-L')?.ids.join() === 'mL,bL' && pg.get('g-R')?.ids.join() === 'mR,bR');
  check('mirrored drive: first motor same, mirrored one opposite', g.motors[0].reversed === false && g.motors[1].reversed === true);
  check('making a group moves no part', parts.every((p) => p.position.every((v) => v === 0)));
  check('a same motor carries no motorReversed field', !('motorReversed' in parts.find((p) => p.instanceId === 'mL')));

  // Ungrouping the part groups leaves the motor group
  const unPg = applyPatches(parts, ungroupParts(parts, ['mL', 'mR']).patches);
  check('ungrouping parts leaves the motor group', motorIds(motorGroupsOf(unPg).get('mg-1')) === 'mL,mR');

  // Flip a motor
  parts = applyPatches(parts, setMotorReversed(parts, 'mR', false).patches);
  check('flipping a motor: now same', motorGroupsOf(parts).get('mg-1').motors[1].reversed === false);
  check('flipping a motor outside a group is refused', /no motor group/.test(tryMsg(() => setMotorReversed(parts, 'bL', true))));

  // Rename
  const renamed = renameMotorGroup(parts, 'mg-1', '  Drive ');
  parts = applyPatches(parts, renamed.patches);
  check('rename: group reads "Drive"', motorGroupsOf(parts).get('mg-1').name === 'Drive');
  check('rename: empty name refused', tryMsg(() => renameMotorGroup(parts, 'mg-1', '   ')) === 'A motor group needs a name');

  // Taking out the second-last motor breaks the group
  const out = applyPatches(parts, removeFromMotorGroup(parts, ['mR']).patches);
  check('taking out the second-last motor breaks the group', motorGroupsOf(out).size === 0);
  check('broken group leaves no fields behind', out.every((p) => !('motorGroupId' in p) && !('motorGroupName' in p) && !('motorReversed' in p)));
  check('taking out leaves part groups', groupsOf(out).size === 2);

  // Break up
  const broken = applyPatches(parts, breakMotorGroup(parts, 'mg-1').patches);
  check('break up: no motor group left', motorGroupsOf(broken).size === 0);
}

// --- Moving a motor to a new group --------------------------------------------------------------------
{
  let parts = ['a', 'b', 'c', 'd'].map((id) => part(id, 'motor'));
  parts = applyPatches(parts, makeMotorGroup(parts, ['a', 'b', 'c'], partOf, { name: 'Lift', groupId: 'mg-lift' }).patches);
  const made = makeMotorGroup(parts, ['c', 'd'], partOf, { groupId: 'mg-2' });
  check('names: next is "Motor group 1" while only "Lift" exists', made.name === 'Motor group 1');
  parts = applyPatches(parts, made.patches);
  const groups = motorGroupsOf(parts);
  check('moving a motor: new group holds c and d', motorIds(groups.get('mg-2')) === 'c,d');
  check('moving a motor: "Lift" keeps a and b', motorIds(groups.get('mg-lift')) === 'a,b');
  check('names: next is "Motor group 2"', nextMotorGroupName(parts) === 'Motor group 2');

  // Moving two out of a two-motor group breaks the old one
  const p2 = applyPatches(parts, makeMotorGroup(parts, ['a', 'c'], partOf, { groupId: 'mg-3' }).patches);
  const g2 = motorGroupsOf(p2);
  check('a group left with one motor breaks up', !g2.has('mg-lift') && !g2.has('mg-2') && motorIds(g2.get('mg-3')) === 'a,c');
  check('the lone leftover motor has no group fields', !('motorGroupId' in p2.find((p) => p.instanceId === 'b')));

  // Explicit opposite list overrides the guess
  const ex = makeMotorGroup(parts, ['a', 'd'], partOf, { opposite: ['d'] });
  check('explicit opposite list is used', ex.patches.find((p) => p.id === 'd').fields.motorReversed === true);
  // Motors at right angles stay same
  const angled = [part('x', 'motor'), part('y', 'motor', { rotation: [0, 0, 90] })];
  const am = makeMotorGroup(angled, ['x', 'y'], partOf);
  check('motors at right angles start same', !am.patches.find((p) => p.id === 'y').fields.motorReversed);
}

// --- Play panel controls ---------------------------------------------------------------------------------
{
  let parts = [part('mL', 'motor'), part('mR', 'motor', { rotation: [180, 0, 0] }), part('mArm', 'motor')];
  parts = applyPatches(parts, makeMotorGroup(parts, ['mL', 'mR'], partOf, { name: 'Drive', groupId: 'mg-d' }).patches);
  const graphMotors = [
    { id: 'mL', label: 'Left motor', stopping: 'brake' },
    { id: 'mR', label: 'Right motor', stopping: 'hold' },
    { id: 'mArm', label: 'Arm motor', stopping: 'brake' }
  ];
  const controls = playControls(graphMotors, parts);
  check('ungrouped motors keep their own rows: two rows', controls.length === 2, controls.map((c) => c.label).join());
  check('the group row is named after the group', controls[0].label === 'Drive' && controls[0].group && controls[0].key === 'mg:mg-d');
  check('the arm motor keeps its own row', controls[1].key === 'mArm' && !controls[1].group);
  const t = new Map(controlThrottles(controls[0], 1));
  check('driving straight: same motor gets +1, opposite gets -1', t.get('mL') === 1 && t.get('mR') === -1);
  const zero = new Map(controlThrottles(controls[0], 0));
  check('stop gives every motor 0', zero.get('mL') === 0 && zero.get('mR') === 0);
  check('one stalled motor: group shows stalled', controlStatus(controls[0], { mL: { rpm: 118 }, mR: { rpm: 0, stalled: true } }).stalled === true);
  check('group speed is its fastest motor', Math.abs(controlStatus(controls[0], { mL: { rpm: 80 }, mR: { rpm: -110 } }).rpm) === 110);
  // A hidden motor (not in the graph) is skipped; the row still shows
  const hidden = playControls(graphMotors.filter((m) => m.id !== 'mR'), parts);
  check('a motor missing from the graph is skipped', hidden[0].group && hidden[0].motors.map((m) => m.id).join() === 'mL');
}

// --- Copies and old builds ---------------------------------------------------------------------------------
{
  let parts = [part('a', 'motor'), part('b', 'motor')];
  parts = applyPatches(parts, makeMotorGroup(parts, ['a', 'b'], partOf, { opposite: ['b'] }).patches);
  const copy = withoutMotorGroup(parts[1]);
  check('a copy of a motor is in no motor group', !('motorGroupId' in copy) && !('motorReversed' in copy) && !('motorGroupName' in copy));
  check('the original keeps its group', parts[1].motorGroupId && parts[1].motorReversed === true);
  const cloned = cloneSet(parts, ['a', 'b'], [12.7, 0, 0], { newId: (() => { let n = 0; return () => `c${++n}`; })(), groupId: 'g-copy' });
  const clonedParts = cloned;
  check('Clone leaves copies out of motor groups', clonedParts.length > 0 && clonedParts.every((p) => !('motorGroupId' in p)), JSON.stringify(Object.keys(cloned)));
  const old = [part('a', 'motor'), part('b', 'motor')];
  check('old builds load with no motor groups', motorGroupsOf(old).size === 0 && playControls([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], old).length === 2);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll motor-group checks passed');
process.exit(failures ? 1 : 0);
