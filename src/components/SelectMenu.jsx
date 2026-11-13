import React, { useCallback, useRef, useState } from 'react';
import { BoxSelect, ChevronDown, FolderMinus, FolderPlus, MousePointerClick, Network, SquareDashed } from 'lucide-react';
import PopoverMenu, { MenuDivider, MenuItem } from './PopoverMenu.jsx';

/**
 * The toolbar's Select menu (openspec outliner-part-groups): Select mode, Box select, Select Connected, Select All,
 * Select None, Invert, Group and Ungroup. The button reads "Box select" or "Select mode" while one is on.
 */
export default function SelectMenu({
  selectMode,
  onToggleSelectMode,
  boxSelect,
  onToggleBoxSelect,
  hasSelection,
  canGroup,
  canUngroup,
  onConnected,
  onAll,
  onNone,
  onInvert,
  onGroup,
  onUngroup
}) {
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
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn ${at || selectMode || boxSelect ? 'active' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        data-help="select"
        aria-expanded={Boolean(at)}
        aria-label="Select"
        title={
          boxSelect
            ? 'Box select is on: drag a box around parts (Esc to leave)'
            : selectMode
              ? 'Select mode is on: clicks add or remove parts (Esc to leave)'
              : 'Select several parts, connected parts, groups'
        }
      >
        {boxSelect ? <BoxSelect size={14} /> : <MousePointerClick size={14} />}
        <span className="btn-text">{boxSelect ? 'Box select' : selectMode ? 'Select mode' : 'Select'}</span>
        <ChevronDown size={12} className="btn-caret" />
      </button>
      {at && (
        <PopoverMenu at={at} onClose={close} label="Select">
          <MenuItem checked={selectMode} onSelect={choose(onToggleSelectMode)} title="While on, a click in the 3D view adds or removes a part">
            Select mode
          </MenuItem>
          <MenuItem
            checked={boxSelect}
            onSelect={choose(onToggleBoxSelect)}
            shortcut="B"
            title="Drag a box: left to right takes parts wholly inside, right to left every part it touches"
          >
            Box select
          </MenuItem>
          <MenuDivider />
          <MenuItem icon={Network} disabled={!hasSelection} onSelect={choose(onConnected)} shortcut="C" title="Every part joined to the selection by pins, pegs and shafts">
            Select Connected
          </MenuItem>
          <MenuItem onSelect={choose(onAll)} shortcut="Ctrl/Cmd+A">
            Select All
          </MenuItem>
          <MenuItem icon={SquareDashed} disabled={!hasSelection} onSelect={choose(onNone)} shortcut="Esc">
            Select None
          </MenuItem>
          <MenuItem onSelect={choose(onInvert)}>Invert Selection</MenuItem>
          <MenuDivider />
          <MenuItem icon={FolderPlus} disabled={!canGroup} onSelect={choose(onGroup)} shortcut="G" title="Make the selected parts one named group">
            Group
          </MenuItem>
          <MenuItem icon={FolderMinus} disabled={!canUngroup} onSelect={choose(onUngroup)} shortcut="Shift+G" title="Break up the selected groups">
            Ungroup
          </MenuItem>
        </PopoverMenu>
      )}
    </>
  );
}
