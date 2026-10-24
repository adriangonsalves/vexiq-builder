import * as THREE from 'three';

/**
 * Pin/shaft-to-opening alignment math for the viewport's aligned-hole highlights.
 * Pure (no React/DOM) so it can be checked from Node against public/catalog.json.
 *
 * Inserts:  `pin` (pin_peg port), `shaft` (shaft fastenerSpecs, local Z line through origin)
 * Openings: `pin_hole`, `shaft_bore`, `shaft_socket` (ports), `collar_hole` (Rubber Shaft Collar)
 */

const VEX_PITCH_MM = 12.7;

export const PARALLEL_MIN_DOT = Math.cos(THREE.MathUtils.degToRad(2));
export const MAX_LINE_DISTANCE_MM = 0.25;
export const MAX_AXIAL_GAP_MM = 12 * VEX_PITCH_MM; // 152.4mm
export const OUTSIDE_OVERLAP_ALLOWANCE_MM = 0.05;
export const COLLAR_HOLE_RADIUS_RANGE_MM = [1.4, 1.7];
// An opening's end within this distance of the part's outer surface is moved out to that surface,
// so the ring sits on the visible face (beam/plate hole spans stop ~0.76mm short of it).
export const FACE_SNAP_MM = 1.0;
// Through holes in parts at most this thick along the hole axis (beams, plates, gears ≈ 0.5P) run
// face to face; their catalog spans often cover only one side (e.g. 12x12 Plate holes: [1, 2.286]).
export const THIN_PART_MAX_MM = 7.0;
// Rim radius of each opening at the part face (from catalog cylinder radii); collars use their own cylinder.
export const OPENING_RIM_RADIUS_MM = { pin_hole: 3.175, shaft_bore: 2.5, shaft_socket: 2.5 };
export const SHAFT_FASTENER_TYPES = new Set(['straight_shaft', 'capped_shaft', 'motor_shaft']);
export const COLLAR_NAME_PATTERN = /rubber shaft collar/i;
const PIN_CATEGORY = 'Pins & Standoffs';
const PIN_PART_MAX_WIDTH_MM = 6.5; // VEX pins are 6.35mm across at the cap/shoulder
// Parts whose catalog data cannot be trusted for alignment (see scripts/check-pin-hole-alignment.mjs).
// Rubber Shaft Collar v1: none of its catalog cylinders is the real shaft hole (radial raycast check fails).
export const EXCLUDED_PART_NAMES = new Set(['Rubber Shaft Collar v1']);

const OPENINGS_BY_INSERT = {
  pin: new Set(['pin_hole']),
  shaft: new Set(['pin_hole', 'shaft_bore', 'shaft_socket', 'collar_hole'])
};
const PORT_KIND_BY_TYPE = {
  pin_peg: 'pin',
  pin_hole: 'pin_hole',
  shaft_bore: 'shaft_bore',
  shaft_socket: 'shaft_socket'
};

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const normalize3 = (v) => {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
};

/** Min/max of `dot(corner, axis)` over the 8 corners of the part's local bbox. */
function bboxRangeAlong(bbox, axis) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of [bbox.min[0], bbox.max[0]]) {
    for (const y of [bbox.min[1], bbox.max[1]]) {
      for (const z of [bbox.min[2], bbox.max[2]]) {
        const t = x * axis[0] + y * axis[1] + z * axis[2];
        lo = Math.min(lo, t);
        hi = Math.max(hi, t);
      }
    }
  }
  return [lo, hi];
}

/**
 * Intersects [t0, t1] with the bbox projected on the axis; null when nothing is left.
 * With `snapToFace`, an end within FACE_SNAP_MM of the bbox boundary is moved out onto it.
 */
function clampToBbox(range, bbox, axis, snapToFace = false) {
  const [bLo, bHi] = bbox ? bboxRangeAlong(bbox, axis) : [-Infinity, Infinity];
  let lo = Math.max(Math.min(range[0], range[1]), bLo);
  let hi = Math.min(Math.max(range[0], range[1]), bHi);
  if (lo > hi) return null;
  if (snapToFace) {
    if (lo - bLo <= FACE_SNAP_MM) lo = bLo;
    if (bHi - hi <= FACE_SNAP_MM) hi = bHi;
  }
  return [lo, hi];
}

const localFeatureCache = new WeakMap(); // partMeta -> local features

/** Part-local inserts/openings per design.md §2. Extents are absolute t = dot(point, axis). */
export function getLocalFeatures(partMeta) {
  if (!partMeta) return [];
  if (localFeatureCache.has(partMeta)) return localFeatureCache.get(partMeta);

  const features = [];
  const bbox = partMeta.bbox;
  const isCollar = COLLAR_NAME_PATTERN.test(partMeta.name || '');

  const push = (featureId, kind, origin, axisRaw, range, radiusMm = OPENING_RIM_RADIUS_MM[kind], through = false) => {
    const axis = normalize3(axisRaw);
    const isOpening = !OPENINGS_BY_INSERT[kind];
    const extent = clampToBbox(range, bbox, axis, isOpening);
    if (!extent) return;
    features.push({
      featureId,
      kind,
      origin: [...origin],
      axis,
      tMin: extent[0],
      tMax: extent[1],
      ...(isOpening ? { radiusMm, through } : {})
    });
  };

  if (!EXCLUDED_PART_NAMES.has(partMeta.name)) {
    for (const port of partMeta.ports || []) {
      const kind = PORT_KIND_BY_TYPE[port.type];
      if (!kind) continue;
      const axis = normalize3(port.axis);
      const t0 = dot3(port.origin, axis);
      let range;
      const thickness = bbox ? bboxRangeAlong(bbox, axis) : [0, Infinity];
      if (kind === 'shaft_socket') {
        // Blind socket: runs maxDepthMm from its face (origin) into the part along -axis
        range = [t0 - (port.maxDepthMm ?? 0), t0];
      } else if (kind !== 'pin' && port.through && thickness[1] - thickness[0] <= THIN_PART_MAX_MM) {
        range = [-Infinity, Infinity];
      } else {
        range = port.spanMm || [-Infinity, Infinity];
      }
      push(port.portId, kind, port.origin, axis, range, OPENING_RIM_RADIUS_MM[kind], Boolean(port.through));
    }

    const fs = partMeta.fastenerSpecs;
    // A pin part with no stored peg (2x3 Smooth Idler Pin): pin-shaped bbox centered on local Z, so
    // stand in a pin along local Z through the origin; measurePinEnds decides which ends stick out.
    const size = bbox?.max.map((v, i) => v - bbox.min[i]);
    if (
      partMeta.category === PIN_CATEGORY &&
      /\bpin\b/i.test(partMeta.name || '') &&
      !features.some((f) => f.kind === 'pin') &&
      size &&
      size[0] <= PIN_PART_MAX_WIDTH_MM &&
      size[1] <= PIN_PART_MAX_WIDTH_MM &&
      size[2] > size[0]
    ) {
      push('pin_body', 'pin', [0, 0, 0], [0, 0, 1], [bbox.min[2], bbox.max[2]]);
    }
    if (isCollar) {
      // Mis-tagged as a shaft in the catalog: it is a ring that slides onto a shaft.
      const [rLo, rHi] = COLLAR_HOLE_RADIUS_RANGE_MM;
      const bore = (partMeta.cylinders || [])
        .filter((c) => c.radius >= rLo && c.radius <= rHi)
        .sort((a, b) => a.radius - b.radius)[0];
      if (bore) {
        push('collar_hole', 'collar_hole', bore.origin, bore.axis, [-Infinity, Infinity], bore.radius, true);
      }
    } else if (fs && SHAFT_FASTENER_TYPES.has(fs.fastenerType)) {
      push('shaft', 'shaft', [0, 0, 0], fs.axis || [0, 0, 1], fs.usableSpanZ || [-Infinity, Infinity]);
    }
  }

  localFeatureCache.set(partMeta, features);
  return features;
}

export const SURFACE_PROBE_RAYS = 8;
export const SURFACE_PROBE_RING_OFFSET_MM = 0.35; // probe at the middle of the drawn ring (rim + half its width)
const SURFACE_PROBE_START_MM = 2; // rays start this far outside the part's bbox
const SURFACE_PROBE_ACCEPT_MM = 1; // accept hits up to this far outside the opening's catalog extent

/**
 * Measures where each opening's two faces really are on the part's mesh, by casting rays parallel
 * to the opening axis just outside its rim, from both sides. `raycast(originArr, dirArr)` must
 * return the distance to the part's surface in part-local mm, or null on a miss.
 * Returns Map(featureId -> { lo, hi }) of surface positions as t = dot(point, axis); a side with no
 * usable hit keeps its catalog extent.
 */
export function measureOpeningSurfaces(partMeta, raycast) {
  const surfaces = new Map();
  const bbox = partMeta?.bbox;
  if (!bbox) return surfaces;

  for (const f of getLocalFeatures(partMeta)) {
    if (OPENINGS_BY_INSERT[f.kind]) continue; // inserts keep their extent
    const axis = new THREE.Vector3(...f.axis);
    const t0 = dot3(f.origin, f.axis);
    const [bLo, bHi] = bboxRangeAlong(bbox, f.axis);
    const u = new THREE.Vector3()
      .crossVectors(axis, Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
      .normalize();
    const v = new THREE.Vector3().crossVectors(axis, u);
    const probeRadius = (f.radiusMm ?? 0) + SURFACE_PROBE_RING_OFFSET_MM;

    const faceFrom = (side) => {
      const tStart = side > 0 ? bHi + SURFACE_PROBE_START_MM : bLo - SURFACE_PROBE_START_MM;
      const dir = axis.clone().multiplyScalar(-side).toArray();
      let best = null;
      for (let k = 0; k < SURFACE_PROBE_RAYS; k++) {
        const ang = (k / SURFACE_PROBE_RAYS) * Math.PI * 2;
        const start = new THREE.Vector3(...f.origin)
          .addScaledVector(axis, tStart - t0)
          .addScaledVector(u, probeRadius * Math.cos(ang))
          .addScaledVector(v, probeRadius * Math.sin(ang));
        const d = raycast(start.toArray(), dir);
        if (d == null) continue;
        const t = tStart - side * d;
        if (t < f.tMin - SURFACE_PROBE_ACCEPT_MM || t > f.tMax + SURFACE_PROBE_ACCEPT_MM) continue;
        // keep the surface nearest the approaching insert
        if (best == null || (side > 0 ? t > best : t < best)) best = t;
      }
      return best;
    };

    // Clamp to the bbox: the 0.38mm erosion step-back is exact only on faces square to the ray
    const hi = Math.min(faceFrom(1) ?? f.tMax, bHi);
    const lo = Math.max(faceFrom(-1) ?? f.tMin, bLo);
    if (lo < hi) surfaces.set(f.featureId, { lo, hi });
  }
  return surfaces;
}

export const PIN_END_PROBE_RAYS = 8;
export const PIN_END_PROBE_START_RADIUS_MM = 4.5; // radial rays start this far from the pin axis
export const PIN_END_PROBE_INSET_MM = 1.5; // radial probe sits this far in from the pin end
// A radial ray must first hit the pin's own (eroded) surface within this distance window, i.e. at a
// radius of about 1.5–2.5mm (VEX pegs: r ≈ 2.0–2.4mm, minus 0.38mm erosion), entering through a front face.
export const PIN_END_PIN_SURFACE_HIT_MM = [2.0, 3.0];
// VEX pin tips are split: 2–4 of the 8 radial rays pass through the slot and miss.
export const PIN_END_MIN_RADIAL_HITS = 4;
export const PIN_END_BEYOND_MM = 1.0; // point past the end on the axis that must be in open air
const PIN_END_MAX_INSIDE_VOTES = 2; // of 6 rays; more first-hit back faces means the point is inside the body

/**
 * Measures which ends of each pin stick out of its part. `raycastHit(originArr, dirArr)` must return
 * the first hit `{ distance, normal }` on the part's mesh in part-local mm (normal: face normal),
 * or null on a miss. An end sticks out when
 *  (a) near it, open space surrounds the pin: ≥ PIN_END_MIN_RADIAL_HITS of PIN_END_PROBE_RAYS radial
 *      rays first hit the pin's own surface within PIN_END_PIN_SURFACE_HIT_MM, and none hits anything
 *      closer (material closer than the pin's surface means the probe started inside the body). Face
 *      orientation is ignored here: idler pins' smooth ends have inward-facing triangles, and
 *  (b) a point PIN_END_BEYOND_MM past the end is in open air: of 6 rays (±axis, ±u, ±v) from it,
 *      at most PIN_END_MAX_INSIDE_VOTES first meet a back face. An axial ray alone won't do: pins are
 *      hollow, so it runs down the bore and misses.
 * (a) rejects ends buried in the body (corner connector peg spans run through it); (b) rejects a
 * base end where the stored span stops at the body face (Triple corner connector +X pegs).
 * Returns Map(featureId -> { lo, hi }) of booleans for the tMin / tMax ends. Shafts are not measured.
 * A pin with neither end passing gets no entry (both ends count, as before measuring): that happens
 * on parts whose "peg" is really a hollow tube (Straight Standoff Connector), where the test can't be
 * trusted.
 */
export function measurePinEnds(partMeta, raycastHit) {
  const ends = new Map();
  const _dir = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const entersFrontFace = (hit, dirArr) =>
    hit && _n.fromArray(hit.normal).dot(_dir.fromArray(dirArr)) < 0;

  for (const f of getLocalFeatures(partMeta)) {
    if (f.kind !== 'pin') continue;
    const length = f.tMax - f.tMin;
    if (!(length > 0)) continue; // unmeasurable: both ends count (no entry)
    const axis = new THREE.Vector3(...f.axis);
    const t0 = dot3(f.origin, f.axis);
    const u = new THREE.Vector3()
      .crossVectors(axis, Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
      .normalize();
    const v = new THREE.Vector3().crossVectors(axis, u);
    const onAxis = (t) => new THREE.Vector3(...f.origin).addScaledVector(axis, t - t0);

    const sticksOut = (side) => {
      const tEnd = side > 0 ? f.tMax : f.tMin;
      const inset = Math.min(PIN_END_PROBE_INSET_MM, length / 2);
      const center = onAxis(tEnd - side * inset);
      let radialHits = 0;
      for (let k = 0; k < PIN_END_PROBE_RAYS; k++) {
        const ang = (k / PIN_END_PROBE_RAYS) * Math.PI * 2;
        const out = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang));
        const start = center.clone().addScaledVector(out, PIN_END_PROBE_START_RADIUS_MM).toArray();
        const dir = out.negate().toArray();
        const hit = raycastHit(start, dir);
        if (!hit) continue; // through the tip slot
        if (hit.distance < PIN_END_PIN_SURFACE_HIT_MM[0]) return false; // probe started inside the body
        if (hit.distance <= PIN_END_PIN_SURFACE_HIT_MM[1]) radialHits++;
      }
      if (radialHits < PIN_END_MIN_RADIAL_HITS) return false;

      const beyond = onAxis(tEnd + side * PIN_END_BEYOND_MM).toArray();
      let insideVotes = 0;
      for (const dirVec of [axis, u, v].flatMap((d) => [d, d.clone().negate()])) {
        const dir = dirVec.toArray();
        const hit = raycastHit(beyond, dir);
        if (hit && !entersFrontFace(hit, dir)) insideVotes++;
      }
      return insideVotes <= PIN_END_MAX_INSIDE_VOTES;
    };

    const lo = sticksOut(-1);
    const hi = sticksOut(1);
    if (lo || hi) ends.set(f.featureId, { lo, hi });
  }
  return ends;
}

/**
 * World-space inserts/openings for one placed part. Each feature carries its axis line
 * (`origin`, unit `axis`), the two world end points of its usable length (`start`, `end`),
 * and for openings the rim radius at the face (`radiusMm`) and whether it goes through (`through`).
 * `measured.surfaces` (from measureOpeningSurfaces) replaces an opening's extent with its measured
 * mesh faces; `measured.pinEnds` (from measurePinEnds) sets which pin ends stick out
 * (`freeAtStart` / `freeAtEnd` for the `start` / `end` points; both true when not measured).
 */
export function collectWorldFeatures(partMeta, matrixWorld, instanceId, measured = null) {
  const surfaces = measured?.surfaces;
  const pinEnds = measured?.pinEnds;
  const result = [];
  for (const f of getLocalFeatures(partMeta)) {
    const origin = new THREE.Vector3(...f.origin);
    const axis = new THREE.Vector3(...f.axis);
    const t0 = dot3(f.origin, f.axis);
    const measured = surfaces?.get(f.featureId);
    const tMin = measured ? measured.lo : f.tMin;
    const tMax = measured ? measured.hi : f.tMax;
    const start = origin.clone().addScaledVector(axis, tMin - t0).applyMatrix4(matrixWorld);
    const end = origin.clone().addScaledVector(axis, tMax - t0).applyMatrix4(matrixWorld);
    origin.applyMatrix4(matrixWorld);
    axis.transformDirection(matrixWorld);
    result.push({
      instanceId,
      featureId: f.featureId,
      kind: f.kind,
      origin,
      axis,
      start,
      end,
      radiusMm: f.radiusMm,
      through: f.through,
      ...(f.kind === 'pin'
        ? { freeAtStart: pinEnds?.get(f.featureId)?.lo ?? true, freeAtEnd: pinEnds?.get(f.featureId)?.hi ?? true }
        : {})
    });
  }
  return result;
}

/** World AABB of the part's catalog bbox (used to skip far-away parts before the per-feature loop). */
export function worldPartBox(partMeta, matrixWorld) {
  const bbox = partMeta?.bbox;
  if (!bbox) return null;
  return new THREE.Box3(
    new THREE.Vector3(...bbox.min),
    new THREE.Vector3(...bbox.max)
  ).applyMatrix4(matrixWorld);
}

const _v = new THREE.Vector3();

const projectRange = (a, b, origin, axis) => {
  const ta = _v.subVectors(a, origin).dot(axis);
  const tb = _v.subVectors(b, origin).dot(axis);
  return ta <= tb ? [ta, tb] : [tb, ta];
};

/**
 * When `opening` lines up with `insert` and the insert is still outside it, returns
 * { face, farFace, outward }: the world points of the opening's face toward the insert and its
 * opposite face, and the unit axis direction pointing from the opening out toward the insert.
 * Otherwise null.
 */
function facesIfAlignedAndOutside(insert, opening) {
  if (Math.abs(insert.axis.dot(opening.axis)) < PARALLEL_MIN_DOT) return null;

  _v.subVectors(opening.origin, insert.origin);
  const along = _v.dot(insert.axis);
  const perpSq = _v.lengthSq() - along * along;
  if (perpSq > MAX_LINE_DISTANCE_MM * MAX_LINE_DISTANCE_MM) return null;

  const [iMin, iMax] = projectRange(insert.start, insert.end, insert.origin, insert.axis);
  const [oMin, oMax] = projectRange(opening.start, opening.end, insert.origin, insert.axis);
  const overlap = Math.min(iMax, oMax) - Math.max(iMin, oMin);
  if (overlap > OUTSIDE_OVERLAP_ALLOWANCE_MM || -overlap > MAX_AXIAL_GAP_MM) return null;

  // The insert sits entirely on one side of the opening; pick the opening end on that side.
  const insertAbove = iMin + iMax > oMin + oMax;

  // A pin only reaches openings on a side where it sticks out of its part
  if (insert.kind === 'pin') {
    const startIsLower =
      _v.subVectors(insert.start, insert.origin).dot(insert.axis) <=
      _v.subVectors(insert.end, insert.origin).dot(insert.axis);
    // opening below the insert (insertAbove) is reached through the insert's lower end
    const usesStart = insertAbove === startIsLower;
    if (!(usesStart ? insert.freeAtStart : insert.freeAtEnd)) return null;
  }
  const tStart = _v.subVectors(opening.start, insert.origin).dot(insert.axis);
  const tEnd = _v.subVectors(opening.end, insert.origin).dot(insert.axis);
  const nearIsStart = insertAbove === tStart >= tEnd;
  return {
    face: (nearIsStart ? opening.start : opening.end).clone(),
    farFace: (nearIsStart ? opening.end : opening.start).clone(),
    outward: insert.axis.clone().multiplyScalar(insertAbove ? 1 : -1)
  };
}

/**
 * Openings to highlight for the selected part, checked both ways: the selected part's
 * pins/shaft against other parts' openings, and its openings against other parts' pins/shafts.
 * Each result carries `face` (world point on the opening's axis at the face toward the insert),
 * `farFace` (the opposite face, or null for a blind opening) and `outward` (unit axis direction
 * from the opening toward the insert).
 */
export function findAlignedOpenings(selectedFeatures, otherFeatures) {
  const hits = new Map();
  for (const s of selectedFeatures) {
    for (const o of otherFeatures) {
      if (s.instanceId === o.instanceId) continue;
      let insert = null;
      let opening = null;
      if (OPENINGS_BY_INSERT[s.kind]?.has(o.kind)) {
        insert = s;
        opening = o;
      } else if (OPENINGS_BY_INSERT[o.kind]?.has(s.kind)) {
        insert = o;
        opening = s;
      } else {
        continue;
      }
      const key = `${opening.instanceId}:${opening.featureId}`;
      if (hits.has(key)) continue;
      const faces = facesIfAlignedAndOutside(insert, opening);
      if (faces) hits.set(key, { opening, insert, ...faces });
    }
  }
  return [...hits.values()].map(({ opening, insert, face, farFace, outward }) => ({
    instanceId: opening.instanceId,
    featureId: opening.featureId,
    kind: opening.kind,
    origin: opening.origin,
    axis: opening.axis,
    start: opening.start,
    end: opening.end,
    face,
    farFace: opening.through ? farFace : null,
    outward,
    radiusMm: opening.radiusMm,
    insertInstanceId: insert.instanceId,
    insertFeatureId: insert.featureId,
    insertOrigin: insert.origin,
    insertAxis: insert.axis,
    insertStart: insert.start,
    insertEnd: insert.end
  }));
}

const maxAlong = (a, b, dir) => Math.max(a.dot(dir), b.dot(dir));
const minAlong = (a, b, dir) => Math.min(a.dot(dir), b.dot(dir));

/**
 * Groups the selected part's highlighted pairs (from findAlignedOpenings) into mate directions.
 * Returns [{ direction, pairs, lateral, travelMm, sweepMm }]:
 *  - direction: unit travel of the selected part: toward the opening when it holds the pin/shaft,
 *    toward the pin/shaft when it holds the opening; directions within 2° are merged;
 *  - lateral: sideways shift (≤ the 0.25mm alignment tolerance) that puts the nearest pair exactly
 *    on axis;
 *  - travelMm: how far to go when nothing is touched: until the pin/shaft's leading end is flush with
 *    the far face of the farthest opening (relative to the opening, the insert moves along v, so
 *    travel = max_v(opening) − max_v(insert));
 *  - sweepMm: how far to keep looking for contact: as long as the pin/shaft is still in an opening,
 *    i.e. until its trailing end reaches the far face (sweep = max_v(opening) − min_v(insert)). A pin's
 *    shoulder or cap meets the face well inside this range; a plain shaft finds nothing and stops at
 *    travelMm.
 */
export function planMates(alignedOpenings, selectedId) {
  const plans = [];
  for (const pair of alignedOpenings) {
    const holdsInsert = pair.insertInstanceId === selectedId;
    const direction = pair.outward.clone().multiplyScalar(holdsInsert ? -1 : 1);
    let plan = plans.find((p) => p.direction.dot(direction) >= PARALLEL_MIN_DOT);
    if (!plan) {
      plan = { direction, pairs: [], lateral: new THREE.Vector3(), travelMm: 0, sweepMm: 0 };
      plans.push(plan);
    }
    plan.pairs.push(pair);
  }

  for (const plan of plans) {
    let nearestGap = Infinity;
    for (const pair of plan.pairs) {
      const holdsInsert = pair.insertInstanceId === selectedId;
      const v = plan.direction.clone().multiplyScalar(holdsInsert ? 1 : -1);
      const travel =
        maxAlong(pair.start, pair.end, v) - maxAlong(pair.insertStart, pair.insertEnd, v);
      plan.travelMm = Math.max(plan.travelMm, travel);
      const sweep = maxAlong(pair.start, pair.end, v) - minAlong(pair.insertStart, pair.insertEnd, v);
      plan.sweepMm = Math.max(plan.sweepMm, sweep);

      const gap = minAlong(pair.start, pair.end, v) - maxAlong(pair.insertStart, pair.insertEnd, v);
      if (gap < nearestGap) {
        nearestGap = gap;
        const w = _v.subVectors(pair.origin, pair.insertOrigin);
        const perp = w.clone().addScaledVector(pair.insertAxis, -w.dot(pair.insertAxis));
        plan.lateral = holdsInsert ? perp : perp.negate();
      }
    }
  }
  return plans;
}
