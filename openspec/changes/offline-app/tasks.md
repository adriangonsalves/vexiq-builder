## 1. Build output

- [x] 1.1 Add a static-mode plugin step that, after the public files are copied, writes `dist-static/offline-manifest.json` (`version` and `files: [{ path, size, hash }]`, paths relative to the base; leaving out `sw.js`, the manifest itself and source maps). Verify: `npm run build:static`, then the manifest lists every file in `dist-static/` except those, and the total is about 90 MB.
- [x] 1.2 Add `scripts/check-offline-manifest.mjs`. It reads `dist-static/offline-manifest.json` and checks that every listed file exists with the right size and hash, that no file is missing from the list, and that two builds with no source change get the same `version`. Verify: it exits 0 after a build, and exits 1 after deleting one model from `dist-static/models/`.
- [x] 1.3 Make the brand-badge SVG and the PNG icons (192, 512, maskable 512, Apple 180) in `src/offline/icons/`. Copy them into `dist-static/icons/` in static mode. Verify: the files are in the build and the maskable icon looks right in a maskable preview tool.
- [x] 1.4 In static mode, emit `manifest.webmanifest` (name "VEX IQ Builder", short name "VEX IQ", `start_url`/`scope` at the base, `display: standalone`, colours `#111827`, the icons). Add the manifest link, theme colour, Apple touch icon and `apple-mobile-web-app-capable` to `index.html` through `transformIndexHtml`. Verify: Chrome DevTools → Application → Manifest shows no errors and is installable. `npm run dev`'s page has none of these tags.

## 2. Service worker

- [x] 2.1 Write `src/offline/sw.js` and emit it as `sw.js` at the site root in static mode. Behaviour:
  - answer same-origin GETs in scope from the current `vexiq-offline-<version>` cache;
  - answer page loads with the cached `index.html`;
  - let `offline-manifest.json`, the downloader's marked requests and anything not cached go to the network;
  - on `activate-version`, switch caches and delete older `vexiq-offline-*` caches;
  - switch site versions only on `activate-version`. A newer `sw.js` does take over at once (`skipWaiting`), since it serves the same version.

  Verify: with a complete cache and DevTools set to Offline, reloading `/vexiq-builder/` opens the app, and a part never used before can be added.
- [x] 2.2 Register the worker only after a complete download, and unregister it when Use offline is turned off. Verify: on a fresh profile, DevTools → Application shows no service worker until the download finishes, and none after turning the switch off.

## 3. Download and state

- [x] 3.1 Add `src/offline/download.js`. It does the space check (`navigator.storage.estimate`, total plus 10%), then downloads only the files missing from the cache, four at a time, checking sizes and trying a failed file up to 3 times. It reports progress in bytes, stops on Cancel, offline or `QuotaExceededError` with a reason, and writes `__complete__` with the manifest. It holds a `navigator.locks` lock so only one tab downloads. Verify: switching the connection off at about 40% stops the download with "connection lost", and Resume starts from about 40%.
- [x] 3.2 Add `src/offline/state.js`. It works out the state (not downloaded, downloading, available, update needed, stopped) from the caches plus the localStorage record (stop reason, time of last download), including "the browser removed the offline copy" when the record says downloaded but the cache is gone. Verify: deleting the cache by hand in DevTools gives that stopped state on reload.
- [ ] 3.3 Request persistent storage when Download is confirmed, and read `navigator.storage.persisted()` on start-up. Verify: the Offline section shows the browser's answer in Chrome (usually granted once installed) and in Safari.

## 4. Settings and toolbar

- [x] 4.1 Add the Offline section to `SettingsPanel.jsx`, shown only on the static site (gated like `hasAssistant`). It has:
  - the Use offline switch, the state line and the space check with Download/Cancel;
  - the progress bar showing "N of M MB" with Cancel, and Resume;
  - the persistent-storage line, the Export reminder and the Install the app link;
  - turning off asks first, then deletes the caches and leaves builds alone.

  Verify: walk through on/download/cancel/resume/off in the static build. File → Load… still lists every build after turning off. The dev app's Settings has no Offline section.
- [x] 4.2 Add the **Available offline** label next to the part count, shown only in the "available" state. Selecting it opens Settings at the Offline section. Verify: it appears when the download completes, isn't shown while downloading or stopped, and opens Settings when selected.

## 5. Install guidance

- [x] 5.1 Add `src/offline/install.js`. It catches and keeps `beforeinstallprompt` from start-up, and detects `installed`, `prompt`, `ios-safari` (including iPads that report as a Mac), `mac-safari` and `other`. Verify: Chrome desktop gives `prompt`, Chrome after installing gives `installed`, and an iPad Safari user agent with touch gives `ios-safari`.
- [ ] 5.2 Show the install guide when the download finishes and from the Install the app link: the Install app button, the iOS Share → Add to Home Screen steps with the Share icon, Mac Safari's File → Add to Dock, the "can't install here" note, or "installed". Verify: each case in Chrome, Safari (Mac), iOS Simulator Safari and Firefox.
- [ ] 5.3 In iOS Safari when not installed, turning Use offline on first shows the Home Screen steps and the note about builds staying in Safari (Export, then Load… → Open from computer…), with **Download in Safari anyway**. Verify: in the iOS Simulator, nothing downloads until one of the two is chosen. Inside the Home Screen app, the download starts with no Home Screen steps.

- [x] 5.4 Offer offline in the installed app: on opening as an installed app with Use offline off and a connection, fetch the file list and show "Use VEX IQ without internet? …(about N MB)" with Download (space check, then download at once, Settings opens at Offline) and Not now (hidden until next opening; never again after two). Add "The installed app will offer to download everything for offline use when it opens" to the Install app guidance. Verify: emulating the installed display mode in Chrome shows the message; Download completes with the label; two Not nows stop it; a normal tab never shows it; offline it isn't shown.

## 6. New versions

- [x] 6.1 Add the version check: fetch `offline-manifest.json` with `no-store` on start-up, on `online` and when the tab becomes visible, at most once a minute. A failed fetch counts as offline. A different version sets "update needed", hides the label and shows the message ("A new version of VEX IQ Builder is out. Download it to keep using it offline.") with Download update / Later. Verify: building and serving a changed version makes the message appear on the next focus, and opening offline shows no message.
- [x] 6.2 Add Download update. Files whose hash is unchanged are copied from the old cache and the rest are fetched, with the same progress, cancel and resume. Then the app saves the current build, sends `activate-version`, and reloads. Verify: after a script-only change, the progress total is a few MB, the app reloads with the same build open, and the label is back. Going offline before updating still opens the older version.

## 7. End-to-end checks

- [ ] 7.1 On the GitHub Pages build (`/vexiq-builder/`): download, install in Chrome, go offline, and run every smart action, Explode, Audit with blueprint, Load… and Export. Verify: everything works, and the network panel shows no requests that failed.
- [ ] 7.2 On a real iPad: install from Safari, turn Use offline on inside the Home Screen app, switch to flight mode, and build. Verify: the app opens and works, and builds survive closing and reopening it.
- [x] 7.3 Update `features.md` with an Offline section and `README.md` with a short "Use it offline" note. Verify: both describe the Settings switch, the label, installing, and updates. Every `node scripts/check-*.mjs` passes.
