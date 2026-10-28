import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import occtimportjs from 'occt-import-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PARTS_DIR = path.join(ROOT_DIR, 'VEX-IQ-All-Parts');
const CONTROL_DIR = path.join(ROOT_DIR, 'VEX-IQ-All-Control');
const MODELS_DIR = path.join(ROOT_DIR, 'public', 'models');
const CATALOG_PATH = path.join(ROOT_DIR, 'public', 'catalog.json');

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

function parseGlbMaterials(glbPath) {
  if (!fs.existsSync(glbPath)) return null;
  const buf = fs.readFileSync(glbPath);
  const jsonLength = buf.readUInt32LE(12);
  const jsonText = buf.toString('utf8', 20, 20 + jsonLength);
  const gltf = JSON.parse(jsonText);
  return gltf.materials || [];
}

function scanFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      results.push(...scanFiles(full));
    } else if (/\.(step|STEP)$/.test(ent.name)) {
      results.push(full);
    }
  }
  return results;
}

async function main() {
  console.log('--- Checking STEP Multi-Colour Bodies & GLB Materials ---');
  const occt = await occtimportjs();

  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`Error: Catalog file not found at ${CATALOG_PATH}`);
    process.exit(1);
  }
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));

  const stepFiles = [...scanFiles(PARTS_DIR), ...scanFiles(CONTROL_DIR)];
  console.log(`Discovered ${stepFiles.length} STEP files to inspect.`);

  let multiColorCount = 0;
  let passedCount = 0;
  let failedCount = 0;

  for (const stepPath of stepFiles) {
    const relStepPath = path.relative(ROOT_DIR, stepPath);
    const fileBuf = fs.readFileSync(stepPath);

    // Fast pre-filter: files with <= 1 COLOUR entity cannot have multi-colour bodies
    const stepText = fileBuf.toString('latin1');
    const colorMatches = stepText.match(/COLOUR_RGB|DRAUGHTING_PRE_DEFINED_COLOUR/g);
    if (!colorMatches || colorMatches.length <= 1) continue;

    const res = occt.ReadStepFile(new Uint8Array(fileBuf), { linearDeflection: 2.0, angularDeflection: 1.0 });
    if (!res || !res.success || !res.meshes) continue;

    const validMeshes = res.meshes.filter(
      (m) => m.attributes?.position?.array?.length > 0 && m.index?.array?.length > 0
    );
    if (validMeshes.length === 0) continue;

    const groupsMap = new Map();
    for (const m of validMeshes) {
      const key = getMeshColorKey(m);
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          key,
          isRubber: key === 'rubber',
          meshes: [],
          totalFaces: 0,
          maxBodyFaces: 0
        });
      }
      const g = groupsMap.get(key);
      const faces = m.brep_faces?.length || (m.index?.array?.length / 3) || 1;
      g.meshes.push(m);
      g.totalFaces += faces;
      if (faces > g.maxBodyFaces) g.maxBodyFaces = faces;
    }

    const actualColors = new Set([...groupsMap.keys()].filter((k) => k !== 'none'));
    if (actualColors.size <= 1) continue; // Single colour or uncoloured

    multiColorCount++;
    groupsMap.delete('none');
    const groups = Array.from(groupsMap.values());
    groups.sort((a, b) => {
      const diff = b.maxBodyFaces - a.maxBodyFaces;
      if (diff !== 0) return diff;
      return b.totalFaces - a.totalFaces;
    });

    // Group 0 is main body (no material). Groups 1..N-1 are extra colour bodies.
    const expectedMaterials = groups.slice(1).map((g) => {
      if (g.isRubber) return 'rubber';
      return `step:${g.key}`;
    });

    // Find all catalog entries for this STEP file (including variants like with-battery)
    const catalogEntries = catalog.filter((item) => {
      const itemFile = item.file.replace(/\\/g, '/');
      const targetFile = relStepPath.replace(/\\/g, '/');
      return itemFile === targetFile || targetFile.endsWith(itemFile);
    });

    if (catalogEntries.length === 0) {
      console.error(`[FAIL] No catalog entries found for multi-colour STEP: ${relStepPath}`);
      failedCount++;
      continue;
    }

    for (const item of catalogEntries) {
      const glbPath = path.join(MODELS_DIR, `${item.id}.glb`);
      const materials = parseGlbMaterials(glbPath);

      if (!materials) {
        console.error(`[FAIL] GLB missing for ${item.name} (${item.id}): ${glbPath}`);
        failedCount++;
        continue;
      }

      const matNames = materials.map((m) => m.name);
      let missingMat = false;
      for (const expected of expectedMaterials) {
        if (!matNames.includes(expected)) {
          console.error(
            `[FAIL] ${item.name} (${item.id}) is missing material "${expected}". Found: [${matNames.join(', ')}]`
          );
          missingMat = true;
        }
      }

      if (missingMat) {
        failedCount++;
      } else {
        passedCount++;
        console.log(
          `  ✓ [PASS] ${item.name} (${item.partNumber}): extra materials verified [${expectedMaterials.join(', ')}]`
        );
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Multi-colour STEP files: ${multiColorCount}`);
  console.log(`Verified GLB models:      ${passedCount}`);
  console.log(`Failed checks:            ${failedCount}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal check error:', err);
  process.exit(1);
});
