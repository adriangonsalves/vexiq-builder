import React, { useState } from 'react';
import { Minus, Plus, Route, Shuffle, Trash2, Undo2, X } from 'lucide-react';
import { BAND_SPECS } from '../utils/bandPath.js';
import { STRETCH_COLORS } from '../sim/bandStrength.js';

const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * The Band builder's panel (openspec rubber-bands): band sizes and Choose for me, the route's spots
 * with side, wraps and cross for each, the lit spot's controls, the stretch read-out and a better
 * size, Other way round, the parts-in-the-way question, and the ring close-up of each gear, sprocket or
 * pulley on the route. Every key action has a button here, for touch.
 */
export default function BandBuilderPanel({ band }) {
  const { session, sizes, readout, entryLabel, ringParts } = band;
  const [ringIndex, setRingIndex] = useState(0);
  if (!session) return null;
  const ring = ringParts[Math.min(ringIndex, ringParts.length - 1)] || null;
  const hover = session.hover;
  const hoverLabel = hover ? entryLabel(hover) : null;
  const editing = Boolean(session.editId);
  return (
    <div className="band-panel" role="dialog" aria-label="Band builder">
      <div className="band-panel-row">
        <strong className="band-panel-title">{editing ? 'Edit band' : 'Band builder'}</strong>
        <button type="button" className="explode-close" onClick={band.close} title="Cancel (Esc)" aria-label="Cancel">
          <X size={14} />
        </button>
      </div>

      <div className="band-sizes" role="radiogroup" aria-label="Band size">
        {sizes.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={session.size === p.partNumber} className={`chip ${session.size === p.partNumber ? 'active' : ''}`} onClick={() => band.setSize(p.partNumber)} title={`${p.name}: ${BAND_SPECS[p.partNumber].freeMm} mm round when unstretched`}>
            {BAND_SPECS[p.partNumber].name.replace(' Square Silicone Belt', ' belt').replace(' Rubber Belt', ' belt')}
          </button>
        ))}
        {!editing && (
          <button type="button" role="radio" aria-checked={session.size === 'auto'} className={`chip ${session.size === 'auto' ? 'active' : ''}`} onClick={() => band.setSize('auto')} title="Pick the size that stretches closest to 1.5× on this route">
            Choose for me
          </button>
        )}
      </div>

      <div className="band-hint">
        {session.route.length === 0
          ? 'Click a post, pin, pulley, tooth gap or beam end to hook the band on.'
          : session.route.length === 1
            ? 'Click the next spot.'
            : (editing ? 'Circles are anchors the band must go round; dots are handles on the band. Click a spot to add an anchor in the stretch nearest it, drag a dot onto a spot to add one there, drag a circle to move it, and right-click (or Alt+click) a circle to take it off.' : 'Click more spots, or Done to close the band. To make it go another way, drag a small handle on the band onto the edge or post it should go round, or press Other way round; drag a circle to move that spot, right-click it to take it off.')}{' '}
        R or the wheel steps to the next spot near the pointer.
      </div>

      {hover && (
        <div className="band-lit">
          <span>
            Lit: <strong>{hoverLabel.spot}</strong> on {hoverLabel.part}
            {hover.near > 1 ? ` (1 of ${hover.near} here)` : ''}
          </span>
          <span className="band-controls">
            <button type="button" className="chip" onClick={() => band.setPending({ side: session.pending.side === 'in' ? 'out' : 'in' })} title="Which side the band goes round this spot">
              {session.pending.side === 'in' ? 'Inside' : 'Outside'}
            </button>
            <WrapButtons value={session.pending.wraps} onChange={(w) => band.setPending({ wraps: w })} />
          </span>
        </div>
      )}

      {session.route.length > 0 && (
        <ol className="band-route">
          {session.route.map((s, i) => {
            const l = entryLabel(s);
            const next = session.route[(i + 1) % session.route.length];
            const canCross = l.round && next && entryLabel(next).round && session.route.length >= 2;
            return (
              <li key={`${s.instanceId}|${s.feature}|${i}`}>
                <span className="band-route-name" title={l.part}>
                  {i + 1}. {l.spot} <span className="band-route-part">{l.part}</span>
                </span>
                <span className="band-controls">
                  {l.round && (
                    <button type="button" className="chip" onClick={() => band.setEntry(i, { side: s.side === 'in' ? 'out' : 'in' })} title="Outside: round the far side from the loop's middle. Inside: the band bends the other way.">
                      {s.side === 'in' ? 'Inside' : 'Outside'}
                    </button>
                  )}
                  {l.round && <WrapButtons value={s.wraps || 1} onChange={(w) => band.setEntry(i, { wraps: w })} />}
                  {canCross && (
                    <button type="button" className={`chip ${s.cross ? 'active' : ''}`} onClick={() => band.setEntry(i, { cross: !s.cross })} title="Cross the run to the next spot over (a figure-8)">
                      <Shuffle size={12} /> Cross
                    </button>
                  )}
                  <button type="button" className="icon-btn" onClick={() => band.removeEntry(i)} title="Take this spot off" aria-label="Take this spot off">
                    <Trash2 size={12} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {session.route.length >= 3 && (
        <div className="band-panel-row" role="radiogroup" aria-label="How the band comes back">
          <span className="band-route-part">{session.back === 'auto' ? 'Goes:' : 'Goes (your choice):'}</span>
          <button type="button" role="radio" aria-checked={band.fold} className={`chip ${band.fold ? 'active' : ''}`} onClick={() => band.setBack(band.fold && session.back !== 'auto' ? 'auto' : 'same')} title="Out over the spots and back over the same ones (a band hooked on two pins, under or over the parts between). Chosen by itself for two hooks.">
            There and back
          </button>
          <button type="button" role="radio" aria-checked={!band.fold} className={`chip ${!band.fold ? 'active' : ''}`} onClick={() => band.setBack(!band.fold && session.back !== 'auto' ? 'auto' : 'straight')} title="Round every spot in turn and back to the first (a loop round posts, an intake roller). Chosen by itself for three or more hooks.">
            Loop
          </button>
        </div>
      )}

      {readout && (
        <div className="band-readout">
          <span className="band-dot" style={{ background: hex(STRETCH_COLORS[readout.state]) }} />
          <strong>{readout.stretch.toFixed(2)}×</strong> {readout.state} · {readout.pullN.toFixed(1)} N · {Math.round(readout.lengthMm)} mm round ({readout.size}, {Math.round(readout.freeMm)} mm free)
          {readout.suggestion && (
            <div className="band-suggest">
              A {readout.suggestion.name} would be {readout.suggestion.stretch.toFixed(2)}×.{' '}
              <button type="button" className="link-btn" onClick={() => band.setSize(readout.suggestion.partNumber)}>
                Use it
              </button>
            </div>
          )}
        </div>
      )}

      {readout?.added?.length > 0 && (
        <div className="band-suggest">Wound round {[...new Set(readout.added.map((s) => entryLabel(s).part))].join(', ')}, in the way.</div>
      )}
      {band.engine?.error && <div className="band-inway" role="alert">{band.engine.error}</div>}

      {session.needsRoute && (
        <div className="band-inway" role="alert">
          {session.needsRoute.map((p) => (
            <div key={p.instanceId} className="band-inway-row">
              <span>The band would pass through {p.label}.</span>
              <button type="button" className="chip" onClick={() => band.finish({ [p.instanceId]: 'over' })} title="Round its far side from the loop's middle">
                Over
              </button>
              <button type="button" className="chip" onClick={() => band.finish({ [p.instanceId]: 'under' })} title="Round its near side">
                Under
              </button>
            </div>
          ))}
        </div>
      )}

      {ring && <RingCloseUp ring={ring} route={band.shownRoute} hover={hover} onGap={band.toggleGap} onPost={band.toggleGap} />}
      {ringParts.length > 1 && (
        <div className="band-ring-switch">
          {ringParts.map((r, i) => (
            <button key={r.instanceId} type="button" className={`chip ${r === ring ? 'active' : ''}`} onClick={() => setRingIndex(i)} title={r.label}>
              {r.name.replace(' Sprocket', '').replace(' Gear', '')}
            </button>
          ))}
        </div>
      )}

      <div className="band-panel-row band-actions">
        <button type="button" className="btn btn-outline" onClick={band.undoSpot} disabled={!session.route.length} title="Take off the last spot (Backspace)">
          <Undo2 size={13} /> Back
        </button>
        {!editing && (
          <button type="button" className="btn btn-outline" onClick={() => band.otherWay(1)} disabled={!band.ways || band.ways.count < 2} title="Show the next way round the parts between (over them or under them). R does the same while no spot is lit.">
            <Route size={13} /> Other way round{band.ways && band.ways.count > 1 ? ` (${band.ways.index + 1} of ${band.ways.count})` : ''}
          </button>
        )}
        <button type="button" className="btn btn-primary-action" onClick={() => band.finish()} disabled={session.route.length < 2} title="Close the band and add it (Enter)">
          Done
        </button>
      </div>
    </div>
  );
}

function WrapButtons({ value, onChange }) {
  return (
    <span className="band-wraps" title="Turns round this spot">
      <button type="button" className="icon-btn" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label="Fewer wraps">
        <Minus size={11} />
      </button>
      <span>{value}×</span>
      <button type="button" className="icon-btn" onClick={() => onChange(Math.min(3, value + 1))} disabled={value >= 3} aria-label="More wraps">
        <Plus size={11} />
      </button>
    </span>
  );
}

/**
 * A flat drawing of a gear's, sprocket's or pulley's face: numbered notches for its tooth gaps, dots
 * for the posts on it, and the band's route drawn over it. Clicking a notch or a dot adds it to the
 * route, or takes it off.
 */
function RingCloseUp({ ring, route, hover, onGap, onPost }) {
  const size = 200;
  const R = ring.radius;
  const scale = (size / 2 - 18) / R;
  const P = (x, y) => [size / 2 + x * scale, size / 2 - y * scale];
  const inRoute = (instanceId, feature) => route.findIndex((s) => s.instanceId === instanceId && s.feature === feature);
  // The route's spots on this gear, in route order, joined by a line
  const marks = route
    .map((s, i) => {
      if (s.instanceId === ring.instanceId) {
        const g = ring.gaps.find((x) => x.feature === s.feature);
        return g ? { i, at: P(g.x * ring.root, g.y * ring.root) } : null;
      }
      const post = ring.posts.find((p) => p.instanceId === s.instanceId && p.feature === s.feature);
      return post ? { i, at: P(post.x, post.y) } : null;
    })
    .filter(Boolean);
  const showEvery = ring.gaps.length > 30 ? 4 : ring.gaps.length > 16 ? 2 : 1;
  return (
    <figure className="band-ring" aria-label={`${ring.name} close-up`}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={R * scale} className="band-ring-rim" />
        {ring.gaps.map((g) => {
          const [x, y] = P(g.x * ring.root, g.y * ring.root);
          const [lx, ly] = P(g.x * (R + 7), g.y * (R + 7));
          const on = inRoute(ring.instanceId, g.feature) >= 0;
          const lit = hover && hover.instanceId === ring.instanceId && hover.feature === g.feature;
          return (
            <g key={g.feature} className={`band-notch ${on ? 'on' : ''} ${lit ? 'lit' : ''}`} onClick={() => onGap(ring.instanceId, g.feature)} role="button" aria-label={`gap ${g.gap}`}>
              <circle cx={x} cy={y} r={on || lit ? 4.5 : 3} />
              {(g.gap % showEvery === 0 || on) && (
                <text x={lx} y={ly + 3} textAnchor="middle">
                  {g.gap}
                </text>
              )}
            </g>
          );
        })}
        {ring.posts.map((p) => {
          const [x, y] = P(p.x, p.y);
          const on = inRoute(p.instanceId, p.feature) >= 0;
          return (
            <circle key={`${p.instanceId}|${p.feature}`} cx={x} cy={y} r={Math.max(4, p.r * scale)} className={`band-post ${on ? 'on' : ''}`} onClick={() => onPost(p.instanceId, p.feature)} role="button" aria-label={p.label}>
              <title>{p.label}</title>
            </circle>
          );
        })}
        {marks.length >= 2 && <polyline points={marks.map((m) => m.at.join(',')).join(' ')} className="band-ring-route" />}
      </svg>
      <figcaption>{ring.name}: click a notch or a post to add it, or take it off</figcaption>
    </figure>
  );
}
