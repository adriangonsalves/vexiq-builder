import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Check, ChevronDown, ChevronRight, Cog, Copy, Cpu, Eye, EyeOff, Folder, FolderMinus, Layers, LocateFixed, Lock, Minus, Palette, Pencil, Search, Trash2, Unlock, X } from 'lucide-react';
import { NO_FILTERS, colorsInBuild, filterRows as filterOutlineRows, filtersOn, partPasses, shownIds } from '../utils/outlineFilter.js';

const LOCATE_PINNED_KEY = 'vexiq.outlinerLocatePinned';
const SELECTED_OPEN_KEY = 'vexiq.outlinerSelectedOpen';
const LONG_PRESS_MS = 500;

const readPinned = () => {
  try {
    return window.localStorage.getItem(LOCATE_PINNED_KEY) === '1';
  } catch {
    return false;
  }
};
const readSelectedOpen = () => {
  try {
    return window.localStorage.getItem(SELECTED_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
};

/**
 * The Assembly Outliner (openspec outliner-part-groups): every part stays in its place in the list,
 * group folders (their parts indented under them while open) before the loose parts. Above the list a
 * "Selected (N)" box, which can be closed, lists the selection again with actions for all of it (hide,
 * lock, colour, clone, delete). Clicks select (folder = whole group, a row inside a folder = that
 * part only), Ctrl/Cmd+click adds or removes, and in Select mode a plain click or the row's checkbox
 * (shown only then) does too. Shift+click adds a range of whole rows in the order shown, so every
 * group in it comes whole; Shift+Alt+click adds a range of single parts, inside a group or across groups. The locate button scrolls to the selection; a long press pins it so every new selection
 * is scrolled to.
 */
export default function AssemblyOutliner({
  instances,
  catalogMap,
  groups,
  motorGroups = new Map(),
  canGroupMotors = false,
  onGroupMotors,
  onMotorGroupEdit,
  selectedIds,
  primaryId,
  selectMode = false,
  onSelectIds,
  onTogglePart,
  onSetGroupFlag,
  onClearAll,
  colors = [],
  onSetSelectionFlag,
  onSetSelectionColor,
  onCloneSelection,
  onDeleteSelection
}) {
  const [openFolders, setOpenFolders] = useState(() => new Set());
  const byId = useMemo(() => new Map(instances.map((i) => [i.instanceId, i])), [instances]);
  const [query, setQuery] = useState(''); // narrows the rows shown; the selection and the build are untouched
  const listRef = useRef(null);

  // List rows: { kind: 'part', inst, depth } and { kind: 'folder', group, listed }, every part in its
  // place whether selected or not: group folders first, then the loose parts, otherwise in build order.
  const allRows = useMemo(() => {
    const folders = [];
    const loose = [];
    const shown = new Set();
    for (const inst of instances) {
      const group = inst.groupId ? groups.get(inst.groupId) : null;
      if (!group) {
        loose.push({ kind: 'part', inst, depth: 0 });
        continue;
      }
      if (shown.has(group.id)) continue;
      shown.add(group.id);
      folders.push({ kind: 'folder', group, listed: group.ids });
      if (openFolders.has(group.id)) for (const id of group.ids) if (byId.has(id)) folders.push({ kind: 'part', inst: byId.get(id), depth: 1 });
    }
    return [...folders, ...loose];
  }, [instances, groups, openFolders, byId]);

  // The "Selected" box: a wholly selected group as its folder, a selected part of a partly selected
  // group on its own row naming the group, then the loose parts; folders first, otherwise build order
  const pickedRows = useMemo(() => {
    const chosen = new Set(selectedIds);
    const folders = [];
    const parts = [];
    const shown = new Set();
    for (const inst of instances) {
      if (!chosen.has(inst.instanceId)) continue;
      const group = inst.groupId ? groups.get(inst.groupId) : null;
      if (!group) {
        parts.push({ kind: 'part', inst, depth: 0 });
        continue;
      }
      if (group.ids.every((id) => chosen.has(id))) {
        if (!shown.has(group.id)) folders.push({ kind: 'folder', group, listed: group.ids });
        shown.add(group.id);
        continue;
      }
      parts.push({ kind: 'part', inst, depth: 0, groupName: group.name });
    }
    return [...folders, ...parts];
  }, [instances, groups, selectedIds]);

  // Search and filter chips (openspec outline-filters-and-one-part-pick, src/utils/outlineFilter.js): a
  // part row stays when it passes every chip on and its label, catalog name or part number contains the
  // text; with only a search, a folder whose name matches keeps all its parts. Only the list changes.
  const q = query.trim().toLowerCase();
  const [filters, setFilters] = useState(NO_FILTERS);
  const chipsOn = filtersOn(filters);
  const narrowing = Boolean(q) || chipsOn;
  const metaOf = (inst) => catalogMap?.get(inst?.partId);
  const partMatches = (inst) => Boolean(inst) && partPasses(inst, metaOf(inst), query, filters);
  const rows = useMemo(
    () => filterOutlineRows(allRows, { query, filters, metaOf, byId }),
    [allRows, query, filters, catalogMap, byId] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const shownCount = narrowing ? instances.filter(partMatches).length : instances.length;
  const toggleChip = (key) => setFilters((f) => ({ ...f, [key]: !f[key] }));
  const buildColors = useMemo(() => colorsInBuild(instances), [instances]);
  const [chipColorOpen, setChipColorOpen] = useState(false);
  const chipColorRef = useRef(null);
  useEffect(() => {
    if (!chipColorOpen) return undefined;
    const onDown = (e) => {
      if (!chipColorRef.current?.contains(e.target)) setChipColorOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [chipColorOpen]);



  const rowIds = (row) => (row.kind === 'folder' ? row.group.ids : [row.inst.instanceId]);
  const rowKey = (row) => (row.kind === 'folder' ? `folder:${row.group.id}` : row.inst.instanceId);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const handleRowClick = (e, row, index) => {
    const ids = rowIds(row);
    if (e.shiftKey && primaryId) {
      // Ranges run in the order the list shows (search included), from the primary part's row to the
      // clicked row, and add to the selection. The clicked row's parts go last, so it becomes the primary.
      const add = (range, last) => {
        const ordered = range.filter((id) => !last.includes(id)).concat(last);
        const inRange = new Set(ordered);
        onSelectIds([...selectedIds.filter((id) => !inRange.has(id)), ...ordered]);
      };
      if (e.altKey) {
        // Shift+Alt: single parts, inside a group or across groups (a closed folder's parts where it is)
        const order = [];
        let folderNamed = false;
        for (const r of rows) {
          if (r.kind === 'folder') {
            folderNamed = !!q && r.group.name.toLowerCase().includes(q);
            if (!openFolders.has(r.group.id)) order.push(...r.listed.filter((id) => folderNamed || partMatches(byId.get(id))));
          } else order.push(r.inst.instanceId);
        }
        const anchor = order.indexOf(primaryId);
        const spots = ids.map((id) => order.indexOf(id)).filter((i) => i >= 0);
        if (anchor < 0 || spots.length === 0) return add(ids, ids);
        const target = anchor <= Math.min(...spots) ? Math.min(...spots) : Math.max(...spots);
        const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
        const clicked = row.kind === 'folder' ? [order[target]] : ids;
        return add(order.slice(from, to + 1), clicked);
      }
      // Shift: whole rows of the top level, so every group in the range comes whole (a part's row inside
      // an open folder counts as its folder)
      const top = rows.filter((r) => r.kind === 'folder' || !r.depth);
      const topIndexOf = (id) => {
        const group = byId.get(id)?.groupId ? groups.get(byId.get(id).groupId) : null;
        return top.findIndex((r) => (r.kind === 'folder' ? r.group.id === group?.id : r.inst.instanceId === id));
      };
      const anchor = topIndexOf(primaryId);
      const target = topIndexOf(ids[0]);
      if (target < 0) return add(ids, ids);
      if (anchor < 0) return add(rowIds(top[target]), rowIds(top[target]));
      const [from, to] = anchor <= target ? [anchor, target] : [target, anchor];
      return add(top.slice(from, to + 1).flatMap(rowIds), rowIds(top[target]));
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

  // --- The "Selected" box ---
  const [selectedOpen, setSelectedOpen] = useState(readSelectedOpen);
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef(null);
  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTED_OPEN_KEY, selectedOpen ? '1' : '0');
    } catch {
      // storage unavailable: the choice just isn't remembered
    }
  }, [selectedOpen]);
  // The colour menu closes on a click outside it or Esc, and when the selection empties
  useEffect(() => {
    if (!colorOpen) return undefined;
    const onDown = (e) => {
      if (!colorRef.current?.contains(e.target)) setColorOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setColorOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [colorOpen]);
  useEffect(() => {
    if (selectedIds.length === 0) setColorOpen(false);
  }, [selectedIds.length]);

  const pickedParts = useMemo(() => selectedIds.map((id) => byId.get(id)).filter(Boolean), [selectedIds, byId]);
  const sharedColor = pickedParts.length > 0 && pickedParts.every((p) => p.color === pickedParts[0].color) ? pickedParts[0].color : null;

  // A row in the box: a plain click makes it the primary part (keeping the selection) and shows it in the
  // list; Ctrl/Cmd+click or its X takes it out of the selection
  const handlePickedClick = (e, row) => {
    const ids = rowIds(row);
    if (e.ctrlKey || e.metaKey) {
      onSelectIds(selectedIds.filter((id) => !ids.includes(id)));
      return;
    }
    onSelectIds([...selectedIds.filter((id) => !ids.includes(id)), ...ids]);
    locate(ids.at(-1));
  };

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
    const inst = byId.get(id);
    if (!inst) return;
    const group = inst.groupId ? groups.get(inst.groupId) : null;
    // A wholly selected group is shown by its folder; a part picked out of a group by its row in the opened folder
    const wholeGroup = group && group.ids.every((gid) => selectedSet.has(gid));
    if (narrowing && !partMatches(inst) && !(!chipsOn && group && group.name.toLowerCase().includes(q))) {
      setQuery('');
      setFilters(NO_FILTERS);
    }
    if (group && !wholeGroup && !openFolders.has(group.id)) setOpenFolders((prev) => new Set(prev).add(group.id));
    locateIdRef.current = wholeGroup && !openFolders.has(group.id) ? `folder:${group.id}` : id;
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
  // "Catalog name · part number" of the part's catalog entry
  const baseName = (inst) => {
    const meta = catalogMap?.get(inst.partId);
    return meta ? (
      <>
        {meta.name} <span className="part-number">· {meta.partNumber}</span>
      </>
    ) : (
      `Unknown part (${inst.partId})`
    );
  };

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

  return (
    <section className="outliner-section" data-help="outline">
      <div className="panel-header" style={{ padding: '10px 14px' }}>
        <div className="panel-title-row">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} />
            Assembly Outliner ({narrowing ? `${shownCount} / ${instances.length}` : instances.length})
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className={`icon-btn locate-btn ${pinned ? 'active' : ''}`}
              data-help="outline-locate"
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
        {instances.length > 0 && (
          <div className="search-box outliner-search">
            <Search size={15} />
            <input
              type="search"
              className="search-input"
              placeholder="Search label, part name, 228-..."
              aria-label="Search the assembly"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                }
              }}
            />
            {query && (
              <button type="button" className="clear-search-btn" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {instances.length > 0 && (
          <div className="outline-filters-wrap" ref={chipColorRef}>
          <div className="outline-filters" role="group" aria-label="Filter the list" data-help="outline-filters">
            <button type="button" className={`outline-chip ${filters.electronics ? 'on' : ''}`} aria-pressed={filters.electronics} title="Show only motors, brains, batteries, sensors and other electronics" onClick={() => toggleChip('electronics')}>
              <Cpu size={12} />
              Electronics
            </button>
            <button type="button" className={`outline-chip ${filters.locked ? 'on' : ''}`} aria-pressed={filters.locked} title="Show only locked parts" onClick={() => toggleChip('locked')}>
              <Lock size={12} />
              Locked
            </button>
            <button type="button" className={`outline-chip ${filters.hidden ? 'on' : ''}`} aria-pressed={filters.hidden} title="Show only hidden parts" onClick={() => toggleChip('hidden')}>
              <EyeOff size={12} />
              Hidden
            </button>
              <button
                type="button"
                className={`outline-chip ${filters.color ? 'on' : ''}`}
                aria-pressed={Boolean(filters.color)}
                aria-expanded={chipColorOpen}
                title="Show only parts of one colour"
                onClick={() => setChipColorOpen((o) => !o)}
              >
                {filters.color ? <span className="picked-color-dot" style={{ background: filters.color }} /> : <Palette size={12} />}
                Colour
              </button>
          </div>
              {chipColorOpen && (
            <div className="picked-color-menu outline-color-menu" role="menu" aria-label="Show only parts of this colour">
              <div className="color-swatches">
                {buildColors.map(({ color, count }) => (
                  <button
                    key={color}
                    type="button"
                    className={`color-swatch-btn ${filters.color === color ? 'active' : ''}`}
                    style={{ backgroundColor: color }}
                    title={`${count} ${count === 1 ? 'part' : 'parts'}`}
                    aria-label={`Colour ${color}, ${count} ${count === 1 ? 'part' : 'parts'}`}
                    onClick={() => {
                      setFilters((f) => ({ ...f, color }));
                      setChipColorOpen(false);
                    }}
                  />
                ))}
              </div>
              {filters.color && (
                <button
                  type="button"
                  className="link-btn"
                  style={{ marginTop: 6 }}
                  onClick={() => {
                    setFilters((f) => ({ ...f, color: null }));
                    setChipColorOpen(false);
                  }}
                >
                  Any colour
                </button>
              )}
            </div>
          )}
          </div>
        )}
        {narrowing && (
          <div className="outline-filter-actions">
            <button
              type="button"
              className="btn btn-outline"
              data-help="outline-select-shown"
              disabled={shownCount === 0}
              title="Select every part the list shows"
              onClick={() => onSelectIds(shownIds(rows, openFolders))}
            >
              Select shown ({shownCount})
            </button>
            {chipsOn && (
              <button type="button" className="link-btn" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {pickedRows.length > 0 && (
        <div className={`outliner-picked ${selectedOpen ? 'open' : ''}`}>
          <div className="outliner-heading selected-heading">
            <button
              type="button"
              className="picked-toggle"
              aria-expanded={selectedOpen}
              onClick={() => setSelectedOpen((o) => !o)}
              title={selectedOpen ? 'Close the selected list' : 'Open the selected list'}
            >
              {selectedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>Selected ({selectedIds.length})</span>
            </button>
            <div className="picked-actions">
              {flagButtons(pickedParts, (field, value) => onSetSelectionFlag(field, value), selectedIds.length > 1 ? 'selected parts' : 'Part')}
              <div className="picked-color" ref={colorRef}>
                <button
                  type="button"
                  className={`icon-btn ${colorOpen ? 'active' : ''}`}
                  title="Colour of the selected parts"
                  aria-label="Colour of the selected parts"
                  aria-expanded={colorOpen}
                  onClick={() => setColorOpen((o) => !o)}
                >
                  {sharedColor ? <span className="picked-color-dot" style={{ background: sharedColor }} /> : <Palette size={13} />}
                </button>
                {colorOpen && (
                  <div className="picked-color-menu" role="menu">
                    <div className="color-swatches">
                      {colors.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          className={`color-swatch-btn ${sharedColor === hex ? 'active' : ''}`}
                          style={{ backgroundColor: hex }}
                          onClick={() => onSetSelectionColor(hex)}
                          aria-label={`Color ${hex}`}
                        />
                      ))}
                      <input
                        type="color"
                        className="picked-color-input"
                        value={sharedColor || '#64748b'}
                        onChange={(e) => onSetSelectionColor(e.target.value, { live: true })}
                        title="Custom Color"
                        aria-label="Custom color"
                      />
                    </div>
                  </div>
                )}
              </div>
              {onGroupMotors && canGroupMotors && (
                <button type="button" className="icon-btn" data-help="group-motors" title="Group the selected Smart Motors, to drive them with one control in Play mode" aria-label="Group motors" onClick={onGroupMotors}>
                  <Cog size={13} />
                </button>
              )}
              <button type="button" className="icon-btn" title="Clone the selected parts (D)" aria-label="Clone the selected parts" onClick={onCloneSelection}>
                <Copy size={13} />
              </button>
              <button type="button" className="icon-btn danger" title="Delete the selected parts (Del)" aria-label="Delete the selected parts" onClick={onDeleteSelection}>
                <Trash2 size={13} />
              </button>
              <button type="button" className="link-btn" onClick={() => onSelectIds([])} title="Unselect everything (Esc)">
                Clear
              </button>
            </div>
          </div>
          {selectedOpen && (
            <div className="picked-list scroller">
              {pickedRows.map((row) => {
                const ids = rowIds(row);
                const name = row.kind === 'folder' ? row.group.name : row.inst.label;
                const isPrimary = ids.includes(primaryId);
                return (
                  <div
                    key={rowKey(row)}
                    className={`instance-row picked-row ${row.kind === 'folder' ? 'folder-row' : ''} selected ${isPrimary ? '' : 'secondary'}`}
                    onClick={(e) => handlePickedClick(e, row)}
                    title={`${name}: click to show it in the list, Ctrl/Cmd+click to unselect`}
                  >
                    {row.kind === 'folder' ? (
                      <Folder size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                    ) : (
                      <span className="color-dot" style={{ background: row.inst.color }} />
                    )}
                    <span className="instance-row-name">
                      {name}
                      {row.kind === 'folder' && <span className="folder-count">{row.group.ids.length}</span>}
                      {row.groupName && <span className="folder-count">in {row.groupName}</span>}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Unselect ${name}`}
                      title="Unselect"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectIds(selectedIds.filter((id) => !ids.includes(id)));
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="instance-list scroller" ref={listRef}>
        {motorGroups.size > 0 && (
          <MotorGroupsSection groups={motorGroups} byId={byId} selectedSet={selectedSet} onSelectIds={onSelectIds} onEdit={onMotorGroupEdit} />
        )}
        {rows.map((row, index) => {
          if (row.kind === 'folder') {
            const { group } = row;
            const members = group.ids.map((id) => byId.get(id)).filter(Boolean);
            const open = openFolders.has(group.id);
            const picked = group.ids.filter((id) => selectedSet.has(id)).length;
            const isSelected = picked === group.ids.length;
            const isPrimary = !open && group.ids.includes(primaryId);
            return (
              <div
                key={rowKey(row)}
                data-row-id={`folder:${group.id}`}
                className={`instance-row folder-row ${isSelected ? 'selected' : picked > 0 ? 'partly-selected' : ''} ${isSelected && !isPrimary ? 'secondary' : ''}`}
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
                  <span className="folder-count">
                    {picked > 0 && !isSelected ? `${picked} of ${members.length} selected` : row.listed.length < members.length ? `${row.listed.length} of ${members.length} shown` : members.length}
                  </span>
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
              {checkbox(row, isSelected, `Select ${inst.label}`)}
              <span
                className="color-dot"
                style={{
                  background: inst.isIntersecting ? '#9ca3af' : inst.color,
                  opacity: inst.isIntersecting ? 0.5 : 1
                }}
              />
              <span className="instance-row-name" title={inst.label}>
                {inst.label}
                {inst.isIntersecting && <span style={{ color: '#fca5a5', marginLeft: 6, fontSize: 11 }}>(Intersecting)</span>}
                {isPrimary && <span className="instance-row-base">{baseName(inst)}</span>}
              </span>
              {flagButtons([inst], (field, value) => onTogglePart(inst.instanceId, { [field]: value }), 'Part')}
            </div>
          );
        })}

        {instances.length > 0 && rows.length === 0 && <div className="empty-state">{q ? `No parts match "${query.trim()}"${chipsOn ? ' with these filters' : ''}.` : 'No parts match these filters.'}</div>}
        {instances.length === 0 && (
          <div className="empty-state">Click any part in the left library to place it into the 3D workspace.</div>
        )}
      </div>
    </section>
  );
}

/**
 * The "Motor groups" section at the top of the list (openspec motor-groups): one folder per motor group
 * (arrow, name, motor count, rename, break up); opened, its motors, each with Same/Opposite and a button
 * to take it out. A folder click selects just its motors (not the part groups they are in). Open state
 * lives only while the page is open.
 */
function MotorGroupsSection({ groups, byId, selectedSet, onSelectIds, onEdit }) {
  const [open, setOpen] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // { id, name } of the folder being renamed
  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  const finishRename = (save) => {
    if (save && editing) onEdit?.({ kind: 'rename', groupId: editing.id, name: editing.name });
    setEditing(null);
  };
  return (
    <div className="motor-groups" data-help="motor-groups">
      <div className="outliner-heading">Motor groups</div>
      {[...groups.values()].map((group) => {
        const ids = group.motors.map((m) => m.id);
        const isOpen = open.has(group.id);
        const picked = ids.filter((id) => selectedSet.has(id)).length;
        const isSelected = picked === ids.length;
        return (
          <React.Fragment key={group.id}>
            <div
              className={`instance-row folder-row ${isSelected ? 'selected' : picked > 0 ? 'partly-selected' : ''}`}
              data-row-id={`motor-group:${group.id}`}
              onClick={() => editing?.id !== group.id && onSelectIds(ids)}
              title={`${group.name}: select its motors`}
            >
              <button type="button" className="icon-btn folder-toggle" aria-label={isOpen ? `Close ${group.name}` : `Open ${group.name}`} aria-expanded={isOpen} onClick={stop(() => toggle(group.id))}>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <Cog size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
              {editing?.id === group.id ? (
                <input
                  className="motor-group-name-input"
                  aria-label="Motor group name"
                  autoFocus
                  value={editing.name}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  onBlur={() => finishRename(true)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') finishRename(true);
                    if (e.key === 'Escape') finishRename(false);
                  }}
                />
              ) : (
                <span className="instance-row-name" title={group.name}>
                  {group.name}
                  <span className="folder-count">{ids.length} motors</span>
                </span>
              )}
              <button type="button" className="icon-btn" title="Rename this motor group" aria-label={`Rename ${group.name}`} onClick={stop(() => setEditing({ id: group.id, name: group.name }))}>
                <Pencil size={13} />
              </button>
              <button type="button" className="icon-btn" title="Break up this motor group (the motors stay)" aria-label={`Break up ${group.name}`} onClick={stop(() => onEdit?.({ kind: 'break', groupId: group.id }))}>
                <FolderMinus size={13} />
              </button>
            </div>
            {isOpen &&
              group.motors.map((m) => {
                const inst = byId.get(m.id);
                if (!inst) return null;
                return (
                  <div
                    key={m.id}
                    className={`instance-row in-folder ${selectedSet.has(m.id) ? 'selected' : ''}`}
                    data-row-id={`motor-group:${group.id}:${m.id}`}
                    onClick={() => onSelectIds([m.id])}
                  >
                    <span className="color-dot" style={{ background: inst.color }} />
                    <span className="instance-row-name" title={inst.label}>
                      {inst.label}
                    </span>
                    <button
                      type="button"
                      className={`motor-dir-btn ${m.reversed ? 'opposite' : ''}`}
                      aria-label={`${inst.label}: turns ${m.reversed ? 'the opposite way' : 'the same way'}. Tap to flip`}
                      title={m.reversed ? 'Turns the opposite way to the group: tap to make it turn the same way' : 'Turns the same way as the group: tap to make it turn the opposite way'}
                      onClick={stop(() => onEdit?.({ kind: 'reverse', id: m.id, reversed: !m.reversed }))}
                    >
                      {m.reversed ? <ArrowLeftRight size={12} /> : <ArrowRight size={12} />}
                      {m.reversed ? 'Opposite' : 'Same'}
                    </button>
                    <button type="button" className="icon-btn" title="Take this motor out of the group" aria-label={`Take ${inst.label} out of ${group.name}`} onClick={stop(() => onEdit?.({ kind: 'remove', id: m.id }))}>
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
          </React.Fragment>
        );
      })}
    </div>
  );
}
