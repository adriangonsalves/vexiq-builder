# Follow-ups

Low-priority items left open when a change was closed. Pick one up by proposing a change (`/opsx:propose`) or folding it into a related one.

## From outliner-part-groups (archived 2026-10-29)

1. **Select Connected uses the audit's clamp rule.** A part squeezed between two parts that are fastened to each other counts as joined, so one Shift+wheel layer from a lock beam also takes the tire, hub and collar, not only its pins. The multi-select spec says parts that only touch don't count. Decide whether expanding by layers should leave clamp joins out (they would then only come in through Select Connected).
2. **Toolbar wraps at about 1500 px** with advanced options on (the MCP badge plus the Select menu button).
3. **Shift+click (3D view) and Ctrl/Cmd+click (Outliner) still add or remove parts outside Select mode.** Outliner checkboxes and plain-click toggling are Select-mode only. Decide whether modifier keys should be Select-mode only too.
4. **Quick 90° turns (Inspector) and MCP `update_group` turns aren't put back when they end overlapping**; only ring turns are (rotate-mode "Overlaps and saving"). Inspector set moves (nudges, typed centre) also don't save overlap flags.
5. **Box select also picks parts hidden behind others** (like most CAD tools). Decide whether it should take only visible parts.
6. **Clawbot build:** the Claw group sits 0.58 mm too deep in the Wrist 4x4 Plate along X, and Wrist Chassis Corner R is 0.338 mm low in Y (its pegs miss the plate's holes). Fix: move Claw +0.58 mm in X; set Corner R y to 158.75. The group-snapping change stops this kind of drift for new moves.
