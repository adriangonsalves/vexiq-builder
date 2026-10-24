import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { loadPartAsset } from '../utils/geometryCache.js';

const thumbnailDataUrlCache = new Map(); // "partId|defaultColor" -> string (dataURL)
const thumbKey = (part) => `${part.id}|${part.defaultColor}`;

// Near-white parts (connectors) lose their shape under the studio lights: draw them with stronger,
// denser outlines and a less shiny surface so they read clearly against the dark card.
const LIGHT_PART_LUMINANCE = 0.85; // linear luminance; #f8fafc ≈ 0.94, Metal/Silver #e2e8f0 ≈ 0.77
const isLightColor = (color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722 > LIGHT_PART_LUMINANCE;
let sharedThumbRenderer = null;
let sharedThumbScene = null;
let sharedThumbCamera = null;
let sharedMeshGroup = null;

function getThumbnailStudio() {
  if (!sharedThumbRenderer) {
    sharedThumbRenderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    sharedThumbRenderer.setSize(112, 112);
    sharedThumbRenderer.setPixelRatio(1);

    sharedThumbScene = new THREE.Scene();

    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    sharedThumbScene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.35);
    keyLight.position.set(80, 120, 100);
    sharedThumbScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.65);
    fillLight.position.set(-80, -60, -70);
    sharedThumbScene.add(fillLight);

    sharedThumbCamera = new THREE.PerspectiveCamera(36, 1, 0.5, 2000);

    sharedMeshGroup = new THREE.Group();
    sharedThumbScene.add(sharedMeshGroup);
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

  const partColor = new THREE.Color(part.defaultColor || '#64748b');
  const light = isLightColor(partColor);

  const mat = new THREE.MeshStandardMaterial({
    color: partColor,
    roughness: light ? 0.55 : 0.35,
    metalness: 0.15
  });

  const edgeMat = new THREE.LineBasicMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: light ? 0.85 : 0.35
  });

  for (const geo of geometries) {
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    const edgeGeo = new THREE.EdgesGeometry(geo, light ? 25 : 35);
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

  const maxDim = Math.max(size.x, size.y, size.z, 6);
  const dist = maxDim * 1.75;
  const viewDir = new THREE.Vector3(1.0, 0.78, 1.15).normalize();

  camera.position.copy(center).addScaledVector(viewDir, dist);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/webp', 0.88);
  thumbnailDataUrlCache.set(thumbKey(part), dataUrl);
  return dataUrl;
}

export default function PartThumbnail({ part, index }) {
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
    <div ref={containerRef} className="part-thumb-box">
      {dataUrl ? (
        <img
          src={dataUrl}
          alt={part.name}
          width={52}
          height={52}
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
