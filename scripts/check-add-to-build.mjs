/**
 * Node check for adding one build into another as a new group (openspec add-build-to-build):
 * addBuildAsGroup and setOffsetBesideBuild in src/utils/partGroups.js, on hand-made parts and the starters.
 * Run: node scripts/check-add-to-build.mjs   (exits 1 on any failure)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addBuildAsGroup, freeGroupName, groupsOf, setOffsetBesideBuild, worldBoxOf } from '../src/utils/partGroups.js';
import { bandReport } from '../src/utils/bandRoute.js';
import { shapedPart } from '../src/utils/shapedParts.js';
import { STARTERS, starterById } from '../src/starters.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const catalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'catalog.json'), 'utf8'));
const catalogMap = new Map(catalog.map((p) => [p.id, p]));
const partOf = (inst) => shapedPart(catalogMap.get(inst.partId), inst.shape);
const bboxOf = (inst) => partOf(inst)?.bbox;
const build = (id) => starterById(id).build(catalog);
const merged = (instances, added) => [...instances, ...added.parts];

/** Do the world boxes of two sets of parts meet anywhere? */
function setsMeet(a, b) {
  const boxes = (list) => list.filter((i) => i.visible !== false).map((i) => worldBoxOf(i, bboxOf(i))).filter(Boolean);
  const meet = (p, q) => [0, 1, 2].every((k) => p.min[k] < q.max[k] && q.min[k] < p.max[k]);
  const bb = boxes(b);
  return boxes(a).some((p) => bb.some((q) => meet(p, q)));
}

// --- Which saved fields name another part: only band routes ----------------------------------------
{
  const found = new Set();
  for (const s of STARTERS) {
    const parts = s.build(catalog);
    const ids = new Set(parts.map((p) => p.instanceId));
    const walk = (v, at) => {
      if (typeof v === 'string') {
        if (ids.has(v) && at !== 'instanceId') found.add(at);
      } else if (Array.isArray(v)) v.forEach((x) => walk(x, `${at}[]`));
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
    };
    parts.forEach((p) => walk(p, ''));
  }
  const allowed = new Set(['shape.route[].instanceId', 'shape.picks[].instanceId']);
  check('references: no starter part names another part outside a band route', [...found].every((f) => allowed.has(f)), [...found].join(', '));
}

// --- Hand-made: a drive base and a claw --------------------------------------------------------------
const beam = catalog.find((p) => /^2x10 Beam$/i.test(p.name)) || catalog.find((p) => /Beam/.test(p.name));
const mk = (id, label, position, extra = {}) => ({ instanceId: id, partId: beam.id, label, position, rotation: [0, 0, 0], lastValidPosition: [...position], lastValidRotation: [0, 0, 0], isIntersecting: false, color: '#fff', visible: true, locked: false, ...extra });
{
  const base = [mk('a', `${beam.name} #1`, [0, 0, 0]), mk('b', `${beam.name} #2`, [0, 12.7, 0]), mk('c', 'Left side', [0, 25.4, 0])];
  const claw = [
    mk('a', `${beam.name} #1`, [0, 0, 0], { groupId: 'g1', groupName: 'Jaw' }),
    mk('x', 'Left side', [0, 12.7, 0], { groupId: 'g1', groupName: 'Jaw', locked: true }),
    mk('y', 'Hidden one', [0, 25.4, 0], { visible: false, color: '#f00', groupId: 'g2', groupName: 'Wrist' }),
    mk('z', 'Wrist plate', [0, 38.1, 0], { groupId: 'g2', groupName: 'Wrist' })
  ];
  const before = JSON.stringify(base);
  const added = addBuildAsGroup(base, claw, 'claw', bboxOf);
  const all = merged(base, added);
  check('add: every part comes in', added.parts.length === claw.length);
  check('add: parts already there are untouched', JSON.stringify(all.slice(0, base.length)) === before);
  check('add: no two parts share an id', new Set(all.map((p) => p.instanceId)).size === all.length);
  check('add: no two parts share a label', new Set(all.map((p) => p.label)).size === all.length, all.map((p) => p.label).join(' | '));
  check('add: a clashing numbered label takes the next free number', added.parts[0].label === `${beam.name} #3`, added.parts[0].label);
  check('add: a clashing plain label gets a number', added.parts[1].label === 'Left side 2', added.parts[1].label);
  const groups = groupsOf(all);
  const g = groups.get(added.parts[0].groupId);
  check('add: one new group holds every added part, its groups merged in', groups.size === 1 && g?.ids.length === claw.length && g.name === 'claw', JSON.stringify([...groups.values()]));
  check('add: hidden and colours kept', added.parts[2].visible === false && added.parts[2].color === '#f00');
  check('add: locked parts come in unlocked', added.parts.every((p) => p.locked === false));
  const d = (i, k) => added.parts[i].position[k] - claw[i].position[k];
  check('add: places relative to one another kept, height kept', added.parts.every((_, i) => [0, 1, 2].every((k) => Math.abs(d(i, k) - d(0, k)) < 1e-6)) && d(0, 1) === 0);
  check('add: offset on the half-pitch grid', [0, 2].every((k) => Math.abs(d(0, k) / 6.35 - Math.round(d(0, k) / 6.35)) < 1e-6));
  check('add: set down clear of the build', !setsMeet(base, added.parts));
  check('add: last valid pose is the new pose', added.parts.every((p) => p.lastValidPosition.join() === p.position.join() && p.isIntersecting === false));
  check('add: source build unchanged', claw[0].instanceId === 'a' && claw[0].position[0] === 0);

  const again = addBuildAsGroup(all, claw, 'claw', bboxOf);
  const all2 = merged(all, again);
  check('twice: second group is "claw 2"', again.groupName === 'claw 2');
  check('twice: the second set clears the first', !setsMeet(all, again.parts));
  check('twice: labels and ids all distinct', new Set(all2.map((p) => p.label)).size === all2.length && new Set(all2.map((p) => p.instanceId)).size === all2.length);

  check('empty: nothing to add', addBuildAsGroup(base, [], 'x', bboxOf).parts.length === 0);
  check('empty build: no offset', setOffsetBesideBuild([], claw, bboxOf).join() === '0,0,0');
  check('group name: "Group" when blank', freeGroupName([], '  ') === 'Group');
}

// --- Starters: same starter twice, Flop's bent sheets, the winch's belts ------------------------------
{
  const claw = build('clawbot');
  const added = addBuildAsGroup(claw, build('clawbot'), 'Clawbot', bboxOf);
  const all = merged(claw, added);
  check('Clawbot into Clawbot: ids distinct', new Set(all.map((p) => p.instanceId)).size === all.length);
  check('Clawbot into Clawbot: labels distinct', new Set(all.map((p) => p.label)).size === all.length);
  check('Clawbot into Clawbot: clear of each other', !setsMeet(claw, added.parts));
}
{
  const t0 = Date.now();
  const flop = build('flop');
  const added = addBuildAsGroup(build('clawbot'), flop, 'Flop', bboxOf);
  const ms = Date.now() - t0;
  check(`Flop into Clawbot: 594 parts in one group (${ms} ms)`, added.parts.length === flop.length && groupsOf(added.parts).size === 1);
  const sheets = added.parts.filter((p) => p.shape?.kind === 'sheet-bend');
  check('Flop: bent sheets keep their shape', sheets.length === 2 && sheets.every((s, i) => JSON.stringify(s.shape) === JSON.stringify(flop.filter((p) => p.shape?.kind === 'sheet-bend')[i].shape)));
}
{
  const winch = build('ratchet-winch');
  const added = addBuildAsGroup(build('clawbot'), winch, 'Ratchet winch', bboxOf);
  const bands = winch.filter((p) => p.shape?.kind === 'band');
  const copies = added.parts.filter((p) => p.shape?.kind === 'band');
  const rep = (b) => {
    const r = bandReport(b, partOf);
    return r ? JSON.stringify([r.lengthMm, r.stretch, r.state]) : null;
  };
  check('winch: belts stay strung with the same length and stretch', copies.length === bands.length && copies.every((c, i) => c.shape.path && rep(c) === rep(bands[i])), copies.map(rep).join(' / '));
}
{
  // A band strung between two parts of the added build points at their copies
  const band = catalog.find((p) => /#32 Rubber Band/i.test(p.name)) || catalog.find((p) => /Rubber Band/i.test(p.name));
  const src = [mk('p', 'Post A', [0, 0, 0]), mk('q', 'Post B', [50, 0, 0]), { ...mk('r', 'Band', [25, 0, 0]), partId: band.id, shape: { kind: 'band', route: [{ instanceId: 'p', feature: 'post:body', side: 'out', wraps: 1 }, { instanceId: 'q', feature: 'post:body', side: 'out', wraps: 1 }], picks: [{ instanceId: 'p', feature: 'post:body' }], path: { points: [[0, 0, 0]], ups: [[0, 1, 0]], lengthMm: 100 } } }];
  const added = addBuildAsGroup([mk('p', 'Other', [0, 0, 0])], src, 'Bands', bboxOf);
  const [pa, qa, ra] = added.parts;
  check('band: route points at the added copies', ra.shape.route[0].instanceId === pa.instanceId && ra.shape.route[1].instanceId === qa.instanceId && ra.shape.picks[0].instanceId === pa.instanceId);
  check('band: never points at a part already in the build', ra.shape.route.every((s) => s.instanceId !== 'p'));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll add-to-build checks passed');
process.exit(failures ? 1 : 0);
