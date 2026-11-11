/**
 * Writes the band test data for openspec rubber-bands: a VEX CAD robot's library parts as the import
 * places them, and each visible stretched rubber band or belt as points of VEX's own mesh (app frame,
 * mm, thinned to one point per 1.5 mm cube).
 *
 *   node scripts/make-band-fixture.mjs [<project id | link | saved .json>] [--out file]
 *
 * Default: Hero Bot Swish to scripts/fixtures/swish-bands.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { basePartNumber, convertParts, loadProject, walkAssembly } from './import-cad.mjs';
import { BAND_PART_NUMBERS, bandPiecesOf, dracoDecoder, nodesByPath, projectArchive } from './cad-meshes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SWISH = '4094-viqc 2024-2025 hero bot swish';

async function main(argv) {
  const args = argv.slice(2);
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(ROOT, 'scripts', 'fixtures', 'swish-bands.json');
  const source = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out') || SWISH;
  const project = await loadProject(source);
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
  const frames = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'cad-frames.json'), 'utf8')).frames;
  const byNumber = new Map(catalog.map((p) => [p.partNumber, p]));
  const walked = walkAssembly(project, { isLibraryPart: (n) => byNumber.has(n) });
  const converted = convertParts(walked, { catalog, frames });
  const meshDir = await projectArchive(typeof source === 'string' && !fs.existsSync(source) ? source : SWISH);
  const decode = await dracoDecoder({ faces: true });
  const nodes = nodesByPath(project);
  const bands = [];
  for (const w of walked.parts) {
    const pn = basePartNumber(w.cadPartNumber);
    if (w.hidden || !BAND_PART_NUMBERS.has(pn)) continue;
    const parts = bandPiecesOf(w, nodes.get(w.path), { meshDir, decode, scaleFactor: walked.scaleFactor, liftMm: converted.liftMm });
    parts.forEach((p, k) => bands.push({ path: parts.length > 1 ? `${w.path}#${k + 1}` : w.path, cadPartNumber: pn, partId: byNumber.get(pn)?.id || null, points: p }));
  }
  const data = {
    source: typeof source === 'string' ? source : SWISH,
    liftMm: converted.liftMm,
    parts: converted.items.map(({ partQuery, label, position, rotation, subassembly }) => ({ partId: partQuery, label, position, rotation, subassembly })),
    bands
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`${data.parts.length} parts, ${bands.length} bands -> ${path.relative(ROOT, out)}`);
  for (const b of bands) console.log(`  ${b.cadPartNumber} ${b.path.split('/').pop()}: ${b.points.length / 3} points`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv).catch((err) => {
    console.error(err.stack || err);
    process.exit(1);
  });
}
