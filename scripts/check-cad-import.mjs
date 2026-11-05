/**
 * Node check for importing VEX CAD (openspec cad-import-readiness, cad-import): the frame table,
 * the CAD-to-app converter and the import's conversion, on a saved slice of the 2026-27 Herobot
 * Flop project (scripts/fixtures/flop-cad-slice.json: a drive motor with its pins and shaft, a
 * corner connector and its beams, both drive chains, the two duplicate 2x12 Beam pairs, a cable plug).
 * Run: node scripts/check-cad-import.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAssembly, looksTheSame } from '../mcp/assembly-engine.mjs';
import { convertParts, projectIdFrom, walkAssembly } from './import-cad.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const catalog = read('public/catalog.json');
const frames = read('public/cad-frames.json').frames;
const slice = read('scripts/fixtures/flop-cad-slice.json');

// --- The frame table ------------------------------------------------------------------------------
{
  const bad = Object.entries(frames).filter(([, e]) => !['centre', 'origin'].includes(e.rule) || !['pins', 'mesh', 'default'].includes(e.source) || !e.checkedOn);
  check('every frame entry has a rule, how it was found and the build it was checked on', bad.length === 0, bad.map(([k]) => k).join(', '));
  check('Smart Motor: its own origin, turned 180° about Z', frames['228-2560']?.rule === 'origin' && Math.abs(Math.abs(frames['228-2560'].turn?.[2]) - 180) < 1e-6);
  check('Bumper Switch: its own origin, offset -19.05, 0, 6.35', frames['228-2677']?.rule === 'origin' && JSON.stringify(frames['228-2677'].offsetMm) === '[-19.05,0,6.35]');
  check('omni wheel and Long Intake Flap carry a turn', frames['228-2536-000']?.turn && frames['228-2500-242']?.turn);
  check('the Double Offset Corner Connector uses the box-centre rule', frames['228-2500-277']?.rule === 'centre');
}

// --- Converting the slice --------------------------------------------------------------------------
const walked = walkAssembly(slice);
const conv = convertParts(walked, { catalog, frames, looksTheSame });
const instances = conv.items.map((i) => ({ instanceId: i.label, label: i.label, partId: i.partQuery, position: i.position, rotation: i.rotation }));
const audit = auditAssembly({ instances });
{
  check('project id from an instructions.online link', projectIdFrom('https://instructions.online/?id=4063-2026-2027_viqrc_herobot_flop') === '4063-2026-2027_viqrc_herobot_flop');
  const motor = 'Drive Train: 228-2560-1';
  const inMotor = audit.joints.filter((j) => j.seatedIn.some((s) => s.instanceId === motor));
  const pins = inMotor.filter((j) => /228-2500-060/.test(j.label));
  check('Motor from CAD: its four mounting pins from the same CAD file are seated in its holes', pins.length === 4, inMotor.map((j) => j.label).join(', '));
  const socket = catalog.find((p) => p.partNumber === '228-2560').ports.find((p) => p.type === 'shaft_socket').portId;
  const shaft = audit.joints.find((j) => j.label === 'Drive Train: 228-2500-2238-1');
  check('  its motor shaft is in its drive socket', shaft?.seatedIn.some((s) => s.instanceId === motor && s.ports.includes(socket)), JSON.stringify(shaft?.seatedIn));
  const cc = audit.pegJoints.filter((j) => j.part === 'Drive Train: 228-2500-277-1').map((j) => `${j.joinedTo} x${j.pegs}`).sort();
  check('the Double Offset Corner Connector has its pegs in both beams', cc.join() === 'Drive Train: 228-2500-027-1 x2,Drive Train: 228-2500-030-1 x2', cc.join());
  check('nothing in the slice overlaps', audit.collisionCount === 0, JSON.stringify(audit.collisions.slice(0, 3)));
}

// --- Labels, duplicates, left out ----------------------------------------------------------------------
{
  const labels = conv.items.map((i) => i.label);
  check('every label is unique', new Set(labels).size === labels.length);
  const link29 = labels.filter((l) => l.endsWith('228-2500-230-29'));
  check(
    'Same name in two chains: both links placed, with different labels',
    link29.length === 2 && link29.includes('Drive Train: Chain Assembly v2-1/228-2500-230-29') && link29.includes('Drive Train: Chain Assembly v2-2/228-2500-230-29'),
    link29.join(' | ')
  );
  const linkPart = catalog.find((p) => p.partNumber === '228-2500-230').id;
  check('both chains are placed whole (130 links)', conv.items.filter((i) => i.partQuery === linkPart).length === 130);
  check(
    'the two 2x12 Beams turned end for end at the same place are dropped as duplicates',
    conv.duplicates.length === 2 && conv.duplicates.every((d) => /228-2500-026-[34]$/.test(d.path)),
    JSON.stringify(conv.duplicates)
  );
  check('the cable plug is left out as a cable plug', conv.leftOut.some((l) => /6P6C/.test(l.cadPartNumber) && l.reason === 'cable plug'), JSON.stringify(conv.leftOut));
  check('every part type in the slice has a checked frame entry', conv.unchecked.length === 0, conv.unchecked.join(', '));
  const pinsAfter = conv.items.findIndex((i) => i.isPin);
  check('structural parts come before pins', pinsAfter > 0 && conv.items.slice(pinsAfter).every((i) => i.isPin));
  const lowest = Math.min(...conv.items.map((i) => i.position[1]));
  check('the slice is raised so it rests on the floor', conv.liftMm > 0 && lowest > 0, `${conv.liftMm} mm`);
}

// --- A part number with no table entry ------------------------------------------------------------------
{
  const one = walked.parts.find((p) => p.cadPartNumber === '228-2500-2238');
  const unknown = convertParts({ scaleFactor: walked.scaleFactor, parts: [{ ...one, cadPartNumber: '228-2500-120', path: 'Test/228-2500-120-1' }] }, { catalog, frames: {} });
  check('Unknown part: placed by the box-centre rule and listed as unchecked', unknown.items.length === 1 && unknown.unchecked.includes('228-2500-120'), JSON.stringify(unknown.unchecked));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll CAD import checks passed');
process.exit(failures ? 1 : 0);
