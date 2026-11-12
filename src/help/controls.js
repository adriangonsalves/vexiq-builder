/**
 * Show me (openspec in-app-help, design.md section 6): every name a help page may write in `[[…]]`,
 * and how to find that control on screen. Plain data plus one lookup that touches the DOM only when
 * called, so the help check can read the names in Node.
 *
 * An entry is one of:
 *   { find: [selector, …], hint }   the first selector that matches a control on screen is flashed;
 *                                   `hint` is the one line shown when none is on screen
 *                                   (`sidePanel`: hidden while the guide takes the side panel's place)
 *   { menu: 'Tools' }               an item inside a menu: the menu's button is flashed (menus are
 *                                   never opened by the guide)
 * The selectors use `data-help` attributes put on the controls for this purpose (and the context
 * bar's own `data-tip` ids), never class names that change with the styling.
 */
import { BAR_IDS, BAR_TIPS, WHEEL_IDS } from '../utils/contextToolbarItems.js';

const at = (...names) => names.map((n) => `[data-help="${n}"]`);

const TOOLBAR = {
  Undo: { find: at('undo'), hint: 'Undo is in the toolbar at the top.' },
  Redo: { find: at('redo'), hint: 'Redo is in the toolbar at the top.' },
  History: { find: at('history'), hint: 'History is in the toolbar at the top.' },
  Select: { find: at('select'), hint: 'Select is in the toolbar at the top.' },
  Tools: { find: at('tools'), hint: 'Tools is in the toolbar at the top.' },
  Snap: { find: at('snap'), hint: 'Snap is in the toolbar at the top.' },
  Focus: { find: at('focus'), hint: 'Focus is in the toolbar at the top.' },
  Wide: { find: at('wide'), hint: 'Wide is in the toolbar on a computer or tablet. It is hidden on a phone.' },
  Panels: { find: at('wide'), hint: 'Panels is in the toolbar on a computer screen, after you have selected Wide.' },
  View: { find: at('view', 'view-cube'), hint: 'Use the view cube in the top right corner of the 3D view, or View in the toolbar.' },
  File: { find: at('file'), hint: 'File is in the toolbar at the top.' },
  Help: { find: at('help'), hint: 'Help is the question mark in the toolbar at the top.' },
  Settings: { find: at('settings'), hint: 'Settings is the gear at the right end of the toolbar.' },
  'Build name': { find: at('build-name'), hint: "The build's name is at the left of the toolbar on a computer screen." }
};

const PANELS = {
  Library: {
    find: at('library-button', 'library-tab', 'library'),
    sidePanel: true,
    hint: 'Select Panels in the toolbar to show the Library.'
  },
  Outline: {
    find: at('outline-button', 'outline-tab', 'outline'),
    sidePanel: true,
    hint: 'Select Panels in the toolbar to show the Outline.'
  },
  Properties: {
    find: at('properties'),
    sidePanel: true,
    hint: 'Select a part, then its Properties show beside the 3D view (on a tablet or phone, in place of the Outline).'
  },
  '3D view': { find: at('view-area'), hint: 'The 3D view is the big area in the middle.' },
  'View cube': { find: at('view-cube'), hint: 'The view cube is in the top right corner of the 3D view (not in Stereo).' },
  'Context bar': { find: at('context-bar'), hint: 'The context bar shows down the side of the 3D view when there is something to do.' },
  'Shortcuts strip': { find: at('shortcuts-strip'), hint: 'The shortcuts strip runs along the bottom of the 3D view on a computer screen.' }
};

const CONTROLS = {
  // The history timeline (select History in the toolbar to open it)
  Play: { find: at('play'), hint: 'Select History in the toolbar, then Play is at the left of the timeline.' },
  Pause: { find: at('play'), hint: 'Select History, then Play. While the build plays, the same button reads Pause.' },
  '1×': { find: at('speed-1'), hint: 'Select History in the toolbar to see the speed buttons next to Play.' },
  '2×': { find: at('speed-2'), hint: 'Select History in the toolbar to see the speed buttons next to Play.' },
  '4×': { find: at('speed-4'), hint: 'Select History in the toolbar to see the speed buttons next to Play.' },
  'Go to end of step': { find: at('go-to-end-of-step'), hint: 'It shows under the timeline when you slide to the middle of a step.' },

  // Your builds window (File, then Your builds)
  Open: { find: at('build-open'), hint: 'Select File, then Your builds, to see Open beside each build.' },
  Rename: { find: at('build-rename'), hint: 'Select File, then Your builds, to see Rename beside each build.' },
  'Open from computer…': { find: at('library-open-from-computer'), hint: 'Select File, then Your builds, to see Open from computer… at the top of the window.' },

  // The Outline, the Library and Properties
  Locate: { find: at('outline-locate'), sidePanel: true, hint: 'Select Panels in the toolbar to show the Outline. Locate is the small target above the list.' },
  'Library search box': { find: at('library-search'), sidePanel: true, hint: 'Select Panels in the toolbar to show the Library. The search box is at the top of it.' },
  'Group name': { find: at('group-name'), sidePanel: true, hint: 'Select a group, then its name shows in Properties.' },
  'Hide all': { find: at('group-hide-all'), sidePanel: true, hint: 'Select a group or two or more parts, then Hide all shows in Properties.' },
  'Lock all': { find: at('group-lock-all'), sidePanel: true, hint: 'Select a group or two or more parts, then Lock all shows in Properties.' },
  'Mirror Z (L↔R)': { find: at('mirror-z'), sidePanel: true, hint: 'Select one part, then find Mirror in the Smart Assembly section of Properties (turn on Advanced options in Settings first).' },
  'Mirror X (F↔R)': { find: at('mirror-x'), sidePanel: true, hint: 'Select one part, then find Mirror in the Smart Assembly section of Properties (turn on Advanced options in Settings first).' },
  'Mirror All Z': { find: at('mirror-all-z'), sidePanel: true, hint: 'Select one part, then find Mirror in the Smart Assembly section of Properties (turn on Advanced options in Settings first).' },
  'Auto-Fasten Pins': { find: at('auto-fasten'), sidePanel: true, hint: 'Select one part, then find Auto-Fasten in the Smart Assembly section of Properties (turn on Advanced options in Settings first).' },
  'Snap & Mate Selected Part': { find: at('snap-mate'), sidePanel: true, hint: 'Select one part, then find Snap & Mate in the Smart Assembly section of Properties (turn on Advanced options in Settings first).' },
  Flatten: { find: at('bend-flatten', 'band-flatten'), hint: 'For a bent sheet, select Tools, then Bend sheet. For a band, select the band and look in Properties.' },

  // Settings (the gear in the toolbar)
  Offline: { find: at('settings-offline'), hint: 'Select the gear (Settings). Offline is a section in it on the website version.' },
  Shadows: { find: at('settings-shadows'), hint: 'Select the gear (Settings) to see Shadows under Display.' },
  'Ambient occlusion': { find: at('settings-ambient-occlusion'), hint: 'Select the gear (Settings) to see Ambient occlusion under Display.' },
  'Environment reflections': { find: at('settings-environment-reflections'), hint: 'Select the gear (Settings) to see Environment reflections under Display.' },
  'Reflection brightness': { find: at('settings-reflection-brightness'), hint: 'Select the gear (Settings) to see Reflection brightness under Display.' },

  // Views and panels that are only sometimes open
  Depth: { find: at('stereo-depth'), hint: 'Choose View, then Stereo. Then open View again to see Depth.' },
  'Open Full SVG': { find: at('blueprint-open-svg'), hint: 'Select Tools, then Blueprint, to see Open Full SVG at the top of the window.' },
  'Explode slider': { find: at('explode-slider'), hint: 'Select Tools, then Explode, to see the Explode panel and its slider.' },
  'Explode close button': { find: at('explode-close'), hint: 'Select Tools, then Explode, to see the Explode panel and its close button.' },
  'Attempt Fix': { find: at('audit-attempt-fix'), hint: 'Select Tools, then Audit. Attempt Fix shows beside a problem that can be fixed.' },
  Drop: { find: at('play-drop'), hint: 'Select Tools, then Play mode, to see Drop in the Drop test row.' },
  Reset: { find: at('play-reset'), hint: 'Press Drop in Play mode. Then Reset shows beside it.' },
  Hold: { find: at('play-hold'), hint: 'Select Tools, then Play mode. Hold is beside each motor.' },
  Throttle: { find: at('play-throttle'), hint: 'Select Tools, then Play mode, to see a throttle slider for each motor.' },
  Done: { find: at('band-done'), hint: 'Select Tools, then Band builder, to start a band. Done shows under the band steps.' },
  Apply: { find: at('bend-apply'), hint: 'Select a sheet and another part, then Tools, then Bend sheet. Pick a row to turn Apply on.' }
};

const menu = (name, items) => Object.fromEntries(items.map((item) => [`${name} → ${item}`, { menu: name }]));

const MENUS = {
  ...menu('Select', ['Select mode', 'Box select', 'Select Connected', 'Select All', 'Select None', 'Invert Selection', 'Group', 'Ungroup']),
  ...menu('Tools', [
    'Fix assembly', 'Audit', 'Blueprint', 'Explode', 'Play mode', 'Chain builder', 'Track builder…', 'Bend sheet…',
    'Band builder', 'Band between these', 'Belt round these', 'Flatten band'
  ]),
  ...menu('Snap', ['1P', '0.5P', '0.25P', 'Free']),
  ...menu('File', ['New', 'Starter', 'Load…', 'Export', 'Delete this build…']),
  ...menu('View', ['Perspective', 'Orthographic', 'Single', '4-View', 'Stereo', 'Cross-eyed', 'Full screen', 'Grid', 'Axes'])
};

// What makes each context bar button appear when it isn't showing
const BAR_HINTS = {
  move: 'Move shows on the context bar when nothing else is going on in the 3D view',
  rotate: 'Rotate shows on the context bar when nothing else is going on in the 3D view',
  addToSelection: 'Add to selection shows on the context bar when nothing else is going on in the 3D view',
  markHole: 'Mark a hole shows on the context bar when nothing else is going on in the 3D view',
  stampCopies: 'Select one part with pins first, then Stamp copies shows on the context bar',
  worldArrows: 'Select one part first, then World arrows shows on the context bar',
  freeMove: 'Select a part with Move on, then Free move shows on the context bar',
  turnStep: 'Select a part with Rotate on, then Turn step shows on the context bar',
  onePartOfGroup: 'Select a group first, then One part of a group shows on the context bar'
};
const WHEEL_HINT = (name) => `${name} shows on the wheel bar while you step through fits or turn with a ring`;

const barEntry = (id, name) => ({
  find: [`[data-help="context-bar"] [data-tip="${id}"]`],
  hint: BAR_HINTS[id] || (WHEEL_IDS.includes(id) && !BAR_IDS.includes(id) ? WHEEL_HINT(name) : `Select a part first, then ${name} shows on the context bar`)
});

const CONTEXT_BAR = {
  ...Object.fromEntries([...new Set([...BAR_IDS, ...WHEEL_IDS])].filter((id) => BAR_TIPS[id]).map((id) => [BAR_TIPS[id][0], barEntry(id, BAR_TIPS[id][0])])),
  // The join button is named for what a double-click would do: Manual Join or Auto Join
  Join: barEntry('join', 'Join'),
  'Auto Join': barEntry('join', 'Auto Join'),
  'Manual Join': barEntry('join', 'Manual Join'),
  Tick: { find: ['[data-help="context-bar"] [data-tip="commit"]'], hint: WHEEL_HINT('The tick') }
};

// Duplicate and Delete are also on the context bar; inside the Your builds window they mean the build
const SHARED = {
  Duplicate: { ...CONTEXT_BAR.Duplicate, find: [...at('build-duplicate'), ...CONTEXT_BAR.Duplicate.find] },
  Delete: { ...CONTEXT_BAR.Delete, find: [...at('build-delete'), ...CONTEXT_BAR.Delete.find] }
};

export const HELP_CONTROLS = { ...TOOLBAR, ...PANELS, ...MENUS, ...CONTEXT_BAR, ...CONTROLS, ...SHARED };

/** Whether an element is drawn on screen now (not hidden, not zero-sized, inside the window's height). */
function onScreen(el) {
  if (!el || !el.getClientRects().length) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  // Off to the side counts as on screen: a phone's toolbar scrolls sideways, and flashing scrolls it in
  if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
}

/**
 * Where the named control is now: `{ element }` when one is on screen, else `{ hint }`.
 * Unknown names give `{ hint }` too (the help check stops pages from naming those).
 */
export function locateControl(name, root = document) {
  let entry = HELP_CONTROLS[name];
  if (entry?.menu) entry = HELP_CONTROLS[entry.menu];
  if (!entry) return { hint: `${name} isn't on screen right now.` };
  for (const selector of entry.find) {
    const element = [...root.querySelectorAll(selector)].find(onScreen);
    if (element) return { element };
  }
  // On a tablet, and on a computer under 1500 px wide, the guide takes the side panel's place
  if (entry.sidePanel && root.querySelector('.workspace-grid.help-open')) return { hint: `Close Help to see the ${name}.` };
  return { hint: entry.hint };
}
