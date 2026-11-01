import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { loadPartAsset, RUBBER_COLOR, isMetalPart, isClearPlasticPart, METAL_SHAFT_COLOR } from '../utils/geometryCache.js';

const thumbnailDataUrlCache = new Map(); // "partId|defaultColor" -> string (dataURL)
const thumbKey = (part) => `${part.id}|${part.defaultColor}`;

/** The part's rendered thumbnail (200 px) when it has been drawn, else null. */
export const cachedThumbnail = (part) => thumbnailDataUrlCache.get(thumbKey(part)) || null;

export const THUMB_PX = 72; // shown size in the list
export const GRID_THUMB_PX = 100; // shown size in the grid
export const ZOOM_THUMB_PX = 300; // shown size in the hover picture
const THUMB_RENDER_PX = ZOOM_THUMB_PX * 3; // one render serves every size, sharp on high-density screens
const CLEAR_PLASTIC_OPACITY = 0.2; // as in the 3D view

// Thumbnails sit on a light tile, and every part gets dark outlines, which contrast with the tile and
// with the part: dark parts (beams, plates, gears) are lifted to a mid tone so both their shading and
// the outlines show; near-white parts (connectors) get denser outlines and a less shiny surface.
// The 3D view keeps the real colors.
const LIGHT_PART_LUMINANCE = 0.85; // linear luminance; #f8fafc ≈ 0.94, Metal/Silver #e2e8f0 ≈ 0.77
const luminance = (color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
const MIN_THUMB_LIGHTNESS = 0; // 0: no lifting, parts keep their real shade; raise (0.22-0.4) to lift dark parts; // HSL lightness; #1f2937 is 0.17, #374151 0.25, #64748b 0.39: black parts stay dark on the dark tile
const THUMB_FILL = 0.95; // share of the tile the part's longest projected half-extent reaches

/** The color a part is drawn with in its thumbnail: very dark colors lifted to a readable mid tone. */
function thumbnailColor(hex) {
  const color = new THREE.Color(hex || '#64748b');
  const hsl = color.getHSL({ h: 0, s: 0, l: 0 });
  if (hsl.l < MIN_THUMB_LIGHTNESS) color.setHSL(hsl.h, hsl.s, MIN_THUMB_LIGHTNESS);
  return color;
}
let sharedThumbRenderer = null;
let sharedThumbScene = null;
let sharedThumbCamera = null;
let sharedMeshGroup = null;
let sharedComposer = null; // render -> ambient occlusion -> output, the 3D view's AO settings

function getThumbnailStudio() {
  if (!sharedThumbRenderer) {
    sharedThumbRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    sharedThumbRenderer.setSize(THUMB_RENDER_PX, THUMB_RENDER_PX);
    sharedThumbRenderer.setPixelRatio(1);

    sharedThumbScene = new THREE.Scene();

    // The 3D view's lights, weaker and with the key light low and to the side: thumbnails show faces
    // turned up toward the lights, which at full strength wash light parts out to pure white
    const DIM = 0.6;
    sharedThumbScene.add(new THREE.AmbientLight(0xffffff, 0.65 * DIM));

    const hemi = new THREE.HemisphereLight(0xe2e8f0, 0x1e293b, 0.65 * DIM);
    hemi.position.set(0, 300, 0);
    sharedThumbScene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1 * DIM);
    keyLight.position.set(300, 90, 160);
    sharedThumbScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.55 * DIM);
    fillLight.position.set(-200, -120, -160);
    sharedThumbScene.add(fillLight);

    const pmremGenerator = new THREE.PMREMGenerator(sharedThumbRenderer);
    pmremGenerator.compileEquirectangularShader();
    const roomEnv = new RoomEnvironment();
    sharedThumbScene.environment = pmremGenerator.fromScene(roomEnv, 0.04).texture;
    sharedThumbScene.environmentIntensity = 0.6;
    roomEnv.dispose();
    pmremGenerator.dispose();

    sharedThumbCamera = new THREE.PerspectiveCamera(36, 1, 0.5, 2000);

    sharedMeshGroup = new THREE.Group();
    sharedThumbScene.add(sharedMeshGroup);

    sharedComposer = new EffectComposer(
      sharedThumbRenderer,
      new THREE.WebGLRenderTarget(THUMB_RENDER_PX, THUMB_RENDER_PX, { type: THREE.HalfFloatType, samples: 4 })
    );
    sharedComposer.setPixelRatio(1);
    sharedComposer.setSize(THUMB_RENDER_PX, THUMB_RENDER_PX);
    const aoPass = new GTAOPass(sharedThumbScene, sharedThumbCamera, THUMB_RENDER_PX, THUMB_RENDER_PX);
    // Scene units are mm: darkening reaches a few mm out from a corner
    aoPass.updateGtaoMaterial({ radius: 4, distanceExponent: 1, thickness: 2, scale: 1.6, samples: 16 });
    aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    sharedComposer.addPass(new RenderPass(sharedThumbScene, sharedThumbCamera));
    sharedComposer.addPass(aoPass);
    sharedComposer.addPass(new OutputPass());
  }
  return {
    renderer: sharedThumbRenderer,
    scene: sharedThumbScene,
    camera: sharedThumbCamera,
    group: sharedMeshGroup
  };
}

function renderPartToDataUrl(part, geometries, localBox) {
  if (thumbnailDataUrlCache.has(thumbKey(part))) {
    return thumbnailDataUrlCache.get(thumbKey(part));
  }

  const { renderer, scene, camera, group } = getThumbnailStudio();

  // Clear previous children from sharedMeshGroup
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if (child.material) child.material.dispose();
    if (child.name === '__thumb_edges__' && child.geometry) {
      child.geometry.dispose();
    }
  }

  const isMetal = isMetalPart(part);
  const baseHex = isMetal && (!part.defaultColor || part.defaultColor === '#4b5563')
    ? METAL_SHAFT_COLOR
    : (part.defaultColor || (isMetal ? METAL_SHAFT_COLOR : '#64748b'));
  const original = new THREE.Color(baseHex);
  const light = luminance(original) > LIGHT_PART_LUMINANCE;
  const partColor = thumbnailColor(baseHex);

  const isClear = isClearPlasticPart(part);
  const mat = isClear
    ? new THREE.MeshPhysicalMaterial({
        color: partColor,
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
        color: partColor,
        roughness: isMetal ? 0.22 : 0.38,
        metalness: isMetal ? 0.85 : 0.12
      });

  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: isMetal ? 0.25 : (light ? 0.9 : 0.7)
  });

  const rubberMat = new THREE.MeshStandardMaterial({ color: RUBBER_COLOR, roughness: 0.85, metalness: 0 });
  const fixedMats = new Map();

  for (const geo of geometries) {
    let meshMat = mat;
    if (geo.userData.rubber) {
      meshMat = rubberMat;
    } else if (geo.userData.fixedColor) {
      if (!fixedMats.has(geo.userData.fixedColor)) {
        const fc = thumbnailColor(geo.userData.fixedColor);
        fixedMats.set(
          geo.userData.fixedColor,
          new THREE.MeshStandardMaterial({
            color: fc,
            roughness: 0.38,
            metalness: 0.12
          })
        );
      }
      meshMat = fixedMats.get(geo.userData.fixedColor);
    }
    const mesh = new THREE.Mesh(geo, meshMat);
    group.add(mesh);

    const edgeGeo = new THREE.EdgesGeometry(geo, 25);
    const edges = new THREE.LineSegments(edgeGeo, edgeMat);
    edges.name = '__thumb_edges__';
    group.add(edges);
  }

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  if (!localBox.isEmpty()) {
    localBox.getCenter(center);
    localBox.getSize(size);
  } else {
    size.set(20, 20, 20);
  }

  // Frame by how big the part looks from this angle (not its longest side), so short parts aren't
  // cut off and long racks aren't tiny: the nearest distance at which every box corner fits
  // Corner connectors are seen from higher up, so their holed face shows and their pins don't cover it
  const isCorner = /corner connector/i.test(part.name || '');
  const viewDir = (isCorner ? new THREE.Vector3(0.5, 1.5, 0.75) : new THREE.Vector3(1.0, 0.78, 1.15)).normalize();
  camera.position.copy(center).add(viewDir);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const reach = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * THUMB_FILL;
  const half = size.clone().multiplyScalar(0.5).max(new THREE.Vector3(3, 3, 3));
  let dist = 0;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const offset = new THREE.Vector3(sx * half.x, sy * half.y, sz * half.z);
        const across = Math.max(Math.abs(offset.dot(right)), Math.abs(offset.dot(up)));
        dist = Math.max(dist, across / reach + offset.dot(viewDir));
      }
    }
  }

  camera.position.copy(center).addScaledVector(viewDir, dist);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  sharedComposer.render();
  const dataUrl = renderer.domElement.toDataURL('image/webp', 0.88);
  thumbnailDataUrlCache.set(thumbKey(part), dataUrl);
  return dataUrl;
}

export default function PartThumbnail({ part, index, size = THUMB_PX }) {
  const [dataUrl, setDataUrl] = useState(() => thumbnailDataUrlCache.get(thumbKey(part)) || null);
  const containerRef = useRef(null);

  useEffect(() => {
    if (thumbnailDataUrlCache.has(thumbKey(part))) {
      setDataUrl(thumbnailDataUrlCache.get(thumbKey(part)));
      return;
    }

    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    const triggerRender = () => {
      loadPartAsset(part)
        .then(({ geometries, localBox }) => {
          if (cancelled) return;
          const url = renderPartToDataUrl(part, geometries, localBox);
          setDataUrl(url);
        })
        .catch(() => {
          // ignore thumbnail error
        });
    };

    // Immediately render above-the-fold items; lazy-observe offscreen items
    if (index < 12) {
      triggerRender();
      return () => {
        cancelled = true;
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          triggerRender();
        }
      },
      { rootMargin: '140px' }
    );
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [part, index]);

  // Follow optimize-image-priority from modern-web-guidance:
  // - Elevate priority with fetchpriority="high" on the first 2 critical visible thumbnails
  // - Use loading="lazy" ALONE (no fetchpriority="low") on standard below-the-fold images
  // - Omit fetchpriority on standard above-the-fold images
  const imgProps = {};
  if (index < 2) {
    imgProps.fetchPriority = 'high';
  } else if (index >= 12) {
    imgProps.loading = 'lazy';
  }

  return (
    <div ref={containerRef} className="part-thumb-box" style={{ width: size, height: size }}>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={part.name}
          width={size}
          height={size}
          className="part-thumb-img"
          {...imgProps}
        />
      ) : (
        <span
          className="part-thumb-placeholder"
          style={{ backgroundColor: part.defaultColor }}
        />
      )}
    </div>
  );
}
