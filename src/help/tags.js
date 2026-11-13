/**
 * Labels on help pages (openspec in-app-help, design.md section 12). Plain data, no imports, so the
 * help check can read it in Node.
 *
 * TOPIC_TAGS: words a page may carry in its `tags:` header line (3 to 10 per page). Shared freely; they
 * find related pages and help the search rank pages.
 *
 * SITUATIONS: exactly what helpContext() (context.js) can return, most specific tiers first. A page
 * claims one in its `answers:` header line; a More section claims one with `<!-- answers: id -->` under
 * its heading. Each is claimed once, and `reason` finishes "Because you're ...". Descriptive words
 * (touch, zoom, mirror, shortcut) are topic tags only. Sensors, pneumatics and moving a part are not
 * situations: selecting those opens Help as if nothing were selected.
 */
export const TOPIC_TAGS = [
  'gear', 'sprocket', 'chain', 'track', 'wheel', 'shaft', 'motor', 'brain', 'battery', 'pin', 'beam', 'plate',
  'connector', 'standoff', 'sheet', 'band', 'belt', 'pulley', 'collar', 'spacer', 'tire',
  'touch', 'mouse', 'keyboard', 'tablet', 'phone', 'shortcut', 'zoom', 'camera', 'view', 'cube',
  'select', 'group', 'move', 'rotate', 'turn', 'mirror', 'copy', 'duplicate', 'delete', 'lock', 'hide', 'name',
  'join', 'mate', 'hole', 'snap', 'fit', 'place', 'bend',
  'undo', 'redo', 'history', 'branch', 'save', 'load', 'export', 'starter', 'library', 'outline', 'properties',
  'settings', 'offline', 'advanced', 'search', 'audit', 'fix', 'problem', 'play', 'test', 'explode', 'blueprint',
  'mechanism', 'tool', 'build', 'words', 'assistant', 'help'
];

const S = (id, tier, reason) => ({ id, tier, reason });

export const SITUATIONS = [
  // 1. a tool or panel that is open or running
  S('band-builder', 1, "stringing a rubber band"),
  S('chain-builder', 1, 'building a chain'),
  S('track-builder', 1, 'building a track'),
  S('bend-sheet', 1, 'bending a plastic sheet'),
  S('explode', 1, 'looking at an exploded view'),
  S('play', 1, 'in Play mode'),
  S('drop-test', 1, 'running a drop test'),
  S('audit', 1, 'checking your build'),
  S('blueprint', 1, 'making a blueprint'),
  S('timeline', 1, 'looking at your history'),
  S('build-library', 1, 'looking through your builds'),
  S('settings', 1, 'in Settings'),
  S('offline', 1, 'setting up offline use'),
  S('four-view', 1, 'looking at 4-View'),
  S('stereo', 1, 'looking at Stereo'),
  // 2. something going on in the 3D view
  S('fits-wheel', 2, 'stepping through the ways a part can fit'),
  S('placing', 2, 'placing a part'),
  S('stamp', 2, 'stamping copies'),
  S('hole-pick', 2, 'picking a hole'),
  S('mate-arrows', 2, 'turning a part with its arrows'),
  // 3. a context bar button that is on or armed, and Rotate mode
  S('mark-hole', 3, 'marking a hole'),
  S('select-mode', 3, 'adding to your selection'),
  S('box-select', 3, 'selecting with a box'),
  S('world-arrows', 3, 'using World arrows'),
  S('free-move', 3, 'moving a part freely'),
  S('grow-selection', 3, 'growing your selection'),
  S('one-of-group', 3, 'picking one part of a group'),
  S('turn-step', 3, 'choosing a turn step'),
  S('rotate', 3, 'turning a part'),
  // 4. what is selected
  S('group-selected', 4, 'looking at a group'),
  S('several-parts', 4, 'working with several parts'),
  S('gear', 4, 'working with a gear'),
  S('sprocket', 4, 'working with a sprocket'),
  S('chain', 4, 'working with chain'),
  S('track', 4, 'working with track'),
  S('sheet', 4, 'working with a plastic sheet'),
  S('band', 4, 'working with a rubber band'),
  S('belt', 4, 'working with a belt'),
  S('pulley', 4, 'working with a pulley'),
  S('motor', 4, 'working with a Smart Motor'),
  S('brain', 4, 'working with the Robot Brain'),
  S('battery', 4, 'working with the battery'),
  S('shaft', 4, 'working with a shaft'),
  S('motor-shaft', 4, 'working with a motor shaft'),
  S('collar', 4, 'working with a shaft collar'),
  S('spacer', 4, 'working with a spacer'),
  S('wheel', 4, 'working with a wheel'),
  S('omni-wheel', 4, 'working with an omni wheel'),
  S('tire', 4, 'working with a tire'),
  S('hub', 4, 'working with a wheel hub'),
  S('pin', 4, 'working with a pin'),
  S('standoff', 4, 'working with a standoff'),
  S('connector', 4, 'working with a connector'),
  S('beam', 4, 'working with a beam'),
  S('plate', 4, 'working with a plate')
];
