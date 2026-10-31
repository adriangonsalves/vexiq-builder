## Purpose

How the part library on the left shows the catalog: a List or Grid view of the parts that match the search and category, and a Recent filter that brings back the parts the user adds most.

## ADDED Requirements

### Requirement: List and Grid views
The library header SHALL have a two-way **List / Grid** switch. List SHALL show the parts as they are shown today: one card per row with a thumbnail, name, part number, hole count and "+ Add". Grid SHALL show one square tile per part, several to a row filling the panel width, each tile showing only the part's thumbnail at a larger size than in List (about 100 px, against 72 px). Both views SHALL show the same parts in the same order for the current search, category or Recent filter, and clicking a tile or card SHALL add the part exactly as clicking a List card does today. The empty-search message SHALL show in both views.

#### Scenario: Switch to Grid
- **WHEN** the user picks Grid with the "All" category and no search
- **THEN** the panel shows every catalog part as a thumbnail tile, three or more to a row, larger than the List thumbnails, and the part count in the header is unchanged

#### Scenario: Add from Grid
- **WHEN** the user clicks the tile of a 2x Pitch Motor Shaft in Grid
- **THEN** a 2x Pitch Motor Shaft is added and selected, with the same label and history step as adding it from List

#### Scenario: Search applies to Grid
- **WHEN** Grid is on and the user types "gear"
- **THEN** only tiles for parts whose name, part number or category contains "gear" are shown

### Requirement: Remembered view choice
The List / Grid choice SHALL be remembered in this browser and restored on reload. It SHALL NOT be part of the build, its history or what MCP sees. When nothing is remembered, or the stored value can't be read, the library SHALL open in List.

#### Scenario: Reload keeps Grid
- **WHEN** the user picks Grid and reloads the page
- **THEN** the library opens in Grid

#### Scenario: First visit
- **WHEN** the app opens in a browser that has never stored a choice
- **THEN** the library shows List

### Requirement: Part name on hover in Grid
Hovering a Grid tile, or giving it keyboard focus, SHALL show the part's full name and its part number in a label near the tile, within about half a second, and the label SHALL go away when the pointer or focus leaves. The label SHALL stay inside the visible panel and SHALL NOT be cut off by the panel edge. Each tile SHALL carry the part's name as its accessible name.

#### Scenario: Hover a tile
- **WHEN** the pointer rests on the tile of the "VEX IQ Robot Brain"
- **THEN** a label shows "VEX IQ Robot Brain" and its part number "228-2540", and it disappears when the pointer moves off

#### Scenario: Tile at the panel edge
- **WHEN** the pointer rests on a tile in the rightmost column
- **THEN** the whole label is visible inside the panel

### Requirement: Recent filter
The category pills SHALL start with a **Recent** pill, before "All", showing how many parts it holds. Selecting it SHALL show the recently used parts, in List or Grid, ordered best first; the search box SHALL still narrow them. The Recent list SHALL hold at most 20 parts. When it is empty the pill SHALL still show, and selecting it SHALL show a message that parts added from the library will appear there.

#### Scenario: Recent shows used parts
- **WHEN** the user has added a 1x2 Beam, a 1x1 Connector Pin and a Rubber Shaft Collar from the library and selects Recent
- **THEN** those three parts are shown and the pill reads "Recent (3)"

#### Scenario: Empty Recent
- **WHEN** nothing has been added from the library in this browser and the user selects Recent
- **THEN** no parts are shown and the message explains that parts added from the library appear here

### Requirement: What counts as using a part
A part SHALL count as used each time the user adds it by clicking it in the library (List or Grid, any filter, including Recent). Parts placed by MCP, by duplicating or copy-inserting, by loading a build or starter, or by undo and redo SHALL NOT count.

#### Scenario: MCP placement doesn't count
- **WHEN** an MCP client places ten 1x1 Connector Pins
- **THEN** the Recent list is unchanged

#### Scenario: Duplicate doesn't count
- **WHEN** the user duplicates a selected beam with `D`
- **THEN** the Recent list is unchanged

### Requirement: Ranking by recency and use
The Recent list SHALL be ordered by a score that rises with every use of a part and fades as other parts are used afterwards, so that a part used many times stays above a part used once, and a part not used for a long run of other adds falls below parts in current use. When the list would hold more than 20 parts, the lowest-scored part SHALL be dropped. The order SHALL NOT change while the user is looking at it, except when they add a part.

#### Scenario: Frequent part ranks first
- **WHEN** the user adds a 1x1 Connector Pin five times and then a 1x6 Beam once
- **THEN** Recent lists the 1x1 Connector Pin above the 1x6 Beam

#### Scenario: Latest of equals ranks first
- **WHEN** the user adds a 1x2 Beam once and then a 1x4 Beam once
- **THEN** Recent lists the 1x4 Beam above the 1x2 Beam

#### Scenario: Old favourite fades
- **WHEN** the user added a VEX IQ Smart Motor three times and has since made 40 adds of other parts
- **THEN** the VEX IQ Smart Motor ranks below parts used several times in those 40 adds, or has dropped off the list

#### Scenario: Cap at 20
- **WHEN** 21 different parts have each been added once
- **THEN** Recent holds 20 parts and the first-added one is gone

### Requirement: Recent list storage
The Recent list SHALL be kept in this browser and restored on reload, and SHALL be the same whichever build is open. It SHALL NOT be saved in builds, history or what MCP sees. Parts in the stored list that are no longer in the catalog SHALL be left out without an error. If the stored list can't be read, Recent SHALL start empty.

#### Scenario: Survives reload and build switch
- **WHEN** the user adds parts, opens a different build from the library and reloads
- **THEN** Recent shows the same parts in the same order

#### Scenario: Part gone from catalog
- **WHEN** the stored list names a part id that isn't in the catalog
- **THEN** Recent shows the other parts and its count leaves that part out
