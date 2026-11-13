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
Press [[Auto-Fasten Pins]] to put a pin in every pair of lined-up holes between the part and its partner. The partner is **ALL Touching Parts** or one part you pick. The pin limit box, **Maximum connector pins**, offers **Max 12**, 8, 4, 2 or 1. It starts at 8. It skips any pin that would overlap. It says "Inserted 3 collision-verified connector pin(s)." If nothing lines up, or the holes already have pins, it says that instead.

## Snap & Mate
This moves the selected part so one of its holes sits on a hole of another part. Leave the first choice on its Auto setting, pick the target part, then its hole. **Roll** turns the part about the hole's line: 0°, 5°, 45°, 90° or 180°. The offset slides it along that line, by a quarter, half or whole pitch either way. **Normal Dir** turns the part end for end and then reads **Flipped 180°**. Press [[Snap & Mate Selected Part]]. The message starts "Mated". If the parts overlap it adds a warning, so try flipping or another offset.

## The gear train builder
Select a beam. Under **Mesh Gear Train on Selected Beam**, pick a start hole near one end, then a preset. The presets are 3, 5 or 2 gears of 36 teeth, a 12 to 36 tooth pair, and a 60 to 36 tooth pair. **+ 3x Shafts** adds a shaft to each gear, and **Gears Only** leaves them out. Press **Build Meshed Gear Train**. It says "Placed 3 meshed gears and 3 shafts." If the beam is too short, it says "No matching pin_hole found". Start nearer the end, or pick fewer gears.

## Mirror, left to right
Select a part and press [[Mirror Z (L↔R)]] for the other side, or [[Mirror X (F↔R)]] for front to rear. [[Mirror All Z]] copies the whole build. The mirror plane is the build's own middle, not the part's. It says "Mirrored 1 part(s) across Z = 0mm." Left and right names swap. Afterwards, look at the copy: a part whose two sides differ can only turn to the nearest pose.

## CAD information
This is the part information section, under Mirror. **Status** says "Placed (Clear)" or "Overlapping". Then it lists the part's number, category and size, in millimetres and in pitches. It counts the part's pin holes, shaft holes and pegs, such as "23 pin · 0 shaft · 0 peg". Gears, pins and heavy parts add a line about their teeth, type or the pins they need.

## The Axes overlay
**View → Axes** is on by default and doesn't need Advanced options. For the selected part it draws a short line through every hole. Pin holes are cyan, shaft holes pink, square sockets purple and pegs yellow.
