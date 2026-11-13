/**
 * The assistant's mesh_right_angle tool (openspec right-angle-gears, design §7): list the mesh spots
 * of a gear round a partner it meshes with at 90°, or put the gear at one of them, meshed, as one
 * history step. Pure: state in, state out, so the MCP server and the app's own tools share it.
 */
import { applyPosePatches, checkCandidateCollision, findPart, partOf, settlePlacedInstance } from './core.js';
import { meshSpots, quaternionToEulerDeg, rightAnglePair, worldToothed } from '../utils/gearMeshing.js';

export const RIGHT_ANGLE_PAIRS_TEXT =
  'a bevel gear with a bevel gear of the same tooth count (18 Tooth with 18 Tooth, 12 Tooth High Strength with 12 Tooth High Strength); the 36 Tooth Crown Gear with a standard spur gear (12, 24, 36, 48 or 60 Tooth); the Worm Gear with a standard spur gear';

const round3 = (v) => v.toArray().map((x) => Math.round(x * 1000) / 1000 + 0);

/**
 * params: { instanceId (a gear already in the build) or part (one to add), targetInstanceId, spot?,
 * label?, color? }. Without `spot`: { ok, spots: [{ spot, axis, center, blocked, blockedBy }] } and
 * nothing changes. With one: { ok, state, record, stepLabel, message, instanceId, position, rotation,
 * spot, meshedWith } or { ok: false, error }.
 */
export function meshRightAngle(state, params = {}) {
  const target = state.instances.find((i) => i.instanceId === params.targetInstanceId);
  if (!target) return { ok: false, error: `Partner gear "${params.targetInstanceId}" not found.` };
  const moving = params.instanceId ? state.instances.find((i) => i.instanceId === params.instanceId) : null;
  if (params.instanceId && !moving) return { ok: false, error: `Gear "${params.instanceId}" not found.` };
  if (moving && moving.instanceId === target.instanceId) return { ok: false, error: 'A gear can\'t mesh with itself.' };
  const part = moving ? partOf(moving) : findPart(params.part);
  if (!part) return { ok: false, error: params.part ? `Part not found for "${params.part}".` : 'Give instanceId (a gear in the build) or part (a gear to add).' };
  const targetMeta = partOf(target);
  if (!rightAnglePair(part, targetMeta)) {
    return { ok: false, error: `${part.name} and ${targetMeta?.name || target.label} don't mesh at 90°. The pairs that do: ${RIGHT_ANGLE_PAIRS_TEXT}.` };
  }
  if (moving?.locked) return { ok: false, error: `${moving.label} is locked.` };

  const others = state.instances.filter((i) => i.visible !== false && i.instanceId !== moving?.instanceId);
  const start = moving
    ? { position: moving.position, rotation: moving.rotation }
    : { position: [target.position[0] + 30, target.position[1], target.position[2]], rotation: [0, 0, 0] };
  const partner = worldToothed(targetMeta, target.position, target.rotation, target.instanceId);
  const probeId = moving?.instanceId ?? '__mesh_spot__';
  const spots = meshSpots(part, start, partner, targetMeta).map((s) => {
    const pose = { position: round3(s.position), rotation: quaternionToEulerDeg(s.quaternion) };
    const col = checkCandidateCollision({ instanceId: probeId, partId: part.id, ...pose, visible: true }, others);
    return {
      spot: s.index,
      axis: s.axis.toArray().map((x) => Math.round(x * 1000) / 1000 + 0),
      center: round3(s.center),
      blocked: col.isIntersecting,
      blockedBy: col.collidingWith.map((c) => c.label),
      pose
    };
  });
  if (params.spot === undefined || params.spot === null) return { ok: true, spots: spots.map(({ pose, ...rest }) => rest) };

  const chosen = spots.find((s) => s.spot === Number(params.spot));
  if (!chosen) return { ok: false, error: `There is no spot ${params.spot}: ${part.name} has ${spots.length} round ${target.label}.` };
  if (chosen.blocked) return { ok: false, error: `Spot ${chosen.spot} is blocked by ${chosen.blockedBy.join(', ')}.`, spots: spots.map(({ pose, ...rest }) => rest) };

  const sameCount = state.instances.filter((i) => i.partId === part.id).length;
  const placed = moving
    ? { ...moving, ...chosen.pose }
    : {
        instanceId: `inst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        partId: part.id,
        label: params.label || `${part.name} #${sameCount + 1}`,
        ...chosen.pose,
        color: params.color || part.defaultColor,
        visible: true,
        locked: false
      };
  // The placement step as for any placement: it re-meshes (no turn left) and fits square flats
  const settled = settlePlacedInstance(placed, [...others, placed]);
  const own = settled.patches.find((p) => p.instanceId === placed.instanceId);
  if (own) Object.assign(placed, own);
  const rest = applyPosePatches(
    state.instances.filter((i) => i.instanceId !== placed.instanceId),
    settled.patches.filter((p) => p.instanceId !== placed.instanceId)
  );
  const col = checkCandidateCollision(placed, rest);
  placed.isIntersecting = col.isIntersecting;
  placed.lastValidPosition = col.isIntersecting ? null : [...placed.position];
  placed.lastValidRotation = col.isIntersecting ? null : [...placed.rotation];
  const meshNote = settled.messages.find((m) => m.startsWith('Meshed'));
  const message = [meshNote || `Meshed ${placed.label} with ${target.label}`, ...settled.messages.filter((m) => m !== meshNote)].join('. ');
  return {
    ok: true,
    state: { ...state, selectedId: placed.instanceId, instances: [...rest, placed] },
    record: true,
    stepLabel: `${moving ? 'Move' : 'Add'} ${placed.label}. ${message}`,
    message,
    instanceId: placed.instanceId,
    position: placed.position,
    rotation: placed.rotation,
    spot: chosen.spot,
    meshedWith: target.label,
    overlaps: col.collidingWith.map((c) => c.label)
  };
}
