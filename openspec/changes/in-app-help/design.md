## Context

See `proposal.md` for why. What shapes the approach:

- The app is one React page (`src/App.jsx`, about 4,500 lines) with a toolbar, a library panel, the 3D view (`.viewport-container`) and an Outline / Properties panel, inside `.app-shell[data-layout=large|medium|small]`. There is no router. `location.hash` is not used today.
- The static site (`npm run build:static`) copies only the names in `STATIC_PUBLIC_FILES` (`vite.config.js`) out of `public/`, and `scripts/offline-manifest.mjs` lists every file in the built folder for the offline download. So anything put in the built folder is offline automatically; anything in `public/` is left out unless it is on that list.
- The app already knows which input was used last (`lastInputRef` in `App.jsx`, `'mouse' | 'touch'`) and the layout size (`layoutSize`).
- The context bar's buttons are a data list (`BAR_IDS`, `WHEEL_IDS`, `barItems()` in `src/utils/contextToolbarItems.js`), and the starters are a list (`STARTERS` in `src/starters.js`). Menu items (File, Select, Tools) are written out in their components.
- Tests are plain Node scripts (`scripts/check-*.mjs`). There is no browser test tool in the project. Earlier changes checked on-screen behaviour with headless Chrome by hand.
- Ports: 5173 is the dev app (it shares one saved build file with every tab and the assistant), 5174 is the static preview. No other ports.
- Facts for the pages come from `features.md`, `AGENTS.md` ("How pieces are used") and `openspec/specs/*/spec.md`. They are written for developers and are partly out of date in small ways (for example `features.md` still says "478-Part" in one heading and 479 in the next), so the running app is the final word.

## Goals / Non-Goals

**Goals:**
- Help text that a writer can edit as plain Markdown files, one file per page, with no React knowledge.
- Zero cost when Help is never opened: none of its code, text or pictures load with the app.
- Pictures that can be retaken by one command after a UI change, with markers that stay on their controls.
- A check that catches a stale or incomplete guide without a browser.
- A build plan that splits code (main engineer) from words and pictures (main scribe), and lets several writers work at once without colliding.

**Non-Goals:**
- A general documentation system. The page format supports exactly what the pages need and nothing more.
- Automated browser tests of the guide. On-screen behaviour is checked by hand against the spec's scenarios, as in earlier changes, using the same Chrome driver the screenshot script uses.
- Rewriting `features.md`. It stays the developer's record; the guide is the builder's.

## Decisions

### 1. Help is a panel inside the app, not separate web pages
`src/help/HelpPanel.jsx` renders inside `.app-shell` as a right-hand panel in the large and medium layouts and a full-screen sheet in the small layout. In the large and medium layouts it takes its width from the layout (the 3D view shrinks; it is not drawn over the view), so the context bar and view cube stay clear without special cases. In the large layout it takes the place of the Outline / Properties column while open only if the window is under 1500 px wide; wider than that, it sits beside them. In the medium layout it takes the side panel's place (Library and Outline tabs) while open: at 900 px, keeping both would leave about 160 px of 3D view. Decided with the user on 2026-11-12: on tablets and phones Help may replace the working panel or screen.

*Why not separate HTML pages at `/help/…`:* a builder would have to switch tabs between reading and doing, which doesn't work in an installed app or on a phone, and "Show me" and the question marks on tool panels couldn't reach the live app. *Why not an iframe:* awkward scrolling and focus on iPad, and the same reach problem. Page links (`#help/<page>`) give each page an address anyway.

### 2. Pages are Markdown files, turned into HTML in the browser by `marked`
One file per page in `src/help/pages/<id>.md`, with a small header block:

```
---
title: Chain and track
group: mechanisms          # start | basics | mechanisms | check | devices | lookup | advanced
order: 4
summary: Wrap chain or tank track round sprockets.
icon: link                 # a lucide-react icon name
keywords: sprocket, tread, links, tank
devOnly: false             # true only for assistant.md
---
One sentence saying what it's for.

1. First step with **Tools → Chain builder** [[Tools]] (1).
   ![The Tools menu open with Chain builder marked](shot:chain-tools-menu)
2. {{Double-click the sprocket | Tap **Join**, then the sprocket}}.

<!-- more -->

## If the chain sags
…
```

The few extras, all handled by `src/help/renderPage.js` before or after `marked`:

| Written | Shown as |
|---|---|
| `<!-- more -->` | everything above is the top part; each `##` section below is a closed More section. Section ids come from the heading text (`if-the-chain-sags`) |
| `{{mouse wording \| touch wording}}` | one of the two, by the Mouse / Touch switch |
| `` `W` `` (inline code) | a key cap. The pages contain no code, so inline code always means a key |
| `[[Tools]]`, `[[Tools → Explode]]` | a Show me chip; the name must be in `src/help/controls.js` |
| `![description](shot:name)` | the picture `help/shots/name.webp` with its markers from `shots.json` |
| `[text](help:page-id#section)` | a link inside the guide |
| `> **Tip** …`, `> **Watch out** …` | a tip or warning box |
| `(1)`, `(2)` in a step followed by a picture | the marker number, drawn as the same round badge as on the picture |

`renderPage.js` exports a pure `parsePage(text)` → `{ meta, top, sections, shots, links, controls, words }` that both the panel and `scripts/check-help.mjs` use, so the check and the app can't disagree about what a page contains.

*Why Markdown and not JSX pages:* the pages are 90 % of the work and will be edited far more often than the panel; writers (and writing subagents) shouldn't need to touch React, and the check can read the same files in Node. *Why `marked`:* small (about 40 KB), no dependencies, runs in the browser and in Node. Pages are our own files, so its HTML output is trusted. *Why not convert at build time:* the dev app would need the same plugin and the gain (40 KB in a chunk that loads only with Help) is small.

### 3. One lazy chunk for all of Help
`App.jsx` holds only: the Help button, the `?` key, the welcome card (a few lines of markup), the hash listener, and `const HelpPanel = lazy(() => import('./help/HelpPanel.jsx'))`. The chunk holds the panel, `marked`, every page's text (`import.meta.glob('./pages/*.md', { query: '?raw', eager: true })` inside the chunk), the search index and `shots.json`. All pages together are expected to be under 200 KB of text, so one chunk is simpler than one request per page and makes search instant. Pictures are plain `<img loading="lazy">` with `width` and `height` from `shots.json`, so the layout doesn't jump.

### 4. Search is a small index built when the chunk loads
`src/help/search.js`: for each page and each section, the title, keywords and plain text, lower-cased and split into words. A query matches by word prefix; score = title hit 100, section title or keyword 30, text 1 per hit, all query words must match. No library. Built once on first use (a few milliseconds for 32 pages).

### 5. Pictures: a shot list and `puppeteer-core`
- `scripts/help-shots/shots.mjs` exports the shot list. Each shot:
  ```js
  { name: 'chain-tools-menu', layout: 'large',            // large 1280×800, medium 900×1100, small 390×780
    build: 'starter:flop',                               // or 'empty', or 'file:scripts/help-shots/builds/two-beams.vexiq.json'
    async setup(app) { await app.select(['Sprocket A', 'Sprocket B']); await app.openMenu('Tools'); },
    crop: ['toolbar', 'menu:Tools'],                     // named regions or selectors; union plus 16 px; 'window' for the lot
    marks: ['button:Tools', 'menuitem:Chain builder'] }  // marker 1, 2, … in this order
  ```
- `scripts/capture-help-shots.mjs [name…] [--url http://localhost:5174/vexiq-builder/]` opens the static preview in the installed Chrome (path from `CHROME_PATH`, else the usual places on macOS, Windows and Linux) with a new empty profile per run, device scale 2, sets the layout's window size, loads the build, runs `setup`, waits until the view is still, then saves `public/help/shots/<name>.webp` (Chrome's own WebP output, quality about 80, clipped to the crop) and writes that shot's entry in `public/help/shots/shots.json`: `{ w, h, marks: [{ n, x, y }] }` with `x`, `y` as fractions of the picture, taken from each marked element's rectangle at capture time.
- The `app` helper (`scripts/help-shots/app.mjs`) drives the app the way a builder would: clicks by accessible name, key presses, drags in the view, File → Starter, File → Load… → Open from computer… for example builds. It also sets the "welcome card seen" flag before the page loads.
- **Waiting until the view is still:** the script waits for no pending requests for 500 ms, then for two identical consecutive screenshots of the view region. No hook is added to the app for this.
- Markers are drawn by the page (absolutely placed badges over the image), not burned into the picture, so pictures stay clean and badges stay crisp at any size.
- `help` joins `STATIC_PUBLIC_FILES` in `vite.config.js`, which puts the pictures in the static site and so in the offline list.

*Why the static preview and not the dev app:* the dev app shares one saved build with the user's open tabs and the assistant, so driving it would overwrite the user's build. The static site keeps builds in the browser profile, and the script's profile is new every run. It is also the site the readers use. The preview must be rebuilt first (`VEXIQ_BASE=/vexiq-builder/ npm run build:static`); the script checks that the preview's offline file list is no older than the newest file in `src/` and stops with that command if it is.

*Why `puppeteer-core`:* it uses the Chrome already installed and downloads nothing; it is a dev dependency only. Playwright would download its own browsers (hundreds of MB). The MCP server's `capture_screenshot` only returns the 3D view, not the toolbar, menus and panels the pictures mostly need.

*Why pictures are committed:* they are part of the site, and building the site must not need Chrome.

### 6. Show me uses a table of controls
`src/help/controls.js` maps each name a page may put in `[[…]]` to how to find it: a CSS selector (new `data-help="tools"` attributes on the toolbar buttons, panels, the view cube and the context bar's buttons; the bar's buttons already have ids from `BAR_IDS`), the control that opens it when it is inside a menu, and the one-line "what makes it appear" text for when it isn't on screen. Flashing adds a CSS class to the element for two seconds (an outline that pulses; no layout change). Menu items are never opened by the guide: the chip flashes the menu's button. The check verifies every `[[name]]` is in the table; it can't verify the selector matches, so task 7.3 selects every chip once in the app.

### 7. Page links and Back
`src/help/useHelpRoute.js`: reads `location.hash` on load and on `hashchange`; `#help` is home, `#help/<page>` a page, `#help/<page>/<section>` a section. Going to a page inside the guide does `history.pushState` (so Back steps through pages); closing the guide goes back to the entry before the first help entry when the guide was opened in this visit, or replaces the hash with nothing when the app was opened by a help link. Nothing else in the app reads the hash, and the service worker ignores it.

### 8. Remembered in this browser (localStorage, like the other per-browser choices)
`vexiq.help.welcomeSeen` (`1`), `vexiq.help.input` (`mouse` | `touch`, only once the reader uses the switch). The last page and scroll are kept in memory for the visit only. Nothing is saved with a build, and nothing here is a history step.

### 9. `Esc` and focus
The guide closes on `Esc` only when the event wasn't used by something above it (a dialog, a menu, a picked ring, mate arrows, Explode, Play mode: the app's existing `Esc` order runs first when focus is in the 3D view). Rule: `Esc` closes the guide when keyboard focus is inside the guide; from the 3D view `Esc` keeps its present meaning. The enlarged picture takes `Esc` first.

### 10. The coverage list
`src/help/coverage.json`: `[{ "feature": "Tools → Explode", "kind": "menu", "page": "explode", "section": "" , "name": "Explode" }, …]` (`section` empty means the top part). Written by hand from `features.md`, the specs and a walk through every menu, panel and dialog in the app. The check adds entries it can read from code: every id in `BAR_IDS` / `WHEEL_IDS` (by its label from `barItems`) must be named on the `context-bar` page, and every `STARTERS` name on the `saving` page.

### 12. Help in context: topic tags, situation claims and one pure function
- **Two lists in code**, `src/help/tags.js`: `TOPIC_TAGS` (plain words, shared freely between pages) and `SITUATIONS = [{ id: 'band-builder', reason: "you're stringing a rubber band" }, …]`. A situation is only something `helpContext` can return; descriptive words (touch, zoom, mirror, view-cube, shortcut) are topic tags only. The check reads both lists.
- **On pages:** the header has `tags:` (topic tags, 3–10) and `answers:` (situation claims, any number, exclusive across pages). A section claims with `<!-- answers: a, b -->` on the line after its `##` heading; `parsePage` reads it and leaves it out of the text, word counts and search. (Round two wrote exclusive labels under `tags:`; they were renamed to `answers:` on 2026-11-12, and `nothing-selected`, `sensor` and `pneumatic` were dropped, since Help must open home with nothing selected and no page explains sensors or pneumatics.)
- **What the builder is doing** is one pure function, `helpContext(snapshot)` in `src/help/context.js`, returning situations most specific first, in the four tiers of the spec. `App.jsx` builds the snapshot when Help opens, from state it already has: open panels and dialogs, `interaction` (hole picking, placing, fits), `pointerTool` (`target`, `stamp`), the context bar's switches and the Turn step menu, `transformMode` (only Rotate counts: Move is the default and is never returned), the view layout, and the selected parts' catalog entries. Part kinds come from a name and category table in the same file (`partKindTag(part)`), so new parts fall into place by name.
- **Picking the place** is `helpTarget(pages, situations)` in `src/help/content.js`: the first situation with a claimant wins; its section claimant wins over its page claimant. Both functions are tested in Node with no browser.
- *Why claims and not a hand-written table from app state to page:* a table in app code goes stale as pages are split or renamed; claims live with the words, and the check proves every situation still has a page. *Why two kinds of label:* exclusive claims can't also find related pages (no two pages would share one), and descriptive tags can't route (many pages would claim them). *Why a snapshot on open:* nothing changes in the app while the guide is closed.

### 11. Who builds what
Two leads, each with its own helpers (`.claude/agents/`). The session that applies the change starts them in this order.

| Who | Owns | Helpers |
|---|---|---|
| `main-engineer` (Opus) | Everything that is code: the page format and `parsePage`, the check script, the panel, page links, Show me and `controls.js`, the question marks, the welcome card, the screenshot script and its driver, the example builds, the static build, and the wrap-up (task groups 1–4 and 8) | `tester`, `coder` |
| `main-scribe` (Opus) | Everything that is words and pictures: the writer's brief, every page in `src/help/pages/`, the shot lists, `coverage.json`, and the read-through of every page against the app (task groups 5–7) | `scribe-assistant` |

1. **Main engineer first (groups 1–4).** The format, check, panel and screenshot script must exist before a page can be written, checked or pictured. It proves them with two short fixture pages, not real ones.
2. **Main scribe next (groups 5–7).** It starts with `quick-start` end to end and the writer's brief (`src/help/WRITING.md`), which fixes the style before anyone writes at volume. It then writes the complicated pages itself and hands simple pages and fact gathering to `scribe-assistant`, several at once, as its own brief describes. It writes the summary pages (shortcuts, words, troubleshooting) last.
3. **What the scribe may and may not touch.** It writes `src/help/pages/*.md`, `src/help/WRITING.md`, `src/help/coverage.json`, and the shot lists `scripts/help-shots/shots-<group>.mjs`. It runs the capture and the check. It does not change application code, the panel, the check script or `controls.js`. When a page needs something from the app (a control that Show me can't point at, a driver helper the shot list lacks, a rule in the check that is wrong, a bug found while following a step), it stops on that page, lists what it needs, and carries on with others.
4. **Main engineer, on the scribe's list.** After group 6 (and sooner if the scribe is blocked), the engineer works through what the scribe asked for, and the scribe finishes the pages that were waiting.
5. **Main engineer last (group 8):** offline check, `features.md`, `AGENTS.md`, `README.md`, all checks and builds.

Assistants each write only the page files and the shot-list file named in their brief, and return the `controls.js` and `coverage.json` entries they need instead of editing those files, so writers working at once don't collide. The scribe and its assistants use the static preview on 5174, never the dev app, so they don't touch the user's build. The `scribe-assistant` has no way to drive a browser; it lists the steps it couldn't try and the scribe tries them.

## Risks / Trade-offs

- **[Headless Chrome may draw the 3D view slowly or differently (software rendering)]** → earlier changes ran the app in headless Chrome, so it works; the script waits for a still picture instead of a fixed time. If shadows or reflections look wrong in software rendering, run Chrome with its window shown (`--headful` flag on the script) on the developer's machine. Pictures are committed, so this only matters when retaking.
- **[The guide goes stale as the app changes]** → the check covers structure, links, pictures, lengths, banned words, context bar buttons and starters. It can't tell that a sentence is wrong. The `AGENTS.md` habit and retakeable pictures are the mitigation; a picture that changes when retaken is the visible sign a page needs a read.
- **[Thirty-two pages by several writers read unevenly]** → one example page first, hard length limits in the check, one fixed word list, and the main scribe reads every page.
- **[Writers describe what `features.md` says, not what the app does]** → the rule that every step is tried in the static preview first, and the final truth pass in both wordings.
- **[The panel squeezes the 3D view on small laptops]** → under 1500 px it replaces the Outline / Properties column instead of adding a column, so the 3D view keeps its width. Check at 1180 px (the smallest large layout).
- **[8 MB more to download for offline use]** → hard limits in the check (150 KB a picture, 8 MB total); WebP at 2× cropped tight is typically 40–90 KB.
- **[Show me selectors break silently when markup changes]** → `data-help` attributes are added for the purpose (not tied to class names), and the capture script's `marks` use the same table, so a broken entry fails the next capture loudly.
- **[`?` key clashes]** → `?` is Shift + `/`; no current shortcut uses `/`. Ignored while a text field has focus.
- **[A welcome card on first open annoys teachers setting up many devices]** → it is small, blocks nothing, and one tap removes it for good.

## Open Questions

- Whether the three starters' pictures on the Saving page should be the build library's own thumbnails or fresh shots. Either meets the spec; decide when the page is written.
- The exact picture of the Start here card (the Sample starter or two joined beams). Decide with the quick start page.
