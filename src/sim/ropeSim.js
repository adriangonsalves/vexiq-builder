/**
 * Ropes in Play mode (openspec rope-and-spool, design decisions 8 and 9), shared by the physics
 * (src/sim/physics.js) and the redraw (src/sim/playRunner.js): a rope's elements carried by their
 * bodies' moves, the drum set from the turns on the spool, the path solved, and the drawing.
 */
import * as THREE from 'three';
import { solveBandPath } from '../utils/bandPath.js';
import { windingAt, woundLengthMm } from '../utils/ropePath.js';
import { drawRope } from '../utils/ropeRoute.js';

const v3 = (a) => (a?.isVector3 ? a.clone() : new THREE.Vector3(a[0], a[1], a[2]));
const HANG_PROBE_MM = 1000;

/**
 * The rope's elements now: each carried by `poseOf(bodyId)` ({ q, t } in mm from the start, or null
 * for a body that hasn't moved), the drum at the layer and height `turns` give, a free end's probe
 * straight below the last spot.
 */
export function ropeElementsNow(rope, poseOf, turns, anchor = null) {
  const els = rope.elements.map((e, i) => {
    if (!e.instanceId) return { ...e, center: v3(e.center), axis: v3(e.axis) }; // a free end's probe, set below
    const pose = poseOf(rope.bodies[i]);
    const q = pose?.q || new THREE.Quaternion();
    const t = pose?.t || new THREE.Vector3();
    const out = { ...e, center: v3(e.center).applyQuaternion(q).add(t), axis: v3(e.axis).applyQuaternion(q) };
    if (e.radial) out.radial = v3(e.radial).applyQuaternion(q);
    if (e.wrapDir) out.wrapDir = v3(e.wrapDir).applyQuaternion(q);
    return out;
  });
  if (rope.spool && anchor) {
    // Unwound: the rope runs from where it's tied on the drum (world mm), a point
    const d = els[rope.spool.element];
    els[rope.spool.element] = { ...d, shape: 'point', center: v3(anchor), radius: 0, span: [0, 0], key: `${d.key ?? d.feature ?? 'drum'}|tie` };
  } else if (rope.spool) {
    const w = windingAt(rope.spool.spec, rope.cordMm, turns);
    const d = els[rope.spool.element];
    d.radius = w.radius - rope.cordMm / 2;
    d.span = [w.height, w.height];
  }
  if (rope.free) {
    const last = els[els.length - 2];
    els[els.length - 1].center = v3(last.center).add(new THREE.Vector3(0, -HANG_PROBE_MM, 0));
  }
  return els;
}

/** The rope's path through its elements now (open), or null. */
export const solveRopeNow = (rope, els) => solveBandPath(els, { open: true, turns: rope.turns, thickMm: rope.cordMm, widthMm: rope.cordMm, maxRounds: 40, tolMm: 0.02 });

/** The rope length the path may use: its length less what is wound on the spool. */
export const ropeGiven = (rope, turns) => rope.lengthMm - (rope.spool ? woundLengthMm(rope.spool.spec, rope.cordMm, turns) : 0);

/** The path's length, without a free end's probe run. */
export function ropePathMm(rope, path) {
  if (!rope.free) return path.lengthMm;
  const c = path.contacts;
  return path.lengthMm - v3(c[c.length - 2].b).distanceTo(v3(c[c.length - 1].a));
}

/**
 * The angle (rad) about the spool's axis, in the spool body's own frame, of the point where the rope
 * leaves the drum: from `contact` (world mm) with the spool body's pose { q, t }.
 */
export function leaveAngle(rope, els, contact, spoolPose) {
  const d = els[rope.spool.element];
  const q = spoolPose?.q || new THREE.Quaternion();
  const local = v3(contact).sub(d.center).applyQuaternion(q.clone().invert());
  const axis = v3(rope.elements[rope.spool.element].axis).normalize();
  const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0)).normalize();
  const w = new THREE.Vector3().crossVectors(axis, u);
  return Math.atan2(local.dot(w), local.dot(u));
}

/**
 * The rope drawn now, in the world: its middle line and tabs (drawRope), with the spool's live turns
 * and winding, slack as a sag, a free end hanging by what's left.
 */
export function ropeDrawingNow(rope, els, path, turns, winding, poseOf) {
  const given = ropeGiven(rope, turns);
  const used = ropePathMm(rope, path);
  const left = Math.max(0, given - used);
  const carry = (p, bodyId, vec = false) => {
    const pose = poseOf(bodyId);
    const out = v3(p);
    if (!pose) return out;
    return vec ? out.applyQuaternion(pose.q) : out.applyQuaternion(pose.q).add(pose.t);
  };
  const bodyOfEnd = (k) => (k === 0 ? rope.bodies[0] : rope.bodies[rope.bodies.length - 1]);
  const ends = rope.ends.map((e, k) => (e ? { kind: e.kind, point: carry(e.point, bodyOfEnd(k)), axis: carry(e.axis, bodyOfEnd(k), true), ...(e.slot ? { slot: carry(e.slot, bodyOfEnd(k), true) } : {}) } : null));
  let spool = null;
  if (rope.spool) {
    const end = rope.spool.element === 0 ? 0 : 1;
    const e = rope.ends[end];
    spool = { end, spec: rope.spool.spec, cordMm: rope.cordMm, turns, winding, origin: carry(e.origin, rope.spool.body), axis: carry(e.axis, rope.spool.body, true), pocket: carry(e.point, rope.spool.body) };
  }
  return drawRope({ elements: els, path, hang: rope.free ? left : null, slackMm: rope.free ? 0 : left, spool, ends });
}
