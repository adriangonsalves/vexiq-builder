/**
 * Part groups and sets of parts (openspec outliner-part-groups).
 * A group is two or more parts sharing a `groupId`; each member also carries the folder's `groupName`.
 * Helpers return patch lists `[{ id, fields }]` instead of changing parts, so the app turns them into one
 * history step and the MCP server into one `mcp` step. Pure (no React/DOM), shared by the app, the
 * Vite bridge and the MCP server.
 */
import * as THREE from 'three';
import { quaternionToEulerDeg } from './gearMeshing.js';

export const newGroupId = () => `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Groups with two or more members: Map<groupId, { id, name, ids }>, in the order of their first member. */
export function groupsOf(instances = []) {
  const members = new Map();
  for (const inst of instances) {
    if (!inst.groupId) continue;
    if (!members.has(inst.groupId)) members.set(inst.groupId, []);
    members.get(inst.groupId).push(inst);
  }
  const groups = new Map();
  for (const [id, parts] of members) {
    if (parts.length < 2) continue;
    // Members can disagree after a writer edits one part; the most common name wins
    const counts = new Map();
    for (const p of parts) if (p.groupName) counts.set(p.groupName, (counts.get(p.groupName) || 0) + 1);
    let name = '';
    let best = 0;
    for (const [n, c] of counts) if (c > best) [name, best] = [n, c];
    groups.set(id, { id, name: name || 'Group', ids: parts.map((p) => p.instanceId) });
  }
  return groups;
}

/** The group a part is in, or null (a lone part with a stale groupId is in no group). */
export function groupOfPart(instances, id, groups = groupsOf(instances)) {
  const inst = instances.find((p) => p.instanceId === id);
  return (inst?.groupId && groups.get(inst.groupId)) || null;
}

/** `ids` with every grouped part's whole group added, keeping the order (a group's members come in at its first hit). */
export function expandToGroups(ids = [], instances = [], groups = groupsOf(instances)) {
  const byId = new Map(instances.map((p) => [p.instanceId, p]));
  const out = [];
  const seen = new Set();
  const push = (id) => {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  for (const id of ids) {
    const group = groups.get(byId.get(id)?.groupId);
    if (group) {
      // The clicked part stays last of its group so it is the primary part
      group.ids.filter((m) => m !== id).forEach(push);
    }
    push(id);
  }
  return out;
}

/** Groups as one node each: Map<instanceId, groupId> for every grouped part. */
export function groupCollapse(instances = [], groups = groupsOf(instances)) {
  const collapse = new Map();
  for (const group of groups.values()) for (const id of group.ids) collapse.set(id, group.id);
  return collapse;
}

/** "Group N" with the smallest N no current group uses. */
export function nextGroupName(instances = []) {
  const used = new Set();
  for (const group of groupsOf(instances).values()) {
    const m = /^Group (\d+)$/.exec(group.name);
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n += 1;
  return `Group ${n}`;
}

const clearGroup = (id) => ({ id, fields: { groupId: null, groupName: null } });

// Parts of groups that would be left with fewer than two members once `leaving` go
function dissolvedBy(instances, leaving) {
  const out = [];
  for (const group of groupsOf(instances).values()) {
    const staying = group.ids.filter((id) => !leaving.has(id));
    if (staying.length < 2) out.push(...staying);
  }
  return out;
}

/**
 * Make `ids` one new group. Parts leave their old groups, and a group left with one part is dissolved.
 * Returns { groupId, name, patches }. Throws with fewer than two known parts.
 */
export function groupParts(instances, ids, name, { groupId = newGroupId() } = {}) {
  const known = new Set(instances.map((p) => p.instanceId));
  const members = [...new Set(ids)].filter((id) => known.has(id));
  if (members.length < 2) throw new Error('A group needs two or more parts');
  const groupName = (name || '').trim() || nextGroupName(instances);
  const joining = new Set(members);
  const patches = members.map((id) => ({ id, fields: { groupId, groupName } }));
  for (const id of dissolvedBy(instances, joining)) patches.push(clearGroup(id));
  return { groupId, name: groupName, patches };
}

/** Dissolve every group that any of `ids` is in. Returns { groupIds, patches } (empty when none are grouped). */
export function ungroupParts(instances, ids) {
  const groups = groupsOf(instances);
  const byId = new Map(instances.map((p) => [p.instanceId, p]));
  const groupIds = [...new Set(ids.map((id) => byId.get(id)?.groupId).filter((g) => groups.has(g)))];
  const patches = groupIds.flatMap((g) => groups.get(g).ids.map(clearGroup));
  return { groupIds, patches };
}

/** Write `name` on every member of the group. Throws on an empty name or an unknown group. */
export function renameGroup(instances, groupId, name) {
  const group = groupsOf(instances).get(groupId);
  if (!group) throw new Error(`No group ${groupId}`);
  const groupName = (name || '').trim();
  if (!groupName) throw new Error('A group needs a name');
  return { name: groupName, oldName: group.name, patches: group.ids.map((id) => ({ id, fields: { groupName } })) };
}

/** Apply a patch list to parts. A null group field removes it, so ungrouped parts look like they never were; a new pose is also the last good pose. */
export function applyPatches(instances, patches) {
  const byId = new Map();
  for (const { id, fields } of patches) byId.set(id, { ...(byId.get(id) || {}), ...fields });
  return instances.map((inst) => {
    const fields = byId.get(inst.instanceId);
    if (!fields) return inst;
    const next = { ...inst, ...fields };
    for (const key of ['groupId', 'groupName']) if (next[key] == null || next[key] === '') delete next[key];
    // A pose set here is the part's new known good pose
    if (fields.position || fields.rotation) {
      next.lastValidPosition = [...next.position];
      next.lastValidRotation = [...next.rotation];
    }
    return next;
  });
}

// --- Moving and turning a set --------------------------------------------------------------------------

const toBox = (box) => {
  if (!box) return null;
  if (box.isBox3) return box;
  return new THREE.Box3(new THREE.Vector3(...box.min), new THREE.Vector3(...box.max));
};

/**
 * Centre of the set's combined world box, as [x, y, z]. `boxes` maps instanceId to a world box
 * (THREE.Box3 or { min, max } arrays); a part without one counts as its position.
 */
export function setPivot(instances, ids, boxes = new Map()) {
  const wanted = new Set(ids);
  const total = new THREE.Box3();
  for (const inst of instances) {
    if (!wanted.has(inst.instanceId)) continue;
    const box = toBox(boxes.get ? boxes.get(inst.instanceId) : boxes[inst.instanceId]);
    if (box && !box.isEmpty()) total.union(box);
    else total.expandByPoint(new THREE.Vector3(...(inst.position || [0, 0, 0])));
  }
  if (total.isEmpty()) return [0, 0, 0];
  return total.getCenter(new THREE.Vector3()).toArray();
}

const toVec = (v) => (v?.isVector3 ? v.clone() : new THREE.Vector3(...(v || [0, 0, 0])));
const toQuat = (q) => (q?.isQuaternion ? q.clone() : q ? new THREE.Quaternion(...q) : new THREE.Quaternion());
const round3 = (v) => Math.round(v * 1000) / 1000 + 0;

/** Turn of `deg` degrees about axis 'X' | 'Y' | 'Z' (or a vector) as a quaternion. */
export function axisTurn(axis, deg) {
  const dir =
    typeof axis === 'string'
      ? new THREE.Vector3(axis.toUpperCase() === 'X' ? 1 : 0, axis.toUpperCase() === 'Y' ? 1 : 0, axis.toUpperCase() === 'Z' ? 1 : 0)
      : toVec(axis).normalize();
  return new THREE.Quaternion().setFromAxisAngle(dir, THREE.MathUtils.degToRad(deg));
}

/**
 * New poses for the set `ids` after turning by `deltaQuat` about `pivot`, then moving by `deltaPos`.
 * Each part's rotation is composed as a quaternion and written back in Euler XYZ degrees, the order
 * the viewport and buildWorldMatrix use. Returns a patch list of { position, rotation }.
 */
export function applySetTransform(instances, ids, pivot, { deltaPos, deltaQuat } = {}) {
  const wanted = new Set(ids);
  const p = toVec(pivot);
  const move = toVec(deltaPos);
  const turn = toQuat(deltaQuat);
  const patches = [];
  for (const inst of instances) {
    if (!wanted.has(inst.instanceId)) continue;
    const position = toVec(inst.position).sub(p).applyQuaternion(turn).add(p).add(move);
    const own = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(inst.rotation || [0, 0, 0]).map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ')
    );
    patches.push({
      id: inst.instanceId,
      fields: { position: position.toArray().map(round3), rotation: quaternionToEulerDeg(turn.clone().multiply(own)) }
    });
  }
  return patches;
}

/**
 * Keep a saved state's `selectedIds` and `selectedId` (the primary, last id) in step. A writer that only
 * sets `selectedId` (older tools) replaces the selection with that one part. Ids not in the build drop out.
 */
export function syncSelection(state) {
  if (!state || !Array.isArray(state.instances)) return state;
  const present = new Set(state.instances.map((p) => p.instanceId));
  const primary = state.selectedId ?? null;
  const ids = Array.isArray(state.selectedIds) && (state.selectedIds.at(-1) ?? null) === primary ? state.selectedIds : primary ? [primary] : [];
  const selectedIds = ids.filter((id) => present.has(id));
  return { ...state, selectedIds, selectedId: selectedIds.at(-1) ?? null };
}

/** A part's world box from its catalog `bbox` ({ min, max }), as { min, max } arrays. */
export function worldBoxOf(inst, bbox) {
  if (!bbox?.min || !bbox?.max) return null;
  const matrix = new THREE.Matrix4().compose(
    toVec(inst.position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...(inst.rotation || [0, 0, 0]).map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ')
    ),
    new THREE.Vector3(1, 1, 1)
  );
  const box = new THREE.Box3(new THREE.Vector3(...bbox.min), new THREE.Vector3(...bbox.max)).applyMatrix4(matrix);
  return { min: box.min.toArray(), max: box.max.toArray() };
}

/** World boxes for `ids`, from `bboxOf(inst)` (the catalog box of the part). */
export function setWorldBoxes(instances, ids, bboxOf) {
  const wanted = new Set(ids);
  const boxes = new Map();
  for (const inst of instances) {
    if (!wanted.has(inst.instanceId)) continue;
    const box = worldBoxOf(inst, bboxOf(inst));
    if (box) boxes.set(inst.instanceId, box);
  }
  return boxes;
}

/**
 * Where a part added with nothing selected goes: on the floor (one pitch up), in front of the build
 * (+X is the front) with a pitch of space between, across from the build's middle, on the half-pitch
 * grid. `bbox` is the new part's catalog box; `bboxOf(inst)` the catalog box of a placed part.
 * Returns null for an empty build (the caller picks a spot near the origin).
 */
export function spotBesideBuild(instances, bbox, bboxOf, pitch = 12.7) {
  const box = new THREE.Box3();
  for (const inst of instances) {
    if (inst.visible === false) continue;
    const b = worldBoxOf(inst, bboxOf(inst));
    if (b) box.union(new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)));
  }
  if (box.isEmpty()) return null;
  const half = pitch / 2;
  const x = Math.ceil((box.max.x + pitch - (bbox?.min?.[0] ?? 0)) / half) * half;
  const z = Math.round((box.min.z + box.max.z) / 2 / half) * half;
  return [x, pitch, z].map((v) => Number(v.toFixed(3)) + 0);
}

/** The group `ids` make up exactly, or null (a loose set, a group and more, or part of a group). */
export function wholeGroupOf(instances, ids, groups = groupsOf(instances)) {
  if (ids.length < 2) return null;
  const first = instances.find((p) => p.instanceId === ids[0]);
  const group = first?.groupId ? groups.get(first.groupId) : null;
  if (!group || group.ids.length !== ids.length) return null;
  const wanted = new Set(ids);
  return group.ids.every((id) => wanted.has(id)) ? group : null;
}

/**
 * Copies of the set `ids`, moved by `offset` [x, y, z] mm, keeping their places relative to one another.
 * A whole group's copies make a new group "<name> copy"; copies of a loose set are in no group.
 */
export function cloneSet(instances, ids, offset, { newId, groupId = newGroupId() } = {}) {
  const group = wholeGroupOf(instances, ids);
  const wanted = new Set(ids);
  const makeId = newId || (() => `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  return instances
    .filter((inst) => wanted.has(inst.instanceId))
    .map((inst) => {
      const position = inst.position.map((v, i) => round3(v + (offset[i] || 0)));
      const copy = {
        ...inst,
        instanceId: makeId(),
        label: `${inst.label} (Copy)`,
        position,
        lastValidPosition: [...position],
        lastValidRotation: [...inst.rotation],
        isIntersecting: false
      };
      delete copy.groupId;
      delete copy.groupName;
      if (group) Object.assign(copy, { groupId, groupName: `${group.name} copy` });
      return copy;
    });
}
