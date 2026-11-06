import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Download, FilePlus2, FolderOpen, Sparkles, Trash2 } from 'lucide-react';
import PopoverMenu, { MenuDivider, MenuItem } from './PopoverMenu.jsx';

/**
 * The toolbar's File menu (openspec build-library): New, Starter ▸ (every starter, shown under it
 * on hover or click), Load…, Export and Delete this build….
 */
export default function FileMenu({ starters, onNew, onStarter, onLoad, onExport, onDeleteCurrent }) {
  const buttonRef = useRef(null);
  const [at, setAt] = useState(null);
  const [startersOpen, setStartersOpen] = useState(false);
  const close = useCallback(() => {
    setAt(null);
    setStartersOpen(false);
  }, []);
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
  return (
    <>
      <button ref={buttonRef} type="button" className={`btn ${at ? 'active' : ''}`} onClick={toggle} aria-haspopup="menu" aria-expanded={Boolean(at)} title="New, starters, your saved builds, export" aria-label="File">
        <FolderOpen size={14} className="compact-only" />
        <span className="btn-text">File</span>
        <ChevronDown size={12} className="btn-caret" />
      </button>
      {at && (
        <PopoverMenu at={at} onClose={close} label="File">
          <MenuItem icon={FilePlus2} onSelect={choose(onNew)} title="Start an empty build (the open one stays saved)">
            New
          </MenuItem>
          <div onPointerEnter={() => setStartersOpen(true)}>
            <MenuItem icon={Sparkles} onSelect={() => setStartersOpen(true)} title="Start a new build from a starter">
              <span className="popover-submenu-label">
                Starter
                <ChevronRight size={12} />
              </span>
            </MenuItem>
            {startersOpen && (
              <div className="popover-submenu" role="group" aria-label="Starters">
                {starters.map((s) => (
                  <MenuItem key={s.id} onSelect={choose(() => onStarter(s.id))}>
                    {s.name}
                  </MenuItem>
                ))}
              </div>
            )}
          </div>
          <MenuItem icon={FolderOpen} onSelect={choose(onLoad)} title="Your saved builds, or open one from your computer">
            Load…
          </MenuItem>
          <MenuItem icon={Download} onSelect={choose(onExport)} title="Download this build as a .vexiq.json file">
            Export
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={Trash2} onSelect={choose(onDeleteCurrent)} title="Remove this build from this browser's storage">
            Delete this build…
          </MenuItem>
        </PopoverMenu>
      )}
    </>
  );
}

/** The current build's name beside the title: click to type a new one (Enter keeps, Esc cancels). */
export function BuildNameField({ name, onRename }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    const next = (draft ?? '').trim();
    setDraft(null);
    if (next && next !== name) onRename(next);
  };
  if (draft === null) {
    return (
      <button type="button" className="build-name" onClick={() => setDraft(name || '')} title="Click to rename this build">
        {name || '…'}
      </button>
    );
  }
  return (
    <input
      className="build-name-input"
      value={draft}
      autoFocus
      aria-label="Build name"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          e.stopPropagation();
          setDraft(null);
        }
      }}
      onFocus={(e) => e.target.select()}
    />
  );
}
