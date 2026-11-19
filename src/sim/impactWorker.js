/**
 * Off-main-thread impact solver for the drop test (openspec drop-load-network).
 *
 * `solveImpact` integrates the robot's spring-network impact for ~300–650 ms; running it here the
 * moment Drop is clicked lets it finish in parallel with the robot's freefall so floor contact has
 * no main-thread freeze.
 */
import * as THREE from 'three';
import { solveImpact } from './impact.js';

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const m3 = (e) => new THREE.Matrix3().fromArray(e);

self.onmessage = ({ data }) => {
  const { jobId, model, speed } = data;
  try {
    const hydrated = {
      floorY: model.floorY,
      nodes: model.nodes.map((n) => ({ m: n.m, I: m3(n.I), part: n.part })),
      conns: model.conns.map((c) => ({
        a: c.a,
        b: c.b,
        rA: v3(c.rA),
        rB: v3(c.rB),
        n: v3(c.n),
        e1: v3(c.e1),
        e2: v3(c.e2),
        k: c.k,
        kind: c.kind,
        friction: c.friction,
        joint: c.joint
      })),
      gears: model.gears.map((g) => ({
        a: g.a,
        b: g.b,
        k: g.k,
        ratio: g.ratio,
        axisA: v3(g.axisA),
        axisB: v3(g.axisB)
      })),
      contacts: model.contacts.map((ct) => ({
        node: ct.node,
        k: ct.k,
        r: v3(ct.r),
        y0: ct.y0,
        part: ct.part
      }))
    };
    const result = solveImpact(hydrated, { speed });
    self.postMessage({ jobId, result });
  } catch (err) {
    self.postMessage({ jobId, error: err?.message || String(err) });
  }
};
