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

// The VEX IQ 2nd gen Speed Build 2.0 (iq-2nd-gen-speedbot-v5.pdf), without its two Smart Cables:
// [part number, label, position, rotation, motor hub turn]. The brain's model includes the battery,
// so the battery isn't a separate part. Built with the MCP tools: no overlaps, every part held.
const SPEEDBOT = [
  ['228-2540', 'Robot Brain', [0, 69.9, 0], [0, 0, 0]],
  ['228-2500-065', 'Standoff L 1', [-44.45, 63.55, -38.1], [0, 0, 0]],
  ['228-2500-065', 'Standoff L 2', [-31.75, 63.55, -38.1], [0, 0, 0]],
  ['228-2500-271', 'Corner Connector L', [44.45, 63.55, -50.8], [0, 0, 0]],
  ['228-2500-043', 'Side Plate L', [0, 44.5, -53.85], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin L 1', [-31.75, 38.15, -50.8], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin L 2', [-44.45, 38.15, -50.8], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin L 3', [-31.75, 25.45, -50.8], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin L 4', [-44.45, 25.45, -50.8], [-180, 0, 0]],
  ['228-2560', 'Drive Motor L', [-28.57, 31.8, -50.67], [-90, 0, 0], -14.1],
  ['228-2500-2236', 'Drive Shaft L', [-38.1, 31.8, -85.725], [-180, 0, 0]],
  ['228-2500-114', 'Spacer L', [-38.1, 31.8, -58.5], [0, 0, 0]],
  ['228-2536', 'Omni Wheel L', [-38.1, 31.8, -73.45], [90, 0, 0]],
  ['228-2500-2234', 'Rear Axle L', [38.1, 31.8, -54.4], [0, 0, 0]],
  ['228-2500-060', 'Connector Pin L 1', [31.75, 38.15, -57.15], [0, 0, 0]],
  ['228-2500-060', 'Connector Pin L 2', [44.45, 25.45, -57.15], [0, 0, 0]],
  ['228-2500-136', 'Offset Connector L', [57.15, 25.45, -57.15], [90, 90, 0]],
  ['228-2500-208', 'Rear Hub L', [38.1, 31.8, -66.6], [0, 180, 0]],
  ['228-2500-143', 'Omni Collar L', [-42.191, 39.895, -90.76], [90, 0, 0]],
  ['228-2500-143', 'Rear Collar L', [34.009, 23.705, -66.675], [-90, 0, 0]],
  ['228-2500-209', 'Rear Tire L', [38.1, 31.8, -73.01], [0, 0, 0]],
  ['228-2500-065', 'Standoff R 1', [-44.45, 63.55, 38.1], [180, 0, 0]],
  ['228-2500-065', 'Standoff R 2', [-31.75, 63.55, 38.1], [180, 0, 0]],
  ['228-2500-271', 'Corner Connector R', [44.45, 63.55, 50.8], [180, 0, 0]],
  ['228-2500-043', 'Side Plate R', [0, 44.5, 53.85], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin R 1', [-31.75, 38.15, 50.8], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin R 2', [-44.45, 38.15, 50.8], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin R 3', [-31.75, 25.45, 50.8], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin R 4', [-44.45, 25.45, 50.8], [-180, 0, 0]],
  ['228-2560', 'Drive Motor R', [-28.57, 31.8, 50.67], [90, 0, 0], -14.1],
  ['228-2500-2236', 'Drive Shaft R', [-38.1, 31.8, 85.725], [180, 180, 0]],
  ['228-2500-114', 'Spacer R', [-38.1, 31.8, 58.5], [0, 0, 0]],
  ['228-2536', 'Omni Wheel R', [-38.1, 31.8, 73.45], [270, 0, 0]],
  ['228-2500-2234', 'Rear Axle R', [38.1, 31.8, 54.4], [180, 0, 0]],
  ['228-2500-060', 'Connector Pin R 1', [31.75, 38.15, 57.15], [0, 0, 0]],
  ['228-2500-060', 'Connector Pin R 2', [44.45, 25.45, 57.15], [0, 0, 0]],
  ['228-2500-136', 'Offset Connector R', [57.15, 38.15, 57.15], [-90, 90, 0]],
  ['228-2500-208', 'Rear Hub R', [38.1, 31.8, 66.6], [180, 180, 0]],
  ['228-2500-209', 'Rear Tire R', [38.1, 31.8, 73.01], [0, 0, 0]],
  ['228-2500-025', 'Rear Crossbeam', [60.2, 31.8, 0], [0, 90, 0]],
  ['228-2500-143', 'Omni Collar R', [-42.191, 23.705, 90.76], [-90, 0, 0]],
  ['228-2500-143', 'Rear Collar R', [34.009, 39.895, 66.675], [90, 0, 0]]
];

/** The Speed Build 2.0: brain on two side plates, motor-driven omni wheels, free tires at the back. */
function speedbotStarter(catalog) {
  const byNumber = new Map(catalog.map((p) => [p.partNumber, p]));
  return SPEEDBOT.flatMap(([number, label, position, rotation, socketAngleDeg], i) => {
    const p = byNumber.get(number);
    if (!p) return [];
    const inst = { ...part(p, `inst-speedbot-${i + 1}`, position, rotation), label };
    return socketAngleDeg ? [{ ...inst, socketAngleDeg }] : [inst];
  });
}

export const STARTERS = [
  { id: 'sample', name: 'Sample starter', build: sampleStarter },
  { id: 'speedbot', name: 'Speedbot 2.0', build: speedbotStarter }
];

export const starterById = (id) => STARTERS.find((s) => s.id === id) || STARTERS[0];
