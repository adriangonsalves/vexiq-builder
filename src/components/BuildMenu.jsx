import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, Hammer, Link2, X } from 'lucide-react';
import PopoverMenu, { MenuItem } from './PopoverMenu.jsx';

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

/**
 * Chain and Track builder's questions. Track builder always asks whether to add rubber grippers
 * (Traction Links); either builder asks which run holds the slack when the chain is noticeably longer
 * than the path (`slackMm`, null when there is no choice to make). `grippers` and `slack` are
 * remembered by the caller while the page is open. Build calls onBuild({ grippers, slack }); Cancel,
 * Esc or a click outside builds nothing.
 */
export function ChainBuilderDialog({ open, kind = 'chain', grippers, slack = 'lower', slackMm = null, onClose, onBuild }) {
  const ref = useRef(null);
  const [checked, setChecked] = useState(grippers);
  const [run, setRun] = useState(slack);
  const track = kind === 'track';

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setChecked(grippers);
      setRun(slack);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, grippers, slack]);

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
          <label className="settings-row">
            <span className="settings-row-text">
              <span className="settings-row-label">Add rubber grippers</span>
              <span className="settings-row-hint">A Traction Link in every tread link, facing out</span>
            </span>
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} autoFocus />
          </label>
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
              onBuild({ grippers: checked, slack: run });
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
 * Chain builder's over/under dialog (openspec chain-over-under): one row per enclosed sprocket or
 * standoff with two toggle buttons, Under / inner and Over / outer, and no default. `initialRoute`
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
          Choose whether the chain passes under or over each part inside the loop.
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
              </span>
              <div role="group" aria-label={`Route for ${item.label}`} style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  className={`btn ${choice === 'under' ? 'active' : 'btn-outline'}`}
                  aria-pressed={choice === 'under'}
                  autoFocus={idx === 0}
                  onClick={() => pick(item.instanceId, 'under')}
                >
                  Under / inner
                </button>
                <button
                  type="button"
                  className={`btn ${choice === 'over' ? 'active' : 'btn-outline'}`}
                  aria-pressed={choice === 'over'}
                  onClick={() => pick(item.instanceId, 'over')}
                >
                  Over / outer
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

