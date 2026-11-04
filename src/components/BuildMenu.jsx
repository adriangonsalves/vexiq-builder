import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { ATTACHMENT_EVERY_MAX, UPPER_BLOCKED } from '../utils/chainPath.js';

/**
 * Lets a modal <dialog> be dragged by the element these props go on (its header). The offset is kept
 * while the page is open, so the dialog opens where it was left; it stays at least partly on screen.
 */
function useDialogDrag(ref) {
  const offset = useRef({ x: 0, y: 0 });
  const place = () => {
    if (ref.current) ref.current.style.transform = `translate(${offset.current.x}px, ${offset.current.y}px)`;
  };
  useEffect(place);
  const onPointerDown = (e) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    const start = { x: e.clientX, y: e.clientY, ox: offset.current.x, oy: offset.current.y };
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const limX = window.innerWidth / 2;
      const limY = window.innerHeight / 2;
      offset.current = {
        x: Math.max(-limX, Math.min(limX, start.ox + ev.clientX - start.x)),
        y: Math.max(-limY, Math.min(limY, start.oy + ev.clientY - start.y))
      };
      place();
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };
  return { onPointerDown, style: { cursor: 'move', touchAction: 'none', userSelect: 'none' } };
}

// Track builder's attachment choices (openspec chain-over-under, track attachments)
const TRACK_ATTACHMENT_CHOICES = [
  ['traction', 'Traction Link'],
  ['short-flap', 'Short Intake Flap'],
  ['medium-flap', 'Medium Intake Flap'],
  ['long-flap', 'Long Intake Flap'],
  ['none', 'None']
];
const ordinalOf = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

/**
 * Chain and Track builder's questions. Track builder always asks which attachment goes in the tread
 * links (a Traction Link, an Intake Flap or none) and on every how many links (1 to 20); either
 * builder asks which run holds the slack when the chain is noticeably longer than the path
 * (`slackMm`, null when there is no choice to make; with `upperBlocked` Upper run is shown unavailable,
 * with the reason). `attachment`, `every` and `slack` are
 * remembered by the caller while the page is open. Build calls onBuild({ attachment, every, slack });
 * Cancel, Esc or a click outside builds nothing.
 */
export function ChainBuilderDialog({ open, kind = 'chain', attachment = 'traction', every = 1, slack = 'lower', slackMm = null, upperBlocked = false, onClose, onBuild }) {
  const ref = useRef(null);
  const [att, setAtt] = useState(attachment);
  const [spacing, setSpacing] = useState(every);
  const [run, setRun] = useState(slack);
  const track = kind === 'track';

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setAtt(attachment);
      setSpacing(every);
      setRun(upperBlocked ? 'lower' : slack);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, attachment, every, slack, upperBlocked]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onCloseEvent = () => onClose();
    dialog.addEventListener('close', onCloseEvent);
    return () => dialog.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  return (
    <dialog ref={ref} closedby="any" className="settings-dialog" aria-labelledby="chainBuilderTitle">
      <div className="settings-header">
        <strong id="chainBuilderTitle">{track ? 'Track builder' : 'Chain builder'}</strong>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close" title="Cancel (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="settings-body">
        <p className="settings-note" style={{ marginTop: 10 }}>
          {track ? 'Wraps a loop of Tank Tread Attachment Links round the selected sprockets.' : 'Wraps a loop of Chain Links round the selected sprockets.'}
        </p>
        {track && (
          <fieldset className="settings-row" style={{ border: 0, padding: 0, margin: 0, display: 'block' }}>
            <span className="settings-row-text">
              <span className="settings-row-label">Attachment</span>
              <span className="settings-row-hint">Plugged into the tread links, facing out</span>
            </span>
            <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 6 }}>
              {TRACK_ATTACHMENT_CHOICES.map(([value, label], idx) => (
                <label key={value} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="radio" name="trackAttachment" value={value} checked={att === value} onChange={() => setAtt(value)} autoFocus={att === value || (idx === 0 && !TRACK_ATTACHMENT_CHOICES.some(([v]) => v === att))} />
                  {label}
                </label>
              ))}
            </span>
          </fieldset>
        )}
        {track && att !== 'none' && (
          <div className="settings-slider-row">
            <label className="settings-slider-label">
              <span className="settings-row-text">
                <span className="settings-row-label">Every</span>
                <span className="settings-row-hint">{spacing === 1 ? 'On every tread link' : `On every ${ordinalOf(spacing)} tread link`}</span>
              </span>
              <div className="settings-slider-wrap">
                <input type="range" min="1" max={ATTACHMENT_EVERY_MAX} step="1" value={spacing} onChange={(e) => setSpacing(Number(e.target.value))} />
                <span className="settings-slider-val">{spacing}</span>
              </div>
            </label>
          </div>
        )}
        {slackMm != null && (
          <fieldset className="settings-row" style={{ border: 0, padding: 0, margin: 0, display: 'block' }}>
            <span className="settings-row-text">
              <span className="settings-row-label">Slack on</span>
              <span className="settings-row-hint">
                The {track ? 'track' : 'chain'} is {slackMm.toFixed(1)} mm longer than the path, so one run hangs loose.
              </span>
            </span>
            <span style={{ display: 'flex', gap: 16, marginTop: 6 }}>
              {[
                ['lower', 'Lower run'],
                ['upper', 'Upper run']
              ].map(([value, label], idx) => (
                <label key={value} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', opacity: value === 'upper' && upperBlocked ? 0.5 : 1 }}>
                  <input type="radio" name="chainSlack" value={value} checked={run === value} disabled={value === 'upper' && upperBlocked} onChange={() => setRun(value)} autoFocus={!track && idx === 0} />
                  {label}
                </label>
              ))}
            </span>
            {upperBlocked && <span className="settings-row-hint" style={{ display: 'block', marginTop: 6 }}>{UPPER_BLOCKED}</span>}
          </fieldset>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn btn-outline" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn active"
            onClick={() => {
              onBuild({ attachment: att, every: spacing, slack: run });
              ref.current?.close();
            }}
          >
            Build
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Chain builder's over/under dialog (openspec chain-over-under), draggable by its header over a light
 * backdrop so the highlighted part stays in view: one row per part in the chain's
 * way (an enclosed sprocket or standoff, or a crossing sprocket, whose `outside` names the answer
 * that wraps round its outside) with two toggle buttons, Under and Over, a hint, and no default. `initialRoute`
 * (Map or plain object) holds any choices remembered for the page. Hovering or focusing a row calls
 * `onHighlight(instanceId)` so the 3D view highlights that part; the first row is highlighted on
 * open. Build is enabled only when every row has a choice.
 */
export function ChainRouteDialog({ open, enclosed = [], initialRoute = null, onHighlight, onClose, onBuild }) {
  const ref = useRef(null);
  const [choices, setChoices] = useState({});
  const [error, setError] = useState(null);
  const drag = useDialogDrag(ref);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const next = {};
      for (const item of enclosed) {
        const val =
          initialRoute instanceof Map ? initialRoute.get(item.instanceId) : initialRoute?.[item.instanceId];
        if (val === 'over' || val === 'under') next[item.instanceId] = val;
      }
      setChoices(next);
      setError(null);
      onHighlight?.(enclosed[0]?.instanceId ?? null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, enclosed, initialRoute, onHighlight]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onCloseEvent = () => onClose?.();
    const onClick = (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = r.top <= event.clientY && event.clientY <= r.bottom && r.left <= event.clientX && event.clientX <= r.right;
      if (!inside) dialog.close();
    };
    dialog.addEventListener('close', onCloseEvent);
    dialog.addEventListener('click', onClick);
    return () => {
      dialog.removeEventListener('close', onCloseEvent);
      dialog.removeEventListener('click', onClick);
    };
  }, [onClose]);

  const allChosen =
    enclosed.length > 0 && enclosed.every((item) => choices[item.instanceId] === 'over' || choices[item.instanceId] === 'under');

  const pick = (instanceId, side) => {
    setChoices((prev) => ({ ...prev, [instanceId]: side }));
    setError(null);
    onHighlight?.(instanceId);
  };

  return (
    <dialog ref={ref} closedby="any" className="settings-dialog chain-route-dialog" aria-labelledby="chainRouteTitle">
      <div className="settings-header" {...drag} title="Drag to move">
        <strong id="chainRouteTitle">Chain builder</strong>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close" title="Cancel (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="settings-body">
        <p className="settings-note" style={{ marginTop: 10 }}>
          Choose whether the chain passes under or over each part in its way.
        </p>
        {enclosed.map((item, idx) => {
          const choice = choices[item.instanceId];
          return (
            <div
              key={item.instanceId}
              className="settings-row"
              onMouseEnter={() => onHighlight?.(item.instanceId)}
              onFocusCapture={() => onHighlight?.(item.instanceId)}
            >
              <span className="settings-row-text">
                <span className="settings-row-label">{item.label}</span>
                <span className="settings-row-hint">
                  {item.outside ? `${item.outside === 'over' ? 'Over' : 'Under'} wraps round its outside` : 'Inside the loop'}
                </span>
              </span>
              <div role="group" aria-label={`Route for ${item.label}`} style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className={`btn ${choice === 'under' ? 'active' : 'btn-outline'}`}
                  aria-pressed={choice === 'under'}
                  autoFocus={idx === 0}
                  onClick={() => pick(item.instanceId, 'under')}
                >
                  Under
                </button>
                <button
                  type="button"
                  className={`btn ${choice === 'over' ? 'active' : 'btn-outline'}`}
                  aria-pressed={choice === 'over'}
                  onClick={() => pick(item.instanceId, 'over')}
                >
                  Over
                </button>
              </div>
            </div>
          );
        })}
        {error && (
          <p className="settings-note chain-route-error" role="alert">
            {error} Change an answer and build again.
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn btn-outline" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${allChosen ? 'active' : 'btn-outline'}`}
            disabled={!allChosen}
            onClick={() => {
              if (!allChosen) return;
              // onBuild returns a reason when the route can't work: stay open to change an answer
              const refused = onBuild?.(choices);
              if (typeof refused === 'string') {
                setError(refused);
                return;
              }
              ref.current?.close();
            }}
          >
            Build
          </button>
        </div>
      </div>
    </dialog>
  );
}

