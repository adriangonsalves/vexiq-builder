/**
 * Node check for src/utils/chainPath.js (openspec chain-track-builder): which sprockets can carry a
 * chain, the pivot walk, the link count and gap, link and gripper poses and sprocket turns.
 * Run: node scripts/check-chain-builder.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { angleAbout } from '../src/utils/axisFrame.js';
import { CHAIN_PLAY_MM, buildChainPath, chainMessage, checkSprocketsForChain, nextChainName, worldSprocket } from '../src/utils/chainPath.js';
import { areChainNeighbours, isChainFit, isGripperOnLink, isLinkOnSprocket, unsupportedBends } from '../src/utils/chainFit.js';
import { buildChain, explodeInputs } from '../mcp/assembly-engine.mjs';
import { buildPieces } from '../src/utils/explodePlan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
const parts = Array.isArray(catalog) ? catalog : catalog.parts || Object.values(catalog);
const byName = (name) => parts.find((p) => p.name === name);
const metaByPartNumber = (pn) => parts.find((p) => p.partNumber === pn);

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

let n = 0;
const sprocket = (teeth, position, rotation = [0, 0, 0]) => {
  n += 1;
  return { instanceId: `s${n}`, label: `${teeth}T #${n}`, meta: byName(`${teeth} Tooth Sprocket`), position, rotation };
};
const gear = (teeth, position) => ({ instanceId: `g${teeth}${position[0]}`, label: `${teeth} Tooth Gear`, meta: byName(`${teeth} Tooth Gear`), position, rotation: [0, 0, 0] });
const quat = (r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...r.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
const local = (pose, v) => new THREE.Vector3(...v).applyQuaternion(quat(pose.rotation)).add(new THREE.Vector3(...pose.position));

/** Every check a built chain should pass, for the parts it was built from. */
function checkChain(name, input, res) {
  check(`${name}: built`, res.ok, res.error);
  if (!res.ok) return;
  const sprockets = input.filter((p) => res.onLoop.includes(p.instanceId)).map((p) => worldSprocket(p.meta, p.position, p.rotation, p.instanceId));
  const normal = sprockets[0].axis;
  const pivots = res.links.map((l) => local(l, [0, 0, 0]));
  const ends = res.links.map((l) => local(l, [0, 0, -6.35]));
  // No kinks: no link turns more than a tooth step of the smallest sprocket on the loop
  const step = 360 / Math.min(...sprockets.map((sp) => sp.teeth));
  const turns = pivots.map((b, i) => THREE.MathUtils.radToDeg(b.clone().sub(pivots[(i - 1 + pivots.length) % pivots.length]).angleTo(pivots[(i + 1) % pivots.length].clone().sub(b))));
  check(`${name}: no kink sharper than a tooth step (${step.toFixed(1)}°)`, Math.max(...turns) <= step + 0.5, Math.max(...turns).toFixed(1));
  check(`${name}: the fewest whole links that reach round the path`, res.linkCount === res.links.length && res.linkCount === Math.ceil(res.exactLinks - CHAIN_PLAY_MM / 6.35 - 1e-9), `${res.linkCount} vs ${res.exactLinks}`);
  // The loop closes: each link's far pivot is near the next link's roller (eased runs differ a little)
  const worstJoin = Math.max(...ends.map((e, i) => e.distanceTo(pivots[(i + 1) % pivots.length])));
  check(`${name}: the loop closes (link ends meet the next roller)`, worstJoin < 1.0, worstJoin.toFixed(3));
  // Every link in the plane, pivot axis along the axles
  const t0 = sprockets[0].center.dot(normal);
  check(`${name}: every link in the sprockets' plane`, pivots.every((p) => near(p.dot(normal), t0, 0.01)));
  check(
    `${name}: link pivot axes parallel to the axles`,
    res.links.every((l) => Math.abs(new THREE.Vector3(1, 0, 0).applyQuaternion(quat(l.rotation)).dot(normal)) > 0.9999)
  );
  // Pivots on arcs sit on a pitch circle and are one chain pitch apart there
  let onCircle = 0;
  let arcStepsOk = true;
  pivots.forEach((p, i) => {
    const s = sprockets.find((sp) => near(p.distanceTo(sp.center), sp.pitchRadius, 0.005));
    if (!s) return;
    onCircle += 1;
    const next = pivots[(i + 1) % pivots.length];
    if (near(next.distanceTo(s.center), s.pitchRadius, 0.005) && !near(p.distanceTo(next), 6.35, 0.02)) arcStepsOk = false;
  });
  check(`${name}: pivots on each sprocket sit on its pitch circle`, sprockets.every((s) => pivots.some((p) => near(p.distanceTo(s.center), s.pitchRadius, 0.05))) && onCircle > 0);
  check(`${name}: neighbouring pivots on a sprocket are 6.35 mm apart`, arcStepsOk);
  // +Y of every link points out of the loop (away from the loop's centre of sprockets)
  // Inside the loop: the nearest point on a line between two sprocket centres (a run hanging into
  // the loop still has the line below it)
  const spine = (p) => {
    let best = null;
    for (const a of sprockets) {
      for (const c of sprockets) {
        if (a === c) continue;
        const ac = c.center.clone().sub(a.center);
        const t = Math.min(1, Math.max(0, p.clone().sub(a.center).dot(ac) / ac.lengthSq()));
        const q = a.center.clone().addScaledVector(ac, t);
        if (!best || q.distanceTo(p) < best.distanceTo(p)) best = q;
      }
    }
    return best;
  };
  const outward = res.links.every((l, i) => {
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(quat(l.rotation));
    const mid = pivots[i].clone().add(pivots[(i + 1) % pivots.length]).multiplyScalar(0.5);
    const nearest = sprockets.reduce((a, s) => (s.center.distanceTo(mid) < a.center.distanceTo(mid) ? s : a));
    const from = mid.distanceTo(nearest.center) < nearest.pitchRadius + 1 ? nearest.center : spine(mid);
    return y.dot(mid.clone().sub(from)) > 0;
  });
  check(`${name}: every link's outer side faces out of the loop`, outward);
  // Sprocket turns are under half a tooth and leave a gap at a pivot
  const turnsOk = res.sprocketTurns.every((t) => {
    const s = sprockets.find((sp) => sp.instanceId === t.instanceId);
    return Math.abs(t.deg) <= 180 / s.teeth + 1e-6;
  });
  check(`${name}: each sprocket turn is under half a tooth`, turnsOk);
  const gapsOk = sprockets.every((s) => {
    const t = res.sprocketTurns.find((x) => x.instanceId === s.instanceId);
    const gapDir = s.gapDir.clone().applyAxisAngle(s.axis, THREE.MathUtils.degToRad(t ? t.deg : 0));
    return pivots.some((p) => {
      if (!near(p.distanceTo(s.center), s.pitchRadius, 0.05)) return false;
      const diff = angleAbout(s.axis, p.clone().sub(s.center)) - angleAbout(s.axis, gapDir);
      const period = 360 / s.teeth;
      const w = ((diff % period) + period) % period;
      return w < 0.05 || period - w < 0.05;
    });
  });
  check(`${name}: after turning, every sprocket has a tooth gap at a chain pivot`, gapsOk);
  check(`${name}: never more than ${CHAIN_PLAY_MM} mm short of the path, at most a link longer`, res.gapMm <= CHAIN_PLAY_MM + 1e-6 && res.gapMm > -6.35, String(res.gapMm));
}

// --- Which sprockets can carry a chain --------------------------------------------------------
{
  check('two sprockets in one plane: ok', checkSprocketsForChain([sprocket(16, [0, 0, 0]), sprocket(32, [80, 0, 0])]).ok);
  const one = checkSprocketsForChain([sprocket(16, [0, 0, 0])]);
  check('one sprocket: refused, asks for two or more', !one.ok && /two or more sprockets/.test(one.error), one.error);
  const gears = checkSprocketsForChain([gear(36, [0, 0, 0]), gear(36, [60, 0, 0])]);
  check('two spur gears: refused, chain fits sprockets', !gears.ok && /sprockets, not gears/.test(gears.error), gears.error);
  const offPlane = checkSprocketsForChain([sprocket(16, [0, 0, 0]), sprocket(16, [80, 0, 6])]);
  check('a sprocket 6 mm along its axle: refused, not in one plane', !offPlane.ok && /one plane/.test(offPlane.error), offPlane.error);
  const tilted = checkSprocketsForChain([sprocket(16, [0, 0, 0]), sprocket(16, [80, 0, 0], [10, 0, 0])]);
  check('axles 10° apart: refused', !tilted.ok && /parallel/.test(tilted.error), tilted.error);
  const overlap = checkSprocketsForChain([sprocket(32, [0, 0, 0]), sprocket(32, [50, 0, 0])]);
  check('overlapping sprockets: refused', !overlap.ok && /overlap/.test(overlap.error), overlap.error);
  const row = [sprocket(32, [0, 0, 0]), sprocket(8, [60, 0, 0]), sprocket(32, [120, 0, 0])];
  const inside = checkSprocketsForChain(row);
  check('a small sprocket inside the loop is left out', inside.ok && inside.sprockets.length === 2 && inside.leftOut.map((s) => s.instanceId).join() === row[1].instanceId);
  const mixed = checkSprocketsForChain([sprocket(16, [0, 0, 0]), sprocket(16, [80, 0, 0]), gear(36, [0, 60, 0])]);
  check('a gear in the selection is ignored', mixed.ok && mixed.all.length === 2);
  // Sprockets with their axles along the opposite way still share a plane
  const flipped = checkSprocketsForChain([sprocket(16, [0, 0, 0]), sprocket(24, [80, 0, 0], [180, 0, 0])]);
  check('a sprocket turned over (axle the other way) still counts', flipped.ok, flipped.error);
}

// --- Pivot walk, count and gap ----------------------------------------------------------------
{
  const pair = [sprocket(16, [0, 0, 0]), sprocket(16, [101.6, 0, 0])];
  const res = buildChainPath(pair, { kind: 'chain', metaByPartNumber });
  check('two 16T sprockets 101.6 mm apart: exactly 48 links', res.ok && res.linkCount === 48, String(res.linkCount));
  check('  and no gap', res.ok && Math.abs(res.gapMm) < 0.01 && !res.moveHint, String(res.gapMm));
  check('  message says exact fit', /Chain builder: 48 Chain Links round 2 sprockets\. Exact fit\./.test(chainMessage(res)), chainMessage(res));
  checkChain('16T + 16T', pair, res);
  check('  every straight link is exactly 6.35 mm', res.links.every((l, i) => local(l, [0, 0, -6.35]).distanceTo(local(res.links[(i + 1) % 48], [0, 0, 0])) < 0.01));
}
{
  // 3 mm more path than 48 links: a real chain can't stretch, so it takes 49 and is 3.35 mm slack
  const pair = [sprocket(16, [0, 0, 0]), sprocket(16, [103.1, 0, 0])];
  const res = buildChainPath(pair, { kind: 'chain', metaByPartNumber });
  check('3 mm longer path: 49 links, never a too-tight 48', res.ok && res.linkCount === 49 && near(res.gapMm, -3.35, 0.01), `${res.linkCount} ${res.gapMm}`);
  check('  suggests moving a sprocket about 1.7 mm away for an exact fit', res.moveHint && near(res.moveHint.mm, -1.675, 0.05), JSON.stringify(res.moveHint));
  const text = chainMessage(res);
  check('  message names the slack, the move and the sag', /3\.4 mm longer than the path/.test(text) && /about 1\.7 mm away from/.test(text) && /sag a little/.test(text), text);
  checkChain('16T + 16T, 3 mm long', pair, res);
}
{
  // 0.3 mm more path than 48 links: within the chain's play, so 48 links
  const pair = [sprocket(16, [0, 0, 0]), sprocket(16, [101.75, 0, 0])];
  const res = buildChainPath(pair, { kind: 'chain', metaByPartNumber });
  check('0.3 mm longer path: 48 links (the chain\'s play takes it up)', res.ok && res.linkCount === 48 && near(res.gapMm, 0.3, 0.01) && !/sag/.test(chainMessage(res)), `${res.linkCount} ${res.gapMm}`);
}
{
  // A slack chain hangs: the bottom run sags toward the floor on a smooth curve, the top run stays
  // straight, and no join bends more than a tooth step (22.5° on a 16T)
  const pair = [sprocket(16, [0, 0, 0]), sprocket(16, [103.1, 0, 0])];
  const res = buildChainPath(pair, { kind: 'chain', metaByPartNumber });
  const P = res.links.map((l) => new THREE.Vector3(...l.position));
  const bend = (i) => {
    const [a, b, c] = [P[(i - 1 + P.length) % P.length], P[i], P[(i + 1) % P.length]];
    return THREE.MathUtils.radToDeg(b.clone().sub(a).angleTo(c.clone().sub(b)));
  };
  const bends = P.map((_, i) => bend(i));
  const between = (p) => p.x > 1 && p.x < 102;
  const top = P.filter((p) => between(p) && p.y > 0);
  const bottom = P.filter((p) => between(p) && p.y < 0);
  check('slack chain: no kink sharper than a tooth step', Math.max(...bends) <= 22.5 + 0.5, Math.max(...bends).toFixed(1));
  check('  the top run is straight and tight', top.every((p) => near(p.y, 16.27, 0.05)), top.map((p) => p.y.toFixed(2)).join(' '));
  check('  the bottom run hangs below the sprockets, lowest near the middle', Math.min(...bottom.map((p) => p.y)) < -16.27 - 3 && Math.abs(bottom.reduce((m, p) => (p.y < m.y ? p : m)).x - 51.55) < 10, bottom.map((p) => p.y.toFixed(1)).join(' '));
  const runBends = P.map((p, i) => [p, bends[i]]).filter(([p]) => between(p) && p.y < -16.5).map(([, b]) => b);
  check('  and bends a little at every link of the sag, not in one place', runBends.every((b) => b > 0.5 && b < 8), runBends.map((b) => b.toFixed(1)).join(' '));
}
{
  // Slack on the upper run: it hangs down into the loop, the bottom run stays straight, and the
  // chain leaves and meets the sprockets without sinking into their teeth
  const pair = [sprocket(16, [0, 0, 0]), sprocket(16, [103.1, 0, 0])];
  const res = buildChainPath(pair, { kind: 'chain', slack: 'upper', metaByPartNumber });
  check('slack chain offers the upper/lower choice', res.ok && res.slackChoice === true && res.slack === 'upper');
  checkChain('16T + 16T, slack on the upper run', pair, res);
  const P = res.links.map((l) => new THREE.Vector3(...l.position));
  const between = (p) => p.x > 1 && p.x < 102;
  const top = P.filter((p) => between(p) && p.y > 0);
  const bottom = P.filter((p) => between(p) && p.y < 0);
  check('  the bottom run is straight and tight', bottom.every((p) => near(p.y, -16.27, 0.05)), bottom.map((p) => p.y.toFixed(2)).join(' '));
  check('  the top run hangs down into the loop, lowest near the middle', Math.min(...top.map((p) => p.y)) < 16.27 - 3 && Math.abs(top.reduce((m, p) => (p.y < m.y ? p : m)).x - 51.55) < 10, top.map((p) => p.y.toFixed(1)).join(' '));
  const deepest = Math.min(...P.map((p) => Math.min(p.distanceTo(new THREE.Vector3(0, 0, 0)), p.distanceTo(new THREE.Vector3(103.1, 0, 0))) - 16.27));
  check('  no link sinks into a sprocket\'s teeth', deepest > -0.3, deepest.toFixed(2));
  const flat = [sprocket(16, [0, 0, 0], [90, 0, 0]), sprocket(16, [103.1, 0, 0], [90, 0, 0])];
  const lying = buildChainPath(flat, { kind: 'chain', slack: 'upper', metaByPartNumber });
  check('sprockets lying flat: no upper/lower choice', lying.ok && lying.slackChoice === false && lying.slack === null);
  const snug = buildChainPath([sprocket(16, [0, 0, 0]), sprocket(16, [101.6, 0, 0])], { kind: 'chain', metaByPartNumber });
  check('an exact fit: no choice to make', snug.ok && snug.slackChoice === false);
}
{
  // A tilted triangle (a real build): runs straight, every join no sharper than its sprocket's tooth step
  const tri = [sprocket(16, [30.42, 0.005, 176.405], [0, 30, 4.26]), sprocket(40, [123.92, 6.355, 122.786], [0, 30, 1.56]), sprocket(24, [63.414, 31.755, 157.72], [0, 30, -7.44])];
  const res = buildChainPath(tri, { kind: 'chain', metaByPartNumber });
  check('tilted triangle 0.55 mm longer than 65 links: 65 links (within the 0.75 mm play)', res.ok && res.linkCount === 65 && near(res.gapMm, 0.55, 0.05), `${res.linkCount} ${res.gapMm}`);
  checkChain('tilted triangle', tri, res);
  const P = res.links.map((l) => new THREE.Vector3(...l.position));
  const worst = Math.max(...P.map((b, i) => THREE.MathUtils.radToDeg(b.clone().sub(P[(i - 1 + P.length) % P.length]).angleTo(P[(i + 1) % P.length].clone().sub(b)))));
  check('  no join sharper than a tooth step on the 16T', worst <= 22.5 + 0.5, worst.toFixed(1));
}
{
  const pair = [sprocket(8, [0, 0, 0]), sprocket(24, [70, 20, 0])];
  checkChain('8T + 24T', pair, buildChainPath(pair, { kind: 'chain', metaByPartNumber }));
}
{
  const tri = [sprocket(16, [0, 0, 0]), sprocket(24, [90, 0, 0]), sprocket(32, [40, 75, 0])];
  const res = buildChainPath(tri, { kind: 'chain', metaByPartNumber });
  checkChain('three sprockets in a triangle', tri, res);
  check('  all three are on the loop', res.ok && res.onLoop.length === 3);
  const worst = Math.max(...res.links.map((l, i) => Math.abs(new THREE.Vector3(...l.position).distanceTo(new THREE.Vector3(...res.links[(i + 1) % res.links.length].position)) - 6.35)));
  check('  the leftover is spread over the runs (every link within 0.15 mm of the pitch)', worst < 0.15, worst.toFixed(3));
}
{
  // A tilted plane: axles along (0, 1, 1)
  const r = [45, 0, 0];
  const s1 = sprocket(24, [0, 0, 0], r);
  const s2 = sprocket(40, [100, 0, 0], r);
  checkChain('24T + 40T on tilted axles', [s1, s2], buildChainPath([s1, s2], { kind: 'chain', metaByPartNumber }));
}
{
  const row = [sprocket(32, [0, 0, 0]), sprocket(8, [60, 0, 0]), sprocket(32, [120, 0, 0])];
  const res = buildChainPath(row, { kind: 'chain', metaByPartNumber });
  check('the left-out sprocket is named in the message', res.ok && /Not touched by the chain: 8T #/.test(chainMessage(res)), chainMessage(res));
}

// --- Track and grippers -----------------------------------------------------------------------
{
  const pair = [sprocket(24, [0, 0, 0]), sprocket(24, [120, 0, 0])];
  const res = buildChainPath(pair, { kind: 'track', grippers: true, metaByPartNumber });
  checkChain('24T + 24T track', pair, res);
  check('track uses tread links', res.ok && res.links.every((l) => l.partId === metaByPartNumber('228-2500-231').id));
  check('one gripper per tread link', res.ok && res.grippers.length === res.links.length);
  const seat = metaByPartNumber('228-2500-239').chainSpecs.seatInLink;
  check(
    'each gripper sits at its seat in its link, same turn',
    res.ok && res.grippers.every((g, i) => local(res.links[i], seat).distanceTo(new THREE.Vector3(...g.position)) < 0.01 && g.rotation.join() === res.links[i].rotation.join())
  );
  // The gripper's pad (its +Y) faces out of the loop like the link's
  check('each gripper pad faces out like its link', res.ok && res.grippers.every((g, i) => g.rotation.join() === res.links[i].rotation.join()));
  check('message counts grippers', /Track builder: \d+ tread links and \d+ grippers round 2 sprockets/.test(chainMessage(res)), chainMessage(res));
  const plain = buildChainPath(pair, { kind: 'track', grippers: false, metaByPartNumber });
  check('track without grippers: tread links only', plain.ok && plain.grippers.length === 0 && plain.linkCount === res.linkCount);
}

// --- Random layouts ---------------------------------------------------------------------------
{
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const sizes = [8, 16, 24, 32, 40];
  let built = 0;
  let worstSpacing = 0;
  let worstJoin = 0;
  let worstGap = 0;
  let tightest = -Infinity;
  const failed = [];
  for (let t = 0; t < 60; t++) {
    const count = 2 + Math.floor(rand() * 3);
    const set = [];
    for (let tries = 0; set.length < count && tries < 200; tries++) {
      const teeth = sizes[Math.floor(rand() * sizes.length)];
      const cand = sprocket(teeth, [rand() * 200 - 100, rand() * 200 - 100, 0]);
      const r = cand.meta.gearSpecs.tipRadiusMm;
      if (set.every((o) => Math.hypot(o.position[0] - cand.position[0], o.position[1] - cand.position[1]) > r + o.meta.gearSpecs.tipRadiusMm + 8)) set.push(cand);
    }
    const res = buildChainPath(set, { kind: 'chain', metaByPartNumber });
    if (!res.ok) {
      failed.push(`${set.map((x) => `${x.meta.gearSpecs.teeth}@${x.position.slice(0, 2).map((v) => v.toFixed(0))}`).join(' ')}: ${res.error}`);
      continue;
    }
    built += 1;
    const pv = res.links.map((l) => new THREE.Vector3(...l.position));
    pv.forEach((p, i) => (worstSpacing = Math.max(worstSpacing, Math.abs(p.distanceTo(pv[(i + 1) % pv.length]) - 6.35))));
    res.links.forEach((l, i) => (worstJoin = Math.max(worstJoin, local(l, [0, 0, -6.35]).distanceTo(pv[(i + 1) % pv.length]))));
    worstGap = Math.max(worstGap, Math.abs(res.gapMm));
    tightest = Math.max(tightest, res.gapMm);
  }
  check('60 random layouts of 2-4 sprockets all build', failed.length === 0, failed.slice(0, 3).join(' | '));
  check('  every link within 0.3 mm of the chain pitch', worstSpacing < 0.3, worstSpacing.toFixed(3));
  check('  every link end meets the next roller within 0.3 mm', worstJoin < 0.3, worstJoin.toFixed(3));
  check('  never too tight, at most a link slack', worstGap < 6.35 && tightest <= CHAIN_PLAY_MM + 1e-6, `${worstGap.toFixed(3)} / tightest ${tightest.toFixed(3)}`);
  console.log(`      (${built} built, worst spacing ${worstSpacing.toFixed(3)} mm, worst gap ${worstGap.toFixed(2)} mm)`);
}

// --- Fit rules (overlaps and audit) -------------------------------------------------------------
{
  const matrixOf = (pose) => new THREE.Matrix4().compose(new THREE.Vector3(...pose.position), quat(pose.rotation), new THREE.Vector3(1, 1, 1));
  const meta = (id) => parts.find((p) => p.id === id);
  const pair = [sprocket(24, [0, 0, 0]), sprocket(24, [120, 0, 0])];
  const res = buildChainPath(pair, { kind: 'track', grippers: true, metaByPartNumber });
  const links = res.links.map((l, i) => ({ id: `L${i}`, part: meta(l.partId), matrix: matrixOf(l) }));
  const grips = res.grippers.map((g) => ({ part: meta(g.partId), matrix: matrixOf(g) }));
  const sp = pair.map((p) => ({ part: p.meta, matrix: matrixOf(p) }));
  check('neighbouring links share a pivot', areChainNeighbours(links[0].part, links[0].matrix, links[1].part, links[1].matrix));
  check('links two apart are not neighbours', !areChainNeighbours(links[0].part, links[0].matrix, links[2].part, links[2].matrix));
  const onS = links.filter((l) => sp.some((s) => isLinkOnSprocket(l.part, l.matrix, s.part, s.matrix))).length;
  check('links round the sprockets sit on them (and only those)', onS > 10 && onS < links.length, `${onS} of ${links.length}`);
  check('each gripper is plugged into its own tread link', grips.every((g, i) => isGripperOnLink(g.part, g.matrix, links[i].part, links[i].matrix)));
  check('a gripper is not on another link', !isGripperOnLink(grips[0].part, grips[0].matrix, links[5].part, links[5].matrix));
  check('chain fit: gripper with the next link and next gripper', isChainFit(grips[0].part, grips[0].matrix, links[1].part, links[1].matrix) && isChainFit(grips[0].part, grips[0].matrix, grips[1].part, grips[1].matrix));
  check('chain fit: a link with a far link is no fit', !isChainFit(links[0].part, links[0].matrix, links[9].part, links[9].matrix));
  check('chain fit: a sprocket with an unrelated part is no fit', !isChainFit(sp[0].part, sp[0].matrix, sp[1].part, sp[1].matrix));
  check('a built chain has no bends away from a sprocket', unsupportedBends(links, sp).size === 0);
  // A link leaving a sprocket rides up the next tooth: lifted 1.5 mm it still fits; pushed 2 mm into the teeth it doesn't
  {
    // A link in the middle of the wrap: it and both neighbours sit on the sprocket
    const on = (l) => isLinkOnSprocket(l.part, l.matrix, sp[0].part, sp[0].matrix);
    const onArc = links.find((l, i) => on(l) && on(links[(i + 1) % links.length]) && on(links[(i - 1 + links.length) % links.length]));
    const centre = new THREE.Vector3().setFromMatrixPosition(sp[0].matrix);
    const pivot = new THREE.Vector3().setFromMatrixPosition(onArc.matrix);
    const out = pivot.clone().sub(centre).setZ(0).normalize();
    const shifted = (mm) => onArc.matrix.clone().setPosition(pivot.clone().addScaledVector(out, mm));
    check('a link lifted 1.5 mm off the teeth (leaving the sprocket) is no collision', isChainFit(onArc.part, shifted(1.5), sp[0].part, sp[0].matrix));
    check('  but it isn\'t counted as seated', !isLinkOnSprocket(onArc.part, shifted(1.5), sp[0].part, sp[0].matrix));
    check('a link pushed 2 mm into the teeth is a collision', !isChainFit(onArc.part, shifted(-2), sp[0].part, sp[0].matrix));
  }

  const moved = [sp[0], { part: sp[1].part, matrix: matrixOf({ position: [140, 0, 0], rotation: [0, 0, 0] }) }];
  check('after a sprocket moves 20 mm, the links that bent round it are flagged', unsupportedBends(links, moved).size > 5, String(unsupportedBends(links, moved).size));
}

// --- Names ------------------------------------------------------------------------------------
{
  const inst = [{ groupName: 'Chain 1' }, { groupName: 'Chain 3' }, { groupName: 'Track 1' }, { groupName: 'Group 2' }];
  check('next chain name skips used numbers', nextChainName(inst, 'chain') === 'Chain 2' && nextChainName(inst, 'track') === 'Track 2');
}

// --- Explode keeps a chain or track in one piece ----------------------------------------------
{
  const inst = (instanceId, name, position) => ({ instanceId, partId: byName(name).id, label: instanceId, position, rotation: [0, 0, 0], visible: true });
  const state = { instances: [inst('S16', '16 Tooth Sprocket', [0, 0, 0]), inst('S32', '32 Tooth Sprocket', [101.6, 0, 0])], selectedIds: [] };
  const built = buildChain(state, { kind: 'track', instanceIds: ['S16', 'S32'] });
  check('explode: a track is built for the check', !built.error, built.error);
  if (!built.error) {
    // Ungrouped, so only the chain joins can hold it together
    const instances = built.instances.map((i) => ({ ...i, groupId: undefined, groupName: undefined }));
    const input = explodeInputs({ ...state, instances });
    const { pieceOf } = buildPieces({ ...input, parts: input.parts.map((p) => ({ ...p, worldBox: null })) });
    const trackPieces = new Set(built.newIds.map((id) => pieceOf.get(id)));
    check(
      'explode: an ungrouped track\'s links and grippers stay one piece, apart from its sprockets',
      trackPieces.size === 1 && !trackPieces.has(pieceOf.get('S16')) && !trackPieces.has(pieceOf.get('S32')),
      `${trackPieces.size} pieces`
    );
  }
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
