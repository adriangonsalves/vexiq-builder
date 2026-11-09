import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { explodedOffsets } from '../utils/explodePlan.js';
import { MeshBVH } from 'three-mesh-bvh';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadPartAsset, loadSheetPattern, RUBBER_COLOR, isMetalPart, isClearPlasticPart, METAL_SHAFT_COLOR } from '../utils/geometryCache.js';
import { derivedPartById, shapedPart } from '../utils/shapedParts.js';
import { SHEET_PRESS_MM, isPlasticSheet } from '../utils/sheetBend.js';
import { sheetFlexDepth, sheetsStacked } from '../utils/sheetContact.js';
import { hubMatrix, isShaftInMotorSocket } from '../utils/motorHub.js';
import { isMeshingGear, meshTurn, worldToothed } from '../utils/gearMeshing.js';
import { squareFitRoll } from '../utils/shaftGroups.js';
import { settlePlacement } from '../utils/placementFit.js';
import { isTireOnHub } from '../utils/tireFit.js';
import { isChainFit } from '../utils/chainFit.js';
import { batteryBayPose } from '../utils/batteryBay.js';
import { setGridPivot, wholeGroupOf } from '../utils/partGroups.js';
import {
  HOLE_SNAP_AXIAL_REACH_MM,
  MAX_AXIAL_GAP_MM,
  PARALLEL_MIN_DOT,
  collectWorldFeatures,
  findAlignedOpenings,
  findEngagedJoints,
  parallelLines,
  findHoleSnap,
  findStraighten,
  findTooWideInserts,
  freeSetFeatures,
  freeSetLeadEnds,
  listSetInsertFits,
  setLeadsFacing,
  HOLE_SNAP_RADIUS_MM,
  SET_HOLE_SNAP_AXIAL_REACH_MM,
  getLocalFeatures,
  gridPivot,
  boreTargets,
  clearSpotAlongLine,
  insertFitsOpening,
  isBorePart,
  isOpeningTaken,
  listBoreFits,
  listTargetFits,
  listInsertFits,
  measureOpeningPassRadii,
  measureOpeningSurfaces,
  measurePinEnds,
  mateAction,
  measureShaftProfiles,
  openFaces,
  holesFilledByFit,
  planMates,
  worldPartBox
} from '../utils/pinHoleAlignment.js';

const VEX_PITCH_MM = 12.7; // 1x VEX IQ Pitch = 0.5 inch = 12.7 mm
const HOLE_HIGHLIGHT_COLOR = 0xf97316; // orange: distinct from Axes overlay, selection, collision & gizmo colors
const CLEAR_PLASTIC_EDGE_COLOR = 0xd5dbe3; // a clear sheet's hole rims and outline (light grey rings)
const CLEAR_PLASTIC_EDGE_OPACITY = 0.85;
const SHEET_PATTERN_OPACITY = 0.55; // the printed lattice on clear sheets
const COLLISION_EROSION_MM = 0.38; // collision meshes are eroded inward by this much (see geometryCache.js)
const _pieceMatrix = new THREE.Matrix4();
const _pieceInverse = new THREE.Matrix4();

const openingSurfaceCache = new Map(); // partId -> Map(featureId -> { lo, hi }) measured on the mesh
const pinEndCache = new Map(); // partId -> Map(featureId -> { lo, hi }) which pin ends stick out
const passRadiusCache = new Map(); // partId -> Map(featureId -> widest a part may be to pass through)
const shaftProfileCache = new Map(); // partId -> Map(featureId -> [{ t, r }]) shaft width along its length
const rawBvhs = new WeakMap(); // render geometry -> BVH over the real (unshrunk) mesh

/** Distance to the nearest real (unshrunk) surface along a part-local ray, or null on a miss. */
function createRawRaycaster(geos) {
  const ray = new THREE.Ray();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const trees = geos.map((geo) => {
    if (!rawBvhs.has(geo)) rawBvhs.set(geo, new MeshBVH(geo));
    return rawBvhs.get(geo);
  });
  return (originArr, dirArr) => {
    ray.set(origin.fromArray(originArr), dir.fromArray(dirArr));
    let best = null;
    for (const tree of trees) {
      const hit = tree.raycastFirst(ray, THREE.DoubleSide);
      if (hit && (best == null || hit.distance < best)) best = hit.distance;
    }
    return best;
  };
}

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
  // Hole and shaft widths come from the real mesh: shrinking leaves a 0.8 mm shaft cap a sliver
  const renderGeos = group.userData.renderGeometries;
  if (renderGeos?.length && !passRadiusCache.has(partMeta.id)) {
    const raw = createRawRaycaster(renderGeos);
    passRadiusCache.set(partMeta.id, measureOpeningPassRadii(partMeta, raw));
    shaftProfileCache.set(partMeta.id, measureShaftProfiles(partMeta, raw));
  }
  return {
    surfaces: openingSurfaceCache.get(partMeta.id),
    pinEnds: pinEndCache.get(partMeta.id),
    passRadii: passRadiusCache.get(partMeta.id),
    profiles: shaftProfileCache.get(partMeta.id)
  };
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

// A part's holes in world space, from its group (a shaped copy's group carries the shaped part)
function groupWorldPorts(group, part) {
  const q = new THREE.Quaternion();
  group.matrixWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  return (part?.ports || []).map((p) => ({
    type: p.type,
    worldOrigin: new THREE.Vector3(...p.origin).applyMatrix4(group.matrixWorld).toArray(),
    worldAxis: new THREE.Vector3(...p.axis).applyQuaternion(q).toArray()
  }));
}

// Is a meeting between a plastic sheet and another part a tight fit: two stacked sheets, or a sheet
// that only has to flex SHEET_PRESS_MM to clear the part
function sheetContactIsTight(groupA, partA, groupB, partB) {
  const sheetA = isPlasticSheet(partA);
  const sheetB = isPlasticSheet(partB);
  if (sheetA && sheetB) return sheetsStacked(groupWorldPorts(groupA, partA), groupWorldPorts(groupB, partB));
  const [sheetGroup, otherGroup] = sheetA ? [groupA, groupB] : [groupB, groupA];
  const withBvh = (geo) => {
    if (!geo.boundsTree) geo.boundsTree = new MeshBVH(geo);
    return geo;
  };
  const sheetGeos = sheetGroup.userData.renderGeometries || [];
  const otherGeos = otherGroup.userData.renderGeometries || [];
  if (!sheetGeos.length || !otherGeos.length) return false;
  return sheetGeos.every((sg) => otherGeos.every((og) => sheetFlexDepth(withBvh(sg), sheetGroup.matrixWorld, withBvh(og), otherGroup.matrixWorld, SHEET_PRESS_MM) <= SHEET_PRESS_MM));
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
 * World size that keeps an overlay at a constant size on screen at `position`: the same factor
 * TransformControls uses for its gizmo, for perspective and orthographic cameras.
 */
function gizmoScaleFactor(camera, position) {
  if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / camera.zoom;
  return position.distanceTo(camera.position) * Math.min((1.9 * Math.tan((Math.PI * camera.fov) / 360)) / camera.zoom, 7);
}

const SHADOW_MAP_SIZE = 4096; // shadow-map texels per side

// Lighting, after VEX's own viewer (instructions.online): one strong light from over the viewer's
// shoulder that turns with the camera, little light from all round, matte plastic. Faces turned
// toward the viewer come out clearly brighter than the sides, so parts read as solid.
const KEY_LIGHT_FROM_VIEW = new THREE.Vector3(0.35, 0.9, 1).normalize(); // camera frame: right, up, back
const PLASTIC_REFLECTION_SHARE = 0.35; // plastic gets this much of the room reflection; metal all of it
const PLASTIC_ROUGHNESS = 0.8;

/** Gives a metal part's material the room reflection at the full chosen strength (none when off). */
function setMetalReflection(material, scene) {
  material.userData.metalReflection = true;
  const on = Boolean(scene?.environment);
  material.envMap = on ? scene.environment : null;
  material.envMapIntensity = on && scene.environmentIntensity ? scene.environmentIntensity / PLASTIC_REFLECTION_SHARE : 0;
  material.needsUpdate = true;
}

/** World direction toward the key light for `cam`: over its shoulder, whichever way it faces. */
function keyLightDirection(cam, out = new THREE.Vector3()) {
  return out.copy(KEY_LIGHT_FROM_VIEW).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
}

/** The 8 corners of a box. */
function boxCorners(box) {
  const out = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) out.push(new THREE.Vector3(x, y, z));
  return out;
}

/** Axis-aligned bounds of `points` after `matrix` (e.g. into a light's view space). */
function lightSpaceBounds(points, matrix) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  const v = new THREE.Vector3();
  for (const p of points) {
    v.copy(p).applyMatrix4(matrix);
    b.minX = Math.min(b.minX, v.x);
    b.maxX = Math.max(b.maxX, v.x);
    b.minY = Math.min(b.minY, v.y);
    b.maxY = Math.max(b.maxY, v.y);
    b.minZ = Math.min(b.minZ, v.z);
    b.maxZ = Math.max(b.maxZ, v.z);
  }
  return b;
}

/**
 * Corners of `cam`'s view, cut to the depths where `scenePoints` lie (so a far plane 5 m away
 * doesn't swamp the region), or null when the scene is behind the camera.
 */
function viewFrustumCorners(cam, scenePoints) {
  cam.updateMatrixWorld();
  const origin = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
  const forward = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).normalize().negate();
  const depths = scenePoints.map((p) => p.clone().sub(origin).dot(forward));
  const far = Math.max(...depths);
  if (cam.isPerspectiveCamera && far <= cam.near) return null;
  const near = cam.isPerspectiveCamera ? Math.max(cam.near, Math.min(...depths)) : Math.min(...depths);
  const corners = [];
  for (const d of [near, far]) {
    const hh = cam.isPerspectiveCamera ? (d * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))) / cam.zoom : (cam.top - cam.bottom) / 2 / cam.zoom;
    const hw = cam.isPerspectiveCamera ? hh * cam.aspect : (cam.right - cam.left) / 2 / cam.zoom;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      corners.push(origin.clone().addScaledVector(forward, d).addScaledVector(right, sx * hw).addScaledVector(up, sy * hh));
    }
  }
  return corners;
}

/** Fits a camera's frustum to a pane's shape (orthographic: keeps its view height at zoom 1). */
function fitCameraToPane(cam, pane) {
  const aspect = pane.width / pane.height;
  if (cam.isPerspectiveCamera) {
    cam.aspect = aspect;
  } else {
    const h = cam.userData.viewHeight;
    cam.top = h / 2;
    cam.bottom = -h / 2;
    cam.left = (-h * aspect) / 2;
    cam.right = (h * aspect) / 2;
  }
  cam.updateProjectionMatrix();
}

const TOUCH_PROBE_MM = 2 * COLLISION_EROSION_MM + 0.15; // closer than this (~0.9 mm) counts as touching
const PICK_COLOR = 0x22d3ee; // cyan: the hovered hole and the preview while picking a hole
const PICK_TAKEN_COLOR = 0x9ca3af; // grey: a hovered hole that already has a part in it
const TARGET_COLOR = 0xe879f9; // magenta: the target hole or pin end (target-hole-placement)

/**
 * Overlay for hole picking: a ring on the hovered hole face (cyan, grey when taken), a see-through
 * copy of the selected part at the previewed fit, and green/red discs where its other pins meet the
 * face plane. Lives on the scene root, so click picking ignores it; draws through parts.
 */
function createPickOverlay({ color = PICK_COLOR, name = '__hole_pick__' } = {}) {
  const group = new THREE.Group();
  group.name = name;
  const ringMaterials = {
    open: new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false }),
    taken: new THREE.MeshBasicMaterial({ color: PICK_TAKEN_COLOR, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95, toneMapped: false })
  };
  const ringGeos = new Map(); // rim radius -> RingGeometry
  const ringGeoFor = (r) => {
    const key = r.toFixed(3);
    if (!ringGeos.has(key)) ringGeos.set(key, new THREE.RingGeometry(r, r + 0.9, 40));
    return ringGeos.get(key);
  };
  const rings = [];
  const ghostMaterial = new THREE.MeshBasicMaterial({ color: PICK_COLOR, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const ghost = new THREE.Group();
  ghost.visible = false;
  group.add(ghost);
  const markerGeo = new THREE.CircleGeometry(2.4, 24);
  const markerMaterials = {
    green: new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false }),
    red: new THREE.MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, depthTest: false, depthWrite: false, toneMapped: false })
  };
  const markers = [];
  const zAxis = new THREE.Vector3(0, 0, 1);

  /** Rings on hole faces: [{ point, outward, radiusMm, taken }] (cyan, grey when taken). */
  const showRings = (faces) => {
    while (rings.length < faces.length) {
      const ring = new THREE.Mesh(ringGeoFor(3.175), ringMaterials.open);
      ring.renderOrder = 1003;
      group.add(ring);
      rings.push(ring);
    }
    rings.forEach((ring, i) => {
      const face = faces[i];
      ring.visible = Boolean(face);
      if (!face) return;
      ring.geometry = ringGeoFor(face.radiusMm ?? 3.175);
      ring.material = face.taken ? ringMaterials.taken : ringMaterials.open;
      ring.position.copy(face.point).addScaledVector(face.outward, 0.2);
      ring.quaternion.setFromUnitVectors(zAxis, face.outward);
    });
  };
  /** One ring on a hole face, or null to hide the rings. */
  const showRing = (face) => showRings(face ? [face] : []);
  /** See-through copy of a part group's meshes (built once per pick). */
  const setGhostSource = (sourceGroup) => {
    ghost.clear();
    sourceGroup?.traverse((child) => {
      if (child.isMesh && child.userData.isPartMesh) {
        const copy = new THREE.Mesh(child.geometry, ghostMaterial);
        copy.position.copy(child.position);
        copy.quaternion.copy(child.quaternion);
        copy.renderOrder = 1001;
        ghost.add(copy);
      }
    });
  };
  /** See-through copy of several part groups (a set), in world space (built once per pick). */
  const setGhostSources = (sourceGroups) => {
    ghost.clear();
    for (const sourceGroup of sourceGroups) {
      sourceGroup.updateMatrixWorld(true);
      sourceGroup.traverse((child) => {
        if (child.isMesh && child.userData.isPartMesh) {
          const copy = new THREE.Mesh(child.geometry, ghostMaterial);
          child.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
          copy.renderOrder = 1001;
          ghost.add(copy);
        }
      });
    }
  };
  /** Pose of the preview copy ({ position, quaternion }), or null to hide it. */
  const showGhost = (pose) => {
    ghost.visible = Boolean(pose);
    if (!pose) return;
    ghost.position.copy(pose.position);
    ghost.quaternion.copy(pose.quaternion);
  };
  /** Discs: [{ point, green }] facing `normal`. */
  const showMarkers = (list, normal) => {
    while (markers.length < list.length) {
      const m = new THREE.Mesh(markerGeo, markerMaterials.green);
      m.renderOrder = 1004;
      group.add(m);
      markers.push(m);
    }
    markers.forEach((m, i) => {
      const entry = list[i];
      m.visible = Boolean(entry);
      if (!entry) return;
      m.material = entry.green ? markerMaterials.green : markerMaterials.red;
      m.position.copy(entry.point).addScaledVector(normal, 0.4);
      m.quaternion.setFromUnitVectors(zAxis, normal);
    });
  };
  const clear = () => {
    showRing(null);
    showGhost(null);
    showMarkers([], zAxis);
    ghost.clear();
  };
  const dispose = () => {
    for (const geo of ringGeos.values()) geo.dispose();
    ringMaterials.open.dispose();
    ringMaterials.taken.dispose();
    ghostMaterial.dispose();
    markerGeo.dispose();
    markerMaterials.green.dispose();
    markerMaterials.red.dispose();
  };
  return { group, showRing, showRings, setGhostSource, setGhostSources, showGhost, showMarkers, clear, dispose };
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

  const updateScale = (camera) => {
    if (!group.visible) return;
    for (const arrow of arrows.slice(0, shownCount)) {
      const factor = gizmoScaleFactor(camera, arrow.root.position);
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

  // Straight lines in world mm (the group is never scaled): the line the chosen ring turns about,
  // and for a held part the anchor lines it could turn about instead, plus a dashed line back to
  // its default centre. Each is centred on the point of its line nearest the part's centre.
  // Fat lines (a set width in screen pixels), easier to see and to click than 1 px lines
  const lineMaterial = (color, opacity, dashed = false, linewidth = dashed ? 2 : 3) =>
    new LineMaterial({
      color,
      linewidth,
      transparent: true,
      opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      dashed,
      dashSize: 3,
      gapSize: 2
    });
  const makeLine = (material) => {
    const line = new Line2(new LineGeometry(), material);
    line.renderOrder = 1006;
    line.visible = false;
    line.frustumCulled = false;
    group.add(line);
    return line;
  };
  const axisLine = makeLine(lineMaterial(0xffffff, 0.95));
  // A soft glow under the turning axis while its ring is selected or dragged, so it stands out
  const axisHalo = makeLine(lineMaterial(0xffffff, 0.3, false, 14));
  axisHalo.renderOrder = 1005;
  const defaultLine = makeLine(lineMaterial(0xffffff, 0.7, true));
  const anchorLines = []; // THREE.Line pool
  let anchorDefs = []; // [{ origin, axis }] in world space, as shown
  let defaultDef = null;
  let anchorHover = null; // { kind: 'anchor', index } | { kind: 'default' } | null
  // Anchor lines are thinner and fainter than the turning axis; the one under the pointer thickens
  const refreshAnchorLooks = () => {
    anchorLines.forEach((line, i) => {
      const hot = anchorHover?.kind === 'anchor' && anchorHover.index === i;
      line.material.linewidth = hot ? 4.5 : 2.5;
      line.material.opacity = hot ? 1 : 0.75;
    });
    const hot = anchorHover?.kind === 'default';
    defaultLine.material.linewidth = hot ? 3.5 : 2;
    defaultLine.material.opacity = hot ? 1 : 0.7;
  };
  let lineCenter = new THREE.Vector3();
  let lineHalfMm = 20;

  /** Puts `line` along the world line (origin, axis), centred near the part's centre. */
  const placeLine = (line, origin, axis) => {
    const dir = axis.clone().normalize();
    const mid = origin.clone().addScaledVector(dir, lineCenter.clone().sub(origin).dot(dir)).sub(group.position);
    const a = mid.clone().addScaledVector(dir, -lineHalfMm);
    const b = mid.clone().addScaledVector(dir, lineHalfMm);
    line.geometry.dispose();
    line.geometry = new LineGeometry().setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
    if (line.material.dashed) line.computeLineDistances();
    line.visible = true;
  };
  /** The line's two ends in world space, for picking. */
  const lineEnds = (origin, axis) => {
    const dir = axis.clone().normalize();
    const mid = origin.clone().addScaledVector(dir, lineCenter.clone().sub(origin).dot(dir));
    return [mid.clone().addScaledVector(dir, -lineHalfMm), mid.clone().addScaledVector(dir, lineHalfMm)];
  };

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
    // One turning axis: the dragged ring's, else the selected ring's, else the hovered ring's
    const shown = [dragIndex, selectedIndex, hoverIndex].find((i) => i >= 0 && i < shownCount);
    if (shown === undefined || !group.visible) {
      axisLine.visible = false;
      axisHalo.visible = false;
    } else {
      const axis = zAxis.clone().applyQuaternion(rings[shown].root.quaternion);
      const chosen = shown === dragIndex || shown === selectedIndex;
      axisLine.material.color.copy(rings[shown].color);
      axisLine.material.linewidth = chosen ? 5 : 3;
      placeLine(axisLine, group.position, axis);
      if (chosen) {
        axisHalo.material.color.copy(rings[shown].color);
        placeLine(axisHalo, group.position, axis);
      } else {
        axisHalo.visible = false;
      }
    }
  };

  /** Anchor lines `defs` ([{ origin, axis }], world) and the dashed default-centre line (or null). */
  const setAnchorLines = (defs, dashed) => {
    anchorDefs = group.visible ? defs : [];
    defaultDef = group.visible ? dashed : null;
    while (anchorLines.length < anchorDefs.length) anchorLines.push(makeLine(lineMaterial(HOLE_HIGHLIGHT_COLOR, 0.95)));
    anchorLines.forEach((line, i) => {
      if (i < anchorDefs.length) placeLine(line, anchorDefs[i].origin, anchorDefs[i].axis);
      else line.visible = false;
    });
    if (defaultDef) placeLine(defaultLine, defaultDef.origin, defaultDef.axis);
    else defaultLine.visible = false;
    anchorHover = null;
    refreshAnchorLooks();
  };

  /** Thickens the anchor or default line under the pointer (a pickAnchor result, or null). */
  const setAnchorHover = (picked) => {
    if (picked?.kind === anchorHover?.kind && picked?.index === anchorHover?.index) return;
    anchorHover = picked;
    refreshAnchorLooks();
  };

  /**
   * The shown anchor or default line nearest the pointer on screen, within `maxPx`:
   * { kind: 'anchor', index } | { kind: 'default' } | null. `project` maps a world point to canvas px.
   */
  const pickAnchor = (pointerPx, project, maxPx = 6) => {
    if (!group.visible) return null;
    const distTo = (def) => {
      const [a, b] = lineEnds(def.origin, def.axis).map(project);
      const ab = b.clone().sub(a);
      const t = ab.lengthSq() > 1e-9 ? THREE.MathUtils.clamp(pointerPx.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0;
      return a.addScaledVector(ab, t).distanceTo(pointerPx);
    };
    let best = null;
    let bestPx = maxPx;
    anchorDefs.forEach((def, index) => {
      const px = distTo(def);
      if (px <= bestPx) {
        bestPx = px;
        best = { kind: 'anchor', index };
      }
    });
    if (defaultDef) {
      const px = distTo(defaultDef);
      if (px <= bestPx) best = { kind: 'default' };
    }
    return best;
  };

  /**
   * `rings`: [{ axis (unit), color (hex), minRadius (world mm) }], all turning about `pivot`.
   * `center` (the part's centre) and `lineHalfMm` place the axis and anchor lines.
   */
  const show = (pivot, ringDefs, { center = pivot, halfMm = 20 } = {}) => {
    while (rings.length < ringDefs.length) rings.push(makeRing());
    group.position.copy(pivot);
    lineCenter = center.clone();
    lineHalfMm = halfMm;
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
    axisLine.visible = false;
    axisHalo.visible = false;
    setAnchorLines([], null);
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

  const updateScale = (camera, width, height) => {
    if (!group.visible) return;
    if (width && height) for (const line of [axisLine, axisHalo, defaultLine, ...anchorLines]) line.material.resolution.set(width, height);
    const factor = gizmoScaleFactor(camera, group.position);
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
    for (const line of [axisLine, axisHalo, defaultLine, ...anchorLines]) {
      line.geometry.dispose();
      line.material.dispose();
    }
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
    setAnchorLines,
    setAnchorHover,
    pickAnchor,
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

const VIEW_CUBE_PX = 110; // on-screen size of the view cube's square
const VIEW_CUBE_RIGHT = 12; // gap to the main view's right edge
const VIEW_CUBE_TOP = 60; // below the top HUD pills
const VIEW_CUBE_LABELS = {
  '1,0,0': ['+X', 'Front'],
  '-1,0,0': ['−X', 'Back'],
  '0,1,0': ['+Y', 'Top'],
  '0,-1,0': ['−Y', 'Bottom'],
  '0,0,1': ['+Z', ''],
  '0,0,-1': ['−Z', '']
};

/**
 * The clickable view cube: its own scene and orthographic camera, drawn over the main view's
 * top-right corner. The cube's shell is split into 26 regions (6 faces, 12 edges, 8 corners); each
 * region's `direction` (the sum of its face normals) is the view a click turns the camera to.
 */
function createViewCube() {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1.75, 1.75, 1.75, -1.75, 0.1, 20);
  // Soft light from over the viewer's shoulder, so the faces read as a solid
  scene.add(new THREE.AmbientLight(0xffffff, 1.9));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
  keyLight.position.set(0.6, 1, 1);
  camera.add(keyLight);
  scene.add(camera);
  const colors = { face: 0xe2e8f0, edge: 0xb6c2d1, corner: 0x8796ab, hover: 0x22d3ee };
  const regions = [];
  const disposables = [];
  const span = (c) => (c === 0 ? [1.4, 0] : [0.3, 0.85 * c]); // [size, center] along one axis
  for (const i of [-1, 0, 1]) {
    for (const j of [-1, 0, 1]) {
      for (const k of [-1, 0, 1]) {
        const zeros = [i, j, k].filter((c) => c === 0).length;
        if (zeros === 3) continue;
        const kind = zeros === 2 ? 'face' : zeros === 1 ? 'edge' : 'corner';
        const [sx, cx] = span(i);
        const [sy, cy] = span(j);
        const [sz, cz] = span(k);
        const geo = new THREE.BoxGeometry(sx, sy, sz);
        const mat = new THREE.MeshLambertMaterial({ color: colors[kind] });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, cy, cz);
        mesh.userData = { kind, direction: new THREE.Vector3(i, j, k).normalize() };
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x475569 }));
        mesh.add(edges);
        scene.add(mesh);
        regions.push(mesh);
        disposables.push(geo, mat, edges.geometry, edges.material);
      }
    }
  }
  // Labels on the faces; top and bottom read with +X up, like the top and bottom views
  for (const [key, [axisText, name]] of Object.entries(VIEW_CUBE_LABELS)) {
    const normal = new THREE.Vector3(...key.split(',').map(Number));
    const up = Math.abs(normal.y) > 0.5 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${name ? 40 : 52}px system-ui, sans-serif`;
    ctx.fillText(axisText, 64, name ? 50 : 64);
    if (name) {
      ctx.font = '600 26px system-ui, sans-serif';
      ctx.fillText(name, 64, 90);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const geo = new THREE.PlaneGeometry(1.4, 1.4);
    const label = new THREE.Mesh(geo, mat);
    label.position.copy(normal).multiplyScalar(1.002);
    const right = new THREE.Vector3().crossVectors(up, normal);
    label.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
    label.raycast = () => {}; // clicks go to the face region under it
    scene.add(label);
    disposables.push(texture, mat, geo);
  }

  const raycaster = new THREE.Raycaster();
  let hovered = -1;
  return {
    scene,
    camera,
    /** Turns the cube to match the main camera's view direction. */
    sync(mainCamera) {
      camera.quaternion.copy(mainCamera.quaternion);
      camera.position.set(0, 0, 6).applyQuaternion(mainCamera.quaternion);
      camera.updateMatrixWorld();
    },
    /** Region index under a point given in the cube square's NDC, or -1. */
    pick(ndc) {
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObjects(regions, false)[0];
      return hit ? regions.indexOf(hit.object) : -1;
    },
    direction: (index) => regions[index].userData.direction.clone(),
    setHover(index) {
      if (index === hovered) return;
      if (hovered >= 0) regions[hovered].material.color.setHex(colors[regions[hovered].userData.kind]);
      hovered = index;
      if (index >= 0) regions[index].material.color.setHex(colors.hover);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    }
  };
}

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
 * Shown position of every part (openspec explode-view): assembled, plus the explode plan's offset at
 * slider value `amount` while Explode is open with a plan for its direction. Map<instanceId, [x, y, z]>.
 */
function explodedPositionsFor(instances, explodeMode, plan, amount) {
  const result = new Map();
  const offsets = explodeMode !== 'off' && plan?.mode === explodeMode ? explodedOffsets(plan, amount) : null;
  for (const inst of instances) {
    const o = offsets?.get(inst.instanceId);
    result.set(inst.instanceId, o ? inst.position.map((v, i) => v + o[i]) : [...inst.position]);
  }
  return result;
}

/**
 * Resolves the base display color for a part instance, ensuring non-plastic metal shafts
 * display in reflective metallic silver (#e2e8f0) even if saved with legacy default grey (#4b5563).
 */
function resolvePartBaseColor(inst, partMeta) {
  const isMetal = isMetalPart(partMeta);
  if (isMetal && (!inst?.color || inst.color === '#4b5563')) {
    return METAL_SHAFT_COLOR;
  }
  return inst?.color || partMeta?.defaultColor || (isMetal ? METAL_SHAFT_COLOR : '#64748b');
}

/**
 * Applies either normal VEX appearance or transparent-grey intersecting appearance
 * strictly to actual CAD part meshes (`child.userData.isPartMesh === true`).
 */
const EMPTY_IDS = [];
// How strongly a part is lit as selected: 2 = the primary (last) part, 1 = another selected part, 0 = not selected
const selectLevel = (ids, id) => (ids.at(-1) === id ? 2 : ids.includes(id) ? 1 : 0);

// Part meshes of selected parts are also on this layer, which the selection contour is drawn from
const SELECT_LAYER = 5;

// Clear plastic sheets: tinted, glossy, mostly see-through
const CLEAR_PLASTIC_OPACITY = 0.2;

// Selection look: an amber glow and amber edges, which stand out on blue parts and the blue grid.
// Primary (or only) selected part / other parts of a multi-selection.
const SELECT_COLOR = 0xff9f1c;
// The contour around selected parts: a bright yellow line with a dark rim
const SELECT_CONTOUR_COLOR = 0xffd400;
const SELECT_GLOW = { 2: 0.42, 1: 0.24 };
const SELECT_EDGE_OPACITY = { 2: 1, 1: 0.75 };
const ATTENTION_COLOR = new THREE.Color(HOLE_HIGHLIGHT_COLOR);

// isSelected: true or 2 = the primary (or only) selected part, 1 = another part of a multi-selection
function applyGroupAppearance(group, { baseColor, isSelected, isAttention = false, attentionPulse = 1, isIntersecting }) {
  const level = isIntersecting || !isSelected ? 0 : isSelected === 1 ? 1 : 2;
  const attention = isAttention && !isIntersecting;
  group.traverse((child) => {
    // The part's CAD edges become a bright contour while it is selected or highlighted for attention
    if (child.isLineSegments && child.name === '__cad_edges__' && child.material) {
      const mat = child.material;
      if (!child.userData.edgeLook) child.userData.edgeLook = { color: mat.color.getHex(), opacity: mat.opacity };
      const { color, opacity } = child.userData.edgeLook;
      mat.color.setHex(attention ? HOLE_HIGHLIGHT_COLOR : level ? SELECT_COLOR : color);
      mat.opacity = attention ? 1 : level ? SELECT_EDGE_OPACITY[level] : opacity;
      return;
    }
    if (!child.isMesh || !child.userData.isPartMesh || !child.material) return;
    const mat = child.material;
    const wasTransparent = mat.transparent;
    const wasDepthWrite = mat.depthWrite;
    if (isSelected) child.layers.enable(SELECT_LAYER);
    else child.layers.disable(SELECT_LAYER);

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
      let resolvedColor = child.userData.fixedColor || baseColor;
      if (!child.userData.fixedColor && child.userData.isMetal && (!resolvedColor || resolvedColor === '#4b5563')) {
        resolvedColor = METAL_SHAFT_COLOR;
      }
      mat.color.set(resolvedColor || '#64748b');
      if (attention) {
        mat.color.lerp(ATTENTION_COLOR, 0.35 + 0.35 * attentionPulse);
      }
      // Clear plastic sheets stay see-through; everything else is solid
      const clear = child.userData.clearPlastic;
      mat.transparent = Boolean(clear);
      mat.opacity = clear ? CLEAR_PLASTIC_OPACITY : 1.0;
      mat.depthWrite = !clear;
      if (mat.emissive) {
        if (attention) {
          mat.emissive.setHex(HOLE_HIGHLIGHT_COLOR);
          mat.emissiveIntensity = 0.45 + 0.55 * attentionPulse;
        } else {
          mat.emissive.setHex(level ? SELECT_COLOR : 0x000000);
          mat.emissiveIntensity = level ? SELECT_GLOW[level] : 0;
        }
      }
    }
    // Colours and opacity take effect without a rebuild; only a change of see-through rebuilds the
    // material (flagging every part each time made three.js rework all of them on the next frame)
    if (mat.transparent !== wasTransparent || mat.depthWrite !== wasDepthWrite) mat.needsUpdate = true;
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
  selectedIds = EMPTY_IDS,
  attentionIds = EMPTY_IDS,
  markedHoles = EMPTY_IDS,
  selectMode = false,
  boxSelect = false,
  onBoxSelect,
  onSelect,
  onExpandSelection,
  onUpdateTransform,
  onUpdateSet,
  onFitSet,
  onRegisterFlushMover,
  onRegisterScreenshot,
  onRegisterPartPoints,
  onRegisterViewSpot,
  placeRequest = null,
  onCancelPlace,
  onTargetChange,
  transformMode,
  snapPitchFactor,
  rotationSnapDeg,
  showGrid,
  showConnectors,
  explodeMode = 'off',
  explodeAmount = 1,
  explodePlan = null,
  playing = false,
  playFrame = null,
  focusTrigger,
  onLoadingChange,
  onMateFeedback,
  onToggleRotateRequest,
  collisionRecheck,
  onPickStatus,
  onCubeMenu,
  onInsertCopy,
  projection = 'perspective',
  viewLayout = 'single',
  stereoCrossEyed = false,
  stereoDepth = 1,
  viewAlongTrigger,
  immersive = false,
  shadows = false,
  ambientOcclusion = false,
  environmentReflections = true,
  reflectionIntensity = 0.75
}) {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const panesRef = useRef(null); // { main } pane rectangles, CSS px within the viewport
  const applyLayoutRef = useRef(null); // () => void: resize the canvas and panes
  const renderFrameRef = useRef(null); // () => void: draw every pane now
  const updateShadowsRef = useRef(null); // () => void: fit the shadow light and redraw its map
  const inputElRef = useRef(null); // the element over the main view that takes pointer input
  const activateCameraRef = useRef(null); // (camera) => void, set up with the controls
  // The camera pointer input is judged from: the main camera, or in stereo the working half's eye
  const pointerCameraRef = useRef(() => cameraRef.current);
  const perspCameraRef = useRef(null);
  const miniViewsRef = useRef([]); // four-view small views: [{ camera, el, auto, rect, ... }]
  const orthoCameraRef = useRef(null); // height of its view at zoom 1 in userData.viewHeight
  const shadowsRef = useRef(shadows);
  shadowsRef.current = shadows;
  const aoRef = useRef(ambientOcclusion);
  aoRef.current = ambientOcclusion;
  const envTextureRef = useRef(null);
  const envReflectionsRef = useRef(environmentReflections);
  envReflectionsRef.current = environmentReflections;
  const reflectionIntensityRef = useRef(reflectionIntensity);
  reflectionIntensityRef.current = reflectionIntensity;
  const viewLayoutRef = useRef(viewLayout);
  viewLayoutRef.current = viewLayout;
  const stereoRef = useRef({ crossEyed: stereoCrossEyed, depth: stereoDepth });
  stereoRef.current = { crossEyed: stereoCrossEyed, depth: stereoDepth };
  const rendererRef = useRef(null);
  const orbitRef = useRef(null);
  const transformRef = useRef(null);
  const gridRef = useRef(null);
  const partGroupRef = useRef(null);
  const meshMapRef = useRef(new Map()); // instanceId -> THREE.Group
  const wasDraggingRef = useRef(false);
  const dragMovedRef = useRef(false); // the last gizmo drag actually moved/rotated the part
  const dragStartPosRef = useRef(new THREE.Vector3());
  const dragStartQuatRef = useRef(new THREE.Quaternion()); // the part's turn when the drag began (its own axes)
  const lastClearDragPosRef = useRef(new THREE.Vector3());
  const lineSettleCacheRef = useRef({ key: '', settled: null }); // last along-the-line settle, per snapped pose
  const hasClearDragPosRef = useRef(false);
  const altKeyRef = useRef(false); // Alt held: drag without snapping onto holes
  // Hole picking (double-click with nothing lined up): { selId, ... } while picking, else null
  const pickModeRef = useRef(null);
  const pickOverlayRef = useRef(null);
  const copyPointerRef = useRef(null); // canvas px of the pointer over the viewport, for the copy preview
  const onCubeMenuRef = useRef(onCubeMenu);
  onCubeMenuRef.current = onCubeMenu;
  const onPickStatusRef = useRef(onPickStatus);
  onPickStatusRef.current = onPickStatus;
  const onInsertCopyRef = useRef(onInsertCopy);
  onInsertCopyRef.current = onInsertCopy;
  const onCancelPlaceRef = useRef(onCancelPlace);
  onCancelPlaceRef.current = onCancelPlace;
  // A library drag's release is still to come: it must not count as a click (easier-placing-and-fix-assembly)
  const pendingDropRef = useRef(false);
  const holeOverlayRef = useRef(null);
  const otherFeaturesRef = useRef([]); // [{ instanceId, box, features }] for visible non-selected parts
  const lastSceneSyncRef = useRef(null); // what the scene sync effect last applied, to spot selection-only changes
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

  // The catalog plus the shaped parts of copies with a shape (openspec shaped-parts-and-sheet-bending):
  // a group's userData.partId is the shaped part's id for such a copy
  const shapedCatalogMap = useMemo(() => ({ base: catalogMap, get: (id) => catalogMap.get(id) || derivedPartById(id) || undefined, has: (id) => catalogMap.has(id) || Boolean(derivedPartById(id)) }), [catalogMap]);
  const catalogMapRef = useRef(shapedCatalogMap);
  catalogMapRef.current = shapedCatalogMap;
  // A copy's part: shaped when it has a shape; a group's userData (partId may be a shaped part's id) works too
  const partFor = (inst) => (!inst ? null : inst.shape ? shapedPart(catalogMapRef.current.base.get(inst.partId), inst.shape) : catalogMapRef.current.get(inst.partId));

  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  // Every selected part (openspec outliner-part-groups); the last is the primary part
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  // Highlighted parts for a modal question (openspec chain-over-under), separate from selection
  const attentionIdsRef = useRef(attentionIds);
  attentionIdsRef.current = attentionIds;
  // Play mode (openspec play-mode): called every frame with the part groups to move them
  const playFrameRef = useRef(playFrame);
  playFrameRef.current = playing ? playFrame : null;
  // Holes another tool marks ([{ instanceId, portIds }], Bend sheet's choices): shown instead of the
  // selected part's lined-up openings while set
  const markedHolesRef = useRef(markedHoles);
  markedHolesRef.current = markedHoles;
  const prevAttentionIdsRef = useRef(EMPTY_IDS);
  const selectModeRef = useRef(selectMode);
  selectModeRef.current = selectMode;
  // Box select: a left-drag draws a rectangle instead of turning the camera
  const boxSelectRef = useRef(boxSelect);
  boxSelectRef.current = boxSelect;
  const onBoxSelectRef = useRef(onBoxSelect);
  onBoxSelectRef.current = onBoxSelect;
  const onExpandSelectionRef = useRef(onExpandSelection);
  onExpandSelectionRef.current = onExpandSelection;
  const onUpdateSetRef = useRef(onUpdateSet);
  onUpdateSetRef.current = onUpdateSet;
  const onFitSetRef = useRef(onFitSet);
  onFitSetRef.current = onFitSet;
  // Moving several parts as one (openspec outliner-part-groups): the Move arrows sit on this pivot at
  // the set's centre; a drag moves every member from where it started
  const setPivotRef = useRef(null);
  const setDragRef = useRef(null); // a set drag in progress (startSetDrag)
  const fitPendingRef = useRef(false); // a dropped set is being fitted: viewport input waits
  const straightenedRef = useRef(false); // the dragged part is turned square onto a hole line

  const explodeModeRef = useRef(explodeMode);
  explodeModeRef.current = explodeMode;
  const explodeAmountRef = useRef(explodeAmount);
  explodeAmountRef.current = explodeAmount;
  const explodePlanRef = useRef(explodePlan);
  explodePlanRef.current = explodePlan;

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
  const onTargetChangeRef = useRef(onTargetChange);
  onTargetChangeRef.current = onTargetChange;
  onMateFeedbackRef.current = onMateFeedback;

  const onToggleRotateRequestRef = useRef(onToggleRotateRequest);
  onToggleRotateRequestRef.current = onToggleRotateRequest;

  /**
   * Exact concave mesh-to-mesh intersection check using three-mesh-bvh on inward-eroded
   * collision geometries. Evaluates at true assembled positions even when exploded.
   */
  /** World pins/shafts/openings of a part's group, with mesh measurements. */
  const worldFeaturesOfGroup = (group) => {
    const partMeta = partFor(group.userData);
    if (!partMeta) return [];
    group.updateMatrixWorld(true);
    return collectWorldFeatures(partMeta, group.matrixWorld, group.userData.instanceId, getMeshMeasurements(group, partMeta));
  };

  /** A shaft part (straight or capped), whose width along its length is measured. */
  const isShaftGroup = (group) => {
    const partMeta = partFor(group.userData);
    return Boolean(partMeta && getMeshMeasurements(group, partMeta)?.profiles?.size);
  };

  /**
   * Moving `group` straight from `fromPos` to its current position: the first position on the way
   * where a shaft section is inside a hole too narrow for it (e.g. a cap jumping past a beam's lip in
   * one grid step, where both ends of the move are clear), or null. Leaves the group where it was.
   */
  const firstTooNarrowCrossing = (group, fromPos) => {
    const toPos = group.position.clone();
    const distance = toPos.distanceTo(fromPos);
    const neighbours = otherFeaturesRef.current.flatMap((o) => o.features);
    if (distance < 0.2 || (!isShaftGroup(group) && !neighbours.some((f) => f.profile))) return null;
    const steps = Math.ceil(distance / 0.25);
    let crossing = null;
    for (let i = 1; i < steps && !crossing; i++) {
      group.position.lerpVectors(fromPos, toPos, i / steps);
      if (findTooWideInserts(worldFeaturesOfGroup(group), neighbours).length > 0) crossing = group.position.clone();
    }
    group.position.copy(toPos);
    group.updateMatrixWorld(true);
    return crossing;
  };

  /**
   * Poses a Smart Motor's hub pieces (render and collision) at `deg` about its socket axis
   * (openspec square-shaft-fit). No-op for parts without a hub.
   */
  const applyHubAngle = (group, deg = 0) => {
    const hub = group?.userData.hub;
    if (!hub) return;
    const angle = Number(deg) || 0;
    if (hub.angle === angle) return;
    hub.angle = angle;
    const m = hubMatrix(hub.frame, angle);
    for (const obj of hub.objects) m.decompose(obj.position, obj.quaternion, obj.scale);
    const locals = (group.userData.collisionLocalMatrices ||= []);
    for (const i of hub.collisionIndices) locals[i] = angle ? m.clone() : null;
    group.updateMatrixWorld(true);
  };

  // ignoreIds: parts moving together with the target (a set), which never count as overlapping it.
  // hits: when given, every overlapped part's id is pushed to it (all of them, not just the first).
  // tightOk: a contact that only the normal collision mesh sees is a tight fit, not an overlap. Set
  // it where the result marks a part overlapping; moves that stop at first contact leave it off
  // Overlap answers per pair of parts, kept with both parts' poses and shapes (see pairLook): while
  // neither part moves, turns or changes shape, the answer is reused instead of testing the meshes again.
  // Hiding, showing, colouring or selecting a part re-runs the check for every part, so without this a
  // big robot spent seconds re-testing pairs that hadn't changed.
  const pairCacheRef = useRef(new Map());
  const pairCacheCatalogRef = useRef(null);
  /** What a pair's answer depends on, for one part: its world matrix, hub angle and collision shapes. */
  const pairLook = (group) => {
    const d = group.userData;
    return { m: group.matrixWorld.elements.slice(), hub: d.hub?.angle ?? 0, geos: d.collisionGeometries, deep: d.deepCollisionGeometries };
  };
  const sameLook = (look, group) => {
    const d = group.userData;
    if (look.geos !== d.collisionGeometries || look.deep !== d.deepCollisionGeometries || look.hub !== (d.hub?.angle ?? 0)) return false;
    const e = group.matrixWorld.elements;
    for (let k = 0; k < 16; k++) if (look.m[k] !== e[k]) return false;
    return true;
  };
  /** A part's world box, worked out again only when its matrix has changed. */
  const worldBoxOf = (group) => {
    const d = group.userData;
    const e = group.matrixWorld.elements;
    const c = d.worldBoxCache;
    if (c && c.local === d.localBox && c.m.every((v, k) => v === e[k])) return c.box;
    const box = d.localBox.clone().applyMatrix4(group.matrixWorld);
    d.worldBoxCache = { local: d.localBox, m: e.slice(), box };
    return box;
  };

  const checkGroupCollision = (targetGroup, useAssembledPositions = false, ignoreIds = null, hits = null, tightOk = false) => {
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
    const worldBoxA = worldBoxOf(targetGroup);
    const invMatrixA = new THREE.Matrix4().copy(targetGroup.matrixWorld).invert();
    if (pairCacheCatalogRef.current !== catalogMapRef.current || pairCacheRef.current.size > 200000) {
      pairCacheRef.current.clear();
      pairCacheCatalogRef.current = catalogMapRef.current;
    }
    const pairCache = pairCacheRef.current;
    const idA = targetGroup.userData.instanceId;
    const matrixBtoA = new THREE.Matrix4();

    let collided = false;
    let anyHit = false;
    let featuresA; // worked out only when a shaft and a hole meet
    for (const [otherId, otherGroup] of meshMapRef.current.entries()) {
      if (otherId === targetGroup.userData.instanceId) continue;
      if (ignoreIds?.has(otherId)) continue;
      if (!otherGroup.visible) continue;

      const colGeosB = otherGroup.userData.collisionGeometries;
      const localBoxB = otherGroup.userData.localBox;
      if (!colGeosB || colGeosB.length === 0 || !localBoxB || localBoxB.isEmpty()) continue;

      otherGroup.updateWorldMatrix(true, false);
      const worldBoxB = worldBoxOf(otherGroup);

      if (!worldBoxA.intersectsBox(worldBoxB)) continue;
      const catalogMap = catalogMapRef.current;
      const partA = catalogMap.get(targetGroup.userData.partId);
      const partB = catalogMap.get(otherGroup.userData.partId);
      if (isTireOnHub(partA, targetGroup.matrixWorld, partB, otherGroup.matrixWorld)) continue;
      if (isChainFit(partA, targetGroup.matrixWorld, partB, otherGroup.matrixWorld)) continue;
      if (isShaftInMotorSocket(partA, targetGroup.matrixWorld, partB, otherGroup.matrixWorld)) continue;
      // The same pair (either way round: the tests below give the same answer both ways), neither part
      // changed since it was last tested: the same answer
      const aFirst = idA < otherId;
      const pairKey = `${aFirst ? idA : otherId}\u0000${aFirst ? otherId : idA}\u0000${tightOk ? 1 : 0}`;
      const cached = pairCache.get(pairKey);
      if (cached && sameLook(aFirst ? cached.a : cached.b, targetGroup) && sameLook(aFirst ? cached.b : cached.a, otherGroup)) {
        collided = cached.hit;
        if (collided && hits) {
          hits.push(otherId);
          anyHit = true;
          collided = false;
          continue;
        }
        if (collided) break;
        continue;
      }
      otherGroup.updateMatrixWorld(true);

      matrixBtoA.multiplyMatrices(invMatrixA, otherGroup.matrixWorld);
      // A turned motor hub's collision piece is posed by its own local matrix inside its group
      const localsA = targetGroup.userData.collisionLocalMatrices;
      const localsB = otherGroup.userData.collisionLocalMatrices;

      colGeosA.forEach((geoA, i) => {
        if (collided || !geoA.boundsTree) return;
        colGeosB.forEach((geoB, j) => {
          if (collided) return;
          let m = matrixBtoA;
          if (localsA?.[i] || localsB?.[j]) {
            m = _pieceMatrix.copy(matrixBtoA);
            if (localsA?.[i]) m.premultiply(_pieceInverse.copy(localsA[i]).invert());
            if (localsB?.[j]) m.multiply(localsB[j]);
          }
          if (geoA.boundsTree.intersectsGeometry(geoB, m)) collided = true;
        });
      });
      if (collided && tightOk && targetGroup.userData.deepCollisionGeometries && otherGroup.userData.deepCollisionGeometries) {
        const deepA = targetGroup.userData.deepCollisionGeometries();
        const deepB = otherGroup.userData.deepCollisionGeometries();
        collided = deepA.some((geoA, i) =>
          deepB.some((geoB, j) => {
            let m = matrixBtoA;
            if (localsA?.[i] || localsB?.[j]) {
              m = _pieceMatrix.copy(matrixBtoA);
              if (localsA?.[i]) m.premultiply(_pieceInverse.copy(localsA[i]).invert());
              if (localsB?.[j]) m.multiply(localsB[j]);
            }
            return geoA.boundsTree.intersectsGeometry(geoB, m);
          })
        );
      }
      // Plastic sheets flex where they press, and stacked sheets press together (src/utils/sheetContact.js)
      if (collided && tightOk && (isPlasticSheet(partA) || isPlasticSheet(partB))) collided = !sheetContactIsTight(targetGroup, partA, otherGroup, partB);
      // The shrunk meshes miss small overlaps, like a shaft's cap inside a hole it can't pass
      if (!collided && (isShaftGroup(targetGroup) || isShaftGroup(otherGroup))) {
        if (featuresA === undefined) featuresA = worldFeaturesOfGroup(targetGroup);
        collided = findTooWideInserts(featuresA, worldFeaturesOfGroup(otherGroup)).length > 0;
      }
      const lookA = pairLook(targetGroup);
      const lookB = pairLook(otherGroup);
      pairCache.set(pairKey, { a: aFirst ? lookA : lookB, b: aFirst ? lookB : lookA, hit: collided });
      if (collided && hits) {
        hits.push(otherId);
        anyHit = true;
        collided = false;
        continue;
      }
      if (collided) break;
    }
    if (anyHit) collided = true;

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
      // Quarter steps counted from the clear position, so parts off the world grid rest flush too
      const base = clearPos[domAxis];
      const qIndex =
        dir > 0
          ? Math.floor((lo[domAxis] - base + 0.05) / quarterStep)
          : Math.ceil((lo[domAxis] - base - 0.05) / quarterStep);
      const qVal = Number((base + qIndex * quarterStep).toFixed(3));
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
   * World features of one part ({ instanceId, box, partBox, features }, or null when it has none),
   * kept on the part until it moves or its measurements change.
   */
  const featureEntryFor = (instId, group) => {
    const partMeta = partFor(group.userData);
    if (!partMeta) return null;
    group.updateMatrixWorld();
    const measured = getMeshMeasurements(group, partMeta);
    const cached = group.userData.featureCache;
    if (
      cached &&
      cached.partMeta === partMeta &&
      cached.matrix.equals(group.matrixWorld) &&
      cached.surfaces === measured?.surfaces &&
      cached.passRadii === measured?.passRadii
    ) {
      return cached.entry;
    }
    const features = collectWorldFeatures(partMeta, group.matrixWorld, instId, measured);
    const partBox = worldPartBox(partMeta, group.matrixWorld);
    const entry = features.length === 0
      ? null
      : {
          instanceId: instId,
          box: partBox?.clone().expandByScalar(MAX_AXIAL_GAP_MM),
          partBox,
          features
        };
    group.userData.featureCache = {
      partMeta,
      matrix: group.matrixWorld.clone(),
      surfaces: measured?.surfaces,
      passRadii: measured?.passRadii,
      entry
    };
    return entry;
  };

  /**
   * Caches world pins/shafts/openings of every visible non-selected part. Nothing but the selected
   * part moves during a drag, so this is rebuilt only at drag start and after scene syncs. `exclude`:
   * the ids left out instead of the selected part (a set being dragged).
   */
  const rebuildOtherFeatures = (exclude = null) => {
    const entries = [];
    for (const [instId, group] of meshMapRef.current.entries()) {
      if ((exclude ? exclude.has(instId) : instId === selectedIdRef.current) || !group.visible) continue;
      // A part that hasn't moved (and whose measurements haven't arrived since) keeps its last entry
      const entry = featureEntryFor(instId, group);
      if (entry) entries.push(entry);
    }
    otherFeaturesRef.current = entries;
  };

  /**
   * Hole snapping for a Move drag: with the dragged part at `rawPos`, finds the smallest move along
   * the gizmo's dragged axes that lines one of its pins/shafts/openings up with a matching one on
   * another part (any angle). Returns the snapped position, with dragged axes that run along the
   * hole's line taken from `gridPos`, or null when nothing is close enough.
   */
  // --- Gear meshing and square fits (openspec gear-meshing, square-shaft-fit; design.md §5) ----------

  /** Gears and racks in world space (as posed in the scene), except `excludeId`. */
  const toothedNeighbours = (excludeId) => {
    const list = [];
    for (const [id, g] of meshMapRef.current.entries()) {
      if (id === excludeId || !g.visible) continue;
      const toothed = worldToothed(partFor(g.userData), g.position, g.quaternion, id);
      if (toothed) list.push(toothed);
    }
    return list;
  };

  /** Turns a scene object by `deg` about the world line through `point` along `axis`. */
  const turnObjectAbout = (obj, axis, point, deg) => {
    const pivot = point.clone();
    const rad = THREE.MathUtils.degToRad(deg);
    obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, rad));
    obj.position.sub(pivot).applyAxisAngle(axis, rad).add(pivot);
    obj.updateMatrixWorld(true);
  };

  /**
   * While dragging: a spur gear in mesh range turns to mesh (so tooth clashes don't hold it short of
   * the hole it is pulled onto), and a square axle on a square hole's line rolls onto its flats. A
   * dragged part has left its shaft group, so only it turns.
   */
  const liveFitWhileDragging = (obj, partMeta) => {
    const id = obj.userData.instanceId;
    if (isMeshingGear(partMeta)) {
      const turn = meshTurn(worldToothed(partMeta, obj.position, obj.quaternion, id), toothedNeighbours(id));
      if (turn && Math.abs(turn.turnDeg) >= 0.005) turnObjectAbout(obj, turn.axis, obj.position, turn.turnDeg);
      return;
    }
    if (partMeta?.fastenerSpecs?.shape !== 'square') return;
    obj.updateMatrixWorld(true);
    const shaft = collectWorldFeatures(partMeta, obj.matrixWorld, id, getMeshMeasurements(obj, partMeta)).find(
      (f) => f.kind === 'shaft' && f.flatDir
    );
    if (!shaft) return;
    let best = null;
    for (const other of otherFeaturesRef.current) {
      // A Smart Motor's hub turns to the axle instead (on release)
      const hasHub = Boolean(catalogMapRef.current.get(meshMapRef.current.get(other.instanceId)?.userData.partId)?.hubSpecs);
      for (const f of other.features) {
        if (!f.flatDir || (f.kind !== 'shaft_bore' && f.kind !== 'shaft_socket') || (hasHub && f.kind === 'shaft_socket')) continue;
        if (Math.abs(f.axis.dot(shaft.axis)) < PARALLEL_MIN_DOT) continue;
        const d = f.origin.clone().sub(shaft.origin);
        const along = d.dot(shaft.axis);
        if (d.lengthSq() - along * along > 0.25 * 0.25) continue;
        if (!best || Math.abs(along) < best.along) best = { f, along: Math.abs(along) };
      }
    }
    if (!best) return;
    const deg = squareFitRoll(shaft, best.f);
    if (Math.abs(deg) >= 0.01) turnObjectAbout(obj, shaft.axis, shaft.origin, deg);
  };

  /** A group's pose as stored on instances (mm to 0.001, degrees to 0.01). */
  const groupPose = (group) => ({
    position: group.position.toArray().map((v) => Number(v.toFixed(3))),
    rotation: [group.rotation.x, group.rotation.y, group.rotation.z].map((r) => Number(THREE.MathUtils.radToDeg(r).toFixed(2)))
  });

  /**
   * The placement step (placementFit.js) for `placedId` at `placedPose`, against the parts as saved.
   * With `copyOf`, the placed part is a new copy of that part (id '__copy__', label '{copy}'), and
   * the original stays where it is.
   */
  const settleInstances = (placedId, placedPose, { receivingId = null, copyOf = null } = {}) => {
    if (explodeModeRef.current !== 'off') return { patches: [], messages: [] };
    let list = instancesRef.current.map((i) => (i.instanceId === placedId ? { ...i, ...placedPose } : i));
    let id = placedId;
    if (copyOf) {
      const src = instancesRef.current.find((i) => i.instanceId === copyOf);
      if (!src) return { patches: [], messages: [] };
      id = '__copy__';
      list = [...instancesRef.current, { ...src, instanceId: id, label: '{copy}', ...placedPose, socketAngleDeg: 0, visible: true }];
    }
    return settlePlacement({
      placedId: id,
      instances: list,
      receivingId,
      partOf: (i) => partFor(i),
      featuresOf: (i) => {
        const meta = partFor(i);
        const g = meshMapRef.current.get(i.instanceId === '__copy__' ? copyOf : i.instanceId);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...i.rotation.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
        const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...i.position), q, new THREE.Vector3(1, 1, 1));
        return collectWorldFeatures(meta, matrix, i.instanceId, g ? getMeshMeasurements(g, meta) : null);
      }
    });
  };

  /** Sets a group to a pose patch's position and rotation (degrees). */
  const poseGroup = (group, patch) => {
    group.position.set(...patch.position);
    group.rotation.set(...patch.rotation.map((d) => THREE.MathUtils.degToRad(d)));
    group.updateMatrixWorld(true);
  };

  /**
   * Before a part is pushed in (mate, pick, copy) from where it is along `direction` for up to
   * `travelMm`: turns it as the placement step would, so its teeth or flats don't stop it short. A
   * gear takes the turn at the first point of its path where it meshes (sliding down an axle past
   * another gear), anything else the turn at the end of its travel. Moves the group by the same
   * shift when the turn is about a line off its origin. Returns that shift.
   */
  const preTurnForPlacement = (group, direction, travelMm, options = {}, sweepMm = travelMm) => {
    const id = group.userData.instanceId;
    const placedId = options.copyOf ? '__copy__' : id;
    const start = group.position.clone();
    const settleAt = (d) => {
      group.position.copy(start).addScaledVector(direction, d);
      group.updateMatrixWorld(true);
      return { at: group.position.clone(), settled: settleInstances(id, groupPose(group), options) };
    };
    const STEP_MM = 1.5;
    const travel = Math.max(0, travelMm);
    let chosen = null;
    if (isMeshingGear(partFor(group.userData))) {
      // The whole push: it goes on past the travel limit while still in an opening
      const reach = Math.max(travel, sweepMm ?? 0);
      for (let d = 0; d <= reach && !chosen; d += Math.max(STEP_MM, reach / 40)) {
        const probe = settleAt(d);
        if (probe.settled.mesh) chosen = probe;
      }
    }
    chosen ||= settleAt(travel);
    group.position.copy(start);
    group.updateMatrixWorld(true);
    const own = chosen.settled.patches.find((p) => p.instanceId === placedId && p.rotation);
    if (!own) return new THREE.Vector3();
    const shift = new THREE.Vector3(...own.position).sub(chosen.at);
    poseGroup(group, { position: start.clone().add(shift).toArray(), rotation: own.rotation });
    return shift;
  };

  /**
   * Commits a part that just landed (drag release, mate, pick) with the placement step's turns as
   * one history step. Returns the step's notes (meshes, conflicts, hub turns).
   */
  const commitPlacement = (group, { label, receivingId = null, settle = true, stepMeta = null } = {}) => {
    const id = group.userData.instanceId;
    const inst = instancesRef.current.find((i) => i.instanceId === id);
    const settled = settle ? settleInstances(id, groupPose(group), { receivingId }) : { patches: [], messages: [] };
    const own = settled.patches.find((p) => p.instanceId === id);
    if (own?.position) poseGroup(group, own);
    const isIntersecting = checkGroupCollision(group, false, null, null, true);
    group.userData.isIntersecting = isIntersecting;
    const extraPatches = settled.patches.filter((p) => p.instanceId !== id);
    const notes = settled.messages;
    const stepLabel = notes.length ? `${label || `Move ${inst?.label || id}`}. ${notes.join('. ')}` : label;
    onUpdateTransformRef.current(
      id,
      { ...groupPose(group), isIntersecting, ...(own && 'socketAngleDeg' in own ? { socketAngleDeg: own.socketAngleDeg } : {}) },
      stepLabel || extraPatches.length || stepMeta
        ? { ...stepMeta, ...(stepLabel ? { label: stepLabel } : {}), ...(extraPatches.length ? { extraPatches } : {}) }
        : undefined
    );
    return notes;
  };

  const snapDragToHoles = (obj, partMeta, rawPos, gridPos) => {
    const transform = transformRef.current;
    const letters = (transform?.axis || '').replace(/[^XYZ]/g, '');
    if (!letters || !partMeta) return null;
    const directions = [...letters].map((l) => {
      const dir = new THREE.Vector3(l === 'X' ? 1 : 0, l === 'Y' ? 1 : 0, l === 'Z' ? 1 : 0);
      return transform.space === 'local' ? dir.applyQuaternion(dragStartQuatRef.current) : dir;
    });

    obj.position.copy(rawPos);
    obj.updateMatrixWorld();
    const selectedFeatures = collectWorldFeatures(
      partMeta,
      obj.matrixWorld,
      obj.userData.instanceId,
      getMeshMeasurements(obj, partMeta)
    );
    if (selectedFeatures.length === 0) return null;
    // As far as the pull reaches along a hole's line
    const reachBox = worldPartBox(partMeta, obj.matrixWorld)?.expandByScalar(HOLE_SNAP_AXIAL_REACH_MM);
    const candidates = [];
    for (const other of otherFeaturesRef.current) {
      if (reachBox && other.box && !reachBox.intersectsBox(other.box)) continue;
      for (const f of other.features) candidates.push(f);
    }
    const snap = findHoleSnap(selectedFeatures, candidates, directions);
    if (!snap) return null;

    const snapped = rawPos.clone().add(snap.offset);
    // Dragged axes along the hole's line don't affect lining up: keep them on the drag grid
    directions.forEach((dir) => {
      if (Math.abs(dir.dot(snap.opening.axis)) > 0.999) {
        snapped.addScaledVector(dir, gridPos.clone().sub(snapped).dot(dir));
      }
    });
    return {
      position: new THREE.Vector3(Number(snapped.x.toFixed(3)), Number(snapped.y.toFixed(3)), Number(snapped.z.toFixed(3))),
      axis: snap.opening.axis.clone()
    };
  };

  /**
   * A part lined up on a hole's line but overlapping something (a pitch step left it pressed into the
   * pins it is going onto): the nearest clear position along that line, within `reachMm`, or null.
   */
  const settleAlongLine = (obj, position, axis, reachMm) => {
    const d = clearSpotAlongLine((t) => {
      obj.position.copy(position).addScaledVector(axis, t);
      return !checkGroupCollision(obj, false);
    }, reachMm);
    const settled = position.clone().addScaledVector(axis, d ?? 0);
    obj.position.copy(settled);
    if (d === null) return null;
    return new THREE.Vector3(Number(settled.x.toFixed(3)), Number(settled.y.toFixed(3)), Number(settled.z.toFixed(3)));
  };

  /**
   * Hole-to-hole pairs only count while the two parts are apart: a hole's face often sits recessed
   * in its part, so the faces of stacked parts' holes never meet. Drops the hole pairs of every
   * direction in which moving the part TOUCH_PROBE_MM toward the other part already touches
   * something. The probe must exceed the collision meshes' contact tolerance (0.38 mm shrink per
   * part, so up to 0.76 mm of overlap goes unseen), or a part sitting flush would never count.
   */
  const dropTouchingHolePairs = (group, aligned) => {
    if (!aligned.some((a) => a.pairKind === 'hole')) return aligned;
    const saved = group.position.clone();
    const touching = [];
    for (const a of aligned) {
      if (a.pairKind !== 'hole' || touching.some((d) => d.dot(a.outward) >= 0.9994)) continue;
      group.position.copy(saved).addScaledVector(a.outward, -TOUCH_PROBE_MM);
      if (checkGroupCollision(group, false)) touching.push(a.outward);
    }
    group.position.copy(saved);
    group.updateMatrixWorld(true);
    if (touching.length === 0) return aligned;
    return aligned.filter((a) => a.pairKind !== 'hole' || !touching.some((d) => d.dot(a.outward) >= 0.9994));
  };

  /**
   * Highlights (see-through) every opening lined up with the selected part's pins/shafts, and the
   * selected part's openings lined up with other parts' pins/shafts, while the insert is still outside.
   */
  const updateAlignedHoleHighlights = () => {
    const overlay = holeOverlayRef.current;
    if (!overlay) return;

    if (markedHolesRef.current.length > 0) {
      const marked = [];
      for (const { instanceId, portIds } of markedHolesRef.current) {
        const g = meshMapRef.current.get(instanceId);
        const meta = g ? partFor(g.userData) : null;
        if (!meta) continue;
        g.updateMatrixWorld();
        for (const f of collectWorldFeatures(meta, g.matrixWorld, instanceId, getMeshMeasurements(g, meta))) {
          if (!f.radiusMm || !portIds.includes(f.featureId.replace(/@(lo|hi)$/, ''))) continue;
          const outward = f.start.clone().sub(f.end).normalize();
          marked.push({ face: f.start, farFace: f.end, outward, radiusMm: f.radiusMm });
        }
      }
      lastAlignedRef.current = [];
      overlay.show(marked);
      return;
    }

    const selId = selectedIdRef.current;
    const group = selId ? meshMapRef.current.get(selId) : null;
    const selectedInst = selId ? instancesRef.current.find((i) => i.instanceId === selId) : null;
    const partMeta = group ? partFor(group.userData) : null;
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
    lastAlignedRef.current = dropTouchingHolePairs(group, findAlignedOpenings(selectedFeatures, candidates));
    overlay.show(lastAlignedRef.current);
  };

  /** Hides the mate direction arrows and gives the move gizmo or rotate rings back. */
  const hideMateArrows = () => {
    const arrows = arrowOverlayRef.current;
    if (!arrows?.isShown()) return;
    arrows.hide();
    arrowPlansRef.current = [];
    const transform = transformRef.current;
    if (transform && pickModeRef.current?.kind !== 'pick') {
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
    // `group` may be a point instead (a set's centre)
    const center = group.isVector3 ? group.clone() : new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3());
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
   * Moves `group` from `start` along `direction` in 0.5mm steps for up to `sweepMm`, stopping at the
   * first contact (flush-boundary bisection), else at `travelMm`. Rounds to 0.001mm, backing off
   * until clear. Leaves the group at the result and returns it.
   */
  const sweepToContact = (group, start, direction, travelMm, sweepMm) => {
    const STEP_MM = 0.5;
    const travel = Math.max(0, travelMm);
    const sweep = Math.max(travel, sweepMm ?? 0);
    const lastClear = start.clone();
    let final = null;
    for (let d = Math.min(STEP_MM, sweep); d > 0; d = Math.min(d + STEP_MM, sweep)) {
      const probe = start.clone().addScaledVector(direction, d);
      group.position.copy(probe);
      if (checkGroupCollision(group, false)) {
        final = findFlushBoundaryPosition(group, lastClear, probe) || lastClear.clone();
        break;
      }
      lastClear.copy(probe);
      if (d >= sweep) break;
    }
    if (!final) final = start.clone().addScaledVector(direction, travel);

    // The contact found by bisection is within ~0.0005mm of touching, so rounding to 0.001mm can
    // land on the touching side: step back along the move until the rounded position is clear.
    const roundVec = (vec) =>
      new THREE.Vector3(Number(vec.x.toFixed(3)), Number(vec.y.toFixed(3)), Number(vec.z.toFixed(3)));
    const BACK_OFF_MM = 0.002;
    let rounded = roundVec(final);
    group.position.copy(rounded);
    for (let i = 0; i < 50 && checkGroupCollision(group, false); i++) {
      rounded = roundVec(final.addScaledVector(direction, -BACK_OFF_MM));
      group.position.copy(rounded);
    }
    group.updateMatrixWorld();
    return rounded;
  };

  /**
   * Mates the selected part along one plan (see planMates): shift sideways onto the axis, then
   * sweep along the direction in 0.5mm steps for as long as the pin/shaft is still in an opening
   * (sweepMm); at the first contact use the drag's flush-boundary bisection, otherwise stop at the
   * plan's travel limit (leading end flush with the far face). Commits like a drag release, after
   * making sure the rounded position is clear.
   */
  const mateSelected = (plan, { label, message, receivingId: receivingIdArg = null, stepMeta = null } = {}) => {
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

    const partnerOf = (p) => (p.insertInstanceId === selId ? p.instanceId : p.insertInstanceId);
    const receivingId = receivingIdArg ?? (plan.pairs[0] ? partnerOf(plan.pairs[0]) : null);
    // Turn to mesh / fit before the push, as at the end of the travel
    start.add(preTurnForPlacement(group, plan.direction, plan.travelMm, { receivingId }, plan.sweepMm));
    const final = sweepToContact(group, start, plan.direction, plan.travelMm, plan.sweepMm);
    group.position.copy(final);
    const notes = commitPlacement(group, { label, receivingId, stepMeta });
    const withNotes = (text) => [text, ...notes].join('. ');
    if (message) {
      feedback(withNotes(message));
      return;
    }
    const stacked = plan.pairs.length > 0 && plan.pairs.every((p) => p.pairKind === 'hole');

    const partnerIds = new Set(plan.pairs.map(partnerOf));
    const labels = [...partnerIds].map(
      (id) => instancesRef.current.find((i) => i.instanceId === id)?.label || id
    );
    feedback(withNotes(`${stacked ? 'Stacked on' : 'Mated with'} ${labels.join(', ')}`));
  };

  // --- View options (openspec: view-options) --------------------------------------------------------

  /** Zooms an orthographic camera to show what a perspective camera shows from `distance` away. */
  const setOrthoViewDistance = (ortho, distance) => {
    const halfFov = THREE.MathUtils.degToRad(perspCameraRef.current.fov / 2);
    ortho.zoom = ortho.userData.viewHeight / (2 * distance * Math.tan(halfFov));
    ortho.updateProjectionMatrix();
  };

  /**
   * Makes the main view perspective or orthographic, keeping the orbit target, the view direction
   * and the size of things at the target's depth.
   */
  const switchProjection = (kind) => {
    const persp = perspCameraRef.current;
    const ortho = orthoCameraRef.current;
    const orbit = orbitRef.current;
    const from = cameraRef.current;
    const to = kind === 'orthographic' ? ortho : persp;
    if (!persp || !ortho || !orbit || from === to) return;
    const target = orbit.target;
    const halfFov = THREE.MathUtils.degToRad(persp.fov / 2);
    const offset = from.position.clone().sub(target);
    if (to === ortho) {
      ortho.userData.viewHeight = 2 * offset.length() * Math.tan(halfFov);
      ortho.zoom = 1;
      ortho.position.copy(from.position);
    } else {
      const distance = ortho.userData.viewHeight / ortho.zoom / (2 * Math.tan(halfFov));
      persp.position.copy(target).addScaledVector(offset.normalize(), distance);
    }
    to.up.copy(from.up);
    to.quaternion.copy(from.quaternion);
    const panes = panesRef.current;
    if (panes) fitCameraToPane(to, panes.main);
    activateCameraRef.current?.(to);
  };

  const VIEW_ANIM_MS = 300;
  const viewAnimRef = useRef(0); // rAF id of the running camera turn

  /**
   * Turns the main camera to look from `direction` (world, from the target toward the camera) over
   * VIEW_ANIM_MS, about the orbit target, keeping the distance (orthographic: the zoom). Looking
   * straight up or down sits just off the pole so +X ends up at the top of the picture.
   */
  const animateViewTo = (direction) => {
    const cam = cameraRef.current;
    const orbit = orbitRef.current;
    if (!cam || !orbit) return;
    const end = direction.clone().normalize();
    if (Math.abs(end.y) > 0.999) end.set(-1e-4 * Math.sign(end.y), Math.sign(end.y), 0).normalize();
    const target = orbit.target.clone();
    const offset = cam.position.clone().sub(target);
    const distance = offset.length();
    const start = offset.normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(start, end);
    const step = new THREE.Quaternion();
    cancelAnimationFrame(viewAnimRef.current);
    const damping = orbit.enableDamping;
    orbit.enableDamping = false; // leftover orbit momentum would fight the turn
    const t0 = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / VIEW_ANIM_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      step.identity().slerp(turn, eased);
      const dir = t < 1 ? start.clone().applyQuaternion(step) : end;
      const active = cameraRef.current;
      active.position.copy(target).addScaledVector(dir, distance);
      active.lookAt(target);
      orbit.update();
      if (t < 1) viewAnimRef.current = requestAnimationFrame(tick);
      else orbit.enableDamping = damping;
    };
    tick();
  };

  // --- Hole picking (openspec: hole-pick-insert) -----------------------------------------------------

  const PICK_HOVER_PX = 24;
  const pickLabelOf = (id) => instancesRef.current.find((i) => i.instanceId === id)?.label || id;

  // Bore parts have no pins to count
  const pinCount = (fit) => (fit.bore ? '' : ` · ${fit.green} of ${fit.total} pins in holes`);

  /** Tells App what to show in the picking banner, or null when picking ends. */
  const emitPickStatus = () => {
    const pick = pickModeRef.current;
    if (!pick) {
      onPickStatusRef.current?.(null);
      return;
    }
    const name = pick.set ? pick.set.name : pickLabelOf(pick.selId);
    if (pick.kind === 'copy') {
      // Copy preview: a short line only while a hole is lit (or after a refusal); none over the
      // hole a copy just went into
      let text = null;
      let tone = 'info';
      const justFilled = pick.hovered && openingKey(pick.hovered.opening) === pick.lastInsertedKey;
      if (justFilled && !pick.message) {
        text = null;
      } else if (pick.message || pick.hovered?.taken || (pick.hovered && pick.fits.length === 0)) {
        tone = 'warning';
        text = pick.message ?? (pick.hovered.taken ? 'That hole already has a part in it' : `${name} doesn't fit this hole from this side`);
      } else if (pick.hovered) {
        const fit = pick.fits[pick.fitIndex];
        text = `Copy ${name} → ${pickLabelOf(pick.hovered.opening.instanceId)}: Fit ${pick.fitIndex + 1} of ${pick.fits.length}${pinCount(fit)}. Ctrl/Cmd+double-click to insert a copy, wheel for other fits`;
      }
      onPickStatusRef.current?.(text ? { text, tone } : null);
      return;
    }
    const arrowHint = pick.alongsideArrows ? ', or click the arrow to stack along the lined-up holes' : '';
    if (pick.fixed && pick.hovered) {
      // Placing at the target (target-hole-placement)
      const fit = pick.fits[pick.fitIndex];
      const lined = fit && fit.green > 1 ? ` · ${fit.green} ${fit.holeFit ? 'holes' : 'pins'} lined up` : '';
      const text =
        pick.message ??
        `Add ${name} into ${pickLabelOf(pick.hovered.opening.instanceId)}: Fit ${pick.fitIndex + 1} of ${pick.fits.length}${lined}. Click to place it, wheel or R for other fits, Esc to cancel`;
      onPickStatusRef.current?.({ text, tone: pick.message ? 'warning' : 'info' });
      return;
    }
    if (pick.place && !pick.hovered && !pick.message) {
      const text = pick.place.followOnly
        ? `Placing ${name}: move it where it goes (it pulls onto lined-up holes), click to put it down, Esc to cancel`
        : `Placing ${name}: point at a ${pick.bore ? "hole or an axle's end" : 'hole'} to fit it, click to put it down here, Esc to cancel`;
      onPickStatusRef.current?.({ text, tone: 'info' });
      return;
    }
    let text = pick.bore
      ? `Pick a place for ${name}: point at an axle's end or a hole, click to put it on${arrowHint}, Esc to cancel`
      : `Pick a hole for ${name}: point at a hole, click to insert${arrowHint}, Esc to cancel`;
    let tone = 'info';
    if (pick.hovered?.taken) {
      text = 'That hole already has a part in it';
      tone = 'warning';
    } else if (pick.hovered && pick.fits.length === 0) {
      text = `${name} doesn't fit this hole from this side`;
      tone = 'warning';
    } else if (pick.hovered) {
      const fit = pick.fits[pick.fitIndex];
      text = `${name} → ${pickLabelOf(pick.hovered.opening.instanceId)}: Fit ${pick.fitIndex + 1} of ${pick.fits.length}${pinCount(fit)}. Click to insert, wheel or R for other fits${arrowHint}, Esc to cancel`;
    }
    if (pick.message) {
      text = pick.message;
      tone = 'warning';
    }
    onPickStatusRef.current?.({ text, tone });
  };

  /** Shows the hovered face, the preview copy and its pin markers for the current fit. */
  const renderPick = () => {
    const pick = pickModeRef.current;
    const overlay = pickOverlayRef.current;
    if (!pick || !overlay) return;
    const hovered = pick.hovered;
    const fit = hovered && !hovered.taken ? pick.fits[pick.fitIndex] : null;
    if (pick.kind === 'copy' && fit) {
      // Ring every hole the copy's pins would go into, on the face the copy comes in from
      const n = hovered.face.outward;
      const faces = holesFilledByFit(fit, hovered).map((opening) => {
        if (opening === hovered.opening) return { ...hovered.face, radiusMm: opening.radiusMm, taken: false };
        const face = openFaces(opening).reduce((a, b) => (b.outward.dot(n) > a.outward.dot(n) ? b : a));
        return { ...face, radiusMm: opening.radiusMm, taken: isCopyHoleTaken(pick, opening) };
      });
      overlay.showRings(faces);
    } else {
      overlay.showRing(hovered ? { ...hovered.face, radiusMm: hovered.opening.radiusMm, taken: hovered.taken } : null);
    }
    // Placing poses the part itself at the fit instead of a see-through copy
    if (pick.place) poseFollowAtFit(fit);
    overlay.showGhost(fit && !pick.place ? { position: fit.position, quaternion: fit.quaternion } : null);
    overlay.showMarkers(fit ? fit.markers : [], hovered ? hovered.face.outward : new THREE.Vector3(0, 0, 1));
    emitPickStatus();
  };

  /**
   * Session state for hole picking ('pick') or the Ctrl/Cmd copy preview ('copy'), for the selected
   * part: every open face of every other part's openings that one of its inserts fits. Null for
   * parts without pins, pegs or shafts.
   */
  const buildPickSession = (kind, extra = {}) => {
    const selId = selectedIdRef.current;
    const group = selId ? meshMapRef.current.get(selId) : null;
    const partMeta = group ? partFor(group.userData) : null;
    if (!group || !partMeta) return null;
    const insertKinds = [...new Set(getLocalFeatures(partMeta).filter((f) => f.kind === 'pin' || f.kind === 'shaft').map((f) => f.kind))];
    // A bore part (gear, hub, pulley, motor) is picked onto axle ends and hole faces instead
    const bore = insertKinds.length === 0 && isBorePart(partMeta);
    // Placing a part with nothing to insert (beam, plate, brain): it only follows the pointer
    const followOnly = insertKinds.length === 0 && !bore;
    if (followOnly && !extra.allowFollowOnly) return null;

    rebuildOtherFeatures();
    const others = otherFeaturesRef.current.flatMap((o) => o.features);
    const candidates = bore ? boreTargets(others) : [];
    for (const f of bore ? [] : others) {
      if (!insertKinds.some((k) => insertFitsOpening(k, f.kind))) continue;
      for (const face of openFaces(f)) candidates.push({ opening: f, face });
    }
    return {
      kind,
      selId,
      partMeta,
      bore,
      followOnly,
      measured: getMeshMeasurements(group, partMeta),
      // Gears and racks a gear preview meshes with (a copy also meshes with the original)
      meshNeighbours: isMeshingGear(partMeta) ? toothedNeighbours(kind === 'copy' ? null : selId) : null,
      startPosition: group.position.clone(),
      startQuaternion: group.quaternion.clone(),
      transformMode: transformModeRef.current,
      explodeMode: explodeModeRef.current,
      candidates,
      others,
      hovered: null,
      fits: [],
      fitIndex: 0,
      message: null,
      ...extra
    };
  };

  const openingKey = (opening) => `${opening.instanceId}:${opening.featureId}`;
  /** Taken for the copy preview: a part is seated in it, or a copy was just inserted there. */
  const isCopyHoleTaken = (pick, opening) =>
    opening.kind !== 'shaft' && (pick.insertedKeys?.has(openingKey(opening)) || isOpeningTaken(opening, pick.others));

  /**
   * Starts hole picking for the selected part when it has pins, pegs or shafts: hides the gizmo and
   * gathers the hole faces its inserts fit. Returns false (nothing started) for parts without inserts.
   */
  const startPick = ({ alongsideArrows = false } = {}) => {
    const session = buildPickSession('pick', { alongsideArrows });
    if (!session) return false;
    const group = meshMapRef.current.get(session.selId);
    pickModeRef.current = session;
    const transform = transformRef.current;
    if (transform) {
      transform.enabled = false;
      transform.getHelper().visible = false;
    }
    pickOverlayRef.current?.setGhostSource(group);
    refreshRotateSetup(); // hides the rotate rings while picking
    renderPick();
    return true;
  };

  // --- Placing a part dragged in from the library (openspec easier-placing-and-fix-assembly) -------

  /**
   * Starts placing the just-added part `request.instanceId`: a hole-picking session whose part follows
   * the pointer and sits at the hovered hole's fit. Parts with nothing to insert only follow (and pull
   * onto lined-up holes). Returns false when the part isn't the selected one.
   */
  const startPlace = (request) => {
    if (selectedIdRef.current !== request.instanceId || explodeModeRef.current !== 'off') return false;
    if (pickModeRef.current) endPick();
    const session = buildPickSession('pick', { allowFollowOnly: true });
    const group = meshMapRef.current.get(request.instanceId);
    if (!session || !group) return false;
    session.place = { request, followOnly: session.followOnly };
    if (request.atTarget) {
      // Straight into the target, at its first free fit; the part stays there (target-hole-placement)
      const target = resolveTarget();
      const fits = target ? targetFits(session, group, target) : [];
      if (!fits.length) {
        const where = !target ? 'the target is gone' : target.onShaft ? `on this ${target.opening.kind === 'shaft' ? 'shaft' : 'pin'}` : 'at this hole';
        onMateFeedbackRef.current?.(target ? `No free fit for ${pickLabelOf(request.instanceId)} ${where}` : `Can't place ${pickLabelOf(request.instanceId)}: ${where}`, true);
        return false;
      }
      session.hovered = { ...target, taken: false };
      session.fits = fits;
      session.fitIndex = 0;
      session.fixed = true;
      session.followOnly = false;
      session.place.followOnly = false;
    }
    pickModeRef.current = session;
    const transform = transformRef.current;
    if (transform) {
      transform.enabled = false;
      transform.getHelper().visible = false;
    }
    hideMateArrows();
    pickOverlayRef.current?.setGhostSource(group);
    refreshRotateSetup();
    const at = copyPointerRef.current;
    if (at) {
      updatePickHover(at.x, at.y);
      followPointer(at.x, at.y);
    }
    renderPick();
    return true;
  };

  /** Poses the placed part at `fit` (a hovered hole's fit). */
  const poseFollowAtFit = (fit) => {
    const pick = pickModeRef.current;
    const group = pick ? meshMapRef.current.get(pick.selId) : null;
    if (!group || !fit) return;
    group.position.copy(fit.seated?.position ?? fit.position);
    group.quaternion.copy(fit.seated?.quaternion ?? fit.quaternion);
    group.updateMatrixWorld(true);
  };

  // At most this many fits are seated to find the free ones when placing at the target
  const TARGET_FIT_CAP = 48;

  /**
   * The free fits of the part being placed (`group`) at `target` (design.md §7): every fit from
   * listTargetFits, best first, seated (posed just outside, pushed in to first contact) and left out
   * when its way in is blocked; fits that seat the same are listed once. Plug fits win: hole fits
   * are only kept when no plug fit is free. The part is put back where it was.
   */
  const targetFits = (session, group, target) => {
    const receiving = meshMapRef.current.get(target.opening.instanceId);
    const receivingQuaternion = receiving ? receiving.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    const listed = listTargetFits({
      partMeta: session.partMeta,
      measured: session.measured,
      instanceId: session.selId,
      target,
      receivingQuaternion,
      otherFeatures: session.others,
      currentQuaternion: session.startQuaternion,
      meshNeighbours: session.meshNeighbours
    });
    const oldPosition = group.position.clone();
    const oldQuaternion = group.quaternion.clone();
    const free = [];
    let seatedCount = 0;
    for (const fit of listed) {
      if (seatedCount >= TARGET_FIT_CAP) break;
      seatedCount += 1;
      group.position.copy(fit.position);
      group.quaternion.copy(fit.quaternion);
      group.updateMatrixWorld(true);
      if (checkGroupCollision(group, false)) continue; // the way in is blocked
      const final = sweepToContact(group, fit.position.clone(), fit.direction, fit.travelMm, fit.sweepMm);
      const seated = { position: final.clone(), quaternion: fit.quaternion.clone() };
      const same = free.some((g) => g.seated.position.distanceTo(seated.position) < 0.05 && g.seated.quaternion.angleTo(seated.quaternion) < THREE.MathUtils.degToRad(0.5));
      if (!same) free.push({ ...fit, seated });
    }
    group.position.copy(oldPosition);
    group.quaternion.copy(oldQuaternion);
    group.updateMatrixWorld(true);
    const plugs = free.filter((f) => f.rule !== 'hole');
    return plugs.length ? plugs : free;
  };

  /**
   * Moves the placed part under the pointer (canvas px), keeping its turn and its distance from the
   * camera; at the hovered hole's fit while one is lit. A part with nothing to insert pulls onto
   * lined-up holes as a drag does (not with Alt).
   */
  const followPointer = (canvasX, canvasY) => {
    const pick = pickModeRef.current;
    const camera = pointerCameraRef.current();
    const inputEl = inputElRef.current;
    const group = pick?.place ? meshMapRef.current.get(pick.selId) : null;
    if (!group || !camera || !inputEl || pick.fixed) return;
    const fit = pick.hovered && !pick.hovered.taken ? pick.fits[pick.fitIndex] : null;
    if (fit) {
      poseFollowAtFit(fit);
      return;
    }
    const rect = inputEl.getBoundingClientRect();
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2((canvasX / rect.width) * 2 - 1, -(canvasY / rect.height) * 2 + 1), camera);
    const box = group.userData.localBox;
    const centreLocal = box ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    group.quaternion.copy(pick.startQuaternion);
    group.updateMatrixWorld(true);
    const centre = centreLocal.clone().applyMatrix4(group.matrixWorld);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), centre);
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    group.position.add(hit.sub(centre));
    group.updateMatrixWorld(true);
    if (pick.place.followOnly && !altKeyRef.current) {
      const features = collectWorldFeatures(pick.partMeta, group.matrixWorld, pick.selId, pick.measured);
      const reachBox = worldPartBox(pick.partMeta, group.matrixWorld)?.expandByScalar(HOLE_SNAP_AXIAL_REACH_MM);
      const candidates = [];
      for (const other of otherFeaturesRef.current) {
        if (reachBox && other.box && !reachBox.intersectsBox(other.box)) continue;
        for (const f of other.features) candidates.push(f);
      }
      const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
      const snap = features.length ? findHoleSnap(features, candidates, axes) : null;
      if (snap) {
        group.position.add(snap.offset);
        group.updateMatrixWorld(true);
      }
    }
  };

  /** A click away from any hole while placing: put the part down where it is shown. */
  const dropPlacedPart = () => {
    const pick = pickModeRef.current;
    const group = pick?.place ? meshMapRef.current.get(pick.selId) : null;
    if (!group) return;
    const { request } = pick.place;
    pick.keepPose = true;
    endPick();
    commitPlacement(group, { label: `Add ${pickLabelOf(pick.selId)}`, stepMeta: { mergeKey: request.mergeKey, mergeWindowMs: Infinity } });
  };

  /**
   * Starts the Ctrl/Cmd copy preview (openspec: quick-copy-insert) when nothing else is going on: a
   * visible selected part with inserts, no drag or ring turn, no picking, no arrows, no Explode, and
   * no text field focused. Leaves the gizmo and rings alone. Returns true when a session is running.
   */
  const startCopy = () => {
    if (pickModeRef.current) return pickModeRef.current.kind === 'copy';
    const selId = selectedIdRef.current;
    const inst = selId ? instancesRef.current.find((i) => i.instanceId === selId) : null;
    const active = document.activeElement;
    if (
      !inst ||
      inst.visible === false ||
      explodeModeRef.current !== 'off' ||
      transformRef.current?.dragging ||
      rotateGestureRef.current ||
      arrowOverlayRef.current?.isShown() ||
      (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable))
    ) {
      return false;
    }
    const session = buildPickSession('copy', { insertedKeys: new Map() }); // opening key -> copy id
    if (!session) return false;
    pickModeRef.current = session;
    pickOverlayRef.current?.setGhostSource(meshMapRef.current.get(selId));
    renderPick();
    return true;
  };

  /** Leaves hole picking or the copy preview without changing the part, and gives the gizmo back. */
  const endPick = () => {
    const pick = pickModeRef.current;
    if (!pick) return;
    pickModeRef.current = null;
    if (pick.alongsideArrows) hideMateArrows();
    pickOverlayRef.current?.clear();
    if (pick.place && !pick.keepPose) {
      // Placing ended without putting the part down: it goes away again (App removes it)
      const group = meshMapRef.current.get(pick.selId);
      if (group) {
        group.position.copy(pick.startPosition);
        group.quaternion.copy(pick.startQuaternion);
        group.updateMatrixWorld(true);
      }
      const request = pick.place.request;
      setTimeout(() => onCancelPlaceRef.current?.(request), 0);
    }
    const transform = transformRef.current;
    if (transform && pick.kind === 'pick') {
      transform.enabled = true;
      transform.getHelper().visible = transform.object !== undefined;
    }
    if (inputElRef.current) inputElRef.current.style.cursor = '';
    if (pick.kind === 'pick') refreshRotateSetup();
    emitPickStatus();
  };

  /**
   * Finds the hole face near the cursor (canvas px): faces within PICK_HOVER_PX on screen, the one
   * nearest the camera (nearest on screen when within 2 mm in depth). Works out its fits when the
   * hovered face changes.
   */
  /**
   * Of `candidates` ({ face: { point } }), the one under the cursor (canvas px): those within
   * PICK_HOVER_PX on screen, the one nearest the camera (nearest on screen when within 2 mm in depth).
   */
  const nearestScreenTarget = (candidates, canvasX, canvasY) => {
    const camera = pointerCameraRef.current(); // in stereo, the working half's eye
    const inputEl = inputElRef.current;
    if (!camera || !inputEl) return null;
    const rect = inputEl.getBoundingClientRect();
    const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld); // stereo eyes don't keep .position
    const near = [];
    const ndc = new THREE.Vector3();
    for (const c of candidates) {
      ndc.copy(c.face.point).project(camera);
      if (ndc.z > 1) continue; // behind the camera
      const sx = ((ndc.x + 1) / 2) * rect.width;
      const sy = ((1 - ndc.y) / 2) * rect.height;
      const screen = Math.hypot(sx - canvasX, sy - canvasY);
      if (screen > PICK_HOVER_PX) continue;
      near.push({ c, screen, depth: eye.distanceTo(c.face.point) });
    }
    near.sort((a, b) => a.depth - b.depth);
    return near.filter((n) => n.depth <= near[0]?.depth + 2).sort((a, b) => a.screen - b.screen)[0]?.c ?? null;
  };

  const updatePickHover = (canvasX, canvasY) => {
    const pick = pickModeRef.current;
    const camera = pointerCameraRef.current();
    const inputEl = inputElRef.current;
    if (!pick || !camera || !inputEl) return;
    if (pick.fixed) return; // placing at the target: it stays the hovered one
    const front = nearestScreenTarget(pick.candidates, canvasX, canvasY);
    const same = front && pick.hovered && pick.hovered.opening === front.opening && pick.hovered.face === front.face;
    if (same || (!front && !pick.hovered)) return;
    pick.message = null;
    pick.lastInsertedKey = null;
    if (!front) {
      pick.hovered = null;
      pick.fits = [];
    } else {
      const taken = isCopyHoleTaken(pick, front.opening);
      const receiving = meshMapRef.current.get(front.opening.instanceId);
      const receivingQuaternion = receiving ? receiving.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
      pick.hovered = { ...front, taken };
      const listFits = pick.bore ? listBoreFits : listInsertFits;
      pick.fits = taken
        ? []
        : pick.set
          ? listSetInsertFits({ leadEnds: pick.set.leads, hovered: front, otherFeatures: pick.others }).map((fit) => ({
              ...fit,
              // The preview copy's pose: turned about the leading tip, then moved
              quaternion: fit.quaternion,
              position: fit.pivot.clone().add(fit.offset).sub(fit.pivot.clone().applyQuaternion(fit.quaternion))
            }))
          : listFits({
            partMeta: pick.partMeta,
            measured: pick.measured,
            instanceId: pick.selId,
            hovered: front,
            receivingQuaternion,
            otherFeatures: pick.others,
            currentQuaternion: pick.startQuaternion,
            meshNeighbours: pick.meshNeighbours
          });
      pick.fitIndex = 0;
    }
    if (pick.kind === 'copy') inputEl.style.cursor = pick.hovered ? 'copy' : '';
    else inputEl.style.cursor = pick.hovered ? 'pointer' : 'crosshair';
    renderPick();
  };

  /** Steps through the hovered hole's fits (wheel, R, Shift+R). Returns true when it did. */
  const cyclePickFit = (delta) => {
    const pick = pickModeRef.current;
    if (!pick?.hovered || pick.fits.length < 2) return Boolean(pick?.hovered);
    pick.fitIndex = (pick.fitIndex + delta + pick.fits.length) % pick.fits.length;
    pick.message = null;
    renderPick();
    return true;
  };

  /**
   * A click while picking: insert into the hovered hole (turn the part to the fit's pose just outside
   * the face, then push it in like mating), say why not, or leave picking when nothing is hovered.
   */
  const pickClick = () => {
    const pick = pickModeRef.current;
    if (!pick) return;
    if (!pick.hovered) {
      if (pick.place) dropPlacedPart();
      else endPick();
      return;
    }
    if (pick.hovered.taken) {
      pick.message = 'That hole already has a part in it';
      emitPickStatus();
      return;
    }
    if (pick.set) {
      setPickClick(pick);
      return;
    }
    const fit = pick.fits[pick.fitIndex];
    const group = meshMapRef.current.get(pick.selId);
    if (!fit || !group) return;
    const oldPosition = group.position.clone();
    const oldQuaternion = group.quaternion.clone();
    group.position.copy(fit.position);
    group.quaternion.copy(fit.quaternion);
    group.updateMatrixWorld(true);
    if (checkGroupCollision(group, false)) {
      group.position.copy(oldPosition);
      group.quaternion.copy(oldQuaternion);
      group.updateMatrixWorld(true);
      pick.message = 'The way in is blocked: something is in the way just outside that hole';
      emitPickStatus();
      return;
    }
    const verb = pick.place ? 'Add' : 'Insert';
    const label = `${verb} ${pickLabelOf(pick.selId)} into ${pickLabelOf(pick.hovered.opening.instanceId)}`;
    const receivingInstanceId = pick.hovered.opening.instanceId;
    const stepMeta = pick.place ? { mergeKey: pick.place.request.mergeKey, mergeWindowMs: Infinity } : null;
    pick.keepPose = true;
    endPick();
    if (pick.fixed) setTarget(null); // the target is filled
    mateSelected(
      { lateral: new THREE.Vector3(), direction: fit.direction, travelMm: fit.travelMm, sweepMm: fit.sweepMm, pairs: [] },
      { label, message: label.replace(/^(Insert|Add)/, pick.place ? 'Added' : 'Inserted'), receivingId: receivingInstanceId, stepMeta }
    );
  };

  /**
   * Where a copy of the selected part ends up for `fit`, without moving the original: the original
   * group is posed at the fit, checked for a clear way in, pushed in like mating, then put back.
   * Returns { position, rotation } (mm, degrees), or null when the way in is blocked.
   */
  const computeCopyPose = (group, fit, receivingId = null) => {
    const oldPosition = group.position.clone();
    const oldQuaternion = group.quaternion.clone();
    group.position.copy(fit.position);
    group.quaternion.copy(fit.quaternion);
    group.updateMatrixWorld(true);
    let pose = null;
    if (!checkGroupCollision(group, false)) {
      const copyOf = group.userData.instanceId;
      const startPos = fit.position.clone();
      startPos.add(preTurnForPlacement(group, fit.direction, fit.travelMm, { receivingId, copyOf }, fit.sweepMm));
      const final = sweepToContact(group, startPos, fit.direction, fit.travelMm, fit.sweepMm);
      group.position.copy(final);
      // The placement step for the copy: its own final pose, other parts' turns and the step's notes
      const settled = settleInstances(copyOf, groupPose(group), { receivingId, copyOf });
      const own = settled.patches.find((p) => p.instanceId === '__copy__');
      if (own?.position) poseGroup(group, own);
      pose = {
        ...groupPose(group),
        extraPatches: settled.patches.filter((p) => p.instanceId !== '__copy__'),
        notes: settled.messages
      };
    }
    group.position.copy(oldPosition);
    group.quaternion.copy(oldQuaternion);
    group.updateMatrixWorld(true);
    return pose;
  };

  /** Ctrl/Cmd+double-click in the copy preview: add a copy seated in the lit hole, or say why not. */
  const copyInsert = () => {
    const pick = pickModeRef.current;
    if (pick?.kind !== 'copy' || !pick.hovered) return;
    const refuse = (message) => {
      pick.message = message;
      emitPickStatus();
    };
    if (pick.hovered.taken) return refuse('That hole already has a part in it');
    const fit = pick.fits[pick.fitIndex];
    const group = meshMapRef.current.get(pick.selId);
    if (!fit || !group) return;
    const pose = computeCopyPose(group, fit, pick.hovered.opening.instanceId);
    if (!pose) return refuse('The way in is blocked: something is in the way just outside that hole');
    const copyId = onInsertCopyRef.current?.(pick.selId, pose, pickLabelOf(pick.hovered.opening.instanceId));
    if (!copyId) return;
    // The filled holes show taken straight away, for as long as the copy is there
    for (const opening of holesFilledByFit(fit, pick.hovered)) pick.insertedKeys.set(openingKey(opening), copyId);
    pick.lastInsertedKey = openingKey(pick.hovered.opening);
    // An axle can carry more parts: it is never shown taken
    if (pick.hovered.opening.kind !== 'shaft') pick.hovered = { ...pick.hovered, taken: true };
    pick.fits = [];
    renderPick();
  };

  /**
   * The part list changed during the copy preview (a copy added, undo, MCP): gather the hole faces
   * again and light the hole under the pointer anew.
   */
  const refreshCopySession = () => {
    const old = pickModeRef.current;
    if (old?.kind !== 'copy') return;
    const ids = new Set(instancesRef.current.map((i) => i.instanceId));
    const insertedKeys = new Map([...old.insertedKeys].filter(([, copyId]) => ids.has(copyId)));
    const session = buildPickSession('copy', { insertedKeys });
    if (!session) {
      endPick();
      return;
    }
    pickModeRef.current = session;
    pickOverlayRef.current?.setGhostSource(meshMapRef.current.get(session.selId));
    const at = copyPointerRef.current;
    if (at) updatePickHover(at.x, at.y);
    session.lastInsertedKey = old.lastInsertedKey;
    renderPick();
  };

  // --- The target hole or pin end (openspec target-hole-placement) -----------------------------------
  // Alt held over the view lights the hole face or free pin/shaft end under the cursor; Alt+click
  // makes it the target, which a part clicked in the library then goes straight into.
  const altHoverRef = useRef(null); // { candidates, all, hovered } while Alt is held over the view
  const targetRef = useRef(null); // { instanceId, featureId, onShaft, which, outwardLocal }
  const targetOverlayRef = useRef(null);

  const isCappedEnd = (f, which) =>
    which === 'end' && catalogMapRef.current.get(meshMapRef.current.get(f.instanceId)?.userData.partId)?.fastenerSpecs?.fastenerType === 'capped_shaft';

  /** Feature entries of every visible part (featureEntryFor). */
  const visibleFeatureEntries = () => {
    const entries = [];
    for (const [instId, group] of meshMapRef.current.entries()) {
      if (!group.visible) continue;
      const entry = featureEntryFor(instId, group);
      if (entry) entries.push(entry);
    }
    return entries;
  };

  /**
   * The free ends of the pins, pegs and shafts of `entries` (of only the part `onlyId` when given):
   * each part is checked against the parts whose boxes meet its own.
   */
  const freeInsertEnds = (entries, onlyId = null) => {
    const ends = [];
    for (const e of entries) {
      if (onlyId && e.instanceId !== onlyId) continue;
      if (!e.features.some((f) => f.kind === 'pin' || f.kind === 'shaft')) continue;
      const near = entries.filter((o) => o === e || !o.partBox || !e.partBox || o.partBox.intersectsBox(e.partBox));
      for (const end of freeSetLeadEnds(near.flatMap((o) => o.features), { isCapped: isCappedEnd })) {
        if (end.feature.instanceId === e.instanceId) ends.push(end);
      }
    }
    return ends;
  };

  const sameTarget = (a, b) =>
    Boolean(a && b) &&
    a.opening.instanceId === b.opening.instanceId &&
    a.opening.featureId === b.opening.featureId &&
    Boolean(a.onShaft) === Boolean(b.onShaft) &&
    (a.onShaft ? a.which === b.which : a.face.outward.dot(b.face.outward) > 0.9);

  /** The target as it is now ({ opening, face, onShaft?, which? }), following its part; null when gone. */
  const resolveTarget = () => {
    const t = targetRef.current;
    if (!t) return null;
    const group = meshMapRef.current.get(t.instanceId);
    if (!group || !group.visible) return null;
    const opening = featureEntryFor(t.instanceId, group)?.features.find((f) => f.featureId === t.featureId);
    if (!opening) return null;
    if (t.onShaft) {
      const point = t.which === 'start' ? opening.start : opening.end;
      const other = t.which === 'start' ? opening.end : opening.start;
      return { opening, face: { point: point.clone(), outward: point.clone().sub(other).normalize() }, onShaft: true, which: t.which };
    }
    const want = t.outwardLocal.clone().applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
    const face = openFaces(opening).reduce((a, b) => (b.outward.dot(want) > a.outward.dot(want) ? b : a));
    return { opening, face };
  };

  /** Rings for the target and, while Alt is held, the lit hole or end (grey when taken). */
  const renderTarget = () => {
    const overlay = targetOverlayRef.current;
    if (!overlay) return;
    const ringOf = (c, taken = false) => ({ ...c.face, radiusMm: c.opening.radiusMm ?? (c.opening.kind === 'shaft' ? 2.6 : 3.4), taken });
    const rings = [];
    const target = resolveTarget();
    if (target) rings.push(ringOf(target));
    const lit = altHoverRef.current?.hovered;
    if (lit && !sameTarget(lit, target)) rings.push(ringOf(lit, lit.taken));
    overlay.showRings(rings);
  };

  const setTarget = (candidate) => {
    let next = null;
    if (candidate) {
      const group = meshMapRef.current.get(candidate.opening.instanceId);
      const inverse = group ? group.getWorldQuaternion(new THREE.Quaternion()).invert() : new THREE.Quaternion();
      next = {
        instanceId: candidate.opening.instanceId,
        featureId: candidate.opening.featureId,
        onShaft: Boolean(candidate.onShaft),
        which: candidate.which ?? null,
        outwardLocal: candidate.face.outward.clone().applyQuaternion(inverse)
      };
    }
    const had = Boolean(targetRef.current);
    targetRef.current = next;
    if (had !== Boolean(next)) onTargetChangeRef.current?.(Boolean(next));
    renderTarget();
  };

  /**
   * The part list changed: the target goes when its part is hidden or gone, or something now sits in
   * it (a part seated in the hole, or slid over the pin's end). The part being placed doesn't count.
   */
  const validateTarget = () => {
    const target = resolveTarget();
    if (!targetRef.current) return;
    let ok = Boolean(target);
    if (ok) {
      const placingId = pickModeRef.current?.place ? pickModeRef.current.selId : null;
      const entries = visibleFeatureEntries().filter((e) => e.instanceId !== placingId);
      ok = target.onShaft
        ? freeInsertEnds(entries, target.opening.instanceId).some((e) => e.feature.featureId === target.opening.featureId && e.which === target.which)
        : !isOpeningTaken(target.opening, entries.flatMap((e) => e.features));
    }
    if (ok) renderTarget();
    else setTarget(null);
  };

  /** True when Alt may light targets: nothing dragged, picked, placed, turned or exploded, no field focused. */
  const canAltHover = () => {
    const active = document.activeElement;
    return (
      !pickModeRef.current &&
      !transformRef.current?.dragging &&
      !rotateGestureRef.current &&
      !arrowOverlayRef.current?.isShown() &&
      explodeModeRef.current === 'off' &&
      !(active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable))
    );
  };

  /** Starts lighting targets: every open hole face and free pin/shaft end of the visible parts. */
  const startAltHover = () => {
    if (altHoverRef.current) return true;
    if (!canAltHover()) return false;
    const entries = visibleFeatureEntries();
    const all = entries.flatMap((e) => e.features);
    const candidates = [];
    for (const f of all) {
      if (f.kind === 'pin' || f.kind === 'shaft') continue;
      for (const face of openFaces(f)) candidates.push({ opening: f, face });
    }
    for (const end of freeInsertEnds(entries)) {
      candidates.push({ opening: end.feature, face: { point: end.point, outward: end.dir }, onShaft: true, which: end.which });
    }
    altHoverRef.current = { candidates, all, hovered: null };
    return true;
  };

  const endAltHover = () => {
    if (!altHoverRef.current) return;
    altHoverRef.current = null;
    if (inputElRef.current && !pickModeRef.current) inputElRef.current.style.cursor = '';
    renderTarget();
  };

  /** Lights the target under the cursor (canvas px) while Alt is held. */
  const updateAltHover = (canvasX, canvasY) => {
    const hover = altHoverRef.current;
    if (!hover) return;
    const front = nearestScreenTarget(hover.candidates, canvasX, canvasY);
    if (front ? sameTarget(front, hover.hovered) : !hover.hovered) return;
    hover.hovered = front ? { ...front, taken: !front.onShaft && isOpeningTaken(front.opening, hover.all) } : null;
    if (inputElRef.current) inputElRef.current.style.cursor = front ? 'pointer' : '';
    renderTarget();
  };

  /** Alt+click: set, move or clear the target at the lit hole or end. False when nothing is lit. */
  const altClick = () => {
    const lit = altHoverRef.current?.hovered;
    if (!lit) return false;
    if (lit.taken) {
      onMateFeedbackRef.current?.('That hole already has a part in it', true);
      return true;
    }
    setTarget(sameTarget(lit, resolveTarget()) ? null : lit);
    return true;
  };

  /** Double-click on the selected part: mate in its only direction, or offer arrows for several. */
  /**
   * With a battery selected, double-clicking a brain slides the battery into that brain's bay
   * (src/utils/batteryBay.js). Returns false when the selected part and `brainId` aren't a battery
   * and a brain it fits, so the double-click does its usual job.
   */
  const batteryFitsBrain = (batteryId, brainId) => {
    const partOf = (id) => partFor(instancesRef.current.find((i) => i.instanceId === id));
    return Boolean(brainId && batteryBayPose(partOf(batteryId), partOf(brainId), new THREE.Matrix4()));
  };

  const slideBatteryInto = (brainId) => {
    const selId = selectedIdRef.current;
    const group = selId ? meshMapRef.current.get(selId) : null;
    const brain = meshMapRef.current.get(brainId);
    const inst = instancesRef.current.find((i) => i.instanceId === selId);
    const brainInst = instancesRef.current.find((i) => i.instanceId === brainId);
    if (!group || !brain || !inst || !brainInst || explodeModeRef.current !== 'off') return false;
    brain.updateMatrixWorld(true);
    const pose = batteryBayPose(partFor(inst), partFor(brainInst), brain.matrixWorld);
    if (!pose) return false;
    const feedback = (message, isError = false) => onMateFeedbackRef.current?.(message, isError);
    if (inst.locked) {
      feedback('Part is locked', true);
      return true;
    }
    const before = groupPose(group);
    poseGroup(group, pose);
    if (checkGroupCollision(group, false)) {
      poseGroup(group, before);
      feedback(`Can't slide ${inst.label} into ${brainInst.label}: something is in the way`, true);
      return true;
    }
    commitPlacement(group, { label: `Slide ${inst.label} into ${brainInst.label}`, settle: false });
    feedback(`Slid ${inst.label} into ${brainInst.label}`);
    return true;
  };

  const handleMateRequest = () => {
    const members = selectedSetMembers();
    if (members) return mateSetRequest(members);
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
    // Only its holes line up (hole to hole) while its own pins/shafts line up with nothing: offer the
    // stacking arrow and hole picking for the pins together, instead of stacking straight away
    const partMeta = partFor(group.userData);
    const hasInserts = getLocalFeatures(partMeta).some((f) => f.kind === 'pin' || f.kind === 'shaft');
    let action = mateAction(plans, hasInserts);
    // A bore part with nothing lined up picks an axle or hole to go onto
    if (action === 'none' && isBorePart(partMeta)) action = 'pick';
    if (action === 'none') {
      feedback('Nothing lined up to mate with', true);
    } else if (action === 'pick') {
      // Nothing lined up: a part with pins or shafts can pick any hole instead
      startPick();
    } else if (action === 'mate') {
      mateSelected(plans[0]);
    } else {
      showMateArrows(plans, group);
      if (action === 'arrows+pick') startPick({ alongsideArrows: true });
    }
  };

  /** Selects the ring the mouse wheel turns (-1: none, the wheel zooms again). */
  const selectRing = (index) => {
    if (rotateGestureRef.current?.kind === 'wheel') commitRotation();
    selectedRingRef.current = index;
    rotateGizmoRef.current?.setSelected(index);
    if (orbitRef.current) orbitRef.current.enableZoom = index < 0;
    refreshAnchorLines();
  };

  /**
   * For one part held on two or more joint lines with a ring selected: shows the joint lines parallel
   * to that ring (other than the one the rings sit on) as anchors to click, and a dashed line through
   * the part's default centre once the rings have been moved off it.
   */
  const refreshAnchorLines = () => {
    const gizmo = rotateGizmoRef.current;
    const setup = rotateSetupRef.current;
    if (!gizmo) return;
    const ring = selectedRingRef.current;
    if (!setup?.instanceId || !setup.defaultPivot || (setup.lines?.length ?? 0) < 2 || ring < 0 || !setup.rings[ring]) {
      if (setup) setup.shownAnchors = [];
      gizmo.setAnchorLines([], null);
      return;
    }
    const axis = setup.rings[ring].axis;
    const anchors = parallelLines(setup.lines, axis, { exclude: setup.pivot });
    setup.shownAnchors = anchors;
    const off = setup.defaultPivot.clone().sub(setup.pivot).projectOnPlane(axis).length() > 0.25;
    gizmo.setAnchorLines(
      anchors.map((l) => ({ origin: l.origin, axis: l.axis })),
      off ? { origin: setup.defaultPivot, axis } : null
    );
  };

  /**
   * Moves the rings' centre onto a picked anchor line (the point on it nearest the part's centre), or
   * back to the default centre. The part doesn't move, the ring stays selected, angles carry on.
   */
  const chooseRotateAnchor = (picked) => {
    const setup = rotateSetupRef.current;
    const group = setup?.instanceId ? meshMapRef.current.get(setup.instanceId) : null;
    if (!group || !picked || rotateGestureRef.current) return;
    let pivot;
    if (picked.kind === 'default') {
      pivot = setup.defaultPivot.clone();
    } else {
      const line = setup.shownAnchors?.[picked.index];
      if (!line) return;
      const axis = line.axis.clone().normalize();
      pivot = line.origin.clone().addScaledVector(axis, setup.center.clone().sub(line.origin).dot(axis));
    }
    group.updateMatrixWorld();
    setup.localPivot = pivot.applyMatrix4(group.matrixWorld.clone().invert());
    refreshRotateSetup();
  };

  /**
   * Works out how the selected part may turn in Rotate mode and shows its rings: free -> world X/Y/Z
   * rings through the part's center; held on one axis line -> one ring around that line; locked,
   * Explode on, or held on several axis lines -> no rings and a message. Ring angles carry over while
   * the same part keeps the same rings and start at 0° otherwise.
   */
  /** The selected set's members as [{ id, group, inst }], or null with fewer than two parts selected. */
  const selectedSetMembers = () => {
    const ids = selectedIdsRef.current;
    if (ids.length < 2) return null;
    const out = [];
    for (const id of ids) {
      const group = meshMapRef.current.get(id);
      const inst = instancesRef.current.find((i) => i.instanceId === id);
      if (group && inst) out.push({ id, group, inst });
    }
    return out.length > 1 ? out : null;
  };

  /** Centre of the members' combined world box. */
  const setCentreOf = (members) => {
    const box = new THREE.Box3();
    for (const { group } of members) {
      group.updateMatrixWorld();
      if (group.userData.localBox && !group.userData.localBox.isEmpty()) box.union(group.userData.localBox.clone().applyMatrix4(group.matrixWorld));
      else box.expandByPoint(group.position);
    }
    return box.getCenter(new THREE.Vector3());
  };

  /** Every member's world pins and holes, as posed in the scene. */
  const setMemberFeatures = (members) =>
    members.flatMap(({ id, group }) => {
      const meta = partFor(group.userData);
      if (!meta) return [];
      group.updateMatrixWorld();
      return collectWorldFeatures(meta, group.matrixWorld, id, getMeshMeasurements(group, meta));
    });

  // Why a set can't be moved, or null
  const setBlockedMessage = (members) =>
    members.some((m) => m.inst.locked) ? 'Part is locked' : members.some((m) => m.inst.visible === false) ? 'Some parts are hidden' : null;

  /** Rotate rings for a set: X, Y and Z about the set's centre (kept with the set between turns). */
  const refreshSetRotateSetup = (members) => {
    const gizmo = rotateGizmoRef.current;
    const labels = angleLabelsRef.current;
    const prev = rotateSetupRef.current;
    const ids = members.map((m) => m.id);
    const setKey = ids.join(',');
    const clear = (message = '') => {
      rotateSetupRef.current = null;
      if (selectedRingRef.current >= 0) selectRing(-1);
      gizmo.hide();
      labels.hide();
      const key = message ? `${setKey}:${message}` : '';
      if (message && rotateMessageKeyRef.current !== key) onMateFeedbackRef.current?.(message, true);
      rotateMessageKeyRef.current = key;
    };
    if (transformModeRef.current !== 'rotate') return clear();
    const blocked = setBlockedMessage(members);
    if (blocked) return clear(blocked);
    if (explodeModeRef.current !== 'off') return clear("Can't rotate in Explode view");

    const ref = members[0].group;
    ref.updateMatrixWorld();
    // The pivot stays in the first member's frame between turns, so repeated turns go about one point
    const pivot =
      prev?.setKey === setKey && prev.localPivot ? prev.localPivot.clone().applyMatrix4(ref.matrixWorld) : setGridPivot(setMemberFeatures(members), setCentreOf(members));
    const rings = [
      { name: 'X', axis: new THREE.Vector3(1, 0, 0) },
      { name: 'Y', axis: new THREE.Vector3(0, 1, 0) },
      { name: 'Z', axis: new THREE.Vector3(0, 0, 1) }
    ];
    const corners = [];
    for (const { group } of members) {
      const lb = group.userData.localBox;
      if (!lb || lb.isEmpty()) continue;
      for (const x of [lb.min.x, lb.max.x]) {
        for (const y of [lb.min.y, lb.max.y]) {
          for (const z of [lb.min.z, lb.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(group.matrixWorld));
        }
      }
    }
    const minRadiusFor = (axis) => Math.max(10, ...corners.map((c) => c.clone().sub(pivot).projectOnPlane(axis).length())) * 1.05 + 2;
    const same = prev?.setKey === setKey && prev.pivot.distanceTo(pivot) < 0.5;
    const angles = same ? prev.angles : rings.map(() => 0);
    if (!same && selectedRingRef.current >= 0) selectRing(-1);
    const localPivot = pivot.clone().applyMatrix4(ref.matrixWorld.clone().invert());
    rotateSetupRef.current = { instanceId: null, ids, setKey, pivot, localPivot, rings, angles };
    rotateMessageKeyRef.current = '';
    const setCentre = setCentreOf(members);
    const halfMm = Math.max(10, ...corners.map((c) => c.distanceTo(setCentre))) + 10;
    gizmo.show(
      pivot,
      rings.map((r) => ({ axis: r.axis, color: ROTATE_RING_COLORS[r.name], minRadius: minRadiusFor(r.axis) })),
      { center: setCentre, halfMm }
    );
    if (cameraRef.current) gizmo.updateScale(cameraRef.current);
    gizmo.setSelected(selectedRingRef.current);
    labels.show(rings.map((r) => r.name));
    angles.forEach((deg, i) => labels.setAngle(i, deg));
    refreshAnchorLines();
  };

  // --- Dragging a set (openspec group-snapping) -------------------------------------------------------

  /** A part's world box as posed (a point box at its position when it has no model box). */
  const posedBox = (group) => {
    group.updateMatrixWorld();
    const lb = group.userData.localBox;
    return lb && !lb.isEmpty() ? lb.clone().applyMatrix4(group.matrixWorld) : new THREE.Box3(group.position.clone(), group.position.clone());
  };

  /**
   * The set's edge members: those whose box, grown by `marginMm`, meets the box of a visible part
   * outside the set (cached at drag start; outside parts don't move). Only these can overlap anything,
   * so overlap tests that look only at them give the same answer as testing every member.
   */
  const setEdgeIds = (drag, marginMm = 0.5) => {
    const edge = new Set();
    for (const id of drag.ids) {
      const g = meshMapRef.current.get(id);
      if (!g) continue;
      const box = posedBox(g).expandByScalar(marginMm);
      if (drag.outsideBoxes.some((b) => b.intersectsBox(box))) edge.add(id);
    }
    return edge;
  };

  /** Overlaps of the set's edge members with outside parts, as a Set of `memberId|otherId`. */
  const setOverlapPairs = (drag) => {
    const pairs = new Set();
    for (const id of drag.edge) {
      const g = meshMapRef.current.get(id);
      if (!g) continue;
      const hits = [];
      checkGroupCollision(g, false, drag.ignore, hits);
      for (const other of hits) pairs.add(`${id}|${other}`);
    }
    return pairs;
  };

  /** A point of the set at its start pose, turned by `turn` ({ quaternion, pivot } or null) and moved by `delta`. */
  const setPointAt = (p, delta, turn) => {
    const out = p.clone();
    if (turn) out.sub(turn.pivot).applyQuaternion(turn.quaternion).add(turn.pivot);
    return out.add(delta);
  };

  /** Poses every member from its start pose: turned by `turn`, then moved by `delta`. */
  const poseSetMembers = (drag, delta, turn = null) => {
    for (const [id, start] of drag.starts) {
      const g = meshMapRef.current.get(id);
      if (!g) continue;
      g.position.copy(setPointAt(start.pos, delta, turn));
      g.quaternion.copy(start.quat);
      if (turn) g.quaternion.premultiply(turn.quaternion);
      g.updateMatrixWorld();
    }
  };

  /** The set's free outer features (taken at its start pose) where `delta` and `turn` put them. */
  const setFeaturesAt = (drag, delta, turn = null) =>
    drag.features.map((f) => {
      const moved = { ...f, origin: setPointAt(f.origin, delta, turn), start: setPointAt(f.start, delta, turn), end: setPointAt(f.end, delta, turn) };
      if (turn) {
        moved.axis = f.axis.clone().applyQuaternion(turn.quaternion);
        if (f.flatDir) moved.flatDir = f.flatDir.clone().applyQuaternion(turn.quaternion);
      }
      return moved;
    });

  /** Outside parts' features near the set at `delta` (its start box moved, grown by the set reach). */
  const setSnapCandidates = (drag, delta) => {
    const reach = drag.box.clone().translate(delta).expandByScalar(SET_HOLE_SNAP_AXIAL_REACH_MM + drag.turnSlackMm);
    const out = [];
    for (const other of otherFeaturesRef.current) {
      if (other.partBox && !reach.intersectsBox(other.partBox)) continue;
      for (const f of other.features) out.push(f);
    }
    return out;
  };

  /**
   * The selected set as it is now, for moving it as one: start poses, its free outer features, the
   * outside parts' boxes (and their features in otherFeaturesRef), its edge members and its overlaps.
   */
  const setContext = () => {
    const ids = selectedIdsRef.current.filter((id) => meshMapRef.current.has(id));
    const ignore = new Set(ids);
    rebuildOtherFeatures(ignore);
    const members = ids.map((id) => ({ id, group: meshMapRef.current.get(id) }));
    const starts = new Map(members.map(({ id, group }) => [id, { pos: group.position.clone(), quat: group.quaternion.clone() }]));
    const box = new THREE.Box3();
    for (const { group } of members) box.union(posedBox(group));
    const outsideBoxes = [];
    for (const [id, g] of meshMapRef.current.entries()) if (!ignore.has(id) && g.visible) outsideBoxes.push(posedBox(g));
    const all = setMemberFeatures(members);
    const ctx = { ids, ignore, starts, box, outsideBoxes, all, features: freeSetFeatures(all), turnSlackMm: 0 };
    ctx.edge = setEdgeIds(ctx);
    ctx.startOverlap = setOverlapPairs(ctx);
    return ctx;
  };

  /** The set's name for messages and steps: its group's name when it is a whole group, else "N parts". */
  const setNameOf = (ids) => wholeGroupOf(instancesRef.current, ids)?.name || `${ids.length} parts`;

  /** Starts a set drag from the set's context. */
  const startSetDrag = () => {
    const drag = setContext();
    Object.assign(drag, {
      // A straightening turn (at most 5°) can swing the far end of a big set this much
      turnSlackMm: drag.box.getSize(new THREE.Vector3()).length() * Math.sin(THREE.MathUtils.degToRad(5)),
      delta: new THREE.Vector3(),
      turn: null,
      snapLine: null,
      leftStart: false,
      lastCheckAt: 0,
      moved: [],
      candidates: []
    });
    setDragRef.current = drag;
  };

  /** Lined-up pairs no further apart along their line than the set reach. */
  const withinSetReach = (a) =>
    Math.min(a.insertStart.clone().sub(a.face).dot(a.outward), a.insertEnd.clone().sub(a.face).dot(a.outward)) <= SET_HOLE_SNAP_AXIAL_REACH_MM;

  /** True when the set (`ctx`) as posed overlaps an outside part it didn't overlap in its context. */
  const setHasNewOverlap = (ctx) => {
    ctx.edge = setEdgeIds(ctx);
    return [...setOverlapPairs(ctx)].some((pair) => !ctx.startOverlap.has(pair));
  };

  /**
   * Pushes the selected set along `plan` (planMates, or a picked hole's fit): sideways onto the line,
   * then along the direction until a member touches an outside part (bisected to contact) or the plan's
   * travel ends; one step. A push that ends in a new overlap leaves the set where it was. `ctx`: the
   * set's context (taken now when not given); `from` ({ quaternion, pivot, offset }): a picked fit's
   * pose to start from instead of where the set is.
   */
  const mateSet = async (plan, { ctx = setContext(), from = null, label = null, message = null } = {}) => {
    const feedback = (text, isError = false) => onMateFeedbackRef.current?.(text, isError);
    const turn = from ? { quaternion: from.quaternion, pivot: from.pivot } : null;
    const base = (from ? from.offset.clone() : new THREE.Vector3()).add(plan.lateral || new THREE.Vector3());
    const poseAt = (d) => poseSetMembers(ctx, base.clone().addScaledVector(plan.direction, d), turn);
    const putBack = (text) => {
      poseSetMembers(ctx, new THREE.Vector3(), null);
      const members = selectedSetMembers();
      if (members) markSetOverlaps(members, ctx.ignore);
      feedback(text, true);
      syncGizmos();
    };
    poseAt(0);
    if (setHasNewOverlap(ctx)) return putBack(from ? 'The way in is blocked: something is in the way just outside that hole' : "Can't mate: already touching another part");
    const STEP_MM = 0.5;
    const travel = Math.max(0, plan.travelMm);
    const sweep = Math.max(travel, plan.sweepMm ?? 0);
    let clear = 0;
    let final = null;
    for (let d = Math.min(STEP_MM, sweep); d > 0; d = Math.min(d + STEP_MM, sweep)) {
      poseAt(d);
      if (setHasNewOverlap(ctx)) {
        let blocked = d;
        for (let i = 0; i < 10; i++) {
          const mid = (clear + blocked) / 2;
          poseAt(mid);
          if (setHasNewOverlap(ctx)) blocked = mid;
          else clear = mid;
        }
        final = clear;
        break;
      }
      clear = d;
      if (d >= sweep) break;
    }
    poseAt(final ?? travel);
    // Then Fix assembly's fit (square up and seat), as when a dragged set is let go; Alt skips it
    let fitNote = '';
    if (!altKeyRef.current) {
      const fitted = await fitSetNow(ctx.ids);
      if (fitted.aborted) return;
      fitNote = fitted.note;
    }
    roundSetPoses(ctx.ids);
    if (setHasNewOverlap(ctx)) return putBack("Can't place it there: it would overlap another part. Put back.");
    const partnerIds = new Set(plan.pairs?.map((p) => (ctx.ignore.has(p.insertInstanceId) ? p.instanceId : p.insertInstanceId)) || []);
    if (plan.receivingId) partnerIds.add(plan.receivingId);
    const onto = [...partnerIds].map((id) => instancesRef.current.find((i) => i.instanceId === id)?.label || id).join(', ');
    const name = setNameOf(ctx.ids);
    const stepLabel = label || `Mate ${name} onto ${onto}`;
    commitSetPoses(ctx.ids, 'move', { edge: ctx.edge, label: fitNote ? `${stepLabel}. ${fitNote}` : stepLabel });
    feedback([message || `Mated ${name} with ${onto}`, fitNote].filter(Boolean).join('. '));
    syncGizmos();
  };

  /** A clicked mate arrow: mates the selected set, or the selected part. */
  const mateArrowPlan = (plan) => {
    if (selectedSetMembers()) mateSet(plan);
    else mateSelected(plan);
  };

  /**
   * Double-click on a selected set: push it in when its free pins and holes are lined up within the set
   * reach (arrows when there are several ways in), else hole picking with the pins that face a hole.
   */
  const mateSetRequest = (members) => {
    const feedback = (text, isError = false) => onMateFeedbackRef.current?.(text, isError);
    try {
      mateSetRequestUnchecked(members, feedback);
    } catch (err) {
      console.error('Mating the set failed', err);
      feedback(`Couldn't mate the set: ${err.message}`, true);
    }
  };
  const mateSetRequestUnchecked = (members, feedback) => {
    if (explodeModeRef.current !== 'off') return feedback("Can't mate in Explode view", true);
    const blocked = setBlockedMessage(members);
    if (blocked) return feedback(blocked, true);
    const ctx = setContext();
    const candidates = setSnapCandidates(ctx, new THREE.Vector3());
    const aligned = findAlignedOpenings(ctx.features, candidates).filter(withinSetReach);
    const plans = planMates(aligned, ctx.ignore);
    if (plans.length === 1) return mateSet(plans[0], { ctx });
    if (plans.length > 1) return showMateArrows(plans, setCentreOf(members));
    if (!startSetPick(ctx)) feedback('Turn or move the group so its pins face the part to mate it to', true);
  };

  /**
   * Hole picking for the selected set (group-snapping): only the hole faces that one of its leading
   * ends points within 30° of straight into. Returns false when there are none.
   */
  const startSetPick = (ctx) => {
    const capped = (f, which) =>
      which === 'end' && catalogMapRef.current.get(meshMapRef.current.get(f.instanceId)?.userData.partId)?.fastenerSpecs?.fastenerType === 'capped_shaft';
    const leads = freeSetLeadEnds(ctx.all, { isCapped: capped });
    if (!leads.length) return false;
    const others = otherFeaturesRef.current.flatMap((o) => o.features);
    const candidates = [];
    for (const f of others) {
      for (const face of openFaces(f)) if (setLeadsFacing(leads, f, face).length) candidates.push({ opening: f, face });
    }
    if (!candidates.length) return false;
    const selId = selectedIdRef.current;
    pickModeRef.current = {
      kind: 'pick',
      selId,
      set: { ...ctx, leads, name: setNameOf(ctx.ids) },
      partMeta: null,
      bore: false,
      followOnly: false,
      measured: null,
      meshNeighbours: null,
      startPosition: meshMapRef.current.get(selId)?.position.clone() ?? new THREE.Vector3(),
      startQuaternion: meshMapRef.current.get(selId)?.quaternion.clone() ?? new THREE.Quaternion(),
      transformMode: transformModeRef.current,
      explodeMode: explodeModeRef.current,
      candidates,
      others,
      hovered: null,
      fits: [],
      fitIndex: 0,
      message: null
    };
    const transform = transformRef.current;
    if (transform) {
      transform.enabled = false;
      transform.getHelper().visible = false;
    }
    pickOverlayRef.current?.setGhostSources(ctx.ids.map((id) => meshMapRef.current.get(id)).filter(Boolean));
    refreshRotateSetup();
    renderPick();
    return true;
  };

  /** A click on a hovered hole while picking for a set: pose the set at the fit and push it in. */
  const setPickClick = (pick) => {
    const fit = pick.fits[pick.fitIndex];
    if (!fit) return;
    const into = pickLabelOf(pick.hovered.opening.instanceId);
    const label = `Insert ${pick.set.name} into ${into}`;
    const ctx = pick.set;
    pick.keepPose = true;
    endPick();
    mateSet(
      { lateral: new THREE.Vector3(), direction: fit.direction, travelMm: fit.travelMm, sweepMm: fit.sweepMm, pairs: [], receivingId: pick.hovered.opening.instanceId },
      { ctx, from: fit, label, message: `Inserted ${pick.set.name} into ${into}` }
    );
  };

  /** World directions the Move arrows drag a set along (sets always use the world's axes). */
  const setDragDirections = () =>
    [...(transformRef.current?.axis || '').replace(/[^XYZ]/g, '')].map((l) => new THREE.Vector3(l === 'X' ? 1 : 0, l === 'Y' ? 1 : 0, l === 'Z' ? 1 : 0));

  /**
   * One frame of a set drag, with the pivot at its whole-step position: straightens a small tilt, pulls
   * onto holes within the set reach (never back to the start until it has left it), poses the members.
   */
  const dragSetFrame = (drag, pivotObj, rawPos) => {
    const start = dragStartPosRef.current;
    if (rawPos.distanceTo(start) > HOLE_SNAP_RADIUS_MM) drag.leftStart = true;
    let delta = pivotObj.position.clone().sub(start);
    let turn = null;
    drag.snapLine = null;
    const directions = setDragDirections();
    if (!altKeyRef.current && drag.features.length && directions.length) {
      drag.candidates = setSnapCandidates(drag, delta);
      const reach = { axialReachMm: SET_HOLE_SNAP_AXIAL_REACH_MM };
      const st = findStraighten(setFeaturesAt(drag, delta), drag.candidates, reach);
      if (st) turn = { quaternion: st.quaternion, pivot: st.pivot.clone().sub(delta) };
      const rejectMove = (offset) => !drag.leftStart && !turn && delta.clone().add(offset).length() < 0.25;
      const snap = findHoleSnap(setFeaturesAt(drag, delta, turn), drag.candidates, directions, { ...reach, rejectMove });
      if (snap) {
        const snapped = delta.clone().add(snap.offset);
        // Dragged axes along the hole's line stay on the drag grid
        for (const dir of directions) {
          if (Math.abs(dir.dot(snap.opening.axis)) > 0.999) snapped.addScaledVector(dir, delta.clone().sub(snapped).dot(dir));
        }
        delta = new THREE.Vector3(...snapped.toArray().map((v) => Number(v.toFixed(3))));
        drag.snapLine = snap.opening.axis.clone();
      }
    }
    drag.delta = delta;
    drag.turn = turn;
    drag.moved = altKeyRef.current ? [] : setFeaturesAt(drag, delta, turn);
    pivotObj.position.copy(start).add(delta);
    poseSetMembers(drag, delta, turn);
  };

  /** The set's lined-up pairs (within the set reach along the line) as hole highlights. */
  const showSetHighlights = (drag) => {
    const overlay = holeOverlayRef.current;
    if (!overlay) return;
    const aligned = drag.moved.length
      ? findAlignedOpenings(drag.moved, drag.candidates).filter((a) => {
          const gap = Math.min(a.insertStart.clone().sub(a.face).dot(a.outward), a.insertEnd.clone().sub(a.face).dot(a.outward));
          return gap <= SET_HOLE_SNAP_AXIAL_REACH_MM;
        })
      : [];
    lastAlignedRef.current = aligned;
    overlay.show(aligned);
  };

  /** Puts each member at its pose as it will be saved (mm to 0.001, degrees to 0.01), so overlap tests see it. */
  const roundSetPoses = (ids) => {
    for (const id of ids) {
      const g = meshMapRef.current.get(id);
      if (g) poseGroup(g, groupPose(g));
    }
  };

  /**
   * Fix assembly's fit for the set `ids` where it is now (the engine's fit_set), while viewport input
   * waits; the members are posed at the fit. Returns { note } ('' when nothing was fitted), or
   * { aborted: true } when the build or selection changed meanwhile (the move is then not saved).
   */
  const fitSetNow = async (ids) => {
    if (!onFitSetRef.current) return { note: '' };
    const poses = {};
    for (const id of ids) {
      const g = meshMapRef.current.get(id);
      if (g) poses[id] = groupPose(g);
    }
    const instancesBefore = instancesRef.current;
    const selectionBefore = selectedIdsRef.current.join(',');
    fitPendingRef.current = true;
    transformRef.current?.detach();
    let fit = null;
    try {
      fit = await onFitSetRef.current(ids, poses);
    } catch {
      fit = null;
    } finally {
      fitPendingRef.current = false;
    }
    // The build or the selection changed while it was worked out: the scene already shows that
    if (instancesRef.current !== instancesBefore || selectedIdsRef.current.join(',') !== selectionBefore) {
      onMateFeedbackRef.current?.('The build changed while the parts were being lined up, so the move was not saved.', true);
      syncGizmos();
      return { aborted: true };
    }
    if (!fit?.ok || !fit.poses) return { note: '' };
    for (const id of ids) {
      const g = meshMapRef.current.get(id);
      if (g && fit.poses[id]) poseGroup(g, fit.poses[id]);
    }
    return { note: `Lined up ${fit.pairs} pin${fit.pairs === 1 ? '' : 's'} and hole${fit.pairs === 1 ? '' : 's'} with ${fit.onto}` };
  };

  /**
   * A set drag let go: slide clear along the snap line, fit onto nearby holes (Fix assembly's rules, in
   * the engine), then save as one step, or put the set back when it now overlaps something new.
   */
  const finishSetDrag = async (drag) => {
    const members = () => selectedSetMembers() || [];
    const factor = snapPitchFactorRef.current;
    const step = factor && factor > 0 ? VEX_PITCH_MM * factor : 0;
    // 1. Lined up on a hole line but pressed into something: the nearest clear spot along it
    if (drag.snapLine) {
      const reach = Math.max(VEX_PITCH_MM * 0.25, step / 2);
      drag.edge = setEdgeIds(drag, reach + 0.5);
      if (setOverlapPairs(drag).size) {
        const base = new Map(drag.ids.map((id) => [id, meshMapRef.current.get(id)?.position.clone()]));
        const shiftBy = (t) => {
          for (const [id, pos] of base) {
            const g = meshMapRef.current.get(id);
            if (!g || !pos) continue;
            g.position.copy(pos).addScaledVector(drag.snapLine, t);
            g.updateMatrixWorld();
          }
        };
        const d = clearSpotAlongLine((t) => {
          shiftBy(t);
          return setOverlapPairs(drag).size === 0;
        }, reach);
        shiftBy(d ?? 0);
      }
    }
    // 2. The fit, unless Alt is held or the set never left where it started
    let note = '';
    if (!altKeyRef.current && drag.leftStart) {
      const fitted = await fitSetNow(drag.ids);
      if (fitted.aborted) return;
      note = fitted.note;
    }
    roundSetPoses(drag.ids);
    // 3. Something new overlapped: back to where the drag started, nothing saved
    drag.edge = setEdgeIds(drag);
    const overlaps = setOverlapPairs(drag);
    if ([...overlaps].some((pair) => !drag.startOverlap.has(pair))) {
      poseSetMembers(drag, new THREE.Vector3(), null);
      markSetOverlaps(members(), drag.ignore);
      onMateFeedbackRef.current?.("Can't place it there: it would overlap another part. Put back.", true);
      syncGizmos();
      return;
    }
    commitSetPoses(drag.ids, 'move', { note, edge: drag.edge });
    if (note) onMateFeedbackRef.current?.(note);
    syncGizmos();
  };

  // Members of a moving set marked overlapping only by parts outside the set. `edge`: when given, only
  // these members are tested (the others are too far from every outside part to overlap one)
  const markSetOverlaps = (members, ignore, edge = null) => {
    const overlaps = new Map();
    for (const { id, group, inst } of members) {
      const isColliding = edge && !edge.has(id) ? false : checkGroupCollision(group, false, ignore, null, true);
      group.userData.isIntersecting = isColliding;
      overlaps.set(id, isColliding);
      applyGroupAppearance(group, {
        baseColor: resolvePartBaseColor(inst, partFor(inst)),
        isSelected: selectLevel(selectedIdsRef.current, id),
        isIntersecting: isColliding
      });
    }
    return overlaps;
  };

  const refreshRotateSetup = () => {
    const gizmo = rotateGizmoRef.current;
    const labels = angleLabelsRef.current;
    if (!gizmo || !labels || rotateGestureRef.current) return;
    const members = selectedSetMembers();
    if (members) return refreshSetRotateSetup(members);
    const selId = selectedIdRef.current;
    const group = selId ? meshMapRef.current.get(selId) : null;
    const inst = selId ? instancesRef.current.find((i) => i.instanceId === selId) : null;
    const partMeta = group ? partFor(group.userData) : null;
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

    if (
      transformModeRef.current !== 'rotate' ||
      !group ||
      !inst ||
      !partMeta ||
      inst.visible === false
    ) {
      return clear();
    }
    if (inst.locked) return clear('Part is locked');
    if (explodeModeRef.current !== 'off') return clear("Can't rotate in Explode view");
    if (arrowOverlayRef.current?.isShown() || pickModeRef.current?.kind === 'pick' || !group.userData.localBox) return clear();

    group.updateMatrixWorld();
    const selectedFeatures = collectWorldFeatures(
      partMeta,
      group.matrixWorld,
      selId,
      getMeshMeasurements(group, partMeta)
    );
    const candidates = otherFeaturesRef.current.flatMap((o) => (o.instanceId === selId ? [] : o.features));
    const { lines } = findEngagedJoints(selectedFeatures, candidates);
    // Held on more than one axis line: it can still turn freely; a turn that ends overlapping is put back

    const center = group.userData.localBox.getCenter(new THREE.Vector3()).applyMatrix4(group.matrixWorld);
    const samePart = prev?.instanceId === selId;
    let pivot;
    let rings;
    let defaultPivot = null;
    if (lines.length !== 1) {
      // On the part's own hole grid, so quarter turns keep its holes lined up. Kept in the part's
      // frame between turns: turning about it leaves it in place, and it moves along with the part.
      // The user can move it onto one of the joint lines that hold the part (chooseRotateAnchor).
      defaultPivot =
        samePart && prev.localDefaultPivot
          ? prev.localDefaultPivot.clone().applyMatrix4(group.matrixWorld)
          : gridPivot(selectedFeatures, center);
      pivot = samePart && prev.localPivot ? prev.localPivot.clone().applyMatrix4(group.matrixWorld) : defaultPivot.clone();
      // A ring whose axis runs along a joint line through the pivot turns about that line exactly
      const ringAxis = (worldAxis) => {
        const line = parallelLines(lines, worldAxis).find((l) => parallelLines([l], worldAxis, { exclude: pivot }).length === 0);
        if (!line) return worldAxis;
        const axis = line.axis.clone().normalize();
        return axis.dot(worldAxis) < 0 ? axis.negate() : axis;
      };
      // The rings follow the part's own axes, like the Move arrows; Alt shows the world's
      const own = altKeyRef.current ? new THREE.Quaternion() : group.getWorldQuaternion(new THREE.Quaternion());
      rings = [
        { name: 'X', axis: ringAxis(new THREE.Vector3(1, 0, 0).applyQuaternion(own)) },
        { name: 'Y', axis: ringAxis(new THREE.Vector3(0, 1, 0).applyQuaternion(own)) },
        { name: 'Z', axis: ringAxis(new THREE.Vector3(0, 0, 1).applyQuaternion(own)) }
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

    // X/Y/Z rings keep their angles while the part stays selected, even when the centre is moved
    // onto an anchor; the single Joint ring starts again when it moves to another line.
    const same =
      samePart &&
      prev.rings.length === rings.length &&
      prev.rings.every((r, i) => r.name === rings[i].name) &&
      (rings[0].name !== 'Joint' || (prev.rings[0].axis.dot(rings[0].axis) > 0.9999 && prev.pivot.distanceTo(pivot) < 0.5));
    const angles = same ? prev.angles : rings.map(() => 0);
    if (!same && selectedRingRef.current >= 0) selectRing(-1);

    const toLocal = group.matrixWorld.clone().invert();
    const localPivot = lines.length !== 1 ? pivot.clone().applyMatrix4(toLocal) : null;
    const localDefaultPivot = defaultPivot ? defaultPivot.clone().applyMatrix4(toLocal) : null;
    rotateSetupRef.current = { instanceId: selId, pivot, localPivot, defaultPivot, localDefaultPivot, lines, center, rings, angles };
    rotateMessageKeyRef.current = '';
    const halfMm = group.userData.localBox.getSize(new THREE.Vector3()).length() / 2 + 10;
    gizmo.show(
      pivot,
      rings.map((r) => ({ axis: r.axis, color: ROTATE_RING_COLORS[r.name], minRadius: minRadiusFor(r.axis) })),
      { center, halfMm }
    );
    if (cameraRef.current) gizmo.updateScale(cameraRef.current);
    gizmo.setSelected(selectedRingRef.current);
    labels.show(rings.map((r) => r.name));
    angles.forEach((deg, i) => labels.setAngle(i, deg));
    refreshAnchorLines();
  };

  /** Starts a turn of the selected part around ring `ring`, remembering the pose it started from. */
  const beginRotateGesture = (kind, ring, extra = {}) => {
    const setup = rotateSetupRef.current;
    if (setup?.ids) {
      // A set: every member turns from where it started
      const starts = new Map();
      for (const id of setup.ids) {
        const g = meshMapRef.current.get(id);
        if (g) starts.set(id, { pos: g.position.clone(), quat: g.quaternion.clone() });
      }
      // Already overlapping outside parts at the start: such a turn isn't put back for overlapping
      const ignore = new Set(setup.ids);
      const startOverlap = setup.ids.some((id) => {
        const g = meshMapRef.current.get(id);
        return g ? checkGroupCollision(g, false, ignore) : false;
      });
      rotateGestureRef.current = { kind, ring, ids: setup.ids, starts, startOverlap, startAngle: setup.angles[ring], ...extra };
      return rotateGestureRef.current;
    }
    const group = setup ? meshMapRef.current.get(setup.instanceId) : null;
    if (!group) return null;
    rotateGestureRef.current = {
      kind,
      ring,
      instanceId: setup.instanceId,
      startPos: group.position.clone(),
      startQuat: group.quaternion.clone(),
      startOverlap: checkGroupCollision(group, false),
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
    if (setup?.ids && gesture?.ids) {
      const q = new THREE.Quaternion().setFromAxisAngle(setup.rings[ring].axis, THREE.MathUtils.degToRad(totalDeg - gesture.startAngle));
      for (const [id, start] of gesture.starts) {
        const g = meshMapRef.current.get(id);
        if (!g) continue;
        g.position.copy(start.pos).sub(setup.pivot).applyQuaternion(q).add(setup.pivot);
        g.quaternion.copy(q).multiply(start.quat);
        g.updateMatrixWorld();
      }
      setup.angles[ring] = totalDeg;
      angleLabelsRef.current?.setAngle(ring, totalDeg);
      // Overlaps with outside parts, at most every 150 ms while turning (and again when it's saved)
      const now = performance.now();
      if (!gesture.lastCheckAt || now - gesture.lastCheckAt > 150) {
        gesture.lastCheckAt = now;
        const members = selectedSetMembers();
        if (members) markSetOverlaps(members, new Set(gesture.ids));
      }
      return;
    }
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
    const partMeta = partFor(group.userData);
    const isColliding = checkGroupCollision(group, false, null, null, true);
    group.userData.isIntersecting = isColliding;
    applyGroupAppearance(group, {
      baseColor: resolvePartBaseColor(inst, partMeta),
      isSelected: true,
      isIntersecting: isColliding
    });
    updateAlignedHoleHighlights();
  };

  /** A finished turn that would overlap another part: the ring's angle goes back, with a message. */
  const putBackTurn = (gesture) => {
    const setup = rotateSetupRef.current;
    if (setup?.angles && gesture.ring >= 0 && gesture.ring < setup.angles.length) {
      setup.angles[gesture.ring] = gesture.startAngle;
      angleLabelsRef.current?.setAngle(gesture.ring, gesture.startAngle);
    }
    onMateFeedbackRef.current?.("Can't turn there: it would overlap another part. Put back.", true);
  };

  /** Saves the turned pose like a drag release; the instance sync then works out the rings again. */
  const commitRotation = () => {
    const gesture = rotateGestureRef.current;
    rotateGestureRef.current = null;
    if (gesture?.wheelTimer) clearTimeout(gesture.wheelTimer);
    rotateGizmoRef.current?.setDragging(-1);
    rotateGizmoRef.current?.clearSlices();
    if (gesture?.ids) {
      const members = selectedSetMembers();
      const overlaps = members ? markSetOverlaps(members, new Set(gesture.ids)) : new Map();
      if (!gesture.startOverlap && [...overlaps.values()].some(Boolean)) {
        for (const [id, start] of gesture.starts) {
          const g = meshMapRef.current.get(id);
          if (!g) continue;
          g.position.copy(start.pos);
          g.quaternion.copy(start.quat);
          g.updateMatrixWorld();
        }
        if (members) markSetOverlaps(members, new Set(gesture.ids));
        putBackTurn(gesture);
        return;
      }
      commitSetPoses(gesture.ids, 'turn');
      return;
    }
    const group = gesture ? meshMapRef.current.get(gesture.instanceId) : null;
    if (!group) return;
    const isColliding = checkGroupCollision(group, false, null, null, true);
    if (isColliding && !gesture.startOverlap) {
      group.position.copy(gesture.startPos);
      group.quaternion.copy(gesture.startQuat);
      group.updateMatrixWorld();
      group.userData.isIntersecting = false;
      const inst = instancesRef.current.find((i) => i.instanceId === gesture.instanceId);
      applyGroupAppearance(group, {
        baseColor: resolvePartBaseColor(inst, partFor(group.userData)),
        isSelected: selectLevel(selectedIdsRef.current, gesture.instanceId),
        isIntersecting: false
      });
      putBackTurn(gesture);
      updateAlignedHoleHighlights();
      return;
    }
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

  /** Saves a set's moved or turned poses as one step (`kind`: 'move' | 'turn'), with overlaps against outside parts. */
  const commitSetPoses = (ids, kind, { note = '', edge = null, label = null } = {}) => {
    const members = ids.map((id) => ({ id, group: meshMapRef.current.get(id), inst: instancesRef.current.find((i) => i.instanceId === id) })).filter((m) => m.group && m.inst);
    if (!members.length) return;
    const overlaps = markSetOverlaps(members, new Set(ids), edge);
    const patches = members.map(({ id, group }) => ({
      id,
      fields: {
        position: group.position.toArray().map((v) => Number(v.toFixed(3))),
        rotation: [group.rotation.x, group.rotation.y, group.rotation.z].map((r) => Number(THREE.MathUtils.radToDeg(r).toFixed(2))),
        isIntersecting: overlaps.get(id)
      }
    }));
    onUpdateSetRef.current?.(ids, patches, { kind, note, label });
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
    const members = selectedSetMembers();
    if (members) {
      // A set: the Move arrows on a pivot at its centre; none while exploded, locked or hidden
      const pivotObj = setPivotRef.current;
      const blocked = setBlockedMessage(members);
      const canMoveSet = transformModeRef.current === 'translate' && explodeModeRef.current === 'off' && !blocked && pivotObj;
      if (canMoveSet) {
        if (!transform.dragging) {
          pivotObj.position.copy(setCentreOf(members));
          pivotObj.quaternion.identity();
          pivotObj.updateMatrixWorld();
        }
        if (transform.object !== pivotObj) transform.attach(pivotObj);
        if (!transform.dragging) transform.setSpace('world'); // a set has no axes of its own
      } else {
        transform.detach();
        if (blocked && transformModeRef.current === 'translate') {
          const key = `${members.map((m) => m.id).join(',')}:${blocked}`;
          if (rotateMessageKeyRef.current !== key) onMateFeedbackRef.current?.(blocked, true);
          rotateMessageKeyRef.current = key;
        }
      }
      refreshRotateSetup();
      return;
    }
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
      // The arrows follow the part's own axes; Alt shows the world's
      if (!transform.dragging) transform.setSpace(altKeyRef.current ? 'world' : 'local');
    } else {
      transform.detach();
    }
    refreshRotateSetup();
  };

  // Expose a screenshot renderer to App.jsx for the MCP server's capture_screenshot tool. Everything
  // happens in one task (render, read the canvas, restore), so the user never sees a frame of it.
  useEffect(() => {
    if (!onRegisterScreenshot) return;
    const shoot = ({ view = 'iso', width = 1024, height = 768, focusInstanceId, direction } = {}) => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const container = containerRef.current;
      if (!renderer || !scene || !camera || !container) return null;

      // Frame the whole assembly (or one part) from a fixed direction per standard view (+X is the
      // front, +Z the right side), or from any `direction` [x, y, z] the caller gives
      const VIEW_DIRS = {
        iso: [1, 0.75, 1],
        'iso-front-left': [1, 0.75, -1],
        'iso-back-right': [-1, 0.75, 1],
        'iso-back-left': [-1, 0.75, -1],
        front: [1, 0, 0],
        back: [-1, 0, 0],
        side: [0, 0, 1],
        right: [0, 0, 1],
        left: [0, 0, -1],
        top: [0, 1, 0],
        bottom: [0, -1, 0]
      };
      const customDir = Array.isArray(direction) && direction.length === 3 && direction.some((n) => Number(n)) ? direction.map(Number) : null;
      // 'current' is the main view's own camera (orthographic when set; one picture, even in stereo);
      // the standard views always use perspective
      const shotCamera = (view === 'current' ? camera : perspCameraRef.current).clone();
      fitCameraToPane(shotCamera, { width, height });
      if (view !== 'current') {
        const box = new THREE.Box3();
        const focus = focusInstanceId ? meshMapRef.current.get(focusInstanceId) : null;
        if (focus) box.setFromObject(focus);
        else for (const g of meshMapRef.current.values()) if (g.visible) box.expandByObject(g);
        if (!box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 40);
          const dir = new THREE.Vector3(...(customDir || VIEW_DIRS[view] || VIEW_DIRS.iso)).normalize();
          shotCamera.position.copy(center).addScaledVector(dir, maxDim * 2.1 * Math.max(1, height / width));
          // Looking straight down (or up), +X is up in the picture (a robot facing +X has its front at the top)
          if (Math.abs(dir.y) > 0.99) shotCamera.up.set(1, 0, 0);
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
      const selIds = selectedIdsRef.current;
      const attIds = attentionIdsRef.current;
      for (const id of new Set([...selIds, ...attIds])) {
        const g = meshMapRef.current.get(id);
        const inst = instancesRef.current.find((i) => i.instanceId === id);
        if (g && inst) {
          applyGroupAppearance(g, {
            baseColor: resolvePartBaseColor(inst, partFor(g.userData)),
            isSelected: 0,
            isAttention: attIds.includes(id),
            attentionPulse: 1,
            isIntersecting: Boolean(g.userData.isIntersecting)
          });
        }
      }

      const pixelRatio = renderer.getPixelRatio();
      let png;
      try {
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        renderer.setScissorTest(false); // the frame loop draws panes with a scissor
        updateShadowsRef.current?.(shotCamera);
        renderer.render(scene, shotCamera);
        png = renderer.domElement.toDataURL('image/png').split(',')[1];
      } finally {
        renderer.setPixelRatio(pixelRatio);
        applyLayoutRef.current?.();
        overlays.forEach((o, i) => {
          o.visible = wasVisible[i];
        });
        for (const id of selIds) {
          const g = meshMapRef.current.get(id);
          const inst = instancesRef.current.find((i) => i.instanceId === id);
          if (g && inst) {
            applyGroupAppearance(g, {
              baseColor: resolvePartBaseColor(inst, partFor(g.userData)),
              isSelected: selectLevel(selIds, id),
              isAttention: attentionIdsRef.current.includes(id),
              isIntersecting: Boolean(g.userData.isIntersecting)
            });
          }
        }
        renderFrameRef.current?.();
      }
      return png;
    };
    // What the picture shows, so the server can tell a tab that is out of date or still loading parts
    shoot.status = () => {
      const visible = instancesRef.current.filter((i) => i.visible !== false);
      const loading = visible.filter((i) => !meshMapRef.current.get(i.instanceId)?.userData.renderGeometries);
      return {
        instanceIds: visible.map((i) => i.instanceId),
        partsLoading: loading.length,
        hidden: typeof document !== 'undefined' && document.hidden
      };
    };
    onRegisterScreenshot(shoot);
  }, [onRegisterScreenshot]);

  // Play mode's collision shapes (openspec play-mode): a shown part's mesh points in its own frame (mm)
  useEffect(() => {
    if (!onRegisterPartPoints) return;
    onRegisterPartPoints((instanceId) => {
      const group = meshMapRef.current.get(instanceId);
      if (!group) return null;
      group.updateMatrixWorld(true);
      const toGroup = group.matrixWorld.clone().invert();
      const chunks = [];
      const rel = new THREE.Matrix4();
      const v = new THREE.Vector3();
      // The part's own meshes, not the overlays added to it (named __like_this__)
      const visit = (o) => {
        if (o.name?.startsWith('__')) return;
        o.children.forEach(visit);
        const pos = o.isMesh ? o.geometry?.attributes?.position : null;
        if (!pos) return;
        rel.multiplyMatrices(toGroup, o.matrixWorld);
        const out = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(rel);
          out[i * 3] = v.x;
          out[i * 3 + 1] = v.y;
          out[i * 3 + 2] = v.z;
        }
        chunks.push(out);
      };
      visit(group);
      if (!chunks.length) return null;
      const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) {
        all.set(c, at);
        at += c.length;
      }
      return all;
    });
  }, [onRegisterPartPoints]);

  // Where a part added from the library goes (openspec easier-placing-and-fix-assembly):
  // `viewSpot(bbox, pointer?)` returns the part's position (mm). With a pointer (client px), the point
  // under it on the plane through the orbit target facing the camera; without, the clear spot nearest
  // that target on the plane, on the 1-pitch world grid, with the whole part in view.
  useEffect(() => {
    if (!onRegisterViewSpot) return;
    onRegisterViewSpot((bbox, pointer = null) => {
      const camera = cameraRef.current;
      const target = orbitRef.current?.target;
      const inputEl = inputElRef.current;
      if (!camera || !target || !inputEl || !bbox) return null;
      camera.updateMatrixWorld();
      const viewDir = camera.getWorldDirection(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir, target);
      const local = new THREE.Box3(new THREE.Vector3(...bbox.min), new THREE.Vector3(...bbox.max));
      const centre = local.getCenter(new THREE.Vector3());
      const size = local.getSize(new THREE.Vector3());
      const round3 = (v) => v.toArray().map((n) => Number(n.toFixed(3)) + 0);
      const rect = inputEl.getBoundingClientRect();
      if (pointer) {
        const ndc = new THREE.Vector2(((pointer.x - rect.left) / rect.width) * 2 - 1, -((pointer.y - rect.top) / rect.height) * 2 + 1);
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        return hit ? round3(hit.sub(centre)) : null;
      }
      const boxes = [];
      for (const group of meshMapRef.current.values()) {
        if (!group.visible) continue;
        group.updateMatrixWorld();
        const box = worldPartBox(partFor(group.userData), group.matrixWorld);
        if (box) boxes.push(box);
      }
      const corner = new THREE.Vector3();
      const fits = (origin) => {
        const box = local.clone().translate(origin);
        const grown = box.clone().expandByScalar(2);
        if (boxes.some((b) => b.intersectsBox(grown))) return false;
        for (const x of [box.min.x, box.max.x]) {
          for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
              corner.set(x, y, z).project(camera);
              if (corner.z > 1 || Math.abs(corner.x) > 0.9 || Math.abs(corner.y) > 0.9) return false;
            }
          }
        }
        return true;
      };
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const step = Math.max(size.x, size.y, size.z, VEX_PITCH_MM) + 4;
      for (let ring = 0; ring <= 6; ring++) {
        const count = ring === 0 ? 1 : 8 * ring;
        for (let k = 0; k < count; k++) {
          const angle = (k / count) * Math.PI * 2;
          const point = target.clone().addScaledVector(right, Math.cos(angle) * ring * step).addScaledVector(up, Math.sin(angle) * ring * step);
          const origin = point.sub(centre);
          origin.set(...origin.toArray().map((n) => Math.round(n / VEX_PITCH_MM) * VEX_PITCH_MM));
          if (fits(origin)) return round3(origin);
        }
      }
      return round3(target.clone().sub(centre));
    });
  }, [onRegisterViewSpot]);

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
      let desiredColliding = checkGroupCollision(group, false);
      let blockedVec = desiredVec;
      let crossesLip = false;
      // A whole step can carry a shaft's cap past a beam's lip: stop at the lip instead
      if (!startColliding && !desiredColliding) {
        const crossing = firstTooNarrowCrossing(group, startVec);
        if (crossing) {
          desiredColliding = true;
          crossesLip = true;
          blockedVec = crossing;
        }
      }

      if (!startColliding && desiredColliding) {
        const flushVec = findFlushBoundaryPosition(group, startVec, blockedVec);
        if (flushVec && flushVec.distanceTo(startVec) > 0.12) {
          group.position.copy(savedPos);
          return {
            position: [flushVec.x, flushVec.y, flushVec.z],
            isIntersecting: false,
            snappedFlush: true
          };
        }
        // Already resting on the lip: the cap can't go through, so the part stays put
        if (crossesLip) {
          group.position.copy(savedPos);
          return { position: [startVec.x, startVec.y, startVec.z], isIntersecting: false, snappedFlush: true };
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
    cameraRef.current = camera; // the active camera: every handler reads it from here
    perspCameraRef.current = camera;
    // Orthographic twin, posed from the perspective camera on a switch. Its near/far reach behind
    // the camera, so zooming in never clips the parts in front.
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
    orthoCamera.userData.viewHeight = 200;
    orthoCameraRef.current = orthoCamera;

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
    renderer.domElement.classList.add('viewport-gl');
    rendererRef.current = renderer;
    // Every pointer event lands on this layer over the main view (the canvas takes none), so the
    // controls and all pointer math measure against the main view's own area
    const inputEl = document.createElement('div');
    inputEl.className = 'viewport-input';
    container.appendChild(inputEl);
    inputElRef.current = inputEl;

    // Studio CAD Lighting & Environment Reflections
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    const envTexture = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    envTextureRef.current = envTexture;
    if (envReflectionsRef.current !== false) {
      scene.environment = envTexture;
      scene.environmentIntensity = PLASTIC_REFLECTION_SHARE * (typeof reflectionIntensityRef.current === 'number' ? reflectionIntensityRef.current : 0.75);
    } else {
      scene.environment = null;
    }
    roomEnv.dispose();
    pmremGenerator.dispose();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(ambientLight);

    // Neutral greys: a coloured ground tint turns black and dark grey parts navy
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x777777, 0.3);
    hemiLight.position.set(0, 300, 0);
    scene.add(hemiLight);

    // The key light turns with the camera (keyLightDirection): aimed before each pane is drawn
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.copy(KEY_LIGHT_FROM_VIEW);
    scene.add(dirLight1);
    const keyLightDir = new THREE.Vector3();
    const aimKeyLight = (cam) => {
      keyLightDirection(cam, keyLightDir);
      dirLight1.position.copy(dirLight1.target.position).addScaledVector(keyLightDir, dirLight1.position.distanceTo(dirLight1.target.position) || 1);
      dirLight1.updateMatrixWorld();
    };
    // Optional shadows from this key light (openspec: view-options, render-shadows). Only its share
    // of the light is blocked, and only partly, so shadowed faces stay readable.
    dirLight1.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    dirLight1.shadow.intensity = 0.75;
    scene.add(dirLight1.target);
    // The selection outline's mask pass looks only at SELECT_LAYER. Lights left off that layer made the
    // light setup differ between that pass and the normal one, so three.js reworked every part's material
    // on every frame while anything was selected; on both layers, the setup never changes
    for (const light of [ambientLight, hemiLight, dirLight1]) light.layers.enable(SELECT_LAYER);
    // A soft floor patch under the build for the shadow to fall on (the background is black, so a
    // shadow on nothing wouldn't show): dark slate, fading out toward its edge
    const floorFade = (() => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      gradient.addColorStop(0, '#fff');
      gradient.addColorStop(0.55, '#bbb');
      gradient.addColorStop(1, '#000');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 256, 256);
      return new THREE.CanvasTexture(canvas);
    })();
    const shadowGround = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshLambertMaterial({ color: 0x2a3a52, alphaMap: floorFade, transparent: true, depthWrite: false })
    );
    shadowGround.rotation.x = -Math.PI / 2;
    shadowGround.receiveShadow = true;
    shadowGround.visible = false;
    scene.add(shadowGround);
    // With shadows on, a little less flat fill light and a little more key light, for contrast
    const LIGHT_LEVELS = {
      off: { ambient: 0.25, hemi: 0.3, key: 1.8 },
      on: { ambient: 0.2, hemi: 0.25, key: 2.1 }
    };
    renderer.shadowMap.autoUpdate = false; // drawn once per frame, however many panes there are

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

    // Aligned-hole highlights live on the scene root (not partsRoot) so click selection ignores them
    const holeOverlay = createHoleHighlightOverlay();
    scene.add(holeOverlay.group);
    holeOverlayRef.current = holeOverlay;

    // Mate direction arrows (double-click on a part that can mate in several directions)
    const arrowOverlay = createMateArrowOverlay();
    scene.add(arrowOverlay.group);
    arrowOverlayRef.current = arrowOverlay;

    // Hole picking: hovered face ring, preview copy and pin markers
    const pickOverlay = createPickOverlay();
    scene.add(pickOverlay.group);
    pickOverlayRef.current = pickOverlay;
    const targetOverlay = createPickOverlay({ color: TARGET_COLOR, name: '__target__' });
    scene.add(targetOverlay.group);
    targetOverlayRef.current = targetOverlay;

    // Rotate-mode rings and their angle labels (typed angles turn the part)
    const rotateGizmo = createRotateGizmo();
    rotateGizmo.setSnap(rotationSnapDegRef.current || 0);
    scene.add(rotateGizmo.group);
    rotateGizmoRef.current = rotateGizmo;
    const angleLabels = createAngleLabels(container, (ring, value) => turnRingToTypedAngle(ring, value));
    angleLabelsRef.current = angleLabels;

    // OrbitControls
    const orbit = new OrbitControls(camera, inputEl);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.maxDistance = 2500;
    orbit.minDistance = 10;
    orbitRef.current = orbit;

    // TransformControls
    const transform = new TransformControls(camera, inputEl);
    transform.setSize(0.95);
    enhanceTranslatePlaneHandles(transform);

    const setPivotObj = new THREE.Object3D();
    setPivotObj.name = '__set_pivot__';
    setPivotObj.userData.isSetPivot = true;
    scene.add(setPivotObj);
    setPivotRef.current = setPivotObj;

    transform.addEventListener('objectChange', () => {
      const obj = transform.object;
      if (!obj) return;
      dragMovedRef.current = true;
      if (obj.userData.isSetPivot) {
        // A set: snap the pivot in whole steps from where it started, then straighten and pull onto
        // nearby holes (dragSetFrame) and move every member by as much. Contact is settled on release.
        const drag = setDragRef.current;
        if (!drag) return;
        const rawPos = obj.position.clone();
        const factor = snapPitchFactorRef.current;
        const step = factor && factor > 0 ? VEX_PITCH_MM * factor : 0;
        const start = dragStartPosRef.current;
        if (step > 0) {
          for (const ax of ['x', 'y', 'z']) obj.position[ax] = Number((start[ax] + Math.round((obj.position[ax] - start[ax]) / step) * step).toFixed(3));
        }
        dragSetFrame(drag, obj, rawPos);
        const now = performance.now();
        if (now - drag.lastCheckAt > 150) {
          drag.lastCheckAt = now;
          const members = selectedSetMembers();
          drag.edge = setEdgeIds(drag);
          if (members) markSetOverlaps(members, drag.ignore, drag.edge);
          showSetHighlights(drag);
        }
        return;
      }
      const instId = obj.userData.instanceId;
      const inst = instancesRef.current.find((i) => i.instanceId === instId);
      const partMeta = inst ? partFor(inst) : null;

      if (transformModeRef.current === 'translate') {
        const rawPos = obj.position.clone();
        const factor = snapPitchFactorRef.current;
        const step = factor && factor > 0 ? VEX_PITCH_MM * factor : 0;
        const quarterStep = VEX_PITCH_MM * 0.25; // 3.175mm (0.25P flush wall boundary)
        const snappedPos = rawPos.clone();

        // Steps are counted from where the drag started, so a part that starts lined up with holes
        // (wherever they are, e.g. axles at wheel-radius height) moves in whole steps from there. They
        // are counted along the arrows' axes: the part's own axes (local, the default) or the world's
        // (Alt), so a part on a slanted beam steps along the beam.
        const start = dragStartPosRef.current;
        if (step > 0) {
          const turn = transform.space === 'local' ? dragStartQuatRef.current : new THREE.Quaternion();
          const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)].map((d) => d.applyQuaternion(turn));
          const moved = rawPos.clone().sub(start);
          const offsets = dirs.map((d) => moved.dot(d));
          const posFrom = (offs) => offs.reduce((p, o, k) => p.addScaledVector(dirs[k], o), start.clone());
          const snappedOffsets = offsets.map((o) => (Math.abs(o) <= 0.005 ? 0 : o));
          offsets.forEach((o, k) => {
            if (Math.abs(o) <= 0.005) return;
            const gridVal = Math.round(o / step) * step;
            const qVal = Math.round(o / quarterStep) * quarterStep;
            snappedOffsets[k] = gridVal;
            // If the pointer is closer to a 0.25P (3.175mm) step than the coarse grid one, keep it
            // there when that step is a flush contact boundary
            if (step > quarterStep && Math.abs(qVal - gridVal) > 0.1 && Math.abs(o - qVal) <= quarterStep * 0.55) {
              const at = (v) => {
                const offs = [...snappedOffsets];
                offs[k] = v;
                obj.position.copy(posFrom(offs));
                return checkGroupCollision(obj, false);
              };
              if (!at(qVal) && (at(qVal + quarterStep) || at(qVal - quarterStep))) snappedOffsets[k] = qVal;
            }
          });
          const p = posFrom(snappedOffsets);
          snappedPos.set(Number(p.x.toFixed(3)), Number(p.y.toFixed(3)), Number(p.z.toFixed(3)));
        }

        // Within 5° of a matching hole's line: turn square to it first, about the matched pin or hole,
        // then pull on as usual. Worked out from the drag's start turn, so it never adds up; skipped with Alt
        if (!altKeyRef.current && partMeta) {
          const current = obj.quaternion.clone();
          obj.quaternion.copy(dragStartQuatRef.current);
          obj.position.copy(snappedPos);
          obj.updateMatrixWorld();
          const features = collectWorldFeatures(partMeta, obj.matrixWorld, instId, getMeshMeasurements(obj, partMeta));
          const reachBox = worldPartBox(partMeta, obj.matrixWorld)?.expandByScalar(HOLE_SNAP_AXIAL_REACH_MM);
          const candidates = [];
          for (const other of otherFeaturesRef.current) {
            if (reachBox && other.box && !reachBox.intersectsBox(other.box)) continue;
            for (const f of other.features) candidates.push(f);
          }
          const st = features.length ? findStraighten(features, candidates) : null;
          if (st) {
            obj.quaternion.premultiply(st.quaternion);
            const shift = snappedPos.clone().sub(st.pivot).applyQuaternion(st.quaternion).add(st.pivot).sub(snappedPos);
            snappedPos.add(shift);
            rawPos.add(shift);
            straightenedRef.current = true;
          } else if (!straightenedRef.current) {
            obj.quaternion.copy(current); // keep a meshing or square-fit turn made earlier in the drag
          } else {
            straightenedRef.current = false;
          }
          obj.updateMatrixWorld();
        }

        // Near a hole that a pin/shaft (or one of its own holes) can line up with: snap onto it
        let snapLine = null;
        if (!altKeyRef.current) {
          const holeSnapped = snapDragToHoles(obj, partMeta, rawPos, snappedPos);
          if (holeSnapped) {
            snappedPos.copy(holeSnapped.position);
            snapLine = holeSnapped.axis;
          }
        }

        obj.position.copy(snappedPos);
        // Turn to mesh / to fit square flats before the collision step (skipped with Alt, like snapping)
        if (!altKeyRef.current) {
          liveFitWhileDragging(obj, partMeta);
          snappedPos.copy(obj.position);
        }
        let isColliding = checkGroupCollision(obj, false);
        // Lined up but pressed into what it's going onto: slide along the line to the nearest clear
        // spot, so a part that looks lined up drops into place
        if (isColliding && snapLine) {
          const key = `${snappedPos.toArray().join(',')}|${snapLine.toArray().join(',')}`;
          if (lineSettleCacheRef.current.key !== key) {
            const reach = Math.max(VEX_PITCH_MM * 0.25, step / 2);
            let settled = settleAlongLine(obj, snappedPos, snapLine, reach);
            if (settled && hasClearDragPosRef.current && firstTooNarrowCrossing(obj, lastClearDragPosRef.current)) settled = null;
            lineSettleCacheRef.current = { key, settled };
          }
          const { settled } = lineSettleCacheRef.current;
          if (settled) {
            snappedPos.copy(settled);
            isColliding = false;
          }
          obj.position.copy(snappedPos);
        }
        let blockedAt = snappedPos;
        // A whole grid step can carry a shaft's cap past a beam's lip; stop at the lip instead
        if (!isColliding && hasClearDragPosRef.current) {
          const crossing = firstTooNarrowCrossing(obj, lastClearDragPosRef.current);
          if (crossing) {
            isColliding = true;
            blockedAt = crossing;
          }
        }

        // If the snapped step penetrated a solid surface (e.g. pushing a pin cap into a beam wall),
        // clamp to the exact physical flush contact boundary before allowing pass-through!
        if (isColliding && hasClearDragPosRef.current) {
          const penetrationDist = rawPos.distanceTo(lastClearDragPosRef.current);
          if (penetrationDist <= VEX_PITCH_MM * 1.35) {
            const flushPos = findFlushBoundaryPosition(obj, lastClearDragPosRef.current, blockedAt);
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
          baseColor: resolvePartBaseColor(inst, partMeta),
          isSelected: true,
          isIntersecting: isColliding
        });
        updateAlignedHoleHighlights();
        return;
      }

      const isColliding = checkGroupCollision(obj, false, null, null, true);
      obj.userData.isIntersecting = isColliding;

      applyGroupAppearance(obj, {
        baseColor: resolvePartBaseColor(inst, partMeta),
        isSelected: true,
        isIntersecting: isColliding
      });
      updateAlignedHoleHighlights();
    });

    transform.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
      // Alt pressed or let go during the drag: the arrows catch up once it ends
      if (!event.value && transform.object && !transform.object.userData.isSetPivot) transform.setSpace(altKeyRef.current ? 'world' : 'local');
      if (event.value) {
        wasDraggingRef.current = true;
        dragMovedRef.current = false;
        hideMateArrows();
        lineSettleCacheRef.current = { key: '', settled: null };
        if (transform.object?.userData.isSetPivot) {
          dragStartPosRef.current.copy(transform.object.position);
          startSetDrag();
        } else if (transform.object) {
          rebuildOtherFeatures();
          straightenedRef.current = false;
          dragStartPosRef.current.copy(transform.object.position);
          dragStartQuatRef.current.copy(transform.object.quaternion);
          const startColliding = checkGroupCollision(transform.object, false);
          if (!startColliding) {
            lastClearDragPosRef.current.copy(transform.object.position);
            hasClearDragPosRef.current = true;
          } else {
            hasClearDragPosRef.current = false;
          }
        }
      } else if (transform.object?.userData.isSetPivot) {
        const drag = setDragRef.current;
        setDragRef.current = null;
        holeOverlayRef.current?.show([]);
        lastAlignedRef.current = [];
        if (drag && dragMovedRef.current) finishSetDrag(drag);
      } else if (transform.object) {
        const obj = transform.object;
        const instId = obj.userData.instanceId;
        if (instId) {
          // A moved part goes through the placement step (square fit, mesh, hub); a hand turn in
          // Rotate mode, or a drag with Alt held, is kept as it is
          const settle = transformModeRef.current === 'translate' && !altKeyRef.current && dragMovedRef.current;
          const notes = commitPlacement(obj, { settle });
          if (notes.length) onMateFeedbackRef.current?.(notes.join('. '));
        }
      }
      if (!event.value) {
        // Always clear after any drag ends, even when the part was detached mid-drag (selection
        // changed, an undo, or the scene replaced by MCP or another tab); a stuck flag made every
        // later click in the viewport be ignored
        setTimeout(() => {
          wasDraggingRef.current = false;
        }, 30);
      }
    });

    const gizmoHelper = transform.getHelper ? transform.getHelper() : transform;
    scene.add(gizmoHelper);
    transformRef.current = transform;

    // Makes `cam` the active camera: the controls, ray casts and overlay sizing all follow it
    activateCameraRef.current = (cam) => {
      cameraRef.current = cam;
      orbit.object = cam;
      transform.camera = pointerCameraRef.current();
      orbit.update();
    };

    // Click raycasting for part selection
    const raycaster = new THREE.Raycaster();
    const pointerDownPos = new THREE.Vector2();
    let lastArrowClickAt = -Infinity; // the dblclick that follows an arrow click must not mate again

    // Box select: the rectangle being drawn, in canvas px ({ x0, y0, x1, y1 }), or null
    let boxDrag = null;
    const boxEl = document.createElement('div');
    boxEl.className = 'select-box';
    boxEl.style.display = 'none';
    container.appendChild(boxEl);
    const showBox = () => {
      const { x0, y0, x1, y1 } = boxDrag;
      Object.assign(boxEl.style, {
        display: 'block',
        left: `${Math.min(x0, x1)}px`,
        top: `${Math.min(y0, y1)}px`,
        width: `${Math.abs(x1 - x0)}px`,
        height: `${Math.abs(y1 - y0)}px`
      });
      // Dragged right to left: parts it touches (dashed); left to right: parts wholly inside (solid)
      boxEl.classList.toggle('crossing', x1 < x0);
    };

    /**
     * Visible parts in the box (canvas px). `crossing`: any of the part's points inside; otherwise all of
     * them. Big meshes are sampled (about 4000 points each), which is plenty for a box drawn by hand.
     */
    const partsInBox = ({ x0, y0, x1, y1 }, crossing) => {
      const cam = pointerCameraRef.current();
      const rect = inputEl.getBoundingClientRect();
      const [left, right, top, bottom] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)];
      const v = new THREE.Vector3();
      const ids = [];
      for (const [id, group] of meshMapRef.current.entries()) {
        if (!group.visible) continue;
        group.updateMatrixWorld();
        let any = false;
        let all = true;
        let seen = 0;
        group.traverse((child) => {
          if (!child.isMesh || !child.userData.isPartMesh || !child.geometry?.attributes.position) return;
          const pos = child.geometry.attributes.position;
          const step = Math.max(1, Math.floor(pos.count / 4000));
          for (let i = 0; i < pos.count; i += step) {
            v.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld).project(cam);
            const sx = ((v.x + 1) / 2) * rect.width;
            const sy = ((1 - v.y) / 2) * rect.height;
            const inside = v.z > -1 && v.z < 1 && sx >= left && sx <= right && sy >= top && sy <= bottom;
            seen += 1;
            if (inside) any = true;
            else all = false;
          }
        });
        if (seen > 0 && (crossing ? any : all)) ids.push(id);
      }
      return ids;
    };

    const handlePointerDown = (e) => {
      pointerDownPos.set(e.clientX, e.clientY);
      // A new press that isn't grabbing the gizmo starts clean, so a missed drag end can't block clicks
      if (!transform.dragging) wasDraggingRef.current = false;
      if (
        boxSelectRef.current &&
        e.button === 0 &&
        !e.ctrlKey &&
        !e.metaKey &&
        !pickModeRef.current &&
        !transform.dragging &&
        !transform.axis &&
        !rotateGestureRef.current &&
        !ringClickHandled
      ) {
        const rect = inputEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        boxDrag = { x0: x, y0: y, x1: x, y1: y };
        // OrbitControls would pan on Shift+drag: the camera stays still while a box is drawn
        orbit.enabled = false;
        inputEl.setPointerCapture?.(e.pointerId);
      }
    };

    const projectToCanvas = (point) => {
      const rect = inputEl.getBoundingClientRect();
      const ndc = point.clone().project(pointerCameraRef.current());
      return new THREE.Vector2(((ndc.x + 1) / 2) * rect.width, ((1 - ndc.y) / 2) * rect.height);
    };

    // A left press on a rotate ring starts turning (capture phase, ahead of OrbitControls, which is
    // switched off for the drag). The angle comes from the pointer on the ring's plane; when the
    // plane is seen nearly edge-on, from the pointer's travel along the ring's on-screen tangent.
    let ringClickHandled = false; // the bubbling pointerup of a ring press must not change selection
    let anchorPress = null; // a left press on an anchor line: a click moves the rings onto it
    const handleRingPointerDown = (e) => {
      anchorPress = null;
      if (e.button !== 0 || !rotateSetupRef.current || rotateGestureRef.current) return;
      if (pickModeRef.current?.kind === 'copy' && (e.ctrlKey || e.metaKey)) return; // part of a copy click
      // Anchor lines win over the rings and parts behind them; a drag from one still turns the camera
      const rect = inputEl.getBoundingClientRect();
      const anchor = rotateGizmo.pickAnchor(new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top), projectToCanvas);
      if (anchor) {
        anchorPress = { ...anchor, pressX: e.clientX, pressY: e.clientY };
        return;
      }
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
      inputEl.setPointerCapture?.(e.pointerId);
      rotateGizmo.setDragging(hit.index);
      inputEl.style.cursor = 'grabbing';
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
      if (e.button === 0 && anchorPress) {
        const press = anchorPress;
        anchorPress = null;
        if (Math.hypot(e.clientX - press.pressX, e.clientY - press.pressY) < 5) {
          ringClickHandled = true; // keeps the selection and the selected ring
          chooseRotateAnchor(press);
        }
        return;
      }
      const gesture = rotateGestureRef.current;
      if (e.button !== 0 || gesture?.kind !== 'drag') return;
      inputEl.releasePointerCapture?.(e.pointerId);
      orbit.enabled = true;
      inputEl.style.cursor = 'grab';
      ringClickHandled = true;
      if (gesture.moved) {
        commitRotation();
        return;
      }
      rotateGestureRef.current = null;
      rotateGizmo.setDragging(-1);
      selectRing(selectedRingRef.current === gesture.ring ? -1 : gesture.ring);
    };

    // The input layer covers the main view, or in stereo the working half, so this is the same for all
    const setRayFromEvent = (e) => {
      const rect = inputEl.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const cam = pointerCameraRef.current();
      raycaster.setFromCamera(mouse, cam);
      // An orthographic ray starts halfway between near and far, at the camera itself; its near plane
      // reaches behind the camera (parts there are drawn), so start the ray there too or they can't be picked
      if (cam.isOrthographicCamera) raycaster.ray.origin.addScaledVector(raycaster.ray.direction, cam.near);
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

    // Copy preview: Ctrl/Cmd+double-click is read from two presses, since on macOS Ctrl+click comes
    // as a right-click and may never make a dblclick
    let lastCopyClick = null; // { at, x, y }
    const handleCopyPointerUp = (e, moved) => {
      if (moved || transform.dragging || wasDraggingRef.current) {
        lastCopyClick = null;
        return;
      }
      const now = performance.now();
      const second =
        lastCopyClick &&
        now - lastCopyClick.at <= DOUBLE_CLICK_WINDOW_MS &&
        Math.hypot(e.clientX - lastCopyClick.x, e.clientY - lastCopyClick.y) <= 6;
      if (!second) {
        lastCopyClick = { at: now, x: e.clientX, y: e.clientY };
        return;
      }
      lastCopyClick = null;
      const rect = inputEl.getBoundingClientRect();
      updatePickHover(e.clientX - rect.left, e.clientY - rect.top);
      copyInsert();
    };

    const handlePointerUp = (e) => {
      // The release that ends a drag from the library: placing carries on
      if (pendingDropRef.current && e.button === 0) {
        pendingDropRef.current = false;
        return;
      }
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (boxDrag && e.button === 0) {
        const box = boxDrag;
        boxDrag = null;
        boxEl.style.display = 'none';
        orbit.enabled = true;
        // A short drag is just a click
        if (Math.hypot(dx, dy) > 5) {
          cancelPendingSelect();
          const ids = partsInBox(box, box.x1 < box.x0);
          onBoxSelectRef.current?.(ids, { additive: e.shiftKey || selectModeRef.current });
          return;
        }
      }
      // A click with Ctrl/Cmd in the copy preview never selects or toggles Move/Rotate
      if (pickModeRef.current?.kind === 'copy' && (e.ctrlKey || e.metaKey) && (e.button === 0 || e.button === 2)) {
        handleCopyPointerUp(e, Math.hypot(dx, dy) > 5);
        return;
      }
      if (pickModeRef.current?.kind === 'copy') endPick(); // the modifier went up unseen
      // Right-click (not a right-drag pan) on the selected part, even behind another: Move <-> Rotate
      if (e.button === 2) {
        const selIds = selectedIdsRef.current;
        if (Math.hypot(dx, dy) <= 5 && selIds.length > 0 && pickPartsAt(e).some((id) => selIds.includes(id))) {
          onToggleRotateRequestRef.current?.();
        }
        return;
      }
      if (e.button !== 0) return;
      if (ringClickHandled) {
        ringClickHandled = false;
        return;
      }
      if (pickModeRef.current) {
        // Picking: a click inserts into the hovered hole (or leaves); a drag just turns the camera
        if (Math.hypot(dx, dy) <= 5) {
          // With the stacking arrow shown alongside, a click on the arrow mates along it instead
          if (arrowOverlay.isShown()) {
            setRayFromEvent(e);
            const index = arrowOverlay.pick(raycaster);
            const plan = index >= 0 ? arrowPlansRef.current[index] : null;
            if (plan) {
              endPick();
              lastArrowClickAt = performance.now();
              mateArrowPlan(plan);
              return;
            }
          }
          const rect = inputEl.getBoundingClientRect();
          updatePickHover(e.clientX - rect.left, e.clientY - rect.top);
          pickClick();
        }
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
          mateArrowPlan(plan);
          return;
        }
      }

      // Alt+click on a lit hole or pin end sets, moves or clears the target, never selects
      if (e.altKey && !e.shiftKey && altHoverRef.current) {
        updateAltHover(e.clientX - inputEl.getBoundingClientRect().left, e.clientY - inputEl.getBoundingClientRect().top);
        if (altClick()) {
          cancelPendingSelect();
          return;
        }
      }

      const ids = pickPartsAt(e);
      const front = ids[0] ?? null;
      const selId = selectedIdRef.current;
      cancelPendingSelect();
      // Shift+click, or any click in Select mode, adds or removes the part (a grouped part's whole group;
      // with Alt held too, just that part); empty space leaves the selection
      if (e.shiftKey || selectModeRef.current) {
        if (front) onSelectRef.current(front, { additive: true, exact: e.altKey });
        return;
      }
      // Wait for a possible double-click before selecting: on the selected part behind another, on
      // a brain the selected battery fits (the double-click slides it in), or on any part of a selected
      // set (the double-click mates the whole set, so the first click mustn't narrow the selection)
      const selIds = selectedIdsRef.current;
      const onSet = selIds.length > 1 && ids.some((id) => selIds.includes(id));
      if (onSet || (selId && front !== selId && (ids.includes(selId) || batteryFitsBrain(selId, front)))) {
        pendingSelectTimer = setTimeout(() => {
          pendingSelectTimer = null;
          onSelectRef.current(front);
        }, DOUBLE_CLICK_WINDOW_MS);
        return;
      }
      onSelectRef.current(front);
    };

    let pickHoverFrame = 0;
    let pickHoverAt = null;
    const handlePointerMove = (e) => {
      const rect = inputEl.getBoundingClientRect();
      if (boxDrag) {
        boxDrag.x1 = e.clientX - rect.left;
        boxDrag.y1 = e.clientY - rect.top;
        showBox();
        return;
      }
      copyPointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      // The copy preview follows Ctrl/Cmd (a missed keyup ends it here) and steps aside for a drag
      const modifier = e.ctrlKey || e.metaKey;
      if (pickModeRef.current?.kind === 'copy' && (!modifier || transform.dragging)) endPick();
      else if (!pickModeRef.current && modifier && !e.shiftKey) startCopy(); // Shift+Ctrl is for the wheel
      // Alt (not Shift+Alt, which selects one part of a group) lights the target under the cursor
      const altLights = e.altKey && !e.shiftKey && !modifier && e.buttons === 0;
      if (altHoverRef.current && (!altLights || !canAltHover())) endAltHover();
      else if (altLights && !altHoverRef.current) startAltHover();
      if (altHoverRef.current) updateAltHover(e.clientX - rect.left, e.clientY - rect.top);
      if (pickModeRef.current) {
        if (arrowOverlay.isShown()) {
          setRayFromEvent(e);
          arrowOverlay.setHover(arrowOverlay.pick(raycaster));
        }
        pickHoverAt = [e.clientX - rect.left, e.clientY - rect.top];
        // A placed part follows the pointer, but not while a button turns the camera
        const follow = pendingDropRef.current || e.buttons === 0;
        if (!pickHoverFrame) {
          pickHoverFrame = requestAnimationFrame(() => {
            pickHoverFrame = 0;
            if (!pickHoverAt) return;
            updatePickHover(...pickHoverAt);
            if (follow) followPointer(...pickHoverAt);
          });
        }
        return;
      }
      if (rotateGestureRef.current?.kind === 'drag') {
        handleRingDragMove(e);
        return;
      }
      if (rotateGizmo.isShown() && !arrowOverlay.isShown()) {
        // An anchor line under the pointer comes first, as for a press
        const anchor = rotateGizmo.pickAnchor(new THREE.Vector2(e.clientX - rect.left, e.clientY - rect.top), projectToCanvas);
        rotateGizmo.setAnchorHover(anchor);
        if (anchor) {
          rotateGizmo.setHover(-1);
          inputEl.style.cursor = 'pointer';
          return;
        }
        setRayFromEvent(e);
        const index = rotateGizmo.pick(raycaster)?.index ?? -1;
        rotateGizmo.setHover(index);
        inputEl.style.cursor = index >= 0 ? 'grab' : '';
        return;
      }
      if (!arrowOverlay.isShown()) return;
      setRayFromEvent(e);
      const index = arrowOverlay.pick(raycaster);
      arrowOverlay.setHover(index);
      inputEl.style.cursor = index >= 0 ? 'pointer' : '';
    };

    // The gizmo's center grab area ('XYZ' in move mode, 'XYZE' in rotate mode) covers small parts, and
    // pressing it starts a zero-length drag; only arrow/plane/ring handles or a real move block a mate.
    const GIZMO_CENTER_AXES = new Set(['XYZ', 'XYZE']);
    const handleDoubleClick = (e) => {
      if (performance.now() - lastCubeClickAt < 600) return; // clicks on the view cube
      // Copy-insert works on one part: with several selected, say so. A plain double-click on a part of
      // the set mates the whole set (group-snapping)
      const multi = selectedIdsRef.current;
      if (multi.length > 1 && (e.ctrlKey || e.metaKey) && !pickModeRef.current && !transform.dragging) {
        if (pickPartsAt(e).some((id) => multi.includes(id))) onMateFeedbackRef.current?.('Copies are inserted one part at a time: select a single part.', true);
        return;
      }
      if (e.ctrlKey || e.metaKey) return; // Ctrl/Cmd+double-click inserts a copy, never mates
      if (pickModeRef.current) return; // picking: single clicks insert
      if (transform.dragging) return;
      if (wasDraggingRef.current && dragMovedRef.current) return;
      // A small set sits under its own Move arrows: a double-click on one of its parts counts even over
      // an arrow or plane handle, as long as nothing was dragged
      const onSetPart = multi.length > 1 && pickPartsAt(e).some((id) => multi.includes(id));
      // The centre of a set's Move gizmo counts as the set, even over empty space between its parts
      const onSetCentre = multi.length > 1 && transform.object?.userData.isSetPivot && GIZMO_CENTER_AXES.has(transform.axis);
      if (!onSetPart && transform.object && transform.axis && !GIZMO_CENTER_AXES.has(transform.axis)) return;
      if (arrowOverlay.isShown()) return;
      if (performance.now() - lastArrowClickAt < 600) return; // second click of an arrow double-click
      if (rotateGizmo.isShown()) {
        setRayFromEvent(e);
        if (rotateGizmo.pick(raycaster)) return; // double-clicking a ring handle never mates
      }
      // A set has no single selected part (selectedId is null), so it is handled before that check
      if (multi.length > 1) {
        if (!onSetPart && !onSetCentre) return;
        cancelPendingSelect();
        handleMateRequest();
        return;
      }
      const selId = selectedIdRef.current;
      if (!selId) return;
      const underPointer = pickPartsAt(e);
      // A selected battery and a brain double-clicked: slide the battery into the brain's bay
      if (underPointer.some((id) => id !== selId && slideBatteryInto(id))) {
        cancelPendingSelect();
        return;
      }
      // The selected part may be behind another part; anywhere under the pointer counts
      if (!underPointer.includes(selId)) return;
      cancelPendingSelect();
      handleMateRequest();
    };

    // Capture phase, so Esc only dismisses the arrows (or unselects the wheel ring) and doesn't reach
    // App's deselect handler. Esc in an angle field is handled by the field itself.
    const handleKeyDownCapture = (e) => {
      if (document.querySelector('dialog[open]')) return; // Settings or Audit is open: its keys
      if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat && !e.shiftKey && !pickModeRef.current && copyPointerRef.current) {
        if (startCopy()) updatePickHover(copyPointerRef.current.x, copyPointerRef.current.y);
      }
      if (e.key === 'Alt' && !e.repeat && !e.shiftKey && !e.ctrlKey && !e.metaKey && copyPointerRef.current) {
        if (startAltHover()) updateAltHover(copyPointerRef.current.x, copyPointerRef.current.y);
      } else if (e.key !== 'Alt' && altHoverRef.current && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        endAltHover();
      }
      if (pickModeRef.current && e.target?.tagName !== 'INPUT') {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          endPick();
          return;
        }
        if (pickModeRef.current.kind === 'pick' && (e.key === 'r' || e.key === 'R') && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
          cyclePickFit(e.shiftKey ? -1 : 1);
          return;
        }
      }
      if (e.key !== 'Escape' || e.target?.tagName === 'INPUT') return;
      if (arrowOverlay.isShown()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideMateArrows();
        inputEl.style.cursor = '';
      } else if (selectedRingRef.current >= 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        selectRing(-1);
      } else if (targetRef.current) {
        // Esc clears the target first (another Esc then deselects as usual)
        e.preventDefault();
        e.stopImmediatePropagation();
        setTarget(null);
      }
    };

    // With a ring selected, the wheel turns the part one snap step (5° when Free) per notch instead
    // of zooming; saved 300 ms after the last notch. Capture phase, ahead of OrbitControls' zoom.
    const WHEEL_NOTCH = 100; // deltaY of one mouse-wheel notch in pixel mode; trackpad deltas add up
    let wheelAccum = 0;
    let pickWheelAccum = 0;
    // One expand/contract step per notch at most every EXPAND_STEP_MS, so a trackpad flick isn't five layers
    const EXPAND_STEP_MS = 120;
    let lastExpandAt = -Infinity;
    const handleWheelCapture = (e) => {
      // Shift+wheel grows the selection one layer of joined parts (away from the user) or takes the
      // last layer off (towards); never zooms. Some mice report Shift+wheel as deltaX. With Ctrl/Cmd
      // too, only parts joined by a pin, shaft or peg in a hole count (a copy preview steps aside).
      const pinnedOnly = e.ctrlKey || e.metaKey;
      if (pinnedOnly && e.shiftKey && pickModeRef.current?.kind === 'copy') endPick();
      if (e.shiftKey && selectedIdsRef.current.length > 0 && !pickModeRef.current && selectedRingRef.current < 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const delta = e.deltaY || e.deltaX;
        const now = performance.now();
        if (!delta || now - lastExpandAt < EXPAND_STEP_MS) return;
        lastExpandAt = now;
        onExpandSelectionRef.current?.(delta < 0 ? 1 : -1, { pinnedOnly });
        return;
      }
      // Picking with a hole highlighted: the wheel steps through fits instead of zooming
      if (pickModeRef.current?.hovered) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pickWheelAccum += e.deltaY;
        if (Math.abs(pickWheelAccum) >= 40) {
          cyclePickFit(pickWheelAccum > 0 ? 1 : -1);
          pickWheelAccum = 0;
        }
        return;
      }
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

    // Letting go of Ctrl/Cmd, or leaving the window, ends the copy preview
    const handleKeyUp = (e) => {
      if (pickModeRef.current?.kind === 'copy' && !e.ctrlKey && !e.metaKey) endPick();
      if (e.key === 'Alt' || !e.altKey) endAltHover();
    };
    const handleWindowBlur = () => {
      if (pickModeRef.current?.kind === 'copy') endPick();
      endAltHover();
    };
    // Off the canvas, no hole is under the pointer
    const handlePointerLeave = () => {
      copyPointerRef.current = null;
      if (pickModeRef.current?.kind === 'copy') updatePickHover(-1e6, -1e6);
      endAltHover();
    };

    const handleContextMenu = (e) => e.preventDefault();
    // Alt held: the Move arrows and rotate rings show the world's axes instead of the part's, and a drag doesn't snap
    // onto holes (read before the gizmo moves the part). The arrows don't change during a drag.
    const trackAltKey = (e) => {
      const held = e.type === 'blur' ? false : e.key === 'Alt' ? e.type === 'keydown' : e.altKey;
      if (held === altKeyRef.current) return;
      altKeyRef.current = held;
      if (!transform.dragging && transform.object && !transform.object.userData.isSetPivot) transform.setSpace(held ? 'world' : 'local');
      // The rotate rings switch too (not during a turn)
      if (transformModeRef.current === 'rotate' && !rotateGestureRef.current) refreshRotateSetup();
    };

    // View cube over the main view's top-right corner (not in stereo, small views or screenshots)
    const viewCube = createViewCube();
    const cubeShown = () => viewLayoutRef.current !== 'stereo';
    const cubeRect = (main) => ({
      x: main.x + main.width - VIEW_CUBE_RIGHT - VIEW_CUBE_PX,
      y: main.y + VIEW_CUBE_TOP,
      width: VIEW_CUBE_PX,
      height: VIEW_CUBE_PX
    });
    /** The pointer in the cube square's NDC, or null outside the square. */
    const cubeNdc = (e) => {
      const main = panesRef.current?.main;
      if (!main) return null;
      const r = inputEl.getBoundingClientRect();
      const x = (e.clientX - r.left - (main.width - VIEW_CUBE_RIGHT - VIEW_CUBE_PX)) / VIEW_CUBE_PX;
      const y = (e.clientY - r.top - VIEW_CUBE_TOP) / VIEW_CUBE_PX;
      if (x < 0 || x > 1 || y < 0 || y > 1) return null;
      return new THREE.Vector2(x * 2 - 1, 1 - y * 2);
    };
    // A press on the cube itself is the cube's (capture phase, ahead of the gizmo, rings, orbit and
    // selection); a press in its square but off the cube falls through to the parts behind
    let cubePress = null; // { index, x, y, lastX, lastY, dragging, pointerId }
    let lastCubeClickAt = -Infinity;
    let lastCubeClick = null; // { index, at } for double-clicks
    const CUBE_DRAG_PX = 5;
    const CUBE_DOUBLE_CLICK_MS = 350;
    const cubeHit = (e) => {
      if (!cubeShown()) return -1;
      const ndc = cubeNdc(e);
      return ndc ? viewCube.pick(ndc) : -1;
    };
    /** Orbits the active camera about the orbit target, as dragging empty space does. */
    const orbitBy = (dx, dy) => {
      const cam = cameraRef.current;
      const controls = orbitRef.current;
      if (!cam || !controls) return;
      const height = inputEl.clientHeight || 1;
      const offset = cam.position.clone().sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      sph.theta -= (2 * Math.PI * dx) / height;
      sph.phi = THREE.MathUtils.clamp(sph.phi - (2 * Math.PI * dy) / height, Math.max(0.0001, controls.minPolarAngle), Math.min(Math.PI - 0.0001, controls.maxPolarAngle));
      cam.position.copy(controls.target).add(offset.setFromSpherical(sph));
      cam.lookAt(controls.target);
      controls.update();
    };
    const handleCubePointerDown = (e) => {
      const index = cubeHit(e);
      if (index < 0) return;
      // A right press on the cube is the cube's (its menu), never the part behind it
      if (e.button === 2) {
        e.stopImmediatePropagation();
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      cubePress = { index, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, dragging: false, pointerId: e.pointerId };
      try {
        inputEl.setPointerCapture(e.pointerId); // the drag goes on when the pointer leaves the cube
      } catch {
        // pointer already gone
      }
    };
    const handleCubePointerUp = (e) => {
      if (!cubePress) return;
      e.stopImmediatePropagation();
      const press = cubePress;
      cubePress = null;
      try {
        inputEl.releasePointerCapture(press.pointerId);
      } catch {
        // not captured
      }
      lastCubeClickAt = performance.now();
      if (press.dragging) {
        lastCubeClick = null;
        return;
      }
      // A second click on the same face, edge or corner looks from the opposite side
      const now = performance.now();
      const double = lastCubeClick && lastCubeClick.index === press.index && now - lastCubeClick.at <= CUBE_DOUBLE_CLICK_MS;
      lastCubeClick = double ? null : { index: press.index, at: now };
      const dir = viewCube.direction(press.index);
      animateViewTo(double ? dir.clone().negate() : dir);
    };
    const handleCubeContextMenu = (e) => {
      if (cubeHit(e) < 0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCubeMenuRef.current?.({ x: e.clientX, y: e.clientY });
    };
    let cubeHovered = false;
    const handleCubePointerMove = (e) => {
      if (cubePress) {
        e.stopImmediatePropagation();
        if (!cubePress.dragging && Math.hypot(e.clientX - cubePress.x, e.clientY - cubePress.y) > CUBE_DRAG_PX) {
          cubePress.dragging = true;
        }
        if (cubePress.dragging) {
          orbitBy(e.clientX - cubePress.lastX, e.clientY - cubePress.lastY);
          inputEl.style.cursor = 'grabbing';
        }
        cubePress.lastX = e.clientX;
        cubePress.lastY = e.clientY;
        return;
      }
      if (e.buttons !== 0) return; // an orbit or drag passing over the cube
      const ndc = cubeShown() ? cubeNdc(e) : null;
      const index = ndc ? viewCube.pick(ndc) : -1;
      viewCube.setHover(index);
      if (index >= 0) {
        cubeHovered = true;
        inputEl.title = 'Click: look from this side · double-click: the opposite side · drag: turn the view · right-click: view options';
        inputEl.style.cursor = 'pointer';
        e.stopImmediatePropagation(); // no hole hover or gizmo highlight under the cube
      } else if (cubeHovered) {
        cubeHovered = false;
        inputEl.title = '';
        inputEl.style.cursor = '';
      }
    };
    // While a dropped set is being fitted, clicks and drags in the view wait
    const blockWhileFitting = (e) => {
      if (!fitPendingRef.current) return;
      e.stopImmediatePropagation();
      e.preventDefault();
    };
    inputEl.addEventListener('pointerdown', blockWhileFitting, true);
    inputEl.addEventListener('pointerdown', handleCubePointerDown, true);
    inputEl.addEventListener('pointerup', handleCubePointerUp, true);
    inputEl.addEventListener('pointermove', handleCubePointerMove, true);
    inputEl.addEventListener('contextmenu', handleCubeContextMenu, true);

    inputEl.addEventListener('pointerdown', trackAltKey, true);
    window.addEventListener('keydown', trackAltKey, true);
    window.addEventListener('keyup', trackAltKey, true);
    window.addEventListener('blur', trackAltKey);
    inputEl.addEventListener('pointermove', trackAltKey, true);
    inputEl.addEventListener('pointerdown', handleRingPointerDown, true);
    inputEl.addEventListener('pointerup', handleRingPointerUp, true);
    inputEl.addEventListener('pointerdown', handlePointerDown);
    inputEl.addEventListener('pointerup', handlePointerUp);
    inputEl.addEventListener('pointermove', handlePointerMove);
    inputEl.addEventListener('dblclick', handleDoubleClick);
    // Shift+click selects parts; without this the browser also extends a text selection across the page
    const preventShiftTextSelect = (e) => {
      if (e.shiftKey) e.preventDefault();
    };
    inputEl.addEventListener('mousedown', preventShiftTextSelect);
    inputEl.addEventListener('wheel', handleWheelCapture, { capture: true, passive: false });
    container.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDownCapture, true);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    inputEl.addEventListener('pointerleave', handlePointerLeave);

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
        const inFront = setup.pivot.clone().project(pointerCameraRef.current()).z < 1;
        // projectToCanvas is relative to the input layer; the labels sit in the whole viewport
        const main = panesRef.current?.main ?? { x: 0, y: 0 };
        angleLabels.place(i, best.x + main.x, best.y + main.y, inFront);
      });
    };

    // Four-view layout: three view-only orthographic views beside the main view, each framing the
    // visible parts until zoomed or panned (openspec: view-options, four-view-layout)
    const miniViews = [
      { name: 'X · Front', dir: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0) },
      { name: 'Y · Top', dir: new THREE.Vector3(0, 1, 0), up: new THREE.Vector3(1, 0, 0) },
      { name: 'Z · Side', dir: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0) }
    ].map((view) => {
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -5000, 5000);
      camera.up.copy(view.up);
      camera.userData.viewHeight = 200;
      const el = document.createElement('div');
      el.className = 'viewport-mini';
      el.style.display = 'none';
      const label = document.createElement('span');
      label.className = 'viewport-mini-label';
      label.textContent = view.name;
      el.appendChild(label);
      container.appendChild(el);
      return { ...view, camera, el, auto: true, rect: null };
    });
    miniViewsRef.current = miniViews;
    const MINI_GAP = 4;
    const MINI_GAP_COLOR = new THREE.Color(0x334155);
    const CLEAR_COLOR = new THREE.Color(0x000000);

    /** Frames a small view on all visible parts (a 10% margin), looking along its direction. */
    const frameMiniView = (view) => {
      const box = new THREE.Box3();
      for (const g of meshMapRef.current.values()) if (g.visible) box.expandByObject(g);
      const cam = view.camera;
      const aspect = view.rect.width / view.rect.height;
      let center = new THREE.Vector3();
      let height = 200;
      if (!box.isEmpty()) {
        const right = new THREE.Vector3().crossVectors(view.up, view.dir); // screen right
        const corners = [];
        for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
        const across = corners.map((c) => c.dot(right));
        const along = corners.map((c) => c.dot(view.up));
        const w = Math.max(...across) - Math.min(...across);
        const h = Math.max(...along) - Math.min(...along);
        center = box.getCenter(new THREE.Vector3());
        height = Math.max(h, w / aspect, 20) * 1.1;
      }
      cam.position.copy(center).addScaledVector(view.dir, 1000);
      cam.lookAt(center);
      cam.zoom = 1;
      cam.userData.viewHeight = height;
      fitCameraToPane(cam, view.rect);
    };

    // Stereo: two half-width pictures from eyes beside the main (perspective) camera, meeting at the
    // orbit target; the gap between the eyes follows the distance (openspec: view-options, stereo-view)
    const stereoCam = new THREE.StereoCamera();
    /** [left picture's camera, right picture's camera]: swapped for cross-eyed viewing. */
    const stereoEyes = () => (stereoRef.current.crossEyed ? [stereoCam.cameraR, stereoCam.cameraL] : [stereoCam.cameraL, stereoCam.cameraR]);
    const updateStereo = () => {
      const cam = perspCameraRef.current;
      cam.updateMatrixWorld();
      cam.focus = Math.max(cam.position.distanceTo(orbit.target), 1);
      stereoCam.eyeSep = (cam.focus / 30) * stereoRef.current.depth;
      stereoCam.update(cam);
      for (const eye of [stereoCam.cameraL, stereoCam.cameraR]) {
        // StereoCamera sets only matrixWorld and projectionMatrix; ray casts, projections and AO
        // need the inverses, and the gizmo sizes itself from fov
        eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
        eye.matrixWorldInverse.copy(eye.matrixWorld).invert();
        eye.fov = cam.fov;
      }
    };
    updateStereo(); // valid eyes before the first frame

    // Stereo workbench: the input layer covers the working half (0 left, 1 right picture) and every
    // pointer path judges from that picture's eye. The half under a free pointer becomes the working one.
    let stereoSide = 0;
    pointerCameraRef.current = () => (panesRef.current?.stereo ? stereoEyes()[stereoSide] : cameraRef.current);
    const placeWorkingHalf = () => {
      const panes = panesRef.current;
      if (!panes?.stereo) return;
      panes.main = panes.stereo[stereoSide];
      placeEl(inputEl, panes.main);
      transform.camera = pointerCameraRef.current();
    };
    const handleStereoSideMove = (e) => {
      const panes = panesRef.current;
      if (!panes?.stereo || e.buttons !== 0) return;
      if (transform.dragging || rotateGestureRef.current) return; // never mid-gesture
      const r = container.getBoundingClientRect();
      const side = e.clientX - r.left >= panes.stereo[1].x ? 1 : 0;
      if (side === stereoSide) return;
      stereoSide = side;
      placeWorkingHalf();
    };
    container.addEventListener('pointermove', handleStereoSideMove, true);

    // Pane rectangles in CSS px within the viewport: { main, minis, stereo } (the main view takes the input layer)
    const computePanes = (w, h) => {
      if (viewLayoutRef.current === 'stereo') {
        const half = Math.floor(w / 2);
        const stereo = [
          { x: 0, y: 0, width: half, height: h },
          { x: half, y: 0, width: w - half, height: h }
        ];
        return { main: stereo[stereoSide], minis: [], stereo };
      }
      if (viewLayoutRef.current === 'four') {
        const mainWidth = Math.round(w * 0.7);
        const sideX = mainWidth + MINI_GAP;
        const sideHeight = Math.floor((h - 2 * MINI_GAP) / 3);
        return {
          main: { x: 0, y: 0, width: mainWidth, height: h },
          minis: [0, 1, 2].map((i) => ({
            x: sideX,
            y: i * (sideHeight + MINI_GAP),
            width: w - sideX,
            height: i === 2 ? h - 2 * (sideHeight + MINI_GAP) : sideHeight
          }))
        };
      }
      return { main: { x: 0, y: 0, width: w, height: h }, minis: [] };
    };

    const placeEl = (el, rect) =>
      Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });

    // Sizes the canvas to the viewport, puts the input layer over the main pane and fits the
    // active camera to the main pane's shape; places and fits the small views
    const applyLayout = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h);
      const panes = computePanes(w, h);
      panesRef.current = panes;
      placeEl(inputEl, panes.main);
      fitCameraToPane(cameraRef.current, panes.main);
      transform.camera = pointerCameraRef.current();
      miniViews.forEach((view, i) => {
        view.rect = panes.minis[i] ?? null;
        view.el.style.display = view.rect ? 'block' : 'none';
        if (!view.rect) return;
        placeEl(view.el, view.rect);
        fitCameraToPane(view.camera, view.rect);
      });
    };

    // Small views: the wheel zooms about the pointer and a drag pans; either stops auto-framing
    const miniPointAt = (view, e) => {
      const r = view.el.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 };
    };
    const miniAxes = (view) => {
      const right = new THREE.Vector3().setFromMatrixColumn(view.camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(view.camera.matrixWorld, 1);
      return { right, up };
    };
    const miniCleanups = miniViews.map((view) => {
      const onWheel = (e) => {
        e.preventDefault();
        const cam = view.camera;
        const { right, up } = miniAxes(view);
        const p = miniPointAt(view, e);
        const halfW = (cam.right - cam.left) / 2;
        const halfH = (cam.top - cam.bottom) / 2;
        const oldZoom = cam.zoom;
        const newZoom = THREE.MathUtils.clamp(oldZoom * Math.exp(-e.deltaY * 0.0015), 0.05, 200);
        // Keep the point under the pointer where it is
        const k = 1 / oldZoom - 1 / newZoom;
        cam.position.addScaledVector(right, p.x * halfW * k).addScaledVector(up, p.y * halfH * k);
        cam.zoom = newZoom;
        cam.updateProjectionMatrix();
        view.auto = false;
      };
      let drag = null;
      const onDown = (e) => {
        drag = { x: e.clientX, y: e.clientY };
        view.el.setPointerCapture?.(e.pointerId);
      };
      const onMove = (e) => {
        if (!drag) return;
        const cam = view.camera;
        const { right, up } = miniAxes(view);
        const r = view.el.getBoundingClientRect();
        const perPx = (cam.top - cam.bottom) / cam.zoom / r.height;
        cam.position.addScaledVector(right, -(e.clientX - drag.x) * perPx).addScaledVector(up, (e.clientY - drag.y) * perPx);
        drag = { x: e.clientX, y: e.clientY };
        view.auto = false;
      };
      const onUp = (e) => {
        drag = null;
        view.el.releasePointerCapture?.(e.pointerId);
      };
      view.el.addEventListener('wheel', onWheel, { passive: false });
      view.el.addEventListener('pointerdown', onDown);
      view.el.addEventListener('pointermove', onMove);
      view.el.addEventListener('pointerup', onUp);
      return () => {
        view.el.removeEventListener('wheel', onWheel);
        view.el.removeEventListener('pointerdown', onDown);
        view.el.removeEventListener('pointermove', onMove);
        view.el.removeEventListener('pointerup', onUp);
        view.el.remove();
      };
    });
    applyLayoutRef.current = applyLayout;

    const resizeObserver = new ResizeObserver(applyLayout);
    resizeObserver.observe(container);
    applyLayout();

    // Interactive overlays: drawn only in the main pane
    const editOverlays = () =>
      [transform.getHelper(), rotateGizmo.group, arrowOverlay.group, pickOverlay.group, holeOverlay.group];

    /** Points the renderer's viewport and scissor at one pane (CSS px within the canvas). */
    const setPane = (rect) => {
      const y = container.clientHeight - rect.y - rect.height; // WebGL counts up from the bottom
      renderer.setViewport(rect.x, y, rect.width, rect.height);
      renderer.setScissor(rect.x, y, rect.width, rect.height);
      renderer.setScissorTest(true);
    };

    // Ambient occlusion (openspec: view-options, render-ambient-occlusion): per pane slot a composer
    // RenderPass -> GTAOPass -> OutputPass that draws into the pane, with the overlays left out
    const aoSlots = new Map(); // slot name -> { composer, renderPass, aoPass, width, height, pixelRatio }
    const depthOnlyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
    const aoSlotFor = (slot, rect, cam) => {
      let entry = aoSlots.get(slot);
      if (!entry) {
        // Multisampled, like the plain path, so edges stay smooth with AO on
        const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
        const renderPass = new RenderPass(scene, cam);
        const aoPass = new GTAOPass(scene, cam, rect.width, rect.height);
        // Scene units are mm: darkening reaches a few mm out from a corner
        aoPass.updateGtaoMaterial({ radius: 4, distanceExponent: 1, thickness: 2, scale: 1.6, samples: 16 });
        aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
        composer.addPass(renderPass);
        composer.addPass(aoPass);
        composer.addPass(new OutputPass());
        entry = { composer, renderPass, aoPass, width: 0, height: 0, pixelRatio: 0 };
        aoSlots.set(slot, entry);
      }
      entry.renderPass.camera = cam;
      entry.aoPass.camera = cam;
      // The AO shaders are compiled for one camera type; switch them when the pane's camera changes
      const perspective = cam.isPerspectiveCamera ? 1 : 0;
      for (const material of [entry.aoPass.gtaoMaterial, entry.aoPass.depthRenderMaterial]) {
        if (material.defines.PERSPECTIVE_CAMERA !== perspective) {
          material.defines.PERSPECTIVE_CAMERA = perspective;
          material.needsUpdate = true;
        }
      }
      const pixelRatio = renderer.getPixelRatio();
      if (entry.width !== rect.width || entry.height !== rect.height || entry.pixelRatio !== pixelRatio) {
        entry.composer.setPixelRatio(pixelRatio);
        entry.composer.setSize(rect.width, rect.height);
        Object.assign(entry, { width: rect.width, height: rect.height, pixelRatio });
      }
      return entry;
    };

    /**
     * One pane with ambient occlusion: the scene without overlays through the AO composer, then (when
     * overlays belong here) the scene's depth refilled and the overlays drawn on top, so overlays that
     * ignore depth still show through parts and depth-tested ones are still hidden behind them.
     */
    const renderViewAO = (rect, cam, slot, overlays) => {
      const shown = editOverlays().filter((o) => o.visible);
      shown.forEach((o) => {
        o.visible = false;
      });
      setPane(rect);
      aoSlotFor(slot, rect, cam).composer.render();
      if (!overlays || shown.length === 0) {
        shown.forEach((o) => {
          o.visible = true;
        });
        return;
      }
      setPane(rect);
      renderer.autoClear = false;
      renderer.clearDepth();
      const floorShown = shadowGround.visible;
      shadowGround.visible = false; // the faded floor patch never hid anything
      scene.overrideMaterial = depthOnlyMaterial;
      renderer.render(scene, cam);
      scene.overrideMaterial = null;
      shadowGround.visible = floorShown;
      const content = [partsRoot, gridGroup, axesHelper, shadowGround];
      const contentShown = content.map((o) => o.visible);
      content.forEach((o) => {
        o.visible = false;
      });
      shown.forEach((o) => {
        o.visible = true;
      });
      renderer.render(scene, cam);
      content.forEach((o, i) => {
        o.visible = contentShown[i];
      });
      renderer.autoClear = true;
    };

    /**
     * Selection contour: the selected parts' silhouettes drawn white into a mask, then a thick bright
     * line with a dark rim traced around them on top of the pane. It shows through other parts and
     * reads by brightness rather than hue, so it stays visible on any part color.
     */
    const contourSlots = new Map(); // slot -> { target, width, height }
    const contourMaskMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const contourMaterial = new THREE.ShaderMaterial({
      uniforms: {
        mask: { value: null },
        texel: { value: new THREE.Vector2() },
        coreR: { value: 3 },
        rimR: { value: 5 },
        // The shader writes straight to the screen, so the colors are given as they should look
        coreColor: { value: new THREE.Color().setHex(SELECT_CONTOUR_COLOR, THREE.LinearSRGBColorSpace) },
        rimColor: { value: new THREE.Color(0x000000) }
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D mask;
        uniform vec2 texel;
        uniform float coreR;
        uniform float rimR;
        uniform vec3 coreColor;
        uniform vec3 rimColor;
        void main() {
          if (texture2D(mask, vUv).r > 0.5) discard;
          float nearest = 1e6;
          for (int i = 0; i < 16; i++) {
            float a = float(i) * 0.39269908;
            vec2 dir = vec2(cos(a), sin(a));
            for (int k = 1; k <= 8; k++) {
              float r = float(k) * rimR / 8.0;
              if (texture2D(mask, vUv + dir * r * texel).r > 0.5) nearest = min(nearest, r);
            }
          }
          if (nearest <= coreR) gl_FragColor = vec4(coreColor, 1.0);
          else if (nearest <= rimR) gl_FragColor = vec4(rimColor, 0.85);
          else discard;
        }`,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    contourMaterial.toneMapped = false;
    const contourQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), contourMaterial);
    contourQuad.frustumCulled = false;
    const contourScene = new THREE.Scene();
    contourScene.add(contourQuad);
    const contourCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const drawSelectionContour = (rect, cam, slot) => {
      if (selectedIdsRef.current.length === 0) return;
      const pixelRatio = renderer.getPixelRatio();
      const width = Math.max(1, Math.round(rect.width * pixelRatio));
      const height = Math.max(1, Math.round(rect.height * pixelRatio));
      let entry = contourSlots.get(slot);
      if (!entry) {
        entry = { target: new THREE.WebGLRenderTarget(width, height), width, height };
        contourSlots.set(slot, entry);
      } else if (entry.width !== width || entry.height !== height) {
        entry.target.setSize(width, height);
        Object.assign(entry, { width, height });
      }
      // Mask: only the selected parts' meshes (on SELECT_LAYER), flat white on black
      const savedTarget = renderer.getRenderTarget();
      const savedLayers = cam.layers.mask;
      const savedBackground = scene.background;
      const savedClear = renderer.getClearColor(new THREE.Color());
      const savedAlpha = renderer.getClearAlpha();
      const savedScissor = renderer.getScissorTest();
      cam.layers.set(SELECT_LAYER);
      scene.overrideMaterial = contourMaskMaterial;
      scene.background = null;
      renderer.setRenderTarget(entry.target);
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, rect.width, rect.height);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      renderer.render(scene, cam);
      scene.overrideMaterial = null;
      scene.background = savedBackground;
      cam.layers.mask = savedLayers;
      renderer.setRenderTarget(savedTarget);
      renderer.setClearColor(savedClear, savedAlpha);
      renderer.setScissorTest(savedScissor);
      // Contour over the pane
      contourMaterial.uniforms.mask.value = entry.target.texture;
      contourMaterial.uniforms.texel.value.set(1 / width, 1 / height);
      contourMaterial.uniforms.coreR.value = 1.75 * pixelRatio;
      contourMaterial.uniforms.rimR.value = 2.75 * pixelRatio;
      setPane(rect);
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(contourScene, contourCamera);
      renderer.autoClear = autoClear;
    };

    /** Draws `cam`'s view into one pane, optionally without the overlays; `slot` names the pane for AO. */
    const renderView = (rect, cam, { overlays = true, slot = 'main' } = {}) => {
      // With shadows on, every pane keeps the main view's light, which the one shadow map was drawn for
      if (!shadowsRef.current) aimKeyLight(cam);
      if (aoRef.current) {
        renderViewAO(rect, cam, slot, overlays);
        if (overlays) drawSelectionContour(rect, cam, slot);
        return;
      }
      setPane(rect);
      if (overlays) {
        renderer.render(scene, cam);
        drawSelectionContour(rect, cam, slot);
        return;
      }
      const hidden = editOverlays().filter((o) => o.visible);
      hidden.forEach((o) => {
        o.visible = false;
      });
      renderer.render(scene, cam);
      hidden.forEach((o) => {
        o.visible = true;
      });
    };

    /** Draws every pane of the current layout. */
    /**
     * Shadows on: fits the key light's shadow camera and the ground under the visible parts' bounding
     * sphere and asks for one shadow-map draw this frame. Off: no shadow-casting light at all.
     */
    const shadowBox = new THREE.Box3();
    const shadowSphere = new THREE.Sphere();
    const lightView = new THREE.OrthographicCamera(); // stands in for the shadow camera's pose
    let playFloorY = null; // held steady while Play mode turns wheels and arms
    const updateShadows = (viewCam = cameraRef.current) => {
      const on = shadowsRef.current;
      const levels = on ? LIGHT_LEVELS.on : LIGHT_LEVELS.off;
      ambientLight.intensity = levels.ambient;
      hemiLight.intensity = levels.hemi;
      dirLight1.intensity = levels.key;
      dirLight1.castShadow = on;
      shadowGround.visible = on;
      if (!on) {
        if (viewCam) aimKeyLight(viewCam);
        return;
      }
      shadowBox.makeEmpty();
      for (const g of meshMapRef.current.values()) if (g.visible) shadowBox.expandByObject(g);
      if (shadowBox.isEmpty()) {
        shadowGround.visible = false;
        return;
      }
      shadowBox.getBoundingSphere(shadowSphere);
      const r = Math.max(shadowSphere.radius, 20);
      const center = shadowSphere.center;
      if (playFloorY === null || !playFrameRef.current) playFloorY = shadowBox.min.y - 0.05;
      shadowGround.position.set(center.x, playFloorY, center.z);
      shadowGround.scale.set(3.6 * r, 3.6 * r, 1);
      dirLight1.target.position.copy(center);
      dirLight1.target.updateMatrixWorld();
      dirLight1.position.copy(center).addScaledVector(keyLightDirection(viewCam, keyLightDir), 2 * r);

      // Everything that casts or receives: the build plus the floor patch under it
      const half = 1.8 * r;
      const floorY = shadowGround.position.y;
      const scenePoints = boxCorners(shadowBox);
      for (const [dx, dz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        scenePoints.push(new THREE.Vector3(center.x + dx * half, floorY, center.z + dz * half));
      }
      // Light space: the same pose the shadow camera takes (at the light, looking at the target)
      lightView.position.copy(dirLight1.position);
      lightView.lookAt(center);
      lightView.updateMatrixWorld();
      const toLight = lightView.matrixWorldInverse.copy(lightView.matrixWorld).invert();
      const full = lightSpaceBounds(scenePoints, toLight);
      // Single and Stereo: only the part of the scene inside the main view needs a shadow map, so
      // zooming in gives finer shadows. Four-view's small views show everything, so it keeps all.
      let region = full;
      if (viewLayoutRef.current !== 'four') {
        const corners = viewFrustumCorners(cameraRef.current, scenePoints);
        if (corners) {
          const seen = lightSpaceBounds(corners, toLight);
          // A margin; wider in stereo, whose eyes sit a little to each side of the main camera
          const margin = viewLayoutRef.current === 'stereo' ? 0.1 : 0.05;
          const pad = margin * Math.max(seen.maxX - seen.minX, seen.maxY - seen.minY);
          const minX = Math.max(full.minX, seen.minX - pad);
          const maxX = Math.min(full.maxX, seen.maxX + pad);
          const minY = Math.max(full.minY, seen.minY - pad);
          const maxY = Math.min(full.maxY, seen.maxY + pad);
          if (minX < maxX && minY < maxY) region = { ...full, minX, maxX, minY, maxY };
        }
      }
      // Steady as the camera moves: the size goes in quarter-octave steps and the center snaps to
      // whole shadow-map texels, so shadow edges don't shimmer while orbiting or zooming
      const rawSize = Math.max(region.maxX - region.minX, region.maxY - region.minY, 10);
      const size = 2 ** (Math.ceil(Math.log2(rawSize) * 4) / 4);
      const texel = size / SHADOW_MAP_SIZE;
      const cx = Math.round((region.minX + region.maxX) / 2 / texel) * texel;
      const cy = Math.round((region.minY + region.maxY) / 2 / texel) * texel;
      const cam = dirLight1.shadow.camera;
      cam.left = cx - size / 2;
      cam.right = cx + size / 2;
      cam.bottom = cy - size / 2;
      cam.top = cy + size / 2;
      // Depth covers every caster, on screen or not (z is negative in front of the light)
      cam.near = Math.max(0.1, -full.maxZ - 1);
      cam.far = -full.minZ + 1;
      cam.updateProjectionMatrix();
      dirLight1.shadow.bias = -0.0002;
      dirLight1.shadow.normalBias = texel * 0.75; // a smaller lift off the surface: less light leaking into inside corners
      renderer.shadowMap.needsUpdate = true;
    };
    updateShadowsRef.current = updateShadows;

    const renderFrame = () => {
      if (attentionIdsRef.current.length > 0) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.008);
        for (const id of attentionIdsRef.current) {
          const group = meshMapRef.current.get(id);
          const inst = instancesRef.current.find((i) => i.instanceId === id);
          const partMeta = inst ? partFor(inst) : null;
          if (!group || !inst || !partMeta) continue;
          applyGroupAppearance(group, {
            baseColor: resolvePartBaseColor(inst, partMeta),
            isSelected: selectLevel(selectedIdsRef.current, id),
            isAttention: true,
            attentionPulse: pulse,
            isIntersecting: Boolean(group.userData.isIntersecting)
          });
        }
      }
      updateShadows();
      const active = cameraRef.current;
      arrowOverlay.updateScale(active);
      rotateGizmo.updateScale(active, inputEl.clientWidth, inputEl.clientHeight);
      placeAngleLabels();
      const panes = panesRef.current;
      if (!panes) return;
      if (panes.minis.length > 0) {
        // The gaps between panes show this color; each pane then clears its own area
        renderer.setScissorTest(false);
        renderer.setClearColor(MINI_GAP_COLOR);
        renderer.clear();
        renderer.setClearColor(CLEAR_COLOR);
      }
      if (panes.stereo) {
        updateStereo();
        const eyes = stereoEyes();
        // Overlays in both pictures, so the gizmo, rings and previews are seen in depth
        panes.stereo.forEach((rect, i) => renderView(rect, eyes[i], { slot: `stereo${i}` }));
        return;
      }
      renderView(panes.main, active);
      miniViews.forEach((view, i) => {
        if (!view.rect) return;
        if (view.auto) frameMiniView(view);
        renderView(view.rect, view.camera, { overlays: false, slot: `mini${i}` });
      });
      if (cubeShown()) {
        // Over the main view without clearing it: only the depth is reset
        viewCube.sync(active);
        setPane(cubeRect(panes.main));
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(viewCube.scene, viewCube.camera);
        renderer.autoClear = true;
      }
    };
    renderFrameRef.current = renderFrame;

    let animFrameId;
    const animate = (now) => {
      animFrameId = requestAnimationFrame(animate);
      playFrameRef.current?.(meshMapRef.current, now);
      orbit.update();
      if (targetRef.current) renderTarget(); // the target follows its part (a drag, an animation)
      renderFrame();
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrameId);
      resizeObserver.disconnect();
      inputEl.removeEventListener('pointerdown', handleRingPointerDown, true);
      inputEl.removeEventListener('pointerup', handleRingPointerUp, true);
      inputEl.removeEventListener('pointerdown', handlePointerDown);
      inputEl.removeEventListener('pointerup', handlePointerUp);
      inputEl.removeEventListener('pointermove', handlePointerMove);
      inputEl.removeEventListener('dblclick', handleDoubleClick);
      inputEl.removeEventListener('mousedown', preventShiftTextSelect);
      inputEl.removeEventListener('wheel', handleWheelCapture, { capture: true });
      container.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDownCapture, true);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
      inputEl.removeEventListener('pointerleave', handlePointerLeave);
      inputEl.removeEventListener('pointerdown', trackAltKey, true);
      window.removeEventListener('keydown', trackAltKey, true);
      window.removeEventListener('keyup', trackAltKey, true);
      window.removeEventListener('blur', trackAltKey);
      inputEl.removeEventListener('pointermove', trackAltKey, true);
      container.removeEventListener('pointermove', handleStereoSideMove, true);
      inputEl.removeEventListener('pointerdown', blockWhileFitting, true);
      inputEl.removeEventListener('pointerdown', handleCubePointerDown, true);
      inputEl.removeEventListener('pointerup', handleCubePointerUp, true);
      inputEl.removeEventListener('pointermove', handleCubePointerMove, true);
      inputEl.removeEventListener('contextmenu', handleCubeContextMenu, true);
      viewCube.dispose();
      boxEl.remove();
      for (const { composer, aoPass } of aoSlots.values()) {
        aoPass.dispose();
        composer.dispose();
      }
      depthOnlyMaterial.dispose();
      for (const { target } of contourSlots.values()) target.dispose();
      contourMaskMaterial.dispose();
      contourMaterial.dispose();
      contourQuad.geometry.dispose();
      envTexture.dispose();
      miniCleanups.forEach((cleanup) => cleanup());
      cancelPendingSelect();
      clearTimeout(rotateGestureRef.current?.wheelTimer);
      rotateGestureRef.current = null;
      transform.dispose();
      orbit.dispose();
      holeOverlay.dispose();
      arrowOverlay.dispose();
      pickOverlay.dispose();
      targetOverlay.dispose();
      if (pickHoverFrame) cancelAnimationFrame(pickHoverFrame);
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
    const transform = transformRef.current;
    if (!partsRoot || !transform) return;

    // Only the selection changed: nothing moved, so skip the per-part overlap checks and just
    // re-light the parts that were and are selected
    const lastSync = lastSceneSyncRef.current;
    lastSceneSyncRef.current = { instances, catalogMap, showConnectors, explodeMode, explodePlan, playing, selectedId, selectedIds };
    if (
      lastSync &&
      lastSync.instances === instances &&
      lastSync.catalogMap === catalogMap &&
      lastSync.showConnectors === showConnectors &&
      lastSync.explodeMode === explodeMode &&
      lastSync.explodePlan === explodePlan &&
      lastSync.playing === playing
    ) {
      const byId = new Map(instances.map((i) => [i.instanceId, i]));
      for (const id of new Set([...lastSync.selectedIds, ...selectedIds])) {
        const inst = id ? byId.get(id) : null;
        const group = id ? meshMapRef.current.get(id) : null;
        const partMeta = inst ? partFor(inst) : null;
        if (!inst || !group || !partMeta) continue;
        const isSelected = id === selectedId;
        applyGroupAppearance(group, {
          baseColor: resolvePartBaseColor(inst, partMeta),
          isSelected: selectLevel(selectedIds, id),
          isAttention: attentionIdsRef.current.includes(id),
          isIntersecting: Boolean(group.userData.isIntersecting)
        });
        const existingOverlay = group.getObjectByName('__connector_overlay__');
        if (existingOverlay) group.remove(existingOverlay);
        if (showConnectors && isSelected && (partMeta.ports?.length > 0 || partMeta.cylinders?.length > 0)) {
          group.add(createConnectorAxesGroup(partMeta));
        }
      }
      hideMateArrows();
      rebuildOtherFeatures();
      syncGizmos();
      updateAlignedHoleHighlights();
      return;
    }

    const currentById = new Map(instances.map((i) => [i.instanceId, i]));

    // Remove deleted instances or instances whose partId changed
    for (const [instId, group] of meshMapRef.current.entries()) {
      const currentInst = currentById.get(instId);
      if (!currentInst || group.userData.partId !== (partFor(currentInst)?.id ?? currentInst.partId)) {
        if (transform.object === group) {
          transform.detach();
        }
        partsRoot.remove(group);
        meshMapRef.current.delete(instId);
      }
    }

    // Shown positions: assembled, or spread by the explode plan at the slider value
    const explodedPosMap = explodedPositionsFor(instances, explodeMode, explodePlan, explodeAmountRef.current);

    // First pass: create/update groups and set transforms
    instances.forEach((inst) => {
      const partMeta = partFor(inst);
      if (!partMeta) return;

      let group = meshMapRef.current.get(inst.instanceId);
      if (!group) {
        group = new THREE.Group();
        group.userData.instanceId = inst.instanceId;
        group.userData.partId = partMeta.id;
        meshMapRef.current.set(inst.instanceId, group);
        partsRoot.add(group);

        onLoadingChange?.(true);
        loadPartAsset(partMeta)
          .then(({ geometries, collisionGeometries, deepCollisionGeometries, localBox, hub }) => {
            if (!meshMapRef.current.has(inst.instanceId)) return;
            group.userData.collisionGeometries = collisionGeometries;
            group.userData.deepCollisionGeometries = deepCollisionGeometries;
            group.userData.renderGeometries = geometries;
            group.userData.localBox = localBox;
            group.userData.hub = hub ? { ...hub, objects: [] } : null;

            const isMetal = isMetalPart(partMeta);
            const baseColor = resolvePartBaseColor(inst, partMeta);
            const isClear = isClearPlasticPart(partMeta);
            const material = isClear
              ? new THREE.MeshPhysicalMaterial({
                  color: new THREE.Color(baseColor),
                  roughness: 0.06,
                  metalness: 0,
                  clearcoat: 1,
                  clearcoatRoughness: 0.05,
                  reflectivity: 0.9,
                  envMapIntensity: 1.6,
                  transparent: true,
                  opacity: CLEAR_PLASTIC_OPACITY,
                  depthWrite: false,
                  side: THREE.DoubleSide
                })
              : new THREE.MeshStandardMaterial({
                  color: new THREE.Color(baseColor),
                  roughness: isMetal ? 0.22 : PLASTIC_ROUGHNESS,
                  metalness: isMetal ? 0.85 : 0
                });
            // Metal keeps the full room reflection; plastic only gets the scene's smaller share
            if (isMetal) setMetalReflection(material, sceneRef.current);

            const fixedMaterials = new Map();
            for (const geo of geometries) {
              if (geo.userData.rubber && !fixedMaterials.has('rubber')) {
                fixedMaterials.set('rubber', new THREE.MeshStandardMaterial({
                  color: new THREE.Color(RUBBER_COLOR),
                  roughness: 0.85,
                  metalness: 0
                }));
              } else if (geo.userData.fixedColor && !fixedMaterials.has(geo.userData.fixedColor)) {
                fixedMaterials.set(geo.userData.fixedColor, new THREE.MeshStandardMaterial({
                  color: new THREE.Color(geo.userData.fixedColor),
                  roughness: PLASTIC_ROUGHNESS,
                  metalness: 0
                }));
              }
            }

            geometries.forEach((geo, index) => {
              let meshMat = material;
              if (geo.userData.rubber) meshMat = fixedMaterials.get('rubber');
              else if (geo.userData.fixedColor) meshMat = fixedMaterials.get(geo.userData.fixedColor);

              const mesh = new THREE.Mesh(geo, meshMat);
              mesh.castShadow = true; // only matters while the Shadows option is on
              mesh.receiveShadow = true;
              mesh.userData.instanceId = inst.instanceId;
              mesh.userData.isPartMesh = true;
              if (geo.userData.rubber) mesh.userData.fixedColor = RUBBER_COLOR;
              else if (geo.userData.fixedColor) mesh.userData.fixedColor = geo.userData.fixedColor;
              if (isMetal) mesh.userData.isMetal = true;
              if (isClear) mesh.userData.clearPlastic = true;
              group.add(mesh);

              const edgesGeo = new THREE.EdgesGeometry(geo, 32);
              // A clear sheet's hole rims and outline are light rings, as VEX's viewer draws them
              const edgesMat = new THREE.LineBasicMaterial({
                color: isClear ? CLEAR_PLASTIC_EDGE_COLOR : 0x0f172a,
                transparent: true,
                opacity: isClear ? CLEAR_PLASTIC_EDGE_OPACITY : isMetal ? 0.18 : 0.28
              });
              const edges = new THREE.LineSegments(edgesGeo, edgesMat);
              edges.name = '__cad_edges__';
              group.add(edges);
              if (hub?.renderIndices.includes(index)) group.userData.hub.objects.push(mesh, edges);
            });
            // A clear sheet's printed lattice, as VEX's model shows it (bent with the sheet)
            if (isClear) {
              loadSheetPattern(partMeta).then((patternGeo) => {
                if (!patternGeo || !meshMapRef.current.has(inst.instanceId)) return;
                const pattern = new THREE.LineSegments(
                  patternGeo,
                  new THREE.LineBasicMaterial({ color: CLEAR_PLASTIC_EDGE_COLOR, transparent: true, opacity: SHEET_PATTERN_OPACITY })
                );
                pattern.name = '__sheet_pattern__';
                pattern.raycast = () => {};
                group.add(pattern);
                renderFrameRef.current?.();
              });
            }
            const loadedInst = instancesRef.current.find((i) => i.instanceId === inst.instanceId);
            applyHubAngle(group, loadedInst?.socketAngleDeg);

            const latestInst = instancesRef.current.find(
              (i) => i.instanceId === inst.instanceId
            );
            const isSelectedNow = selectLevel(selectedIdsRef.current, inst.instanceId);
            const isColliding = checkGroupCollision(group, explodeModeRef.current !== 'off', null, null, true);
            group.userData.isIntersecting = isColliding;

            applyGroupAppearance(group, {
              baseColor: resolvePartBaseColor(latestInst, partMeta),
              isSelected: isSelectedNow,
              isAttention: attentionIdsRef.current.includes(inst.instanceId),
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
      applyHubAngle(group, inst.socketAngleDeg);
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
      const partMeta = partFor(inst);
      const group = meshMapRef.current.get(inst.instanceId);
      if (!partMeta || !group) return;

      const isSelected = selectedId === inst.instanceId;
      const isColliding = group.userData.collisionGeometries
        ? checkGroupCollision(group, explodeMode !== 'off', null, null, true)
        : Boolean(inst.isIntersecting);
      group.userData.isIntersecting = isColliding;

      applyGroupAppearance(group, {
        baseColor: resolvePartBaseColor(inst, partMeta),
        isSelected: selectLevel(selectedIds, inst.instanceId),
        isAttention: attentionIdsRef.current.includes(inst.instanceId),
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
  }, [instances, selectedId, selectedIds, catalogMap, showConnectors, explodeMode, explodePlan, playing]);

  // Moving the Explode slider (or its play) only moves the parts
  useEffect(() => {
    if (explodeMode === 'off' || !explodePlan) return;
    const posMap = explodedPositionsFor(instancesRef.current, explodeMode, explodePlan, explodeAmount);
    for (const inst of instancesRef.current) {
      const group = meshMapRef.current.get(inst.instanceId);
      const pos = posMap.get(inst.instanceId);
      if (group && pos) group.position.set(pos[0], pos[1], pos[2]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explodeAmount]);

  // Hole picking ends when its part is no longer the one being picked for, or the mode around it
  // changes: another selection, Move/Rotate, Explode, or the part moved/hidden/locked/removed by
  // undo, redo, the timeline or MCP.
  // The target goes with its part, or when something now sits in it
  useEffect(() => {
    validateTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances]);

  useEffect(() => {
    const pick = pickModeRef.current;
    if (!pick) return;
    const inst = instances.find((i) => i.instanceId === pick.selId);
    if (pick.kind === 'copy') {
      // The copy preview ends with its part or Explode, and otherwise follows the part list
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (!inst || inst.visible === false || selectedId !== pick.selId || explodeMode !== 'off') endPick();
      else refreshCopySession();
      return;
    }
    const rotation = inst ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...inst.rotation.map((r) => THREE.MathUtils.degToRad(r)), 'XYZ')) : null;
    const moved =
      !inst ||
      inst.visible === false ||
      inst.locked ||
      new THREE.Vector3(...inst.position).distanceTo(pick.startPosition) > 0.001 ||
      rotation.angleTo(pick.startQuaternion) > 0.0005;
    if (
      moved ||
      selectedId !== pick.selId ||
      transformMode !== pick.transformMode ||
      explodeMode !== pick.explodeMode
    ) {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      endPick();
    }
  }, [instances, selectedId, transformMode, explodeMode]);

  // A part dragged in from the library: placing starts once its mesh has loaded
  useEffect(() => {
    if (!placeRequest) return undefined;
    pendingDropRef.current = Boolean(placeRequest.dropPending);
    // Released anywhere (the view's own handler sees it first when it is over the view)
    const released = () => {
      pendingDropRef.current = false;
    };
    window.addEventListener('pointerup', released);
    window.addEventListener('pointercancel', released);
    let cancelled = false;
    const inst = instancesRef.current.find((i) => i.instanceId === placeRequest.instanceId);
    const partMeta = inst ? partFor(inst) : null;
    if (partMeta) {
      loadPartAsset(partMeta).then(() =>
        requestAnimationFrame(() => {
          if (!cancelled && !startPlace(placeRequest)) onCancelPlaceRef.current?.(placeRequest);
        })
      );
    }
    return () => {
      cancelled = true;
      window.removeEventListener('pointerup', released);
      window.removeEventListener('pointercancel', released);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeRequest]);

  // Undo, redo and history jumps put parts back without their overlap flags: check the moved parts
  // again (after the effect above has posed them) and report any flag that changed
  useEffect(() => {
    if (!collisionRecheck?.ids?.length) return;
    for (const id of collisionRecheck.ids) {
      const group = meshMapRef.current.get(id);
      const inst = instancesRef.current.find((i) => i.instanceId === id);
      if (!group || !inst || !group.userData.collisionGeometries) continue;
      partGroupRef.current?.updateMatrixWorld(true);
      const isColliding = checkGroupCollision(group, explodeModeRef.current !== 'off', null, null, true);
      group.userData.isIntersecting = isColliding;
      const partMeta = partFor(inst);
      applyGroupAppearance(group, {
        baseColor: resolvePartBaseColor(inst, partMeta),
        isSelected: selectLevel(selectedIdsRef.current, id),
        isAttention: attentionIdsRef.current.includes(id),
        isIntersecting: isColliding
      });
      if (isColliding !== Boolean(inst.isIntersecting)) {
        onUpdateTransformRef.current(id, { isIntersecting: isColliding });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collisionRecheck]);

  // Highlighted parts for a modal question (openspec chain-over-under): apply or clear immediately
  useEffect(() => {
    const prev = prevAttentionIdsRef.current;
    prevAttentionIdsRef.current = attentionIds;
    const changed = new Set([...prev, ...attentionIds]);
    if (changed.size === 0) return;
    const byId = new Map(instancesRef.current.map((i) => [i.instanceId, i]));
    for (const id of changed) {
      const inst = id ? byId.get(id) : null;
      const group = id ? meshMapRef.current.get(id) : null;
      const partMeta = inst ? partFor(inst) : null;
      if (!inst || !group || !partMeta) continue;
      applyGroupAppearance(group, {
        baseColor: resolvePartBaseColor(inst, partMeta),
        isSelected: selectLevel(selectedIdsRef.current, id),
        isAttention: attentionIds.includes(id),
        attentionPulse: 1,
        isIntersecting: Boolean(group.userData.isIntersecting)
      });
    }
    renderFrameRef.current?.();
  }, [attentionIds]);

  // Box select takes the left drag, so the camera doesn't turn with it (right-drag pan and wheel zoom stay)
  useEffect(() => {
    if (orbitRef.current) orbitRef.current.enableRotate = !boxSelect;
  }, [boxSelect]);

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
      if (camera.isOrthographicCamera) setOrthoViewDistance(camera, maxDim * 2.1);
      orbit.update();
      for (const view of miniViewsRef.current) view.auto = true; // the small views frame everything again
    } else {
      orbit.target.set(0, 0, 0);
      camera.position.set(220, 170, 240);
      if (camera.isOrthographicCamera) setOrthoViewDistance(camera, camera.position.length());
      orbit.update();
    }
  }, [focusTrigger]);

  // One-shot camera turn along an axis (keys 1/2/3, MCP viewAlong)
  useEffect(() => {
    const dir = viewAlongTrigger?.dir;
    if (!dir) return;
    const axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[dir[1]];
    if (!axis) return;
    animateViewTo(new THREE.Vector3(...axis).multiplyScalar(dir[0] === '-' ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewAlongTrigger]);

  // Panes for the layout (single, four-view, stereo)
  useEffect(() => {
    applyLayoutRef.current?.();
    syncGizmos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLayout]);

  // Studio environment reflections toggle and intensity
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (!environmentReflections) {
      scene.environment = null;
    } else {
      scene.environment = envTextureRef.current;
      scene.environmentIntensity = PLASTIC_REFLECTION_SHARE * (typeof reflectionIntensity === 'number' ? reflectionIntensity : 0.75);
    }
    partGroupRef.current?.traverse((o) => {
      if (o.isMesh && o.material?.userData?.metalReflection) setMetalReflection(o.material, scene);
    });
    renderFrameRef.current?.();
  }, [environmentReflections, reflectionIntensity]);

  // Holes another tool marks (Bend sheet's choices)
  useEffect(() => {
    updateAlignedHoleHighlights();
    renderFrameRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markedHoles]);

  // Perspective or orthographic main view (stereo always draws in perspective)
  useEffect(() => {
    switchProjection(viewLayout === 'stereo' ? 'perspective' : projection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection, viewLayout]);

  return (
    <>
      <div ref={containerRef} className={`viewport-canvas${immersive ? ' viewport-immersive' : ''}`} />
      {immersive && (
        <div className="immersive-hint" role="status">
          Esc to exit full screen
        </div>
      )}
    </>
  );
}
