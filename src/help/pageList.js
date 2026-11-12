/**
 * The Help guide's pages, in their groups and order (openspec in-app-help, specs/help-content
 * "The guide's pages"). Plain data, so the panel and scripts/check-help.mjs read the same list.
 * Page ids are the names used in links (#help/<id>) and must not change once published.
 */

export const HELP_GROUPS = [
  { id: 'start', title: 'Start here' },
  { id: 'basics', title: 'Basics' },
  { id: 'mechanisms', title: 'Make it work like the real robot' },
  { id: 'check', title: 'See it and check it' },
  { id: 'devices', title: 'Settings and devices' },
  { id: 'lookup', title: 'Look it up' },
  { id: 'advanced', title: 'Advanced' }
];

const LIST = {
  start: ['quick-start', 'tour'],
  basics: ['library', 'looking-around', 'moving', 'joining', 'context-bar', 'selecting', 'outline', 'copying', 'undo-history', 'saving'],
  mechanisms: ['pins-and-connectors', 'shafts-and-wheels', 'gears', 'chain-and-track', 'rubber-bands', 'plastic-sheets'],
  check: ['views', 'explode', 'check-and-fix', 'blueprint', 'play-mode'],
  devices: ['settings', 'tablets-and-phones', 'offline'],
  lookup: ['shortcuts', 'words', 'troubleshooting'],
  advanced: ['advanced-tools', 'history-branches', 'assistant']
};

/** [{ id, group, order }] with order counted from 1 inside each group, in guide order. */
export const HELP_PAGES = HELP_GROUPS.flatMap((g) => LIST[g.id].map((id, i) => ({ id, group: g.id, order: i + 1 })));

/** The page the Start here card and the welcome card open. */
export const START_PAGE = 'quick-start';

/** Pages that exist only where the assistant does (the dev app), never on the static site. */
export const DEV_ONLY_PAGES = ['assistant'];
