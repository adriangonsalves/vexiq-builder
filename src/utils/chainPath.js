import * as THREE from 'three';
import { angleAbout, directionAt, refAxes, wrapDeg } from './axisFrame.js';
import { quaternionToEulerDeg } from './gearMeshing.js';

/**
 * Chain and track round sprockets and standoffs (openspec chain-track-builder, chain-over-under).
 * Pure: part metadata + world poses in, link poses and sprocket turns out, so the app, the MCP
 * engine and Node checks agree.
 *
 * The parts are laid out as circles in 2D in the frame of refAxes(n) (n: the first sprocket's
 * axle): a sprocket's pitch circle, or a standoff's guide circle (its body radius plus a link's
 * half-height, where the links' pivot line rests). The loop is a list of nodes { c, s }: circle c,
 * wrapped counter-clockwise from inside the loop (s = +1, the outer parts) or clockwise from outside
 * (s = −1, an enclosed part the chain bends round, over or under it). Between nodes the chain runs
 * along the line touching both circles on those sides; round a sprocket the pivots step one tooth
 * (each link a 6.35 mm chord); round a standoff the links lie flat on its body. On a straight run
 * they are spaced evenly, as near 6.35 mm as a whole number of links allows. The count is the fewest
 * links that reach all the way round (a chain can't stretch, so it is never more than CHAIN_PLAY_MM
 * short of the path); what's left over is reported as the gap.
 *
 * Links (Chain Link, Tank Tread Attachment Link) have their roller pivot at the origin, the next
 * pivot 6.35 mm along local −Z, the pivot axis along X and +Y out of the loop (part chainSpecs).
 */

export const AXIS_PARALLEL_MIN_DOT = Math.cos(THREE.MathUtils.degToRad(2));
export const PLANE_TOLERANCE_MM = 1.0;
export const SEATED_PIVOT_TOLERANCE_MM = 0.5;
export const CHAIN_PLAY_MM = 0.75; // a chain this much short of the path still goes on (play in its joints)
export const SAG_NOTE_MM = 3.175; // more slack than half a link: the chain sags a little
// Why Upper run can't be had, for the builder dialog and the build's notes
export const UPPER_BLOCKED = "The upper run can't hold this much slack without a sharp bend, so it hangs on the lower run; move a sprocket to take some up.";
export const SAG_ASK_MM = 1; // a run hanging this far below its straight line is slack worth placing
export const LINK_HALF_HEIGHT_MM = 2.2; // a link's plates reach this far either side of its pivots
const EASE_PER_LINK_MM = 0.2; // a run's links may be drawn this much apart past 6.35 mm (inside the chain's play)
const NOT_NEIGHBOURS_MM = 13.2; // two points this far apart along the chain are on different runs
const EPS = 1e-6;

export const CHAIN_LINK_PART_NUMBER = '228-2500-230';
export const TREAD_LINK_PART_NUMBER = '228-2500-231';
export const GRIPPER_PART_NUMBER = '228-2500-239';
// What a track's tread links can carry (openspec chain-over-under, track attachments)
export const TRACK_ATTACHMENTS = {
  traction: { partNumber: GRIPPER_PART_NUMBER, one: 'gripper', many: 'grippers' },
  'short-flap': { partNumber: '228-2500-240', one: 'Short Intake Flap', many: 'Short Intake Flaps' },
  'medium-flap': { partNumber: '228-2500-241', one: 'Medium Intake Flap', many: 'Medium Intake Flaps' },
  'long-flap': { partNumber: '228-2500-242', one: 'Long Intake Flap', many: 'Long Intake Flaps' }
};
export const ATTACHMENT_EVERY_MAX = 20;

const toVec = (v) => (v?.isVector3 ? v.clone() : new THREE.Vector3(...v));
const toQuat = (r) => {
  if (r?.isQuaternion) return r.clone();
  const e = new THREE.Euler(...r.map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ');
  return new THREE.Quaternion().setFromEuler(e);
};
const round3 = (x) => Math.round(x * 1000) / 1000 + 0;

export const isSprocket = (meta) => meta?.gearSpecs?.gearType === 'sprocket' && meta.gearSpecs.measured === true;
export const isStandoff = (meta) => meta?.fastenerSpecs?.fastenerType === 'standoff';
const isToothedNonSprocket = (meta) => Boolean(meta?.gearSpecs) && meta.gearSpecs.gearType !== 'sprocket';
export const chainRole = (meta) => meta?.chainSpecs?.role || null;

/** A sprocket in world space: { instanceId, label, teeth, pitchRadius, tipRadius, center, axis, gapDir }. */
export function worldSprocket(meta, position, rotation, instanceId = null, label = null) {
  const g = meta.gearSpecs;
  const q = toQuat(rotation);
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const faceMid = g.faceSpanMm ? (g.faceSpanMm[0] + g.faceSpanMm[1]) / 2 : 0;
  return {
    kind: 'sprocket',
    instanceId,
    label: label || meta.name,
    teeth: g.teeth,
    pitchRadius: g.pitchRadiusMm,
    tipRadius: g.tipRadiusMm ?? g.pitchRadiusMm,
    chainPitch: g.chainPitchMm ?? 6.35,
    center: toVec(position).addScaledVector(axis, faceMid),
    axis,
    // Direction from the centre to a tooth gap, where a chain pivot sits
    gapDir: directionAt([0, 0, 1], g.gapPhaseDeg ?? 0).applyQuaternion(q)
  };
}

/** The radius of a standoff's round body: its largest catalog cylinder on its Z axis. */
export function standoffBodyRadius(meta) {
  const onZ = (meta.cylinders || []).filter((c) => Math.abs(Math.abs(c.axis?.[2] ?? 0) - 1) < 1e-3 && Math.hypot(c.origin?.[0] ?? 0, c.origin?.[1] ?? 0) < 0.05);
  if (onZ.length) return Math.max(...onZ.map((c) => c.radius));
  const b = meta.bbox;
  return b ? Math.min(b.size[0], b.size[1]) / 2 : 3.175;
}

/**
 * A standoff as a chain guide in world space: { kind: 'guide', instanceId, label, bodyRadius,
 * pitchRadius (where the links' pivot line rests: body + link half-height), tipRadius (body),
 * center (on its axis), axis, span: [lo, hi] its body along its local Z, hasBody }.
 */
export function worldGuide(meta, position, rotation, instanceId = null, label = null, linkHalfMm = LINK_HALF_HEIGHT_MM) {
  const f = meta.fastenerSpecs;
  const q = toQuat(rotation);
  const bodyRadius = standoffBodyRadius(meta);
  return {
    kind: 'guide',
    instanceId,
    label: label || meta.name,
    bodyRadius,
    pitchRadius: bodyRadius + linkHalfMm,
    tipRadius: bodyRadius,
    center: toVec(position),
    axis: new THREE.Vector3(0, 0, 1).applyQuaternion(q),
    span: [Math.min(f.shoulderNegZ, f.shoulderPosZ), Math.max(f.shoulderNegZ, f.shoulderPosZ)],
    hasBody: (f.bodyLengthMm ?? 0) > 0 && f.shoulderNegZ < f.shoulderPosZ
  };
}

/** Angle (rad) of a 2D vector. */
const ang = (x, y) => Math.atan2(y, x);
const mod2pi = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/**
 * The line touching circle a (wrapped on side sa) and circle b (side sb), going a → b: { m: the
 * loop's outward normal (right of travel), ta, tb: touching points, length } or null when there is
 * none (opposite sides: the circles are too close for the chain to pass between them). With signed
 * radii the same formula gives the outer line (same sides) and the crossing line (opposite sides).
 */
function signedTangent(a, sa, b, sb) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  const Ra = sa * a.r;
  const Rb = sb * b.r;
  if (L < EPS || Math.abs(Ra - Rb) >= L - EPS) return null;
  const k = (Ra - Rb) / L;
  const h = Math.sqrt(1 - k * k);
  // d̂ and its right-hand normal (−90°): outer circles stay on the left going counter-clockwise
  const ux = dx / L;
  const uy = dy / L;
  const m = [k * ux + h * uy, k * uy - h * ux];
  return {
    m,
    ta: [a.x + Ra * m[0], a.y + Ra * m[1]],
    tb: [b.x + Rb * m[0], b.y + Rb * m[1]],
    length: Math.sqrt(Math.max(0, L * L - (Ra - Rb) ** 2))
  };
}

/**
 * The outer loop round circles [{ x, y, r }] (counter-clockwise): [{ from, to, m: [mx, my] }] edges,
 * m the outward normal of the touching line, or null when no loop exists. Circles inside the loop
 * get no edge.
 */
function outerLoop(circles) {
  const n = circles.length;
  const edges = new Map(); // from → best edge
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = circles[i];
      const b = circles[j];
      const t = signedTangent(a, 1, b, 1);
      if (!t) continue;
      const [tx, ty] = t.ta;
      const m = t.m;
      const outside = circles.some((c, ci) => ci !== i && ci !== j && (c.x - tx) * m[0] + (c.y - ty) * m[1] > -c.r + 1e-4);
      if (outside) continue;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const prev = edges.get(i);
      if (!prev || L < prev.length) edges.set(i, { from: i, to: j, m, length: L });
    }
  }
  if (edges.size < 2) return null;
  const start = [...edges.keys()][0];
  const loop = [];
  const seen = new Set();
  let at = start;
  while (!seen.has(at)) {
    seen.add(at);
    const e = edges.get(at);
    if (!e) return null;
    loop.push(e);
    at = e.to;
  }
  if (at !== start || loop.length < 2) return null;
  return loop;
}

/**
 * The runs and arcs of a loop of nodes [{ c, s }]: { ok, edges: [signedTangent from node k to k+1],
 * arcs: [{ circle, s, thIn (angle of the point where the chain meets the circle), alpha (how far
 * round it the chain goes, ≥ 0, in the node's direction) }] }, or { ok: false, tooClose: [ci, cj] }.
 */
function loopPath(circles, nodes) {
  const K = nodes.length;
  const edges = [];
  for (let k = 0; k < K; k++) {
    const A = nodes[k];
    const B = nodes[(k + 1) % K];
    const e = signedTangent(circles[A.c], A.s, circles[B.c], B.s);
    if (!e) return { ok: false, tooClose: [A.c, B.c] };
    edges.push(e);
  }
  const arcs = nodes.map((nd, k) => {
    const mp = edges[(k - 1 + K) % K].m;
    const mn = edges[k].m;
    return {
      circle: nd.c,
      s: nd.s,
      thIn: ang(nd.s * mp[0], nd.s * mp[1]),
      alpha: mod2pi(nd.s * (ang(mn[0], mn[1]) - ang(mp[0], mp[1])))
    };
  });
  return { ok: true, edges, arcs };
}

/** In-plane "above" in the loop frame: world +Y, or world −Z when the parts lie flat. */
function aboveIn(frame) {
  const up = [frame.u.y, frame.v.y];
  if (Math.hypot(...up) >= 0.3) return up.map((x) => x / Math.hypot(...up));
  const down = [-frame.u.z, -frame.v.z];
  return down.map((x) => x / Math.hypot(...down));
}

/** Points along an arc of circle `c` from angle th going s·alpha, about every `stepMm` mm. */
function arcPoints(c, th, alpha, s, stepMm = 1) {
  const n = Math.max(1, Math.ceil((alpha * c.r) / stepMm));
  return Array.from({ length: n + 1 }, (_, j) => {
    const a = th + (s * alpha * j) / n;
    return [c.x + c.r * Math.cos(a), c.y + c.r * Math.sin(a)];
  });
}

/** Distance along a ray p + t·d to segment a–b, or Infinity. */
function rayHit(p, d, a, b) {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const den = d[0] * ey - d[1] * ex;
  if (Math.abs(den) < 1e-12) return Infinity;
  const wx = a[0] - p[0];
  const wy = a[1] - p[1];
  const t = (wx * ey - wy * ex) / den;
  const u = (wx * d[1] - wy * d[0]) / den;
  return t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

const segDist = (p, a, b) => {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2));
  return Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey);
};

/**
 * Which of `parts` ([{ instanceId, label, meta, position, rotation }], the selection) can carry one
 * chain: sprockets, and standoffs as smooth guides. `kind` 'chain' | 'track'. Returns { ok, error?,
 * normal, frame, circles, all (world parts, sprockets then guides), loop (outer edges), sprockets
 * (world, on the outer loop, in loop order), enclosed: [{ instanceId, label, kind, index, topRun,
 * returnRun }] (selected parts inside the outer loop; runs as { index, fromId, toId }), leftOut:
 * [{ instanceId, label, reason }] (a track's enclosed parts, reason 'outside-only') }.
 */
export function checkSprocketsForChain(parts, { kind = 'chain', route = null, linkHalfMm = LINK_HALF_HEIGHT_MM } = {}) {
  const sprocketParts = parts.filter((p) => isSprocket(p.meta));
  const guideParts = parts.filter((p) => isStandoff(p.meta));
  if (sprocketParts.length < 2) {
    const gears = parts.filter((p) => isToothedNonSprocket(p.meta));
    if (gears.length >= 2 || (gears.length && sprocketParts.length)) {
      return { ok: false, error: 'Chain and track fit sprockets, not gears. Select two or more sprockets.' };
    }
    return { ok: false, error: 'Select two or more sprockets in one plane.' };
  }
  const sprockets = sprocketParts.map((p) => worldSprocket(p.meta, p.position, p.rotation, p.instanceId, p.label));
  const n = sprockets[0].axis.clone().normalize();
  for (const s of sprockets.slice(1)) {
    if (Math.abs(s.axis.dot(n)) < AXIS_PARALLEL_MIN_DOT) {
      return { ok: false, error: `The sprockets' axles aren't parallel (${s.label}).` };
    }
  }
  const t0 = sprockets[0].center.dot(n);
  for (const s of sprockets.slice(1)) {
    const off = Math.abs(s.center.dot(n) - t0);
    if (off > PLANE_TOLERANCE_MM) {
      return { ok: false, error: `The sprockets aren't in one plane: ${s.label} is ${off.toFixed(1)} mm along its axle from ${sprockets[0].label}.` };
    }
  }
  // Standoffs: parallel, a round body, reaching across the chain's plane
  const guides = guideParts.map((p) => worldGuide(p.meta, p.position, p.rotation, p.instanceId, p.label, linkHalfMm));
  for (const g of guides) {
    if (Math.abs(g.axis.dot(n)) < AXIS_PARALLEL_MIN_DOT) {
      return { ok: false, error: `${g.label}'s axle isn't parallel to the sprockets'.` };
    }
    if (!g.hasBody) return { ok: false, error: `${g.label} has no round body for a chain to rest on.` };
    const along = g.center.dot(n);
    const dir = Math.sign(g.axis.dot(n));
    const ends = g.span.map((z) => along + dir * z);
    const lo = Math.min(...ends);
    const hi = Math.max(...ends);
    const short = t0 < lo ? lo - t0 : t0 > hi ? t0 - hi : 0;
    if (short > 0.01) {
      return { ok: false, error: `${g.label} doesn't reach the chain: its body ends ${short.toFixed(1)} mm short of the sprockets' plane.` };
    }
  }
  const all = [...sprockets, ...guides];
  const [u, v] = refAxes(n);
  const circles = all.map((s) => ({
    x: s.center.dot(u),
    y: s.center.dot(v),
    r: s.pitchRadius,
    outer: s.tipRadius,
    kind: s.kind,
    teeth: s.teeth ?? null
  }));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const d = Math.hypot(circles[i].x - circles[j].x, circles[i].y - circles[j].y);
      if (d < all[i].tipRadius + all[j].tipRadius) {
        return { ok: false, error: `${all[i].label} and ${all[j].label} overlap; move them apart.` };
      }
    }
  }
  const loop = outerLoop(circles);
  if (!loop) return { ok: false, error: 'No chain fits round these sprockets.' };
  const frame = { u, v, t0 };

  // Enclosed parts: the selected ones inside the outer loop, with the runs above and below them
  const onLoop = new Set(loop.map((e) => e.from));
  const up = aboveIn(frame);
  const enclosed = [];
  for (let i = 0; i < all.length; i++) {
    if (onLoop.has(i)) continue;
    const found = runsAround(circles, all, loop, i, up);
    if (!found.ok) return found;
    enclosed.push({ instanceId: all[i].instanceId, label: all[i].label, kind: all[i].kind === 'guide' ? 'standoff' : 'sprocket', index: i, topRun: found.topRun, returnRun: found.returnRun });
  }
  // Crossing sprockets (chain only): on the outer loop, but a straight run of the loop without them
  // would pass through them, so the chain could go either side
  const crossing = [];
  if (kind !== 'track') {
    for (const e of loop) {
      const i = e.from;
      if (all[i].kind !== 'sprocket') continue;
      const rest = outerLoopOf(circles, [...onLoop].filter((c) => c !== i));
      if (!rest || rest.filter((r) => all[r.from].kind === 'sprocket').length < 2) continue;
      const run = runThrough(circles, rest, i, linkHalfMm);
      if (!run) continue;
      const sticksOut = run.m[0] * up[0] + run.m[1] * up[1] > 0 ? 'above' : 'below';
      crossing.push({ instanceId: all[i].instanceId, label: all[i].label, kind: 'sprocket', index: i, sticksOut, outside: sticksOut === 'above' ? 'over' : 'under' });
    }
  }
  const base = {
    ok: true,
    kind,
    normal: n,
    frame,
    circles,
    all,
    loop,
    up,
    sprockets: loop.map((e) => all[e.from]).filter((s) => s.kind === 'sprocket'),
    enclosed,
    crossing,
    leftOut: kind === 'track' ? enclosed.map((e) => ({ instanceId: e.instanceId, label: e.label, reason: 'outside-only' })) : []
  };
  const asked = [...enclosed, ...crossing];
  if (route && kind !== 'track' && asked.length && asked.every((e) => route[e.instanceId] === 'over' || route[e.instanceId] === 'under')) {
    const routed = routeLoop(base, { kind, route });
    if (!routed.ok) return { ...routed, enclosed, crossing };
    const valid = validateLoop(base, routed.nodes, linkHalfMm, routed.baseLoop);
    if (!valid.ok) return { ...valid, enclosed, crossing };
  }
  return base;
}

/** The outer loop round the circles `ids` (indices into `circles`), its edges in those indices. */
function outerLoopOf(circles, ids) {
  if (ids.length < 2) return null;
  const sub = outerLoop(ids.map((c) => circles[c]));
  return sub && sub.map((e) => ({ ...e, from: ids[e.from], to: ids[e.to] }));
}

/** The straight run of `loop` passing nearest through circle `i` (tip radius plus a link half-height), or null. */
function runThrough(circles, loop, i, linkHalfMm) {
  const path = loopPath(circles, loop.map((e) => ({ c: e.from, s: 1 })));
  if (!path.ok) return null;
  const c = circles[i];
  let best = null;
  path.edges.forEach((ed, k) => {
    const d = segDist([c.x, c.y], ed.ta, ed.tb);
    if (d < c.outer + linkHalfMm && (!best || d < best.d)) best = { index: k, d, m: ed.m };
  });
  return best;
}

/**
 * The top and return runs of `loop` round part `i`: the first straight runs a ray from its centre
 * meets going up and down. Refused when a ray meets an arc first (the part sits beside a sprocket).
 */
function runsAround(circles, all, loop, i, up) {
  const path = loopPath(circles, loop.map((e) => ({ c: e.from, s: 1 })));
  const runRef = (k) => ({ index: k, fromId: all[loop[k].from].instanceId, toId: all[loop[k].to].instanceId });
  const p = [circles[i].x, circles[i].y];
  const runs = [];
  for (const d of [up, [-up[0], -up[1]]]) {
    let best = { t: Infinity, run: null, arc: null };
    path.edges.forEach((e, k) => {
      const t = rayHit(p, d, e.ta, e.tb);
      if (t < best.t) best = { t, run: k, arc: null };
    });
    path.arcs.forEach((a, k) => {
      const pts = arcPoints(circles[a.circle], a.thIn, a.alpha, a.s, 0.5);
      for (let j = 0; j + 1 < pts.length; j++) {
        const t = rayHit(p, d, pts[j], pts[j + 1]);
        if (t < best.t - 1e-6) best = { t, run: null, arc: k };
      }
    });
    if (best.arc != null) {
      const next = all[loop[best.arc].from];
      return { ok: false, error: `${all[i].label} sits right next to ${next.label}; move it so the chain passes it on a straight run.` };
    }
    if (best.run == null) return { ok: false, error: 'No chain fits round these sprockets.' };
    runs.push(runRef(best.run));
  }
  return { ok: true, topRun: runs[0], returnRun: runs[1] };
}

/**
 * The loop's nodes once the route is applied (chain only). Crossing sprockets sent the other side
 * leave the outer loop, which is rebuilt from the parts left; each goes into the rebuilt run that
 * passes through it. Enclosed parts go into their top run (under) or return run (over) of that loop.
 * Inserted parts have side −1, ordered along their run. Returns { ok, nodes, baseLoop, sides:
 * Map(index → 'outer' | 'over' | 'under') } or a refusal with `needsRoute`.
 */
function routeLoop(check, { kind, route }) {
  const { loop, enclosed, crossing = [], circles, all, up } = check;
  const sides = new Map(loop.map((e) => [e.from, 'outer']));
  if (kind === 'track') return { ok: true, nodes: loop.map((e) => ({ c: e.from, s: 1 })), baseLoop: loop, sides };
  const asked = [...enclosed, ...crossing];
  const missing = asked.filter((e) => route?.[e.instanceId] !== 'over' && route?.[e.instanceId] !== 'under');
  if (missing.length) {
    return {
      ok: false,
      error: `Choose whether the chain goes over or under ${missing.map((e) => e.label).join(', ')}.`,
      needsRoute: missing.map((e) => ({ instanceId: e.instanceId, label: e.label }))
    };
  }
  for (const x of crossing) sides.set(x.index, route[x.instanceId]);
  // Crossing sprockets passed on the other side leave the outer loop
  const inner = crossing.filter((x) => route[x.instanceId] !== x.outside);
  let baseLoop = loop;
  if (inner.length) {
    const innerIdx = new Set(inner.map((x) => x.index));
    baseLoop = outerLoopOf(circles, loop.map((e) => e.from).filter((c) => !innerIdx.has(c)));
    if (!baseLoop || baseLoop.filter((e) => all[e.from].kind === 'sprocket').length < 2) {
      return { ok: false, error: `The chain wouldn't reach ${inner[0].label} with this route.` };
    }
  }
  const inserts = baseLoop.map(() => []);
  const along = (k, ci) => {
    const a = circles[baseLoop[k].from];
    const b = circles[baseLoop[k].to];
    const c = circles[ci];
    return (c.x - a.x) * (b.x - a.x) + (c.y - a.y) * (b.y - a.y);
  };
  for (const x of inner) {
    const run = runThrough(circles, baseLoop, x.index, 0);
    if (!run) return { ok: false, error: `The chain wouldn't reach ${x.label} with this route.` };
    inserts[run.index].push({ c: x.index, along: along(run.index, x.index) });
  }
  for (const e of enclosed) {
    const side = route[e.instanceId];
    // The runs above and below it, on the loop the chain now takes
    const runs = baseLoop === loop ? e : runsAround(circles, all, baseLoop, e.index, up);
    if (!runs.topRun) return runs;
    const run = side === 'under' ? runs.topRun : runs.returnRun;
    inserts[run.index].push({ c: e.index, along: along(run.index, e.index) });
    sides.set(e.index, side);
  }
  const nodes = [];
  baseLoop.forEach((e, k) => {
    nodes.push({ c: e.from, s: 1 });
    for (const ins of inserts[k].sort((p, q) => p.along - q.along)) nodes.push({ c: ins.c, s: -1 });
  });
  return { ok: true, nodes, baseLoop, sides };
}

/**
 * The loop's path as points about every mm: [{ p: [x, y], at: mm along the chain, node (the part
 * whose arc it's on, or null), run (the run it's on, or null) }] and its total length.
 */
function samplePath(circles, nodes, path) {
  const K = nodes.length;
  const pts = [];
  let at = 0;
  const add = (p, owner) => {
    if (pts.length) at += Math.hypot(p[0] - pts.at(-1).p[0], p[1] - pts.at(-1).p[1]);
    pts.push({ p, at, ...owner });
  };
  for (let k = 0; k < K; k++) {
    const a = path.arcs[k];
    for (const p of arcPoints(circles[a.circle], a.thIn, a.alpha, a.s, 1)) add(p, { node: k, run: null });
    const e = path.edges[k];
    const steps = Math.max(1, Math.ceil(e.length));
    for (let j = 1; j < steps; j++) add([e.ta[0] + ((e.tb[0] - e.ta[0]) * j) / steps, e.ta[1] + ((e.tb[1] - e.ta[1]) * j) / steps], { node: null, run: k, frac: j / steps });
  }
  const last = pts.at(-1).p;
  return { pts, total: at + Math.hypot(pts[0].p[0] - last[0], pts[0].p[1] - last[1]) };
}

/** True when open segments a–b and c–d cross each other. */
function segmentsCross(a, b, c, d) {
  const ccw = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = ccw(a, b, c);
  const d2 = ccw(a, b, d);
  const d3 = ccw(c, d, a);
  const d4 = ccw(c, d, b);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

/**
 * Can the chain go this way round? Refuses (first failure wins, naming the parts) when two parts
 * are too close for the chain to pass between them, an outer part would lose the chain or an
 * enclosed one wouldn't be reached, the loop would cross itself, the chain would pass through a
 * selected part, or two runs would touch. Returns { ok, path } or { ok: false, error }.
 */
function validateLoop(check, nodes, linkHalfMm, baseLoop = check.loop) {
  const { circles, all } = check;
  const label = (ci) => all[ci].label;
  const path = loopPath(circles, nodes);
  if (!path.ok) {
    const [a, b] = path.tooClose;
    return { ok: false, error: `${label(a)} and ${label(b)} are too close for the chain to pass between them.` };
  }
  const K = nodes.length;
  const outerPath = loopPath(circles, baseLoop.map((e) => ({ c: e.from, s: 1 })));
  const outerAlpha = new Map(outerPath.ok ? outerPath.arcs.map((a) => [a.circle, a.alpha]) : []);
  // One full turn: an outer part wrapped the wrong way adds a turn, an enclosed one takes one away
  const turning = path.arcs.reduce((sum, a) => sum + a.s * a.alpha, 0);
  if (Math.abs(turning - 2 * Math.PI) > 1e-3) {
    const side = turning > 2 * Math.PI ? 1 : -1;
    const culprit = path.arcs.filter((a) => a.s === side).sort((p, q) => q.alpha - p.alpha)[0];
    return {
      ok: false,
      error: side > 0 ? `${label(culprit.circle)} would no longer touch the chain with this route.` : `The chain wouldn't reach ${label(culprit.circle)} with this route.`
    };
  }
  const lostOuter = path.arcs.find((a) => a.s > 0 && outerAlpha.has(a.circle) && a.alpha - outerAlpha.get(a.circle) > Math.PI / 2);
  if (lostOuter) {
    return { ok: false, error: `${label(lostOuter.circle)} would no longer touch the chain with this route.` };
  }
  const edgePart = (k) => (nodes[k].s < 0 ? nodes[k].c : nodes[(k + 1) % K].c);
  for (let i = 0; i < K; i++) {
    for (let j = i + 1; j < K; j++) {
      if (segmentsCross(path.edges[i].ta, path.edges[i].tb, path.edges[j].ta, path.edges[j].tb)) {
        const a = label(edgePart(i));
        const b = label(edgePart(j));
        return { ok: false, error: a === b ? `The chain would cross itself round ${a}.` : `The chain would cross itself between ${a} and ${b}.` };
      }
    }
  }
  const { pts, total } = samplePath(circles, nodes, path);
  // Passing through a part: a part it doesn't wrap, or one it wraps elsewhere on the loop
  const nodeOf = new Map(nodes.map((nd, k) => [nd.c, k]));
  for (let ci = 0; ci < circles.length; ci++) {
    const c = circles[ci];
    const k = nodeOf.get(ci);
    const prevK = k != null ? (k - 1 + K) % K : -1;
    const nextK = k != null ? (k + 1) % K : -1;
    const own = (q) => k != null && (q.node === k || q.node === prevK || q.node === nextK || q.run === k || q.run === prevK);
    const clear = (k == null ? c.outer + linkHalfMm : c.kind === 'guide' ? c.r : c.r + linkHalfMm) - 0.05;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      const next = pts[(i + 1) % pts.length];
      if (own(q) || own(next)) continue;
      if (segDist([c.x, c.y], q.p, next.p) < clear) return { ok: false, error: `The chain would pass through ${label(ci)}.` };
    }
  }
  // Two runs touching: points far apart along the chain closer than two link half-heights
  const partOf = (q) => (q.node != null ? nodes[q.node].c : nodes[q.frac < 0.5 ? q.run : (q.run + 1) % K].c);
  const touchMm = 2 * linkHalfMm;
  let worst = null;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const along = Math.min(pts[j].at - pts[i].at, total - (pts[j].at - pts[i].at));
      if (along <= NOT_NEIGHBOURS_MM) continue;
      const d = Math.hypot(pts[i].p[0] - pts[j].p[0], pts[i].p[1] - pts[j].p[1]);
      if (d < touchMm - 1e-6 && (!worst || d < worst.d)) worst = { d, a: pts[i], b: pts[j] };
    }
  }
  if (worst) {
    const a = label(partOf(worst.a));
    const b = label(partOf(worst.b));
    return { ok: false, error: a === b ? `The chain's runs would touch near ${a}.` : `The chain's runs would touch between ${a} and ${b}.` };
  }
  return { ok: true, path };
}

/** A standoff's turn per link: the angle a 6.35 mm chord on its guide circle spans. */
const guideStep = (r, pitch) => 2 * Math.asin(Math.min(1, pitch / (2 * r)));

/**
 * The true length of the loop in links (real number): whole teeth round each sprocket arc, the arc
 * length over the chain pitch round each standoff, plus the straight runs over the chain pitch.
 */
function exactLinks(circles, path, pitch) {
  const arcLinks = path.arcs.reduce((sum, a) => {
    const c = circles[a.circle];
    if (c.kind === 'guide') return sum + (a.alpha * c.r) / pitch;
    return sum + a.alpha / ((2 * Math.PI) / c.teeth);
  }, 0);
  return arcLinks + path.edges.reduce((sum, e) => sum + e.length / pitch, 0);
}

/**
 * The whole chain. `parts` as for checkSprocketsForChain; `kind` 'chain' | 'track'; `route` (chain
 * only) { instanceId: 'over' | 'under' } for each enclosed part; `attachment` (track only:
 * 'none' or a TRACK_ATTACHMENTS key; default from `grippers`, the older form: true = 'traction')
 * on every `attachmentEvery`th tread link (1–20); `slack`
 * 'lower' | 'upper': which run holds a slack chain's spare length when the parts stand up (the upper
 * run hangs down into the loop); `metaByPartNumber(pn)` → part metadata for the link and gripper parts.
 * Returns { ok, error?, needsRoute?, linkPart, gripperPart, links: [{ partId, position, rotation }],
 *   grippers: [...], sprocketTurns: [{ instanceId, axis, point, deg }], onLoop, wrapped: [{ instanceId,
 *   side: 'outer' | 'over' | 'under', outside (wrapped from inside the loop, as an outer part) }], leftOut: [{ instanceId, reason }], sprocketCount,
 *   standoffCount, linkCount, exactLinks, gapMm, moveHint, notes, slack, sagMm, slackChoice, upperBlocked }.
 *   `sagMm` is how far the hanging run drops below its straight line; `slackChoice` is true when that
 *   is SAG_ASK_MM or more, the parts stand up and a run faces up; `upperBlocked` when no upper run
 *   can hang the slack without a sharp bend (UPPER_BLOCKED says why); `slack` is the run used
 *   ('lower', 'upper', or null when flat).
 */
export function buildChainPath(parts, { kind = 'chain', grippers = false, attachment = null, attachmentEvery = 1, route = null, slack = 'lower', metaByPartNumber }) {
  const linkPart = metaByPartNumber(kind === 'track' ? TREAD_LINK_PART_NUMBER : CHAIN_LINK_PART_NUMBER);
  const linkHalfMm = linkPart?.bbox ? Math.abs(linkPart.bbox.min[1]) : LINK_HALF_HEIGHT_MM;
  const check = checkSprocketsForChain(parts, { kind, linkHalfMm });
  if (!check.ok) return check;
  const attach = kind !== 'track' ? 'none' : attachment ?? (grippers ? 'traction' : 'none');
  if (attach !== 'none' && !TRACK_ATTACHMENTS[attach]) {
    return { ok: false, error: `attachment must be "none", ${Object.keys(TRACK_ATTACHMENTS).map((k) => `"${k}"`).join(', ')}.` };
  }
  const every = Number(attachmentEvery);
  if (!Number.isInteger(every) || every < 1 || every > ATTACHMENT_EVERY_MAX) {
    return { ok: false, error: `attachmentEvery must be a whole number from 1 to ${ATTACHMENT_EVERY_MAX}.` };
  }
  const gripperPart = attach !== 'none' ? metaByPartNumber(TRACK_ATTACHMENTS[attach].partNumber) : null;
  if (!linkPart?.chainSpecs) return { ok: false, error: `The ${kind === 'track' ? 'tread' : 'chain'} link part is missing from the library.` };
  if (attach !== 'none' && !gripperPart?.chainSpecs?.seatInLink) return { ok: false, error: `The ${TRACK_ATTACHMENTS[attach].one} part is missing from the library.` };

  const routed = routeLoop(check, { kind, route });
  if (!routed.ok) return routed;
  const { nodes, sides } = routed;
  const { normal: n, frame, circles, all } = check;
  if (nodes.filter((nd) => circles[nd.c].kind === 'sprocket').length < 2) {
    return { ok: false, error: `A ${kind} needs two or more sprockets on its outside.` };
  }
  const valid = validateLoop(check, nodes, linkHalfMm, routed.baseLoop);
  if (!valid.ok) return valid;
  const { path } = valid;
  const pitch = linkPart.chainSpecs.pitchMm;
  const exact = exactLinks(circles, path, pitch);

  // Never tighter than the path allows: round up, unless it's within the chain's play
  const target = Math.max(2, Math.ceil(exact - CHAIN_PLAY_MM / pitch));
  // A slack chain sags on one run ending on a sprocket (where the walk starts): the lower run, or with
  // `slack` 'upper' an upper one (it may touch a part the chain bends round)
  const K = nodes.length;
  const endsOnSprocket = (k) => circles[nodes[(k + 1) % K].c].kind === 'sprocket';
  const outerRun = (k) => nodes[k].s > 0 && nodes[(k + 1) % K].s > 0;
  const ending = nodes.map((_, k) => k).filter(endsOnSprocket);
  const down = new THREE.Vector3(0, -1, 0);
  const down2 = [down.dot(frame.u), down.dot(frame.v)];
  const standing = Math.hypot(...down2) > 0.3;
  const downness = (k) => (path.edges[k].m[0] * down2[0] + path.edges[k].m[1] * down2[1]) / Math.hypot(...down2);
  const outerRuns = ending.filter(outerRun);
  // Lower: a run facing the floor that hangs the slack without folding into a kink, an outer one if
  // any (it may touch a part the chain bends round, as when the return run goes over one), the one
  // facing the floor most; the longest outer run when the parts lie flat
  const lowness = (k) => (standing ? downness(k) : path.edges[k].length);
  const lowerTried = standing
    ? ending
        .filter((k) => downness(k) > 0.25)
        .map((k) => ({ k, walk: planChain(circles, nodes, path, pitch, target, k, down2) }))
        .filter((c) => c.walk && c.walk.sag.clean)
    : [];
  const lowerPick = lowerTried.filter((c) => outerRun(c.k)).length ? lowerTried.filter((c) => outerRun(c.k)) : lowerTried;
  const lowerRun = lowerPick.length
    ? lowerPick.reduce((b, c) => (lowness(c.k) > lowness(b.k) ? c : b)).k
    : outerRuns.length
      ? outerRuns.reduce((best, k) => (lowness(k) > lowness(best) ? k : best), outerRuns[0])
      : null;
  // Upper: runs facing up that hang the slack into the loop without folding into a kink; of those, the
  // one whose closing joins bend least (bendCost), then the most the top of the loop (how much it faces
  // up times how long it is). None: there's no upper run to offer, and the slack goes on the lower run.
  const upperTried = standing
    ? ending
        .filter((k) => downness(k) < -0.25)
        .map((k) => ({ k, top: -downness(k) * path.edges[k].length, walk: planChain(circles, nodes, path, pitch, target, k, down2) }))
        .filter((c) => c.walk && c.walk.sag.clean)
    : [];
  const upperOffered = upperTried.some((c) => c.k !== lowerRun);
  // A run facing up that can't hang the slack without a sharp bend: still asked, with Upper run unavailable
  const upperFacing = standing && ending.some((k) => k !== lowerRun && downness(k) < -0.25);
  const upper = standing && slack === 'upper' && upperTried.length > 0;
  let candidates = upper ? upperTried.map((c) => c.k) : lowerRun != null ? [lowerRun, ...outerRuns.filter((k) => k !== lowerRun)] : outerRuns;
  if (!candidates.length) {
    // Every run touches a part the chain bends round: the longest takes the slack
    candidates = [ending.reduce((best, k) => (path.edges[k].length > path.edges[best].length ? k : best), ending[0])];
  }
  const sagRun = upper
    ? upperTried.reduce((b, c) => (c.walk.sag.kink < b.walk.sag.kink - 1e-6 || (Math.abs(c.walk.sag.kink - b.walk.sag.kink) <= 1e-6 && c.top > b.top) ? c : b)).k
    : lowerRun ?? candidates.reduce((best, k) => (lowness(k) > lowness(best) ? k : best), candidates[0]);
  // The facing run unless closing on another needs fewer links
  let walk = planChain(circles, nodes, path, pitch, target, sagRun, down2);
  if (!walk || walk.pivots2d.length > target) {
    for (const k of candidates) {
      if (k === sagRun) continue;
      const other = planChain(circles, nodes, path, pitch, target, k, down2);
      if (other && (!walk || other.pivots2d.length < walk.pivots2d.length)) walk = other;
    }
  }
  if (!walk) return { ok: false, error: 'No chain fits round these sprockets.' };
  const { pivots2d, arcPivotIndex } = walk;
  const total = pivots2d.length;
  const { u, v, t0 } = frame;
  const to3d = ([x, y]) => new THREE.Vector3().addScaledVector(n, t0).addScaledVector(u, x).addScaledVector(v, y);
  const pivots = pivots2d.map(to3d);

  // Link poses: −Z along the chain, +Y out of the loop (d × n going counter-clockwise), X = Y × Z
  const links = [];
  const gripperPoses = [];
  const seat = gripperPart ? toVec(gripperPart.chainSpecs.seatInLink) : null;
  for (let i = 0; i < pivots.length; i++) {
    const p = pivots[i];
    const d = pivots[(i + 1) % pivots.length].clone().sub(p).normalize();
    const zAxis = d.clone().negate();
    const yAxis = new THREE.Vector3().crossVectors(d, n).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    const rotation = quaternionToEulerDeg(q);
    links.push({ partId: linkPart.id, position: p.toArray().map(round3), rotation });
    if (seat && i % every === 0) {
      const gp = seat.clone().applyQuaternion(q).add(p);
      gripperPoses.push({ partId: gripperPart.id, position: gp.toArray().map(round3), rotation });
    }
  }

  // Sprocket turns: a tooth gap at the nearest pivot on its arc, the smallest turn (standoffs stay)
  const sprocketTurns = [];
  nodes.forEach((nd, k) => {
    const s = all[nd.c];
    if (s.kind !== 'sprocket') return;
    const idx = arcPivotIndex[k];
    if (idx == null) return;
    const a = s.axis.clone().normalize();
    const gap = angleAbout(a, s.gapDir);
    const pivotAngle = angleAbout(a, to3d(pivots2d[idx]).sub(s.center));
    const deg = Math.round(wrapDeg(pivotAngle - gap, 360 / s.teeth) * 1000) / 1000 + 0;
    if (Math.abs(deg) >= 0.005) sprocketTurns.push({ instanceId: s.instanceId, axis: a.toArray(), point: s.center.toArray(), deg });
  });

  const gapMm = round3((exact - total) * pitch);
  const moveHint = Math.abs(gapMm) >= 0.05 ? suggestMove(check, nodes, pitch, gapMm) : null;
  const notes = [];
  if (-gapMm > SAG_NOTE_MM) notes.push('It will sag a little; move a sprocket for a snug fit.');
  if (slack === 'upper' && standing && !upper) notes.push(UPPER_BLOCKED);
  // Attachments on links 0, N, 2N, …: the gap from the last one round to the first may be shorter
  if (gripperPoses.length && links.length % every !== 0) {
    const lastGap = links.length - Math.floor((links.length - 1) / every) * every;
    notes.push(`The last gap between ${TRACK_ATTACHMENTS[attach].many} is ${plural(lastGap, 'link', 'links')}, not ${every}.`);
  }
  const onLoopParts = nodes.map((nd) => all[nd.c]);
  return {
    ok: true,
    kind,
    linkPart,
    gripperPart,
    links,
    grippers: gripperPoses,
    attachment: attach,
    attachmentEvery: attach === 'none' ? null : every,
    sprocketTurns,
    onLoop: onLoopParts.map((s) => s.instanceId),
    wrapped: nodes.map((nd) => ({ instanceId: all[nd.c].instanceId, side: sides.get(nd.c), outside: nd.s > 0 })),
    leftOut: check.leftOut.map((l) => ({ instanceId: l.instanceId, reason: l.reason })),
    sprocketCount: onLoopParts.filter((s) => s.kind === 'sprocket').length,
    standoffCount: onLoopParts.filter((s) => s.kind === 'guide').length,
    slack: standing ? (upper ? 'upper' : 'lower') : null,
    sagMm: walk.sag.depthMm,
    slackChoice: standing && (upperOffered || upperFacing) && walk.sag.depthMm >= SAG_ASK_MM,
    upperBlocked: !upperOffered,
    linkCount: links.length,
    exactLinks: Math.round(exact * 1000) / 1000,
    gapMm,
    sag: walk.sag,
    moveHint,
    notes,
    labelOf: Object.fromEntries(all.map((s) => [s.instanceId, s.label]))
  };
}

/**
 * The q − 1 inner pivots of a sagging run from `a` to `b` ([x, y]): q links of `pitch` on a circular
 * arc bowed to the right of a→b (side +1, out of a counter-clockwise loop) or to the left (side −1).
 * A run as long as its links is straight.
 */
function sagPoints(a, b, q, pitch, side = 1) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const D = Math.hypot(dx, dy);
  const straight = () => Array.from({ length: q - 1 }, (_, j) => [a[0] + (dx * (j + 1)) / q, a[1] + (dy * (j + 1)) / q]);
  if (q < 2 || D >= q * pitch - 1e-9) return straight();
  // The turn per link φ: the chord of q links of `pitch` on a circle, p·sin(qφ/2)/sin(φ/2), equals D
  let lo = 1e-9;
  let hi = (2 * Math.PI) / q - 1e-9;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if ((pitch * Math.sin((q * mid) / 2)) / Math.sin(mid / 2) > D) lo = mid;
    else hi = mid;
  }
  const phi = (lo + hi) / 2;
  const rho = pitch / (2 * Math.sin(phi / 2));
  const out = [(side * dy) / D, (-side * dx) / D]; // the side it bows to
  const h = rho * Math.cos((q * phi) / 2);
  const c = [(a[0] + b[0]) / 2 - out[0] * h, (a[1] + b[1]) / 2 - out[1] * h];
  const a0 = ang(a[0] - c[0], a[1] - c[1]);
  const pointsFor = (sign) => Array.from({ length: q - 1 }, (_, j) => [c[0] + rho * Math.cos(a0 + sign * (j + 1) * phi), c[1] + rho * Math.sin(a0 + sign * (j + 1) * phi)]);
  // The way round that ends at b
  const endFor = (sign) => Math.hypot(c[0] + rho * Math.cos(a0 + sign * q * phi) - b[0], c[1] + rho * Math.sin(a0 + sign * q * phi) - b[1]);
  return pointsFor(endFor(1) < endFor(-1) ? 1 : -1);
}

/**
 * The q − 1 inner pivots of a slack run from `a` to `b` ([x, y]) hanging under gravity: q links of
 * `pitch` on a catenary sagging toward `down` (a unit [x, y]). The curve's length is tuned so q chords
 * of `pitch` walked along it land exactly on b. Falls back to sagPoints when the run is nearly
 * vertical (no sideways sag to show).
 */
function hangPoints(a, b, q, pitch, down, side = 1) {
  const D = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (q < 2 || D >= q * pitch - 1e-9) return sagPoints(a, b, q, pitch, side);
  // Frame: ey up (against gravity), ex across
  const ey = [-down[0], -down[1]];
  const ex = [ey[1], -ey[0]];
  const toF = (p) => [p[0] * ex[0] + p[1] * ex[1], p[0] * ey[0] + p[1] * ey[1]];
  const fromF = ([x, y]) => [x * ex[0] + y * ey[0], x * ex[1] + y * ey[1]];
  let [A, B] = [toF(a), toF(b)];
  const flip = A[0] > B[0];
  if (flip) [A, B] = [B, A];
  const h = B[0] - A[0];
  const v = B[1] - A[1];
  if (h < 0.05 * D) return sagPoints(a, b, q, pitch, side);

  // y = k·cosh((x − x0)/k) + c with arc length S between A and B
  const curve = (S) => {
    const L0 = Math.sqrt(Math.max(S * S - v * v, 1e-12));
    // 2k·sinh(h / 2k) = L0, decreasing in k
    let lo = 1e-3;
    let hi = 1e7;
    for (let i = 0; i < 200; i++) {
      const mid = Math.sqrt(lo * hi);
      if (2 * mid * Math.sinh(Math.min(h / (2 * mid), 700)) > L0) lo = mid;
      else hi = mid;
    }
    const k = Math.sqrt(lo * hi);
    const x0 = (A[0] + B[0]) / 2 - k * Math.asinh(v / L0);
    const c = A[1] - k * Math.cosh((A[0] - x0) / k);
    return (x) => k * Math.cosh((x - x0) / k) + c;
  };
  // Walk q − 1 chords of `pitch` along the curve from A; returns the pivots
  const N = 400;
  const walk = (y) => {
    const pts = [];
    let cur = A;
    let prev = A;
    for (let n = 1; n <= N && pts.length < q - 1; n++) {
      const x = A[0] + (h * n) / N;
      const p = [x, y(x)];
      while (pts.length < q - 1 && Math.hypot(p[0] - cur[0], p[1] - cur[1]) >= pitch) {
        // Between prev and p: the point at `pitch` from cur
        let l0 = 0;
        let l1 = 1;
        for (let i = 0; i < 40; i++) {
          const m = (l0 + l1) / 2;
          const xm = prev[0] + (p[0] - prev[0]) * m;
          const pm = [xm, y(xm)];
          if (Math.hypot(pm[0] - cur[0], pm[1] - cur[1]) < pitch) l0 = m;
          else l1 = m;
        }
        const xm = prev[0] + (p[0] - prev[0]) * l1;
        cur = [xm, y(xm)];
        pts.push(cur);
        prev = cur;
      }
      prev = p;
    }
    return pts;
  };
  // Longer curve → the walk ends further from B; tune so the last chord is exactly `pitch`
  const missBy = (S) => {
    const pts = walk(curve(S));
    if (pts.length < q - 1) return -1; // ran out of curve: too short
    const last = pts.at(-1);
    return Math.hypot(B[0] - last[0], B[1] - last[1]) - pitch;
  };
  let lo = D * (1 + 1e-6);
  let hi = q * pitch * 1.05;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (missBy(mid) > 0) hi = mid;
    else lo = mid;
  }
  const pts = walk(curve((lo + hi) / 2));
  if (pts.length < q - 1) return sagPoints(a, b, q, pitch, side);
  const out = (flip ? pts.reverse() : pts).map(fromF);
  return out;
}

/**
 * The pivot loop, counter-clockwise: [x, y] points in the loop frame, `target` of them (one per link).
 * The walk starts where the chain leaves the sprocket after run `sagRun` and goes link by link: each
 * run lands where the chain meets the next part (its touching point from the last pivot), with the
 * whole number of links that fits it best. A run onto a sprocket is straight and tight: eased a hair
 * longer to reach the touching point, or landing a little past it (wrapping a little less, turning
 * in by less than a tooth) when the links overreach; a run onto a standoff with links to spare bows
 * a little. Round a sprocket
 * the links step one tooth (a 6.35 mm chord), in the node's direction; round a standoff they lie
 * flat on its body (pivots on the circle where a link's middle touches the guide circle, or one
 * pivot at the corner for a shallow wrap). The last run, `sagRun`, closes the loop: it lands on the
 * first sprocket a whole number of teeth before the start, as near its touching point as the link
 * count allows, and holds what's left over: hanging on a catenary toward the floor (`down2`, gravity
 * in the loop frame, so into the loop on a run facing up; out of the loop when the parts lie flat)
 * when the chain is longer than the path, eased straight (within the chain's play) when shorter.
 * Returns { pivots2d, arcPivotIndex: [index of a pivot on each loop part], sag: { run, mm, depthMm } }
 * or null.
 */
function planChain(circles, nodes, path, pitch, target, sagRun = 0, down2 = [0, 0]) {
  const { arcs } = path;
  const K = nodes.length;
  const circleOf = (k) => circles[nodes[k].c];
  const sOf = (k) => nodes[k].s;
  const isGuide = (k) => circleOf(k).kind === 'guide';
  // On a standoff each link's straight side rests on the post (the guide circle, its body plus a link
  // half-height), so its pivots sit further out, on a circle the link's middle just touches
  const pivotR = (k) => (isGuide(k) ? Math.hypot(circleOf(k).r, pitch / 2) : circleOf(k).r);
  const tau = (k) => (isGuide(k) ? 2 * Math.atan2(pitch / 2, circleOf(k).r) : (2 * Math.PI) / circleOf(k).teeth);
  const at = (k, th, r = pivotR(k)) => {
    const c = circleOf(k);
    return [c.x + r * Math.cos(th), c.y + r * Math.sin(th)];
  };
  const thOut = (k) => arcs[k].thIn + sOf(k) * arcs[k].alpha;
  // `th` moved by whole turns to within half a turn of `ref`
  const near = (th, ref) => ref + (mod2pi(th - ref + Math.PI) - Math.PI);
  // How far round part k the chain goes from angle th to where it leaves
  const wrapFrom = (k, th) => sOf(k) * (near(thOut(k), th + sOf(k) * arcs[k].alpha) - th);
  // Where a chain from `from` meets circle k: the touching point nearest the loop's own
  const touching = (from, k) => {
    const c = circleOf(k);
    const d = Math.hypot(from[0] - c.x, from[1] - c.y);
    if (d <= c.r) return null;
    const toFrom = ang(from[0] - c.x, from[1] - c.y);
    const half = Math.acos(c.r / d);
    const ref = arcs[k].thIn;
    const both = [near(toFrom + half, ref), near(toFrom - half, ref)];
    const th = Math.abs(both[0] - ref) <= Math.abs(both[1] - ref) ? both[0] : both[1];
    return { th, length: Math.sqrt(d * d - c.r * c.r) };
  };
  // A run bows away from a standoff end, out of the loop between outer parts, in between enclosed ones
  const bowSide = (k) => {
    const a = sOf(k);
    const b = sOf((k + 1) % K);
    if (a === b) return a;
    if (isGuide((k + 1) % K)) return b;
    if (isGuide(k)) return a;
    return 1;
  };
  // The pivots on part k from where the chain meets it at angle th
  // `exact`: a standoff's first pivot at th itself (where a straight run lands), not centred on the wrap
  const onPart = (k, th, exact = false) => {
    const s = sOf(k);
    const w = wrapFrom(k, th);
    if (!isGuide(k) || exact) {
      if (isGuide(k)) {
        const m = Math.max(0, Math.floor(w / tau(k) + 1e-9));
        return Array.from({ length: m + 1 }, (_, j) => at(k, th + s * j * tau(k)));
      }
      const m = Math.max(0, Math.round(w / tau(k)));
      return Array.from({ length: m + 1 }, (_, j) => at(k, th + s * j * tau(k)));
    }
    const step = tau(k);
    const ww = Math.max(0, w);
    const m = Math.floor(ww / step);
    const startTh = th + (s * (ww - m * step)) / 2;
    return Array.from({ length: m + 1 }, (_, j) => at(k, startTh + s * j * step));
  };

  // How much the chain bends at p1: a turn back out of the loop (against the way the loop goes round)
  // counts three times over, since a chain hanging or under tension doesn't bend that way at a
  // sprocket; turning in by more than a tooth step (`step`) is a kink and worse than either
  const bendCost = (p0, p1, p2, step) => {
    const t = mod2pi(ang(p2[0] - p1[0], p2[1] - p1[1]) - ang(p1[0] - p0[0], p1[1] - p0[1]) + Math.PI) - Math.PI;
    return t >= 0 ? t + (t > step + 0.005 ? 5 : 0) : -3 * t;
  };

  // The point on circle k at distance L from `from`, on the same side as the touching angle `thT`
  const landAt = (from, k, L, thT, r = pivotR(k)) => {
    const c = circleOf(k);
    const d = Math.hypot(from[0] - c.x, from[1] - c.y);
    const cos = (d * d + r * r - L * L) / (2 * d * r);
    if (cos > 1 || cos < -1) return null;
    const toFrom = ang(from[0] - c.x, from[1] - c.y);
    const side = Math.sign(mod2pi(thT - toFrom + Math.PI) - Math.PI) || 1;
    return near(toFrom + side * Math.acos(cos), thT);
  };

  // A run landing on standoff k from `from` (t: where it touches the guide circle): n whole links to a
  // first pivot on the standoff, then pivots one link apart round it until the chain can leave for the
  // next part without cutting into the post. Of the link counts that keep the run off the post too,
  // the one that bends least (bendCost). Returns { n, on: [pivots] } or null.
  const onGuide = (from, kn, t) => {
    const c = circleOf(kn);
    const sN = sOf(kn);
    const step = tau(kn);
    const k2 = (kn + 1) % K;
    const off = (a, b) => segDist([c.x, c.y], a, b) >= c.r - 0.05;
    // Where the run's last link would rest on the post with its middle at the touching point
    const ideal = t.th + sN * (step / 2);
    const D = Math.hypot(at(kn, ideal)[0] - from[0], at(kn, ideal)[1] - from[1]);
    const n0 = Math.max(1, Math.round(D / pitch));
    // Whole links landing near there, or the run eased (as runs onto sprockets are) to land right there
    const tries = [n0 - 1, n0, n0 + 1, n0 + 2].filter((n) => n >= 1).map((n) => ({ n, th: landAt(from, kn, n * pitch, ideal) }));
    const nEased = Math.floor(D / pitch + 1e-9);
    if (nEased >= 1 && D - nEased * pitch <= stretchAllowed(D)) tries.push({ n: nEased, th: ideal });
    let best = null;
    for (const { n, th } of tries) {
      if (th == null) continue;
      const on = [at(kn, th)];
      if (!off(from, on[0])) continue;
      let leave = null;
      for (let j = 0; j < 8; j++) {
        const last = on.at(-1);
        const t2 = touching(last, k2);
        if (!t2) break;
        const dep = at(k2, t2.th);
        if (off(last, dep)) {
          leave = dep;
          break;
        }
        on.push(at(kn, ang(last[0] - c.x, last[1] - c.y) + sN * step));
      }
      if (!leave) continue;
      const seq = [from, ...on, leave];
      let cost = 0;
      for (let i = 1; i + 1 < seq.length; i++) cost = Math.max(cost, bendCost(seq[i - 1], seq[i], seq[i + 1], step));
      // Resting on the post rather than hovering beside it. A shallow wrap has one pivot on the post,
      // which needn't sit on the wrap circle: swing it about `from` (keeping the run's whole links)
      // toward the post until the chain just touches it
      const gapOf = (seq2) => {
        let g = Infinity;
        for (let i = 0; i + 1 < seq2.length; i++) g = Math.min(g, segDist([c.x, c.y], seq2[i], seq2[i + 1]) - c.r);
        return g;
      };
      let gap = gapOf(seq);
      if (on.length === 1 && gap > 0.02) {
        const swing = (psi) => {
          const v = [on[0][0] - from[0], on[0][1] - from[1]];
          const [cs, sn] = [Math.cos(psi), Math.sin(psi)];
          const p1 = [from[0] + v[0] * cs - v[1] * sn, from[1] + v[0] * sn + v[1] * cs];
          const t2 = touching(p1, k2);
          return t2 ? [from, p1, at(k2, t2.th)] : null;
        };
        // Toward the post is the way that brings the pivot nearer its axis
        const dir = Math.hypot(...[0, 1].map((i) => swing(0.01)[1][i] - [c.x, c.y][i])) < Math.hypot(on[0][0] - c.x, on[0][1] - c.y) ? 1 : -1;
        let lo = 0;
        let hi = 0;
        for (let k = 1; k <= 40; k++) {
          const sq = swing((dir * k) / 200);
          if (!sq || gapOf(sq) < 0) {
            hi = (dir * k) / 200;
            break;
          }
          lo = (dir * k) / 200;
        }
        if (hi) {
          for (let i = 0; i < 40; i++) {
            const mid = (lo + hi) / 2;
            const sq = swing(mid);
            if (sq && gapOf(sq) >= 0) lo = mid;
            else hi = mid;
          }
          const sq = swing(lo);
          on[0] = sq[1];
          seq.splice(0, seq.length, ...sq);
          gap = gapOf(seq);
          cost = 0;
          for (let i = 1; i + 1 < seq.length; i++) cost = Math.max(cost, bendCost(seq[i - 1], seq[i], seq[i + 1], step));
        }
      }
      cost += 0.05 * Math.max(0, gap);
      if (!best || cost < best.cost - 1e-9) best = { n, on, cost };
    }
    return best;
  };

  const s0 = (sagRun + 1) % K; // always a sprocket
  const start = thOut(s0);
  const pts = [at(s0, start)];
  const firstOn = new Array(K).fill(null);
  firstOn[s0] = 0;
  // A run's links are the whole number that fits it best, eased at most a hair a link longer; a run
  // with links to spare bows out a little. Slack moves between runs as the sprockets turn, so only
  // the total counts: the planned `target` links, with the closing run taking up the rest.
  const stretchAllowed = (length) => (EASE_PER_LINK_MM * length) / pitch;
  for (let i = 0; i < K - 1; i++) {
    const k = (s0 + i) % K;
    const kn = (k + 1) % K;
    const from = pts.at(-1);
    const t = touching(from, kn);
    if (!t) return null;
    if (isGuide(kn)) {
      const placed = onGuide(from, kn, t);
      if (placed) {
        for (let j = 1; j < placed.n; j++) pts.push([from[0] + ((placed.on[0][0] - from[0]) * j) / placed.n, from[1] + ((placed.on[0][1] - from[1]) * j) / placed.n]);
        firstOn[kn] = pts.length;
        pts.push(...placed.on);
        continue;
      }
    }
    let on = onPart(kn, t.th);
    let end = on[0];
    const R = Math.hypot(end[0] - from[0], end[1] - from[1]);
    {
      // A run onto a part is straight: q links eased to the touching point, or exactly q links
      // landing a little past it (wrapping the part a little less, turning in as a chain under
      // tension does) or a link fewer landing a little before it, whichever bends least there. A
      // standoff has no teeth, so the chain rests on it wherever the run lands.
      let q = Math.max(1, Math.ceil((R - stretchAllowed(R)) / pitch - 1e-9));
      if (q * pitch > R + 1e-9) {
        // On a standoff, also where the chain leaves it for the next part: a wrap shared unevenly
        // between its pivots makes one of them turn further
        const leaving = (pts2) => {
          if (!isGuide(kn)) return 0;
          const last = pts2.at(-1);
          const k2 = (kn + 1) % K;
          const t2 = touching(last, k2);
          return t2 ? bendCost(pts2.at(-2) || from, last, at(k2, t2.th), tau(kn)) : 0;
        };
        const options = (isGuide(kn) ? [q, q - 1, q + 1] : [q, q - 1])
          .filter((n) => n >= 1)
          .map((n) => {
            const th = landAt(from, kn, n * pitch, t.th);
            if (th == null) return null;
            const pts2 = onPart(kn, th, true);
            const next = pts2[1] || at(kn, th + sOf(kn) * tau(kn));
            return { n, on: pts2, cost: Math.max(bendCost(from, pts2[0], next, tau(kn)), leaving(pts2)) };
          })
          .filter(Boolean);
        if (!options.length) return null;
        const best = options.reduce((a, b) => (b.cost < a.cost - 1e-9 ? b : a));
        q = best.n;
        on = best.on;
        end = on[0];
      }
      for (let j = 1; j < q; j++) pts.push([from[0] + ((end[0] - from[0]) * j) / q, from[1] + ((end[1] - from[1]) * j) / q]);
    }
    firstOn[kn] = pts.length;
    pts.push(...on);
  }
  // The closing run onto the first sprocket. The chain may leave the last sprocket a tooth or two
  // sooner or later than planned (`e`), as a hanging run does, and lands c teeth before the start
  // with q links in the run.
  const t0 = tau(s0);
  const s = sOf(s0);
  const tl = tau(sagRun);
  const sl = sOf(sagRun);
  const lastOn = firstOn[sagRun];
  const lastTh = ang(pts.at(-1)[0] - circleOf(sagRun).x, pts.at(-1)[1] - circleOf(sagRun).y);
  const onLast = pts.length - lastOn; // pivots on the last part's arc
  // Slack hangs toward the floor; out of the loop (the run's bow side) when the parts lie flat
  const g = Math.hypot(down2[0], down2[1]);
  const bow = bowSide(sagRun);
  const hang = (from, cd) => {
    const dx = cd.end[0] - from[0];
    const dy = cd.end[1] - from[1];
    const out = [(bow * dy) / Math.hypot(dx, dy), (-bow * dx) / Math.hypot(dx, dy)];
    // Standing up, slack always hangs with gravity (into the loop on a run facing up)
    const down = g > 0.3 ? [down2[0] / g, down2[1] / g] : out;
    return hangPoints(from, cd.end, cd.q, pitch, down, bow);
  };
  // How much a join of the closing run bends (bendCost), against the smaller tooth of the parts it joins
  const toothStep = Math.min(tau(s0), tau(sagRun));
  const turn = (p0, p1, p2) => bendCost(p0, p1, p2, toothStep);
  // A run pivot sinking into a part's circle would sit in its teeth or body
  const clear = (run) =>
    run.every((p, idx) => {
      const mid = idx ? [(p[0] + run[idx - 1][0]) / 2, (p[1] + run[idx - 1][1]) / 2] : p;
      return circles.every((c) => Math.hypot(p[0] - c.x, p[1] - c.y) >= c.r - 0.3 && Math.hypot(mid[0] - c.x, mid[1] - c.y) >= c.r - 0.6);
    });

  let best = null;
  // (round a standoff it can drape a link or two further over the post, but never leave it sooner)
  const eMin = isGuide(sagRun) ? 0 : -Math.min(2, onLast - 1);
  const eMax = 3;
  for (let e = eMin; e <= eMax; e++) {
    const base = e < 0 ? pts.slice(0, pts.length + e) : [...pts, ...Array.from({ length: e }, (_, j) => at(sagRun, lastTh + sl * (j + 1) * tl))];
    const from = base.at(-1);
    const t = touching(from, s0);
    if (!t) continue;
    // Land a tooth gap near where the chain meets the sprocket; the run takes the links left
    const cands = [];
    for (let c = 0; c <= circleOf(s0).teeth; c++) {
      const th = start - s * c * t0;
      const end = at(s0, th);
      const R = Math.hypot(end[0] - from[0], end[1] - from[1]);
      // The links left for the planned count, or one more if those would be too tight
      const q = Math.max(target - base.length - c + 1, Math.ceil((R - stretchAllowed(R)) / pitch - 1e-9));
      if (q < 1) continue;
      const off = Math.abs(near(th, t.th) - t.th);
      // Nearest the touching point, but a tooth further off rather than an extra link
      const extra = q > target - base.length - c + 1;
      cands.push({ c, th, q, end, R, off, extra, score: off + (extra ? t0 * 1.01 : 0) });
    }
    if (!cands.length) continue;
    // Of the landings near the touching point without an extra link, the one whose run meets both
    // parts most smoothly (a hanging chain leaves and lands at its own angle) and stays clear of the
    // teeth; leaving as planned (e = 0) on a tie
    const nearest = cands.reduce((m, cd) => (cd.score < m.score ? cd : m));
    for (const cd of cands) {
      // Within about 60° of the touching point (a few teeth on a small sprocket, more on a big one)
      if (cd.extra !== nearest.extra || cd.off > nearest.off + Math.max(3 * t0, Math.PI / 3)) continue;
      const inner = hang(from, cd);
      const run = [base.at(-2), from, ...inner, cd.end, at(s0, cd.th + s * t0)];
      const kink = Math.max(turn(run[0], run[1], run[2]), turn(run.at(-3), run.at(-2), run.at(-1)));
      const score = (clear([from, ...inner, cd.end]) ? 0 : 10) + (cd.extra ? 5 : 0) + kink + (e === 0 ? 0 : 1e-3);
      if (!best || score < best.score - 1e-6) best = { ...cd, base, inner, kink, score };
    }
  }
  if (!best) return null;
  const out = [...best.base, ...best.inner];
  for (let j = 0; j < best.c; j++) out.push(at(s0, best.th + s * j * t0));
  // The sharpest turn along the closing run, either way (rad): a run that can't hang its slack
  // without folding is no place for it
  const runPts = [best.base.at(-2), best.base.at(-1), ...best.inner, best.end, at(s0, best.th + s * t0)];
  // (the two ends may turn as far as their part's step allows; in between, a sprocket's tooth)
  let clean = true;
  for (let i = 1; i + 1 < runPts.length; i++) {
    const [p0, p1, p2] = [runPts[i - 1], runPts[i], runPts[i + 1]];
    const t = Math.abs(mod2pi(ang(p2[0] - p1[0], p2[1] - p1[1]) - ang(p1[0] - p0[0], p1[1] - p0[1]) + Math.PI) - Math.PI);
    const limit = i === 1 ? tau(sagRun) : i === runPts.length - 2 ? t0 : Math.min(t0, isGuide(sagRun) ? t0 : tau(sagRun));
    if (t > limit + 0.009) clean = false;
  }
  // How far the hanging run drops below its straight line
  const [a, b] = [best.base.at(-1), best.end];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const depth = Math.max(0, ...best.inner.map((p) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len));
  return { pivots2d: out, arcPivotIndex: firstOn, sag: { run: sagRun, mm: round3(best.q * pitch - best.R), depthMm: round3(depth), kink: best.score, clean } };
}

/**
 * Which sprocket to move, which way and how far for an exact fit: of the loop's sprockets moved
 * along each of their runs, the one that changes the length fastest. Returns { instanceId,
 * towardId, mm } (mm > 0: toward that part) or null.
 */
function suggestMove(check, nodes, pitch, gapMm) {
  const { circles, all } = check;
  const lengthOf = (cs) => {
    const p = loopPath(cs, nodes);
    return p.ok ? exactLinks(cs, p, pitch) * pitch : NaN;
  };
  const base = lengthOf(circles);
  let best = null;
  const K = nodes.length;
  for (let k = 0; k < K; k++) {
    const pair = [nodes[k].c, nodes[(k + 1) % K].c];
    for (const [mover, other] of [pair, [pair[1], pair[0]]]) {
      if (circles[mover].kind !== 'sprocket') continue;
      const a = circles[mover];
      const b = circles[other];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const h = 0.01;
      const moved = circles.map((c, i) => (i === mover ? { ...c, x: c.x + ((b.x - a.x) / L) * h, y: c.y + ((b.y - a.y) / L) * h } : c));
      const rate = (lengthOf(moved) - base) / h; // mm of path per mm moved toward
      if (!Number.isFinite(rate) || Math.abs(rate) < 1e-3) continue;
      if (!best || Math.abs(rate) > Math.abs(best.rate)) best = { mover, other, rate };
    }
  }
  if (!best) return null;
  // Path must change by −gapMm (gap > 0: the path is longer than the chain, so shorten it)
  return { instanceId: all[best.mover].instanceId, towardId: all[best.other].instanceId, mm: round3(-gapMm / best.rate) };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ordinal = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

/**
 * Message for a built chain, e.g. "Chain builder: 52 Chain Links round 3 sprockets and 1 standoff
 * (under 8 Tooth Sprocket #3). Exact fit."
 */
export function chainMessage(result, labelOf = (id) => result.labelOf?.[id] || id) {
  if (!result?.ok) return result?.error || '';
  const what = result.kind === 'track' ? 'Track builder' : 'Chain builder';
  const linkName = result.kind === 'track' ? 'tread links' : 'Chain Links';
  const sprocketCount = result.sprocketCount ?? result.onLoop.length;
  const standoffs = result.standoffCount ? ` and ${plural(result.standoffCount, 'standoff', 'standoffs')}` : '';
  const routed = (result.wrapped || []).filter((w) => w.side === 'over' || w.side === 'under');
  const how = routed.length ? ` (${routed.map((w) => `${w.side} ${labelOf(w.instanceId)}`).join(', ')})` : '';
  const att = TRACK_ATTACHMENTS[result.attachment] || TRACK_ATTACHMENTS.traction;
  const every = result.attachmentEvery > 1 ? ` (every ${ordinal(result.attachmentEvery)} link)` : '';
  const carried = result.grippers.length ? ` and ${plural(result.grippers.length, att.one, att.many)}${every}` : '';
  const parts = [`${what}: ${result.linkCount} ${linkName}${carried} round ${sprocketCount} sprockets${standoffs}${how}`];
  if (Math.abs(result.gapMm) < 0.05) parts.push('Exact fit');
  else {
    const mm = Math.abs(result.gapMm).toFixed(1);
    parts.push(result.gapMm > 0 ? `The chain is ${mm} mm short of the path` : `The chain is ${mm} mm longer than the path`);
    if (result.moveHint) {
      const { instanceId, towardId, mm: move } = result.moveHint;
      parts.push(`For an exact fit, move ${labelOf(instanceId)} about ${Math.abs(move).toFixed(1)} mm ${move > 0 ? 'toward' : 'away from'} ${labelOf(towardId)}`);
    }
  }
  parts.push(...result.notes.map((t) => t.replace(/\.$/, '')));
  const leftOut = (result.leftOut || []).map((l) => (typeof l === 'string' ? { instanceId: l, reason: null } : l));
  const outside = leftOut.filter((l) => l.reason === 'outside-only');
  const other = leftOut.filter((l) => l.reason !== 'outside-only');
  if (outside.length) parts.push(`Left out, tracks only go round the outside: ${outside.map((l) => labelOf(l.instanceId)).join(', ')}`);
  if (other.length) parts.push(`Not touched by the chain: ${other.map((l) => labelOf(l.instanceId)).join(', ')}`);
  return `${parts.join('. ')}.`;
}

/** Next free "Chain N" / "Track N" name among `instances`' groups. */
export function nextChainName(instances, kind) {
  const base = kind === 'track' ? 'Track' : 'Chain';
  const used = new Set();
  for (const inst of instances) {
    const m = inst.groupName && new RegExp(`^${base} (\\d+)$`).exec(inst.groupName);
    if (m) used.add(Number(m[1]));
  }
  let k = 1;
  while (used.has(k)) k++;
  return `${base} ${k}`;
}
