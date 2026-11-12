/**
 * What the user is doing right now, as a list of situation ids (src/help/tags.js SITUATIONS), most
 * specific first (openspec in-app-help, design.md section 12). Pure: App passes a snapshot of its state.
 */

// First match wins. A null kind means selecting that part gives no situation of its own.
const KINDS = [
  [/bushing|anchor|support cap|washer/i, null],
  [/motor.*shaft/i, 'motor-shaft'],
  [/smart motor/i, 'motor'],
  [/robot brain/i, 'brain'],
  [/robot battery/i, 'battery'],
  [/rubber band/i, 'band'],
  [/\bbelt\b/i, 'belt'],
  [/pulley/i, 'pulley'],
  [/sprocket/i, 'sprocket'],
  [/chain link/i, 'chain'],
  [/tank tread/i, 'track'],
  [/\btire\b/i, 'tire'],
  [/omni.*wheel/i, 'omni-wheel'],
  [/\bhub\b/i, 'hub'],
  [/wheel/i, 'wheel'],
  [/landing gear/i, null],
  [/gear/i, 'gear'],
  [/plastic sheet/i, 'sheet'],
  [/\bpin\b/i, 'pin'],
  [/collar/i, 'collar'],
  [/spacer/i, 'spacer'],
  [/\bshaft\b/i, 'shaft'],
  [/connector/i, 'connector'],
  [/standoff/i, 'standoff'],
  [/\bbeam\b/i, 'beam'],
  [/\bplate\b/i, 'plate']
];

/** The part-kind situation of a part ({ name, category }), or null when it has none. */
export function partKindTag(part) {
  const name = String((part && part.name) || '');
  for (const [re, kind] of KINDS) if (re.test(name)) return kind;
  return null;
}

const PANELS = ['band', 'chain', 'track', 'bend', 'explode', 'drop', 'play', 'audit', 'blueprint', 'timeline', 'buildLibrary', 'offline', 'settings'];
const PANEL_SITUATION = {
  band: 'band-builder', chain: 'chain-builder', track: 'track-builder', bend: 'bend-sheet', explode: 'explode',
  drop: 'drop-test', play: 'play', audit: 'audit', blueprint: 'blueprint', timeline: 'timeline',
  buildLibrary: 'build-library', offline: 'offline', settings: 'settings'
};
const BAR = [
  ['selectMode', 'select-mode'], ['boxSelect', 'box-select'], ['worldAxes', 'world-arrows'], ['freeMove', 'free-move'],
  ['grow', 'grow-selection'], ['exactPick', 'one-of-group'], ['turnMenu', 'turn-step']
];

/** snapshot: { panels, viewLayout, interaction, pointerTool, bar, transformMode, groupSelected, selection } (all optional). */
export function helpContext(snapshot = {}) {
  const { panels = {}, viewLayout, interaction = {}, pointerTool, bar = {}, transformMode, groupSelected, selection = [] } = snapshot;
  const out = [];
  const add = (id) => {
    if (!out.includes(id)) out.push(id);
  };

  // 1. a tool or panel that is open
  for (const k of PANELS) if (panels[k]) add(PANEL_SITUATION[k]);
  if (viewLayout === 'four') add('four-view');
  if (viewLayout === 'stereo') add('stereo');

  // 2. something going on in the 3D view
  const { fit, placing, fitsKind, session } = interaction;
  if (fit && fit.count > 1) add('fits-wheel');
  if (placing || fitsKind === 'place') add('placing');
  if (fitsKind === 'copy') add('stamp');
  if (fitsKind === 'pick' || fitsKind === 'target') add('hole-pick');
  if (session === 'arrows' || session === 'ring') add('mate-arrows');

  // 3. an armed bar button, the Mark and Stamp tools, Rotate mode
  if (pointerTool === 'target') add('mark-hole');
  if (pointerTool === 'stamp') add('stamp');
  for (const [key, id] of BAR) if (bar[key]) add(id);
  if (transformMode === 'rotate') add('rotate');

  // 4. what is selected
  if (groupSelected) add('group-selected');
  if (selection.length > 1) {
    const kinds = selection.map(partKindTag);
    add(kinds[0] && kinds.every((k) => k === kinds[0]) ? kinds[0] : 'several-parts');
  } else if (selection.length === 1) {
    const kind = partKindTag(selection[0]);
    if (kind) add(kind);
  }
  return out;
}
