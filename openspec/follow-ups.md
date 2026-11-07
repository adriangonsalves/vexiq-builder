# Follow-ups

Low-priority items left open when a change was closed. Pick one up by proposing a change (`/opsx:propose`) or folding it into a related one.

## From outliner-part-groups (archived 2026-10-29)

1. **Select Connected uses the audit's clamp rule.** A part squeezed between two parts that are fastened to each other counts as joined, so one Shift+wheel layer from a lock beam also takes the tire, hub and collar, not only its pins. The multi-select spec says parts that only touch don't count. Decide whether expanding by layers should leave clamp joins out (they would then only come in through Select Connected).
2. **Toolbar wraps at about 1500 px** with advanced options on (the MCP badge plus the Select menu button).
3. **Shift+click (3D view) and Ctrl/Cmd+click (Outliner) still add or remove parts outside Select mode.** Outliner checkboxes and plain-click toggling are Select-mode only. Decide whether modifier keys should be Select-mode only too.
4. **Quick 90° turns (Inspector) and MCP `update_group` turns aren't put back when they end overlapping**; only ring turns are (rotate-mode "Overlaps and saving"). Inspector set moves (nudges, typed centre) also don't save overlap flags.
5. **Box select also picks parts hidden behind others** (like most CAD tools). Decide whether it should take only visible parts.
6. **Clawbot build:** the Claw group sits 0.58 mm too deep in the Wrist 4x4 Plate along X, and Wrist Chassis Corner R is 0.338 mm low in Y (its pegs miss the plate's holes). Fix: move Claw +0.58 mm in X; set Corner R y to 158.75. The group-snapping change stops this kind of drift for new moves.
7. **`app-settings` and `explode-view` specs still name toolbar buttons that moved into the Tools menu:** `app-settings` lists "Audit & Blueprint" (and an Explode drop-down) as toolbar items (Audit is now a panel that slides up in the 3D view and Blueprint its own dialog, both in the Tools menu), and `explode-view` "Opening and closing the Explode panel" says "the toolbar's Explode button". Both are now Tools → Audit & Blueprint and Tools → Explode (ticked while open, shortcut `X`); update the requirements the next time those specs change.

## From play-mode (in progress 2026-11-06)

1. **Flop's drive wheels don't turn in Play mode:** VEX's CAD leaves several wheels, hubs and sprockets 13–45° off their shaft's square flats (228-2500-233, -232, -1208, 228-2536), so Play mode lists them as not fitting and they spin freely. Either turn them to fit on import (the fit tools already turn axles to fit) or check whether those bores take a shaft every 45°.
2. **Clawbot starter:** the claw crank arms sit 30° off their square shafts and 1.1 mm out of mesh with each other, and the tower isn't detected as joined to the base, so the claw doesn't open and the claw piece is listed as loose.
3. **Flop's tower motor only reaches about 72 rpm** driving the intake linkage through its 10:1 train, with nothing touching (120 with the gear ties off). The linkage loop may be binding.
4. **The Smart Motor's hub doesn't turn on screen** in Play mode (the shaft and what it drives do).
5. **Play mode has no MCP tool,** so it can only be tried in the app.
6. **`fix-assembly` spec doesn't yet say Fix assembly tries the other side when the first move would make an overlap** (built, in `src/engine/fixAssembly.js` and `features.md`, with a check in `scripts/check-fix-assembly.mjs`). Add a requirement the next time that spec changes. Also not built yet: turning a shaft to fit a square bore that sits off its flats (the Clawbot's crank arms, 30°); turning the shaft alone works (tried in Node), but the shaft group counts the arm as a member, so only the shaft and the parts that already fit may be turned.
7. **Flop's battery** is a loose piece in Play mode (not joined to anything), so nothing collides with it; the Clawbot's right claw is loose for the same reason. Loose pieces block nothing because treating them as walls stopped the Clawbot's own arm on its unpinned claw. Joining them properly (a pin hole that doesn't line up, a battery not seated in its bay) would fix both.
8. **Intake flaps and tread links run round on screen but collide where they started** on their frame, so a flap swinging past a standoff is judged at its start position on the loop.
