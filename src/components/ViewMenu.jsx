import React from 'react';
import { Columns2, Compass, Cuboid, Fullscreen, Glasses, Grid, LayoutGrid, Square } from 'lucide-react';
import PopoverMenu, { MenuDivider, MenuHeading, MenuItem } from './PopoverMenu.jsx';

/**
 * The view options menu (openspec view-cube-menu): opened by right-clicking the view cube, or from
 * the View button in Stereo, where the cube is hidden. Choices close it; switches and the depth
 * slider leave it open.
 */
export default function ViewMenu({ at, onClose, view }) {
  const {
    projection,
    setProjection,
    viewLayout,
    setViewLayout,
    stereoCrossEyed,
    setStereoCrossEyed,
    stereoDepth,
    setStereoDepth,
    onFullScreen,
    showGrid,
    setShowGrid,
    showConnectors,
    setShowConnectors
  } = view;
  const choose = (fn) => () => {
    fn();
    onClose();
  };
  const stereo = viewLayout === 'stereo';
  return (
    <PopoverMenu at={at} onClose={onClose} label="View options">
      <MenuHeading>Projection</MenuHeading>
      <MenuItem
        icon={Cuboid}
        checked={projection === 'perspective'}
        onSelect={choose(() => setProjection('perspective'))}
        title={stereo ? 'Stereo always uses perspective; this applies when you leave Stereo' : 'Shortcut: P'}
      >
        Perspective
      </MenuItem>
      <MenuItem icon={Square} checked={projection === 'orthographic'} onSelect={choose(() => setProjection('orthographic'))} title="Shortcut: P">
        Orthographic
      </MenuItem>
      <MenuDivider />
      <MenuHeading>Layout</MenuHeading>
      <MenuItem icon={Square} checked={viewLayout === 'single'} onSelect={choose(() => setViewLayout('single'))}>
        Single
      </MenuItem>
      <MenuItem icon={LayoutGrid} checked={viewLayout === 'four'} onSelect={choose(() => setViewLayout('four'))} title="Working view plus front, top and side views">
        4-View
      </MenuItem>
      <MenuItem icon={Glasses} checked={stereo} onSelect={choose(() => setViewLayout('stereo'))} title="Side-by-side stereo pair (work in either picture)">
        Stereo
      </MenuItem>
      {stereo && (
        <>
          <MenuItem
            icon={Columns2}
            checked={stereoCrossEyed}
            onSelect={() => setStereoCrossEyed((v) => !v)}
            title="Swap the images for cross-eyed viewing (off: parallel viewing or a phone VR viewer)"
          >
            Cross-eyed
          </MenuItem>
          <label className="popover-slider" title="Stereo depth: how far apart the two eye positions are">
            Depth
            <input type="range" min="0.25" max="3" step="0.25" value={stereoDepth} onChange={(e) => setStereoDepth(e.target.value)} />
            <span>{Number(stereoDepth).toFixed(2)}×</span>
          </label>
          <MenuItem icon={Fullscreen} onSelect={choose(onFullScreen)} title="Fill the screen with the stereo pair (Esc to exit)">
            Full screen
          </MenuItem>
        </>
      )}
      <MenuDivider />
      <MenuItem icon={Grid} checked={showGrid} onSelect={() => setShowGrid((v) => !v)} title="VEX 12.7 mm pitch grid">
        Grid
      </MenuItem>
      <MenuItem icon={Compass} checked={showConnectors} onSelect={() => setShowConnectors((v) => !v)} title="Show the selected part's pin and shaft hole axes">
        Axes
      </MenuItem>
    </PopoverMenu>
  );
}
