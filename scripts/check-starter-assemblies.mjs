/**
 * Node check for the starter sections and the Clawbot pieces (openspec starter-assemblies):
 * STARTERS sections and order, and Simple drivetrain / Simple arm / Simple claw in src/starters.js.
 * Run: node scripts/check-starter-assemblies.mjs   (exits 1 on any failure)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CLAWBOT_BRAIN, CLAWBOT_PIECES, STARTERS, STARTER_SECTIONS, matchesClawbotRules, starterById } from '../src/starters.js';
import { groupsOf, worldBoxOf } from '../src/utils/partGroups.js';
import { auditAssembly, partOf } from '../mcp/assembly-engine.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'catalog.json'), 'utf8'));
const byId = new Map(catalog.map((p) => [p.id, p]));
const lowest = (list) => Math.min(...list.map((i) => worldBoxOf(i, byId.get(i.partId)?.bbox)?.min[1] ?? Infinity));

// --- Sections ---------------------------------------------------------------------------------------
const sectionIds = new Set(STARTER_SECTIONS.map((s) => s.id));
check('every starter has a known section', STARTERS.every((s) => sectionIds.has(s.section)), STARTERS.filter((s) => !sectionIds.has(s.section)).map((s) => s.name).join(', '));
const names = (section) => STARTERS.filter((s) => s.section === section).map((s) => s.name).join(', ');
check('Robots: Speedbot 2.0, BaseBot, Clawbot, Flop, Huey, Swish', names('robots') === 'Speedbot 2.0, BaseBot, Clawbot, Flop, Huey, Swish', names('robots'));
{
  // Huey (VEX's CAD, scripts/make-huey-starter.mjs): its groups, and both lift ropes on the starter's own parts
  const huey = starterById('huey').build(catalog);
  const ids = new Set(huey.map((i) => i.instanceId));
  const ropes = huey.filter((i) => i.shape?.kind === 'rope');
  const refs = ropes.flatMap((r) => [...r.shape.ends.filter(Boolean), ...(r.shape.via || [])].map((x) => x.instanceId));
  check('Huey: 490 parts in four groups (Drive, Elevator Holder, Elevator Middle Stage, Claw Mount)', huey.length === 490 && [...new Set(huey.map((i) => i.groupName))].sort().join() === 'Claw Mount,Drive,Elevator Holder,Elevator Middle Stage', `${huey.length} parts, ${[...new Set(huey.map((i) => i.groupName))].join()}`);
  check("Huey: two lift ropes, their ends and spots naming the starter's own parts", ropes.length === 2 && refs.length >= 8 && refs.every((id) => ids.has(id)), JSON.stringify(refs.filter((id) => !ids.has(id))));
  const audit = auditAssembly({ instances: huey });
  check('Huey: each rope is held at both ends and passes through no part', audit.ropes.length === 2 && audit.ropes.every((r) => !r.through.length && !r.loosePocket && !r.tooShortMm && r.slackMm > 10), JSON.stringify(audit.ropes.map((r) => [r.through, r.slackMm])));
  // Linear motion and idler pins (openspec linear-motion-and-idler-pins)
  const unsecured = new Set(audit.unsecuredParts.map((u) => u.instanceId));
  const racksAndIdlers = huey.filter((i) => ['1x6 Continuous Linear Motion Rack Gear', '36 Tooth Gear', '48 Tooth Gear'].includes(partOf(i)?.name) && i.groupName !== 'Claw Mount');
  check(`Huey: its racks and idler gears are held (${racksAndIdlers.length} of them, none unsecured), and the Middle Stage slides on the Holder by one slide`, racksAndIdlers.length >= 8 && racksAndIdlers.every((i) => !unsecured.has(i.instanceId)) && audit.slides.length === 1 && audit.slides[0].moving.name === 'Elevator Middle Stage' && !audit.slides[0].locked, JSON.stringify({ unsecured: racksAndIdlers.filter((i) => unsecured.has(i.instanceId)).map((i) => i.label), slides: audit.slides.length }));
}
{
  // Swish (VEX's CAD, scripts/make-swish-starter.mjs): its groups, the winch's ratchet held by its pawl,
  // the rope and six bands on the starter's own parts
  const swish = starterById('swish').build(catalog);
  const ids = new Set(swish.map((i) => i.instanceId));
  const refs = (JSON.stringify(swish.map((i) => i.shape || null)).match(/"instanceId":"[^"]+"/g) || []).map((r) => r.split('"')[3]);
  check('Swish: 465 parts; groups Arm, Chassis, Distance Sensor Mount, Intake, Optical Sensor Mount, Winch', swish.length === 465 && [...new Set(swish.map((i) => i.groupName).filter(Boolean))].sort().join() === 'Arm,Chassis,Distance Sensor Mount,Intake,Optical Sensor Mount,Winch', `${swish.length} parts`);
  check("Swish: one rope and six bands, their routes naming the starter's own parts", swish.filter((i) => i.shape?.kind === 'rope').length === 1 && swish.filter((i) => i.shape?.kind === 'band').length === 6 && refs.length > 20 && refs.every((id) => ids.has(id)), JSON.stringify(refs.filter((id) => !ids.has(id))));
  const audit = auditAssembly({ instances: swish });
  check('Swish: the ratchet is held one way by one pawl on one pivot, pressed on its teeth', audit.ratchets.length === 1 && audit.ratchets[0].holds && audit.ratchets[0].pressed && audit.ratchets[0].pivotCount === 1 && !audit.ratchets[0].wrongWay, JSON.stringify(audit.ratchets));
  check('Swish: the rope is held at both ends and passes through no part; nothing unsecured', audit.ropes.length === 1 && !audit.ropes[0].through.length && !audit.ropes[0].loosePocket && !audit.ropes[0].tooShortMm && audit.unsecuredPartCount === 0, JSON.stringify({ ropes: audit.ropes, unsecured: audit.unsecuredPartCount }));
}
check('Assemblies: Sample starter, Ratchet winch, Rope winch, Rope lift, Simple drivetrain, Simple arm, Simple claw', names('assemblies') === 'Sample starter, Ratchet winch, Rope winch, Rope lift, Simple drivetrain, Simple arm, Simple claw', names('assemblies'));
check('headings: Robots then Assemblies', STARTER_SECTIONS.map((s) => s.name).join() === 'Robots,Assemblies');

// --- Every Clawbot part in exactly one piece or the brain list ---------------------------------------
const clawbot = starterById('clawbot').build(catalog);
const lists = { ...CLAWBOT_PIECES, brain: CLAWBOT_BRAIN };
const unsorted = [];
const doubled = [];
for (const inst of clawbot) {
  const hits = Object.entries(lists).filter(([, rules]) => matchesClawbotRules(rules, inst.label)).map(([k]) => k);
  if (hits.length === 0) unsorted.push(inst.label);
  if (hits.length > 1) doubled.push(`${inst.label} (${hits.join(', ')})`);
}
check('every Clawbot part is in a piece or the brain list', unsorted.length === 0, unsorted.join(', '));
check('no Clawbot part is in two lists', doubled.length === 0, doubled.join(', '));

const pieces = Object.keys(CLAWBOT_PIECES).map((id) => ({ id, starter: starterById(id), parts: starterById(id).build(catalog) }));
const brain = clawbot.filter((i) => matchesClawbotRules(CLAWBOT_BRAIN, i.label));
const all = [...pieces.flatMap((p) => p.parts), ...brain];
const key = (i) => `${i.partId}|${i.label}`;
check(`pieces + brain parts are exactly the Clawbot's ${clawbot.length} parts`, all.length === clawbot.length && new Set(all.map(key)).size === clawbot.length && clawbot.every((i) => all.some((a) => key(a) === key(i))), `${all.length} vs ${clawbot.length}`);
check('brain list is the brain, its 4 connectors and 8 pins', brain.length === 13 && brain.filter((b) => /^Brain Pin/.test(b.label)).length === 8, brain.map((b) => b.label).join(', '));

// --- Each piece ---------------------------------------------------------------------------------------
const floor = lowest(clawbot);
for (const { id, starter, parts } of pieces) {
  const groups = groupsOf(parts);
  const g = [...groups.values()][0];
  check(`${starter.name}: one group named after it`, groups.size === 1 && g.name === starter.name && g.ids.length === parts.length);
  check(`${starter.name}: unique ids`, new Set(parts.map((p) => p.instanceId)).size === parts.length && parts.every((p) => p.instanceId.startsWith(`inst-${id}-`)));
  check(`${starter.name}: rests on the Clawbot's floor`, Math.abs(lowest(parts) - floor) < 0.01, `${lowest(parts)} vs ${floor}`);
  check(`${starter.name}: no brain part`, !parts.some((p) => matchesClawbotRules(CLAWBOT_BRAIN, p.label)));
  const audit = auditAssembly({ instances: parts });
  console.log(`INFO  ${starter.name}: ${parts.length} parts, ${audit.collisions?.length ?? 0} collisions`);
  check(`${starter.name}: no overlaps`, (audit.collisions?.length ?? 0) === 0);
}
const drive = pieces.find((p) => p.id === 'simple-drivetrain').parts;
const count = (re) => drive.filter((p) => re.test(p.label)).length;
check('drivetrain: two drive motors, two omni wheels and two tires', count(/^Drive Motor [LR]$/) === 2 && count(/^Omni Wheel [LR]$/) === 2 && count(/^Rear Tire [LR]$/) === 2);
const arm = pieces.find((p) => p.id === 'simple-arm').parts;
check('arm: arm motor, both 12 and 36 tooth gears, tower uprights', arm.some((p) => p.label === 'Arm Motor') && arm.filter((p) => /^Gear (12T|36T)/.test(p.label)).length === 4 && arm.filter((p) => /^Tower Upright/.test(p.label)).length === 2);
const claw = pieces.find((p) => p.id === 'simple-claw').parts;
check('claw: wrist plate, claw motor, both tips', claw.some((p) => p.label === 'Wrist 4x4 Plate') && claw.some((p) => p.label === 'Claw Smart Motor') && claw.filter((p) => /^Claw Tip/.test(p.label)).length === 2);

// Stopping modes (openspec motor-stopping): the rope starters' motors hold; other starters' motors don't set one (brake)
for (const id of ['rope-lift', 'rope-winch']) {
  const motors = starterById(id).build(catalog).filter((p) => byId.get(p.partId)?.hubSpecs);
  check(`${id}: its motor's stopping mode is hold`, motors.length === 1 && motors[0].stopping === 'hold', JSON.stringify(motors.map((m) => m.stopping)));
}
check('clawbot: no motor sets a stopping mode (they brake)', clawbot.filter((p) => byId.get(p.partId)?.hubSpecs).every((m) => m.stopping === undefined));

console.log(failures ? `\n${failures} check(s) failed` : '\nAll starter assembly checks passed');
process.exit(failures ? 1 : 0);
