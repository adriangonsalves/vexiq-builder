/**
 * Bands on a build (openspec rubber-bands): a band copy's route turned into its stretched path and
 * shape, and bands kept on their parts as the build changes. Pure: the caller passes `partOf(inst)`
 * (the part a copy is drawn as), so the app, the MCP engine and the checks share it.
 *
 * A route entry: { instanceId, feature, side: 'out'|'in', wraps: 1..3, height?, cross?, wrap?, h? }
 *   height  where along a post the user put it (picks which free stretch of the post it slides in)
 *   wrap    the side the band touches the spot from, in the spot part's own frame (CAD import)
 *   h       where the band ended up along the spot (solved; other bands on the spot keep clear of it)
 */
import * as THREE from 'three';
import { BAND_KIND, bandSpec, isBandPart, partSpots, solveBandPath, spotByFeature, stretchOf, suggestBand, worldSpot } from './bandPath.js';
import { bandPullN, stretchState } from '../sim/bandStrength.js';

const r3 = (n) => Number(n.toFixed(3)) + 0;
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

/** A copy's world matrix from its position and XYZ-degree rotation. */
export function instanceMatrix(inst) {
  const e = new THREE.Euler(...(inst.rotation || [0, 0, 0]).map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ');
  return new THREE.Matrix4().compose(v3(inst.position || [0, 0, 0]), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(1, 1, 1));
}

export const isRoutedBand = (inst) => inst?.shape?.kind === BAND_KIND && Array.isArray(inst.shape.route);

/** The copies a band's route names. */
export const bandRefs = (inst) => new Set(isRoutedBand(inst) ? inst.shape.route.map((s) => s.instanceId) : []);

/**
 * Where other parts' solids cover a post, measured on their meshes (the engine sets it; the app's
 * preview, without meshes, uses the parts' hole data): (spot (world), postInst, instances) -> [[a, b]]
 * along the post's axis from its centre.
 */
let postCover = null;
export function setPostCover(fn) {
  postCover = fn;
}

/**
 * The free stretches of a post along its axis (relative to the spot's centre): its span less where
 * other parts' holes sit on it (a pin through a beam is only free outside the beam) and where other
 * bands already lie on it.
 */
function freeSpans(spot, inst, instances, partOf, { widthMm, selfId, bands = true }) {
  const [lo, hi] = [Math.min(...spot.span), Math.max(...spot.span)];
  if (spot.kind !== 'post') return [[lo, hi]];
  const axis = spot.axis;
  const c = spot.center;
  const taken = [];
  for (const other of instances) {
    if (other.instanceId === inst.instanceId || other.visible === false) continue;
    if (isRoutedBand(other)) {
      if (other.instanceId === selfId || !bands) continue;
      for (const s of other.shape.route) {
        if (s.instanceId === inst.instanceId && s.feature === spot.feature && Number.isFinite(s.h)) taken.push([s.h - widthMm / 2 - 0.1, s.h + widthMm / 2 + 0.1]);
      }
      continue;
    }
    const part = partOf(other);
    if (!part?.ports || !other.position) continue;
    if (v3(other.position).distanceTo(c) > 60) continue;
    const m = instanceMatrix(other);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    for (const p of part.ports) {
      if (p.type !== 'pin_hole' && p.type !== 'shaft_bore') continue;
      const a = v3(p.axis).applyQuaternion(q).normalize();
      if (Math.abs(a.dot(axis)) < 0.995) continue;
      const o = v3(p.origin).applyMatrix4(m);
      const d = o.clone().sub(c);
      const t = d.dot(axis);
      if (d.addScaledVector(axis, -t).length() > 1) continue;
      const span = Array.isArray(p.spanMm) && p.spanMm.every(Number.isFinite) && Math.abs(p.spanMm[1] - p.spanMm[0]) < 100 ? p.spanMm : [-3, 3];
      const sgn = Math.sign(a.dot(axis)) || 1;
      const ends = span.map((x) => t + sgn * x);
      taken.push([Math.min(...ends), Math.max(...ends)]);
    }
  }
  if (postCover) taken.push(...postCover(spot, inst, instances));
  let free = [[lo, hi]];
  for (const [a, b] of taken) {
    free = free.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a]] : []), ...(b < y ? [[b, y]] : [])]));
  }
  // A band needs at least 1.5 mm of post to sit on
  return free.filter(([x, y]) => y - x >= 1.5);
}

/**
 * The route's spots in world space, ready for solveBandPath: { elements, missing, buried } where
 * `missing` lists route entries whose copy or feature is gone (or hidden), and `buried` posts with no
 * free length outside the parts they're in.
 */
export function resolveRoute(route, instances, partOf, { widthMm = 3, selfId = null } = {}) {
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const elements = [];
  const missing = [];
  const buried = [];
  for (const s of route) {
    const inst = byId.get(s.instanceId);
    // A bend round one corner of a part, the corner carried by the entry (in the part's frame)
    if (isWrapEntry(s)) {
      if (!inst || inst.visible === false) {
        missing.push(s);
        continue;
      }
      elements.push(wrapElement(s, instanceMatrix(inst)));
      continue;
    }
    const part = inst && inst.visible !== false ? partOf(inst) : null;
    const local = part ? spotByFeature(part, s.feature) : null;
    if (!local) {
      missing.push(s);
      continue;
    }
    const m = instanceMatrix(inst);
    const spot = worldSpot(local, m);
    const el = { ...spot, side: s.side || 'out', wraps: s.wraps || 1, cross: Boolean(s.cross), key: `${s.instanceId}|${s.feature}` };
    if (Array.isArray(s.wrap)) el.wrapDir = v3(s.wrap).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(m)).normalize();
    if (spot.shape === 'circle') {
      const spans = freeSpans(spot, inst, instances, partOf, { widthMm, selfId });
      if (!spans.length && spot.kind === 'post') {
        // Buried in the parts it joins, or full of other bands
        const full = freeSpans(spot, inst, instances, partOf, { widthMm, selfId, bands: false }).length > 0;
        buried.push({ ...s, label: inst.label, full });
        continue;
      }
      if (spans.length) {
        const want = Number.isFinite(s.height) ? s.height : null;
        const pick =
          want === null
            ? spans.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a))
            : spans.reduce((a, b) => (dist(b, want) < dist(a, want) ? b : a));
        // The band's middle stays half its width in from the ends of the free stretch, so its width
        // doesn't press into the part the post stands on (a stretch narrower than the band: its middle)
        const half = spot.kind === 'post' ? widthMm / 2 : 0;
        el.spanLimit = pick[1] - pick[0] > 2 * half ? [pick[0] + half, pick[1] - half] : [(pick[0] + pick[1]) / 2, (pick[0] + pick[1]) / 2];
      }
    }
    elements.push(el);
  }
  return { elements, missing, buried };
}
const dist = ([a, b], x) => (x < a ? a - x : x > b ? x - b : 0);

/** A route entry that bends round one corner of a part: { feature: 'wrap', line: [a, b], wrap }. */
export const isWrapEntry = (s) => s?.feature === 'wrap' && Array.isArray(s.line) && s.line.length === 2;
// A band over a corner rounds over it about this much (VEX beam edges are slightly rounded)
const WRAP_RADIUS = 1.0;

/** The solver element for a bend round a corner: a thin circle along the corner, bent from `wrap`'s side. */
function wrapElement(s, m) {
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const a = v3(s.line[0]).applyMatrix4(m);
  const b = v3(s.line[1]).applyMatrix4(m);
  const len = a.distanceTo(b);
  const el = {
    feature: 'wrap',
    kind: 'edge',
    label: 'corner',
    shape: 'circle',
    center: a.clone().add(b).multiplyScalar(0.5),
    axis: b.clone().sub(a).normalize(),
    radius: WRAP_RADIUS,
    span: [-len / 2, len / 2],
    side: s.side || 'out',
    wraps: 1,
    cross: false,
    key: `${s.instanceId}|wrap|${s.line.flat().join(',')}`
  };
  if (Array.isArray(s.wrap)) {
    el.wrapDir = v3(s.wrap).applyQuaternion(q).normalize();
    // The rounding sits inside the corner, as a rounded edge does: its centre back along the outward
    // direction, so the band rests on the faces either side (√2 × the radius for a square corner)
    el.center.addScaledVector(el.wrapDir, -WRAP_RADIUS * Math.SQRT2);
  }
  return el;
}

/**
 * A band copy strung round `route`: its new pose (the middle of its path, no turn) and shape, with
 * the stretch read-outs. Returns { position, rotation, shape, lengthMm, stretch, state, pullN,
 * suggestion } or { error, missing }.
 */
export function stringBand(bandInst, route, instances, partOf, meta = null) {
  const part = partOf({ ...bandInst, shape: undefined });
  if (!isBandPart(part)) return { error: `${part?.name || 'That part'} isn't a rubber band or belt.` };
  const spec = bandSpec(part);
  const { elements, missing, buried } = resolveRoute(route, instances, partOf, { widthMm: spec.widthMm, selfId: bandInst.instanceId });
  const full = buried.filter((b) => b.full);
  if (full.length) return { error: `${full.map((b) => b.label).join(', ')} ${full.length > 1 ? 'have' : 'has'} no room left beside the band${full.length > 1 ? 's' : ''} already on ${full.length > 1 ? 'them' : 'it'} for a ${spec.widthMm} mm wide band.`, buried, full: true };
  if (buried.length) return { error: `Nothing of ${buried.map((b) => b.label).join(', ')} sticks out for a band to go round: ${buried.length > 1 ? 'they are' : 'it is'} all inside the parts ${buried.length > 1 ? 'they join' : 'it joins'}.`, buried };
  if (missing.length) return { error: `The band's spot${missing.length > 1 ? 's' : ''} ${missing.map((s) => `${s.feature} on ${s.instanceId}`).join(', ')} ${missing.length > 1 ? 'are' : 'is'} gone.`, missing };
  if (elements.length < 2) return { error: 'A band needs two or more spots.' };
  const path = solveBandPath(elements, { thickMm: spec.thickMm, widthMm: spec.widthMm });
  if (!path) return { error: "Couldn't find the band's path." };
  const centre = path.points.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(path.points.length);
  const local = (p) => [r3(p.x - centre.x), r3(p.y - centre.y), r3(p.z - centre.z)];
  const shape = {
    kind: BAND_KIND,
    route: route.map((s, i) => ({ ...cleanEntry(s), h: path.contacts[i].height })),
    // The user's own clicks and how the band comes back, so it can be routed again (a band strung
    // again as its parts move keeps the ones it had)
    ...((meta?.picks || bandInst.shape?.picks) ? { picks: (meta?.picks || bandInst.shape.picks).map(cleanEntry), back: meta?.back || bandInst.shape?.back || 'auto' } : {}),
    path: { points: path.points.map(local), ups: path.ups.map((u) => [r3(u.x), r3(u.y), r3(u.z)]), lengthMm: r3(path.lengthMm) }
  };
  const stretch = stretchOf(spec, path.lengthMm);
  const sug = suggestBand(path.lengthMm);
  return {
    position: [r3(centre.x), r3(centre.y), r3(centre.z)],
    rotation: [0, 0, 0],
    shape,
    lengthMm: path.lengthMm,
    freeMm: spec.freeMm,
    stretch,
    state: stretchState(stretch),
    pullN: bandPullN(part.partNumber, spec.freeMm, path.lengthMm),
    suggestion: sug && sug[0] !== part.partNumber ? { partNumber: sug[0], name: sug[1].name, stretch: sug[2] } : null,
    contacts: path.contacts,
    owners: path.owners,
    elements
  };
}

/** A route entry with only the fields a route keeps. */
function cleanEntry(s) {
  const out = { instanceId: s.instanceId, feature: s.feature, side: s.side === 'in' ? 'in' : 'out', wraps: Math.max(1, Math.min(3, Math.round(s.wraps || 1))) };
  if (Number.isFinite(s.height)) out.height = s.height;
  if (s.cross) out.cross = true;
  if (Array.isArray(s.wrap)) out.wrap = s.wrap;
  if (Array.isArray(s.line)) out.line = s.line;
  if (s.auto) out.auto = true;
  return out;
}

/** What a band copy reports about itself (get_assembly, the Inspector). */
export function bandReport(inst, partOf) {
  if (!isRoutedBand(inst)) return null;
  const part = partOf({ ...inst, shape: undefined });
  const spec = bandSpec(part);
  if (!spec) return null;
  const lengthMm = inst.shape.path?.lengthMm || 0;
  const stretch = stretchOf(spec, lengthMm);
  return {
    size: spec.name,
    freeMm: spec.freeMm,
    lengthMm: r3(lengthMm),
    stretch: Number(stretch.toFixed(3)),
    state: stretchState(stretch),
    pullN: Number(bandPullN(part.partNumber, spec.freeMm, lengthMm).toFixed(2)),
    route: inst.shape.route.map(({ instanceId, feature, side, wraps, cross }) => ({ instanceId, feature, side, wraps, ...(cross ? { cross: true } : {}) }))
  };
}

/**
 * Bands follow their parts: after a change from `before` to `after`, every band whose route names a
 * copy that moved, turned, changed shape, was hidden or removed is strung again. A band that loses
 * spots keeps the rest; with fewer than two left it goes back to a flat ring where it is. Returns
 * { instances, flattened: [band labels], changed: [band ids] } (`instances === after` when nothing
 * needed changing).
 */
export function followBands(before, after, partOf) {
  if (!after.some(isRoutedBand)) return { instances: after, flattened: [], changed: [] };
  const old = new Map(before.map((i) => [i.instanceId, i]));
  const touched = new Set();
  const nowIds = new Set(after.map((i) => i.instanceId));
  for (const id of old.keys()) if (!nowIds.has(id)) touched.add(id);
  for (const inst of after) {
    const was = old.get(inst.instanceId);
    if (!was) continue;
    if (!sameArr(was.position, inst.position) || !sameArr(was.rotation, inst.rotation) || was.visible !== inst.visible || (was.shape !== inst.shape && !isRoutedBand(inst))) touched.add(inst.instanceId);
  }
  if (!touched.size) return { instances: after, flattened: [], changed: [] };
  let instances = after;
  const flattened = [];
  const changed = [];
  for (const band of after.filter(isRoutedBand)) {
    if (![...bandRefs(band)].some((id) => touched.has(id))) continue;
    const byId = new Map(instances.map((i) => [i.instanceId, i]));
    const alive = band.shape.route.filter((s) => {
      const inst = byId.get(s.instanceId);
      return inst && inst.visible !== false && (isWrapEntry(s) || spotByFeature(partOf(inst), s.feature));
    });
    let next;
    if (alive.length < 2 || new Set(alive.map((s) => `${s.instanceId}|${s.feature}`)).size < 2) {
      const { shape, ...flat } = band;
      next = flat;
      flattened.push(band.label || band.instanceId);
    } else {
      const strung = stringBand(band, alive, instances, partOf);
      if (strung.error) continue;
      next = { ...band, position: strung.position, rotation: strung.rotation, shape: strung.shape };
    }
    changed.push(band.instanceId);
    instances = instances.map((i) => (i.instanceId === band.instanceId ? next : i));
  }
  return { instances, flattened, changed };
}

const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);

/**
 * Spots within reach on the given copies (world positions), for listing and picking:
 * [{ instanceId, label, feature, kind, name, center, axis, radius?, gap? }].
 */
export function spotsOn(instances, ids, partOf) {
  const out = [];
  for (const inst of instances) {
    if (!ids.includes(inst.instanceId) || inst.visible === false) continue;
    const part = partOf(inst);
    const m = instanceMatrix(inst);
    for (const s of partSpots(part)) {
      if (s.hidden) continue;
      const w = worldSpot(s, m);
      out.push({
        instanceId: inst.instanceId,
        label: inst.label,
        feature: s.feature,
        kind: s.kind,
        name: s.label,
        center: w.center.toArray().map(r3),
        axis: w.axis.toArray().map((n) => Number(n.toFixed(4)) + 0),
        ...(s.radius ? { radius: s.radius } : {}),
        ...(s.gap !== undefined ? { gap: s.gap } : {})
      });
    }
  }
  return out;
}

/**
 * A band copied with other parts (duplicate, clone, library builds): its route points at the copies
 * of its parts (`idMap`: old id -> new id). A band copied without all its parts is a flat ring.
 */
export function copiedBand(inst, idMap) {
  if (!isRoutedBand(inst)) return inst;
  if (inst.shape.route.every((s) => idMap.has(s.instanceId))) {
    const moved = (list) => list.map((s) => ({ ...s, instanceId: idMap.get(s.instanceId) }));
    const picks = inst.shape.picks?.every((s) => idMap.has(s.instanceId)) ? { picks: moved(inst.shape.picks) } : {};
    const { picks: _p, ...rest } = inst.shape;
    return { ...inst, shape: { ...rest, route: moved(inst.shape.route), ...picks } };
  }
  const { shape, ...flat } = inst;
  return flat;
}

/**
 * A band's route mirrored with its parts (`idMap`: source id -> mirrored copy id) across the world
 * plane axis `axisIdx` = `planeOffsetMm`: each spot on the mirrored copy of its part; a gap goes to
 * the mirrored gear's gap nearest the mirrored place of the original one, and a CAD-read side
 * (`wrap`) is mirrored too. Inside and outside are kept. Null when a part isn't mirrored with it.
 */
export function mirroredRoute(route, idMap, instances, axisIdx, planeOffsetMm, partOf) {
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const flip = (v, point) => {
    const a = v.toArray();
    a[axisIdx] = point ? 2 * planeOffsetMm - a[axisIdx] : -a[axisIdx];
    return v3(a);
  };
  const out = [];
  for (const s of route) {
    const newId = idMap.get(s.instanceId);
    const src = byId.get(s.instanceId);
    const dst = byId.get(newId);
    if (!newId || !src || !dst) return null;
    const entry = { ...s, instanceId: newId };
    delete entry.h;
    const srcPart = partOf(src);
    const dstPart = partOf(dst);
    if (isWrapEntry(s)) {
      // The corner and its side, mirrored in the world and taken into the mirrored part's frame
      const ms = instanceMatrix(src);
      const mdInv = instanceMatrix(dst).invert();
      entry.line = s.line.map((p) => flip(v3(p).applyMatrix4(ms), true).applyMatrix4(mdInv).toArray().map((n) => Number(n.toFixed(3)) + 0));
      if (Array.isArray(s.wrap)) {
        const qs = new THREE.Quaternion().setFromRotationMatrix(ms);
        const qd = new THREE.Quaternion().setFromRotationMatrix(instanceMatrix(dst)).invert();
        entry.wrap = flip(v3(s.wrap).applyQuaternion(qs), false).applyQuaternion(qd).toArray().map((n) => Number(n.toFixed(4)) + 0);
      }
      out.push(entry);
      continue;
    }
    const local = spotByFeature(srcPart, s.feature);
    if (!local) return null;
    const ms = instanceMatrix(src);
    const md = instanceMatrix(dst);
    if (local.shape === 'slot' || local.kind === 'edge' || !spotByFeature(dstPart, s.feature)) {
      // The spot on the mirrored part nearest the mirrored place of this one
      const w = worldSpot(local, ms);
      const at = flip(local.shape === 'slot' ? w.center.clone().addScaledVector(w.radial, local.rootMm) : w.center, true);
      let best = null;
      for (const c of partSpots(dstPart)) {
        if (c.kind !== local.kind) continue;
        const cw = worldSpot(c, md);
        const p = c.shape === 'slot' ? cw.center.clone().addScaledVector(cw.radial, c.rootMm) : cw.center;
        const d = p.distanceTo(at);
        if (!best || d < best.d) best = { feature: c.feature, d };
      }
      if (!best) return null;
      entry.feature = best.feature;
    }
    if (Array.isArray(s.wrap)) {
      const qs = new THREE.Quaternion().setFromRotationMatrix(ms);
      const qd = new THREE.Quaternion().setFromRotationMatrix(md).invert();
      entry.wrap = flip(v3(s.wrap).applyQuaternion(qs), false).applyQuaternion(qd).toArray().map((n) => Number(n.toFixed(4)) + 0);
    }
    out.push(entry);
  }
  // A mirror turns the loop's direction round
  return out.reverse();
}

/**
 * The spots of one copy near a point on it (the pointer's hit, world mm), nearest first, within
 * `maxMm`: [{ instanceId, feature, kind, label, spot (world), dist }]. Band picking lights the first
 * and steps through the rest.
 */
export function spotsNearPoint(inst, part, point, maxMm = 8) {
  const m = instanceMatrix(inst);
  const p = point.isVector3 ? point : v3(point);
  const out = [];
  for (const s of partSpots(part)) {
    if (s.kind === 'gaphook' || s.kind === 'rim' || s.hidden) continue;
    const w = worldSpot(s, m);
    const d = p.clone().sub(w.center);
    const t = d.dot(w.axis);
    const [lo, hi] = [Math.min(...w.span), Math.max(...w.span)];
    let dist;
    if (w.shape === 'slot') {
      const gap = w.center.clone().addScaledVector(w.axis, Math.min(hi, Math.max(lo, t))).addScaledVector(w.radial, (s.rootMm + s.tipMm) / 2);
      dist = gap.distanceTo(p);
    } else {
      const radial = d.clone().addScaledVector(w.axis, -t).length();
      const off = t < lo ? lo - t : t > hi ? t - hi : 0;
      dist = Math.hypot(Math.max(0, Math.abs(radial - s.radius) - 0.5), off);
    }
    if (dist <= maxMm) out.push({ instanceId: inst.instanceId, feature: s.feature, kind: s.kind, label: s.label, spot: w, dist, height: Number(Math.min(hi, Math.max(lo, t)).toFixed(2)) });
  }
  // A whole gear: its rim when no gap or post is near (wrap round the outside)
  if (!out.length) {
    const rim = partSpots(part).find((s) => s.kind === 'rim');
    if (rim) {
      const w = worldSpot(rim, m);
      const d = p.clone().sub(w.center);
      const radial = d.clone().addScaledVector(w.axis, -d.dot(w.axis)).length();
      if (Math.abs(radial - rim.radius) <= maxMm) out.push({ instanceId: inst.instanceId, feature: 'rim', kind: 'rim', label: 'rim', spot: w, dist: Math.abs(radial - rim.radius), height: 0 });
    }
  }
  return out.sort((a, b) => a.dist - b.dist);
}
