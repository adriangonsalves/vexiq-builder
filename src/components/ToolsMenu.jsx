import React, { useCallback, useRef, useState } from 'react';
import { ChevronDown, CircleDashed, ClipboardCheck, Expand, Link2, Magnet, Play, Ruler, Spline, Wrench } from 'lucide-react';
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
 * Bend sheet (openspec shaped-parts-and-sheet-bending) curves a plastic sheet onto another part's holes.
 * Play mode (openspec play-mode) runs the Smart Motors and shows how the build moves; ticked while on,
 * and the way out, so it stays clickable while the other tools are greyed out.
 * Band builder (openspec rubber-bands) strings a rubber band or belt round spots picked in the view;
 * Band between these and Belt round these start it from the selection; Flatten band takes a strung
 * band off its spots.
 */
export default function ToolsMenu({ disabledReason = null, fixReason = null, auditReason = null, chainCheck, chainInTheWay = [], exploded = false, auditOpen = false, bendReason = null, playing = false, playReason = null, onPlay, onFixAssembly, onAudit, onBlueprint, onExplode, onChain, onTrack, onBendSheet, bandOpen = false, onBand, betweenReason = null, onBandBetween, beltReason = null, onBelt, flattenBandReason = null, onFlattenBand }) {
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
  // Parts a run would pass through (openspec chain-routing-around-parts): select one to bend round it
  const inTheWay = chainInTheWay.length ? ` In the way: ${chainInTheWay.join(', ')}; select it to bend the chain round it.` : '';
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn ${at ? 'active' : ''}`}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        aria-label="Tools"
        title="Check the build, fix how parts fit together, or build a chain or track round sprockets"
      >
        <Wrench size={14} />
        <span className="btn-text">Tools</span>
        <ChevronDown size={12} className="btn-caret" />
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
            disabled={playing}
            shortcut="X"
            onSelect={choose(onExplode)}
            title={exploded ? 'Close the Explode panel and put every part back (Shortcut: X)' : 'Take the robot apart with a slider (Shortcut: X)'}
          >
            Explode
          </MenuItem>
          <MenuItem
            icon={Play}
            checked={playing}
            disabled={!playing && Boolean(playReason)}
            onSelect={choose(onPlay)}
            title={playing ? 'Stop playing and put every part back (Esc)' : playReason || 'Run the Smart Motors with throttles and watch the gears, shafts and arms move'}
          >
            Play mode
          </MenuItem>
          <MenuDivider />
          <MenuHeading>Build</MenuHeading>
          <MenuItem icon={Link2} disabled={Boolean(chainOff)} onSelect={choose(onChain)} title={chainOff || `Wrap a loop of Chain Links round the selected sprockets.${inTheWay}`}>
            Chain builder
          </MenuItem>
          <MenuItem disabled={Boolean(chainOff)} onSelect={choose(onTrack)} title={chainOff || `Wrap a tank track round the selected sprockets, with rubber grippers if you like.${inTheWay}`}>
            Track builder…
          </MenuItem>
          <MenuItem
            icon={Spline}
            disabled={Boolean(disabledReason || bendReason)}
            onSelect={choose(onBendSheet)}
            title={disabledReason || bendReason || 'Curve the selected plastic sheet onto a row of holes on the other selected part (its pinned rows stay flat), or, with only a sheet selected, Alt+click one of its holes and then a hole on another part.'}
          >
            Bend sheet…
          </MenuItem>
          <MenuItem
            icon={CircleDashed}
            checked={bandOpen}
            disabled={Boolean(disabledReason) && !bandOpen}
            onSelect={choose(onBand)}
            title={bandOpen ? 'Close the Band builder (Esc)' : disabledReason || 'String a rubber band or belt: click the posts, pins, pulleys, tooth gaps or beam ends it goes round, in order'}
          >
            Band builder
          </MenuItem>
          <MenuItem disabled={Boolean(disabledReason || betweenReason)} onSelect={choose(onBandBetween)} title={disabledReason || betweenReason || 'Start a band between the nearest spots of the two selected parts'}>
            Band between these
          </MenuItem>
          <MenuItem disabled={Boolean(disabledReason || beltReason)} onSelect={choose(onBelt)} title={disabledReason || beltReason || 'Start a belt round the outside of the selected pulleys, hubs or sprockets'}>
            Belt round these
          </MenuItem>
          <MenuItem disabled={Boolean(disabledReason || flattenBandReason)} onSelect={choose(onFlattenBand)} title={disabledReason || flattenBandReason || 'Take the selected band off its spots: a flat ring where it is'}>
            Flatten band
          </MenuItem>
          {disabledReason && <div className="popover-note">{disabledReason}</div>}
        </PopoverMenu>
      )}
    </>
  );
}
