// CAD assembly (parts.json) -> place_parts items in the app's world (Y up, +X front, +Z right, mm)
import fs from 'node:fs';
import * as THREE from '/Users/adriangonsalves/projects/vexiq_builder/node_modules/three/build/three.module.js';
const [,, partsPath, outPath] = process.argv;
const cat = JSON.parse(fs.readFileSync('/Users/adriangonsalves/projects/vexiq_builder/public/catalog.json', 'utf8'));
const libOf = (q) => cat.find((p) => p.partNumber === q || p.name === q);
const S = 0.2141688543947308, DY = 39;
const P = JSON.parse(fs.readFileSync(partsPath, 'utf8'));
// library part, and its frame vs the CAD frame: p_lib = Q p_cad + o
const I3 = [[1,0,0],[0,1,0],[0,0,1]];
const special = {
  '228-2536-000': { lib: '228-2536', Q: [[1,0,0],[0,0,1],[0,-1,0]] },
  '228-2560': { lib: '228-2560', Q: [[-1,0,0],[0,-1,0],[0,0,1]], o: [0,0,0] },
  '228-2500-2238': { o: [0,0,0] },
  '228-2677': { lib: '228-2677', o: [-19.05, 0, 6.35] },
  '228-2500-242': { Q: [[-1,0,0],[0,0,-1],[0,-1,0]] }, // flap turned (90,0,180) about its centre: pegs into the tread link
  '228-6480': { lib: 'VEX IQ Robot Brain with Battery', Q: [[1,0,0],[0,0,1],[0,-1,0]], o: [0,0,0] },
  '228-7711-711 Split Bodies': { lib: '228-2500-2711', only: /Split Bodies-1$/ },
  '228-7711-712 Split Bodies': { lib: '228-2500-2712', only: /Split Bodies-1$/ },
};
const skip = /^(6P6C|Part\d|Intake Wire|Bumper Sensor Wire|Rubber Band|228-9136|228-7045)/;
const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const T = (A) => A[0].map((_, j) => A.map((r) => r[j]));
const mv = (A, v) => A.map((r) => r.reduce((s, x, k) => s + x * v[k], 0));
const C = [[0,0,1],[0,1,0],[-1,0,0]];
const items = [], skipped = [];
for (const p of P) {
  if (p.hidden || skip.test(p.pn)) { skipped.push(p.pn); continue; }
  const sp = special[p.pn] || {};
  if (sp.only && !sp.only.test(p.name)) { skipped.push(p.name); continue; }
  const Q = sp.Q || I3; const lib = libOf(sp.lib || p.pn); const o = sp.o || lib.bbox.center.slice(); // CAD poses the part's box centre
  const Rc = T(p.M.slice(0,3).map((r) => r.slice(0,3)));
  const t = p.M[3].slice(0,3).map((x) => x / S);
  const RQt = mul(Rc, T(Q));
  const Rapp = mul(C, RQt);
  const ro = mv(RQt, o);
  const pos = mv(C, t.map((x, i) => x - ro[i]));
  pos[1] += DY;
  const m4 = new THREE.Matrix4().set(...Rapp[0], 0, ...Rapp[1], 0, ...Rapp[2], 0, 0, 0, 0, 1);
  const e = new THREE.Euler().setFromRotationMatrix(m4, 'XYZ');
  const r = [e.x, e.y, e.z].map((a) => +(THREE.MathUtils.radToDeg(a)).toFixed(3));
  const sub = (p.top || '').replace(/^IQ Hero Bot /, '').replace(/-1$/, '') || 'Robot';
  items.push({ partQuery: sp.lib || p.pn, position: pos.map((x) => +x.toFixed(3)), rotation: r, sub, cad: p.name.split('/').pop() });
}
fs.writeFileSync(outPath, JSON.stringify(items));
const by = {}; for (const i of items) by[i.sub] = (by[i.sub] || 0) + 1;
console.log(items.length, 'items', by, 'skipped', skipped.length);
const ys = items.map((i) => i.position[1]); console.log('y range', Math.min(...ys), Math.max(...ys));
