// onpins.mjs <asm> <restoreLabel>: candidate poses putting the part's 2x2 hole square (hole_4..7) on the nearest 4 parallel pins
import fs from 'node:fs';
import * as THREE from '/Users/adriangonsalves/projects/vexiq_builder/node_modules/three/build/three.module.js';
const [,, asmPath, label] = process.argv;
const asm = JSON.parse(fs.readFileSync(asmPath, 'utf8')); const r = JSON.parse(fs.readFileSync('restore.json', 'utf8')).parts.find((p) => p.label === label);
const cat = JSON.parse(fs.readFileSync('/Users/adriangonsalves/projects/vexiq_builder/public/catalog.json', 'utf8'));
const deg = THREE.MathUtils.degToRad, V = (a) => new THREE.Vector3(...a);
const quat = (rot) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map(deg), 'XYZ'));
const p = cat.find((x) => x.partNumber === r.partQuery); const sq = p.ports.filter((q) => /^hole_[4567]$/.test(q.portId));
const sqc = sq.reduce((s, q) => s.add(V(q.origin)), V([0,0,0])).multiplyScalar(0.25); const sqAxis = V(sq[0].axis);
const c0 = V(r.position).add(V(p.bbox.center).applyQuaternion(quat(r.rotation)));
const all = asm.instances.filter((i) => /228-2500-060-/.test(i.label)).map((i) => ({ i, o: V(i.position), a: V([0,0,1]).applyQuaternion(quat(i.rotation)) }))
  .filter((x) => x.o.distanceTo(c0) < 30);
// the 2x2 square of parallel pins (12.7 mm sides) whose centre is nearest the connector
let pins = null, bestD = 1e9;
for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) for (let c = b + 1; c < all.length; c++) for (let d = c + 1; d < all.length; d++) {
  const g = [all[a], all[b], all[c], all[d]]; if (g.some((x) => Math.abs(x.a.dot(g[0].a)) < 0.99)) continue;
  const ds = []; for (let m = 0; m < 4; m++) for (let n = m + 1; n < 4; n++) ds.push(g[m].o.distanceTo(g[n].o)); ds.sort((x, y) => x - y);
  if (!ds.slice(0, 4).every((x) => Math.abs(x - 12.7) < 0.3) || !ds.slice(4).every((x) => Math.abs(x - 17.96) < 0.3)) continue;
  const cen = g.reduce((s, x) => s.add(x.o), V([0,0,0])).multiplyScalar(0.25); const dd = cen.distanceTo(c0); if (dd < bestD) { bestD = dd; pins = g; } }
const pc = pins.reduce((s, x) => s.add(x.o), V([0,0,0])).multiplyScalar(0.25); const pa = pins[0].a.clone();
const side = Math.sign(c0.clone().sub(pc).dot(pa)) || 1; // connector on this side of the pins' plane
const target = pc.clone().add(pa.clone().multiplyScalar(side * 6.2));
console.log(label, 'pins', pins.map((x) => x.i.label.split(': ')[1]).join(' '), 'pin square centre', pc.toArray().map((v) => v.toFixed(1)).join(','));
const out = [], seen = [];
for (const x of [0,90,180,270]) for (const y of [0,90,180,270]) for (const z of [0,90,180,270]) {
  const q = quat([x,y,z]); if (seen.some((s) => Math.abs(s.dot(q)) > 0.999)) continue; seen.push(q);
  if (Math.abs(sqAxis.clone().applyQuaternion(q).dot(pa)) < 0.99) continue;
  const pos = target.clone().sub(sqc.clone().applyQuaternion(q));
  out.push({ turn: [x,y,z], position: pos.toArray().map((v) => +v.toFixed(3)), rotation: [x,y,z] });
}
fs.writeFileSync('cands.json', JSON.stringify({ label, partQuery: r.partQuery, cands: out })); console.log(out.length, 'candidates');
