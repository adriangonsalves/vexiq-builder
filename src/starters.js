/**
 * Starter builds for File → Starter (openspec build-library). Each starter is a name and a function
 * that lays out its parts from the catalog; add drivetrains, claws and the like here.
 */

const part = (p, instanceId, position, rotation = [0, 0, 0], color = p.defaultColor) => ({
  instanceId,
  partId: p.id,
  label: `${p.name} #1`,
  position,
  rotation,
  lastValidPosition: [...position],
  lastValidRotation: [...rotation],
  isIntersecting: false,
  color,
  visible: true,
  locked: false
});

/** A beam with a pin, an axle and a 36 tooth gear. */
function sampleStarter(catalog) {
  const byNumber = (num) => catalog.find((p) => p.partNumber === num);
  const beam = byNumber('228-2500-025') || catalog.find((p) => p.name.includes('2x8 Beam')) || catalog[0];
  const pin = byNumber('228-2500-086') || catalog.find((p) => p.name.includes('0x2 Connector Pin'));
  const shaft = byNumber('228-2500-258') || catalog.find((p) => p.name.includes('4x Pitch Shaft'));
  const gear = byNumber('228-2500-215') || catalog.find((p) => p.name.includes('36 Tooth Gear'));
  const parts = [];
  if (beam) parts.push(part(beam, 'inst-starter-beam', [0, 12.7, 0]));
  if (pin) parts.push(part(pin, 'inst-starter-pin', [6.35, 6.35, 3.175], [0, 180, 0]));
  if (shaft) parts.push(part(shaft, 'inst-starter-shaft', [-19.05, 6.35, 0]));
  if (gear) parts.push(part(gear, 'inst-starter-gear', [-19.05, 6.35, 12.7], [0, 0, 0], '#dc2626'));
  return parts;
}

export const STARTERS = [{ id: 'sample', name: 'Sample starter', build: sampleStarter }];

export const starterById = (id) => STARTERS.find((s) => s.id === id) || STARTERS[0];
