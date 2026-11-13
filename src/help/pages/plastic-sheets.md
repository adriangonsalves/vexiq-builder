---
title: Plastic sheets
group: mechanisms
order: 6
summary: Pin a sheet flat, then curve it onto a row of holes.
icon: layers
keywords: sheet, plastic, bend, curve, flatten, 2x12, 6x6, 6x12, anchor, row, flex
answers: bend-sheet, sheet
tags: sheet, bend, plate, pin, hole, join, mechanism
devOnly: false
---
A plastic sheet can curve round a robot. Pin it flat first, then bend it onto another row.

1. Pin one or two rows of the sheet flat to a beam.
2. Select the sheet, then the part to curve it onto.
3. Choose **Tools → Bend sheet…** [[Tools → Bend sheet…]] (2).
   ![The Tools menu with Bend sheet marked](shot:sheets-menu)
4. Pick a row in the list. The 3D view shows how it would curve.
5. Press [[Apply]] (2).
   ![The Bend sheet window with Apply marked](shot:sheets-dialog)

> **Tip** To undo a bend, select the sheet alone, choose **Tools → Bend sheet…** and press [[Flatten]].

<!-- more -->

## Choosing the rows
Each choice names a sheet row and the part face it reaches, like "sheet row 6 → 1x8 Beam #1, upper face". The first choice is picked for you. Double-click a choice to apply it.

## Anchoring more rows
A bent sheet can be anchored again. Select it with another part, choose **Tools → Bend sheet…**, and pick the next row. Do one row at a time.

## Flatten
Select a bent sheet on its own and choose **Tools → Bend sheet…**. [[Flatten]] puts it back flat through the rows that were pinned.

## When no row fits
The window says no row of the sheet can be anchored there, and lists each row with why. A common reason is that the holes of the row and the part's holes aren't the same distance apart. Others are that the sheet would bend too tightly, or would pass through a part.

## Stacked sheets and flexing
A sheet on a sheet sits a hair above it. A sheet pressed a little into a part flexes. The audit calls that a tight fit, not an overlap. See [Check and fix your build](help:check-and-fix).

## Picking holes yourself
With only one flat sheet selected, choose **Tools → Bend sheet…**. {{Click a hole on the sheet, then a hole on the other part.|Tap a hole on the sheet, then a hole on the other part.}} Keep the fit you like. The phone layout can't show this banner yet.

## The Shape line in Properties
Select a bent sheet. Properties shows a Shape line that says how it is curved. Use Tools → Bend sheet to change it, or Flatten to straighten it.
