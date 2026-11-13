---
title: Gears
group: mechanisms
order: 3
summary: Place gears so their teeth fit, and know what turns what.
icon: settings
keywords: gear, teeth, mesh, meshed, sprocket, ratio, shaft, square, motor, hub, pitch, rack, idler
answers: gear
tags: gear, sprocket, mechanism, shaft, motor, play, fit
devOnly: false
---
Gears turn each other when their teeth fit. The app turns a gear a little when you place it, so the teeth slot in.

1. Put a gear on a shaft. Select the gear, then use **Manual Join** [[Manual Join]] and pick the end of the shaft.
2. Put a second gear on a shaft of its own, with the teeth almost touching.
   ![A 36 tooth gear next to a 12 tooth gear on two shafts](shot:gears-pair)
3. Look at the message at the top of the 3D view. "Meshed" means the teeth fit.

> **Tip** Gears of different sizes only mesh at the right distance apart.

<!-- more -->

## How far apart the shafts go
Count the distance in pitches (a pitch is the space between two holes). Add the two tooth counts and divide by 24 to get the distance. A 12 and a 24 tooth gear sit 1.5 pitches apart. Two 24 tooth gears sit 2 pitches apart. A 12 and a 36 sit 2. A 24 and a 36 sit 2.5. Two 36s sit 3. A 24 and a 48 sit 3. Two 48s sit 4. Two 60s sit 5.

## Gears that don't mesh
Only regular gears mesh. High strength gears (8, 16 and 24 teeth) mesh only with each other. Bevel gears, crown gears, ratchets, sprockets and the idler's round hole never turn to mesh. Chain goes on sprockets: see [Chain and track](help:chain-and-track).

## What the Meshed messages mean
"Meshed A with B (turned 5°)" says the gear turned that far to fit. "Couldn't mesh with B as well" says one neighbour is still a little off, so move a shaft. "Is held off its axis, so it wasn't turned to mesh" says a pin holds the gear off its own shaft.

## Square shafts and the motor hub
A square shaft only fits a square hole when the flats line up, so the app turns the part to fit. Every part with a square hole on one shaft turns together, and so does the motor's hub that holds the shaft. A round hole, like the idler gear's, spins free on the shaft.

## What turns in Play mode
In [Play mode](help:play-mode), gears turn each other the opposite way, faster or slower by their teeth. A gear train that asks one gear for two speeds jams, and its motor says "Stalled".

## Building a row of gears fast
The Advanced tools page has a gear train builder that places a row of meshed gears along a beam. See [Advanced tools](help:advanced-tools).
