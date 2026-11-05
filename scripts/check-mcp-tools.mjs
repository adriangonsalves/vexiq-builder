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
// The app's settings: branches kept, so the branch checks below apply (linear is checked separately)
const settingsPath = path.join(tmpDir, 'app-settings.json');
const writeSettings = (settings) => fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
writeSettings({ advanced: true, history: 'branches', mcpEnabled: true });

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
  env: { ...process.env, VEXIQ_STATE_PATH: statePath, VEXIQ_SETTINGS_PATH: settingsPath, VEXIQ_APP_PORT: String(bridgePort) },
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

const initMsg = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'check', version: '0' } });
check(
  'initialize instructions include chain over/under and standoff guide note',
  initMsg.result?.instructions?.includes('Standoffs in `instanceIds` act as smooth round chain guides') &&
    initMsg.result?.instructions?.includes('pass `route: { "<id>": "over" | "under" }`'),
  initMsg.result?.instructions?.slice(-300)
);

// ---------------------------------------------------------------------------
// 1.1 Harness
// ---------------------------------------------------------------------------
{
  const list = await rpc('tools/list');
  const names = list.result.tools.map((t) => t.name);
  check('tools/list has the selection and group tools', ['select_parts', 'group_parts', 'ungroup_parts', 'update_group'].every((n) => names.includes(n)), names.join(', '));
  check('tools/list returns the original 15 tools', ['search_parts', 'get_part_details', 'get_assembly', 'place_part', 'update_part', 'align_part_to_hole', 'remove_part', 'clear_assembly', 'configure_viewport', 'auto_fasten_joint', 'audit_assembly', 'mate_parts', 'mesh_gear_train', 'mirror_subassembly', 'capture_viewport_views'].every((n) => names.includes(n)), names.join(', '));
  const placed = await call('place_part', { partQuery: '1x6 Beam', position: [0, 0, 0] });
  check('place_part writes to the temporary assembly file', placed.data?.ok && readState().instances.length === 1, JSON.stringify(placed.data)?.slice(0, 200));
}

// ---------------------------------------------------------------------------
// 1.3 Engine features with mesh measurements
// ---------------------------------------------------------------------------
{
  const { findPart, findPort, worldFeaturesFor } = await import('../mcp/assembly-engine.mjs');
  const { findSeatedPairs } = await import('../src/utils/pinHoleAlignment.js');
  const inst = (id, name, position, rotation = [0, 0, 0]) => ({ instanceId: id, partId: findPart(name).id, label: id, position, rotation, visible: true });
  const motor = worldFeaturesFor(inst('motor', 'VEX IQ Smart Motor', [0, 0, 0]));
  const hole1 = motor.find((f) => f.featureId === findPort(findPart('VEX IQ Smart Motor'), 'hole_1').portId);
  check('worldFeaturesFor: Smart Motor hole_1 is blind from the front face and closed at the back', hole1 && !hole1.through && Math.min(hole1.start.y, hole1.end.y) > -12, JSON.stringify(hole1 && [hole1.start.y, hole1.end.y]));
  // 0x2 pin seated in a 1x6 Beam hole (beam at identity, hole_2 axis +Z)
  const beam = inst('beam', '1x6 Beam', [0, 0, 0]);
  const pin = inst('pin', '0x2 Connector Pin', [-19.05, 0, 3.175]);
  const pairs = findSeatedPairs(worldFeaturesFor(pin), worldFeaturesFor(beam));
  check('worldFeaturesFor + findSeatedPairs: seated pin pairs with the beam hole', pairs.length === 1 && pairs[0].opening.featureId === findPort(findPart('1x6 Beam'), 'hole_2').portId && pairs[0].insert.instanceId === 'pin', JSON.stringify(pairs.map((p) => [p.insert.featureId, p.opening.featureId])));
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
  // By stable id or by an older id kept as an alias
  const conn = (port) => res.data.connections.find((c) => c.port === port || c.aliases?.includes(port));
  const socket = conn('motor_drive_socket');
  check(
    'Smart Motor details: socket along +Y 8.6 mm deep, hole_1/hole_8 blind from the front and closed at the back',
    socket && socket.axis[1] === 1 && Math.abs(socket.depthMm - 8.73) <= 0.1 &&
      ['hole_1', 'hole_8'].every((h) => conn(h) && !conn(h).through && conn(h).span[0] > -12 && !conn(`${h}@lo`)),
    JSON.stringify(res.data.connections.filter((c) => /socket|hole_1$|hole_8$|@/.test(c.port)))
  );
  check('  no cylinder list, reply under 8,000 characters', !('cylinders' in res.data) && text.length < 8000, `${text.length} chars`);
  check('  its CAD frame entry: own origin, turned 180° about Z', res.data.cadFrames?.['228-2560']?.rule === 'origin', JSON.stringify(res.data.cadFrames));
  const socketPort = res.data.connections.find((c) => c.kind === 'shaft_socket');
  check('  the socket by its stable id, with its old id, shape and face', /^socket\./.test(socketPort?.port) && socketPort.aliases?.includes('motor_drive_socket') && socketPort.shape === 'square' && socketPort.faces?.join() === '+y', JSON.stringify(socketPort));
  const shaftDetails = (await call('get_part_details', { partQuery: '4x Pitch Motor Shaft' })).data;
  const shaftPoint = shaftDetails.connections.find((c) => c.kind === 'shaft');
  check('4x Pitch Motor Shaft details: its shaft point with both ends and the stop ring', shaftPoint?.ends?.length === 2 && shaftPoint.stop?.kind === 'stop_ring', JSON.stringify(shaftPoint));
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
  // Capped shaft local z: plain end at -49.02, cap at 0; after insert its plain end should be at the socket bottom (y ≈ -8.6)
  const { buildWorldMatrix } = await import('../mcp/assembly-engine.mjs');
  const plainEnd = axleInst && new THREE.Vector3(0, 0, -49.02).applyMatrix4(buildWorldMatrix(axleInst.position, axleInst.rotation));
  check(
    'Insert a 4x Pitch Capped Shaft into the motor socket: reaches the socket bottom, seated with the motor',
    axle && axle.status === 'placed' && plainEnd && Math.abs(plainEnd.y + 8.6) < 0.6 && Math.abs(plainEnd.x + 9.525) < 0.01 && jointOf(a, 'Axle').includes('Motor'),
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

  // e. Parts that fit more than one way list the others (otherFits), and flip picks one
  const brain = mk('Brain', 'VEX IQ Robot Brain Gen 1', [0, 69.9, 0]);
  const cornerItem = (insert = {}) => [{ partQuery: 'Double 2x Wide, 1x2 Corner Connector', label: 'Corner', insert: { sourcePort: 'peg_1', into: { instanceId: 'Brain', port: 'brain_right_mount_8@lo' }, ...insert } }];
  res = await fresh([brain], cornerItem(), { dryRun: true });
  const corner = res.data?.parts?.[0];
  check(
    'A corner connector pushed into the brain lists its one other fit: turned end for end (upside down)',
    corner?.otherFits?.length === 1 && corner.otherFits[0].flip === true && /other way/.test(corner.otherFitsNote || ''),
    JSON.stringify(corner)
  );
  res = await fresh([brain], cornerItem({ flip: true }), { dryRun: true });
  const flipped = res.data?.parts?.[0];
  check(
    '  insert.flip places it that way, and the reply lists no others once a choice is made',
    flipped?.status === 'placed' && !flipped.otherFits && JSON.stringify(flipped.rotation) === JSON.stringify(corner?.otherFits?.[0]?.rotation),
    JSON.stringify(flipped)
  );
  res = await fresh([beam], [{ partQuery: '1x1 Connector Pin', label: 'P', insert: { into: { instanceId: 'Beam', port: 'hole_3' }, fromSide: '+' } }], { dryRun: true });
  check('  a 1x1 pin (same either way) lists no other fits', res.data?.parts?.[0]?.status === 'placed' && !res.data.parts[0].otherFits, JSON.stringify(res.data?.parts?.[0]));
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
// mirror_subassembly: the Speedbot's left side mirrored gives a sound right side
// ---------------------------------------------------------------------------
{
  const { starterById } = await import('../src/starters.js');
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
  const speedbot = starterById('speedbot').build(catalog);
  const withoutRight = speedbot.filter((i) => !/ R( \d)?$/.test(i.label));
  writeState({ ...emptyState(), instances: withoutRight });
  const leftIds = withoutRight.filter((i) => / L( \d)?$/.test(i.label)).map((i) => i.instanceId);
  const res = await call('mirror_subassembly', { instanceIds: leftIds, mirrorPlane: 'Z', planeOffsetMm: 0 });
  const audit = (await call('audit_assembly')).data;
  const labels = (res.data?.mirroredInstances || []).map((i) => i.label);
  check(
    'mirror_subassembly of the Speedbot\'s left side: sound, no overlaps, both motors drive, offset connector and collars held',
    res.data?.mirroredCount === leftIds.length && audit.isMechanicallySound && audit.collisionCount === 0 && audit.unsecuredPartCount === 0 && audit.kinematics.drivenWheelCount === 2,
    JSON.stringify({ n: res.data?.mirroredCount, collisions: audit.collisionCount, unsecured: audit.unsecuredParts, driven: audit.kinematics.drivenWheelCount })
  );
  check(
    '  labels swap L for R (no "(Mirrored)", no front/rear swap)',
    labels.includes('Offset Connector R') && labels.includes('Rear Collar R') && labels.every((l) => / R( \d)?$/.test(l)),
    JSON.stringify(labels)
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
// Explode panel (openspec explode-view): open or closed, and the slider value
// ---------------------------------------------------------------------------
{
  writeState({ ...emptyState(), instances: [mk('Beam', '1x6 Beam', [0, 0, 0])] });
  let res = await call('configure_viewport', { explodeMode: 'all', explodeAmount: 0.5 });
  let vp = readState().viewport;
  check('configure_viewport opens Explode at the given slider value', !res.isError && vp.explodeMode === 'all' && vp.explodeAmount === 0.5, JSON.stringify(vp));
  await call('configure_viewport', { explodeMode: 'off' });
  await call('configure_viewport', { explodeMode: 'all' });
  vp = readState().viewport;
  check('explodeMode alone sets the slider to 1', vp.explodeMode === 'all' && vp.explodeAmount === 1, JSON.stringify(vp));
  await call('configure_viewport', { showGrid: true });
  vp = readState().viewport;
  check('other viewport calls keep Explode open at its slider value', vp.explodeMode === 'all' && vp.explodeAmount === 1, JSON.stringify(vp));
  await call('configure_viewport', { explodeMode: 'off' });
  check("explodeMode 'off' closes the panel", readState().viewport.explodeMode === 'off');
  res = await call('configure_viewport', { explodeAmount: 2 });
  check('an explodeAmount outside 0..1 is refused', res.isError && /explodeAmount must be a number from 0 to 1/.test(res.data?.error || ''), JSON.stringify(res.data));
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
// Gear meshing and square shafts (openspec gear-meshing-and-square-shafts)
// ---------------------------------------------------------------------------
{
  const { worldFeaturesFor } = await import('../mcp/assembly-engine.mjs');
  const { squareFitRoll, hubFlatDir } = await import('../src/utils/shaftGroups.js');

  // get_part_details returns the measured data
  const g24 = (await call('get_part_details', { partQuery: '24 Tooth Gear' })).data;
  const rack = (await call('get_part_details', { partQuery: '1x6 Linear Motion Rack Gear' })).data;
  const motorDetails = (await call('get_part_details', { partQuery: 'VEX IQ Smart Motor' })).data;
  check(
    'get_part_details returns measured tooth data, rack data and the motor hub',
    g24?.gearSpecs?.measured === true && Number.isFinite(g24.gearSpecs.toothPhaseDeg) && rack?.rackSpecs?.measured === true && motorDetails?.hubSpecs?.radiusMm > 0,
    JSON.stringify({ g: g24?.gearSpecs, r: rack?.rackSpecs, h: motorDetails?.hubSpecs })
  );

  // A 12-36-60 train along a 1x20 Beam audits with no overlaps between the gears
  writeState(emptyState());
  const beamId = (await call('place_part', { partQuery: '1x20 Beam', label: 'Train Beam', position: [0, 0, 0] })).data?.instance?.instanceId;
  const firstHole = findPart('1x20 Beam').ports.filter((p) => p.type === 'pin_hole').sort((a, b) => a.origin[0] - b.origin[0])[0];
  const train = await call('mesh_gear_train', {
    supportBeamId: beamId,
    startPortId: firstHole.portId,
    gears: ['12 Tooth Gear', '36 Tooth Gear', '60 Tooth Gear'],
    axialOffsetMm: 12.7
  });
  const audit = (await call('audit_assembly')).data;
  const gearLabels = new Set((train.data?.placedGears || []).map((g) => g.instance.label));
  const gearClashes = (audit?.collisions || []).filter((c) => gearLabels.has(c.label) && c.collidingWith.some((w) => gearLabels.has(w)));
  check(
    'mesh_gear_train: a 12-36-60 train meshes each gear with the previous one, and the audit finds no overlaps between them',
    train.data?.gearsPlacedCount === 3 && gearClashes.length === 0 && train.data.placedGears.slice(1).every((g) => g.meshedWith),
    JSON.stringify({ clashes: gearClashes, rolls: train.data?.placedGears?.map((g) => [g.rollDeg, g.meshedWith]) })
  );

  // place_parts: a 24T gear slid down an axle (rollDeg 3) beside a 48T gear: the roll is replaced
  writeState(emptyState());
  await call('place_parts', {
    parts: [
      { ref: 'axleA', partQuery: '4x Pitch Shaft', label: 'Axle A', position: [0, 0, 0] },
      { ref: 'big', partQuery: '48 Tooth Gear', label: '48 Tooth Gear #1', position: [0, 0, 0] },
      { ref: 'stop', partQuery: '1x2 Beam', label: 'Stop Beam', position: [38.1, 0, -6.225] },
      { ref: 'axleB', partQuery: '4x Pitch Shaft', label: 'Axle B', position: [38.1, 0, 0] }
    ]
  });
  const ids = Object.fromEntries(readState().instances.map((i) => [i.label, i.instanceId]));
  const placedGear = await call('place_parts', {
    parts: [{ partQuery: '24 Tooth Gear', label: '24 Tooth Gear #1', insert: { into: { instanceId: ids['Axle B'], port: 'shaft' }, fromSide: '+', rollDeg: 3 } }]
  });
  const gearPart = placedGear.data?.parts?.[0];
  const savedGear = readState().instances.find((i) => i.label === '24 Tooth Gear #1');
  const gearAudit = (await call('audit_assembly')).data;
  const gearOverlaps = (gearAudit?.collisions || []).filter((c) => c.label === '24 Tooth Gear #1');
  check(
    'place_parts: a rollDeg 3 gear in mesh range is placed at its meshing turn and the reply says the roll was changed',
    Boolean(gearPart?.rollReplaced) && (gearPart?.notes || []).some((n) => /^Meshed 24 Tooth Gear #1 with 48 Tooth Gear #1/.test(n)) && Math.abs(savedGear?.position?.[2] ?? 99) < 2 && gearOverlaps.length === 0,
    JSON.stringify({ gearPart, pos: savedGear?.position, gearOverlaps })
  );

  // An axle turned 30° into a Smart Motor: the axle keeps its angle, the hub turns to fit it
  writeState(emptyState());
  const motorId = (await call('place_part', { partQuery: 'VEX IQ Smart Motor', label: 'Hub Motor', position: [0, 0, 0] })).data?.instance?.instanceId;
  const asm0 = (await call('get_assembly')).data;
  check('get_assembly shows a Smart Motor without a saved hub angle at socketAngleDeg 0', asm0?.instances?.find((i) => i.instanceId === motorId)?.socketAngleDeg === 0);
  const axleRes = await call('place_parts', {
    parts: [{ partQuery: '4x Pitch Shaft', label: 'Motor Axle', insert: { into: { instanceId: motorId, port: 'motor_drive_socket' }, rollDeg: 30 } }]
  });
  const afterAxle = readState();
  const motorAfter = afterAxle.instances.find((i) => i.instanceId === motorId);
  const axleAfter = afterAxle.instances.find((i) => i.label === 'Motor Axle');
  const socket = worldFeaturesFor(motorAfter).find((f) => f.kind === 'shaft_socket');
  const shaft = axleAfter && worldFeaturesFor(axleAfter).find((f) => f.kind === 'shaft');
  const misfit = shaft ? squareFitRoll(shaft, socket, hubFlatDir(socket, motorAfter.socketAngleDeg || 0)) : null;
  check(
    'place_parts: an axle into a Smart Motor keeps its roll and sets the motor\'s socketAngleDeg to fit it',
    !axleRes.data?.parts?.[0]?.rollReplaced && Number.isFinite(motorAfter?.socketAngleDeg) && motorAfter.socketAngleDeg !== 0 && Math.abs(misfit) < 0.05,
    JSON.stringify({ reply: axleRes.data?.parts?.[0], hub: motorAfter?.socketAngleDeg, misfit })
  );
  const hubAngle = motorAfter?.socketAngleDeg;
  await call('undo');
  const undone = readState().instances.find((i) => i.instanceId === motorId);
  await call('redo');
  const redone = readState().instances.find((i) => i.instanceId === motorId);
  check(
    'undo puts the hub back at 0; redo turns it again',
    (Number(undone?.socketAngleDeg) || 0) === 0 && redone?.socketAngleDeg === hubAngle,
    JSON.stringify({ undone: undone?.socketAngleDeg, redone: redone?.socketAngleDeg, hubAngle })
  );
  const asm1 = (await call('get_assembly')).data;
  check('get_assembly shows the turned hub angle', asm1?.instances?.find((i) => i.instanceId === motorId)?.socketAngleDeg === hubAngle);
}

// ---------------------------------------------------------------------------
// App settings: linear history and the assistant turned off (openspec app-settings, mcp-app-link)
// ---------------------------------------------------------------------------
{
  writeSettings({ advanced: false, history: 'linear', mcpEnabled: true });
  writeState(emptyState());
  await call('place_part', { partQuery: '1x6 Beam', label: 'L1', position: [0, 0, 0] });
  await call('place_part', { partQuery: '1x6 Beam', label: 'L2', position: [0, 30, 0] });
  await call('undo');
  const res = await call('place_part', { partQuery: '1x6 Beam', label: 'L3', position: [0, 60, 0] });
  const line = currentLine(readState().history).map((st) => st.label);
  check(
    'linear history: an MCP change after undo drops the undone step and reports no branch',
    readState().history.steps.length === 2 && !res.data?.historyNote && line.join('|') === 'place_part: L1|place_part: L3',
    JSON.stringify({ steps: readState().history.steps.map((st) => st.label), note: res.data?.historyNote })
  );

  writeSettings({ advanced: false, history: 'linear', mcpEnabled: false });
  const before = fs.readFileSync(statePath, 'utf8');
  const refused = await callRaw('place_part', { partQuery: '1x6 Beam', label: 'Off', position: [0, 90, 0] });
  check(
    'assistant off: place_part refuses with the Settings message and changes nothing',
    refused.isError && /turned off in the app's Settings/.test(refused.data?.error || '') && fs.readFileSync(statePath, 'utf8') === before,
    JSON.stringify(refused.data)
  );
  const undoRefused = await callRaw('undo');
  check('assistant off: undo refuses too', undoRefused.isError && fs.readFileSync(statePath, 'utf8') === before);
  const viewRefused = await callRaw('configure_viewport', { showGrid: false });
  check('assistant off: configure_viewport refuses', viewRefused.isError);
  const asm = await callRaw('get_assembly');
  check('assistant off: get_assembly still answers', !asm.isError && asm.data?.instanceCount === 2, JSON.stringify(asm.data)?.slice(0, 120));
  const found = await callRaw('search_parts', { query: 'beam' });
  check('assistant off: search_parts still answers', !found.isError);

  writeSettings({ advanced: false, history: 'linear', mcpEnabled: true });
  const back = await call('place_part', { partQuery: '1x6 Beam', label: 'On', position: [0, 120, 0] });
  check('assistant back on: place_part works again', back.data?.ok && readState().instances.some((i) => i.label === 'On'));
}

// ---------------------------------------------------------------------------
// outliner-part-groups: select_parts, group_parts, ungroup_parts, update_group, remove_part groupId
// ---------------------------------------------------------------------------
{
  const { jointGraph } = await import('../mcp/assembly-engine.mjs');
  const { connectedFrom } = await import('../src/utils/jointLayers.js');
  writeSettings({ advanced: true, history: 'branches', mcpEnabled: true });
  // A stack: Beam, two pins pushed in from above, a second beam (Top) on their ends below; two spare beams and a loose one
  writeState({ ...emptyState(), instances: [mk('Beam', '1x6 Beam', [0, 0, 0])] });
  await call('place_parts', {
    parts: [
      { partQuery: '0x2 Connector Pin', ref: 'p1', label: 'Pin1', insert: { into: { instanceId: 'Beam', port: 'hole_1' }, fromSide: '+' } },
      { partQuery: '0x2 Connector Pin', ref: 'p6', label: 'Pin6', insert: { into: { instanceId: 'Beam', port: 'hole_6' }, fromSide: '+' } }
    ]
  });
  const st0 = readState();
  st0.instances.push(mk('Top', '1x6 Beam', [0, 0, -6.35]), mk('SpareA', '1x6 Beam', [0, 100, 0]), mk('SpareB', '1x6 Beam', [0, 120, 0]), mk('Loose', '1x6 Beam', [0, 140, 0]));
  writeState(st0);
  const idOf = (label) => readState().instances.find((i) => i.label === label)?.instanceId;
  const labelsOf = (ids) => ids.map((id) => readState().instances.find((i) => i.instanceId === id)?.label).sort().join(',');
  const pin1 = idOf('Pin1');
  const pin6 = idOf('Pin6');
  const audit0 = (await call('audit_assembly')).data;
  check('groups fixture: both pins seated in Beam and Top', ['Pin1', 'Pin6'].every((l) => jointOf(audit0, l).sort().join() === 'Beam,Top'), JSON.stringify(audit0.joints));

  // select_parts
  let res = await call('select_parts', { instanceIds: ['Beam'], expandLayers: 1 });
  check('select_parts expandLayers 1 from a beam: the beam and its pins only', labelsOf(res.data?.selected.map((x) => x.instanceId) || []) === 'Beam,Pin1,Pin6', JSON.stringify(res.data));
  res = await call('select_parts', { instanceIds: ['Beam'], expandLayers: 2 });
  check('select_parts expandLayers 2 adds the part the pins go into', labelsOf(res.data.selected.map((x) => x.instanceId)) === 'Beam,Pin1,Pin6,Top');
  res = await call('select_parts', { instanceIds: ['Top'], connected: true });
  const appWay = connectedFrom(jointGraph(readState()), ['Top']);
  check('select_parts connected: same parts as the app\'s Select Connected', labelsOf(res.data.selected.map((x) => x.instanceId)) === labelsOf(appWay) && appWay.length === 4, labelsOf(appWay));
  check('select_parts writes the selection with the primary last', readState().selectedIds.length === 4 && readState().selectedId === res.data.primaryId);
  // A beam lying against the side of the pinned stack only touches it: joined for the audit's clamp
  // rule, but not for Shift+Ctrl+wheel (pinned only)
  {
    const side = { ...mk('Side', '1x6 Beam', [0, 12.7, -3.175]), instanceId: 'Side' };
    const touching = { ...readState(), instances: [...readState().instances, side] };
    const linked = (g, a, b) => g.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    const all = jointGraph(touching);
    const pinned = jointGraph(touching, { pinnedOnly: true });
    check('joint graph: a beam that only touches a pinned stack is joined to it', linked(all, 'Side', 'Beam') || linked(all, 'Side', 'Top'), JSON.stringify(all.edges.filter((e) => e.includes('Side'))));
    check('joint graph pinnedOnly: the touching beam has no joins', !pinned.edges.some((e) => e.includes('Side')), JSON.stringify(pinned.edges.filter((e) => e.includes('Side'))));
    check('joint graph pinnedOnly: pins still join the stack', labelsOf(connectedFrom(pinned, ['Top'])) === labelsOf(appWay), labelsOf(connectedFrom(pinned, ['Top'])));
  }
  const selBefore = JSON.stringify(readState().selectedIds);
  res = await callRaw('select_parts', { instanceIds: ['Beam', 'Nope'] });
  check('select_parts refuses unknown ids by name, selection unchanged', res.isError && /Nope/.test(res.data?.error) && JSON.stringify(readState().selectedIds) === selBefore, JSON.stringify(res.data));
  res = await callRaw('select_parts', { instanceIds: ['Beam'], connected: true, expandLayers: 1 });
  check('select_parts refuses connected with expandLayers', res.isError);
  await call('select_parts', { mode: 'all' });
  check('select_parts all: every visible part', readState().selectedIds.length === 7);
  await call('select_parts', { instanceIds: ['Beam', 'Top'] });
  await call('select_parts', { mode: 'invert' });
  check('select_parts invert', labelsOf(readState().selectedIds) === 'Loose,Pin1,Pin6,SpareA,SpareB');
  await call('select_parts', { mode: 'remove', instanceIds: ['Loose'] });
  await call('select_parts', { mode: 'add', instanceIds: ['Beam'] });
  check('select_parts add/remove', labelsOf(readState().selectedIds) === 'Beam,Pin1,Pin6,SpareA,SpareB' && readState().selectedId === 'Beam');
  await call('select_parts', { mode: 'none' });
  check('select_parts none', readState().selectedIds.length === 0 && readState().selectedId === null);

  // group_parts / get_assembly groups
  res = await callRaw('group_parts', { instanceIds: ['Beam'] });
  check('group_parts with one part is refused', res.isError && /two or more/.test(res.data?.error));
  await call('select_parts', { instanceIds: ['Beam', pin1, pin6, 'Top'] });
  res = await call('group_parts', { name: 'Stack' });
  const stackId = res.data?.groupId;
  check('group_parts groups the selection and selects the group', res.data?.ok && res.data.instanceIds.length === 4 && readState().selectedIds.length === 4 && readState().instances.filter((i) => i.groupId === stackId).length === 4, JSON.stringify(res.data));
  check('  one step labeled with the group', readState().history.steps.at(-1).label === 'group_parts: Group 4 parts as Stack', readState().history.steps.at(-1).label);
  res = await call('group_parts', { instanceIds: ['SpareA', 'SpareB'] });
  const sparesId = res.data?.groupId;
  check('group_parts default name Group 1', res.data?.name === 'Group 1');
  let asm = (await call('get_assembly')).data;
  check('get_assembly lists two groups with parts and centres, loose part has no group', asm.groups.length === 2 && asm.groups.every((g) => g.instanceIds.length >= 2 && g.centre.length === 3) && !asm.instances.find((i) => i.label === 'Loose').groupId && asm.selectedIds.length === 2, JSON.stringify(asm.groups));
  res = await call('select_parts', { instanceIds: ['Top'] });
  check('select_parts on a grouped part selects its whole group', res.data.count === 4 && res.data.groups[0]?.name === 'Stack' && res.data.primaryId === 'Top');
  res = await call('select_parts', { instanceIds: ['Top'], expandGroups: false });
  check('select_parts expandGroups false picks just the part', res.data.count === 1);

  // Regroup and undo
  await call('group_parts', { instanceIds: ['SpareA', 'Loose'], name: 'Mixed' });
  asm = (await call('get_assembly')).data;
  check('regroup: SpareA leaves Group 1, which is dissolved with one part left', asm.groups.map((g) => g.name).sort().join() === 'Mixed,Stack' && !asm.instances.find((i) => i.label === 'SpareB').groupId);
  await call('undo');
  asm = (await call('get_assembly')).data;
  check('one undo puts Group 1 back', asm.groups.map((g) => g.name).sort().join() === 'Group 1,Stack');

  // update_part keeps the group (8.1)
  await call('update_part', { instanceId: 'Top', color: '#ff0000' });
  check('update_part on a grouped part keeps its group', readState().instances.find((i) => i.label === 'Top').groupId === stackId);

  // update_group: turn keeps pins seated, move, rename, lock
  const centre0 = (await call('get_assembly')).data.groups.find((g) => g.id === stackId).centre;
  res = await call('update_group', { groupId: stackId, turn: { axis: 'Y', deg: 90 } });
  const audit1 = (await call('audit_assembly')).data;
  check('update_group turn 90° about Y: pins still seated in both beams', res.data?.ok && ['Pin1', 'Pin6'].every((l) => jointOf(audit1, l).sort().join() === 'Beam,Top') && res.data.audit.floatingFastenerCount === 0 && res.data.audit.halfSeatedFastenerCount === 0, JSON.stringify(res.data?.audit));
  // The turn goes about a point on the set's hole grid near its centre, so the centre moves at most a half-pitch diagonal
  check('  centre stays near and the step is labeled', res.data.centre.every((v, k) => Math.abs(v - centre0[k]) <= 6.35 * Math.SQRT2 + 0.05) && readState().history.steps.at(-1).label === 'update_group: Turn Stack', JSON.stringify([res.data.centre, centre0, readState().history.steps.at(-1).label]));
  // Three more quarter turns about Y come back to the start (group-snapping: the pivot is on the hole grid)
  const before4 = readState().instances.filter((i) => i.groupId === stackId).map((i) => i.position);
  for (let k = 0; k < 4; k++) await call('update_group', { groupId: stackId, turn: { axis: 'Y', deg: 90 } });
  const after4 = readState().instances.filter((i) => i.groupId === stackId).map((i) => i.position);
  check('update_group: four 90° turns about Y return every part to where it was', after4.every((p, k) => p.every((v, a) => Math.abs(v - before4[k][a]) < 0.01)), JSON.stringify([before4, after4]));
  const centreBeforeMove = (await call('get_assembly')).data.groups.find((g) => g.id === stackId).centre;
  const zBefore = readState().instances.filter((i) => i.groupId === stackId).map((i) => i.position[2]);
  res = await call('update_group', { groupId: stackId, moveBy: [0, 0, 25.4] });
  const zAfter = readState().instances.filter((i) => i.groupId === stackId).map((i) => i.position[2]);
  check('update_group moveBy moves every part 25.4 mm along Z in one step', zAfter.every((z, k) => Math.abs(z - zBefore[k] - 25.4) < 1e-6) && Math.abs(res.data.centre[2] - centreBeforeMove[2] - 25.4) < 0.05);
  // Whole 0.5P steps (the saved snap) from where it is, the nearest to the given centre
  const c1 = (await call('get_assembly')).data.groups.find((g) => g.id === stackId).centre;
  const target = [c1[0] + 2 * 6.35 + 2, c1[1] - 6.35 - 2, c1[2] + 2];
  res = await call('update_group', { groupId: stackId, moveCentreTo: target });
  const moved = res.data.centre.map((v, k) => v - c1[k]);
  check('update_group moveCentreTo 2 mm off a step lands on whole steps', [12.7, -6.35, 0].every((v, k) => Math.abs(moved[k] - v) < 0.01), JSON.stringify({ moved, centre: res.data.centre }));
  res = await call('update_group', { groupId: stackId, name: 'Claw' });
  check('update_group renames', (await call('get_assembly')).data.groups.some((g) => g.name === 'Claw'));
  res = await callRaw('update_group', { groupId: stackId, name: '  ' });
  check('update_group refuses an empty name', res.isError);
  await call('update_group', { groupId: stackId, locked: true });
  const lockedState = fs.readFileSync(statePath, 'utf8');
  res = await callRaw('update_group', { groupId: stackId, moveBy: [10, 0, 0] });
  check('update_group refuses to move a locked set and changes nothing', res.isError && res.data?.error === 'Part is locked' && fs.readFileSync(statePath, 'utf8') === lockedState);
  res = await call('update_group', { instanceIds: ['SpareB', 'Loose'], moveBy: [0, 0, 12.7] });
  check('update_group on loose parts moves them as one, labeled by count', res.data?.ok && readState().history.steps.at(-1).label === 'update_group: Move 2 parts');

  // mirror copies come out ungrouped
  await call('update_group', { groupId: stackId, locked: false });
  await call('mirror_subassembly', { instanceIds: ['Top'], mirrorPlane: 'Y', planeOffsetMm: 300 });
  check('mirror_subassembly copies of a grouped part are in no group', readState().instances.filter((i) => i.groupId === stackId).length === 4);

  // remove_part groupId, ungroup_parts
  res = await callRaw('remove_part', { instanceId: 'Loose', groupId: sparesId });
  check('remove_part refuses instanceId with groupId', res.isError);
  res = await callRaw('remove_part', { groupId: 'group-nope' });
  check('remove_part refuses an unknown group', res.isError);
  const countBefore = readState().instances.length;
  res = await call('remove_part', { groupId: sparesId });
  check('remove_part groupId removes the whole group in one step', res.data?.ok && readState().instances.length === countBefore - 2 && readState().history.steps.at(-1).label === 'remove_part: Delete Group 1', readState().history.steps.at(-1).label);
  await call('undo');
  check('  one undo brings them back', readState().instances.length === countBefore);
  res = await call('ungroup_parts', { groupId: stackId });
  check('ungroup_parts dissolves the group and moves nothing', res.data?.ok && readState().instances.every((i) => i.groupId !== stackId) && readState().history.steps.at(-1).label === 'ungroup_parts: Ungroup Claw');
  res = await callRaw('ungroup_parts', { instanceIds: ['Loose'] });
  check('ungroup_parts on ungrouped parts is refused', res.isError);
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// chain-track-builder: sprocket tooth data, build_chain
// ---------------------------------------------------------------------------
{
  const s16 = (await call('get_part_details', { partQuery: '16 Tooth Sprocket' })).data;
  check(
    'get_part_details returns measured sprocket tooth data',
    s16?.gearSpecs?.measured === true && s16.gearSpecs.teeth === 16 && Math.abs(s16.gearSpecs.pitchRadiusMm - 16.27) < 0.02,
    JSON.stringify(s16?.gearSpecs)
  );
  const link = (await call('get_part_details', { partQuery: 'Chain Link' })).data;
  check('get_part_details returns chain link data', link?.chainSpecs?.role === 'chain_link' && link.gearSpecs === null, JSON.stringify(link?.chainSpecs));

  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'catalog.json'), 'utf8'));
  const cat = Array.isArray(catalog) ? catalog : catalog.parts || Object.values(catalog);
  const partId = (name) => cat.find((p) => p.name === name).id;
  const part = (instanceId, name, position) => ({ instanceId, partId: partId(name), label: instanceId, position, rotation: [0, 0, 0], visible: true });
  writeState({ ...emptyState(), instances: [part('S16', '16 Tooth Sprocket', [0, 0, 0]), part('S32', '32 Tooth Sprocket', [101.6, 0, 0]), part('G36', '36 Tooth Gear', [0, 80, 0])] });
  let res = await callRaw('build_chain', { instanceIds: ['G36', 'S16'] });
  check('build_chain refuses gears with one sprocket', res.isError && /sprockets, not gears/.test(res.data?.error), JSON.stringify(res.data));
  res = await call('build_chain', { kind: 'track', instanceIds: ['S16', 'S32', 'G36'] });
  const st = readState();
  const members = st.instances.filter((i) => i.groupId === res.data?.groupId);
  check(
    'build_chain track: a "Track 1" group of tread links and grippers, selected',
    res.data?.ok && res.data.name === 'Track 1' && members.length === res.data.linkCount + res.data.gripperCount && res.data.gripperCount === res.data.linkCount && st.selectedIds?.length === members.length,
    JSON.stringify({ ...res.data, audit: undefined })
  );
  check('  the reply gives the gap and the sprockets on the loop', typeof res.data?.gapMm === 'number' && res.data.onLoop.length === 2 && res.data.leftOut.length === 0);
  check('  one history step labeled with what was built', /^build_chain: Track builder: \d+ tread links and \d+ grippers round 2 sprockets$/.test(st.history.steps.at(-1).label), st.history.steps.at(-1).label);
  const groupIds = new Set(members.map((m) => m.instanceId));
  const audit = (await call('audit_assembly')).data;
  const auditOf = audit.audit || audit;
  const unsecured = (auditOf.unsecuredParts || []).filter((u) => groupIds.has(u.instanceId));
  const chainCollisions = (auditOf.collisions || []).filter((c) => groupIds.has(c.instanceId));
  check('  the audit counts the track as held, with no collisions and no islands from it', unsecured.length === 0 && chainCollisions.length === 0 && auditOf.disconnectedIslandCount === 1, JSON.stringify({ unsecured: unsecured.length, chainCollisions: chainCollisions.length, islands: auditOf.disconnectedIslandCount }));
  await call('undo');
  check('  one undo removes the whole track', readState().instances.length === 3);
  res = await call('build_chain', { instanceIds: ['S16', 'S32'] });
  check('build_chain chain: a "Chain 1" group', res.data?.ok && res.data.name === 'Chain 1' && res.data.gripperCount === 0, JSON.stringify(res.data?.name));
  await call('undo');
  res = await call('build_chain', { instanceIds: ['S16', 'S32'], slack: 'upper' });
  check('build_chain slack "upper": the reply says the upper run holds the slack', res.data?.ok && res.data.slack === 'upper', JSON.stringify(res.data?.slack));
  res = await callRaw('build_chain', { instanceIds: ['S16', 'S32'], slack: 'middle' });
  check('build_chain rejects an unknown slack run', res.isError && /slack must be "lower" or "upper"/.test(res.data?.error || ''), JSON.stringify(res.data));
  await call('undo');
  res = await call('build_chain', { kind: 'track', instanceIds: ['S16', 'S32'], attachment: 'long-flap', attachmentEvery: 4 });
  check(
    'build_chain track with Long Intake Flaps every 4th link: the reply counts them and the message names them',
    res.data?.ok && res.data.attachment === 'long-flap' && res.data.attachmentEvery === 4 && res.data.attachmentCount === Math.ceil(res.data.linkCount / 4) && res.data.gripperCount === 0 && /Long Intake Flaps \(every 4th link\)/.test(res.data.message),
    JSON.stringify({ ...res.data, audit: undefined })
  );
  await call('undo');
  res = await callRaw('build_chain', { kind: 'track', instanceIds: ['S16', 'S32'], attachment: 'paddle' });
  check('build_chain rejects an unknown attachment', res.isError && /attachment must be/.test(res.data?.error || ''), JSON.stringify(res.data));
  res = await callRaw('build_chain', { kind: 'track', instanceIds: ['S16', 'S32'], attachment: 'traction', attachmentEvery: 0 });
  check('build_chain rejects a spacing outside 1-20', res.isError && /from 1 to 20/.test(res.data?.error || ''), JSON.stringify(res.data));

  // chain-over-under: enclosed parts, route, needsRoute, standoffs, wrapped & leftOut shape
  writeState({
    ...emptyState(),
    instances: [
      part('S24L', '24 Tooth Sprocket', [0, 0, 0]),
      part('S24R', '24 Tooth Sprocket', [120, 0, 0]),
      part('S8', '8 Tooth Sprocket', [45, 10, 0]),
      part('ST1', '1x Pitch Standoff', [80, -8, 6])
    ]
  });
  res = await callRaw('build_chain', { kind: 'chain', instanceIds: ['S24L', 'S24R', 'S8', 'ST1'] });
  check(
    'build_chain without route for enclosed parts refuses with needsRoute',
    res.isError && Array.isArray(res.data?.needsRoute) && res.data.needsRoute.length === 2,
    JSON.stringify(res.data)
  );
  res = await call('build_chain', { kind: 'track', instanceIds: ['S24L', 'S24R', 'S8'] });
  check(
    'build_chain track leaves enclosed sprocket out with reason outside-only',
    res.data?.ok && res.data.leftOut?.length === 1 && res.data.leftOut[0].instanceId === 'S8' && res.data.leftOut[0].reason === 'outside-only',
    JSON.stringify(res.data?.leftOut)
  );
  await call('undo');
  res = await call('build_chain', {
    kind: 'chain',
    instanceIds: ['S24L', 'S24R', 'S8', 'ST1'],
    route: { S8: 'under', ST1: 'over' }
  });
  check(
    'build_chain with route wraps enclosed sprocket under and standoff over',
    res.data?.ok &&
      res.data.wrapped?.some((w) => w.instanceId === 'S8' && w.side === 'under') &&
      res.data.wrapped?.some((w) => w.instanceId === 'ST1' && w.side === 'over') &&
      res.data.audit?.collisionCount === 0,
    JSON.stringify({ wrapped: res.data?.wrapped, audit: res.data?.audit })
  );
}

// ---------------------------------------------------------------------------
// Tight fits (openspec tight-fits): Herobot Flop's tower pivot standoff, 0.53 mm off a beam hole
{
  await call('clear_assembly');
  const beam = { partQuery: '228-2500-015', ref: 'beam', label: 'Pivot Beam', position: [-125.074, 57.616, -41.275], rotation: [0, 0, -20.863] };
  const standoff = { partQuery: '228-2500-064', ref: 'standoff', label: 'Pivot Standoff', position: [-225.425, 96.15, -31.755], rotation: [0, 0, -169.284] };
  let res = await call('place_parts', { parts: [beam, standoff], rejectIntersecting: true });
  const item = res.data?.parts?.find((p) => p.ref === 'standoff');
  check(
    'place_parts: a tight-fit item is placed, saved under rejectIntersecting, with the beam in its tightFits',
    res.data?.saved && item?.status === 'placed' && item.tightFits?.includes('Pivot Beam') && !item.overlaps,
    JSON.stringify(res.data?.parts)
  );
  check('  the audit summary counts the tight fit, not an overlap', res.data?.audit?.collisionCount === 0 && res.data?.audit?.tightFitCount >= 1, JSON.stringify(res.data?.audit));
  const id = item?.instanceId;
  res = await call('update_part', { instanceId: id, position: standoff.position });
  check('update_part: the reply lists the tight fit and the part is not overlapping', res.data?.ok && !res.data.isIntersecting && res.data.tightFits?.includes('Pivot Beam'), JSON.stringify(res.data?.tightFits));
  await call('remove_part', { instanceId: id });
  res = await call('place_part', { partQuery: '228-2500-064', label: 'Pivot Standoff', position: standoff.position, rotation: standoff.rotation });
  check('place_part: placed solid with the tight fit listed', res.data?.placed && res.data.tightFits?.includes('Pivot Beam'), JSON.stringify({ placed: res.data?.placed, tightFits: res.data?.tightFits }));
}

// ---------------------------------------------------------------------------
server.stdin.end();
server.kill();
await stopBridge().catch(() => {});
fs.rmSync(tmpDir, { recursive: true, force: true });
check('public/assembly-state.json is untouched', sha(REAL_STATE) === realStateBefore);
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
