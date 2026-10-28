import * as THREE from 'three';

/**
 * Batteries that slide into a brain's battery bay: held by the bay's latch, not by pins, so the
 * audit counts a battery at its bay pose as fully mounted on that brain. The pose is the battery's
 * place in the brain's own CAD file (the converter leaves it out of the brain's model).
 */
export const BATTERY_BAYS = [
  // Robot Brain (228-2540) and Robot Battery (228-2604)
  { battery: '228-2604', brain: '228-2540', position: [-0.75, -1.15, 0], rotation: [0, -90, 0] }
];

const POSITION_TOL_MM = 1;
const AXIS_DOT_MIN = 0.999;

const bayMatrix = (bay) =>
  new THREE.Matrix4().compose(
    new THREE.Vector3(...bay.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...bay.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ')),
    new THREE.Vector3(1, 1, 1)
  );

const _expected = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** The bay a battery sits in when `battery` (world matrix) is at its bay pose in `brain`, else null. */
export function seatedBatteryBay(batteryPart, batteryMatrix, brainPart, brainMatrix) {
  const bay = BATTERY_BAYS.find((b) => b.battery === batteryPart?.partNumber && b.brain === brainPart?.partNumber);
  if (!bay) return null;
  _expected.multiplyMatrices(brainMatrix, bayMatrix(bay));
  if (_a.setFromMatrixPosition(_expected).distanceTo(_b.setFromMatrixPosition(batteryMatrix)) > POSITION_TOL_MM) return null;
  for (const i of [0, 1, 2]) {
    if (_a.setFromMatrixColumn(_expected, i).normalize().dot(_b.setFromMatrixColumn(batteryMatrix, i).normalize()) < AXIS_DOT_MIN) return null;
  }
  return bay;
}
