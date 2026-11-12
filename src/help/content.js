/**
 * The guide's pages and pictures, inside the help chunk (openspec in-app-help, design.md section 3):
 * every page's text from src/help/pages/*.md, parsed once, and the pictures' sizes and markers from
 * public/help/shots/shots.json. Nothing here loads until Help is first opened.
 *
 * Fixture pages (scripts/fixtures/help/pages/) replace the real ones only in a build made with
 * VITE_HELP_FIXTURES=1, for checking the panel before the real pages exist. Off in every normal build.
 */
import { parsePage } from './renderPage.js';
import { HELP_GROUPS, HELP_PAGES } from './pageList.js';
import shotsJson from '../../public/help/shots/shots.json';

const realFiles = import.meta.glob('./pages/*.md', { query: '?raw', import: 'default', eager: true });
const fixtureFiles = import.meta.env.VITE_HELP_FIXTURES
  ? import.meta.glob('../../scripts/fixtures/help/pages/*.md', { query: '?raw', import: 'default', eager: true })
  : {};

const files = Object.keys(fixtureFiles).length ? fixtureFiles : realFiles;
const idOf = (file) => file.replace(/^.*\//, '').replace(/\.md$/, '');

const groupRank = new Map(HELP_GROUPS.map((g, i) => [g.id, i]));
const listRank = new Map(HELP_PAGES.map((p, i) => [p.id, i]));

const allPages = Object.entries(files)
  .map(([file, text]) => ({ id: idOf(file), ...parsePage(text) }))
  .sort(
    (a, b) =>
      (groupRank.get(a.meta.group) ?? 99) - (groupRank.get(b.meta.group) ?? 99) ||
      (Number(a.meta.order) || 99) - (Number(b.meta.order) || 99) ||
      (listRank.get(a.id) ?? 999) - (listRank.get(b.id) ?? 999)
  );

/** The pages this site shows, in guide order: dev-only pages only where the assistant exists. */
export function sitePages({ hasAssistant }) {
  return allPages.filter((p) => hasAssistant || !p.meta.devOnly);
}

/** `{ [name]: { w, h, marks: [{ n, x, y }] } }` */
export const SHOTS = shotsJson || {};

export { helpTarget, relatedPages } from './target.js';
export { HELP_GROUPS };
