// Per part type, find the local correction L (90-degree turn + grid shift) that best seats the part:
// its holes on fastener/shaft lines and its pegs on other parts' hole lines.
import fs from 'node:fs';
import * as THREE from '/Users/adriangonsalves/projects/vexiq_builder/node_modules/three/build/three.module.js';
const [,, itemsPath, outPath, only] = process.argv;
const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
const cat = JSON.parse(fs.readFileSync('/Users/adriangonsalves/projects/vexiq_builder/public/catalog.json', 'utf8'));
const get = (q) => cat.find((p) => p.partNumber === q || p.name === q);
const deg = THREE.MathUtils.degToRad;
const V = (a) => new THREE.Vector3(...a);
const pose = (it) => new THREE.Matrix4().compose(V(it.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...it.rotation.map(deg), 'XYZ')), new THREE.Vector3(1,1,1));
const isFast = (n) => /Pin|Standoff|Shaft/.test(n) && !/Connector$|Collar/.test(n) || /Standoff Connector/.test(n) && false;
// world lines: male (pin/peg/shaft) and female (holes/bores)
const male = [], female = [];
for (const it of items) {
  const p = get(it.partQuery); if (!p) continue; const M = pose(it);
  for (const q of p.ports || []) {
    const L = { o: V(q.origin).applyMatrix4(M), a: V(q.axis).transformDirection(M), it };
    (q.type === 'pin_peg' ? male : female).push(L);
  }
  if (/Shaft$/.test(p.name) && !/Collar/.test(p.name)) { // shafts: long box axis through the box centre
    const s = V(p.bbox.size); const ax = s.x > s.y && s.x > s.z ? [1,0,0] : s.y > s.z ? [0,1,0] : [0,0,1];
    male.push({ o: V(p.bbox.center).applyMatrix4(M), a: V(ax).transformDirection(M), it });
  }
}
const turns = [];
for (const x of [0,90,180,270]) for (const y of [0,90,180,270]) for (const z of [0,90,180,270]) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(deg(x), deg(y), deg(z)));
  if (!turns.some((t) => Math.abs(t.q.dot(q)) > 0.999)) turns.push({ q, e: [x,y,z], m: new THREE.Matrix4().makeRotationFromQuaternion(q) });
}
const G = 3.175, steps = [-4,-3,-2,-1,0,1,2,3,4].map((k) => k * G);
const on = (o, a, l) => Math.abs(l.a.dot(a)) > 0.98 && o.clone().sub(l.o).cross(l.a).length() < 0.9 && Math.abs(o.clone().sub(l.o).dot(l.a)) < 30;
const groups = new Map(); for (const it of items) { if (!groups.has(it.partQuery)) groups.set(it.partQuery, []); groups.get(it.partQuery).push(it); }
const result = {};
for (const [pq, its] of groups) {
  if (only && !new RegExp(only).test(pq)) continue;
  const p = get(pq); if (!p || /Pin$|Standoff$|Shaft$|Chain Link|Tank Tread|Collar|Spacer|Washer|Extender/.test(p.name)) continue;
  const feats = (p.ports || []).map((q) => ({ o: V(q.origin), a: V(q.axis), peg: q.type === 'pin_peg' }));
  if (!feats.length) continue;
  // candidate lines near each instance, in that instance's old local frame
  const local = its.map((it) => { const inv = pose(it).invert(); const c = V(it.position);
    const pick = (arr) => arr.filter((l) => l.it !== it && l.o.distanceTo(c) < 160).map((l) => ({ o: l.o.clone().applyMatrix4(inv), a: l.a.clone().transformDirection(inv) }));
    return { m: pick(male), f: pick(female) }; });
  const score = (t, s) => { let n = 0; for (const L of local) for (const f of feats) {
      const o = f.o.clone().applyMatrix4(t.m).add(s), a = f.a.clone().transformDirection(t.m);
      if ((f.peg ? L.f : L.m).some((l) => on(o, a, l))) n++; } return n; };
  const base = score(turns[0], V([0,0,0]));
  let best = { n: base, e: [0,0,0], s: [0,0,0] };
  for (const t of turns) for (const x of steps) for (const y of steps) for (const z of steps) {
    const n = score(t, V([x,y,z])); if (n > best.n + 0) best = { n, e: t.e, s: [x,y,z] };
  }
  const total = feats.length * its.length;
  result[pq] = { name: p.name, count: its.length, total, base, best };
  console.log(`${best.n > base ? 'FIX ' : '    '}${p.name.padEnd(50)} x${its.length} feats ${total} seated ${base}${best.n > base ? ` -> ${best.n} turn ${best.e} shift ${best.s.map((v) => v.toFixed(2))}` : ''}`);
}
fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
