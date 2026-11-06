// Seat each Long Intake Flap on its nearest tread link the way the track builder does:
// flap rotation = link rotation, flap position = link position + q * seatInLink
import fs from 'node:fs';
import * as THREE from '/Users/adriangonsalves/projects/vexiq_builder/node_modules/three/build/three.module.js';
const asm = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cat = JSON.parse(fs.readFileSync('/Users/adriangonsalves/projects/vexiq_builder/public/catalog.json', 'utf8'));
const flapP = cat.find((p) => p.partNumber === '228-2500-242');
const seat = new THREE.Vector3(...flapP.chainSpecs.seatInLink);
const deg = THREE.MathUtils.degToRad, V = (a) => new THREE.Vector3(...a);
const quat = (r) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...r.map(deg), 'XYZ'));
const flaps = asm.instances.filter((i) => /: 228-2500-242-/.test(i.label));
const links = asm.instances.filter((i) => /: 228-2500-231-/.test(i.label));
const centre = (i, p) => V(p.bbox.center).applyQuaternion(quat(i.rotation)).add(V(i.position));
const linkP = cat.find((p) => p.partNumber === '228-2500-231');
const used = new Set(), out = [];
for (const f of flaps) {
  const fc = centre(f, flapP);
  let best = null;
  for (const l of links) { if (used.has(l.instanceId)) continue; const d = centre(l, linkP).distanceTo(fc); if (!best || d < best.d) best = { d, l }; }
  used.add(best.l.instanceId);
  const q = quat(best.l.rotation);
  const pos = seat.clone().applyQuaternion(q).add(V(best.l.position));
  // which way the link's outward (+Y) points compared with where the CAD flap was
  const outward = V([0,1,0]).applyQuaternion(q), toFlap = fc.clone().sub(V(best.l.position)).normalize();
  out.push({ instanceId: f.instanceId, label: f.label, link: best.l.label, dist: +best.d.toFixed(1), outwardDot: +outward.dot(toFlap).toFixed(2), position: pos.toArray().map((v) => +v.toFixed(3)), rotation: best.l.rotation });
}
fs.writeFileSync('flapseat.json', JSON.stringify(out, null, 1));
for (const o of out) console.log(o.label, '->', o.link, 'dist', o.dist, 'outward·flap', o.outwardDot);
