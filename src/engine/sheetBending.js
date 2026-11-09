/**
 * Bend sheet (openspec shaped-parts-and-sheet-bending): where a plastic sheet can be anchored to
 * another part's holes, and bending it there. Shared by the app's engine (actions.js) and the MCP
 * server. The bend itself is the `sheet-bend` shape (src/utils/sheetBend.js); this file works out
 * held rows, anchor choices, stacking, clearance, and moves the pins in the sheet's moving rows.
 */
import * as THREE from 'three';
import {
  buildWorldMatrix,
  checkCandidateCollision,
  getCatalog,
  getWorldPortsForInstance,
  jointGraph,
  getPartRawGeometry,
  partOf
} from './core.js';
import {
  MAX_STRETCH_MM,
  MIN_BEND_RADIUS_MM,
  ROW_PITCH_MM,
  STACK_GAP_MM,
  bendCurve,
  isPlasticSheet,
  reachPiece,
  seriesPieces,
  solvePiece,
  sheetFrame,
  sheetRows
} from '../utils/sheetBend.js';
import { normalizeShape, shapeError } from '../utils/shapedParts.js';
import { quaternionToEulerDeg } from '../utils/gearMeshing.js';

const MAX_TURN_COS = -0.9; // the sheet may turn up to about 155° between the held row and the anchored one
const ROW_MATCH_MM = 1; // sheet holes and target holes line up along the row this closely
const PARALLEL_DEG = 3; // a target line this far off the bend line would need a twist
const HELD_LINE_MM = 0.5; // a sheet hole counts as held when another part's hole or pin is this close to its line
const HELD_ALONG_MM = 8; // ... and this close along it
const FACE_MATCH_MM = 1.5; // a sheet already lying on the face, for stacking

const v3 = (a) => new THREE.Vector3(...a);
const quatOf = (rot) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((d) => THREE.MathUtils.degToRad(d || 0)), 'XYZ'));

/** The sheet's frame: world <-> its own coordinates (the catalog part's, whatever its bend). */
function sheetSpace(inst) {
  const m = buildWorldMatrix(inst.position, inst.rotation);
  const inv = m.clone().invert();
  const q = quatOf(inst.rotation);
  const qi = q.clone().invert();
  return {
    toLocal: (p) => v3(p).applyMatrix4(inv).toArray(),
    dirToLocal: (d) => v3(d).applyQuaternion(qi).toArray(),
    toWorld: (p) => v3(p).applyMatrix4(m).toArray(),
    dirToWorld: (d) => v3(d).applyQuaternion(q).toArray()
  };
}

const coaxial = (a, b) => {
  const ax = v3(a.worldAxis);
  if (Math.abs(ax.dot(v3(b.worldAxis))) < 0.995) return null;
  const d = v3(b.worldOrigin).sub(v3(a.worldOrigin));
  const along = d.dot(ax);
  const line = Math.sqrt(Math.max(0, d.lengthSq() - along * along));
  return { line, along };
};

const nearBox = (a, b, margin) => {
  const boxOf = (inst) => {
    const part = partOf(inst);
    if (!part?.bbox) return null;
    const m = buildWorldMatrix(inst.position, inst.rotation);
    return new THREE.Box3(v3(part.bbox.min), v3(part.bbox.max)).applyMatrix4(m).expandByScalar(margin);
  };
  const ba = boxOf(a);
  const bb = boxOf(b);
  return Boolean(ba && bb && ba.intersectsBox(bb));
};

/** Ids of the sheet's holes that another part's hole or pin goes through: Map(portId -> [instanceId]). */
function heldHoles(state, sheet) {
  const sheetPorts = getWorldPortsForInstance(sheet).filter((p) => p.type === 'pin_hole');
  const held = new Map();
  for (const other of state.instances) {
    if (other.instanceId === sheet.instanceId || other.visible === false || !nearBox(sheet, other, 10)) continue;
    const ports = getWorldPortsForInstance(other);
    for (const sp of sheetPorts) {
      for (const op of ports) {
        const c = coaxial(sp, op);
        if (!c || c.line > HELD_LINE_MM || Math.abs(c.along) > HELD_ALONG_MM) continue;
        if (!held.has(sp.portId)) held.set(sp.portId, new Set());
        held.get(sp.portId).add(other.instanceId);
      }
    }
  }
  return held;
}

/**
 * The ways a sheet can bend from where it is held: [{ across, from, held, lastRow, prev }], `prev`
 * being the last held or anchored row's point and direction in the (across, y) plane.
 */
function bendStarts(state, sheet) {
  const base = getCatalog().catalogById.get(sheet.partId);
  if (sheet.shape) {
    const s = sheet.shape;
    const rows = sheetRows(base, s.across, s.from);
    const lastRow = Math.max(0, ...(s.held || []), ...(s.anchors || []).map((a) => a.row));
    const curve = bendCurve(base, s);
    const lastS = rows.find((r) => r.row === lastRow)?.s ?? 0;
    const here = curve.at(lastS);
    return { starts: [{ across: s.across, from: s.from, held: s.held, lastRow, prev: { s: lastS, p: here.p, t: here.t }, shape: s }] };
  }
  const held = heldHoles(state, sheet);
  if (!held.size) return { starts: [], reason: 'Pin one row of the sheet first: none of its holes has a pin or another part\'s hole in it.' };
  const starts = [];
  for (const across of ['z', 'x']) {
    for (const from of ['min', 'max']) {
      const rows = sheetRows(base, across, from);
      const heldRows = rows.filter((r) => r.ports.some((p) => held.has(p.portId))).map((r) => r.row);
      const lastRow = Math.max(...heldRows);
      if (lastRow >= rows.length) continue; // nothing past the held rows to bend
      // Held rows must be at this end: every row before the last held one stays flat anyway
      const f = sheetFrame(base, across, from);
      const s = rows.find((r) => r.row === lastRow).s;
      starts.push({ across, from, held: heldRows, lastRow, prev: { s, p: [f.edge + s * f.sign, f.mid], t: [f.sign, 0] } });
    }
  }
  // Prefer the directions with the most free rows per held row, but keep every way that works
  starts.sort((a, b) => a.held.length - b.held.length || a.lastRow - b.lastRow);
  return { starts, reason: starts.length ? null : 'The sheet is held on rows at both ends, so there is nothing free to bend.' };
}

/**
 * A target part's pin holes as lines (holes sharing a direction that lie on one straight line), in
 * world space, each line sorted along itself. The line holding the most holes is taken first, so a
 * beam's rows come out as rows whatever order its holes are listed in.
 */
function holeLines(target) {
  const holes = getWorldPortsForInstance(target).filter((p) => p.type === 'pin_hole');
  const lines = [];
  const groups = [];
  for (const h of holes) {
    const g = groups.find((x) => coaxial(x[0], h));
    if (g) g.push(h);
    else groups.push([h]);
  }
  for (const group of groups) {
    let left = group.slice();
    while (left.length) {
      let best = null;
      for (let i = 0; i < left.length && left.length > 1; i++) {
        for (let j = i + 1; j < left.length; j++) {
          const a = v3(left[i].worldOrigin);
          const dir = v3(left[j].worldOrigin).sub(a);
          if (dir.length() < 0.01) continue;
          dir.normalize();
          const on = left.filter((h) => {
            const d = v3(h.worldOrigin).sub(a);
            return d.clone().sub(dir.clone().multiplyScalar(d.dot(dir))).length() < 0.5;
          });
          if (!best || on.length > best.on.length) best = { on, dir };
        }
      }
      if (!best) {
        lines.push({ holes: [left[0]] });
        left = left.slice(1);
        continue;
      }
      best.on.sort((x, y) => v3(x.worldOrigin).dot(best.dir) - v3(y.worldOrigin).dot(best.dir));
      lines.push({ holes: best.on });
      left = left.filter((h) => !best.on.includes(h));
    }
  }
  return lines;
}

// The two faces round a hole (world points on its axis): rays along the axis round the hole, out to
// half a pitch from it, from each side to where they first meet the part; the outermost hit on each
// side, since a flat sheet rests on a beam's raised rails rather than round the hole itself
const RIM_OFFSETS_MM = [4.5, 5.5, 6.2];
function holeFaces(target, hole) {
  const part = partOf(target);
  const m = buildWorldMatrix(target.position, target.rotation);
  const inv = m.clone().invert();
  const local = part.ports.find((p) => p.portId === hole.portId);
  const o = v3(local.origin);
  const ax = v3(local.axis).normalize();
  const geo = getPartRawGeometry(part);
  const side = Math.abs(ax.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const p1 = side.clone().sub(ax.clone().multiplyScalar(side.dot(ax))).normalize();
  const p2 = ax.clone().cross(p1);
  const offsets = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    for (const r of RIM_OFFSETS_MM) offsets.push(p1.clone().multiplyScalar(Math.cos(a) * r).addScaledVector(p2, Math.sin(a) * r));
  }
  const ray = new THREE.Ray();
  const faceAlong = (dir) => {
    let best = null;
    for (const off of offsets) {
      ray.set(o.clone().add(off).addScaledVector(dir, 60), dir.clone().negate());
      const hit = geo.boundsTree.raycastFirst(ray, THREE.DoubleSide);
      if (!hit || hit.distance > 60 + 30) continue;
      const t = hit.point.clone().sub(o).dot(dir);
      if (best === null || t > best) best = t;
    }
    return best;
  };
  const hi = faceAlong(ax);
  const lo = faceAlong(ax.clone().negate());
  const ai = local.axis.map(Math.abs).indexOf(Math.max(...local.axis.map(Math.abs)));
  const tHi = hi ?? part.bbox.max[ai] * Math.sign(local.axis[ai]) - o.dot(ax);
  const tLo = lo !== null ? -lo : part.bbox.min[ai] * Math.sign(local.axis[ai]) - o.dot(ax);
  return [tLo, tHi].map((t) => o.clone().addScaledVector(ax, t).applyMatrix4(m).toArray());
}

// Other sheets already lying on a face at a hole: how many layers the new sheet goes on top of
function stackLayers(state, sheet, hole, facePoint, outward) {
  let layers = 0;
  for (const other of state.instances) {
    if (other.instanceId === sheet.instanceId || other.visible === false) continue;
    const part = partOf(other);
    if (!isPlasticSheet(part)) continue;
    for (const p of getWorldPortsForInstance(other).filter((q) => q.type === 'pin_hole')) {
      const c = coaxial(hole, p);
      if (!c || c.line > HELD_LINE_MM) continue;
      const out = v3(p.worldOrigin).sub(v3(facePoint)).dot(v3(outward));
      if (out > -0.1 && out < FACE_MATCH_MM + layers * (part.bbox.size[1] + STACK_GAP_MM)) layers++;
    }
  }
  return layers;
}

const faceName = (outward) => {
  const [x, y, z] = outward;
  const big = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
  if (big === Math.abs(y)) return y > 0 ? 'upper face' : 'lower face';
  if (big === Math.abs(x)) return x > 0 ? 'front face' : 'back face';
  return z > 0 ? '+Z side face' : '-Z side face';
};

/** Pins and other inserts seated in the sheet's holes: Map(instanceId -> portId of the sheet hole). */
function partsInSheetHoles(state, sheet) {
  const sheetPorts = getWorldPortsForInstance(sheet).filter((p) => p.type === 'pin_hole');
  const found = new Map();
  for (const other of state.instances) {
    if (other.instanceId === sheet.instanceId || other.visible === false) continue;
    const part = partOf(other);
    if (part?.category !== 'Pins & Standoffs' || !nearBox(sheet, other, 2)) continue;
    for (const op of getWorldPortsForInstance(other).filter((p) => p.type === 'pin_peg')) {
      for (const sp of sheetPorts) {
        const c = coaxial(sp, op);
        if (c && c.line <= HELD_LINE_MM && Math.abs(c.along) <= HELD_ALONG_MM && !found.has(other.instanceId)) found.set(other.instanceId, sp.portId);
      }
    }
  }
  return found;
}

/**
 * Every way the sheet can be anchored to the target: { choices, reasons, leftOut } with each choice
 * { id, name, row, face, missMm, stretchMm, bending, shape }. `reasons` explains rows that were
 * refused (twist, out of reach, too tight); `leftOut` counts choices that would hit a part.
 */
export function sheetBendChoices(state, { sheetId, targetId, sheetPortId = null, targetPortId = null }) {
  const sheet = state.instances.find((i) => i.instanceId === sheetId);
  const target = state.instances.find((i) => i.instanceId === targetId);
  if (!sheet || !target) return { ok: false, error: 'Select a plastic sheet and the part to anchor it to.' };
  const base = getCatalog().catalogById.get(sheet.partId);
  if (!isPlasticSheet(base)) {
    if (isPlasticSheet(getCatalog().catalogById.get(target.partId))) return sheetBendChoices(state, { sheetId: targetId, targetId: sheetId, sheetPortId: targetPortId, targetPortId: sheetPortId });
    return { ok: false, error: 'Only plastic sheets can be bent: select a 2x12, 6x6 or 6x12 Plastic Sheet and the part to anchor it to.' };
  }
  const { starts, reason } = bendStarts(state, sheet);
  if (!starts.length) return { ok: true, choices: [], reasons: [reason], leftOut: [] };

  const space = sheetSpace(sheet);
  // Marked holes (hole by hole bending): only the marked hole's row, and the picked hole's line
  if (sheetPortId && !getWorldPortsForInstance(sheet).some((p) => p.portId === sheetPortId && p.type === 'pin_hole')) return { ok: false, error: `${sheet.label} has no hole ${sheetPortId}.` };
  const pickedHole = targetPortId ? getWorldPortsForInstance(target).find((p) => p.portId === targetPortId && p.type === 'pin_hole') : null;
  if (targetPortId && !pickedHole) return { ok: false, error: `${target.label} has no hole ${targetPortId}.` };
  let lines = holeLines(target);
  if (pickedHole) lines = lines.filter((l) => l.holes.some((h) => h.portId === targetPortId));
  const reasons = new Set();
  const raw = [];
  const searches = new Map(); // row|face -> inputs for the longer search (hole by hole bending only)
  const keyReasons = new Map(); // row|face -> why the plain bends failed
  for (const start of starts) {
    const f = sheetFrame(base, start.across, start.from);
    const allRows = sheetRows(base, start.across, start.from);
    let rows = allRows.filter((r) => r.row > start.lastRow);
    if (sheetPortId) {
      const markedRow = allRows.find((r) => r.ports.some((p) => p.portId === sheetPortId));
      if (markedRow && markedRow.row <= start.lastRow) {
        reasons.add(`The marked hole is in row ${markedRow.row}, which is already held or anchored: mark a hole in a row further along.`);
        continue;
      }
      rows = rows.filter((r) => r === markedRow);
    }
    const w = [0, 0, 0];
    w[f.wi] = 1; // the bend line, in the sheet's frame
    for (const line of lines) {
      const axisL = space.dirToLocal(line.holes[0].worldAxis);
      if (Math.abs(axisL[f.wi]) > Math.sin(THREE.MathUtils.degToRad(PARALLEL_DEG))) {
        // Holes nearly square to the bend line but a few degrees off: the sheet would have to twist
        if (Math.abs(axisL[f.wi]) < 0.5) reasons.add(`${target.label}: its holes aren't parallel to the sheet's rows, so the sheet would have to twist.`);
        continue;
      }
      const holesL = line.holes.map((h) => ({ h, p: space.toLocal(h.worldOrigin) }));
      if (holesL.length > 1) {
        const ends = [holesL[0].p, holesL.at(-1).p];
        const dir = v3(ends[1]).sub(v3(ends[0])).normalize();
        if (Math.abs(dir.toArray()[f.wi]) < Math.cos(THREE.MathUtils.degToRad(PARALLEL_DEG))) {
          reasons.add(`${target.label}: its holes aren't parallel to the sheet's rows, so the sheet would have to twist.`);
          continue;
        }
      }
      const n2 = (() => {
        const v = [axisL[f.ai], axisL[1]];
        const l = Math.hypot(v[0], v[1]);
        return [v[0] / l, v[1] / l];
      })();
      // Each face the sheet could lie on
      const faces = holeFaces(target, line.holes[0]);
      for (const [fi, faceW] of faces.entries()) {
        const other = faces[1 - fi];
        const outwardW = v3(faceW).sub(v3(other)).normalize().toArray();
        const layers = stackLayers(state, sheet, line.holes[0], faceW, outwardW);
        const offset = layers * (f.thickness + STACK_GAP_MM) + f.thickness / 2;
        const faceL = space.toLocal(v3(faceW).add(v3(outwardW).multiplyScalar(offset)).toArray());
        const P1 = [faceL[f.ai], faceL[1]];
        for (const row of rows) {
          // Sheet holes in this row against the target's holes along the bend line
          const targetW = holesL.map((x) => x.p[f.wi]);
          const lo = Math.min(...targetW) - ROW_MATCH_MM;
          const hi = Math.max(...targetW) + ROW_MATCH_MM;
          // The sheet doesn't slide along its row: the marked hole has to be (nearly) across from the picked one
          if (sheetPortId) {
            const marked = row.ports.find((p) => p.portId === sheetPortId);
            const pickedAt = space.toLocal(pickedHole.worldOrigin)[f.wi];
            const gap = marked.origin[f.wi] - pickedAt;
            if (Math.abs(gap) > ROW_MATCH_MM) {
              const holes = Math.round(Math.abs(gap) / ROW_PITCH_MM);
              reasons.add(`The marked sheet hole is ${Math.abs(gap).toFixed(1)} mm (about ${holes} hole${holes === 1 ? '' : 's'}) along the row from the hole you picked on ${target.label}, and the sheet can't slide. Pick the hole on ${target.label} directly across from the marked one, or mark a sheet hole in line with it.`);
              continue;
            }
          }
          const onTarget = row.ports.filter((p) => p.origin[f.wi] >= lo && p.origin[f.wi] <= hi);
          if (!onTarget.length) {
            reasons.add(`Sheet row ${row.row} → ${target.label}: no hole of that row is in line with the part's holes.`);
            continue;
          }
          const offs = onTarget.map((p) => Math.min(...targetW.map((t) => Math.abs(t - p.origin[f.wi]))));
          if (offs.some((o) => o > ROW_MATCH_MM)) {
            reasons.add(`Sheet row ${row.row} → ${target.label}: the holes of that row and the part's holes aren't the same distance apart, so they can't line up.`);
            continue;
          }
          const alongMiss = Math.max(...offs);
          const L = row.s - start.prev.s;
          const key = `${row.row}|${faceName(outwardW)}|${start.across}|${start.from}`;
          for (const sg of [1, -1]) {
            const t1 = [-n2[1] * sg, n2[0] * sg];
            // How this row and face are anchored with a given piece (variant 0: the plain bend)
            const build = (piece, stretch, variant) => {
              const anchor = { row: row.row, at: P1, dir: t1, stretch, on: target.label, ...(variant ? { variant } : {}) };
              const shape = normalizeShape({
                kind: 'sheet-bend',
                across: start.across,
                from: start.from,
                held: start.held,
                anchors: [...(start.shape?.anchors || []), anchor]
              });
              return { holesMatched: onTarget.length, row: row.row, face: faceName(outwardW), layers, missMm: Math.max(stretch, alongMiss), stretchMm: stretch, alongMm: alongMiss, bending: piece.bending, shape, variant, targetPorts: line.holes.map((h) => h.portId) };
            };
            // The longer search (S-bends, loops) is kept for when no plain bend works for this row and face
            if (sheetPortId) {
              if (!searches.has(key)) searches.set(key, []);
              searches.get(key).push({ p0: start.prev.p, t0: start.prev.t, P1, t1, L, build });
            }
            if (t1[0] * start.prev.t[0] + t1[1] * start.prev.t[1] < MAX_TURN_COS) continue; // arriving backwards
            const reached = reachPiece(start.prev.p, start.prev.t, P1, t1, L);
            if (reached.error) {
              if (!keyReasons.has(key)) keyReasons.set(key, new Set());
              keyReasons.get(key).add(Number.isFinite(reached.shortMm)
                ? `Sheet row ${row.row} → ${target.label}, ${faceName(outwardW)}: out of reach by ${reached.shortMm.toFixed(1)} mm.`
                : `Sheet row ${row.row} → ${target.label}, ${faceName(outwardW)}: the sheet would have to bend too tightly.`);
              continue;
            }
            raw.push(build(reached.piece, reached.stretch, 0));
          }
        }
      }
    }
  }

  // For each row and face, try the ways of arriving in order (most holes lined up, then the gentlest
  // bend) and keep the first that doesn't run into a part: the gentlest may be a hump over the part
  const byKey = new Map();
  for (const c of raw) {
    const key = `${c.row}|${c.face}|${c.shape.across}|${c.shape.from}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(c);
  }
  const visible = state.instances.filter((i) => i.visible !== false);
  const pinned = partsInSheetHoles(state, sheet);
  const choices = [];
  const leftOut = [];
  // Does the sheet bent as `c` clear the other parts up to its anchored row? (past it is only noted)
  const tryOne = (c) => {
    const candidate = { ...sheet, shape: c.shape };
    const nowPinned = partsInSheetHoles({ instances: visible }, candidate);
    const ignore = new Set([...pinned.keys(), ...nowPinned.keys()]);
    const others = visible.filter((i) => !ignore.has(i.instanceId) && i.instanceId !== sheet.instanceId);
    const upTo = checkCandidateCollision({ ...sheet, shape: { ...c.shape, trimAfterRow: c.row } }, others);
    if (upTo.isIntersecting) return { hit: upTo.collidingWith[0]?.label || 'a part' };
    c.pastRowHits = checkCandidateCollision(candidate, others).collidingWith.map((x) => x.label);
    return { ok: true };
  };
  const SEARCH_TESTS = 30; // clearance checks the longer search may spend on one row and face
  const searchStop = Date.now() + 8000;
  const allKeys = new Set([...byKey.keys(), ...searches.keys()]);
  for (const key of allKeys) {
    const tries = (byKey.get(key) || []).sort((x, y) => y.holesMatched - x.holesMatched || x.bending - y.bending);
    let first = null;
    let chosen = null;
    for (const c of tries) {
      const res = tryOne(c);
      if (res.ok) {
        chosen = c;
        break;
      }
      first ||= { row: c.row, face: c.face, hits: res.hit };
    }
    // No plain bend works: search for S-bends and loops that do (only when the holes were picked)
    let searched = false;
    if (!chosen && searches.has(key) && Date.now() < searchStop) {
      searched = true;
      const pool = [];
      for (const input of searches.get(key)) {
        seriesPieces(input.p0, input.t0, input.P1, input.t1, input.L).forEach((piece, i) => pool.push({ piece, variant: i + 1, input }));
      }
      pool.sort((x, y) => x.piece.bending - y.piece.bending);
      for (const { piece, variant, input } of pool.slice(0, SEARCH_TESTS)) {
        const c = input.build(piece, 0, variant);
        const res = tryOne(c);
        if (res.ok) {
          c.searched = true;
          chosen = c;
          break;
        }
        first ||= { row: c.row, face: c.face, hits: res.hit };
      }
    }
    if (chosen) choices.push(chosen);
    else {
      if (first) leftOut.push(first);
      for (const r of keyReasons.get(key) || []) reasons.add(r);
      if (searched) {
        const [row, face] = key.split('|');
        reasons.add(`Sheet row ${row} → ${target.label}, ${face}: even bending it in an S or a loop, no path of that length clears the other parts.`);
      }
    }
  }
  choices.sort((a, b) => (sheetPortId ? b.holesMatched - a.holesMatched : 0) || a.missMm - b.missMm || a.bending - b.bending);
  const several = new Set(choices.map((c) => `${c.shape.across}|${c.shape.from}`)).size > 1;
  choices.forEach((c, i) => {
    c.id = `choice-${i + 1}`;
    const off = c.stretchMm ? `, stretched ${c.stretchMm.toFixed(1)} mm` : c.alongMm > 0.05 ? `, ${c.alongMm.toFixed(1)} mm off along the row` : '';
    c.name = `sheet row ${c.row} → ${target.label}, ${c.face}${c.layers ? ` (on top of ${c.layers} sheet${c.layers > 1 ? 's' : ''})` : ''}${several ? `, bending across ${c.shape.across} from the ${c.shape.from} edge` : ''}${off}${sheetPortId ? `, ${c.holesMatched} hole${c.holesMatched === 1 ? '' : 's'} line up` : ''}`;
    if (c.searched) c.note = `${c.note ? `${c.note} ` : ''}This bend goes first one way and then back (found by a longer search), so the sheet clears the other parts.`;
    if (c.pastRowHits.length) c.note = `${c.note ? `${c.note} ` : ''}Past row ${c.row} the sheet still runs into ${c.pastRowHits.join(', ')}: anchor a later row to bend it clear.`;
  });
  for (const l of leftOut) reasons.add(`Sheet row ${l.row} → ${target.label}, ${l.face}: the sheet would pass through ${l.hits}.`);
  return { ok: true, sheetId: sheet.instanceId, targetId: target.instanceId, choices, reasons: [...reasons], leftOut };
}

// The rigid move that takes a sheet hole from its old pose to its new one (about the bend line)
function holeMove(oldPort, newPort) {
  const q = new THREE.Quaternion().setFromUnitVectors(v3(oldPort.worldAxis).normalize(), v3(newPort.worldAxis).normalize());
  return { q, from: v3(oldPort.worldOrigin), to: v3(newPort.worldOrigin) };
}

function movePose(inst, move) {
  const p = v3(inst.position).sub(move.from).applyQuaternion(move.q).add(move.to);
  const q = move.q.clone().multiply(quatOf(inst.rotation));
  return { position: p.toArray().map((n) => Number(n.toFixed(3)) + 0), rotation: quaternionToEulerDeg(q).map((n) => Number(n.toFixed(3)) + 0) };
}

/** Moves the pins in the sheet's holes from the old sheet's holes to the new sheet's. */
function carryPins(state, oldSheet, newSheet) {
  const pinned = partsInSheetHoles(state, oldSheet);
  const oldPorts = new Map(getWorldPortsForInstance(oldSheet).map((p) => [p.portId, p]));
  const newPorts = new Map(getWorldPortsForInstance(newSheet).map((p) => [p.portId, p]));
  const moved = new Map();
  for (const [id, portId] of pinned) {
    const a = oldPorts.get(portId);
    const b = newPorts.get(portId);
    if (!a || !b) continue;
    if (v3(a.worldOrigin).distanceTo(v3(b.worldOrigin)) < 0.005 && v3(a.worldAxis).dot(v3(b.worldAxis)) > 0.99999) continue;
    const inst = state.instances.find((i) => i.instanceId === id);
    moved.set(id, movePose(inst, holeMove(a, b)));
  }
  return moved;
}

// A target held only by this sheet: every part pinned to it is a pin that only joins it to the sheet
function heldOnlyBySheet(state, target, sheet) {
  const { edges } = jointGraph(state, { pinnedOnly: true });
  const nbr = (id) => edges.filter((e) => e.includes(id)).map((e) => (e[0] === id ? e[1] : e[0]));
  return nbr(target.instanceId).every((n) => {
    if (n === sheet.instanceId) return true;
    const part = partOf(state.instances.find((i) => i.instanceId === n));
    return part?.category === 'Pins & Standoffs' && nbr(n).every((m) => m === target.instanceId || m === sheet.instanceId);
  });
}

/**
 * Bends the sheet: applies a choice (by `choice` id or name, or `sheetRow` with an optional `face`),
 * moves the pins in its moving rows, and with `moveTarget` moves a target only this sheet holds onto
 * the nearest reachable spot. `flatten` removes the bend. Returns the action reply.
 */
export function bendSheet(state, { sheetId, targetId = null, choice = null, sheetRow = null, face = null, moveTarget = false, flatten = false, sheetPortId = null, targetPortId = null }) {
  let sheet = state.instances.find((i) => i.instanceId === sheetId);
  if (sheet && !isPlasticSheet(getCatalog().catalogById.get(sheet.partId)) && targetId) {
    const other = state.instances.find((i) => i.instanceId === targetId);
    if (other && isPlasticSheet(getCatalog().catalogById.get(other.partId))) [sheetId, targetId, sheet] = [targetId, sheetId, other];
  }
  if (!sheet) return { ok: false, error: 'No such sheet.' };
  const finish = (newSheet, extraMoves = new Map(), message) => {
    const moves = carryPins(state, sheet, newSheet);
    for (const [id, pose] of extraMoves) moves.set(id, pose);
    const instances = state.instances.map((i) => (i.instanceId === sheet.instanceId ? newSheet : moves.has(i.instanceId) ? { ...i, ...moves.get(i.instanceId), lastValidPosition: moves.get(i.instanceId).position } : i));
    return {
      ok: true,
      state: { ...state, instances, updatedAt: new Date().toISOString() },
      movedIds: [...moves.keys()],
      message,
      record: true,
      stepLabel: `${flatten ? 'Flatten' : 'Bend'} ${sheet.label}`
    };
  };
  if (flatten) {
    if (!sheet.shape) return { ok: false, error: `${sheet.label} isn't bent.` };
    const { shape, ...flat } = sheet;
    return finish(flat, new Map(), `Flattened ${sheet.label}.`);
  }
  const target = state.instances.find((i) => i.instanceId === targetId);
  if (!target) return { ok: false, error: 'Select the part to anchor the sheet to.' };
  const found = sheetBendChoices(state, { sheetId, targetId, sheetPortId, targetPortId });
  if (!found.ok) return found;
  const byHole = Boolean(sheetPortId && !choice && !sheetRow);
  const pick = byHole ? found.choices[0] : found.choices.find((c) => (choice && (c.id === choice || c.name === choice)) || (!choice && sheetRow && c.row === Number(sheetRow) && (!face || c.face.startsWith(face))));
  if (pick) {
    const err = shapeError(getCatalog().catalogById.get(sheet.partId), pick.shape);
    if (err) return { ok: false, error: err };
    const done = finish({ ...sheet, shape: pick.shape }, new Map(), `Bent ${sheet.label}: ${pick.name}.`);
    return { ...done, holesMatched: pick.holesMatched };
  }
  if (moveTarget && sheetRow) {
    if (!heldOnlyBySheet(state, target, sheet)) return { ok: false, error: `${target.label} is held by other parts too, so it can't be moved to the sheet.` };
    const moved = moveTargetToSheet(state, sheet, target, Number(sheetRow), face);
    if (moved.error) return { ok: false, error: moved.error };
    const next = { ...state, instances: state.instances.map((i) => (i.instanceId === target.instanceId ? { ...i, ...moved.pose } : i)) };
    const again = bendSheet(next, { sheetId, targetId, sheetRow, face });
    if (!again.ok) return again;
    const instances = again.state.instances.map((i) => (i.instanceId === target.instanceId ? { ...i, lastValidPosition: i.position } : i));
    return { ...again, state: { ...again.state, instances }, movedIds: [...again.movedIds, target.instanceId], message: `Moved ${target.label} ${moved.distance.toFixed(1)} mm to the sheet. ${again.message}` };
  }
  const why = found.reasons.length ? found.reasons.join(' ') : 'No row of the sheet lines up with that part.';
  return { ok: false, error: choice || sheetRow ? `That choice isn't available. ${why}` : `Name a choice. ${why}`, choices: found.choices.map(({ id, name, row, face: f, missMm }) => ({ id, name, row, face: f, missMm })) };
}

/**
 * Where a target only this sheet holds must move so the sheet's row reaches it: the target moves
 * straight towards the sheet's previous row until the sheet is long enough.
 */
function moveTargetToSheet(state, sheet, target, row, face) {
  const base = getCatalog().catalogById.get(sheet.partId);
  const { starts } = bendStarts(state, sheet);
  const space = sheetSpace(sheet);
  for (const start of starts) {
    const f = sheetFrame(base, start.across, start.from);
    const r = sheetRows(base, start.across, start.from).find((x) => x.row === row);
    if (!r) continue;
    const L = r.s - start.prev.s;
    for (const line of holeLines(target)) {
      const axisL = space.dirToLocal(line.holes[0].worldAxis);
      if (Math.abs(axisL[f.wi]) > 0.05) continue;
      const faces = holeFaces(target, line.holes[0]);
      for (const [fi, faceW] of faces.entries()) {
        const outwardW = v3(faceW).sub(v3(faces[1 - fi])).normalize().toArray();
        if (face && !faceName(outwardW).startsWith(face)) continue;
        const faceL = space.toLocal(v3(faceW).add(v3(outwardW).multiplyScalar(f.thickness / 2)).toArray());
        const P1 = [faceL[f.ai], faceL[1]];
        const n2 = [axisL[f.ai], axisL[1]];
        const t1 = [-n2[1], n2[0]];
        // Shrink the gap until a curve of the sheet's length fits
        let lo = 0;
        let hi = 1;
        const at = (k) => [start.prev.p[0] + (P1[0] - start.prev.p[0]) * k, start.prev.p[1] + (P1[1] - start.prev.p[1]) * k];
        const fits = (k) => [t1, [-t1[0], -t1[1]]].some((t) => !solvePiece(start.prev.p, start.prev.t, at(k), t, L).error);
        if (fits(1)) return { error: 'The sheet already reaches that part.' };
        if (!fits(0.3)) continue;
        lo = 0.3;
        for (let i = 0; i < 30; i++) {
          const m = (lo + hi) / 2;
          if (fits(m)) lo = m;
          else hi = m;
        }
        const P = at(lo);
        const deltaL = [0, 0, 0];
        deltaL[f.ai] = P[0] - P1[0];
        deltaL[1] = P[1] - P1[1];
        const deltaW = space.dirToWorld(deltaL);
        const position = target.position.map((v, i) => Number((v + deltaW[i]).toFixed(3)) + 0);
        return { pose: { position }, distance: Math.hypot(...deltaW) };
      }
    }
  }
  return { error: `Couldn't find a spot for ${target.label} that sheet row ${row} reaches.` };
}

// --- Laying a sheet on its pins and bending it through the rest (the CAD import) ---

const isPin = (part) => part?.category === 'Pins & Standoffs';
const pegOf = (pin) => getWorldPortsForInstance(pin).find((p) => p.type === 'pin_peg') || null;

/** The parts (not pins, not sheets) whose holes a pin goes into: [{ inst, hole }]. */
function holdersOf(state, pin) {
  const peg = pegOf(pin);
  if (!peg) return [];
  const found = [];
  for (const other of state.instances) {
    if (other.instanceId === pin.instanceId || other.visible === false) continue;
    const part = partOf(other);
    if (!part || isPin(part) || isPlasticSheet(part) || !nearBox(pin, other, 2)) continue;
    for (const h of getWorldPortsForInstance(other).filter((p) => p.type === 'pin_hole')) {
      const c = coaxial(peg, h);
      if (c && c.line <= HELD_LINE_MM && Math.abs(c.along) <= 10) {
        found.push({ inst: other, hole: h });
        break;
      }
    }
  }
  return found;
}

/**
 * A flat sheet laid on two rows of pins, `row1` (its edge row) and `row2` (the next), each a list of
 * pin instances held by another part: the sheet lies on the holder's face on the pins' side, with its
 * rows running along the pins' line, slid along the row so every held pin is in one of its holes.
 * Tries the bend running across either sheet axis. Returns { position, rotation, across } or null.
 */
export function layFlatOnPins(state, sheetPart, row1, row2) {
  const p1 = row1[0];
  const p2 = row2[0];
  const h1 = holdersOf(state, p1)[0];
  const h2 = holdersOf(state, p2)[0];
  if (!h1 || !h2) return null;
  const ax = v3(h1.hole.worldAxis).normalize();
  const out = ax.clone().multiplyScalar(Math.sign(v3(p1.position).sub(v3(h1.hole.worldOrigin)).dot(ax)) || 1);
  const mid = sheetPart.bbox.size[1] / 2;
  // On the holder's face on the pins' side: the opening end farthest out
  const onFace = (holder) => {
    const ends = holeFaces(holder.inst, holder.hole).map(v3);
    const face = ends.reduce((a, b) => (b.dot(out) > a.dot(out) ? b : a));
    return face.addScaledVector(out, mid);
  };
  // The face most of the held pins agree on (a pin in a thin flange can mislead on its own)
  const offsets = [...row1, ...row2]
    .map((pin) => holdersOf(state, pin)[0])
    .filter(Boolean)
    .map((h) => Math.round(onFace(h).dot(out) * 10) / 10);
  const counts = new Map();
  for (const o of offsets) counts.set(o, (counts.get(o) || 0) + 1);
  const plane = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0])[0][0];
  const toPlane = (p) => p.clone().addScaledVector(out, plane - p.dot(out));
  const P1 = toPlane(v3(h1.hole.worldOrigin));
  const P2 = toPlane(v3(h2.hole.worldOrigin));
  // Across the rows: row 1 to row 2, without any part along the rows (the pins of a row give its line)
  const across = P2.clone().sub(P1);
  across.sub(out.clone().multiplyScalar(across.dot(out)));
  const rowWith2 = row1.length > 1 ? row1 : row2.length > 1 ? row2 : null;
  if (rowWith2) {
    const line = v3(rowWith2[1].position).sub(v3(rowWith2[0].position));
    line.sub(out.clone().multiplyScalar(line.dot(out))).normalize();
    across.sub(line.multiplyScalar(across.dot(line)));
  }
  across.normalize();
  const allPins = [...row1, ...row2];
  const gapTo = (sheet, pin) => {
    const peg = pegOf(pin);
    return Math.min(...getWorldPortsForInstance(sheet).filter((p) => p.type === 'pin_hole').map((p) => {
      const d = v3(peg.worldOrigin).sub(v3(p.worldOrigin));
      const a = v3(p.worldAxis);
      return d.sub(a.multiplyScalar(d.dot(a))).length();
    }));
  };
  for (const acrossAxis of ['z', 'x']) {
    // Sheet axes: y = out, the bend runs along `acrossAxis` from row 1 to row 2
    const yW = out.clone();
    const aW = across.clone();
    const xW = acrossAxis === 'z' ? yW.clone().cross(aW).normalize() : aW.clone();
    const zW = acrossAxis === 'z' ? aW.clone() : xW.clone().cross(yW).normalize();
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xW, yW, zW));
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    const rotation = [e.x, e.y, e.z].map((r) => Number(THREE.MathUtils.radToDeg(r).toFixed(4)) + 0);
    const rows = sheetRows(sheetPart, acrossAxis, 'min');
    const ai2 = acrossAxis === 'z' ? 2 : 0;
    const wi = acrossAxis === 'z' ? 0 : 2;
    const wW = wi === 0 ? xW : zW;
    const row1Local = [0, mid, 0];
    row1Local[ai2] = rows[0].ports[0].origin[ai2];
    const base = P1.clone().sub(v3(row1Local).applyQuaternion(q));
    for (const hole of rows[0].ports) {
      const at = v3(hole.origin).applyQuaternion(q).add(base);
      const shift = wW.clone().multiplyScalar(v3(p1.position).sub(at).dot(wW));
      const sheet = { instanceId: '__lay__', partId: sheetPart.id, position: base.clone().add(shift).toArray().map((n) => Number(n.toFixed(4)) + 0), rotation };
      if (allPins.every((pin) => gapTo(sheet, pin) < 0.3)) return { position: sheet.position, rotation, across: acrossAxis };
    }
  }
  return null;
}

/**
 * A sheet bent through the pins that hold it, as VEX CAD has it (openspec shaped-parts-and-sheet-bending,
 * cad-import): the pins are grouped into rows along the bend; two neighbouring rows on one flat holder
 * become the held rows (the sheet laid flat on them), and each later row within the sheet's reach is
 * anchored to the part its pins go into, as Bend sheet would. Sheets already bent in `state` are
 * stacked on. Returns { position, rotation, shape, anchored: [{ row, on, stretchMm }], unanchored:
 * [{ on, reason }] } or { error }.
 */
export function bendSheetOnPins(state, { sheetPartId, label = 'sheet', pinIds }) {
  const sheetPart = getCatalog().catalogById.get(sheetPartId);
  const pins = pinIds.map((id) => state.instances.find((i) => i.instanceId === id)).filter((p) => p && pegOf(p));
  if (pins.length < 2) return { error: `${label}: fewer than two pins to lay it on` };
  // The bend line: square to every pin's axis
  const axes = pins.map((p) => v3(pegOf(p).worldAxis).normalize());
  let L = null;
  for (let i = 0; i < axes.length && !L; i++) {
    for (let j = i + 1; j < axes.length; j++) {
      if (Math.abs(axes[i].dot(axes[j])) < 0.995) {
        L = axes[i].clone().cross(axes[j]).normalize();
        break;
      }
    }
  }
  if (!L) return { error: `${label}: its pins all point the same way, so it isn't bent` };
  // Rows: pins with one axis direction on one line along the bend line, in the plane square to it
  const U = axes[0].clone().sub(L.clone().multiplyScalar(axes[0].dot(L))).normalize();
  const V = L.clone().cross(U);
  const to2 = (p) => [v3(p).dot(U), v3(p).dot(V)];
  const groups = [];
  for (const [k, pin] of pins.entries()) {
    const peg = pegOf(pin);
    const q = to2(peg.worldOrigin);
    const n = to2(peg.worldAxis);
    const g = groups.find((x) => Math.abs(x.n[0] * n[0] + x.n[1] * n[1]) > 0.999 && Math.hypot(x.q[0] - q[0], x.q[1] - q[1]) < 0.8);
    if (g) g.pins.push(pin);
    else groups.push({ q, n: [n[0] / Math.hypot(...n), n[1] / Math.hypot(...n)], pins: [pin], axis: axes[k] });
  }
  const rowsCount = sheetRows(sheetPart, 'z', 'min').length;
  let best = null;
  for (const a of groups) {
    for (const b of groups) {
      if (a === b || Math.abs(a.n[0] * b.n[0] + a.n[1] * b.n[1]) < 0.999) continue;
      const d = [b.q[0] - a.q[0], b.q[1] - a.q[1]];
      if (Math.abs(Math.hypot(...d) - 12.7) > 0.6 || Math.abs(d[0] * a.n[0] + d[1] * a.n[1]) > 0.6) continue;
      const flat = layFlatOnPins(state, sheetPart, a.pins, b.pins);
      if (!flat) continue;
      const rowsHere = sheetRows(sheetPart, flat.across, 'min').length;
      // The rows past row 2, on the far side from row 1, within the sheet's reach, nearest first
      const reach = (rowsHere - 2) * 12.7 + 1;
      const later = groups
        .filter((g) => g !== a && g !== b)
        .map((g) => ({ g, d: Math.hypot(g.q[0] - b.q[0], g.q[1] - b.q[1]), ahead: (g.q[0] - b.q[0]) * d[0] + (g.q[1] - b.q[1]) * d[1] }))
        .filter((x) => x.ahead > 0 && x.d <= reach)
        .sort((x, y) => x.d - y.d);
      const sheet = { instanceId: '__import_sheet__', partId: sheetPart.id, label, position: flat.position, rotation: flat.rotation, visible: true };
      let work = { instances: [...state.instances, sheet] };
      const anchored = [];
      const unanchored = [];
      for (const { g } of later) {
        const counts = new Map();
        for (const pin of g.pins) for (const h of holdersOf(work, pin)) counts.set(h.inst.instanceId, (counts.get(h.inst.instanceId) || 0) + 1);
        const targetId = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0];
        if (!targetId) {
          unanchored.push({ on: g.pins.map((p) => p.label).join(', '), reason: 'its pins go into no part' });
          continue;
        }
        const target = work.instances.find((i) => i.instanceId === targetId);
        const current = work.instances.find((i) => i.instanceId === sheet.instanceId);
        const found = sheetBendChoices(work, { sheetId: sheet.instanceId, targetId });
        const fits = (found.choices || []).filter((c) => {
          const tried = { ...current, shape: c.shape };
          const holes = getWorldPortsForInstance(tried).filter((p) => p.type === 'pin_hole');
          return g.pins.every((pin) => {
            const peg = pegOf(pin);
            return holes.some((h) => {
              const dd = v3(peg.worldOrigin).sub(v3(h.worldOrigin));
              const ha = v3(h.worldAxis);
              return dd.sub(ha.multiplyScalar(dd.dot(ha))).length() < 0.5;
            });
          });
        });
        if (!fits.length) {
          unanchored.push({ on: target.label, reason: found.reasons?.join(' ') || 'no row lines up' });
          continue;
        }
        const c = fits[0];
        anchored.push({ row: c.row, on: target.label, stretchMm: c.stretchMm });
        work = { instances: work.instances.map((i) => (i.instanceId === sheet.instanceId ? { ...i, shape: c.shape } : i)) };
      }
      const final = work.instances.find((i) => i.instanceId === sheet.instanceId);
      const result = { position: final.position, rotation: final.rotation, shape: final.shape || null, anchored, unanchored, rowsCount };
      if (!best || anchored.length > best.anchored.length) best = result;
    }
  }
  return best || { error: `${label}: no two neighbouring rows of its pins hold it flat` };
}
