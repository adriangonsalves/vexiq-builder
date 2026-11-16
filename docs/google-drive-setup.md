# Setting up Google Drive for VEX IQ Builder

VEX IQ Builder has no server. To open and save builds on Google Drive, it needs a Google Cloud project that you own. That project gives you three values, which go into the build. Without them, the Drive menu items don't appear and the app works as before.

Anyone hosting their own copy of the app needs their own project. It takes about 15 minutes.

## 1. Create the project

1. Go to <https://console.cloud.google.com/> and sign in with the Google account that will own the project. A personal account is simplest. A school account may not be allowed to create projects.
2. Choose **Select a project → New project**, name it (for example `vexiq-builder`), and create it.
3. On the project's **Dashboard**, write down the **Project number**. This is `VITE_GOOGLE_APP_ID`. Use the number, not the project ID; the ID is the text name.

## 2. Turn on the two APIs

In **APIs & Services → Library**, search for and **Enable** each of these:

- **Google Drive API**
- **Google Picker API**

## 3. Consent screen

In **APIs & Services → OAuth consent screen** (on newer consoles: **Google Auth Platform → Branding / Audience / Data access**):

1. **App name:** `VEX IQ Builder`. Support email: your own. **App domain / branding links:** the static site carries its own pages, so on GitHub Pages use
   - Application home page: `https://adriangonsalves.github.io/vexiq-builder/`
   - Privacy policy: `https://adriangonsalves.github.io/vexiq-builder/privacy.html`
   - Terms of service: `https://adriangonsalves.github.io/vexiq-builder/terms.html`
   - Authorised domain: `adriangonsalves.github.io`

   The pages are `public/privacy.html` and `public/terms.html`. Change them if the app ever reads more from Google than the `drive.file` files and the display name.
2. **Audience / User type:** **External**. If the project belongs to a school Workspace and only that school's students will use it, choose **Internal** instead; then no test-user list is needed.
3. **Scopes / Data access:** add only `https://www.googleapis.com/auth/drive.file`. Don't add other Drive scopes. `drive.file` lets the app see only files it created or files the student picks, and Google doesn't need to review an app that asks only for it.
4. **Test users:** while the app is in **Testing**, only the accounts listed here can sign in. Add every account that will sign in, **your own account included**, and the second trial account. If you leave one out, its sign-in fails with "access blocked", which looks like a Drive problem but isn't.
5. When the trial is over, choose **Publish app**. Teams on personal Google accounts can't sign in until you do, unless each student is listed as a test user. With only `drive.file`, publishing doesn't need Google's review.

## 4. OAuth client ID

In **APIs & Services → Credentials → Create credentials → OAuth client ID**:

1. **Application type:** Web application. Name: `VEX IQ Builder web`.
2. **Authorised JavaScript origins:** add every address the app is opened from. **An origin is only the scheme, host and port, with no path.**

   | Where | Origin to add |
   |---|---|
   | Dev server | `http://localhost:5173` |
   | Static preview | `http://localhost:5174` |
   | GitHub Pages site | `https://adriangonsalves.github.io` (not `…/vexiq-builder/`) |
   | Your own host | `https://your.host` |

   Google accepts plain `http://` only for `localhost`. An iPad must reach the app through an `https://` address.
3. Leave **Authorised redirect URIs** empty. The app uses the pop-up sign-in, which doesn't need one.
4. Create it and copy the **Client ID** (ends in `.apps.googleusercontent.com`). This is `VITE_GOOGLE_CLIENT_ID`. There is no client secret to keep; the browser app doesn't use one.

New origins can take a few minutes to start working.

## 5. API key

In **Credentials → Create credentials → API key**, then **Edit API key**:

1. **Application restrictions:** Websites. Add each origin from step 4 followed by `/*`, for example `http://localhost:5173/*`, `http://localhost:5174/*` and `https://adriangonsalves.github.io/*`. Don't add the page path (`…/vexiq-builder/*`): browsers send Google only the site's name, so an entry with a path never matches and the Picker says the key is invalid.
2. **API restrictions:** Restrict key → choose **Google Picker API** and **Google Drive API**.
3. Copy the key. This is `VITE_GOOGLE_API_KEY`.

The key ends up in the public web page, which is normal for the Picker. The restrictions above stop other sites from using it.

## 6. Put the values in the build

Create `.env.local` in the main project folder, beside `package.json` (not in `docs/`; the app only reads it from there). Git already ignores it; never commit real values.

```
VITE_GOOGLE_CLIENT_ID=1234567890-abc123.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=AIza...
VITE_GOOGLE_APP_ID=1234567890
```

Restart `npm run dev`, or rebuild with `npm run build:static`. Once the Drive feature is built (change `google-drive-sync`), the **File** menu shows **Save to Google Drive…** and **File → Load…** shows **Open from Google Drive…**.

For the GitHub Pages site, add the three values as repository **variables** with the same names (**Settings → Secrets and variables → Actions → Variables**, or `gh variable set VITE_GOOGLE_CLIENT_ID --body …`). `.github/workflows/pages.yml` passes them to the build. They don't need to be secrets: the client ID and API key are always visible in the published page, which is normal for Google sign-in and the Picker in a browser app. What protects them is the list of allowed addresses on the client ID and the website and API limits on the key (steps 4 and 5). Keep billing off for the project, or set a budget alert.

## 7. How teams share a build

The app doesn't share files. A team shares a folder in Google Drive: one student makes a folder, shares it with teammates as **Editor**, and keeps the build file in it. Personal Google accounts are enough. Each teammate opens the file once with **Open from Google Drive…** (Shared with me → the folder → the file). Teammates shared as **Viewer** can only look. Shared drives (school and work accounts) aren't supported yet.

## 8. School Google accounts

A school's Google Workspace admin decides which outside apps students may sign in to. If students see "This app is blocked" or "Access denied by your administrator", send the admin:

- the **Client ID** from step 4;
- this explanation: the app asks only for `drive.file`, so it can open only the files a student creates with it or picks themselves, and it has no server; files go straight between the student's browser and Google Drive.

In the Admin console the setting is **Security → Access and data control → API controls → Manage third-party app access → Add app → OAuth App Name or Client ID**. The admin pastes the Client ID and sets it to **Trusted** (or **Limited** if Drive is allowed for unconfigured apps). Admins can also block Google Drive access from outside apps entirely; then this feature can't be used at that school, and students use **Work on this device only**.

## Checking the setup

Open the app and use **File → Save to Google Drive…**. If Google's account chooser opens and the build saves, the client ID, origins and test users are right.

Common problems:

| What you see | Cause |
|---|---|
| `Error 400: redirect_uri_mismatch` or `origin_mismatch` | The address in the browser isn't in **Authorised JavaScript origins**, or a path was added to the origin. |
| `Access blocked: … has not completed the Google verification process` | The account isn't in **Test users**. |
| Picker shows "The API developer key is invalid" | The API key's website list doesn't include this address, or Picker API isn't in its API list. |
| A picked file gives `404 File not found` | `VITE_GOOGLE_APP_ID` is missing or isn't the project **number**. |
