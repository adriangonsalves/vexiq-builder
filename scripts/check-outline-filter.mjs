/**
 * Node check for src/utils/outlineFilter.js (openspec outline-filters-and-one-part-pick): the Outline's
 * filter chips (Electronics, Locked, Hidden, Colour) with the search, folders, and Select shown.
 * Run: node scripts/check-outline-filter.mjs   (exits 1 on any failure)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NO_FILTERS, colorsInBuild, filterRows, filtersOn, isElectronics, partPasses, shownIds } from '../src/utils/outlineFilter.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
const catalog = Array.isArray(raw) ? raw : raw.parts || Object.values(raw);
const byName = new Map(catalog.map((p) => [p.name, p]));

// --- Electronics ---------------------------------------------------------------------------------------
{
  const yes = ['VEX IQ Smart Motor', 'VEX IQ Robot Brain Gen 2', 'VEX IQ Robot Brain Gen 1', 'VEX IQ Robot Battery', 'VEX IQ Distance Sensor', 'VEX IQ Touch Sensor', 'VEX IQ 900 MHz Radio', 'VEX IQ Controller', 'VEX IQ Cable Pack'];
  const no = ['2x Pitch Plastic Motor Shaft', '4x Pitch Plastic Motor Shaft', 'Single Motor Support Cap', 'Dual Motor Support Cap', '1x6 Beam', '0x2 Connector Pin'];
  const wrongYes = yes.filter((n) => !isElectronics(byName.get(n)));
  const wrongNo = no.filter((n) => isElectronics(byName.get(n)));
  check('Electronics: motors, brains, battery, sensors, radio, controller, cables count', wrongYes.length === 0, wrongYes.join(', '));
  check('Electronics: motor shafts, motor caps, beams and pins don\'t', wrongNo.length === 0, wrongNo.join(', '));
  check('Electronics: no catalog entry is not electronics', !isElectronics(undefined));
}

// --- Chips on single parts -------------------------------------------------------------------------------
const meta = {
  motor: byName.get('VEX IQ Smart Motor'),
  brain: byName.get('VEX IQ Robot Brain Gen 2'),
  pin: byName.get('0x2 Connector Pin'),
  shaft: byName.get('2x Pitch Plastic Motor Shaft'),
  beam: byName.get('1x6 Beam')
};
const part = (id, kind, extra = {}) => ({ instanceId: id, kind, label: id, color: '#64748b', visible: true, locked: false, ...extra });
const metaOf = (inst) => meta[inst.kind];
{
  const lockedRed = part('Arm', 'beam', { locked: true, color: '#DC2626' });
  check('Locked chip: a locked part passes, an unlocked one not', partPasses(lockedRed, meta.beam, '', { ...NO_FILTERS, locked: true }) && !partPasses(part('B', 'beam'), meta.beam, '', { ...NO_FILTERS, locked: true }));
  check('Hidden chip: a hidden part passes, a shown one not', partPasses(part('H', 'pin', { visible: false }), meta.pin, '', { ...NO_FILTERS, hidden: true }) && !partPasses(part('S', 'pin'), meta.pin, '', { ...NO_FILTERS, hidden: true }));
  check('Colour chip: matches regardless of letter case', partPasses(lockedRed, meta.beam, '', { ...NO_FILTERS, color: '#dc2626' }) && !partPasses(part('G', 'beam'), meta.beam, '', { ...NO_FILTERS, color: '#dc2626' }));
  check('Chips together: every chip must pass', !partPasses(lockedRed, meta.beam, '', { ...NO_FILTERS, locked: true, hidden: true }));
  check('filtersOn: false with none, true with one', !filtersOn(NO_FILTERS) && filtersOn({ ...NO_FILTERS, color: '#fff' }));
}

// --- Rows: search and filter together, folders ---------------------------------------------------------------
{
  // "Left Drive" folder (open): Left Motor, Left Motor Pin hole_6, a motor shaft; loose: Brain, Right Motor, a beam
  const parts = [
    part('Left Motor', 'motor'),
    part('Left Motor Pin hole_6', 'pin'),
    part('Left Shaft', 'shaft'),
    part('Brain', 'brain'),
    part('Right Motor', 'motor', { visible: false }),
    part('Beam', 'beam', { color: '#DC2626' })
  ];
  const byId = new Map(parts.map((p) => [p.instanceId, p]));
  const group = { id: 'g', name: 'Left Drive', ids: ['Left Motor', 'Left Motor Pin hole_6', 'Left Shaft'] };
  const rows = [
    { kind: 'folder', group, listed: group.ids },
    ...group.ids.map((id) => ({ kind: 'part', inst: byId.get(id), depth: 1 })),
    ...['Brain', 'Right Motor', 'Beam'].map((id) => ({ kind: 'part', inst: byId.get(id), depth: 0 }))
  ];
  const names = (list) => list.map((r) => (r.kind === 'folder' ? `[${r.group.name}:${r.listed.length}]` : r.inst.instanceId)).join(', ');
  const opts = (query, filters) => ({ query, filters, metaOf, byId });

  const motorSearch = filterRows(rows, opts('motor', NO_FILTERS));
  check('search "motor" alone also lists the pin named after the motor and the motor shaft', names(motorSearch) === '[Left Drive:3], Left Motor, Left Motor Pin hole_6, Left Shaft, Right Motor', names(motorSearch));
  const elec = filterRows(rows, opts('', { ...NO_FILTERS, electronics: true }));
  check('Electronics: the motors and the brain, no pin or shaft; the folder lists only its motor', names(elec) === '[Left Drive:1], Left Motor, Brain, Right Motor', names(elec));
  const leftElec = filterRows(rows, opts('left', { ...NO_FILTERS, electronics: true }));
  check('search "left" with Electronics: only "Left Motor"', names(leftElec) === '[Left Drive:1], Left Motor', names(leftElec));
  const byFolderName = filterRows(rows, opts('drive', NO_FILTERS));
  check('search only: a folder whose name matches keeps all its parts', names(byFolderName) === '[Left Drive:3], Left Motor, Left Motor Pin hole_6, Left Shaft', names(byFolderName));
  const folderNameWithChip = filterRows(rows, opts('drive', { ...NO_FILTERS, hidden: true }));
  check('with a chip on, a folder name match alone doesn\'t keep the folder', names(folderNameWithChip) === '', names(folderNameWithChip));
  check('no search and no chip: rows unchanged', filterRows(rows, opts('', NO_FILTERS)) === rows);

  const hidden = filterRows(rows, opts('', { ...NO_FILTERS, hidden: true }));
  check('Select shown with Hidden: just the hidden part', shownIds(hidden, new Set(['g'])).join() === 'Right Motor');
  const closedRows = rows.filter((r) => !(r.kind === 'part' && r.depth > 0));
  const elecClosed = filterRows(closedRows, opts('', { ...NO_FILTERS, electronics: true }));
  check('Select shown: a closed folder gives its shown parts where it is, each on its own', shownIds(elecClosed).join() === 'Left Motor,Brain,Right Motor', shownIds(elecClosed).join());

  const colours = colorsInBuild(parts);
  check('colours in the build: one per colour, most used first, lower case', colours.map((c) => `${c.color}:${c.count}`).join() === '#64748b:5,#dc2626:1', JSON.stringify(colours));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll outline filter checks passed');
process.exit(failures ? 1 : 0);
