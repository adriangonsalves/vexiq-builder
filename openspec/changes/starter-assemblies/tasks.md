## 1. Starter data

- [x] 1.1 Add `section: 'robots'` to Speedbot 2.0, BaseBot, Clawbot and Flop, and `section: 'assemblies'` to Sample starter and Ratchet winch, in `src/starters.js`. Verify `node scripts/check-build-library.mjs` still passes.
- [x] 1.2 Add the label table (design decision 2) and a builder that makes a piece from `CLAWBOT`: its rows only, fresh ids `inst-<id>-<n>`, one group named after it, lowered to the floor (decision 4). Add Simple drivetrain, Simple arm and Simple claw to STARTERS under Assemblies. Verify with a check (task 3.1).

## 2. Menu

- [x] 2.1 In `FileMenu.jsx`, list the starters under `MenuHeading` "Robots" then "Assemblies", skipping a heading with none; headings are not choosable. Verify in the app at desktop and phone widths that both headings show with the right starters, and picking one still asks open-or-add when the build has parts.

## 3. Checks

- [x] 3.1 Add `scripts/check-starter-assemblies.mjs`: every STARTERS entry has a section; the menu order matches the spec scenario; every Clawbot row is in exactly one piece or the brain list; the three pieces plus the brain list are exactly the Clawbot's 193 parts; the drivetrain has the two drive motors, four wheels and no brain part; each piece is one group named after it with unique ids; each piece's lowest point is at the Clawbot's floor height. Print each piece's part count and audit collision count. Exits 1 on failure.
- [x] 3.2 Run every `node scripts/check-*.mjs`; all exit 0.

## 4. Help and docs

- [x] 4.1 Update the starters section of `src/help/pages/saving.md` with Robots and Assemblies, one picture each of Simple drivetrain, Simple arm and Simple claw (add `starter('simple-drivetrain', …)` etc. to `shots-basics-c.mjs`), a line on building a Clawbot from the pieces, and coverage entries for the three new starters. Retake `saving-starters` and the new pictures (rebuild the static site first). Verify `check-help.mjs`, `check-help-tags.mjs`, `check-help-context.mjs`.
- [x] 4.2 Update `features.md` (File menu section) with the two sections and the three pieces. Verify by reading it.
- [x] 4.3 In the app, open each piece by itself and add the three together; take screenshots from two views and confirm each piece looks complete and rests on the floor.
