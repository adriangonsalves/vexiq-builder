## Why

The app can do a lot (snap parts onto holes, mesh gears, run chain, string rubber bands, explode a build, run it in Play mode), but nothing inside it teaches any of this. The only write-ups are `features.md` and `AGENTS.md`, which are written for developers and are not part of the site. A middle schooler who opens the app sees a part library and an empty 3D view and has to guess the rest. The context bar and its tips help once you know what you want; they don't tell you where to start or what is possible.

## What Changes

- **A Help guide inside the app.** A **Help** button (a question mark) in the toolbar, and the `?` key, open a guide in a panel beside the 3D view, so a builder can read a step and do it without leaving the build. On a phone it fills the screen with a clear way back.
- **Quick start first.** The guide opens on a home page with one big **Start here** card: a quick start that gets a first build together in about five minutes (add a part, look around, join two parts, undo, save). Below it are topic cards in a few groups.
- **Short on top, full detail underneath.** Every page starts with one line on what the feature is for, then a few short numbered steps with pictures. Everything else (every option, every shortcut, what to do when it goes wrong) sits in closed **More** sections under the steps. Read only the top and you can use the feature; open the sections and nothing about the feature is left out.
- **Every feature covered.** About 30 pages cover everything a builder can do in the app: the library, the 3D view and camera, moving and turning, joining parts, the context bar, selecting and groups, copying and mirroring, gears and shafts, chain and track, plastic sheets, rubber bands, wheels and motors (how real pieces go together), Explode, Audit, Blueprint, Play mode and the drop test, undo and the timeline, saving and exporting, settings, offline use, tablets and phones, all shortcuts, a word list, and a troubleshooting page. The page list is in `specs/help-content/spec.md`.
- **Lots of pictures.** Screenshots of the real app with numbered markers on the controls a step talks about. They are taken by a script, so they can be retaken when the app changes. Tapping a picture shows it full size.
- **Mouse or touch wording.** Steps that differ by input show the mouse and keyboard way or the touch way, following the device, with one switch to swap.
- **Search.** A search box finds pages and sections by word, with no internet needed.
- **Show me.** A control named in a step (for example **Tools**) can be tapped to flash the real button on screen.
- **Help opens on what you're doing.** Pages and sections carry hidden tags (tools, modes, context bar buttons, kinds of part). The Help button reads what the builder is doing (a tool or panel open, picking a hole, an armed context bar button, the kind of part selected) and opens the page or section that fits, with one line saying why. Tags also list related pages at the end of each page.
- **Help where you are.** The tool panels and dialogs (Explode, Play mode, Band builder, Chain and Track, Bend sheet, Audit, History, Settings → Offline) get a small question mark that opens the guide at that tool's page.
- **A one-time welcome.** The first time the app opens in a browser, a small card offers the quick start (**Start** / **Not now**). It never comes back after either choice.
- **Links to a page.** Each help page has its own link (`#help/<page>`), so a teacher can send one, and the browser's Back button steps back through help pages and then closes the guide.
- **Works with no server and no internet.** The guide's text and pictures are part of the static site and of the offline download.
- **Kept true.** A check script fails when a page links to something missing, a picture is missing or unused, a page runs too long, or a feature on the coverage list has no page.

## Out of scope

- Videos and animations (still pictures only).
- Languages other than English.
- A step-by-step tutor that watches what the builder does and moves on by itself.
- Printing or a PDF of the guide.
- Help for developer tools: the CAD import scripts, part conversion and the MCP tool list stay in `AGENTS.md` and `features.md`. The guide has one short page on the assistant, shown only in the dev app where the assistant exists.
- Changing how any building feature works. The only new controls are the Help button, the small question marks, and the welcome card.

## Capabilities

### New Capabilities
- `help-guide`: the Help guide as a part of the app: how it opens and closes, its place in each layout, the home page, page layout with closed More sections, pictures with markers, mouse or touch wording, search, Show me, question marks on tool panels, the welcome card, page links, and working offline.
- `help-content`: what the guide must say: the list of pages and what each one covers, the writing rules for middle schoolers, the picture rules, and the checks that keep pages complete and current.

### Modified Capabilities
- `app-settings`: the Compact toolbar requirement gains a Help button next to the Settings gear.
- `static-site`: the Static build requirement gains the help guide's pictures among the files the static site holds.

## Impact

- **New code:** `src/help/` (the guide's panel, page renderer, search, control table, pages as Markdown files), `public/help/shots/` (pictures and their marker data), `scripts/capture-help-shots.mjs` with its shot list, `scripts/check-help.mjs`.
- **Changed code:** `src/App.jsx` (Help button, `?` key, welcome card, page links, layout wiring), the tool panels and dialogs listed above (a question mark each), `src/styles.css`, `vite.config.js` (`help` added to the static site's files).
- **Dependencies:** `marked` (turns the Markdown pages into HTML; loaded only when Help opens) and `puppeteer-core` as a dev dependency for the screenshot script (it drives the Chrome already on the machine; nothing is downloaded and it is not part of the site).
- **Size:** the guide's pictures add at most 8 MB to the static site and the offline download (about 94 MB today). `README.md` and any text that states the download size get the new number.
- **Docs:** `features.md` gains a Help section; `AGENTS.md` gains a working habit (update the help page and retake its pictures when a feature changes). Nothing is server side.
