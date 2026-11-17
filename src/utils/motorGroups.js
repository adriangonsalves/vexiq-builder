/**
 * Motor groups (openspec motor-groups): two or more Smart Motors driven as one control in Play mode,
 * each turning the same way as the group or the opposite way. Kept apart from part groups: a motor
 * can be in the part group "Left Drive" and the motor group "Drive" at once.
 * A group is the motors sharing a `motorGroupId`; each also carries `motorGroupName`, and an opposite
 * motor has `motorReversed: true`. Helpers return patch lists `[{ id, fields }]` (null clears a field,
 * see applyPatches in partGroups.js) so the app makes one history step and the MCP server one `mcp`
 * step. Pure (no React/DOM), shared by the app, the Vite bridge and the MCP server.
 */
import * as THREE from 'three';

export const MOTOR_GROUP_FIELDS = ['motorGroupId', 'motorGroupName', 'motorReversed'];

export const newMotorGroupId = () => `mgroup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A part is a Smart Motor when its metadata has a drive hub (as Play mode decides). */
export const isMotorPart = (meta) => Boolean(meta?.hubSpecs);

/**
 * Motor groups with two or more members: Map<groupId, { id, name, motors: [{ id, reversed }] }>, in the
 * order of their first motor. A lone motor with a leftover id is in no group.
 */
export function motorGroupsOf(instances = []) {
  const members = new Map();
  for (const inst of instances) {
    if (!inst.motorGroupId) continue;
    if (!members.has(inst.motorGroupId)) members.set(inst.motorGroupId, []);
    members.get(inst.motorGroupId).push(inst);
  }
  const groups = new Map();
  for (const [id, parts] of members) {
    if (parts.length < 2) continue;
    // Members can disagree after a writer edits one motor; the most common name wins
    const counts = new Map();
    for (const p of parts) if (p.motorGroupName) counts.set(p.motorGroupName, (counts.get(p.motorGroupName) || 0) + 1);
    let name = '';
    let best = 0;
    for (const [n, c] of counts) if (c > best) [name, best] = [n, c];
    groups.set(id, { id, name: name || 'Motor group', motors: parts.map((p) => ({ id: p.instanceId, reversed: Boolean(p.motorReversed) })) });
  }
  return groups;
}

/** The motor group a part is in, or null. */
export function motorGroupOfPart(instances, id, groups = motorGroupsOf(instances)) {
  const inst = instances.find((p) => p.instanceId === id);
  return (inst?.motorGroupId && groups.get(inst.motorGroupId)) || null;
}

/** "Motor group N" with the smallest N no current motor group uses. */
export function nextMotorGroupName(instances = []) {
  const used = new Set();
  for (const group of motorGroupsOf(instances).values()) {
    const m = /^Motor group (\d+)$/.exec(group.name);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `Motor group ${n}`;
}

const clearFields = () => ({ motorGroupId: null, motorGroupName: null, motorReversed: null });
const clear = (id) => ({ id, fields: clearFields() });

/** Motors left alone in a group once `leaving` go: those groups break up. */
function brokenBy(instances, leaving) {
  const out = [];
  for (const group of motorGroupsOf(instances).values()) {
    const staying = group.motors.filter((m) => !leaving.has(m.id));
    if (staying.length < 2) out.push(...staying.map((m) => m.id));
  }
  return out;
}

/** The Smart Motors among `ids`, in build order (ids that aren't motors are left out). */
export function motorIdsIn(instances, ids, partOf) {
  const wanted = new Set(ids);
  return instances.filter((i) => wanted.has(i.instanceId) && isMotorPart(partOf(i))).map((i) => i.instanceId);
}

/** The world direction of a motor's drive socket (its shaft points along it), or null. */
export function motorAxis(inst, meta) {
  const socket = (meta?.ports || []).find((p) => p.type === 'shaft_socket');
  if (!socket) return null;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(inst.rotation || [0, 0, 0]).map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ'));
  return new THREE.Vector3(...socket.axis).normalize().applyQuaternion(q);
}

/**
 * Make the Smart Motors among `ids` one new motor group. Motors leave their old motor groups, and a
 * group left with one motor breaks up. The first motor (build order) turns the same way; each other
 * one starts opposite when its shaft points against the first one's (a mirrored drive). `opposite`
 * (ids) overrides that guess. Returns { groupId, name, motorIds, patches }. Throws with fewer than two motors.
 */
export function makeMotorGroup(instances, ids, partOf, { name, groupId = newMotorGroupId(), opposite } = {}) {
  const motorIds = motorIdsIn(instances, ids, partOf);
  if (motorIds.length < 2) throw new Error('A motor group needs two or more Smart Motors');
  const groupName = (name || '').trim() || nextMotorGroupName(instances);
  const byId = new Map(instances.map((p) => [p.instanceId, p]));
  const oppositeSet = opposite ? new Set(opposite) : null;
  const first = byId.get(motorIds[0]);
  const firstAxis = motorAxis(first, partOf(first));
  const patches = motorIds.map((id, k) => {
    let reversed = false;
    if (oppositeSet) reversed = oppositeSet.has(id);
    else if (k > 0 && firstAxis) {
      const axis = motorAxis(byId.get(id), partOf(byId.get(id)));
      reversed = Boolean(axis && axis.dot(firstAxis) < -0.5);
    }
    return { id, fields: { motorGroupId: groupId, motorGroupName: groupName, motorReversed: reversed || null } };
  });
  for (const id of brokenBy(instances, new Set(motorIds))) patches.push(clear(id));
  return { groupId, name: groupName, motorIds, patches };
}

/** Set one grouped motor same (false) or opposite (true). Throws when the motor is in no motor group. */
export function setMotorReversed(instances, id, reversed) {
  if (!motorGroupOfPart(instances, id)) throw new Error(`${id} is in no motor group`);
  return { patches: [{ id, fields: { motorReversed: reversed ? true : null } }] };
}

/** Write `name` on every motor of the group. Throws on an empty name or an unknown group. */
export function renameMotorGroup(instances, groupId, name) {
  const group = motorGroupsOf(instances).get(groupId);
  if (!group) throw new Error(`No motor group ${groupId}`);
  const groupName = (name || '').trim();
  if (!groupName) throw new Error('A motor group needs a name');
  return { name: groupName, oldName: group.name, patches: group.motors.map((m) => ({ id: m.id, fields: { motorGroupName: groupName } })) };
}

/** Take `ids` out of their motor groups; a group left with one motor breaks up. */
export function removeFromMotorGroup(instances, ids) {
  const groups = motorGroupsOf(instances);
  const byId = new Map(instances.map((p) => [p.instanceId, p]));
  const leaving = new Set(ids.filter((id) => groups.has(byId.get(id)?.motorGroupId)));
  const patches = [...leaving].map(clear);
  for (const id of brokenBy(instances, leaving)) patches.push(clear(id));
  return { removed: [...leaving], patches };
}

/** Break up a motor group. Throws on an unknown group. */
export function breakMotorGroup(instances, groupId) {
  const group = motorGroupsOf(instances).get(groupId);
  if (!group) throw new Error(`No motor group ${groupId}`);
  return { name: group.name, patches: group.motors.map((m) => clear(m.id)) };
}

/** A copy of a part (clone, paste, mirror) is in no motor group. */
export function withoutMotorGroup(inst) {
  if (!MOTOR_GROUP_FIELDS.some((k) => k in inst)) return inst;
  const out = { ...inst };
  for (const k of MOTOR_GROUP_FIELDS) delete out[k];
  return out;
}

/**
 * Play panel controls (openspec motor-groups): one per motor group with a motor in `motors` (the Play
 * graph's motors), then one per motor in no group, in the graph's order. Each is
 * { key, label, group: bool, motors: [{ id, label, reversed, stopping }] }; a group's key is `mg:<id>`.
 */
export function playControls(motors = [], instances = [], groups = motorGroupsOf(instances)) {
  const inGraph = new Map(motors.map((m) => [m.id, m]));
  const groupOf = new Map();
  for (const g of groups.values()) for (const m of g.motors) groupOf.set(m.id, g);
  const out = [];
  const shown = new Set();
  for (const m of motors) {
    const g = groupOf.get(m.id);
    if (!g) {
      out.push({ key: m.id, label: m.label, group: false, motors: [{ id: m.id, label: m.label, reversed: false, stopping: m.stopping }] });
      continue;
    }
    if (shown.has(g.id)) continue;
    shown.add(g.id);
    const members = g.motors.filter((x) => inGraph.has(x.id)).map((x) => ({ id: x.id, label: inGraph.get(x.id).label, reversed: x.reversed, stopping: inGraph.get(x.id).stopping }));
    out.push({ key: `mg:${g.id}`, label: g.name, group: true, groupId: g.id, motors: members });
  }
  return out;
}

/** The per-motor throttles a control's value gives: [[motorId, value]], opposite motors reversed. */
export function controlThrottles(control, value) {
  return control.motors.map((m) => [m.id, m.reversed && value ? -value : value]);
}

/** A control's status from its motors': stalled when any is, rpm the fastest one's. */
export function controlStatus(control, status = {}) {
  let rpm = 0;
  let stalled = false;
  for (const m of control.motors) {
    const s = status[m.id];
    if (!s) continue;
    if (s.stalled) stalled = true;
    if (Math.abs(s.rpm || 0) > Math.abs(rpm)) rpm = s.rpm || 0;
  }
  return { rpm, stalled };
}
