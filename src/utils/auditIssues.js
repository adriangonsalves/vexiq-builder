/**
 * The audit's findings as one list of plain-language issues, for the Audit & Blueprint dialog.
 * `problem` issues are the ones that make the build "not mechanically sound"; `note` issues are
 * only worth a look (parts held by a single pin, tight fits). Each issue names the part to select when clicked.
 * Pure (no React/DOM).
 */

const part = (x) => ({ instanceId: x.instanceId, label: x.label });

const mm = (v) => `${v} mm`;

/** How a fastener nearly sits in a hole: "Claw Crank Arm R hole_1 is 0.31 mm off its line (up to 0.25 mm is accepted)". */
function nearMissText(nearMiss = []) {
  const m = nearMiss[0];
  if (!m) return '';
  const tilt = m.angleDeg > 0.1 ? ` and ${m.angleDeg}° tilted` : '';
  return `${m.part} ${m.port} is ${mm(m.lineMm)} off its line${tilt} (up to 0.25 mm and 2° is accepted).`;
}

/**
 * [{ kind, level: 'problem' | 'note', title, detail, parts: [{ instanceId, label }], fixIds }] in audit
 * order. `fixIds` are the parts to run Fix assembly from, in the order to try them (empty: nothing to try).
 */
export function auditIssues(audit) {
  if (!audit) return [];
  const issues = [];
  const add = (kind, level, title, detail, parts, fixIds = []) => issues.push({ kind, level, title, detail, parts, fixIds });

  for (const c of audit.collisions || []) {
    add('collision', 'problem', `${c.label} overlaps another part`, `Passes into ${c.collidingWith.join(', ')}. Fix assembly or moving it clear usually fixes this.`, [part(c)], [c.instanceId]);
  }
  for (const f of audit.floatingFasteners || []) {
    const near = nearMissText(f.nearMiss);
    add('floating', 'problem', `${f.label} is not in any hole`, near || 'This pin or shaft is not seated in a part, and no hole is near its line.', [part(f)], [...new Set([f.instanceId, ...(f.nearMiss || []).map((n) => n.instanceId)])]);
  }
  for (const f of audit.halfSeatedFasteners || []) {
    const into = (f.seatedIn || []).map((s) => s.part).join(', ');
    const near = nearMissText(f.nearMiss);
    // Fix assembly from the part it sits in first (it moves the other side onto the pin), then the pin
    const fixIds = [...new Set([...(f.seatedIn || []).map((s) => s.instanceId).filter(Boolean), f.instanceId])];
    add(
      'half-seated',
      'problem',
      `${f.label} holds only one part`,
      `Seated in ${into} only. ${near || 'No other hole is near its line, so it joins nothing else.'}`,
      [part(f)],
      fixIds
    );
  }
  for (const p of audit.unsecuredParts || []) {
    add('unsecured', 'problem', `${p.label} is not pinned to anything`, 'No pin or shaft holds it.', [part(p)]);
  }
  for (const p of audit.underSecuredHeavyParts || []) {
    add('heavy', 'problem', `${p.label} needs more fasteners`, `Held by ${p.fastenerCount}; it needs at least ${p.minFastenersRequired}.`, [part(p)]);
  }
  for (const island of audit.disconnectedIslands || []) {
    const names = island.map((p) => p.label);
    add('island', 'problem', `${names.length === 1 ? names[0] : `${names.length} parts`} not joined to the rest`, names.join(', '), island.map(part));
  }
  for (const s of audit.protrudingShafts || []) {
    add('protruding', 'problem', `${s.label} sticks out past its parts`, 'The shaft overhangs the outer faces of the parts it is seated in.', [part(s)]);
  }
  for (const p of audit.singlePinPivotParts || []) {
    add('single-pin', 'note', `${p.label} is held by one pin`, 'It can pivot on that pin. Add a second pin if it should stay fixed.', [part(p)]);
  }
  for (const t of audit.tightFits || []) {
    add('tight-fit', 'note', `${t.label} is a tight fit with ${t.withLabel}`, 'They touch by up to half a millimetre, as parts often do in VEX CAD. It is not counted as an overlap.', [part(t), { instanceId: t.withInstanceId, label: t.withLabel }]);
  }
  return issues;
}

/** How many issues make the build "not mechanically sound". */
export const problemCount = (issues) => issues.filter((i) => i.level === 'problem').length;
