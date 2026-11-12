/**
 * Which buttons the context bar in the 3D view shows, and whether each is on, off, set or disabled
 * (openspec change: context-toolbar). Plain data in, plain data out, so a check can run it in Node.
 */

export const BAR_IDS = [
  'move', 'rotate', 'addToSelection', 'markHole', 'join', 'stampCopies', 'worldArrows',
  'freeMove', 'turnStep', 'growSelection', 'onePartOfGroup', 'duplicate', 'delete'
];

export const WHEEL_IDS = ['wheel', 'stepUp', 'stepDown', 'turnStep', 'worldArrows', 'pinsOnly', 'commit', 'cancel'];

// The bar's buttons (src/components/ContextToolbar.jsx): name, one line on what it does, and the keys
// or mouse gesture that do the same. Here as plain data so the help check can read the names.
export const BAR_TIPS = {
  move: ['Move', 'Slide the part along its arrows', 'W'],
  rotate: ['Rotate', 'Turn the part with its rings', 'E · right-click the part'],
  addToSelection: ['Add to selection', 'Tap parts to add or take them out', 'Shift + click'],
  markHole: ['Mark a hole', 'Tap the hole or pin end the next part goes in', 'Alt + click'],
  join: ['Manual Join', 'Pick the hole the part goes into', 'Double-click the part'],
  autoJoin: ['Auto Join', "Push the part into what it's lined up with", 'Double-click the part'],
  stampCopies: ['Stamp copies', 'Put a copy of this part in each hole you pick', 'Ctrl/Cmd + double-click'],
  worldArrows: ['World arrows', 'Arrows follow the room, not the part', 'Hold Alt'],
  freeMove: ['Free move', 'Stop parts jumping onto holes', 'Hold Alt while dragging'],
  turnStep: ['Turn step', 'How far each turn step goes', null],
  growSelection: ['Grow selection', 'Add the parts joined to this one, layer by layer', 'Shift + wheel'],
  onePartOfGroup: ['One part of a group', 'Pick a single part inside the group', 'Shift + Alt + click'],
  duplicate: ['Duplicate', 'Make a copy next to it', 'D'],
  delete: ['Delete', 'Remove it (Undo brings it back)', 'Del'],
  wheel: ['Wheel', 'Turn it for the next or previous one', 'Mouse wheel'],
  stepUp: ['Next', 'Step to the next one', 'R'],
  stepDown: ['Previous', 'Step back one', 'Shift + R'],
  cancel: ['Cancel', 'Stop without changing anything', 'Esc'],
  pinsOnly: ['Pins only', 'Only follow pins and shafts', 'Ctrl/Cmd + Shift + wheel']
};
export const COMMIT_TIPS = {
  fits: ['Put it in', 'Put the part in at the fit shown', 'Click the lit hole'],
  stamp: ['Put a copy in', 'Insert a copy at the fit shown and keep going', 'Ctrl/Cmd + double-click'],
  bendFits: ['Keep', 'Keep this bend', 'Enter'],
  ring: ['Done', 'Finish turning with this ring', 'Esc'],
  layers: ['Done', 'Keep this selection', null],
  band: ['Add this spot', 'Add the lit spot to the band', 'Click the spot']
};

const item = (id, state = 'off', disabledReason = null) => ({ id, state, disabledReason });
const disabled = (id, reason) => item(id, 'disabled', reason);

function wheelItems(stepper, arrowsShowing) {
  const { kind, canStep, canCommit } = stepper;
  // Mate arrows shown, or Bend sheet by holes waiting for its picks: only the cross
  if (kind === 'arrows' || kind === 'bendPick') return [item('cancel')];

  const stepReason = (kind === 'fits' || kind === 'bendFits') && canCommit === false
    ? 'Tap a hole first'
    : 'Nothing else to step to';
  const step = (id) => (canStep === false ? disabled(id, stepReason) : item(id));

  const items = [step('wheel'), step('stepUp'), step('stepDown')];
  if (kind === 'ring') {
    items.push(item('turnStep'));
    if (arrowsShowing) items.push(item('worldArrows'));
  }
  if (kind === 'layers') items.push(item('pinsOnly'));
  items.push(canCommit === false ? disabled('commit', 'Tap a hole first') : item('commit'));
  if (kind === 'fits' || kind === 'bendFits') items.push(item('cancel'));
  return items;
}

export function barItems({ selection, transformMode, locked, explode, playing, previewing, immersive, hasTarget, stepper }) {
  if (locked || explode || playing || previewing || immersive) return [];

  const { count, wholeGroup, stampable, locked: partLocked, hidden, band } = selection;
  const arrowsShowing = count === 1 && !partLocked && !hidden && !band;
  if (stepper) return wheelItems(stepper, arrowsShowing);

  const some = count >= 1;
  const bandReason = 'A band follows its spots: drag a handle';
  const mode = (id, on) => (band && count === 1 ? disabled(id, bandReason) : item(id, on ? 'on' : 'off'));

  const items = [
    mode('move', transformMode === 'translate'),
    mode('rotate', transformMode === 'rotate'),
    item('addToSelection'),
    item('markHole', hasTarget ? 'set' : 'off')
  ];
  if (some) items.push(partLocked ? disabled('join', 'Part is locked') : item('join'));
  if (count === 1 && stampable) items.push(item('stampCopies'));
  if (arrowsShowing) items.push(item('worldArrows'));
  if (some && transformMode === 'translate') items.push(item('freeMove'));
  if (some && transformMode === 'rotate') items.push(item('turnStep'));
  if (some) items.push(item('growSelection'));
  if (wholeGroup) items.push(item('onePartOfGroup'));
  if (some) items.push(item('duplicate'), item('delete'));
  return items;
}
