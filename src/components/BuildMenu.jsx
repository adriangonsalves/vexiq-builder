import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Hammer, Link2, X } from 'lucide-react';
import PopoverMenu, { MenuItem } from './PopoverMenu.jsx';
import { ATTACHMENT_EVERY_MAX } from '../utils/chainPath.js';

/**
 * The toolbar's Build menu (openspec chain-track-builder): Chain builder and Track builder, for two
 * or more sprockets in one plane. `chainCheck` is checkSprocketsForChain's answer for the selection;
 * when it isn't ok both items are greyed out and its message says what is missing.
 */
export default function BuildMenu({ chainCheck, disabledReason = null, onChain, onTrack }) {
  const buttonRef = useRef(null);
  const [at, setAt] = useState(null);
  const close = useCallback(() => setAt(null), []);
  const choose = (fn) => () => {
    close();
    fn();
  };
  const toggle = () => {
    if (at) {
      close();
      return;
    }
    const r = buttonRef.current.getBoundingClientRect();
    setAt({ x: r.left, y: r.bottom + 4 });
  };
  const reason = disabledReason || (chainCheck?.ok ? null : chainCheck?.error || 'Select two or more sprockets in one plane.');
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn ${at ? 'active' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        title="Build a chain or a track round sprockets"
      >
        <Hammer size={14} />
        Build
        <ChevronDown size={12} />
      </button>
      {at && (
        <PopoverMenu at={at} onClose={close} label="Build">
          <MenuItem icon={Link2} disabled={Boolean(reason)} onSelect={choose(onChain)} title={reason || 'Wrap a loop of Chain Links round the selected sprockets'}>
            Chain builder
          </MenuItem>
          <MenuItem disabled={Boolean(reason)} onSelect={choose(onTrack)} title={reason || 'Wrap a tank track round the selected sprockets, with rubber grippers if you like'}>
            Track builder…
          </MenuItem>
          {reason && <div className="popover-note">{reason}</div>}
        </PopoverMenu>
      )}
    </>
  );
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
 * (`slackMm`, null when there is no choice to make). `attachment`, `every` and `slack` are
 * remembered by the caller while the page is open. Build calls onBuild({ attachment, every, slack });
 * Cancel, Esc or a click outside builds nothing.
 */
export function ChainBuilderDialog({ open, kind = 'chain', attachment = 'traction', every = 1, slack = 'lower', slackMm = null, onClose, onBuild }) {
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
      setRun(slack);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, attachment, every, slack]);

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
                <label key={value} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="radio" name="chainSlack" value={value} checked={run === value} onChange={() => setRun(value)} autoFocus={!track && idx === 0} />
                  {label}
                </label>
              ))}
            </span>
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
 * Chain builder's over/under dialog (openspec chain-over-under): one row per part in the chain's
 * way (an enclosed sprocket or standoff, or a crossing sprocket, whose `outside` names the answer
 * that wraps round its outside) with two toggle buttons, Under and Over, a hint, and no default. `initialRoute`
 * (Map or plain object) holds any choices remembered for the page. Hovering or focusing a row calls
 * `onHighlight(instanceId)` so the 3D view highlights that part; the first row is highlighted on
 * open. Build is enabled only when every row has a choice.
 */
export function ChainRouteDialog({ open, enclosed = [], initialRoute = null, onHighlight, onClose, onBuild }) {
  const ref = useRef(null);
  const [choices, setChoices] = useState({});

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
    onHighlight?.(instanceId);
  };

  return (
    <dialog ref={ref} closedby="any" className="settings-dialog" aria-labelledby="chainRouteTitle">
      <div className="settings-header">
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
              onBuild?.(choices);
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

