/**
 * Node check for the build library's pure helpers (src/utils/buildLibrary.js) and the starters.
 * Run: node scripts/check-build-library.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFingerprint, changedAgo, copyName, exportFileName, fileBuildName, groupDuplicateBuilds, groupLibraryBuilds, isStarterAtInitialState, newBuildId, nextBuildName, normalizeFolderName, starterBuildName, starterSaveAction } from '../src/utils/buildLibrary.js';
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

// Starter save-on-edit state transitions (openspec starter-save-on-edit)
{
  const initHist = { headId: 's1', subIndex: null };
  const editedHist = { headId: 's2', subIndex: null };
  const scrubbedHist = { headId: 's1', subIndex: 3 };
  const plainBuild = { id: 'b1', name: 'Build #1' };
  const unsavedStarter = { id: 'b2', name: 'Huey', unsaved: true, starter: { name: 'Huey', initialHeadId: 's1', explicit: false } };
  const promotedStarter = { id: 'b2', name: 'Huey 2', unsaved: false, starter: { name: 'Huey', initialHeadId: 's1', explicit: false } };
  const renamedStarter = { id: 'b2', name: 'My Huey', unsaved: false, starter: { name: 'Huey', initialHeadId: 's1', explicit: true } };
  const driveStarter = { id: 'b2', name: 'Huey', unsaved: false, starter: { name: 'Huey', initialHeadId: 's1', explicit: false }, drive: { fileId: 'f1' } };
  check('ordinary build always saves', starterSaveAction(plainBuild, initHist) === 'save');
  check('unsaved starter at initial state skips saving', isStarterAtInitialState(unsavedStarter, initHist) && starterSaveAction(unsavedStarter, initHist) === 'skip');
  check('unsaved starter promotes on first edit', starterSaveAction(unsavedStarter, editedHist) === 'promote');
  check('unsaved starter promotes when scrubbed inside initial step', starterSaveAction(unsavedStarter, scrubbedHist) === 'promote');
  check('unsaved starter promotes on explicit rename or Drive link', starterSaveAction({ ...unsavedStarter, starter: { ...unsavedStarter.starter, explicit: true } }, initHist) === 'promote' && starterSaveAction({ ...unsavedStarter, drive: { fileId: 'f1' } }, initHist) === 'promote');
  check('promoted starter saves while edited', starterSaveAction(promotedStarter, editedHist) === 'save');
  check('promoted starter demotes when undone back to initial state', starterSaveAction(promotedStarter, initHist) === 'demote');
  check('explicitly renamed or Drive-linked starter stays saved after undo', starterSaveAction(renamedStarter, initHist) === 'save' && starterSaveAction(driveStarter, initHist) === 'save');
}

// Library folder grouping & duplicate-name disambiguation (openspec library-folders-and-select)
{
  check('normalizeFolderName trims and rejects blank names', normalizeFolderName('  Drivetrains ') === 'Drivetrains' && normalizeFolderName('   ') === null);

  const grouped = groupLibraryBuilds([
    { id: '1', name: 'Loose A', updatedAt: 100 },
    { id: '2', name: 'Loose B', updatedAt: 200 },
    { id: '3', name: 'Bot 2025', updatedAt: 150, folder: 'Drivetrains' },
    { id: '4', name: 'Drive 25', updatedAt: 300, drive: { fileId: 'f1', folderId: 'd25', folderName: 'Drivetrains', parentFolderName: '2025' } },
    { id: '5', name: 'Drive 26', updatedAt: 400, drive: { fileId: 'f2', folderId: 'd26', folderName: 'Drivetrains', parentFolderName: '2026' } },
    { id: '6', name: 'My Drive Bot', updatedAt: 50, drive: { fileId: 'f3', folderId: 'my-drive', folderName: 'My Drive' } },
    { id: '7', name: 'Unknown Drive Bot', updatedAt: 25, drive: { fileId: 'f4' } }
  ]);
  const ungroupedSec = grouped.sections.find((s) => s.kind === 'local-ungrouped');
  check(
    'Google Drive folders come first, and ungrouped local builds are sorted newest first',
    grouped.sections[0].kind === 'drive-folder' && ungroupedSec?.builds.map((b) => b.id).join(',') === '2,1',
    JSON.stringify(grouped.sections.map((s) => [s.kind, s.displayName]))
  );
  const byKey = Object.fromEntries(grouped.sections.map((s) => [s.key, s]));
  check(
    'duplicate folder names append parent folder name (Local vs 2025 vs 2026)',
    byKey['local:drivetrains']?.displayName === 'Drivetrains (Local)' &&
      byKey['drive-id:d25']?.displayName === 'Drivetrains (2025)' &&
      byKey['drive-id:d26']?.displayName === 'Drivetrains (2026)',
    JSON.stringify(grouped.sections.map((s) => [s.key, s.displayName]))
  );
  check(
    'unique Drive folders keep plain names and fallback to Google Drive',
    byKey['drive-id:my-drive']?.displayName === 'My Drive' && byKey['drive-default']?.displayName === 'Google Drive',
    JSON.stringify(grouped.sections.map((s) => [s.key, s.displayName]))
  );
  check('localFolderNames lists only local folders', JSON.stringify(grouped.localFolderNames) === '["Drivetrains"]');

  // Unique folder names do NOT append parent names
  const unique = groupLibraryBuilds([
    { id: '1', name: 'A', updatedAt: 10, folder: 'Claws' },
    { id: '2', name: 'B', updatedAt: 20, drive: { fileId: 'f1', folderId: 'd1', folderName: 'Team 1234', parentFolderName: 'Robotics' } }
  ]);
  check(
    'unique folder names omit parent folder name',
    unique.sections.map((s) => s.displayName).join(',') === 'Team 1234,Claws',
    JSON.stringify(unique.sections.map((s) => s.displayName))
  );

  // Content fingerprint & duplicate grouping
  const p1 = { instanceId: 'a', partId: 'beam-2x10', position: [1, 2, 3], rotation: [0, 90, 0], color: '#333' };
  const p2 = { instanceId: 'b', partId: 'pin-1x1', position: [0, 0, 0], rotation: [0, 0, 0], color: '#111' };
  const p1Renamed = { instanceId: 'z99', partId: 'beam-2x10', position: [1.0001, 2, 3], rotation: [0, 90, 0], color: '#333' };
  const p1Moved = { instanceId: 'a', partId: 'beam-2x10', position: [2, 2, 3], rotation: [0, 90, 0], color: '#333' };
  const fpA = buildFingerprint([p1, p2]);
  const fpB = buildFingerprint([p2, p1Renamed]);
  const fpC = buildFingerprint([p1Moved, p2]);
  check('buildFingerprint matches identical parts regardless of order and instanceId', fpA === fpB && fpA !== fpC, `${fpA} vs ${fpB} vs ${fpC}`);
  check('buildFingerprint matches empty builds', buildFingerprint([]) === '0:empty');

  const dupGroups = groupDuplicateBuilds(
    [
      { id: 'u1', name: 'Unique', updatedAt: 500, fingerprint: fpC },
      { id: 'd1', name: 'Huey', updatedAt: 100, fingerprint: fpA },
      { id: 'd2', name: 'Huey 2', updatedAt: 300, fingerprint: fpA },
      { id: 'd3', name: 'Huey Drive', updatedAt: 200, fingerprint: fpA, drive: { fileId: 'f1' } },
      { id: 'e1', name: 'Empty 1', updatedAt: 400, fingerprint: '0:empty' },
      { id: 'e2', name: 'Empty 2', updatedAt: 50, fingerprint: '0:empty' }
    ],
    'e2'
  );
  check(
    'groupDuplicateBuilds keeps only 2+ duplicate groups, sorted largest first',
    dupGroups.length === 2 && dupGroups[0].builds.length === 3 && dupGroups[1].builds.length === 2,
    JSON.stringify(dupGroups.map((g) => [g.displayName, g.builds.length]))
  );
  check(
    'Select extras prefers keeping Drive-linked build, then current build',
    dupGroups[0].keepId === 'd3' && dupGroups[0].extraIds.join(',') === 'd2,d1' && dupGroups[1].keepId === 'e2' && dupGroups[1].extraIds.join(',') === 'e1',
    JSON.stringify(dupGroups.map((g) => ({ keepId: g.keepId, extraIds: g.extraIds })))
  );
}

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
