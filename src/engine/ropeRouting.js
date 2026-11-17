/**
 * Placing and routing ropes in the engine (openspec rope-and-spool): the `place_rope` action shared
 * by the app's engine worker, the dev bridge and the MCP server. The pure parts (sizes, winding,
 * stringing, following parts) are in src/utils/ropePath.js and src/utils/ropeRoute.js; this adds the
 * build's meshes: the way round parts between one spot and the next.
 */
import * as THREE from 'three';
import { findPart, getCatalog, partOf } from './core.js';
import { partSpots, spotByFeature, worldSpot } from '../utils/bandPath.js';
import { instanceMatrix, isWrapEntry } from '../utils/bandRoute.js';
import { ROPE_SPECS, endPlaces, isRopePart, isSpoolPart, ropeSpec, spoolSpec, suggestRope } from '../utils/ropePath.js';
import { isRoutedRope, ropePlacesOn, ropeReport, routeOf, stringRope } from '../utils/ropeRoute.js';
import { clearBends } from './bandStrand.js';

const v3 = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));
const r1 = (n) => Number(n.toFixed(1)) + 0;

/** A new or existing rope copy for `params` (ropePartId for a new one, instanceId for one placed). */
function ropeCopy(state, params, partId) {
  if (params.instanceId) {
    const inst = state.instances.find((i) => i.instanceId === params.instanceId);
    if (!inst) return { error: `No part ${params.instanceId}.` };
    const was = partOf({ ...inst, shape: undefined });
    if (!isRopePart(was)) return { error: `${inst.label} isn't a rope.` };
    if (partId && partId !== was.id) {
      const next = findPart(partId);
      const relabel = !inst.label || getCatalog().catalog.some((p) => isRopePart(p) && inst.label.startsWith(p.name));
      return { inst: { ...inst, partId: next.id, label: relabel ? next.name : inst.label }, isNew: false };
    }
    return { inst, isNew: false };
  }
  const part = findPart(partId || '');
  if (!part) return { error: 'Give a rope part (ropePartId) or a placed rope (instanceId).' };
  if (!isRopePart(part)) return { error: `${part.name} isn't a rope.` };
  return {
    inst: { instanceId: `inst-rope-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, partId: part.id, label: params.label || part.name, position: [0, 0, 0], rotation: [0, 0, 0], color: params.color || part.defaultColor, visible: true, locked: false },
    isNew: true
  };
}

/** An end from what a caller gives: { instanceId, feature: 'post:…' | 'pocket' | 'free', at? }, or null. */
function endEntry(e) {
  if (!e || e.feature === 'free' || !e.instanceId) return null;
  return { instanceId: e.instanceId, feature: String(e.feature || ''), ...(Number.isFinite(Number(e.at)) && e.at !== null && e.at !== undefined ? { at: Number(e.at) } : {}) };
}

/** A spot entry from what a caller gives. */
function viaEntry(s) {
  const turn = Number(s.turn);
  return {
    instanceId: s.instanceId,
    feature: String(s.feature ?? ''),
    wraps: Math.max(1, Math.min(3, Math.round(Number(s.wraps) || 1))),
    ...(turn === 1 || turn === -1 ? { turn } : {}),
    ...(Number.isFinite(Number(s.height)) && s.height !== null && s.height !== undefined ? { height: Number(s.height) } : {}),
    ...(Array.isArray(s.wrap) ? { wrap: s.wrap } : {}),
    ...(Array.isArray(s.line) ? { line: s.line } : {}),
    ...(s.auto ? { auto: true } : {})
  };
}

/** A label for a rope end or spot in messages: "<part label> <place>". */
function placeName(state, s) {
  if (!s) return 'free end';
  const inst = state.instances.find((i) => i.instanceId === s.instanceId);
  if (!inst) return s.instanceId;
  const base = inst.label || partOf(inst)?.name || s.instanceId;
  if (s.feature === 'pocket') return base;
  if (s.feature === 'wrap') return `${base} corner`;
  return base;
}

/** The point of a route node in the world, for the way round parts between nodes. */
function nodePoint(state, node, isEnd, toward_ = null) {
  const inst = state.instances.find((i) => i.instanceId === node.instanceId);
  if (!inst) return null;
  const part = partOf(inst);
  const m = instanceMatrix(inst);
  if (isEnd) {
    if (node.feature === 'pocket') {
      // From the drum's surface toward the next node (the pocket itself is on the spool's shaft)
      const sp = spoolSpec(part);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      const axis = v3(sp.axis).applyQuaternion(q).normalize();
      const centre = new THREE.Vector3().setFromMatrixPosition(m);
      const toward = toward_ && toward_.clone().sub(centre);
      const out = toward ? toward.addScaledVector(axis, -toward.dot(axis)) : new THREE.Vector3();
      if (out.lengthSq() < 1e-9) out.copy(new THREE.Vector3(1, 0, 0).applyQuaternion(q));
      return centre.addScaledVector(out.normalize(), sp.flangeRadiusMm + 1);
    }
    const place = endPlaces(part).find((p) => p.feature === node.feature);
    if (!place) return null;
    const axis = v3(place.axis).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m)).normalize();
    return v3(place.center).applyMatrix4(m).addScaledVector(axis, Number.isFinite(node.at) ? node.at : 0);
  }
  if (isWrapEntry(node)) return v3(node.line[0]).add(v3(node.line[1])).multiplyScalar(0.5).applyMatrix4(m);
  const spot = spotByFeature(part, node.feature);
  return spot ? worldSpot(spot, m).center : null;
}

/**
 * place_rope: routes a rope (new or placed) from `from` over `via` (any number of grooves, posts and
 * edges, in order) to `to` (or a free end). Runs that pass through a part bend round its corners as a
 * tight string would. Spare rope is wound on the spool when an end is in a spool's pocket (`turns`
 * caps it; `winding` "over" / "under"), else it hangs as slack. A rope too short is refused with the
 * size that fits, unless `allowShort`. With `list`, or no `from`, nothing changes and the reply lists
 * the end places and spots on the named parts.
 */
export function placeRope(state, params = {}) {
  // The size: given, the placed rope's, or the shortest that fits (Choose for me)
  const asked = params.ropePartId || params.ropePartQuery ? findPart(params.ropePartId || params.ropePartQuery) : null;
  if ((params.ropePartId || params.ropePartQuery) && !asked) return { ok: false, error: `No rope "${params.ropePartId || params.ropePartQuery}".` };
  if (asked && !isRopePart(asked)) return { ok: false, error: `${asked.name} isn't a rope.` };
  const from = endEntry(params.from);
  if (params.list || !from) {
    const ids = [...new Set([params.instanceId, params.from?.instanceId, params.to?.instanceId, ...(params.via || []).map((s) => s.instanceId), ...(Array.isArray(params.near) ? params.near : [])].filter(Boolean))];
    const placedRope = params.instanceId && isRoutedRope(state.instances.find((i) => i.instanceId === params.instanceId));
    if (placedRope) {
      const inst = state.instances.find((i) => i.instanceId === params.instanceId);
      const listed = ropePlacesOn(state.instances, [...ropeRefsOf(inst), ...ids.filter((id) => id !== params.instanceId)], partOf);
      return { ok: true, rope: ropeReport(inst, partOf), ...listed };
    }
    return { ok: true, ...ropePlacesOn(state.instances, ids, partOf) };
  }
  const to = endEntry(params.to);
  const picks = (Array.isArray(params.via) ? params.via : []).map(viaEntry);
  // Every named part and feature is there
  for (const e of [from, to].filter(Boolean)) {
    const inst = state.instances.find((i) => i.instanceId === e.instanceId);
    if (!inst) return { ok: false, error: `No part ${e.instanceId}.` };
    const places = endPlaces(partOf(inst));
    if (!places.some((p) => p.feature === e.feature)) return { ok: false, error: `${inst.label} has no rope end place "${e.feature}". Its places: ${places.map((p) => p.feature).join(', ') || 'none'}.` };
    if (e.feature === 'pocket') {
      const taken = state.instances.find((r) => isRoutedRope(r) && r.instanceId !== params.instanceId && r.shape.ends.some((x) => x?.instanceId === e.instanceId && x.feature === 'pocket'));
      if (taken) return { ok: false, error: `${inst.label}'s pocket already holds ${taken.label}.` };
    }
  }
  for (const s of picks) {
    const inst = state.instances.find((i) => i.instanceId === s.instanceId);
    if (!inst) return { ok: false, error: `No part ${s.instanceId}.` };
    if (isWrapEntry(s)) continue;
    const spot = spotByFeature(partOf(inst), s.feature);
    if (!spot || ['gap', 'gaphook', 'rim', 'hook'].includes(spot.kind)) {
      const features = partSpots(partOf(inst)).filter((x) => !x.hidden && ['groove', 'post', 'edge'].includes(x.kind)).map((x) => x.feature);
      return { ok: false, error: `A rope can't go over "${s.feature}" on ${inst.label}. Its spots: ${features.slice(0, 40).join(', ') || 'none'}.` };
    }
  }
  const spoolEndIdx = from.feature === 'pocket' ? 0 : to?.feature === 'pocket' ? 1 : null;
  const spoolPart = spoolEndIdx === null ? null : partOf(state.instances.find((i) => i.instanceId === [from, to][spoolEndIdx].instanceId));
  const winding = params.winding === 'under' || params.winding === -1 ? -1 : params.winding === 'over' || params.winding === 1 ? 1 : null;
  const spoolOpts = spoolEndIdx === null ? null : { ...(Number.isFinite(Number(params.turns)) && params.turns !== null && params.turns !== undefined ? { turns: Math.max(0, Number(params.turns)) } : {}), ...(winding ? { winding } : {}) };

  // A first copy to string (the size settled below)
  const placedInst = params.instanceId ? state.instances.find((i) => i.instanceId === params.instanceId) : null;
  const firstSize = asked || (placedInst ? partOf({ ...placedInst, shape: undefined }) : findPart('228-2500-448'));
  const probe = ropeCopy(state, { ...params }, firstSize.id);
  if (probe.error) return { ok: false, error: probe.error };
  const others = state.instances.filter((i) => i.instanceId !== probe.inst.instanceId);
  const string = (inst, via, opts = {}) => stringRope(inst, { ends: [from, to], via, spool: spoolOpts }, others, partOf, opts);

  // 1. Each stretch between neighbouring route nodes takes the shortest clear way round the parts
  //    between, bending on their corners (bends the rope doesn't press on are dropped below)
  const routeIds = new Set([from, to, ...picks].filter(Boolean).map((s) => s.instanceId));
  routeIds.add(probe.inst.instanceId);
  // The pin, shaft or standoff a pulley turns on runs through the pulley's middle: it isn't in the
  // rope's way
  for (const s of picks) {
    if (isWrapEntry(s)) continue;
    const inst = state.instances.find((i) => i.instanceId === s.instanceId);
    const local = spotByFeature(partOf(inst), s.feature);
    if (!local || local.kind !== 'groove') continue;
    const groove = worldSpot(local, instanceMatrix(inst));
    for (const other of others) {
      if (routeIds.has(other.instanceId) || other.visible === false) continue;
      if (v3(other.position).distanceTo(groove.center) > 120) continue;
      const m = instanceMatrix(other);
      for (const post of partSpots(partOf(other)).filter((x) => x.kind === 'post')) {
        const w = worldSpot(post, m);
        const axis = w.axis.clone().normalize();
        if (Math.abs(axis.dot(groove.axis.clone().normalize())) < 0.999) continue;
        const d = groove.center.clone().sub(w.center);
        const t = d.dot(axis);
        if (t < Math.min(...w.span) - 1 || t > Math.max(...w.span) + 1 || d.addScaledVector(axis, -t).length() > 1) continue;
        routeIds.add(other.instanceId);
        break;
      }
    }
  }
  const nodes = [from, ...picks, ...(to ? [to] : [])];
  let via = [];
  const blocked = [];
  for (let k = 0; k + 1 < nodes.length; k++) {
    if (!params.ignoreInWay) {
      let pA = nodePoint(state, nodes[k], k === 0);
      let pB = nodePoint(state, nodes[k + 1], k + 1 > picks.length);
      if (pA && pB && nodes[k].feature === 'pocket') pA = nodePoint(state, nodes[k], true, pB);
      if (pA && pB && nodes[k + 1].feature === 'pocket') pB = nodePoint(state, nodes[k + 1], true, pA);
      if (pA && pB) {
        const res = clearBends({ instances: others }, routeIds, pA, pB, { grow: 0.45, offMm: 1.4 });
        if (res.blockedBy) blocked.push(...res.blockedBy);
        else via.push(...res.bends);
      }
    }
    if (k + 1 <= picks.length) via.push(nodes[k + 1]);
  }
  if (blocked.length) {
    const unique = [...new Map(blocked.map((b) => [b.instanceId, b])).values()];
    return { ok: false, error: `The rope would pass through ${unique.map((b) => b.label).join(', ')} and can't find a way round: pick a spot it goes over.`, needsRoute: unique };
  }
  // 2. String it with the largest rope to learn the route's length, then settle the size
  let strung = string(probe.inst, via, { allowShort: true });
  if (strung.error) return { ok: false, error: strung.error };
  // Bends the rope doesn't press on (it turns less than 2° there) go
  for (let changed = true; changed; ) {
    changed = false;
    for (let k = 0; k < via.length; k++) {
      if (!via[k].auto || (strung.contacts[k + 1]?.wrapDeg ?? 0) >= 2) continue;
      const without = via.filter((_, j) => j !== k);
      const t = string(probe.inst, without, { allowShort: true });
      if (t.error) continue;
      via = without;
      strung = t;
      changed = true;
      break;
    }
  }
  const spool = spoolPart ? spoolSpec(spoolPart) : null;
  const fit = suggestRope(strung.usedMm, spool);
  let size = asked || (placedInst && !params.chooseSize ? partOf({ ...placedInst, shape: undefined }) : null);
  if (!size) {
    if (!fit) return { ok: false, error: `No library rope is long enough: this route needs ${Math.round(strung.usedMm)} mm.`, usedMm: r1(strung.usedMm) };
    size = findPart(fit.partNumber);
  }
  const got = ropeCopy(state, params, size.id);
  if (got.error) return { ok: false, error: got.error };
  strung = string(got.inst, via, { allowShort: true });
  if (strung.error) return { ok: false, error: strung.error };
  const spec = ropeSpec(size);
  if (strung.short && !params.allowShort && !params.dryRun) {
    return { ok: false, short: true, error: `A ${spec.name} is ${Math.round(spec.lengthMm)} mm and this route needs ${Math.round(strung.usedMm)} mm.${fit ? ` The shortest rope that fits is the ${fit.name}.` : ' No library rope is long enough.'}`, suggestion: fit ? { partNumber: fit.partNumber, name: fit.name } : null, usedMm: r1(strung.usedMm), lengthMm: spec.lengthMm };
  }
  const reply = {
    lengthMm: spec.lengthMm,
    size: spec.name,
    usedMm: r1(strung.usedMm),
    spareMm: r1(strung.spareMm),
    slackMm: r1(strung.slackMm),
    ...(strung.hangMm ? { hangMm: r1(strung.hangMm) } : {}),
    turns: strung.turns,
    ...(spool ? { turnsMax: strung.turns + Math.floor(((strung.slackMm + strung.hangMm) / (2 * Math.PI * spool.coreRadiusMm)) * 4) / 4, winding: strung.shape.spool.winding === -1 ? 'under' : 'over' } : {}),
    via: strung.via.filter((s) => !s.auto).map(({ instanceId, feature, turn, wraps }) => ({ instanceId, feature, turn, wraps })),
    bends: strung.via.filter((s) => s.auto).map(({ instanceId, line, wrap }) => ({ instanceId, label: placeName(state, { instanceId }), line, wrap })),
    ...(strung.short ? { tooShortMm: r1(-strung.spareMm) } : {}),
    ...(fit && fit.partNumber !== size.partNumber ? { suggestion: { partNumber: fit.partNumber, name: fit.name } } : {})
  };
  if (params.dryRun) {
    const pts = strung.shape.path.points.map((p) => p.map((c, k) => Number((c + strung.position[k]).toFixed(2))));
    return { ok: true, dryRun: true, points: pts, partId: size.id, short: strung.short, ...reply };
  }
  const rope = { ...got.inst, position: strung.position, rotation: strung.rotation, shape: strung.shape };
  const instances = got.isNew ? [...state.instances, rope] : state.instances.map((i) => (i.instanceId === rope.instanceId ? rope : i));
  const label = `Rope: ${spec.name.replace(' Pitch Rope', '')} from ${placeName(state, from)} to ${to ? placeName(state, to) : 'a free end'}`;
  const spare = strung.turns ? `${strung.turns} turn${strung.turns === 1 ? '' : 's'} on the spool` : '';
  const slack = strung.slackMm > 0.5 ? `${Math.round(strung.slackMm)} mm slack` : '';
  return {
    ok: true,
    state: { ...state, instances, selectedId: rope.instanceId, selectedIds: [rope.instanceId], updatedAt: new Date().toISOString() },
    instanceId: rope.instanceId,
    record: true,
    stepLabel: label,
    message: `${label}: ${Math.round(strung.usedMm)} of ${Math.round(spec.lengthMm)} mm used${[spare, slack].filter(Boolean).length ? `, ${[spare, slack].filter(Boolean).join(', ')}` : ''}.${strung.short ? ` Too short by ${Math.round(-strung.spareMm)} mm.` : ''}${reply.bends.length ? ` Bends round ${[...new Set(reply.bends.map((b) => b.label))].join(', ')}.` : ''}`,
    ...reply
  };
}

function ropeRefsOf(inst) {
  return [...new Set([...inst.shape.ends.filter(Boolean).map((e) => e.instanceId), ...(inst.shape.via || []).map((s) => s.instanceId)])];
}

/**
 * Turns on a placed rope's spool set (the Inspector's and panel's stepper) or its winding flipped:
 * the rope strung again with its route, as one history step.
 */
export function setRopeWinding(state, params = {}) {
  const inst = state.instances.find((i) => i.instanceId === params.instanceId);
  if (!isRoutedRope(inst)) return { ok: false, error: 'Select a routed rope.' };
  const route = routeOf(inst);
  if (!route.spool) return { ok: false, error: `${inst.label} has no end in a spool.` };
  const r = placeRope(state, {
    instanceId: inst.instanceId,
    from: route.ends[0],
    to: route.ends[1],
    via: route.via.filter((s) => !s.auto),
    turns: Number.isFinite(Number(params.turns)) ? Number(params.turns) : route.spool.turns,
    winding: params.flip ? (route.spool.winding === 1 ? 'under' : 'over') : route.spool.winding === 1 ? 'over' : 'under',
    allowShort: true
  });
  return r;
}

export { ROPE_SPECS, isSpoolPart };
