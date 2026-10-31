import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';

const VEX_PITCH_MM = 12.7;

/**
 * The Inspector for a group or several selected parts (openspec outliner-part-groups): the group's name,
 * the set's centre (its combined bounding box) with nudges, quick 90° turns about that centre, and
 * hide/lock for every part. The per-part sections (color, label, mating, fastening) aren't shown.
 */
export default function SetInspector({ group, parts, pivot, snapPitchFactor, onRename, onMoveBy, onMoveCentreTo, onTurn, onSetFlag }) {
  const [draft, setDraft] = useState(group?.name ?? '');
  useEffect(() => setDraft(group?.name ?? ''), [group?.id, group?.name]);
  const commitName = () => {
    if (!group) return;
    const name = draft.trim();
    if (name === group.name) return;
    // An empty name is refused and the old one kept
    if (!onRename(name)) setDraft(group.name);
  };

  const stepP = snapPitchFactor > 0 ? snapPitchFactor : 0.25;
  const hidden = parts.filter((p) => p.visible === false).length;
  const locked = parts.filter((p) => p.locked).length;
  const round = (v) => Math.round(v * 100) / 100;

  return (
    <div className="inspector-body">
      {group && (
        <div className="field-group">
          <div className="field-label">
            <span>Group name</span>
          </div>
          <input
            type="text"
            className="cad-input"
            value={draft}
            aria-label="Group name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setDraft(group.name);
                e.currentTarget.blur();
              }
            }}
          />
        </div>
      )}

      <div className="field-group">
        <div className="field-label">
          <span>Centre (mm)</span>
          <span style={{ color: '#93c5fd', textTransform: 'none' }}>
            Pitch: {pivot.map((v) => `${(v / VEX_PITCH_MM).toFixed(2)}P`).join(', ')}
          </span>
        </div>
        <div className="xyz-grid">
          {['X', 'Y', 'Z'].map((axis, idx) => (
            <label key={axis} className="coord-input-wrap">
              <span className={`coord-axis ${axis.toLowerCase()}`}>{axis}</span>
              <input
                type="number"
                step="6.35"
                className="coord-input"
                value={round(pivot[idx])}
                aria-label={`Centre ${axis}`}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!Number.isNaN(val)) onMoveCentreTo(idx, val);
                }}
              />
            </label>
          ))}
        </div>
        <div className="nudge-row">
          {[0, 1, 2].flatMap((axis) =>
            [-1, 1].map((dir) => {
              const label = `${dir < 0 ? '-' : '+'}${'XYZ'[axis]}`;
              return (
                <button
                  key={label}
                  type="button"
                  className="btn btn-outline"
                  style={{ padding: '4px 0', fontSize: 11 }}
                  onClick={() => {
                    const delta = [0, 0, 0];
                    delta[axis] = dir * stepP * VEX_PITCH_MM;
                    onMoveBy(delta);
                  }}
                  title={`Move every part ${dir > 0 ? '+' : '-'}${stepP}P (${(dir * stepP * VEX_PITCH_MM).toFixed(2)}mm)`}
                >
                  {label}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>Quick 90° Turn</span>
          <span style={{ textTransform: 'none' }}>about the centre</span>
        </div>
        <div className="xyz-grid">
          {['X', 'Y', 'Z'].map((axis, idx) => (
            <button key={axis} type="button" className="btn btn-outline" style={{ fontSize: 11, padding: '5px 4px' }} onClick={() => onTurn(idx)}>
              Rotate {axis} +90°
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <div className="field-label">
          <span>{parts.length} parts</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="btn btn-outline" style={{ fontSize: 11 }} onClick={() => onSetFlag('visible', hidden === parts.length)}>
            {hidden === parts.length ? <Eye size={12} /> : <EyeOff size={12} />}
            {hidden === parts.length ? 'Show all' : 'Hide all'}
          </button>
          <button type="button" className="btn btn-outline" style={{ fontSize: 11 }} onClick={() => onSetFlag('locked', locked !== parts.length)}>
            {locked === parts.length ? <Unlock size={12} /> : <Lock size={12} />}
            {locked === parts.length ? 'Unlock all' : 'Lock all'}
          </button>
        </div>
      </div>
    </div>
  );
}
