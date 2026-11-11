import * as THREE from 'three';

/**
 * What the 3D view draws for the Band builder (openspec rubber-bands): the lit spot under the pointer
 * (a ring round a post, groove or edge at the pointer's height; a bead in a tooth gap), the
 * see-through band coloured by stretch, and a handle at each spot of the route or of the selected
 * band. Lives on the scene root, so clicks and part picking ignore it.
 */
export function createBandOverlay() {
  const group = new THREE.Group();
  group.name = '__bands__';
  group.renderOrder = 10;
  const lit = new THREE.Group();
  const preview = new THREE.Group();
  const handles = new THREE.Group();
  group.add(lit, preview, handles);
  const LIT = 0xff3bd4;
  const ringMat = new THREE.MeshBasicMaterial({ color: LIT, depthTest: false, transparent: true, opacity: 0.95 });
  const handleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 });
  const handleHotMat = new THREE.MeshBasicMaterial({ color: LIT, depthTest: false, transparent: true, opacity: 0.95 });

  const clearGroup = (g) => {
    for (const c of [...g.children]) {
      g.remove(c);
      c.geometry?.dispose();
      if (c.material && c.material !== ringMat && c.material !== handleMat && c.material !== handleHotMat) c.material.dispose();
    }
  };

  /** A ring of radius r round `axis` at `centre`, or a bead at a gap. */
  const marker = (spot, height = 0, mat = ringMat, point = null, small = false) => {
    if (point) {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(small ? 1.6 : 2, 12, 10), mat);
      bead.position.set(...point);
      bead.renderOrder = 11;
      return bead;
    }
    const c = spot.center.clone();
    if (spot.shape === 'slot') {
      const bead = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), mat);
      bead.position.copy(c.addScaledVector(spot.axis, height).addScaledVector(spot.radial, (spot.rootMm + spot.tipMm) / 2));
      bead.renderOrder = 11;
      return bead;
    }
    const r = (spot.radius || 3) + 1.2;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 8, 48), mat);
    ring.position.copy(c.addScaledVector(spot.axis, height));
    ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), spot.axis);
    ring.renderOrder = 11;
    return ring;
  };

  return {
    group,
    /** The spot under the pointer (world spot, height along it), or null. */
    setLit(hover) {
      clearGroup(lit);
      if (hover) lit.add(marker(hover.spot, hover.height ?? 0));
    },
    /**
     * The see-through band: `points` (world [x,y,z], closed when `closed`), its colour (hex), and an
     * open tail from the last spot to the pointer (`tail`: [from, to]).
     */
    setPreview({ points = null, color = 0x2fa84f, closed = true, tail = null } = {}) {
      clearGroup(preview);
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false });
      if (points && points.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal', 0);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(600, points.length * 4), 1.1, 6, closed), mat);
        tube.renderOrder = 10;
        preview.add(tube);
      }
      if (tail) {
        const [a, b] = tail.map((p) => new THREE.Vector3(...p));
        const len = a.distanceTo(b);
        if (len > 0.5) {
          const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, len, 6), mat.clone());
          rod.position.copy(a).add(b).multiplyScalar(0.5);
          rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          rod.renderOrder = 10;
          preview.add(rod);
        }
      }
    },
    /** A handle at each spot ([{ spot, height, hot }]); returns the handle meshes in order for picking. */
    setHandles(list = []) {
      clearGroup(handles);
      return list.map((h, i) => {
        const m = marker(h.spot, h.height ?? 0, h.hot ? handleHotMat : handleMat, h.point || null, h.small);
        m.userData.handleIndex = i;
        handles.add(m);
        return m;
      });
    },
    /** The handle under a ray, by its index, or -1. */
    pickHandle(raycaster) {
      const hit = raycaster.intersectObjects(handles.children, false)[0];
      return hit ? hit.object.userData.handleIndex : -1;
    },
    clear() {
      clearGroup(lit);
      clearGroup(preview);
      clearGroup(handles);
    }
  };
}
