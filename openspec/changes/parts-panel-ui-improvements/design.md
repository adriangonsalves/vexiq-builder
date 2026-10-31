## Context

See proposal.md for why. Today:

- The library (`src/App.jsx`, left `<aside className="panel panel-left">`) filters `catalog` into `filteredCatalog` by `searchQuery` and `activeCategory` and renders each part as a `.part-card` button with `<PartThumbnail>` and text. Clicking calls `handleAddPart(part)` directly. `handleAddPart` is also used by the WebMCP bridge (`placePartAt`, with `meta.source: 'assistant'`), so counting uses there would count MCP adds.
- `PartThumbnail` renders each part once with a shared WebGL renderer at `THUMB_PX * 2` (144 px) and caches the data URL per `partId|defaultColor`. The `<img>` is shown at 72 px. Parts with `index < 12` render at once; the rest wait for an IntersectionObserver.
- The left panel is 340 px wide (`.workspace-grid`), so the list has about 320 px inside its padding.
- Small per-browser choices already live in `localStorage` under `vexiq.*` keys read in a `useState` initializer inside try/catch (`PANELS_HIDDEN_KEY`).
- The Outliner maps `instances` to `.instance-row`s showing `inst.label`. The Inspector's Part Number and Category rows sit in the CAD & Semantic Metadata section, which is only shown with advanced options on. The global key handler already ignores keys typed in inputs, so a search box's own `Esc` won't clash with picking or deselect.

## Goals / Non-Goals

**Goals:**
- Keep one source of parts (`filteredCatalog`, or the Recent list) feeding both views, so search, category and Recent behave the same in List and Grid.
- Keep thumbnails rendered once per part and colour, whichever view shows them.

**Non-Goals:**
- No resizable tiles or zoom slider in Grid; one tile size.
- No drag from the library into the viewport.
- No way to clear or edit the Recent list in this change (can be a follow-up).
- No search over Outliner rows by colour, position or joint; no sorting or grouping of rows.

## Decisions

### Grid view is a second layout of the same list
The view mode (`'list' | 'grid'`) is a state in App, read from and written to `localStorage` key `vexiq.libraryView` the same way as `vexiq.panelsHidden` (try/catch, any value other than `'grid'` means List). The `.catalog-list` container gets a `grid` modifier class; in Grid each part renders as a `.part-tile` button holding only `<PartThumbnail>`, laid out with `grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))` so the 320 px panel gets three columns. Tiles keep `content-visibility: auto` for tiles past the first screen, like `.part-card-deferred`.

Alternative considered: a separate Grid component with its own filtering. Rejected: two copies of the filter would drift.

### One larger thumbnail render serves both views
Raise the render size to cover the grid tile (shown ~100 px, rendered at 2x = 200 px) and let List show the same image scaled to 72 px. `PartThumbnail` takes a `size` prop (default 72) that only sets the shown size of the `<img>` and tile box. The cache key stays `partId|defaultColor`.

Alternative considered: cache per size and render twice. Rejected: switching views would re-render every thumbnail, and the GPU work per part is the slow part. The extra cost of 200 px against 144 px renders is small next to loading the mesh.

The eager-render count (`index < 12`) stays; in Grid the IntersectionObserver picks up the rest of the first screen right away, so nothing visible is left blank.

### One floating hover label for Grid
The name label is a single element in the left panel, positioned from the hovered or focused tile's `getBoundingClientRect()` (below the tile, flipped above near the bottom, and shifted to stay inside the panel's left and right edges). It shows after a short delay (~250 ms) on `pointerenter`/`focus` and hides on `pointerleave`/`blur` and on scroll. Each tile also gets `aria-label={part.name}`.

Alternatives considered: the native `title` attribute (shows after about a second, can't be styled, can't show the part number on its own line), and a CSS `::after` label per tile (clipped by the scrolling list's `overflow`).

### Recent list: scores that fade with each add
New `src/utils/recentParts.js` holds plain functions, no React:

- `loadRecent()` → `[{ id, score }]` from `localStorage` key `vexiq.recentParts` (`{ version: 1, entries }`); bad or missing data gives `[]`.
- `recordUse(entries, partId)` → new entries: every score is multiplied by `DECAY = 0.9`, the used part gets `+1` (added with score 1 if new), sorted by score high to low, cut to `MAX_RECENT = 20`.
- `saveRecent(entries)` writes it back, ignoring storage errors.

This one score covers both "recent" and "often": five uses in a row score about 4.1 against 1 for a single latest use; a part used once falls to about 0.12 after 20 other adds; three old uses followed by 40 others fall to about 0.04. Fading by adds instead of by clock time means a week away from the app doesn't empty the list, and nothing needs timestamps. Ties keep the newer part first (the sort is stable and a newly used part is put at the front before sorting).

Alternatives considered: plain most-recent-first (ignores how often), plain use count (a part used heavily last month stays on top forever), and time-based fading (empties the list after a break).

App keeps `recentEntries` in state, initialized from `loadRecent()`. The library's click handler becomes `handleLibraryAdd(part)`, which calls `handleAddPart(part)` and, when it returns an instance (it returns `null` while previewing history), records the use and saves. MCP, duplicate, copy-insert, starters and loading builds call other paths or `handleAddPart` directly, so they don't count.

The Recent pill is a pseudo-category `'Recent'` placed before `'All'` in the pill row, with its count taken from entries whose id is in `catalogMap`. When `activeCategory === 'Recent'`, the list source is the entries mapped through `catalogMap` (unknown ids dropped), then the same search test as `filteredCatalog`. The header's "shown / total" count uses that list. Since the order only changes inside `handleLibraryAdd`, it can't shift while the user is just looking.

### Outliner search and base name
App gets `outlinerQuery` state (not saved). A `useMemo` gives `shownInstances`: all instances when the query is blank, otherwise those whose `label`, catalog `name` or `partNumber` (via `catalogMap`) contain the trimmed, lower-cased query. The search box reuses the library's `.search-box` markup and styles, with its own clear button and `onKeyDown` for `Esc`. The title shows `(shown / total)` only when the query isn't blank. Clear All keeps clearing `instances`, not `shownInstances`.

The selected row renders a second `.instance-row-base` line with `name · partNumber`, or "Unknown part (partId)" when `catalogMap` has no entry. The Inspector body opens with the same line, placed before the Position group so it shows without advanced options. The Inspector's empty state isn't touched.

## Risks / Trade-offs

- [Larger thumbnail renders take a little more time and memory for 479 parts] → renders are still lazy and cached as WebP data URLs; check the first-screen load in both views during testing.
- [Clicking in the Recent view reorders the list under the pointer, so a second click can land on a different part] → accepted for this change: the order changing after an add is in the spec; note it for a follow-up if it bothers users (e.g. freeze the order until the user leaves Recent).
- [A search that hides the selected row may confuse] → the selection stays and the Inspector still shows the part; the title's count makes the filter visible.
- [`localStorage` blocked or full] → every read and write is wrapped; the app falls back to List and an empty Recent list.

## Migration Plan

Nothing to migrate: new `localStorage` keys start empty and builds are unchanged. Rolling back leaves two unused keys behind.
