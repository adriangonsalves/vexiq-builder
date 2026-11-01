import * as THREE from 'three';
import { angleAbout, directionAt, refAxes, wrapDeg } from './axisFrame.js';
import { quaternionToEulerDeg } from './gearMeshing.js';

/**
 * Chain and track round sprockets (openspec chain-track-builder). Pure: part metadata + world poses
 * in, link poses and sprocket turns out, so the app, the MCP engine and Node checks agree.
 *
 * The sprockets' pitch circles are laid out in 2D in the frame of refAxes(n) (n: the first
 * sprocket's axle). The chain goes round the outside of them, counter-clockwise about n: along the
 * outer touching line from one sprocket to the next, round each one on its pitch circle. On a
 * sprocket the pivots step one tooth (each link a 6.35 mm chord); on a straight run they are spaced
 * evenly, as near 6.35 mm as a whole number of links allows. The count is the fewest links that reach
 * all the way round (a chain can't stretch, so it is never more than CHAIN_PLAY_MM short of the path);
 * what's left over is reported as the gap.
 *
 * Links (Chain Link, Tank Tread Attachment Link) have their roller pivot at the origin, the next
 * pivot 6.35 mm along local −Z, the pivot axis along X and +Y out of the loop (part chainSpecs).
 */

export const AXIS_PARALLEL_MIN_DOT = Math.cos(THREE.MathUtils.degToRad(2));
export const PLANE_TOLERANCE_MM = 1.0;
export const SEATED_PIVOT_TOLERANCE_MM = 0.5;
export const CHAIN_PLAY_MM = 0.75; // a chain this much short of the path still goes on (play in its joints)
export const SAG_NOTE_MM = 3.175; // more slack than half a link: the chain sags a little
const EASE_PER_LINK_MM = 0.2; // a run's links may be drawn this much apart past 6.35 mm (inside the chain's play)
const EPS = 1e-6;

export const CHAIN_LINK_PART_NUMBER = '228-2500-230';
export const TREAD_LINK_PART_NUMBER = '228-2500-231';
export const GRIPPER_PART_NUMBER = '228-2500-239';

const toVec = (v) => (v?.isVector3 ? v.clone() : new THREE.Vector3(...v));
const toQuat = (r) => {
  if (r?.isQuaternion) return r.clone();
  const e = new THREE.Euler(...r.map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ');
  return new THREE.Quaternion().setFromEuler(e);
};
const round3 = (x) => Math.round(x * 1000) / 1000 + 0;

export const isSprocket = (meta) => meta?.gearSpecs?.gearType === 'sprocket' && meta.gearSpecs.measured === true;
const isToothedNonSprocket = (meta) => Boolean(meta?.gearSpecs) && meta.gearSpecs.gearType !== 'sprocket';
export const chainRole = (meta) => meta?.chainSpecs?.role || null;

/** A sprocket in world space: { instanceId, label, teeth, pitchRadius, tipRadius, center, axis, gapDir }. */
export function worldSprocket(meta, position, rotation, instanceId = null, label = null) {
  const g = meta.gearSpecs;
  const q = toQuat(rotation);
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const faceMid = g.faceSpanMm ? (g.faceSpanMm[0] + g.faceSpanMm[1]) / 2 : 0;
  return {
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
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy);
      if (L < EPS || Math.abs(a.r - b.r) >= L) continue;
      const k = (a.r - b.r) / L;
      const h = Math.sqrt(1 - k * k);
      // d̂ and its right-hand normal (−90°): the circles stay on the left going counter-clockwise
      const ux = dx / L;
      const uy = dy / L;
      const m = [k * ux + h * uy, k * uy - h * ux];
      const tx = a.x + a.r * m[0];
      const ty = a.y + a.r * m[1];
      const outside = circles.some((c, ci) => ci !== i && ci !== j && (c.x - tx) * m[0] + (c.y - ty) * m[1] > -c.r + 1e-4);
      if (outside) continue;
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
 * Which of `parts` ([{ instanceId, label, meta, position, rotation }], the selection) can carry one
 * chain. Returns { ok, error?, sprockets (world, on the loop, in loop order), leftOut, normal, loop }.
 */
export function checkSprocketsForChain(parts) {
  const sprocketParts = parts.filter((p) => isSprocket(p.meta));
  if (sprocketParts.length < 2) {
    const gears = parts.filter((p) => isToothedNonSprocket(p.meta));
    if (gears.length >= 2 || (gears.length && sprocketParts.length)) {
      return { ok: false, error: 'Chain and track fit sprockets, not gears. Select two or more sprockets.' };
    }
    return { ok: false, error: 'Select two or more sprockets in one plane.' };
  }
  const all = sprocketParts.map((p) => worldSprocket(p.meta, p.position, p.rotation, p.instanceId, p.label));
  const n = all[0].axis.clone().normalize();
  for (const s of all.slice(1)) {
    if (Math.abs(s.axis.dot(n)) < AXIS_PARALLEL_MIN_DOT) {
      return { ok: false, error: `The sprockets' axles aren't parallel (${s.label}).` };
    }
  }
  const t0 = all[0].center.dot(n);
  for (const s of all.slice(1)) {
    const off = Math.abs(s.center.dot(n) - t0);
    if (off > PLANE_TOLERANCE_MM) {
      return { ok: false, error: `The sprockets aren't in one plane: ${s.label} is ${off.toFixed(1)} mm along its axle from ${all[0].label}.` };
    }
  }
  const [u, v] = refAxes(n);
  const circles = all.map((s) => ({ x: s.center.dot(u), y: s.center.dot(v), r: s.pitchRadius }));
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
  const onLoop = new Set(loop.map((e) => e.from));
  return {
    ok: true,
    normal: n,
    frame: { u, v, t0 },
    circles,
    all,
    loop,
    sprockets: loop.map((e) => all[e.from]),
    leftOut: all.filter((_, i) => !onLoop.has(i))
  };
}

/** Angle (rad) of a 2D vector. */
const ang = (x, y) => Math.atan2(y, x);
const mod2pi = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

/**
 * The true length of the loop in links (real number): whole teeth round each arc plus the straight
 * runs over the chain pitch. `circles`/`loop` as from checkSprocketsForChain.
 */
function loopGeometry(circles, loop, pitch) {
  const arcs = loop.map((e, k) => {
    const prev = loop[(k - 1 + loop.length) % loop.length];
    const thIn = ang(prev.m[0], prev.m[1]);
    const thOut = ang(e.m[0], e.m[1]);
    let alpha = mod2pi(thOut - thIn);
    if (alpha < EPS) alpha = 2 * Math.PI; // a lone circle can't happen (loop ≥ 2), but stay safe
    return { circle: e.from, thIn, alpha };
  });
  const runs = loop.map((e) => {
    const a = circles[e.from];
    const b = circles[e.to];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    return Math.sqrt(Math.max(0, L * L - (a.r - b.r) ** 2));
  });
  return { arcs, runs, pitch };
}

const exactLinks = (circles, loop, pitch, teethOf) => {
  const { arcs, runs } = loopGeometry(circles, loop, pitch);
  return arcs.reduce((s, a) => s + a.alpha / ((2 * Math.PI) / teethOf(a.circle)), 0) + runs.reduce((s, r) => s + r / pitch, 0);
};

/**
 * The whole chain. `parts` as for checkSprocketsForChain; `kind` 'chain' | 'track'; `grippers`
 * (track only); `metaByPartNumber(pn)` → part metadata for the link and gripper parts.
 * Returns { ok, error?, linkPart, gripperPart, links: [{ partId, position, rotation }],
 *   grippers: [...], sprocketTurns: [{ instanceId, axis, point, deg }], onLoop, leftOut,
 *   linkCount, exactLinks, gapMm, moveHint, notes }.
 */
export function buildChainPath(parts, { kind = 'chain', grippers = false, metaByPartNumber }) {
  const check = checkSprocketsForChain(parts);
  if (!check.ok) return check;
  const linkPart = metaByPartNumber(kind === 'track' ? TREAD_LINK_PART_NUMBER : CHAIN_LINK_PART_NUMBER);
  const gripperPart = kind === 'track' && grippers ? metaByPartNumber(GRIPPER_PART_NUMBER) : null;
  if (!linkPart?.chainSpecs) return { ok: false, error: `The ${kind === 'track' ? 'tread' : 'chain'} link part is missing from the library.` };
  if (kind === 'track' && grippers && !gripperPart?.chainSpecs) return { ok: false, error: 'The Traction Link part is missing from the library.' };

  const { normal: n, frame, circles, loop, all } = check;
  const pitch = linkPart.chainSpecs.pitchMm;
  const teethOf = (i) => all[i].teeth;
  const { arcs, runs } = loopGeometry(circles, loop, pitch);
  const exact = exactLinks(circles, loop, pitch, teethOf);

  // Never tighter than the path allows: round up, unless it's within the chain's play
  const target = Math.max(2, Math.ceil(exact - CHAIN_PLAY_MM / pitch));
  // A slack chain sags on one run: the one facing the floor (world −Y), or the longest when the
  // sprockets lie flat
  const down = new THREE.Vector3(0, -1, 0);
  const down2 = [down.dot(frame.u), down.dot(frame.v)];
  const facing = (k) => (Math.hypot(...down2) > 0.3 ? loop[k].m[0] * down2[0] + loop[k].m[1] * down2[1] : runs[k]);
  const sagRun = loop.reduce((best, _, k) => (facing(k) > facing(best) ? k : best), 0);
  // The facing run unless closing on another needs fewer links
  let walk = planChain(circles, loop, arcs, runs, pitch, teethOf, target, sagRun, down2);
  if (!walk || walk.pivots2d.length > target) {
    for (let k = 0; k < loop.length; k++) {
      if (k === sagRun) continue;
      const other = planChain(circles, loop, arcs, runs, pitch, teethOf, target, k, down2);
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
    if (seat) {
      const gp = seat.clone().applyQuaternion(q).add(p);
      gripperPoses.push({ partId: gripperPart.id, position: gp.toArray().map(round3), rotation });
    }
  }

  // Sprocket turns: a tooth gap at the nearest pivot on its arc, the smallest turn
  const sprocketTurns = [];
  loop.forEach((e, k) => {
    const s = all[e.from];
    const idx = arcPivotIndex[k];
    if (idx == null) return;
    const pts = [to3d(pivots2d[idx])];
    const a = s.axis.clone().normalize();
    const gap = angleAbout(a, s.gapDir);
    const pivotAngle = angleAbout(a, pts[0].clone().sub(s.center));
    const deg = Math.round(wrapDeg(pivotAngle - gap, 360 / s.teeth) * 1000) / 1000 + 0;
    if (Math.abs(deg) >= 0.005) sprocketTurns.push({ instanceId: s.instanceId, axis: a.toArray(), point: s.center.toArray(), deg });
  });

  const gapMm = round3((exact - total) * pitch);
  const moveHint = Math.abs(gapMm) >= 0.05 ? suggestMove(check, pitch, gapMm) : null;
  const notes = [];
  if (-gapMm > SAG_NOTE_MM) notes.push('It will sag a little; move a sprocket for a snug fit.');
  return {
    ok: true,
    kind,
    linkPart,
    gripperPart,
    links,
    grippers: gripperPoses,
    sprocketTurns,
    onLoop: check.sprockets.map((s) => s.instanceId),
    leftOut: check.leftOut.map((s) => s.instanceId),
    linkCount: links.length,
    exactLinks: Math.round(exact * 1000) / 1000,
    gapMm,
    moveHint,
    notes,
    labelOf: Object.fromEntries(all.map((s) => [s.instanceId, s.label]))
  };
}

/**
 * The q − 1 inner pivots of a sagging run from `a` to `b` ([x, y]): q links of `pitch` on a circular
 * arc bowed to the right of a→b (out of a counter-clockwise loop). A run as long as its links is
 * straight.
 */
function sagPoints(a, b, q, pitch) {
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
  const out = [dy / D, -dx / D]; // right of a→b
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
function hangPoints(a, b, q, pitch, down) {
  const D = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (q < 2 || D >= q * pitch - 1e-9) return sagPoints(a, b, q, pitch);
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
  if (h < 0.05 * D) return sagPoints(a, b, q, pitch);

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
  if (pts.length < q - 1) return sagPoints(a, b, q, pitch);
  const out = (flip ? pts.reverse() : pts).map(fromF);
  return out;
}

/**
 * The pivot loop, counter-clockwise: [x, y] points in the loop frame, `target` of them (one per link).
 * The walk starts where the chain leaves the sprocket after run `sagRun` and goes link by link: each
 * run lands where the chain meets the next sprocket (its touching point from the last pivot), with
 * the whole number of links that fits it best, straight and tight: eased a hair longer to reach the
 * touching point, or landing a little before it (wrapping a little more) when the links fall short;
 * round a sprocket the links step one tooth (a 6.35 mm chord). The last run, `sagRun`, closes the
 * loop: it lands on the first sprocket a whole number of teeth before the start, as near its touching
 * point as the link count allows, and holds what's left over: hanging on a catenary toward the floor
 * (`down2`, gravity in the loop frame; out of the loop when the sprockets lie flat or the run faces
 * up) when the chain is longer than the path, eased straight (within the chain's play) when shorter. Returns { pivots2d, arcPivotIndex:
 * [index of a pivot on each loop sprocket], sag: { run, mm } } or null.
 */
function planChain(circles, loop, arcs, runs, pitch, teethOf, target, sagRun = 0, down2 = [0, 0]) {
  const K = loop.length;
  const tau = (k) => (2 * Math.PI) / teethOf(loop[k].from);
  const circleOf = (k) => circles[loop[k].from];
  const at = (k, th) => {
    const c = circleOf(k);
    return [c.x + c.r * Math.cos(th), c.y + c.r * Math.sin(th)];
  };
  const thOut = (k) => arcs[k].thIn + arcs[k].alpha;
  // `th` moved by whole turns to within half a turn of `ref`
  const near = (th, ref) => ref + (mod2pi(th - ref + Math.PI) - Math.PI);
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

  // The point on circle k at distance L from `from`, on the same side as the touching angle `thT`
  const landAt = (from, k, L, thT) => {
    const c = circleOf(k);
    const d = Math.hypot(from[0] - c.x, from[1] - c.y);
    const cos = (d * d + c.r * c.r - L * L) / (2 * d * c.r);
    if (cos > 1 || cos < -1) return null;
    const toFrom = ang(from[0] - c.x, from[1] - c.y);
    const side = Math.sign(mod2pi(thT - toFrom + Math.PI) - Math.PI) || 1;
    return near(toFrom + side * Math.acos(cos), thT);
  };

  const s0 = (sagRun + 1) % K;
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
    // A tight run is straight: q links eased to the touching point, or exactly q links landing a
    // little before it, so the chain wraps the sprocket a little more
    let q = Math.floor(t.length / pitch + 1e-9);
    if (q < 1) {
      q = 1;
      pts.push(...sagPoints(from, at(kn, t.th), q, pitch));
    } else if (t.length - q * pitch > stretchAllowed(t.length)) {
      const th = landAt(from, kn, q * pitch, t.th);
      if (th == null) return null;
      t.th = th;
    }
    if (q > 1) {
      const end = at(kn, t.th);
      for (let j = 1; j < q; j++) pts.push([from[0] + ((end[0] - from[0]) * j) / q, from[1] + ((end[1] - from[1]) * j) / q]);
    }
    firstOn[kn] = pts.length;
    const m = Math.max(0, Math.round((near(thOut(kn), t.th + arcs[kn].alpha) - t.th) / tau(kn)));
    for (let j = 0; j <= m; j++) pts.push(at(kn, t.th + j * tau(kn)));
  }
  // The closing run onto the first sprocket: c teeth before the start, q links in the run
  const from = pts.at(-1);
  const t = touching(from, s0);
  if (!t) return null;
  const t0 = tau(s0);
  // Land a tooth gap near where the chain meets the sprocket; the run takes the links left
  const cands = [];
  for (let c = 0; c <= teethOf(loop[s0].from); c++) {
    const th = start - c * t0;
    const end = at(s0, th);
    const R = Math.hypot(end[0] - from[0], end[1] - from[1]);
    // The links left for the planned count, or one more if those would be too tight
    const q = Math.max(target - pts.length - c + 1, Math.ceil((R - stretchAllowed(R)) / pitch - 1e-9));
    if (q < 1) continue;
    const off = Math.abs(near(th, t.th) - t.th);
    // Nearest the touching point, but a tooth further off rather than an extra link
    const extra = q > target - pts.length - c + 1;
    const score = off + (extra ? t0 * 1.01 : 0);
    cands.push({ c, th, q, end, R, off, extra, score });
  }
  if (!cands.length) return null;
  // Slack hangs toward the floor; out of the loop when gravity lies across the run's plane or faces in
  const g = Math.hypot(down2[0], down2[1]);
  const hang = (cd) => {
    const dx = cd.end[0] - from[0];
    const dy = cd.end[1] - from[1];
    const out = [dy / Math.hypot(dx, dy), -dx / Math.hypot(dx, dy)]; // right of from→end: out of the loop
    const down = g > 0.3 && (down2[0] * out[0] + down2[1] * out[1]) / g > 0.25 ? [down2[0] / g, down2[1] / g] : out;
    return hangPoints(from, cd.end, cd.q, pitch, down);
  };
  // Of the landings near the touching point without an extra link, the one whose run meets both
  // sprockets most smoothly (a hanging chain leaves and lands at its own angle)
  const turn = (p0, p1, p2) => Math.abs(mod2pi(ang(p2[0] - p1[0], p2[1] - p1[1]) - ang(p1[0] - p0[0], p1[1] - p0[1]) + Math.PI) - Math.PI);
  const nearest = cands.reduce((m, cd) => (cd.score < m.score ? cd : m));
  let best = null;
  for (const cd of cands) {
    if (cd.extra !== nearest.extra || cd.off > nearest.off + 3 * t0) continue;
    const inner = hang(cd);
    const run = [pts.at(-2), from, ...inner, cd.end, at(s0, cd.th + t0)];
    const kink = Math.max(turn(run[0], run[1], run[2]), turn(run.at(-3), run.at(-2), run.at(-1)));
    if (!best || kink < best.kink - 1e-6) best = { ...cd, inner, kink };
  }
  pts.push(...best.inner);
  for (let j = 0; j < best.c; j++) pts.push(at(s0, best.th + j * t0));
  return { pivots2d: pts, arcPivotIndex: firstOn, sag: { run: sagRun, mm: round3(best.q * pitch - best.R) } };
}

/**
 * Which sprocket to move, which way and how far for an exact fit: of the loop sprockets moved along
 * each of their runs, the one that changes the length fastest. Returns { instanceId, towardId, mm }
 * (mm > 0: toward that sprocket) or null.
 */
function suggestMove(check, pitch, gapMm) {
  const { circles, loop, all } = check;
  const teethOf = (i) => all[i].teeth;
  const base = exactLinks(circles, loop, pitch, teethOf) * pitch;
  let best = null;
  for (const e of loop) {
    for (const [mover, other] of [[e.from, e.to], [e.to, e.from]]) {
      const a = circles[mover];
      const b = circles[other];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const h = 0.01;
      const moved = circles.map((c, i) => (i === mover ? { ...c, x: c.x + ((b.x - a.x) / L) * h, y: c.y + ((b.y - a.y) / L) * h } : c));
      const rate = (exactLinks(moved, loop, pitch, teethOf) * pitch - base) / h; // mm of path per mm moved toward
      if (Math.abs(rate) < 1e-3) continue;
      if (!best || Math.abs(rate) > Math.abs(best.rate)) best = { mover, other, rate };
    }
  }
  if (!best) return null;
  // Path must change by −gapMm (gap > 0: the path is longer than the chain, so shorten it)
  return { instanceId: all[best.mover].instanceId, towardId: all[best.other].instanceId, mm: round3(-gapMm / best.rate) };
}

/** Message for a built chain, e.g. "Chain builder: 48 Chain Links round 2 sprockets. Exact fit." */
export function chainMessage(result, labelOf = (id) => result.labelOf?.[id] || id) {
  const what = result.kind === 'track' ? 'Track builder' : 'Chain builder';
  const linkName = result.kind === 'track' ? 'tread links' : 'Chain Links';
  const parts = [`${what}: ${result.linkCount} ${linkName}${result.grippers.length ? ` and ${result.grippers.length} grippers` : ''} round ${result.onLoop.length} sprockets`];
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
  if (result.leftOut.length) parts.push(`Not touched by the chain: ${result.leftOut.map(labelOf).join(', ')}`);
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
