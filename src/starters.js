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
// [part number, label, position, rotation, motor hub turn]. The library's brain and battery are the
// 1st gen ones (the closest there are). Built with the MCP tools: no overlaps, every part held.
const SPEEDBOT = [
  ['228-2540', 'Robot Brain', [0, 69.9, 0], [0, 0, 0]],
  ['228-2500-065', 'Standoff L 1', [-44.45, 63.55, -38.1], [0, 0, 0]],
  ['228-2500-065', 'Standoff L 2', [-31.75, 63.55, -38.1], [0, 0, 0]],
  ['228-2500-271', 'Corner Connector L', [44.45, 63.55, -38.1], [180, 0, 0]],
  ['228-2500-043', 'Side Plate L', [0, 44.5, -53.85], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin L 1', [-31.75, 38.15, -50.8], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin L 2', [-44.45, 38.15, -50.8], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin L 3', [-31.75, 25.45, -50.8], [-180, 0, 0]],
  ['228-2500-060', 'Motor Pin L 4', [-44.45, 25.45, -50.8], [-180, 0, 0]],
  ['228-2560', 'Drive Motor L', [-28.57, 31.8, -50.67], [-90, 0, 0], -14.1],
  ['228-2500-2234', 'Rear Axle L', [38.1, 31.8, -54.4], [0, 0, 0]],
  ['228-2500-060', 'Connector Pin L 1', [31.75, 38.15, -57.15], [0, 0, 0]],
  ['228-2500-060', 'Connector Pin L 2', [44.45, 25.45, -57.15], [0, 0, 0]],
  ['228-2500-136', 'Offset Connector L', [57.15, 25.45, -57.15], [90, 90, 0]],
  ['228-2500-208', 'Rear Hub L', [38.1, 31.8, -66.6], [0, 180, 0]],
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
  ['228-2500-2234', 'Rear Axle R', [38.1, 31.8, 54.4], [180, 0, 0]],
  ['228-2500-060', 'Connector Pin R 1', [31.75, 38.15, 57.15], [0, 0, 0]],
  ['228-2500-060', 'Connector Pin R 2', [44.45, 25.45, 57.15], [0, 0, 0]],
  ['228-2500-136', 'Offset Connector R', [57.15, 38.15, 57.15], [-90, 90, 0]],
  ['228-2500-208', 'Rear Hub R', [38.1, 31.8, 66.6], [180, 180, 0]],
  ['228-2500-209', 'Rear Tire R', [38.1, 31.8, 73.01], [0, 0, 0]],
  ['228-2500-025', 'Rear Crossbeam', [60.2, 31.8, 0], [0, 90, 0]],
  ['228-2500-143', 'Rear Collar R', [34.009, 39.895, 66.675], [90, 0, 0]],
  ['228-2500-2236', 'Drive Shaft L', [-38.1, 31.8, -47.6], [0, 0, 0]],
  ['228-2500-2236', 'Drive Shaft R', [-38.1, 31.8, 47.6], [0, 180, 0]],
  ['228-2500-114', 'Spacer L', [-38.1, 31.8, -57.383], [0, 0, 0]],
  ['228-2536', 'Omni Wheel L', [-38.1, 31.8, -71.804], [90, 0, 0]],
  ['228-2500-143', 'Omni Collar L', [-42.191, 23.705, -61.465], [-90, 0, 0]],
  ['228-2500-114', 'Spacer R', [-38.1, 31.8, 57.383], [-180, 0, 0]],
  ['228-2536', 'Omni Wheel R', [-38.1, 31.8, 71.804], [-90, 0, 0]],
  ['228-2500-143', 'Omni Collar R', [-42.191, 39.895, 61.465], [90, 0, 0]],
  ['228-2604', 'Robot Battery', [-0.75, 68.75, 0], [0, -90, 0]]
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

// The VEX IQ 2nd gen BaseBot (iq-2nd-gen-basebot-rev12.pdf), without its two Smart Cables:
// [part number, label, position, rotation, motor hub turn]. Two C-channel sides of 2x12 beams on
// Triple corner connectors, motor-driven tires at the back and free omni wheels at the front. The
// tires sit on Small Wheel Hubs (the library's tire is the rubber only); the brain is the 1st gen
// brain with battery (the closest there is). Built with the MCP tools: no overlaps.
const BASEBOT = [
  ['228-2500-026', 'Bottom Beam R', [0, 3.175, 38.1], [-90, 0, 0]],
  ['228-2500-1253', 'Front Block Inner R', [-57.15, 6.35, 31.75], [90, 0, -180]],
  ['228-2500-1253', 'Front Block Outer R', [-57.15, 6.35, 44.45], [90, 0, -180]],
  ['228-2500-1253', 'Middle Block R', [-19.05, 6.35, 31.75], [90, 0, 90]],
  ['228-2500-1253', 'Rear Block R', [69.85, 6.35, 31.75], [90, 0, 90]],
  ['228-2500-026', 'Side Beam R', [0, 19.05, 53.85], [0, 0, 0]],
  ['228-2500-026', 'Top Beam R', [0, 34.925, 38.1], [-90, 0, 0]],
  ['228-2500-060', 'Side Pin R 1', [-57.15, 12.7, 50.8], [0, 0, 0]],
  ['228-2500-060', 'Side Pin R 2', [-69.85, 25.4, 50.8], [0, 0, 0]],
  ['228-2500-017', 'Front Bearing R', [-63.5, 19.05, 59.95], [0, 0, 0]],
  ['228-2500-017', 'Rear Bearing R', [38.1, 19.05, 59.95], [0, 0, 0]],
  ['228-2500-086', 'Bearing Pin R 1', [-57.15, 25.4, 57.15], [-180, 0, 0]],
  ['228-2500-086', 'Bearing Pin R 2', [-69.85, 12.7, 57.15], [-180, 0, 0]],
  ['228-2500-086', 'Bearing Pin R 3', [44.45, 25.4, 57.15], [-180, 0, 0]],
  ['228-2500-086', 'Bearing Pin R 4', [31.75, 12.7, 57.15], [-180, 0, 0]],
  ['228-2560', 'Drive Motor R', [28.575, 19.05, 50.67], [-90, 0, -180], -14.1],
  ['228-2500-060', 'Motor Pin R 1', [19.05, 12.7, 50.8], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin R 2', [19.05, 25.4, 50.8], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin R 3', [6.35, 12.7, 50.8], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin R 4', [6.35, 25.4, 50.8], [0, 0, 0]],
  ['228-2500-2225', 'Front Axle R', [-63.5, 19.05, 26.35], [0, 180, 0]],
  ['228-2500-112', 'Rear Washer R', [38.1, 19.05, 63.4], [0, 0, 0]],
  ['228-2500-208', 'Rear Hub R', [38.1, 19.05, 66.98], [0, 0, 0]],
  ['228-2500-209', 'Rear Tire R', [38.1, 19.05, 73.39], [0, 0, 0]],
  ['228-2500-1925', 'Rear Lock Beam R', [38.1, 19.05, 79.2], [90, 0, 0]],
  ['228-2500-060', 'Rear Hub Pin R 1', [31.75, 25.4, 70.114], [0, 0, 0]],
  ['228-2500-060', 'Rear Hub Pin R 2', [44.45, 25.4, 70.114], [0, 0, 0]],
  ['228-2500-060', 'Rear Hub Pin R 3', [31.75, 12.7, 70.114], [0, 0, 0]],
  ['228-2500-060', 'Rear Hub Pin R 4', [44.45, 12.7, 70.114], [0, 0, 0]],
  ['228-2500-143', 'Rear Collar R', [34.01, 27.15, 79.35], [90, 0, 0]],
  ['228-2500-112', 'Front Washer R', [-63.5, 19.05, 63.4], [0, 0, 0]],
  ['228-2536', 'Omni Wheel R', [-63.5, 19.05, 77.15], [-90, 0, 0]],
  ['228-2500-086', 'Rear Crossbeam Pin 1', [76.45, 25.4, 31.75], [0, -90, 0]],
  ['228-2500-086', 'Rear Crossbeam Pin 2', [76.45, 12.7, 44.45], [0, -90, 0]],
  ['228-2500-136', 'Brain Connector Front R', [-44.45, 38.1, 44.45], [90, 0, 0]],
  ['228-2500-136', 'Brain Connector Rear R', [31.75, 38.1, 44.45], [90, 0, 0]],
  ['228-2500-060', 'Brain Pin R 1', [-44.45, 63.5, 38.2], [0, 0, 0]],
  ['228-2500-060', 'Brain Pin R 2', [-31.75, 63.5, 38.2], [0, 0, 0]],
  ['228-2500-060', 'Brain Pin R 3', [31.75, 63.5, 38.2], [0, 0, 0]],
  ['228-2500-060', 'Brain Pin R 4', [44.45, 63.5, 38.2], [0, 0, 0]],
  ['228-2500-2236', 'Drive Shaft R', [38.1, 19.05, 47.6], [180, 0, 0]],
  ['228-2500-1925', 'Front Lock Beam R', [-63.5, 19.05, 79.39], [90, 0, 0]],
  ['228-2500-060', 'Omni Pin R 1', [-69.85, 25.4, 70.3], [0, 0, 0]],
  ['228-2500-060', 'Omni Pin R 2', [-57.15, 25.4, 70.3], [0, 0, 0]],
  ['228-2500-060', 'Omni Pin R 3', [-69.85, 12.7, 70.3], [0, 0, 0]],
  ['228-2500-060', 'Omni Pin R 4', [-57.15, 12.7, 70.3], [0, 0, 0]],
  ['228-2500-143', 'Front Collar R', [-67.59, 27.15, 79.52], [90, 0, 0]],
  ['228-2500-023', 'Front Crossbeam', [-79.3, 19.05, 0], [0, 90, 0]],
  ['228-2500-023', 'Rear Crossbeam', [79.25, 19.05, 0], [0, 90, 0]],
  ['228-2540 + 228-2604', 'Robot Brain', [0, 69.7, 0], [0, 0, 0]],
  ['228-2500-026', 'Bottom Beam L', [0, 3.175, -38.1], [-90, 0, 0]],
  ['228-2500-1253', 'Front Block Inner L', [-57.15, 6.35, -31.75], [90, 0, -180]],
  ['228-2500-1253', 'Front Block Outer L', [-57.15, 31.75, -44.45], [-90, 0, -180]],
  ['228-2500-1253', 'Middle Block L', [-19.05, 31.75, -31.75], [-90, 0, 90]],
  ['228-2500-1253', 'Rear Block L', [69.85, 31.75, -31.75], [-90, 0, 90]],
  ['228-2500-026', 'Side Beam L', [0, 19.05, -53.85], [0, 0, 0]],
  ['228-2500-026', 'Top Beam L', [0, 34.925, -38.1], [-90, 0, 0]],
  ['228-2500-060', 'Side Pin L 1', [-57.15, 12.7, -50.8], [0, 0, 0]],
  ['228-2500-060', 'Side Pin L 2', [-69.85, 25.4, -50.8], [0, 0, 0]],
  ['228-2500-017', 'Front Bearing L', [-63.5, 19.05, -59.95], [0, 0, 0]],
  ['228-2500-017', 'Rear Bearing L', [38.1, 19.05, -59.95], [0, 0, 0]],
  ['228-2500-086', 'Bearing Pin L 1', [-57.15, 25.4, -57.15], [0, 0, 0]],
  ['228-2500-086', 'Bearing Pin L 2', [-69.85, 12.7, -57.15], [0, 0, 0]],
  ['228-2500-086', 'Bearing Pin L 3', [44.45, 25.4, -57.15], [0, 0, 0]],
  ['228-2500-086', 'Bearing Pin L 4', [31.75, 12.7, -57.15], [0, 0, 0]],
  ['228-2560', 'Drive Motor L', [28.575, 19.05, -50.67], [90, 0, -180], -14.1],
  ['228-2500-060', 'Motor Pin L 1', [19.05, 12.7, -50.8], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin L 2', [19.05, 25.4, -50.8], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin L 3', [6.35, 12.7, -50.8], [0, 0, 0]],
  ['228-2500-060', 'Motor Pin L 4', [6.35, 25.4, -50.8], [0, 0, 0]],
  ['228-2500-2225', 'Front Axle L', [-63.5, 19.05, -26.35], [180, 180, 0]],
  ['228-2500-2236', 'Drive Shaft L', [38.1, 19.05, -47.6], [-180, 180, 0]],
  ['228-2500-112', 'Rear Washer L', [38.1, 19.05, -63.4], [0, 0, 0]],
  ['228-2500-208', 'Rear Hub L', [38.1, 19.05, -66.98], [180, 0, 0]],
  ['228-2500-209', 'Rear Tire L', [38.1, 19.05, -73.39], [0, 0, 0]],
  ['228-2500-1925', 'Rear Lock Beam L', [38.1, 19.05, -79.2], [-90, 0, 0]],
  ['228-2500-060', 'Rear Hub Pin L 1', [31.75, 25.4, -70.114], [0, 0, 0]],
  ['228-2500-060', 'Rear Hub Pin L 2', [44.45, 25.4, -70.114], [0, 0, 0]],
  ['228-2500-060', 'Rear Hub Pin L 3', [31.75, 12.7, -70.114], [0, 0, 0]],
  ['228-2500-060', 'Rear Hub Pin L 4', [44.45, 12.7, -70.114], [0, 0, 0]],
  ['228-2500-143', 'Rear Collar L', [34.01, 10.95, -79.31], [-90, 0, 0]],
  ['228-2500-112', 'Front Washer L', [-63.5, 19.05, -63.4], [0, 0, 0]],
  ['228-2536', 'Omni Wheel L', [-63.5, 19.05, -77.15], [90, 0, 0]],
  ['228-2500-086', 'Rear Crossbeam Pin 3', [76.45, 25.4, -31.75], [0, -90, 0]],
  ['228-2500-086', 'Rear Crossbeam Pin 4', [76.45, 12.7, -44.45], [0, -90, 0]],
  ['228-2500-136', 'Brain Connector Front L', [-31.75, 38.1, -44.45], [90, 0, -180]],
  ['228-2500-136', 'Brain Connector Rear L', [44.45, 38.1, -44.45], [90, 0, -180]],
  ['228-2500-060', 'Brain Pin L 1', [-44.45, 63.5, -38.2], [0, 0, 0]],
  ['228-2500-060', 'Brain Pin L 2', [-31.75, 63.5, -38.2], [0, 0, 0]],
  ['228-2500-060', 'Brain Pin L 3', [31.75, 63.5, -38.2], [0, 0, 0]],
  ['228-2500-060', 'Brain Pin L 4', [44.45, 63.5, -38.2], [0, 0, 0]],
  ['228-2500-1925', 'Front Lock Beam L', [-63.5, 19.05, -79.39], [-90, 0, 0]],
  ['228-2500-060', 'Omni Pin L 1', [-69.85, 25.4, -70.3], [180, 0, 0]],
  ['228-2500-060', 'Omni Pin L 2', [-57.15, 25.4, -70.3], [180, 0, 0]],
  ['228-2500-060', 'Omni Pin L 3', [-69.85, 12.7, -70.3], [180, 0, 0]],
  ['228-2500-060', 'Omni Pin L 4', [-57.15, 12.7, -70.3], [180, 0, 0]],
  ['228-2500-143', 'Front Collar L', [-67.59, 10.95, -79.52], [-90, 0, 0]]
];

/** The BaseBot: brain raised on offset corner connectors over two beam channels, rear-wheel drive. */
function basebotStarter(catalog) {
  const byNumber = new Map(catalog.map((p) => [p.partNumber, p]));
  return BASEBOT.flatMap(([number, label, position, rotation, socketAngleDeg], i) => {
    const p = byNumber.get(number);
    if (!p) return [];
    const inst = { ...part(p, `inst-basebot-${i + 1}`, position, rotation), label };
    return socketAngleDeg ? [{ ...inst, socketAngleDeg }] : [inst];
  });
}

export const STARTERS = [
  { id: 'sample', name: 'Sample starter', build: sampleStarter },
  { id: 'speedbot', name: 'Speedbot 2.0', build: speedbotStarter },
  { id: 'basebot', name: 'BaseBot', build: basebotStarter }
];

export const starterById = (id) => STARTERS.find((s) => s.id === id) || STARTERS[0];
