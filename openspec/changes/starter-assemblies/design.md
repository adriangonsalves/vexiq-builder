## Context

Starters are rows in `src/starters.js`: `STARTERS = [{ id, name, build(catalog) }]`, and `FileMenu.jsx` lists them in one submenu. The Clawbot is `CLAWBOT`, 193 rows `[partNumber, label, position, rotation, color]`, with no groups. Its labels already say which piece a part belongs to ("Drive Motor R", "Arm Beam Upper L", "Claw Tip R", "Brain Pin L"). `PopoverMenu.jsx` already has a `MenuHeading`, used by the View menu. The help check requires the saving page to name every starter (`scripts/help-rules.mjs`).

## Goals / Non-Goals

**Goals:**
- Two headed sections in one submenu, driven by data on each starter.
- The three pieces come from the Clawbot's rows, so a fix to the Clawbot fixes them too.

**Non-Goals:**
- Snapping the pieces onto each other when added.
- Splitting other robots.

## Decisions

1. **A `section: 'robots' | 'assemblies'` field on each STARTERS entry**, and the menu groups by it in that order under `MenuHeading`. Keeps STARTERS one flat list, so `starterById`, the help check and the other scripts don't change. Alternative: two lists; rejected because every user of `STARTERS` would need both.

2. **Pieces chosen by label rules over `CLAWBOT`**, one small table: for each assembly a list of label patterns (for example `/^(Bottom|Side|Top) Beam [LR]$/`, `/^Claw /`, `/^(Wrist|Arm Tip) /`), and a brain list (`/^Robot Brain/`, `/^Brain (Connector|Pin)/`). A check walks all 193 rows and fails when a row matches no list or more than one, so a later Clawbot change can't drop or double a part silently. Alternative: copy the rows into three new files with `save-starter.mjs`; rejected, as it duplicates 190 rows and lets the copies drift from the Clawbot.

   Exact sorting of the labels (from the Clawbot's names):
   - Drivetrain: `Bottom/Side/Top Beam`, `Front Block Inner/Outer`, `Middle Block`, `Rear Block`, `Side Pin`, `Front/Rear Bearing`, `Bearing Pin`, `Drive Motor`, `Motor Pin` (not Arm or Claw Motor Pin), `Front Axle`, `Drive Shaft` (not Claw Drive Shaft), `Front/Rear Washer`, `Rear Hub`, `Rear Tire`, `Rear/Front Lock Beam`, `Rear Hub Pin`, `Front/Rear Collar`, `Omni Wheel`, `Omni Pin`, `Front/Rear Crossbeam`, `Rear Crossbeam Pin`.
   - Simple arm: `Tower …`, `Arm Motor`, `Arm Motor Pin`, `Arm Lower/Upper Shaft`, `Shaft Stop …`, `Arm Beam …`, `Gear 12T/36T …`, `Gear Pin 2x2`, `Arm Standoff`.
   - Simple claw: `Arm Tip Corner …`, `Wrist …`, `Claw …`, `Traction Link`.
   - Left out: `Robot Brain with Battery`, `Brain Connector …`, `Brain Pin …`.

3. **Each piece is one group** (`groupId: group-<id>`, `groupName: <name>`), so opening it by itself shows one folder that moves as one, the same as Ratchet winch. Ids are `inst-<id>-<n>`, fresh per piece.

4. **Each piece is lowered to the floor**: shift it in Y so its lowest point sits where the Clawbot's does (the drivetrain doesn't move; the arm and claw come down). X and Z stay the Clawbot's. Without this the arm and claw open floating in the air. Their places relative to each other inside the piece don't change, so adding them to the drivetrain works as it does for any build.

5. **Help:** the starters section of `saving.md` gets "Robots" and "Assemblies" sub-lists, one picture each for the three new pieces (the same `starter(id, name)` shot helper), and a sentence that they can be added to a build to put a Clawbot together.

## Risks / Trade-offs

- [Taking out the tower leaves the chassis with empty holes, and the claw arrives without the arm-tip it sits on] → expected for pieces; the audit lists loose pins in a piece as it would for any part-built robot. The check reports the audit count for each piece so a surprise shows.
- [A Clawbot label renamed later breaks the sorting] → the check fails on any unsorted or doubly sorted row.
