/**
 * Pictures for the Settings and Use it without internet pages. Written by a scribe assistant.
 */
const OFFLINE = 'css:dialog[open] .offline-section';

async function openSettings(app) {
  await app.clickControl('Settings');
  await app.sleep(500);
}

/** Scrolls the Settings window to its Offline section. */
async function showOffline(app) {
  await openSettings(app);
  await app.page.evaluate(() => document.querySelector('dialog[open] .offline-section')?.scrollIntoView({ block: 'center' }));
  await app.sleep(300);
}

async function clickOfflineSwitch(app) {
  const sw = await app.find('css:dialog[open] .offline-section input[role="switch"]');
  await sw.click();
  await app.sleep(1500);
}

export default [
  { name: 'settings-gear', layout: 'large', build: 'empty', crop: ['toolbar'], marks: ['control:Settings'] },
  { name: 'settings-display', layout: 'large', build: 'empty', async setup(app) { await openSettings(app); }, crop: ['dialog:Settings'], marks: ['text:Shadows'] },
  { name: 'settings-close', layout: 'large', build: 'empty', async setup(app) { await openSettings(app); }, crop: ['css:dialog[open] .settings-header'], marks: ['button:Close settings'] },
  {
    name: 'offline-switch', layout: 'large', build: 'empty',
    async setup(app) { await showOffline(app); },
    crop: [OFFLINE], marks: ['css:dialog[open] .offline-section input[role="switch"]']
  },
  {
    name: 'offline-size', layout: 'large', build: 'empty',
    async setup(app) { await showOffline(app); await clickOfflineSwitch(app); },
    crop: [OFFLINE], marks: ['button:Download']
  },
  {
    // Slowed down so the bar is caught part way
    name: 'offline-progress', layout: 'large', build: 'empty',
    async setup(app) {
      await showOffline(app);
      await clickOfflineSwitch(app);
      const cdp = await app.page.createCDPSession();
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: 1_000_000, uploadThroughput: 1_000_000 });
      await app.click('button:Download');
      await app.sleep(5000);
    },
    crop: [OFFLINE], marks: ['button:Cancel']
  },
  {
    name: 'offline-done', layout: 'large', build: 'empty',
    async setup(app) {
      await showOffline(app);
      await clickOfflineSwitch(app);
      await app.click('button:Download');
      await app.page.waitForFunction(() => /Available offline/.test(document.querySelector('dialog[open] .offline-section')?.innerText || ''), { timeout: 180000 });
      await app.sleep(500);
    },
    crop: ['css:dialog[open] .offline-status'], marks: ['css:dialog[open] .offline-ok']
  }
];
