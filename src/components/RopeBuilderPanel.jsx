import React from 'react';
import { ChevronLeft, ChevronRight, FlipHorizontal2, Minus, Plus, Repeat, Trash2, Undo2, X } from 'lucide-react';
import { ROPE_SPECS } from '../utils/ropePath.js';

/**
 * The Rope builder's panel (openspec rope-and-spool): rope lengths and Choose for me, the route's
 * spots with Flip side and wraps for each, the length line (used, spare as turns or slack, or too
 * short), Turns on spool and Flip winding when an end is in a spool, and Next, Back, Undo last, Done
 * and Cancel, so the whole flow works by tap.
 */
export default function RopeBuilderPanel({ rope, touch = false }) {
  const { session, sizes, engine, pickLabel } = rope;
  if (!session) return null;
  const picks = session.picks;
  const tap = touch ? 'Tap' : 'Click';
  const hint = session.editId
    ? `Drag a handle to another pin, pulley or post to move that end or spot. Drag one off the build to take it off. ${tap} a pulley or post to add it before the far end.`
    : picks.length === 0
      ? `${tap} a pin, standoff, shaft or spool for the rope's first end.`
      : `${tap} the pulleys, posts or beam edges it goes over, then the post or spool for its other end, and Done. With no post last, the other end hangs free.`;
  const lastIsEnd = picks.length >= 2 && !session.freeEnd && (picks.at(-1).kind === 'post' || picks.at(-1).kind === 'pocket');
  const size = engine?.size;
  return (
    <div className="band-panel rope-panel" role="dialog" aria-label="Rope builder">
      <div className="band-panel-row">
        <strong className="band-panel-title">{session.editId ? 'Edit rope' : 'Rope builder'}</strong>
        <button type="button" className="explode-close" onClick={rope.close} title="Cancel (Esc)" aria-label="Cancel">
          <X size={14} />
        </button>
      </div>

      <div className="band-sizes" role="radiogroup" aria-label="Rope length">
        {sizes.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={session.size === p.partNumber} className={`chip ${session.size === p.partNumber ? 'active' : ''}`} onClick={() => rope.setSize(p.partNumber)} title={`${p.name}: ${ROPE_SPECS[p.partNumber].lengthMm} mm hole to hole`}>
            {ROPE_SPECS[p.partNumber].name.replace(' Pitch Rope', '')}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={session.size === 'auto'} className={`chip ${session.size === 'auto' ? 'active' : ''}`} onClick={() => rope.setSize('auto')} title="The shortest rope that fits (with a spool, one more full turn)">
          Choose for me
        </button>
      </div>

      <div className="band-hint">{hint}</div>

      {session.hover && (
        <div className="band-lit">
          <span>
            Lit: <strong>{pickLabel(session.hover).spot}</strong> on {pickLabel(session.hover).part}
            {session.hover.near > 1 ? ` (1 of ${session.hover.near} here)` : ''}
          </span>
        </div>
      )}

      {picks.length > 0 && (
        <ol className="band-route">
          {picks.map((p, i) => {
            const l = pickLabel(p);
            const isEnd = i === 0 || (i === picks.length - 1 && lastIsEnd);
            const round = p.kind === 'groove' || p.kind === 'post';
            return (
              <li key={`${p.instanceId}|${p.feature}|${i}`}>
                <span className="band-route-name" title={l.part}>
                  {i + 1}. {isEnd ? (i === 0 ? 'End: ' : 'Other end: ') : ''}
                  {l.spot} <span className="band-route-part">{l.part}</span>
                </span>
                {!isEnd && round && (
                  <span className="band-controls">
                    <button type="button" className="chip" onClick={() => rope.flipSide(i)} title="Send the rope round the other side of this spot">
                      <FlipHorizontal2 size={12} /> Flip side
                    </button>
                    <span className="band-wraps" title="Turns round this spot">
                      <button type="button" className="icon-btn" onClick={() => rope.setWraps(i, Math.max(1, (p.wraps || 1) - 1))} disabled={(p.wraps || 1) <= 1} aria-label="Fewer wraps">
                        <Minus size={11} />
                      </button>
                      <span>{p.wraps || 1}×</span>
                      <button type="button" className="icon-btn" onClick={() => rope.setWraps(i, Math.min(3, (p.wraps || 1) + 1))} disabled={(p.wraps || 1) >= 3} aria-label="More wraps">
                        <Plus size={11} />
                      </button>
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {picks.length > 0 && !lastIsEnd && picks.length >= 1 && <div className="band-route-part">The other end hangs free until you tap a post or spool for it.</div>}

      {engine && !engine.error && (
        <div className="band-readout">
          <strong>{size}</strong>: {Math.round(engine.usedMm)} of {Math.round(engine.lengthMm)} mm used
          {engine.tooShortMm ? (
            <span role="alert"> · too short by {Math.round(engine.tooShortMm)} mm{engine.suggestion ? `: use the ${engine.suggestion.name}` : ''}</span>
          ) : (
            <>
              {engine.turns ? ` · ${engine.turns} turn${engine.turns === 1 ? '' : 's'} on the spool` : ''}
              {engine.slackMm > 0.5 ? ` · ${Math.round(engine.slackMm)} mm slack` : ''}
              {engine.hangMm > 0.5 ? ` · ${Math.round(engine.hangMm)} mm hanging` : ''}
            </>
          )}
          {engine.suggestion && engine.tooShortMm && (
            <div className="band-suggest">
              <button type="button" className="link-btn" onClick={() => rope.setSize(engine.suggestion.partNumber)}>
                Use the {engine.suggestion.name}
              </button>
            </div>
          )}
        </div>
      )}
      {engine?.error && picks.length > 0 && (
        <div className="band-inway" role="alert">
          {engine.error}
        </div>
      )}

      {rope.hasSpool && engine && !engine.error && (
        <div className="band-panel-row">
          <span className="band-route-part">Turns on spool</span>
          <span className="band-wraps">
            <button type="button" className="icon-btn" onClick={() => rope.stepTurns(-0.25)} disabled={!engine.turns} aria-label="Fewer turns">
              <Minus size={11} />
            </button>
            <span>{engine.turns}</span>
            <button type="button" className="icon-btn" onClick={() => rope.stepTurns(0.25)} disabled={engine.turns >= (engine.turnsMax ?? engine.turns)} aria-label="More turns">
              <Plus size={11} />
            </button>
          </span>
          <button type="button" className="chip" onClick={rope.flipWinding} title="Wind the rope round the drum the other way">
            <Repeat size={12} /> Flip winding ({engine.winding === 'under' ? 'under' : 'over'})
          </button>
        </div>
      )}

      <div className="band-panel-row band-actions">
        <button type="button" className="btn btn-outline" onClick={() => rope.stepLit(-1)} title="The spot before, near the lit one (Shift+R)" aria-label="Back">
          <ChevronLeft size={13} /> Back
        </button>
        <button type="button" className="btn btn-outline" onClick={() => rope.stepLit(1)} title="The next spot near the lit one (R or the wheel)" aria-label="Next">
          Next <ChevronRight size={13} />
        </button>
        <button type="button" className="btn btn-outline" onClick={rope.undoLast} disabled={!picks.length} title="Take off the last one (Backspace)">
          <Undo2 size={13} /> Undo last
        </button>
        <button type="button" className="btn btn-primary-action" onClick={() => rope.finish()} disabled={!picks.length} title="Add the rope (Enter)">
          Done
        </button>
      </div>
      <button type="button" className="btn btn-outline" onClick={rope.close} style={{ width: '100%', marginTop: 6 }}>
        <Trash2 size={13} /> Cancel
      </button>
    </div>
  );
}
