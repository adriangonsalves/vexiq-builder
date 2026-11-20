import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckSquare, ChevronDown, ChevronRight, CloudDownload, Copy, Folder, FolderInput, FolderMinus, FolderPlus, Layers, Pencil, Trash2, Upload, X } from 'lucide-react';
import { changedAgo, groupDuplicateBuilds, groupLibraryBuilds } from '../utils/buildLibrary.js';
import HelpQ from '../help/HelpQ.jsx';

/** Recognizable tricolor Google Drive triangle mark for Drive folder headers and card badges. */
function GoogleDriveMark({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M8.2 3.5h7.6l6.7 11.6h-7.6L8.2 3.5z" fill="#FBBC04" />
      <path d="M1.5 15.1L8.2 3.5l3.8 6.6-6.7 11.6-3.8-6.6z" fill="#34A853" />
      <path d="M5.3 21.7l3.8-6.6h13.4l-3.8 6.6H5.3z" fill="#4285F4" />
    </svg>
  );
}

/**
 * File → Load… (openspec build-library, library-folders-and-select): every build saved in this
 * browser, organized into ungrouped local builds, single-level local folders, and Google Drive
 * folders (with parent-name disambiguation when folder names collide). Clicking a build's thumbnail
 * opens it directly; Select mode lets users multi-select builds to group into local folders or
 * delete in bulk on desktop, tablet, and phone.
 */
export default function LibraryDialog({
  open,
  onClose,
  builds,
  currentId,
  available,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onBulkDelete,
  onMoveToFolder,
  onRenameFolder,
  onRemoveFolder,
  onOpenFile,
  onHelp,
  onOpenFromDrive,
  onDialogOpen
}) {
  const ref = useRef(null);
  const fileRef = useRef(null);
  const [renaming, setRenaming] = useState(null); // { id, draft }
  const [renamingFolder, setRenamingFolder] = useState(null); // { name, draft }
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [groupDuplicates, setGroupDuplicates] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [newFolderDraft, setNewFolderDraft] = useState('');
  const [collapsed, setCollapsed] = useState(() => new Set());

  const { sections, localFolderNames } = useMemo(() => groupLibraryBuilds(builds), [builds]);
  const duplicateGroups = useMemo(() => groupDuplicateBuilds(builds, currentId), [builds, currentId]);
  const activeSections = groupDuplicates ? duplicateGroups : sections;
  const visibleIds = useMemo(() => activeSections.flatMap((s) => s.builds.map((b) => b.id)), [activeSections]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const showSectionHeaders = groupDuplicates || sections.length > 1 || (sections.length === 1 && sections[0].kind !== 'local-ungrouped');

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      onDialogOpen?.();
    }
    if (!open && dialog.open) dialog.close();
    if (!open) {
      setRenaming(null);
      setRenamingFolder(null);
      setSelecting(false);
      setSelectedIds(new Set());
      setGroupDuplicates(false);
      setFolderPickerOpen(false);
      setNewFolderDraft('');
    }
  }, [open]);

  // Drop deleted builds from selection if builds list shrinks while open
  useEffect(() => {
    if (!selectedIds.size) return;
    const valid = new Set(builds.map((b) => b.id));
    let changed = false;
    const next = new Set();
    for (const id of selectedIds) {
      if (valid.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelectedIds(next);
  }, [builds]);

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

  const commitFolderRename = () => {
    if (!renamingFolder) return;
    const nextName = renamingFolder.draft.trim();
    if (nextName && nextName !== renamingFolder.name) onRenameFolder?.(renamingFolder.name, nextName);
    setRenamingFolder(null);
  };

  const exitSelect = () => {
    setSelecting(false);
    setSelectedIds(new Set());
    setFolderPickerOpen(false);
    setNewFolderDraft('');
  };

  const toggleSelectMode = () => {
    if (selecting) exitSelect();
    else {
      setRenaming(null);
      setRenamingFolder(null);
      setSelecting(true);
    }
  };

  const toggleCardSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(visibleIds));
  };

  const toggleSectionIds = (ids) => {
    setRenaming(null);
    setRenamingFolder(null);
    setSelecting(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allIn = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allIn) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const toggleSectionCollapse = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectedBuilds = useMemo(() => builds.filter((b) => selectedIds.has(b.id)), [builds, selectedIds]);
  const hasSelectedDrive = selectedBuilds.some((b) => Boolean(b.drive?.fileId));
  const hasSelectedInFolder = selectedBuilds.some((b) => Boolean(b.folder));

  const applyMoveToFolder = async (folderName) => {
    const ids = [...selectedIds];
    if (!ids.length || hasSelectedDrive) return;
    await onMoveToFolder?.(ids, folderName);
    exitSelect();
  };

  const handleBulkDeleteClick = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const deleted = await onBulkDelete?.(ids);
    if (deleted) exitSelect();
  };

  const renderCard = (b) => {
    const isCurrent = b.id === currentId;
    const isDrive = Boolean(b.drive?.fileId);
    const isSelected = selectedIds.has(b.id);
    return (
      <div
        key={b.id}
        className={`library-card ${isCurrent ? 'current' : ''} ${selecting ? 'selecting' : ''} ${isSelected ? 'selected' : ''}`}
        data-build-name={b.name}
        data-drive={isDrive ? 'true' : undefined}
        onClick={selecting ? () => toggleCardSelection(b.id) : undefined}
      >
        <button
          type="button"
          className="library-thumb-btn"
          data-help="build-open"
          disabled={!selecting && isCurrent}
          onClick={(e) => {
            if (selecting) {
              e.stopPropagation();
              toggleCardSelection(b.id);
              return;
            }
            if (renaming?.id !== b.id && !isCurrent) onOpen(b.id);
          }}
          title={selecting ? (isSelected ? `Deselect ${b.name}` : `Select ${b.name}`) : isCurrent ? 'Open now' : `Open ${b.name}`}
          aria-label={selecting ? `${isSelected ? 'Deselect' : 'Select'} ${b.name}` : `Open ${b.name}`}
        >
          <div className="library-thumb">
            {b.thumbnail ? <img src={b.thumbnail} alt="" /> : <span>No picture yet</span>}
            {selecting && (
              <span className={`library-select-check ${isSelected ? 'checked' : ''}`} aria-hidden="true">
                {isSelected && <Check size={12} strokeWidth={3} />}
              </span>
            )}
            {isDrive && (
              <span className="library-drive-badge" title={b.drive?.folderName ? `Google Drive · ${b.drive.folderName}` : 'Saved on Google Drive'}>
                <GoogleDriveMark size={15} />
                Google Drive
              </span>
            )}
          </div>
        </button>
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
              <span className="library-name-text">{b.name}</span>
              {isCurrent && <span className="library-current">Open now</span>}
            </span>
          )}
          <span className="library-meta">
            {changedAgo(b.updatedAt)} · {b.partCount} part{b.partCount === 1 ? '' : 's'}
          </span>
        </div>
        {!selecting && (
          <div className="library-actions">
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
        )}
      </div>
    );
  };

  return (
    <dialog ref={ref} closedby="any" className="library-dialog" aria-labelledby="libraryTitle">
      <div className="settings-header">
        <strong id="libraryTitle">Your builds</strong>
        <div className="library-header-actions">
          <HelpQ tool="your builds" onHelp={onHelp} />
          {builds.length >= 2 && (
            <button
              type="button"
              className={`btn ${groupDuplicates ? 'btn-primary' : 'btn-outline'}`}
              data-help="library-duplicates"
              onClick={() => setGroupDuplicates((v) => !v)}
              title={groupDuplicates ? 'Show all builds by folder' : 'Group identical builds together to clean up duplicates'}
            >
              <Layers size={14} />
              Duplicates{duplicateGroups.length > 0 ? ` (${duplicateGroups.length})` : ''}
            </button>
          )}
          {builds.length > 0 && (
            <button
              type="button"
              className={`btn ${selecting ? 'btn-primary' : 'btn-outline'}`}
              data-help="library-select"
              onClick={toggleSelectMode}
              title={selecting ? 'Exit select mode' : 'Select multiple builds to group into folders or delete'}
            >
              <CheckSquare size={14} />
              {selecting ? 'Done' : 'Select'}
            </button>
          )}
          {onOpenFromDrive && (
            <button
              type="button"
              className="btn btn-outline"
              data-help="library-open-from-drive"
              disabled={typeof navigator !== 'undefined' && navigator.onLine === false}
              onClick={() => {
                // This window stays above everything on the page, Google's file picker included,
                // so it closes first; the picker then opens in front
                ref.current?.close();
                onOpenFromDrive();
              }}
              title={typeof navigator !== 'undefined' && navigator.onLine === false ? 'Needs an internet connection' : 'Open a build from your Google Drive, or one a teammate shared with you'}
            >
              <CloudDownload size={14} />
              Open from Google Drive…
            </button>
          )}
          <button type="button" className="btn btn-outline" data-help="library-open-from-computer" onClick={() => fileRef.current?.click()} title="Open a .vexiq.json file as a new build, or add it to yours">
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

      {selecting && (
        <div className="library-select-bar">
          <div className="library-select-left">
            <span className="library-select-count">
              {selectedIds.size === 0 ? 'Tap builds to select' : `${selectedIds.size} selected`}
            </span>
            {visibleIds.length > 0 && (
              <button type="button" className="btn btn-outline btn-compact" onClick={toggleSelectAllVisible}>
                {allVisibleSelected ? 'Deselect all' : `Select all (${visibleIds.length})`}
              </button>
            )}
          </div>
          <div className="library-select-actions">
            <button
              type="button"
              className="btn btn-outline"
              disabled={selectedIds.size === 0 || hasSelectedDrive}
              onClick={() => setFolderPickerOpen((v) => !v)}
              title={hasSelectedDrive ? 'Google Drive builds stay in their Drive folder' : 'Group selected builds into a folder'}
            >
              <FolderInput size={14} />
              Move to folder…
            </button>
            <button
              type="button"
              className="btn btn-outline danger"
              disabled={selectedIds.size === 0}
              onClick={handleBulkDeleteClick}
              title="Delete selected builds"
            >
              <Trash2 size={14} />
              Delete
            </button>
            <button type="button" className="btn btn-outline" onClick={exitSelect}>
              Cancel
            </button>
          </div>
          {folderPickerOpen && selectedIds.size > 0 && !hasSelectedDrive && (
            <div className="library-folder-picker">
              <div className="library-folder-picker-list">
                {localFolderNames.map((fname) => (
                  <button key={fname} type="button" className="btn btn-outline" onClick={() => applyMoveToFolder(fname)}>
                    <Folder size={13} />
                    {fname}
                  </button>
                ))}
                {hasSelectedInFolder && (
                  <button type="button" className="btn btn-outline" onClick={() => applyMoveToFolder(null)}>
                    <FolderMinus size={13} />
                    Remove from folder
                  </button>
                )}
              </div>
              <form
                className="library-folder-new"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newFolderDraft.trim();
                  if (name) applyMoveToFolder(name);
                }}
              >
                <input
                  type="text"
                  className="build-name-input"
                  placeholder="New folder name…"
                  aria-label="New folder name"
                  value={newFolderDraft}
                  onChange={(e) => setNewFolderDraft(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" disabled={!newFolderDraft.trim()}>
                  <FolderPlus size={13} />
                  Create folder
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      <div className="library-body">
        {!available && <p className="settings-note">This browser can't keep builds (its storage is turned off). New, Starter and Export still work.</p>}
        {available && builds.length === 0 && <p className="settings-note">No saved builds yet.</p>}
        {available && builds.length > 0 && groupDuplicates && duplicateGroups.length === 0 && (
          <p className="settings-note">No identical builds found.</p>
        )}
        {activeSections.map((section) => {
          const isCollapsed = showSectionHeaders && collapsed.has(section.key);
          const isLocalFolder = section.kind === 'local-folder';
          const isDriveFolder = section.kind === 'drive-folder';
          const isDupGroup = section.kind === 'duplicate-group';
          const sectionIds = section.builds.map((b) => b.id);
          const allSectionSelected = sectionIds.length > 0 && sectionIds.every((id) => selectedIds.has(id));
          const allExtrasSelected = isDupGroup && section.extraIds.length > 0 && section.extraIds.every((id) => selectedIds.has(id));
          return (
            <section key={section.key} className="library-section" data-section-kind={section.kind} data-section-name={section.displayName}>
              {showSectionHeaders && (
                <div className="library-section-header">
                  {isLocalFolder && renamingFolder?.name === section.name ? (
                    <input
                      className="build-name-input library-folder-rename-input"
                      value={renamingFolder.draft}
                      autoFocus
                      aria-label="Rename folder"
                      onChange={(e) => setRenamingFolder({ name: section.name, draft: e.target.value })}
                      onBlur={commitFolderRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitFolderRename();
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          e.stopPropagation();
                          setRenamingFolder(null);
                        }
                      }}
                      onFocus={(e) => e.target.select()}
                    />
                  ) : (
                    <button
                      type="button"
                      className="library-section-toggle"
                      onClick={() => toggleSectionCollapse(section.key)}
                      aria-expanded={!isCollapsed}
                    >
                      {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                      {isDriveFolder && <GoogleDriveMark size={18} className="library-section-icon drive" />}
                      {isLocalFolder && <Folder size={14} className="library-section-icon" />}
                      {isDupGroup && <Layers size={14} className="library-section-icon" />}
                      <span className="library-section-title">{section.displayName}</span>
                      <span className="library-section-count">
                        {isDupGroup ? `${section.builds.length} identical` : section.builds.length}
                      </span>
                    </button>
                  )}
                  <div className="library-section-actions">
                    {isDupGroup && (
                      <>
                        <button
                          type="button"
                          className="btn btn-outline btn-compact"
                          onClick={() => toggleSectionIds(section.extraIds)}
                          title="Select all copies except one kept build"
                        >
                          {allExtrasSelected ? 'Deselect extras' : `Select extras (${section.extraIds.length})`}
                        </button>
                        <button
                          type="button"
                          className="btn btn-outline btn-compact"
                          onClick={() => toggleSectionIds(sectionIds)}
                        >
                          {allSectionSelected ? 'Deselect all' : 'Select all'}
                        </button>
                      </>
                    )}
                    {!isDupGroup && selecting && (
                      <button
                        type="button"
                        className="btn btn-outline btn-compact"
                        onClick={() => toggleSectionIds(sectionIds)}
                      >
                        {allSectionSelected ? 'Deselect' : 'Select all'}
                      </button>
                    )}
                    {isLocalFolder && !selecting && renamingFolder?.name !== section.name && (
                      <>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => setRenamingFolder({ name: section.name, draft: section.name })}
                          title={`Rename folder ${section.name}`}
                          aria-label={`Rename folder ${section.name}`}
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => onRemoveFolder?.(section.name)}
                          title={`Remove folder ${section.name} (keeps builds)`}
                          aria-label={`Remove folder ${section.name}`}
                        >
                          <FolderMinus size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {!isCollapsed && <div className="library-grid">{section.builds.map(renderCard)}</div>}
            </section>
          );
        })}
      </div>
    </dialog>
  );
}
