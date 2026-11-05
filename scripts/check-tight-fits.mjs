/**
 * Node check for tight fits (openspec cad-import-readiness, tight-fits): contacts that only reach
 * TIGHT_FIT_MM past the collision mesh's clearance are tight fits, not overlaps.
 * Run: node scripts/check-tight-fits.mjs   (exits 1 on any failure)
 */
import { checkCandidateCollision, findPart } from '../mcp/assembly-engine.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const inst = (instanceId, query, position, rotation, label = instanceId) => ({
  instanceId,
  partId: findPart(query).id,
  label,
  position,
  rotation,
  visible: true
});
const labels = (list) => list.map((c) => c.label).join(', ') || 'none';

// Herobot Flop's tower pivot: in VEX's CAD the 0.5x Pitch Standoff sits 0.53 mm off the 1x18 Beam's hole
const beam = inst('beam', '228-2500-015', [-125.074, 57.616, -41.275], [0, 0, -20.863], '1x18 Beam');
const standoff = inst('standoff', '228-2500-064', [-225.425, 96.15, -31.755], [0, 0, -169.284], '0.5x Pitch Standoff');
const pivot = checkCandidateCollision(standoff, [beam, standoff]);
check('standoff 0.53 mm off the beam hole is not an overlap', !pivot.isIntersecting, labels(pivot.collidingWith));
check('  it is a tight fit with the beam', pivot.tightFits.length === 1 && pivot.tightFits[0].label === '1x18 Beam', labels(pivot.tightFits));
const back = checkCandidateCollision(beam, [beam, standoff]);
check('  and the same from the beam', !back.isIntersecting && back.tightFits.length === 1, labels(back.tightFits));

const lower = inst('lower', '228-2500-026', [0, 0, 0], [0, 0, 0], 'Lower 2x12 Beam');
const upper = inst('upper', '228-2500-026', [0, 0, 0], [0, 0, 0], 'Upper 2x12 Beam');
const stack = checkCandidateCollision(upper, [lower, upper]);
check('2x12 Beam exactly on another is an overlap', stack.isIntersecting && stack.collidingWith[0]?.label === 'Lower 2x12 Beam', labels(stack.collidingWith));
check('  not a tight fit', stack.tightFits.length === 0, labels(stack.tightFits));

const apart = checkCandidateCollision({ ...upper, position: [0, 30, 0] }, [lower, upper]);
check('beams apart: no overlap, no tight fit', !apart.isIntersecting && apart.tightFits.length === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nAll tight-fit checks passed');
process.exit(failures ? 1 : 0);
