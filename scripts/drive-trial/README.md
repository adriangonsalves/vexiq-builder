# Google Drive trial (tasks 0.2 and 0.3)

A throwaway page that checks, on real Google Drive, the seven things the `google-drive-sync` design assumes but hasn't tested. It is not part of the app and the static build doesn't include it. Delete this folder once the results are in `openspec/changes/google-drive-sync/design.md`.

You need:

- the Google Cloud project from `docs/google-drive-setup.md`, with both test accounts listed as test users;
- two personal Google accounts (A and B). No school or work account is needed;
- an iPad for step 4.

## 1. Open the page

With `npm run dev` running, open:

```
http://localhost:5173/scripts/drive-trial/index.html?client=CLIENT_ID&key=API_KEY&app=PROJECT_NUMBER
```

The page remembers the three values, so after the first visit `http://localhost:5173/scripts/drive-trial/` is enough. To use account B at the same time, open the page in a second Chrome profile or a private window.

## 2. Account A: checks (a), (b), (e), and the shared folder

1. **Sign in** as A.
2. **Create test file in My Drive**.
3. **Run (a)**, **Run (b)** and **Run (e)**.
4. In Google Drive, make a folder called `Team Robot`, share it with account B as **Editor**, and move `drive-trial.vexiq.json` into it.

## 3. Account B: checks (c), (f) and (d)

1. In the second profile, **Sign in** as B.
2. **Pick a file**, open the **Shared with me** tab, open `Team Robot` and choose `drive-trial.vexiq.json`.
3. **Run (c)**, then **Run (f)**.
4. **Create test file in My Drive** (this makes B's own file). In Google Drive, signed in as B, move that new file into `Team Robot`.
5. Back on the page, **Run (d)**. The page still uses the same file id.

## 4. iPad: sign-in (task 0.3)

Google won't sign in from a plain `http://` address other than `localhost`, so the iPad needs an `https://` address for this page. Either:

- **Temporary copy on GitHub Pages:** copy `index.html` and `manifest.webmanifest` into the published site (for example under `drive-trial/`), add `https://adriangonsalves.github.io` to the client's origins, and remove the copy afterwards; or
- **A tunnel** from this computer, for example `npx localtunnel --port 5173`. Its address changes every run and has to be added to the client's origins and the API key's websites each time.

Then:

1. In **Safari**, open the page with the `?client=…&key=…&app=…` address and tap **Sign in**. Note whether Google's window opens or Safari blocks it.
2. Tap **Share → Add to Home Screen**, then open **Drive trial** from the Home Screen. The page should say "Running as a Home Screen app". The Home Screen app doesn't share Safari's saved values, so check that the three fields at the top are filled; if not, type them in. Tap **Sign in** again. Note whether it opens, and whether it comes back to the app signed in.
3. Leave it signed in for more than an hour. The page shows how long the sign-in lasts. Once it has run out, tap **Renew sign-in** and note whether it works with a single tap.

## 5. Send the results back

On each device, tap **Copy results** and paste the text to Claude. Claude writes it into "Trial results" in `design.md`. Every `RESULT … FAIL` line goes back to you before any app code is written. A `RESULT … ERROR (inconclusive)` line means the check couldn't run, for example because of a network error; run it again.
