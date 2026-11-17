import React, { useState } from 'react';
import { AlertTriangle, ArrowLeftRight, ArrowRight, ChevronDown, ChevronRight, ChevronUp, X } from 'lucide-react';
import { controlStatus } from '../utils/motorGroups.js';
import { LANDINGS } from '../sim/impact.js';
import HelpQ from '../help/HelpQ.jsx';

/**
 * The Play panel (openspec play-mode): one throttle per Smart Motor, from full reverse through stop
 * to full forward. A throttle springs back to stop when let go, unless that motor's Keep is ticked.
 * Under each throttle, "When stopped: Coast · Brake · Hold" picks the motor's stopping mode
 * (openspec motor-stopping), saved with the build.
 * Each row shows the motor's speed, or Stalled when a collision or a jammed train stops it; hovering
 * a row lights the motor up in the view. Below, a global option to limit speed by load and any warnings.
 * A motor group (openspec motor-groups) is one row: one throttle, Keep and stopping mode for all its
 * motors, Stalled when any of them is; opened, it lists its motors to flip one's direction.
 */
// A Smart Motor's stopping modes, as VEX's "set motor stopping" block has them
const STOPPING = [
  ['coast', 'Coast', 'Spins freely when stopped'],
  ['brake', 'Brake', 'Slows it to a stop; a heavy load creeps'],
  ['hold', 'Hold', 'Keeps it where it stopped']
];

export default function PlayPanel({
  ready,
  error,
  mode,
  motors = [],
  controls,
  onMotorGroupEdit,
  throttles,
  status = {},
  warnings = [],
  limitSpeedByLoad = false,
  onLimitSpeedByLoad,
  simulateGravity = false,
  ropeHanging = false,
  onSimulateGravity,
  dropReport = null,
  dropUnavailable = false,
  dropSlowMotion = 1,
  onDropSlowMotion,
  highlightLoose = false,
  compact = false,
  onHighlightLoose,
  onDrop,
  onResetDrop,
  onThrottle,
  stopping = {},
  onStopping,
  onHover,
  onClose,
  onHelp
}) {
  const [holds, setHolds] = useState(() => new Set());
  const [openGroups, setOpenGroups] = useState(() => new Set());
  // One row per control; without controls, one per motor
  const rows = controls || motors.map((m) => ({ key: m.id, label: m.label, group: false, motors: [{ id: m.id, label: m.label, reversed: false, stopping: m.stopping }] }));
  const [showWarnings, setShowWarnings] = useState(false);
  const [dropHeight, setDropHeight] = useState(0.5);
  const [dropLanding, setDropLanding] = useState('flat');
  const [showDropDetails, setShowDropDetails] = useState(false);
  // On small screens the controls fold away when a drop starts so the robot stays in view; the
  // Findings section is its own fold, open on big screens and closed on small ones until asked for.
  const [collapsed, setCollapsed] = useState(false);
  const [findingsOpen, setFindingsOpen] = useState(!compact);
  const startDrop = () => {
    if (compact) {
      setCollapsed(true);
      setFindingsOpen(false);
    }
    onDrop?.(dropHeight, dropLanding);
  };
  const toggleHold = (id, checked) => {
    setHolds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    if (!checked && throttles.get(id)) onThrottle(id, 0);
  };
  return (
    <div className="explode-panel play-panel" role="group" aria-label="Play mode">
      <div className="explode-panel-row">
        <span className="explode-panel-title">Play</span>
        {ready && mode === 'kinematic' && (
          <span className="play-mode-note" title="The physics couldn't start, so parts turn by gear ratio but don't stop each other">
            no collisions
          </span>
        )}
        <button
          type="button"
          className="explode-close"
          style={{ marginLeft: 'auto' }}
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Show the Play controls' : 'Fold the Play controls away'}
          aria-label={collapsed ? 'Expand Play panel' : 'Collapse Play panel'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        <HelpQ tool="Play mode" onHelp={onHelp} />
        <button type="button" className="explode-close" style={{ marginLeft: 0 }} onClick={onClose} title="Stop playing and put every part back (Esc)" aria-label="Close Play mode">
          <X size={14} />
        </button>
      </div>
      {collapsed ? null : error ? (
        <div className="play-error" role="alert">{error}</div>
      ) : !ready ? (
        <div className="explode-busy" role="status">Working out how the parts move…</div>
      ) : (
        <>
          {motors.length === 0 ? (
            <div className="play-empty">This build has no Smart Motors to run.</div>
          ) : (
            rows.map((m) => {
              const value = Math.round((throttles.get(m.key) || 0) * 100);
              const s = controlStatus(m, status);
              const held = holds.has(m.key);
              const modes = new Set(m.motors.map((x) => stopping[x.id] || x.stopping || 'brake'));
              const mode = modes.size === 1 ? [...modes][0] : null; // a group's motors set differently: none shows
              const groupOpen = openGroups.has(m.key);
              return (
                <div
                  key={m.key}
                  className={`play-motor ${s.stalled ? 'stalled' : ''}`}
                  onPointerEnter={() => onHover(m.key)}
                  onPointerLeave={() => onHover(null)}
                >
                  <div className="explode-panel-row">
                    {m.group && (
                      <button
                        type="button"
                        className="explode-close play-group-toggle"
                        style={{ marginLeft: 0 }}
                        aria-expanded={groupOpen}
                        aria-label={groupOpen ? `Close ${m.label}` : `Show the motors in ${m.label}`}
                        title={groupOpen ? 'Hide the motors' : 'Show the motors and which way each turns'}
                        onClick={() =>
                          setOpenGroups((prev) => {
                            const next = new Set(prev);
                            if (next.has(m.key)) next.delete(m.key);
                            else next.add(m.key);
                            return next;
                          })
                        }
                      >
                        {groupOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    )}
                    <span className="play-motor-name" title={m.group ? `${m.label}: ${m.motors.length} motors` : m.label}>
                      {m.label}
                    </span>
                    <label className="play-motor-hold" data-help="play-hold" title="Keep this motor's throttle where you let go of it (double-click the slider to stop it)">
                      <input type="checkbox" checked={held} onChange={(e) => toggleHold(m.key, e.target.checked)} />
                      Keep
                    </label>
                    <span className="play-motor-speed" role="status">
                      {s.stalled ? 'Stalled' : `${Math.round(Math.abs(s.rpm || 0))} rpm`}
                    </span>
                  </div>
                  <input
                    className="explode-slider play-throttle"
                    data-help="play-throttle"
                    type="range"
                    min={-100}
                    max={100}
                    step={1}
                    value={value}
                    aria-label={`${m.label} throttle`}
                    aria-valuetext={value === 0 ? 'stopped' : `${Math.abs(value)}% ${value > 0 ? 'forward' : 'reverse'}`}
                    onChange={(e) => onThrottle(m.key, Number(e.target.value) / 100)}
                    onPointerUp={() => !held && onThrottle(m.key, 0)}
                    onPointerCancel={() => !held && onThrottle(m.key, 0)}
                    onDoubleClick={() => onThrottle(m.key, 0)}
                  />
                  {m.group && groupOpen && (
                    <div className="play-group-motors">
                      {m.motors.map((x) => (
                        <div key={x.id} className="play-group-motor">
                          <span title={x.label}>{x.label}</span>
                          <button
                            type="button"
                            className={`motor-dir-btn ${x.reversed ? 'opposite' : ''}`}
                            disabled={!onMotorGroupEdit}
                            aria-label={`${x.label}: turns ${x.reversed ? 'the opposite way' : 'the same way'}. Tap to flip`}
                            title={x.reversed ? 'Turns the opposite way to the group: tap to make it turn the same way' : 'Turns the same way as the group: tap to make it turn the opposite way'}
                            onClick={() => onMotorGroupEdit?.({ kind: 'reverse', id: x.id, reversed: !x.reversed })}
                          >
                            {x.reversed ? <ArrowLeftRight size={12} /> : <ArrowRight size={12} />}
                            {x.reversed ? 'Opposite' : 'Same'}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {onStopping && (
                    <div className="play-stopping" role="radiogroup" aria-label={`${m.label}: when stopped`}>
                      <span className="play-stopping-label">When stopped:</span>
                      {STOPPING.map(([chip, name, tip]) => {
                        const on = mode === chip;
                        return (
                          <button key={chip} type="button" role="radio" aria-checked={on} className={`play-stopping-chip ${on ? 'active' : ''}`} title={tip} onClick={() => !on && onStopping(m.key, chip)}>
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
          {mode !== 'kinematic' && (
            <>
              {motors.length > 0 && (
                <label className="play-hold" title="Cap motor speed above 1.4 W mechanical power ((1.4 / loadTorque) × 9.55 rpm, up to 0.414 N·m stall torque)">
                  <input type="checkbox" checked={limitSpeedByLoad} onChange={(e) => onLimitSpeedByLoad?.(e.target.checked)} />
                  Limit speed by load
                </label>
              )}
              <label className="play-hold" title="Let unanchored or single-pinned parts fall under gravity and add gravitational weight to motor torque required">
                <input type="checkbox" checked={simulateGravity} onChange={(e) => onSimulateGravity?.(e.target.checked)} />
                Simulate gravity
              </label>
              {ropeHanging && !simulateGravity && (
                <p className="play-hint" role="note" style={{ margin: '2px 0 4px', fontSize: 12, color: '#fbbf24' }}>
                  Turn on gravity so parts on ropes can come down.
                </p>
              )}
              <div className="play-drop-section">
                <div className="explode-panel-row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, color: '#cbd5e1' }} title="Drop the robot onto the floor and see which joints let go">
                    Drop test
                  </span>
                  <select className="cad-select" style={{ width: 76, padding: '2px 6px', fontSize: 11 }} value={dropHeight} aria-label="Drop height" onChange={(e) => setDropHeight(Number(e.target.value))}>
                    {[0.15, 0.3, 0.5, 0.8, 1.0, 1.5].map((h) => (
                      <option key={h} value={h}>
                        {h.toFixed(2)} m
                      </option>
                    ))}
                  </select>
                  <select className="cad-select" style={{ width: 92, padding: '2px 6px', fontSize: 11 }} value={dropLanding} aria-label="Landing" title="Which way the robot lands (+X is its front, as on the view cube)" onChange={(e) => setDropLanding(e.target.value)}>
                    {LANDINGS.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn btn-outline" data-help="play-drop" style={{ padding: '2px 8px', fontSize: 11 }} disabled={dropUnavailable} onClick={startDrop} title={dropUnavailable ? 'The server is running older code without the joints the drop test needs: restart the dev server' : 'Lift the robot and drop it, landing as chosen'}>
                    Drop
                  </button>
                  {dropReport?.active && (
                    <button type="button" className="btn btn-outline" data-help="play-reset" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => onResetDrop?.()} title="Put the robot back together where it was">
                      Reset
                    </button>
                  )}
                </div>
                {dropUnavailable && (
                  <div className="play-error" role="alert" style={{ fontSize: 11 }}>
                    The dev server is running older code: restart it to use the drop test.
                  </div>
                )}
                <div className="explode-panel-row" style={{ gap: 6, marginTop: 4 }}>
                  <label className="play-hold" style={{ margin: 0 }} title="Play the drop slower than real time to watch the landing">
                    Slow motion
                    <select className="cad-select" style={{ width: 70, padding: '2px 6px', fontSize: 11, marginLeft: 6 }} value={dropSlowMotion} aria-label="Slow motion" onChange={(e) => onDropSlowMotion?.(Number(e.target.value))}>
                      {[1, 2, 4, 8].map((x) => (
                        <option key={x} value={x}>
                          {x === 1 ? 'Off' : `${x}× slower`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="play-hold" title="Light up the parts a drop knocks off, and the ones left hanging by a single pin">
                  <input type="checkbox" checked={highlightLoose} onChange={(e) => onHighlightLoose?.(e.target.checked)} />
                  Highlight loose parts
                </label>
                {dropReport?.estimates !== false && (
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }} title="How hard pins, pegs and collars hold, and how stiff parts are, are estimates until measured on real parts">
                    Strengths are estimates
                  </div>
                )}
                {dropReport?.impacted && (
                  <div className="play-warnings" style={{ marginTop: 6 }}>
                    <button type="button" className="play-warnings-toggle" onClick={() => setFindingsOpen((on) => !on)} aria-expanded={findingsOpen}>
                      {findingsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      Findings
                    </button>
                    {findingsOpen && (
                      <div>
                    {dropReport.brokenPins.length === 0 ? (
                      <div style={{ fontSize: 11, color: '#4ade80' }} role="status">
                        Survived a {dropReport.heightM} m drop intact ({dropReport.peakG} g, busiest joint {dropReport.maxForceN} N)
                      </div>
                    ) : (
                      <button type="button" className="play-warnings-toggle" onClick={() => setShowDropDetails((on) => !on)} aria-expanded={showDropDetails}>
                        <AlertTriangle size={12} />
                        {dropReport.brokenPins.length} {dropReport.brokenPins.length === 1 ? 'joint' : 'joints'} let go · {dropReport.detachedParts.length}{' '}
                        {dropReport.detachedParts.length === 1 ? 'part' : 'parts'} came off · {dropReport.peakG} g
                      </button>
                    )}
                    {(showDropDetails || dropReport.brokenPins.length === 0) && (
                      <ul>
                        {dropReport.brokenPins.length > 0 &&
                          dropReport.brokenPins.slice(0, 12).map((bp) => (
                            <li key={bp.id} onPointerEnter={() => onHover(bp.partA)} onPointerLeave={() => onHover(null)} style={{ cursor: 'pointer' }}>
                              {bp.label}: {bp.failure} ({bp.forceN} {bp.unit} against {bp.strengthN} {bp.unit})
                            </li>
                          ))}
                        {dropReport.brokenPins.length > 12 && <li>… and {dropReport.brokenPins.length - 12} more</li>}
                        {dropReport.detachedParts.slice(0, 12).map((d) => (
                          <li key={d.id} onPointerEnter={() => onHover(d.id)} onPointerLeave={() => onHover(null)} style={{ cursor: 'pointer' }}>
                            Came off: {d.label}
                          </li>
                        ))}
                        {(dropReport.swingingParts || []).slice(0, 12).map((d) => (
                          <li key={d.id} onPointerEnter={() => onHover(d.id)} onPointerLeave={() => onHover(null)} style={{ cursor: 'pointer' }}>
                            Hanging by one pin: {d.label}
                          </li>
                        ))}
                        {dropReport.weakSpots.slice(0, 10).map((w) => (
                          <li key={w.id} onPointerEnter={() => onHover(w.partA)} onPointerLeave={() => onHover(null)} style={{ cursor: 'pointer', color: '#fbbf24' }}>
                            {w.slidMm ? `Loosened: ${w.label} (slid ${w.slidMm} of ${w.travelMm} mm)` : `Weak spot: ${w.label} (${Math.round(w.use * 100)}% of its strength)`}
                          </li>
                        ))}
                      </ul>
                    )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
      {!collapsed && warnings.length > 0 && (
        <div className="play-warnings">
          <button type="button" className="play-warnings-toggle" onClick={() => setShowWarnings((on) => !on)} aria-expanded={showWarnings}>
            <AlertTriangle size={12} />
            {warnings.length === 1 ? '1 part doesn’t move as built' : `${warnings.length} parts don’t move as built`}
          </button>
          {showWarnings && (
            <ul>
              {warnings.map((w, i) => (
                <li key={i}>{w.text}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
