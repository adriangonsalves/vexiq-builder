import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown, Link2, Magnet, Wrench } from 'lucide-react';
import PopoverMenu, { MenuDivider, MenuHeading, MenuItem } from './PopoverMenu.jsx';

/**
 * The toolbar's Tools menu (openspec easier-placing-and-fix-assembly). Fix assembly lines up the
 * selected part's block with the block it is nearly mated to; Chain builder and Track builder wrap
 * sprockets (openspec chain-track-builder, formerly their own Build menu). `disabledReason` greys out
 * every item (history preview, an action running); `fixReason` and the chain check's error grey out
 * their own items. Each reason shows as the item's hover text.
 */
export default function ToolsMenu({ disabledReason = null, fixReason = null, chainCheck, onFixAssembly, onChain, onTrack }) {
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
  const fixOff = disabledReason || fixReason;
  const chainOff = disabledReason || (chainCheck?.ok ? null : chainCheck?.error || 'Select two or more sprockets in one plane.');
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn ${at ? 'active' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        title="Fix how parts fit together, or build a chain or track round sprockets"
      >
        <Wrench size={14} />
        Tools
        <ChevronDown size={12} />
      </button>
      {at && (
        <PopoverMenu at={at} onClose={close} label="Tools">
          <MenuHeading>Fit</MenuHeading>
          <MenuItem
            icon={Magnet}
            disabled={Boolean(fixOff)}
            onSelect={choose(onFixAssembly)}
            title={fixOff || 'Line up the pins and holes of the selected part’s block with a block it nearly fits, and seat it. The smaller block moves.'}
          >
            Fix assembly
          </MenuItem>
          <MenuDivider />
          <MenuHeading>Build</MenuHeading>
          <MenuItem icon={Link2} disabled={Boolean(chainOff)} onSelect={choose(onChain)} title={chainOff || 'Wrap a loop of Chain Links round the selected sprockets'}>
            Chain builder
          </MenuItem>
          <MenuItem disabled={Boolean(chainOff)} onSelect={choose(onTrack)} title={chainOff || 'Wrap a tank track round the selected sprockets, with rubber grippers if you like'}>
            Track builder…
          </MenuItem>
          {disabledReason && <div className="popover-note">{disabledReason}</div>}
        </PopoverMenu>
      )}
    </>
  );
}
