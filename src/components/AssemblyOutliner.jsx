import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Eye, EyeOff, Folder, Layers, LocateFixed, Lock, Minus, Unlock } from 'lucide-react';

const LOCATE_PINNED_KEY = 'vexiq.outlinerLocatePinned';
const LONG_PRESS_MS = 500;

const readPinned = () => {
  try {
    return window.localStorage.getItem(LOCATE_PINNED_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * The Assembly Outliner (openspec outliner-part-groups): the selected parts first, under "Selected (N)",
 * then the rest; loose parts as rows, each group as a folder row in the place of its first part with its
 * parts indented under it while open. Clicks select (folder = whole group, a row inside a folder = that
 * part only), Ctrl/Cmd+click adds or removes, and in Select mode a plain click or the row's checkbox
 * (shown only then) does too; Shift+click selects a range in the
 * order shown. The locate button scrolls to the selection; a long press pins it so every new selection
 * is scrolled to.
 */
export default function AssemblyOutliner({
  instances,
  groups,
  selectedIds,
  primaryId,
  selectMode = false,
  onSelectIds,
  onTogglePart,
  onSetGroupFlag,
  onClearAll
}) {
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const listRef = useRef(null);

  // Display rows: { kind: 'part', inst, depth, groupName? } and { kind: 'folder', group, listed }.
  // Selected parts come first (a wholly selected group as its folder, other grouped parts on their own
  // row naming their group), then everything else in build order.
  const { selectedRows, otherRows } = useMemo(() => {
    const chosen = new Set(selectedIds);
    const top = [];
    const rest = [];
    const shown = new Set();
    const byId = new Map(instances.map((i) => [i.instanceId, i]));
    const addFolder = (list, group, listed) => {
      list.push({ kind: 'folder', group, listed });
      if (openFolders.has(group.id)) for (const id of listed) list.push({ kind: 'part', inst: byId.get(id), depth: 1 });
    };
    for (const inst of instances) {
      const group = inst.groupId ? groups.get(inst.groupId) : null;
      if (!group) {
        (chosen.has(inst.instanceId) ? top : rest).push({ kind: 'part', inst, depth: 0 });
        continue;
      }
      if (shown.has(group.id)) continue;
      shown.add(group.id);
      const picked = group.ids.filter((id) => chosen.has(id));
      if (picked.length === group.ids.length) {
        addFolder(top, group, group.ids);
        continue;
      }
      for (const id of picked) top.push({ kind: 'part', inst: byId.get(id), depth: 0, groupName: group.name });
      addFolder(rest, group, group.ids.filter((id) => !chosen.has(id)));
    }
    return { selectedRows: top, otherRows: rest };
  }, [instances, groups, openFolders, selectedIds]);
  const rows = useMemo(() => [...selectedRows, ...otherRows], [selectedRows, otherRows]);

  const rowIds = (row) => (row.kind === 'folder' ? row.group.ids : [row.inst.instanceId]);
  const rowKey = (row) => (row.kind === 'folder' ? `folder:${row.group.id}` : row.inst.instanceId);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const handleRowClick = (e, row, index) => {
    const ids = rowIds(row);
    if (e.shiftKey && primaryId) {
      // In build order, since selected rows move to the top: every part from the primary part to the
      // clicked row's first part. The clicked row's parts go last, so the clicked row becomes the primary.
      const order = instances.map((i) => i.instanceId);
      const anchor = order.indexOf(primaryId);
      const target = Math.min(...ids.map((id) => order.indexOf(id)));
      const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
      const range = order.slice(from, to + 1).filter((id) => !ids.includes(id)).concat(ids);
      const inRange = new Set(range);
      onSelectIds([...selectedIds.filter((id) => !inRange.has(id)), ...range]);
      return;
    }
    // Ctrl/Cmd+click, or any click in Select mode, adds or removes the row
    if (e.ctrlKey || e.metaKey || selectMode) {
      const all = ids.every((id) => selectedSet.has(id));
      onSelectIds(all ? selectedIds.filter((id) => !ids.includes(id)) : [...selectedIds.filter((id) => !ids.includes(id)), ...ids]);
      return;
    }
    onSelectIds(ids);
  };

  // A row's checkbox: add or remove its parts, keeping the rest of the selection
  const toggleRow = (row) => {
    const ids = rowIds(row);
    const all = ids.every((id) => selectedSet.has(id));
    onSelectIds(all ? selectedIds.filter((id) => !ids.includes(id)) : [...selectedIds.filter((id) => !ids.includes(id)), ...ids]);
  };
  // Shown only in Select mode, where clicks add to and take from the selection
  const checkbox = (row, state, label) =>
    selectMode && (
      <button
        type="button"
        role="checkbox"
        aria-checked={state}
        aria-label={label}
        title={state === true ? 'Unselect' : 'Add to the selection'}
        className={`row-check ${state === true ? 'on' : state === 'mixed' ? 'mixed' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          toggleRow(row);
        }}
      >
        {state === true ? <Check size={11} strokeWidth={3} /> : state === 'mixed' ? <Minus size={11} strokeWidth={3} /> : null}
      </button>
    );

  const toggleFolder = (groupId) =>
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  // --- Locate ---
  const [pinned, setPinned] = useState(readPinned);
  const [locateTick, setLocateTick] = useState(0);
  const locateIdRef = useRef(null);
  const pressRef = useRef({ timer: null, long: false });
  useEffect(() => {
    try {
      window.localStorage.setItem(LOCATE_PINNED_KEY, pinned ? '1' : '0');
    } catch {
      // storage unavailable: the pin just isn't remembered
    }
  }, [pinned]);

  const locate = (id) => {
    if (!id) return;
    const inst = instances.find((i) => i.instanceId === id);
    const group = inst?.groupId ? groups.get(inst.groupId) : null;
    if (group && !openFolders.has(group.id)) setOpenFolders((prev) => new Set(prev).add(group.id));
    locateIdRef.current = id;
    setLocateTick((t) => t + 1);
  };

  // After the folder has opened: centre the row in the list where the list allows
  useEffect(() => {
    const id = locateIdRef.current;
    const list = listRef.current;
    if (!id || !list) return;
    const el = [...list.querySelectorAll('[data-row-id]')].find((node) => node.dataset.rowId === id);
    if (!el) return;
    locateIdRef.current = null;
    const top = el.offsetTop - list.offsetTop - (list.clientHeight - el.offsetHeight) / 2;
    list.scrollTo({ top: Math.max(0, top) });
  }, [locateTick, rows]);

  // Pinned: follow every new primary selection, wherever it came from
  useEffect(() => {
    if (pinned && primaryId) locate(primaryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, primaryId]);

  const clearPress = () => {
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = null;
  };
  const locateHandlers = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      pressRef.current.long = false;
      clearPress();
      pressRef.current.timer = setTimeout(() => {
        pressRef.current.timer = null;
        pressRef.current.long = true;
        setPinned((p) => !p);
      }, LONG_PRESS_MS);
    },
    onPointerUp: clearPress,
    onPointerLeave: clearPress,
    onPointerCancel: clearPress,
    onContextMenu: (e) => e.preventDefault(),
    onClick: () => {
      // The click that ends a long press only pins or unpins
      if (pressRef.current.long) {
        pressRef.current.long = false;
        return;
      }
      locate(primaryId);
    }
  };

  // --- Rows ---
  const flagButtons = (members, onToggle, noun) => {
    const hidden = members.filter((m) => m.visible === false).length;
    const locked = members.filter((m) => m.locked).length;
    const allHidden = hidden === members.length;
    const allLocked = locked === members.length;
    return (
      <>
        <button
          type="button"
          className={`icon-btn ${hidden > 0 && !allHidden ? 'mixed' : ''}`}
          title={allHidden ? `Show ${noun}` : hidden > 0 ? 'Some parts are hidden: hide all' : `Hide ${noun}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle('visible', allHidden);
          }}
        >
          {hidden > 0 ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button
          type="button"
          className={`icon-btn ${locked > 0 && !allLocked ? 'mixed' : ''}`}
          title={allLocked ? `Unlock ${noun}` : locked > 0 ? 'Some parts are locked: lock all' : `Lock ${noun}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle('locked', !allLocked);
          }}
        >
          {locked > 0 ? <Lock size={13} /> : <Unlock size={13} />}
        </button>
      </>
    );
  };

  const byId = useMemo(() => new Map(instances.map((i) => [i.instanceId, i])), [instances]);

  return (
    <section className="outliner-section">
      <div className="panel-header" style={{ padding: '10px 14px' }}>
        <div className="panel-title-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} />
            Assembly Outliner ({instances.length})
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className={`icon-btn locate-btn ${pinned ? 'active' : ''}`}
              disabled={!primaryId}
              aria-pressed={pinned}
              aria-label="Locate the selection"
              title={pinned ? 'Following the selection (hold to stop)' : 'Show the selected part in the list (hold to keep following)'}
              {...locateHandlers}
            >
              <LocateFixed size={14} />
            </button>
            {instances.length > 0 && (
              <button type="button" className="btn btn-danger" style={{ padding: '2px 7px', fontSize: 11 }} onClick={onClearAll}>
                Clear All
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="instance-list scroller" ref={listRef}>
        {selectedRows.length > 0 && (
          <div className="outliner-heading selected-heading">
            <span>Selected ({selectedIds.length})</span>
            <button type="button" className="link-btn" onClick={() => onSelectIds([])} title="Unselect everything (Esc)">
              Clear
            </button>
          </div>
        )}
        {rows.map((row, index) => {
          const heading =
            index === selectedRows.length && selectedRows.length > 0 && otherRows.length > 0 ? (
              <div key="other-heading" className="outliner-heading">
                <span>Other parts</span>
              </div>
            ) : null;
          if (row.kind === 'folder') {
            const { group } = row;
            const members = group.ids.map((id) => byId.get(id)).filter(Boolean);
            const open = openFolders.has(group.id);
            const picked = group.ids.filter((id) => selectedSet.has(id)).length;
            const isSelected = picked === group.ids.length;
            const isPrimary = !open && group.ids.includes(primaryId);
            return (
              <React.Fragment key={rowKey(row)}>
              {heading}
              <div
                data-row-id={`folder:${group.id}`}
                className={`instance-row folder-row ${isSelected ? 'selected' : ''} ${isSelected && !isPrimary ? 'secondary' : ''}`}
                onClick={(e) => handleRowClick(e, row, index)}
              >
                {checkbox(row, isSelected ? true : picked > 0 ? 'mixed' : false, `Select ${group.name}`)}
                <button
                  type="button"
                  className="icon-btn folder-toggle"
                  aria-label={open ? `Close ${group.name}` : `Open ${group.name}`}
                  aria-expanded={open}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(group.id);
                  }}
                >
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <Folder size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                <span className="instance-row-name" title={group.name}>
                  {group.name}
                  <span className="folder-count">{picked > 0 && !isSelected ? `${row.listed.length} of ${members.length}` : members.length}</span>
                </span>
                {flagButtons(members, (field, value) => onSetGroupFlag(group, field, value), 'Group')}
              </div>
              </React.Fragment>
            );
          }
          const { inst, depth } = row;
          const isSelected = selectedSet.has(inst.instanceId);
          const isPrimary = inst.instanceId === primaryId;
          return (
            <React.Fragment key={rowKey(row)}>
            {heading}
            <div
              data-row-id={inst.instanceId}
              className={`instance-row ${depth ? 'in-folder' : ''} ${isSelected ? 'selected' : ''} ${isSelected && !isPrimary ? 'secondary' : ''}`}
              onClick={(e) => handleRowClick(e, row, index)}
            >
              {checkbox(row, isSelected, `Select ${inst.label}`)}
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  background: inst.isIntersecting ? '#9ca3af' : inst.color,
                  opacity: inst.isIntersecting ? 0.5 : 1,
                  flexShrink: 0
                }}
              />
              <span className="instance-row-name" title={row.groupName ? `${inst.label} (in ${row.groupName})` : inst.label}>
                {inst.label}
                {row.groupName && <span className="folder-count">in {row.groupName}</span>}
                {inst.isIntersecting && <span style={{ color: '#fca5a5', marginLeft: 6, fontSize: 11 }}>(Intersecting)</span>}
              </span>
              {flagButtons([inst], (field, value) => onTogglePart(inst.instanceId, { [field]: value }), 'Part')}
            </div>
            </React.Fragment>
          );
        })}

        {instances.length === 0 && (
          <div className="empty-state">Click any part in the left library to place it into the 3D workspace.</div>
        )}
      </div>
    </section>
  );
}
