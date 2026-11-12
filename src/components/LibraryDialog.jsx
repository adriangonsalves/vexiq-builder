import React, { useEffect, useRef, useState } from 'react';
import { Copy, FolderOpen, Pencil, Trash2, Upload, X } from 'lucide-react';
import { changedAgo } from '../utils/buildLibrary.js';
import HelpQ from '../help/HelpQ.jsx';

/**
 * File → Load… (openspec build-library): every build saved in this browser, newest first, with its
 * picture, name, when it changed and its part count; Open (or double-click), Rename, Duplicate and
 * Delete, and Open from computer… for a .vexiq.json file.
 */
export default function LibraryDialog({ open, onClose, builds, currentId, available, onOpen, onRename, onDuplicate, onDelete, onOpenFile, onHelp }) {
  const ref = useRef(null);
  const fileRef = useRef(null);
  const [renaming, setRenaming] = useState(null); // { id, draft }

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
    if (!open) setRenaming(null);
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const onCloseEvent = () => onClose();
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

  const commitRename = () => {
    if (!renaming) return;
    const name = renaming.draft.trim();
    if (name) onRename(renaming.id, name);
    setRenaming(null);
  };

  return (
    <dialog ref={ref} closedby="any" className="library-dialog" aria-labelledby="libraryTitle">
      <div className="settings-header">
        <strong id="libraryTitle">Your builds</strong>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <HelpQ tool="your builds" onHelp={onHelp} />
          <button type="button" className="btn btn-outline" data-help="library-open-from-computer" onClick={() => fileRef.current?.click()} title="Open a .vexiq.json file as a new build">
            <Upload size={14} />
            Open from computer…
          </button>
          <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Close" title="Close (Esc)">
            <X size={16} />
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onOpenFile(file);
          }}
        />
      </div>
      <div className="library-body">
        {!available && <p className="settings-note">This browser can't keep builds (its storage is turned off). New, Starter and Export still work.</p>}
        {available && builds.length === 0 && <p className="settings-note">No saved builds yet.</p>}
        <div className="library-grid">
          {builds.map((b) => (
            <div
              key={b.id}
              className={`library-card ${b.id === currentId ? 'current' : ''}`}
              onDoubleClick={() => renaming?.id !== b.id && onOpen(b.id)}
              data-build-name={b.name}
            >
              <div className="library-thumb">{b.thumbnail ? <img src={b.thumbnail} alt="" /> : <span>No picture yet</span>}</div>
              <div className="library-info">
                {renaming?.id === b.id ? (
                  <input
                    className="build-name-input"
                    value={renaming.draft}
                    autoFocus
                    aria-label="New name"
                    onChange={(e) => setRenaming({ id: b.id, draft: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                    onFocus={(e) => e.target.select()}
                  />
                ) : (
                  <span className="library-name" title={b.name}>
                    {b.name}
                    {b.id === currentId && <span className="library-current">Open now</span>}
                  </span>
                )}
                <span className="library-meta">
                  {changedAgo(b.updatedAt)} · {b.partCount} part{b.partCount === 1 ? '' : 's'}
                </span>
              </div>
              <div className="library-actions">
                <button type="button" className="btn btn-outline" data-help="build-open" onClick={() => onOpen(b.id)} disabled={b.id === currentId} title="Open this build">
                  <FolderOpen size={13} />
                  Open
                </button>
                <button type="button" className="icon-btn" data-help="build-rename" onClick={() => setRenaming({ id: b.id, draft: b.name })} title="Rename" aria-label={`Rename ${b.name}`}>
                  <Pencil size={13} />
                </button>
                <button type="button" className="icon-btn" data-help="build-duplicate" onClick={() => onDuplicate(b.id)} title="Duplicate" aria-label={`Duplicate ${b.name}`}>
                  <Copy size={13} />
                </button>
                <button type="button" className="icon-btn danger" data-help="build-delete" onClick={() => onDelete(b.id)} title="Delete" aria-label={`Delete ${b.name}`}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}
