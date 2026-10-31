import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { kitColor } from './kit-colors.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const PARTS_DIR = path.join(ROOT_DIR, 'VEX-IQ-All-Parts');
const CONTROL_DIR = path.join(ROOT_DIR, 'VEX-IQ-All-Control');
const OUT_MODELS_DIR = path.join(ROOT_DIR, 'public', 'models');
const OUT_CATALOG_PATH = path.join(ROOT_DIR, 'public', 'catalog.json');
// Bodies left out of a part's model because they are catalog parts of their own (part number ->
// body name prefixes): the Robot Brain's file includes its battery
const SEPARATE_BODIES = { '228-2540': ['228-2604'] };
// Extra catalog entries made from the same file with every body kept (part number -> variants)
const WHOLE_FILE_VARIANTS = {
  '228-2540': [{ key: 'with-battery', name: 'VEX IQ Robot Brain with Battery', partNumber: '228-2540 + 228-2604' }]
};
// Parts with multiple colours in their STEP files that must retain multi-colour bodies
const MULTI_COLOR_PART_NUMBERS = new Set([
  '228-2500-2234', // 2x Pitch Motor Shaft
  '228-2500-2236', // 3x Pitch Motor Shaft
  '228-2500-2238', // 4x Pitch Motor Shaft
  '228-2500-430',  // 12x Pitch Rope
  '228-2500-436',  // 20x Pitch Rope
  '228-2500-438',  // 24x Pitch Rope
  '228-2500-448',  // 120x Pitch Rope
  '228-2536',      // 200mm Travel Omni-Directional Wheel
  '228-2500-1560', // 2x Pitch Shock Absorber (Weak)
  '228-2500-320',  // Ant Front Antenna
  '228-2500-321',  // Ant Rear Antenna
  '228-2560',      // Smart Motor
  '228-2540',      // Robot Brain
  '228-2780',      // Cable Pack
  '228-3010',      // Touch Sensor
  '228-3011',      // Distance Sensor
  '228-3012',      // Color Sensor
  '228-3014',      // Gyro Sensor
  '228-2540 + 228-2604' // Robot Brain with Battery
]);
const cacheKey = (file, variant) => (variant ? `${file}#${variant}` : file);

export function isMetalShaftName(name) {
  const lower = (name || '').toLowerCase();
  return (
    (lower.includes('shaft') || lower.includes('axle')) &&
    !lower.includes('plastic') &&
    !lower.includes('collar') &&
    !lower.includes('bushing') &&
    !lower.includes('washer') &&
    !lower.includes('spacer')
  );
}

function classifyPart(name) {
  const lower = name.toLowerCase();

  // Shafts & axles checked before electronics so "Motor Shaft" is categorized as a shaft
  if (
    lower.includes('shaft') ||
    lower.includes('collar') ||
    lower.includes('bushing') ||
    lower.includes('washer') ||
    lower.includes('spacer') ||
    lower.includes('axle')
  ) {
    const isMetalShaft = isMetalShaftName(name);
    return {
      category: 'Shafts, Spacers & Collars',
      defaultColor: isMetalShaft ? '#e2e8f0' : '#1f2937',
      isMetal: isMetalShaft
    };
  }

  if (
    lower.includes('brain') ||
    lower.includes('motor') ||
    lower.includes('sensor') ||
    lower.includes('battery') ||
    lower.includes('radio') ||
    lower.includes('controller') ||
    lower.includes('switch') ||
    lower.includes('cable') ||
    lower.includes('led') ||
    lower.includes('vision') ||
    lower.includes('gyro') ||
    lower.includes('sonar') ||
    lower.includes('optical') ||
    lower.includes('distance') ||
    lower.includes('bumper') ||
    lower.includes('smart') ||
    lower.includes('touch') ||
    lower.includes('color')
  ) {
    return { category: 'Electronics & Motion', defaultColor: '#4b5563' };
  }

  if (
    lower.includes('wheel') ||
    lower.includes('tire') ||
    lower.includes('hub') ||
    lower.includes('tread') ||
    lower.includes('caster') ||
    lower.includes('omni')
  ) {
    const isTire = lower.includes('tire') || lower.includes('tread') || lower.includes('traction');
    return {
      category: 'Wheels & Treads',
      defaultColor: isTire ? '#1f2937' : '#6b7280'
    };
  }

  if (
    lower.includes('gear') ||
    lower.includes('sprocket') ||
    lower.includes('pulley') ||
    lower.includes('ratchet') ||
    lower.includes('pawl') ||
    lower.includes('chain') ||
    lower.includes('belt') ||
    lower.includes('flywheel') ||
    lower.includes('differential') ||
    lower.includes('cam')
  ) {
    return { category: 'Gears, Sprockets & Pulleys', defaultColor: '#374151' };
  }


  if (lower.includes('pin') || lower.includes('standoff')) {
    let color = '#2563eb';
    if (lower.includes('0x2')) color = '#2563eb';
    else if (lower.includes('0x3')) color = '#0d9488';
    else if (lower.includes('idler')) color = '#64748b';
    else if (lower.includes('standoff')) color = '#475569';
    else color = '#3b82f6';
    return { category: 'Pins & Standoffs', defaultColor: color };
  }

  if (
    lower.includes('connector') ||
    lower.includes('bracket') ||
    lower.includes('gusset') ||
    lower.includes('support') ||
    lower.includes('lock') ||
    lower.includes('hinge') ||
    lower.includes('pivot') ||
    lower.includes('tee') ||
    lower.includes('corner') ||
    lower.includes('offset')
  ) {
    return { category: 'Connectors & Brackets', defaultColor: '#f8fafc' };
  }

  if (
    lower.includes('beam') ||
    lower.includes('plate') ||
    lower.includes('strut') ||
    lower.includes('chassis') ||
    lower.includes('rail')
  ) {
    return { category: 'Beams & Plates', defaultColor: '#64748b' };
  }

  return { category: 'Specialty & Panels', defaultColor: '#dc2626' };
}

function parseFilename(filename, index) {
  const withoutExt = filename.replace(/\.(step|STEP)$/, '');
  const match = withoutExt.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  let displayName = withoutExt;
  let partNumber = `PART-${index + 1}`;
  if (match) {
    displayName = match[1].trim();
    partNumber = match[2].trim();
  }
  const slug = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const id = `${slug}-${index}`;
  return { id, displayName, partNumber, filename };
}

function parseControlEntry(dirName, fileName, index) {
  // Folder names like "228-2540 VEX IQ Robot Brain" or "228 2560 VEX IQ Smart Motor"
  const m = dirName.match(/^(\d{3}[-\s]\d{4})\s+(.+)$/);
  let partNumber = dirName;
  let displayName = dirName;
  if (m) {
    partNumber = m[1].replace(/\s+/g, '-');
    displayName = m[2].trim();
  }
  const slug = `${displayName}-${partNumber}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const id = `${slug}-${index}`;
  return {
    id,
    displayName,
    partNumber,
    filename: `VEX-IQ-All-Control/${dirName}/${fileName}`
  };
}

async function main() {
  fs.mkdirSync(OUT_MODELS_DIR, { recursive: true });

  let existingByFile = new Map();
  if (fs.existsSync(OUT_CATALOG_PATH) && !process.argv.includes('--force')) {
    try {
      const prev = JSON.parse(fs.readFileSync(OUT_CATALOG_PATH, 'utf8'));
      for (const item of prev) {
        existingByFile.set(cacheKey(item.file, item.variant), item);
      }
    } catch {
      // ignore
    }
  }

  const allSourceEntries = [];

  // 1. VEX-IQ-All-Parts
  if (fs.existsSync(PARTS_DIR)) {
    const partFiles = fs
      .readdirSync(PARTS_DIR)
      .filter((f) => /\.(step|STEP)$/.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    partFiles.forEach((filename, index) => {
      const parsed = parseFilename(filename, index);
      const stepPath = path.join(PARTS_DIR, filename);
      allSourceEntries.push({
        ...parsed,
        stepPath
      });
    });
  }

  // 2. VEX-IQ-All-Control (nested directories)
  if (fs.existsSync(CONTROL_DIR)) {
    const subdirs = fs
      .readdirSync(CONTROL_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    subdirs.forEach((dirName, idx) => {
      const dirPath = path.join(CONTROL_DIR, dirName);
      const stepFiles = fs
        .readdirSync(dirPath)
        .filter((f) => /\.(step|STEP)$/.test(f));

      stepFiles.forEach((fileName) => {
        const parsed = parseControlEntry(dirName, fileName, 500 + idx);
        const stepPath = path.join(dirPath, fileName);
        allSourceEntries.push({
          ...parsed,
          stepPath
        });
      });
    });
  }

  for (const entry of [...allSourceEntries]) {
    for (const v of WHOLE_FILE_VARIANTS[entry.partNumber] || []) {
      allSourceEntries.push({ ...entry, id: `${entry.id}-${v.key}`, displayName: v.name, partNumber: v.partNumber, variant: v.key, excludeBodies: [] });
    }
  }

  const catalog = [];
  const pendingTasks = [];

  for (const entry of allSourceEntries) {
    const cached = existingByFile.get(cacheKey(entry.filename, entry.variant));
    const outGlbPath = path.join(OUT_MODELS_DIR, `${(cached || entry).id}.glb`);
    const isMultiColorPart = MULTI_COLOR_PART_NUMBERS.has(entry.partNumber);
    if (cached && fs.existsSync(outGlbPath)) {
      if (!isMultiColorPart || cached.stepColors) {
        catalog.push(cached);
        continue;
      }
    }

    const stat = fs.statSync(entry.stepPath);
    const classified = classifyPart(entry.displayName);
    const { category, isMetal } = classified;
    const defaultColor = kitColor(entry.displayName) ?? classified.defaultColor; // the Competition Kit poster's colour when it shows the part
    pendingTasks.push({
      ...entry,
      category,
      defaultColor,
      isMetal,
      isMultiColorPart,
      outGlbPath: path.join(OUT_MODELS_DIR, `${entry.id}.glb`),
      fileSize: stat.size
    });
  }

  console.log(
    `Total CAD parts discovered: ${allSourceEntries.length} (${catalog.length} already converted, ${pendingTasks.length} new to convert).`
  );

  if (pendingTasks.length > 0) {
    const numWorkers = Math.min(os.cpus().length, pendingTasks.length, 8);
    console.log(`Converting ${pendingTasks.length} new STEP files across ${numWorkers} workers...`);

    let nextTaskIdx = 0;
    let completed = 0;
    let failed = 0;
    const startTime = Date.now();

    await new Promise((resolve) => {
      let activeWorkers = 0;

      for (let w = 0; w < numWorkers; w++) {
        activeWorkers++;
        const worker = new Worker(path.join(__dirname, 'convert-worker.mjs'));

        const assignNext = () => {
          if (nextTaskIdx >= pendingTasks.length) {
            worker.terminate();
            activeWorkers--;
            if (activeWorkers === 0) resolve();
            return;
          }
          const task = pendingTasks[nextTaskIdx++];
          worker.postMessage({
            id: task.id,
            stepPath: task.stepPath,
            outGlbPath: task.outGlbPath,
            fileSize: task.fileSize,
            excludeBodies: task.excludeBodies || SEPARATE_BODIES[task.partNumber] || []
          });
        };

        worker.on('message', (msg) => {
          const task = pendingTasks.find((t) => t.id === msg.id);
          completed++;
          if (msg.ok) {
            catalog.push({
              id: task.id,
              name: task.displayName,
              partNumber: task.partNumber,
              category: task.category,
              defaultColor: task.defaultColor,
              ...(task.isMetal ? { isMetal: true } : {}),
              file: task.filename,
              ...(task.variant ? { variant: task.variant } : {}),
              modelUrl: `/models/${task.id}.glb`,
              stepSizeBytes: task.fileSize,
              glbSizeBytes: msg.glbBytes,
              bbox: msg.bbox,
              vertexCount: msg.vertexCount,
              triangleCount: msg.triangleCount,
              ...(msg.hasRubber ? { hasRubber: true } : {}),
              ...(task.isMultiColorPart ? { stepColors: true } : {}),
              connectorCount: msg.connectorCount,
              cylinders: msg.cylinders
            });
          } else {
            failed++;
            console.error(`  [WARN] Failed ${task.filename}: ${msg.error}`);
          }

          const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(
            `  Converted ${completed}/${pendingTasks.length}: ${task.displayName} (${task.partNumber}) [${elapsed}s]`
          );
          assignNext();
        });

        worker.on('error', (err) => {
          console.error('Worker error:', err);
          assignNext();
        });

        assignNext();
      }
    });
  }

  catalog.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  fs.writeFileSync(OUT_CATALOG_PATH, JSON.stringify(catalog, null, 2));
  console.log(`\nCatalog updated with ${catalog.length} total VEX IQ parts in public/catalog.json!`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
