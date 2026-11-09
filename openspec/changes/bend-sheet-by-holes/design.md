## Context

Bend sheet lives in `src/engine/sheetBending.js` (shared by the app engine and the MCP server). `sheetBendChoices` finds "starts" (`bendStarts`: from which edge and across which axis the sheet bends, with `held` rows taken from any sheet hole that has another part's hole or pin coaxial within 8 mm), then for every row past the last held one and every hole line of the target, builds an anchor and a `sheet-bend` shape. The dialog (`BendSheetDialog`) lists them. The Alt+click hole target (`target-hole-placement`, `Viewport3D.jsx`) already finds a hole under the cursor, marks it, and runs a preview session with fit stepping and banner. See proposal.md for motivation.

The "middle of the sheet" report fits how `heldHoles` works: a sheet already lying over the beam, or pinned in the middle, makes the middle rows "held", and the tool then offers rows without regard to which one the builder meant. This is not yet reproduced; the first task does that.

## Goals / Non-Goals

**Goals:**
- The builder names the sheet row (by marking a hole) and the target hole; the tool only decides face, curve direction and which fit is best.
- Reuse the existing bend maths, held rows, stacking, collision and pin carrying unchanged.

**Non-Goals:**
- Changing how a sheet bends or the dialog's list for the selection route.
- Bending onto several parts in one step.

## Decisions

1. **Filter, don't rewrite.** Add `sheetBendChoices(state, { sheetId, targetId, sheetPortId, targetPortId })`. With `sheetPortId`, only the row containing that hole is tried (all `bendStarts` directions are still tried, since that decides which side stays flat). With `targetPortId`, only the hole line through that hole is tried, and the line's holes are used for matching. *Alternative:* a new solver; rejected, the existing one already handles reach, tightness, stacking and collisions.
2. **Count matches, rank by them.** Each raw choice records `holesMatched`: sheet holes of the row within `ROW_MATCH_MM` of a target hole along the line (today it only checks that all holes in the target's span match, and ignores holes outside it). Sort by `holesMatched` descending, then `missMm`, then `bending`. The marked hole must itself be one of the matched holes, or the fit is dropped (that is what stops the "middle" anchoring: a fit where the marked hole isn't on the picked hole is never shown).
3. **Held rows when the marked row is in the held span.** If the marked hole's row is at or before the last held row, it is refused with "that row is already held, mark a hole further along". The tool never re-anchors a held row. *Alternative:* silently pick the nearest free row; rejected, that is the current surprise.
4. **Interaction reuses the hole target.** Alt+click on a sheet hole marks it as the sheet hole when nothing else is being previewed and Tools → Bend sheet is armed (or when a sheet hole is already marked); Alt+click on another part's hole then runs the choices engine action (`sheet_bend_choices`, async as in the dialog) and shows the first fit as the existing `bendPreview` (shape plus ringed target holes). Wheel/`R` step the list; click calls `bend_sheet` with the shown choice; `Esc` cancels. The dialog stays for the no-hole route. *Alternative:* a new modal dialog with hole fields; rejected, picking in the view is the point.
5. **Hole target and sheet mark are separate.** A second marker colour for the sheet hole, so a placement target set earlier is not lost. Starting bend mode doesn't clear the placement target; picking the second hole uses the Alt+click hole under the cursor directly rather than the placement target.
6. **MCP.** `bend_sheet` passes `sheetPortId` and `targetPortId` through `actions.js` to the same functions; no new tool.

## Risks / Trade-offs

- [The reported bug may not be the held-row cause] → task 1 reproduces it on the user's build first and adds a failing check; decisions 2 and 3 are kept either way since they make the choice explicit.
- [Preview needs an async engine call per picked hole] → same call and cost as the dialog today; the preview shows once it returns, and a newer pick wins over an older one.
- [Sheets bent twice: second mark must be past the last anchored row] → refused with the same message as decision 3; covered by a check.
- [Alt+click now means two things (placement target, sheet hole)] → only while a sheet hole is marked; banner always says which step the builder is on.

## Open Questions

- With no row pinned yet, the tool says to pin one first (as today). If builders find that annoying, a later change could hold the sheet by its far edge. Not needed now.
