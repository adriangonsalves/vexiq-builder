/**
 * Placing and routing bands in the engine (openspec rubber-bands): the `place_band` action shared by
 * the app's engine worker, the dev bridge and the MCP server. The pure parts (spots, path, stringing
 * a band, following parts) are in src/utils/bandPath.js and src/utils/bandRoute.js; this adds the
 * build's meshes: which parts a band's runs would pass through, and the routes between two spots.
 */
import * as THREE from 'three';
import { buildWorldMatrix, checkCandidateCollision, findPart, getCatalog, getPartCollisionBvh, getPartDeepCollisionBvh, partOf } from './core.js';
import { BAND_SPECS, bandSpec, isBandPart, partSpots, spotByFeature, worldSpot } from '../utils/bandPath.js';
import { bandRefs, instanceMatrix, isRoutedBand, spotsOn, stringBand } from '../utils/bandRoute.js';
import { stretchState } from '../sim/bandStrength.js';
import { bandOverlaps } from './bandFit.js';
import { cornerKeysFacing, routeHalf, sideKeys } from './bandStrand.js';

const MAX_IN_WAY_ROUNDS = 12;
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const isGearLike = (part) => Boolean(part?.gearSpecs?.teeth && part.gearSpecs.tipRadiusMm && part.gearSpecs.rootRadiusMm);

/**
 * Parts a band's straight runs pass through: parts not on its route (and, with `checkRoute`, its own
 * route's parts too, against their slightly shrunk "deep" mesh, so a run that only lies against a
 * part it wraps doesn't count; gears on the route are left out, a run in a tooth gap is inside their
 * outline). Returns [{ instanceId, label, at, run, gear, onRoute }].
 */
export function partsInWay(contacts, instances, routeIds, { ignore = new Set(), checkRoute = false, allRuns = false, widthMm = 0 } = {}) {
  // Each run as its middle line and, for a wide band, both edges of the strip (the band lies flat on
  // the spot it leaves, its width along that spot's axis)
  const runs = [];
  contacts.forEach((c, i) => {
    const a = v3(c.b);
    const b = v3(contacts[(i + 1) % contacts.length].a);
    if (a.distanceTo(b) <= 0.5) return;
    runs.push([a, b, i]);
    if (widthMm > 2 && c.axis) {
      const dir = b.clone().sub(a).normalize();
      const up = v3(c.axis).addScaledVector(dir, -v3(c.axis).dot(dir));
      if (up.lengthSq() > 1e-6) {
        up.normalize().multiplyScalar(widthMm / 2 - 0.4);
        runs.push([a.clone().add(up), b.clone().add(up), i, true], [a.clone().sub(up), b.clone().sub(up), i, true]);
      }
    }
  });
  if (!runs.length) return [];
  const box = new THREE.Box3();
  for (const [a, b] of runs) box.expandByPoint(a).expandByPoint(b);
  const hits = [];
  const ray = new THREE.Ray();
  for (const inst of instances) {
    if (inst.visible === false || ignore.has(inst.instanceId) || isRoutedBand(inst)) continue;
    const onRoute = routeIds.has(inst.instanceId);
    if (onRoute && !checkRoute) continue;
    const part = partOf(inst);
    if (!part?.bbox || isBandPart(part)) continue;
    if (onRoute && isGearLike(part)) continue;
    const m = buildWorldMatrix(inst.position, inst.rotation);
    const wbox = new THREE.Box3(v3(part.bbox.min), v3(part.bbox.max)).applyMatrix4(m);
    if (!wbox.intersectsBox(box)) continue;
    let pieces;
    try {
      const got = onRoute ? getPartDeepCollisionBvh(part) : getPartCollisionBvh(part);
      pieces = (Array.isArray(got) ? got : got?.pieces || [got]).map((p) => p?.geo || p).filter((g) => g?.boundsTree);
    } catch {
      continue;
    }
    if (!pieces.length) continue;
    const inv = m.clone().invert();
    for (const [a, b, runIndex, edge] of runs) {
      // A band's width may hang over the end of a spot it's on: its edges are only checked against
      // other parts
      if (edge && onRoute) continue;
      if (!wbox.intersectsBox(new THREE.Box3().setFromPoints([a, b]))) continue;
      const la = a.clone().applyMatrix4(inv);
      const lb = b.clone().applyMatrix4(inv);
      // From just past each end, both ways: an end that starts against a part's face (a standoff on
      // a sprocket) doesn't hide the part the run then passes through
      const len = la.distanceTo(lb);
      const dir = lb.clone().sub(la).normalize();
      let hit = null;
      for (const [o, d] of [
        [la.clone().addScaledVector(dir, 0.6), dir],
        [lb.clone().addScaledVector(dir, -0.6), dir.clone().negate()]
      ]) {
        ray.origin.copy(o);
        ray.direction.copy(d);
        const h = pieces.map((g) => g.boundsTree.raycastFirst(ray, THREE.DoubleSide)).filter(Boolean).sort((x, y) => x.distance - y.distance)[0];
        if (h && h.distance < len - 1.2) {
          hit = h;
          break;
        }
      }
      if (hit) {
        hits.push({ instanceId: inst.instanceId, label: inst.label || part.name, at: hit.point.clone().applyMatrix4(m), run: runIndex, gear: isGearLike(part), onRoute });
        if (!allRuns) break;
      }
    }
  }
  return hits;
}

/** A fold: the band goes out over a half and comes back over its middle spots in reverse (A, B, C, D -> A, B, C, D, C, B). */
export function foldOf(half) {
  return [...half, ...half.slice(1, -1).reverse().map((s) => ({ ...s }))];
}
/** Kept for callers of the old name. */
export const sameWayBack = foldOf;

const HOOK_KINDS = new Set(['post', 'groove', 'rim', 'gap', 'gaphook', 'hook']);

/**
 * Which spots of a route the band is looped on (hooks) and which it only bends round on the way
 * (guides, the edges): the first and last are always hooks. Returns { hooks: [index], guides: [index] }.
 */
export function hooksAndGuides(route, state) {
  const hooks = [];
  const guides = [];
  route.forEach((s, i) => {
    if (i === 0 || i === route.length - 1) return hooks.push(i);
    const inst = state.instances.find((x) => x.instanceId === s.instanceId);
    const spot = inst ? spotByFeature(partOf(inst), s.feature) : null;
    (spot && !HOOK_KINDS.has(spot.kind) ? guides : hooks).push(i);
  });
  return { hooks, guides };
}

/** Whether a route is strung as a fold (there and back) for `back` ('auto' | 'same' | 'straight'). */
export function isFold(route, state, back = 'auto') {
  if (back === 'same') return route.length >= 2;
  if (back === 'straight') return false;
  return route.length >= 2 && hooksAndGuides(route, state).hooks.length === 2;
}

/** A new or existing band copy for `params` (bandPartId / bandPartQuery for a new one, instanceId for one placed). */
function bandCopy(state, params) {
  if (params.instanceId) {
    const inst = state.instances.find((i) => i.instanceId === params.instanceId);
    if (!inst) return { error: `No part ${params.instanceId}.` };
    const was = partOf({ ...inst, shape: undefined });
    if (!isBandPart(was)) return { error: `${inst.label} isn't a rubber band or belt.` };
    // A new size for a placed band: its part, and its colour when it still had the old size's colour
    const next = params.bandPartId || params.bandPartQuery ? findPart(params.bandPartId || params.bandPartQuery) : null;
    if (next && next.id !== was.id) {
      if (!isBandPart(next)) return { error: `${next.name} isn't a rubber band or belt.` };
      const keepColour = inst.color && inst.color.toLowerCase() !== String(was.defaultColor || '').toLowerCase();
      // Renamed too while its label is still a band size's name (not one the user gave it)
      const relabel = !inst.label || getCatalog().catalog.some((p) => isBandPart(p) && inst.label.startsWith(p.name));
      return { inst: { ...inst, partId: next.id, color: keepColour ? inst.color : next.defaultColor, label: relabel ? next.name : inst.label }, isNew: false };
    }
    return { inst, isNew: false };
  }
  const part = findPart(params.bandPartId || params.bandPartQuery || '');
  if (!part) return { error: 'Give a band or belt part (bandPartId) or a placed band (instanceId).' };
  if (!isBandPart(part)) return { error: `${part.name} isn't a rubber band or belt.` };
  const inst = {
    instanceId: `inst-band-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    partId: part.id,
    label: params.label || part.name,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    color: params.color || part.defaultColor,
    visible: true,
    locked: false
  };
  return { inst, isNew: true };
}

/** A route entry from what a caller gives (a feature, or `gap:<k>`, with side, wraps, height, cross). */
function routeEntry(s) {
  return {
    instanceId: s.instanceId,
    feature: String(s.feature ?? ''),
    side: s.side === 'in' || s.side === 'inside' ? 'in' : 'out',
    wraps: Math.max(1, Math.min(3, Math.round(Number(s.wraps) || 1))),
    ...(Number.isFinite(Number(s.height)) && s.height !== null && s.height !== undefined ? { height: Number(s.height) } : {}),
    ...(s.cross ? { cross: true } : {}),
    ...(Array.isArray(s.wrap) ? { wrap: s.wrap } : {}),
    ...(Array.isArray(s.line) ? { line: s.line } : {}),
    ...(s.auto ? { auto: true } : {})
  };
}

/** The label of a spot for messages: "<part label> <spot name>". */
function spotName(state, s) {
  const inst = state.instances.find((i) => i.instanceId === s.instanceId);
  const spot = inst ? spotByFeature(partOf(inst), s.feature) : null;
  return `${inst?.label || s.instanceId}${spot ? ` ${spot.label}` : ''}`;
}

/**
 * Parts the band's real strip overlaps (its mesh against theirs, as the overlap check does), each with
 * the run it lies nearest and the point of that run nearest the part. Parts on the route and bands on
 * its spots don't count (checkCandidateCollision skips them).
 */
function stripHits(bandInst, strungNow, route, instances) {
  const band = { ...bandInst, position: strungNow.position, rotation: strungNow.rotation, shape: strungNow.shape };
  const others = instances.filter((i) => i.instanceId !== bandInst.instanceId);
  // The band rule against parts off the route (runs through the route's own parts are found by rays)
  const onRoute = new Set(route.map((s) => s.instanceId));
  const only = new Set(others.filter((i) => !onRoute.has(i.instanceId)).map((i) => i.instanceId));
  let over;
  try {
    over = bandOverlaps(band, others, { only });
  } catch {
    return [];
  }
  const c = strungNow.contacts;
  return over.map((x) => {
    const inst = instances.find((i) => i.instanceId === x.instanceId);
    const centre = v3(inst.position);
    let best = { run: 0, at: v3(c[0].b), d: Infinity };
    c.forEach((ci, i) => {
      const line = new THREE.Line3(v3(ci.b), v3(c[(i + 1) % c.length].a));
      const at = line.closestPointToPoint(centre, true, new THREE.Vector3());
      const d = at.distanceTo(centre);
      if (d < best.d) best = { run: i, at, d };
    });
    return { instanceId: x.instanceId, label: x.label, at: best.at, run: best.run, gear: isGearLike(partOf(inst)), onRoute: false };
  });
}

/**
 * place_band: strings a band (new or placed) round `spots` ([{ instanceId, feature, side, wraps,
 * height, cross }], in loop order). Runs that would cut through a gear's or sprocket's web go
 * through the nearest gap instead; other parts in a run's way need an answer in `inWay`
 * ({ [instanceId]: 'over' | 'under' }, over meaning round its far side from the loop's middle),
 * else `needsRoute` lists them and nothing changes. With `list`, or fewer than two spots, nothing
 * changes and the reply lists the spots on and near the named parts, and with two spots, the routes
 * between them.
 */
export function placeBand(state, params = {}) {
  const got = bandCopy(state, params);
  if (got.error) return { ok: false, error: got.error };
  const part = partOf({ ...got.inst, shape: undefined });
  const spec = bandSpec(part);
  const picks = (Array.isArray(params.spots) ? params.spots : []).map(routeEntry);
  if (params.cross === true && picks.length) picks[0].cross = true;
  for (const s of picks) {
    const inst = state.instances.find((i) => i.instanceId === s.instanceId);
    if (!inst) return { ok: false, error: `No part ${s.instanceId}.` };
    if (s.feature === 'wrap' && Array.isArray(s.line)) continue;
    if (!spotByFeature(partOf(inst), s.feature)) {
      const features = partSpots(partOf(inst)).filter((x) => x.kind !== 'gaphook' && !x.hidden).map((x) => x.feature);
      return { ok: false, error: `${inst.label} has no spot "${s.feature}". Its spots: ${features.slice(0, 40).join(', ')}${features.length > 40 ? ', …' : ''}` };
    }
  }
  if (params.list || picks.length < 2) {
    const ids = [...new Set(picks.map((s) => s.instanceId).concat(Array.isArray(params.near) ? params.near : []))];
    return { ok: true, spots: spotsNear(state, ids, spec), routes: picks.length >= 2 ? waysRound(state, params) : [] };
  }
  // How the band comes back: a band on two hooks (with only edges between) goes there and back over
  // the same spots; three or more hooks make a loop. `back` forces one.
  // (an imported band's spots are its whole route already: straight unless told otherwise)
  const back = params.back === 'same' || params.back === 'straight' ? params.back : params.ignoreInWay ? 'straight' : 'auto';
  const fold = isFold(picks, state, back);
  const meta = { picks, back };
  const route = fold ? foldOf(picks) : picks;

  // String it (an imported band, whose route VEX's CAD gives, only lists the parts in its way:
  // `ignoreInWay`)
  const inWay = params.inWay && typeof params.inWay === 'object' ? params.inWay : {};
  const string = (list) => stringBand(got.inst, list, state.instances, partOf, meta);
  if (params.ignoreInWay) {
    const strungAsIs = string(route);
    if (strungAsIs.error) return { ok: false, error: strungAsIs.error };
    const hits = partsInWay(strungAsIs.contacts, state.instances, new Set(route.map((s) => s.instanceId)), { ignore: new Set([got.inst.instanceId]) });
    return finishPlace(state, got, spec, route, route, strungAsIs, hits.map((h) => h.label));
  }
  const whole = (list) => (fold ? foldOf(list) : list);
  const firstTry = string(whole(picks));
  if (firstTry.error) return { ok: false, error: firstTry.error };

  // 1. Each stretch from one hook to the next takes the shortest clear way round the parts between,
  //    bending on their real corners, through the edges clicked in it (src/engine/bandStrand.js).
  //    An answer in `inWay` keeps a part's bends to one side of the loop.
  const { hooks } = hooksAndGuides(picks, state);
  const centre = firstTry.contacts.reduce((sum, c) => sum.add(v3(c.a)), new THREE.Vector3()).divideScalar(firstTry.contacts.length);
  const banned = new Set();
  for (const [id, answer] of Object.entries(inWay)) {
    const inst = state.instances.find((i) => i.instanceId === id);
    if (inst) for (const k of cornerKeysFacing(inst, centre, answer === 'over' || answer === 'out')) banned.add(k);
  }
  const stretches = hooks.slice(0, -1).map((h, k) => [h, hooks[k + 1]]);
  if (!fold && hooks.length >= 2) stretches.push([hooks[hooks.length - 1], null]); // the loop's last stretch, back to the first
  const routeAll = (ban) => {
    let list = [picks[0]];
    const blockedBy = [];
    for (const [from, to] of stretches) {
      const A = picks[from];
      const B = to === null ? picks[0] : picks[to];
      const guides = to === null ? picks.slice(from + 1) : picks.slice(from + 1, to);
      const res = routeHalf(state, got.inst, A, B, { guides, banned: ban, fold: true });
      if (res.error) return { error: res.error };
      if (res.blockedBy) blockedBy.push(...res.blockedBy);
      // Bends found replace the clicked edges; if none were needed, the clicked edges stay
      const middle = res.bends?.length ? res.bends : guides;
      list = list.concat(middle, to === null ? [] : [B]);
    }
    return { list, blockedBy };
  };
  // Other ways round (`alternative` k, 0 to 3): each next way may not bend on the side of the part
  // where an earlier way first bent
  const want = Math.max(0, Math.min(3, Math.round(Number(params.alternative) || 0)));
  const answers = [];
  const ban = new Set(banned);
  const signature = (list) => list.filter((x) => x.feature === 'wrap').map((x) => `${x.instanceId}|${x.line.flat().join(',')}`).join(';');
  let firstBlocked = null;
  for (let k = 0; k < 4 && (answers.length <= want || (params.dryRun && answers.length < 4) || (params.list && answers.length < 4)); k++) {
    const res = routeAll(ban);
    if (res.error) return { ok: false, error: res.error };
    if (res.blockedBy.length) {
      if (!answers.length) firstBlocked = res.blockedBy;
      break;
    }
    if (answers.some((x) => signature(x) === signature(res.list))) break;
    answers.push(res.list);
    const firstBend = res.list.find((x) => x.feature === 'wrap');
    if (!firstBend) break; // straight: no other way round
    const inst = state.instances.find((i) => i.instanceId === firstBend.instanceId);
    for (const key of sideKeys(inst, firstBend)) ban.add(key);
  }
  if (!answers.length) {
    const unique = [...new Map((firstBlocked || []).map((b) => [b.instanceId, b])).values()];
    return {
      ok: false,
      error: `The band would pass through ${unique.map((b) => b.label).join(', ')} and can't find a way round: pick a spot it goes round, or say whether it goes over or under ${unique.length > 1 ? 'each' : 'it'}.`,
      needsRoute: unique
    };
  }
  let current = answers[Math.min(want, answers.length - 1)];
  // 2. Runs that still cut through a gear's or sprocket's web go through the gap that keeps the band
  //    shortest (in a fold, on both halves)
  const ignore = new Set([got.inst.instanceId]);
  const gearHits = (strungNow, list) => partsInWay(strungNow.contacts, state.instances, new Set(list.map((s) => s.instanceId)), { ignore, checkRoute: true, allRuns: true, widthMm: spec.widthMm }).filter((h) => h.gear);
  const insertFor = (run) => (entry) => {
    if (!fold) return [...current.slice(0, run + 1), entry, ...current.slice(run + 1)];
    const n = current.length;
    const outRun = run < n - 1 ? run : 2 * n - 3 - run; // run i of the way back is run 2n-3-i of the way out
    return [...current.slice(0, outRun + 1), entry, ...current.slice(outRun + 1)];
  };
  let strung = string(whole(current));
  if (strung.error) return { ok: false, error: strung.error };
  for (let round = 0; round < MAX_IN_WAY_ROUNDS; round++) {
    const h = gearHits(strung, whole(current))[0];
    if (!h) break;
    const inst = state.instances.find((i) => i.instanceId === h.instanceId);
    const insert = insertFor(h.run);
    let best = null;
    for (const sp of partSpots(partOf(inst))) {
      if (sp.kind !== 'gap') continue;
      const tryList = insert({ instanceId: h.instanceId, feature: sp.feature, side: 'out', wraps: 1 });
      const t = string(whole(tryList));
      if (!t.error && (!best || t.lengthMm < best.len)) best = { list: tryList, len: t.lengthMm, t };
    }
    if (!best) return { ok: false, error: `The band would pass through ${h.label} and no gap takes it.`, needsRoute: [{ instanceId: h.instanceId, label: h.label }] };
    current = best.list;
    strung = best.t;
  }
  current = whole(current);
  const isAdded = (s) => !picks.includes(s);
  // A band too long for its route would hang loose: not placed unless asked (an import's isn't refused)
  const slack = strung.stretch < 1;
  if (slack && !params.allowSlack && !params.dryRun) {
    const sug = strung.suggestion;
    return {
      ok: false,
      slack: true,
      error: `A ${spec.name} is ${Math.round(spec.freeMm)} mm and this route is ${Math.round(strung.lengthMm)} mm: it would hang loose.${sug ? ` A ${sug.name} would be ${sug.stretch.toFixed(2)}×.` : ''}`,
      suggestion: sug,
      stretch: Number(strung.stretch.toFixed(3)),
      lengthMm: Number(strung.lengthMm.toFixed(1))
    };
  }
  if (params.dryRun) {
    const pts = strung.shape.path.points.map((p) => p.map((c, k) => Number((c + strung.position[k]).toFixed(2))));
    return { ok: true, dryRun: true, points: pts, route: current, stretch: Number(strung.stretch.toFixed(3)), stretchState: strung.state, pullN: Number(strung.pullN.toFixed(2)), lengthMm: Number(strung.lengthMm.toFixed(1)), addedInWay: [...new Map(current.filter(isAdded).map((x) => [`${x.instanceId}|${x.feature}`, x])).values()], fold, slack, suggestion: strung.suggestion, alternatives: answers.length, alternative: Math.min(want, answers.length - 1) };
  }

  return finishPlace(state, got, spec, picks, current, strung, []);
}

/** The band strung: the new state, the history step's label and the reply. */
function finishPlace(state, got, spec, route, current, strung, passesThrough) {
  const band = { ...got.inst, position: strung.position, rotation: strung.rotation, shape: strung.shape };
  band.isIntersecting = bandOverlaps(band, state.instances.filter((i) => i.instanceId !== band.instanceId)).length > 0;
  const instances = got.isNew ? [...state.instances, band] : state.instances.map((i) => (i.instanceId === band.instanceId ? band : i));
  const names = [...new Map(current.map((s) => [`${s.instanceId}|${s.feature}`, spotName(state, s)])).values()];
  const label = `Band: ${spec.name} round ${names.length} spot${names.length === 1 ? '' : 's'} (${names.join(', ')})`;
  const added = [...new Map(current.filter((s) => !route.some((r) => r.instanceId === s.instanceId && r.feature === s.feature)).map((s) => [`${s.instanceId}|${s.feature}`, s])).values()];
  return {
    ok: true,
    state: { ...state, instances, selectedId: band.instanceId, selectedIds: [band.instanceId], updatedAt: new Date().toISOString() },
    instanceId: band.instanceId,
    record: true,
    stepLabel: label,
    message: `${label}: ${strung.stretch.toFixed(2)}× (${strung.state}), ${strung.pullN.toFixed(1)} N.${added.length ? ` Also round ${added.map((s) => spotName(state, s)).join(', ')}, in the way.` : ''}${strung.suggestion && (strung.state === 'slack' || strung.state === 'too far') ? ` A ${strung.suggestion.name} would be ${strung.suggestion.stretch.toFixed(2)}×.` : ''}`,
    lengthMm: Number(strung.lengthMm.toFixed(1)),
    freeMm: strung.freeMm,
    stretch: Number(strung.stretch.toFixed(3)),
    stretchState: strung.state,
    pullN: Number(strung.pullN.toFixed(2)),
    suggestion: strung.suggestion,
    route: band.shape.route,
    addedInWay: added,
    ...(passesThrough.length ? { passesThrough } : {})
  };
}

/** Spots on the named parts and on parts within reach of them (a band at 3× spans 1.5× its free length). */
function spotsNear(state, ids, spec) {
  const named = state.instances.filter((i) => ids.includes(i.instanceId));
  if (!named.length) return [];
  const reach = (spec?.freeMm || 150) * 1.5;
  const box = new THREE.Box3();
  for (const inst of named) box.expandByPoint(v3(inst.position));
  box.expandByScalar(reach);
  const near = state.instances.filter((i) => i.visible !== false && !isRoutedBand(i) && box.containsPoint(v3(i.position))).map((i) => i.instanceId);
  const all = spotsOn(state.instances, [...new Set([...ids, ...near])], partOf).filter((s) => s.kind !== 'gaphook' || ids.includes(s.instanceId));
  // The named parts' spots first, then the nearest others
  const c = box.getCenter(new THREE.Vector3());
  return all
    .sort((a, b) => Number(!ids.includes(a.instanceId)) - Number(!ids.includes(b.instanceId)) || v3(a.center).distanceTo(c) - v3(b.center).distanceTo(c))
    .slice(0, 300);
}

/**
 * The ways round for a band's spots (place_band with `list`): the shortest, then up to three others
 * (Other way round), each named by the parts it bends round, with its stretch:
 * [{ name, alternative, spots, route, stretch, state }].
 */
function waysRound(state, params) {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const r = placeBand(state, { ...params, list: false, dryRun: true, alternative: k });
    if (!r.ok || r.alternative !== k) break;
    // Named by the parts bent round and the side: over (the bends face up), under (down) or round
    const bends = r.route.filter((x) => x.feature === 'wrap');
    const parts = [...new Set(bends.map((x) => state.instances.find((i) => i.instanceId === x.instanceId)?.label || x.instanceId))];
    const up = bends.reduce((sum, x) => {
      const inst = state.instances.find((i) => i.instanceId === x.instanceId);
      return inst && Array.isArray(x.wrap) ? sum + v3(x.wrap).applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(instanceMatrix(inst))).y : sum;
    }, 0) / (bends.length || 1);
    const how = up > 0.3 ? 'over' : up < -0.3 ? 'under' : 'round';
    out.push({ name: `${parts.length ? `${how} ${parts.join(', ')}` : 'straight'}, ${r.stretch.toFixed(1)}×`, alternative: k, spots: params.spots, route: r.route, stretch: r.stretch, state: r.stretchState });
    if (k + 1 >= r.alternatives) break;
  }
  return out;
}

/**
 * Bands routed again where their parts moved so the route no longer fits (openspec rubber-bands,
 * 9.14): a band the user strung (it has `shape.picks`) is placed again from the user's spots, and
 * the new route kept when the old one now overlaps a part or the new one is shorter (a corner it bent
 * round has moved out of its way). Returns the
 * instances (the same array when none changed) and the ids routed again.
 */
export function rerouteBands(instances, ids = null) {
  let out = instances;
  const changed = [];
  for (const band of instances) {
    if (!isRoutedBand(band) || !band.shape.picks || (ids && !ids.includes(band.instanceId))) continue;
    const others = out.filter((i) => i.instanceId !== band.instanceId);
    const overlaps = bandOverlaps(band, others).length > 0;
    // Only a band with bends of its own can be routed better by itself; one that overlaps always tries
    if (!overlaps && !band.shape.route.some((s) => s.auto)) continue;
    const r = placeBand({ instances: out }, { instanceId: band.instanceId, spots: band.shape.picks, back: band.shape.back || 'auto', allowSlack: true });
    if (!r.ok) continue;
    const placedBand = r.state.instances.find((i) => i.instanceId === band.instanceId);
    // Kept when the old route overlaps, or the new one is shorter (a corner moved out of the way)
    if (!overlaps && !(placedBand.shape.path.lengthMm < (band.shape.path?.lengthMm ?? Infinity) - 1)) continue;
    out = out.map((i) => (i.instanceId === band.instanceId ? placedBand : i));
    changed.push(band.instanceId);
  }
  return { instances: out, changed };
}

export { BAND_SPECS, stretchState, getCatalog };
