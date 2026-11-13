/**
 * Which buttons the context bar in the 3D view shows, and whether each is on, off, set or disabled
 * (openspec change: context-toolbar). Plain data in, plain data out, so a check can run it in Node.
 */

export const BAR_IDS = [
  'move', 'rotate', 'addToSelection', 'markHole', 'join', 'stampCopies', 'worldArrows',
  'freeMove', 'turnStep', 'growSelection', 'onePartOfGroup', 'duplicate', 'delete'
];

export const WHEEL_IDS = ['wheel', 'stepUp', 'stepDown', 'turnStep', 'worldArrows', 'pinsOnly', 'commit', 'cancel'];

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

/** The Join button's tip for each kind: [name, what it does, keys] (openspec context-toolbar, precise-placement). */
export const JOIN_TIPS = {
  manual: ['Manual Join', 'Pick the hole the part goes into', 'Double-click the part'],
  auto: ['Auto Join', "Push the part into what it's lined up with", 'Double-click the part'],
  target: ['Auto Join', 'Put the part into the marked hole', 'Double-click the part']
};

/**
 * Which Join the bar shows: 'target' when one part is selected and a hole or pin end is marked on
 * another part (Join puts it there, before anything it lines up with), else 'auto' when it is lined up
 * with something it can be pushed into, else 'manual'.
 */
export function joinKindFor({ count, targetOnOtherPart = false, linedUp = false }) {
  if (count === 1 && targetOnOtherPart) return 'target';
  return linedUp ? 'auto' : 'manual';
}
