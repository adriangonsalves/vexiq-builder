/**
 * Bent plastic sheets (openspec shaped-parts-and-sheet-bending): the `sheet-bend` shape kind.
 *
 * A sheet bends along lines parallel to one set of its hole rows. In the sheet's own frame, `across`
 * ('x' or 'z') is the axis the bend runs along and y is its thickness; the bend is a curve in the
 * (across, y) plane. Rows are counted from the `from` edge ('min' or 'max' of `across`), and `s` is
 * the distance along the flat sheet from that edge.
 *
 *   { kind: 'sheet-bend', across, from, held: [rows], anchors: [{ row, at: [a, b], dir: [da, db], stretch, on }] }
 *
 * The sheet is straight up to its last held row, then one least-bending cubic piece runs to each
 * anchor (leaving the previous row in line with the sheet, arriving along `dir`, exactly as long as
 * the sheet between the two rows plus `stretch`), then straight to the far edge. `at` is the row's
 * point on the sheet's middle surface and `dir` the sheet's direction there (towards larger `s`),
 * both in the sheet's own frame. Pure three-free maths, shared by the browser and Node.
 */

export const SHEET_BEND_KIND = 'sheet-bend';
export const ROW_PITCH_MM = 12.7;
export const MIN_BEND_RADIUS_MM = 3;
export const MAX_STRETCH_MM = 1;
export const STACK_GAP_MM = 0.1;
// A sheet pressed this far into another part flexes round it: a tight fit, not an overlap
export const SHEET_PRESS_MM = 1.5;
const STRIP_MM = 1; // the mesh is cut into strips this wide across the bend before bending
const PIECE_SAMPLES = 96;

export function isPlasticSheet(part) {
  return /Plastic (PET )?Sheet/.test(part?.name || '');
}

const axisIndex = (across) => (across === 'x' ? 0 : 2);
const otherIndex = (across) => (across === 'x' ? 2 : 0);

/** The sheet's frame for a bend direction: edge, sign, length, middle and thickness. */
export function sheetFrame(part, across, from) {
  const ai = axisIndex(across);
  const { min, max } = part.bbox;
  const sign = from === 'max' ? -1 : 1;
  return {
    ai,
    wi: otherIndex(across),
    sign,
    edge: from === 'max' ? max[ai] : min[ai],
    length: max[ai] - min[ai],
    mid: (min[1] + max[1]) / 2,
    thickness: max[1] - min[1]
  };
}

/**
 * The sheet's hole rows for a bend direction, from the `from` edge: [{ row (1-based), s, ports }].
 * `ports` are the catalog part's (flat) ports in that row.
 */
export function sheetRows(part, across, from) {
  const f = sheetFrame(part, across, from);
  const byCoord = new Map();
  for (const p of part.ports || []) {
    if (p.type !== 'pin_hole') continue;
    const key = Math.round(p.origin[f.ai] * 100) / 100;
    if (!byCoord.has(key)) byCoord.set(key, []);
    byCoord.get(key).push(p);
  }
  return [...byCoord.entries()]
    .map(([a, ports]) => ({ s: (a - f.edge) * f.sign, ports }))
    .sort((x, y) => x.s - y.s)
    .map((r, i) => ({ row: i + 1, ...r }));
}

// --- 2D helpers ---
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / (len(a) || 1));

// A cubic piece from p0 (direction t0) to p1 (direction t1) with handle lengths ha, hb
function hermiteAt(p0, t0, p1, t1, ha, hb, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return [
    h00 * p0[0] + h10 * ha * t0[0] + h01 * p1[0] + h11 * hb * t1[0],
    h00 * p0[1] + h10 * ha * t0[1] + h01 * p1[1] + h11 * hb * t1[1]
  ];
}
function hermiteD1(p0, t0, p1, t1, ha, hb, u) {
  const u2 = u * u;
  const d00 = 6 * u2 - 6 * u;
  const d10 = 3 * u2 - 4 * u + 1;
  const d01 = -6 * u2 + 6 * u;
  const d11 = 3 * u2 - 2 * u;
  return [
    d00 * p0[0] + d10 * ha * t0[0] + d01 * p1[0] + d11 * hb * t1[0],
    d00 * p0[1] + d10 * ha * t0[1] + d01 * p1[1] + d11 * hb * t1[1]
  ];
}
function hermiteD2(p0, t0, p1, t1, ha, hb, u) {
  const e00 = 12 * u - 6;
  const e10 = 6 * u - 4;
  const e01 = -12 * u + 6;
  const e11 = 6 * u - 2;
  return [
    e00 * p0[0] + e10 * ha * t0[0] + e01 * p1[0] + e11 * hb * t1[0],
    e00 * p0[1] + e10 * ha * t0[1] + e01 * p1[1] + e11 * hb * t1[1]
  ];
}

// Length, bending (sum of curvature squared over length) and tightest curvature of a piece
function measurePiece(p0, t0, p1, t1, ha, hb) {
  let length = 0;
  let bending = 0;
  let maxK = 0;
  const du = 1 / PIECE_SAMPLES;
  for (let i = 0; i < PIECE_SAMPLES; i++) {
    const u = (i + 0.5) * du;
    const d1 = hermiteD1(p0, t0, p1, t1, ha, hb, u);
    const d2 = hermiteD2(p0, t0, p1, t1, ha, hb, u);
    const speed = len(d1);
    if (speed < 1e-9) return { length, bending: Infinity, maxK: Infinity };
    const k = Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) / speed ** 3;
    length += speed * du;
    bending += k * k * speed * du;
    maxK = Math.max(maxK, k);
  }
  return { length, bending, maxK };
}

/**
 * The least-bending cubic piece from p0 (leaving along t0) to p1 (arriving along t1) that is `L` long:
 * { ha, hb, bending, maxK } or { error, shortMm } when the two points are farther apart than `L`.
 */
export function leastBendingPiece(p0, t0, p1, t1, L) {
  const chord = len(sub(p1, p0));
  if (chord > L + 1e-6) return { error: 'out of reach', shortMm: chord - L };
  const lengthAt = (ha, hb) => measurePiece(p0, t0, p1, t1, ha, hb).length;
  // For a handle `ha`, the `hb` that makes the piece `L` long (length grows with hb here)
  // Handles shorter than a quarter of the gap leave a sharp turn right at a row
  const minHandle = Math.max(chord, L * 0.5) * 0.25;
  const solveHb = (ha) => {
    let lo = minHandle;
    let hi = Math.max(L, chord) * 4;
    const fLo = lengthAt(ha, lo) - L;
    const fHi = lengthAt(ha, hi) - L;
    if (fLo * fHi > 0) return null;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if ((lengthAt(ha, m) - L) * fLo <= 0) hi = m;
      else lo = m;
    }
    return (lo + hi) / 2;
  };
  let best = null;
  const tryHa = (ha) => {
    const hb = solveHb(ha);
    if (hb === null) return;
    const m = measurePiece(p0, t0, p1, t1, ha, hb);
    if (Math.abs(m.length - L) > 0.05) return;
    if (!best || m.bending < best.bending) best = { ha, hb, bending: m.bending, maxK: m.maxK };
  };
  const scale = Math.max(L, 1);
  for (let k = 1; k <= 40; k++) if ((k / 10) * scale >= minHandle) tryHa((k / 10) * scale);
  if (best) {
    // Refine round the best handle
    const step = scale / 10;
    for (let k = -10; k <= 10; k++) tryHa(Math.max(minHandle, best.ha + (k / 10) * step));
  }
  return best || { error: 'no curve of that length', shortMm: 0 };
}

// --- One smooth bend: straight, one arc, straight ---------------------------------------------------
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
const COUNTER_BEND_K = 0.002; // curvature (1/mm) either way that counts as a real bend

// True when the cubic piece bends one way and then the other (an S): a sheet with spare length
// would bow one way instead
function hasCounterBend(p0, t0, p1, t1, ha, hb) {
  let left = false;
  let right = false;
  const du = 1 / PIECE_SAMPLES;
  for (let i = 0; i <= PIECE_SAMPLES; i++) {
    const u = i * du;
    const d1 = hermiteD1(p0, t0, p1, t1, ha, hb, u);
    const d2 = hermiteD2(p0, t0, p1, t1, ha, hb, u);
    const speed = len(d1);
    if (speed < 1e-9) continue;
    const k = cross2(d1, d2) / speed ** 3;
    if (k > COUNTER_BEND_K) left = true;
    if (k < -COUNTER_BEND_K) right = true;
  }
  return left && right;
}

/**
 * Straight, then one circular arc turning the sheet from t0 to t1, then straight, exactly `L` long
 * from p0 to p1: the arc's radius follows from the length (never tighter than MIN_BEND_RADIUS_MM, and
 * both straights at least 0). One bend, never an S. Null when there is no such piece.
 */
function arcPiece(p0, t0, p1, t1, L) {
  const c = Math.max(-1, Math.min(1, dot(t0, t1)));
  const phi = Math.acos(c);
  const det = cross2(t0, t1);
  if (phi < 1e-3 || phi > Math.PI - 1e-3) return null;
  const sigma = Math.sign(det);
  const n0 = [-t0[1], t0[0]];
  const A1 = add(mul(t0, Math.sin(phi)), mul(n0, sigma * (1 - Math.cos(phi))));
  const D0 = sub(p1, p0);
  const a0 = cross2(D0, t1) / det;
  const b0 = cross2(t0, D0) / det;
  const aA = cross2(A1, t1) / det;
  const bA = cross2(t0, A1) / det;
  const slope = phi - aA - bA;
  if (Math.abs(slope) < 1e-9) return null;
  const r = (L - (a0 + b0)) / slope;
  const a = a0 - r * aA;
  const b = b0 - r * bA;
  if (!(r >= MIN_BEND_RADIUS_MM) || a < -1e-6 || b < -1e-6) return null;
  const arcStart = add(p0, mul(t0, a));
  const arcEnd = add(arcStart, mul(A1, r));
  const sample = (n) => {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const d = (i / n) * L;
      if (d <= a) pts.push(add(p0, mul(t0, d)));
      else if (d <= a + r * phi) {
        const psi = (d - a) / r;
        pts.push(add(arcStart, mul(add(mul(t0, Math.sin(psi)), mul(n0, sigma * (1 - Math.cos(psi)))), r)));
      } else pts.push(add(arcEnd, mul(t1, d - a - r * phi)));
    }
    return pts;
  };
  return { kind: 'arc', a, b, r, bending: phi / r, maxK: 1 / r, sample };
}

/**
 * The piece the sheet follows from p0 (leaving along t0) to p1 (arriving along t1), `L` long: the
 * least-bending cubic, unless that bends one way and then back (spare length makes an S), in which
 * case one smooth arc between straights when there is one. { kind, bending, maxK, sample(n) }, or
 * { error, shortMm } as leastBendingPiece. The same call decides every bend, so a saved bend
 * always comes back as it was worked out.
 */
export function solvePiece(p0, t0, p1, t1, L) {
  const cubic = leastBendingPiece(p0, t0, p1, t1, L);
  const cubicOk = !cubic.error && cubic.maxK <= 1 / MIN_BEND_RADIUS_MM;
  if (cubicOk && !hasCounterBend(p0, t0, p1, t1, cubic.ha, cubic.hb)) return withSample(cubic, p0, t0, p1, t1);
  const arc = arcPiece(p0, t0, p1, t1, L);
  if (arc) return arc;
  return cubic.error ? cubic : withSample(cubic, p0, t0, p1, t1);
}
function withSample(cubic, p0, t0, p1, t1) {
  return { ...cubic, kind: 'cubic', sample: (n) => Array.from({ length: n + 1 }, (_, i) => hermiteAt(p0, t0, p1, t1, cubic.ha, cubic.hb, i / n)) };
}

// --- A longer search: any smooth path, loops included -----------------------------------------------
const SERIES_SEGMENTS = 12;
const SERIES_SEEDS = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
  [1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1], [-1, -1, -1, -1, -1, -1, 1, 1, 1, 1, 1, 1]
];
const SELF_CLEAR_MM = 1.7; // two layers of the sheet (1.5 mm thick) must not touch

function seriesEnd(p0, th0, kap, ell) {
  let x = p0[0];
  let y = p0[1];
  let th = th0;
  for (const k of kap) {
    if (Math.abs(k) < 1e-9) {
      x += ell * Math.cos(th);
      y += ell * Math.sin(th);
    } else {
      x += (Math.sin(th + k * ell) - Math.sin(th)) / k;
      y += (Math.cos(th) - Math.cos(th + k * ell)) / k;
      th += k * ell;
    }
  }
  return [x, y, th];
}

// Solves the square system m x = v by Gaussian elimination (null when singular)
function solveN(m, v) {
  const n = v.length;
  const a = m.map((row, i) => [...row, v[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    if (Math.abs(a[piv][c]) < 1e-12) return null;
    [a[c], a[piv]] = [a[piv], a[c]];
    for (let r = c + 1; r < n; r++) {
      const f = a[r][c] / a[c][c];
      for (let k = c; k <= n; k++) a[r][k] -= f * a[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = a[r][n];
    for (let k = r + 1; k < n; k++) sum -= a[r][k] * x[k];
    x[r] = sum / a[r][r];
  }
  return x;
}

/**
 * Every different smooth path found from p0 (leaving along t0) to p1 (arriving along t1) that is
 * exactly `L` long, made of 12 pieces of constant curvature (never tighter than MIN_BEND_RADIUS_MM),
 * with S-bends and loops allowed, gentlest first. It is a search: the plain least-bending path, then
 * paths forced through a grid of waypoints (each refined by Newton steps), so it is only asked for
 * when the plain bends don't work. Each is { kind: 'series', bending, maxK, sample(n) }.
 * Deterministic: the same call gives the same list.
 */
export function seriesPieces(p0, t0, p1, t1, L, { limit = 24, waypoints = true } = {}) {
  const K = SERIES_SEGMENTS;
  const ell = L / K;
  const kmax = 1 / MIN_BEND_RADIUS_MM;
  const th0 = Math.atan2(t0[1], t0[0]);
  const thT = Math.atan2(t1[1], t1[0]);
  const wrapped = Math.atan2(Math.sin(thT - th0), Math.cos(thT - th0));
  const endOf = (kap, upTo = K) => seriesEnd(p0, th0, kap.slice(0, upTo), ell);

  // Newton steps that keep the ends (and a waypoint, when given) where they must be while easing to the
  // least bending along the directions left free
  const solve = (kap0, target, way) => {
    let kap = kap0.slice();
    const rows = way ? 5 : 3;
    for (let it = 0; it < 120; it++) {
      const e = endOf(kap);
      const r = [e[0] - p1[0], e[1] - p1[1], (e[2] - target) * 10];
      let w = null;
      if (way) {
        w = endOf(kap, way.seg);
        r.push(w[0] - way.at[0], w[1] - way.at[1]);
      }
      const J = Array.from({ length: rows }, () => new Array(K).fill(0));
      for (let j = 0; j < K; j++) {
        const kp = kap.slice();
        kp[j] += 1e-5;
        const ep = endOf(kp);
        J[0][j] = (ep[0] - e[0]) / 1e-5;
        J[1][j] = (ep[1] - e[1]) / 1e-5;
        J[2][j] = ((ep[2] - e[2]) * 10) / 1e-5;
        if (way) {
          const wp = endOf(kp, way.seg);
          J[3][j] = (wp[0] - w[0]) / 1e-5;
          J[4][j] = (wp[1] - w[1]) / 1e-5;
        }
      }
      const JJt = J.map((ra) => J.map((rb) => ra.reduce((sum, x, j) => sum + x * rb[j], 0)));
      const lam = solveN(JJt, r);
      if (!lam) return null;
      const Jk = J.map((ra) => ra.reduce((sum, x, j) => sum + x * kap[j], 0));
      const mu = solveN(JJt, Jk);
      const stepO = kap.map((k, j) => (mu ? -0.3 * (k - J.reduce((sum, ra, a) => sum + ra[j] * mu[a], 0)) : 0));
      const stepC = kap.map((_, j) => -J.reduce((sum, ra, a) => sum + ra[j] * lam[a], 0));
      kap = kap.map((k, j) => Math.max(-kmax, Math.min(kmax, k + stepC[j] + stepO[j])));
      const close = Math.hypot(r[0], r[1]) < 0.004 && Math.abs(r[2]) < 4e-3 && (!way || Math.hypot(r[3], r[4]) < 0.004);
      if (close && it > 12 && Math.hypot(...stepO) < 2e-4) break;
    }
    const e = endOf(kap);
    if (Math.hypot(e[0] - p1[0], e[1] - p1[1]) > 0.02 || Math.abs(e[2] - target) > 2e-3) return null;
    if (way) {
      const w = endOf(kap, way.seg);
      if (Math.hypot(w[0] - way.at[0], w[1] - way.at[1]) > 0.02) return null;
    }
    return kap.some((k) => Math.abs(k) > kmax + 1e-6) ? null : kap;
  };

  const starts = [];
  for (const m of [0, 1, -1]) {
    const target = th0 + wrapped + 2 * Math.PI * m;
    for (const pat of SERIES_SEEDS.slice(0, 4)) starts.push({ kap0: pat.map((x) => x * 0.1), target, way: null });
    if (waypoints && m === 0) {
      // Forced through a point about halfway along: a grid round the two ends
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      const half = 0.6 * L;
      for (const seg of [5, 6, 7]) {
        const reach = seg * ell;
        for (let gx = -4; gx <= 4; gx++) {
          for (let gy = -4; gy <= 4; gy++) {
            const at = [mid[0] + (gx / 4) * half, mid[1] + (gy / 4) * half];
            if (Math.hypot(at[0] - p0[0], at[1] - p0[1]) > reach - 0.5 || Math.hypot(at[0] - p1[0], at[1] - p1[1]) > L - reach - 0.5) continue;
            starts.push({ kap0: new Array(K).fill(0), target, way: { seg, at } });
          }
        }
      }
    }
  }
  const found = [];
  const looks = (kap) => {
    const pts = [];
    for (let i = 1; i <= 8; i++) {
      const e = endOf(kap, 0);
      void e;
      pts.push(pointAt(kap, (i / 8) * L));
    }
    return pts;
  };
  const pointAt = (kap, d) => {
    const seg = Math.min(K - 1, Math.floor(d / ell));
    const e = seriesEnd(p0, th0, kap.slice(0, seg), ell);
    const part = seriesEnd([e[0], e[1]], e[2], [kap[seg]], d - seg * ell);
    return [part[0], part[1]];
  };
  for (const st of starts) {
    const kap = solve(st.kap0, st.target, st.way);
    if (!kap) continue;
    const sig = looks(kap);
    if (found.some((f) => f.sig.every((q, i) => Math.hypot(q[0] - sig[i][0], q[1] - sig[i][1]) < 1.5))) continue;
    found.push({ kap, sig, bending: ell * kap.reduce((sum, k) => sum + k * k, 0), maxK: Math.max(...kap.map(Math.abs)) });
  }
  found.sort((a, b) => a.bending - b.bending);
  const pieces = [];
  for (const f of found) {
    const sample = (n) => Array.from({ length: n + 1 }, (_, i) => pointAt(f.kap, (i / n) * L));
    const pts = sample(240);
    // Two layers of the sheet may not touch where the path crosses or runs back past itself
    let touches = false;
    const gap = Math.ceil(8 / (L / 240));
    for (let i = 0; i < pts.length && !touches; i++) {
      for (let j = i + gap; j < pts.length; j++) {
        if (Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]) < SELF_CLEAR_MM) {
          touches = true;
          break;
        }
      }
    }
    if (!touches) pieces.push({ kind: 'series', bending: f.bending, maxK: f.maxK, sample });
    if (pieces.length >= limit) break;
  }
  return pieces;
}

/**
 * The piece from p0 to p1 with the least stretch beyond `L` that is smooth enough (no tighter than
 * MIN_BEND_RADIUS_MM): { piece, stretch } with stretch 0 when `L` works, or { error, shortMm } when
 * even `maxStretch` more isn't enough (shortMm: how much longer the sheet would need to be, up to 10 mm).
 */
export function reachPiece(p0, t0, p1, t1, L, maxStretch = MAX_STRETCH_MM) {
  const ok = (extra) => {
    const piece = solvePiece(p0, t0, p1, t1, L + extra);
    return !piece.error && piece.maxK <= 1 / MIN_BEND_RADIUS_MM ? piece : null;
  };
  const first = ok(0);
  if (first) return { piece: first, stretch: 0 };
  // The shortest extra length that works, to 0.01 mm
  let hi = 0.25;
  while (hi <= 10 && !ok(hi)) hi *= 2;
  if (hi > 10) return { error: 'too tight', shortMm: Infinity };
  let lo = hi === 0.25 ? 0 : hi / 2;
  for (let k = 0; k < 20 && hi - lo > 0.005; k++) {
    const m = (lo + hi) / 2;
    if (ok(m)) hi = m;
    else lo = m;
  }
  const stretch = Math.ceil(hi * 100) / 100;
  if (stretch > maxStretch) return { error: 'out of reach', shortMm: stretch };
  return { piece: ok(stretch), stretch };
}

// --- The curve of a bend ---

const curveCache = new Map(); // part id + shape json -> curve
const CURVE_CACHE_MAX = 200;

/**
 * The bend's curve: `at(s)` gives the middle surface's point `p` and direction `t` in the
 * (across, y) plane for a distance `s` along the flat sheet, and `turn(s)` the angle the sheet has
 * turned through there. Throws when the shape can't be made.
 */
export function bendCurve(part, shape) {
  const key = `${part.basePartId || part.id}|${JSON.stringify(shape)}`;
  if (curveCache.has(key)) return curveCache.get(key);
  const f = sheetFrame(part, shape.across, shape.from);
  const rows = sheetRows({ ...part, ports: part.flatPorts || part.ports }, shape.across, shape.from);
  const rowS = (r) => {
    const found = rows.find((x) => x.row === r);
    if (!found) throw new Error(`The sheet has no row ${r}`);
    return found.s;
  };
  const heldS = Math.max(0, ...(shape.held || []).map(rowS));
  const segments = [];
  // Straight through the held rows
  const p0 = [f.edge, f.mid];
  const t0 = [f.sign, 0];
  let prev = { s: heldS, p: add(p0, mul(t0, heldS)), t: t0, row: Math.max(0, ...(shape.held || [])) };
  segments.push({ s0: 0, s1: heldS, line: { p: p0, t: t0 } });
  for (const anchor of shape.anchors || []) {
    const s1 = rowS(anchor.row);
    if (s1 <= prev.s + 1e-6) throw new Error(`Row ${anchor.row} isn't past row ${prev.row}`);
    const L = s1 - prev.s + (anchor.stretch || 0);
    const t1 = unit(anchor.dir);
    const piece = anchor.variant ? seriesPieces(prev.p, prev.t, anchor.at, t1, L)[anchor.variant - 1] || { error: 'no such curve' } : solvePiece(prev.p, prev.t, anchor.at, t1, L);
    if (piece.error) throw new Error(`Row ${anchor.row}: ${piece.error}${piece.shortMm ? ` by ${piece.shortMm.toFixed(1)} mm` : ''}`);
    if (piece.maxK > 1 / MIN_BEND_RADIUS_MM) throw new Error(`Row ${anchor.row}: the sheet would have to bend too tightly`);
    // Sample the piece by arc length so a flat distance maps evenly onto it
    const n = 400;
    const pts = piece.sample(n);
    const arc = [0];
    for (let i = 1; i <= n; i++) arc.push(arc[i - 1] + len(sub(pts[i], pts[i - 1])));
    segments.push({ s0: prev.s, s1, piece: { pts, arc, total: arc[n] }, maxK: piece.maxK });
    prev = { s: s1, p: [...anchor.at], t: t1, row: anchor.row };
  }
  segments.push({ s0: prev.s, s1: f.length, line: { p: prev.p, t: prev.t, from: prev.s } });

  const at = (sRaw) => {
    const s = Math.min(Math.max(sRaw, 0), f.length);
    const seg = segments.find((g) => s <= g.s1 + 1e-9) || segments.at(-1);
    if (seg.line) {
      const d = s - (seg.line.from ?? 0);
      return { p: add(seg.line.p, mul(seg.line.t, d)), t: seg.line.t };
    }
    const { pts, arc, total } = seg.piece;
    const want = ((s - seg.s0) / (seg.s1 - seg.s0)) * total;
    let lo = 0;
    let hi = arc.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (arc[m] <= want) lo = m;
      else hi = m;
    }
    const span = arc[hi] - arc[lo] || 1;
    const k = (want - arc[lo]) / span;
    const p = add(pts[lo], mul(sub(pts[hi], pts[lo]), k));
    return { p, t: unit(sub(pts[hi], pts[lo])) };
  };
  const curve = { frame: f, segments, at, length: segments.reduce((sum, g) => sum + (g.piece ? g.piece.total : g.s1 - g.s0), 0) };
  if (curveCache.size >= CURVE_CACHE_MAX) curveCache.delete(curveCache.keys().next().value);
  curveCache.set(key, curve);
  return curve;
}

// The turn (cos, sin) from the flat direction to the curve's direction at s
function turnAt(curve, t) {
  const flat = [curve.frame.sign, 0];
  return [dot(flat, t), flat[0] * t[1] - flat[1] * t[0]];
}
const rotate = ([c, s], v) => [c * v[0] - s * v[1], s * v[0] + c * v[1]];

/** A point of the flat sheet (its own frame, [x, y, z]) moved onto the bend. */
export function bendPoint(curve, point) {
  const f = curve.frame;
  const s = (point[f.ai] - f.edge) * f.sign;
  const { p, t } = curve.at(s);
  const r = turnAt(curve, t);
  const off = rotate(r, [0, point[1] - f.mid]);
  const out = [...point];
  out[f.ai] = p[0] + off[0];
  out[1] = p[1] + off[1];
  return out;
}

/** A direction of the flat sheet at `point` turned with the bend there. */
export function bendDirection(curve, point, dir) {
  const f = curve.frame;
  const s = (point[f.ai] - f.edge) * f.sign;
  const r = turnAt(curve, curve.at(s).t);
  const v = rotate(r, [dir[f.ai], dir[1]]);
  const out = [...dir];
  out[f.ai] = v[0];
  out[1] = v[1];
  return out;
}

/**
 * Cuts triangles (flat arrays, indexed) into strips across `ai` every STRIP_MM, plus at `extraCuts`.
 * Returns unindexed positions and normals.
 */
export function cutIntoStrips(pos, norm, idx, ai, extraCuts = []) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = ai; i < pos.length; i += 3) {
    lo = Math.min(lo, pos[i]);
    hi = Math.max(hi, pos[i]);
  }
  const cuts = [];
  for (let c = Math.ceil(lo / STRIP_MM) * STRIP_MM; c < hi; c += STRIP_MM) if (c > lo) cuts.push(c);
  for (const c of extraCuts) if (c > lo && c < hi) cuts.push(c);
  cuts.sort((a, b) => a - b);
  const outP = [];
  const outN = [];
  const vert = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const nrm = (i) => [norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]];
  const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  const emit = (tri) => {
    for (const v of tri) {
      outP.push(v.p[0], v.p[1], v.p[2]);
      outN.push(v.n[0], v.n[1], v.n[2]);
    }
  };
  // Splits a polygon (convex, vertex list) by the plane x[ai] = c into the part below and above
  const split = (poly, c) => {
    const below = [];
    const above = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const da = a.p[ai] - c;
      const db = b.p[ai] - c;
      if (da <= 0) below.push(a);
      if (da >= 0) above.push(a);
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const k = da / (da - db);
        const v = { p: lerp3(a.p, b.p, k), n: lerp3(a.n, b.n, k) };
        v.p[ai] = c;
        below.push(v);
        above.push(v);
      }
    }
    return [below, above];
  };
  const fan = (poly) => {
    for (let i = 1; i + 1 < poly.length; i++) emit([poly[0], poly[i], poly[i + 1]]);
  };
  for (let t = 0; t < idx.length; t += 3) {
    let poly = [0, 1, 2].map((k) => ({ p: vert(idx[t + k]), n: nrm(idx[t + k]) }));
    const min = Math.min(...poly.map((v) => v.p[ai]));
    const max = Math.max(...poly.map((v) => v.p[ai]));
    for (const c of cuts) {
      if (c <= min) continue;
      if (c >= max) break;
      const [below, above] = split(poly, c);
      if (below.length >= 3) fan(below);
      poly = above;
      if (poly.length < 3) break;
    }
    if (poly.length >= 3) fan(poly);
  }
  return { pos: new Float32Array(outP), norm: new Float32Array(outN) };
}

/** The bent mesh: positions and normals (unindexed) with a plain index. */
export function bendMesh(pos, norm, idx, shape, part) {
  const curve = bendCurve(part, shape);
  const f = curve.frame;
  const rows = sheetRows({ ...part, ports: part.flatPorts || part.ports }, shape.across, shape.from);
  const extra = rows.map((r) => f.edge + r.s * f.sign);
  const cut = cutIntoStrips(pos, norm, idx, f.ai, extra);
  let outP = cut.pos;
  let outN = cut.norm;
  // `trimAfterRow` (only for clearance checks, never saved): the sheet up to that row only
  if (shape.trimAfterRow) {
    const end = rows.find((r) => r.row === shape.trimAfterRow)?.s ?? f.length;
    const keepP = [];
    const keepN = [];
    for (let i = 0; i < outP.length; i += 9) {
      const far = [0, 3, 6].every((k) => (outP[i + k + f.ai] - f.edge) * f.sign > end + 0.01);
      if (far) continue;
      for (let k = 0; k < 9; k++) {
        keepP.push(outP[i + k]);
        keepN.push(outN[i + k]);
      }
    }
    outP = new Float32Array(keepP);
    outN = new Float32Array(keepN);
  }
  for (let i = 0; i < outP.length; i += 3) {
    const p = [outP[i], outP[i + 1], outP[i + 2]];
    const n = bendDirection(curve, p, [outN[i], outN[i + 1], outN[i + 2]]);
    const q = bendPoint(curve, p);
    outP[i] = q[0];
    outP[i + 1] = q[1];
    outP[i + 2] = q[2];
    outN[i] = n[0];
    outN[i + 1] = n[1];
    outN[i + 2] = n[2];
  }
  const index = new Uint32Array(outP.length / 3);
  for (let i = 0; i < index.length; i++) index[i] = i;
  return { pos: outP, norm: outN, idx: index };
}

const round = (n, d = 3) => Number(n.toFixed(d)) + 0;

/** The sheet's ports moved onto the bend (same ids; origin and axis follow the sheet). */
export function bendPorts(ports, shape, part) {
  const curve = bendCurve(part, shape);
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return (ports || []).map((p) => {
    const origin = bendPoint(curve, p.origin).map((v) => round(v));
    const axis = bendDirection(curve, p.origin, p.axis).map((v) => round(v, 5));
    // The usable span along the axis (t = dot(point, axis)) moves with the hole
    const shift = dot3(origin, axis) - dot3(p.origin, p.axis);
    return { ...p, origin, axis, ...(p.spanMm ? { spanMm: p.spanMm.map((t) => round(t + shift)) } : {}) };
  });
}

/** The bent sheet's box: the curve's samples, offset by half the thickness, across the full width. */
export function bendBox(part, shape) {
  const curve = bendCurve(part, shape);
  const f = curve.frame;
  const min = [...part.bbox.min];
  const max = [...part.bbox.max];
  min[f.ai] = Infinity;
  max[f.ai] = -Infinity;
  min[1] = Infinity;
  max[1] = -Infinity;
  for (let s = 0; s <= f.length + 1e-9; s += 0.1) {
    for (const h of [part.bbox.min[1], part.bbox.max[1]]) {
      const pt = [0, h, 0];
      pt[f.ai] = f.edge + s * f.sign;
      const q = bendPoint(curve, pt);
      min[f.ai] = Math.min(min[f.ai], q[f.ai]);
      max[f.ai] = Math.max(max[f.ai], q[f.ai]);
      min[1] = Math.min(min[1], q[1]);
      max[1] = Math.max(max[1], q[1]);
    }
  }
  const size = max.map((v, i) => round(v - min[i]));
  const center = max.map((v, i) => round((v + min[i]) / 2));
  return { min: min.map((v) => round(v)), max: max.map((v) => round(v)), size, center };
}

/** Checks a bend's settings against the sheet; returns an error message or null. */
export function checkBend(shape, part) {
  if (!isPlasticSheet(part)) return 'Only plastic sheets can be bent.';
  if (!['x', 'z'].includes(shape.across)) return 'A bend runs across x or z.';
  if (!['min', 'max'].includes(shape.from)) return "A bend starts from the 'min' or 'max' edge.";
  if (!Array.isArray(shape.held) || !Array.isArray(shape.anchors)) return 'A bend needs held rows and anchors.';
  for (const a of shape.anchors) {
    if (!Number.isInteger(a.row) || !Array.isArray(a.at) || !Array.isArray(a.dir)) return 'Each anchor needs a row, a point and a direction.';
    if (![...a.at, ...a.dir].every(Number.isFinite)) return 'Anchor numbers must be finite.';
    if (a.stretch && (a.stretch < 0 || a.stretch > MAX_STRETCH_MM + 1e-6)) return `A row may stretch at most ${MAX_STRETCH_MM} mm.`;
  }
  try {
    bendCurve(part, shape);
  } catch (err) {
    return err.message;
  }
  return null;
}

/**
 * The bend flipped by a mirror across the sheet's own plane perpendicular to local axis `axis`
 * (0, 1 or 2): across `y` the curve flips over; along the bend it starts from the other edge.
 */
export function mirrorBend(shape, axis, part) {
  const ai = axisIndex(shape.across);
  if (axis === 1) {
    const mid = (part.bbox.min[1] + part.bbox.max[1]) / 2;
    return { ...shape, anchors: shape.anchors.map((a) => ({ ...a, at: [a.at[0], 2 * mid - a.at[1]], dir: [a.dir[0], -a.dir[1]] })) };
  }
  if (axis === ai) {
    const sum = part.bbox.min[ai] + part.bbox.max[ai];
    return { ...shape, from: shape.from === 'min' ? 'max' : 'min', anchors: shape.anchors.map((a) => ({ ...a, at: [sum - a.at[0], a.at[1]], dir: [-a.dir[0], a.dir[1]] })) };
  }
  return shape;
}

/** A short description of a bend for the inspector and the MCP server. */
export function describeBend(shape) {
  const held = shape.held?.length ? `held flat to row ${Math.max(...shape.held)}` : 'flat to its first row';
  const anchors = (shape.anchors || []).map((a) => `row ${a.row}${a.on ? ` on ${a.on}` : ''}${a.stretch ? ` (stretched ${a.stretch.toFixed(1)} mm)` : ''}`);
  return `Bent across ${shape.across}: ${held}${anchors.length ? `; ${anchors.join('; ')}` : ''}.`;
}

export const sheetBendKind = {
  verb: 'Bend',
  accepts: isPlasticSheet,
  check: checkBend,
  shapeMesh: bendMesh,
  shapePorts: bendPorts,
  shapeBox: bendBox,
  mirror: mirrorBend,
  describe: describeBend
};
