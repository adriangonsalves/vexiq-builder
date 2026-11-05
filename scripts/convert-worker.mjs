import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import occtimportjs from 'occt-import-js';

let occtPromise = null;
function getOcct() {
  if (!occtPromise) {
    occtPromise = occtimportjs();
  }
  return occtPromise;
}

/**
 * Extracts up to 256 analytic cylindrical axes (e.g. pin holes / shafts) from STEP ASCII text
 * for future Phase 2 assembly constraint / snapping support.
 */
function extractStepCylinders(stepText) {
  // Parse CARTESIAN_POINT, DIRECTION, AXIS2_PLACEMENT_3D, CYLINDRICAL_SURFACE
  const points = new Map();
  const dirs = new Map();
  const axes = new Map();
  const cylinders = [];

  const ptRegex = /#(\d+)\s*=\s*CARTESIAN_POINT\s*\([^,]*,\s*\(\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*\)\s*\)/g;
  let m;
  while ((m = ptRegex.exec(stepText)) !== null) {
    points.set(m[1], [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]);
  }

  const dirRegex = /#(\d+)\s*=\s*DIRECTION\s*\([^,]*,\s*\(\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*,\s*([-\d.Ee+]+)\s*\)\s*\)/g;
  while ((m = dirRegex.exec(stepText)) !== null) {
    dirs.set(m[1], [parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]);
  }

  const axisRegex = /#(\d+)\s*=\s*AXIS2_PLACEMENT_3D\s*\([^,]*,\s*#(\d+)\s*,\s*#(\d+)\s*,\s*#(\d+)\s*\)/g;
  while ((m = axisRegex.exec(stepText)) !== null) {
    axes.set(m[1], { pt: m[2], zDir: m[3], xDir: m[4] });
  }

  const cylRegex = /#(\d+)\s*=\s*CYLINDRICAL_SURFACE\s*\([^,]*,\s*#(\d+)\s*,\s*([-\d.Ee+]+)\s*\)/g;
  const seen = new Set();
  while ((m = cylRegex.exec(stepText)) !== null) {
    const axis = axes.get(m[2]);
    const radius = parseFloat(m[3]);
    if (!axis) continue;
    // VEX IQ standard pin/hole radii are typically ~1.9mm - 2.5mm (or 4.0mm outer boss)
    if (radius < 1.5 || radius > 6.5) continue;
    const pt = points.get(axis.pt);
    const dir = dirs.get(axis.zDir);
    if (!pt || !dir) continue;
    const key = `${pt[0].toFixed(1)},${pt[1].toFixed(1)},${pt[2].toFixed(1)}:${Math.abs(dir[0]).toFixed(1)},${Math.abs(dir[1]).toFixed(1)},${Math.abs(dir[2]).toFixed(1)}:${radius.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cylinders.push({
      origin: [Number(pt[0].toFixed(3)), Number(pt[1].toFixed(3)), Number(pt[2].toFixed(3))],
      axis: [Number(dir[0].toFixed(3)), Number(dir[1].toFixed(3)), Number(dir[2].toFixed(3))],
      radius: Number(radius.toFixed(3))
    });
    if (cylinders.length >= 256) break;
  }
  return cylinders;
}

// STEP bodies coloured near-black are rubber (omni wheel rollers, tyres moulded onto a hub)
const RUBBER_MAX_CHANNEL = 0.06;
const isRubberMesh = (m) => Array.isArray(m.color) && Math.max(...m.color) < RUBBER_MAX_CHANNEL;

function getMeshColorKey(m) {
  if (isRubberMesh(m)) return 'rubber';
  if (!Array.isArray(m.color) || m.color.length < 3) return 'none';
  const r8 = Math.round(Math.max(0, Math.min(1, m.color[0])) * 255);
  const g8 = Math.round(Math.max(0, Math.min(1, m.color[1])) * 255);
  const b8 = Math.round(Math.max(0, Math.min(1, m.color[2])) * 255);
  return `#${((1 << 24) + (r8 << 16) + (g8 << 8) + b8).toString(16).slice(1)}`;
}

/**
 * Merges all sub-meshes from occt-import-js into a single compact binary GLB buffer
 * and returns bounding box + vertex/triangle stats. When a part mixes plastic and black rubber
 * bodies, or has bodies with multiple colours, the body with the most faces becomes the
 * recolourable main body (primitive 0 with no material). Every other colour body keeps its colour:
 * near-black bodies get a "rubber" material and other colours get a "step:#rrggbb" material.
 */
// STEP colours are linear (as glTF's baseColorFactor); the app's colour strings are sRGB
function linearHexToSrgb(hex) {
  const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const ch = [1, 3, 5].map((i) => Math.round(toSrgb(parseInt(hex.slice(i, i + 2), 16) / 255) * 255));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Splits a mesh whose colours are set per face (newer VEX STEP files) into one mesh per colour.
 * A face with no colour takes the mesh's own colour. Meshes coloured as a whole are left as they are.
 */
function splitByFaceColor(m) {
  const faces = m.brep_faces || [];
  if (!faces.some((f) => Array.isArray(f.color))) return [m];
  const byKey = new Map();
  for (const f of faces) {
    const color = Array.isArray(f.color) ? f.color : m.color;
    const key = JSON.stringify(color ?? null);
    if (!byKey.has(key)) byKey.set(key, { color, ranges: [] });
    byKey.get(key).ranges.push([f.first, f.last]);
  }
  if (byKey.size === 1) return [{ ...m, color: [...byKey.values()][0].color }];
  const pos = m.attributes.position.array;
  const nrm = m.attributes.normal?.array;
  const idx = m.index.array;
  return [...byKey.values()].map(({ color, ranges }, i) => {
    const remap = new Map();
    const positions = [];
    const normals = [];
    const index = [];
    for (const [first, last] of ranges) {
      for (let t = first; t <= last; t++) {
        for (let k = 0; k < 3; k++) {
          const v = idx[t * 3 + k];
          if (!remap.has(v)) {
            remap.set(v, positions.length / 3);
            positions.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
            if (nrm) normals.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
          }
          index.push(remap.get(v));
        }
      }
    }
    return {
      name: `${m.name || 'body'}#${i}`,
      color,
      brep_faces: ranges.map(([first, last]) => ({ first, last })),
      attributes: { position: { array: positions }, ...(nrm ? { normal: { array: normals } } : {}) },
      index: { array: index }
    };
  });
}

function buildGlbFromOcctResult(result, bodyRoles) {
  const allMeshes = (result.meshes || [])
    .filter((m) => m.attributes?.position?.array?.length > 0 && m.index?.array?.length > 0)
    .flatMap(splitByFaceColor);

  if (allMeshes.length === 0) {
    throw new Error('No valid geometry produced from STEP file');
  }

  // Bodies named in bodyRoles.rubber are fixed black whatever colour the STEP file gives them
  for (const m of allMeshes) {
    if (bodyRoles?.rubber?.some((prefix) => String(m.name || '').startsWith(prefix))) m.color = [0, 0, 0];
  }

  // Group meshes by 8-bit RGB colour, with rubber as a special group
  const groupsMap = new Map();
  for (const m of allMeshes) {
    const key = getMeshColorKey(m);
    if (!groupsMap.has(key)) {
      const isRubber = key === 'rubber';
      let hex = null;
      let baseColorFactor = null;
      if (isRubber) {
        baseColorFactor = [0.02, 0.02, 0.02, 1];
      } else if (key !== 'none') {
        hex = key;
        const r8 = parseInt(hex.slice(1, 3), 16);
        const g8 = parseInt(hex.slice(3, 5), 16);
        const b8 = parseInt(hex.slice(5, 7), 16);
        baseColorFactor = [r8 / 255, g8 / 255, b8 / 255, 1];
      }
      groupsMap.set(key, {
        key,
        isRubber,
        hex,
        baseColorFactor,
        meshes: [],
        totalFaces: 0,
        maxBodyFaces: 0,
        indexCount: 0
      });
    }
    const g = groupsMap.get(key);
    const faces = m.brep_faces?.length || (m.index?.array?.length / 3) || 1;
    g.meshes.push(m);
    g.totalFaces += faces;
    if (faces > g.maxBodyFaces) g.maxBodyFaces = faces;
  }

  // Count actual distinct colours (excluding uncoloured 'none')
  const actualColors = new Set([...groupsMap.keys()].filter((k) => k !== 'none'));
  let groups;

  if (actualColors.size <= 1) {
    // Single-colour or uncoloured part -> single primitive with no material, unchanged
    groups = [{
      key: 'main',
      isRubber: false,
      hex: null,
      baseColorFactor: null,
      meshes: allMeshes,
      totalFaces: 0,
      maxBodyFaces: 0,
      indexCount: 0
    }];
  } else {
    // Multi-colour part: merge any uncoloured meshes into the largest colour group
    let noneGroup = groupsMap.get('none');
    groupsMap.delete('none');
    groups = Array.from(groupsMap.values());
    groups.sort((a, b) => {
      const diff = b.maxBodyFaces - a.maxBodyFaces;
      if (diff !== 0) return diff;
      return b.totalFaces - a.totalFaces;
    });
    if (noneGroup) {
      groups[0].meshes.push(...noneGroup.meshes);
      groups[0].totalFaces += noneGroup.totalFaces;
      if (noneGroup.maxBodyFaces > groups[0].maxBodyFaces) {
        groups[0].maxBodyFaces = noneGroup.maxBodyFaces;
      }
    }
  }

  // The body named in bodyRoles.main becomes the recolourable first group
  if (bodyRoles?.main) {
    const at = groups.findIndex((g) => g.meshes.some((m) => String(m.name || '').startsWith(bodyRoles.main)));
    if (at > 0) groups.unshift(...groups.splice(at, 1));
  }

  // The main body's colour in the STEP file (null when it has none or is rubber)
  const mainKey = groups[0].hex ?? (actualColors.size === 1 && [...actualColors][0] !== 'rubber' ? [...actualColors][0] : null);
  const mainColor = mainKey ? linearHexToSrgb(mainKey) : null;

  const validMeshes = groups.flatMap((g) => g.meshes);

  let totalVertices = 0;
  let totalIndices = 0;
  for (const g of groups) {
    g.indexCount = 0;
    for (const m of g.meshes) {
      totalVertices += m.attributes.position.array.length / 3;
      totalIndices += m.index.array.length;
      g.indexCount += m.index.array.length;
    }
  }

  if (totalVertices === 0 || totalIndices === 0) {
    throw new Error('No valid geometry produced from STEP file');
  }

  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const useUint32 = totalVertices > 65535;
  const indices = useUint32 ? new Uint32Array(totalIndices) : new Uint16Array(totalIndices);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let vOffset = 0;
  let iOffset = 0;

  for (const m of validMeshes) {
    const posArr = m.attributes.position.array;
    const normArr = m.attributes.normal?.array;
    const idxArr = m.index.array;
    const vCount = posArr.length / 3;

    for (let i = 0; i < posArr.length; i += 3) {
      const x = posArr[i];
      const y = posArr[i + 1];
      const z = posArr[i + 2];
      positions[(vOffset * 3) + i] = x;
      positions[(vOffset * 3) + i + 1] = y;
      positions[(vOffset * 3) + i + 2] = z;

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    if (normArr && normArr.length === posArr.length) {
      for (let i = 0; i < normArr.length; i++) {
        normals[(vOffset * 3) + i] = normArr[i];
      }
    }

    for (let i = 0; i < idxArr.length; i++) {
      indices[iOffset + i] = idxArr[i] + vOffset;
    }

    vOffset += vCount;
    iOffset += idxArr.length;
  }

  const posByteLength = positions.byteLength;
  const normByteLength = normals.byteLength;
  const idxByteLength = indices.byteLength;
  const idxPaddedByteLength = (idxByteLength + 3) & ~3;

  const totalBinLength = posByteLength + normByteLength + idxPaddedByteLength;
  const binBuffer = Buffer.alloc(totalBinLength);

  Buffer.from(positions.buffer, positions.byteOffset, posByteLength).copy(binBuffer, 0);
  Buffer.from(normals.buffer, normals.byteOffset, normByteLength).copy(binBuffer, posByteLength);
  Buffer.from(indices.buffer, indices.byteOffset, idxByteLength).copy(binBuffer, posByteLength + normByteLength);

  const primitives = [];
  const indexAccessors = [];
  const gltfMaterials = [];
  let currentByteOffset = 0;

  for (let k = 0; k < groups.length; k++) {
    const g = groups[k];
    const accessorIdx = 2 + k;
    indexAccessors.push({
      bufferView: 2,
      byteOffset: currentByteOffset,
      componentType: useUint32 ? 5125 : 5123,
      count: g.indexCount,
      type: 'SCALAR'
    });
    currentByteOffset += g.indexCount * indices.BYTES_PER_ELEMENT;

    if (k === 0) {
      primitives.push({
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: accessorIdx,
        mode: 4
      });
    } else {
      const matIdx = gltfMaterials.length;
      if (g.isRubber) {
        gltfMaterials.push({
          name: 'rubber',
          pbrMetallicRoughness: {
            baseColorFactor: [0.02, 0.02, 0.02, 1],
            metallicFactor: 0,
            roughnessFactor: 0.9
          }
        });
      } else {
        gltfMaterials.push({
          name: `step:${linearHexToSrgb(g.hex)}`, // the app reads this name as an sRGB colour
          pbrMetallicRoughness: {
            baseColorFactor: g.baseColorFactor,
            metallicFactor: 0.1,
            roughnessFactor: 0.5
          }
        });
      }
      primitives.push({
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: accessorIdx,
        material: matIdx,
        mode: 4
      });
    }
  }

  const gltfJson = {
    asset: { version: '2.0', generator: 'vexiq-builder-step-converter' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives
      }
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: totalVertices,
        type: 'VEC3',
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ]
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126, // FLOAT
        count: totalVertices,
        type: 'VEC3'
      },
      ...indexAccessors
    ],
    ...(gltfMaterials.length > 0 ? { materials: gltfMaterials } : {}),
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: posByteLength,
        target: 34962 // ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: posByteLength,
        byteLength: normByteLength,
        target: 34962 // ARRAY_BUFFER
      },
      {
        buffer: 0,
        byteOffset: posByteLength + normByteLength,
        byteLength: idxByteLength,
        target: 34963 // ELEMENT_ARRAY_BUFFER
      }
    ],
    buffers: [
      {
        byteLength: totalBinLength
      }
    ]
  };

  const jsonStr = JSON.stringify(gltfJson);
  const jsonByteLen = Buffer.byteLength(jsonStr, 'utf8');
  const jsonPaddedLen = (jsonByteLen + 3) & ~3;
  const jsonBuffer = Buffer.alloc(jsonPaddedLen, 0x20); // pad with spaces
  jsonBuffer.write(jsonStr, 0, 'utf8');

  const totalGlbLength = 12 + 8 + jsonPaddedLen + 8 + totalBinLength;
  const glb = Buffer.alloc(totalGlbLength);

  // Header
  glb.writeUInt32LE(0x46546c67, 0); // 'glTF'
  glb.writeUInt32LE(2, 4); // version 2
  glb.writeUInt32LE(totalGlbLength, 8);

  // JSON chunk
  glb.writeUInt32LE(jsonPaddedLen, 12);
  glb.writeUInt32LE(0x4e4f534a, 16); // 'JSON'
  jsonBuffer.copy(glb, 20);

  // BIN chunk
  const binChunkOffset = 20 + jsonPaddedLen;
  glb.writeUInt32LE(totalBinLength, binChunkOffset);
  glb.writeUInt32LE(0x004e4942, binChunkOffset + 4); // 'BIN\0'
  binBuffer.copy(glb, binChunkOffset + 8);

  return {
    glb,
    bbox: {
      min: [Number(minX.toFixed(2)), Number(minY.toFixed(2)), Number(minZ.toFixed(2))],
      max: [Number(maxX.toFixed(2)), Number(maxY.toFixed(2)), Number(maxZ.toFixed(2))],
      size: [
        Number((maxX - minX).toFixed(2)),
        Number((maxY - minY).toFixed(2)),
        Number((maxZ - minZ).toFixed(2))
      ],
      center: [
        Number(((minX + maxX) / 2).toFixed(2)),
        Number(((minY + maxY) / 2).toFixed(2)),
        Number(((minZ + maxZ) / 2).toFixed(2))
      ]
    },
    vertexCount: totalVertices,
    triangleCount: Math.floor(totalIndices / 3),
    glbBytes: totalGlbLength,
    hasRubber: groups.length > 1 && groups.slice(1).some((g) => g.isRubber),
    mainColor
  };
}

parentPort.on('message', async (task) => {
  const { id, stepPath, outGlbPath, fileSize, excludeBodies = [], bodyRoles } = task;
  try {
    const occt = await getOcct();
    const fileBuffer = fs.readFileSync(stepPath);

    // Adaptive tessellation quality so large plates (>2MB) stay fast and compact
    const isLarge = fileSize > 4 * 1024 * 1024;
    const isMedium = fileSize > 1 * 1024 * 1024;
    const params = {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: isLarge ? 0.008 : isMedium ? 0.004 : 0.002,
      angularDeflection: isLarge ? 0.8 : isMedium ? 0.6 : 0.4
    };

    const result = occt.ReadStepFile(new Uint8Array(fileBuffer), params);
    if (!result || !result.success) {
      throw new Error('occt ReadStepFile returned unsuccessful');
    }
    // Bodies that are catalog parts of their own (e.g. the battery inside the brain's file)
    result.meshes = (result.meshes || []).filter((m) => !excludeBodies.some((prefix) => String(m.name || '').startsWith(prefix)));

    const { glb, bbox, vertexCount, triangleCount, glbBytes, hasRubber, mainColor } = buildGlbFromOcctResult(result, bodyRoles);
    fs.writeFileSync(outGlbPath, glb);

    const stepText = fileBuffer.toString('latin1');
    const cylinders = extractStepCylinders(stepText);

    parentPort.postMessage({
      id,
      ok: true,
      bbox,
      vertexCount,
      triangleCount,
      glbBytes,
      hasRubber,
      mainColor,
      connectorCount: cylinders.length,
      cylinders: cylinders.slice(0, 64) // store sample in catalog, full can be inspected
    });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: err?.message || String(err)
    });
  }
});
