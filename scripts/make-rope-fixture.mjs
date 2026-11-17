/**
 * Writes the rope test data for openspec rope-and-spool: the parts of the subassemblies a VEX CAD
 * robot's ropes run on, as the import places them, and each rope as the import reads it (ends, spots,
 * winding) with the points of VEX's own cord (app frame, mm, one per 2 mm cube).
 *
 *   node scripts/make-rope-fixture.mjs            both robots, to scripts/fixtures/
 *   node scripts/make-rope-fixture.mjs swish|huey [<saved project .json>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertParts, importRopes, loadProject, walkAssembly } from './import-cad.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROBOTS = {
  swish: { source: '856670fb-2cfa-48e6-b439-4e3b45a5f28e', name: '4094-viqc 2024-2025 hero bot swish', out: 'swish-rope.json', subs: /Catapult (Winch|Arm)$/ },
  huey: { source: '82f13c0c-d4a4-4db5-869e-5a18c90b9443', name: '4063-2025-2026_viqrc_hero_bot_huey', out: 'huey-lift.json', subs: /(Holder CAD|Middle Stage|Claw Mount)$/ }
};

async function make(robot, saved) {
  const source = saved || robot.source;
  const project = await loadProject(source);
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
  const frames = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'cad-frames.json'), 'utf8')).frames;
  const numbers = new Set(catalog.map((p) => p.partNumber));
  const walked = walkAssembly(project, { isLibraryPart: (n) => numbers.has(n) });
  const converted = convertParts(walked, { catalog, frames, projectId: project.id || null });
  const ropes = await importRopes(project, walked, converted, { source, keepPoints: true });
  // The import's ids (`import-<k>`) stay, so the ropes' routes name the fixture's parts
  const parts = converted.items.map((it, k) => ({ instanceId: `import-${k}`, partId: it.partQuery, label: it.label, position: it.position, rotation: it.rotation, subassembly: it.subassembly })).filter((p) => robot.subs.test(p.subassembly));
  const data = { source: robot.name, made: 'node scripts/make-rope-fixture.mjs', liftMm: converted.liftMm, parts, ropes };
  const out = path.join(ROOT, 'scripts', 'fixtures', robot.out);
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`${parts.length} parts, ${ropes.length} ropes -> ${path.relative(ROOT, out)}`);
  for (const r of ropes) console.log(r.error ? `  left out: ${r.label}: ${r.error}` : `  ${r.label}: ${r.names.from} -> ${r.names.via.join(', ') || '(straight)'} -> ${r.names.to}; ${r.usedMm} mm used, ${r.turns} turns, ${r.slackMm} mm slack, ${r.points.length / 3} cord points`);
}

const [which, saved] = process.argv.slice(2);
for (const [name, robot] of Object.entries(ROBOTS)) if (!which || which === name) await make(robot, which ? saved : null);
