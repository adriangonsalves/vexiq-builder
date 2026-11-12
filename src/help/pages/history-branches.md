---
title: Branches in the timeline
group: advanced
order: 2
summary: Keep the steps you undid, and switch between the different paths of a build.
icon: git-branch
keywords: branch, branches, linear, keep branches, undo, timeline, history, path, switch, advanced
devOnly: false
answers:
tags: branch, history, undo, redo, advanced, settings
---
Undo, then try something new, and keep the old path too. Turn on **Show advanced options** in Settings first.

1. {{Click|Tap}} **Settings** [[Settings]] (1).
   ![The Settings button marked in the toolbar](shot:history-branches-settings)
2. Turn on **Show advanced options** (1).
   ![The Show advanced options switch marked in Settings](shot:history-branches-advanced)
3. Under History, choose **Keep branches** (1). Then close Settings.
   ![The two History choices, with Keep branches marked](shot:history-branches-keep)
4. Make a change, {{click|tap}} **Undo** [[Undo]] (1), then make a different change.
   ![The Undo and Redo buttons marked](shot:undo-history-buttons)
5. {{Click|Tap}} **History** [[History]] (1) to show the timeline.
   ![The History button marked in the toolbar](shot:undo-history-open)
6. {{Click|Tap}} the branch icon (1) on the bar, then pick a branch.
   ![The branch icon on the timeline and the list of branches](shot:history-branches-menu)

<!-- more -->

## Linear or Keep branches
**Linear** is how the app starts. Undo something, make a new change, and the undone steps are dropped. **Keep branches** saves them instead. Each path stays in the timeline until you delete the build. Switch back to **Linear** and the next change after an Undo drops the undone steps again, and the branch icon goes away.

## Reading the branch icon
A small branch icon sits on the bar at the step where two paths split. Hover over it to read "2 branches continue after step 1". {{Click|Tap}} it to open "Branches after step 1". Each line shows the name of that path's first step, how many steps it has and when it was made. The path you are on says "current".

## Switching to another branch
{{Click|Tap}} a line that is not marked "current". The build goes to the end of that path, and your parts change to match. The bar and the count, like "Step 2 of 2", now follow that path. To switch back, open the same list and pick the first path again.
