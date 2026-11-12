---
title: Advanced tools
group: advanced
order: 1
summary: Auto-fasten, snap and mate, gear trains and mirror, in Properties.
icon: wrench
keywords: advanced, smart assembly, auto-fasten, snap, mate, flip, roll, offset, gear train, mirror, left, right, cad, axes
answers:
tags: advanced, tool, join, snap, mate, gear, mirror, properties
devOnly: false
---
First turn on **Settings** [[Settings]] then **Show advanced options**. Then these tools show in Properties.

1. Select one part.
2. Look in Properties for **Smart Assembly & Fastening** (1).
   ![Properties with the Smart Assembly section marked](shot:advanced-smart)
3. Pick a tool, set its choices, and press its button.

> **Watch out** These tools show only when exactly one part is selected.

<!-- more -->

## Auto-Fasten Joint
Press [[Auto-Fasten Pins]] to put a pin in every pair of lined-up holes between the part and its partner. **Target partner part** is **ALL Touching Parts** or one part. **Maximum connector pins** is 1 to 12 (8 to start). It skips any pin that would overlap, and says "Inserted 3 collision-verified connector pins".

## Snap & Mate
This moves the selected part so one of its holes sits on a hole of another part. Choose the source hole, the target part and the target hole. **Roll** turns it about the hole's line. **Offset** slides it along the line, from -1 pitch to +1 pitch. **Flip** turns it end for end. Then press [[Snap & Mate Selected Part]]. A message says "Mated" or warns about an overlap, so try Flip or another offset.

## The gear train builder
Select a beam, then choose where to start and a preset. The presets are 3 or 5 gears of 36 teeth, 2 gears, 12 to 36 teeth, or 60 to 36 teeth.

## Mirror, left to right
Select a part and press [[Mirror Z (L↔R)]] for the other side, or [[Mirror X (F↔R)]] for front to rear. [[Mirror All Z]] copies the whole build. The mirror plane is the build's own middle, not the part's. Left and right names swap. Afterwards, look at the copy: a part whose two sides differ can only turn to the nearest pose.

## CAD information
This section lists the part's number, category, size in millimetres and in pitches, and its holes. It also says "Overlapping" or "Placed (Clear)".

## The Axes overlay
**View → Axes** is on by default and doesn't need Advanced options. For the one selected part it draws a short line through every hole. Pin holes are cyan, shaft holes pink, square sockets purple and pegs yellow.
