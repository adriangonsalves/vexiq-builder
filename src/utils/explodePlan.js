import * as THREE from 'three';

/**
 * The explode plan (openspec explode-view): how the robot comes apart, worked out once per build and
 * direction choice, so the slider only has to add up offsets.
 *
 * 1. Pieces: parts that never move apart (groups, a tire and its hub, a pin and the part it sits
 *    deeper in). The base piece holds the brain, or else is the biggest.
 * 2. Pass A, outside in: take pieces off one at a time, each along a direction it can slide out
 *    (its pin or shaft axis first, then the main axes) carrying what was already taken off it.
 *    Pieces that get stuck merge into a lump, which is taken apart again on its own.
 * 3. Pass B, inside out: how far each piece travels so what it carries has room to spread.
 * 4. Timeline with the slider check built in: holders first, each piece starts as early as it can
 *    slide out without meeting anything at any 1% of the slider, so a piece never leaves its holder
 *    before the holder moves and no two parts overlap that don't overlap as built.
 *
 * Pure: the caller passes the parts with their collision meshes (BufferGeometry with a `boundsTree`
 * from three-mesh-bvh) and the joint data (see `explodeInputs` in mcp/assembly-engine.mjs).
 */

export const EXPLODE_GAP_MM = 6.35; // room left between pieces when spread (0.5 pitch)
export const EXPLODE_SAMPLES = 100; // the slider check looks at every 1/100
export const EXPLODE_MODES = ['x', 'y', 'z', 'all'];
const AXIS_MATCH_DOT = Math.cos(THREE.MathUtils.degToRad(2));
const MAX_POINTS_PER_PART = 400;
const OVERLAP_SLACK_MM = 0.05; // a slide this short still counts as touching
const MIN_WINDOW = 0.08;
const MAX_STRETCH = 3; // the furthest a piece may go, as a multiple of its planned travel
const OPEN_PATH_MM = 40; // a slide out into open room is tried before one that only clears the holder // shortest stretch of the slider a piece moves over
const DOUBLE_SIDE = 2; // THREE.DoubleSide

const MAIN_AXES = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
].map((a) => new THREE.Vector3(...a));
const MODE_AXIS = { x: 0, y: 1, z: 2 };

const _v = new THREE.Vector3();
const _ray = new THREE.Ray();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _box = new THREE.Box3();
const _box2 = new THREE.Box3();

const boxOf = (b) => new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max));
const volumeOf = (box) => {
  const s = box.getSize(_v);
  return Math.max(s.x, 1e-3) * Math.max(s.y, 1e-3) * Math.max(s.z, 1e-3);
};
/** Lowest and highest reach of a box along a unit direction. */
const projRange = (box, d) => {
  const c = box.getCenter(new THREE.Vector3()).dot(d);
  const s = box.getSize(new THREE.Vector3());
  const half = (Math.abs(d.x) * s.x + Math.abs(d.y) * s.y + Math.abs(d.z) * s.z) / 2;
  return [c - half, c + half];
};
const extentAlong = (box, d) => {
  const [lo, hi] = projRange(box, d);
  return hi - lo;
};
/** The box swept from where it is to `dist` along `d`. */
const sweptBox = (box, d, dist, out = new THREE.Box3()) => {
  out.copy(box);
  _box2.copy(box).translate(_v.copy(d).multiplyScalar(dist));
  return out.union(_box2);
};
const sameDir = (a, b) => a.dot(b) >= AXIS_MATCH_DOT;
const smoothstep = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const round = (n, k = 4) => Number(n.toFixed(k)) + 0;
/** `progress` (a 0..1 callback) for one stretch, a..b, of the whole job; null without one. */
const span = (progress, a, b) => (progress ? (f) => progress(a + (b - a) * clamp01(f)) : null);

// ---------------------------------------------------------------------------------------------
// Parts: world boxes, collision meshes, sample points and mesh tests

function preparePart(p) {
  const matrix = p.matrix.isMatrix4 ? p.matrix : new THREE.Matrix4().fromArray(p.matrix);
  return {
    ...p,
    matrix,
    inverse: matrix.clone().invert(),
    worldBox: boxOf(p.box),
    meshes: p.meshes || [],
    points: null
  };
}

/** Up to MAX_POINTS_PER_PART world points of a part's collision mesh, spread over it (one per grid cell). */
function pointsOf(part) {
  if (part.points) return part.points;
  const pts = [];
  for (const mesh of part.meshes) {
    const pos = mesh.geo.getAttribute('position');
    const index = mesh.geo.getIndex();
    // A hub piece shares the body's position buffer, so only its own triangles' corners count
    const used = index ? new Set(index.array) : null;
    const world = mesh.local ? _m.multiplyMatrices(part.matrix, mesh.local).clone() : part.matrix;
    for (let i = 0; i < pos.count; i++) {
      if (used && !used.has(i)) continue;
      pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(world));
    }
  }
  const size = part.worldBox.getSize(new THREE.Vector3());
  let cells = 10;
  let kept = pts;
  while (kept.length > MAX_POINTS_PER_PART && cells > 1) {
    const cell = Math.max(size.x, size.y, size.z, 1) / cells;
    const seen = new Set();
    kept = [];
    for (const q of pts) {
      const key = `${Math.floor(q.x / cell)},${Math.floor(q.y / cell)},${Math.floor(q.z / cell)}`;
      if (!seen.has(key)) {
        seen.add(key);
        kept.push(q);
      }
    }
    cells = Math.floor(cells * 0.7);
  }
  if (kept.length > MAX_POINTS_PER_PART) {
    const step = kept.length / MAX_POINTS_PER_PART;
    kept = Array.from({ length: MAX_POINTS_PER_PART }, (_, i) => kept[Math.floor(i * step)]);
  }
  part.points = kept;
  return kept;
}

/** Distance along the world ray (origin, d) to `part`'s collision mesh, up to `far`, or Infinity. */
function rayToPart(part, origin, d, far) {
  let best = Infinity;
  for (const mesh of part.meshes) {
    _m.copy(part.inverse);
    if (mesh.local) _m.premultiply(_m2.copy(mesh.local).invert());
    _ray.origin.copy(origin).applyMatrix4(_m);
    _ray.direction.copy(d).transformDirection(_m);
    const hit = mesh.geo.boundsTree.raycastFirst(_ray, DOUBLE_SIDE, 0, far);
    if (hit && hit.distance < best) best = hit.distance;
  }
  return best;
}

/** True when parts `a` and `b`, moved by world offsets `oa` and `ob`, overlap. */
function partsOverlap(a, b, oa, ob) {
  // a's frame <- b's frame: inv(T(oa) * Ma) * T(ob) * Mb
  const ma = new THREE.Matrix4().makeTranslation(oa.x, oa.y, oa.z).multiply(a.matrix).invert();
  const mb = new THREE.Matrix4().makeTranslation(ob.x, ob.y, ob.z).multiply(b.matrix);
  const bToA = ma.multiply(mb);
  for (const ma2 of a.meshes) {
    for (const mb2 of b.meshes) {
      _m.copy(bToA);
      if (ma2.local) _m.premultiply(_m2.copy(ma2.local).invert());
      if (mb2.local) _m.multiply(mb2.local);
      if (ma2.geo.boundsTree.intersectsGeometry(mb2.geo, _m)) return true;
    }
  }
  return false;
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * partsOverlap, plus a shaft section inside a hole too narrow for it (`tooWide`, which the shrunk
 * meshes miss), remembered by the two parts' offset from each other (all that matters to either).
 */
function overlapCached(cache, a, b, oa, ob, tooWide = null) {
  const key = `${a.id}|${b.id}|${Math.round((ob.x - oa.x) * 1000)},${Math.round((ob.y - oa.y) * 1000)},${Math.round((ob.z - oa.z) * 1000)}`;
  let hit = cache.get(key);
  if (hit === undefined) {
    hit = partsOverlap(a, b, oa, ob) || Boolean(tooWide && (a.kind === 'shaft' || b.kind === 'shaft') && tooWide(a.id, b.id, oa.toArray(), ob.toArray()));
    cache.set(key, hit);
  }
  return hit;
}


/**
 * The fixed point everything moves away from: `input.center` when given (a lump planned on its own
 * uses the robot's), else the brain's centre, else the robot's centre of mass (parts weighted by
 * their box volume).
 */
function fixedPoint(input) {
  const center = new THREE.Vector3();
  if (input.center) return center.fromArray(input.center);
  const brain = input.parts.find((p) => /robot brain/i.test(p.name || ''));
  if (brain) return boxOf(brain.box).getCenter(center);
  let total = 0;
  for (const p of input.parts) {
    const box = boxOf(p.box);
    const v = volumeOf(box);
    center.addScaledVector(box.getCenter(new THREE.Vector3()), v);
    total += v;
  }
  return total ? center.divideScalar(total) : center;
}

/** Pairs of parts that overlap as built (a tire on its hub, slightly-off models): they never count. */
function builtOverlapsOf(parts, tooWide) {
  const out = new Set();
  const zero = new THREE.Vector3();
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i];
      const b = parts[j];
      if (!a.worldBox.intersectsBox(b.worldBox)) continue;
      const wide = tooWide && (a.kind === 'shaft' || b.kind === 'shaft') && tooWide(a.id, b.id, [0, 0, 0], [0, 0, 0]);
      if (wide || partsOverlap(a, b, zero, zero)) out.add(pairKey(a.id, b.id));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 1. Pieces

class Pieces {
  constructor(parts) {
    this.parent = new Map(parts.map((p) => [p.id, p.id]));
  }
  find(id) {
    let r = id;
    while (this.parent.get(r) !== r) r = this.parent.get(r);
    let c = id;
    while (this.parent.get(c) !== r) {
      const n = this.parent.get(c);
      this.parent.set(c, r);
      c = n;
    }
    return r;
  }
  union(keep, other) {
    const a = this.find(keep);
    const b = this.find(other);
    if (a !== b) this.parent.set(b, a);
  }
}

/**
 * Pieces of the build: { pieces: Map<pieceId, { id, members, box, volume }>, pieceOf: Map<partId,
 * pieceId>, base, joints: [{ a, b, axis, weight }] } where joints run between pieces (an axis for
 * pins, pegs and shafts; none for battery bays and other joins).
 */
export function buildPieces(input) {
  const parts = input.parts;
  const byId = new Map(parts.map((p) => [p.id, p]));
  const uf = new Pieces(parts);
  const vol = (id) => volumeOf(byId.get(id).worldBox || boxOf(byId.get(id).box));

  // Groups (two or more visible members)
  const groupFirst = new Map();
  const groupCount = new Map();
  for (const p of parts) if (p.groupId) groupCount.set(p.groupId, (groupCount.get(p.groupId) || 0) + 1);
  for (const p of parts) {
    if (!p.groupId || groupCount.get(p.groupId) < 2) continue;
    if (!groupFirst.has(p.groupId)) groupFirst.set(p.groupId, p.id);
    else uf.union(groupFirst.get(p.groupId), p.id);
  }
  // A tire stays on its hub
  for (const [tire, hub] of input.tires || []) if (byId.has(tire) && byId.has(hub)) uf.union(hub, tire);
  // A pin or standoff rides with the part it sits deeper in (the larger part on a tie)
  const depth = new Map(); // pinId -> Map(partnerId -> mm)
  const addDepth = (pin, partner, mm) => {
    if (byId.get(pin)?.kind !== 'pin' || !byId.has(partner)) return;
    if (!depth.has(pin)) depth.set(pin, new Map());
    depth.get(pin).set(partner, (depth.get(pin).get(partner) || 0) + mm);
  };
  for (const pr of input.pairs) {
    addDepth(pr.insertOwner, pr.openingOwner, pr.depthMm);
    addDepth(pr.openingOwner, pr.insertOwner, pr.depthMm);
  }
  for (const [pin, partners] of depth) {
    let best = null;
    for (const [id, mm] of partners) {
      if (byId.get(id).kind === 'shaft') continue;
      const better =
        !best ||
        mm > best.mm + 0.5 ||
        (Math.abs(mm - best.mm) <= 0.5 && (byId.get(id).kind !== 'pin') > (byId.get(best.id).kind !== 'pin')) ||
        (Math.abs(mm - best.mm) <= 0.5 && (byId.get(id).kind !== 'pin') === (byId.get(best.id).kind !== 'pin') && vol(id) > vol(best.id));
      if (better) best = { id, mm };
    }
    if (best) uf.union(best.id, pin);
  }

  const pieces = new Map();
  const pieceOf = new Map();
  for (const p of parts) {
    const root = uf.find(p.id);
    pieceOf.set(p.id, root);
    if (!pieces.has(root)) pieces.set(root, { id: root, members: [], box: new THREE.Box3() });
    const piece = pieces.get(root);
    piece.members.push(p.id);
    piece.box.union(p.worldBox || boxOf(p.box));
  }
  for (const piece of pieces.values()) piece.volume = volumeOf(piece.box);

  // The piece that stays: the one holding `input.basePart` when given, else the brain's, else the biggest
  const brain = parts.find((p) => /robot brain/i.test(p.name || ''));
  let base = input.basePart && pieceOf.has(input.basePart) ? pieceOf.get(input.basePart) : brain ? pieceOf.get(brain.id) : null;
  if (!base) for (const piece of pieces.values()) if (!base || piece.volume > pieces.get(base).volume) base = piece.id;

  const joints = [];
  for (const pr of input.pairs) {
    const a = pieceOf.get(pr.insertOwner);
    const b = pieceOf.get(pr.openingOwner);
    // Kept even inside one piece (a pin may move to the other piece it sits in later)
    if (a && b) joints.push({ a, b, pa: pr.insertOwner, pb: pr.openingOwner, axis: new THREE.Vector3(...pr.axis).normalize(), weight: 1 });
  }
  for (const bay of input.bays || []) {
    const a = pieceOf.get(bay.battery);
    const b = pieceOf.get(bay.brain);
    if (a && b && a !== b) joints.push({ a, b, axis: null, weight: 1, bay: bay.brain });
  }
  for (const [x, y] of input.direct || []) {
    const a = pieceOf.get(x);
    const b = pieceOf.get(y);
    if (a && b && a !== b) joints.push({ a, b, axis: null, weight: 0.25 });
  }
  return { pieces, pieceOf, base, joints };
}

// ---------------------------------------------------------------------------------------------
// The plan builder

/**
 * The plan for the parts in `input` as they are (see buildExplodePlan). With `input.planeParts` it
 * plans one half of a mirror-image robot: those parts move only along the plane (`input.mirrorAxis`).
 */
function planCore(input, mode = 'all', { log = null, nested = false, progress = null } = {}) {
  const t0 = Date.now();
  const parts = input.parts.map(preparePart);
  const partById = new Map(parts.map((p) => [p.id, p]));
  const { pieces, pieceOf, base, joints } = buildPieces({ ...input, parts });

  // The fixed point everything moves away from: given (a lump planned on its own uses the robot's),
  // else the brain's centre, else the robot's centre of mass (parts weighted by their box volume)
  const center = fixedPoint(input);
  const outward = outwardFrom(center);
  const mirrorRule = mirrorRuleFor(input, partById);
  const middleRule = middleRuleFor(input, partById);
  const inPlane = (ids, dirs) => middleRule(ids, mirrorRule(ids, dirs));

  const builtOverlap = builtOverlapsOf(parts, input.tooWide);
  // Stop rings: [{ insert, opening, axis, plus, minus }] at part level
  const blocks = stopRingsOf(input, partById);

  // State of the take-apart
  let remaining = new Set(pieces.keys());
  const members = new Map([...pieces].map(([id, p]) => [id, new Set(p.members)])); // piece -> parts
  const origMembers = new Map([...pieces].map(([id, p]) => [id, new Set(p.members)]));
  const takenOffOf = new Map([...pieces.keys()].map((id) => [id, []])); // holder -> pieces taken off it
  const absorbed = new Map(); // piece -> pieces merged into it
  for (const j of joints) [j.a0, j.b0] = [j.a, j.b];
  const children = new Map([...pieces.keys()].map((id) => [id, []]));
  const holderOf = new Map();
  const dirOf = new Map();
  const clearOf = new Map();
  const order = [];
  const freeCache = new Map(); // `${piece}|${dir}` -> { far, dist, version }
  const bodyVersion = new Map([...pieces.keys()].map((id) => [id, 0]));

  /** Every part a piece carries: its own and those of every piece taken off it, recursively. */
  const bodyParts = (pid, out = new Set()) => {
    for (const m of members.get(pid)) out.add(m);
    for (const c of children.get(pid)) bodyParts(c, out);
    return out;
  };
  const boxOfParts = (ids) => {
    const box = new THREE.Box3();
    for (const id of ids) box.union(partById.get(id).worldBox);
    return box;
  };
  const jointsOf = (pid) => joints.filter((j) => j.a !== j.b && ((j.a === pid && remaining.has(j.b)) || (j.b === pid && remaining.has(j.a))));
  const neighbours = (pid) => {
    const set = new Set();
    for (const j of jointsOf(pid)) if (j.weight >= 1) set.add(j.a === pid ? j.b : j.a);
    return set;
  };

  const holderFor = (pid) => {
    const score = new Map();
    for (const j of jointsOf(pid)) {
      const other = j.a === pid ? j.b : j.a;
      score.set(other, (score.get(other) || 0) + j.weight);
    }
    let best = null;
    for (const [id, s] of score) if (!best || s > best.s || (s === best.s && pieces.get(id).volume > pieces.get(best.id).volume)) best = { id, s };
    if (best) return best.id;
    // No joints left: the nearest remaining piece
    const c = pieces.get(pid).box;
    let near = null;
    for (const id of remaining) {
      if (id === pid) continue;
      const d = pieces.get(id).box.distanceToPoint(c.getCenter(_v));
      if (!near || d < near.d) near = { id, d };
    }
    return near?.id ?? runBase;
  };

  /** The remaining piece other than the base that `pid` is most joined to (or nearest), or null. */
  const partnerFor = (pid) => {
    const score = new Map();
    for (const j of jointsOf(pid)) {
      const other = j.a === pid ? j.b : j.a;
      if (other !== runBase) score.set(other, (score.get(other) || 0) + j.weight);
    }
    let best = null;
    for (const [id, sc] of score) if (!best || sc > best.sc) best = { id, sc };
    if (best) return best.id;
    const c = pieces.get(pid).box.getCenter(new THREE.Vector3());
    let near = null;
    for (const id of remaining) {
      if (id === pid || id === runBase) continue;
      const d = pieces.get(id).box.distanceToPoint(c);
      if (!near || d < near.d) near = { id, d };
    }
    return near?.id ?? null;
  };

  const candidateDirs = (pid) => {
    const dirs = [];
    const push = (v) => {
      if (!dirs.some((d) => sameDir(d, v))) dirs.push(v.clone());
    };
    for (const j of jointsOf(pid)) {
      if (j.axis) {
        push(j.axis);
        push(j.axis.clone().negate());
      } else if (j.bay) {
        const m = partById.get(j.bay).matrix;
        for (let k = 0; k < 3; k++) {
          const ax = new THREE.Vector3().setFromMatrixColumn(m, k).normalize();
          push(ax);
          push(ax.negate());
        }
      }
    }
    for (const a of MAIN_AXES) push(a);
    const box = boxOfParts(bodyParts(pid));
    if (mode in MODE_AXIS) {
      const k = MODE_AXIS[mode];
      return inPlane(bodyParts(pid), outward(box, MAIN_AXES.filter((a) => a.getComponent(k) !== 0)));
    }
    // A shaft may also be pulled out inward along its length (an axle whose cap sits on the inside)
    const shaftAxes = [...members.get(pid)].every((m) => partById.get(m).kind === 'shaft')
      ? jointsOf(pid).filter((j) => j.axis).map((j) => j.axis)
      : [];
    const out = outward(box, dirs);
    for (const d of dirs) if (!out.includes(d) && shaftAxes.some((a) => Math.abs(a.dot(d)) >= AXIS_MATCH_DOT)) out.push(d);
    return inPlane(bodyParts(pid), out);
  };

  // A stop ring is checked against every part, also those already taken off (they may still be on
  // its shaft, further along)
  const ringBlocks = (body, d) => ringBlocksFor(blocks, body, { has: (id) => !body.has(id) }, d);

  /**
   * How far `body` (a set of parts) slides along `d` before touching any of the `others` parts, up
   * to `far`: rays from the body's points along d into the others, and from theirs
   * along -d into the body. Pairs that overlap as built are left out.
   */
  let lastHit = null;
  const freeDistance = (body, d, far, others) => {
    lastHit = null;
    const bodyBox = boxOfParts(body);
    const swept = sweptBox(bodyBox, d, far).expandByScalar(0.1);
    const nd = d.clone().negate();
    let best = far + 1;
    const p = new THREE.Vector3();
    for (const o of parts) {
      if (!others.has(o.id) || !swept.intersectsBox(o.worldBox)) continue;
      for (const bid of body) {
        const b = partById.get(bid);
        if (builtOverlap.has(pairKey(b.id, o.id))) continue;
        sweptBox(b.worldBox, d, Math.min(far, best), _box).expandByScalar(0.1);
        if (!_box.intersectsBox(o.worldBox)) continue;
        const reach = Math.min(far, best);
        const oBox = o.worldBox.clone().expandByScalar(0.1);
        const bBox = b.worldBox.clone().expandByScalar(0.1);
        for (const q of pointsOf(b)) {
          _ray.origin.copy(q);
          _ray.direction.copy(d);
          if (!_ray.intersectsBox(oBox)) continue;
          const hit = rayToPart(o, p.copy(q), d, Math.min(reach, best));
          if (hit < best) [best, lastHit] = [hit, o.id];
        }
        for (const q of pointsOf(o)) {
          _ray.origin.copy(q);
          _ray.direction.copy(nd);
          if (!_ray.intersectsBox(bBox)) continue;
          const hit = rayToPart(b, p.copy(q), nd, Math.min(reach, best));
          if (hit < best) [best, lastHit] = [hit, o.id];
        }
        if (best <= OVERLAP_SLACK_MM) return 0;
      }
    }
    return best;
  };

  /**
   * How far the body must go along d to leave its holder: past every holder part in its path that it
   * sits beside along d now (holder parts further ahead would block the slide anyway).
   */
  const clearOut = (bodyBox, holder, d) => {
    const [lo, hi] = projRange(bodyBox, d);
    const path = sweptBox(bodyBox, d, 1e4, new THREE.Box3()).expandByScalar(-0.05);
    let clear = 0;
    for (const id of members.get(holder)) {
      const hb = partById.get(id).worldBox;
      if (!path.intersectsBox(hb)) continue;
      const [hLo, hHi] = projRange(hb, d);
      if (hLo > hi + 0.5) continue; // ahead of the body: an obstacle, not something it sits in
      clear = Math.max(clear, hHi - lo);
    }
    return clear;
  };

  /**
   * The first way `pid` slides off, carrying what was taken off it, past the pieces still on the
   * robot (pieces already taken off are out of the way, as when taking a robot apart by hand; the
   * slider check catches any that are still in the way when the slider plays). With `open`, the way
   * must also stay clear for OPEN_PATH_MM past the holder, so the piece has room to spread into.
   */
  const trySlide = (pid, open) => {
    const body = bodyParts(pid);
    const bodyBox = boxOfParts(body);
    const holder = holderFor(pid);
    const others = new Set();
    for (const r of remaining) if (r !== pid) for (const m of members.get(r)) others.add(m);
    let blocked = 0;
    for (const d of candidateDirs(pid)) {
      if (ringBlocks(body, d)) {
        blocked++;
        continue;
      }
      const clear = clearOut(bodyBox, holder, d);
      const far = clear + (open ? OPEN_PATH_MM : 0);
      const key = `${pid}|${d.toArray().map((n) => n.toFixed(3)).join(',')}`;
      let cached = freeCache.get(key);
      // Still right while the body is the same and what stopped it is still on the robot (fewer
      // pieces left can only make the way clearer)
      const stale =
        !cached ||
        cached.version !== bodyVersion.get(pid) ||
        (cached.by ? !others.has(cached.by) : cached.far < far);
      if (stale) {
        const dist = freeDistance(body, d, far, others);
        cached = { far, dist, by: dist <= far ? lastHit : null, version: bodyVersion.get(pid) };
        freeCache.set(key, cached);
      }
      if (cached.dist >= far - 1e-6) return { ok: true, holder, d, clear };
      blocked++;
    }
    return { ok: false, holder, blocked };
  };

  const takeOff = (pid, holder, d, clear) => {
    remaining.delete(pid);
    holderOf.set(pid, holder);
    dirOf.set(pid, d);
    clearOf.set(pid, clear);
    children.get(holder).push(pid);
    takenOffOf.get(holder).push(pid);
    bodyVersion.set(holder, bodyVersion.get(holder) + 1);
    order.push(pid);
  };

  const merge = (pid, into) => {
    if (pid === into) throw new Error(`explode: piece ${pid} can't merge into itself`);
    remaining.delete(pid);
    for (const m of members.get(pid)) {
      members.get(into).add(m);
      pieceOf.set(m, into);
    }
    for (const c of children.get(pid)) {
      holderOf.set(c, into);
      children.get(into).push(c);
    }
    children.set(pid, []);
    for (const j of joints) {
      if (j.a === pid) j.a = into;
      if (j.b === pid) j.b = into;
    }
    pieces.get(into).box.union(pieces.get(pid).box);
    pieces.get(into).volume = volumeOf(pieces.get(into).box);
    bodyVersion.set(into, bodyVersion.get(into) + 1);
    if (!absorbed.has(into)) absorbed.set(into, []);
    absorbed.get(into).push(pid);
  };

  const labelOf = (pid) => [...members.get(pid)].map((m) => partById.get(m).label || partById.get(m).name).slice(0, 2).join('+');
  /**
   * Tries each stuck piece together with what blocks it: a group starts as the piece and takes in
   * the piece that stopped it most, up to 4 pieces, until the group can slide off as one (a capped
   * axle, the block its cap sits behind and the bearing in front of that).
   */
  const takeOffGroup = (ids) => {
    const pieceOfPart = new Map();
    for (const r of remaining) for (const m of members.get(r)) pieceOfPart.set(m, r);
    for (const a of ids) {
      const group = [a];
      for (let size = 1; size <= 4; size++) {
        const inGroup = new Set(group);
        const body = new Set();
        for (const g of group) bodyParts(g, body);
        const others = new Set();
        for (const r of remaining) if (!inGroup.has(r)) for (const m of members.get(r)) others.add(m);
        const outside = joints.filter((j) => j.a !== j.b && inGroup.has(j.a) !== inGroup.has(j.b) && remaining.has(inGroup.has(j.a) ? j.b : j.a));
        const score = new Map();
        for (const j of outside) {
          const o = inGroup.has(j.a) ? j.b : j.a;
          score.set(o, (score.get(o) || 0) + j.weight);
        }
        const holder = [...score].sort((x, y) => y[1] - x[1])[0]?.[0] ?? runBase;
        const dirs = [];
        const push = (v) => !dirs.some((d) => sameDir(d, v)) && dirs.push(v.clone());
        if (mode in MODE_AXIS) MAIN_AXES.filter((x) => x.getComponent(MODE_AXIS[mode]) !== 0).forEach(push);
        else {
          for (const j of outside) if (j.axis) [j.axis, j.axis.clone().negate()].forEach(push);
          MAIN_AXES.forEach(push);
        }
        const bodyBox = boxOfParts(body);
        const blockers = new Map();
        for (const d of inPlane(body, outward(bodyBox, dirs))) {
          if (ringBlocks(body, d)) continue;
          const clear = clearOut(bodyBox, holder, d);
          if (freeDistance(body, d, clear, others) < clear - 1e-6) {
            const by = lastHit && pieceOfPart.get(lastHit);
            if (by && by !== runBase && by !== holder) blockers.set(by, (blockers.get(by) || 0) + 1);
            continue;
          }
          if (group.length === 1) break; // on its own it already failed the normal test
          const keep = group.slice().sort((x, y) => pieces.get(y).volume - pieces.get(x).volume)[0];
          for (const g of group) if (g !== keep) merge(g, keep);
          log?.(`explode: ${labelOf(keep)} comes off together with ${group.length - 1} piece(s) that blocked it`);
          takeOff(keep, holder, d, clear);
          return true;
        }
        const next = [...blockers].sort((x, y) => y[1] - x[1])[0]?.[0];
        if (!next || inGroup.has(next)) break;
        group.push(next);
      }
    }
    return false;
  };

  /** Moves `pins` from piece `from` to piece `to`, joints and all. */
  const movePins = (pins, from, to) => {
    const set = new Set(pins);
    for (const m of pins) {
      members.get(from).delete(m);
      members.get(to).add(m);
      pieceOf.set(m, to);
    }
    for (const j of joints) {
      if (set.has(j.pa)) j.a = to;
      if (set.has(j.pb)) j.b = to;
    }
    for (const x of [from, to]) {
      pieces.get(x).box = boxOfParts(members.get(x));
      pieces.get(x).volume = volumeOf(pieces.get(x).box);
      bodyVersion.set(x, bodyVersion.get(x) + 1);
    }
  };
  const pinPartners = new Map(); // pin -> parts it sits in
  for (const pr of input.pairs) {
    for (const [pin, other] of [[pr.insertOwner, pr.openingOwner], [pr.openingOwner, pr.insertOwner]]) {
      if (partById.get(pin)?.kind !== 'pin' || !partById.has(other)) continue;
      if (!pinPartners.has(pin)) pinPartners.set(pin, new Set());
      pinPartners.get(pin).add(other);
    }
  }
  /**
   * A stuck piece held by pins that ride with its neighbour (pins whose far end has passed through
   * it, as on a bearing pinned to a beam) tries again taking those pins with it, pulling them out of
   * the neighbour instead.
   */
  const swapPins = (ids) => {
    const pieceOfPart = new Map();
    for (const r of remaining) for (const m of members.get(r)) pieceOfPart.set(m, r);
    for (const c of ids) {
      const mine = members.get(c);
      const byPiece = new Map();
      for (const [pin, partners] of pinPartners) {
        const q = pieceOfPart.get(pin);
        if (!q || q === c || ![...partners].some((m) => mine.has(m))) continue;
        if (![...partners].some((m) => members.get(q).has(m))) continue; // not holding c to q
        if (!byPiece.has(q)) byPiece.set(q, []);
        byPiece.get(q).push(pin);
      }
      for (const [q, pins] of byPiece) {
        if (members.get(q).size <= pins.length) continue;
        const before = joints.map((j) => [j.a, j.b]);
        movePins(pins, q, c);
        const r = trySlide(c, false);
        if (r.ok) {
          // For good: the lump step starts again from the original pieces
          for (const o of origMembers.values()) for (const m of pins) o.delete(m);
          for (const m of pins) origMembers.get(c).add(m);
          for (const j of joints) {
            if (pins.includes(j.pa)) j.a0 = c;
            if (pins.includes(j.pb)) j.b0 = c;
          }
          log?.(`explode: ${labelOf(c)} comes off with the pins that held it to ${labelOf(q)}`);
          takeOff(c, r.holder, r.d, r.clear);
          return true;
        }
        movePins(pins, c, q);
        joints.forEach((j, k) => ([j.a, j.b] = before[k]));
      }
    }
    return false;
  };

  // 2. Pass A over `ids`, keeping `runBase`: returns how many pieces came off
  let runBase = base;
  let relump = false;
  const takeApart = (ids, keep) => {
    remaining = new Set(ids);
    runBase = keep;
    let taken = 0;
    while (remaining.size > 1) {
      const candidates = [...remaining]
        .filter((id) => id !== runBase)
        .map((id) => ({ id, n: neighbours(id).size, v: pieces.get(id).volume }))
        .sort((a, b) => (a.n <= 1 ? 0 : 1) - (b.n <= 1 ? 0 : 1) || a.v - b.v);
      let done = false;
      let stuck = null;
      for (const open of [true, false]) {
        for (const c of candidates) {
          const r = trySlide(c.id, open);
          if (r.ok) {
            takeOff(c.id, r.holder, r.d, r.clear);
            taken++;
            done = true;
            break;
          }
          if (!open) {
            // Prefer joining a neighbour over joining the base (what joins the base never moves)
            const into = r.holder === runBase ? partnerFor(c.id) ?? runBase : r.holder;
            const onBase = into === runBase ? 1 : 0;
            if (!stuck || onBase < stuck.onBase || (onBase === stuck.onBase && r.blocked < stuck.blocked)) stuck = { id: c.id, into, onBase, blocked: r.blocked };
          }
        }
        if (done) break;
      }
      // Stuck: pieces that block each other alone may come off together (a capped axle, the block
      // its cap sits behind and the bearing in front of that)
      // (only once a lump is off the brain; on the whole robot, stuck pieces form the lumps)
      if (!done) done = swapPins(candidates.map((c) => c.id));
      if (!done && (nested || relump)) done = takeOffGroup(candidates.map((c) => c.id));
      if (done) taken++;
      if (!relump) progress?.(0.2 * (1 - remaining.size / pieces.size));
      if (!done) {
        // Only the base stays put: a stuck piece joins a neighbour that isn't the base, so parts
        // pinned together (a frame) come off as one lump and are taken apart once clear
        const into = stuck.into;
        log?.(`explode: stuck, ${labelOf(stuck.id)} stays on ${labelOf(into)}`);
        merge(stuck.id, into);
      }
    }
    return taken;
  };
  takeApart([...pieces.keys()], base);

  // A lump of pieces that got stuck together comes apart once it is away from the rest: take it
  // apart again with only its own parts in the way (as a side frame comes off the brain whole and is
  // then taken apart). The slider check decides whether there's room for that where it ends up.
  const lumpOf = (id, out = []) => {
    out.push(id);
    for (const q of absorbed.get(id) || []) lumpOf(q, out);
    return out;
  };
  const work = [...absorbed.keys()];
  relump = true;
  const seenLumps = new Set();
  while (work.length) {
    const id = work.shift();
    // Only a lump that moves on its own; one merged into a bigger lump is taken apart with it
    if (!absorbed.has(id) || [...absorbed.values()].some((v) => v.includes(id))) continue;
    const lump = lumpOf(id);
    const key = lump.slice().sort().join(',');
    if (seenLumps.has(key)) continue;
    seenLumps.add(key);
    const inLump = new Set(lump);
    for (const q of lump) {
      absorbed.delete(q);
      members.set(q, new Set(origMembers.get(q)));
      children.set(q, takenOffOf.get(q).slice());
      for (const c of takenOffOf.get(q)) holderOf.set(c, q);
      bodyVersion.set(q, bodyVersion.get(q) + 1);
      pieces.get(q).box = boxOfParts(origMembers.get(q));
      pieces.get(q).volume = volumeOf(pieces.get(q).box);
    }
    for (const j of joints) {
      if (inLump.has(j.a0)) j.a = j.a0;
      if (inLump.has(j.b0)) j.b = j.b0;
    }
    const taken = takeApart(lump, id);
    log?.(`explode: lump of ${lump.length} around ${labelOf(id)}: ${taken} came off`);
    if (taken) for (const q of absorbed.keys()) if (inLump.has(q)) work.push(q);
  }
  remaining = new Set([base]);
  progress?.(0.3);

  // Tree after Pass A: every piece left points at its holder; merged pieces are gone
  const live = new Set([base, ...order.filter((id) => holderOf.has(id) && !remaining.has(id) && members.get(id).size)]);
  const plan = { mode, base, nodes: new Map() };
  const depthOf = (id) => (id === base ? -1 : depthOf(holderOf.get(id)) + 1);
  for (const id of live) {
    plan.nodes.set(id, {
      id,
      members: [...members.get(id)],
      parent: id === base ? null : holderOf.get(id),
      dir: id === base ? null : dirOf.get(id),
      clear: clearOf.get(id) || 0,
      travel: 0,
      children: [],
      box: boxOfParts(members.get(id))
    });
  }
  for (const node of plan.nodes.values()) {
    node.depth = depthOf(node.id);
    if (node.parent) plan.nodes.get(node.parent).children.push(node.id);
  }

  const tA = Date.now() - t0;
  log?.(`explode: pass A ${tA} ms, ${plan.nodes.size - 1} moving`);
  // 3. Pass B, then 4 + 5. the timeline with the slider check
  passB(plan);
  const ctx = makeContext(input, parts, partById, builtOverlap, center, mode, inPlane, order);
  ctx.progress = span(progress, 0.3, 0.75);
  schedule(plan, ctx, log);
  splitBase(plan, ctx, origMembers.get(base), input, mode, log);
  progress?.(0.8);
  ctx.progress = span(progress, 0.8, 0.92);
  if (!nested) explodeLumps(plan, ctx, input, mode, log);
  ctx.progress = span(progress, 0.92, 0.96);
  if (!nested && !input.planeParts) spreadLayers(plan, ctx, log);
  // Last line of defence: a piece still meeting another stays on its holder, until none do
  ctx.progress = span(progress, 0.96, 1);
  let unplaced = verifyPlan(plan, ctx);
  ctx.progress = null;
  for (let round = 0; unplaced.length && round < 20; round++) {
    const nodeOf = new Map();
    for (const n of plan.nodes.values()) for (const m of n.members) nodeOf.set(m, n);
    const done = new Set();
    for (const h of unplaced) {
      const [x, y] = [nodeOf.get(h.a), nodeOf.get(h.b)];
      const n = [x, y].filter((q) => q.parent && !done.has(q.id)).sort((p, q) => (q.start ?? 0) - (p.start ?? 0))[0];
      if (!n || !plan.nodes.has(n.id)) continue;
      log?.(`explode: ${ctx.label(n.members[0])} stays on its holder (still meets ${ctx.label(n === x ? h.b : h.a)})`);
      done.add(n.id);
      mergeNode(plan, n.id, n.parent);
    }
    unplaced = verifyPlan(plan, ctx);
  }

  const stats = {
    parts: parts.length,
    pieces: pieces.size,
    moving: plan.nodes.size - 1,
    ms: Date.now() - t0
  };
  return {
    mode,
    base,
    pieces: [...plan.nodes.values()].map((n) => ({
      id: n.id,
      members: n.members,
      parent: n.parent,
      depth: n.depth,
      dir: n.dir ? n.dir.toArray().map((x) => round(x, 6)) : null,
      travel: round(n.travel, 3),
      start: round(n.start, 5),
      end: round(n.end, 5)
    })),
    order: order.filter((id) => plan.nodes.has(id)),
    unplaced,
    stats
  };
}


/** `dirs` without the ones heading back toward `center` (a piece at the centre keeps all). */
const outwardFrom = (center) => (box, dirs) => {
  const v = box.getCenter(new THREE.Vector3()).sub(center);
  if (v.length() < 5) return dirs;
  v.normalize();
  return dirs.filter((d) => d.dot(v) >= -0.2);
};

/**
 * On a mirror-image robot (`input.middleAxis`, `input.middleAt`): `(ids, dirs)` without the slides
 * toward the middle line for parts wholly on one side of it, so nothing ends up on the other side.
 * Parts across the line only move along it, except a lone shaft through the middle.
 */
function middleRuleFor(input, partById) {
  const k = input.middleAxis;
  if (k == null) return (ids, dirs) => dirs;
  const c = input.middleAt;
  return (ids, dirs) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const id of ids) {
      const b = partById.get(id)?.worldBox;
      if (!b) continue;
      lo = Math.min(lo, b.min.getComponent(k));
      hi = Math.max(hi, b.max.getComponent(k));
    }
    const side = lo > c - 0.5 ? 1 : hi < c + 0.5 ? -1 : 0;
    if (side) return dirs.filter((d) => d.getComponent(k) * side > -1e-3);
    // Across the line: only a lone shaft slides out sideways
    return [...ids].every((id) => partById.get(id)?.kind === 'shaft') ? dirs : dirs.filter((d) => Math.abs(d.getComponent(k)) < 1e-3);
  };
}

const LAYER_GAP_MM = 12.7; // room left between stacked pieces sliding the same way (1 pitch)
const MIRROR_GAP_MM = 20; // a piece this close to the mirror plane never slides toward it

/**
 * Planning one half of a mirror-image robot (`input.mirrorAxis`): `(ids, dirs)` keeps the ways the
 * parts `ids` may slide. Parts on the plane only move along it (the mirrored half moves them the
 * same way); a piece near the plane never slides toward it (it would meet its mirror image).
 */
function mirrorRuleFor(input, partById) {
  const k = input.mirrorAxis;
  if (k == null) return (ids, dirs) => dirs;
  const plane = new Set(input.planeParts);
  const { mirrorAt: c, mirrorSide: side } = input;
  return (ids, dirs) => {
    let near = Infinity;
    for (const id of ids) {
      if (plane.has(id)) return dirs.filter((d) => Math.abs(d.getComponent(k)) < 1e-3);
      const b = partById.get(id)?.worldBox;
      if (b) near = Math.min(near, side > 0 ? b.min.getComponent(k) - c : c - b.max.getComponent(k));
    }
    return near >= MIRROR_GAP_MM ? dirs : dirs.filter((d) => d.getComponent(k) * side > -1e-3);
  };
}

/** Stop rings: [{ insert, opening, axis, plus, minus }] at part level. */
const stopRingsOf = (input, partById) =>
  input.pairs
    .filter((p) => p.blocks && partById.has(p.insertOwner) && partById.has(p.openingOwner))
    .map((p) => ({ insert: p.insertOwner, opening: p.openingOwner, axis: new THREE.Vector3(...p.axis).normalize(), ...p.blocks }));

/** True when a stop ring in `body` (or one through it) can't pass going `d`. */
const ringBlocksFor = (blocks, body, others, d) =>
  blocks.some((b) => {
    const insIn = body.has(b.insert);
    if (insIn ? !others.has(b.opening) : !(body.has(b.opening) && others.has(b.insert))) return false;
    const rel = insIn ? d : d.clone().negate(); // how the insert moves against the opening
    const dot = rel.dot(b.axis);
    return (dot >= AXIS_MATCH_DOT && b.plus) || (dot <= -AXIS_MATCH_DOT && b.minus);
  });

/** What the timeline steps share about the build (the slider check, ways out, labels). */
function makeContext(input, parts, partById, builtOverlap, center, mode, inPlane, order) {
  const blocks = stopRingsOf(input, partById);
  const ringBlocks = (body, others, d) => ringBlocksFor(blocks, body, others, d);
  const partAxes = new Map(); // part -> pin/shaft axes it is joined on
  for (const pr of input.pairs) {
    for (const id of [pr.insertOwner, pr.openingOwner]) {
      if (!partAxes.has(id)) partAxes.set(id, []);
      partAxes.get(id).push(new THREE.Vector3(...pr.axis).normalize());
    }
  }
  return {
    partById,
    builtOverlap,
    order,
    overlapCache: new Map(),
    tooWide: input.tooWide || null,
    center,
    outward: outwardFrom(center),
    inPlane,
    label: (id) => partById.get(id)?.label || id,
    // Ways a set of parts could slide: their pin/shaft axes, then the main axes (the direction choice applies)
    dirsFor: (ids, moving = ids) => {
      if (mode in MODE_AXIS) return inPlane(moving, MAIN_AXES.filter((a) => a.getComponent(MODE_AXIS[mode]) !== 0));
      const dirs = [];
      const push = (v) => !dirs.some((d) => sameDir(d, v)) && dirs.push(v.clone());
      for (const id of ids) for (const ax of partAxes.get(id) || []) [ax, ax.clone().negate()].forEach(push);
      MAIN_AXES.forEach(push);
      return inPlane(moving, dirs);
    },
    ringBlocked: (body, d) => {
      const others = new Set(parts.map((p) => p.id).filter((id) => !body.has(id)));
      return ringBlocks(body, others, d);
    },
    clearAlong: (box, holderParts, d) => {
      const [lo, hi] = projRange(box, d);
      const path = sweptBox(box, d, 1e4, new THREE.Box3()).expandByScalar(-0.05);
      let clear = 0;
      for (const id of holderParts) {
        const hb = partById.get(id).worldBox;
        if (!path.intersectsBox(hb)) continue;
        const [hLo, hHi] = projRange(hb, d);
        if (hLo > hi + 0.5) continue;
        clear = Math.max(clear, hHi - lo);
      }
      return clear;
    }
  };
}

// ---------------------------------------------------------------------------------------------
// 3. Pass B: travel, from the leaves up

/** Box of a piece and everything it carries, spread out (at the slider's end), relative to the piece. */
function spreadBox(plan, id) {
  const node = plan.nodes.get(id);
  const box = node.box.clone();
  for (const c of node.children) {
    const child = plan.nodes.get(c);
    box.union(spreadBox(plan, c).translate(child.dir.clone().multiplyScalar(child.travel)));
  }
  return box;
}

/** Room left past the holder: the 0.5 pitch gap, or half the piece's own size along its way out if more. */
const spreadOf = (node) => Math.max(EXPLODE_GAP_MM, 0.5 * extentAlong(node.box, node.dir));

function passB(plan) {
  const byDepth = [...plan.nodes.values()].filter((n) => n.parent).sort((a, b) => b.depth - a.depth);
  const room = new Map();
  for (const node of byDepth) node.travel = node.clear + spreadOf(node);
  // Deepest first, so a piece's children already have their travel
  const seen = new Set();
  for (const node of byDepth) {
    if (seen.has(node.parent)) continue;
    seen.add(node.parent);
    layOutRows(plan, node.parent, room);
  }
}

/** Siblings that leave `holderId` the same way stack in rows: each one's travel adds the room of those between it and the holder. */
function layOutRows(plan, holderId, room) {
  const holder = plan.nodes.get(holderId);
  const kids = holder.children.map((c) => plan.nodes.get(c));
  for (const k of kids) {
    const sb = spreadBox(plan, k.id);
    room.set(k.id, { box: sb, along: extentAlong(sb, k.dir) + EXPLODE_GAP_MM });
  }
  for (const k of kids) {
    let add = 0;
    const [kLo] = projRange(k.box, k.dir);
    for (const s of kids) {
      if (s === k || !sameDir(s.dir, k.dir)) continue;
      const [sLo] = projRange(s.box, k.dir);
      if (sLo > kLo || (sLo === kLo && s.id > k.id)) continue;
      // Between it and the holder: in its way as it slides out
      if (!sweptBox(room.get(s.id).box, k.dir, 1e4, _box).intersectsBox(room.get(k.id).box)) continue;
      add += room.get(s.id).along;
    }
    k.travel = k.clear + spreadOf(k) + add;
  }
}

// ---------------------------------------------------------------------------------------------
// 4 + 5. Timeline, with the slider check built in

const WINDOW = 0.35; // stretch of the slider each piece slides over
const LAG = 0.12; // a piece starts at least this long after its holder
const START_STEP = 0.03; // start times tried (a whole number of sample steps, so positions repeat and their checks are reused)
const T_STEP = 1 / EXPLODE_SAMPLES;

/** Offsets of every piece at slider value t: Map<pieceId, Vector3>. Unscheduled pieces ride with their holder. */
function pieceOffsets(plan, t) {
  const out = new Map();
  const walk = (id, acc) => {
    const n = plan.nodes.get(id);
    let off = acc;
    if (n.parent && n.start != null) {
      const k = smoothstep(clamp01((t - n.start) / Math.max(1e-6, n.end - n.start)));
      if (k > 0) off = acc.clone().addScaledVector(n.dir, n.travel * k);
    }
    out.set(id, off);
    for (const c of n.children) walk(c, off);
  };
  walk(plan.base, new THREE.Vector3());
  return out;
}

const subtreeOf = (plan, id, out = new Set()) => {
  out.add(id);
  for (const c of plan.nodes.get(id).children) subtreeOf(plan, c, out);
  return out;
};

/**
 * First overlap, for t from `from` to 1, between the parts of the pieces in `moving` and every other
 * part, with everything where the plan has it now: { t, a, b, other } or null. Pairs that overlap as
 * built, or haven't moved apart, don't count.
 */
function firstHitStep(plan, moving, from, ctx, every) {
  const rootId = [...moving][0];
  const others = [...plan.nodes.values()].filter((n) => !moving.has(n.id));
  const movers = [...moving].map((id) => plan.nodes.get(id));
  const a0 = Math.max(1, Math.ceil(from / T_STEP - 1e-9));
  for (let i = a0; i <= EXPLODE_SAMPLES; i++) {
    if (every > 1 && i % every !== 0 && i !== EXPLODE_SAMPLES) continue;
    const t = i * T_STEP;
    // The pieces not moving don't depend on this piece's start, so their offsets are kept per t
    let offs = ctx.offsetCache.get(i);
    if (!offs) {
      offs = pieceOffsets(plan, t);
      ctx.offsetCache.set(i, offs);
    }
    const node = plan.nodes.get(rootId);
    const k = node.start == null ? 0 : smoothstep(clamp01((t - node.start) / Math.max(1e-6, node.end - node.start)));
    const om = offs.get(node.parent).clone().addScaledVector(node.dir, node.travel * k);
    const mb = new THREE.Box3();
    for (const m of movers) mb.union(_box.copy(m.box).translate(om));
    for (const o of others) {
      const oo = offs.get(o.id);
      if (om.distanceToSquared(oo) < 1e-8) continue;
      if (!_box2.copy(o.box).translate(oo).intersectsBox(mb)) continue;
      for (const m of movers) {
        if (!_box.copy(m.box).translate(om).intersectsBox(_box2)) continue;
        for (const a of m.members) {
          const pa = ctx.partById.get(a);
          const ba = pa.worldBox.clone().translate(om);
          for (const b of o.members) {
            if (ctx.builtOverlap.has(pairKey(a, b))) continue;
            const pb = ctx.partById.get(b);
            if (!ba.intersectsBox(_box.copy(pb.worldBox).translate(oo))) continue;
            if (overlapCached(ctx.overlapCache, pa, pb, om, oo, ctx.tooWide)) return { t, a, b, other: o.id };
          }
        }
      }
    }
  }
  return null;
}

/** The piece in the way, when it can be hung one level higher (not already on the base). */
function liftable(plan, id, placed) {
  const n = plan.nodes.get(id);
  return n && !placed.has(id) && n.parent && n.parent !== plan.base ? id : null;
}

/** Hangs a piece on its holder's holder, keeping its way out. */
function liftNode(plan, id) {
  const n = plan.nodes.get(id);
  const parent = plan.nodes.get(n.parent);
  parent.children = parent.children.filter((c) => c !== id);
  if (!n.lifted) n.origParent = n.parent;
  n.parent = parent.parent;
  n.lifted = true;
  plan.nodes.get(n.parent).children.push(id);
  const depthOf = (x) => (x.parent ? depthOf(plan.nodes.get(x.parent)) + 1 : -1);
  for (const x of plan.nodes.values()) x.depth = depthOf(x);
}

/** firstHitStep over every sample, looking at every 4th first: most overlaps last several samples. */
function firstHit(plan, moving, from, ctx) {
  return firstHitStep(plan, moving, from, ctx, 4) || firstHitStep(plan, moving, from, ctx, 1);
}

/**
 * A piece that can't come off cleanly stays on its holder: its parts join the holder's. A piece that
 * was hung higher goes back on the holder it started on, whose path everything else was checked against.
 */
function mergeNode(plan, id, into = null) {
  const node = plan.nodes.get(id);
  let target = into ?? (node.lifted ? node.origParent : node.parent);
  while (!plan.nodes.has(target)) target = plan.mergedInto.get(target);
  const target_ = plan.nodes.get(target);
  const current = plan.nodes.get(node.parent);
  current.children = current.children.filter((c) => c !== id);
  target_.members.push(...node.members);
  target_.box.union(node.box);
  target_.children.push(...node.children);
  for (const c of node.children) plan.nodes.get(c).parent = target;
  plan.nodes.delete(id);
  plan.mergedInto.set(id, target);
}

/**
 * Gives every piece a start and end on the slider, holders first. Each piece takes the earliest
 * start (at least LAG after its holder's) at which it and everything it carries can slide out and
 * stay out without meeting any other part, as the plan stands. Every pair of parts is checked when
 * the later of their pieces is placed, against the final motion of both, so the finished plan has
 * no overlaps at any sampled slider value. A piece blocked by one that hasn't been placed yet waits
 * for it; one that still can't go travels further, and failing that stays on its holder.
 */
function schedule(plan, ctx, log, { keep = false } = {}) {
  plan.mergedInto ||= new Map();
  const base = plan.nodes.get(plan.base);
  base.start = 0;
  base.end = 0;
  base.travel = 0;
  // With `keep`, pieces already placed stay as they are and only the new ones are placed
  if (!keep) for (const n of plan.nodes.values()) if (n.parent) n.start = n.end = null;
  // No piece ever goes more than MAX_STRETCH times the travel Pass B gave it
  for (const n of plan.nodes.values()) if (n.parent) n.firstTravel ??= n.travel;
  const rank = new Map(ctx.order.map((id, i) => [id, i]));
  const placed = new Set([plan.base, ...(keep ? [...plan.nodes.values()].filter((n) => n.start != null).map((n) => n.id) : [])]);
  ctx.offsetCache = new Map();
  const lifts = new Map(); // piece -> times it was hung one level up
  const pushes = new Map(); // piece -> times it pushed the pieces in its way further out

  /**
   * The ways a piece can try to come off its holder, in order: its own way (from Pass A), going
   * further, then the other pin/shaft axes and main axes allowed by the direction choice.
   */
  const waysOut = (n) => {
    const own = { dir: n.dir, travel: n.travel };
    const ways = [own, { dir: n.dir, travel: n.travel * 2 }];
    const body = new Set();
    for (const id of subtreeOf(plan, n.id)) for (const m of plan.nodes.get(id).members) body.add(m);
    const holderParts = plan.nodes.get(n.parent).members;
    for (const d of ctx.outward(n.box, ctx.dirsFor(new Set(n.members), body))) {
      if (sameDir(d, n.dir) || ctx.ringBlocked(body, d)) continue;
      const clear = ctx.clearAlong(n.box, holderParts, d);
      ways.push({ dir: d, travel: clear + 2 * EXPLODE_GAP_MM });
    }
    return ways;
  };

  /**
   * Hangs an unplaced piece on its holder's holder, if riding there (not yet moving on its own) meets
   * nothing for the whole slider: placed pieces were checked against the path it rode before.
   */
  const tryLift = (id) => {
    const n = plan.nodes.get(id);
    const was = { parent: n.parent, lifted: n.lifted, origParent: n.origParent };
    liftNode(plan, id);
    ctx.offsetCache.clear();
    if (!firstHit(plan, subtreeOf(plan, id), 0, ctx)) return true;
    const p = plan.nodes.get(n.parent);
    p.children = p.children.filter((c) => c !== id);
    Object.assign(n, was);
    plan.nodes.get(n.parent).children.push(id);
    const depthOf = (x) => (x.parent ? depthOf(plan.nodes.get(x.parent)) + 1 : -1);
    for (const x of plan.nodes.values()) x.depth = depthOf(x);
    ctx.offsetCache.clear();
    return false;
  };

  /** Earliest start for the piece's current way out: { ok } or { ok: false, hit }. */
  const tryStarts = (n) => {
    const parent = plan.nodes.get(n.parent);
    const s0 = n.parent === plan.base ? 0 : Math.round((parent.start + LAG) / T_STEP) * T_STEP;
    const moving = subtreeOf(plan, n.id);
    let hit = null;
    for (let s = Math.min(s0, 1 - MIN_WINDOW); s <= 1 - MIN_WINDOW + 1e-9; s += START_STEP) {
      n.start = s;
      n.end = Math.min(1, s + WINDOW);
      // A piece hung higher rides a new path even before it starts: check it from the beginning
      hit = firstHit(plan, moving, n.lifted ? 0 : s, ctx);
      if (!hit) return { ok: true };
      // Blocked by something it carries, not by itself: that piece can be left behind instead
      const owner = [...moving].find((x) => plan.nodes.get(x).members.includes(hit.a));
      if (owner && owner !== n.id && !n.dropTried?.has(owner)) {
        n.start = n.end = null;
        return { ok: false, hit, dragged: owner };
      }
      (n.blockers ||= new Set()).add(hit.other);
      // In the way of a piece not placed yet: no start helps until that one is placed
      if (!placed.has(hit.other)) break;
      // Starting later only helps while what it met is still moving: then wait until it stops
      let moveEnd = -1;
      for (let q = plan.nodes.get(hit.other); q?.parent; q = plan.nodes.get(q.parent)) moveEnd = Math.max(moveEnd, q.end ?? -1);
      if (moveEnd <= hit.t) break;
      s = Math.max(s, Math.ceil((s + moveEnd - hit.t) / T_STEP - 1e-9) * T_STEP - START_STEP);
    }
    n.start = n.end = null;
    return { ok: false, hit };
  };

  /** Moves on to the piece's next way out, or keeps it on its holder when none are left. */
  const nextWay = (n, hit) => {
    n.ownDir ??= n.dir;
    n.ownTravel ??= n.travel;
    n.ways ||= waysOut(n);
    n.way = (n.way || 0) + 1;
    if (n.way < n.ways.length) {
      n.dir = n.ways[n.way].dir;
      n.travel = Math.min(n.ways[n.way].travel, n.firstTravel * MAX_STRETCH);
      return;
    }
    // Out of ways: push the pieces it ran into further out, to make room, and try again
    if ((pushes.get(n.id) || 0) < 2) {
      pushes.set(n.id, (pushes.get(n.id) || 0) + 1);
      const mine = new Set();
      for (let q = n; q; q = q.parent ? plan.nodes.get(q.parent) : null) mine.add(q.id);
      let pushed = false;
      for (const q of n.blockers || []) {
        if (q === plan.base || mine.has(q) || !placed.has(q) || !plan.nodes.has(q)) continue;
        if (pushOut(q)) pushed = true;
      }
      if (pushed) {
        n.ways = null;
        n.way = 0;
        n.dir = n.ownDir;
        n.travel = n.ownTravel;
        n.blockers = null;
        return;
      }
    }
    // Still out of ways: come off before its holder moves, hung on the holder's holder, and try again
    if (n.parent !== plan.base && (lifts.get(n.id) || 0) < 6 && tryLift(n.id)) {
      lifts.set(n.id, (lifts.get(n.id) || 0) + 1);
      n.ways = null;
      n.way = 0;
      n.dir = n.ownDir;
      n.travel = n.ownTravel;
      ctx.offsetCache.clear();
      return;
    }
    log?.(`explode: ${ctx.label(n.members[0])} stays on ${ctx.label(plan.nodes.get(n.parent).members[0])} (meets ${ctx.label(hit.b)})`);
    stayOn(n);
  };

  /**
   * Sends a placed piece further out along its way (with everything it carries), if its longer
   * slide meets nothing at any 1% of the slider.
   */
  const pushOut = (id) => {
    const q = plan.nodes.get(id);
    const was = q.travel;
    // Never more than MAX_STRETCH times its first travel, so a pushed piece stays near the robot
    for (const f of [1.6, 2.5]) {
      if (was * f > q.firstTravel * MAX_STRETCH + 1e-6) continue;
      q.travel = was * f;
      ctx.offsetCache.clear();
      if (!firstHitAll(plan, subtreeOf(plan, id), ctx)) {
        log?.(`explode: ${ctx.label(q.members[0])} goes further out to make room`);
        return true;
      }
    }
    q.travel = was;
    ctx.offsetCache.clear();
    return false;
  };

  /** Keeps an unplaced piece on its holder for good. */
  const stayOn = (n) => {
    // Only the base stays put: rather than stay on it, ride along with a piece it ran into, when
    // riding there meets nothing for the whole slider (as a frame comes off in one piece)
    if (n.parent === plan.base) {
      const mine = subtreeOf(plan, n.id);
      for (const y of n.blockers || []) {
        if (y === plan.base || !plan.nodes.has(y) || mine.has(y)) continue;
        const was = plan.nodes.get(n.parent);
        was.children = was.children.filter((c) => c !== n.id);
        n.parent = y;
        plan.nodes.get(y).children.push(n.id);
        ctx.offsetCache.clear();
        const clear = !firstHit(plan, mine, 0, ctx);
        if (clear) {
          log?.(`explode: ${ctx.label(n.members[0])} comes off with ${ctx.label(plan.nodes.get(y).members[0])}`);
          mergeNode(plan, n.id, y);
          ctx.offsetCache.clear();
          return;
        }
        plan.nodes.get(y).children = plan.nodes.get(y).children.filter((c) => c !== n.id);
        n.parent = was.id;
        was.children.push(n.id);
        ctx.offsetCache.clear();
      }
    }
    // Riding on its current holder was checked when it was hung there (or is as it always was)
    mergeNode(plan, n.id, n.parent);
    ctx.offsetCache.clear();
  };

  for (;;) {
    const ready = [...plan.nodes.values()]
      .filter((n) => !placed.has(n.id) && placed.has(n.parent))
      .sort((x, y) => x.depth - y.depth || (rank.get(x.id) ?? 0) - (rank.get(y.id) ?? 0));
    if (!ready.length) break;
    let progress = false;
    let waiting = null;
    for (const n of ready) {
      if (!plan.nodes.has(n.id) || placed.has(n.id)) continue;
      const r = tryStarts(n);
      if (r.dragged) {
        // Leave the carried piece behind on this piece's holder, if riding there meets nothing
        (n.dropTried ||= new Set()).add(r.dragged);
        let child = plan.nodes.get(r.dragged);
        while (child.parent !== n.id) child = plan.nodes.get(child.parent);
        if (tryLift(child.id)) log?.(`explode: ${ctx.label(child.members[0])} stays behind as ${ctx.label(n.members[0])} comes off`);
        progress = true;
        continue;
      }
      if (r.ok) {
        placed.add(n.id);
        ctx.progress?.(placed.size / plan.nodes.size);
        ctx.offsetCache.clear();
        progress = true;
        continue;
      }
      // Blocked by a piece still riding on its holder: it may move out of the way later
      if (!placed.has(r.hit.other)) {
        if (!waiting) waiting = { n, hit: r.hit };
        continue;
      }
      nextWay(n, r.hit);
      progress = true;
    }
    if (!progress && waiting) {
      // Everyone left is waiting: the piece in the way goes first, hung on its holder's holder
      // (as when a beam pinned across two parts has to come off before either of them)
      const blocker = liftable(plan, waiting.hit.other, placed);
      if (blocker && (lifts.get(blocker) || 0) < 6 && tryLift(blocker)) {
        lifts.set(blocker, (lifts.get(blocker) || 0) + 1);
        log?.(`explode: ${ctx.label(plan.nodes.get(blocker).members[0])} moves up a level (in the way of ${ctx.label(waiting.n.members[0])})`);
      } else {
        // Or the waiting piece tries another way out
        nextWay(waiting.n, waiting.hit);
      }
      if (!plan.nodes.has(waiting.n.id)) ctx.offsetCache.clear();
      ctx.offsetCache.clear();
    } else if (!progress) break;
  }
  const depthOf = (n) => (n.parent ? depthOf(plan.nodes.get(n.parent)) + 1 : -1);
  for (const n of plan.nodes.values()) n.depth = depthOf(n);
}

/**
 * Overlap, for every sample, between the parts of the pieces in `moving` and every other part, with
 * every piece's own motion (pieces in `moving` may already move on their own): { t, a, b, other }
 * or null. Looks at every 4th sample first.
 */
function firstHitAll(plan, moving, ctx, against = null) {
  for (const every of [4, 1]) {
    for (let i = every; i <= EXPLODE_SAMPLES; i += every) {
      const offs = pieceOffsets(plan, i * T_STEP);
      for (const mId of moving) {
        const m = plan.nodes.get(mId);
        const om = offs.get(mId);
        const mb = m.box.clone().translate(om);
        for (const [oId, o] of plan.nodes) {
          if (moving.has(oId) || (against && !against.has(oId))) continue;
          const oo = offs.get(oId);
          if (om.distanceToSquared(oo) < 1e-8 || !_box2.copy(o.box).translate(oo).intersectsBox(mb)) continue;
          for (const a of m.members) {
            const pa = ctx.partById.get(a);
            const ba = pa.worldBox.clone().translate(om);
            for (const b of o.members) {
              if (ctx.builtOverlap.has(pairKey(a, b))) continue;
              const pb = ctx.partById.get(b);
              if (!ba.intersectsBox(_box.copy(pb.worldBox).translate(oo))) continue;
              if (overlapCached(ctx.overlapCache, pa, pb, om, oo, ctx.tooWide)) return { t: i * T_STEP, a, b, other: oId };
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Only the brain stays put: whatever is still riding on the base besides the brain (and the pins in
 * it) is split into lumps of parts joined to each other (a side frame), and each lump slides off
 * the brain, biggest first, the clearest way pointing away from it, carrying the pieces held on it.
 * A lump goes only where it and everything it carries meet nothing at any 1% of the slider.
 */
function splitBase(plan, ctx, brainParts, input, mode, log) {
  const base = plan.nodes.get(plan.base);
  const brain = new Set(brainParts);
  const left = base.members.filter((m) => !brain.has(m));
  if (!left.length) return;
  // Lumps: leftover parts joined through pins, pegs or shafts
  const parent = new Map(left.map((m) => [m, m]));
  const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
  for (const pr of input.pairs) {
    if (parent.has(pr.insertOwner) && parent.has(pr.openingOwner)) parent.set(find(pr.insertOwner), find(pr.openingOwner));
  }
  for (const [a, b] of input.direct || []) if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b));
  const lumps = new Map();
  for (const m of left) (lumps.get(find(m)) || lumps.set(find(m), []).get(find(m))).push(m);
  const brainBox = new THREE.Box3();
  for (const m of brain) brainBox.union(ctx.partById.get(m).worldBox);
  const brainCenter = brainBox.getCenter(new THREE.Vector3());
  // Part-level joints, to see which pieces on the base are held by a lump rather than the brain
  const jointCount = (ids, set) => input.pairs.filter((pr) => (ids.has(pr.insertOwner) && set.has(pr.openingOwner)) || (ids.has(pr.openingOwner) && set.has(pr.insertOwner))).length;

  // Lumps of `parts` joined to each other
  const lumpsOf = (parts) => {
    const pset = new Set(parts);
    const up = new Map(parts.map((m) => [m, m]));
    const f = (x) => (up.get(x) === x ? x : (up.set(x, f(up.get(x))), up.get(x)));
    for (const pr of input.pairs) if (pset.has(pr.insertOwner) && pset.has(pr.openingOwner)) up.set(f(pr.insertOwner), f(pr.openingOwner));
    const out = new Map();
    for (const m of parts) (out.get(f(m)) || out.set(f(m), []).get(f(m))).push(m);
    return [...out.values()].sort((a, b) => b.length - a.length);
  };
  const pinnedToBrain = (m) => input.pairs.some((pr) => (pr.insertOwner === m && brain.has(pr.openingOwner)) || (pr.openingOwner === m && brain.has(pr.insertOwner)));
  const queue = [...lumps.values()].sort((a, b) => b.length - a.length).map((parts) => ({ parts, split: true }));
  while (queue.length) {
    const { parts: lumpParts, split } = queue.shift();
    const set = new Set(lumpParts);
    const box = new THREE.Box3();
    for (const m of lumpParts) box.union(ctx.partById.get(m).worldBox);
    const id = `lump:${lumpParts[0]}`;
    const node = { id, members: lumpParts, parent: plan.base, dir: null, travel: 0, children: [], box, start: null, end: null };
    // Pieces on the base held more by this lump than by the brain ride with it
    const elsewhere = new Set(base.members.filter((m) => !set.has(m))); // the brain and other lumps
    const carried = base.children.filter((c) => {
      if (String(c).startsWith('lump:')) return false; // a lump already off the brain
      const ids = new Set(plan.nodes.get(c).members);
      return jointCount(ids, set) > jointCount(ids, elsewhere);
    });
    // Starting later holds back the pieces it carries by the same amount (they never start first)
    const carriedNodes = carried.flatMap((c) => [...subtreeOf(plan, c)]).map((x) => plan.nodes.get(x));
    const times = new Map(carriedNodes.map((n) => [n.id, [n.start, n.end]]));
    const firstStart = Math.min(1, ...carriedNodes.map((n) => n.start ?? 1));
    const shiftTo = (s) => {
      const delta = Math.max(0, s - firstStart);
      for (const n of carriedNodes) {
        const [s0, e0] = times.get(n.id);
        if (s0 == null) continue;
        n.start = Math.min(1 - MIN_WINDOW, s0 + delta);
        n.end = Math.min(1, n.start + (e0 - s0));
      }
    };
    const carriedIds = new Set(carriedNodes.map((n) => n.id));
    const away = box.getCenter(new THREE.Vector3()).sub(brainCenter);
    const dirs = ctx.dirsFor(set).sort((p, q) => q.dot(away) - p.dot(away));
    const body = new Set(lumpParts);
    // Commit the lump to the tree for the trial, carrying its pieces
    plan.nodes.set(id, node);
    base.children.push(id);
    base.members = base.members.filter((m) => !set.has(m));
    for (const c of carried) {
      base.children = base.children.filter((x) => x !== c);
      node.children.push(c);
      plan.nodes.get(c).parent = id;
      for (const m of subtreeOf(plan, c)) for (const p of plan.nodes.get(m).members) body.add(p);
    }
    const moving = subtreeOf(plan, id);
    let placed = false;
    for (const d of dirs) {
      if (d.dot(away) < -1e-6 || ctx.ringBlocked(body, d) || !ctx.inPlane(body, [d]).length) continue;
      const clear = ctx.clearAlong(box, brainParts, d);
      for (const extra of [1, 2]) {
        node.dir = d;
        node.travel = clear + extra * Math.max(EXPLODE_GAP_MM, 0.5 * extentAlong(box, d));
        for (let s = 0; s <= 1 - MIN_WINDOW + 1e-9 && !placed; s += START_STEP) {
          node.start = s;
          node.end = Math.min(1, s + WINDOW);
          shiftTo(s);
          // Against everything else, and the carried pieces against the lump (it moves now)
          if (!firstHitAll(plan, moving, ctx) && !firstHitAll(plan, carriedIds, ctx, new Set([id]))) placed = true;
        }
        if (placed) break;
      }
      if (placed) break;
    }
    if (placed) {
      log?.(`explode: ${ctx.label(lumpParts[0])} and ${lumpParts.length - 1} more come off the brain together`);
      continue;
    }
    // Nowhere to go: back on the brain as it was
    shiftTo(0);
    for (const n of carriedNodes) [n.start, n.end] = times.get(n.id);
    plan.nodes.delete(id);
    base.children = base.children.filter((x) => x !== id);
    base.members.push(...lumpParts);
    for (const c of carried) {
      plan.nodes.get(c).parent = plan.base;
      base.children.push(c);
    }
    // Held onto the brain from more than one side: the parts pinned to the brain stay for now, the
    // rest comes off them first (a frame off its brain connectors), then they come off the brain
    if (split) {
      const onBrain = lumpParts.filter(pinnedToBrain);
      const rest = lumpParts.filter((m) => !onBrain.includes(m));
      if (onBrain.length && rest.length) {
        queue.unshift(...lumpsOf(rest).map((parts) => ({ parts, split: true })));
        queue.push(...lumpsOf(onBrain).flatMap((parts) => parts.map((m) => ({ parts: [m], split: false }))));
      }
    }
  }
  const depthOf = (n) => (n.parent ? depthOf(plan.nodes.get(n.parent)) + 1 : -1);
  for (const n of plan.nodes.values()) n.depth = depthOf(n);
  void mode;
}

/**
 * A lump that came off the brain whole (a side frame) comes apart once it is clear: it is planned on
 * its own (its biggest part stays), and those pieces hang below it and are placed like any other,
 * starting after it and checked against everything else's motion.
 */
function explodeLumps(plan, ctx, input, mode, log) {
  let added = 0;
  const brainBox = new THREE.Box3();
  for (const m of plan.nodes.get(plan.base).members) brainBox.union(ctx.partById.get(m).worldBox);
  const brainCenter = brainBox.getCenter(new THREE.Vector3());
  for (const node of [...plan.nodes.values()]) {
    if (!String(node.id).startsWith('lump:') || node.members.length < 2) continue;
    // Planned with everything it carries (wheels, collars, a crossbeam), so its pieces' ways out go
    // around them; what it carries is planned again with it
    const carriedNodes = node.children.flatMap((c) => [...subtreeOf(plan, c)]);
    const set = new Set(node.members);
    for (const x of carriedNodes) for (const m of plan.nodes.get(x).members) set.add(m);
    const pairs = input.pairs.filter((pr) => set.has(pr.insertOwner) && set.has(pr.openingOwner));
    // The part that stays is the lump's innermost one, nearest the brain it came off (the block an
    // axle's cap rests against): everything else slides outward off it and off the shafts' free ends
    const frame = node.members.filter((m) => ctx.partById.get(m).kind === 'part');
    const frameSet = new Set(frame);
    let basePart = frame.sort((x, y) => ctx.partById.get(x).worldBox.distanceToPoint(brainCenter) - ctx.partById.get(y).worldBox.distanceToPoint(brainCenter))[0];
    // Better: the part a capped shaft's cap rests against, on the shaft carrying the most parts
    let best = 0;
    for (const shaft of node.members.filter((m) => ctx.partById.get(m).kind === 'shaft')) {
      const seats = pairs.filter((pr) => pr.insertOwner === shaft && pr.blocks && frameSet.has(pr.openingOwner));
      if (seats.length <= best) continue;
      // Blocked going -axis means the wide end is toward +axis: the part furthest along +axis
      const toward = seats[0].blocks.minus ? 1 : -1;
      const axis = new THREE.Vector3(...seats[0].axis).multiplyScalar(toward);
      const along = (m) => ctx.partById.get(m).worldBox.getCenter(new THREE.Vector3()).dot(axis);
      best = seats.length;
      basePart = seats.map((pr) => pr.openingOwner).sort((x, y) => along(y) - along(x))[0];
    }
    const sub = buildExplodePlan(
      {
        parts: input.parts.filter((p) => set.has(p.id)),
        pairs,
        direct: (input.direct || []).filter(([a, b]) => set.has(a) && set.has(b)),
        bays: (input.bays || []).filter((b) => set.has(b.battery) && set.has(b.brain)),
        tires: (input.tires || []).filter(([a, b]) => set.has(a) && set.has(b)),
        tooWide: input.tooWide,
        center: ctx.center.toArray(),
        planeParts: input.planeParts,
        mirrorAxis: input.mirrorAxis,
        mirrorAt: input.mirrorAt,
        mirrorSide: input.mirrorSide,
        middleAxis: input.middleAxis,
        middleAt: input.middleAt,
        basePart
      },
      mode,
      { nested: true, log: log && ((m) => log(`  [lump] ${m}`)) }
    );
    if (sub.pieces.length < 2) continue;
    // Swap what the lump carried for the lump's own plan; the new pieces are placed below
    for (const x of carriedNodes) plan.nodes.delete(x);
    node.children = [];
    const idOf = (pid) => (pid === sub.base ? node.id : `sub:${node.id}:${pid}`);
    for (const sp of sub.pieces) {
      if (sp.id === sub.base) {
        node.members = sp.members.slice();
        continue;
      }
      const id = idOf(sp.id);
      const box = new THREE.Box3();
      for (const m of sp.members) box.union(ctx.partById.get(m).worldBox);
      plan.nodes.set(id, { id, members: sp.members, parent: idOf(sp.parent), dir: new THREE.Vector3(...sp.dir), travel: sp.travel, children: [], box, start: null, end: null });
      added++;
    }
    for (const sp of sub.pieces) if (sp.id !== sub.base) plan.nodes.get(idOf(sp.parent)).children.push(idOf(sp.id));
    node.box = new THREE.Box3();
    for (const m of node.members) node.box.union(ctx.partById.get(m).worldBox);
    log?.(`explode: ${ctx.label(basePart)}'s lump comes apart into ${sub.pieces.length - 1} pieces`);
  }
  if (!added) return;
  const depthOf = (n) => (n.parent ? depthOf(plan.nodes.get(n.parent)) + 1 : -1);
  for (const n of plan.nodes.values()) n.depth = depthOf(n);
  schedule(plan, ctx, log, { keep: true });
}

/**
 * Pieces stacked one beyond another and sliding the same way end at least a gap apart, inner ones
 * first: one that would end closer than that to a piece behind it (a bearing just off its side beam)
 * goes further out, taking what it carries and so pushing the pieces beyond it out too. A piece
 * that then meets anything goes back to where it was.
 */
function spreadLayers(plan, ctx, log) {
  const isUnder = (id, anc) => {
    for (let n = plan.nodes.get(id); n; n = plan.nodes.get(n.parent)) if (n.id === anc) return true;
    return false;
  };
  const moving = [...plan.nodes.values()].filter((n) => n.parent && n.dir && n.travel > 0);
  // Where a piece sits is where its biggest part sits (its pins may reach into its neighbours)
  const main = new Map(
    moving.map((n) => {
      const own = n.members.map((m) => ctx.partById.get(m)).filter((p) => p.kind !== 'pin');
      const big = (own.length ? own : n.members.map((m) => ctx.partById.get(m))).sort((p, q) => volumeOf(q.worldBox) - volumeOf(p.worldBox))[0];
      return [n.id, big.worldBox];
    })
  );
  const changed = new Map(); // node -> travel before
  for (const d of MAIN_AXES) {
    const k = Math.abs(d.x) > 0.5 ? 0 : Math.abs(d.y) > 0.5 ? 1 : 2;
    const [u, w] = [0, 1, 2].filter((i) => i !== k);
    const lo = (b) => (d.getComponent(k) > 0 ? b.min.getComponent(k) : -b.max.getComponent(k));
    const hi = (b) => (d.getComponent(k) > 0 ? b.max.getComponent(k) : -b.min.getComponent(k));
    const across = (a, b) =>
      a.min.getComponent(u) < b.max.getComponent(u) && b.min.getComponent(u) < a.max.getComponent(u) &&
      a.min.getComponent(w) < b.max.getComponent(w) && b.min.getComponent(w) < a.max.getComponent(w);
    const group = moving.filter((n) => sameDir(n.dir, d)).sort((a, b) => lo(main.get(a.id)) - lo(main.get(b.id)));
    for (let j = 1; j < group.length; j++) {
      const b = group[j];
      let need = 0;
      const offs = pieceOffsets(plan, 1);
      const bEnd = b.box.clone().translate(offs.get(b.id));
      for (let i = 0; i < j; i++) {
        const a = group[i];
        // b sits further along than a; a shaft running through what is beyond it doesn't count
        // (what it carries would have to go past its far end)
        // Only neighbours: built within two gaps of each other, and still in line at the end
        const [ma, mb] = [main.get(a.id), main.get(b.id)];
        if (lo(mb) < hi(ma) - 0.5 || lo(mb) - hi(ma) > 2 * LAYER_GAP_MM || !across(ma, mb) || isUnder(a.id, b.id)) continue;
        if (a.members.every((m) => ctx.partById.get(m).kind === 'shaft')) continue;
        if (!across(ma.clone().translate(offs.get(a.id)), mb.clone().translate(offs.get(b.id)))) continue;
        const aEnd = a.box.clone().translate(offs.get(a.id));
        need = Math.max(need, hi(aEnd) + LAYER_GAP_MM - lo(bEnd));
      }
      if (need <= 0.01) continue;
      if (!changed.has(b.id)) changed.set(b.id, b.travel);
      b.travel += need;
    }
  }
  if (!changed.size) return;
  // Take back the pushes that made something meet
  for (let round = 0; round < 10; round++) {
    const left = verifyPlan(plan, ctx);
    ctx.progress = null; // only the first check counts toward progress
    if (!left.length) break;
    const parts = new Set(left.flatMap((h) => [h.a, h.b]));
    let undone = 0;
    for (const [id, travel] of changed) {
      const sub = subtreeOf(plan, id);
      if (![...sub].some((x) => plan.nodes.get(x).members.some((m) => parts.has(m)))) continue;
      plan.nodes.get(id).travel = travel;
      changed.delete(id);
      undone++;
    }
    if (!undone) {
      for (const [id, travel] of changed) plan.nodes.get(id).travel = travel;
      changed.clear();
      break;
    }
  }
  log?.(`explode: ${changed.size} piece(s) go further out to leave room behind them`);
}

/** Every overlap left at each sampled slider value: [{ a, b, t }] (the check script's own scan). */
function verifyPlan(plan, ctx) {
  const left = [];
  const seen = new Set();
  const nodes = [...plan.nodes.values()];
  for (let i = 1; i <= EXPLODE_SAMPLES; i++) {
    ctx.progress?.(i / EXPLODE_SAMPLES);
    const t = i * T_STEP;
    const offs = pieceOffsets(plan, t);
    for (let x = 0; x < nodes.length; x++) {
      for (let y = x + 1; y < nodes.length; y++) {
        const ox = offs.get(nodes[x].id);
        const oy = offs.get(nodes[y].id);
        if (ox.distanceToSquared(oy) < 1e-8) continue;
        if (!nodes[x].box.clone().translate(ox).intersectsBox(nodes[y].box.clone().translate(oy))) continue;
        for (const a of nodes[x].members) {
          for (const b of nodes[y].members) {
            const key = pairKey(a, b);
            if (seen.has(key) || ctx.builtOverlap.has(key)) continue;
            const pa = ctx.partById.get(a);
            const pb = ctx.partById.get(b);
            if (!pa.worldBox.clone().translate(ox).intersectsBox(pb.worldBox.clone().translate(oy))) continue;
            if (overlapCached(ctx.overlapCache, pa, pb, ox, oy, ctx.tooWide)) {
              seen.add(key);
              left.push({ a, b, t: round(t, 2) });
            }
          }
        }
      }
    }
  }
  return left;
}


// ---------------------------------------------------------------------------------------------
// Mirror-image robots: one half is planned and the other half copies it, so both sides come apart
// the same way

const MIRROR_TOL_MM = 0.8;

/**
 * Builds the plan for a build and a direction choice ('x' | 'y' | 'z' | 'all').
 * `input`: { parts: [{ id, name, kind: 'pin'|'shaft'|'part', groupId, matrix, box: { min, max },
 * meshes: [{ geo, local }] }], pairs: [{ insertOwner, openingOwner, axis, depthMm, blocks }],
 * direct: [[a, b]], bays: [{ battery, brain }], tires: [[tire, hub]] }.
 * Returns { mode, base, pieces: [{ id, members, parent, depth, dir, travel, start, end }], order,
 * unplaced: [{ a, b, t }], stats }. `options.progress(f)` hears how far along it is (0..1).
 */
export function buildExplodePlan(input, mode = 'all', options = {}) {
  if (!options.nested && !input.planeParts) {
    const mirror = mirrorOf(input);
    if (mirror) return mirroredPlan(input, mode, options, mirror, fixedPoint(input));
  }
  return planCore(input, mode, options);
}

/**
 * The robot's mirror plane, when most parts pair up across it: { axis, twin: Map<part, part>,
 * plane: Set<part>, half: Set<part> } or null. A part on the plane pairs with itself, and one
 * without a partner that crosses the plane (a lopsided brain) counts as on it. Other parts with no
 * partner (a single arm motor) are planned once, where they are.
 */
function mirrorOf(input) {
  const parts = input.parts.map((p) => ({ id: p.id, box: boxOf(p.box) }));
  const all = new THREE.Box3();
  for (const p of parts) all.union(p.box);
  let best = null;
  for (let k = 0; k < 3; k++) {
    const lo = new THREE.Vector3();
    const hi = new THREE.Vector3();
    const near = (q, tol) => q.box.min.distanceTo(lo) <= tol && q.box.max.distanceTo(hi) <= tol;
    const mirrorAt = (p, c) => {
      lo.copy(p.box.min).setComponent(k, 2 * c - p.box.max.getComponent(k));
      hi.copy(p.box.max).setComponent(k, 2 * c - p.box.min.getComponent(k));
    };
    // The plane: roughly the middle of the whole robot, then exactly the middle of the pairs found there
    const rough = all.getCenter(_v).getComponent(k);
    const mids = [];
    for (const p of parts) {
      mirrorAt(p, rough);
      const q = parts.find((x) => near(x, 3));
      if (q) mids.push((p.box.min.getComponent(k) + p.box.max.getComponent(k) + q.box.min.getComponent(k) + q.box.max.getComponent(k)) / 4);
    }
    if (!mids.length) continue;
    mids.sort((a, b) => a - b);
    const c = mids[Math.floor(mids.length / 2)];
    const twin = new Map();
    for (const p of parts) {
      if (twin.has(p.id)) continue;
      mirrorAt(p, c);
      const q = near(p, MIRROR_TOL_MM) ? p : parts.find((x) => !twin.has(x.id) && near(x, MIRROR_TOL_MM));
      if (q) {
        twin.set(p.id, q.id);
        twin.set(q.id, p.id);
      } else if (p.box.min.getComponent(k) < c - 0.5 && p.box.max.getComponent(k) > c + 0.5) twin.set(p.id, p.id);
    }
    const sideOf = (p) => {
      const off = p.box.getCenter(_v).getComponent(k) - c;
      return Math.abs(off) < 0.5 ? 0 : Math.sign(off);
    };
    const pairs = parts.filter((p) => twin.has(p.id) && twin.get(p.id) !== p.id).length / 2;
    if (pairs * 2 < 0.4 * parts.length || (best && pairs <= best.pairs)) continue;
    // The half planned is the side with more parts that have no partner (they are planned as they are)
    const single = parts.filter((p) => !twin.has(p.id)).map(sideOf);
    const side = single.filter((x) => x < 0).length > single.filter((x) => x > 0).length ? -1 : 1;
    const half = new Set();
    const plane = new Set();
    for (const p of parts) {
      const t = twin.get(p.id);
      if (t === p.id) {
        plane.add(p.id);
        half.add(p.id);
      } else if (!t) half.add(p.id);
      else {
        const sp = sideOf(p);
        const st = sideOf(parts.find((x) => x.id === t));
        if (sp === side || (sp === 0 && st !== side && p.id < t)) half.add(p.id);
      }
    }
    best = { axis: k, at: c, side, twin, plane, half, pairs };
  }
  return best;
}

function mirroredPlan(input, mode, options, mirror, center) {
  const t0 = Date.now();
  const { log } = options;
  const k = mirror.axis;
  const inHalf = (id) => mirror.half.has(id);
  const both = (a, b) => inHalf(a) && inHalf(b);
  log?.(`explode: mirror image across ${'xyz'[k]}: planning ${mirror.half.size} of ${input.parts.length} parts`);
  const { progress } = options;
  const half = planCore(
    {
      ...input,
      parts: input.parts.filter((p) => inHalf(p.id)),
      pairs: input.pairs.filter((pr) => both(pr.insertOwner, pr.openingOwner)),
      direct: (input.direct || []).filter(([a, b]) => both(a, b)),
      bays: (input.bays || []).filter((b) => both(b.battery, b.brain)),
      tires: (input.tires || []).filter(([a, b]) => both(a, b)),
      center: center.toArray(),
      planeParts: [...mirror.plane],
      mirrorAxis: k,
      mirrorAt: mirror.at,
      mirrorSide: mirror.side,
      middleAxis: k,
      middleAt: mirror.at
    },
    mode,
    { ...options, progress: span(progress, 0, 0.5) }
  );

  // The whole robot's pieces: each half piece and its mirror image; a piece holding a part on the
  // plane is one piece with its mirror half
  const parts = input.parts.map(preparePart);
  const partById = new Map(parts.map((p) => [p.id, p]));
  const onPlane = (members) => members.some((id) => mirror.plane.has(id));
  const twinId = new Map(half.pieces.map((p) => [p.id, onPlane(p.members) ? p.id : `m:${p.id}`]));
  const nodes = new Map();
  const add = (id, members, parent, dir, p) => {
    const box = new THREE.Box3();
    for (const m of members) box.union(partById.get(m).worldBox);
    nodes.set(id, { id, members, parent, dir: dir && new THREE.Vector3(...dir), travel: p.travel, start: p.start, end: p.end, children: [], box });
  };
  // A piece holding a shaft through the plane (an arm's shafts, which slide out to one side) and
  // everything it holds go back on the brain, to be planned with the whole robot below
  const kids = new Map();
  for (const p of half.pieces) if (p.parent) (kids.get(p.parent) || kids.set(p.parent, []).get(p.parent)).push(p.id);
  const back = new Set();
  const sendBack = (id) => {
    back.add(id);
    for (const c of kids.get(id) || []) sendBack(c);
  };
  const across = new Set(
    input.pairs
      .filter((pr) => Math.abs(pr.axis[k]) > 0.9)
      .flatMap((pr) => [pr.insertOwner, pr.openingOwner])
      .filter((id) => mirror.plane.has(id) && partById.get(id).kind === 'shaft')
  );
  for (const p of half.pieces) if (p.id !== half.base && p.members.some((m) => across.has(m))) sendBack(p.id);
  const onBrain = [];
  for (const p of half.pieces) {
    const twins = p.members.filter((m) => !mirror.plane.has(m) && mirror.twin.has(m)).map((m) => mirror.twin.get(m));
    if (back.has(p.id)) {
      onBrain.push(...p.members, ...twins);
      continue;
    }
    if (onPlane(p.members)) {
      add(p.id, [...p.members, ...twins, ...(p.id === half.base ? onBrain : [])], p.parent, p.dir, p);
      continue;
    }
    add(p.id, p.members.slice(), p.parent, p.dir, p);
    if (twins.length) add(twinId.get(p.id), twins, p.parent && twinId.get(p.parent), p.dir && p.dir.map((v, i) => (i === k ? -v : v)), p);
  }
  const baseNode = nodes.get(half.base);
  for (const m of onBrain) if (!baseNode.members.includes(m)) baseNode.members.push(m), baseNode.box.union(partById.get(m).worldBox);
  // A mirror piece whose holder had no mirror (it held only parts without partners) hangs on that holder
  for (const n of nodes.values()) if (n.parent && !nodes.has(n.parent)) n.parent = n.parent.replace(/^m:/, '');
  for (const n of nodes.values()) if (n.parent) nodes.get(n.parent).children.push(n.id);
  const plan = { mode, base: half.base, nodes, mergedInto: new Map() };

  // A piece on the plane rides only on holders that move along it (else its two halves would part)
  const along = (n) => !n.parent || Math.abs(n.dir.getComponent(k)) < 1e-3;
  const steady = (id) => {
    for (let n = nodes.get(id); n; n = nodes.get(n.parent)) if (!along(n)) return false;
    return true;
  };
  const depthOf = (n) => (n.parent ? depthOf(nodes.get(n.parent)) + 1 : -1);
  for (const n of [...nodes.values()].sort((a, b) => depthOf(a) - depthOf(b))) {
    if (!n.parent || !nodes.has(n.id) || !onPlane(n.members)) continue;
    if (!along(n)) {
      mergeNode(plan, n.id);
      continue;
    }
    let to = n.parent;
    while (!steady(to)) to = nodes.get(to).parent;
    if (to === n.parent) continue;
    nodes.get(n.parent).children = nodes.get(n.parent).children.filter((c) => c !== n.id);
    n.parent = to;
    nodes.get(to).children.push(n.id);
  }

  // What is still on the brain (parts across the plane: a tower, an arm) comes off as on any robot,
  // planned with the whole robot
  const mirrorNode = (id) => (id.startsWith('m:') ? id.slice(2) : `m:${id}`);
  const order = [...new Set(half.order.flatMap((id) => [id, mirrorNode(id)]))].filter((id) => nodes.has(id) && id !== plan.base);
  const ctx = makeContext(input, parts, partById, builtOverlapsOf(parts, input.tooWide), center, mode, middleRuleFor({ middleAxis: k, middleAt: mirror.at }, partById), order);
  for (const n of nodes.values()) n.depth = depthOf(n);
  const base = nodes.get(plan.base);
  const { pieces: fullPieces, base: fullBase } = buildPieces({ ...input, parts });
  const brainParts = new Set(fullPieces.get(fullBase).members);
  if (base.members.some((m) => !brainParts.has(m))) {
    const set = new Set(base.members);
    const sub = planCore(
      {
        ...input,
        parts: input.parts.filter((p) => set.has(p.id)),
        pairs: input.pairs.filter((pr) => set.has(pr.insertOwner) && set.has(pr.openingOwner)),
        direct: (input.direct || []).filter(([a, b]) => set.has(a) && set.has(b)),
        bays: (input.bays || []).filter((b) => set.has(b.battery) && set.has(b.brain)),
        tires: (input.tires || []).filter(([a, b]) => set.has(a) && set.has(b)),
        center: center.toArray(),
        middleAxis: k,
        middleAt: mirror.at
      },
      mode,
      { log: log && ((m) => log(`  [middle] ${m}`)), progress: span(progress, 0.5, 0.85) }
    );
    // Its pieces hang below the brain and are placed around everything already moving
    const idOf = (id) => (id === sub.base ? plan.base : `c:${id}`);
    for (const sp of sub.pieces) {
      if (sp.id === sub.base) {
        base.members = sp.members.slice();
        continue;
      }
      const box = new THREE.Box3();
      for (const m of sp.members) box.union(partById.get(m).worldBox);
      nodes.set(idOf(sp.id), { id: idOf(sp.id), members: sp.members, parent: idOf(sp.parent), dir: new THREE.Vector3(...sp.dir), travel: sp.travel, children: [], box, start: null, end: null });
    }
    for (const sp of sub.pieces) if (sp.id !== sub.base) nodes.get(idOf(sp.parent)).children.push(idOf(sp.id));
    for (const id of sub.order) order.push(idOf(id));
    for (const n of nodes.values()) n.depth = depthOf(n);
    ctx.progress = span(progress, 0.85, 0.93);
    schedule(plan, ctx, log, { keep: true });
    ctx.progress = null;
  }
  progress?.(0.93);

  ctx.progress = span(progress, 0.93, 0.97);
  spreadLayers(plan, ctx, log);
  ctx.progress = span(progress, 0.97, 1);
  // A piece pushed further out after mirroring takes its mirror image with it
  for (const n of nodes.values()) {
    const twin = nodes.get(mirrorNode(n.id));
    if (twin && twin.travel < n.travel) twin.travel = n.travel;
  }

  // The two halves may still meet near the plane: such a piece and its mirror stay on their holders
  let unplaced = verifyPlan(plan, ctx);
  ctx.progress = null;
  for (let round = 0; unplaced.length && round < 20; round++) {
    const nodeOf = new Map();
    for (const n of nodes.values()) for (const m of n.members) nodeOf.set(m, n);
    const done = new Set();
    for (const h of unplaced) {
      const [x, y] = [nodeOf.get(h.a), nodeOf.get(h.b)];
      const n = [x, y].filter((q) => q.parent && !done.has(q.id)).sort((p, q) => (q.start ?? 0) - (p.start ?? 0))[0];
      if (!n || !nodes.has(n.id)) continue;
      log?.(`explode: ${partById.get(n.members[0]).label || n.id} stays on its holder (still meets ${partById.get(n === x ? h.b : h.a).label || ''})`);
      for (const id of [n.id, mirrorNode(n.id)]) {
        if (!nodes.has(id) || done.has(id)) continue;
        done.add(id);
        mergeNode(plan, id);
      }
    }
    unplaced = verifyPlan(plan, ctx);
  }

  for (const n of nodes.values()) n.depth = depthOf(n);
  return {
    mode,
    base: plan.base,
    pieces: [...nodes.values()].map((n) => ({
      id: n.id,
      members: n.members,
      parent: n.parent,
      depth: n.depth,
      dir: n.dir ? n.dir.toArray().map((x) => round(x, 6)) : null,
      travel: round(n.travel, 3),
      start: round(n.start, 5),
      end: round(n.end, 5)
    })),
    order: order.filter((id) => nodes.has(id)),
    unplaced,
    stats: { parts: parts.length, pieces: half.stats.pieces, moving: nodes.size - 1, mirrored: 'xyz'[k], ms: Date.now() - t0 }
  };
}

// ---------------------------------------------------------------------------------------------
// Positions

/**
 * Where every part is shown at slider value t (0..1): Map<partId, [dx, dy, dz]> offsets from its
 * assembled position, for the parts the plan moves. Works on the plain plan from buildExplodePlan.
 */
export function explodedOffsets(plan, t) {
  const out = new Map();
  if (!plan?.pieces?.length) return out;
  const byId = new Map(plan.pieces.map((p) => [p.id, p]));
  const kids = new Map();
  for (const p of plan.pieces) if (p.parent) (kids.get(p.parent) || kids.set(p.parent, []).get(p.parent)).push(p);
  const walk = (p, acc) => {
    let off = acc;
    if (p.parent) {
      const k = smoothstep(clamp01((t - p.start) / Math.max(1e-6, p.end - p.start)));
      off = [acc[0] + p.dir[0] * p.travel * k, acc[1] + p.dir[1] * p.travel * k, acc[2] + p.dir[2] * p.travel * k];
    }
    for (const m of p.members) out.set(m, off);
    for (const c of kids.get(p.id) || []) walk(c, off);
  };
  walk(byId.get(plan.base), [0, 0, 0]);
  return out;
}
