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
 * Track builder's question: add rubber grippers (Traction Links) or not. `grippers` is remembered by
 * the caller while the page is open. Build calls onBuild(grippers); Cancel, Esc or a click outside
 * builds nothing.
 */
export function TrackBuilderDialog({ open, grippers, onClose, onBuild }) {
  const ref = useRef(null);
  const [checked, setChecked] = useState(grippers);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setChecked(grippers);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, grippers]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onCloseEvent = () => onClose();
    dialog.addEventListener('close', onCloseEvent);
    return () => dialog.removeEventListener('close', onCloseEvent);
  }, [onClose]);

  return (
    <dialog ref={ref} closedby="any" className="settings-dialog" aria-labelledby="trackBuilderTitle">
      <div className="settings-header">
        <strong id="trackBuilderTitle">Track builder</strong>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close" title="Cancel (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="settings-body">
        <p className="settings-note" style={{ marginTop: 10 }}>
          Wraps a loop of Tank Tread Attachment Links round the selected sprockets.
        </p>
        <label className="settings-row">
          <span className="settings-row-text">
            <span className="settings-row-label">Add rubber grippers</span>
            <span className="settings-row-hint">A Traction Link in every tread link, facing out</span>
          </span>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} autoFocus />
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <button type="button" className="btn btn-outline" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="btn active"
            onClick={() => {
              onBuild(checked);
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
