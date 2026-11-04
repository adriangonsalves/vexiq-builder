import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown, ClipboardCheck, Expand, Link2, Magnet, Ruler, Wrench } from 'lucide-react';
import PopoverMenu, { MenuDivider, MenuHeading, MenuItem } from './PopoverMenu.jsx';

/**
 * The toolbar's Tools menu (openspec easier-placing-and-fix-assembly). Fix assembly lines up the
 * selected part's block with the block it is nearly mated to; Chain builder and Track builder wrap
 * sprockets (openspec chain-track-builder, formerly their own Build menu). `disabledReason` greys out
 * every item (history preview, an action running); `fixReason` and the chain check's error grey out
 * their own items. Each reason shows as the item's hover text. Audit & Blueprint (formerly its own
 * toolbar button) is now two items: Audit opens or closes the Audit panel that slides up in the 3D
 * view (ticked while open), and Blueprint shows the 3-view drawing on its own. Explode
 * (formerly a toolbar button; shortcut X) opens or closes the Explode panel and shows a tick while it is open.
 */
export default function ToolsMenu({ disabledReason = null, fixReason = null, auditReason = null, chainCheck, exploded = false, auditOpen = false, onFixAssembly, onAudit, onBlueprint, onExplode, onChain, onTrack }) {
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
  const auditOff = disabledReason || auditReason;
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
        title="Check the build, fix how parts fit together, or build a chain or track round sprockets"
      >
        <Wrench size={14} />
        Tools
        <ChevronDown size={12} />
      </button>
      {at && (
        <PopoverMenu at={at} onClose={close} label="Tools">
          <MenuHeading>Check and fit</MenuHeading>
          <MenuItem
            icon={Magnet}
            disabled={Boolean(fixOff)}
            onSelect={choose(onFixAssembly)}
            title={fixOff || 'Line up the pins and holes of the selected part’s block with a block it nearly fits, and seat it. The smaller block moves.'}
          >
            Fix assembly
          </MenuItem>
          <MenuItem
            icon={ClipboardCheck}
            checked={auditOpen}
            disabled={Boolean(auditOff)}
            onSelect={choose(onAudit)}
            title={auditOff || (auditOpen ? 'Close the Audit panel' : 'Check the build and list what it found, in a panel that stays open while you work')}
          >
            Audit
          </MenuItem>
          <MenuItem
            icon={Ruler}
            disabled={Boolean(auditOff)}
            onSelect={choose(onBlueprint)}
            title={auditOff || 'Show the 3-view orthographic blueprint (top, side, front) of the build'}
          >
            Blueprint
          </MenuItem>
          <MenuItem
            icon={Expand}
            checked={exploded}
            shortcut="X"
            onSelect={choose(onExplode)}
            title={exploded ? 'Close the Explode panel and put every part back (Shortcut: X)' : 'Take the robot apart with a slider (Shortcut: X)'}
          >
            Explode
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
