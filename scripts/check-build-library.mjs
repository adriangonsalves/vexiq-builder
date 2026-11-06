/**
 * Node check for the build library's pure helpers (src/utils/buildLibrary.js) and the starters.
 * Run: node scripts/check-build-library.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { changedAgo, copyName, exportFileName, fileBuildName, newBuildId, nextBuildName, starterBuildName } from '../src/utils/buildLibrary.js';
import { STARTERS, starterById } from '../src/starters.js';
import { checkCandidateCollision } from '../mcp/assembly-engine.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

check('no builds: "Build #1"', nextBuildName([]) === 'Build #1');
check('#1, #3 and "Clawbot": "Build #4"', nextBuildName(['Build #1', 'Build #3', 'Clawbot']) === 'Build #4', nextBuildName(['Build #1', 'Build #3', 'Clawbot']));
check('a renamed "Build #2 v2" does not count', nextBuildName(['Build #2 v2', 'Build #1']) === 'Build #2');
check('copy names: "<name> copy", then "<name> copy 2"', copyName(['Clawbot'], 'Clawbot') === 'Clawbot copy' && copyName(['Clawbot', 'Clawbot copy'], 'Clawbot') === 'Clawbot copy 2');
check('starter names: "Sample starter", then "Sample starter 2"', starterBuildName([], 'Sample starter') === 'Sample starter' && starterBuildName(['Sample starter'], 'Sample starter') === 'Sample starter 2');
check('file names: extension dropped', fileBuildName('drivetrain.vexiq.json') === 'drivetrain' && fileBuildName('/tmp/My Bot.json') === 'My Bot' && fileBuildName('.vexiq.json') === 'Opened build');
check('export file names: named after the build, unsafe characters replaced', exportFileName('Clawbot') === 'Clawbot.vexiq.json' && exportFileName('a/b:c') === 'a-b-c.vexiq.json');
check('build ids are unique', new Set(Array.from({ length: 50 }, newBuildId)).size === 50);
check('changed-ago text', changedAgo(1000, 1000) === 'just now' && changedAgo(0, 5 * 60000) === '5 min ago' && changedAgo(0, 3 * 3600000) === '3 h ago');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'public', 'catalog.json'), 'utf8'));
const sample = starterById('sample');
const parts = sample.build(catalog);
check('the sample starter lays out a beam, pin, axle and gear', STARTERS.length >= 1 && sample.name === 'Sample starter' && parts.length === 4, JSON.stringify(parts.map((p) => p.label)));

const speedbot = starterById('speedbot').build(catalog);
check('the Speedbot 2.0 starter has all 43 parts of the kit (cables left out)', speedbot.length === 43, String(speedbot.length));
const overlapping = speedbot.filter((inst) => checkCandidateCollision(inst, speedbot).isIntersecting).map((p) => p.label);
check('  none of its parts overlap (tires on their hubs included)', overlapping.length === 0, overlapping.join(', '));

const basebot = starterById('basebot').build(catalog);
check('the BaseBot starter has its 97 parts (cables left out, two wheel hubs added)', basebot.length === 97, String(basebot.length));
const basebotOverlapping = basebot.filter((inst) => checkCandidateCollision(inst, basebot).isIntersecting).map((p) => p.label);
check('  none of its parts overlap', basebotOverlapping.length === 0, basebotOverlapping.join(', '));

const clawbot = starterById('clawbot').build(catalog);
check('the Clawbot starter has its 193 parts', clawbot.length === 193, String(clawbot.length));

const flop = starterById('flop').build(catalog);
const flopGroups = new Set(flop.map((p) => p.groupName));
check('the Flop starter has its 594 parts in 5 groups', flop.length === 594 && flopGroups.size === 5, `${flop.length} parts, ${[...flopGroups].join(', ')}`);
const flopOverlapping = flop.filter((inst) => checkCandidateCollision(inst, flop).isIntersecting).map((p) => p.label);
check('  none of its parts overlap', flopOverlapping.length === 0, flopOverlapping.join(', '));


console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
