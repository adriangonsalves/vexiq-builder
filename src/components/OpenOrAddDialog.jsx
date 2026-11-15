import React, { useEffect, useRef } from 'react';
import { FolderOpen, PackagePlus, X } from 'lucide-react';

/**
 * The open-or-add question (openspec add-build-to-build): shown when a starter, a saved build or a
 * file is opened while the open build has parts. "Open by itself" opens it as before; "Add to this
 * build" brings its parts in as one new group. Cancel, Esc or a tap outside change nothing. A native
 * modal <dialog>, so it sits on top of the library dialog and Esc closes only this one.
 */
export default function OpenOrAddDialog({ pick, buildName, onOpen, onAdd, onCancel }) {
  const ref = useRef(null);
  const answeredRef = useRef(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (pick && !dialog.open) {
      answeredRef.current = false;
      dialog.showModal();
    }
    if (!pick && dialog.open) dialog.close();
  }, [pick]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onClose = () => {
      if (!answeredRef.current) onCancel();
    };
    const onClick = (event) => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = r.top <= event.clientY && event.clientY <= r.bottom && r.left <= event.clientX && event.clientX <= r.right;
      if (!inside) dialog.close();
    };
    dialog.addEventListener('close', onClose);
    dialog.addEventListener('click', onClick);
    return () => {
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('click', onClick);
    };
  }, [onCancel]);

  const answer = (fn) => () => {
    answeredRef.current = true;
    ref.current?.close();
    fn();
  };

  return (
    <dialog ref={ref} closedby="any" className="settings-dialog open-or-add-dialog" aria-labelledby="openOrAddTitle" data-help="open-or-add">
      <div className="settings-header">
        <strong id="openOrAddTitle">Open {pick?.name}</strong>
        <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cancel" title="Cancel (Esc)">
          <X size={16} />
        </button>
      </div>
      <div className="settings-body">
        <p className="settings-note" style={{ marginTop: 10 }}>
          {buildName ? `${buildName} has parts in it.` : 'This build has parts in it.'} Open {pick?.name} on its own, or add it to this build as a group you can move into place?
        </p>
        <div className="open-or-add-choices">
          <button type="button" className="btn btn-outline open-or-add-btn" autoFocus onClick={answer(onOpen)} data-help="open-by-itself">
            <FolderOpen size={20} />
            <span>
              <strong>Open by itself</strong>
              <small>{buildName ? `${buildName} stays saved` : 'This build stays saved'}</small>
            </span>
          </button>
          <button type="button" className="btn btn-outline open-or-add-btn" onClick={answer(onAdd)} data-help="add-to-this-build">
            <PackagePlus size={20} />
            <span>
              <strong>Add to this build</strong>
              <small>Comes in as one group beside your parts</small>
            </span>
          </button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10, marginBottom: 12 }}>
          <button type="button" className="btn btn-outline" onClick={() => ref.current?.close()}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
