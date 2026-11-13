---
title: Check and fix your build
group: check
order: 3
summary: Let the Audit find loose or overlapping parts, then fix them.
icon: clipboard-check
keywords: audit, check, fix, fix assembly, attempt fix, overlap, loose pin, half seated, unpinned, warning, note, tight fit, sound
answers: audit
tags: audit, fix, problem, pin, fit, tool
devOnly: false
---
The Audit looks over your build and lists problems. Most can be fixed with one button.

1. Choose **Tools → Audit** [[Tools → Audit]].
2. Read the top line. "Mechanically sound" means no problems.
3. {{Click|Tap}} a row (1) to select the parts it is about.
4. For an overlap, a loose pin or a half-seated pin, press [[Attempt Fix]] (2).
   ![The Audit panel with a row and Attempt Fix marked](shot:check-audit)

> **Tip** The Audit updates by itself while you build.

<!-- more -->

## The counters
Seven counters sit under the title: Overlaps, Loose pins, Half-seated, Unpinned, Under-fastened, Not joined and Overhanging shafts. A counter is green at zero. A blue **Drive** counter shows motors, meshed gears and driven wheels, such as "1M → 2G → 2/4W". It is never a problem. **Refresh** runs the Audit again.

## Overlaps and tight fits
"Overlaps another part" says solid parts pass into each other. Press [[Attempt Fix]], or move the part clear. "Is a tight fit" is only a note. VEX parts often touch by half a millimetre, and that is fine.

## Loose and half-seated pins
"Is not in any hole" says a pin or shaft sits in nothing. "Holds only one part" says it is in one part but not the other. The row says how far off its line the nearest hole is. [[Attempt Fix]] moves the part to line them up.

## Parts that aren't held
"Is not pinned to anything": add pins, or use Auto-Fasten on the [Advanced tools](help:advanced-tools) page. "Needs more fasteners" says a heavy part, like the brain or a motor, needs more pins. "Not joined to the rest" lists a group with no pin or shaft joining it to the rest. Join it with [Joining parts](help:joining).

## Shafts and single pins
"Sticks out past its parts" says a shaft end reaches more than a few millimetres past the outer faces. Slide it, or add a collar. "Is held by one pin" is a note: the part can swing on that pin. Add a second pin if it should stay put.

## Tools → Fix assembly on its own
Select a part, then choose **Tools → Fix assembly** [[Tools → Fix assembly]]. It lines up pins and holes that nearly fit, and seats them. The side with fewer parts moves, and never a side with a locked part. It won't move more than 10 mm or turn more than 25°. If it can't, a message says why, for example "Move the parts closer first".

## Closing the Audit panel
{{Click|Tap}} the **X** (Close the audit panel) at the top right of the Audit panel when you have finished reading. The findings come back when you choose **Tools → Audit** again.
