import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, Layers, LocateFixed, Lock, Unlock } from 'lucide-react';

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
 * The Assembly Outliner (openspec outliner-part-groups): loose parts as rows, each group as a folder row
 * in the place of its first part with its parts indented under it while open. Clicks select (folder =
 * whole group, a row inside a folder = that part only), Ctrl/Cmd+click adds or removes, Shift+click
 * selects a range in the order shown. The locate button scrolls to the selection; a long press pins it
 * so every new selection is scrolled to.
 */
export default function AssemblyOutliner({
  instances,
  groups,
  selectedIds,
  primaryId,
  onSelectIds,
  onTogglePart,
  onSetGroupFlag,
  onClearAll
}) {
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const listRef = useRef(null);

  // Display rows: { kind: 'part', inst, depth } and { kind: 'folder', group }
  const rows = useMemo(() => {
    const out = [];
    const shown = new Set();
    const byId = new Map(instances.map((i) => [i.instanceId, i]));
    for (const inst of instances) {
      const group = inst.groupId ? groups.get(inst.groupId) : null;
      if (!group) {
        out.push({ kind: 'part', inst, depth: 0 });
        continue;
      }
      if (shown.has(group.id)) continue;
      shown.add(group.id);
      out.push({ kind: 'folder', group });
      if (openFolders.has(group.id)) {
        for (const id of group.ids) out.push({ kind: 'part', inst: byId.get(id), depth: 1 });
      }
    }
    return out;
  }, [instances, groups, openFolders]);

  const rowIds = (row) => (row.kind === 'folder' ? row.group.ids : [row.inst.instanceId]);
  const rowKey = (row) => (row.kind === 'folder' ? `folder:${row.group.id}` : row.inst.instanceId);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  // The row showing the primary part: its own row, or its folder when the folder is closed
  const primaryRowIndex = rows.findIndex((row) =>
    row.kind === 'part' ? row.inst.instanceId === primaryId : row.group.ids.includes(primaryId) && !openFolders.has(row.group.id)
  );

  const handleRowClick = (e, row, index) => {
    const ids = rowIds(row);
    if (e.shiftKey && primaryRowIndex >= 0) {
      const [from, to] = primaryRowIndex <= index ? [primaryRowIndex, index] : [index, primaryRowIndex];
      // The clicked row's parts go last, so the clicked row becomes the primary
      const range = rows.slice(from, to + 1).filter((r) => r !== row).flatMap(rowIds).concat(ids);
      const inRange = new Set(range);
      onSelectIds([...selectedIds.filter((id) => !inRange.has(id)), ...range]);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      const all = ids.every((id) => selectedSet.has(id));
      onSelectIds(all ? selectedIds.filter((id) => !ids.includes(id)) : [...selectedIds.filter((id) => !ids.includes(id)), ...ids]);
      return;
    }
    onSelectIds(ids);
  };

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
        {rows.map((row, index) => {
          if (row.kind === 'folder') {
            const { group } = row;
            const members = group.ids.map((id) => byId.get(id)).filter(Boolean);
            const open = openFolders.has(group.id);
            const isSelected = group.ids.every((id) => selectedSet.has(id));
            const isPrimary = !open && group.ids.includes(primaryId);
            return (
              <div
                key={rowKey(row)}
                data-row-id={`folder:${group.id}`}
                className={`instance-row folder-row ${isSelected ? 'selected' : ''} ${isSelected && !isPrimary ? 'secondary' : ''}`}
                onClick={(e) => handleRowClick(e, row, index)}
              >
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
                  <span className="folder-count">{members.length}</span>
                </span>
                {flagButtons(members, (field, value) => onSetGroupFlag(group, field, value), 'Group')}
              </div>
            );
          }
          const { inst, depth } = row;
          const isSelected = selectedSet.has(inst.instanceId);
          const isPrimary = inst.instanceId === primaryId;
          return (
            <div
              key={rowKey(row)}
              data-row-id={inst.instanceId}
              className={`instance-row ${depth ? 'in-folder' : ''} ${isSelected ? 'selected' : ''} ${isSelected && !isPrimary ? 'secondary' : ''}`}
              onClick={(e) => handleRowClick(e, row, index)}
            >
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
              <span className="instance-row-name" title={inst.label}>
                {inst.label}
                {inst.isIntersecting && <span style={{ color: '#fca5a5', marginLeft: 6, fontSize: 11 }}>(Intersecting)</span>}
              </span>
              {flagButtons([inst], (field, value) => onTogglePart(inst.instanceId, { [field]: value }), 'Part')}
            </div>
          );
        })}

        {instances.length === 0 && (
          <div className="empty-state">Click any part in the left library to place it into the 3D workspace.</div>
        )}
      </div>
    </section>
  );
}
