## Purpose

Lets a visitor to the static site download everything it needs and keep using it with no internet connection, install it as an app on their device, and know when a new version means they have to download again.

## ADDED Requirements

### Requirement: Offline section in Settings
On the static site, Settings SHALL have an **Offline** section, shown whether advanced options are on or off. It SHALL have one switch, **Use offline**, off by default, and SHALL show the current offline state as one of:
- **Not downloaded** (switch off);
- **Downloading** with progress;
- **Available offline**, with the date the copy was downloaded;
- **Update needed** (a newer version has been published; see New version needs a new download);
- **Download stopped**, with the reason and a **Resume** button.

The dev app SHALL NOT show the Offline section. Turning the switch on or off SHALL NOT add a history step or change the build.

#### Scenario: Section on the static site
- **WHEN** a visitor opens Settings on the static site for the first time
- **THEN** there is an Offline section with Use offline off and the state "Not downloaded"

#### Scenario: Not in the dev app
- **WHEN** the user opens Settings in the app run by `npm run dev`
- **THEN** there is no Offline section

### Requirement: Space check before downloading
Before anything is downloaded, turning Use offline on SHALL show how much the download is (from the published file list, for example "About 90 MB") and, where the browser reports it, how much space the site can use. If the browser reports less free space than the download needs, the app SHALL say so and SHALL NOT start the download. Otherwise the user SHALL confirm with **Download**, or **Cancel**, which turns the switch back off.

#### Scenario: Enough space
- **WHEN** the visitor turns Use offline on and the browser has room
- **THEN** the app shows "About 90 MB" and a Download button, and nothing has been downloaded yet

#### Scenario: Not enough space
- **WHEN** the visitor turns Use offline on and the browser reports less free space than the download needs
- **THEN** the app says there isn't enough space on this device, nothing is downloaded, and the switch goes back off

### Requirement: Downloading the app and every part
After **Download**, the app SHALL save, on the device, every file the static site needs to run with no connection: the page, its scripts and styles, the engine worker, the part catalog, part metadata, all part models, the app icons and the web app manifest. While it downloads, the section SHALL show a progress bar with the amount done and the total (for example "41 of 90 MB") and a **Cancel** button. The app SHALL keep working normally during the download.

The download SHALL be complete only when every listed file is saved and matches the published file list. If it stops partway (Cancel, connection lost, page closed, or the browser refuses the space), the state SHALL be "Download stopped" with the reason. **Resume** SHALL fetch only the files not yet saved. A file that fails SHALL be tried again a few times before the download stops.

#### Scenario: Full download
- **WHEN** the visitor confirms Download and stays online until it ends
- **THEN** the progress bar reaches the total, the state becomes "Available offline", and the toolbar shows the Available offline label

#### Scenario: Connection lost partway
- **WHEN** the connection drops at 41 of 90 MB
- **THEN** the state becomes "Download stopped" saying the connection was lost, and no Available offline label is shown

#### Scenario: Resume skips saved files
- **WHEN** the visitor taps Resume after a stop at 41 of 90 MB
- **THEN** the progress bar starts at about 41 MB and only the remaining files are fetched

### Requirement: Works with no connection
While the state is "Available offline" or "Update needed", the site SHALL open and work fully with no connection: the part library with every thumbnail, adding any part, every smart action, Explode, Audit with blueprint, saving to the build library, Load…, Export and Settings. It SHALL run the version that was downloaded, never a mix of an older and a newer version.

#### Scenario: Open with no connection
- **WHEN** the download has finished, the device goes offline and the visitor opens the site
- **THEN** the app opens with the current build, and adding a part never used before works

#### Scenario: Not downloaded, no connection
- **WHEN** Use offline is off and the device is offline
- **THEN** the site behaves as it does today (the browser's own offline page on a fresh load)

### Requirement: Available offline label
While the downloaded copy is complete and matches the newest published version known to the app, the toolbar SHALL show an **Available offline** label next to the part count. Selecting the label SHALL open Settings at the Offline section. The label SHALL NOT be shown in any other state, and never in the dev app.

#### Scenario: Label opens Settings
- **WHEN** the label is shown and the visitor selects it
- **THEN** Settings opens with the Offline section in view

### Requirement: Keeping the data
When the download starts, the app SHALL ask the browser to keep the site's data and not clear it when space runs low (persistent storage). The Offline section SHALL say whether the browser agreed. If it didn't, the section SHALL explain that the browser may clear the downloaded copy and saved builds if the site isn't used for a while, and that installing the app makes this less likely.

The Offline section SHALL always remind the visitor that builds are kept only in this browser on this device, and that **File → Export** saves a copy they can keep.

#### Scenario: Browser agrees to keep data
- **WHEN** the download starts and the browser grants persistent storage
- **THEN** the Offline section says the browser will keep the data

#### Scenario: Browser doesn't agree
- **WHEN** the browser doesn't grant persistent storage
- **THEN** the Offline section says the browser may clear the data after a while and suggests installing the app and using Export

### Requirement: Install guidance
When the download finishes, and from an **Install the app** link in the Offline section at any time, the app SHALL show steps to install it that fit the visitor's device and browser:
- **Chrome or Edge** that offers installing: an **Install app** button that opens the browser's own install prompt.
- **Safari on iPad or iPhone:** tap the Share button, then **Add to Home Screen**, then open the app from the Home Screen.
- **Safari on a Mac:** File → **Add to Dock**.
- **Any other browser:** a note that this browser can't install the app, but the site still works offline in this browser.

When the site is already running as an installed app, the guidance SHALL say it is installed and SHALL NOT show the steps.

#### Scenario: Chrome on a laptop
- **WHEN** the download finishes in Chrome, which offers installing the site
- **THEN** the app shows an Install app button, and selecting it opens Chrome's install prompt

#### Scenario: Already installed
- **WHEN** the visitor opens the installed app and opens the Offline section
- **THEN** it says the app is installed and shows no install steps

### Requirement: iPad and iPhone keep a separate copy for the Home Screen app
On an iPad or iPhone, a Home Screen app keeps its own storage, apart from Safari. So in Safari there (not installed), turning Use offline on SHALL first show the Add to Home Screen steps and explain that:
- the Home Screen app downloads its own copy, so Use offline should be turned on inside it;
- builds made in Safari don't appear in the Home Screen app, and moving one means Export in Safari, then Load… → Open from computer… in the app.

The visitor SHALL be able to choose **Download in Safari anyway**, which continues as in Space check before downloading.

#### Scenario: iPad Safari
- **WHEN** a visitor using Safari on an iPad turns Use offline on
- **THEN** the app shows the Add to Home Screen steps and the note about builds before anything is downloaded

#### Scenario: Inside the Home Screen app
- **WHEN** the visitor opens the app from the iPad Home Screen and turns Use offline on
- **THEN** the space check and download start as on any other device, with no Add to Home Screen steps

### Requirement: Installable app
The static site SHALL be installable as an app. It SHALL publish a web app manifest with the app's name ("VEX IQ Builder"), a short name, icons in the sizes devices ask for, including an Apple Home Screen icon, and the app's colours. Installed, it SHALL open full screen in its own window, at the site's base path, with no browser address bar. The dev app SHALL NOT change.

#### Scenario: Installed app opens on its own
- **WHEN** the visitor installs the app and opens it from the Home Screen or the app list
- **THEN** it opens in its own window without an address bar, showing the builder

#### Scenario: Sub-folder site
- **WHEN** the site is published at `/vexiq-builder/` and installed
- **THEN** the installed app opens `/vexiq-builder/` and works offline there

### Requirement: New version needs a new download
While Use offline is on, every time the app is opened online, comes back online, or the visitor returns to its tab or window, the app SHALL check whether the published version differs from the downloaded one. Being offline SHALL NOT count as a new version. When a different version has been published:
- the Available offline label SHALL go away;
- the state SHALL become "Update needed";
- a message over the app SHALL say "A new version of VEX IQ Builder is out. Download it to keep using it offline.", with **Download update** and **Later**.

The app SHALL keep running the downloaded version until the new one is fully saved, so nothing breaks mid-build. **Download update** SHALL fetch only the files that changed between the two versions, with the same progress, cancel and resume as the first download. When it finishes, the app SHALL save the current build and reload into the new version, and the label SHALL come back. **Later** SHALL hide the message for that version until the app is next opened. The state SHALL stay "Update needed", and offline use SHALL keep working with the older version, until the visitor downloads the update.

#### Scenario: New version published
- **WHEN** a new version is published and the visitor opens the app online
- **THEN** the Available offline label is gone, and the message asks them to download the new version

#### Scenario: Only changed files
- **WHEN** a new version changes the app's scripts but no part models, and the visitor selects Download update
- **THEN** only the changed files are fetched (a few MB, not 90 MB), then the app reloads into the new version with the current build open and the label back

#### Scenario: Later, then offline
- **WHEN** the visitor selects Later and then goes offline
- **THEN** the app still opens and works with the version that was downloaded

#### Scenario: Offline is not an update
- **WHEN** the app is opened with no connection
- **THEN** no update message is shown and the Available offline label stays

### Requirement: Turning offline off
Turning Use offline off SHALL ask first ("Remove the offline copy? The app will need the internet again. Your builds stay."). Confirming SHALL delete every downloaded file, stop the site from being served from the device, hide the label and set the state to "Not downloaded". Builds in the build library and settings SHALL NOT be deleted.

#### Scenario: Turn off keeps builds
- **WHEN** the visitor turns Use offline off and confirms
- **THEN** the downloaded files are gone, the label is hidden, and every saved build is still in File → Load…
