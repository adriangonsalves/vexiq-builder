## Why

The static site (openspec static-site) runs everything in the browser, but nothing keeps its files on the device. With no connection a reload shows nothing, and a part model the visitor hasn't used yet won't load. Builders often want it where the internet is poor or missing: classrooms, competitions, on an iPad in the car. They should be able to make it work offline on purpose, know when it does, and be told when an update means they need to download again.

## What Changes

- Add an **Offline** section to Settings, on the static site only. One switch, **Use offline**, off by default. Turning it on:
  - says how much space it needs (about 90 MB) and how much the browser has free;
  - asks the browser to keep the site's data (persistent storage);
  - downloads the app, the part catalog, part metadata and all 482 part models, with a progress bar, a Cancel button and resume after a stopped download;
  - when everything is saved, shows **Available offline** and walks the user through installing the app for their device: Add to Home Screen on iPad/iPhone, the Install button in Chrome and Edge, and a note for browsers that can't install;
  - reminds them that builds live only in this browser and that **Export** is their backup.
- Turning the switch off deletes the downloaded files and stops offline use. Builds and settings are not touched.
- Show an **Available offline** label in the toolbar next to the part count while the downloaded copy is complete and current. Tapping it opens the Offline section.
- **New versions:** whenever the app is online (opening, coming back online, returning to the tab), it checks whether a newer version has been published. If one has:
  - the Available offline label goes away;
  - a message says a new version is out and asks the user to download it again;
  - the app keeps running the downloaded version until the new one is fully downloaded, then reloads into it. Only files that changed are fetched again.
- Add a **web app manifest and icons**, so the site can be installed and opens full screen in its own window.
- Add a **service worker** that serves the downloaded copy when Use offline is on. It is only registered while the switch is on.
- The dev app (`npm run dev`) and the MCP server are unchanged. The Offline section doesn't appear there. The assistant (MCP) doesn't work offline and isn't part of the static site anyway.

## Capabilities

### New Capabilities
- `offline-app`: the Settings switch, downloading and keeping the site's files, the Available offline label, install guidance per device, persistent storage and backup reminder, new-version detection with the request to download again, turning offline off, and the manifest and icons that make the site installable.

### Modified Capabilities
<!-- None. As with static-site, the static site's extra Settings section and toolbar label are
     described in offline-app; app-settings and the dev app stay as they are. -->

## Impact

- **Code:**
  - new `src/offline/`: the download and version logic, install-guide helpers, and the service worker source;
  - `src/components/SettingsPanel.jsx`: the Offline section;
  - `src/App.jsx`: the toolbar label, the new-version message and wiring;
  - `vite.config.js`: in static mode, write `offline-manifest.json` (version plus each file's path, size and content hash), emit the service worker and web app manifest at the site root, and copy the icons;
  - `index.html`: manifest link, theme colour and Apple touch icon (static build only).
- **Build:** `dist-static/` gains `sw.js`, `offline-manifest.json`, `manifest.webmanifest` and icons. Site size barely changes.
- **Hosting:** needs HTTPS, which GitHub Pages already provides. No workflow changes.
- **Dependencies:** none added. The service worker is hand-written (see design).
- **Checks:** a new `scripts/check-offline-manifest.mjs` checks the built file list against `dist-static/`.
- **Out of scope:** making the assistant work offline, syncing builds between devices or between Safari and an iPad Home Screen app, compressing models, and the touch and tablet layout work (a separate change).
