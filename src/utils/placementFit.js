import * as THREE from 'three';
import { findSeatedPairs } from './pinHoleAlignment.js';
import { isMeshingGear, meshMessage, meshTurn, quaternionToEulerDeg, turnQuaternion, worldToothed } from './gearMeshing.js';
import { groupOf, hubAngleFor, shaftGroups, squareFitRoll } from './shaftGroups.js';

/**
 * The step after a part is placed (dropped from a drag, mated, picked into a hole, inserted as a
 * copy, or placed by the assistant): openspec gear-meshing and square-shaft-fit, design.md §5.
 *   1. square fit: a square axle turns to fit the square hole it is in, or a part with a square bore
 *      turns to fit the axle it is on;
 *   2. mesh: a measured spur gear turns to mesh with nearby gears and racks; when it sits on a square
 *      axle its whole shaft group turns instead;
 *   3. hub: a Smart Motor whose socket holds a square axle turns its hub to the axle's angle.
 * Pure: the viewport and the MCP engine pass their own feature lookups, so both place identically.
 *
 * `instances`: [{ instanceId, partId, label, position, rotation, socketAngleDeg, visible }] with the
 * placed part at its placed pose. `partOf(inst)` → part metadata; `featuresOf(inst)` → its world
 * features at the instance's pose (collectWorldFeatures). `receivingId`: the part the placed one was
 * put into, when known (its hole is the one a square axle fits first).
 * Returns { patches: [{ instanceId, position?, rotation?, socketAngleDeg? }], messages: [string],
 *   squareFit: { deg, openingInstanceId } | null, mesh: meshTurn result | null }.
 */
export function settlePlacement({ placedId, instances, partOf, featuresOf, receivingId = null, mesh = true }) {
  const poses = new Map(instances.filter((i) => i.visible !== false).map((i) => [i.instanceId, { ...i }]));
  const start = poses.get(placedId);
  const result = { patches: [], messages: [], squareFit: null, mesh: null };
  if (!start) return result;
  const labelOf = (id) => poses.get(id)?.label || id;
  const hasHub = (id) => Boolean(partOf(poses.get(id))?.hubSpecs);
  const featureCache = new Map();
  const featuresAt = (id) => {
    if (!featureCache.has(id)) featureCache.set(id, featuresOf(poses.get(id)));
    return featureCache.get(id);
  };
  const setPose = (id, pose) => {
    poses.set(id, pose);
    featureCache.delete(id);
  };
  const otherIds = () => [...poses.keys()].filter((id) => id !== placedId);
  const otherFeatures = () => otherIds().flatMap(featuresAt);
  const squarePairs = () =>
    findSeatedPairs(featuresAt(placedId), otherFeatures()).filter((p) => p.insert.flatDir && p.opening.flatDir);
  const placedMeta = partOf(start);

  // 1. Square fit. A Smart Motor's socket never turns its part: its hub turns instead (step 3).
  const isHubSocket = (f) => f.kind === 'shaft_socket' && hasHub(f.instanceId);
  const asShaft = squarePairs().filter((p) => p.insert.instanceId === placedId && !isHubSocket(p.opening));
  const asBore = squarePairs().filter((p) => p.opening.instanceId === placedId && !isHubSocket(p.opening));
  const pickPair = (pairs, otherOf) =>
    pairs.find((p) => otherOf(p) === receivingId) || pairs.reduce((a, b) => (b.overlapMm > a.overlapMm ? b : a));
  if (asShaft.length) {
    const pair = pickPair(asShaft, (p) => p.opening.instanceId);
    const deg = squareFitRoll(pair.insert, pair.opening);
    if (deg) setPose(placedId, turnAboutLine(poses.get(placedId), pair.insert.axis, pair.insert.origin, deg));
    result.squareFit = { deg, openingInstanceId: pair.opening.instanceId };
    // Holes further along whose flats disagree with the first one
    const misfits = squarePairs().filter(
      (p) => p.insert.instanceId === placedId && !isHubSocket(p.opening) && Math.abs(squareFitRoll(p.insert, p.opening)) > 1
    );
    for (const id of new Set(misfits.map((p) => p.opening.instanceId))) {
      result.messages.push(`Couldn't fit the square hole of ${labelOf(id)} as well`);
    }
  } else if (asBore.length) {
    const pair = pickPair(asBore, (p) => p.insert.instanceId);
    const deg = squareFitRoll(pair.opening, pair.insert);
    if (deg) setPose(placedId, turnAboutLine(poses.get(placedId), pair.opening.axis, pair.insert.origin, deg));
    result.squareFit = { deg, openingInstanceId: pair.insert.instanceId };
  }

  // 2. Mesh
  if (mesh && isMeshingGear(placedMeta)) {
    const placed = poses.get(placedId);
    const gear = worldToothed(placedMeta, placed.position, placed.rotation, placedId);
    const groups = shaftGroups(
      [...poses.keys()].map((id) => ({ instanceId: id, features: featuresAt(id), hasHub: hasHub(id) }))
    );
    const group = groupOf(groups, placedId);
    const members = group ? group.members.filter((m) => !m.hub).map((m) => m.instanceId) : [placedId];
    const neighbours = otherIds()
      .filter((id) => !members.includes(id))
      .map((id) => {
        const p = poses.get(id);
        return worldToothed(partOf(p), p.position, p.rotation, id);
      })
      .filter(Boolean);
    const turn = meshTurn(gear, neighbours);
    // A gear held by a pin or axle off its own axis can't turn about it without leaving that hole
    const offAxis = findSeatedPairs(featuresAt(placedId), otherFeatures()).some((p) => {
      const d = p.insert.origin.clone().sub(gear.center);
      return d.lengthSq() - d.dot(gear.axis) ** 2 > 0.25 ** 2;
    });
    if (turn && offAxis && Math.abs(turn.turnDeg) >= 0.005) {
      result.messages.push(`${labelOf(placedId)} is held off its axis, so it wasn't turned to mesh`);
    } else if (turn) {
      result.mesh = turn;
      if (Math.abs(turn.turnDeg) >= 0.005) {
        if (group) {
          const deg = turn.turnDeg * (Math.sign(gear.axis.dot(group.axis)) || 1);
          for (const id of members) setPose(id, turnAboutLine(poses.get(id), group.axis, group.point, deg));
        } else {
          setPose(placedId, turnAboutLine(placed, gear.axis, gear.center, turn.turnDeg));
        }
      }
      const text = meshMessage(labelOf(placedId), turn, (o) => labelOf(o.instanceId));
      if (text) result.messages.unshift(text);
    }
  }

  // 3. Smart Motor hubs holding a square axle whose angle may have changed
  const moved = new Set([...poses.keys()].filter((id) => poseChanged(poses.get(id), instances.find((i) => i.instanceId === id))));
  moved.add(placedId);
  for (const motorId of poses.keys()) {
    if (!hasHub(motorId)) continue;
    const socket = featuresAt(motorId).find((f) => f.kind === 'shaft_socket' && f.flatDir);
    if (!socket) continue;
    const shaftIds = motorId === placedId || moved.has(motorId) ? otherIds().filter((id) => id !== motorId) : [...moved].filter((id) => id !== motorId);
    const shaftFeatures = shaftIds.flatMap(featuresAt).filter((f) => f.kind === 'shaft' && f.flatDir);
    const pair = findSeatedPairs([socket], shaftFeatures)[0];
    if (!pair) continue;
    const motor = poses.get(motorId);
    const current = Number(motor.socketAngleDeg) || 0;
    const angle = hubAngleFor(socket, pair.insert, current);
    if (Math.abs(angle - current) >= 0.01) {
      setPose(motorId, { ...motor, socketAngleDeg: angle });
      result.messages.push(`Turned the hub of ${labelOf(motorId)} to ${angle}° to fit ${labelOf(pair.insert.instanceId)}`);
    }
  }

  for (const inst of instances) {
    const pose = poses.get(inst.instanceId);
    if (!pose) continue;
    const patch = { instanceId: inst.instanceId };
    if (!sameArray(pose.position, inst.position) || !sameArray(pose.rotation, inst.rotation)) {
      patch.position = pose.position;
      patch.rotation = pose.rotation;
    }
    if ((Number(pose.socketAngleDeg) || 0) !== (Number(inst.socketAngleDeg) || 0)) patch.socketAngleDeg = pose.socketAngleDeg;
    if (Object.keys(patch).length > 1) result.patches.push(patch);
  }
  return result;
}

const sameArray = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
const poseChanged = (pose, inst) =>
  !inst || !sameArray(pose.position, inst.position) || !sameArray(pose.rotation, inst.rotation);

/** `pose` turned by `deg` about the world line through `point` along `axis`. */
export function turnAboutLine(pose, axis, point, deg) {
  const a = axis.clone().normalize();
  const position = new THREE.Vector3(...pose.position)
    .sub(point)
    .applyAxisAngle(a, THREE.MathUtils.degToRad(deg))
    .add(point)
    .toArray()
    .map((v) => Math.round(v * 1000) / 1000 + 0);
  return { ...pose, position, rotation: quaternionToEulerDeg(turnQuaternion(pose.rotation, a, deg)) };
}
