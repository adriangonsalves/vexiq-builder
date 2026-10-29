/**
 * Node check for src/utils/partGroups.js (groups, set moves) and src/utils/jointLayers.js (walking joints).
 * Run: node scripts/check-part-groups.mjs   (exits 1 on any failure)
 */
import * as THREE from 'three';
import {
  applyPatches,
  applySetTransform,
  axisTurn,
  expandToGroups,
  groupCollapse,
  groupParts,
  groupsOf,
  nextGroupName,
  renameGroup,
  setPivot,
  syncSelection,
  ungroupParts
} from '../src/utils/partGroups.js';
import { connectedFrom, layersFrom } from '../src/utils/jointLayers.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const part = (id, extra = {}) => ({ instanceId: id, partId: 'beam', label: id, position: [0, 0, 0], rotation: [0, 0, 0], ...extra });
const ids = (list) => list.map((p) => p.instanceId);

// --- Group, ungroup, regroup -----------------------------------------------------------------------
{
  let parts = ['a', 'b', 'c', 'd', 'e'].map((id) => part(id));
  check('names: first group is "Group 1"', nextGroupName(parts) === 'Group 1');

  let threw = '';
  try {
    groupParts(parts, ['a'], '');
  } catch (e) {
    threw = e.message;
  }
  check('group: one part is refused', threw === 'A group needs two or more parts');

  const claw = groupParts(parts, ['a', 'b', 'c'], 'Claw', { groupId: 'g-claw' });
  parts = applyPatches(parts, claw.patches);
  check('group: three parts share the group', groupsOf(parts).get('g-claw')?.ids.join() === 'a,b,c');
  check('group: grouping moves no part', parts.every((p) => p.position.every((v) => v === 0)));
  check('names: next group is "Group 1" while only "Claw" exists', nextGroupName(parts) === 'Group 1');

  const g1 = groupParts(parts, ['c', 'd', 'e'], '', { groupId: 'g-1' });
  check('group: unnamed group gets "Group 1"', g1.name === 'Group 1');
  parts = applyPatches(parts, g1.patches);
  const groups = groupsOf(parts);
  check('regroup: the new group holds c, d, e', groups.get('g-1')?.ids.join() === 'c,d,e');
  check('regroup: "Claw" keeps a and b', groups.get('g-claw')?.ids.join() === 'a,b');
  check('names: next is "Group 2"', nextGroupName(parts) === 'Group 2');

  // Taking b out of Claw leaves one part: Claw is dissolved
  const g2 = groupParts(parts, ['b', 'e'], 'Pair', { groupId: 'g-2' });
  parts = applyPatches(parts, g2.patches);
  const after = groupsOf(parts);
  check('dissolve: a group left with one part goes away', !after.has('g-claw') && !('groupId' in parts.find((p) => p.instanceId === 'a')));
  check('dissolve: c, d stay in Group 1', after.get('g-1')?.ids.join() === 'c,d');

  const renamed = renameGroup(parts, 'g-1', '  Left Drive ');
  parts = applyPatches(parts, renamed.patches);
  check('rename: every member gets the new name', groupsOf(parts).get('g-1')?.name === 'Left Drive' && renamed.oldName === 'Group 1');
  let empty = '';
  try {
    renameGroup(parts, 'g-1', '  ');
  } catch (e) {
    empty = e.message;
  }
  check('rename: an empty name is refused', empty === 'A group needs a name');

  check('expand: a grouped part pulls in its group, clicked part last', expandToGroups(['d'], parts).join() === 'c,d');
  check('expand: a loose part stays alone', expandToGroups(['a'], parts).join() === 'a');

  const un = ungroupParts(parts, ['c']);
  parts = applyPatches(parts, un.patches);
  check('ungroup: the group is gone and parts keep no group fields', !groupsOf(parts).has('g-1') && parts.filter((p) => 'groupId' in p).length === 2);

  // A part whose groupId no other part shares is in no group, and names disagreeing go to the most common
  const stray = [part('x', { groupId: 'g-x', groupName: 'X' }), part('y', { groupId: 'g', groupName: 'A' }), part('z', { groupId: 'g', groupName: 'A' }), part('w', { groupId: 'g', groupName: 'B' })];
  check('groups: a lone groupId is no group', !groupsOf(stray).has('g-x'));
  check('groups: the most common name wins', groupsOf(stray).get('g')?.name === 'A');
}

// --- Moving and turning a set ------------------------------------------------------------------------
const matrixOf = (p) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ')),
    new THREE.Vector3(1, 1, 1)
  );
const sameMatrix = (a, b, tol = 1e-3) => a.elements.every((v, i) => Math.abs(v - b.elements[i]) < tol);
const relative = (a, b) => matrixOf(a).invert().multiply(matrixOf(b));

{
  // A beam with two pins seated in its end holes, the whole thing turned oddly
  const beam = part('beam', { position: [30, 12.5, -7], rotation: [20, 35, -50] });
  const beamM = matrixOf(beam);
  const pinAt = (local, id) => {
    const m = beamM.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...local), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), new THREE.Vector3(1, 1, 1)));
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    m.decompose(pos, q, new THREE.Vector3());
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    return part(id, { partId: 'pin', position: pos.toArray(), rotation: [e.x, e.y, e.z].map(THREE.MathUtils.radToDeg) });
  };
  let parts = [beam, pinAt([0, 0, 0], 'pin1'), pinAt([88.9, 0, 0], 'pin2'), part('other', { position: [500, 0, 0] })];
  const set = ['beam', 'pin1', 'pin2'];
  const start = parts.map(matrixOf);
  const pivot = setPivot(parts, set);
  check('pivot: centre of the set, not the outside part', pivot[0] < 200);

  for (const axis of ['X', 'Y', 'Z']) {
    let turned = parts;
    for (let i = 0; i < 4; i += 1) turned = applyPatches(turned, applySetTransform(turned, set, pivot, { deltaQuat: axisTurn(axis, 90) }));
    check(`turn: 4 x 90° about ${axis} returns every part to its start`, turned.every((p, i) => sameMatrix(matrixOf(p), start[i])));
  }

  const before = relative(parts[0], parts[1]);
  const before2 = relative(parts[0], parts[2]);
  parts = applyPatches(parts, applySetTransform(parts, set, pivot, { deltaQuat: axisTurn('Y', 90), deltaPos: [12.7, 0, 25.4] }));
  // Angles are stored to 0.01°, so a pin 89 mm along the beam may shift by a few thousandths of a mm
  check('seated: pins keep their place in the beam after a set turn and move', sameMatrix(relative(parts[0], parts[1]), before, 0.02) && sameMatrix(relative(parts[0], parts[2]), before2, 0.02));
  check('move: the outside part does not move', parts[3].position[0] === 500);

  const moved = applyPatches(parts, applySetTransform(parts, set, [0, 0, 0], { deltaPos: [0, 0, 25.4] }));
  check('move: a plain move shifts every member by the distance', set.every((id) => {
    const a = parts.find((p) => p.instanceId === id);
    const b = moved.find((p) => p.instanceId === id);
    return Math.abs(b.position[2] - a.position[2] - 25.4) < 1e-6 && b.rotation.join() === a.rotation.join();
  }));

  const boxes = new Map([['beam', { min: [0, 0, 0], max: [10, 10, 10] }], ['pin1', { min: [20, -5, 0], max: [30, 5, 4] }]]);
  check('pivot: combined world box centre', setPivot(parts, ['beam', 'pin1'], boxes).join() === '15,2.5,5');
}

// --- Saved selection ---------------------------------------------------------------------------------
{
  const instances = ['a', 'b', 'c'].map((id) => part(id));
  const kept = syncSelection({ instances, selectedIds: ['a', 'b'], selectedId: 'b' });
  check('selection: matching selectedIds are kept', kept.selectedIds.join() === 'a,b' && kept.selectedId === 'b');
  const older = syncSelection({ instances, selectedIds: ['a', 'b'], selectedId: 'c' });
  check('selection: a writer setting only selectedId replaces the selection', older.selectedIds.join() === 'c');
  const cleared = syncSelection({ instances, selectedIds: ['a', 'b'], selectedId: null });
  check('selection: selectedId null clears it', cleared.selectedIds.length === 0);
  const pruned = syncSelection({ instances: instances.slice(1), selectedIds: ['a', 'b'], selectedId: 'b' });
  check('selection: removed parts drop out', pruned.selectedIds.join() === 'b' && pruned.selectedId === 'b');
}

// --- Walking joints ----------------------------------------------------------------------------------
{
  // beam - 2 pins - plate1 - pin3 - plate2 ; a loose part; and a separate peg join plate2 = bracket
  const graph = {
    nodes: ['beam', 'pin1', 'pin2', 'plate1', 'pin3', 'plate2', 'bracket', 'loose'],
    edges: [['pin1', 'beam'], ['pin1', 'plate1'], ['pin2', 'beam'], ['pin2', 'plate1'], ['pin3', 'plate1'], ['pin3', 'plate2'], ['plate2', 'bracket']]
  };
  const sorted = (list) => [...list].sort().join();
  const layers = layersFrom(graph, ['beam']);
  check('layers: beam, then its pins, then the plate', sorted(layers[0]) === 'beam' && sorted(layers[1]) === 'pin1,pin2' && sorted(layers[2]) === 'plate1', JSON.stringify(layers));
  check('layers: stop at the first empty layer', layers.length === 6 && layers.every((l) => l.length > 0), JSON.stringify(layers));
  check('connected: the whole piece, not the loose part', sorted(connectedFrom(graph, ['plate2'])) === 'beam,bracket,pin1,pin2,pin3,plate1,plate2');
  check('connected: a loose part is alone', connectedFrom(graph, ['loose']).join() === 'loose');

  // A group of plate1 + pin3 counts as one node: reached in one step, all members together
  const instances = graph.nodes.map((id) => part(id, ['plate1', 'pin3'].includes(id) ? { groupId: 'g', groupName: 'G' } : {}));
  const collapse = groupCollapse(instances);
  const grouped = layersFrom(graph, ['beam'], { collapse });
  check('layers: a group is one step', sorted(grouped[2]) === 'pin3,plate1' && sorted(grouped[3]) === 'plate2', JSON.stringify(grouped));
  check('layers: seeding with one member starts from the whole group', sorted(layersFrom(graph, ['pin3'], { collapse })[0]) === 'pin3,plate1');
}

console.log(failures === 0 ? '\nAll part group checks passed.' : `\n${failures} part group check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
