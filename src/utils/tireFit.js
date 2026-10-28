import * as THREE from 'three';

/**
 * A tire is moulded a little smaller than the hub it stretches over, so a tire seated on a hub
 * always overlaps it. Both are round about their local Z axis; a tire counts as seated when the two
 * axes line up and the hub's middle sits inside the tire's width. Shared by the viewport and the
 * MCP engine so neither reports a fitted tire as a collision.
 */

const TIRE_NAME = /\btire\b/i;
const HUB_NAME = /\bhub\b/i;
const AXIS_DOT_MIN = 0.999;
const CENTER_OFFSET_MAX_MM = 0.6;

const _axisA = new THREE.Vector3();
const _axisB = new THREE.Vector3();
const _center = new THREE.Vector3();
const _hubCenter = new THREE.Vector3();

const worldCenter = (part, matrix, out) => out.set(...part.bbox.center).applyMatrix4(matrix);

/** True when one part is a tire and the other a hub it is seated on (world matrices given). */
export function isTireOnHub(partA, matrixA, partB, matrixB) {
  let tire, tireMatrix, hub, hubMatrix;
  if (TIRE_NAME.test(partA?.name) && HUB_NAME.test(partB?.name)) {
    [tire, tireMatrix, hub, hubMatrix] = [partA, matrixA, partB, matrixB];
  } else if (TIRE_NAME.test(partB?.name) && HUB_NAME.test(partA?.name)) {
    [tire, tireMatrix, hub, hubMatrix] = [partB, matrixB, partA, matrixA];
  } else {
    return false;
  }
  if (!tire.bbox || !hub.bbox) return false;

  _axisA.setFromMatrixColumn(tireMatrix, 2).normalize();
  _axisB.setFromMatrixColumn(hubMatrix, 2).normalize();
  if (Math.abs(_axisA.dot(_axisB)) < AXIS_DOT_MIN) return false;

  worldCenter(tire, tireMatrix, _center);
  worldCenter(hub, hubMatrix, _hubCenter).sub(_center);
  const along = _hubCenter.dot(_axisA);
  const across = _hubCenter.addScaledVector(_axisA, -along).length();
  return across <= CENTER_OFFSET_MAX_MM && Math.abs(along) <= tire.bbox.size[2] / 2;
}
