---
title: Chain and track
group: mechanisms
order: 4
summary: Wrap a chain or a tank track round sprockets in one go.
icon: link
keywords: chain, track, tread, sprocket, links, tank, grippers, flap, sag, slack, over, under, loop
answers: chain-builder, sprocket, chain, track
tags: chain, track, sprocket, gear, band, belt, mechanism, tool
devOnly: false
---
Chain and track go round sprockets. The app builds the whole loop for you.

1. Put two or more sprockets on shafts that point the same way, with their teeth in one plane.
2. Select the sprockets.
3. Choose **Tools → Chain builder** [[Tools → Chain builder]] (2). For a tank track choose **Tools → Track builder…** [[Tools → Track builder…]].
   ![The Tools menu with Chain builder marked](shot:chain-menu)
4. If a window asks over or under, answer for each part, then press **Build**.
   ![A chain round two sprockets](shot:chain-done)

> **Watch out** Chain goes on sprockets, never on gears.

<!-- more -->

## When the Chain builder is greyed out
Point at the greyed item to read why. "Select two or more sprockets in one plane" means pick more sprockets, or move one along its shaft. "The sprockets' axles aren't parallel" means one sprocket is tilted. "Chain and track fit sprockets, not gears" means you picked gears.

## Standoffs and parts in the way
A standoff you select with the sprockets is a smooth round guide for the chain. Any other part you select, like a beam, is something the chain bends round. A part inside the loop or in a run's way gets an **Under** and **Over** question: does the chain pass below it or above it? **Build** stays greyed until every part has an answer.

A message after the build can say "In the way" and name a part. The chain is built, but that part is in its path. Select it with the sprockets, or move it, then build again.

## If the chain sags
The builder never makes a chain too tight. If it needs a longer loop, a window asks **Slack on** the **Lower run** or **Upper run**. The message says how far to move a sprocket for an exact fit. Move it that way and build again.

## Track builder and its attachments
<!-- answers: track-builder -->
The Track builder always opens a window. Choose an **Attachment**: **Traction Link**, **Short Intake Flap**, **Medium Intake Flap**, **Long Intake Flap** or **None**. The **Every** slider puts one on every 1st to 20th link. A track only goes round the outside of sprockets, so parts inside the loop are left out.

## The chain is one group
The links come as one group named "Chain 1", "Track 1" and so on. To remove it, delete the group, or undo. The chain does not follow a sprocket you move later: delete it and build again. See [Selecting and groups](help:selecting).
