/**
 * Play mode's moving model (openspec play-mode), from the engine's `playInputs`: which parts move
 * together as one body, where bodies turn on each other, and which bodies drive each other through
 * gears, racks and chains. Pure and plain data in and out, so the checks run it without the app.
 *
 * - A square shaft and everything whose square fits it is one body; a square more than
 *   SQUARE_FIT_DEG off the shaft's flats doesn't fit and is reported.
 * - Two bodies joined on two or more separate lines (pins, pegs, shafts) are one body; on one line,
 *   the joint is a hinge on that line. A Smart Motor's socket is a hinge it drives.
 * - Chain and track links stay where they are and belong to no body.
 *
 * Returns { bodies: [{ id, parts, shaft, label }], ground, fixed: [bodyId], loose: [bodyId],
 * sliders: [bodyId], hinges: [{ id, a, b, axis, point, kind,
 * motor }], slideJoints: [{ id, a (the brackets' body), b (the beam's), direction, point, limits: [lo, hi] mm
 * along direction }] (openspec linear-motion-and-idler-pins), links: [{ kind, a, b, ratio, sign, axisA, axisB?, direction?, mmPerRad? }],
 * motors: [{ id, label, hinge }], still: [partId], pins: [partId], solidPins: [partId] (the pins that
 * are solid posts, standoffs, and so collide), tracks: [{ links (in order round
 * the loop, or null), linkIds, grippers: [[gripperId, linkId]], frame: bodyId, drive: { body, axis, teeth } | null }], bands: [{ id, label,
 * elements, bodies (per spot), pulls, freeMm, ... }] (openspec rubber-bands), ratchets: [{ id, ratchet, pawl,
 * ratchetBody, holderBody, pawlBody, locked, pressed, axis, point, freeSign, teeth, tipRadiusMm, profileMm,
 * phaseDeg, leverMm, pivot }], maybeMeshes: [{ id, gears, a, b, holders, teeth, radii, axes, centers, toothDirs,
 * faceSpans, meshedOnEntry }] (openspec ratchet-and-pawl), warnings: [{ partId, text }] }.
 */
import { gapStrengths, jointSpec, seatGrip, snapGrip } from './fastenerStrength.js';

export const SQUARE_FIT_DEG = 45;
const LINE_MM = 0.5; // two joins this close to one line count as the same line
const PARALLEL = 0.999;
const MAYBE_MESH_MM = 80; // gears this near mesh distance on parts that move apart may swing into mesh

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);

/** Two joins lie on one line: parallel axes, and each point on the other's line. */
export function sameLine(p, q) {
  if (Math.abs(dot(p.axis, q.axis)) < PARALLEL) return false;
  return len(cross(sub(q.point, p.point), p.axis)) < LINE_MM;
}

function unionFind(ids) {
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(id) !== root) {
      const next = parent.get(id);
      parent.set(id, root);
      id = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent.set(rb, ra);
    return true;
  };
  return { find, union };
}

export function buildBodyGraph(inputs) {
  const { parts, seated, groups, meshes, chains, tracks = [], sprocketAxes = {}, bays = [], bands = [], ropes = [], ratchets = [], spurGears = [], clips = [], slides = [] } = inputs;
  const byId = new Map(parts.map((p) => [p.id, p]));
  const labelOf = (id) => byId.get(id)?.label || id;
  const warnings = [];
  const still = parts.filter((p) => p.chain).map((p) => p.id);
  const stillSet = new Set(still);
  const pinLike = new Set(parts.filter((p) => p.fastener && !p.chain && !groups.some((g) => g.shaftIds.includes(p.id))).map((p) => p.id));
  const nodes = parts.filter((p) => !p.chain && !pinLike.has(p.id)).map((p) => p.id);
  const uf = unionFind(parts.map((p) => p.id));

  // Shaft groups: the shaft and what its square fits; a square that's off is a round hole for play
  const misfit = new Set(); // "shaftGroupIndex|partId" left out
  const shaftOf = new Map(); // partId -> group index
  const motorSockets = []; // { motor, group }
  const shaftPairs = []; // [[shaftId, memberId]]
  groups.forEach((g, gi) => {
    for (const m of g.members) {
      if (m.offDeg > SQUARE_FIT_DEG) {
        misfit.add(`${gi}|${m.id}`);
        warnings.push({ partId: m.id, text: `${labelOf(m.id)} doesn't fit the square shaft (${m.offDeg}° off its flats), so the shaft doesn't turn it.` });
        continue;
      }
      if (m.hub) {
        motorSockets.push({ motor: m.id, group: gi });
        continue;
      }
      uf.union(g.shaftIds[0], m.id);
      if (g.shaftIds[0] !== m.id) shaftPairs.push([g.shaftIds[0], m.id]);
      shaftOf.set(m.id, gi);
    }
  });

  // Joins on a line between two parts: pins and standoffs join every part they sit in. `joints` are the
  // same joins part by part with what holds them (openspec drop-load-network), for the drop test
  const joins = []; // { a, b, axis, point }
  const pinParts = new Map(); // pin -> [{ part, axis, point, depthMm }]
  const joints = []; // { id, kind, a, b, axis, point, pinIds, ...jointSpec }
  const addJoint = (kind, a, b, axis, point, extra = {}) => {
    if (!a || !b || a === b) return;
    const { pullN, depthMm, travelMm, ...rest } = extra;
    joints.push({ id: `j${joints.length}`, kind, a, b, axis, point, pinIds: [], ...jointSpec(kind, { pullN, depthMm, travelMm }), ...(depthMm !== undefined ? { depthMm } : {}), ...rest });
  };
  for (const s of seated) {
    if (stillSet.has(s.insert) || stillSet.has(s.opening)) continue;
    if (pinLike.has(s.insert) || pinLike.has(s.opening)) {
      const pin = pinLike.has(s.insert) ? s.insert : s.opening;
      const other = pin === s.insert ? s.opening : s.insert;
      if (!pinParts.has(pin)) pinParts.set(pin, []);
      pinParts.get(pin).push({ part: other, axis: s.axis, point: s.point, depthMm: s.overlapMm ?? 5 });
      continue;
    }
    // A square shaft in an opening that fits it is already one body; one that doesn't fit turns
    const gi = groups.findIndex((g) => g.shaftIds.includes(s.insert));
    const fitted = gi >= 0 && shaftOf.get(s.opening) === gi;
    const hubbed = gi >= 0 && motorSockets.some((m) => m.motor === s.opening && m.group === gi);
    const shaftLike = gi >= 0 || s.insertKind === 'shaft';
    if (s.openingKind === 'collar_hole') {
      // A collar comes off only by sliding the shaft inside it, and any shaft past it, off the shaft's nearer end
      const ends = byId.get(s.insert)?.shaftEnds;
      const t = dot(s.point, s.axis);
      const rest = ends ? Math.min(...ends.map((e) => Math.abs(dot(e, s.axis) - t))) : 0;
      addJoint('collar', s.insert, s.opening, s.axis, s.point, { travelMm: Math.max(1, s.overlapMm ?? 5, rest) });
    }
    else if (hubbed) addJoint('socket', s.insert, s.opening, s.axis, s.point);
    else if (fitted) addJoint('square', s.insert, s.opening, s.axis, s.point);
    else if (shaftLike) addJoint('bearing', s.insert, s.opening, s.axis, s.point);
    else {
      // An integral peg (a corner connector's) in a hole: its grip there plus its snap ridge
      const weak = Boolean(byId.get(s.insert)?.weak);
      const depthMm = s.overlapMm ?? 5;
      // Its axis points the way the peg sticks out of its part, so the hole's part moving that way is a pull
      const pull = seatGrip({ depthMm, peg: true, weak }) + snapGrip({ peg: true, weak });
      if (s.out) addJoint('peg', s.insert, s.opening, s.out, s.point, { pullN: pull, depthMm });
      else addJoint('peg', s.insert, s.opening, s.axis, s.point, { pullN: pull, depthMm, orient: 'centres' });
    }
    if (fitted || hubbed) continue;
    joins.push({ a: s.insert, b: s.opening, axis: s.axis, point: s.point });
  }
  /**
   * One joint for each gap between neighbouring parts along a pin or pin stack, holding what the
   * slide-off rule says: the parts on one side slide off their end, past no shoulder, cap or standoff body.
   */
  const addPinJoints = (pins, holds) => {
    const first = pins.map((id) => byId.get(id)).find((p) => p?.pin) || null;
    const axis = first?.pin?.zAxis || holds[0].axis;
    const tOf = (point) => dot(point, axis);
    const blockers = [];
    for (const id of pins) {
      const pin = byId.get(id)?.pin;
      if (!pin) continue;
      const base = dot(pin.origin, axis);
      const sign = Math.sign(dot(pin.zAxis, axis)) || 1;
      for (const [lo, hi] of pin.blockersZ || []) {
        const ends = [base + sign * lo, base + sign * hi];
        blockers.push([Math.min(...ends), Math.max(...ends)]);
      }
    }
    const weak = pins.some((id) => byId.get(id)?.weak);
    const seats = holds.map((h) => ({ part: h.part, t: tOf(h.point), depthMm: h.depthMm, point: h.point }));
    const pointOf = new Map();
    for (const s of seats) if (!pointOf.has(s.part)) pointOf.set(s.part, s.point);
    for (const gap of gapStrengths({ seats, blockers, weak })) {
      const pa = pointOf.get(gap.a);
      const pb = pointOf.get(gap.b);
      addJoint('pin', gap.a, gap.b, axis, pa.map((v, k) => (v + pb[k]) / 2), { pullN: gap.pullN, depthMm: gap.depthMm, way: gap.way });
      joints[joints.length - 1].pinIds = [...pins];
    }
  };
  // Pins plugged into pins (a standoff stack) count as one pin
  const pinUf = unionFind([...pinLike]);
  for (const s of seated) if (pinLike.has(s.insert) && pinLike.has(s.opening)) pinUf.union(s.insert, s.opening);
  const stacks = new Map();
  for (const pin of pinLike) {
    const root = pinUf.find(pin);
    if (!stacks.has(root)) stacks.set(root, { pins: [], holds: [] });
    stacks.get(root).pins.push(pin);
    stacks.get(root).holds.push(...(pinParts.get(pin) || []).filter((h) => !pinLike.has(h.part)));
  }
  const pinHome = new Map(); // pin -> part it moves with
  for (const { pins, holds } of stacks.values()) {
    const partsHeld = [...new Set(holds.map((h) => h.part))];
    for (let i = 0; i < partsHeld.length; i++) {
      for (let j = i + 1; j < partsHeld.length; j++) {
        const h = holds.find((x) => x.part === partsHeld[i]);
        joins.push({ a: partsHeld[i], b: partsHeld[j], axis: h.axis, point: h.point });
      }
    }
    for (const pin of pins) pinHome.set(pin, partsHeld[0] || null);
    if (!partsHeld.length) for (const pin of pins) warnings.push({ partId: pin, text: `${labelOf(pin)} isn't in any part, so it stays still.` });
    else addPinJoints(pins, holds);
  }
  // The bays: a Gen 1 battery in its brain and a tire on its hub, each held all round as one piece
  for (const [battery, brain] of bays) {
    uf.union(brain, battery);
    addJoint(/Tire/i.test(byId.get(battery)?.name || '') ? 'tire' : 'bay', battery, brain, null, null);
  }
  // Racks clipped onto beams are one piece with the beam (openspec linear-motion-and-idler-pins)
  for (const [rack, beam] of clips) {
    if (!byId.has(rack) || !byId.has(beam)) continue;
    uf.union(beam, rack);
    addJoint('bay', rack, beam, null, null, { clip: true });
  }
  // Brackets pointing different ways lock what they hold
  for (const sl of slides) {
    if (!sl.locked) continue;
    uf.union(sl.brackets[0], sl.beams[0]);
    warnings.push({ partId: sl.beams[0], text: `${labelOf(sl.beams[0])} is held by brackets that point different ways, so it can't slide.` });
  }
  // Parts on one shaft press on their neighbours along it (a wheel on a spacer on a plate), and a
  // capped or motor shaft's cap or stop ring presses on the part it rests against
  groups.forEach((g) => {
    const axis = g.axis;
    const items = [];
    for (const s of seated) {
      if (!g.shaftIds.includes(s.insert) || stillSet.has(s.opening)) continue;
      items.push({ part: s.opening, t: dot(s.point, axis), point: s.point });
    }
    for (const id of g.shaftIds) {
      const stop = byId.get(id)?.shaftStop;
      if (stop) items.push({ part: id, t: dot(stop, axis), point: stop });
    }
    items.sort((x, y) => x.t - y.t || (x.part < y.part ? -1 : 1));
    for (let i = 0; i + 1 < items.length; i++) {
      const [x, y] = [items[i], items[i + 1]];
      if (x.part === y.part) continue;
      addJoint('push', x.part, y.part, axis, x.point.map((v, k) => (v + y.point[k]) / 2));
    }
  });

  // Merge bodies joined on two or more lines, until nothing changes
  for (let changed = true; changed; ) {
    changed = false;
    const lines = new Map(); // "ra|rb" -> [join]
    for (const j of joins) {
      const ra = uf.find(j.a);
      const rb = uf.find(j.b);
      if (ra === rb) continue;
      const key = ra < rb ? `${ra}|${rb}` : `${rb}|${ra}`;
      if (!lines.has(key)) lines.set(key, []);
      const list = lines.get(key);
      if (!list.some((l) => sameLine(l, j))) list.push(j);
    }
    for (const [key, list] of lines) {
      if (list.length < 2) continue;
      const [ra, rb] = key.split('|');
      if (uf.union(ra, rb)) changed = true;
    }
  }
  for (const [pin, home] of pinHome) if (home) uf.union(home, pin);

  // Bodies, with stable ids; the one with most parts holds still (no floor yet)
  const members = new Map();
  for (const id of [...nodes, ...pinLike]) {
    if (pinLike.has(id) && !pinHome.get(id)) continue;
    const root = uf.find(id);
    if (!members.has(root)) members.set(root, []);
    members.get(root).push(id);
  }
  const bodies = [...members.entries()]
    .map(([root, ids]) => ({ root, ids }))
    .sort((x, y) => y.ids.length - x.ids.length || (x.ids[0] < y.ids[0] ? -1 : 1))
    .map(({ root, ids }, i) => {
      const gi = groups.findIndex((g) => uf.find(g.shaftIds[0]) === root);
      return { id: `b${i}`, root, parts: ids, shaft: gi >= 0 ? gi : null, label: labelOf(ids.find((id) => !pinLike.has(id)) || ids[0]) };
    });
  const bodyOfRoot = new Map(bodies.map((b) => [b.root, b.id]));
  const bodyOf = (partId) => bodyOfRoot.get(uf.find(partId)) || null;
  for (const id of pinLike) if (!pinHome.get(id)) still.push(id);

  // Hinges: bodies joined on one line; motor sockets drive theirs. Parts that share the pin stack
  // or shaft of a hinge sit side by side on its line and turn against each other without colliding
  const hinges = [];
  const hingeKey = new Map();
  const hingePairSet = new Set();
  const addHingePair = (x, y) => {
    const bx = bodyOf(x);
    const by = bodyOf(y);
    if (!bx || !by || bx === by) return;
    hingePairSet.add(x < y ? `${x}|${y}` : `${y}|${x}`);
  };
  for (const j of joins) {
    addHingePair(j.a, j.b);
    const a = bodyOf(j.a);
    const b = bodyOf(j.b);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (hingeKey.has(key)) continue;
    const shaftSide = bodies.find((x) => x.id === a).shaft !== null || bodies.find((x) => x.id === b).shaft !== null;
    hingeKey.set(key, hinges.length);
    hinges.push({ id: `h${hinges.length}`, a, b, axis: j.axis, point: j.point, kind: shaftSide ? 'axle' : 'pin', motor: null });
  }
  for (const { pins, holds } of stacks.values()) {
    for (const pin of pins) for (const h of holds) addHingePair(pin, h.part);
  }
  const onShaft = new Map(); // shaft key -> Set of partIds on that shaft line
  groups.forEach((g, gi) => onShaft.set(`g${gi}`, new Set([...g.shaftIds, ...g.members.map((m) => m.id)])));
  for (const s of seated) {
    if (stillSet.has(s.insert) || stillSet.has(s.opening) || pinLike.has(s.insert) || pinLike.has(s.opening)) continue;
    const gi = groups.findIndex((g) => g.shaftIds.includes(s.insert));
    const key = gi >= 0 ? `g${gi}` : `s:${s.insert}`;
    if (!onShaft.has(key)) onShaft.set(key, new Set([s.insert]));
    onShaft.get(key).add(s.opening);
  }
  for (const set of onShaft.values()) {
    const ids = [...set];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) addHingePair(ids[i], ids[j]);
  }
  // A rubber collar spins on its shaft inside what the shaft carries (in an omni wheel's recess, under the
  // lock beam pinned there): it never collides with the parts of its shaft's body (openspec
  // linear-motion-and-idler-pins: Huey's front wheels turned it into their lock beams and stalled)
  for (const s of seated) {
    if (s.openingKind !== 'collar_hole' || stillSet.has(s.insert) || stillSet.has(s.opening)) continue;
    const shaftBody = uf.find(s.insert);
    if (shaftBody === uf.find(s.opening)) continue;
    for (const id of nodes) if (uf.find(id) === shaftBody) addHingePair(s.opening, id);
  }
  for (const t of tracks) {
    for (const s of t.sprockets) {
      for (const id of [...t.linkIds, ...t.grippers.map(([g]) => g)]) {
        hingePairSet.add(s < id ? `${s}|${id}` : `${id}|${s}`);
      }
    }
  }
  // Slides between bodies (openspec linear-motion-and-idler-pins, design §3): the bracket's body and the
  // beam's, along the slide, with the travel the engine found each way. Slides between the same two
  // bodies are one joint. The racks and beams riding through the brackets touch them by design, as
  // racks touch the gears on them, and never collide
  const slideJoints = [];
  for (const sl of slides) {
    if (sl.locked) continue;
    const a = bodyOf(sl.brackets[0]);
    const b = bodyOf(sl.beams[0]);
    if (!a || !b || a === b) continue;
    if (!slideJoints.some((j) => j.a === a && j.b === b)) {
      slideJoints.push({ id: `sl${slideJoints.length}`, a, b, direction: sl.direction, point: sl.point, limits: sl.limits, slide: sl.id });
    }
    for (const k of sl.brackets) for (const id of [...sl.beams, ...sl.racks]) hingePairSet.add(k < id ? `${k}|${id}` : `${id}|${k}`);
  }
  const motors = [];
  for (const { motor, group } of motorSockets) {
    const a = bodyOf(motor);
    const b = bodyOf(groups[group].shaftIds[0]);
    if (!a || !b) continue;
    if (a === b) {
      warnings.push({ partId: motor, text: `${labelOf(motor)} is locked to the shaft it drives, so it can't turn it.` });
      continue;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    let index = hingeKey.get(key);
    if (index === undefined) {
      index = hinges.length;
      hingeKey.set(key, index);
      hinges.push({ id: `h${index}`, a, b, axis: groups[group].axis, point: groups[group].point, kind: 'axle', motor: null });
    }
    // The motor's body is side a, so a positive speed turns the shaft about +axis relative to it
    const h = hinges[index];
    if (h.a !== a) Object.assign(h, { a, b: h.a });
    Object.assign(h, { axis: groups[group].axis, point: groups[group].point, motor });
    motors.push({ id: motor, label: labelOf(motor), hinge: h.id, stopping: byId.get(motor)?.stopping || 'brake' });
  }

  // Gears, racks and chains drive each other
  const links = [];
  const slideRacks = new Map(slides.flatMap((sl) => sl.racks.map((r) => [r, sl])));
  // Gears just out of mesh: their smooth collision shells would rub and drag each other, so they are
  // kept from colliding as well as from driving (openspec play-mode)
  const nearGears = [];
  for (const m of meshes) {
    if (m.kind === 'near') {
      warnings.push({ partId: m.b, text: `${labelOf(m.a)} and ${labelOf(m.b)} are ${m.offMm} mm out of mesh, so they don't drive each other.` });
      nearGears.push([m.a, m.b]);
      continue;
    }
    const a = bodyOf(m.a);
    const b = bodyOf(m.b);
    if (!a || !b) continue;
    if (a === b) {
      warnings.push({ partId: m.b, text: `${labelOf(m.a)} and ${labelOf(m.b)} mesh but are locked together, so they can't turn.` });
    }
    if (m.kind === 'gear') {
      links.push({ kind: 'gear', a, b, gears: [m.a, m.b], ratio: m.teethA / m.teethB, sign: -Math.sign(dot(m.axisA, m.axisB)) || -1, axisA: m.axisA, axisB: m.axisB });
    } else if (m.kind === 'bevel' || m.kind === 'crown' || m.kind === 'worm' || m.kind === 'hybrid') {
      // Gears at 90° (openspec right-angle-gears): `ratio` is signed (b about axisB per a about
      // axisA); a worm (always a) drives its gear one way only
      links.push({ kind: 'gear', pair: m.kind, a, b, gears: [m.a, m.b], ratio: Math.abs(m.ratio), sign: Math.sign(m.ratio) || -1, axisA: m.axisA, axisB: m.axisB, ...(m.oneWay ? { oneWay: true } : {}) });
    } else {
      links.push({ kind: 'rack', a, b, gears: [m.a, m.b], axisA: m.axisA, direction: m.direction, mmPerRad: m.mmPerRad });
      // A gear on a slide's rack runs along the slide's other racks too (end to end on its line)
      const sl = slideRacks.get(m.b);
      if (sl) for (const r of sl.racks) hingePairSet.add(m.a < r ? `${m.a}|${r}` : `${r}|${m.a}`);
    }
  }
  for (const ids of chains) {
    for (let i = 1; i < ids.length; i++) {
      const pa = byId.get(ids[0]);
      const pb = byId.get(ids[i]);
      const a = bodyOf(ids[0]);
      const b = bodyOf(ids[i]);
      if (!a || !b || !pa?.gear || !pb?.gear) continue;
      const axisA = sprocketAxes[ids[0]];
      const axisB = sprocketAxes[ids[i]];
      links.push({ kind: 'chain', a, b, gears: [ids[0], ids[i]], ratio: pa.gear.teeth / pb.gear.teeth, sign: Math.sign(dot(axisA, axisB)) || 1, axisA, axisB });
    }
  }

  // A motor whose train reaches a worm only from the gear's side can't turn it
  for (const l of links.filter((x) => x.oneWay)) {
    for (const m of motors) {
      const h = hinges.find((x) => x.id === m.hinge);
      if (!h) continue;
      const reached = new Set([h.b]);
      for (let k = 0, queue = [h.b]; k < queue.length; k++) {
        for (const o of links) {
          if (o.oneWay) continue;
          const next = o.a === queue[k] ? o.b : o.b === queue[k] ? o.a : null;
          if (next && !reached.has(next)) {
            reached.add(next);
            queue.push(next);
          }
        }
      }
      if (reached.has(l.b) && !reached.has(l.a)) {
        warnings.push({ partId: m.id, text: `${m.label} can't turn ${labelOf(l.gears[0])}: a worm can only be turned from its own shaft.` });
      }
    }
  }
  // Pieces: bodies joined by hinges. The largest piece, and any piece with a Smart Motor driving a
  // shaft, holds one body still (no floor yet): the one carrying most such motors, as motors sit on
  // the frame, else the largest. Other pieces aren't joined to the robot: they stay still, block
  // nothing (they'd fall off) and are listed. A rack joined only to its gear slides along its teeth.
  const joined = new Set();
  for (const h of hinges) joined.add(h.a).add(h.b);
  for (const j of slideJoints) joined.add(j.a).add(j.b);
  const sliders = links.filter((l) => l.kind === 'rack' && !joined.has(l.b) && l.a !== l.b).map((l) => l.b);
  const driving = new Set(motors.map((m) => m.id));
  const motorCount = (b) => b.parts.filter((id) => driving.has(id)).length;
  const findPieces = () => {
    const out = [];
    const reached = new Set(sliders);
    for (const start of bodies) {
      if (reached.has(start.id)) continue;
      const piece = [start];
      reached.add(start.id);
      for (let i = 0; i < piece.length; i++) {
        for (const h of [...hinges, ...slideJoints]) {
          const next = h.a === piece[i].id ? h.b : h.b === piece[i].id ? h.a : null;
          if (next && !reached.has(next)) reached.add(next) && piece.push(bodies.find((b) => b.id === next));
        }
      }
      out.push(piece);
    }
    return out;
  };
  let pieces = findPieces();
  const size = (piece) => piece.reduce((n, b) => n + b.parts.length, 0);
  let largest = pieces.reduce((best, p) => (!best || size(p) > size(best) ? p : best), null);
  // A piece hanging on a rope from the rest of the robot (a carriage, even one carrying its own motor):
  // when the parts round it let it move along one line only, it slides along it on the body it is
  // nested in (openspec rope-and-spool, design decision 10; the engine's `guide` tries the moves). Its
  // bodies are listed as roped, so they fall when gravity is on
  const guidedBodies = new Set();
  if (inputs.guide && ropes.length) {
    for (const piece of pieces) {
      if (piece === largest) continue;
      const own = new Set(piece.map((b) => b.id));
      const ropeBodies = ropes.map((r) => r.elements.map((e) => (e.instanceId ? bodyOf(e.instanceId) : null)).filter(Boolean));
      const carrier = ropeBodies.flatMap((list) => (list.some((b) => !own.has(b)) ? list.filter((b) => own.has(b)) : []))[0];
      if (!carrier) continue;
      const moving = piece.flatMap((b) => b.parts);
      const candidates = bodies.filter((b) => !own.has(b.id)).map((b) => ({ key: b.id, parts: b.parts }));
      const g = inputs.guide(moving, candidates);
      if (!g) continue;
      slideJoints.push({ id: `sl${slideJoints.length}`, a: g.key, b: carrier, direction: g.direction, point: g.point, limits: g.limits, rope: true });
      for (const b of piece) guidedBodies.add(b.id);
    }
    if (guidedBodies.size) {
      for (const j of slideJoints) joined.add(j.a).add(j.b);
      pieces = findPieces();
      largest = pieces.reduce((best, p) => (!best || size(p) > size(best) ? p : best), null);
    }
  }
  const fixed = [];
  const loose = [];
  for (const piece of pieces) {
    if (piece === largest || piece.some(motorCount)) {
      fixed.push(piece.reduce((best, b) => (motorCount(b) > motorCount(best) ? b : best)).id);
      continue;
    }
    for (const b of piece) fixed.push(b.id) && loose.push(b.id);
    const n = size(piece);
    const main = piece[0];
    if (links.some((l) => piece.some((b) => l.a === b.id || l.b === b.id)) && n === 1) {
      warnings.push({ partId: main.parts[0], text: `${main.label} isn't held on anything, so it stays still and other gears can't turn it.` });
    } else {
      warnings.push({
        partId: main.parts[0],
        text: n === 1 ? `${main.label} isn't joined to anything, so it stays still.` : `${main.label} and ${n - 1} part${n === 2 ? '' : 's'} with it aren't joined to the rest of the robot, so they stay still and don't block anything.`
      });
    }
  }

  // Gears whose shafts can move apart (openspec ratchet-and-pawl, design §8–9). A gear's holder is the
  // body its own body turns on along the gear's axis (the frame before a washer: most parts wins), or
  // its own body when it turns on nothing there. Two spur gears of one tooth size, axes parallel and
  // tooth bands overlapping, on different bodies whose holders can move against each other (not the
  // same body, not both held still), and within MAYBE_MESH_MM of mesh distance, may mesh while playing:
  // they go in `maybeMeshes`, and a pair meshed on entry goes there instead of `links`. Every other
  // gear pair is linked exactly as before.
  const fixedSet = new Set(fixed);
  const gearById = new Map(spurGears.map((gr) => [gr.id, gr]));
  const sizeOfBody = (id) => bodies.find((b) => b.id === id)?.parts.length || 0;
  const holderOf = (gr) => {
    const own = bodyOf(gr.id);
    const line = { axis: gr.axis, point: gr.center };
    const near = hinges.filter((h) => (h.a === own || h.b === own) && sameLine({ axis: h.axis, point: h.point }, line)).map((h) => (h.a === own ? h.b : h.a));
    if (!near.length) return own;
    return near.reduce((best, id) => (fixedSet.has(id) && !fixedSet.has(best) ? id : fixedSet.has(best) && !fixedSet.has(id) ? best : sizeOfBody(id) > sizeOfBody(best) ? id : best));
  };
  const canMoveApart = (ha, hb) => ha && hb && ha !== hb && !(fixedSet.has(ha) && fixedSet.has(hb));
  const maybeMeshes = [];
  const pairDone = new Set();
  const addMaybe = (ga, gb, meshedOnEntry) => {
    const [bodyA, bodyB] = [bodyOf(ga.id), bodyOf(gb.id)];
    maybeMeshes.push({
      id: `m${maybeMeshes.length}`,
      gears: [ga.id, gb.id],
      a: bodyA,
      b: bodyB,
      holders: [holderOf(ga), holderOf(gb)],
      teeth: [ga.teeth, gb.teeth],
      radii: [ga.pitchRadiusMm, gb.pitchRadiusMm],
      axes: [ga.axis, gb.axis],
      centers: [ga.center, gb.center],
      toothDirs: [ga.toothDir, gb.toothDir],
      faceSpans: [ga.faceSpan, gb.faceSpan],
      meshedOnEntry
    });
  };
  for (let i = links.length - 1; i >= 0; i--) {
    const l = links[i];
    if (l.kind !== 'gear' || l.pair) continue;
    const [ga, gb] = l.gears.map((id) => gearById.get(id));
    if (!ga || !gb || !canMoveApart(holderOf(ga), holderOf(gb))) continue;
    links.splice(i, 1);
    addMaybe(ga, gb, true);
    pairDone.add([ga.id, gb.id].sort().join('|'));
  }
  // Gears just out of mesh that can swing into it aren't reported as out of mesh
  const swingable = new Set();
  for (let i = 0; i < spurGears.length; i++) {
    for (let j = i + 1; j < spurGears.length; j++) {
      const [ga, gb] = [spurGears[i], spurGears[j]];
      if (pairDone.has([ga.id, gb.id].sort().join('|'))) continue;
      const [bodyA, bodyB] = [bodyOf(ga.id), bodyOf(gb.id)];
      if (!bodyA || !bodyB || bodyA === bodyB || Math.abs(ga.moduleMm - gb.moduleMm) > 0.01) continue;
      if (Math.abs(dot(ga.axis, gb.axis)) < PARALLEL || !canMoveApart(holderOf(ga), holderOf(gb))) continue;
      const d = sub(gb.center, ga.center);
      const along = dot(d, ga.axis);
      const apart = Math.sqrt(Math.max(0, dot(d, d) - along * along));
      // Tooth bands along the axis overlap (B's band measured in A's axis, which may point the other way)
      const sB = dot(gb.axis, ga.axis) > 0 ? gb.faceSpan : [-gb.faceSpan[1], -gb.faceSpan[0]];
      const overlap = Math.min(ga.faceSpan[1], along + sB[1]) - Math.max(ga.faceSpan[0], along + sB[0]);
      if (overlap <= 0 || Math.abs(apart - ga.pitchRadiusMm - gb.pitchRadiusMm) > MAYBE_MESH_MM) continue;
      addMaybe(ga, gb, false);
      swingable.add([ga.id, gb.id].sort().join('|'));
    }
  }
  for (let i = warnings.length - 1; i >= 0; i--) {
    const near = nearGears.find(([x, y]) => warnings[i].partId === y && swingable.has([x, y].sort().join('|')));
    if (near && /out of mesh/.test(warnings[i].text)) warnings.splice(i, 1);
  }

  // Tracks (chain and track parts) ride with the body that holds their sprockets' axles: the one most
  // of the sprockets' shaft bodies hang on within two hinges (else the largest), or the sprocket's own
  // body when it isn't on a shaft. A track on a single sprocket also runs round its loop as that
  // sprocket turns (`drive`); those on several sprockets are tied by ratio and only ride along.
  const sizeOf = new Map(bodies.map((b) => [b.id, b.parts.length]));
  const hingeNeighbours = (id) => hinges.filter((h) => h.a === id || h.b === id).map((h) => (h.a === id ? h.b : h.a));
  const trackList = tracks
    .map((t) => {
      const sprockets = t.sprockets.filter((id) => bodyOf(id));
      if (!sprockets.length) return null;
      // Each sprocket's body votes for the bodies it hangs on, within two hinges (a shaft body hangs on
      // spacers and the frame; a loose sprocket on its shaft's body). Most sprockets reaching it wins,
      // then nearest, then largest: so a frame shared by every sprocket beats each one's own spacer.
      const ownBodies = new Set(sprockets.map(bodyOf));
      const reach = new Map(); // body -> { count, near }
      const vote = (body, near) => {
        const r = reach.get(body) || { count: 0, near: 0 };
        r.count += 1;
        r.near += near;
        reach.set(body, r);
      };
      for (const id of sprockets) {
        const own = bodyOf(id);
        const first = hingeNeighbours(own).filter((n) => !ownBodies.has(n));
        const second = new Set();
        for (const n of first) for (const m of hingeNeighbours(n)) if (m !== own && !ownBodies.has(m) && !first.includes(m)) second.add(m);
        for (const n of first) vote(n, 100);
        for (const n of second) vote(n, 1);
      }
      const frame =
        [...reach.entries()].sort((x, y) => y[1].count - x[1].count || y[1].near - x[1].near || sizeOf.get(y[0]) - sizeOf.get(x[0]))[0]?.[0] ?? null;
      const sp = t.links ? sprockets.map((id) => parts.find((p) => p.id === id)).find((p) => p?.gear) : null;
      return {
        links: t.links,
        linkIds: t.linkIds,
        grippers: t.grippers,
        frame,
        drive: sp ? { body: bodyOf(sp.id), axis: sprocketAxes[sp.id], teeth: sp.gear.teeth } : null
      };
    })
    .filter(Boolean);

  // Ratchets (openspec ratchet-and-pawl, design §7): a pawl holding a ratchet ties the ratchet's body to
  // the body the pawl hangs on, one way; a pawl on two pins is part of that body and ties it both ways.
  // A pawl facing the wrong way holds nothing.
  const ratchetList = [];
  for (const r of ratchets) {
    const ratchetBody = bodyOf(r.ratchet);
    const pawlBody = bodyOf(r.pawl);
    if (!ratchetBody || !pawlBody) continue;
    if (r.wrongWay) {
      warnings.push({ partId: r.pawl, text: `${labelOf(r.pawl)} faces the wrong way on ${labelOf(r.ratchet)}, so it holds nothing: the ratchet turns both ways.` });
      continue;
    }
    if (!r.holds || r.pivotCount === 0) continue;
    if (pawlBody === ratchetBody) {
      warnings.push({ partId: r.pawl, text: `${labelOf(r.pawl)} is locked to ${labelOf(r.ratchet)}, so it holds nothing.` });
      continue;
    }
    let holderBody = null;
    let locked = false;
    if (r.pivotCount >= 2) {
      // Pinned through two holes: one body with what it's pinned to
      holderBody = pawlBody;
      locked = true;
      warnings.push({ partId: r.pawl, text: `${labelOf(r.pawl)} is pinned through two holes, so it can't lift: ${labelOf(r.ratchet)} is locked both ways.` });
    } else {
      const line = r.pivot ? { axis: r.pivot.axis, point: r.pivot.point } : null;
      const hinge = hinges.find((h) => (h.a === pawlBody || h.b === pawlBody) && (!line || sameLine({ axis: h.axis, point: h.point }, line)));
      if (!hinge) continue;
      holderBody = hinge.a === pawlBody ? hinge.b : hinge.a;
      if (holderBody === ratchetBody) continue;
    }
    ratchetList.push({
      id: `r${ratchetList.length}`,
      ratchet: r.ratchet,
      pawl: r.pawl,
      ratchetBody,
      holderBody,
      pawlBody,
      locked,
      pressed: Boolean(r.pressed),
      axis: r.axis,
      point: r.center,
      freeSign: r.freeSign,
      teeth: r.teeth,
      tipRadiusMm: r.tipRadiusMm,
      profileMm: r.profileMm,
      phaseDeg: r.phaseDeg,
      leverMm: r.leverMm,
      pivot: r.pivot,
      tip: r.tip
    });
  }

  // Bands (openspec rubber-bands): no body of their own; each spot belongs to the body of its part.
  // A band whose spots are all on one body pulls on nothing.
  // A band pressing a pawl onto its ratchet presses by the ratchet rule (pressed), not by pulling: its
  // full pull on a light pawl would kick the ratchet and what holds it
  const pawlBodies = new Set(ratchetList.map((r) => r.pawlBody));
  const bandList = bands.map((b) => {
    const spotBodies = b.elements.map((e) => bodyOf(e.instanceId));
    const pressesPawl = spotBodies.some((id) => pawlBodies.has(id));
    return { ...b, bodies: spotBodies, pulls: !pressesPawl && new Set(spotBodies.filter(Boolean)).size > 1, ...(pressesPawl ? { pressesPawl: true } : {}) };
  });

  // Ropes (openspec rope-and-spool, design decision 8): no body either; each element belongs to the
  // body of its part. A rope pulls when both ends are held and its elements are on more than one body.
  // Bodies joined to the robot by no pin or shaft but holding a rope's end or spot (a carriage, a
  // hook) hang on the rope instead of being loose (design decision 10): pulled by it, falling when
  // gravity is on, colliding as other moving bodies do
  const roped = [];
  const ropeBodyIds = new Set(ropes.flatMap((r) => r.elements.map((e) => (e.instanceId ? bodyOf(e.instanceId) : null)).filter(Boolean)));
  // ...with the loose bodies hinged to them (a hook on a pin in the rope's tab carrier)
  for (let grew = true; grew; ) {
    grew = false;
    for (const h of hinges) {
      for (const [x, y] of [[h.a, h.b], [h.b, h.a]]) {
        if (ropeBodyIds.has(x) && loose.includes(y) && !ropeBodyIds.has(y)) {
          ropeBodyIds.add(y);
          grew = true;
        }
      }
    }
  }
  for (const id of guidedBodies) roped.push(id);
  for (const id of [...loose]) {
    if (!ropeBodyIds.has(id)) continue;
    loose.splice(loose.indexOf(id), 1);
    roped.push(id);
    const b = bodies.find((x) => x.id === id);
    for (let k = warnings.length - 1; k >= 0; k--) if (b?.parts.includes(warnings[k].partId)) warnings.splice(k, 1);
  }
  const ropeList = ropes.map((r) => {
    // A pulley or post that spins on one pin and nothing else (an idler pulley) only passes the rope's
    // pull on through its axle: a frictionless pulley feels the same pull both sides, so the two add
    // up to one force through the axle. The rope's spot is carried by, and pulls on, the part that
    // pin is in. So does a rope end tied on a shaft that spins freely in a part (Swish's arm), its
    // tie on the shaft's line: every joint of the shaft's body turns on that one line (a collar riding
    // on the shaft too), and the spot goes to the part the shaft turns in, not to the collar.
    const ownBodies = r.elements.map((e) => (e.instanceId ? bodyOf(e.instanceId) : null));
    const onLine = (h, e) => (e.shape === 'circle' ? sameLine({ axis: h.axis, point: h.point }, { axis: e.axis, point: e.center }) : sameLine({ axis: h.axis, point: h.point }, { axis: h.axis, point: e.center }));
    const elBodies = r.elements.map((e, i) => {
      const b = ownBodies[i];
      if (!b || !(e.shape === 'circle' || e.kind === 'end') || (r.spool && i === r.spool.element)) return b;
      const own = hinges.filter((h) => h.a === b || h.b === b);
      if (!own.length || own.some((h) => h.motor || !onLine(h, e))) return b;
      const partners = own.map((h) => (h.a === b ? h.b : h.a));
      if (partners.length === 1) return partners[0];
      // The part the shaft turns in is joined to more than the shaft; a collar or spacer on it isn't
      const held = partners.filter((p) => hinges.some((h) => (h.a === p || h.b === p) && h.a !== b && h.b !== b) || fixed.includes(p));
      return held.length === 1 ? held[0] : b;
    });
    // The pulleys whose spots another body carries ride with it: [carried body | null per element]
    const riders = ownBodies.map((b, i) => (b && b !== elBodies[i] ? b : null));
    const spool = r.spool ? { ...r.spool, body: elBodies[r.spool.element] } : null;
    return { ...r, bodies: elBodies, riders, spool, pulls: !r.free && new Set(elBodies.filter(Boolean)).size > 1 };
  });

  return {
    bodies: bodies.map(({ root, ...rest }) => rest),
    tracks: trackList,
    bands: bandList,
    ropes: ropeList,
    ground: bodies[0]?.id || null,
    fixed,
    loose,
    roped,
    sliders,
    hinges,
    slideJoints,
    hingePairs: [...hingePairSet].map((k) => k.split('|')),
    joints: joints.map((j) => ({ ...j, bodyA: bodyOf(j.a), bodyB: bodyOf(j.b) })),
    partInfo: Object.fromEntries(parts.map((p) => [p.id, { label: p.label, name: p.name, partNumber: p.partNumber, category: p.category, box: p.box, weak: Boolean(p.weak), fastener: p.fastener, motor: p.motor, chain: p.chain }])),
    bays,
    shaftPairs,
    links,
    maybeMeshes,
    ratchets: ratchetList,
    nearGears,
    motors,
    still,
    pins: [...pinLike],
    solidPins: [...pinLike].filter((id) => byId.get(id)?.standoff),
    warnings
  };
}
