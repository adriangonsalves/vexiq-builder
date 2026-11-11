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
 * motor }], links: [{ kind, a, b, ratio, sign, axisA, axisB?, direction?, mmPerRad? }],
 * motors: [{ id, label, hinge }], still: [partId], pins: [partId], solidPins: [partId] (the pins that
 * are solid posts, standoffs, and so collide), tracks: [{ links (in order round
 * the loop, or null), linkIds, grippers: [[gripperId, linkId]], frame: bodyId, drive: { body, axis, teeth } | null }], bands: [{ id, label,
 * elements, bodies (per spot), pulls, freeMm, ... }] (openspec rubber-bands), warnings: [{ partId, text }] }.
 */
import { gapStrengths, jointSpec, seatGrip, snapGrip } from './fastenerStrength.js';

export const SQUARE_FIT_DEG = 45;
const LINE_MM = 0.5; // two joins this close to one line count as the same line
const PARALLEL = 0.999;

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
  const { parts, seated, groups, meshes, chains, tracks = [], sprocketAxes = {}, bays = [], bands = [] } = inputs;
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
  for (const t of tracks) {
    for (const s of t.sprockets) {
      for (const id of [...t.linkIds, ...t.grippers.map(([g]) => g)]) {
        hingePairSet.add(s < id ? `${s}|${id}` : `${id}|${s}`);
      }
    }
  }
  const hingePairs = [...hingePairSet].map((k) => k.split('|'));
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
    motors.push({ id: motor, label: labelOf(motor), hinge: h.id });
  }

  // Gears, racks and chains drive each other
  const links = [];
  for (const m of meshes) {
    if (m.kind === 'near') {
      warnings.push({ partId: m.b, text: `${labelOf(m.a)} and ${labelOf(m.b)} are ${m.offMm} mm out of mesh, so they don't drive each other.` });
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
    } else {
      links.push({ kind: 'rack', a, b, gears: [m.a, m.b], axisA: m.axisA, direction: m.direction, mmPerRad: m.mmPerRad });
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

  // Pieces: bodies joined by hinges. The largest piece, and any piece with a Smart Motor driving a
  // shaft, holds one body still (no floor yet): the one carrying most such motors, as motors sit on
  // the frame, else the largest. Other pieces aren't joined to the robot: they stay still, block
  // nothing (they'd fall off) and are listed. A rack joined only to its gear slides along its teeth.
  const joined = new Set();
  for (const h of hinges) joined.add(h.a).add(h.b);
  const sliders = links.filter((l) => l.kind === 'rack' && !joined.has(l.b) && l.a !== l.b).map((l) => l.b);
  const driving = new Set(motors.map((m) => m.id));
  const motorCount = (b) => b.parts.filter((id) => driving.has(id)).length;
  const pieces = [];
  const reached = new Set(sliders);
  for (const start of bodies) {
    if (reached.has(start.id)) continue;
    const piece = [start];
    reached.add(start.id);
    for (let i = 0; i < piece.length; i++) {
      for (const h of hinges) {
        const next = h.a === piece[i].id ? h.b : h.b === piece[i].id ? h.a : null;
        if (next && !reached.has(next)) reached.add(next) && piece.push(bodies.find((b) => b.id === next));
      }
    }
    pieces.push(piece);
  }
  const size = (piece) => piece.reduce((n, b) => n + b.parts.length, 0);
  const largest = pieces.reduce((best, p) => (!best || size(p) > size(best) ? p : best), null);
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

  // Bands (openspec rubber-bands): no body of their own; each spot belongs to the body of its part.
  // A band whose spots are all on one body pulls on nothing.
  const bandList = bands.map((b) => {
    const spotBodies = b.elements.map((e) => bodyOf(e.instanceId));
    return { ...b, bodies: spotBodies, pulls: new Set(spotBodies.filter(Boolean)).size > 1 };
  });

  return {
    bodies: bodies.map(({ root, ...rest }) => rest),
    tracks: trackList,
    bands: bandList,
    ground: bodies[0]?.id || null,
    fixed,
    loose,
    sliders,
    hinges,
    hingePairs,
    joints: joints.map((j) => ({ ...j, bodyA: bodyOf(j.a), bodyB: bodyOf(j.b) })),
    partInfo: Object.fromEntries(parts.map((p) => [p.id, { label: p.label, name: p.name, partNumber: p.partNumber, category: p.category, box: p.box, weak: Boolean(p.weak), fastener: p.fastener, motor: p.motor, chain: p.chain }])),
    bays,
    shaftPairs,
    links,
    motors,
    still,
    pins: [...pinLike],
    solidPins: [...pinLike].filter((id) => byId.get(id)?.standoff),
    warnings
  };
}
