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

export const DEPTH_PROBE_RADIUS_FRACTION = 0.5; // off-axis depth rays sit at half the rim radius
export const DEPTH_THROUGH_SLACK_MM = 0.5; // open to within this much of the full length counts as through
export const DEPTH_MIN_OPEN_MM = 1.0; // shallower than this from a face means that face is closed (e.g. the Smart Motor's ~0.4 mm back marks)

/**
 * Measures how deep each opening really is from each of its faces, by casting five rays along the
 * axis (one on it, four at half the rim radius) from outside the part into the opening, from both
 * sides; the median first hit gives the depth from that face. `raycast(originArr, dirArr)` returns
 * the distance to the part's surface in part-local mm, or null on a miss (a miss = open all the way).
 * Faces come from `surfaces` (measureOpeningSurfaces) when given, else the catalog extent.
 * Returns Map(featureId -> { fromLo, fromHi, length }) in mm; a side with no usable ray is left out.
 */
export function measureOpeningDepths(partMeta, raycast, surfaces = null) {
  const depths = new Map();
  const bbox = partMeta?.bbox;
  if (!bbox) return depths;

  for (const f of getLocalFeatures(partMeta)) {
    if (OPENINGS_BY_INSERT[f.kind]) continue; // inserts keep their extent
    const axis = new THREE.Vector3(...f.axis);
    const t0 = dot3(f.origin, f.axis);
    const [bLo, bHi] = bboxRangeAlong(bbox, f.axis);
    const faceLo = surfaces?.get(f.featureId)?.lo ?? f.tMin;
    const faceHi = surfaces?.get(f.featureId)?.hi ?? f.tMax;
    const length = faceHi - faceLo;
    if (!(length > 0)) continue;
    const u = new THREE.Vector3()
      .crossVectors(axis, Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
      .normalize();
    const v = new THREE.Vector3().crossVectors(axis, u);
    const r = (f.radiusMm ?? 0) * DEPTH_PROBE_RADIUS_FRACTION;
    const offsets = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]];

    // Depth of open space from the face on `side` (+1: from faceHi going -axis), or undefined
    const depthFrom = (side) => {
      const tStart = side > 0 ? bHi + SURFACE_PROBE_START_MM : bLo - SURFACE_PROBE_START_MM;
      const dir = axis.clone().multiplyScalar(-side).toArray();
      const face = side > 0 ? faceHi : faceLo;
      const found = [];
      for (const [a, b] of offsets) {
        const start = new THREE.Vector3(...f.origin)
          .addScaledVector(axis, tStart - t0)
          .addScaledVector(u, a)
          .addScaledVector(v, b);
        const d = raycast(start.toArray(), dir);
        if (d == null) {
          found.push(length);
          continue;
        }
        const t = tStart - side * d;
        // A hit before the face means something overhangs the entrance: no reading from this ray
        if (side > 0 ? t > face + SURFACE_PROBE_ACCEPT_MM : t < face - SURFACE_PROBE_ACCEPT_MM) continue;
        found.push(Math.min(Math.max(side > 0 ? face - t : t - face, 0), length));
      }
      if (found.length === 0) return undefined;
      found.sort((x, y) => x - y);
      return found[Math.floor(found.length / 2)];
    };

    const entry = { length };
    const lo = depthFrom(-1);
    const hi = depthFrom(1);
    if (lo !== undefined) entry.fromLo = lo;
    if (hi !== undefined) entry.fromHi = hi;
    depths.set(f.featureId, entry);
  }
  return depths;
}

/**
 * Open spans of an opening along its axis (absolute t) from its measured depths: one through span,
 * or a blind span from each face that is open. [{ suffix, lo, hi, through }]; suffix '@lo' / '@hi'
 * only when the opening splits into two blind openings.
 */
function openingSpans(lo, hi, through, depth) {
  if (!depth) return [{ suffix: '', lo, hi, through }];
  const full = depth.length - DEPTH_THROUGH_SLACK_MM;
  if ((depth.fromLo ?? 0) >= full || (depth.fromHi ?? 0) >= full) {
    return [{ suffix: '', lo, hi, through: depth.fromLo !== undefined && depth.fromHi !== undefined ? true : through }];
  }
  const spans = [];
  if ((depth.fromHi ?? 0) > DEPTH_MIN_OPEN_MM) spans.push({ suffix: '@hi', lo: hi - depth.fromHi, hi, through: false });
  if ((depth.fromLo ?? 0) > DEPTH_MIN_OPEN_MM) spans.push({ suffix: '@lo', lo, hi: lo + depth.fromLo, through: false });
  if (spans.length === 0) return [{ suffix: '', lo, hi, through }];
  if (spans.length === 1) spans[0].suffix = '';
  return spans;
}

// --- Parts too wide to go through a hole ------------------------------------------------------------
// Collision meshes are shrunk 0.38 mm per part so pins and shafts can sit in their holes, which hides
// overlaps smaller than ~0.76 mm. A capped shaft's cap (radius ~2.37 mm) is only ~0.28 mm wider than
// a beam hole (~2.08 mm), so it slid straight through. These measurements catch that case exactly.
export const PASS_PROBE_RAYS = 24;
export const PASS_TOLERANCE_MM = 0.05; // a section must be this much wider than the hole to block it
export const PASS_MAX_LATERAL_MM = 1.0; // further off the hole's line, the collision meshes catch it
const PASS_SECTIONS = 5; // depths probed inside each opening
const PROFILE_STEP_MM = 0.2; // spacing of the shaft width samples
const PROFILE_PROBE_START_MM = 6; // inward rays start this far from the shaft's axis

const crossAxes = (axis) => {
  const u = new THREE.Vector3()
    .crossVectors(axis, Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0))
    .normalize();
  return [u, new THREE.Vector3().crossVectors(axis, u)];
};

/**
 * How wide a part may be to pass through each opening: at several depths, rays go out from the
 * opening's axis to its wall in PASS_PROBE_RAYS directions; a section passes up to its widest
 * reach (a square bore passes up to its corners), and the opening passes what its narrowest
 * section does. `raycast(originArr, dirArr)` returns the distance to the visible surface, or null.
 * Rubber shaft collars are left out: they are made to grip a shaft tighter than its width.
 * Returns Map(featureId -> pass radius in mm).
 */
export function measureOpeningPassRadii(partMeta, raycast) {
  const radii = new Map();
  if (COLLAR_NAME_PATTERN.test(partMeta?.name || '')) return radii;
  for (const f of getLocalFeatures(partMeta)) {
    if (OPENINGS_BY_INSERT[f.kind] || f.kind === 'collar_hole') continue;
    const axis = new THREE.Vector3(...f.axis);
    const [u, v] = crossAxes(axis);
    const t0 = dot3(f.origin, f.axis);
    const inset = Math.min(0.3, (f.tMax - f.tMin) / 4);
    let pass = Infinity;
    for (let i = 0; i < PASS_SECTIONS; i++) {
      const t = f.tMin + inset + ((f.tMax - f.tMin - 2 * inset) * i) / (PASS_SECTIONS - 1);
      const center = new THREE.Vector3(...f.origin).addScaledVector(axis, t - t0);
      let widest = 0;
      for (let k = 0; k < PASS_PROBE_RAYS; k++) {
        const ang = (k / PASS_PROBE_RAYS) * Math.PI * 2;
        const dir = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang));
        const d = raycast(center.toArray(), dir.toArray());
        widest = Math.max(widest, d == null ? Infinity : d);
      }
      if (widest > 0 && Number.isFinite(widest)) pass = Math.min(pass, widest);
    }
    if (Number.isFinite(pass)) radii.set(f.featureId, pass);
  }
  return radii;
}

/**
 * Width along each shaft of a shaft part (straight or capped), every PROFILE_STEP_MM: rays come in
 * toward the axis from PASS_PROBE_RAYS directions, and a section counts its narrowest reach (a
 * square shaft counts its flats). `raycast` as for measureOpeningPassRadii.
 * Returns Map(featureId -> [{ t, r }]) with t measured from the feature origin along its axis.
 */
export function measureShaftProfiles(partMeta, raycast) {
  const profiles = new Map();
  if (!SHAFT_FASTENER_TYPES.has(partMeta?.fastenerSpecs?.fastenerType)) return profiles;
  if (COLLAR_NAME_PATTERN.test(partMeta?.name || '')) return profiles;
  for (const f of getLocalFeatures(partMeta)) {
    if (f.kind !== 'shaft' || !Number.isFinite(f.tMin) || !Number.isFinite(f.tMax)) continue;
    const axis = new THREE.Vector3(...f.axis);
    const [u, v] = crossAxes(axis);
    const t0 = dot3(f.origin, f.axis);
    const samples = [];
    for (let t = f.tMin; t <= f.tMax + 1e-6; t += PROFILE_STEP_MM) {
      const center = new THREE.Vector3(...f.origin).addScaledVector(axis, t - t0);
      // A shaft is solid: a ray that misses slipped through a mesh seam and is skipped
      let narrowest = Infinity;
      for (let k = 0; k < PASS_PROBE_RAYS; k++) {
        const ang = (k / PASS_PROBE_RAYS) * Math.PI * 2;
        const dir = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(v, Math.sin(ang));
        const start = center.clone().addScaledVector(dir, PROFILE_PROBE_START_MM);
        const d = raycast(start.toArray(), dir.clone().negate().toArray());
        if (d != null) narrowest = Math.min(narrowest, Math.max(0, PROFILE_PROBE_START_MM - d));
      }
      const r = Number.isFinite(narrowest) ? narrowest : 0;
      samples.push({ t: Number((t - t0).toFixed(3)), r: Number(r.toFixed(3)) });
    }
    profiles.set(f.featureId, samples);
  }
  return profiles;
}

/**
 * Shafts that sit (almost) on an opening's line with a section inside it that is too wide to pass:
 * e.g. a capped shaft pushed so far that its cap is in the hole. Lines must be parallel within 2°
 * and at most PASS_MAX_LATERAL_MM apart (further off, the collision meshes catch it). Needs features
 * from collectWorldFeatures with measured `profiles` and `passRadii`. Returns [{ insert, opening,
 * widthMm, passMm }].
 */
export function findTooWideInserts(featuresA, featuresB) {
  const hits = [];
  for (const a of featuresA) {
    for (const b of featuresB) {
      if (a.instanceId === b.instanceId) continue;
      const roles = pairRoles(a, b);
      if (!roles?.insert.profile || !Number.isFinite(roles.opening.passRadius)) continue;
      const { insert, opening } = roles;
      if (Math.abs(insert.axis.dot(opening.axis)) < PARALLEL_MIN_DOT) continue;
      _v.subVectors(opening.origin, insert.origin);
      const along = _v.dot(insert.axis);
      const lateral = Math.sqrt(Math.max(0, _v.lengthSq() - along * along));
      if (lateral > PASS_MAX_LATERAL_MM) continue;
      const [oMin, oMax] = projectRange(opening.start, opening.end, insert.origin, insert.axis);
      const blocked = insert.profile.find(
        (s) => s.t > oMin + 0.1 && s.t < oMax - 0.1 && s.r + lateral > opening.passRadius + PASS_TOLERANCE_MM
      );
      if (blocked) hits.push({ insert, opening, widthMm: blocked.r, passMm: opening.passRadius });
    }
  }
  return hits;
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
 * (`freeAtStart` / `freeAtEnd` for the `start` / `end` points; both true when not measured);
 * `measured.depths` (from measureOpeningDepths) cuts an opening down to its really open part, and
 * splits one listed as through but blocked inside into two blind openings, `<id>@lo` and `<id>@hi`.
 */
export function collectWorldFeatures(partMeta, matrixWorld, instanceId, measured = null) {
  const surfaces = measured?.surfaces;
  const pinEnds = measured?.pinEnds;
  const result = [];
  const depths = measured?.depths;
  const profiles = measured?.profiles;
  const passRadii = measured?.passRadii;
  for (const f of getLocalFeatures(partMeta)) {
    const t0 = dot3(f.origin, f.axis);
    const measuredFaces = surfaces?.get(f.featureId);
    const isOpening = !OPENINGS_BY_INSERT[f.kind];
    const spans = isOpening
      ? openingSpans(measuredFaces ? measuredFaces.lo : f.tMin, measuredFaces ? measuredFaces.hi : f.tMax, f.through, depths?.get(f.featureId))
      : [{ suffix: '', lo: f.tMin, hi: f.tMax }];
    for (const span of spans) {
      const origin = new THREE.Vector3(...f.origin);
      const axis = new THREE.Vector3(...f.axis);
      const start = origin.clone().addScaledVector(axis, span.lo - t0).applyMatrix4(matrixWorld);
      const end = origin.clone().addScaledVector(axis, span.hi - t0).applyMatrix4(matrixWorld);
      origin.applyMatrix4(matrixWorld);
      axis.transformDirection(matrixWorld);
      result.push({
        instanceId,
        featureId: f.featureId + span.suffix,
        kind: f.kind,
        origin,
        axis,
        start,
        end,
        radiusMm: f.radiusMm,
        through: isOpening ? span.through : f.through,
        ...(profiles?.has(f.featureId) ? { profile: profiles.get(f.featureId) } : {}),
        ...(passRadii?.has(f.featureId) ? { passRadius: passRadii.get(f.featureId) } : {}),
        ...(f.kind === 'pin'
          ? { freeAtStart: pinEnds?.get(f.featureId)?.lo ?? true, freeAtEnd: pinEnds?.get(f.featureId)?.hi ?? true }
          : {})
      });
    }
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

/** True when two axis lines are parallel within 2° and within 0.25 mm of each other. */
function linesCoincide(originA, axisA, originB, axisB) {
  if (Math.abs(axisA.dot(axisB)) < PARALLEL_MIN_DOT) return false;
  _v.subVectors(originB, originA);
  const along = _v.dot(axisA);
  return _v.lengthSq() - along * along <= MAX_LINE_DISTANCE_MM * MAX_LINE_DISTANCE_MM;
}

/**
 * When `insert` and `opening` share an axis line, returns their spans along the insert's axis
 * ({ iMin, iMax, oMin, oMax }) and how much they overlap (`overlap`, negative = gap). Otherwise null.
 */
function coaxialSpans(insert, opening) {
  if (!linesCoincide(insert.origin, insert.axis, opening.origin, opening.axis)) return null;
  const [iMin, iMax] = projectRange(insert.start, insert.end, insert.origin, insert.axis);
  const [oMin, oMax] = projectRange(opening.start, opening.end, insert.origin, insert.axis);
  return { iMin, iMax, oMin, oMax, overlap: Math.min(iMax, oMax) - Math.max(iMin, oMin) };
}

/** Insert/opening roles for a selected and an other feature, or null when they don't fit together. */
function pairRoles(s, o) {
  if (OPENINGS_BY_INSERT[s.kind]?.has(o.kind)) return { insert: s, opening: o };
  if (OPENINGS_BY_INSERT[o.kind]?.has(s.kind)) return { insert: o, opening: s };
  return null;
}

/**
 * When `opening` lines up with `insert` and the insert is still outside it, returns
 * { face, farFace, outward }: the world points of the opening's face toward the insert and its
 * opposite face, and the unit axis direction pointing from the opening out toward the insert.
 * Otherwise null.
 */
function facesIfAlignedAndOutside(insert, opening) {
  const spans = coaxialSpans(insert, opening);
  if (!spans) return null;
  const { iMin, iMax, oMin, oMax, overlap } = spans;
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
      const roles = pairRoles(s, o);
      if (!roles) continue;
      const { insert, opening } = roles;
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

/**
 * The selected part's engaged joints: pairs where one part's pin/shaft sits inside the other's
 * opening (same pairing and axis rules as findAlignedOpenings, axial overlap above
 * OUTSIDE_OVERLAP_ALLOWANCE_MM, i.e. exactly the pairs facesIfAlignedAndOutside rejects as already
 * inside). Pairs on the same axis line are merged. Returns { lines: [{ origin, axis, pairs }] } with
 * `axis` pointing the same way for every pair of a line; each pair is { insert, opening }.
 */
export function findEngagedJoints(selectedFeatures, otherFeatures) {
  const lines = [];
  for (const pair of findSeatedPairs(selectedFeatures, otherFeatures)) {
    const s = pair.featureA;
    let line = lines.find((l) => linesCoincide(l.origin, l.axis, s.origin, s.axis));
    if (!line) {
      line = { origin: s.origin.clone(), axis: s.axis.clone(), pairs: [] };
      lines.push(line);
    }
    line.pairs.push({ insert: pair.insert, opening: pair.opening });
  }
  return { lines };
}

/**
 * Every pin/shaft-in-opening pair between features of `featuresA` and of `featuresB` (different
 * parts) that is seated: matching kinds, axes within 2° and 0.25 mm, and overlapping along the axis
 * by more than OUTSIDE_OVERLAP_ALLOWANCE_MM. [{ insert, opening, overlapMm, featureA }], where
 * `featureA` is whichever of the two came from `featuresA`.
 */
export function findSeatedPairs(featuresA, featuresB) {
  const pairs = [];
  for (const a of featuresA) {
    for (const b of featuresB) {
      if (a.instanceId === b.instanceId) continue;
      const roles = pairRoles(a, b);
      if (!roles) continue;
      const spans = coaxialSpans(roles.insert, roles.opening);
      if (!spans || spans.overlap <= OUTSIDE_OVERLAP_ALLOWANCE_MM) continue;
      pairs.push({ ...roles, overlapMm: spans.overlap, featureA: a });
    }
  }
  return pairs;
}

// Hole snapping while dragging: the farthest a part is pulled onto a hole's line, how far apart
// along that line a pin/shaft and opening may be for the pull to apply, and how big a sideways miss
// the pull also settles on axes that aren't being dragged (a part that drifted slightly off a hole
// pattern, e.g. after snapping into a gear's turned pin hole, otherwise never lines up again).
export const HOLE_SNAP_RADIUS_MM = 3.5;
export const HOLE_SNAP_AXIAL_REACH_MM = 2 * VEX_PITCH_MM;
export const HOLE_SNAP_SETTLE_MM = 1.0;

/**
 * The move, using only `directions` (unit world vectors being dragged along), that best puts the
 * line of `axis` through `fromPoint` onto the parallel line through `toPoint`. Null when the drag
 * directions can't line them up to within HOLE_SNAP_SETTLE_MM; a smaller leftover miss is closed
 * by also moving straight across the line.
 */
function moveOntoLine(fromPoint, toPoint, axis, directions) {
  const offset = new THREE.Vector3().subVectors(toPoint, fromPoint);
  offset.addScaledVector(axis, -offset.dot(axis)); // perpendicular part: what has to be closed
  // Each drag direction's effect on that gap (its part across the line); along the line does nothing
  const usable = directions
    .map((dir) => ({ dir, across: dir.clone().addScaledVector(axis, -dir.dot(axis)) }))
    .filter((d) => d.across.lengthSq() > 1e-4);

  let move;
  if (usable.length === 0) {
    move = new THREE.Vector3(); // dragging along the line: only a small sideways settle can apply
  } else if (usable.length >= 3) {
    move = offset.clone(); // free drag: move straight across
  } else if (usable.length === 2) {
    const [a, b] = usable;
    const aa = a.across.dot(a.across);
    const ab = a.across.dot(b.across);
    const bb = b.across.dot(b.across);
    const det = aa * bb - ab * ab;
    if (Math.abs(det) > 1e-6) {
      const ra = a.across.dot(offset);
      const rb = b.across.dot(offset);
      const ca = (ra * bb - rb * ab) / det;
      const cb = (rb * aa - ra * ab) / det;
      move = a.dir.clone().multiplyScalar(ca).addScaledVector(b.dir, cb);
    } else {
      usable.splice(aa >= bb ? 1 : 0, 1);
    }
  }
  if (!move) {
    const [{ dir, across }] = usable;
    move = dir.clone().multiplyScalar(across.dot(offset) / across.dot(across));
  }

  // Whatever the drag directions can't close, up to HOLE_SNAP_SETTLE_MM, is closed straight across
  const reached = move.clone().addScaledVector(axis, -move.dot(axis));
  const miss = offset.clone().sub(reached);
  if (miss.length() > HOLE_SNAP_SETTLE_MM) return null;
  return move.add(miss);
}

/**
 * Hole snapping while dragging: the smallest move of the selected part, along the dragged
 * `directions` (plus up to HOLE_SNAP_SETTLE_MM straight across), that puts one of its
 * pins/shafts/openings on the axis line of a matching
 * opening/pin/shaft of another part (same pairing rules as the hole highlights, axes parallel within
 * 2°). The move must be at most `radiusMm`, and the two must be within `axialReachMm` of each other
 * along the line, or overlapping. Works at any part angle, since it uses the real hole lines.
 * Returns { offset: Vector3 (world mm), insert, opening } or null.
 */
export function findHoleSnap(
  selectedFeatures,
  otherFeatures,
  directions,
  { radiusMm = HOLE_SNAP_RADIUS_MM, axialReachMm = HOLE_SNAP_AXIAL_REACH_MM } = {}
) {
  let best = null;
  for (const s of selectedFeatures) {
    for (const o of otherFeatures) {
      if (s.instanceId === o.instanceId) continue;
      const roles = pairRoles(s, o);
      if (!roles) continue;
      if (Math.abs(s.axis.dot(o.axis)) < PARALLEL_MIN_DOT) continue;
      const axis = o.axis;
      _v.subVectors(o.origin, s.origin);
      const along = _v.dot(axis);
      if (_v.lengthSq() - along * along > radiusMm * radiusMm) continue; // moving can't be shorter
      const [sMin, sMax] = projectRange(s.start, s.end, o.origin, axis);
      const [oMin, oMax] = projectRange(o.start, o.end, o.origin, axis);
      if (Math.max(oMin - sMax, sMin - oMax) > axialReachMm) continue;
      const move = moveOntoLine(s.origin, o.origin, axis, directions);
      if (!move || move.length() > radiusMm) continue;
      if (!best || move.lengthSq() < best.offset.lengthSq()) best = { offset: move, ...roles };
    }
  }
  return best;
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

// --- Picking a hole: the pose that puts a part's pin or shaft into a chosen hole -------------------

export const PICK_GAP_MM = 1.0; // the leading end waits this far outside the picked face
// Holes searched for another pin of the pattern may sit this far from the picked hole along its axis
const PATTERN_AXIAL_REACH_MM = 2 * VEX_PITCH_MM;
const LOCAL_AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];

/**
 * The ends an insert can go into a hole with: a pin's ends that stick out of its part, both ends of
 * a straight shaft, the uncapped (low) end of a capped shaft. [{ end: 'lo' | 'hi', dir, point }] in
 * part-local mm, `dir` pointing from the insert toward that end.
 */
export function insertLeadEnds(partMeta, feature, measured = null) {
  const axis = new THREE.Vector3(...feature.axis);
  const t0 = dot3(feature.origin, feature.axis);
  const pointAt = (t) => new THREE.Vector3(...feature.origin).addScaledVector(axis, t - t0);
  const ends = [];
  const add = (end) =>
    ends.push({
      end,
      dir: end === 'hi' ? axis.clone() : axis.clone().negate(),
      point: pointAt(end === 'hi' ? feature.tMax : feature.tMin)
    });
  if (feature.kind === 'pin') {
    const sticksOut = measured?.pinEnds?.get(feature.featureId) ?? { lo: true, hi: true };
    if (sticksOut.lo) add('lo');
    if (sticksOut.hi) add('hi');
  } else if (feature.kind === 'shaft') {
    add('lo');
    if (partMeta?.fastenerSpecs?.fastenerType !== 'capped_shaft') add('hi');
  }
  return ends;
}

// Of `axes`, the one most across `dir`, made exactly perpendicular to it
const mostAcross = (dir, axes) => {
  const best = axes.reduce((a, b) => (Math.abs(a.dot(dir)) <= Math.abs(b.dot(dir)) ? a : b));
  return best.clone().addScaledVector(dir, -best.dot(dir)).normalize();
};

/**
 * Pose of the selected part (design.md §1) with insert `featureId` going in by its `end` through the
 * hole face at world point `face`, whose `outward` unit direction points toward the side the part
 * comes from. The insert's axis lies on the hole's axis pointing in, its leading end `gapMm` outside
 * the face, and the part rolled around the axis to match the receiving part (its world rotation
 * `receivingQuaternion`), plus `roll` quarter turns, or `rollRad` radians when given.
 * Returns { quaternion, position, rotationDeg, matrix, leadPoint } or null when the insert/end is unknown.
 */
export function insertPose({ partMeta, measured = null, featureId, end, face, outward, receivingQuaternion, roll = 0, rollRad = null, gapMm = PICK_GAP_MM }) {
  const feature = getLocalFeatures(partMeta).find((f) => f.featureId === featureId);
  const lead = feature && insertLeadEnds(partMeta, feature, measured).find((e) => e.end === end);
  if (!lead) return null;
  const n = outward.clone().normalize();
  const inward = n.clone().negate();
  const rs = mostAcross(lead.dir, LOCAL_AXES);
  const rr = mostAcross(n, LOCAL_AXES.map((a) => a.clone().applyQuaternion(receivingQuaternion)));
  const rk = rr.applyAxisAngle(n, rollRad ?? (roll * Math.PI) / 2);
  const local = new THREE.Matrix4().makeBasis(lead.dir, rs, lead.dir.clone().cross(rs));
  const world = new THREE.Matrix4().makeBasis(inward, rk, inward.clone().cross(rk));
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(world.multiply(local.transpose()));
  const leadPoint = face.clone().addScaledVector(n, gapMm);
  const position = leadPoint.clone().sub(lead.point.clone().applyQuaternion(quaternion));
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  const rotationDeg = [euler.x, euler.y, euler.z].map((r) => Number(THREE.MathUtils.radToDeg(r).toFixed(4)));
  const matrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
  return { quaternion, position, rotationDeg, matrix, leadPoint };
}

/**
 * Faces of a world opening the part can go in through: { point, outward } with `outward` pointing out
 * of the opening at that face. Through openings: both. A blind opening split per face ('@hi' /
 * '@lo'): its open face. Other blind openings (Smart Motor socket, standoff ends): the `end` face,
 * since their axis points out of the opening.
 */
export function openFaces(opening) {
  const along = new THREE.Vector3().subVectors(opening.end, opening.start);
  if (along.lengthSq() < 1e-9) along.copy(opening.axis);
  along.normalize();
  const atEnd = { point: opening.end.clone(), outward: along.clone() };
  const atStart = { point: opening.start.clone(), outward: along.clone().negate() };
  if (opening.through) return [atStart, atEnd];
  if (opening.featureId.endsWith('@lo')) return [atStart];
  return [atEnd];
}

/** True when another part's pin or shaft is already seated in `opening`. */
export function isOpeningTaken(opening, otherFeatures) {
  return findSeatedPairs([opening], otherFeatures.filter((f) => f.instanceId !== opening.instanceId)).length > 0;
}

/**
 * True when rolling the part around `feature`'s axis can't change how it looks: the axis runs
 * through the middle of the part's bbox and the bbox is equally wide both ways across it (pins,
 * shafts, standoffs). Such a part gets one roll instead of four.
 */
function spinSymmetric(partMeta, feature) {
  const bbox = partMeta?.bbox;
  if (!bbox) return false;
  const axis = new THREE.Vector3(...feature.axis);
  const across = LOCAL_AXES.filter((a) => Math.abs(a.dot(axis)) < 0.01);
  if (across.length !== 2 || Math.abs(Math.abs(axis.x) + Math.abs(axis.y) + Math.abs(axis.z) - 1) > 0.01) return false;
  const origin = new THREE.Vector3(...feature.origin);
  const widths = across.map((a) => {
    const i = a.x ? 0 : a.y ? 1 : 2;
    const center = (bbox.min[i] + bbox.max[i]) / 2;
    return { offset: Math.abs(origin.getComponent(i) - center), width: bbox.max[i] - bbox.min[i] };
  });
  return widths.every((w) => w.offset < 0.1) && Math.abs(widths[0].width - widths[1].width) < 0.1;
}

/**
 * Every way the selected part can go into the picked hole face (design.md §2): each of its inserts
 * that fits the opening, by each end it can lead with, at each of 4 quarter-turn rolls and at every
 * roll that puts another of its pins on a parallel hole that fits it (searched within the part's
 * widest pin spread across the axis, and PATTERN_AXIAL_REACH_MM along it); poses that
 * come out the same are listed once, and a part that looks the same at any roll (spinSymmetric) gets
 * one roll. Each fit marks the selected part's other inserts parallel to
 * the anchor, at the face plane: green when a matching opening on another part lines up with it.
 * Sorted by green count (most first), then by the smallest turn from `currentQuaternion`.
 * `hovered`: { opening (world feature), face: { point, outward } }. Returns
 * [{ featureId, end, roll, quaternion, position, rotationDeg, markers, green, total, turnRad,
 *    travelMm, sweepMm }].
 */
export function listInsertFits({ partMeta, measured = null, instanceId, hovered, receivingQuaternion, otherFeatures, currentQuaternion }) {
  const { opening, face } = hovered;
  const n = face.outward.clone().normalize();
  const farFace = face.point.distanceTo(opening.start) < face.point.distanceTo(opening.end) ? opening.end : opening.start;
  const depth = face.point.distanceTo(farFace);
  const candidates = otherFeatures.filter((o) => o.instanceId !== instanceId);
  // Openings that could take another pin of the pattern: parallel to the picked one and within
  // PATTERN_AXIAL_REACH_MM of it along the axis (how far across is checked per pin below)
  const across = (v) => v.clone().addScaledVector(n, -v.dot(n));
  const patternOpenings = candidates
    .filter(
      (o) =>
        o !== opening &&
        !OPENINGS_BY_INSERT[o.kind] &&
        Math.abs(o.axis.dot(n)) >= PARALLEL_MIN_DOT &&
        Math.abs(o.origin.clone().sub(opening.origin).dot(n)) <= PATTERN_AXIAL_REACH_MM
    )
    .map((o) => ({ o, v: across(o.origin.clone().sub(opening.origin)) }));
  const fits = [];
  for (const f of getLocalFeatures(partMeta)) {
    if (!OPENINGS_BY_INSERT[f.kind]?.has(opening.kind)) continue;
    for (const lead of insertLeadEnds(partMeta, f, measured)) {
      const base = { partMeta, measured, featureId: f.featureId, end: lead.end, face: face.point, outward: n, receivingQuaternion };
      // Quarter turns relative to the receiving part, plus the exact turns that put another of the
      // part's pins on a nearby matching hole (patterns that are not square to the receiving
      // part's axes, e.g. the angled face of a 30° corner connector)
      const rollAngles = spinSymmetric(partMeta, f) ? [0] : [0, 1, 2, 3].map((q) => (q * Math.PI) / 2);
      const basePose = insertPose(base);
      if (basePose && rollAngles.length > 1) {
        const world = collectWorldFeatures(partMeta, basePose.matrix, instanceId, measured);
        const anchor = world.find((w) => w.featureId === f.featureId);
        // The part's other parallel pins and how far each is across the axis from the anchor; holes
        // further across than the widest of them can't take any pin, so they are skipped
        const others = world
          .filter((w) => w !== anchor && OPENINGS_BY_INSERT[w.kind] && Math.abs(w.axis.dot(n)) >= PARALLEL_MIN_DOT)
          .map((w) => ({ w, u: across(w.origin.clone().sub(anchor.origin)) }))
          .filter(({ u }) => u.length() >= 0.5);
        const span = Math.max(0, ...others.map(({ u }) => u.length())) + MAX_LINE_DISTANCE_MM;
        const reachable = patternOpenings.filter(({ v }) => v.length() <= span);
        for (const { w, u } of others) {
          for (const { o, v } of reachable) {
            if (!OPENINGS_BY_INSERT[w.kind].has(o.kind)) continue;
            if (Math.abs(v.length() - u.length()) > MAX_LINE_DISTANCE_MM) continue;
            const angle = Math.atan2(n.dot(u.clone().cross(v)), u.dot(v));
            rollAngles.push(((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
          }
        }
      }
      for (const [rollIndex, rollRad] of rollAngles.entries()) {
        const roll = rollIndex < 4 ? rollIndex : 4; // 0-3: quarter turns; 4: a turn found from the hole pattern
        const pose = insertPose({ ...base, rollRad });
        if (!pose) continue;
        const duplicate = fits.some(
          (g) => g.position.distanceTo(pose.position) < 0.01 && g.quaternion.angleTo(pose.quaternion) < THREE.MathUtils.degToRad(0.1)
        );
        if (duplicate) continue;

        const world = collectWorldFeatures(partMeta, pose.matrix, instanceId, measured);
        const anchor = world.find((w) => w.featureId === f.featureId);
        const markers = [];
        for (const w of world) {
          if (!OPENINGS_BY_INSERT[w.kind] || w === anchor) continue;
          if (Math.abs(w.axis.dot(n)) < PARALLEL_MIN_DOT) continue;
          const green = candidates.some((o) => pairRoles(w, o)?.insert === w && linesCoincide(w.origin, w.axis, o.origin, o.axis));
          // Where its axis meets the face plane
          const p = w.origin.clone();
          markers.push({ featureId: w.featureId, green, point: p.addScaledVector(n, -p.clone().sub(face.point).dot(n)) });
        }
        const travelMm = PICK_GAP_MM + depth;
        fits.push({
          featureId: f.featureId,
          end: lead.end,
          roll,
          quaternion: pose.quaternion,
          position: pose.position,
          rotationDeg: pose.rotationDeg,
          markers,
          green: 1 + markers.filter((m) => m.green).length,
          total: 1 + markers.length,
          turnRad: currentQuaternion ? pose.quaternion.angleTo(currentQuaternion) : 0,
          travelMm,
          sweepMm: travelMm + Math.max(0, f.tMax - f.tMin),
          direction: n.clone().negate()
        });
      }
    }
  }
  return fits.sort((a, b) => b.green - a.green || a.turnRad - b.turnRad || a.roll - b.roll);
}

/** True when an insert of `insertKind` ('pin' / 'shaft') fits an opening of `openingKind`. */
export const insertFitsOpening = (insertKind, openingKind) => Boolean(OPENINGS_BY_INSERT[insertKind]?.has(openingKind));
