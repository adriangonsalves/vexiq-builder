import * as THREE from 'three';
import { findSeatedPairs } from './pinHoleAlignment.js';
import { canTurnToMesh, meshMessage, meshRelation, meshSnapSlides, meshTurn, quaternionToEulerDeg, rightAngleNearMiss, turnQuaternion, worldToothed } from './gearMeshing.js';
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
export function settlePlacement({ placedId, instances, partOf, featuresOf, receivingId = null, mesh = true, snap = true }) {
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

  // 1b. A 90° pair just out of mesh slides into mesh along the gears' own axes, the placed gear first
  // and its partner too when needed (openspec precise-placement). Only gears held by nothing but the
  // shaft through their bore, and not locked, slide; shafts never move.
  if (mesh && snap && canTurnToMesh(placedMeta)) {
    const slidable = (id) => {
      const inst = poses.get(id);
      if (!inst || inst.locked) return false;
      const others = [...poses.keys()].filter((o) => o !== id).flatMap(featuresAt);
      return findSeatedPairs(featuresAt(id), others).every((p) => p.opening.instanceId === id && p.insert.kind === 'shaft');
    };
    if (slidable(placedId)) {
      const placed = poses.get(placedId);
      const mine = worldToothed(placedMeta, placed.position, placed.rotation, placedId);
      const near = otherIds()
        .map((id) => {
          const p = poses.get(id);
          const t = worldToothed(partOf(p), p.position, p.rotation, id);
          const miss = t && mine ? rightAngleNearMiss(mine, t) : null;
          return miss ? { id, offMm: miss.offMm } : null;
        })
        .filter(Boolean)
        .sort((x, y) => x.offMm - y.offMm);
      for (const n of near) {
        const partner = poses.get(n.id);
        const snap = meshSnapSlides(
          { meta: placedMeta, pose: poses.get(placedId), id: placedId },
          { meta: partOf(partner), pose: partner, id: n.id },
          { slideB: slidable(n.id) }
        );
        if (!snap) continue;
        const move = (id, axis, s) => {
          if (!s) return;
          const p = poses.get(id);
          setPose(id, { ...p, position: new THREE.Vector3(...p.position).addScaledVector(axis, s).toArray().map((v) => Math.round(v * 1000) / 1000 + 0) });
          result.messages.push(`Slid ${labelOf(id)} ${Math.abs(s).toFixed(1)} mm along its shaft to mesh with ${labelOf(id === placedId ? n.id : placedId)}`);
        };
        move(placedId, snap.axisA, snap.a);
        move(n.id, snap.axisB, snap.b);
        break;
      }
    }
  }

  // 2. Mesh
  if (mesh && canTurnToMesh(placedMeta)) {
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

  // 2b. A Smart Motor placed on a shaft: the shaft (and what's fixed on it) turns to sit square in its
  // socket; the motor body stays (openspec precise-placement). Refused, with the reason, when the shaft
  // is held elsewhere or carries a meshed gear.
  if (hasHub(placedId)) {
    const squared = squareShaftInMotor({ instances: [...poses.values()], motorId: placedId, partOf, featuresOf: (i) => featuresAt(i.instanceId) });
    if (squared?.patches) {
      for (const p of squared.patches) setPose(p.instanceId, { ...poses.get(p.instanceId), position: p.position, rotation: p.rotation });
      result.messages.push(squared.message);
    } else if (squared?.refused) {
      result.messages.push(squared.refused);
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

// A motor socket this close to a shaft's line holds it and is squared onto it (openspec precise-placement)
export const MOTOR_SQUARE_MAX_DEG = 3;
export const MOTOR_SQUARE_MAX_MM = 1;
// Closer than this counts as square already
const MOTOR_SQUARE_DONE_DEG = 0.01;
const MOTOR_SQUARE_DONE_MM = 0.005;

const midOf = (f) => f.start.clone().add(f.end).multiplyScalar(0.5);

/**
 * The shaft a Smart Motor's socket (world feature) holds, among `features`: a shaft whose line is
 * within MOTOR_SQUARE_MAX_DEG and MOTOR_SQUARE_MAX_MM of the socket's and which reaches into it.
 * Returns { shaft, angleDeg, offsetMm } for the closest, or null.
 */
export function motorShaftTilt(socket, features) {
  const sAxis = socket.axis.clone().normalize();
  const sMid = midOf(socket);
  let best = null;
  for (const f of features) {
    if (f.kind !== 'shaft' || f.instanceId === socket.instanceId) continue;
    const axis = f.axis.clone().normalize();
    const angleDeg = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(axis.dot(sAxis)))));
    if (angleDeg > MOTOR_SQUARE_MAX_DEG) continue;
    const t = (p) => p.clone().sub(f.start).dot(axis);
    const onLine = f.start.clone().addScaledVector(axis, t(sMid));
    const offsetMm = onLine.distanceTo(sMid);
    if (offsetMm > MOTOR_SQUARE_MAX_MM) continue;
    // The shaft must reach into the socket along the line
    const [lo, hi] = [t(socket.start), t(socket.end)].sort((a, b) => a - b);
    const [flo, fhi] = [0, t(f.end)].sort((a, b) => a - b);
    if (Math.min(hi, fhi) - Math.max(lo, flo) <= 0.05) continue;
    if (!best || angleDeg + offsetMm < best.angleDeg + best.offsetMm) best = { shaft: f, angleDeg, offsetMm };
  }
  return best;
}

/**
 * A Smart Motor tilted off the shaft in its socket (openspec precise-placement): the motor body stays,
 * and the shaft with its shaft group (parts fixed on it by square holes) turns about the socket onto
 * its line, keeping its turn about its own line and its depth in the socket. Refused when a member is
 * locked, a member is held by anything but the motor and the group, or a gear of the group meshes with
 * one outside it. `instances` as in settlePlacement (visible parts at their poses).
 * Returns null (no shaft in the socket, or already square), { refused: message }, or
 * { patches: [{ instanceId, position, rotation }], message, shaftId, angleDeg }.
 */
export function squareShaftInMotor({ instances, motorId, partOf, featuresOf }) {
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const motor = byId.get(motorId);
  if (!motor || !partOf(motor)?.hubSpecs) return null;
  const socket = featuresOf(motor).find((f) => f.kind === 'shaft_socket');
  if (!socket) return null;
  const others = instances.filter((i) => i.instanceId !== motorId);
  const found = motorShaftTilt(socket, others.flatMap((i) => featuresOf(i)));
  if (!found || (found.angleDeg <= MOTOR_SQUARE_DONE_DEG && found.offsetMm <= MOTOR_SQUARE_DONE_MM)) return null;
  const shaftId = found.shaft.instanceId;
  const labelOf = (id) => byId.get(id)?.label || id;
  const groups = shaftGroups(instances.map((i) => ({ instanceId: i.instanceId, features: featuresOf(i), hasHub: Boolean(partOf(i)?.hubSpecs) })));
  const group = groupOf(groups, shaftId);
  const members = new Set(group ? group.members.filter((m) => !m.hub).map((m) => m.instanceId) : [shaftId]);
  members.add(shaftId);
  const lockedId = [...members].find((id) => byId.get(id)?.locked);
  if (lockedId) return { refused: `${labelOf(motorId)} is ${found.angleDeg.toFixed(1)}° off ${labelOf(shaftId)}, but ${labelOf(lockedId)} is locked` };
  // Held by something else: turning it would pull it out
  const memberFeatures = [...members].flatMap((id) => featuresOf(byId.get(id)));
  const outside = instances.filter((i) => !members.has(i.instanceId) && i.instanceId !== motorId);
  const holder = findSeatedPairs(memberFeatures, outside.flatMap((i) => featuresOf(i)))[0];
  if (holder) {
    const other = members.has(holder.insert.instanceId) ? holder.opening.instanceId : holder.insert.instanceId;
    return { refused: `${labelOf(motorId)} is ${found.angleDeg.toFixed(1)}° off ${labelOf(shaftId)}, which also sits in ${labelOf(other)}, so it can't be turned to fit` };
  }
  // A gear of the group meshed with one outside it would leave its mesh
  const toothedOf = (i) => worldToothed(partOf(i), i.position, i.rotation, i.instanceId);
  const groupGears = [...members].map((id) => byId.get(id)).map(toothedOf).filter(Boolean);
  if (groupGears.length) {
    const outsideGears = outside.map(toothedOf).filter(Boolean);
    for (const g of groupGears) {
      const partner = outsideGears.find((o) => meshRelation(g, o) || meshRelation(o, g));
      if (partner) {
        return { refused: `${labelOf(motorId)} is ${found.angleDeg.toFixed(1)}° off ${labelOf(shaftId)}; turning the shaft would take ${labelOf(g.instanceId)} out of mesh with ${labelOf(partner.instanceId)}` };
      }
    }
  }
  const aS = found.shaft.axis.clone().normalize();
  const target = socket.axis.clone().normalize();
  if (target.dot(aS) < 0) target.negate();
  const q = new THREE.Quaternion().setFromUnitVectors(aS, target);
  const socketMid = midOf(socket);
  const pivot = found.shaft.start.clone().addScaledVector(aS, socketMid.clone().sub(found.shaft.start).dot(aS));
  const off = socketMid.clone().sub(pivot);
  const shift = off.sub(target.clone().multiplyScalar(off.dot(target)));
  const patches = [...members].map((id) => {
    const inst = byId.get(id);
    const position = new THREE.Vector3(...inst.position).sub(pivot).applyQuaternion(q).add(pivot).add(shift);
    const rotQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(...inst.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
    return {
      instanceId: id,
      position: position.toArray().map((v) => Math.round(v * 1000) / 1000 + 0),
      rotation: quaternionToEulerDeg(q.clone().multiply(rotQ))
    };
  });
  const angleDeg = found.angleDeg;
  return { patches, shaftId, angleDeg, message: `Turned ${labelOf(shaftId)} ${angleDeg.toFixed(1)}° to sit square in ${labelOf(motorId)}` };
}

// A gear moves onto a hole whose line is at most this far from its axis (openspec precise-placement)
export const TRAIN_HOLE_REACH_MM = 1.5;
const GEAR_SET_CATEGORIES = /gear|shaft|spacer|collar/i;

/**
 * Lays a gear train out again from its start (openspec precise-placement): from the gear held in
 * place (on a motor's shaft, or on a shaft held by a beam), each next gear along the meshes that is
 * free to move (its shaft group is only gears, shafts, collars and spacers, not locked, not held by
 * anything else) moves sideways onto the hole of another part that best gives the meshing distance
 * from the gear before it, and every gear then turns (with its shaft group) to mesh with the gear
 * before it. Beams, plates and motors never move. Only spur gears; `startIds` picks the trains.
 * Returns { patches: [{ instanceId, position, rotation }], messages, moved: [ids] } (empty when
 * nothing changes).
 */
export function layoutGearTrain({ instances, startIds, partOf, featuresOf }) {
  const poses = new Map(instances.filter((i) => i.visible !== false).map((i) => [i.instanceId, { ...i }]));
  const labelOf = (id) => poses.get(id)?.label || id;
  const toothedOf = (id) => {
    const p = poses.get(id);
    const t = p ? worldToothed(partOf(p), p.position, p.rotation, id) : null;
    return t && t.kind === 'gear' ? t : null;
  };
  const gearIds = [...poses.keys()].filter((id) => toothedOf(id));
  const groups = shaftGroups([...poses.values()].map((i) => ({ instanceId: i.instanceId, features: featuresOf(i), hasHub: Boolean(partOf(i)?.hubSpecs) })));
  const unitOf = (id) => {
    const g = groupOf(groups, id);
    return { ids: g ? g.members.filter((m) => !m.hub).map((m) => m.instanceId) : [id], hub: Boolean(g?.members.some((m) => m.hub)) };
  };
  // Meshes as they are now
  const neighbours = new Map(gearIds.map((id) => [id, []]));
  for (const a of gearIds) {
    for (const b of gearIds) {
      if (a >= b) continue;
      const ta = toothedOf(a);
      const tb = toothedOf(b);
      if (meshRelation(ta, tb) || meshRelation(tb, ta)) {
        neighbours.get(a).push(b);
        neighbours.get(b).push(a);
      }
    }
  }
  const featuresNow = (id) => featuresOf(poses.get(id));
  const heldBy = (ids) => {
    const set = new Set(ids);
    const outside = [...poses.keys()].filter((id) => !set.has(id) && !gearIds.includes(id)).flatMap(featuresNow);
    return findSeatedPairs(ids.flatMap(featuresNow), outside).length > 0;
  };
  const movableUnit = (unit) =>
    !unit.hub && unit.ids.every((id) => !poses.get(id).locked && GEAR_SET_CATEGORIES.test(partOf(poses.get(id))?.category || '')) && !heldBy(unit.ids);
  const shiftUnit = (unit, v) => {
    for (const id of unit.ids) {
      const p = poses.get(id);
      poses.set(id, { ...p, position: new THREE.Vector3(...p.position).add(v).toArray().map((x) => Math.round(x * 1000) / 1000 + 0) });
    }
  };
  const turnUnit = (unit, gear, deg) => {
    for (const id of unit.ids) poses.set(id, turnAboutLine(poses.get(id), gear.axis, gear.center, deg));
  };
  const messages = [];
  const moved = new Set();
  const visited = new Set();
  const starts = new Set((startIds || []).filter((id) => neighbours.has(id)));
  for (const start of starts) {
    if (visited.has(start)) continue;
    // The train: every gear meshed with the start, through the others
    const train = [start];
    const seen = new Set([start]);
    for (let i = 0; i < train.length; i++) {
      for (const n of neighbours.get(train[i])) if (!seen.has(n)) seen.add(n) && train.push(n);
    }
    if (train.length < 2) continue;
    // Its start: on a motor's shaft, else held by a beam or plate, else not one of the gears just put in
    const score = (id) => (unitOf(id).hub ? 3 : heldBy(unitOf(id).ids) ? 2 : starts.has(id) ? 0 : 1);
    const root = [...train].sort((a, b) => score(b) - score(a))[0];
    const queue = [root];
    const doneUnits = new Set(unitOf(root).ids);
    visited.add(root);
    while (queue.length) {
      const parent = queue.shift();
      for (const child of neighbours.get(parent)) {
        if (visited.has(child)) continue;
        visited.add(child);
        queue.push(child);
        const unit = unitOf(child);
        if (unit.ids.some((id) => doneUnits.has(id))) continue; // on a shaft already laid out
        unit.ids.forEach((id) => doneUnits.add(id));
        const P = toothedOf(parent);
        let C = toothedOf(child);
        // Onto the hole that best gives the meshing distance from the gear before it
        if (movableUnit(unit)) {
          const need = P.pitchRadiusMm + C.pitchRadiusMm;
          const unitSet = new Set(unit.ids);
          let best = null;
          for (const id of poses.keys()) {
            if (unitSet.has(id) || gearIds.includes(id)) continue;
            for (const f of featuresNow(id)) {
              if (f.kind !== 'pin_hole' && f.kind !== 'shaft_bore') continue;
              if (Math.abs(f.axis.dot(C.axis)) < MESH_PARALLEL) continue;
              const d = C.center.clone().sub(f.origin);
              const off = d.clone().sub(f.axis.clone().multiplyScalar(d.dot(f.axis)));
              if (off.length() > TRAIN_HOLE_REACH_MM) continue;
              const at = C.center.clone().sub(off);
              const pd = at.clone().sub(P.center);
              const across = pd.sub(P.axis.clone().multiplyScalar(pd.dot(P.axis))).length();
              const err = Math.abs(across - need);
              if (err > 1.0) continue;
              if (!best || err < best.err - 0.01 || (Math.abs(err - best.err) <= 0.01 && off.length() < best.off.length())) best = { err, off, holeOf: id };
            }
          }
          if (best && best.off.length() > 0.005) {
            shiftUnit(unit, best.off.clone().negate());
            unit.ids.forEach((id) => moved.add(id));
            messages.push(`Moved ${labelOf(child)} ${best.off.length().toFixed(2)} mm onto the hole of ${labelOf(best.holeOf)}`);
            C = toothedOf(child);
          }
        }
        // Then turned to mesh with the gear before it (a gear on a motor's shaft stays: its hub holds it)
        if (unit.hub || unit.ids.some((id) => poses.get(id).locked)) continue;
        const turn = meshTurn(C, [P]);
        if (turn && Math.abs(turn.turnDeg) >= 0.005) {
          turnUnit(unit, C, turn.turnDeg);
          unit.ids.forEach((id) => moved.add(id));
        }
      }
    }
  }
  if (moved.size) messages.push(`Laid out the gear train again from ${labelOf([...starts][0])}`);
  const patches = [];
  for (const id of moved) {
    const p = poses.get(id);
    patches.push({ instanceId: id, position: p.position, rotation: p.rotation });
  }
  return { patches, messages, moved: [...moved] };
}
const MESH_PARALLEL = Math.cos(THREE.MathUtils.degToRad(2));

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
