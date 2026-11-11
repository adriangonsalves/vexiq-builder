/**
 * One half of a band, from one hook to the next, taking the shortest clear way round the parts
 * between as a tight string would (openspec rubber-bands, design decision 11, stage B).
 *
 * 1. String the half straight; gather the parts its run passes through.
 * 2. Take those parts' outer corners (src/engine/bandHull.js), as points just off each corner.
 * 3. Find the shortest chain of points from hook to hook whose straight joins clear every gathered
 *    part (A*, joins tested only when reached). Clicked edges (guides) are passed on the way.
 * 4. Each point becomes a bend round its corner (a `wrap` route entry carrying the corner), and the
 *    path solver slides each bend along its corner to the shortest band.
 * 5. Bends the band no longer presses on are dropped; parts the band now meets are gathered and the
 *    search runs again, within limits (rounds, bends, stretch, time).
 */
import * as THREE from 'three';
import { buildWorldMatrix, getPartCollisionBvh, partOf } from './core.js';
import { partHull, partWrapEdges } from './bandHull.js';
import { bandSpec, isBandPart, partSpots, worldSpot } from '../utils/bandPath.js';
import { instanceMatrix, isRoutedBand, stringBand } from '../utils/bandRoute.js';
import { bandOverlaps } from './bandFit.js';

export const STRAND_LIMITS = { rounds: 8, bends: 8, stretch: 3, ms: 300 };
const MAX_BEND_DEG = 135; // the most a band turns round one corner of a part
const NEAR_MM = 30; // how far round the hooks to look for parts when no way round is found
const v3 = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));
const r3 = (n) => Number(n.toFixed(3)) + 0;

/** The meshes and pose of a part, for clear-line tests (cached per call). */
function solidOf(inst, cache) {
  if (cache.has(inst.instanceId)) return cache.get(inst.instanceId);
  const part = partOf(inst);
  let pieces = [];
  try {
    const got = getPartCollisionBvh(part);
    pieces = (Array.isArray(got) ? got : got?.pieces || [got]).map((g) => g?.geo || g).filter((g) => g?.boundsTree);
  } catch {
    pieces = [];
  }
  const m = buildWorldMatrix(inst.position, inst.rotation);
  const box = part?.bbox ? new THREE.Box3(v3(part.bbox.min), v3(part.bbox.max)).applyMatrix4(m) : null;
  const solid = { inst, part, pieces, m, inv: m.clone().invert(), box, hull: part?.gearSpecs?.teeth ? null : partHull(part) };
  cache.set(inst.instanceId, solid);
  return solid;
}

const ray = new THREE.Ray();

/** Whether a point lies inside a convex hull grown by `grow` mm (its face planes moved out). */
function insideGrown(hull, p, grow) {
  for (const f of hull.faces) if (f.normal.dot(p) - f.constant > grow) return false;
  return true;
}

/**
 * Whether the segment a→b passes through a convex hull grown by `grow` mm: the segment clipped by
 * every face plane moved out by `grow`, with something left over (not counting `endMm` at each end).
 */
function segmentHitsGrown(hull, a, b, grow, endMm = 0.05) {
  const d = b.clone().sub(a);
  const len = d.length();
  if (len < 1e-6) return false;
  let tNear = endMm / len;
  let tFar = 1 - endMm / len;
  if (tNear >= tFar) return false;
  for (const f of hull.faces) {
    const num = f.constant + grow - f.normal.dot(a);
    const den = f.normal.dot(d);
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return false;
      continue;
    }
    const t = num / den;
    if (den < 0) tNear = Math.max(tNear, t);
    else tFar = Math.min(tFar, t);
    if (tNear > tFar) return false;
  }
  return true;
}

/**
 * Whether a band's middle line from p to q keeps clear of the solid. A band has thickness, and
 * can't thread a hole or a slit, so the line is tested against the part's outer shape (its convex
 * hull) grown by `grow` (about half the band's thickness): a gap between two parts thinner than the
 * band counts as closed. When an end lies inside that grown shape (a band leaving a post that stands
 * on the part), against the part's real mesh, by rays both ways as partsInWay casts them.
 */
function lineMisses(p, q, solid, grow = 0) {
  if (!solid.pieces.length || !solid.box) return true;
  if (!solid.box.clone().expandByScalar(grow).intersectsBox(new THREE.Box3().setFromPoints([p, q]))) return true;
  const a = p.clone().applyMatrix4(solid.inv);
  const b = q.clone().applyMatrix4(solid.inv);
  const len = a.distanceTo(b);
  if (len < 1e-6) return true;
  if (solid.hull && !insideGrown(solid.hull, a, grow) && !insideGrown(solid.hull, b, grow)) return !segmentHitsGrown(solid.hull, a, b, grow);
  const dir = b.clone().sub(a).divideScalar(len);
  for (const [o, d] of [
    [a, dir],
    [b, dir.clone().negate()]
  ]) {
    ray.origin.copy(o);
    ray.direction.copy(d);
    for (const g of solid.pieces) {
      const h = g.boundsTree.raycastFirst(ray, THREE.DoubleSide);
      if (h && h.distance < len - 0.05) return false;
    }
  }
  return true;
}

/** The parts (other than `skip`) the line p→q passes through or comes within `grow` mm of. */
function partsOnLine(p, q, instances, skip, cache, grow = 0) {
  const out = [];
  const seg = new THREE.Box3().setFromPoints([p, q]);
  for (const inst of instances) {
    if (skip.has(inst.instanceId) || inst.visible === false || isRoutedBand(inst)) continue;
    const part = partOf(inst);
    if (!part?.bbox || isBandPart(part) || part.gearSpecs?.teeth) continue;
    const box = new THREE.Box3(v3(part.bbox.min), v3(part.bbox.max)).applyMatrix4(buildWorldMatrix(inst.position, inst.rotation));
    if (!box.expandByScalar(grow).intersectsBox(seg)) continue;
    if (!lineMisses(p, q, solidOf(inst, cache), grow)) out.push(inst.instanceId);
  }
  return out;
}

/**
 * The corners of a part in the world: [{ key, a, b, out, local: { a, b, out } }]. Straight corners
 * from its hull; a part with none (a standoff in the way) gives the edges of its box.
 */
function cornersOf(inst, banned) {
  const part = partOf(inst);
  const m = instanceMatrix(inst);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  let list = partWrapEdges(part).filter((e) => e.a);
  if (!list.length && part?.bbox) {
    const c = v3(part.bbox.center);
    list = partSpots(part)
      .filter((s) => s.feature?.startsWith('box:'))
      .map((s) => {
        const ax = v3(s.axis);
        const mid = v3(s.center);
        const out = mid.clone().sub(c);
        out.addScaledVector(ax, -out.dot(ax)).normalize();
        return { a: mid.clone().addScaledVector(ax, s.span[0]).toArray(), b: mid.clone().addScaledVector(ax, s.span[1]).toArray(), out: out.toArray() };
      });
  }
  return list
    .map((e) => ({ key: `${inst.instanceId}|${e.a.join(',')}|${e.b.join(',')}`, instanceId: inst.instanceId, a: v3(e.a).applyMatrix4(m), b: v3(e.b).applyMatrix4(m), out: v3(e.out).applyQuaternion(q).normalize(), local: e }))
    .filter((e) => !banned.has(e.key));
}

/** Points just off a corner where the search may bend: its ends, its middle and its point nearest the hooks' line. */
function cornerPoints(corner, A, B, offMm) {
  const line = new THREE.Line3(corner.a, corner.b);
  const ab = new THREE.Line3(A, B);
  const at = [corner.a, corner.b, line.getCenter(new THREE.Vector3())];
  // The corner's point nearest the hooks' line (sampled), and nearest each hook
  let best = null;
  for (let k = 0; k <= 20; k++) {
    const p = ab.at(k / 20, new THREE.Vector3());
    const c = line.closestPointToPoint(p, true, new THREE.Vector3());
    const d = c.distanceTo(p);
    if (!best || d < best.d) best = { c, d };
  }
  at.push(best.c, line.closestPointToPoint(A, true, new THREE.Vector3()), line.closestPointToPoint(B, true, new THREE.Vector3()));
  const seen = [];
  return at
    .filter((p) => {
      if (seen.some((s) => s.distanceTo(p) < 2)) return false;
      seen.push(p);
      return true;
    })
    .map((p) => ({ p: p.clone().addScaledVector(corner.out, offMm), corner }));
}

/**
 * The shortest clear chain from A to B through `nodes` ([{ p, corner }]), each join clear of every
 * solid. Returns the nodes passed, in order, or null.
 */
function shortestChain(A, B, nodes, solids, deadline, grow = 0) {
  const all = [{ p: A }, ...nodes, { p: B }];
  const n = all.length;
  const goal = n - 1;
  const g = new Array(n).fill(Infinity);
  const prev = new Array(n).fill(-1);
  const closed = new Array(n).fill(false);
  const h = all.map((x) => x.p.distanceTo(B));
  const clearCache = new Map();
  const clear = (i, j) => {
    const k = i < j ? i * n + j : j * n + i;
    if (clearCache.has(k)) return clearCache.get(k);
    const ok = solids.every((s) => lineMisses(all[i].p, all[j].p, s, grow));
    clearCache.set(k, ok);
    return ok;
  };
  g[0] = 0;
  const open = new Set([0]);
  while (open.size) {
    if (Date.now() > deadline) return null;
    let i = -1;
    for (const k of open) if (i < 0 || g[k] + h[k] < g[i] + h[i]) i = k;
    open.delete(i);
    if (i === goal) break;
    closed[i] = true;
    // Nearest first, so a good chain is found before the far points are tested
    for (let j = 0; j < n; j++) {
      if (closed[j] || j === i) continue;
      const t = g[i] + all[i].p.distanceTo(all[j].p);
      if (t >= g[j]) continue;
      if (!clear(i, j)) continue;
      g[j] = t;
      prev[j] = i;
      open.add(j);
    }
  }
  if (!Number.isFinite(g[goal])) return null;
  const chain = [];
  for (let k = prev[goal]; k > 0; k = prev[k]) chain.unshift(all[k]);
  return chain;
}

/** A bend entry for a corner, in its part's frame. */
const bendEntry = (corner) => ({ instanceId: corner.instanceId, feature: 'wrap', line: [corner.local.a, corner.local.b], wrap: corner.local.out, side: 'out', wraps: 1, auto: true });

/**
 * One half of a band from hook `A` to hook `B` (route entries), round the parts between.
 * Options: `guides` (clicked edge entries the half must pass, in order), `banned` (corner keys not
 * to bend round), `fold` (the band comes back the same way: the whole fold is checked), `limits`.
 * Returns { bends: [route entries], lengthMm } or { blockedBy: [{ instanceId, label }] }.
 */
export function routeHalf(state, bandInst, A, B, { guides = [], banned: bannedIn = new Set(), fold = false, limits = STRAND_LIMITS } = {}) {
  const banned = new Set(bannedIn); // corners ruled out by the caller, and by this search
  const t0 = Date.now();
  const deadline = t0 + limits.ms;
  const part = partOf({ ...bandInst, shape: undefined });
  const spec = bandSpec(part) || { thickMm: 1.5, widthMm: 3, freeMm: 100 };
  const instances = state.instances.filter((i) => i.instanceId !== bandInst.instanceId);
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const cache = new Map();
  const hookIds = new Set([A.instanceId, B.instanceId]);
  const whole = (half) => (fold ? [...half, ...half.slice(1, -1).reverse().map((s) => ({ ...s }))] : half);
  // Where each hook holds the band: its post at the height the band sits
  const straight = stringBand(bandInst, whole([A, B]), instances, partOf);
  if (straight.error) return { error: straight.error };
  const hookPoint = (k) => {
    const e = straight.elements[k];
    return e.shape === 'slot' ? v3(straight.contacts[k].a) : v3(e.center).addScaledVector(v3(e.axis), straight.contacts[k].height);
  };
  const pA = hookPoint(0);
  const pB = hookPoint(1);
  // The band's middle keeps this clear of parts (half its thickness, less a little it can squash),
  // and bend points sit far enough off a corner to be clear of both its faces
  const grow = Math.max(0, spec.thickMm / 2 - 0.15);
  const offMm = (spec.thickMm / 2 + 0.3) * Math.SQRT2;
  // Guides: the corners of each clicked edge's part along that edge
  const guideSets = guides.map((gd) => {
    const inst = byId.get(gd.instanceId);
    const spot = inst ? partSpots(partOf(inst)).find((s) => s.feature === gd.feature) : null;
    if (!spot) return [];
    const w = worldSpot(spot, instanceMatrix(inst));
    return cornersOf(inst, banned).filter((c) => {
      const d = c.b.clone().sub(c.a).normalize();
      if (Math.abs(d.dot(w.axis)) < 0.99) return false;
      const mid = c.a.clone().add(c.b).multiplyScalar(0.5);
      const rel = mid.sub(w.center);
      const off = rel.addScaledVector(w.axis, -rel.dot(w.axis)).length();
      return Math.abs(off - (w.radius || 0)) <= 1.5;
    });
  });
  // Gathered parts: those the hooks' line passes through, and the guides' parts
  const gathered = new Set(partsOnLine(pA, pB, instances, hookIds, cache, grow));
  for (const gd of guides) gathered.add(gd.instanceId);
  let best = null;
  let widened = false;
  for (let round = 0; round < limits.rounds; round++) {
    if (Date.now() > deadline) break;
    const solids = [...gathered].map((id) => byId.get(id)).filter(Boolean).map((i) => solidOf(i, cache));
    const corners = [...gathered].flatMap((id) => (byId.get(id) ? cornersOf(byId.get(id), banned) : []));
    // Bend points inside another part, or nearer it than the band's half thickness (a slit between
    // two parts), can't be reached
    const reachable = (node) => solids.every((so) => !so.hull || so.inst.instanceId === node.corner.instanceId || !insideGrown(so.hull, node.p.clone().applyMatrix4(so.inv), grow));
    const pointsOf = (c, from, to) => cornerPoints(c, from, to, offMm).filter(reachable);
    if (globalThis.process?.env?.BAND_DEBUG) console.log('  round', round, 'parts', [...gathered].map((id) => byId.get(id)?.label).join(', '), 'corners', corners.length, 'ms', Date.now() - t0);
    // The chain through each guide in turn: A -> a guide corner -> ... -> B
    const legs = [pA, ...guideSets.map(() => null), pB];
    let chain = [];
    let at = pA;
    let ok = true;
    for (let gi = 0; gi <= guideSets.length; gi++) {
      const target = gi < guideSets.length ? null : pB;
      if (target) {
        const pts = corners.flatMap((c) => pointsOf(c, at, target));
        const leg = shortestChain(at, target, pts, solids, deadline, grow);
        if (!leg) {
          ok = false;
          break;
        }
        chain = chain.concat(leg);
      } else {
        // To the guide: the guide corner point that makes the shortest clear chain from here
        let bestLeg = null;
        for (const gc of guideSets[gi]) {
          for (const gp of pointsOf(gc, at, pB)) {
            const pts = corners.flatMap((c) => pointsOf(c, at, gp.p));
            const leg = shortestChain(at, gp.p, pts, solids, deadline, grow);
            if (!leg) continue;
            const len = [at, ...leg.map((x) => x.p), gp.p].reduce((s, p, k, arr) => (k ? s + p.distanceTo(arr[k - 1]) : 0), 0) + gp.p.distanceTo(pB);
            if (!bestLeg || len < bestLeg.len) bestLeg = { leg: [...leg, gp], len, at: gp.p };
          }
        }
        if (!bestLeg) {
          ok = false;
          break;
        }
        chain = chain.concat(bestLeg.leg);
        at = bestLeg.at;
      }
    }
    void legs;
    if (!ok) {
      // No clear chain round the parts weighed so far: bring in every part near the hooks (the band
      // may have to go round parts the straight line never met, such as under the robot), once
      if (widened) break;
      widened = true;
      const zone = new THREE.Box3().setFromPoints([pA, pB, ...guideSets.flat().flatMap((c) => [c.a, c.b])]).expandByScalar(NEAR_MM);
      for (const inst of instances) {
        if (hookIds.has(inst.instanceId) || gathered.has(inst.instanceId) || inst.visible === false || isRoutedBand(inst)) continue;
        const p = partOf(inst);
        if (!p?.bbox || isBandPart(p) || p.gearSpecs?.teeth) continue;
        const box = new THREE.Box3(v3(p.bbox.min), v3(p.bbox.max)).applyMatrix4(buildWorldMatrix(inst.position, inst.rotation));
        if (box.intersectsBox(zone)) gathered.add(inst.instanceId);
      }
      continue;
    }
    // Parts the chain's lines pass through or come too close to that weren't weighed yet (a part
    // beside a gap the band can't squeeze through): weigh them and search again
    const pts = [pA, ...chain.map((x) => x.p), pB];
    const near = new Set();
    for (let k = 0; k + 1 < pts.length; k++) for (const pid of partsOnLine(pts[k], pts[k + 1], instances, hookIds, cache, grow)) if (!gathered.has(pid)) near.add(pid);
    if (near.size) {
      for (const pid of near) gathered.add(pid);
      continue;
    }
    // Bends, one per corner passed (two points on one corner are one bend)
    let bends = [];
    for (const node of chain) if (!bends.length || bends[bends.length - 1].key !== node.corner.key) bends.push(node.corner);
    // Solve, then drop bends the band doesn't press on (it turns less than 2° there)
    let entries = bends.map(bendEntry);
    let strung = stringBand(bandInst, whole([A, ...entries, B]), instances, partOf);
    for (let changed = true; changed && entries.length && !strung.error; ) {
      changed = false;
      for (let k = 0; k < entries.length; k++) {
        if ((strung.contacts[k + 1]?.wrapDeg ?? 0) >= 2) continue;
        const without = entries.filter((_, j) => j !== k);
        const t = stringBand(bandInst, whole([A, ...without, B]), instances, partOf);
        if (t.error) continue;
        entries = without;
        bends = bends.filter((_, j) => j !== k);
        strung = t;
        changed = true;
        break;
      }
    }
    if (strung.error) return { error: strung.error };
    // A band can't turn more than about a right angle round a square corner: a bend that turns
    // further was taken the wrong way round (the band would loop round the corner). Rule it out and
    // search again.
    // First try without such bends (the band often doesn't need them); if it then overlaps a part,
    // rule the corner out and search again.
    for (let guard = 0; guard < entries.length; guard++) {
      const looped = entries.findIndex((_, k) => (strung.contacts[k + 1]?.wrapDeg ?? 0) > MAX_BEND_DEG);
      if (looped < 0) break;
      const without = entries.filter((_, j) => j !== looped);
      const t = stringBand(bandInst, whole([A, ...without, B]), instances, partOf);
      const clear = !t.error && !bandOverlaps({ ...bandInst, position: t.position, rotation: t.rotation, shape: t.shape }, instances).some((o) => !hookIds.has(o.instanceId) && !partOf(byId.get(o.instanceId))?.gearSpecs?.teeth);
      if (!clear) {
        banned.add(bends[looped].key);
        strung = null;
        break;
      }
      entries = without;
      bends = bends.filter((_, j) => j !== looped);
      strung = t;
    }
    if (!strung) continue;
    if (entries.length > limits.bends || strung.stretch > limits.stretch * (spec.freeMm ? 1 : 0)) break;
    // What the band meets now: parts off the hooks it overlaps, other than the gathered ones (those
    // mean the search has to be finer, which the next round can't fix)
    const band = { ...bandInst, position: strung.position, rotation: strung.rotation, shape: strung.shape };
    // (gears are left to the caller, which puts runs through their tooth gaps)
    const over = bandOverlaps(band, instances).filter((o) => !hookIds.has(o.instanceId) && !partOf(byId.get(o.instanceId))?.gearSpecs?.teeth);
    const fresh = over.filter((o) => !gathered.has(o.instanceId));
    best = { bends: entries, lengthMm: strung.lengthMm, over, ms: Date.now() - t0 };
    if (!over.length) return best;
    if (!fresh.length) break;
    for (const o of fresh) gathered.add(o.instanceId);
  }
  const blocked = best?.over?.length ? best.over : [...gathered].map((id) => ({ instanceId: id, label: byId.get(id)?.label }));
  return { blockedBy: blocked.map((b) => ({ instanceId: b.instanceId, label: b.label || byId.get(b.instanceId)?.label })), best };
}

/**
 * Keys of a part's corners facing toward `centre` (the loop's middle) or, with `awayOnly` false,
 * away from it: the corners an answer of over (round the far side) or under rules out.
 */
export function cornerKeysFacing(inst, centre, over) {
  return cornersOf(inst, new Set())
    .filter((c) => {
      const toMid = v3(centre).sub(c.a.clone().add(c.b).multiplyScalar(0.5));
      const facesMiddle = c.out.dot(toMid) > 0;
      return over ? facesMiddle : !facesMiddle;
    })
    .map((c) => c.key);
}

/** Keys of the corners of `inst` on the same side as a bend (their outward directions within 60°). */
export function sideKeys(inst, bend) {
  if (!inst || !Array.isArray(bend.wrap)) return [];
  const w = v3(bend.wrap).normalize();
  return cornersOf(inst, new Set())
    .filter((c) => v3(c.local.out).normalize().dot(w) > 0.5)
    .map((c) => c.key);
}

export { r3 };
export { partsOnLine as _partsOnLine, cornersOf as _cornersOf, solidOf as _solidOf, lineMisses as _lineMisses };
