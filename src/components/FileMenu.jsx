import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, CloudCheck, CloudUpload, Download, FilePlus2, FolderOpen, Sparkles, Trash2 } from 'lucide-react';
import PopoverMenu, { MenuDivider, MenuHeading, MenuItem } from './PopoverMenu.jsx';
import { STARTER_SECTIONS } from '../starters.js';

/**
 * The toolbar's File menu (openspec build-library): New, Starter ▸ (every starter, shown under it
 * on hover or click, under the headings Robots and Assemblies: openspec starter-assemblies), Load…,
 * Export and Delete this build…. With Google Drive set up (openspec google-drive-sync): Save to
 * Google Drive… and, while editing a Drive build, Done editing. Opening the menu starts loading the
 * Google scripts, so sign-in can open straight from the tap.
 */
export default function FileMenu({ starters, onNew, onStarter, onLoad, onExport, onDeleteCurrent, drive, onMenuOpen }) {
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
    onMenuOpen?.();
  };
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  return (
    <>
      <button ref={buttonRef} type="button" className={`btn ${at ? 'active' : ''}`} onClick={toggle} aria-haspopup="menu" aria-expanded={Boolean(at)} title="New, starters, your saved builds, export" aria-label="File" data-help="file">
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
            <MenuItem icon={Sparkles} onSelect={() => setStartersOpen(true)} title="Start a new build from a starter, or add one to your build">
              <span className="popover-submenu-label">
                Starter
                <ChevronRight size={12} />
              </span>
            </MenuItem>
            {startersOpen && (
              <div className="popover-submenu" role="group" aria-label="Starters">
                {STARTER_SECTIONS.map((section) => {
                  const list = starters.filter((s) => (s.section || 'robots') === section.id);
                  if (!list.length) return null;
                  return (
                    <React.Fragment key={section.id}>
                      <MenuHeading>{section.name}</MenuHeading>
                      {list.map((s) => (
                        <MenuItem key={s.id} onSelect={choose(() => onStarter(s.id))}>
                          {s.name}
                        </MenuItem>
                      ))}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
          <MenuItem icon={FolderOpen} onSelect={choose(onLoad)} title="Your saved builds, or open one from your computer">
            Load…
          </MenuItem>
          <MenuItem icon={Download} onSelect={choose(onExport)} title="Download this build as a .vexiq.json file">
            Export
          </MenuItem>
          {drive?.configured && (
            <>
              <MenuDivider />
              <MenuItem
                icon={CloudUpload}
                onSelect={choose(() => drive.session.askWhereToSave())}
                disabled={!online || drive.readOnlyViewer}
                title={!online ? 'Needs an internet connection' : drive.readOnlyViewer ? 'Not while this build is read-only' : 'Save this build as a new file on Google Drive, in your team’s folder or your My Drive'}
                help="save-to-drive"
              >
                Save to Google Drive…
              </MenuItem>
              {drive.linked && drive.mode === 'edit' && (
                <MenuItem icon={CloudCheck} onSelect={choose(() => drive.session.doneEditing())} title="Save if needed, then finish editing so a teammate can edit" help="done-editing">
                  Done editing
                </MenuItem>
              )}
            </>
          )}
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
export function BuildNameField({ name, onRename, readOnly = false }) {
  const [draft, setDraft] = useState(null);
  // A Read-only or paused Drive build can't be renamed (openspec google-drive-sync)
  if (readOnly) {
    return (
      <span className="build-name build-name-readonly" data-help="build-name">
        {name || '…'}
      </span>
    );
  }
  const commit = () => {
    const next = (draft ?? '').trim();
    setDraft(null);
    if (next && next !== name) onRename(next);
  };
  if (draft === null) {
    return (
      <button type="button" className="build-name" data-help="build-name" onClick={() => setDraft(name || '')} title="Click to rename this build">
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
