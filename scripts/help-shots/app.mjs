/**
 * The driver for the help pictures (openspec in-app-help, design.md section 5): opens the static site
 * in the Chrome already installed (puppeteer-core, nothing downloaded) and works the app the way a
 * builder would: clicks by name, menus, keys, starters, loading a saved build from a file, selecting
 * parts in the Outline, drags in the 3D view. Used by scripts/capture-help-shots.mjs; a shot list's
 * `setup(app)` gets one of these.
 *
 * Every page opens with a new empty browser context, with the welcome card already seen.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { HELP_CONTROLS } from '../../src/help/controls.js';

export const LAYOUTS = {
  large: { width: 1280, height: 800 },
  medium: { width: 900, height: 1100 },
  small: { width: 390, height: 780 }
};

export const DEFAULT_URL = 'http://localhost:5174/vexiq-builder/';

const CHROME_PATHS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
];

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = CHROME_PATHS.find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chrome found: set CHROME_PATH to the Chrome or Chromium program.');
  return found;
}

/** Starts Chrome with a new empty profile; `close()` also deletes the profile. */
export async function launchBrowser({ headful = false } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'vexiq-help-shots-'));
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: !headful,
    userDataDir: profile,
    args: ['--no-first-run', '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars']
  });
  const close = async () => {
    await browser.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  };
  return { browser, close };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Opens the app in a new context at `layout` and returns the driver. `touch` emulates a touch screen
 * (for tablet and phone pictures). `hash` opens at an address such as `#help/gears`.
 */
export async function openApp(browser, { url = DEFAULT_URL, layout = 'large', touch, hash = '', welcomeSeen = true } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const size = LAYOUTS[layout];
  if (!size) throw new Error(`Unknown layout "${layout}" (large, medium or small)`);
  const hasTouch = touch ?? layout !== 'large';
  await page.setViewport({ ...size, deviceScaleFactor: 2, hasTouch });
  if (welcomeSeen) {
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('vexiq.help.welcomeSeen', '1');
      } catch {
        // no storage: the card shows, which a shot can avoid with setup
      }
    });
  }
  page.on('pageerror', (err) => console.warn(`  page error: ${err.message}`));
  await page.goto(url + hash, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('.topbar', { timeout: 30000 });
  const app = makeDriver(page, { layout, hasTouch });
  app.context = context;
  await app.waitForCatalog();
  return app;
}

function makeDriver(page, { layout, hasTouch }) {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'; // Ctrl+click is a right-click on a Mac

  /** The element handle for the first visible element matching the finder run in the page. */
  async function visibleHandle(finder, arg, what) {
    const handle = await page.evaluateHandle(finder, arg);
    const el = handle.asElement();
    if (!el) throw new Error(`Not on screen: ${what}`);
    return el;
  }

  const isVisibleSrc = `(el) => {
    if (!el || !el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom <= 0 || r.top >= innerHeight) return false; // off to the side: a toolbar that scrolls sideways
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }`;

  /** Finds an element by a spec string, in the page (the same specs `crop` and `marks` use). */
  const findInPage = ({ spec, controls, visibleSrc }) => {
    // eslint-disable-next-line no-new-func
    const visible = new Function(`return ${visibleSrc}`)();
    const all = (sel) => [...document.querySelectorAll(sel)].filter(visible);
    const named = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
    const [kind, ...rest] = spec.split(':');
    const value = rest.join(':');
    switch (kind) {
      case 'control': {
        let entry = controls[value];
        if (entry?.menu) entry = controls[entry.menu];
        if (!entry) return null;
        for (const sel of entry.find) {
          const el = all(sel)[0];
          if (el) return el;
        }
        return null;
      }
      case 'button':
        return all('button, [role="button"], [role="tab"], [role="checkbox"]').find((el) => named(el) === value || el.getAttribute('aria-label')?.startsWith(`${value}:`)) || null;
      case 'menuitem':
        return all('[role="menuitem"], [role="menuitemcheckbox"]').find((el) => named(el).startsWith(value)) || null;
      case 'menu':
        return all(`[role="menu"][aria-label="${value}"]`)[0] || null;
      case 'dialog':
        return all(`dialog[open], [role="dialog"]`).find((el) => (el.getAttribute('aria-label') || el.querySelector('[id]')?.textContent || '').includes(value)) || null;
      case 'text':
        return all('body *').find((el) => el.children.length === 0 && el.textContent.trim() === value) || null;
      case 'part':
        return all('.instance-list .instance-row-name').find((el) => el.getAttribute('title') === value)?.closest('.instance-row') || null;
      case 'css':
        return all(value)[0] || null;
      default: {
        const regions = {
          toolbar: '.topbar',
          view: '.viewport-container',
          library: '[data-help="library"]',
          outline: '[data-help="outline"]',
          properties: '[data-help="properties"]',
          'context-bar': '[data-help="context-bar"]',
          help: '.help-panel',
          'view-cube': '[data-help="view-cube"]'
        };
        return regions[spec] ? all(regions[spec])[0] || null : null;
      }
    }
  };

  const find = (spec) => visibleHandle(findInPage, { spec, controls: HELP_CONTROLS, visibleSrc: isVisibleSrc }, spec);

  /** The element's rectangle in CSS pixels of the window, or null when it isn't on screen. */
  async function rectOf(spec) {
    if (spec === 'window') return { x: 0, y: 0, width: LAYOUTS[layout].width, height: LAYOUTS[layout].height };
    const handle = await page.evaluateHandle(findInPage, { spec, controls: HELP_CONTROLS, visibleSrc: isVisibleSrc });
    const el = handle.asElement();
    if (!el) return null;
    return page.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }, el);
  }

  async function tapOrClick(handle, opts = {}) {
    // Scroll it into view (a phone's toolbar scrolls sideways), then press its middle
    const p = await handle.evaluate((el) => {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
      return { x, y };
    });
    if (hasTouch && !opts.modifiers?.length) await page.touchscreen.tap(p.x, p.y);
    else {
      for (const m of opts.modifiers || []) await page.keyboard.down(m);
      await page.mouse.click(p.x, p.y);
      for (const m of opts.modifiers || []) await page.keyboard.up(m);
    }
    await sleep(opts.wait ?? 150);
  }

  const app = {
    page,
    layout,
    hasTouch,
    sleep,
    find,
    rectOf,

    /** Waits until the part catalog has loaded (the library lists parts). */
    async waitForCatalog() {
      await page.waitForFunction(() => document.querySelector('.catalog-list')?.children.length > 1, { timeout: 60000 }).catch(() => {});
    },

    /** Clicks (taps, on a touch layout) the element a spec names: 'button:Tools', 'control:Tools', 'menuitem:Explode', 'css:…'. */
    async click(spec, opts) {
      const target = spec.includes(':') ? spec : `button:${spec}`;
      await tapOrClick(await find(target), opts);
    },

    /** Selects a control by its help name, the one pages write in [[…]] (src/help/controls.js). */
    async clickControl(name, opts) {
      await tapOrClick(await find(`control:${name}`), opts);
    },

    /** Opens a toolbar menu: 'Tools', 'Select', 'File', 'Snap', 'View'. */
    async openMenu(name) {
      const open = await page.$(`[role="menu"][aria-label="${name === 'View' ? 'View options' : name}"]`);
      if (!open) await app.clickControl(name);
      await page.waitForSelector(`[role="menu"]`, { timeout: 5000 });
    },

    /** Opens a menu and chooses an item in it, e.g. menu('Tools', 'Explode'). */
    async menu(name, item) {
      await app.openMenu(name);
      await app.click(`menuitem:${item}`, { wait: 300 });
    },

    /** Presses a key or a combination: 'x', 'Escape', 'Control+a', 'Shift+G'. */
    async press(keys) {
      const parts = keys.split('+');
      const key = parts.pop();
      for (const m of parts) await page.keyboard.down(m);
      await page.keyboard.press(key);
      for (const m of parts.reverse()) await page.keyboard.up(m);
      await sleep(150);
    },

    /** Types text into whatever has the focus. */
    async type(text) {
      await page.keyboard.type(text, { delay: 20 });
    },

    /** File → New. */
    async newBuild() {
      await app.menu('File', 'New');
      await app.waitStill();
    },

    /** File → Starter → name ('Sample starter', 'Speedbot 2.0', 'BaseBot', 'Clawbot', 'Flop'). */
    async starter(name) {
      await app.openMenu('File');
      await app.click('menuitem:Starter', { wait: 300 });
      await app.click(`menuitem:${name}`, { wait: 500 });
      await app.waitForParts();
      await app.waitStill();
    },

    /** File → Load… → Open from computer… with a saved build file (a path from the project root or absolute). */
    async loadBuild(file) {
      const full = path.resolve(file);
      if (!fs.existsSync(full)) throw new Error(`No build file ${full}`);
      await app.menu('File', 'Load…');
      await page.waitForSelector('dialog.library-dialog[open]', { timeout: 5000 });
      const input = await page.$('dialog.library-dialog input[type="file"]');
      if (!input) throw new Error('Load… has no file input');
      await input.uploadFile(full);
      await page.waitForFunction(() => !document.querySelector('dialog.library-dialog[open]'), { timeout: 10000 });
      await app.waitForParts();
      await app.waitStill();
    },

    /** Waits until the build has parts. */
    async waitForParts() {
      await page.waitForFunction(() => /\b[1-9]\d* parts?\b/.test(document.querySelector('.topbar')?.textContent || ''), { timeout: 30000 }).catch(() => {});
    },

    /** Shows the Outline in any layout (the tab on a tablet, the drawer on a phone). */
    async showOutline() {
      if (layout === 'medium') await app.click('css:[data-help="outline-tab"]');
      if (layout === 'small' && !(await page.$('.drawer-outline'))) await app.click('css:[data-help="outline-button"]');
    },

    /**
     * Selects parts by their names in the Outline: on a computer the first with a click and the others
     * with Cmd/Ctrl + click; on a tablet or phone with Select mode on (Add to selection on the context bar; the Outline gives way to
     * Properties after each tap, so it goes Back to the Outline in between).
     */
    async select(labels) {
      const list = Array.isArray(labels) ? labels : [labels];
      await app.showOutline();
      const compact = layout !== 'large';
      // Add to selection on the context bar turns Select mode on and off
      const selectMode = async () => tapOrClick(await find('css:[data-help="context-bar"] [data-tip="addToSelection"]'));
      if (compact && list.length > 1) await selectMode();
      for (const [i, label] of list.entries()) {
        if (compact) {
          const back = await page.$('.inspector-back');
          if (back && (await back.boundingBox())) await tapOrClick(back);
          await app.showOutline();
        }
        const row = await find(`part:${label}`);
        await tapOrClick(row, i === 0 || compact ? {} : { modifiers: [mod] });
      }
      if (compact && list.length > 1) await selectMode();
      await sleep(200);
    },

    /** Drags in the window from one point to another, in CSS pixels (a mouse drag, or one finger on touch layouts). */
    async drag(from, to, { steps = 12 } = {}) {
      if (hasTouch) {
        await page.touchscreen.touchStart(from.x, from.y);
        for (let i = 1; i <= steps; i += 1) await page.touchscreen.touchMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
        await page.touchscreen.touchEnd();
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps });
        await page.mouse.up();
      }
      await sleep(200);
    },

    /** Points inside the 3D view as fractions of it (0..1), in window pixels. */
    async viewPoint(fx, fy) {
      const r = await rectOf('view');
      return { x: r.x + r.width * fx, y: r.y + r.height * fy };
    },

    /** Moves the mouse over an element (for a tooltip); does nothing on touch layouts. */
    async hover(spec) {
      const el = await find(spec.includes(':') ? spec : `button:${spec}`);
      await el.hover();
      await sleep(400);
    },

    /** Opens the Help guide at a page (and section), the way a link does. */
    async openHelp(pageId = '', section = '') {
      await page.evaluate((h) => {
        window.location.hash = h;
      }, pageId ? `#help/${pageId}${section ? `/${section}` : ''}` : '#help');
      await page.waitForSelector('.help-root', { timeout: 15000 });
      await sleep(300);
    },

    /** Waits until no request has been pending for 500 ms, then until two pictures of the view in a row are the same. */
    async waitStill({ timeout = 20000 } = {}) {
      await page.waitForNetworkIdle({ idleTime: 500, timeout }).catch(() => {});
      const view = await rectOf('view');
      if (!view) return;
      const clip = { x: view.x, y: view.y, width: Math.max(1, view.width), height: Math.max(1, view.height) };
      const until = Date.now() + timeout;
      let last = null;
      while (Date.now() < until) {
        const shot = Buffer.from(await page.screenshot({ clip, type: 'png', captureBeyondViewport: false })).toString('base64');
        if (shot === last) return;
        last = shot;
        await sleep(250);
      }
    },

    async close() {
      await app.context?.close().catch(() => {});
    }
  };
  return app;
}
