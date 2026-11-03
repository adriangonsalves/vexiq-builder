## Context

See proposal.md for why. Today:

- `npm run build:static` (vite.config.js, `mode === 'static'`) builds `dist-static/` with hashed scripts in `assets/` (about 1.6 MB, including the module engine worker `worker-*.js`), plus `catalog.json`, `part-metadata.json` and 482 GLB models (about 88 MB). These are copied by `copyStaticPublicFilesPlugin`. The base path comes from `VEXIQ_BASE`, and GitHub Pages publishes at `/vexiq-builder/`.
- Every file request goes through `assetUrl()` (`src/utils/assetUrl.js`) at the base path. The site makes no requests to other sites: no web fonts, no CDNs, and the environment lighting is the built-in `RoomEnvironment`.
- Library thumbnails are drawn from the part models (`PartThumbnail.jsx`), so the library needs the models too.
- Builds are kept in IndexedDB (`src/utils/buildLibrary.js`) and settings in localStorage. Neither changes here.
- `src/backend/index.js` picks the static or bridge backend from `import.meta.env.VITE_STATIC`. `hasAssistant` already gates static-only UI, and the same pattern gates the Offline section.
- The Settings panel (`SettingsPanel.jsx`) is a `<dialog>` with sections built from `SwitchRow`.

## Goals / Non-Goals

**Goals:**
- Offline use is something the visitor turns on and can see. Nothing is cached behind their back.
- Offline, the site always runs one whole version, never a mix of old scripts and new models or the other way round.
- An update fetches only what changed.
- No new dependencies. The static site keeps working on any static host.

**Non-Goals:**
- Background sync, push notifications, or updating while the app is closed.
- Making the dev app installable.
- Moving builds between Safari and an iOS Home Screen app automatically.

## Decisions

### 1. The build writes `offline-manifest.json`: a version plus every file with its size and content hash

In static mode, a new plugin step (after `writeBundle`, so the copied models are there) walks `dist-static/`. It skips `sw.js`, `offline-manifest.json` and source maps. For each file it records `{ path, size, hash }` (SHA-256, first 16 hex characters), with paths relative to the base. `version` is the hash of the sorted file list. The page uses the manifest for the total size, the progress bar, what to download, and what changed.

*Alternative:* use Vite's own build manifest. Rejected: it doesn't list the copied models or their sizes.

### 2. A hand-written service worker, registered only while Use offline is on

`src/offline/sw.js` is emitted at the site root as `sw.js`, so it is in scope for the whole base path. It is short:
- **fetch:** for a same-origin GET inside the scope, look in the downloaded cache and answer from it if found. Page loads (navigations) are answered with the cached `index.html`. Anything not in the cache goes to the network as normal. So do the downloader's own requests, which carry an `x-vexiq-offline-download` header. Without that, a changed file that keeps its name (a model, `catalog.json`, `index.html`) would be answered from the old copy during an update.
- **message:** `activate-version` makes a newly downloaded version current (Decision 4).

The page decides when to switch site versions (`activate-version`), so a session never jumps version midway. A new `sw.js` does call `skipWaiting`, because it keeps serving the same active version. That way a fix to the worker reaches visitors without them closing every tab.

The page registers it only after a complete download, and unregisters it when Use offline is turned off. With the switch off, nothing about the site changes.

*Alternative:* `vite-plugin-pwa` / Workbox. Rejected: it adds a dependency, and its precache-on-install model downloads 90 MB the moment the worker installs. We want the download started by the visitor, with progress shown in the app and a resumable partial download. A worker of about 60 lines, plus our own manifest, is simpler.

### 3. The page does the download, into a cache named after the version

`src/offline/download.js` runs in the page, which has the Cache API, so progress and Cancel live naturally in React state:
1. Fetch `offline-manifest.json` with `cache: 'no-store'`.
2. Open cache `vexiq-offline-<version>`. List what it already has (resume).
3. Fetch the missing files four at a time, check each response's size against the manifest, and `put` them in the cache. Each file is retried up to 3 times with a back-off, then the download stops with a reason (offline, no space from `QuotaExceededError`, file failed).
4. When every file is there, write a `__complete__` entry holding the manifest, then register the service worker (first download) or activate the version (update).

The state ("not downloaded", "downloading", "available", "update needed" or "stopped") is worked out from the caches at start-up, plus a small localStorage record of the stop reason and the time of the last download. So it is correct even after the browser clears localStorage.

### 4. Updates: keep the old cache until the new one is complete, copying files whose hash didn't change

The check fetches `offline-manifest.json` with `cache: 'no-store'`. The service worker lets this one file go to the network. The check runs on start-up, on `online`, and on `visibilitychange` to visible, at most once a minute. A failed fetch means offline, not a new version. If the version differs from the current cache's `__complete__` manifest, the state becomes "update needed", the label hides and the message shows.

**Download update** builds `vexiq-offline-<new>`. Every file whose hash matches an entry in the old manifest is copied from the old cache (no network), and the rest are fetched, so a script-only release is a few MB. When the new cache is complete:
1. the page saves the current build (the build library's normal save, awaited);
2. it tells the worker `activate-version <new>`;
3. the worker serves from the new cache and deletes older `vexiq-offline-*` caches;
4. the page reloads.

Until step 2, the worker serves the old cache, so the running app and an offline reload both stay on the old version.

*Alternative:* serve from the network when online and from the cache only when offline. Rejected: with hashed script names, a newer `index.html` can point to scripts that aren't cached, and an online session would be on a version that isn't saved for offline use. Keeping one version also makes "Update needed" mean exactly what it says.

### 5. Install guidance from what the browser says about itself

`src/offline/install.js` returns one of `installed`, `prompt`, `ios-safari`, `mac-safari` or `other`:
- `installed`: `matchMedia('(display-mode: standalone)')` or `navigator.standalone`.
- `prompt`: a `beforeinstallprompt` event was caught and kept (listened for from start-up). The Install app button calls its `prompt()`.
- `ios-safari`: iPhone, iPod, or an iPad that reports as a Mac (`MacIntel` with touch points over 1).
- `mac-safari`: Safari on a Mac with no install prompt.
- `other`: anything else.

The guide is a panel inside Settings' Offline section, with a short step list and a picture of the Share icon for iOS. It isn't a separate dialog.

### 6. Manifest, icons and `index.html` in static mode only

A static-mode plugin emits `manifest.webmanifest` (`name: "VEX IQ Builder"`, `short_name: "VEX IQ"`, `start_url` and `scope` set to the base, `display: "standalone"`, and `background_color`/`theme_color` taken from `--bg-panel` `#111827`). It also uses `transformIndexHtml` to add `<link rel="manifest">`, `<meta name="theme-color">`, `<link rel="apple-touch-icon">` and `apple-mobile-web-app-capable`.

The icons are committed PNGs in `src/offline/icons/`: 192, 512, maskable 512 and Apple 180, made once from an SVG of the brand badge. Committing them means the build doesn't need an image library.

### 7. Persistent storage and space

`navigator.storage.estimate()` gives the space check: the download is refused if `quota - usage` is less than the manifest total plus 10%. If `estimate` isn't there, the check is skipped and a failed `put` is reported instead. `navigator.storage.persist()` is called when Download is confirmed, and its result shows in the section. `navigator.storage.persisted()` is checked again on start-up.

## Risks / Trade-offs

- [Safari may clear site data after 7 days without use, unless the site is installed or persistent storage was granted.] → The persist request, the install steps and the Export reminder. On start-up, if the cache is gone but the record says it was downloaded, the state becomes "Download stopped: the browser removed the offline copy" with Resume.
- [A 90 MB download on a mobile data plan.] → The size is shown before anything starts, and nothing downloads without confirming.
- [Someone sends an old link or bookmark while offline.] → Navigations inside the scope all get the cached `index.html`, which reads the build from IndexedDB as normal.
- [A host that rewrites or compresses files could make sizes not match.] → Compare against `Content-Length` only when it's there and the response isn't encoded. Otherwise compare the length of the stored body. Hashes are used to compare versions and aren't checked on the device, since hashing 88 MB on a phone is slow.
- [Two tabs downloading at once.] → A `navigator.locks` lock named `vexiq-offline-download`. The second tab shows "Downloading in another tab" and follows the cache contents.
- [A broken release that has already been activated.] → Publishing a fixed version triggers the update path as usual. Turning Use offline off and on again also recovers.

## Migration Plan

Nothing changes for current visitors until they turn Use offline on: the worker isn't registered before then. Rolling back means removing the Offline section and publishing a `sw.js` that unregisters itself and deletes `vexiq-offline-*` caches, so anyone who downloaded is cleaned up on their next online visit.
