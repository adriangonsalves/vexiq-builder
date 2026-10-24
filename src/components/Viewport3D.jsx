import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { loadPartAsset } from '../utils/geometryCache.js';
import {
  MAX_AXIAL_GAP_MM,
  collectWorldFeatures,
  findAlignedOpenings,
  findEngagedJoints,
  measureOpeningSurfaces,
  measurePinEnds,
  planMates,
  worldPartBox
} from '../utils/pinHoleAlignment.js';

const VEX_PITCH_MM = 12.7; // 1x VEX IQ Pitch = 0.5 inch = 12.7 mm
const HOLE_HIGHLIGHT_COLOR = 0xf97316; // orange: distinct from Axes overlay, selection, collision & gizmo colors
const COLLISION_EROSION_MM = 0.38; // collision meshes are eroded inward by this much (see geometryCache.js)

const openingSurfaceCache = new Map(); // partId -> Map(featureId -> { lo, hi }) measured on the mesh
const pinEndCache = new Map(); // partId -> Map(featureId -> { lo, hi }) which pin ends stick out

/**
 * Returns a part-local raycaster over a group's (eroded) collision meshes that reports the nearest
 * hit as { distance, normal } (normal: the hit triangle's face normal), or null on a miss.
 */
function createCollisionRaycaster(geos) {
  const ray = new THREE.Ray();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return (originArr, dirArr) => {
    ray.set(origin.fromArray(originArr), dir.fromArray(dirArr));
    let best = null;
    for (const geo of geos) {
      const hit = geo.boundsTree?.raycastFirst(ray, THREE.DoubleSide);
      if (hit && (best == null || hit.distance < best.distance)) best = hit;
    }
    return best ? { distance: best.distance, normal: best.face.normal.toArray() } : null;
  };
}

/**
 * Mesh measurements used by the alignment math, computed once per part from its collision mesh:
 * real face positions of its openings (so rings sit on the surface around each rim) and which ends
 * of its pins stick out. Returns null until the GLB has loaded.
 */
function getMeshMeasurements(group, partMeta) {
  const geos = group.userData.collisionGeometries;
  if (!geos || geos.length === 0) return null;
  let raycastHit = null;
  const hitFn = () => (raycastHit ||= createCollisionRaycaster(geos));

  if (!openingSurfaceCache.has(partMeta.id)) {
    const surfaces = measureOpeningSurfaces(partMeta, (originArr, dirArr) => {
      const hit = hitFn()(originArr, dirArr);
      // Step back from the eroded collision surface onto the visible one
      return hit ? Math.max(0, hit.distance - COLLISION_EROSION_MM) : null;
    });
    openingSurfaceCache.set(partMeta.id, surfaces);
  }
  if (!pinEndCache.has(partMeta.id)) {
    pinEndCache.set(partMeta.id, measurePinEnds(partMeta, (o, d) => hitFn()(o, d)));
  }
  return { surfaces: openingSurfaceCache.get(partMeta.id), pinEnds: pinEndCache.get(partMeta.id) };
}

/**
 * Builds a dual-resolution VEX IQ pitch grid (major lines every 1x Pitch = 12.7mm,
 * minor lines every 0.5x Pitch = 6.35mm).
 */
function createVexPitchGrid(pitchCount = 24) {
  const group = new THREE.Group();
  const halfExtent = pitchCount * VEX_PITCH_MM;

  const minorGrid = new THREE.GridHelper(
    halfExtent * 2,
    pitchCount * 4,
    0x334155,
    0x1e293b
  );
  minorGrid.position.y = -0.05;
  group.add(minorGrid);

  const majorGrid = new THREE.GridHelper(
    halfExtent * 2,
    pitchCount * 2,
    0x3b82f6,
    0x334155
  );
  group.add(majorGrid);

  return group;
}

/**
 * Builds 3D visual markers for the verified semantic ports (pin_hole, shaft_bore, shaft_socket, pin_peg)
 * or fallback cylindrical axes extracted from the STEP file.
 */
function createConnectorAxesGroup(partMeta) {
  const group = new THREE.Group();
  group.name = '__connector_overlay__';

  const items = partMeta?.ports?.length ? partMeta.ports : partMeta?.cylinders || [];

  const matByType = {
    pin_hole: new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      depthTest: false,
      transparent: true,
      opacity: 0.92
    }),
    shaft_bore: new THREE.LineBasicMaterial({
      color: 0xf472b6,
      depthTest: false,
      transparent: true,
      opacity: 0.95
    }),
    shaft_socket: new THREE.LineBasicMaterial({
      color: 0xc084fc,
      depthTest: false,
      transparent: true,
      opacity: 0.95
    }),
    pin_peg: new THREE.LineBasicMaterial({
      color: 0xfacc15,
      depthTest: false,
      transparent: true,
      opacity: 0.92
    })
  };

  const dotGeo = new THREE.SphereGeometry(1.05, 10, 10);
  const dotMatByType = {
    pin_hole: new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false }),
    shaft_bore: new THREE.MeshBasicMaterial({ color: 0xf472b6, depthTest: false }),
    shaft_socket: new THREE.MeshBasicMaterial({ color: 0xc084fc, depthTest: false }),
    pin_peg: new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false })
  };

  for (const item of items) {
    const [ox, oy, oz] = item.origin;
    const [ax, ay, az] = item.axis;
    const type = item.type || 'pin_hole';
    const len = 7.5;
    const p1 = new THREE.Vector3(ox - ax * len, oy - ay * len, oz - az * len);
    const p2 = new THREE.Vector3(ox + ax * len, oy + ay * len, oz + az * len);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(lineGeo, matByType[type] || matByType.pin_hole);
    line.renderOrder = 999;
    group.add(line);

    const dot = new THREE.Mesh(dotGeo, dotMatByType[type] || dotMatByType.pin_hole);
    dot.position.set(ox, oy, oz);
    dot.renderOrder = 1000;
    group.add(dot);
  }

  return group;
}

/**
 * Builds the overlay that marks openings lined up with the selected part's pins/shafts:
 * - a solid ring on the receiving part's surface at each face of the opening (both faces for a
 *   through opening), depth-tested so it reads as part of the surface and hides behind other parts;
 * - a faint see-through ring on the face toward the pin/shaft, so a hidden opening is still findable.
 * Rings are pooled and hidden rather than removed so dragging never allocates geometry.
 */
function createHoleHighlightOverlay() {
  const group = new THREE.Group();
  group.name = '__aligned_hole_highlights__';

  const RING_WIDTH_MM = 0.7;
  const SOLID_RING_LIFT_MM = 0.15; // lift off the measured surface so the depth test never buries it
  const GHOST_OPACITY = 0.3;
  const ringGeoByRadius = new Map(); // rim radius (mm) -> shared RingGeometry hugging that rim
  const ringGeoFor = (radiusMm = 3.175) => {
    const key = radiusMm.toFixed(3);
    if (!ringGeoByRadius.has(key)) {
      ringGeoByRadius.set(key, new THREE.RingGeometry(radiusMm, radiusMm + RING_WIDTH_MM, 40));
    }
    return ringGeoByRadius.get(key);
  };
  const baseMaterial = {
    color: HOLE_HIGHLIGHT_COLOR,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
    toneMapped: false
  };
  const solidMaterial = new THREE.MeshBasicMaterial({
    ...baseMaterial,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
  const ghostMaterial = new THREE.MeshBasicMaterial({
    ...baseMaterial,
    depthTest: false,
    transparent: true,
    opacity: GHOST_OPACITY
  });
  const solidPool = [];
  const ghostPool = [];
  const ringNormal = new THREE.Vector3(0, 0, 1);

  // Places one pooled ring per entry of `placements` ({ position, normal, radiusMm }).
  const placeRings = (pool, material, renderOrder, placements) => {
    while (pool.length < placements.length) {
      const ring = new THREE.Mesh(ringGeoFor(), material);
      ring.renderOrder = renderOrder;
      group.add(ring);
      pool.push(ring);
    }
    pool.forEach((ring, i) => {
      const p = placements[i];
      ring.visible = Boolean(p);
      if (!p) return;
      ring.geometry = ringGeoFor(p.radiusMm);
      ring.position.copy(p.position);
      ring.quaternion.setFromUnitVectors(ringNormal, p.normal);
    });
  };

  const show = (openings) => {
    const solid = [];
    const ghost = [];
    for (const o of openings) {
      solid.push({
        position: o.face.clone().addScaledVector(o.outward, SOLID_RING_LIFT_MM),
        normal: o.outward,
        radiusMm: o.radiusMm
      });
      if (o.farFace) {
        const inward = o.outward.clone().negate();
        solid.push({
          position: o.farFace.clone().addScaledVector(inward, SOLID_RING_LIFT_MM),
          normal: inward,
          radiusMm: o.radiusMm
        });
      }
      ghost.push({ position: o.face, normal: o.outward, radiusMm: o.radiusMm });
    }
    // Ghost first, solid on top; both above the Axes overlay (999/1000) and below the gizmo (Infinity)
    placeRings(ghostPool, ghostMaterial, 1001, ghost);
    placeRings(solidPool, solidMaterial, 1002, solid);
  };

  const dispose = () => {
    for (const geo of ringGeoByRadius.values()) geo.dispose();
    solidMaterial.dispose();
    ghostMaterial.dispose();
  };

  return { group, show, dispose };
}

/**
 * Builds the large direction arrows shown when a double-clicked part can mate in more than one
 * direction. Arrows are sized in gizmo units and rescaled every frame (like TransformControls) so
 * they stay large on screen; they draw through parts and carry fatter invisible pickers for clicking.
 */
function createMateArrowOverlay() {
  const group = new THREE.Group();
  group.name = '__mate_direction_arrows__';
  group.visible = false;

  const ARROW_COLOR = HOLE_HIGHLIGHT_COLOR;
  const ARROW_HOVER_COLOR = 0xfdba74;
  // Built along +Y in gizmo units: shaft from 0.12 to 1.0, cone tip at 1.35
  const shaftGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.88, 12).translate(0, 0.56, 0);
  const headGeo = new THREE.ConeGeometry(0.11, 0.35, 20).translate(0, 1.175, 0);
  const pickGeo = new THREE.CylinderGeometry(0.16, 0.16, 1.25, 8).translate(0, 0.725, 0);
  const pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const yAxis = new THREE.Vector3(0, 1, 0);
  const arrows = []; // { root, material, picker }
  let shownCount = 0;

  const makeArrow = () => {
    const material = new THREE.MeshBasicMaterial({
      color: ARROW_COLOR,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false
    });
    const root = new THREE.Group();
    const shaft = new THREE.Mesh(shaftGeo, material);
    const head = new THREE.Mesh(headGeo, material);
    const picker = new THREE.Mesh(pickGeo, pickMaterial);
    shaft.renderOrder = 1003; // above the hole rings (1001/1002)
    head.renderOrder = 1003;
    root.add(shaft, head, picker);
    group.add(root);
    return { root, material, picker };
  };

  const show = (directions, origin) => {
    while (arrows.length < directions.length) arrows.push(makeArrow());
    arrows.forEach((arrow, i) => {
      const dir = directions[i];
      arrow.root.visible = Boolean(dir);
      if (!dir) return;
      arrow.root.position.copy(origin);
      arrow.root.quaternion.setFromUnitVectors(yAxis, dir);
      arrow.material.color.setHex(ARROW_COLOR);
    });
    shownCount = directions.length;
    group.visible = shownCount > 0;
  };

  const hide = () => {
    shownCount = 0;
    group.visible = false;
  };

  /** Index of the arrow under the raycaster, or -1. */
  const pick = (raycaster) => {
    if (!group.visible) return -1;
    group.updateMatrixWorld(true);
    const pickers = arrows.slice(0, shownCount).map((a) => a.picker);
    const hit = raycaster.intersectObjects(pickers, false)[0];
    return hit ? pickers.indexOf(hit.object) : -1;
  };

  const setHover = (index) => {
    arrows.forEach((arrow, i) => arrow.material.color.setHex(i === index ? ARROW_HOVER_COLOR : ARROW_COLOR));
  };

  // Same screen-size factor TransformControls uses for its gizmo
  const updateScale = (camera) => {
    if (!group.visible) return;
    for (const arrow of arrows.slice(0, shownCount)) {
      const factor =
        arrow.root.position.distanceTo(camera.position) *
        Math.min((1.9 * Math.tan((Math.PI * camera.fov) / 360)) / camera.zoom, 7);
      arrow.root.scale.setScalar((factor * 0.95) / 4);
    }
  };

  const dispose = () => {
    shaftGeo.dispose();
    headGeo.dispose();
    pickGeo.dispose();
    pickMaterial.dispose();
    for (const arrow of arrows) arrow.material.dispose();
  };

  return { group, show, hide, pick, setHover, updateScale, isShown: () => group.visible, dispose };
}

const ROTATE_RING_INNER = 0.85; // gizmo units; the outer edge is at 1.0
const ROTATE_RING_COLORS = { X: 0xef4444, Y: 0x22c55e, Z: 0x3b82f6, Joint: HOLE_HIGHLIGHT_COLOR };

/**
 * Builds the Rotate-mode gizmo: up to three flat rings around one pivot, one per turning axis. Each
 * ring has a thin rim (so it still shows edge-on), tick marks at the snap angles, a fatter invisible
 * picker, and a shaded slice shown while dragging. Rings are sized in screen units like the mate
 * arrows, but never smaller than the part (`minRadius`, world mm), so they always go around it.
 */
function createRotateGizmo() {
  const group = new THREE.Group();
  group.name = '__rotate_gizmo__';
  group.visible = false;

  const OUTER = 1.0;
  const zAxis = new THREE.Vector3(0, 0, 1);
  const bandGeo = new THREE.RingGeometry(ROTATE_RING_INNER, OUTER, 96);
  const rimGeo = new THREE.TorusGeometry(OUTER, 0.012, 6, 96);
  const pickGeo = new THREE.TorusGeometry((ROTATE_RING_INNER + OUTER) / 2, 0.1, 8, 64);
  const pickMaterial = new THREE.MeshBasicMaterial({ visible: false });
  let tickGeo = new THREE.BufferGeometry();
  const overlayMaterial = (color, opacity) =>
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false
    });

  const rings = []; // { root, band, rim, ticks, slice, picker, color, minRadius }
  let shownCount = 0;
  let hoverIndex = -1;
  let selectedIndex = -1;
  let dragIndex = -1;

  const makeRing = () => {
    const root = new THREE.Group();
    const band = new THREE.Mesh(bandGeo, overlayMaterial(0xffffff, 0.28));
    const rim = new THREE.Mesh(rimGeo, overlayMaterial(0xffffff, 0.9));
    const ticks = new THREE.LineSegments(
      tickGeo,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false })
    );
    const slice = new THREE.Mesh(new THREE.BufferGeometry(), overlayMaterial(0xffffff, 0.25));
    const picker = new THREE.Mesh(pickGeo, pickMaterial);
    // Above the hole rings (1001/1002) and mate arrows (1003)
    band.renderOrder = 1004;
    slice.renderOrder = 1004;
    rim.renderOrder = 1005;
    ticks.renderOrder = 1005;
    slice.visible = false;
    root.add(band, rim, ticks, slice, picker);
    group.add(root);
    return { root, band, rim, ticks, slice, picker, color: new THREE.Color(), minRadius: 0 };
  };

  const refreshLooks = () => {
    rings.forEach((ring, i) => {
      const active = i === dragIndex || i === selectedIndex;
      const color = active ? ring.color.clone().lerp(new THREE.Color(0xffffff), 0.35) : ring.color;
      ring.band.material.color.copy(color);
      ring.band.material.opacity = active ? 0.7 : i === hoverIndex ? 0.5 : 0.28;
      ring.rim.material.color.copy(color);
      ring.ticks.material.color.copy(color);
      ring.slice.material.color.copy(ring.color);
    });
  };

  /** `rings`: [{ axis (unit), color (hex), minRadius (world mm) }], all turning about `pivot`. */
  const show = (pivot, ringDefs) => {
    while (rings.length < ringDefs.length) rings.push(makeRing());
    group.position.copy(pivot);
    rings.forEach((ring, i) => {
      const def = ringDefs[i];
      ring.root.visible = Boolean(def);
      if (!def) return;
      ring.root.quaternion.setFromUnitVectors(zAxis, def.axis);
      ring.color.setHex(def.color);
      ring.minRadius = def.minRadius;
      ring.slice.visible = false;
    });
    shownCount = ringDefs.length;
    group.visible = shownCount > 0;
    refreshLooks();
  };

  const hide = () => {
    shownCount = 0;
    group.visible = false;
    hoverIndex = -1;
    dragIndex = -1;
  };

  /** Ring under the raycaster as { index, point } (world hit point), or null. */
  const pick = (raycaster) => {
    if (!group.visible) return null;
    group.updateMatrixWorld(true);
    const pickers = rings.slice(0, shownCount).map((r) => r.picker);
    const hit = raycaster.intersectObjects(pickers, false)[0];
    return hit ? { index: pickers.indexOf(hit.object), point: hit.point.clone() } : null;
  };

  const setHover = (index) => {
    if (index === hoverIndex) return;
    hoverIndex = index;
    refreshLooks();
  };
  const setSelected = (index) => {
    selectedIndex = index;
    refreshLooks();
  };
  const setDragging = (index) => {
    dragIndex = index;
    refreshLooks();
  };

  /** Tick marks every `stepDeg` (longer every 90°); none when snapping is off. */
  const setSnap = (stepDeg) => {
    const positions = [];
    if (stepDeg > 0) {
      for (let deg = 0; deg < 360 - 1e-6; deg += stepDeg) {
        const a = THREE.MathUtils.degToRad(deg);
        const len = Math.abs(deg % 90) < 1e-6 ? 0.14 : 0.07;
        const c = Math.cos(a);
        const s = Math.sin(a);
        positions.push(c * OUTER, s * OUTER, 0, c * (OUTER + len), s * (OUTER + len), 0);
      }
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    for (const ring of rings) ring.ticks.geometry = next;
    tickGeo.dispose();
    tickGeo = next;
  };

  /** Axis and in-plane unit vectors u, v (u × v = axis) of a ring, plus its world radius. */
  const frame = (index) => {
    const ring = rings[index];
    return {
      axis: zAxis.clone().applyQuaternion(ring.root.quaternion),
      u: new THREE.Vector3(1, 0, 0).applyQuaternion(ring.root.quaternion),
      v: new THREE.Vector3(0, 1, 0).applyQuaternion(ring.root.quaternion),
      radius: OUTER * ring.root.scale.x
    };
  };

  /** Shades the slice turned so far: from in-plane angle `startRad` (from u) through `deltaRad`. */
  const setSlice = (index, startRad, deltaRad) => {
    const ring = rings[index];
    if (!ring) return;
    ring.slice.geometry.dispose();
    const length = Math.min(Math.abs(deltaRad), Math.PI * 2);
    ring.slice.visible = length > 1e-4;
    ring.slice.geometry = ring.slice.visible
      ? new THREE.CircleGeometry(ROTATE_RING_INNER, 64, deltaRad >= 0 ? startRad : startRad + deltaRad, length)
      : new THREE.BufferGeometry();
  };
  const clearSlices = () => {
    for (const ring of rings) ring.slice.visible = false;
  };

  // Same screen-size factor TransformControls uses for its gizmo
  const updateScale = (camera) => {
    if (!group.visible) return;
    const factor =
      group.position.distanceTo(camera.position) *
      Math.min((1.9 * Math.tan((Math.PI * camera.fov) / 360)) / camera.zoom, 7);
    for (const ring of rings.slice(0, shownCount)) {
      ring.root.scale.setScalar(Math.max((factor * 0.95) / 6, ring.minRadius / OUTER));
    }
  };

  const dispose = () => {
    bandGeo.dispose();
    rimGeo.dispose();
    pickGeo.dispose();
    tickGeo.dispose();
    pickMaterial.dispose();
    for (const ring of rings) {
      ring.band.material.dispose();
      ring.rim.material.dispose();
      ring.ticks.material.dispose();
      ring.slice.material.dispose();
      ring.slice.geometry.dispose();
    }
  };

  return {
    group,
    show,
    hide,
    pick,
    setHover,
    setSelected,
    setDragging,
    setSnap,
    frame,
    setSlice,
    clearSlices,
    updateScale,
    isShown: () => group.visible,
    dispose
  };
}

/** Wraps degrees into (−180, 180]. */
const wrapDeg = (deg) => {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};

/**
 * HTML angle labels for the rotate rings, laid over the canvas inside `parent`. Each label is a
 * button showing e.g. "Z 30°"; clicking it swaps in a number field. Enter calls
 * `onSubmit(index, value)`, Esc or clicking away cancels.
 */
function createAngleLabels(parent, onSubmit) {
  const layer = document.createElement('div');
  layer.className = 'rotate-angle-layer';
  parent.appendChild(layer);
  const labels = []; // { el, name, text, editing }

  const makeLabel = (index) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rotate-angle-label';
    const label = { el, name: '', text: '', editing: false };
    el.addEventListener('click', () => {
      if (label.editing) return;
      label.editing = true;
      const input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.className = 'rotate-angle-input';
      input.value = label.value ?? '0';
      el.replaceChildren(input);
      input.focus();
      input.select();
      const finish = (submit) => {
        if (!label.editing) return;
        label.editing = false;
        const value = Number.parseFloat(input.value);
        el.textContent = label.text;
        if (submit && Number.isFinite(value)) onSubmit(index, value);
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(false));
    });
    layer.appendChild(el);
    return label;
  };

  /** `names`: one per ring ('X', 'Y', 'Z' or 'Joint'). */
  const show = (names) => {
    while (labels.length < names.length) labels.push(makeLabel(labels.length));
    labels.forEach((label, i) => {
      label.name = names[i] ?? '';
      if (!names[i]) label.el.style.display = 'none';
      else label.el.style.setProperty('--ring-color', `#${new THREE.Color(ROTATE_RING_COLORS[names[i]]).getHexString()}`);
    });
  };

  const hide = () => {
    for (const label of labels) {
      label.name = '';
      label.el.style.display = 'none';
    }
  };

  const setAngle = (index, deg) => {
    const label = labels[index];
    if (!label) return;
    const value = Number(wrapDeg(deg).toFixed(1));
    label.value = String(value);
    label.text = `${label.name === 'Joint' ? '↻' : label.name} ${value}°`;
    if (!label.editing) label.el.textContent = label.text;
  };

  /** Places label `index` centered at canvas pixel (x, y), or hides it when `visible` is false. */
  const place = (index, x, y, visible) => {
    const label = labels[index];
    if (!label || !label.name) return;
    label.el.style.display = visible ? 'block' : 'none';
    if (visible) label.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  };

  const dispose = () => layer.remove();

  return { show, hide, setAngle, place, dispose };
}

/**
 * Computes exploded display positions for all visible instances along 'x', 'y', 'z', or 'all'
 * without mutating their underlying assembled positions.
 */
function computeExplodedPositions(instances, explodeMode = 'off', explodeFactor = 1.15) {
  const result = new Map();
  const visible = instances.filter((i) => i.visible !== false);
  if (explodeMode === 'off' || visible.length <= 1) {
    for (const inst of instances) {
      result.set(inst.instanceId, [...inst.position]);
    }
    return result;
  }

  // Compute assembly centroid
  let cx = 0,
    cy = 0,
    cz = 0;
  for (const inst of visible) {
    cx += inst.position[0];
    cy += inst.position[1];
    cz += inst.position[2];
  }
  cx /= visible.length;
  cy /= visible.length;
  cz /= visible.length;

  const explodeAxisOffset = (val, centerVal, idx, total, isSingleAxis) => {
    const delta = val - centerVal;
    if (Math.abs(delta) >= 2.0) {
      // Scale distance from centroid + add minimum separation step per layer sign
      return delta * explodeFactor + Math.sign(delta) * 26 * explodeFactor;
    }
    // If parts lie on the exact same plane (e.g. all drivetrain parts at y=25.4mm when exploding Y),
    // fan them out symmetrically so single-axis explode still separates co-planar parts clearly.
    if (isSingleAxis) {
      const centeredIdx = idx - (total - 1) / 2;
      return centeredIdx * 18 * explodeFactor;
    }
    return 0;
  };

  visible.forEach((inst, idx) => {
    const [px, py, pz] = inst.position;
    let ox = 0,
      oy = 0,
      oz = 0;

    if (explodeMode === 'x' || explodeMode === 'all') {
      ox = explodeAxisOffset(px, cx, idx, visible.length, explodeMode === 'x');
    }
    if (explodeMode === 'y' || explodeMode === 'all') {
      oy = explodeAxisOffset(py, cy, idx, visible.length, explodeMode === 'y');
      // Keep Y explosion above the floor grid
      if (py + oy < 6) oy = Math.max(oy, 6 - py + idx * 8);
    }
    if (explodeMode === 'z' || explodeMode === 'all') {
      oz = explodeAxisOffset(pz, cz, idx, visible.length, explodeMode === 'z');
    }

    result.set(inst.instanceId, [
      Number((px + ox).toFixed(3)),
      Number((py + oy).toFixed(3)),
      Number((pz + oz).toFixed(3))
    ]);
  });

  for (const inst of instances) {
    if (!result.has(inst.instanceId)) {
      result.set(inst.instanceId, [...inst.position]);
    }
  }

  return result;
}

/**
 * Applies either normal VEX appearance or transparent-grey intersecting appearance
 * strictly to actual CAD part meshes (`child.userData.isPartMesh === true`).
 */
function applyGroupAppearance(group, { baseColor, isSelected, isIntersecting }) {
  group.traverse((child) => {
    if (!child.isMesh || !child.userData.isPartMesh || !child.material) return;
    const mat = child.material;

    if (isIntersecting) {
      mat.color.set('#9ca3af');
      mat.transparent = true;
      mat.opacity = 0.42;
      mat.depthWrite = false;
      if (mat.emissive) {
        mat.emissive.setHex(0x374151);
        mat.emissiveIntensity = 0.25;
      }
    } else {
      mat.color.set(baseColor || '#64748b');
      mat.transparent = false;
      mat.opacity = 1.0;
      mat.depthWrite = true;
      if (mat.emissive) {
        mat.emissive.setHex(isSelected ? 0x1d4ed8 : 0x000000);
        mat.emissiveIntensity = isSelected ? 0.32 : 0;
      }
    }
    mat.needsUpdate = true;
  });
}

/**
 * Upgrades the stock TransformControls translate gizmo's tiny (0.15) plane squares into large,
 * clearly visible, outlined plane-drag handles. Dragging a plane handle moves the selected part
 * freely within that plane (XY = Front plane, YZ = Side plane, XZ = Ground plane), while the
 * custom VEX pitch snapping + BVH flush-contact solver in `objectChange` still applies.
 *
 * TransformControls bakes handle transforms into geometry (see setupGizmo), so we replace the
 * geometry of the existing `XY` / `YZ` / `XZ` handles in both the visible gizmo and invisible picker.
 */
function enhanceTranslatePlaneHandles(transform) {
  const gizmoRoot = transform?._gizmo;
  const visibleGroup = gizmoRoot?.gizmo?.translate;
  const pickerGroup = gizmoRoot?.picker?.translate;
  if (!visibleGroup || !pickerGroup) return;

  const OFFSET = 0.27; // center of plane square from gizmo origin (gizmo units)
  const SIZE = 0.26; // visible square edge length
  const PICK_SIZE = 0.32; // larger invisible hit area for easier grabbing
  const THICK = 0.004;

  const planeDefs = {
    XY: { color: 0x3b82f6, box: (s) => [s, s, THICK], center: [OFFSET, OFFSET, 0] },
    YZ: { color: 0xef4444, box: (s) => [THICK, s, s], center: [0, OFFSET, OFFSET] },
    XZ: { color: 0x22c55e, box: (s) => [s, THICK, s], center: [OFFSET, 0, OFFSET] }
  };

  const outlinePoints = (name, s) => {
    const h = s / 2;
    const [cx, cy, cz] = planeDefs[name].center;
    const corners2d = [
      [-h, -h],
      [h, -h],
      [h, h],
      [-h, h]
    ];
    const pts = corners2d.map(([a, b]) => {
      if (name === 'XY') return new THREE.Vector3(cx + a, cy + b, cz);
      if (name === 'YZ') return new THREE.Vector3(cx, cy + a, cz + b);
      return new THREE.Vector3(cx + a, cy, cz + b);
    });
    const segs = [];
    for (let i = 0; i < 4; i++) segs.push(pts[i], pts[(i + 1) % 4]);
    return segs;
  };

  for (const [name, def] of Object.entries(planeDefs)) {
    // Visible filled square
    for (const handle of visibleGroup.children.filter((c) => c.name === name && c.isMesh)) {
      const geo = new THREE.BoxGeometry(...def.box(SIZE));
      geo.translate(...def.center);
      handle.geometry.dispose();
      handle.geometry = geo;
      handle.material = new THREE.MeshBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false
      });
    }

    // Bright outline so the plane handle reads clearly against parts and the grid
    const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePoints(name, SIZE));
    const outline = new THREE.LineSegments(
      outlineGeo,
      new THREE.LineBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false
      })
    );
    outline.name = name; // same name => positioned, scaled, hidden edge-on & highlighted with its plane
    outline.renderOrder = Infinity;
    visibleGroup.add(outline);

    // Larger invisible picker hit area
    for (const picker of pickerGroup.children.filter((c) => c.name === name)) {
      const geo = new THREE.BoxGeometry(...def.box(PICK_SIZE).map((v) => (v === THICK ? 0.02 : v)));
      geo.translate(...def.center);
      picker.geometry.dispose();
      picker.geometry = geo;
    }
  }
}

export default function Viewport3D({
  instances,
  catalogMap,
  selectedId,
  onSelect,
  onUpdateTransform,
  onRegisterFlushMover,
  onRegisterScreenshot,
  transformMode,
  snapPitchFactor,
  rotationSnapDeg,
  showGrid,
  showConnectors,
  explodeMode = 'off',
  focusTrigger,
  onLoadingChange,
  onMateFeedback,
  onToggleRotateRequest
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const orbitRef = useRef(null);
  const transformRef = useRef(null);
  const gridRef = useRef(null);
  const partGroupRef = useRef(null);
  const explodeLinesGroupRef = useRef(null);
  const meshMapRef = useRef(new Map()); // instanceId -> THREE.Group
  const wasDraggingRef = useRef(false);
  const dragMovedRef = useRef(false); // the last gizmo drag actually moved/rotated the part
  const dragStartPosRef = useRef(new THREE.Vector3());
  const lastClearDragPosRef = useRef(new THREE.Vector3());
  const hasClearDragPosRef = useRef(false);
  const holeOverlayRef = useRef(null);
  const otherFeaturesRef = useRef([]); // [{ instanceId, box, features }] for visible non-selected parts
  const lastAlignedRef = useRef([]); // latest findAlignedOpenings result for the selected part
  const arrowOverlayRef = useRef(null);
  const arrowPlansRef = useRef([]); // mate plans behind the arrows currently shown
  const rotateGizmoRef = useRef(null);
  const angleLabelsRef = useRef(null);
  // { instanceId, pivot, rings: [{ name, axis }], angles: [deg] } while Rotate-mode rings are shown
  const rotateSetupRef = useRef(null);
  const rotateMessageKeyRef = useRef(''); // last refusal message sent, so each is sent once per selection
  const selectedRingRef = useRef(-1); // ring the mouse wheel turns, or -1
  // In-progress ring drag / wheel turn / typed angle:
  // { kind, ring, instanceId, startPos, startQuat, startAngle, ... }
  const rotateGestureRef = useRef(null);

  const instancesRef = useRef(instances);
  instancesRef.current = instances;

  const catalogMapRef = useRef(catalogMap);
  catalogMapRef.current = catalogMap;

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const explodeModeRef = useRef(explodeMode);
  explodeModeRef.current = explodeMode;

  const transformModeRef = useRef(transformMode);
  transformModeRef.current = transformMode;

  const snapPitchFactorRef = useRef(snapPitchFactor);
  snapPitchFactorRef.current = snapPitchFactor;

  const rotationSnapDegRef = useRef(rotationSnapDeg);
  rotationSnapDegRef.current = rotationSnapDeg;

  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const onUpdateTransformRef = useRef(onUpdateTransform);
  onUpdateTransformRef.current = onUpdateTransform;

  const onMateFeedbackRef = useRef(onMateFeedback);
  onMateFeedbackRef.current = onMateFeedback;

  const onToggleRotateRequestRef = useRef(onToggleRotateRequest);
  onToggleRotateRequestRef.current = onToggleRotateRequest;

  /**
   * Exact concave mesh-to-mesh intersection check using three-mesh-bvh on inward-eroded
   * collision geometries. Evaluates at true assembled positions even when exploded.
   */
  const checkGroupCollision = (targetGroup, useAssembledPositions = false) => {
    if (!targetGroup || !targetGroup.visible) return false;
    const colGeosA = targetGroup.userData.collisionGeometries;
    const localBoxA = targetGroup.userData.localBox;
    if (!colGeosA || colGeosA.length === 0 || !localBoxA || localBoxA.isEmpty()) {
      return false;
    }

    const savedPos = new Map();
    if (useAssembledPositions) {
      for (const inst of instancesRef.current) {
        const g = meshMapRef.current.get(inst.instanceId);
        if (g) {
          savedPos.set(g, g.position.clone());
          g.position.set(inst.position[0], inst.position[1], inst.position[2]);
        }
      }
    }

    targetGroup.updateMatrixWorld(true);
    const worldBoxA = localBoxA.clone().applyMatrix4(targetGroup.matrixWorld);
    const invMatrixA = new THREE.Matrix4().copy(targetGroup.matrixWorld).invert();
    const matrixBtoA = new THREE.Matrix4();

    let collided = false;
    for (const [otherId, otherGroup] of meshMapRef.current.entries()) {
      if (otherId === targetGroup.userData.instanceId) continue;
      if (!otherGroup.visible) continue;

      const colGeosB = otherGroup.userData.collisionGeometries;
      const localBoxB = otherGroup.userData.localBox;
      if (!colGeosB || colGeosB.length === 0 || !localBoxB || localBoxB.isEmpty()) continue;

      otherGroup.updateMatrixWorld(true);
      const worldBoxB = localBoxB.clone().applyMatrix4(otherGroup.matrixWorld);

      if (!worldBoxA.intersectsBox(worldBoxB)) continue;

      matrixBtoA.multiplyMatrices(invMatrixA, otherGroup.matrixWorld);

      for (const geoA of colGeosA) {
        if (!geoA.boundsTree) continue;
        for (const geoB of colGeosB) {
          if (geoA.boundsTree.intersectsGeometry(geoB, matrixBtoA)) {
            collided = true;
            break;
          }
        }
        if (collided) break;
      }
      if (collided) break;
    }

    if (useAssembledPositions) {
      for (const [g, pos] of savedPos.entries()) {
        g.position.copy(pos);
        g.updateMatrixWorld(true);
      }
    }

    return collided;
  };

  /**
   * Finds the exact physical flush contact boundary along [clearPos, desiredPos] before
   * solid mesh penetration occurs. Combines 10-step BVH bisection with canonical VEX 0.25P
   * (3.175mm, e.g. pin flat cap resting against a 0.5P thick beam/plate) snapping.
   */
  const findFlushBoundaryPosition = (targetGroup, clearPos, desiredPos) => {
    const saved = targetGroup.position.clone();
    const testAt = (vec) => {
      targetGroup.position.copy(vec);
      return checkGroupCollision(targetGroup, false);
    };

    if (testAt(clearPos)) {
      targetGroup.position.copy(saved);
      return null;
    }

    const lo = clearPos.clone();
    const hi = desiredPos.clone();
    const mid = new THREE.Vector3();
    for (let i = 0; i < 10; i++) {
      mid.lerpVectors(lo, hi, 0.5);
      if (!testAt(mid)) {
        lo.copy(mid);
      } else {
        hi.copy(mid);
      }
    }

    // Prefer a clean VEX 0.25P (3.175mm) flush coordinate along the dominant movement axis
    // if it lies on the safe side within 0.95mm of the BVH surface contact limit.
    const delta = new THREE.Vector3().subVectors(desiredPos, clearPos);
    const absX = Math.abs(delta.x);
    const absY = Math.abs(delta.y);
    const absZ = Math.abs(delta.z);
    const domAxis = absX >= absY && absX >= absZ ? 'x' : absY >= absZ ? 'y' : 'z';

    const quarterStep = VEX_PITCH_MM * 0.25; // 3.175mm
    const dir = Math.sign(delta[domAxis]);
    if (dir !== 0) {
      const qIndex =
        dir > 0
          ? Math.floor((lo[domAxis] + 0.05) / quarterStep)
          : Math.ceil((lo[domAxis] - 0.05) / quarterStep);
      const qVal = Number((qIndex * quarterStep).toFixed(3));
      const distFromClear = (qVal - clearPos[domAxis]) * dir;
      const distFromLo = Math.abs(lo[domAxis] - qVal);
      if (distFromClear >= -0.01 && distFromLo <= 0.95) {
        const candidate = lo.clone();
        candidate[domAxis] = qVal;
        if (!testAt(candidate)) {
          lo.copy(candidate);
        }
      }
    }

    targetGroup.position.copy(saved);
    return new THREE.Vector3(
      Number(lo.x.toFixed(3)),
      Number(lo.y.toFixed(3)),
      Number(lo.z.toFixed(3))
    );
  };

  /**
   * Caches world pins/shafts/openings of every visible non-selected part. Nothing but the selected
   * part moves during a drag, so this is rebuilt only at drag start and after scene syncs.
   */
  const rebuildOtherFeatures = () => {
    const entries = [];
    for (const [instId, group] of meshMapRef.current.entries()) {
      if (instId === selectedIdRef.current || !group.visible) continue;
      const partMeta = catalogMapRef.current.get(group.userData.partId);
      if (!partMeta) continue;
      group.updateMatrixWorld();
      const features = collectWorldFeatures(
        partMeta,
        group.matrixWorld,
        instId,
        getMeshMeasurements(group, partMeta)
      );
      if (features.length === 0) continue;
      const box = worldPartBox(partMeta, group.matrixWorld)?.expandByScalar(MAX_AXIAL_GAP_MM);
      entries.push({ instanceId: instId, box, features });
    }
    otherFeaturesRef.current = entries;
  };

  /**
   * Highlights (see-through) every opening lined up with the selected part's pins/shafts, and the
   * selected part's openings lined up with other parts' pins/shafts, while the insert is still outside.
   */
  const updateAlignedHoleHighlights = () => {
    const overlay = holeOverlayRef.current;
    if (!overlay) return;

    const selId = selectedIdRef.current;
    const group = selId ? meshMapRef.current.get(selId) : null;
    const selectedInst = selId ? instancesRef.current.find((i) => i.instanceId === selId) : null;
    const partMeta = group ? catalogMapRef.current.get(group.userData.partId) : null;
    lastAlignedRef.current = [];
    if (
      !group ||
      !partMeta ||
      !selectedInst ||
      selectedInst.visible === false ||
      explodeModeRef.current !== 'off'
    ) {
      overlay.show([]);
      return;
    }

    group.updateMatrixWorld();
    const selectedFeatures = collectWorldFeatures(
      partMeta,
      group.matrixWorld,
      selId,
      getMeshMeasurements(group, partMeta)
    );
    if (selectedFeatures.length === 0) {
      overlay.show([]);
      return;
    }

    const reachBox = worldPartBox(partMeta, group.matrixWorld)?.expandByScalar(MAX_AXIAL_GAP_MM);
    const candidates = [];
    for (const other of otherFeaturesRef.current) {
      if (other.instanceId === selId) continue;
      if (reachBox && other.box && !reachBox.intersectsBox(other.box)) continue;
      for (const f of other.features) candidates.push(f);
    }
    lastAlignedRef.current = findAlignedOpenings(selectedFeatures, candidates);
    overlay.show(lastAlignedRef.current);
  };

  /** Hides the mate direction arrows and gives the move gizmo or rotate rings back. */
  const hideMateArrows = () => {
    const arrows = arrowOverlayRef.current;
    if (!arrows?.isShown()) return;
    arrows.hide();
    arrowPlansRef.current = [];
    const transform = transformRef.current;
    if (transform) {
      transform.enabled = true;
      transform.getHelper().visible = transform.object !== undefined;
    }
    refreshRotateSetup();
  };

  /** Shows one large arrow per mate plan at the selected part's center and hides the gizmo. */
  const showMateArrows = (plans, group) => {
    const arrows = arrowOverlayRef.current;
    const transform = transformRef.current;
    if (!arrows || !transform) return;
    const center = new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
    arrowPlansRef.current = plans;
    arrows.show(
      plans.map((p) => p.direction),
      center
    );
    if (cameraRef.current) arrows.updateScale(cameraRef.current);
    transform.enabled = false;
    transform.getHelper().visible = false;
    refreshRotateSetup(); // hides the rotate rings while the arrows are shown
  };

  /**
   * Mates the selected part along one plan (see planMates): shift sideways onto the axis, then
   * sweep along the direction in 0.5mm steps for as long as the pin/shaft is still in an opening
   * (sweepMm); at the first contact use the drag's flush-boundary bisection, otherwise stop at the
   * plan's travel limit (leading end flush with the far face). Commits like a drag release, after
   * making sure the rounded position is clear.
   */
  const mateSelected = (plan) => {
    const selId = selectedIdRef.current;
    const group = selId ? meshMapRef.current.get(selId) : null;
    if (!group || !plan) return;
    const feedback = (message, isError = false) => onMateFeedbackRef.current?.(message, isError);

    const original = group.position.clone();
    const start = original.clone().add(plan.lateral);
    group.position.copy(start);
    if (checkGroupCollision(group, false)) {
      group.position.copy(original);
      feedback("Can't mate: already touching another part", true);
      return;
    }

    const STEP_MM = 0.5;
    const travel = Math.max(0, plan.travelMm);
    const sweep = Math.max(travel, plan.sweepMm ?? 0);
    const lastClear = start.clone();
    let final = null;
    for (let d = Math.min(STEP_MM, sweep); d > 0; d = Math.min(d + STEP_MM, sweep)) {
      const probe = start.clone().addScaledVector(plan.direction, d);
      group.position.copy(probe);
      if (checkGroupCollision(group, false)) {
        final = findFlushBoundaryPosition(group, lastClear, probe) || lastClear.clone();
        break;
      }
      lastClear.copy(probe);
      if (d >= sweep) break;
    }
    if (!final) final = start.clone().addScaledVector(plan.direction, travel);

    // The contact found by bisection is within ~0.0005mm of touching, so rounding to 0.001mm can
    // land on the touching side: step back along the move until the rounded position is clear.
    const roundVec = (vec) =>
      new THREE.Vector3(Number(vec.x.toFixed(3)), Number(vec.y.toFixed(3)), Number(vec.z.toFixed(3)));
    const BACK_OFF_MM = 0.002;
    let rounded = roundVec(final);
    group.position.copy(rounded);
    for (let i = 0; i < 50 && checkGroupCollision(group, false); i++) {
      rounded = roundVec(final.addScaledVector(plan.direction, -BACK_OFF_MM));
      group.position.copy(rounded);
    }
    final = rounded;
    group.updateMatrixWorld();

    onUpdateTransformRef.current(selId, {
      position: [
        Number(final.x.toFixed(3)),
        Number(final.y.toFixed(3)),
        Number(final.z.toFixed(3))
      ],
      rotation: [
        Number(THREE.MathUtils.radToDeg(group.rotation.x).toFixed(2)),
        Number(THREE.MathUtils.radToDeg(group.rotation.y).toFixed(2)),
        Number(THREE.MathUtils.radToDeg(group.rotation.z).toFixed(2))
      ],
      isIntersecting: false
    });

    const partnerIds = new Set(
      plan.pairs.map((p) => (p.insertInstanceId === selId ? p.instanceId : p.insertInstanceId))
    );
    const labels = [...partnerIds].map(
      (id) => instancesRef.current.find((i) => i.instanceId === id)?.label || id
    );
    feedback(`Mated with ${labels.join(', ')}`);
  };

  /** Double-click on the selected part: mate in its only direction, or offer arrows for several. */
  const handleMateRequest = () => {
    const selId = selectedIdRef.current;
    const group = selId ? meshMapRef.current.get(selId) : null;
    const inst = selId ? instancesRef.current.find((i) => i.instanceId === selId) : null;
    if (!group || !inst || explodeModeRef.current !== 'off') return;
    const feedback = (message, isError = false) => onMateFeedbackRef.current?.(message, isError);
    if (inst.locked) {
      feedback('Part is locked', true);
      return;
    }
    const plans = planMates(lastAlignedRef.current, selId);
    if (plans.length === 0) {
      feedback('Nothing lined up to mate with', true);
    } else if (plans.length === 1) {
      mateSelected(plans[0]);
    } else {
      showMateArrows(plans, group);
    }
  };

  /** Selects the ring the mouse wheel turns (-1: none, the wheel zooms again). */
  const selectRing = (index) => {
    if (rotateGestureRef.current?.kind === 'wheel') commitRotation();
    selectedRingRef.current = index;
    rotateGizmoRef.current?.setSelected(index);
    if (orbitRef.current) orbitRef.current.enableZoom = index < 0;
  };

  /**
   * Works out how the selected part may turn in Rotate mode and shows its rings: free -> world X/Y/Z
   * rings through the part's center; held on one axis line -> one ring around that line; locked,
   * Explode on, or held on several axis lines -> no rings and a message. Ring angles carry over while
   * the same part keeps the same rings and start at 0° otherwise.
   */
  const refreshRotateSetup = () => {
    const gizmo = rotateGizmoRef.current;
    const labels = angleLabelsRef.current;
    if (!gizmo || !labels || rotateGestureRef.current) return;
    const selId = selectedIdRef.current;
    const group = selId ? meshMapRef.current.get(selId) : null;
    const inst = selId ? instancesRef.current.find((i) => i.instanceId === selId) : null;
    const partMeta = group ? catalogMapRef.current.get(group.userData.partId) : null;
    const prev = rotateSetupRef.current;

    const clear = (message = '') => {
      rotateSetupRef.current = null;
      if (selectedRingRef.current >= 0) selectRing(-1);
      gizmo.hide();
      labels.hide();
      const key = message ? `${selId}:${message}` : '';
      if (message && rotateMessageKeyRef.current !== key) onMateFeedbackRef.current?.(message, true);
      rotateMessageKeyRef.current = key;
    };

    if (transformModeRef.current !== 'rotate' || !group || !inst || !partMeta || inst.visible === false) {
      return clear();
    }
    if (inst.locked) return clear('Part is locked');
    if (explodeModeRef.current !== 'off') return clear("Can't rotate in Explode view");
    if (arrowOverlayRef.current?.isShown() || !group.userData.localBox) return clear();

    group.updateMatrixWorld();
    const selectedFeatures = collectWorldFeatures(
      partMeta,
      group.matrixWorld,
      selId,
      getMeshMeasurements(group, partMeta)
    );
    const candidates = otherFeaturesRef.current.flatMap((o) => (o.instanceId === selId ? [] : o.features));
    const { lines } = findEngagedJoints(selectedFeatures, candidates);
    if (lines.length > 1) return clear("Can't rotate: held by pins or shafts on more than one axis");

    const center = group.userData.localBox.getCenter(new THREE.Vector3()).applyMatrix4(group.matrixWorld);
    let pivot;
    let rings;
    if (lines.length === 0) {
      pivot = center;
      rings = [
        { name: 'X', axis: new THREE.Vector3(1, 0, 0) },
        { name: 'Y', axis: new THREE.Vector3(0, 1, 0) },
        { name: 'Z', axis: new THREE.Vector3(0, 0, 1) }
      ];
    } else {
      const { origin, axis } = lines[0];
      pivot = origin.clone().addScaledVector(axis, center.clone().sub(origin).dot(axis));
      rings = [{ name: 'Joint', axis: axis.clone().normalize() }];
    }

    // Each ring goes around the whole part: its radius covers every bbox corner in the ring's plane
    const corners = [];
    const { min, max } = group.userData.localBox;
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld));
      }
    }
    const minRadiusFor = (axis) =>
      Math.max(...corners.map((c) => c.clone().sub(pivot).projectOnPlane(axis).length())) * 1.1 + 2;

    const same =
      prev &&
      prev.instanceId === selId &&
      prev.rings.length === rings.length &&
      prev.rings.every((r, i) => r.axis.dot(rings[i].axis) > 0.9999) &&
      prev.pivot.distanceTo(pivot) < 0.5;
    const angles = same ? prev.angles : rings.map(() => 0);
    if (!same && selectedRingRef.current >= 0) selectRing(-1);

    rotateSetupRef.current = { instanceId: selId, pivot, rings, angles };
    rotateMessageKeyRef.current = '';
    gizmo.show(
      pivot,
      rings.map((r) => ({ axis: r.axis, color: ROTATE_RING_COLORS[r.name], minRadius: minRadiusFor(r.axis) }))
    );
    if (cameraRef.current) gizmo.updateScale(cameraRef.current);
    gizmo.setSelected(selectedRingRef.current);
    labels.show(rings.map((r) => r.name));
    angles.forEach((deg, i) => labels.setAngle(i, deg));
  };

  /** Starts a turn of the selected part around ring `ring`, remembering the pose it started from. */
  const beginRotateGesture = (kind, ring, extra = {}) => {
    const setup = rotateSetupRef.current;
    const group = setup ? meshMapRef.current.get(setup.instanceId) : null;
    if (!group) return null;
    rotateGestureRef.current = {
      kind,
      ring,
      instanceId: setup.instanceId,
      startPos: group.position.clone(),
      startQuat: group.quaternion.clone(),
      startAngle: setup.angles[ring],
      ...extra
    };
    return rotateGestureRef.current;
  };

  /**
   * Turns the selected part so ring `ring` reads `totalDeg`: around the ring's axis through the pivot,
   * starting from the gesture's start pose (not incrementally, so snapping never adds up error).
   */
  const turnSelectedTo = (ring, totalDeg) => {
    const setup = rotateSetupRef.current;
    const gesture = rotateGestureRef.current;
    const group = setup ? meshMapRef.current.get(setup.instanceId) : null;
    if (!group || !gesture) return;
    const q = new THREE.Quaternion().setFromAxisAngle(
      setup.rings[ring].axis,
      THREE.MathUtils.degToRad(totalDeg - gesture.startAngle)
    );
    group.position.copy(gesture.startPos).sub(setup.pivot).applyQuaternion(q).add(setup.pivot);
    group.quaternion.copy(q).multiply(gesture.startQuat);
    group.updateMatrixWorld();
    setup.angles[ring] = totalDeg;
    angleLabelsRef.current?.setAngle(ring, totalDeg);

    const inst = instancesRef.current.find((i) => i.instanceId === setup.instanceId);
    const partMeta = catalogMapRef.current.get(group.userData.partId);
    const isColliding = checkGroupCollision(group, false);
    group.userData.isIntersecting = isColliding;
    applyGroupAppearance(group, {
      baseColor: inst?.color || partMeta?.defaultColor,
      isSelected: true,
      isIntersecting: isColliding
    });
    updateAlignedHoleHighlights();
  };

  /** Saves the turned pose like a drag release; the instance sync then works out the rings again. */
  const commitRotation = () => {
    const gesture = rotateGestureRef.current;
    rotateGestureRef.current = null;
    if (gesture?.wheelTimer) clearTimeout(gesture.wheelTimer);
    rotateGizmoRef.current?.setDragging(-1);
    rotateGizmoRef.current?.clearSlices();
    const group = gesture ? meshMapRef.current.get(gesture.instanceId) : null;
    if (!group) return;
    const isColliding = checkGroupCollision(group, false);
    group.userData.isIntersecting = isColliding;
    onUpdateTransformRef.current(gesture.instanceId, {
      position: [
        Number(group.position.x.toFixed(3)),
        Number(group.position.y.toFixed(3)),
        Number(group.position.z.toFixed(3))
      ],
      rotation: [
        Number(THREE.MathUtils.radToDeg(group.rotation.x).toFixed(2)),
        Number(THREE.MathUtils.radToDeg(group.rotation.y).toFixed(2)),
        Number(THREE.MathUtils.radToDeg(group.rotation.z).toFixed(2))
      ],
      isIntersecting: isColliding
    });
  };

  /** Typed angle on a ring label: turn so the label reads `value` (exact, not snapped), then save. */
  const turnRingToTypedAngle = (ring, value) => {
    const setup = rotateSetupRef.current;
    if (!setup || rotateGestureRef.current || !setup.rings[ring]) return;
    const current = setup.angles[ring];
    if (!beginRotateGesture('type', ring)) return;
    turnSelectedTo(ring, current + (value - wrapDeg(current)));
    commitRotation();
  };

  /**
   * Puts the right gizmo on the selected part: the Move arrows (TransformControls) in Move mode, the
   * rotate rings in Rotate mode; neither while exploded, for locked parts, or for hidden parts.
   */
  const syncGizmos = () => {
    const transform = transformRef.current;
    if (!transform) return;
    if (rotateGestureRef.current?.kind === 'wheel' && transformModeRef.current !== 'rotate') commitRotation();
    const selId = selectedIdRef.current;
    const group = selId ? meshMapRef.current.get(selId) : null;
    const inst = selId ? instancesRef.current.find((i) => i.instanceId === selId) : null;
    const canMove =
      transformModeRef.current === 'translate' &&
      explodeModeRef.current === 'off' &&
      group &&
      inst &&
      inst.visible !== false &&
      !inst.locked;
    if (canMove) {
      if (transform.object !== group) transform.attach(group);
    } else {
      transform.detach();
    }
    refreshRotateSetup();
  };

  // Expose a screenshot renderer to App.jsx for the MCP server's capture_screenshot tool. Everything
  // happens in one task (render, read the canvas, restore), so the user never sees a frame of it.
  useEffect(() => {
    if (!onRegisterScreenshot) return;
    onRegisterScreenshot(({ view = 'iso', width = 1024, height = 768, focusInstanceId } = {}) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!renderer || !scene || !camera || !container) return null;

      // Frame the whole assembly (or one part) from a fixed direction per standard view
      const VIEW_DIRS = { iso: [1, 0.75, 1], front: [1, 0, 0], side: [0, 0, 1], top: [0, 1, 0] };
      const shotCamera = camera.clone();
      shotCamera.aspect = width / height;
      if (view !== 'current') {
        const box = new THREE.Box3();
        const focus = focusInstanceId ? meshMapRef.current.get(focusInstanceId) : null;
        if (focus) box.setFromObject(focus);
        else for (const g of meshMapRef.current.values()) if (g.visible) box.expandByObject(g);
        if (!box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 40);
          const dir = new THREE.Vector3(...(VIEW_DIRS[view] || VIEW_DIRS.iso)).normalize();
          shotCamera.position.copy(center).addScaledVector(dir, maxDim * 2.1 * Math.max(1, height / width));
          // Looking straight down, +X is up in the picture (a robot facing +X has its front at the top)
          if (view === 'top') shotCamera.up.set(1, 0, 0);
          else shotCamera.up.set(0, 1, 0);
          shotCamera.lookAt(center);
        }
      }
      shotCamera.updateProjectionMatrix();

      // Leave out gizmos, hole highlights, mate arrows, rotate rings and the selection tint
      const overlays = [
        transformRef.current?.getHelper?.(),
        holeOverlayRef.current?.group,
        arrowOverlayRef.current?.group,
        rotateGizmoRef.current?.group
      ].filter(Boolean);
      const wasVisible = overlays.map((o) => o.visible);
      overlays.forEach((o) => {
        o.visible = false;
      });
      const selId = selectedIdRef.current;
      const selGroup = selId ? meshMapRef.current.get(selId) : null;
      const selInst = selId ? instancesRef.current.find((i) => i.instanceId === selId) : null;
      const selAppearance = selGroup && {
        baseColor: selInst?.color || catalogMapRef.current.get(selGroup.userData.partId)?.defaultColor,
        isIntersecting: Boolean(selGroup.userData.isIntersecting)
      };
      if (selGroup) applyGroupAppearance(selGroup, { ...selAppearance, isSelected: false });

      const pixelRatio = renderer.getPixelRatio();
      let png;
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        renderer.render(scene, shotCamera);
        png = renderer.domElement.toDataURL('image/png').split(',')[1];
      } finally {
        renderer.setPixelRatio(pixelRatio);
        renderer.setSize(container.clientWidth, container.clientHeight);
        overlays.forEach((o, i) => {
          o.visible = wasVisible[i];
        });
        if (selGroup) applyGroupAppearance(selGroup, { ...selAppearance, isSelected: true });
        renderer.render(scene, camera);
      }
      return png;
    });
  }, [onRegisterScreenshot]);

  // Expose a contact-aware nudge/move resolver to App.jsx for the Inspector -X/+X/-Y/+Y/-Z/+Z buttons
  useEffect(() => {
    if (!onRegisterFlushMover) return;
    onRegisterFlushMover((instanceId, axisIndex, deltaMm) => {
      const group = meshMapRef.current.get(instanceId);
      const inst = instancesRef.current.find((i) => i.instanceId === instanceId);
      if (!inst) return null;

      const axisKey = ['x', 'y', 'z'][axisIndex];
      const startVec = new THREE.Vector3(...inst.position);
      const desiredVec = startVec.clone();
      desiredVec[axisKey] = Number((startVec[axisKey] + deltaMm).toFixed(3));

      if (!group || !group.userData.collisionGeometries) {
        return {
          position: [desiredVec.x, desiredVec.y, desiredVec.z],
          isIntersecting: false,
          snappedFlush: false
        };
      }

      const savedPos = group.position.clone();
      group.position.copy(startVec);
      const startColliding = checkGroupCollision(group, false);

      const quarterStep = VEX_PITCH_MM * 0.25; // 3.175mm
      const dir = Math.sign(deltaMm);

      // If stepping by >= 0.5P (6.35mm), check if there is an intermediate 0.25P (3.175mm) flush
      // stop right before a collision, or if the full step itself collides.
      group.position.copy(desiredVec);
      const desiredColliding = checkGroupCollision(group, false);

      if (!startColliding && desiredColliding) {
        const flushVec = findFlushBoundaryPosition(group, startVec, desiredVec);
        if (flushVec && flushVec.distanceTo(startVec) > 0.12) {
          group.position.copy(savedPos);
          return {
            position: [flushVec.x, flushVec.y, flushVec.z],
            isIntersecting: false,
            snappedFlush: true
          };
        }
      } else if (!startColliding && !desiredColliding && Math.abs(deltaMm) >= VEX_PITCH_MM * 0.49) {
        // Also check if startVec was off the 0.5P grid (e.g. at +3.175mm) and stepping by 6.35mm
        // jumped across 0.0mm or across a flush seat
        const midQuarter = Number(
          (Math.round((startVec[axisKey] + dir * quarterStep) / quarterStep) * quarterStep).toFixed(3)
        );
        if (Math.abs(midQuarter - startVec[axisKey]) > 0.12 && Math.abs(midQuarter - desiredVec[axisKey]) > 0.12) {
          const midVec = startVec.clone();
          midVec[axisKey] = midQuarter;
          const afterMidVec = startVec.clone();
          afterMidVec[axisKey] = Number((midQuarter + dir * quarterStep).toFixed(3));
          group.position.copy(midVec);
          const midCollides = checkGroupCollision(group, false);
          group.position.copy(afterMidVec);
          const afterMidCollides = checkGroupCollision(group, false);
          if (!midCollides && afterMidCollides) {
            group.position.copy(savedPos);
            return {
              position: [midVec.x, midVec.y, midVec.z],
              isIntersecting: false,
              snappedFlush: true
            };
          }
        }
      }

      group.position.copy(savedPos);
      return {
        position: [desiredVec.x, desiredVec.y, desiredVec.z],
        isIntersecting: desiredColliding,
        snappedFlush: false
      };
    });
  }, [onRegisterFlushMover]);

  // Initialize Three.js scene, camera, controls
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      1,
      5000
    );
    camera.position.set(220, 170, 240);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Studio CAD Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0xe2e8f0, 0x1e293b, 0.65);
    hemiLight.position.set(0, 300, 0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.1);
    dirLight1.position.set(180, 300, 220);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.55);
    dirLight2.position.set(-200, -120, -160);
    scene.add(dirLight2);

    // VEX IQ Pitch Grid
    const gridGroup = createVexPitchGrid(24);
    scene.add(gridGroup);
    gridRef.current = gridGroup;

    const axesHelper = new THREE.AxesHelper(VEX_PITCH_MM * 2);
    axesHelper.position.y = 0.1;
    scene.add(axesHelper);

    const partsRoot = new THREE.Group();
    scene.add(partsRoot);
    partGroupRef.current = partsRoot;

    const explodeLinesGroup = new THREE.Group();
    scene.add(explodeLinesGroup);
    explodeLinesGroupRef.current = explodeLinesGroup;

    // Aligned-hole highlights live on the scene root (not partsRoot) so click selection ignores them
    const holeOverlay = createHoleHighlightOverlay();
    scene.add(holeOverlay.group);
    holeOverlayRef.current = holeOverlay;

    // Mate direction arrows (double-click on a part that can mate in several directions)
    const arrowOverlay = createMateArrowOverlay();
    scene.add(arrowOverlay.group);
    arrowOverlayRef.current = arrowOverlay;

    // Rotate-mode rings and their angle labels (typed angles turn the part)
    const rotateGizmo = createRotateGizmo();
    rotateGizmo.setSnap(rotationSnapDegRef.current || 0);
    scene.add(rotateGizmo.group);
    rotateGizmoRef.current = rotateGizmo;
    const angleLabels = createAngleLabels(container, (ring, value) => turnRingToTypedAngle(ring, value));
    angleLabelsRef.current = angleLabels;

    // OrbitControls
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.maxDistance = 2500;
    orbit.minDistance = 10;
    orbitRef.current = orbit;

    // TransformControls
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(0.95);
    enhanceTranslatePlaneHandles(transform);

    transform.addEventListener('objectChange', () => {
      const obj = transform.object;
      if (!obj) return;
      dragMovedRef.current = true;
      const instId = obj.userData.instanceId;
      const inst = instancesRef.current.find((i) => i.instanceId === instId);
      const partMeta = inst ? catalogMapRef.current.get(inst.partId) : null;

      if (transformModeRef.current === 'translate') {
        const rawPos = obj.position.clone();
        const factor = snapPitchFactorRef.current;
        const step = factor && factor > 0 ? VEX_PITCH_MM * factor : 0;
        const quarterStep = VEX_PITCH_MM * 0.25; // 3.175mm (0.25P flush wall boundary)
        const snappedPos = rawPos.clone();

        if (step > 0) {
          for (const ax of ['x', 'y', 'z']) {
            if (Math.abs(rawPos[ax] - dragStartPosRef.current[ax]) <= 0.005) {
              snappedPos[ax] = dragStartPosRef.current[ax];
              continue;
            }
            const gridVal = Number((Math.round(rawPos[ax] / step) * step).toFixed(3));
            const qVal = Number((Math.round(rawPos[ax] / quarterStep) * quarterStep).toFixed(3));

            // If cursor is closer to a 0.25P (3.175mm) coordinate than the coarse gridVal,
            // check if that 0.25P coordinate is a physical flush contact boundary!
            if (step > quarterStep && Math.abs(qVal - gridVal) > 0.1 && Math.abs(rawPos[ax] - qVal) <= quarterStep * 0.55) {
              const testQ = snappedPos.clone();
              testQ[ax] = qVal;
              obj.position.copy(testQ);
              const qClear = !checkGroupCollision(obj, false);
              if (qClear) {
                const testPlus = testQ.clone();
                testPlus[ax] = Number((qVal + quarterStep).toFixed(3));
                obj.position.copy(testPlus);
                const plusHit = checkGroupCollision(obj, false);

                const testMinus = testQ.clone();
                testMinus[ax] = Number((qVal - quarterStep).toFixed(3));
                obj.position.copy(testMinus);
                const minusHit = checkGroupCollision(obj, false);

                if (plusHit || minusHit) {
                  snappedPos[ax] = qVal;
                  continue;
                }
              }
            }
            snappedPos[ax] = gridVal;
          }
        }

        obj.position.copy(snappedPos);
        let isColliding = checkGroupCollision(obj, false);

        // If the snapped step penetrated a solid surface (e.g. pushing a pin cap into a beam wall),
        // clamp to the exact physical flush contact boundary before allowing pass-through!
        if (isColliding && hasClearDragPosRef.current) {
          const penetrationDist = rawPos.distanceTo(lastClearDragPosRef.current);
          if (penetrationDist <= VEX_PITCH_MM * 1.35) {
            const flushPos = findFlushBoundaryPosition(obj, lastClearDragPosRef.current, snappedPos);
            if (flushPos) {
              obj.position.copy(flushPos);
              isColliding = false;
            }
          }
        }

        if (!isColliding) {
          lastClearDragPosRef.current.copy(obj.position);
          hasClearDragPosRef.current = true;
        }

        obj.userData.isIntersecting = isColliding;
        applyGroupAppearance(obj, {
          baseColor: inst?.color || partMeta?.defaultColor,
          isSelected: true,
          isIntersecting: isColliding
        });
        updateAlignedHoleHighlights();
        return;
      }

      const isColliding = checkGroupCollision(obj, false);
      obj.userData.isIntersecting = isColliding;

      applyGroupAppearance(obj, {
        baseColor: inst?.color || partMeta?.defaultColor,
        isSelected: true,
        isIntersecting: isColliding
      });
      updateAlignedHoleHighlights();
    });

    transform.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
      if (event.value) {
        wasDraggingRef.current = true;
        dragMovedRef.current = false;
        hideMateArrows();
        rebuildOtherFeatures();
        if (transform.object) {
          dragStartPosRef.current.copy(transform.object.position);
          const startColliding = checkGroupCollision(transform.object, false);
          if (!startColliding) {
            lastClearDragPosRef.current.copy(transform.object.position);
            hasClearDragPosRef.current = true;
          } else {
            hasClearDragPosRef.current = false;
          }
        }
      } else if (transform.object) {
        const obj = transform.object;
        const instId = obj.userData.instanceId;
        if (instId) {
          const isColliding = checkGroupCollision(obj, false);
          obj.userData.isIntersecting = isColliding;
          onUpdateTransformRef.current(instId, {
            position: [
              Number(obj.position.x.toFixed(3)),
              Number(obj.position.y.toFixed(3)),
              Number(obj.position.z.toFixed(3))
            ],
            rotation: [
              Number(THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(2)),
              Number(THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(2)),
              Number(THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(2))
            ],
            isIntersecting: isColliding
          });
        }
        setTimeout(() => {
          wasDraggingRef.current = false;
        }, 30);
      }
    });

    const gizmoHelper = transform.getHelper ? transform.getHelper() : transform;
    scene.add(gizmoHelper);
    transformRef.current = transform;

    // Click raycasting for part selection
    const raycaster = new THREE.Raycaster();
    const pointerDownPos = new THREE.Vector2();
    let lastArrowClickAt = -Infinity; // the dblclick that follows an arrow click must not mate again

    const handlePointerDown = (e) => {
      pointerDownPos.set(e.clientX, e.clientY);
    };

    const projectToCanvas = (point) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = point.clone().project(camera);
      return new THREE.Vector2(((ndc.x + 1) / 2) * rect.width, ((1 - ndc.y) / 2) * rect.height);
    };

    // A left press on a rotate ring starts turning (capture phase, ahead of OrbitControls, which is
    // switched off for the drag). The angle comes from the pointer on the ring's plane; when the
    // plane is seen nearly edge-on, from the pointer's travel along the ring's on-screen tangent.
    let ringClickHandled = false; // the bubbling pointerup of a ring press must not change selection
    const handleRingPointerDown = (e) => {
      if (e.button !== 0 || !rotateSetupRef.current || rotateGestureRef.current) return;
      setRayFromEvent(e);
      const hit = rotateGizmo.pick(raycaster);
      if (!hit) return;
      const setup = rotateSetupRef.current;
      const { axis, u, v, radius } = rotateGizmo.frame(hit.index);
      const edgeOn = Math.abs(raycaster.ray.direction.dot(axis)) < 0.2;
      // Measure from where the pointer meets the ring's plane (the picker's surface sits off it)
      const planeHit = edgeOn
        ? null
        : raycaster.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(axis, setup.pivot), new THREE.Vector3());
      const pressDir = (planeHit ?? hit.point).clone().sub(setup.pivot).projectOnPlane(axis).normalize();
      const extra = {
        pressX: e.clientX,
        pressY: e.clientY,
        moved: false,
        edgeOn,
        pressDir,
        startRad: Math.atan2(pressDir.dot(v), pressDir.dot(u)),
        prevRaw: 0,
        turnedRad: 0
      };
      if (edgeOn) {
        // Positive turns move the press point along axis × radius; measure pixels along that
        const tangent = new THREE.Vector3().crossVectors(axis, pressDir);
        const a = projectToCanvas(hit.point);
        const b = projectToCanvas(hit.point.clone().addScaledVector(tangent, radius));
        const screen = b.sub(a);
        extra.pxPerRad = Math.max(screen.length(), 40);
        extra.screenTangent = screen.normalize();
      }
      if (!beginRotateGesture('drag', hit.index, extra)) return;
      orbit.enabled = false;
      renderer.domElement.setPointerCapture?.(e.pointerId);
      rotateGizmo.setDragging(hit.index);
      renderer.domElement.style.cursor = 'grabbing';
    };

    const ringPlane = new THREE.Plane();
    const ringPoint = new THREE.Vector3();
    const handleRingDragMove = (e) => {
      const gesture = rotateGestureRef.current;
      const setup = rotateSetupRef.current;
      if (!setup) return;
      if (Math.hypot(e.clientX - gesture.pressX, e.clientY - gesture.pressY) > 5) gesture.moved = true;
      if (!gesture.moved) return;
      const { axis } = rotateGizmo.frame(gesture.ring);
      if (gesture.edgeOn) {
        gesture.turnedRad =
          ((e.clientX - gesture.pressX) * gesture.screenTangent.x +
            (e.clientY - gesture.pressY) * gesture.screenTangent.y) /
          gesture.pxPerRad;
      } else {
        setRayFromEvent(e);
        ringPlane.setFromNormalAndCoplanarPoint(axis, setup.pivot);
        if (!raycaster.ray.intersectPlane(ringPlane, ringPoint)) return;
        const dir = ringPoint.sub(setup.pivot).normalize();
        const raw = Math.atan2(
          axis.dot(new THREE.Vector3().crossVectors(gesture.pressDir, dir)),
          gesture.pressDir.dot(dir)
        );
        // Unwrap across ±180° so turns past half a circle keep counting
        let delta = raw - gesture.prevRaw;
        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;
        gesture.turnedRad += delta;
        gesture.prevRaw = raw;
      }
      const step = rotationSnapDegRef.current;
      const total = gesture.startAngle + THREE.MathUtils.radToDeg(gesture.turnedRad);
      const snapped = step > 0 ? Math.round(total / step) * step : total;
      turnSelectedTo(gesture.ring, snapped);
      rotateGizmo.setSlice(gesture.ring, gesture.startRad, THREE.MathUtils.degToRad(snapped - gesture.startAngle));
    };

    // Release: a drag saves the turn; a click without movement selects/unselects the ring instead
    const handleRingPointerUp = (e) => {
      const gesture = rotateGestureRef.current;
      if (e.button !== 0 || gesture?.kind !== 'drag') return;
      renderer.domElement.releasePointerCapture?.(e.pointerId);
      orbit.enabled = true;
      renderer.domElement.style.cursor = 'grab';
      ringClickHandled = true;
      if (gesture.moved) {
        commitRotation();
        return;
      }
      rotateGestureRef.current = null;
      rotateGizmo.setDragging(-1);
      selectRing(selectedRingRef.current === gesture.ring ? -1 : gesture.ring);
    };

    const setRayFromEvent = (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(mouse, camera);
    };

    // Instance ids of the visible parts under the pointer, nearest first
    const pickPartsAt = (e) => {
      setRayFromEvent(e);
      const meshes = [];
      partsRoot.traverse((child) => {
        if (
          child.isMesh &&
          child.userData.isPartMesh &&
          child.userData.instanceId &&
          child.parent?.visible !== false
        ) {
          meshes.push(child);
        }
      });
      const ids = [];
      for (const hit of raycaster.intersectObjects(meshes, false)) {
        const id = hit.object.userData.instanceId;
        if (!ids.includes(id)) ids.push(id);
      }
      return ids;
    };

    // A click on another part that sits in front of the selected part waits one double-click interval
    // before changing the selection, so double-clicking a selected part hidden behind it still mates it.
    const DOUBLE_CLICK_WINDOW_MS = 350;
    let pendingSelectTimer = null;
    const cancelPendingSelect = () => {
      if (pendingSelectTimer) clearTimeout(pendingSelectTimer);
      pendingSelectTimer = null;
    };

    const handlePointerUp = (e) => {
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      // Right-click (not a right-drag pan) on the selected part, even behind another: Move <-> Rotate
      if (e.button === 2) {
        const selId = selectedIdRef.current;
        if (Math.hypot(dx, dy) <= 5 && selId && pickPartsAt(e).includes(selId)) {
          onToggleRotateRequestRef.current?.();
        }
        return;
      }
      if (e.button !== 0) return;
      if (ringClickHandled) {
        ringClickHandled = false;
        return;
      }
      if (transform.dragging || wasDraggingRef.current) return;
      if (Math.hypot(dx, dy) > 5) return;
      if (selectedRingRef.current >= 0) selectRing(-1); // a click off the rings unselects the ring

      // While mate arrows are shown, a click either picks an arrow or dismisses them
      if (arrowOverlay.isShown()) {
        setRayFromEvent(e);
        const index = arrowOverlay.pick(raycaster);
        const plan = index >= 0 ? arrowPlansRef.current[index] : null;
        hideMateArrows();
        if (plan) {
          lastArrowClickAt = performance.now();
          mateSelected(plan);
          return;
        }
      }

      const ids = pickPartsAt(e);
      const front = ids[0] ?? null;
      const selId = selectedIdRef.current;
      cancelPendingSelect();
      if (selId && front !== selId && ids.includes(selId)) {
        pendingSelectTimer = setTimeout(() => {
          pendingSelectTimer = null;
          onSelectRef.current(front);
        }, DOUBLE_CLICK_WINDOW_MS);
        return;
      }
      onSelectRef.current(front);
    };

    const handlePointerMove = (e) => {
      if (rotateGestureRef.current?.kind === 'drag') {
        handleRingDragMove(e);
        return;
      }
      if (rotateGizmo.isShown() && !arrowOverlay.isShown()) {
        setRayFromEvent(e);
        const index = rotateGizmo.pick(raycaster)?.index ?? -1;
        rotateGizmo.setHover(index);
        renderer.domElement.style.cursor = index >= 0 ? 'grab' : '';
        return;
      }
      if (!arrowOverlay.isShown()) return;
      setRayFromEvent(e);
      const index = arrowOverlay.pick(raycaster);
      arrowOverlay.setHover(index);
      renderer.domElement.style.cursor = index >= 0 ? 'pointer' : '';
    };

    // The gizmo's center grab area ('XYZ' in move mode, 'XYZE' in rotate mode) covers small parts, and
    // pressing it starts a zero-length drag; only arrow/plane/ring handles or a real move block a mate.
    const GIZMO_CENTER_AXES = new Set(['XYZ', 'XYZE']);
    const handleDoubleClick = (e) => {
      if (transform.dragging) return;
      if (wasDraggingRef.current && dragMovedRef.current) return;
      if (transform.object && transform.axis && !GIZMO_CENTER_AXES.has(transform.axis)) return;
      if (arrowOverlay.isShown()) return;
      if (performance.now() - lastArrowClickAt < 600) return; // second click of an arrow double-click
      if (rotateGizmo.isShown()) {
        setRayFromEvent(e);
        if (rotateGizmo.pick(raycaster)) return; // double-clicking a ring handle never mates
      }
      const selId = selectedIdRef.current;
      // The selected part may be behind another part; anywhere under the pointer counts
      if (!selId || !pickPartsAt(e).includes(selId)) return;
      cancelPendingSelect();
      handleMateRequest();
    };

    // Capture phase, so Esc only dismisses the arrows (or unselects the wheel ring) and doesn't reach
    // App's deselect handler. Esc in an angle field is handled by the field itself.
    const handleKeyDownCapture = (e) => {
      if (e.key !== 'Escape' || e.target?.tagName === 'INPUT') return;
      if (arrowOverlay.isShown()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideMateArrows();
        renderer.domElement.style.cursor = '';
      } else if (selectedRingRef.current >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectRing(-1);
      }
    };

    // With a ring selected, the wheel turns the part one snap step (5° when Free) per notch instead
    // of zooming; saved 300 ms after the last notch. Capture phase, ahead of OrbitControls' zoom.
    const WHEEL_NOTCH = 100; // deltaY of one mouse-wheel notch in pixel mode; trackpad deltas add up
    let wheelAccum = 0;
    const handleWheelCapture = (e) => {
      const ring = selectedRingRef.current;
      const setup = rotateSetupRef.current;
      if (ring < 0 || !setup || rotateGestureRef.current?.kind === 'drag') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const unit = e.deltaMode === 1 ? WHEEL_NOTCH / 3 : e.deltaMode === 2 ? WHEEL_NOTCH * 3 : 1;
      wheelAccum -= e.deltaY * unit; // scrolling up turns the positive way around the axis
      const notches = Math.trunc(wheelAccum / WHEEL_NOTCH);
      if (notches === 0) return;
      wheelAccum -= notches * WHEEL_NOTCH;
      const gesture = rotateGestureRef.current ?? beginRotateGesture('wheel', ring);
      if (!gesture || gesture.ring !== ring) return;
      const snap = rotationSnapDegRef.current;
      const step = snap > 0 ? snap : 5;
      let total = setup.angles[ring] + notches * step;
      if (snap > 0) total = Math.round(total / step) * step;
      turnSelectedTo(ring, total);
      clearTimeout(gesture.wheelTimer);
      gesture.wheelTimer = setTimeout(commitRotation, 300);
    };

    const handleContextMenu = (e) => e.preventDefault();

    renderer.domElement.addEventListener('pointerdown', handleRingPointerDown, true);
    renderer.domElement.addEventListener('pointerup', handleRingPointerUp, true);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('dblclick', handleDoubleClick);
    renderer.domElement.addEventListener('wheel', handleWheelCapture, { capture: true, passive: false });
    container.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDownCapture, true);

    // Each label sits just outside its ring, at the ring point furthest toward a per-ring screen
    // direction (so the X/Y/Z labels don't pile up where the rings cross)
    const LABEL_SCREEN_DIRS = { X: [1, -0.4], Y: [-1, 0.5], Z: [0.3, -1], Joint: [0.6, -0.8] };
    const placeAngleLabels = () => {
      const setup = rotateSetupRef.current;
      if (!setup || !rotateGizmo.isShown()) return;
      const pivotPx = projectToCanvas(setup.pivot);
      setup.rings.forEach((ring, i) => {
        const { u, v, radius } = rotateGizmo.frame(i);
        const [px, py] = LABEL_SCREEN_DIRS[ring.name];
        let best = null;
        let bestScore = -Infinity;
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          const point = setup.pivot.clone().addScaledVector(u, Math.cos(a) * radius).addScaledVector(v, Math.sin(a) * radius);
          const screen = projectToCanvas(point);
          const score = (screen.x - pivotPx.x) * px + (screen.y - pivotPx.y) * py;
          if (score > bestScore) {
            bestScore = score;
            best = screen;
          }
        }
        const out = best.clone().sub(pivotPx);
        if (out.lengthSq() > 1e-6) best.addScaledVector(out.normalize(), 22);
        const inFront = setup.pivot.clone().project(camera).z < 1;
        angleLabels.place(i, best.x, best.y, inFront);
      });
    };

    const resizeObserver = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(container);

    let animFrameId;
    const animate = () => {
      animFrameId = requestAnimationFrame(animate);
      orbit.update();
      arrowOverlay.updateScale(camera);
      rotateGizmo.updateScale(camera);
      placeAngleLabels();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handleRingPointerDown, true);
      renderer.domElement.removeEventListener('pointerup', handleRingPointerUp, true);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('dblclick', handleDoubleClick);
      renderer.domElement.removeEventListener('wheel', handleWheelCapture, { capture: true });
      container.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDownCapture, true);
      cancelPendingSelect();
      clearTimeout(rotateGestureRef.current?.wheelTimer);
      rotateGestureRef.current = null;
      transform.dispose();
      orbit.dispose();
      holeOverlay.dispose();
      arrowOverlay.dispose();
      rotateGizmo.dispose();
      angleLabels.dispose();
      renderer.dispose();
    };
  }, []);

  // Sync snapping settings. TransformControls only ever moves (Rotate mode uses the ring gizmo).
  useEffect(() => {
    const transform = transformRef.current;
    if (!transform) return;
    // Keep TransformControls raw translation unsnapped so our custom world-grid + BVH flush-boundary
    // solver in `objectChange` can stop smoothly at 0.25P (3.175mm) flush faces before penetration.
    transform.setTranslationSnap(null);
    rotateGizmoRef.current?.setSnap(rotationSnapDeg > 0 ? rotationSnapDeg : 0);
  }, [snapPitchFactor, rotationSnapDeg]);

  // Switch between the Move gizmo and the rotate rings; entering Rotate mode starts every ring at 0°
  useEffect(() => {
    if (!transformRef.current) return;
    hideMateArrows();
    rotateSetupRef.current = null;
    syncGizmos();
  }, [transformMode]);

  // Sync Grid visibility
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.visible = showGrid;
    }
  }, [showGrid]);

  // Sync placed instances & explode offsets with Three.js scene objects
  useEffect(() => {
    const partsRoot = partGroupRef.current;
    const explodeLinesGroup = explodeLinesGroupRef.current;
    const transform = transformRef.current;
    if (!partsRoot || !transform || !explodeLinesGroup) return;

    const currentById = new Map(instances.map((i) => [i.instanceId, i]));

    // Remove deleted instances or instances whose partId changed
    for (const [instId, group] of meshMapRef.current.entries()) {
      const currentInst = currentById.get(instId);
      if (!currentInst || group.userData.partId !== currentInst.partId) {
        if (transform.object === group) {
          transform.detach();
        }
        partsRoot.remove(group);
        meshMapRef.current.delete(instId);
      }
    }

    // Compute visual exploded positions
    const explodedPosMap = computeExplodedPositions(instances, explodeMode, 1.15);

    // Clear and rebuild explode trace lines when explodeMode !== 'off'
    while (explodeLinesGroup.children.length > 0) {
      const line = explodeLinesGroup.children[0];
      explodeLinesGroup.remove(line);
      if (line.geometry) line.geometry.dispose();
      if (line.material) line.material.dispose();
    }

    if (explodeMode !== 'off') {
      const traceMat = new THREE.LineDashedMaterial({
        color: 0x38bdf8,
        dashSize: 5,
        gapSize: 3,
        transparent: true,
        opacity: 0.65
      });

      for (const inst of instances) {
        if (inst.visible === false) continue;
        const expPos = explodedPosMap.get(inst.instanceId) || inst.position;
        const dist = Math.hypot(
          expPos[0] - inst.position[0],
          expPos[1] - inst.position[1],
          expPos[2] - inst.position[2]
        );
        if (dist > 1) {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(...inst.position),
            new THREE.Vector3(...expPos)
          ]);
          const line = new THREE.Line(geo, traceMat);
          line.computeLineDistances();
          explodeLinesGroup.add(line);
        }
      }
    }

    // First pass: create/update groups and set transforms
    instances.forEach((inst) => {
      const partMeta = catalogMap.get(inst.partId);
      if (!partMeta) return;

      let group = meshMapRef.current.get(inst.instanceId);
      if (!group) {
        group = new THREE.Group();
        group.userData.instanceId = inst.instanceId;
        group.userData.partId = inst.partId;
        meshMapRef.current.set(inst.instanceId, group);
        partsRoot.add(group);

        onLoadingChange?.(true);
        loadPartAsset(partMeta)
          .then(({ geometries, collisionGeometries, localBox }) => {
            if (!meshMapRef.current.has(inst.instanceId)) return;
            group.userData.collisionGeometries = collisionGeometries;
            group.userData.localBox = localBox;

            const material = new THREE.MeshStandardMaterial({
              color: new THREE.Color(inst.color || partMeta.defaultColor),
              roughness: 0.38,
              metalness: 0.12
            });

            geometries.forEach((geo) => {
              const mesh = new THREE.Mesh(geo, material);
              mesh.userData.instanceId = inst.instanceId;
              mesh.userData.isPartMesh = true;
              group.add(mesh);

              const edgesGeo = new THREE.EdgesGeometry(geo, 32);
              const edgesMat = new THREE.LineBasicMaterial({
                color: 0x0f172a,
                transparent: true,
                opacity: 0.28
              });
              const edges = new THREE.LineSegments(edgesGeo, edgesMat);
              edges.name = '__cad_edges__';
              group.add(edges);
            });

            const latestInst = instancesRef.current.find(
              (i) => i.instanceId === inst.instanceId
            );
            const isSelectedNow = selectedIdRef.current === inst.instanceId;
            const isColliding = checkGroupCollision(
              group,
              explodeModeRef.current !== 'off'
            );
            group.userData.isIntersecting = isColliding;

            applyGroupAppearance(group, {
              baseColor: latestInst?.color || partMeta.defaultColor,
              isSelected: isSelectedNow,
              isIntersecting: isColliding
            });

            if (isColliding !== Boolean(latestInst?.isIntersecting)) {
              onUpdateTransformRef.current(inst.instanceId, {
                isIntersecting: isColliding
              });
            }

            // Mesh is now available: re-place highlight rings on the measured surfaces
            rebuildOtherFeatures();
            updateAlignedHoleHighlights();
            refreshRotateSetup();
          })
          .catch((err) => {
            console.error('Failed to load GLB for part:', partMeta.name, err);
          })
          .finally(() => {
            onLoadingChange?.(false);
          });
      }

      group.visible = inst.visible !== false;
      const displayPos = explodedPosMap.get(inst.instanceId) || inst.position;
      const isBeingTurned = rotateGestureRef.current?.instanceId === inst.instanceId;
      if ((!transform.dragging || transform.object !== group) && !isBeingTurned) {
        group.position.set(displayPos[0], displayPos[1], displayPos[2]);
        group.rotation.set(
          THREE.MathUtils.degToRad(inst.rotation[0]),
          THREE.MathUtils.degToRad(inst.rotation[1]),
          THREE.MathUtils.degToRad(inst.rotation[2])
        );
      }
    });

    // Second pass: evaluate collision (at assembled coordinates) & update appearance
    instances.forEach((inst) => {
      const partMeta = catalogMap.get(inst.partId);
      const group = meshMapRef.current.get(inst.instanceId);
      if (!partMeta || !group) return;

      const isSelected = selectedId === inst.instanceId;
      const isColliding = group.userData.collisionGeometries
        ? checkGroupCollision(group, explodeMode !== 'off')
        : Boolean(inst.isIntersecting);
      group.userData.isIntersecting = isColliding;

      applyGroupAppearance(group, {
        baseColor: inst.color || partMeta.defaultColor,
        isSelected,
        isIntersecting: isColliding
      });

      const existingOverlay = group.getObjectByName('__connector_overlay__');
      if (existingOverlay) {
        group.remove(existingOverlay);
      }
      if (showConnectors && isSelected && (partMeta.ports?.length > 0 || partMeta.cylinders?.length > 0)) {
        const overlay = createConnectorAxesGroup(partMeta);
        group.add(overlay);
      }
    });

    // Any scene change (selection, Explode, hide, server sync, a committed mate) makes shown mate
    // plans stale, so dismiss the arrows
    hideMateArrows();
    rebuildOtherFeatures();
    // Move gizmo or rotate rings (none while exploded, to prevent offset confusion)
    syncGizmos();
    updateAlignedHoleHighlights();
  }, [instances, selectedId, catalogMap, showConnectors, explodeMode]);

  // Camera Focus / Frame trigger (key 'F' or toolbar button)
  useEffect(() => {
    if (!focusTrigger) return;
    const camera = cameraRef.current;
    const orbit = orbitRef.current;
    const partsRoot = partGroupRef.current;
    if (!camera || !orbit || !partsRoot) return;

    const box = new THREE.Box3();
    if (selectedId && meshMapRef.current.has(selectedId)) {
      box.setFromObject(meshMapRef.current.get(selectedId));
    } else if (partsRoot.children.length > 0) {
      box.setFromObject(partsRoot);
    }

    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 40);
      const dir = camera.position.clone().sub(orbit.target).normalize();
      orbit.target.copy(center);
      camera.position.copy(center).addScaledVector(dir, maxDim * 2.1);
      orbit.update();
    } else {
      orbit.target.set(0, 0, 0);
      camera.position.set(220, 170, 240);
      orbit.update();
    }
  }, [focusTrigger]);

  return <div ref={containerRef} className="viewport-canvas" />;
}
