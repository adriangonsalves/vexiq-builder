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

/**
 * Merges all sub-meshes from occt-import-js into a single compact binary GLB buffer
 * and returns bounding box + vertex/triangle stats. When a part mixes plastic and black rubber
 * bodies, the rubber goes in a second primitive with a material named "rubber" so the app can
 * keep it black whatever colour the part is given.
 */
function buildGlbFromOcctResult(result) {
  let totalVertices = 0;
  let totalIndices = 0;

  const allMeshes = (result.meshes || []).filter(
    (m) => m.attributes?.position?.array?.length > 0 && m.index?.array?.length > 0
  );
  const rubberMeshes = allMeshes.filter(isRubberMesh);
  const splitRubber = rubberMeshes.length > 0 && rubberMeshes.length < allMeshes.length;
  const validMeshes = splitRubber
    ? [...allMeshes.filter((m) => !isRubberMesh(m)), ...rubberMeshes]
    : allMeshes;
  let bodyIndexCount = 0;

  for (const m of validMeshes) {
    totalVertices += m.attributes.position.array.length / 3;
    totalIndices += m.index.array.length;
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
    if (!splitRubber || !isRubberMesh(m)) bodyIndexCount = iOffset;
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

  const gltfJson = {
    asset: { version: '2.0', generator: 'vexiq-builder-step-converter' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: splitRubber
          ? [
              { attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, mode: 4 },
              { attributes: { POSITION: 0, NORMAL: 1 }, indices: 3, material: 0, mode: 4 }
            ]
          : [
              {
                attributes: { POSITION: 0, NORMAL: 1 },
                indices: 2,
                mode: 4
              }
            ]
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
      ...(splitRubber
        ? [
            { bufferView: 2, byteOffset: 0, componentType: useUint32 ? 5125 : 5123, count: bodyIndexCount, type: 'SCALAR' },
            {
              bufferView: 2,
              byteOffset: bodyIndexCount * indices.BYTES_PER_ELEMENT,
              componentType: useUint32 ? 5125 : 5123,
              count: totalIndices - bodyIndexCount,
              type: 'SCALAR'
            }
          ]
        : [
            {
              bufferView: 2,
              byteOffset: 0,
              componentType: useUint32 ? 5125 : 5123, // UNSIGNED_INT or UNSIGNED_SHORT
              count: totalIndices,
              type: 'SCALAR'
            }
          ])
    ],
    ...(splitRubber
      ? { materials: [{ name: 'rubber', pbrMetallicRoughness: { baseColorFactor: [0.02, 0.02, 0.02, 1], metallicFactor: 0, roughnessFactor: 0.9 } }] }
      : {}),
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
    hasRubber: splitRubber
  };
}

parentPort.on('message', async (task) => {
  const { id, stepPath, outGlbPath, fileSize } = task;
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

    const { glb, bbox, vertexCount, triangleCount, glbBytes, hasRubber } = buildGlbFromOcctResult(result);
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
