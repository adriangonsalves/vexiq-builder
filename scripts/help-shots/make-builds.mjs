/**
 * Makes the help pictures' example builds (openspec in-app-help, task 4.2) with the vexiq MCP tools,
 * on a private MCP server (mcp-session.mjs) that never touches the user's own build, audits each,
 * and writes it to scripts/help-shots/builds/<name>.vexiq.json in the app's Export format, ready
 * for File → Load… → Open from computer… (or `build: 'file:…'` in a shot).
 *
 *   node scripts/help-shots/make-builds.mjs [name…]
 *
 * Look at each in the static preview from two views after making it: a clean audit doesn't mean
 * the parts face the right way.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcp } from './mcp-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'builds');
const P = 12.7;
const FLAT = [-90, 0, 0]; // a beam lying flat, its holes upright
const UPRIGHT = [-90, 0, 0]; // a shaft or standoff standing up
const BEAM = '228-2500-023'; // 2x8 Beam
const PIN = '228-2500-060'; // 1x1 Connector Pin
const SHAFT = '228-2500-120'; // 4x Pitch Shaft
const BEAM_Y = 3.175; // a flat beam's middle, resting on the floor

/** The world point of a flat beam's hole at local (x, y): the beam turned FLAT sends local y to -z. */
const onFlatBeam = (beamPos, x, y) => [beamPos[0] + x, beamPos[1], beamPos[2] - y];

const BUILDS = {
  /** Two 2x8 beams, one with a pin in its end hole, the other beside it, not joined yet. */
  async 'two-beams-pin'(m) {
    await m.call('place_parts', {
      parts: [
        { ref: 'a', partQuery: BEAM, position: [0, BEAM_Y, 0], rotation: FLAT },
        { ref: 'pin', partQuery: PIN, insert: { into: { ref: 'a', port: 'hole.thru.14_-2_0' }, fromSide: '+' } },
        { ref: 'b', partQuery: BEAM, position: [0, BEAM_Y, 3.5 * P], rotation: FLAT }
      ]
    });
  },

  /** Two 2x8 beams joined end to end by pins, the second one layer up. */
  async 'two-beams-joined'(m) {
    const a = [0, BEAM_Y, 0];
    // B's hole at local (-44.45, 6.35) over A's hole at local (44.45, -6.35), one layer (0.5 pitch) up
    const b = [88.9, BEAM_Y + 0.5 * P, 12.7];
    const placed = await m.call('place_parts', {
      parts: [
        { ref: 'a', partQuery: BEAM, position: a, rotation: FLAT },
        { ref: 'b', partQuery: BEAM, position: b, rotation: FLAT }
      ]
    });
    const [ia, ib] = placed.parts.map((p) => p.instanceId);
    await m.call('auto_fasten_joint', { instanceIdA: ia, instanceIdB: ib, maxPins: 1 });
  },

  /** A 36 tooth and a 12 tooth gear meshed on two shafts in a beam. */
  async 'gear-pair'(m) {
    await m.call('place_parts', {
      parts: [
        { ref: 'a', partQuery: BEAM, position: [0, BEAM_Y, 0], rotation: FLAT },
        { ref: 's1', partQuery: SHAFT, position: [-19.05, 18, 6.35], rotation: UPRIGHT },
        { ref: 's2', partQuery: SHAFT, position: [6.35, 18, 6.35], rotation: UPRIGHT },
        { ref: 'g36', partQuery: '228-2500-214', insert: { into: { ref: 's1', port: 'shaft.thru.0_0_0' }, fromSide: '+' } },
        { ref: 'g12', partQuery: '228-2500-213', insert: { into: { ref: 's2', port: 'shaft.thru.0_0_0' }, fromSide: '+' } }
      ]
    });
  },

  /** Two 16 tooth sprockets on shafts at the ends of a beam, ready for the chain builder. */
  async 'two-sprockets'(m) {
    await m.call('place_parts', {
      parts: [
        { ref: 'a', partQuery: BEAM, position: [0, BEAM_Y, 0], rotation: FLAT },
        { ref: 's1', partQuery: SHAFT, position: [-44.45, 18, 6.35], rotation: UPRIGHT },
        { ref: 's2', partQuery: SHAFT, position: [31.75, 18, 6.35], rotation: UPRIGHT },
        { ref: 'k1', partQuery: '228-2500-233', insert: { into: { ref: 's1', port: 'shaft.thru.0_0_0' }, fromSide: '+' } },
        { ref: 'k2', partQuery: '228-2500-233', insert: { into: { ref: 's2', port: 'shaft.thru.0_0_0' }, fromSide: '+' } }
      ]
    });
  },

  /** A 6x6 plastic sheet pinned flat on one row to a 2x8 beam, and a 1x8 beam lower down to curve it onto. */
  async 'sheet-one-row'(m) {
    const placed = await m.call('place_parts', {
      parts: [
        { ref: 'a', partQuery: BEAM, position: [0, BEAM_Y, 0], rotation: FLAT },
        // The sheet's edge row (z = -31.75 in its own frame) over the beam's row at local y = 6.35
        { ref: 'sheet', partQuery: '228-2500-2711', position: [0, 6.35, -6.35 + 31.75], rotation: [0, 0, 0] },
        { ref: 'pin1', partQuery: PIN, insert: { into: { ref: 'sheet', port: 'hole.thru.-10_0_-10' }, fromSide: '+' } },
        { ref: 'pin2', partQuery: PIN, insert: { into: { ref: 'sheet', port: 'hole.thru.10_0_-10' }, fromSide: '+' } },
        // A 1x8 beam (holes every pitch, like the sheet's) lower down, in reach of the sheet's far row
        { ref: 'b', partQuery: '228-2500-007', position: [0, BEAM_Y - 1.5 * P, 47], rotation: FLAT }
      ]
    });
    const ids = Object.fromEntries(placed.parts.map((p) => [p.ref, p.instanceId]));
    const choices = await m.call('bend_sheet', { sheetId: ids.sheet, targetId: ids.b }, { allowError: true });
    console.log(`  bend choices onto the lower beam: ${JSON.stringify(choices?.choices?.map((c) => c.name) ?? choices)}`);
  },

  /** A rubber band round two standoffs standing in two stacked beams. */
  async 'band-standoffs'(m) {
    const placed = await m.call('place_parts', {
      parts: [
        { ref: 'a', partQuery: BEAM, position: [0, BEAM_Y + 0.5 * P, 0], rotation: FLAT },
        { ref: 'b', partQuery: BEAM, position: [0, BEAM_Y, 0], rotation: FLAT },
        { ref: 'p1', partQuery: '228-2500-065', insert: { into: { ref: 'a', port: 'hole.thru.-14_-2_0' }, fromSide: '+' } },
        { ref: 'p2', partQuery: '228-2500-065', insert: { into: { ref: 'a', port: 'hole.thru.14_-2_0' }, fromSide: '+' } }
      ]
    });
    const ids = Object.fromEntries(placed.parts.map((p) => [p.ref, p.instanceId]));
    const band = await m.call('place_band', {
      bandPartId: 'Silicone Rubber Band #32',
      spots: [
        { instanceId: ids.p1, feature: 'post:body' },
        { instanceId: ids.p2, feature: 'post:body' }
      ]
    });
    console.log(`  band: stretch ${band?.stretch?.toFixed?.(2)} (${band?.stretchState})`);
  },

  /** For the Audit page: two beams overlapping, and a pin on its own in the air. */
  async 'audit-problems'(m) {
    await m.call('place_parts', {
      keepPoses: true,
      parts: [
        { ref: 'a', partQuery: BEAM, position: [0, BEAM_Y, 0], rotation: FLAT },
        { ref: 'b', partQuery: BEAM, position: [30, BEAM_Y, 4], rotation: [-90, 0, 20] },
        { ref: 'pin', partQuery: PIN, position: [-20, 30, 45], rotation: [0, 0, 0] }
      ]
    });
  }
};

const wanted = process.argv.slice(2);
const unknown = wanted.filter((n) => !BUILDS[n]);
if (unknown.length) {
  console.error(`No build named ${unknown.join(', ')}. Builds: ${Object.keys(BUILDS).join(', ')}`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const m = await startMcp();
try {
  for (const name of wanted.length ? wanted : Object.keys(BUILDS)) {
    console.log(`${name}`);
    await m.call('clear_assembly', {});
    await BUILDS[name](m);
    const audit = await m.call('audit_assembly', {});
    const summary = audit?.summary ?? audit;
    console.log(`  audit: ${JSON.stringify(summary).slice(0, 600)}`);
    const { instances } = m.state();
    // The file opens as a new build. Overlap flags are cleared, as an export would have them, so the
    // audit build keeps its overlap (Export itself leaves overlapping parts out)
    const parts = instances.map((i) => ({
      ...i,
      // auto_fasten_joint names its pins after the joint; the app would call it "<part> #n"
      label: i.label.startsWith('Auto ') ? `${i.label.slice(5).replace(/ \(.*\)$/, '')} #1` : i.label,
      isIntersecting: false,
      lastValidPosition: [...i.position],
      lastValidRotation: [...i.rotation]
    }));
    const payload = { version: '1.1', pitchUnitMm: P, exportedAt: '2026-01-01T00:00:00.000Z', instances: parts };
    fs.writeFileSync(path.join(OUT, `${name}.vexiq.json`), `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`  wrote builds/${name}.vexiq.json (${parts.length} parts: ${parts.map((p) => p.label).join(', ')})`);
  }
} finally {
  m.stop();
}
