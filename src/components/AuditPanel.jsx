import React from 'react';
import { Magnet, RefreshCw, X } from 'lucide-react';
import HelpQ from '../help/HelpQ.jsx';

/**
 * The Audit panel: slides up from the bottom of the 3D view and stays open while the user works.
 * It lists what the audit found (src/utils/auditIssues.js). Clicking a finding selects and frames
 * its part(s) and highlights the row; the panel stays open. "Attempt Fix" runs Fix assembly for that
 * finding. `selectedIds` decides which row is highlighted (so picking a part in the 3D view lights
 * its row too). `audit` is null until the first result arrives.
 */
export default function AuditPanel({ open, audit, issues, problems, busy, note, selectedIds, onSelect, onFix, onRefresh, onClose, onHelp }) {
  const selected = new Set(selectedIds);
  const isActive = (issue) => issue.parts.length > 0 && issue.parts.length === selected.size && issue.parts.every((p) => selected.has(p.instanceId));
  const sound = Boolean(audit?.isMechanicallySound);
  const k = audit?.kinematics;
  const chip = (label, value, bad) => (
    <span className={`audit-chip ${bad ? 'bad' : 'ok'}`} key={label}>
      {label} <strong>{value}</strong>
    </span>
  );
  return (
    <section className={`audit-panel ${open ? 'open' : ''}`} aria-label="Audit" aria-hidden={!open} inert={!open}>
      <div className="audit-panel-header">
        <strong>Audit</strong>
        {audit && (
          <span className={`audit-panel-status ${sound ? 'ok' : 'bad'}`}>
            {sound ? '● Mechanically sound (0 issues)' : `▲ ${problems} warning${problems === 1 ? '' : 's'}`}
          </span>
        )}
        <span className="audit-panel-spacer" />
        <HelpQ tool="Audit" onHelp={onHelp} />
        <button type="button" className="btn btn-outline" onClick={onRefresh} disabled={busy} title="Run the audit again">
          <RefreshCw size={12} />
          Refresh
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose} aria-label="Close the audit panel" title="Close">
          <X size={12} />
        </button>
      </div>
      {audit && (
        <div className="audit-chips">
          {chip('Overlaps', audit.collisionCount, audit.collisionCount > 0)}
          {chip('Loose pins', audit.floatingFastenerCount, audit.floatingFastenerCount > 0)}
          {chip('Half-seated', audit.halfSeatedFastenerCount, audit.halfSeatedFastenerCount > 0)}
          {chip('Unpinned', audit.unsecuredPartCount, audit.unsecuredPartCount > 0)}
          {chip('Under-fastened', audit.underSecuredHeavyPartCount, audit.underSecuredHeavyPartCount > 0)}
          {chip('Not joined', audit.disconnectedIslandCount, audit.disconnectedIslandCount > 0)}
          {chip('Overhanging shafts', audit.protrudingShaftCount, audit.protrudingShaftCount > 0)}
          <span className="audit-chip info">
            Drive{' '}
            <strong>
              {k?.motorCount || 0}M → {k?.meshedGearPairCount || 0}G → {k?.drivenWheelCount || 0}/{k?.totalWheelCount || 0}W
            </strong>
          </span>
        </div>
      )}
      {note && (
        <div className={`audit-fix-note ${note.isError ? 'error' : ''}`} role="status">
          <strong>{note.title}:</strong> {note.text}
        </div>
      )}
      <div className="audit-panel-body">
        {!audit && <div className="audit-empty">Running the audit…</div>}
        {audit && issues.length === 0 && <div className="audit-empty ok">Nothing to report.</div>}
        {issues.length > 0 && (
          <ul className="audit-issue-list">
            {issues.map((issue, n) => (
              <li key={`${issue.kind}-${issue.parts.map((p) => p.instanceId).join('+')}-${n}`} className={`audit-issue ${issue.level} ${isActive(issue) ? 'active' : ''}`}>
                <button type="button" className="audit-issue-button" aria-pressed={isActive(issue)} onClick={() => onSelect(issue)}>
                  <strong>
                    {issue.level === 'note' ? 'Note' : 'Warning'}: {issue.title}
                  </strong>
                  <span>{issue.detail}</span>
                </button>
                {issue.fixIds.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-outline audit-fix-button"
                    data-help="audit-attempt-fix"
                    disabled={busy}
                    onClick={() => onFix(issue)}
                    title="Run Fix assembly on this part to line up its pins and holes and seat it"
                  >
                    <Magnet size={12} />
                    Attempt Fix
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
