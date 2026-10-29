## Purpose

Lets the user find the selected part in a long Assembly Outliner list with one click, or keep the list following the selection while they work in the 3D view.

## ADDED Requirements

### Requirement: Locate button scrolls to the selection
The Assembly Outliner header SHALL have a small locate button. Clicking it SHALL scroll the Outliner so the selected row is in view, centred where the list allows; when the selected part is inside a closed group folder, that folder SHALL be opened first. With several parts selected, it SHALL scroll to the one selected last. With nothing selected the button SHALL be shown disabled. Locating SHALL NOT change the selection, the camera or the build.

#### Scenario: Find the selected part
- **WHEN** the user selects a pin in the 3D view whose row is far down the Outliner, and clicks the locate button
- **THEN** the Outliner scrolls so that pin's row is in view and highlighted

#### Scenario: Part inside a closed folder
- **WHEN** the selected part belongs to the group "Claw" whose folder is closed, and the user clicks the locate button
- **THEN** the "Claw" folder opens and the part's row is scrolled into view

### Requirement: Long press pins locate
Pressing and holding the locate button for about half a second SHALL pin it; pressing and holding it again SHALL unpin it. A short click while pinned SHALL scroll once as usual and keep it pinned. While pinned, the button SHALL look pressed, and every change of selection, from the 3D view, the Outliner, the Select menu or the MCP server, SHALL scroll the newly selected row into view, opening its folder if needed. The pinned state SHALL be remembered in this browser across reloads, and SHALL NOT be saved with the build or create a history step. A long press SHALL work with mouse, pen and touch, and SHALL NOT also count as a click.

#### Scenario: Pin and follow
- **WHEN** the user holds the locate button until it shows pressed, then clicks three different parts in the 3D view
- **THEN** after each click the Outliner scrolls to that part's row

#### Scenario: Unpin
- **WHEN** locate is pinned and the user holds the button again
- **THEN** it shows unpressed and selecting parts no longer scrolls the Outliner

#### Scenario: Remembered
- **WHEN** locate is pinned and the user reloads the page
- **THEN** it is still pinned
