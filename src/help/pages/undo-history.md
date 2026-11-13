---
title: Undo and the timeline
group: basics
order: 9
summary: Take back a mistake, then replay your build step by step.
icon: history
keywords: undo, redo, history, timeline, play, step, mistake, back, replay, scrub
answers: timeline
tags: undo, redo, history, branch, play, build
devOnly: false
---
Undo takes back your last change, and the timeline lets you replay the whole build.

1. {{Click|Tap}} **Undo** [[Undo]] (1) to go back a step, and [[Redo]] (2) to bring it back. {{`Ctrl` + `Z` also undoes, and `Ctrl` + `Y` redoes.|}}
   ![The Undo and Redo buttons marked](shot:undo-history-buttons)
2. {{Click|Tap}} **History** [[History]] (1) to show the timeline under the 3D view.
   ![The History button marked in the toolbar](shot:undo-history-open)
3. {{Click or drag along the bar (1) to go to any step.|Tap or drag along the bar (1) to go to any step.}} Each mark is one step.
   ![The timeline bar marked](shot:undo-history-bar)
4. {{Click|Tap}} [[Play]] (1) to watch the build appear from the start. Pick [[1×]], [[2×]] or [[4×]] (2) for the speed.
   ![The Play button and the speed buttons marked](shot:undo-history-play)

> **Tip** An earlier step can't be edited while you look at it.

<!-- more -->

## What counts as a step
Each change to your parts is one step: adding, moving, turning, joining, deleting, copying, changing a color, hiding, locking, grouping. Changing several selected parts at once is one step. Typing in a box, or nudging one part again and again, joins into one step.

Looking around does not count. Selecting, turning the view, Explode and the settings are not steps, so Undo skips them.

## Reading the timeline
{{On a Mac, `Cmd` works in place of `Ctrl` for Undo and Redo. `Shift` + `Ctrl` + `Z` also redoes.|}}

The bar shows "Step 3 of 5", so you know where you are. Each step has a mark. Its color says where the step came from. Hover over a mark to see its name, the time and how many parts changed. {{Click the bar, then press `←` or `→` to move one step.|}}

Going to a step moves the build there, like Undo. Redo brings later steps back.

## A big step plays part by part
Some steps add many parts at once, such as a starter. Click along the bar inside one and its parts appear a few at a time. The bar says something like "part 12 of 594".
![Part-way through a big step with Go to end of step marked](shot:undo-history-bigstep)

Stopping part-way shows a message: "Showing step 1 part-way". Select [[Go to end of step]] to finish that step and edit again.

## Play and its speeds
[[Play]] starts at the very beginning and builds the robot again, step by step. It turns into [[Pause]] while it runs. The speed buttons are [[1×]], [[2×]] and [[4×]]. Making a change, or using Undo or Redo, stops it.

## More than one path
If you undo and then change something, the undone steps are dropped. To keep them, see [Branches in the timeline](help:history-branches).
