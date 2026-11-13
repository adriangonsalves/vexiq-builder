## Purpose

The Help guide is the manual built into the app: a panel beside the 3D view that gets a new builder started in minutes and lets them dig into any feature in full, with pictures, on a computer, tablet or phone, with no server and no internet.

## ADDED Requirements

### Requirement: Opening and closing Help
The toolbar SHALL have a **Help** button (a question mark) that opens the Help guide, in every layout size. The `?` key SHALL open and close it, except while the user is typing in a text field. The guide SHALL close with its own close button, with `Esc` (when nothing else that `Esc` closes is open over it), and with the Help button. Opening or closing the guide SHALL NOT change the build, the selection, the camera or the history. While open, the Help button SHALL show as on.

When the builder is in the middle of something the guide has a page for (see Help opens on what you're doing), opening the guide SHALL show that page. Otherwise, reopening the guide in the same visit SHALL show the page it was last on, scrolled where it was, and the first opening of a visit SHALL show the home page.

#### Scenario: Open from the toolbar
- **WHEN** the user selects the Help button for the first time in a visit, with a build open, a sensor selected (a part no page is about) and no tool open
- **THEN** the guide opens on its home page, and the build, the selected part and the camera are unchanged

#### Scenario: The ? key
- **WHEN** the user presses `?` while no text field has the focus
- **THEN** the guide opens, and pressing `?` again closes it

#### Scenario: Typing a question mark
- **WHEN** the user types `?` in the library's search box
- **THEN** the character is typed and the guide does not open

#### Scenario: Back where you were
- **WHEN** the user reads halfway down the Gears page, closes the guide, clears the selection, then opens it again with no tool or panel open
- **THEN** the Gears page shows at the same place

### Requirement: Help opens on what you're doing
When the Help button or the `?` key opens the guide, it SHALL work out what the builder is doing from the app's state and open the page, or the More section, that best fits, scrolled to it. What the builder is doing is read in this order, and the first one with a page wins:
1. a tool or panel that is open or running: the band builder, a chain or track builder dialog, Bend sheet, Explode, Play mode (and its Drop test), Audit, Blueprint, the History timeline, the build library (Load…), Settings (and its Offline section), a view layout other than Single (4-View, Stereo);
2. something going on in the 3D view: picking a hole, placing a part, stamping copies, stepping through fits with the wheel bar, mate arrows on screen;
3. a context bar button that is switched on or armed: Mark a hole, Stamp copies, Add to selection (Select mode), Box select, World arrows, Free move, Grow selection, One part of a group, an open Turn step choice; and Rotate mode;
4. what is selected: the kind of part when one part is selected, or when every selected part is the same kind (a gear, a sprocket, a chain link, a plastic sheet, a rubber band, a Smart Motor, a brain, a battery, a shaft, a wheel, a pin, a standoff, a connector and so on); otherwise a group, or several parts.

The guide SHALL show one line at the top of that page saying why it opened there ("Because you're stringing a rubber band") with a link to the home page. With nothing from this list going on, the guide SHALL open as before (the last page in this visit, or the home page). Opening the guide this way SHALL NOT change the build, the selection, the tool that is running, or the camera, and a page link (`#help/…`) or a tool panel's question mark SHALL open the page it names instead.

#### Scenario: In the band builder
- **WHEN** the band builder is open with two spots picked and the user selects the Help button
- **THEN** the guide opens on the Rubber bands page, says why it opened there, and the band builder stays open with its two spots

#### Scenario: Armed context bar button
- **WHEN** Mark a hole is armed on the context bar and the user presses `?`
- **THEN** the guide opens on the section that explains Mark a hole, open and scrolled into view

#### Scenario: A gear selected
- **WHEN** one 36 Tooth Gear is selected, no tool is open, and the user opens Help
- **THEN** the guide opens on the Gears page

#### Scenario: Tool beats selection
- **WHEN** two sprockets are selected and the Track builder dialog is open
- **THEN** Help opens on the Chain and track page at its track section, not on a page about selecting

#### Scenario: Nothing going on
- **WHEN** nothing is selected, no tool or panel is open, and Help hasn't been opened in this visit
- **THEN** Help opens on the home page with no "Because" line

#### Scenario: Back to home
- **WHEN** Help opened on the Play mode page because Play mode is on, and the user selects the line's home link
- **THEN** the home page shows, and Play mode is still on

### Requirement: Help sits beside the build
In the large layout the guide SHALL open as a panel on the right side of the window, 420 px wide (or 60 % of the window when that is less), and the Library SHALL stay available. In the medium layout the guide SHALL take the side panel's place (the Library and Outline come back when the guide closes), 420 px wide or 60 % of the window. In both, the 3D view SHALL stay visible and usable while the guide is open: parts can be selected, moved and joined, and the toolbar and context bar work. The context bar and the view cube SHALL stay visible, clear of the panel. In the small layout the guide SHALL fill the screen below the toolbar, with a close button always in view. The guide SHALL scroll inside itself and SHALL never make the page scroll sideways, at any width from 320 px up.

#### Scenario: Read and do on a computer
- **WHEN** the guide is open on a 1280 px wide window and the user drags a part in the 3D view
- **THEN** the part moves as usual and the guide stays open on its page

#### Scenario: Context bar stays clear
- **WHEN** the guide opens in the large layout with a part selected
- **THEN** the context bar and the view cube are fully visible to the left of the guide

#### Scenario: Phone
- **WHEN** the guide opens in a 390 px wide window
- **THEN** it fills the screen under the toolbar, its text and pictures fit the width, and one tap on its close button returns to the 3D view

#### Scenario: Tablet
- **WHEN** the guide opens in a 900 px wide window
- **THEN** it takes the side panel's place, the 3D view beside it still turns and moves parts, and closing the guide brings the Library and Outline back as they were

#### Scenario: Turning a tablet
- **WHEN** the guide is open on a page and the window changes from the medium to the small layout
- **THEN** the guide stays open on the same page in the new layout's form

### Requirement: Home page
The guide's home page SHALL show, top to bottom: a search box; one **Start here** card for the quick start, larger than the rest, with a picture and the words "about 5 minutes"; then topic cards in named groups, each card with an icon, the page's title and a one-line summary. Every page of the guide SHALL be reachable from the home page in one tap. Pages for features that need Advanced options SHALL be in their own group, last, labelled **Advanced**. A page for a feature the current site doesn't have (the assistant, on the static site) SHALL NOT be listed, searched or opened.

Every page other than home SHALL show a header with a button back to the home page and the page's title, and at its end links to the previous and next page in its group.

#### Scenario: Start here
- **WHEN** the user opens the guide for the first time and selects the Start here card
- **THEN** the quick start page opens

#### Scenario: Any page in one tap
- **WHEN** the user is on the home page
- **THEN** a card for every listed page is on it, grouped, with Advanced last

#### Scenario: No assistant page on the static site
- **WHEN** the guide is open on the static site
- **THEN** no card or search result leads to the assistant page, and a link to it opens the home page instead

### Requirement: Pages are short on top with detail underneath
Every feature page SHALL show, in this order: its title; one sentence saying what the feature is for; the main steps as a short numbered list with pictures; then its **More** sections. Each More section SHALL show as a closed row with its title and SHALL open and close when its title is selected. More sections SHALL be closed when a page opens, except a section a link or search result points at, which SHALL be open and scrolled into view. Opening one section SHALL NOT close another.

#### Scenario: A page opens short
- **WHEN** the user opens the Rubber bands page from the home page
- **THEN** the sentence, the steps and their pictures show, and every More section is closed with its title readable

#### Scenario: Digging in
- **WHEN** the user selects the More section "Every setting"
- **THEN** it opens in place and the sections the user opened earlier stay open

#### Scenario: A link into a section
- **WHEN** the user follows a link to the Shortcuts section of the Selecting page
- **THEN** the Selecting page opens with that section open and at the top of the view

### Requirement: Pictures with numbered markers
A picture in the guide SHALL be a screenshot of the real app. Where a step names controls, the picture SHALL carry numbered round markers on those controls, and the step SHALL use the same numbers. Markers SHALL stay on their controls at every picture size. Every picture SHALL have a text description for screen readers. Selecting a picture SHALL show it as large as the window allows, over the guide and the 3D view, and a tap anywhere, `Esc` or its close button SHALL return to the page. Pictures SHALL load only when their page is shown, and the page SHALL keep its layout while a picture loads (no jump when it arrives).

#### Scenario: Markers match the step
- **WHEN** a step reads "Open **Tools** (1) and choose **Explode** (2)"
- **THEN** its picture shows marker 1 on the Tools button and marker 2 on the Explode item

#### Scenario: Bigger picture
- **WHEN** the user taps a picture in the 420 px panel
- **THEN** the picture shows at up to the window's size with its markers in the same places, and a tap closes it

#### Scenario: No jump
- **WHEN** a page with three pictures opens on a slow connection
- **THEN** the text below each picture stays where it is as the pictures arrive

### Requirement: Mouse or touch wording
Steps that are done differently with a mouse and keyboard than by touch SHALL exist in both wordings, and a page SHALL show one of them at a time. The guide SHALL start with the touch wording in the medium and small layouts and when the app was last used by touch, and with the mouse wording otherwise. A switch in the guide's header (**Mouse** / **Touch**) SHALL swap the wording on every page at once, and the choice SHALL be remembered in this browser. Keyboard shortcuts SHALL be shown in the mouse wording only.

#### Scenario: Tablet shows taps
- **WHEN** the guide opens on a tablet and shows the Joining parts page
- **THEN** its steps say to tap **Join** on the context bar and then a hole, and no step says "double-click"

#### Scenario: Swapping
- **WHEN** the user sets the switch to Mouse on that page
- **THEN** the same steps say to double-click the part, shortcuts appear, and the next page opened also uses the mouse wording

### Requirement: Search
The guide SHALL have a search box on the home page and in every page's header. Typing SHALL list matching pages and sections as the user types, best match first: matches in titles first, then section titles and keywords, then text. Each result SHALL show the page title, the section title when there is one, and a line of the matching text. Selecting a result SHALL open that page at that section, with the section open. Search SHALL ignore upper and lower case, SHALL match the start of words (so "gea" finds "gears"), and SHALL work with no internet. With no match, the guide SHALL say so and offer the home page.

#### Scenario: Find a feature by word
- **WHEN** the user types "chain"
- **THEN** the Chain and track page is the first result, and sections of other pages that mention chain follow

#### Scenario: A word used for something by its other name
- **WHEN** the user types "axle"
- **THEN** the Shafts and wheels page is among the results (found through its keywords)

#### Scenario: Nothing found
- **WHEN** the user types "zzzz"
- **THEN** the guide says nothing was found and shows a link to the home page

### Requirement: Show me
A control of the app named in a step (a toolbar button, a menu, a context bar button, the library, the Outline, the view cube) SHALL be shown as a chip the user can select. Selecting it SHALL flash a highlight on the real control for about two seconds, without pressing it. When the control is inside a closed menu, the highlight SHALL go on the button that opens that menu. When the control is not on screen right now (a context bar button that needs a selection, a panel hidden in this layout), the guide SHALL say in one line what makes it appear instead of highlighting anything. In the small layout, where the guide covers the view, selecting a chip SHALL close the guide first and then flash the control.

#### Scenario: Flash the Tools button
- **WHEN** the user selects the **Tools** chip in a step
- **THEN** the toolbar's Tools button flashes for about two seconds and no menu opens

#### Scenario: A button that isn't showing
- **WHEN** the user selects the **Join** chip with nothing selected
- **THEN** nothing flashes and the guide says "Select a part first, then Join shows on the context bar"

#### Scenario: On a phone
- **WHEN** the user selects the **Library** chip in the small layout
- **THEN** the guide closes and the Library button at the bottom of the screen flashes

### Requirement: Help from tool panels and dialogs
The Explode panel, the Play panel, the Band builder panel, the Audit panel, the History timeline, the chain and track builder's dialogs, the Bend sheet dialog, the build library dialog and the Offline section in Settings SHALL each have a small question mark button, named "Help with <tool>" for screen readers. Selecting it SHALL open the guide at that tool's page without closing the tool or changing what it is doing.

#### Scenario: Help from the Explode panel
- **WHEN** the Explode panel is open with the build exploded halfway and the user selects its question mark
- **THEN** the guide opens on the Explode page, and the panel stays open with the build exploded halfway

#### Scenario: Help from a dialog on a phone
- **WHEN** the user selects the question mark in the Bend sheet dialog in the small layout
- **THEN** the guide opens on the Plastic sheets page, and closing the guide shows the dialog as it was

### Requirement: Welcome card
The first time the app opens in a browser, it SHALL show one small card over the 3D view: "New here? Build your first thing in 5 minutes." with **Start** and **Not now**. **Start** SHALL open the guide on the quick start page. Either choice SHALL close the card, and the card SHALL NOT be shown again in that browser. The card SHALL NOT block the app: everything stays usable while it shows, and it SHALL also go away for good once the user opens Help any other way. The card SHALL NOT show when the app was opened by a link to a help page.

#### Scenario: First visit
- **WHEN** the app opens in a browser that has never opened it
- **THEN** the card shows, and the library, toolbar and 3D view work while it is there

#### Scenario: Not now
- **WHEN** the user selects Not now and later reloads the app
- **THEN** the card does not show

#### Scenario: Start
- **WHEN** the user selects Start
- **THEN** the card closes and the guide opens on the quick start page

### Requirement: Links to help pages
Every help page and More section SHALL have its own link: the app's address followed by `#help/<page>` or `#help/<page>/<section>`. Opening the app with such a link SHALL open the guide at that place once the app has loaded. While the guide is open the address SHALL follow the page shown, so the browser's Back button returns to the help page before, and Back from the first one closes the guide. Closing the guide SHALL remove the help part of the address. A link to a page or section that doesn't exist SHALL open the home page. Each page's header SHALL have a **Copy link** button.

#### Scenario: A teacher's link
- **WHEN** a browser opens `<site>/#help/gears`
- **THEN** the app loads with the guide open on the Gears page and no welcome card

#### Scenario: Back button
- **WHEN** the user goes from home to Quick start to Joining parts and presses the browser's Back button twice
- **THEN** the guide shows Quick start, then home, and a third Back closes the guide

#### Scenario: A link that no longer exists
- **WHEN** a browser opens `<site>/#help/no-such-page`
- **THEN** the guide opens on the home page

### Requirement: Help needs no server and no internet
The guide's text, search and pictures SHALL be part of the static site, SHALL make no request to any other site, and SHALL be part of the offline download, so every page and picture shows with no connection once **Available offline** is shown. The guide's text and code SHALL NOT be downloaded when the app opens: they load the first time the guide (or the welcome card's Start) is used, and a short "Loading help…" shows meanwhile. If they can't be loaded, the guide SHALL say so with a **Try again** button and the app SHALL keep working.

#### Scenario: Offline
- **WHEN** the site has been downloaded for offline use, the device has no connection, and the user opens the Play mode page
- **THEN** the page shows with all its pictures

#### Scenario: Not loaded until used
- **WHEN** the app opens and the user never opens Help
- **THEN** the guide's text, code and pictures are not requested

#### Scenario: Lost connection, not downloaded
- **WHEN** the connection drops before the guide was ever opened, Use offline is off, and the user selects Help
- **THEN** the guide's panel says help couldn't be loaded and offers Try again, and the build can still be edited

### Requirement: Help is readable and reachable for everyone
The guide's body text SHALL be at least 16 px, with line length no more than about 70 characters. Every control in the guide (cards, More titles, chips, the switch, pictures, links) SHALL be reachable and usable by keyboard, SHALL be at least 44 × 44 px in the medium and small layouts, and SHALL have a name for screen readers. Page titles and section titles SHALL be real headings in order. Opening the guide SHALL move keyboard focus into it and closing it SHALL return focus to where it was.

#### Scenario: Keyboard only
- **WHEN** the user opens the guide with `?` and uses only Tab, Enter and Esc
- **THEN** they can open a page, open a More section, enlarge and close a picture, and close the guide, and focus returns to the control that had it

#### Scenario: Touch targets
- **WHEN** the guide is open in the small layout
- **THEN** every card, More title, chip and header button is at least 44 px tall and wide
