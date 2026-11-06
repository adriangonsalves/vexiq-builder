// cctop2.mjs <asm> <pq> <label> <holeA x,z> <holeB x,z> <h>: pose a connector with peg_1->holeA, peg_2->holeB on the bumper's top face
import fs from 'node:fs';
import * as THREE from '/Users/adriangonsalves/projects/vexiq_builder/node_modules/three/build/three.module.js';
const [,, asmPath, pq, label, A, B, hs] = process.argv;
const asm = JSON.parse(fs.readFileSync(asmPath, 'utf8')); const cat = JSON.parse(fs.readFileSync('/Users/adriangonsalves/projects/vexiq_builder/public/catalog.json', 'utf8'));
const deg = THREE.MathUtils.degToRad, V = (a) => new THREE.Vector3(...a);
const b = asm.instances.find((i) => i.label === 'Tower: 228-2677-1');
const W = new THREE.Matrix4().compose(V(b.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...b.rotation.map(deg), 'XYZ')), V([1,1,1]));
const top = (s) => { const [x, z] = s.split(',').map(Number); return V([x, 23.84, z]).applyMatrix4(W); };
const up = V([0,1,0]).transformDirection(W);
const cp = cat.find((x) => x.partNumber === pq); const p1 = V(cp.ports.find((q) => q.portId === 'peg_1').origin);
const hA = top(A), hB = top(B);
const X = hB.clone().sub(hA).normalize(), Z = up.clone().negate(), Y = Z.clone().cross(X);
const R = new THREE.Matrix4().makeBasis(X, Y, Z);
const pos = hA.clone().add(up.clone().multiplyScalar(+hs)).sub(p1.clone().applyMatrix4(R));
const e = new THREE.Euler().setFromRotationMatrix(R, 'XYZ');
console.log(JSON.stringify({ partQuery: pq, label, position: pos.toArray().map((v) => +v.toFixed(3)), rotation: [e.x, e.y, e.z].map((v) => +THREE.MathUtils.radToDeg(v).toFixed(3)) }));
