## Why

The part library only has a list of small 72 px cards, so finding a part by its look means a lot of scrolling, and the same dozen parts (pins, beams, shafts, collars) have to be searched for again every time. On the right, the Assembly Outliner has no way to find a part in a big build, and once a part has been given its own label (MCP builds use names like "Left drive motor") nothing in the panel says which catalog part it is.

## What Changes

- The part library gets a **List / Grid** switch in its header. Grid shows larger thumbnails in a grid of tiles with no text; hovering a tile shows the part's name (and part number). The choice is remembered in this browser.
- The part library gets a **Recent** filter, listed first among the category pills, holding up to 20 parts recently added from the library, ordered by a score that weighs both how recently and how often each was added. The list is kept in this browser and is the same for every build.
- The Assembly Outliner gets a **search box** that filters its rows by label, catalog part name or part number, with a match count and a clear button.
- The **selected part** in the Outliner shows its catalog (base) name and part number under its label, and the Part Inspector shows the same at the top of its body, whether or not advanced options are on.

## Capabilities

### New Capabilities
- `part-library`: how the part library lists parts: List and Grid views, the hover name in Grid, and the Recent filter with its ranking and storage.
- `assembly-outliner`: the Outliner's search box, and how the selected part's base catalog name is shown in the Outliner and Inspector.

### Modified Capabilities
<!-- none: no existing spec covers the library or the Outliner -->

## Impact

- `src/App.jsx`: library header (view switch, Recent pill), the catalog list rendering, `handleAddPart` call site for library clicks, Outliner header and rows, Inspector body.
- `src/components/PartThumbnail.jsx`: takes a display size so grid tiles can be larger (rendered at 2x the shown size, cached per size).
- New `src/utils/recentParts.js`: ranking and `localStorage` read/write for the Recent list.
- `src/styles.css`: grid tiles, hover name, Outliner search box, base-name line.
- `features.md`: describe the new library and Outliner behaviour.
- No change to saved builds, the MCP server, or history.
