/**
 * Node check for connection points (openspec cad-import-readiness, connection-points): face holes,
 * shaft points, attachment pegs, the Mini Standoff Connector's bore, stable ids with aliases, and
 * the tools that take port ids.
 * Run: node scripts/check-connection-points.mjs   (exits 1 on any failure)
 */
import * as THREE from 'three';
import {
  auditAssembly,
  buildChain,
  buildWorldMatrix,
  computeMateTransform,
  describePartConnections,
  findPart,
  findPort,
  getCatalog,
  placeParts
} from '../mcp/assembly-engine.mjs';

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const part = (name) => {
  const p = findPart(name);
  if (!p || p.name !== name) throw new Error(`Catalog part not found: ${name}`);
  return p;
};
const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
const show = (ports) => JSON.stringify(ports.map((p) => [p.portId, p.origin, p.faces]));

// --- Every face's holes ------------------------------------------------------------------------
{
  const bumper = part('VEX IQ Bumper Switch');
  const top = bumper.ports.filter((p) => p.type === 'pin_hole' && p.faces?.join() === '+y' && near(p.origin[1], bumper.bbox.max[1]));
  const corners = [[-6.35, -6.35], [-6.35, 6.35], [6.35, -6.35], [6.35, 6.35]];
  check(
    'Bumper Switch: four holes on its top face at ±6.35, ±6.35, opening upward',
    corners.every(([x, z]) => top.some((p) => near(p.origin[0], x) && near(p.origin[2], z))),
    show(top)
  );
  const base = bumper.ports.filter((p) => p.type === 'pin_hole' && p.faces?.join() === '-y');
  check('  and the holes on its base listed before', base.length === 4 && ['hole_1', 'hole_2', 'hole_3', 'hole_6'].every((id) => base.includes(findPort(bumper, id))), show(base));
}

// --- Mini Standoff Connector: a pin goes into its bore -------------------------------------------
{
  const msc = part('Mini Standoff Connector');
  const bore = findPort(msc, 'bore_1');
  check('Mini Standoff Connector bore is a pin hole (old id bore_1 kept)', bore?.type === 'pin_hole' && bore.kind === 'hole', JSON.stringify(bore));
  const pinPart = part('1x1 Connector Pin');
  const mate = computeMateTransform(pinPart, null, { instanceId: 'msc', partId: msc.id, label: 'MSC', position: [0, 0, 0], rotation: [0, 0, 0] }, bore.portId, {});
  const audit = auditAssembly({
    instances: [
      { instanceId: 'msc', partId: msc.id, label: 'MSC', position: [0, 0, 0], rotation: [0, 0, 0] },
      { instanceId: 'pin', partId: pinPart.id, label: 'Pin', position: mate.position, rotation: mate.rotation }
    ]
  });
  const joint = audit.joints.find((j) => j.instanceId === 'pin');
  check('  a 1x1 Connector Pin pushed into it counts as seated in it', joint?.seatedIn.some((s) => s.instanceId === 'msc' && s.ports.includes(bore.portId)), JSON.stringify(joint));
}

// --- Standoff Extender: a standoff goes into its end, and the two join the parts at both ends ----------
{
  const ext = part('0.5x Pitch Standoff Extender');
  const hole = ext.ports.find((p) => p.type === 'pin_hole');
  const peg = ext.ports.find((p) => p.type === 'pin_peg');
  check('Standoff Extender has a pin hole in its body end, and its peg stops where the hole begins', hole?.faces?.join() === '-z' && peg && peg.spanMm[0] >= hole.spanMm[1] - 0.01, JSON.stringify(ext.ports));
  // Herobot Flop's intake: an 8x Pitch Standoff into an extender whose pin sits in a 2x2 plate hole
  const r = placeParts({ instances: [] }, [
    { ref: 'upper', partQuery: '1x6 Beam', label: 'Upper Beam', position: [0, 0, 0] },
    { ref: 'ext', partQuery: ext.name, label: 'Extender', insert: { sourcePort: peg.portId, into: { ref: 'upper', port: 'hole_2' }, fromSide: '-' } }
  ]);
  const extInst = r.instances?.find((i) => i.label === 'Extender');
  const so = part('1x Pitch Standoff');
  const m = buildWorldMatrix(extInst.position, extInst.rotation);
  const holeFace = new THREE.Vector3(...hole.origin).applyMatrix4(m);
  const down = new THREE.Vector3(0, 0, 1).transformDirection(m);
  // The standoff's top pin in the extender's hole, its body hanging below; a lower beam on its bottom pin
  const top = so.ports.find((p) => p.type === 'pin_peg').spanMm[1];
  const soPos = holeFace.clone().addScaledVector(down, -(top - 5.25 - 0.01)).toArray();
  const soInst = { instanceId: 'so', partId: so.id, label: 'Standoff', position: soPos, rotation: extInst.rotation };
  const lower = { instanceId: 'lower', partId: part('1x6 Beam').id, label: 'Lower Beam', position: [0, 0, Number((soPos[2] - (so.bbox.min[2] + 3.6) * -down.z).toFixed(3))], rotation: [0, 0, 0] };
  const audit = auditAssembly({ instances: [...r.instances, soInst, lower] });
  const joint = audit.joints.find((j) => j.label === 'Standoff');
  check(
    '  a standoff in the extender is seated in it, and the stack joins both beams (not half-seated)',
    joint?.seatedIn.some((s) => s.part === 'Extender' && s.fastener) && !audit.halfSeatedFasteners.some((f) => ['Standoff', 'Extender'].includes(f.label)) && audit.disconnectedIslandCount === 0,
    JSON.stringify({ joints: audit.joints, half: audit.halfSeatedFasteners.map((f) => f.label), islands: audit.disconnectedIslands })
  );
}

// --- Shafts have an axis -------------------------------------------------------------------------
{
  const motorShaft = part('4x Pitch Motor Shaft');
  const shafts = motorShaft.ports.filter((p) => p.type === 'shaft');
  const s = shafts[0];
  check(
    '4x Pitch Motor Shaft: one shaft point along its length with both ends, square',
    shafts.length === 1 && s.shape === 'square' && near(s.ends[0][2], motorShaft.bbox.min[2]) && near(s.ends[1][2], motorShaft.bbox.max[2]),
    JSON.stringify(s)
  );
  // The short end is the one nearer the ring
  const shortEnd = motorShaft.bbox.max[2] - s.stop?.spanMm[1] < s.stop?.spanMm[0] - motorShaft.bbox.min[2] ? '+z' : '-z';
  check('  stop ring marked at its short end', s.stop?.kind === 'stop_ring' && s.stop.end === shortEnd, JSON.stringify(s.stop));
  const capped = part('4x Pitch Capped Shaft').ports.find((p) => p.type === 'shaft');
  check('4x Pitch Capped Shaft: its cap at the +Z end (its origin side)', capped?.stop?.kind === 'cap' && capped.stop.end === '+z', JSON.stringify(capped?.stop));
  const plain = part('4x Pitch Shaft').ports.find((p) => p.type === 'shaft');
  check('4x Pitch Shaft: a shaft point with no cap or ring', plain && !plain.stop);
  const { catalog } = getCatalog();
  const shaftParts = catalog.filter((p) => ['straight_shaft', 'capped_shaft', 'motor_shaft'].includes(p.fastenerSpecs?.fastenerType) && !/collar|bushing/i.test(p.name));
  const missing = shaftParts.filter((p) => !p.ports.some((q) => q.type === 'shaft')).map((p) => p.name);
  check(`every shaft (${shaftParts.length}) has a shaft point`, missing.length === 0, missing.join(', '));
}

// --- Attachments have pegs that line up with a tread link's holes ----------------------------------
{
  const flap = part('Long Intake Flap');
  const pegs = flap.ports.filter((p) => p.type === 'pin_peg');
  check('Long Intake Flap has two pegs', pegs.length === 2, show(pegs));
  const sprocket = (n, position) => ({ instanceId: `s${n}`, partId: part('24 Tooth Sprocket').id, label: `S${n}`, position, rotation: [0, 0, 0], visible: true });
  const pair = [sprocket(1, [0, 0, 0]), sprocket(2, [120, 0, 0])];
  const built = buildChain({ instances: pair }, { kind: 'track', instanceIds: ['s1', 's2'], attachment: 'long-flap' });
  const mine = new Set(built.newIds || []);
  const placed = (built.instances || []).filter((i) => mine.has(i.instanceId));
  const link = part('Tank Tread, Attachment Link');
  const links = placed.filter((i) => i.partId === link.id);
  const flaps = placed.filter((i) => i.partId === flap.id);
  const worldOf = (inst, point) => new THREE.Vector3(...point).applyMatrix4(buildWorldMatrix(inst.position, inst.rotation));
  const linkHoles = links.flatMap((l) => link.chainSpecs.gripperHoles.map((h) => worldOf(l, h)));
  // A peg's face end (where it meets the hole's face) sits on a hole of a link
  const pegFaces = flaps.flatMap((f) => pegs.map((p) => worldOf(f, p.origin.map((v, i) => v + ((p.spanMm[1] - p.spanMm[0]) / 2) * p.axis[i]))));
  const off = pegFaces.map((pt) => Math.min(...linkHoles.map((h) => h.distanceTo(pt))));
  check(
    `  in a track built round two 24T sprockets (${flaps.length} flaps), every peg lines up with a link's attachment hole`,
    flaps.length > 0 && Math.max(...off) < 0.01,
    `worst ${Math.max(...off).toFixed(3)} mm`
  );
  const treadHoles = link.ports.filter((p) => p.type === 'pin_hole' && p.faces?.join() === '+y');
  check('Tank Tread Attachment Link lists its two attachment holes', treadHoles.length === 2, show(treadHoles));
}

// --- Stable ids with aliases -----------------------------------------------------------------------
{
  const { catalog } = getCatalog();
  const QUARTER = 12.7 / 4;
  const q = (v) => Math.round(v / QUARTER) || 0;
  let dup = [];
  let wrong = [];
  for (const p of catalog) {
    const seen = new Set();
    for (const port of p.ports) {
      for (const id of [port.portId, ...(port.aliases || [])]) {
        if (seen.has(id)) dup.push(`${p.name} ${id}`);
        seen.add(id);
      }
      const face = port.faces.length > 1 ? 'thru' : port.faces[0];
      const expected = `${port.kind}.${face}.${port.origin.map(q).join('_')}`;
      if (port.portId.split('#')[0] !== expected) wrong.push(`${p.name} ${port.portId} (from where it is: ${expected})`);
    }
  }
  check('every id and alias is unique within its part', dup.length === 0, dup.slice(0, 5).join('; '));
  check('every id is made from the point\'s kind, face and quarter-pitch position', wrong.length === 0, wrong.slice(0, 5).join('; '));

  const beam = part('2x20 Beam');
  const h14 = findPort(beam, 'hole_14');
  check('2x20 Beam hole_14 is listed by its stable id, with hole_14 as an alias', h14 && h14.portId.startsWith('hole.') && h14.aliases?.includes('hole_14'), JSON.stringify(h14));
  check('  every 2x20 Beam hole keeps its old hole_N id', beam.ports.every((p) => p.aliases?.some((a) => /^hole_\d+$/.test(a))));
  const details = describePartConnections(beam).find((c) => c.port === h14.portId);
  check('get_part_details lists it by stable id with its alias, shape and faces', details?.aliases?.includes('hole_14') && details.shape === 'round' && details.faces?.length === 2, JSON.stringify(details));

  // An insert by the old id and by the stable id land in the same place, and the reply names the stable id
  const beamItem = { ref: 'beam', partQuery: '2x20 Beam', label: 'Beam', position: [0, 0, 0] };
  const byOld = placeParts({ instances: [] }, [beamItem, { ref: 'pin', partQuery: '0x2 Connector Pin', insert: { into: { ref: 'beam', port: 'hole_14' }, fromSide: '+' } }]);
  const byNew = placeParts({ instances: [] }, [beamItem, { ref: 'pin', partQuery: '0x2 Connector Pin', insert: { into: { ref: 'beam', port: h14.portId }, fromSide: '+' } }]);
  const [a, b] = [byOld, byNew].map((r) => r.placed?.find((p) => p.ref === 'pin'));
  check(
    'insert by hole_14 and by its stable id give the same pose',
    a && b && a.inst.position.every((v, i) => near(v, b.inst.position[i], 0.001)) && a.inst.rotation.every((v, i) => near(v, b.inst.rotation[i], 0.001)),
    JSON.stringify([a?.inst.position, b?.inst.position, byOld.error, byNew.error])
  );
  check('  the reply names the hole by its stable id', a?.ports?.into === h14.portId, JSON.stringify(a?.ports));
  const bad = placeParts({ instances: [] }, [beamItem, { ref: 'pin', partQuery: '0x2 Connector Pin', insert: { into: { ref: 'beam', port: 'hole_999' } } }]);
  check('an unknown id fails and the error lists the stable ids', /no port "hole_999"/.test(bad.error?.reason || '') && (bad.error?.reason || '').includes(h14.portId), bad.error?.reason?.slice(0, 160));

  // Insert by stable id into the Bumper Switch's top hole (mcp-batch-placement scenario)
  const bumper = part('VEX IQ Bumper Switch');
  const topHole = bumper.ports.find((p) => p.faces?.join() === '+y' && near(p.origin[0], -6.35) && near(p.origin[2], -6.35));
  const cc = part('2x Wide, 30 Degree Left 1x2 Corner Connector');
  const peg = cc.ports.find((p) => p.type === 'pin_peg');
  const intoBumper = placeParts({ instances: [] }, [
    { ref: 'bumper', partQuery: '228-2677', label: 'Bumper', position: [0, 0, 0] },
    { ref: 'cc', partQuery: cc.name, label: 'CC', insert: { sourcePort: peg.portId, into: { ref: 'bumper', port: topHole.portId } } }
  ]);
  const ccItem = intoBumper.placed?.find((p) => p.ref === 'cc');
  const ccJoint = intoBumper.placed && auditAssembly({ instances: intoBumper.instances }).pegJoints.find((j) => j.part === 'CC');
  check(
    'a corner connector peg inserted into a Bumper Switch top hole by stable id is seated there, both named by stable id',
    ccItem?.ports?.into === topHole.portId && ccItem.ports.source === peg.portId && ccJoint?.joinedTo === 'Bumper',
    JSON.stringify({ error: intoBumper.error, ports: ccItem?.ports, joint: ccJoint })
  );
}

// --- Facts for every point ---------------------------------------------------------------------------
{
  const motor = part('VEX IQ Smart Motor');
  const socket = findPort(motor, 'motor_drive_socket');
  check(
    'Smart Motor drive socket: a square socket opening on its front face (+Y), 4.7 mm deep',
    socket?.kind === 'socket' && socket.shape === 'square' && socket.faces?.join() === '+y' && near(socket.depthMm, 4.7),
    JSON.stringify(socket)
  );
  const { catalog } = getCatalog();
  const missing = catalog.flatMap((p) => p.ports.filter((q) => !q.kind || !q.faces?.length || !q.origin || !q.axis).map((q) => `${p.name} ${q.portId}`));
  check('every point has a kind, faces, position and axis', missing.length === 0, missing.slice(0, 5).join('; '));
  const unshaped = catalog.flatMap((p) => p.ports.filter((q) => q.type !== 'pin_peg' && !q.shape).map((q) => `${p.name} ${q.portId}`));
  check('every opening and shaft has a shape', unshaped.length === 0, unshaped.slice(0, 5).join('; '));
}

// --- Shafts are checked along their indexed axis (mcp-fit-audit) ------------------------------------------
{
  const shaftId = part('4x Pitch Capped Shaft').ports.find((p) => p.type === 'shaft').portId;
  const r = placeParts({ instances: [] }, [
    { ref: 'beam', partQuery: '2x8 Beam', label: 'Beam', position: [0, 0, 0] },
    { ref: 'shaft', partQuery: '4x Pitch Capped Shaft', label: 'Shaft', insert: { into: { ref: 'beam', port: 'hole_1' }, fromSide: '+' } },
    { ref: 's1', partQuery: '0.25x Pitch Spacer', label: 'Spacer 1', insert: { into: { ref: 'shaft', port: shaftId }, fromSide: '-' } },
    { ref: 'gear', partQuery: '12 Tooth Gear', label: 'Gear', insert: { into: { ref: 'shaft', port: shaftId }, fromSide: '-' } },
    { ref: 's2', partQuery: '0.25x Pitch Spacer', label: 'Spacer 2', insert: { into: { ref: 'shaft', port: shaftId }, fromSide: '-' } }
  ]);
  const audit = r.instances ? auditAssembly({ instances: r.instances }) : null;
  const shaft = audit?.joints.find((j) => j.label === 'Shaft');
  const inParts = (shaft?.seatedIn || []).map((s) => s.part).sort().join(', ');
  check('capped shaft through two spacers, a 12 Tooth Gear and a 2x8 Beam: seated in all four', inParts === 'Beam, Gear, Spacer 1, Spacer 2', inParts || r.error?.reason);
  check('  the audit has no overlaps', audit?.collisionCount === 0, JSON.stringify(audit?.collisions));
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll connection point checks passed');
process.exit(failures ? 1 : 0);
