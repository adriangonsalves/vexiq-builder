/**
 * Runs Play mode (openspec play-mode) in the page: steps the motion every frame and moves the part
 * groups in the 3D view to match, without touching the build. `engine` is the kinematic pass
 * (src/sim/kinematic.js) or the physics world (src/sim/physics.js); both have step(dt, throttles),
 * deltas(), spin(bodyId, axis) and status().
 *
 * Chain and track parts have no body of their own: each track rides with the body holding its
 * sprockets (graph.tracks[].frame), and one on a single sprocket runs round its loop as that
 * sprocket turns, each link moving to where the next link was (blended between the two).
 */
import * as THREE from 'three';

const MAX_DT = 1 / 20; // a slow frame doesn't jump the motion

const startMatrix = (inst) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...inst.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...inst.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ')),
    new THREE.Vector3(1, 1, 1)
  );

const THREE_ONE = new THREE.Vector3(1, 1, 1);
const poseOf = (inst) => {
  const m = startMatrix(inst);
  return { m, p: new THREE.Vector3().setFromMatrixPosition(m), q: new THREE.Quaternion().setFromRotationMatrix(m) };
};

/** One track: its links' starting poses in loop order, with the grippers' places on their links. */
function trackState(track, byId) {
  const start = new Map([...track.linkIds, ...track.grippers.map(([g]) => g)].map((id) => [id, poseOf(byId.get(id))]));
  const order = track.drive && track.links ? track.links : null;
  let dir = 1;
  if (order) {
    // Loop order against the sprocket's turn: counter-clockwise about its axis is its positive turn
    const normal = new THREE.Vector3();
    order.forEach((id, i) => normal.add(start.get(id).p.clone().cross(start.get(order[(i + 1) % order.length]).p)));
    dir = Math.sign(normal.dot(new THREE.Vector3(...track.drive.axis))) || 1;
  }
  return {
    track,
    order,
    dir,
    start,
    phase: 0,
    grippers: track.grippers.map(([g, link]) => ({ id: g, link, rel: start.get(link).m.clone().invert().multiply(start.get(g).m) }))
  };
}

export function createPlayRunner(graph, instances, engine) {
  const byId = new Map(instances.map((i) => [i.instanceId, i]));
  const looseSet = new Set(graph.loose || []);
  const moving = []; // { id, body, start }
  const allParts = []; // { id, body, start } including fixed chassis parts when a drop test moves the whole robot
  for (const b of graph.bodies) {
    const isFixed = graph.fixed.includes(b.id) && !(graph.sliders || []).includes(b.id) && !looseSet.has(b.id);
    for (const id of b.parts) {
      const inst = byId.get(id);
      if (!inst) continue;
      const entry = { id, body: b.id, start: startMatrix(inst) };
      allParts.push(entry);
      if (!isFixed) moving.push(entry);
    }
  }
  const trackPartIds = new Set((graph.tracks || []).flatMap((t) => [...t.linkIds, ...t.grippers.map(([g]) => g)]));
  if (graph.ground) {
    for (const id of graph.still || []) {
      if (trackPartIds.has(id)) continue;
      const inst = byId.get(id);
      if (inst) allParts.push({ id, body: graph.ground, start: startMatrix(inst) });
    }
  }
  const fixedOnly = (body) => graph.fixed.includes(body) && !(graph.sliders || []).includes(body) && !looseSet.has(body);
  const tracks = (graph.tracks || [])
    .filter((t) => t.frame && (t.drive || !fixedOnly(t.frame)))
    .map((t) => trackState(t, byId));
  const allTracks = (graph.tracks || []).filter((t) => t.frame).map((t) => trackState(t, byId));
  const throttles = new Map();
  let last = null;
  let wasDropping = false;
  const m = new THREE.Matrix4();
  const link = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  return {
    engine,
    throttles,
    setThrottle(id, value) {
      if (value) throttles.set(id, value);
      else throttles.delete(id);
    },
    setLimitSpeedByLoad(on) {
      engine.setLimitSpeedByLoad?.(on);
    },
    setSimulateGravity(on) {
      engine.setSimulateGravity?.(on);
    },
    drop(heightMeters, landing = 'flat') {
      return engine.drop?.(heightMeters, landing) || null;
    },
    resetDrop() {
      engine.resetDrop?.();
    },
    setDropTimeScale(scale) {
      engine.setDropTimeScale?.(scale);
    },
    dropReport() {
      return engine.dropReport?.() || null;
    },
    frame(meshMap, now = performance.now()) {
      const dt = last === null ? 0 : Math.min(MAX_DT, (now - last) / 1000);
      last = now;
      if (dt > 0) engine.step(dt, throttles);
      const deltas = engine.deltas();
      const partDeltas = engine.partDeltas?.();
      const dropping = Boolean(engine.dropReport?.()?.active);
      const list = dropping || wasDropping || partDeltas ? allParts : moving;
      wasDropping = dropping;
      for (const p of list) {
        const group = meshMap.get(p.id);
        const d = partDeltas?.get(p.id) || deltas.get(p.body);
        if (!group || !d) continue;
        m.multiplyMatrices(d, p.start).decompose(group.position, group.quaternion, group.scale);
      }
      for (const t of dropping ? allTracks : tracks) {
        const frameDelta = deltas.get(t.track.frame) || new THREE.Matrix4();
        if (t.order) {
          // Links per radian of the sprocket's turn against its frame: one link a tooth
          const d = t.track.drive;
          const turn = engine.spin(d.body, d.axis) - engine.spin(t.track.frame, d.axis);
          t.phase += t.dir * turn * dt * (d.teeth / (2 * Math.PI));
        }
        const n = t.order?.length || 0;
        const place = (id, matrix) => {
          const group = meshMap.get(id);
          if (group) m.multiplyMatrices(frameDelta, matrix).decompose(group.position, group.quaternion, group.scale);
        };
        const linkMatrix = new Map();
        for (const [j, id] of (t.order || t.track.linkIds).entries()) {
          if (!t.order) {
            linkMatrix.set(id, t.start.get(id).m);
            place(id, t.start.get(id).m);
            continue;
          }
          const u = (((j + t.phase) % n) + n) % n;
          const i0 = Math.floor(u);
          const a = t.start.get(t.order[i0]);
          const b = t.start.get(t.order[(i0 + 1) % n]);
          q.slerpQuaternions(a.q, b.q, u - i0);
          v.lerpVectors(a.p, b.p, u - i0);
          const matrix = new THREE.Matrix4().compose(v, q, THREE_ONE);
          linkMatrix.set(id, matrix);
          place(id, matrix);
        }
        for (const g of t.grippers) {
          const own = linkMatrix.get(g.link);
          if (!own) continue;
          link.copy(own).multiply(t.start.get(g.link).m.clone().invert()).multiply(t.start.get(g.id).m);
          place(g.id, link);
        }
      }
    },
    status: () => engine.status(),
    dispose: () => engine.dispose?.()
  };
}
