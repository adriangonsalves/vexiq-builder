---
title: Selecting and groups
group: basics
order: 6
summary: Pick one part or many, and tie parts together as a group.
icon: hand
keywords: select, selection, shift, box, group, ungroup, connected, all, folder, set
answers: select-mode, box-select, grow-selection, one-of-group, group-selected, several-parts
tags: select, group, move, copy, mirror, touch, shortcut
devOnly: false
---
Select parts to move, turn, copy or delete them together. A group keeps them tied as one.

1. {{Click|Tap}} a part. It glows amber.
   ![A gear selected and glowing amber in the 3D view](shot:selecting-click)
2. {{Hold `Shift` and click more parts.|Tap **Add to selection** [[Add to selection]] (1), then tap more parts.}} Each one joins the selection.
   ![Two parts selected, with Add to selection marked on the context bar](shot:selecting-add)
3. Open **Select** [[Select]] (1) and choose **Group** [[Select → Group]] (2). The parts now act as one.
   ![The Select menu open with Group marked](shot:selecting-group)

> **Tip** {{Press `G` to group and `Shift` + `G` to ungroup.|Choose Ungroup in the same menu to take a group apart.}}

<!-- more -->

## Select mode
**Select → Select mode** [[Select → Select mode]] makes a plain click add or remove parts. It is the same switch as **Add to selection** on the context bar. {{`Esc` turns it off and keeps the selection.|Tap it again to turn it off.}}

## Box select
Choose **Select → Box select** [[Select → Box select]] {{or press `B`|}}, then drag a box over the 3D view. Left to right picks parts wholly inside. Right to left picks every part the box touches. Groups come whole.

## Select all, none and invert
**Select → Select All** [[Select → Select All]] picks every visible part. {{`Ctrl`/`Cmd` + `A` does the same.|}} **Select None** clears the selection. **Invert Selection** swaps selected and not selected.

## Select Connected
**Select → Select Connected** [[Select → Select Connected]] {{or `C`|}} picks every part joined to the selection through pins and shafts. A message gives the count. Parts that only touch are left out.

## Grow or shrink by joints
**Grow selection** [[Grow selection]] on the context bar adds the parts joined to the selection, one layer at a time. {{`Shift` + wheel does the same, and turning back removes a layer.|Drag the wheel to add or remove layers, then tap the tick.}} [[Pins only]] follows only pins and shafts.

## Groups
Group {{(`G`)|}} makes a folder in the Outline named Group 1, Group 2 and so on. Clicking any part of a group selects the whole group. **One part of a group** [[One part of a group]] picks a single part. {{`Shift` + `Alt` + click does the same.|}} Ungroup {{(`Shift` + `G`)|}} breaks it up.

## Working on a set
A group or a selection of several parts moves and turns as one, and keeps its parts in place. Use [[Duplicate]] and [[Delete]] on the context bar to copy or remove the whole set. Hide and lock buttons for the set are at the top of the Outline's Selected list. A set with a locked or hidden part shows no arrows.

## What a selection looks like
Selected parts glow amber with a yellow outline, even when other parts are in front.
