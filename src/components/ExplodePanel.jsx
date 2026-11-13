import React from 'react';
import { X } from 'lucide-react';
import HelpQ from '../help/HelpQ.jsx';

/**
 * The Explode panel (openspec explode-view). While the take-apart is being worked out it shows a ring
 * filling up as `progress` (0..1) comes in from the server; once it's `ready`, a slider from 0%
 * (built) to 100% (fully apart). Pressing the slider (or its keys) hands it to the user, stopping
 * the play.
 */
export default function ExplodePanel({ amount, ready, progress, onAmount, onGrab, onClose, onHelp }) {
  const percent = Math.round(amount * 100);
  return (
    <div className="explode-panel" role="group" aria-label="Explode">
      <div className="explode-panel-row">
        <span className="explode-panel-title">Explode</span>
        <HelpQ tool="Explode" onHelp={onHelp} />
        <button type="button" className="explode-close" data-help="explode-close" onClick={onClose} title="Put the parts back (X or Esc)" aria-label="Close Explode">
          <X size={14} />
        </button>
      </div>
      {ready ? (
        <div className="explode-panel-row">
          <input
            className="explode-slider"
            data-help="explode-slider"
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            aria-label="How far apart"
            onPointerDown={onGrab}
            onKeyDown={onGrab}
            onChange={(e) => onAmount(Number(e.target.value) / 100)}
          />
          <span className="explode-percent">{percent}%</span>
        </div>
      ) : (
        <div className="explode-busy" role="status">
          <ProgressRing fraction={progress} />
          <span>Working out explode…{progress != null && ` ${Math.round(progress * 100)}%`}</span>
        </div>
      )}
    </div>
  );
}

/** A small ring that fills clockwise with `fraction` (0..1); spins while there is no number yet. */
function ProgressRing({ fraction }) {
  const r = 7;
  const around = 2 * Math.PI * r;
  const known = fraction != null;
  return (
    <svg className={`explode-ring ${known ? '' : 'spinning'}`} width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} className="explode-ring-track" />
      <circle
        cx="9"
        cy="9"
        r={r}
        className="explode-ring-fill"
        strokeDasharray={around}
        strokeDashoffset={around * (1 - (known ? fraction : 0.25))}
        transform="rotate(-90 9 9)"
      />
    </svg>
  );
}
