import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown, FolderMinus, FolderPlus, MousePointerClick, Network, SquareDashed } from 'lucide-react';
import PopoverMenu, { MenuDivider, MenuItem } from './PopoverMenu.jsx';

/**
 * The toolbar's Select menu (openspec outliner-part-groups): Select mode, Select Connected, Select All,
 * Select None, Invert, Group and Ungroup. The button reads "Select mode" while that mode is on.
 */
export default function SelectMenu({
  selectMode,
  onToggleSelectMode,
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
        className={`btn ${at || selectMode ? 'active' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        title={selectMode ? 'Select mode is on: clicks add or remove parts (Esc to leave)' : 'Select several parts, connected parts, groups'}
      >
        <MousePointerClick size={14} />
        {selectMode ? 'Select mode' : 'Select'}
        <ChevronDown size={12} />
      </button>
      {at && (
        <PopoverMenu at={at} onClose={close} label="Select">
          <MenuItem checked={selectMode} onSelect={choose(onToggleSelectMode)} title="While on, a click in the 3D view adds or removes a part">
            Select mode
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
