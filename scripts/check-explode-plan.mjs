/**
 * Node check for src/utils/explodePlan.js (openspec explode-view) on the Clawbot starter
 * (src/starters.js): pieces, slide directions, the slider timeline and no overlaps at any slider
 * value, for All and each axis. A fixed build, so the check doesn't depend on what the app has open.
 * Run: node scripts/check-explode-plan.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { ROOT_DIR, checkCandidateCollision, explodeInputs, explodePlanFor, getCatalog } from '../mcp/assembly-engine.mjs';
import { EXPLODE_GAP_MM, buildPieces, explodedOffsets } from '../src/utils/explodePlan.js';
import { batteryBayPose } from '../src/utils/batteryBay.js';
import { buildWorldMatrix } from '../mcp/assembly-engine.mjs';
import { starterById } from '../src/starters.js';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'catalog.json'), 'utf8'));
const state = { instances: starterById('clawbot').build(catalog) };
const { catalogById } = getCatalog();
const instances = state.instances.filter((i) => i.visible !== false);
const label = new Map(instances.map((i) => [i.instanceId, i.label]));
const byId = new Map(instances.map((i) => [i.instanceId, i]));
const partOf = (id) => catalogById.get(byId.get(id).partId);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const parallel = (a, b) => Math.abs(dot(a, b)) >= Math.cos(THREE.MathUtils.degToRad(2));

// --- 1. Pieces ----------------------------------------------------------------------------------
const input = explodeInputs(state);
{
  const { pieces, pieceOf, base } = buildPieces(input);
  const brain = instances.find((i) => /robot brain/i.test(partOf(i.instanceId).name));
  check('pieces: the base holds the brain', pieceOf.get(brain.instanceId) === base);
  const pins = input.parts.filter((p) => p.kind === 'pin');
  const lonePins = pins.filter((p) => pieces.get(pieceOf.get(p.id)).members.length === 1);
  check('pieces: no seated pin is a piece of its own', lonePins.length === 0, lonePins.map((p) => p.label).join(', '));
  const shafts = input.parts.filter((p) => p.kind === 'shaft');
  check(
    'pieces: every shaft is a piece of its own',
    shafts.every((p) => pieces.get(pieceOf.get(p.id)).members.length === 1),
    shafts.filter((p) => pieces.get(pieceOf.get(p.id)).members.length > 1).map((p) => p.label).join(', ')
  );
  // A 1x1 pin half in each of two parts goes with the larger one; one deeper in a part stays in it
  const tires = input.tires.every(([tire, hub]) => pieceOf.get(tire) === pieceOf.get(hub));
  check('pieces: a tire is in its hub\'s piece', input.tires.length > 0 && tires);

  // A group of five parts becomes one piece
  const ids = ['Claw Tip L', 'Claw Tip R', 'Claw 1x4 Beam L', 'Claw 1x4 Beam R', 'Traction Link #3'].map((n) => instances.find((i) => i.label === n)?.instanceId);
  const grouped = { ...state, instances: state.instances.map((i) => (ids.includes(i.instanceId) ? { ...i, groupId: 'g-check', groupName: 'Claw tips' } : i)) };
  const g = buildPieces(explodeInputs(grouped));
  check('pieces: a group of five parts is one piece', ids.every(Boolean) && new Set(ids.map((id) => g.pieceOf.get(id))).size === 1);
}

// --- 2-5. Plans for each direction choice -------------------------------------------------------
const plans = {};
for (const mode of ['all', 'x', 'y', 'z']) {
  const t0 = Date.now();
  plans[mode] = explodePlanFor(state, mode);
  const plan = plans[mode];
  const moved = [...explodedOffsets(plan, 1).values()].filter((o) => len(o) > 1).length;
  console.log(`INFO  ${mode}: ${Date.now() - t0} ms, ${plan.pieces.length - 1} moving pieces, ${moved} of ${instances.length} parts moved`);
  check(`${mode}: no overlaps left at any 1% step (plan's own check)`, plan.unplaced.length === 0, JSON.stringify(plan.unplaced.slice(0, 5)));

  const at0 = explodedOffsets(plan, 0);
  check(`${mode}: at 0% every part is where it was built`, [...at0.values()].every((o) => len(o) < 1e-9));
  const a = explodedOffsets(plan, 0.37);
  const b = explodedOffsets(plan, 0.37);
  check(`${mode}: the same slider value gives the same positions`, [...a].every(([id, o]) => len(sub(o, b.get(id))) === 0));

  const byPiece = new Map(plan.pieces.map((p) => [p.id, p]));
  const early = plan.pieces.filter((p) => p.parent && p.parent !== plan.base && p.start < byPiece.get(p.parent).start - 1e-9);
  check(`${mode}: no piece starts before its holder`, early.length === 0, early.map((p) => label.get(p.members[0])).join(', '));

  if (mode !== 'all') {
    const k = { x: 0, y: 1, z: 2 }[mode];
    const off = [...explodedOffsets(plan, 1)].filter(([, o]) => o.some((v, i) => i !== k && Math.abs(v) > 1e-6));
    check(`${mode}: every part that moved moved only along ${mode.toUpperCase()}`, off.length === 0, off.slice(0, 3).map(([id]) => label.get(id)).join(', '));
  } else {
    // Each slide is along a pin or shaft axis of the piece, or a main axis
    const axesOf = new Map();
    for (const pr of input.pairs) for (const id of [pr.insertOwner, pr.openingOwner]) (axesOf.get(id) || axesOf.set(id, []).get(id)).push(pr.axis);
    const odd = plan.pieces.filter(
      (p) => p.dir && !p.members.some((m) => (axesOf.get(m) || []).some((ax) => parallel(ax, p.dir))) && ![[1, 0, 0], [0, 1, 0], [0, 0, 1]].some((ax) => parallel(ax, p.dir))
    );
    check('all: every slide is along a pin or shaft axis, or a main axis', odd.length === 0, odd.map((p) => label.get(p.members[0])).join(', '));
    const alongPins = plan.pieces.filter((p) => p.dir && p.members.some((m) => (axesOf.get(m) || []).some((ax) => parallel(ax, p.dir)))).length;
    console.log(`INFO  all: ${alongPins} of ${plan.pieces.length - 1} slides follow a pin or shaft axis`);
  }

  // A shaft's stop ring never passes the hole it can't go through
  const pieceOf = new Map();
  for (const p of plan.pieces) for (const m of p.members) pieceOf.set(m, p.id);
  const end = explodedOffsets(plan, 1);
  const ringBad = input.pairs.filter((pr) => {
    if (!pr.blocks || pieceOf.get(pr.insertOwner) === pieceOf.get(pr.openingOwner)) return false;
    const rel = sub(end.get(pr.insertOwner) || [0, 0, 0], end.get(pr.openingOwner) || [0, 0, 0]);
    const along = dot(rel, pr.axis);
    const lateral = len(sub(rel, pr.axis.map((v) => v * along)));
    if (lateral > 1) return false; // came apart sideways first
    return (along > 1 && pr.blocks.plus) || (along < -1 && pr.blocks.minus);
  });
  check(`${mode}: no shaft's stop ring passes a hole it can't`, ringBad.length === 0, ringBad.map((pr) => `${label.get(pr.insertOwner)} in ${label.get(pr.openingOwner)}`).join(', '));
}

// --- Wheel stacks spread along their shaft, in order ------------------------------------------
{
  const plan = plans.all;
  const end = explodedOffsets(plan, 1);
  const pieceOf = new Map();
  for (const p of plan.pieces) for (const m of p.members) pieceOf.set(m, p);
  let stacks = 0;
  let bad = [];
  for (const shaft of input.parts.filter((p) => p.kind === 'shaft')) {
    const axis = input.pairs.find((pr) => pr.insertOwner === shaft.id)?.axis;
    if (!axis) continue;
    // Pieces on this shaft that slid along it
    const on = [...new Set(input.pairs.filter((pr) => pr.insertOwner === shaft.id).map((pr) => pieceOf.get(pr.openingOwner)))].filter(
      (p) => p && p !== pieceOf.get(shaft.id) && p.dir && parallel(p.dir, axis)
    );
    const groups = new Map(); // same way out -> pieces
    for (const p of on) {
      const key = Math.sign(dot(p.dir, axis));
      (groups.get(key) || groups.set(key, []).get(key)).push(p);
    }
    for (const [sign, list] of groups) {
      if (list.length < 2) continue;
      stacks += 1;
      const d = axis.map((v) => v * sign);
      const range = (p, offset) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const m of p.members) {
          const box = input.parts.find((q) => q.id === m).box;
          for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) {
            const v = dot([x + offset[0], y + offset[1], z + offset[2]], d);
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
        return [lo, hi];
      };
      // Two pieces still in line at the end: their boxes overlap across the shaft (one lifted clear
      // of the other first doesn't count)
      const boxAt = (p) => {
        const o = end.get(p.members[0]);
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];
        for (const m of p.members) {
          const box = input.parts.find((q) => q.id === m).box;
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], box.min[k] + o[k]);
            hi[k] = Math.max(hi[k], box.max[k] + o[k]);
          }
        }
        return { lo, hi };
      };
      const k = axis.map(Math.abs).indexOf(Math.max(...axis.map(Math.abs)));
      const inLine = (p, q) => {
        const [a, b] = [boxAt(p), boxAt(q)];
        return [0, 1, 2].every((i) => i === k || (a.lo[i] < b.hi[i] && b.lo[i] < a.hi[i]));
      };
      const sorted = list.slice().sort((p, q) => range(p, [0, 0, 0])[0] - range(q, [0, 0, 0])[0]);
      for (let i = 1; i < sorted.length; i++) {
        if (!inLine(sorted[i - 1], sorted[i])) continue;
        const [, hiPrev] = range(sorted[i - 1], end.get(sorted[i - 1].members[0]));
        const [lo] = range(sorted[i], end.get(sorted[i].members[0]));
        if (lo < hiPrev - 0.5) bad.push(`${label.get(sorted[i - 1].members[0])} / ${label.get(sorted[i].members[0])}`);
      }
    }
  }
  console.log(`INFO  all: ${stacks} stack(s) of pieces sliding off one shaft the same way`);
  check('all: pieces sliding off a shaft the same way keep their order along it', bad.length === 0, bad.join(', '));
  void EXPLODE_GAP_MM;
}

// --- Independent overlap check with the engine's collision test (every 5%) ----------------------
for (const mode of ['all', 'y']) {
  const plan = plans[mode];
  const builtHits = new Set();
  // Pairs touching when built, tight fits included: sliding apart may press a tight fit a little deeper
  for (const inst of instances) {
    const col = checkCandidateCollision(inst, instances);
    for (const c of [...col.collidingWith, ...col.tightFits]) builtHits.add(`${inst.instanceId}|${c.instanceId}`);
  }
  const hits = [];
  for (let i = 1; i <= 20 && hits.length < 5; i++) {
    const t = i / 20;
    const off = explodedOffsets(plan, t);
    const moved = instances.map((inst) => {
      const o = off.get(inst.instanceId) || [0, 0, 0];
      return { ...inst, position: inst.position.map((v, k) => v + o[k]) };
    });
    for (const inst of moved) {
      if (len(off.get(inst.instanceId) || [0, 0, 0]) < 1e-6) continue;
      for (const c of checkCandidateCollision(inst, moved).collidingWith) {
        if (!builtHits.has(`${inst.instanceId}|${c.instanceId}`)) hits.push(`${label.get(inst.instanceId)} / ${c.label} at ${Math.round(t * 100)}%`);
      }
    }
  }
  check(`${mode}: the engine's own collision test finds no new overlaps every 5%`, hits.length === 0, hits.slice(0, 5).join('; '));
}

// --- Battery slides out of its bay --------------------------------------------------------------
{
  const brainPart = [...catalogById.values()].find((p) => p.partNumber === '228-2540');
  const batteryPart = [...catalogById.values()].find((p) => p.partNumber === '228-2604');
  const brain = { instanceId: 'b-brain', partId: brainPart.id, label: 'Brain', position: [0, 60, 0], rotation: [0, 0, 0] };
  const pose = batteryBayPose(batteryPart, brainPart, buildWorldMatrix(brain.position, brain.rotation));
  const battery = { instanceId: 'b-battery', partId: batteryPart.id, label: 'Battery', ...pose };
  const plan = explodePlanFor({ instances: [brain, battery] }, 'all');
  const off = explodedOffsets(plan, 1).get('b-battery') || [0, 0, 0];
  const brainAxes = [0, 1, 2].map((k) => new THREE.Vector3().setFromMatrixColumn(buildWorldMatrix(brain.position, brain.rotation), k).toArray());
  check(
    'battery: slides out of the bay along one of the brain\'s axes',
    len(off) > 10 && brainAxes.some((ax) => parallel(ax, off.map((v) => v / len(off)))) && plan.unplaced.length === 0,
    `offset ${off.map((v) => v.toFixed(1)).join(', ')}`
  );
}

if (failures) {
  console.log(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll explode-plan checks passed.');
