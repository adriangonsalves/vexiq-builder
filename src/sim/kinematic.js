/**
 * Play mode's first pass (openspec play-mode): turns the body graph by motor speed and gear, rack
 * and chain ratios alone, with no collisions. Also the fallback when the physics library can't load.
 *
 * Bodies hang off the fixed bodies in a tree of hinges; each step every body's hinge speed is set
 * from the motors outward through the ratio links. A train that asks a body for two speeds, or asks
 * a fixed body to turn, is jammed: it stops and its motors show as stalled.
 */
import * as THREE from 'three';

export const MOTOR_FREE_RPM = 120;
export const MOTOR_FREE_RAD_S = (MOTOR_FREE_RPM * 2 * Math.PI) / 60;
const ALONG = 0.99; // a gear axis must lie this close to its body's hinge axis to turn with it
const SAME = 1e-6;

const v3 = (a) => new THREE.Vector3(...a);

export function createKinematic(graph) {
  const fixed = new Set(graph.fixed);
  const sliders = new Set(graph.sliders || []);
  // Tree of hinges from the fixed bodies: body -> { parent, hinge, axis (child turns about +axis), point }
  const tree = new Map();
  const order = [];
  for (const root of graph.fixed) {
    const queue = [root];
    order.push(root);
    while (queue.length) {
      const cur = queue.shift();
      for (const h of graph.hinges) {
        const child = h.a === cur ? h.b : h.b === cur ? h.a : null;
        if (!child || fixed.has(child) || tree.has(child)) continue;
        // A hinge's speed turns b relative to a about +axis
        const axis = v3(h.axis).normalize().multiplyScalar(child === h.b ? 1 : -1);
        tree.set(child, { parent: cur, hinge: h.id, axis, point: v3(h.point) });
        order.push(child);
        queue.push(child);
      }
    }
  }
  const angle = new Map(order.map((id) => [id, 0])); // radians about the tree axis
  const slide = new Map([...sliders].map((id) => [id, 0])); // mm along the rack
  // How each motor's hinge turns a body of the tree: the shaft side (b) when it turns with the motor
  // body taken as still, else the motor side (a) when it hangs off the shaft
  const motorBody = new Map(
    graph.motors.map((m) => {
      const h = graph.hinges.find((x) => x.id === m.hinge);
      const axis = v3(h.axis).normalize();
      for (const [body, sign] of [[h.b, 1], [h.a, -1]]) {
        const t = tree.get(body);
        const along = t ? t.axis.dot(axis) : 0;
        if (Math.abs(along) >= ALONG) return [m.id, { child: body, sign: sign / along }];
      }
      return [m.id, { child: null, sign: 0 }];
    })
  );

  const speedOf = new Map(); // body -> rad/s about its tree axis (or mm/s for sliders)
  let stalled = new Set();

  /** World spin of a body about `axis` from its own hinge speed (its parent taken as still). */
  const spinAbout = (body, axis) => {
    const t = tree.get(body);
    if (!t) return 0;
    return (speedOf.get(body) || 0) * t.axis.dot(axis);
  };

  function solve(throttles) {
    speedOf.clear();
    const jammed = new Set();
    const setBy = new Map(); // body -> motor id that set it
    const queue = [];
    for (const m of graph.motors) {
      const mb = motorBody.get(m.id);
      const throttle = throttles.get(m.id) || 0;
      if (!throttle) continue;
      // A motor whose shaft can't turn on any hinge is stuck
      if (!mb?.child) {
        jammed.add(m.id);
        continue;
      }
      speedOf.set(mb.child, mb.sign * throttle * MOTOR_FREE_RAD_S);
      setBy.set(mb.child, m.id);
      queue.push(mb.child);
    }
    const jam = (motor) => jammed.add(motor);
    while (queue.length) {
      const cur = queue.shift();
      for (const l of graph.links) {
        if (l.a !== cur && l.b !== cur) continue;
        const forward = l.a === cur;
        const other = forward ? l.b : l.a;
        const motor = setBy.get(cur);
        let want;
        if (l.kind === 'rack') {
          if (!forward) continue; // a rack doesn't drive its gear back in this pass
          want = l.mmPerRad * spinAbout(cur, v3(l.axisA));
          if (!sliders.has(other)) {
            if (Math.abs(want) > SAME) jam(motor);
            continue;
          }
        } else {
          // A worm (side a) turns its gear, but the gear can't turn the worm: asked to, it jams
          // (reached from the gear after the worm set it, it's only the same mesh seen from the other end)
          if (l.oneWay && !forward) {
            if (!speedOf.has(other) && Math.abs(spinAbout(cur, v3(l.axisB))) > SAME) jam(motor);
            continue;
          }
          const [mine, theirs] = forward ? [v3(l.axisA), v3(l.axisB)] : [v3(l.axisB), v3(l.axisA)];
          const ratio = forward ? l.ratio : 1 / l.ratio;
          const spinWanted = l.sign * ratio * spinAbout(cur, mine);
          const t = tree.get(other);
          if (!t || Math.abs(t.axis.dot(theirs)) < ALONG) {
            if (Math.abs(spinWanted) > SAME) jam(motor);
            continue;
          }
          want = spinWanted / t.axis.dot(theirs);
        }
        if (speedOf.has(other)) {
          if (Math.abs(speedOf.get(other) - want) > 1e-3 * Math.max(1, Math.abs(want))) {
            jam(motor);
            if (setBy.get(other) !== motor) jam(setBy.get(other));
          }
          continue;
        }
        speedOf.set(other, want);
        setBy.set(other, motor);
        queue.push(other);
      }
    }
    // A jammed motor's whole train stops
    for (const [body, motor] of setBy) if (jammed.has(motor)) speedOf.set(body, 0);
    stalled = jammed;
  }

  return {
    /** Advances by `dt` seconds with `throttles` (Map motorId -> -1..1). */
    step(dt, throttles) {
      solve(throttles);
      for (const [body, speed] of speedOf) {
        if (sliders.has(body)) slide.set(body, slide.get(body) + speed * dt);
        else if (angle.has(body)) angle.set(body, angle.get(body) + speed * dt);
      }
    },
    /** Each body's move from where it started, as a world Matrix4: body -> Matrix4. */
    deltas() {
      const out = new Map();
      for (const id of order) {
        const t = tree.get(id);
        if (!t) {
          out.set(id, new THREE.Matrix4());
          continue;
        }
        const turn = new THREE.Matrix4()
          .makeTranslation(t.point.x, t.point.y, t.point.z)
          .multiply(new THREE.Matrix4().makeRotationAxis(t.axis, angle.get(id)))
          .multiply(new THREE.Matrix4().makeTranslation(-t.point.x, -t.point.y, -t.point.z));
        out.set(id, out.get(t.parent).clone().multiply(turn));
      }
      for (const id of sliders) {
        const l = graph.links.find((x) => x.kind === 'rack' && x.b === id);
        const d = v3(l.direction).multiplyScalar(slide.get(id));
        out.set(id, new THREE.Matrix4().makeTranslation(d.x, d.y, d.z));
      }
      return out;
    },
    /** Motor shaft speeds (rpm, signed by throttle direction) and which motors are stalled. */
    status() {
      const motors = {};
      for (const m of graph.motors) {
        const mb = motorBody.get(m.id);
        const rad = mb?.child ? (speedOf.get(mb.child) || 0) / mb.sign : 0;
        motors[m.id] = { rpm: (rad * 60) / (2 * Math.PI), stalled: stalled.has(m.id) };
      }
      return motors;
    },
    /** A body's spin about a world axis (rad/s), from its own hinge. */
    spin: (body, axis) => spinAbout(body, v3(axis).normalize())
  };
}
