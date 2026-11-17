/**
 * Ropes on a build (openspec rope-and-spool): a rope copy's route turned into its path and shape,
 * and ropes kept on their parts as the build changes. Pure: the caller passes `partOf(inst)`, so the
 * app, the MCP engine and the checks share it.
 *
 * A rope's route: { ends: [end, end | null], via: [entry], spool: { turns?, winding? } | null }
 *   end    { instanceId, feature: 'post:…' | 'pocket', at? }  (`at`: along the post, in its part's frame)
 *   entry  { instanceId, feature, turn?: 1 | -1, wraps?, height?, line?, wrap?, auto? }
 *          the same spots and bends bands use; `turn` is the way the rope goes round the spot's own
 *          axis (right-hand rule), in the spot part's frame, so it holds when a free pulley spins.
 * The spool's `winding` is the way the spool turns about its axis to wind rope on (+1 / -1).
 */
import * as THREE from 'three';
import { partSpots, solveBandPath, spotByFeature, worldSpot } from './bandPath.js';
import { freeSpans, instanceMatrix, isWrapEntry, resolveRoute, spotsNearPoint } from './bandRoute.js';
import { ROPE_KIND, TAB_SPAN_MM, defaultTurn, drumSpot, endPlaces, isRopePart, isSpoolPart, ropeSpec, sagCurve, spoolSpec, suggestRope, turnsForLength, turnsThatFit, windingAt, woundLengthMm } from './ropePath.js';

const r3 = (n) => Number(n.toFixed(3)) + 0;
const r4 = (n) => Number(n.toFixed(4)) + 0;
const v3 = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));
const UP = new THREE.Vector3(0, 1, 0);
const HANG_PROBE_MM = 1000; // a free end is solved toward a point this far straight down

export const isRoutedRope = (inst) => inst?.shape?.kind === ROPE_KIND && Array.isArray(inst.shape.ends);

/** The copies a rope's route names (its ends and spots). */
export function ropeRefs(inst) {
  if (!isRoutedRope(inst)) return new Set();
  return new Set([...inst.shape.ends.filter(Boolean).map((e) => e.instanceId), ...(inst.shape.via || []).map((s) => s.instanceId)]);
}

/** An end with only the fields an end keeps. */
function cleanEnd(e) {
  if (!e || e.feature === 'free') return null;
  return { instanceId: e.instanceId, feature: String(e.feature), ...(Number.isFinite(e.at) ? { at: r3(e.at) } : {}) };
}

/** A spot entry with only the fields a route keeps. */
function cleanVia(s) {
  const out = { instanceId: s.instanceId, feature: String(s.feature), wraps: Math.max(1, Math.min(3, Math.round(s.wraps || 1))) };
  if (s.turn === 1 || s.turn === -1) out.turn = s.turn;
  if (Number.isFinite(s.height)) out.height = s.height;
  if (Array.isArray(s.wrap)) out.wrap = s.wrap;
  if (Array.isArray(s.line)) out.line = s.line;
  if (s.auto) out.auto = true;
  if (Number.isFinite(s.h)) out.h = s.h;
  return out;
}

/**
 * Where a rope end sits, in the world: { kind: 'post' | 'pocket', inst, point, axis, element } or
 * { error }. A tab on a post sits where the user pointed (`at`), else against the nearest part on the
 * post, in a free stretch of post at least TAB_SPAN_MM long.
 */
export function resolveEnd(end, instances, partOf, { selfId = null } = {}) {
  const inst = instances.find((i) => i.instanceId === end.instanceId);
  if (!inst || inst.visible === false) return { error: `The rope's end on ${end.instanceId} is gone.`, missing: true };
  const part = partOf(inst);
  const m = instanceMatrix(inst);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  if (end.feature === 'pocket') {
    const spool = spoolSpec(part);
    if (!spool) return { error: `${inst.label || part?.name} has no pocket for a rope's end.` };
    const axis = v3(spool.axis).applyQuaternion(q).normalize();
    return { kind: 'pocket', inst, part, spool, m, q, axis, point: v3(spool.pocket.center).applyMatrix4(m), origin: new THREE.Vector3().setFromMatrixPosition(m) };
  }
  const local = endPlaces(part).find((p) => p.feature === end.feature && p.kind === 'post');
  if (!local) return { error: `${inst.label || part?.name} has no post "${end.feature}" for a rope's end.`, missing: true };
  const spot = worldSpot({ ...spotByFeature(part, end.feature) }, m);
  const half = TAB_SPAN_MM / 2;
  const spans = freeSpans(spot, inst, instances.filter((i) => i.instanceId !== selfId && !isRoutedRope(i)), partOf, { widthMm: TAB_SPAN_MM, selfId, bands: true }).filter(([a, b]) => b - a >= TAB_SPAN_MM - 0.05);
  if (!spans.length) return { error: `There's no room on ${inst.label || part.name} for a rope's tab: it needs ${TAB_SPAN_MM} mm of free post.`, buried: true };
  const [lo0, hi0] = [Math.min(...spot.span), Math.max(...spot.span)];
  let at;
  if (Number.isFinite(end.at)) {
    const pick = spans.reduce((a, b) => (gap(b, end.at) < gap(a, end.at) ? b : a));
    at = Math.min(pick[1] - half, Math.max(pick[0] + half, end.at));
  } else {
    // Against the nearest part on the post: the end of a free stretch that isn't the post's own tip
    let best = null;
    for (const [a, b] of spans) {
      for (const [edge, x] of [
        [a, a + half],
        [b, b - half]
      ]) {
        const tip = Math.abs(edge - lo0) < 0.05 || Math.abs(edge - hi0) < 0.05;
        const score = (tip ? 100 : 0) + Math.abs(x);
        if (!best || score < best.score) best = { at: x, score };
      }
    }
    at = best.at;
  }
  const point = spot.center.clone().addScaledVector(spot.axis, at);
  return { kind: 'post', inst, part, m, q, axis: spot.axis.clone(), point, at, spot };
}
const gap = ([a, b], x) => (x < a ? a - x : x > b ? x - b : 0);

/** The solver element for an end on a post: a point at the tab's hole centre. */
const pointElement = (end, key) => ({ feature: 'end', kind: 'end', label: 'end', shape: 'point', center: end.point.clone(), axis: end.axis.clone(), span: [0, 0], key });

/** The solver element for a spool's drum with `turns` on it: a circle at the cord's layer, at the height of the last turn. */
function drumElement(end, cordMm, turns) {
  const w = windingAt(end.spool, cordMm, turns);
  // The solver adds half the cord to the radius
  return { feature: 'drum', kind: 'drum', label: 'drum', shape: 'circle', center: end.origin.clone(), axis: end.axis.clone(), radius: w.radius - cordMm / 2, span: [w.height, w.height], key: `${end.inst.instanceId}|drum` };
}

/**
 * A rope copy strung on a route: its new pose (the middle of its path, no turn) and shape, with the
 * read-outs. Returns { position, rotation, shape, lengthMm, usedMm, spareMm, slackMm, hangMm, turns,
 * short, contacts, elements, via } or { error, missing? }.
 * Options: `allowShort` keeps a rope too short for its route on it, marked short.
 */
export function stringRope(ropeInst, route, instances, partOf, opts = {}) {
  const part = partOf({ ...ropeInst, shape: undefined });
  if (!isRopePart(part)) return { error: `${part?.name || 'That part'} isn't a rope.` };
  const spec = ropeSpec(part);
  const cord = spec.cordMm;
  const others = instances.filter((i) => i.instanceId !== ropeInst.instanceId);
  const ends = [route.ends?.[0] ? cleanEnd(route.ends[0]) : null, route.ends?.[1] ? cleanEnd(route.ends[1]) : null];
  if (!ends[0] && ends[1]) ends.reverse();
  if (!ends[0]) return { error: 'A rope needs at least one held end.' };
  if (ends[0].feature === 'pocket' && ends[1]?.feature === 'pocket') return { error: 'Only one end of a rope can be in a spool.' };
  const resolved = [];
  for (const e of ends) {
    if (!e) {
      resolved.push(null);
      continue;
    }
    const r = resolveEnd(e, others, partOf, { selfId: ropeInst.instanceId });
    if (r.error) return r;
    resolved.push(r);
  }
  const spoolEnd = resolved[0]?.kind === 'pocket' ? 0 : resolved[1]?.kind === 'pocket' ? 1 : null;
  const winding = route.spool?.winding === -1 ? -1 : 1;

  // The spots between, as the band solver takes them
  const via = (route.via || []).map(cleanVia);
  const { elements: viaEls, missing, buried } = resolveRoute(
    via.map((s) => ({ ...s, side: 'out' })),
    others,
    partOf,
    { widthMm: cord, selfId: ropeInst.instanceId }
  );
  if (missing.length) return { error: `The rope's spot${missing.length > 1 ? 's' : ''} ${missing.map((s) => `${s.feature} on ${s.instanceId}`).join(', ')} ${missing.length > 1 ? 'are' : 'is'} gone.`, missing };
  if (buried.length) return { error: `Nothing of ${buried.map((b) => b.label).join(', ')} sticks out for a rope to go round.`, buried };
  // A rope lies in a pulley's groove, below its rim
  viaEls.forEach((el) => {
    if (el.kind === 'groove' && Number.isFinite(el.grooveRadiusMm)) el.radius = el.grooveRadiusMm;
  });

  const solve = (turnsOnSpool) => {
    const els = [];
    const keyOf = (k) => `${ropeInst.instanceId}|end${k}`;
    els.push(spoolEnd === 0 ? drumElement(resolved[0], cord, turnsOnSpool) : pointElement(resolved[0], keyOf(0)));
    els.push(...viaEls.map((e) => ({ ...e })));
    let hangProbe = null;
    if (resolved[1]) els.push(spoolEnd === 1 ? drumElement(resolved[1], cord, turnsOnSpool) : pointElement(resolved[1], keyOf(1)));
    else {
      // A free end hangs straight down from the last spot
      const last = els[els.length - 1];
      hangProbe = v3(last.center).addScaledVector(UP, -HANG_PROBE_MM);
      els.push({ feature: 'hang', kind: 'end', label: 'free end', shape: 'point', center: hangProbe, axis: UP.clone(), span: [0, 0], key: keyOf(1) });
    }
    // Sides: the asked turn, or the side a tight rope presses on; the drum by its winding
    const centreOf = (e) => (e.shape === 'point' ? v3(e.center) : v3(e.center).addScaledVector(v3(e.axis), Number.isFinite(e.span?.[0]) && e.kind === 'drum' ? e.span[0] : 0));
    const turns = els.map((e, i) => {
      if (e.kind === 'drum') return i === 0 ? -winding : winding;
      if (i === 0 || i === els.length - 1 || e.shape !== 'circle') return 0;
      const s = via[i - 1];
      if (s.turn === 1 || s.turn === -1) {
        // `turn` is about the spot's axis in its part's frame; the world axis may point the other way
        return s.turn;
      }
      if (isWrapEntry(s) || Array.isArray(s.wrap)) return 0; // a bend's side comes from its corner
      return defaultTurn(centreOf(els[i - 1]), e, centreOf(els[i + 1]));
    });
    const path = solveBandPath(els, { open: true, turns, thickMm: cord, widthMm: cord, maxRounds: 200 });
    return { els, path, hangProbe, turns };
  };

  // Turns on the spool: the asked number, never more than the spare takes; else all the spare
  const asked = Number.isFinite(route.spool?.turns) ? Math.max(0, route.spool.turns) : null;
  let turnsOnSpool = spoolEnd === null ? 0 : asked ?? 0;
  let got = solve(turnsOnSpool);
  if (!got.path) return { error: "Couldn't find the rope's path." };
  const usedOf = (g) => {
    let used = g.path.lengthMm;
    if (g.hangProbe) used -= v3(g.path.contacts[g.path.contacts.length - 2].b).distanceTo(g.hangProbe);
    return used;
  };
  if (spoolEnd !== null) {
    for (let k = 0; k < 4; k++) {
      const spare = spec.lengthMm - usedOf(got);
      const fit = turnsForLength(spoolSpec(resolved[spoolEnd].part), cord, Math.max(0, spare));
      const want = asked === null ? fit : Math.min(asked, fit);
      if (Math.abs(want - turnsOnSpool) < 1e-6) break;
      turnsOnSpool = want;
      got = solve(turnsOnSpool);
      if (!got.path) return { error: "Couldn't find the rope's path." };
    }
  }
  const { els, path, hangProbe } = got;
  const usedMm = usedOf(got);
  const spool = spoolEnd !== null ? spoolSpec(resolved[spoolEnd].part) : null;
  const woundMm = spool ? woundLengthMm(spool, cord, turnsOnSpool) : 0;
  const spareMm = spec.lengthMm - usedMm;
  const short = spareMm < -0.5;
  if (short && !opts.allowShort) {
    const sug = suggestRope(usedMm, spool, cord);
    return { error: `A ${spec.name} is ${Math.round(spec.lengthMm)} mm and this route needs ${Math.round(usedMm)} mm.${sug ? ` The shortest rope that fits is the ${sug.name}.` : ' No library rope is long enough.'}`, short: true, usedMm, suggestion: sug };
  }
  const left = Math.max(0, spareMm - woundMm);
  const hangMm = resolved[1] ? 0 : left;
  const slackMm = resolved[1] ? left : 0;

  // The drawn middle line and the tabs, in the world
  const { points: pts, tabs } = drawRope({
    elements: els,
    path,
    hang: hangProbe ? hangMm : null,
    slackMm,
    spool: spool ? { end: spoolEnd, spec: spool, cordMm: cord, turns: turnsOnSpool, winding, origin: resolved[spoolEnd].origin, axis: resolved[spoolEnd].axis, pocket: resolved[spoolEnd].point } : null,
    ends: resolved.map((r) => (!r ? null : r.kind === 'pocket' ? { kind: 'pocket', point: r.point, axis: r.axis, slot: slotDir(r) } : { kind: 'post', point: r.point, axis: r.axis }))
  });

  const centre = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(pts.length || 1);
  const local = (p) => [r3(p.x - centre.x), r3(p.y - centre.y), r3(p.z - centre.z)];
  const viaOut = via.map((s, i) => {
    const c = path.contacts[i + 1];
    const e = { ...s, h: c.height };
    if (!isWrapEntry(s) && !Array.isArray(s.wrap) && els[i + 1].shape === 'circle') e.turn = c.turn === -1 ? -1 : 1;
    return e;
  });
  const endsOut = resolved.map((r, k) => (r ? { ...ends[k], ...(r.kind === 'post' ? { at: r3(r.at) } : {}) } : null));
  const shape = {
    kind: ROPE_KIND,
    ends: endsOut,
    via: viaOut,
    spool: spoolEnd !== null ? { end: spoolEnd, turns: turnsOnSpool, winding } : null,
    path: { points: pts.map(local), radiusMm: cord / 2 },
    tabs: tabs.map((t) => (t ? { position: local(t.position), quaternion: t.quaternion } : null)),
    lengthMm: spec.lengthMm,
    usedMm: r3(usedMm),
    slackMm: r3(slackMm),
    hangMm: r3(hangMm),
    ...(short ? { short: r3(-spareMm) } : {})
  };
  return {
    position: [r3(centre.x), r3(centre.y), r3(centre.z)],
    rotation: [0, 0, 0],
    shape,
    lengthMm: spec.lengthMm,
    usedMm,
    spareMm,
    woundMm,
    slackMm,
    hangMm,
    turns: turnsOnSpool,
    turnsFit: spool ? turnsThatFit(spool, cord) : 0,
    short,
    contacts: path.contacts,
    owners: path.owners,
    elements: els,
    via: viaOut,
    hangProbe: Boolean(hangProbe),
    solveTurns: got.turns,
    spoolEnd,
    resolvedEnds: resolved.map((r) => (!r ? null : r.kind === 'pocket' ? { kind: 'pocket', instanceId: r.inst.instanceId, point: r.point, axis: r.axis, slot: slotDir(r), origin: r.origin } : { kind: 'post', instanceId: r.inst.instanceId, point: r.point, axis: r.axis }))
  };
}

/** The direction out of a spool's pocket through its flange slot, in the world. */
function slotDir(r) {
  const a = (r.spool.pocket.slotDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(a), Math.sin(a), 0).applyQuaternion(r.q);
}

/**
 * A rope's drawn middle line and tab poses (world) from its solved path, shared by the build
 * (stringRope) and Play mode's redraw: coils on the spool from the pocket, the path with any slack
 * as a sag on its longest run, and a free end hanging straight down by `hang` mm.
 *   elements, path       the solver's elements and solution (open)
 *   hang                 null, or the length of a free end (the last element is then the hang probe)
 *   spool                null, or { end, spec, cordMm, turns, winding, origin, axis, pocket }
 *   ends                 [{ kind: 'post' | 'pocket', point, axis, slot? } | null, ...]
 * Returns { points: [Vector3], tabs: [{ position: Vector3, quaternion: [x,y,z,w] } | null] }.
 */
export function drawRope({ elements, path, hang = null, slackMm = 0, spool = null, ends }) {
  const contacts = path.contacts.map((c) => ({ a: v3(c.a), b: v3(c.b) }));
  const n = elements.length;
  const perEl = elements.map(() => []);
  path.points.forEach((p, k) => perEl[path.owners[k]].push(v3(p)));
  let sagRun = -1;
  if (slackMm > 0.5) {
    let best = 0;
    for (let i = 0; i < n - 1; i++) {
      const d = contacts[i].b.distanceTo(contacts[i + 1].a);
      if (d > best) {
        best = d;
        sagRun = i;
      }
    }
  }
  const world = [];
  const coil = spool ? coilPoints({ axis: spool.axis, origin: spool.origin, point: spool.pocket }, spool.spec, spool.cordMm, spool.turns, spool.winding, spool.end === 0 ? contacts[0].a : contacts[n - 1].a) : null;
  if (coil && spool.end === 0) world.push(...coil);
  for (let i = 0; i < n; i++) {
    if (hang !== null && i === n - 1) {
      world.push(contacts[n - 2].b.clone().addScaledVector(UP, -Math.max(0, hang)));
      break;
    }
    world.push(...perEl[i]);
    if (i === sagRun) world.push(...sagCurve(contacts[i].b, contacts[i + 1].a, slackMm).slice(1, -1));
  }
  if (coil && spool.end === 1) world.push(...coil.slice().reverse());
  const points = world.filter((p, k) => k === 0 || p.distanceTo(world[k - 1]) > 1e-3);
  const tabs = ends.map((r, k) => {
    if (!r) return null;
    if (r.kind === 'pocket') return tabPose(r.point, r.axis, r.slot);
    const from = k === 0 ? contacts[0].b : contacts[n - 1].a;
    const toward = k === 0 ? (n > 1 ? contacts[1].a : from) : contacts[n - 2].b;
    return tabPose(from, r.axis, toward.clone().sub(from));
  });
  return { points, tabs };
}

/** A tab's pose: its hole on `point` with its axis along `axis`, its tip pointing away from `cordDir`. */
function tabPose(point, axis, cordDir) {
  const z = v3(axis).normalize();
  const x = v3(cordDir).negate();
  x.addScaledVector(z, -x.dot(z));
  if (x.lengthSq() < 1e-9) x.set(1, 0, 0).addScaledVector(z, -z.x);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  return { position: point.clone(), quaternion: [q.x, q.y, q.z, q.w].map(r4) };
}

/**
 * The coils on a drum, in the world, from the pocket to where the rope leaves (`leave`): a helix
 * across the drum per layer (design decision 5). The rope runs round the drum the way the spool
 * winds it.
 */
export function coilPoints(end, spool, cordMm, turns, winding, leave) {
  const axis = end.axis;
  const o = end.origin;
  const toLocal = (p) => {
    const d = v3(p).sub(o);
    return { h: d.dot(axis), r: d.clone().addScaledVector(axis, -d.dot(axis)) };
  };
  const lv = toLocal(leave);
  // Angles in the plane across the axis from a fixed direction
  const u = lv.r.lengthSq() > 1e-9 ? lv.r.clone().normalize() : new THREE.Vector3().crossVectors(axis, Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  const w = new THREE.Vector3().crossVectors(axis, u);
  const at = (theta, h, r) => o.clone().addScaledVector(axis, h).addScaledVector(u, r * Math.cos(theta)).addScaledVector(w, r * Math.sin(theta));
  const out = [];
  // From the pocket out through the slot onto the drum
  const start = windingAt(spool, cordMm, 0);
  const th0 = winding * 2 * Math.PI * turns; // the leave point is at angle 0
  out.push(end.point.clone());
  const steps = Math.max(2, Math.ceil(turns * 36));
  for (let k = 0; k <= steps; k++) {
    const t = (turns * k) / steps;
    const wa = windingAt(spool, cordMm, t);
    out.push(at(th0 - winding * 2 * Math.PI * t, k === 0 ? start.height : wa.height, wa.radius));
  }
  void lv;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Report, follow, copy and mirror

/** What a rope copy reports about itself (get_assembly, get_part_details, the Inspector). */
export function ropeReport(inst, partOf) {
  if (!isRoutedRope(inst)) return null;
  const part = partOf({ ...inst, shape: undefined });
  const spec = ropeSpec(part);
  if (!spec) return null;
  const s = inst.shape;
  const spareMm = spec.lengthMm - (s.usedMm || 0);
  return {
    size: spec.name,
    lengthMm: spec.lengthMm,
    usedMm: r3(s.usedMm || 0),
    spareMm: r3(spareMm),
    slackMm: r3(s.slackMm || 0),
    ...(s.hangMm ? { hangMm: r3(s.hangMm) } : {}),
    turns: s.spool?.turns ?? 0,
    ...(s.spool ? { winding: s.spool.winding === -1 ? 'under' : 'over' } : {}),
    ends: s.ends,
    via: (s.via || []).map(({ instanceId, feature, turn, wraps, auto }) => ({ instanceId, feature, ...(turn ? { turn } : {}), wraps, ...(auto ? { auto: true } : {}) })),
    ...(s.short ? { tooShortMm: s.short } : {})
  };
}

/** A rope's route as stringRope takes it, from its shape. */
export const routeOf = (inst) => ({ ends: inst.shape.ends, via: inst.shape.via || [], spool: inst.shape.spool ? { turns: inst.shape.spool.turns, winding: inst.shape.spool.winding } : null });

/**
 * Ropes follow their parts (design "Ropes follow their parts"): after a change from `before` to
 * `after`, every rope whose route names a copy that moved, turned, was hidden or removed is strung
 * again, keeping its turns (the change goes to slack first, then turns come off the spool; a rope
 * still too short stays on its route marked short). An end whose part is gone becomes free; a rope
 * with no held end left goes back to a straight rope. Returns { instances, flattened, changed }.
 */
export function followRopes(before, after, partOf) {
  if (!after.some(isRoutedRope)) return { instances: after, flattened: [], changed: [] };
  const old = new Map(before.map((i) => [i.instanceId, i]));
  const touched = new Set();
  const nowIds = new Set(after.map((i) => i.instanceId));
  for (const id of old.keys()) if (!nowIds.has(id)) touched.add(id);
  for (const inst of after) {
    const was = old.get(inst.instanceId);
    if (!was) continue;
    if (!sameArr(was.position, inst.position) || !sameArr(was.rotation, inst.rotation) || was.visible !== inst.visible || (was.shape !== inst.shape && !isRoutedRope(inst))) touched.add(inst.instanceId);
  }
  if (!touched.size) return { instances: after, flattened: [], changed: [] };
  let instances = after;
  const flattened = [];
  const changed = [];
  for (const rope of after.filter(isRoutedRope)) {
    if (![...ropeRefs(rope)].some((id) => touched.has(id))) continue;
    const byId = new Map(instances.map((i) => [i.instanceId, i]));
    const alive = (id) => byId.get(id) && byId.get(id).visible !== false;
    const route = routeOf(rope);
    const ends = route.ends.map((e) => (e && alive(e.instanceId) ? e : null));
    const via = route.via.filter((s) => alive(s.instanceId));
    let next;
    if (!ends[0] && !ends[1]) {
      const { shape, ...flat } = rope;
      next = flat;
      flattened.push(rope.label || rope.instanceId);
    } else {
      // Turns kept: the asked number is the most the spool keeps (stringRope takes turns off to fit)
      const strung = stringRope(rope, { ends, via, spool: route.spool }, instances, partOf, { allowShort: true });
      if (strung.error) {
        if (!strung.missing && !strung.buried) continue;
        const { shape, ...flat } = rope;
        next = flat;
        flattened.push(rope.label || rope.instanceId);
      } else next = { ...rope, position: strung.position, rotation: strung.rotation, shape: strung.shape };
    }
    changed.push(rope.instanceId);
    instances = instances.map((i) => (i.instanceId === rope.instanceId ? next : i));
  }
  return { instances, flattened, changed };
}

/**
 * Ropes in a build just opened whose route names a part or feature that isn't there (design "Saving
 * ropes"): that end goes free, a lost spot is dropped, and a rope with no held end left is a straight
 * rope again. Returns { instances, messages } (`instances` unchanged when nothing needed it).
 */
export function repairRopes(instances, partOf) {
  if (!instances.some(isRoutedRope)) return { instances, messages: [] };
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const has = (e, isEnd) => {
    const inst = byId.get(e.instanceId);
    if (!inst) return false;
    if (!isEnd) return isWrapEntry(e) || Boolean(spotByFeature(partOf(inst), e.feature));
    return endPlaces(partOf(inst)).some((p) => p.feature === e.feature);
  };
  let out = instances;
  const messages = [];
  for (const rope of instances.filter(isRoutedRope)) {
    const route = routeOf(rope);
    const ends = route.ends.map((e) => (e && has(e, true) ? e : null));
    const via = route.via.filter((v) => has(v, false));
    if (ends.every((e, k) => e === route.ends[k]) && via.length === route.via.length) continue;
    let next;
    if (!ends[0] && !ends[1]) {
      const { shape, ...flat } = rope;
      next = flat;
      messages.push(`${rope.label || 'A rope'} lost its ends and is a straight rope again.`);
    } else {
      const strung = stringRope(rope, { ends, via, spool: route.spool }, out, partOf, { allowShort: true });
      if (strung.error) {
        const { shape, ...flat } = rope;
        next = flat;
        messages.push(`${rope.label || 'A rope'} couldn't keep its route and is a straight rope again.`);
      } else {
        next = { ...rope, position: strung.position, rotation: strung.rotation, shape: strung.shape };
        messages.push(`${rope.label || 'A rope'} lost a part on its route: ${ends.some((e, k) => !e && route.ends[k]) ? 'that end hangs free' : 'it was routed again without it'}.`);
      }
    }
    out = out.map((i) => (i.instanceId === rope.instanceId ? next : i));
  }
  return { instances: out, messages };
}

const sameArr = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-6);

/** A rope copied with other parts (`idMap`: old id -> new id); one copied without all its parts is a straight rope. */
export function copiedRope(inst, idMap) {
  if (!isRoutedRope(inst)) return inst;
  if ([...ropeRefs(inst)].every((id) => idMap.has(id))) {
    const s = inst.shape;
    return { ...inst, shape: { ...s, ends: s.ends.map((e) => (e ? { ...e, instanceId: idMap.get(e.instanceId) } : null)), via: (s.via || []).map((v) => ({ ...v, instanceId: idMap.get(v.instanceId) })) } };
  }
  const { shape, ...flat } = inst;
  return flat;
}

/**
 * A rope's route mirrored with its parts (`idMap`: source id -> mirrored copy id) across the world
 * plane axis `axisIdx` = `planeOffsetMm`. A mirror turns every way round the other way, so the spool
 * winds the mirrored way and each `turn` flips, unless the mirrored part's spot axis comes out
 * reversed too (then it stays). Null when a part isn't mirrored with it.
 */
export function mirroredRope(shape, idMap, instances, axisIdx, planeOffsetMm, partOf) {
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const flipV = (v) => {
    const a = v.toArray();
    a[axisIdx] = -a[axisIdx];
    return v3(a);
  };
  const flipP = (v) => {
    const a = v.toArray();
    a[axisIdx] = 2 * planeOffsetMm - a[axisIdx];
    return v3(a);
  };
  // Whether a mirrored copy's spot axis points the mirror of the source's (true) or the other way
  const axisKept = (srcId, dstId, localAxis) => {
    const src = byId.get(srcId);
    const dst = byId.get(dstId);
    const qs = new THREE.Quaternion().setFromRotationMatrix(instanceMatrix(src));
    const qd = new THREE.Quaternion().setFromRotationMatrix(instanceMatrix(dst));
    return flipV(v3(localAxis).applyQuaternion(qs)).dot(v3(localAxis).applyQuaternion(qd)) > 0;
  };
  const ends = [];
  for (const e of shape.ends) {
    if (!e) {
      ends.push(null);
      continue;
    }
    const id = idMap.get(e.instanceId);
    if (!id || !byId.get(id)) return null;
    const out = { ...e, instanceId: id };
    if (Number.isFinite(e.at)) {
      const part = partOf(byId.get(e.instanceId));
      const place = endPlaces(part).find((p) => p.feature === e.feature);
      if (place && !axisKept(e.instanceId, id, place.axis)) out.at = -e.at;
    }
    ends.push(out);
  }
  const via = [];
  for (const s of shape.via || []) {
    const id = idMap.get(s.instanceId);
    const src = byId.get(s.instanceId);
    const dst = byId.get(id);
    if (!id || !src || !dst) return null;
    const entry = { ...s, instanceId: id };
    delete entry.h;
    if (isWrapEntry(s) || Array.isArray(s.wrap)) {
      const ms = instanceMatrix(src);
      const mdInv = instanceMatrix(dst).invert();
      if (Array.isArray(s.line)) entry.line = s.line.map((p) => flipP(v3(p).applyMatrix4(ms)).applyMatrix4(mdInv).toArray().map(r3));
      if (Array.isArray(s.wrap)) {
        const qs = new THREE.Quaternion().setFromRotationMatrix(ms);
        const qd = new THREE.Quaternion().setFromRotationMatrix(instanceMatrix(dst)).invert();
        entry.wrap = flipV(v3(s.wrap).applyQuaternion(qs)).applyQuaternion(qd).toArray().map(r4);
      }
    } else if (s.turn) {
      const spot = spotByFeature(partOf(src), s.feature);
      if (spot) entry.turn = axisKept(s.instanceId, id, spot.axis) ? -s.turn : s.turn;
    }
    via.push(entry);
  }
  // The spool winds the mirrored way unless its axis came out reversed
  let spool = shape.spool ? { ...shape.spool } : null;
  if (spool) {
    const se = shape.ends[spool.end];
    const sp = spoolSpec(partOf(byId.get(se.instanceId)));
    spool.winding = sp && axisKept(se.instanceId, idMap.get(se.instanceId), sp.axis) ? -spool.winding : spool.winding;
  }
  return { ends, via, spool };
}

/**
 * Where a rope can go on the given copies (world), for listing and picking: end places (posts and
 * spool pockets) and spots (grooves, posts, edges; a spool's drum).
 * Returns { ends: [{ instanceId, label, feature, kind, name, center, axis, taken? }], spots: [...] }.
 */
export function ropePlacesOn(instances, ids, partOf) {
  const ends = [];
  const spots = [];
  const takenPockets = new Set();
  for (const inst of instances) {
    if (!isRoutedRope(inst)) continue;
    for (const e of inst.shape.ends) if (e?.feature === 'pocket') takenPockets.add(e.instanceId);
  }
  for (const inst of instances) {
    if (!ids.includes(inst.instanceId) || inst.visible === false || isRoutedRope(inst)) continue;
    const part = partOf(inst);
    if (!part) continue;
    const m = instanceMatrix(inst);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const world = (s) => ({ center: v3(s.center).applyMatrix4(m).toArray().map(r3), axis: v3(s.axis).applyQuaternion(q).normalize().toArray().map(r4) });
    for (const p of endPlaces(part)) {
      if (p.kind === 'pocket' && takenPockets.has(inst.instanceId)) continue;
      ends.push({ instanceId: inst.instanceId, label: inst.label, feature: p.feature, kind: p.kind, name: p.label, ...world(p) });
    }
    for (const s of partSpots(part)) {
      if (s.hidden || s.kind === 'gap' || s.kind === 'gaphook' || s.kind === 'rim' || s.kind === 'hook') continue;
      spots.push({ instanceId: inst.instanceId, label: inst.label, feature: s.feature, kind: s.kind, name: s.label, ...world(s), ...(s.radius ? { radius: s.grooveRadiusMm || s.radius } : {}) });
    }
    if (isSpoolPart(part)) {
      const d = drumSpot(part);
      spots.push({ instanceId: inst.instanceId, label: inst.label, feature: 'drum', kind: 'drum', name: 'drum', ...world(d), radius: d.radius });
    }
  }
  return { ends, spots };
}

/**
 * The places a rope can take near a point on one copy (the Rope builder's picking), nearest first: a
 * spool's pocket (when the pointer is on the spool), its posts, grooves and edges. Not tooth gaps or
 * rims. Same form as spotsNearPoint: [{ instanceId, feature, kind, label, spot (world), dist, height }].
 */
export function ropeSpotsNearPoint(inst, part, point, maxMm = 8) {
  const out = spotsNearPoint(inst, part, point, maxMm).filter((s) => !['gap', 'gaphook', 'rim', 'hook'].includes(s.kind)).map((s) => (s.kind === 'groove' && s.spot && Number.isFinite(s.spot.grooveRadiusMm) ? { ...s, label: 'groove', spot: { ...s.spot, radius: s.spot.grooveRadiusMm } } : s));
  const spool = spoolSpec(part);
  if (spool) {
    const m = instanceMatrix(inst);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const axis = v3(spool.axis).applyQuaternion(q).normalize();
    const centre = v3(spool.pocket.center).applyMatrix4(m);
    const p = point.isVector3 ? point : v3(point);
    const d = p.clone().sub(new THREE.Vector3().setFromMatrixPosition(m));
    const radial = d.clone().addScaledVector(axis, -d.dot(axis)).length();
    if (radial <= spool.flangeRadiusMm + maxMm) out.unshift({ instanceId: inst.instanceId, feature: 'pocket', kind: 'pocket', label: 'spool pocket', spot: { feature: 'pocket', kind: 'pocket', shape: 'circle', center: centre, axis, radius: spool.flangeRadiusMm, span: [0, 0] }, dist: 0, height: 0 });
  }
  return out;
}
