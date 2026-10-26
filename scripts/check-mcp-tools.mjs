/**
 * Node check for the MCP server (mcp/vexiq-mcp-server.mjs), driven over its stdio JSON-RPC protocol.
 * Runs against a temporary assembly file (VEXIQ_STATE_PATH) and a stub app bridge on a free port
 * (VEXIQ_APP_PORT), so the real public/assembly-state.json is never touched.
 * Run: node scripts/check-mcp-tools.mjs   (exits 1 on any failure)
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentLine, diffParts, loadHistory, matchesParts, stepById } from '../src/utils/buildHistory.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_STATE = path.join(ROOT, 'public', 'assembly-state.json');

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const sha = (file) => (fs.existsSync(file) ? crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex') : 'missing');
const realStateBefore = sha(REAL_STATE);

// --- Temporary assembly file -------------------------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vexiq-mcp-check-'));
const statePath = path.join(tmpDir, 'assembly-state.json');
const emptyState = () => ({
  version: '1.0',
  selectedId: null,
  viewport: { transformMode: 'translate', snapPitchFactor: 0.5, rotationSnapDeg: 15, showGrid: true, showConnectors: false, explodeMode: 'off', focusTrigger: 0 },
  instances: []
});
const writeState = (state) => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
const readState = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
writeState(emptyState());

// --- Stub app bridge: counts POSTs, fakes connected browsers, answers screenshot requests -------
const bridge = {
  browsers: 1,
  screenshot: 'png', // 'png' | 'hang'
  posts: 0,
  screenshotRequests: [],
  running: true
};
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const readBody = (req) =>
  new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => resolve(body));
  });
const stub = http.createServer(async (req, res) => {
  const body = await readBody(req);
  res.setHeader('Content-Type', 'application/json');
  if (req.url === '/api/assembly' && req.method === 'POST') {
    bridge.posts += 1;
    res.end(JSON.stringify({ ok: true, browserClients: bridge.browsers }));
  } else if (req.url === '/api/assembly/screenshot' && req.method === 'POST') {
    bridge.screenshotRequests.push(JSON.parse(body || '{}'));
    if (bridge.browsers === 0) {
      res.statusCode = 409;
      res.end(JSON.stringify({ ok: false, error: 'No browser has the app open' }));
    } else if (bridge.screenshot === 'hang') {
      res.statusCode = 504;
      setTimeout(() => res.end(JSON.stringify({ ok: false, error: 'Timed out waiting for the app' })), 200);
    } else {
      res.end(JSON.stringify({ ok: true, png: TINY_PNG }));
    }
  } else {
    res.statusCode = 404;
    res.end('{}');
  }
});
await new Promise((r) => stub.listen(0, '127.0.0.1', r));
const bridgePort = stub.address().port;
const stopBridge = () => new Promise((r) => { bridge.running = false; stub.close(r); stub.closeAllConnections?.(); });
const startBridge = () => new Promise((r) => { bridge.running = true; stub.listen(bridgePort, '127.0.0.1', r); });

// --- MCP server over stdio ----------------------------------------------------------------------
const server = spawn(process.execPath, [path.join(ROOT, 'mcp', 'vexiq-mcp-server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, VEXIQ_STATE_PATH: statePath, VEXIQ_APP_PORT: String(bridgePort) },
  stdio: ['pipe', 'pipe', 'inherit']
});
let nextId = 1;
const pending = new Map();
let outBuf = '';
server.stdout.on('data', (chunk) => {
  outBuf += chunk;
  let nl;
  while ((nl = outBuf.indexOf('\n')) >= 0) {
    const line = outBuf.slice(0, nl).trim();
    outBuf = outBuf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});
const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 60000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
/** Calls a tool; returns { data (parsed text content), content (raw content items), isError }. */
const callRaw = async (name, args = {}) => {
  const msg = await rpc('tools/call', { name, arguments: args });
  if (msg.error) return { data: null, content: [], isError: true, error: msg.error };
  const content = msg.result?.content || [];
  const text = content.find((c) => c.type === 'text')?.text;
  return { data: text ? JSON.parse(text) : null, content, isError: Boolean(msg.result?.isError) };
};

// Every call is also a history check: a call that changes parts adds exactly one MCP step labeled
// with its tool, a call that changes nothing adds none, and the saved history replays to the saved parts.
const historyCheck = { problems: [], stepsByTool: {} };
const savedBuild = () => {
  if (!fs.existsSync(statePath)) return null;
  const s = readState();
  return { raw: s.history, parts: s.instances, history: loadHistory(s.history, s.instances) };
};
const call = async (name, args = {}) => {
  const before = savedBuild();
  const res = await callRaw(name, args);
  const after = savedBuild();
  if (!before || !after) return res;
  const changed = diffParts(before.parts, after.parts).length > 0;
  const added = after.history.steps.length - before.history.steps.length;
  const head = stepById(after.history, after.history.headId);
  const where = `${name} ${JSON.stringify(args).slice(0, 80)}`;
  if (name !== 'undo' && name !== 'redo') {
    if (changed && !(added === 1 && head?.source === 'mcp' && head.label.startsWith(name))) {
      historyCheck.problems.push(`${where}: changed parts but added ${added} step(s), head "${head?.label}"`);
    }
    if (!changed && added !== 0) historyCheck.problems.push(`${where}: changed nothing but added ${added} step(s)`);
    if (changed && added === 1) historyCheck.stepsByTool[name] = (historyCheck.stepsByTool[name] || 0) + 1;
  }
  if (after.raw && !matchesParts(after.raw, after.parts)) {
    historyCheck.problems.push(`${where}: saved history does not replay to the saved parts`);
  }
  return res;
};

await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'check', version: '0' } });

// ---------------------------------------------------------------------------
// 1.1 Harness
// ---------------------------------------------------------------------------
{
  const list = await rpc('tools/list');
  const names = list.result.tools.map((t) => t.name);
  check('tools/list returns the original 15 tools', ['search_parts', 'get_part_details', 'get_assembly', 'place_part', 'update_part', 'align_part_to_hole', 'remove_part', 'clear_assembly', 'configure_viewport', 'auto_fasten_joint', 'audit_assembly', 'mate_parts', 'mesh_gear_train', 'mirror_subassembly', 'capture_viewport_views'].every((n) => names.includes(n)), names.join(', '));
  const placed = await call('place_part', { partQuery: '1x6 Beam', position: [0, 0, 0] });
  check('place_part writes to the temporary assembly file', placed.data?.ok && readState().instances.length === 1, JSON.stringify(placed.data)?.slice(0, 200));
}

// ---------------------------------------------------------------------------
// 1.3 Engine features with mesh measurements
// ---------------------------------------------------------------------------
{
  const { findPart, worldFeaturesFor } = await import('../mcp/assembly-engine.mjs');
  const { findSeatedPairs } = await import('../src/utils/pinHoleAlignment.js');
  const inst = (id, name, position, rotation = [0, 0, 0]) => ({ instanceId: id, partId: findPart(name).id, label: id, position, rotation, visible: true });
  const motor = worldFeaturesFor(inst('motor', 'VEX IQ Smart Motor', [0, 0, 0]));
  const hole1 = motor.find((f) => f.featureId === 'hole_1');
  check('worldFeaturesFor: Smart Motor hole_1 is blind from the front face and closed at the back', hole1 && !hole1.through && Math.min(hole1.start.y, hole1.end.y) > -12, JSON.stringify(hole1 && [hole1.start.y, hole1.end.y]));
  // 0x2 pin seated in a 1x6 Beam hole (beam at identity, hole_2 axis +Z)
  const beam = inst('beam', '1x6 Beam', [0, 0, 0]);
  const pin = inst('pin', '0x2 Connector Pin', [-19.05, 0, 3.175]);
  const pairs = findSeatedPairs(worldFeaturesFor(pin), worldFeaturesFor(beam));
  check('worldFeaturesFor + findSeatedPairs: seated pin pairs with the beam hole', pairs.length === 1 && pairs[0].opening.featureId === 'hole_2' && pairs[0].insert.instanceId === 'pin', JSON.stringify(pairs.map((p) => [p.insert.featureId, p.opening.featureId])));
}

// ---------------------------------------------------------------------------
// 2.1 Fit audit on seated joints
// ---------------------------------------------------------------------------
const { findPart } = await import('../mcp/assembly-engine.mjs');
const { getLocalFeatures } = await import('../src/utils/pinHoleAlignment.js');
const THREE = await import('three');
const drivetrain = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'fixtures', 'drivetrain.json'), 'utf8'));
const mk = (id, name, position, rotation = [0, 0, 0]) => ({
  instanceId: id, partId: findPart(name).id, label: id, position, rotation,
  lastValidPosition: position, lastValidRotation: rotation, isIntersecting: false, visible: true, locked: false
});
const auditOf = async (instances) => {
  writeState({ ...emptyState(), instances });
  return (await call('audit_assembly')).data;
};
const jointOf = (audit, label) => audit.joints.find((j) => j.label === label)?.seatedIn.map((x) => x.part) || [];
const subset = (labels) => drivetrain.instances.filter((i) => labels.includes(i.label));
{
  let a = await auditOf(drivetrain.instances);
  check('Drivetrain fixture: sound, one piece, 8 driven wheels', a.isMechanicallySound && a.connectedComponentCount === 1 && a.kinematics.drivenWheelCount === 8, JSON.stringify({ sound: a.isMechanicallySound, comps: a.connectedComponentCount, driven: a.kinematics.drivenWheelCount, half: a.halfSeatedFasteners, prot: a.protrudingShafts }));
  check('  corner connector pegs join it to the inner rail (2 pegs)', a.pegJoints.some((j) => j.part === 'Left Corner Connector' && j.joinedTo === 'Left Inner Rail' && j.pegs === 2), JSON.stringify(a.pegJoints));

  // Plate and its pins raised 6.3 mm: pins stay in the plate but leave the connector flanges
  const raised = drivetrain.instances.map((i) =>
    /Plate Pin|Top Plate/.test(i.label) ? { ...i, position: [i.position[0], i.position[1] + 6.3, i.position[2]] } : i
  );
  a = await auditOf(raised);
  check('Plate pins above the connector flanges: 8 half-seated, not sound', !a.isMechanicallySound && a.halfSeatedFastenerCount === 8 && a.halfSeatedFasteners.every((h) => h.seatedIn.length === 1 && h.seatedIn[0].part === 'Top Plate'), JSON.stringify(a.halfSeatedFasteners.map((h) => h.label)));

  // Pin through two stacked beams
  a = await auditOf([mk('Beam A', '1x6 Beam', [0, 0, 3.05]), mk('Beam B', '1x6 Beam', [0, 0, -3.05]), mk('Pin', '0x2 Connector Pin', [-19.05, 0, 0])]);
  check('Pin through two stacked beams joins them', a.connectedComponentCount === 1 && jointOf(a, 'Pin').length === 2, JSON.stringify(a.joints));

  // Pin half in a beam, half in open air
  a = await auditOf([mk('Beam', '1x6 Beam', [0, 0, 0]), mk('Pin', '0x2 Connector Pin', [-19.05, 0, 3.05])]);
  check('Pin with one end in open air is half-seated, naming the beam', a.halfSeatedFastenerCount === 1 && a.halfSeatedFasteners[0].seatedIn[0].part === 'Beam' && !a.isMechanicallySound, JSON.stringify(a.halfSeatedFasteners));

  // Motor -> shaft -> hub
  const motorSet = subset(['Left Inner Rail', 'Left Outer Rail', 'Left Motor', 'Left Front Axle', 'Left Front Hub', 'Left Front Tire', 'Left Front Gear', 'Left Front Spacer In', 'Left Front Spacer Out']);
  a = await auditOf(motorSet);
  const chain = a.kinematics.motorDriveChains[0];
  check('Shaft in the motor socket and the hub bore drives the wheel', chain?.drivenWheels.some((w) => w.label === 'Left Front Hub'), JSON.stringify(chain));

  // Gear moved 1 mm off the shaft line: boxes still overlap, axes don't line up
  a = await auditOf(motorSet.map((i) => (i.label === 'Left Front Gear' ? { ...i, position: [i.position[0] + 1, i.position[1], i.position[2]] } : i)));
  check('Gear 1 mm beside the shaft is not on the shaft', !jointOf(a, 'Left Front Axle').includes('Left Front Gear') && !a.kinematics.motorDriveChains[0].gearsInChain.includes('Left Front Gear'), JSON.stringify(jointOf(a, 'Left Front Axle')));

  // Rubber Shaft Collar on the end of a shaft through a beam
  const collarMeta = findPart('Rubber Shaft Collar');
  const hole = getLocalFeatures(collarMeta).find((f) => f.kind === 'collar_hole');
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...hole.axis), new THREE.Vector3(0, 0, 1));
  const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
  const collarRot = [e.x, e.y, e.z].map((r) => Number(THREE.MathUtils.radToDeg(r).toFixed(2)));
  const holeCenterT = (hole.tMin + hole.tMax) / 2;
  const holeCenter = new THREE.Vector3(...hole.origin).addScaledVector(new THREE.Vector3(...hole.axis), holeCenterT - new THREE.Vector3(...hole.origin).dot(new THREE.Vector3(...hole.axis))).applyQuaternion(q);
  // 4x Pitch Shaft along Z from -3.05 (beam bottom) up 49 mm; the collar sits on its top 9 mm
  const shaftTop = -3.05 + 49.02;
  const collarCenter = new THREE.Vector3(-19.05, 0, shaftTop - (hole.tMax - hole.tMin) / 2);
  const collarPos = collarCenter.clone().sub(holeCenter).toArray().map((n) => Number(n.toFixed(3)));
  a = await auditOf([
    mk('Beam', '1x6 Beam', [0, 0, 0]),
    mk('Gear', '36 Tooth Gear', [-19.05, 0, 20]),
    mk('Shaft', '4x Pitch Shaft', [-19.05, 0, -3.05 + 24.51]),
    mk('Collar', 'Rubber Shaft Collar', collarPos, collarRot)
  ]);
  check(
    'Collar on a shaft end: held by the shaft, not floating or unsecured, and the shaft does not overhang',
    jointOf(a, 'Shaft').includes('Collar') && !a.unsecuredParts.some((u) => u.label === 'Collar') && !a.floatingFasteners.some((f) => f.label === 'Collar') && a.protrudingShaftCount === 0,
    JSON.stringify({ joints: jointOf(a, 'Shaft'), unsecured: a.unsecuredParts, prot: a.protrudingShafts })
  );
}

// ---------------------------------------------------------------------------
// 2.2 Depth rule end to end (Smart Motor at identity: face at y = 0.13, back at y = -50.35)
// ---------------------------------------------------------------------------
{
  const { checkCandidateCollision } = await import('../mcp/assembly-engine.mjs');
  const motor = mk('Motor', 'VEX IQ Smart Motor', [0, 0, 0]);
  // Pin pointing +Y (rotation [-90,0,0] maps local +Z to +Y), leading end 6 mm into the back at hole_1
  const backPin = mk('Back Pin', '0x2 Connector Pin', [22.225, -50.35 + 6 - 6.14, 6.35], [-90, 0, 0]);
  check('Pin pushed 6 mm into the back of the motor at hole_1 collides', checkCandidateCollision(backPin, [motor]).isIntersecting);
  // Pin pointing -Y, shoulder on the face, lower half in face hole_10
  const facePin = mk('Face Pin', '0x2 Connector Pin', [15.875, 0.13, 0], [90, 0, 0]);
  check('Pin in a face hole (hole_10) does not collide', !checkCandidateCollision(facePin, [motor]).isIntersecting);
  // Pin just touching the back mark (0.3 mm in): not seated
  const touchPin = mk('Touch Pin', '0x2 Connector Pin', [22.225, -50.35 + 0.3 - 6.14, 6.35], [-90, 0, 0]);
  const a = await auditOf([motor, touchPin]);
  check('Pin touching the back mark is not counted as seated', jointOf(a, 'Touch Pin').length === 0 && a.floatingFasteners.some((f) => f.label === 'Touch Pin'), JSON.stringify(a.joints));
  const b = await auditOf([motor, facePin]);
  check('Pin in a face hole is seated in the motor', jointOf(b, 'Face Pin').includes('Motor'), JSON.stringify(b.joints));
}

// ---------------------------------------------------------------------------
// 3.1 Compact part details
// ---------------------------------------------------------------------------
{
  const res = await call('get_part_details', { partQuery: 'VEX IQ Smart Motor' });
  const text = res.content.find((c) => c.type === 'text').text;
  const conn = (port) => res.data.connections.find((c) => c.port === port);
  const socket = conn('motor_drive_socket');
  check(
    'Smart Motor details: socket along +Y about 4.7 mm deep, hole_1/hole_8 blind from the front and closed at the back',
    socket && socket.axis[1] === 1 && Math.abs(socket.depthMm - 4.7) <= 0.6 &&
      ['hole_1', 'hole_8'].every((h) => conn(h) && !conn(h).through && conn(h).span[0] > -12 && !conn(`${h}@lo`)),
    JSON.stringify(res.data.connections.filter((c) => /socket|hole_1$|hole_8$|@/.test(c.port)))
  );
  check('  no cylinder list, reply under 8,000 characters', !('cylinders' in res.data) && text.length < 8000, `${text.length} chars`);
  const cc = await call('get_part_details', { partQuery: '1x Wide, 1x1 Corner Connector' });
  const peg = cc.data.connections.find((c) => c.kind === 'pin');
  check('1x Wide, 1x1 Corner Connector peg sticks out on its +Z end only', peg && peg.sticksOut === 'hi' && peg.axis[2] === 1, JSON.stringify(cc.data.connections));
  const full = await call('get_part_details', { partQuery: 'VEX IQ Smart Motor', verbose: true });
  check('verbose: true returns the cylinder list too', Array.isArray(full.data.cylinders) && full.data.cylinders.length > 0 && Array.isArray(full.data.connections));
}

// ---------------------------------------------------------------------------
// 4.1 / 4.2 place_parts: absolute items, errors, rejectIntersecting, dryRun
// ---------------------------------------------------------------------------
{
  writeState(emptyState());
  const beams = Array.from({ length: 40 }, (_, i) => ({ partQuery: '1x6 Beam', ref: `b${i}`, label: `Beam ${i}`, position: [0, 0, i * 20] }));
  let posts = bridge.posts;
  let res = await call('place_parts', { parts: beams });
  check(
    'place_parts: 40 beams saved in one write, one short line each',
    res.data?.saved && res.data.parts.length === 40 && readState().instances.length === 40 && bridge.posts - posts === 1 &&
      res.data.parts.every((p) => p.status === 'placed' && p.instanceId && !('position' in p)),
    JSON.stringify(res.data)?.slice(0, 300)
  );
  check('  reply carries one audit summary', res.data?.audit && typeof res.data.audit.isMechanicallySound === 'boolean' && res.data.audit.unsecuredPartCount === 40, JSON.stringify(res.data?.audit));

  posts = bridge.posts;
  const bad = beams.slice(0, 20).map((b, i) => (i === 7 ? { ...b, partQuery: 'Flux Capacitor 9000' } : { ...b, ref: `c${i}`, position: [100, 0, i * 20] }));
  res = await call('place_parts', { parts: bad });
  check('Unknown part at item 7: nothing saved, error names item 7', res.isError && /item 7/.test(res.data?.error) && readState().instances.length === 40 && bridge.posts === posts, JSON.stringify(res.data));

  res = await call('place_parts', {
    parts: [
      { partQuery: '1x6 Beam', ref: 'x', label: 'Overlap A', position: [200, 0, 0] },
      { partQuery: '1x6 Beam', ref: 'y', label: 'Overlap B', position: [205, 0, 0] }
    ],
    rejectIntersecting: true
  });
  check(
    'rejectIntersecting with two overlapping items: nothing saved, both named',
    res.data && !res.data.saved && readState().instances.length === 40 && res.data.parts.every((p) => p.status === 'overlapping' && p.overlaps?.length) && bridge.posts === posts,
    JSON.stringify(res.data)?.slice(0, 300)
  );

  const before = JSON.stringify((await call('get_assembly')).data.instances);
  res = await call('place_parts', { parts: [{ partQuery: '1x6 Beam', ref: 'dry', position: [300, 0, 0] }], dryRun: true });
  const after = JSON.stringify((await call('get_assembly')).data.instances);
  check(
    'dryRun: same reply with poses, marked as a dry run, nothing saved or sent to the app',
    res.data?.dryRun && !res.data.saved && res.data.parts[0].position?.[0] === 300 && before === after && bridge.posts === posts,
    JSON.stringify(res.data)?.slice(0, 300)
  );
}

// ---------------------------------------------------------------------------
// 4.3 place_parts insert: line up outside, move in until contact
// ---------------------------------------------------------------------------
{
  const fresh = async (instances, parts, extra = {}) => {
    writeState({ ...emptyState(), instances });
    return call('place_parts', { parts, verbose: true, ...extra });
  };
  const beam = mk('Beam', '1x6 Beam', [0, 0, 0]);
  // a. Pin into a beam hole from +Z
  let res = await fresh([beam], [{ partQuery: '0x2 Connector Pin', ref: 'pin', label: 'Pin', insert: { into: { instanceId: 'Beam', port: 'hole_3' }, fromSide: '+' } }]);
  let a = (await call('audit_assembly')).data;
  const pin = res.data?.parts?.[0];
  // 0x2 pin: cap end at local z = -6.26, pin end at +6.14; it goes all the way in until the cap rests on the top face
  const pinInst = readState().instances.find((i) => i.label === 'Pin');
  const { buildWorldMatrix: bwm } = await import('../mcp/assembly-engine.mjs');
  const capEnd = pinInst && new THREE.Vector3(0, 0, -6.26).applyMatrix4(bwm(pinInst.position, pinInst.rotation));
  check(
    'Insert a 0x2 Connector Pin into a 1x6 Beam hole: seated, cap on the top face, stopped against the beam, not overlapping',
    pin && pin.status === 'placed' && /Beam/.test(pin.stoppedAgainst) && jointOf(a, 'Pin').includes('Beam') && capEnd && Math.abs(capEnd.z - 3.05) < 0.3,
    JSON.stringify({ pin, capEnd: capEnd?.toArray(), joints: jointOf(a, 'Pin') })
  );

  // b. Capped shaft into the Smart Motor socket
  const motor = mk('Motor', 'VEX IQ Smart Motor', [0, 0, 0]);
  res = await fresh([motor], [{ partQuery: '4x Pitch Capped Shaft', ref: 'axle', label: 'Axle', insert: { into: { instanceId: 'Motor', port: 'motor_drive_socket' } } }]);
  a = (await call('audit_assembly')).data;
  const axle = res.data?.parts?.[0];
  const axleInst = readState().instances.find((i) => i.label === 'Axle');
  // Capped shaft local z: plain end at -49.02, cap at 0; after insert its plain end should be at the socket bottom (y ≈ -4.7)
  const { buildWorldMatrix } = await import('../mcp/assembly-engine.mjs');
  const plainEnd = axleInst && new THREE.Vector3(0, 0, -49.02).applyMatrix4(buildWorldMatrix(axleInst.position, axleInst.rotation));
  check(
    'Insert a 4x Pitch Capped Shaft into the motor socket: reaches the socket bottom, seated with the motor',
    axle && axle.status === 'placed' && plainEnd && Math.abs(plainEnd.y + 4.7) < 0.6 && Math.abs(plainEnd.x + 9.525) < 0.01 && jointOf(a, 'Axle').includes('Motor'),
    JSON.stringify({ axle, plainEnd: plainEnd?.toArray(), joints: jointOf(a, 'Axle') })
  );

  // c + d. Plain shaft through a lone beam stops flush with the far face; a hub slides on until it touches
  res = await fresh([beam], [
    { partQuery: '4x Pitch Shaft', ref: 'shaft', label: 'Shaft', insert: { into: { instanceId: 'Beam', port: 'hole_3' }, fromSide: '+' } },
    { partQuery: 'Small Wheel Hub (44 mm)', ref: 'hub', label: 'Hub', insert: { into: { ref: 'shaft', port: 'shaft' }, fromSide: '+' } }
  ]);
  a = (await call('audit_assembly')).data;
  const [shaftRes, hubRes] = res.data?.parts || [];
  const shaftInst = readState().instances.find((i) => i.label === 'Shaft');
  const shaftLow = shaftInst && shaftInst.position[2] - 24.51;
  check(
    'Plain shaft through a lone beam stops flush with its far face',
    shaftRes && shaftRes.stoppedAgainst === 'flush with far face' && Math.abs(shaftLow + 3.05) < 0.7,
    JSON.stringify({ shaftRes, shaftLow })
  );
  check(
    'Hub inserted over the earlier shaft (by ref) slides on until it touches the beam',
    hubRes && hubRes.status === 'placed' && /Beam/.test(hubRes.stoppedAgainst) && jointOf(a, 'Shaft').includes('Hub'),
    JSON.stringify({ hubRes, joints: jointOf(a, 'Shaft') })
  );
}

// ---------------------------------------------------------------------------
// 4.4 place_parts mirror: left half of the drivetrain + its top plate, mirrored across Z
// ---------------------------------------------------------------------------
{
  writeState(emptyState());
  const half = drivetrain.instances
    .filter((i) => i.label.startsWith('Left') || i.label === 'Top Plate')
    .map((i) => ({ partQuery: i.partId, ref: i.label, label: i.label, position: i.position, rotation: i.rotation, color: i.color }));
  const res = await call('place_parts', { parts: half, mirror: { plane: 'Z', offsetMm: 0 } });
  const audit = (await call('audit_assembly')).data;
  const labels = readState().instances.map((i) => i.label);
  check(
    'Mirrored drivetrain half: 65 parts (plate not doubled), sound, 8 driven wheels, no overlaps',
    res.data?.saved && labels.length === 65 && labels.filter((l) => l === 'Top Plate').length === 1 && audit.isMechanicallySound && audit.kinematics.drivenWheelCount === 8 && audit.collisionCount === 0,
    JSON.stringify({ n: labels.length, audit: res.data?.audit })
  );
  check(
    '  both motors drive their front axles, right-side parts are labeled Right, no approximate mirrors',
    audit.kinematics.motorDriveChains.length === 2 && audit.kinematics.motorDriveChains.every((c) => c.motorShafts.length === 1) &&
      labels.includes('Right Motor') && labels.includes('Right Corner Connector') && !res.data.parts.some((p) => p.mirrorApproximate) &&
      res.data.parts.some((p) => p.ref === 'Left Motor#mirror'),
    JSON.stringify(audit.kinematics.motorDriveChains.map((c) => [c.motorLabel, c.motorShafts]))
  );
  check(
    '  mirrored corner connector stays right side up: the right plate pins sit in it',
    jointOf(audit, 'Right Plate Pin A1').includes('Right Corner Connector'),
    JSON.stringify(jointOf(audit, 'Right Plate Pin A1'))
  );
}

// ---------------------------------------------------------------------------
// View options (openspec: view-options): projection, layout, stereo, viewAlong
// ---------------------------------------------------------------------------
{
  writeState({ ...emptyState(), instances: [mk('Beam', '1x6 Beam', [0, 0, 0])] });
  let res = await call('configure_viewport', { projection: 'orthographic', viewLayout: 'four', stereoCrossEyed: true, stereoDepth: 2, shadows: true, ambientOcclusion: true });
  const stepsBefore = (readState().history?.steps || []).length; // the first write adds "Starting assembly"
  let vp = readState().viewport;
  check(
    'configure_viewport saves projection, layout, cross-eyed, depth, shadows and AO',
    !res.isError && vp.projection === 'orthographic' && vp.viewLayout === 'four' && vp.stereoCrossEyed === true && vp.stereoDepth === 2 && vp.shadows === true && vp.ambientOcclusion === true,
    JSON.stringify(vp)
  );
  await call('configure_viewport', { showGrid: false });
  vp = readState().viewport;
  check('other viewport calls keep the view options', vp.projection === 'orthographic' && vp.viewLayout === 'four' && vp.stereoDepth === 2 && vp.shadows === true && vp.ambientOcclusion === true, JSON.stringify(vp));
  res = await call('configure_viewport', { viewAlong: '+y' });
  const first = readState().viewport.viewAlongTrigger;
  await call('configure_viewport', { viewAlong: '+y' });
  const second = readState().viewport.viewAlongTrigger;
  check('viewAlong turns the camera once per call (the trigger counts up)', first?.dir === '+y' && second?.dir === '+y' && second.n === first.n + 1, JSON.stringify([first, second]));
  check('view options add no history steps', (readState().history?.steps || []).length === stepsBefore);
  const bad = [
    [{ projection: 'fisheye' }, /projection must be one of: perspective, orthographic/],
    [{ viewLayout: 'quad' }, /viewLayout must be one of: single, four, stereo/],
    [{ viewAlong: 'up' }, /viewAlong must be one of: \+x, -x, \+y, -y, \+z, -z/],
    [{ stereoDepth: 5 }, /stereoDepth must be a number from 0.25 to 3/],
    [{ stereoCrossEyed: 'yes' }, /stereoCrossEyed must be true or false/],
    [{ shadows: 'on' }, /shadows must be true or false/],
    [{ ambientOcclusion: 1 }, /ambientOcclusion must be true or false/]
  ];
  const vpBefore = JSON.stringify(readState().viewport);
  const refused = [];
  for (const [args, message] of bad) {
    const r = await call('configure_viewport', args);
    if (!(r.isError && message.test(r.data?.error || ''))) refused.push(`${JSON.stringify(args)} -> ${JSON.stringify(r.data)}`);
  }
  check('bad view options are refused with the allowed values, and nothing is saved', refused.length === 0 && JSON.stringify(readState().viewport) === vpBefore, refused.join(' | '));
}

// ---------------------------------------------------------------------------
// 5.1 appSync on every change
// ---------------------------------------------------------------------------
{
  writeState({ ...emptyState(), instances: [mk('Beam', '1x6 Beam', [0, 0, 0])] });
  const writers = async () => [
    ['place_part', await call('place_part', { partQuery: '1x6 Beam', position: [0, 40, 0] })],
    ['place_parts', await call('place_parts', { parts: [{ partQuery: '1x6 Beam', position: [0, 80, 0] }] })],
    ['update_part', await call('update_part', { instanceId: 'Beam', color: '#ff0000' })],
    ['configure_viewport', await call('configure_viewport', { showGrid: true })]
  ];
  const all = (results, sync, hint) => results.every(([, r]) => r.data?.appSync === sync && (hint ? hint.test(r.data.appHint || '') : !r.data.appHint));
  const show = (results) => JSON.stringify(results.map(([n, r]) => [n, r.data?.appSync, r.data?.appHint]));

  bridge.browsers = 1;
  let results = await writers();
  check('appSync "live" when the app is open in a browser (place_part, place_parts, update_part, configure_viewport)', all(results, 'live'), show(results));

  bridge.browsers = 0;
  results = await writers();
  check('appSync "no-browser" with the app address when nobody has it open', all(results, 'no-browser', new RegExp(`http://localhost:${bridgePort}`)), show(results));

  await stopBridge();
  results = await writers();
  check('appSync "saved-to-file-only" with an npm run dev hint when the app is not running', all(results, 'saved-to-file-only', /npm run dev/), show(results));
  check('  the change is still saved to the file (1 + 2 per round x 3)', readState().instances.length === 7, String(readState().instances.length));
  await startBridge();
  bridge.browsers = 1;

  const read = await call('get_assembly');
  check('Read-only tools carry no appSync', !('appSync' in read.data));
}

// ---------------------------------------------------------------------------
// 5.2 capture_screenshot through the bridge
// ---------------------------------------------------------------------------
{
  bridge.browsers = 1;
  bridge.screenshot = 'png';
  let res = await call('capture_screenshot', { view: 'iso' });
  const image = res.content.find((c) => c.type === 'image');
  const asked = bridge.screenshotRequests.at(-1);
  check(
    'capture_screenshot returns a PNG image item, asking the app for the iso view at 1024 x 768',
    !res.isError && image?.mimeType === 'image/png' && image.data.length > 0 && asked?.view === 'iso' && asked.width === 1024 && asked.height === 768,
    JSON.stringify({ content: res.content.map((c) => c.type), asked })
  );
  res = await call('capture_screenshot', { view: 'top', width: 5000, height: 10 });
  check('  width and height are kept within 320–1920', bridge.screenshotRequests.at(-1).width === 1920 && bridge.screenshotRequests.at(-1).height === 320);

  bridge.browsers = 0;
  res = await call('capture_screenshot', {});
  check('No browser: error saying the app is not open, with its address', res.isError && /No browser/.test(res.data?.error) && new RegExp(`localhost:${bridgePort}`).test(res.data?.appHint), JSON.stringify(res.data));

  bridge.browsers = 1;
  bridge.screenshot = 'hang';
  res = await call('capture_screenshot', {});
  check('App never answers: timeout error', res.isError && /10 seconds|Timed out/.test(res.data?.error), JSON.stringify(res.data));
  bridge.screenshot = 'png';

  await stopBridge();
  res = await call('capture_screenshot', {});
  check('App not running: error with an npm run dev hint', res.isError && /isn't running/.test(res.data?.error) && /npm run dev/.test(res.data?.appHint), JSON.stringify(res.data));
  await startBridge();
}

// ---------------------------------------------------------------------------
// Build history (openspec: mcp-history)
// ---------------------------------------------------------------------------
{
  bridge.browsers = 1;
  writeState(emptyState());
  const items = Array.from({ length: 36 }, (_, i) => ({
    partQuery: '0x2 Connector Pin',
    label: `Left Pin ${i + 1}`,
    position: [(i % 6) * 25.4, Math.floor(i / 6) * 25.4, 40]
  }));
  const placed = await call('place_parts', { parts: items, mirror: { plane: 'Z', offsetMm: 0 } });
  let saved = readState();
  const line = currentLine(saved.history);
  const step = line.at(-1);
  const addOrder = step?.ops.filter((o) => o.op === 'add').map((o) => o.part.instanceId).join();
  check(
    'place_parts with 36 items and mirror: one step adding 72 parts, labeled "place_parts: 72 parts"',
    placed.data?.placedCount === 72 && line.length === 1 && step.label === 'place_parts: 72 parts' && step.source === 'mcp' && step.ops.length === 72,
    JSON.stringify({ placed: placed.data?.placedCount, steps: line.length, label: step?.label })
  );
  check('  its parts are recorded in placement order', addOrder === saved.instances.map((p) => p.instanceId).join());
  check('  the reply names the step', placed.data?.historyStep === 'place_parts: 72 parts', JSON.stringify(placed.data?.historyStep));

  const dry = await call('place_parts', { dryRun: true, parts: [{ partQuery: '1x6 Beam', position: [0, 200, 0] }] });
  check('place_parts dryRun adds no step', dry.data?.dryRun && currentLine(readState().history).length === 1);
  const asm = await call('get_assembly');
  check('get_assembly reports the step count, not the steps', asm.data?.history?.currentStep === 1 && asm.data?.history?.totalSteps === 1 && !asm.data?.history?.steps);

  // Undo / redo / get_history
  let res = await call('undo');
  saved = readState();
  check('undo removes the call\'s 72 parts without adding a step', res.data?.ok && saved.instances.length === 0 && saved.history.steps.length === 1 && res.data?.undone?.[0] === 'place_parts: 72 parts', JSON.stringify(res.data));
  check('  undo reports appSync', res.data?.appSync === 'live');
  res = await call('undo');
  check('undo at the start refuses with a message', res.data?.ok === false && /Nothing to undo/.test(res.data?.message));
  res = await call('redo');
  saved = readState();
  check('redo brings the 72 parts back', res.data?.ok && saved.instances.length === 72 && res.data?.currentStep === 1);
  res = await call('redo');
  check('redo at the end refuses with a message', res.data?.ok === false && /Nothing to redo/.test(res.data?.message));

  await call('undo');
  res = await call('place_part', { partQuery: '1x6 Beam', label: 'Branch Beam', position: [0, 150, 0] });
  check('a change after undo starts a branch and the reply says so', /new branch/.test(res.data?.historyNote || ''), JSON.stringify(res.data?.historyNote));
  const hist = await call('get_history');
  check(
    'get_history lists labels and sources, and the branch point at the start',
    hist.data?.totalSteps === 1 &&
      hist.data.steps[0].label === 'place_part: Branch Beam' &&
      hist.data.steps[0].source === 'mcp' &&
      hist.data.branchPoints.length === 1 &&
      hist.data.branchPoints[0].afterStep === 0 &&
      hist.data.branchPoints[0].branches.length === 2,
    JSON.stringify(hist.data)
  );

  // Every changing tool records one step (checked by the call wrapper); exercise the rest
  writeState(emptyState());
  const railA = (await call('place_part', { partQuery: '228-2500-026', label: 'Rail A', position: [0, 23.87, 0] })).data?.instance?.instanceId;
  const railB = (await call('place_part', { partQuery: '228-2500-026', label: 'Rail B', position: [0, 23.87, 6.1] })).data?.instance?.instanceId;
  await call('update_part', { instanceId: railB, color: '#ff0000' });
  await call('auto_fasten_joint', { instanceIdA: railA, instanceIdB: railB, maxPins: 2 });
  await call('align_part_to_hole', { targetInstanceId: railA, partQuery: '0x2 Connector Pin', holeIndex: 5 });
  const mated = await call('mate_parts', { partQuery: '0x2 Connector Pin', targetInstanceId: railA, targetPortId: 'hole_29' });
  await call('mesh_gear_train', { supportBeamId: railA, startPortId: 'hole_31', gears: ['228-2500-214', '228-2500-214'], axialOffsetMm: -30 });
  await call('mirror_subassembly', { instanceIds: [railA], mirrorPlane: 'Z', planeOffsetMm: -40 });
  await call('remove_part', { instanceId: mated.data?.instance?.instanceId });
  await call('configure_viewport', { showGrid: false });
  await call('clear_assembly', { mode: 'empty' });
  await call('clear_assembly', { mode: 'starter' });
  const changingTools = ['place_part', 'place_parts', 'update_part', 'align_part_to_hole', 'mate_parts', 'auto_fasten_joint', 'mesh_gear_train', 'mirror_subassembly', 'remove_part', 'clear_assembly'];
  const missing = changingTools.filter((t) => !historyCheck.stepsByTool[t]);
  check('every changing tool recorded a step', missing.length === 0, `no step from: ${missing.join(', ')}`);
  const labels = currentLine(readState().history).map((s) => s.label);
  check('clear_assembly steps are labeled "clear_assembly" and "clear_assembly: starter"', labels.includes('clear_assembly') && labels.includes('clear_assembly: starter'), labels.join(' | '));
  check(
    'every call: one step when parts changed, none otherwise, and the saved history replays to the saved parts',
    historyCheck.problems.length === 0,
    historyCheck.problems.slice(0, 5).join(' || ')
  );
}

// ---------------------------------------------------------------------------
server.stdin.end();
server.kill();
await stopBridge().catch(() => {});
fs.rmSync(tmpDir, { recursive: true, force: true });
check('public/assembly-state.json is untouched', sha(REAL_STATE) === realStateBefore);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
