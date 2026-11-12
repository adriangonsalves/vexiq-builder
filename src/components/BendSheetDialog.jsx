import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useDialogDrag } from './BuildMenu.jsx';
import HelpQ from '../help/HelpQ.jsx';

/**
 * Bend sheet (openspec shaped-parts-and-sheet-bending): a draggable dialog over a light backdrop, so
 * the sheet stays in view. It asks `loadChoices()` (async: { ok, choices, reasons, error }) for the
 * ways the sheet can be anchored to the other part and lists them; pointing at or picking one calls
 * `onPreview(choice)` (the 3D view shows the sheet bent that way and marks the target holes), and
 * Apply calls `onApply(choice)`, which may return (or resolve to) a reason it didn't work. With no
 * target (a bent sheet alone) only Flatten is offered; `bent` shows Flatten beside the choices.
 */
export default function BendSheetDialog({ open, sheetLabel, targetLabel = null, bent = false, loadChoices, onPreview, onApply, onFlatten, onClose, onHelp }) {
  const ref = useRef(null);
  const drag = useDialogDrag(ref);
  const [state, setState] = useState({ loading: false, choices: [], reasons: [], error: null });
  const [picked, setPicked] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setPicked(null);
      setError(null);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open || !targetLabel) {
      setState({ loading: false, choices: [], reasons: [], error: null });
      return undefined;
    }
    let live = true;
    setState({ loading: true, choices: [], reasons: [], error: null });
    Promise.resolve(loadChoices?.())
      .then((r) => {
        if (!live) return;
        const choices = r?.choices || [];
        setState({ loading: false, choices, reasons: r?.reasons || [], error: r?.ok === false ? r.error : null });
        if (choices.length) {
          setPicked(choices[0].id);
          onPreview?.(choices[0]);
        }
      })
      .catch((err) => live && setState({ loading: false, choices: [], reasons: [], error: String(err?.message || err) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetLabel]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onCloseEvent = () => {
      onPreview?.(null);
      onClose?.();
    };
    dialog.addEventListener('close', onCloseEvent);
    return () => dialog.removeEventListener('close', onCloseEvent);
  }, [onClose, onPreview]);

  const choiceById = (id) => state.choices.find((c) => c.id === id) || null;
  const show = (id) => onPreview?.(choiceById(id ?? picked));
  const apply = async () => {
    const choice = choiceById(picked);
    if (!choice) return;
    const refused = await onApply?.(choice);
    if (typeof refused === 'string') setError(refused);
  };

  return (
    <dialog ref={ref} closedby="any" className="settings-dialog chain-route-dialog bend-sheet-dialog" aria-labelledby="bendSheetTitle">
      <div className="settings-header" {...drag} title="Drag to move">
        <strong id="bendSheetTitle">Bend sheet</strong>
        <HelpQ tool="Bend sheet" onHelp={onHelp} className="help-q-head" />
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close" title="Cancel (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="settings-body">
        <p className="settings-note" style={{ marginTop: 10 }}>
          {targetLabel
            ? `Where ${sheetLabel} can be anchored to ${targetLabel}. The rows already pinned stay flat; the sheet curves onto the row you pick.`
            : `${sheetLabel} is bent. Flatten it, or select it with another part to anchor a further row.`}
        </p>
        {state.loading && <p className="settings-note">Looking for rows that line up…</p>}
        {state.error && (
          <p className="settings-note chain-route-error" role="alert">
            {state.error}
          </p>
        )}
        {targetLabel && !state.loading && !state.error && state.choices.length === 0 && (
          <div className="settings-note bend-sheet-reasons" role="status">
            <p style={{ margin: '0 0 4px' }}>No row of the sheet can be anchored there:</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(state.reasons.length ? state.reasons : ['No row of the sheet lines up with that part.']).slice(0, 6).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        <div role="listbox" aria-label="Where to anchor the sheet" onMouseLeave={() => show(picked)}>
          {state.choices.map((c) => (
            <div
              key={c.id}
              role="option"
              aria-selected={picked === c.id}
              tabIndex={0}
              className={`settings-row bend-sheet-choice${picked === c.id ? ' active' : ''}`}
              onMouseEnter={() => show(c.id)}
              onFocus={() => show(c.id)}
              onClick={() => {
                setPicked(c.id);
                setError(null);
                show(c.id);
              }}
              onDoubleClick={apply}
            >
              <span className="settings-row-text">
                <span className="settings-row-label">{c.name}</span>
                {c.note && <span className="settings-row-hint">{c.note}</span>}
              </span>
            </div>
          ))}
        </div>
        {error && (
          <p className="settings-note chain-route-error" role="alert">
            {error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          {bent && (
            <button type="button" className="btn btn-outline" data-help="bend-flatten" onClick={() => onFlatten?.()} title="Remove the bend: the sheet goes flat again through its held rows">
              Flatten
            </button>
          )}
          <button type="button" className="btn btn-outline" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          {targetLabel && (
            <button type="button" className={`btn ${picked ? 'active' : 'btn-outline'}`} disabled={!picked} data-help="bend-apply" onClick={apply}>
              Apply
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
