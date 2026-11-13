# Writer's brief for the Help guide

You write pages for kids in middle school who build VEX IQ robots, often on a tablet or phone, sometimes with no internet. They want to get going fast and look up details only when stuck. Read `src/help/pages/quick-start.md` first. It follows every rule below. Copy its shape.

## Where things are

- Pages: `src/help/pages/<id>.md`. The ids, groups and order are in `src/help/pageList.js`. Don't change that file.
- Pictures: `public/help/shots/<name>.webp`, made only by `node scripts/capture-help-shots.mjs [name...]`. Never edit a picture or `shots.json` by hand.
- Shot lists: `scripts/help-shots/shots-<group>.mjs`, each a default-exported array. Add your own file only if your brief says so, and add one line for it to `scripts/help-shots/shots.mjs` only if your brief says so.
- Names for Show me chips: `src/help/controls.js`. Don't edit it.

## Page format

```
---
title: Joining parts
group: basics          # start | basics | mechanisms | check | devices | lookup | advanced
order: 4               # the number from pageList.js
summary: One line for the home page card.
icon: link             # a name from src/help/icons.js
keywords: words, a, kid, might, type
devOnly: false
---
One sentence saying what this is for.

1. One action, with the exact name of the control in bold [[Tools]] (1).
   ![Plain description of the picture](shot:name)
2. {{Mouse wording | Touch wording}}.

> **Tip** One sentence.

<!-- more -->

## A title that says what is inside
Closed section text.
```

| Written | Shown as |
|---|---|
| `<!-- more -->` | above it is the top part; each `##` below it is a closed More section |
| `{{mouse wording \| touch wording}}` | one of the two, by the Mouse / Touch switch |
| `` `W` `` | a key cap (inline code is always a key; keys go in the mouse half) |
| `[[Tools]]`, `[[Tools → Explode]]` | a Show me chip; the name must be in `controls.js` |
| `![description](shot:name)` | the picture, with its numbered markers |
| `[text](help:page-id#section)` | a link inside the guide |
| `> **Tip** …` / `> **Watch out** …` | a tip or warning box, one sentence |
| `(1)`, `(2)` in a step | the marker number; the picture after that step must have that many markers |

## Rules (the check enforces most of them)

- Say what to do, in the order it is done. One action to a step. At most 6 steps.
- Opening sentence: 20 words or fewer. Every sentence: 25 or fewer, 15 on average. Top part (opening and steps): 120 words or fewer. A More section: 200 words or fewer; split longer ones. Each More title says what is inside ("Every button on the bar"), never "Details".
- Use the words the app shows for buttons and menus, in bold: **Tools → Explode**. Keys as key caps.
- One name per thing: "3D view", "Library", "Outline", "Properties", "context bar", "view cube", "pitch", "shaft" (say once that "axle" is the same).
- Banned: file names, code, part ids, "instance", "port", "mesh" for a 3D model, "viewport", "kinematic", "semantic", "MCP". Other special words must be in the Words page, so keep them few.
- Numbers only when the reader needs them. No tolerances outside More sections.
- At most two Tips or Watch outs in the top part.
- Say plainly what the app can't do yet and give the way round. Never write a step you haven't checked.
- Don't pad. If a sentence can go, cut it.
- On a tablet, Help takes the place of the Library and Outline while it is open; they come back when Help closes. On a phone Help fills the screen. A step that needs the Library says to close Help.
- Every page has a picture in its top part. Every step that names a control the reader hasn't met on that page has a picture with a marker on it.

## Adding a picture

Add a shot to your shot-list file:

```js
{ name: 'moving-snap-menu', layout: 'large',          // large | medium | small
  build: 'fresh',     // or 'empty', 'starter:Flop', 'file:scripts/help-shots/builds/two-beams-pin.vexiq.json'
  async setup(app) { await app.openMenu('Snap'); },
  crop: ['toolbar', 'menu:Snap'],                      // regions kept, plus 16 px round them
  marks: ['control:Snap', 'menuitem:0.5P'] }           // marker 1, 2, ... in this order
```

Specs for `crop` and `marks`: `control:<name from controls.js>`, `button:<name>`, `menuitem:<text>`, `menu:<name>`, `dialog:<title>`, `part:<Outline name>`, `text:<exact text>`, `css:<selector>`, or a region (`toolbar`, `view`, `library`, `outline`, `properties`, `context-bar`, `help`, `view-cube`, `window`). A mark sits at the middle of the control's right edge; end it with `@center`, `@left`, `@top` or `@bottom` to move it.

Driver helpers in `scripts/help-shots/app.mjs`: `click`, `clickControl`, `openMenu`, `menu(name, item)`, `press`, `type`, `newBuild`, `starter(name)`, `loadBuild(file)`, `select([labels])`, `showOutline`, `drag`, `viewPoint`, `hover`, `openHelp`, `waitStill`, `find`, `rectOf`, and `page` (puppeteer).

Crop tight, show only what the step is about, use the large layout unless the step is about touch, tablets or phones. A picture must be 150 KB or less.

Take pictures: rebuild the preview first (`VEXIQ_BASE=/vexiq-builder/ npm run build:static`), then `node scripts/capture-help-shots.mjs <name> ...`. Rebuild again after a capture so the guide shows the new pictures.

## Checking a page

`node scripts/check-help.mjs --only <page-id>`. It must exit 0. A run without `--only` fails on pages that aren't written yet; that is expected.

## What to return

- The page file, and the shot list entries.
- Steps you could not try in the app.
- Control names the page needed that are not in `controls.js`.
- Features the page covers, as `page, section, name` lines for the coverage list (do not create `coverage.json`).
- Anything in the app that didn't match the sources, or looked like a bug.
