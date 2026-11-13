---
title: Play mode
group: check
order: 5
summary: Run the motors and watch gears, shafts and arms move.
icon: play
keywords: play, motor, throttle, hold, stalled, gravity, drop test, floor, simulate, rpm, stop, physics, load
answers: play, drop-test
tags: play, test, motor, mechanism, gear, shaft, band
devOnly: false
---
Play mode runs your Smart Motors so you can see what turns. Nothing in your build changes.

1. Choose **Tools → Play mode** [[Tools → Play mode]].
2. Drag a motor's throttle slider (1) right to go forward and left to go back.
   ![The Play panel with a throttle slider marked](shot:play-panel)
3. Let go, and the motor stops. Tick [[Hold]] to keep it running.
4. {{Press `Esc` to leave.|Tap the X at the top right of the Play panel to leave.}} Every part goes back.

> **Tip** {{Double-click a slider to stop that motor.|Drag a slider back to the middle to stop that motor.}}

<!-- more -->

## What turns and what holds still
Parts joined by two or more pins or shafts move as one piece. A piece held on one line turns on it like a hinge. A square shaft turns the parts whose square holes fit it. Round holes spin free. Meshed gears turn each other the opposite way. Sprockets joined by a chain turn the same way. The biggest piece holds still.

## When a motor says Stalled
A motor stops and says **Stalled** when what it turns hits something, or when a gear train asks one gear for two speeds. Its whole train stops. Only the opposite throttle works until it is free. A list at the bottom says which parts "don't move as built", and why.

## Simulate gravity and the floor
Tick **Simulate gravity**. A floor appears under the robot, and loose or one-pin parts fall onto it. **Limit speed by load** slows a motor under a heavy load. Wheels don't drive the robot along the floor yet.

## The Drop test
Choose a **Drop height** and a **Landing**, then press [[Drop]]. [[Reset]] puts the robot back. **Slow motion** plays it slower. If nothing breaks it says, for example, "Survived a 0.5 m drop intact". Otherwise it lists the joints that let go, the parts that came off and the ones hanging by one pin. **Highlight loose parts** lights them. The strengths are estimates.

## Bands pulling
A band shows grey when slack, green when snug, amber when tight and red when too far. In Play mode it pulls on the parts it holds. See [Rubber bands and belts](help:rubber-bands).

## If the physics won't start
A grey "no collisions" tag shows. Parts still turn by gear ratio but don't stop each other, and gravity and the Drop test are hidden.

## Folding the Play panel and the Findings list
Press the small arrow at the top of the Play panel to fold it down: Collapse Play panel shows more of the robot. Press it again to Expand Play panel.

After a Drop, {{click|tap}} **Findings** to open or close the list of joints that let go and parts that came off. It starts closed on small screens.
