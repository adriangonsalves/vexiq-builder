# What the scribe asked for (task 6.10)

From the main scribe's round-one and round-two reports, 2026-11-12. Work through these in 6.10: fix the small ones, and put the rest in `openspec/follow-ups.md` under "From in-app-help" with the reason.

## Show me chips to add to `src/help/controls.js` (with `data-help` attributes)

These are bold text on the pages today, with no chip. Once each one is added, turn its bold text on the page into a `[[…]]` chip.

- Toolbar and timeline: Redo, Play, Pause, 1×, 2×, 4×, Go to end of step
- Build library: Open, Rename, Duplicate, Delete, Open from computer…
- File menu: File → Starter, File → Export, File → Delete this build…
- Outline: Locate, Group name, Hide all, Lock all, Library search box
- Wheel bar: Wheel, Next, Previous, Pins only, Cancel (check these against the existing names; some may already be there under other names)
- Settings: Offline (the section's question mark), the three Display switches and their sub-options
- Views and panels: Depth, Open Full SVG, the Explode slider and close button
- Panel buttons: Attempt Fix, Drop, Reset, Done, Apply, Flatten
- Play mode: the throttle slider, Hold
- Properties: Mirror Z (L↔R), Mirror X (F↔R), Mirror All Z, Auto-Fasten Pins, Snap & Mate Selected Part

## App findings to fix or file

1. **Advanced options and Keep branches:** with Keep branches chosen, turning Advanced options off leaves branching on (`isLinearHistory` in `src/utils/appSettings.js` ignores the switch). Settings then says undone steps are dropped, which isn't true. This is a behaviour decision the app-settings spec doesn't settle: put it in follow-ups for the user, don't change it.
2. **The hint under Show advanced options mentions "assistant settings",** which don't exist on the static site. Small fix: leave that phrase out on the static site.
3. **"Snap & Mate to Port"** contains a word the guide bans ("Port"), so the page calls it **Snap & Mate**. That breaks the rule that names match the app. Either rename the section in the app or allow the exact title on `advanced-tools`. Put it in follow-ups for the user to decide.
4. **The Axes overlay** draws only on the selected part, but `features.md` says each part. Fix `features.md` in group 8.
5. **Stereo full screen has no on-screen way out by touch.** Put it in follow-ups.
6. **`controls.js` says tablets have no side panels to hide,** but the Wide button is hidden only on phones. Fix the hint.
7. **Two band chips are both labelled "2x30 mm belt"** (silicone and rubber). The Track builder says "Traction Link", but its message says "grippers". Put both in follow-ups.
8. **`features.md` is missing keys:** `B`, Undo and Redo, `?`, `R`, `Enter`, Alt+click, Shift+click; its Esc line is out of date. Redo is `Ctrl`+`Y` only, and `1` `2` `3` work only on the top-row digits. Fix in group 8.
9. **`features.md` describes the Explode panel with direction choices,** but the app has none. Fix in group 8.
10. **The `AGENTS.md` wording "2nd gen omni wheel"** doesn't match the library part, which is "200mm Travel Omni-Directional Wheel". Fix in group 8.

## Steps not tried in the app (for group 7)

Listed page by page in the scribe's round-one and round-two reports. Most steps on the mechanism, check and devices pages were captured but not followed. `shortcuts`, `words` and `troubleshooting` were written from code. Group 7 has to cover these.
