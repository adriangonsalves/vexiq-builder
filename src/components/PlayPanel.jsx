import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

/**
 * The Play panel (openspec play-mode): one throttle per Smart Motor, from full reverse through stop
 * to full forward. A throttle springs back to stop when let go, unless that motor's Hold is ticked.
 * Each row shows the motor's speed, or Stalled when a collision or a jammed train stops it; hovering
 * a row lights the motor up in the view. Below, a global option to limit speed by load and any warnings.
 */
export default function PlayPanel({
  ready,
  error,
  mode,
  motors = [],
  throttles,
  status = {},
  warnings = [],
  limitSpeedByLoad = false,
  onLimitSpeedByLoad,
  simulateGravity = false,
  onSimulateGravity,
  onThrottle,
  onHover,
  onClose
}) {
  const [holds, setHolds] = useState(() => new Set());
  const [showWarnings, setShowWarnings] = useState(false);
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
        <button type="button" className="explode-close" onClick={onClose} title="Stop playing and put every part back (Esc)" aria-label="Close Play mode">
          <X size={14} />
        </button>
      </div>
      {error ? (
        <div className="play-error" role="alert">{error}</div>
      ) : !ready ? (
        <div className="explode-busy" role="status">Working out how the parts move…</div>
      ) : motors.length === 0 ? (
        <div className="play-empty">This build has no Smart Motors to run.</div>
      ) : (
        <>
          {motors.map((m) => {
            const value = Math.round((throttles.get(m.id) || 0) * 100);
            const s = status[m.id];
            const held = holds.has(m.id);
            return (
              <div
                key={m.id}
                className={`play-motor ${s?.stalled ? 'stalled' : ''}`}
                onPointerEnter={() => onHover(m.id)}
                onPointerLeave={() => onHover(null)}
              >
                <div className="explode-panel-row">
                  <span className="play-motor-name" title={m.label}>{m.label}</span>
                  <label className="play-motor-hold" title="Keep this motor's throttle where you let go of it (double-click the slider to stop it)">
                    <input type="checkbox" checked={held} onChange={(e) => toggleHold(m.id, e.target.checked)} />
                    Hold
                  </label>
                  <span className="play-motor-speed" role="status">
                    {s?.stalled ? 'Stalled' : `${Math.round(Math.abs(s?.rpm || 0))} rpm`}
                  </span>
                </div>
                <input
                  className="explode-slider play-throttle"
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={value}
                  aria-label={`${m.label} throttle`}
                  aria-valuetext={value === 0 ? 'stopped' : `${Math.abs(value)}% ${value > 0 ? 'forward' : 'reverse'}`}
                  onChange={(e) => onThrottle(m.id, Number(e.target.value) / 100)}
                  onPointerUp={() => !held && onThrottle(m.id, 0)}
                  onPointerCancel={() => !held && onThrottle(m.id, 0)}
                  onDoubleClick={() => onThrottle(m.id, 0)}
                />
              </div>
            );
          })}
          {mode !== 'kinematic' && (
            <>
              <label className="play-hold" title="Cap motor speed above 1.4 W mechanical power ((1.4 / loadTorque) × 9.55 rpm, up to 0.414 N·m stall torque)">
                <input type="checkbox" checked={limitSpeedByLoad} onChange={(e) => onLimitSpeedByLoad?.(e.target.checked)} />
                Limit speed by load
              </label>
              <label className="play-hold" title="Let unanchored or single-pinned parts fall under gravity and add gravitational weight to motor torque required">
                <input type="checkbox" checked={simulateGravity} onChange={(e) => onSimulateGravity?.(e.target.checked)} />
                Simulate gravity
              </label>
            </>
          )}
        </>
      )}
      {warnings.length > 0 && (
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
