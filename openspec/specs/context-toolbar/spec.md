# context-toolbar Specification

## Purpose
A small column of icon buttons in the 3D view that shows what can be done right now. It gives every gesture that needs a held key, a right-click, a double-click, a hover or the mouse wheel a button that works by tap, and it shows mouse users which key does the same thing.

## Requirements

### Requirement: The context bar sits in the 3D view
The 3D view SHALL show a context bar: one column of icon-only buttons on the right edge of the working view, below the view cube. Buttons SHALL be at least 44 × 44 px in the medium and small layouts and on any screen whose main pointer is a finger, and at least 32 × 32 px otherwise. The bar SHALL NOT cover the view cube, the pills and messages at the top of the view, or a panel open along the bottom of the view (the history timeline, the Audit panel, the shortcuts strip); it ends above them. In 4-View it SHALL sit at the right edge of the working view, left of the small views. When the view is too short to show the bar's buttons in one column, the bar SHALL use more columns rather than hide buttons or scroll. In the small (phone) layout, where the view cube takes much of the narrow view, the bar SHALL sit on the left edge of the view instead, below the warning button (see "Few messages over the view on a phone"), ending above a panel along the bottom (the band builder's included); its read-out, tips and menus SHALL open to its right, and further columns SHALL grow to the right. A press on the bar SHALL NOT select or unselect parts, turn the camera or close a picking session.

The bar SHALL be hidden in Play mode, while the Explode panel is open, while a past step is shown from the history timeline, and in Stereo full screen.

#### Scenario: Desktop
- **WHEN** the app opens in a 1440 px wide window with nothing selected
- **THEN** the bar shows as one column on the right edge of the 3D view, under the view cube

#### Scenario: Audit panel open
- **WHEN** the Audit panel slides up over the bottom of the view
- **THEN** the bar ends above the panel, using a second column if its buttons no longer fit in one

#### Scenario: Phone turned sideways
- **WHEN** the app is used in a window 844 × 390 px with a part selected
- **THEN** every button of the bar is on screen, in more than one column, and none is under the view cube

#### Scenario: Phone
- **WHEN** the app is used in a window 390 × 844 px with a part selected
- **THEN** the bar is on the left edge of the view, clear of the view cube, and every button is on screen

#### Scenario: 4-View
- **WHEN** the layout is 4-View
- **THEN** the bar sits at the right edge of the working view and doesn't cover the small views

#### Scenario: Play mode
- **WHEN** Play mode is turned on
- **THEN** the bar is hidden, and it comes back when Play mode is closed

### Requirement: The bar shows the buttons that apply now
The bar SHALL show these buttons, top to bottom, each only in the situation given:

| Button | Shown when |
|---|---|
| Move | always |
| Rotate | always |
| Add to selection | always |
| Mark a hole | always |
| Auto Join or Manual Join | one or more parts are selected (see "Join") |
| Stamp copies | exactly one part is selected and it has a pin, peg or shaft, or is a bore part (see copy-insert) |
| World arrows | exactly one part is selected and its Move arrows or Rotate rings are showing |
| Free move | one or more parts are selected, in Move mode |
| Turn step | one or more parts are selected, in Rotate mode |
| Grow selection | one or more parts are selected |
| One part of a group | the selection is one whole group |
| Duplicate | one or more parts are selected |
| Delete | one or more parts are selected |

A button that doesn't apply SHALL NOT be shown. A button that applies but can't act right now (the part is locked, the part is a strung band) SHALL be greyed and its tip SHALL say why. While a wheel session is running (see "The bar turns into a wheel") these buttons SHALL be replaced by the wheel bar.

#### Scenario: Nothing selected
- **WHEN** nothing is selected
- **THEN** the bar shows Move, Rotate, Add to selection and Mark a hole, and nothing else

#### Scenario: A pin selected in Move mode
- **WHEN** a 0x2 Connector Pin is selected in Move mode
- **THEN** the bar shows Move, Rotate, Add to selection, Mark a hole, Join, Stamp copies, World arrows, Free move, Grow selection, Duplicate and Delete

#### Scenario: A beam selected
- **WHEN** a 2x8 Beam is selected
- **THEN** Stamp copies is not shown

#### Scenario: Rotate mode
- **WHEN** a part is selected and Rotate mode is turned on
- **THEN** Free move is replaced by Turn step

#### Scenario: A group selected
- **WHEN** a whole group is selected
- **THEN** One part of a group is shown, and World arrows and Stamp copies are not

#### Scenario: A locked part
- **WHEN** a locked part is selected
- **THEN** Join is greyed and its tip says the part is locked, and World arrows is not shown because the part has no arrows

#### Scenario: Selection cleared
- **WHEN** a part is selected and the user clears the selection
- **THEN** World arrows, Free move, Join, Duplicate and Delete are gone from the bar

### Requirement: Move and Rotate are on the bar
The bar's Move and Rotate buttons SHALL set the Move or Rotate mode, and the one that is on SHALL be shown as on. They SHALL do exactly what `W`, `E` and a right-click on the selected part do (see rotate-mode), and SHALL follow the mode when it is changed any other way. With a strung band selected both SHALL be greyed, with the tip that a band follows its spots.

#### Scenario: Tap Rotate
- **WHEN** a beam is selected in Move mode and the user taps Rotate on the bar
- **THEN** the rotation rings appear round the beam and the Rotate button shows as on

#### Scenario: Right-click follows
- **WHEN** the user right-clicks the selected part in Move mode
- **THEN** the bar's Rotate button shows as on

### Requirement: Buttons light while their key is held
While a key is held (and the user is not typing in a field), the buttons that stand in for it SHALL show as on:
- Shift: Add to selection, and Grow selection;
- Alt: Mark a hole, World arrows and Free move;
- Ctrl or Cmd: Stamp copies;
- Shift and Alt together: One part of a group only.

Letting go of the key, or the window losing focus, SHALL put each button back to how it was. A button turned on by tapping SHALL stay on when a key is pressed and let go. A button SHALL act as on when either it was tapped on or its key is held.

#### Scenario: Hold Alt
- **WHEN** a part is selected in Move mode and the user holds Alt
- **THEN** Mark a hole, World arrows and Free move show as on, and go back to off when Alt is let go

#### Scenario: Tapped on, then a key
- **WHEN** World arrows was turned on by tapping and the user presses and lets go of Alt
- **THEN** World arrows is still on

### Requirement: Add to selection
Tapping Add to selection SHALL turn Select mode on or off (see multi-select): while on, a click or tap on a part adds or removes it, and one on empty space keeps the selection. It SHALL be the same switch as the Select menu's Select mode, so each shows the other's state, and `Esc` turns it off.

#### Scenario: Pick three parts by tap
- **WHEN** the user taps Add to selection and then taps three parts in turn
- **THEN** all three are selected

#### Scenario: Same switch as the menu
- **WHEN** the user turns Select mode on from the Select menu
- **THEN** the bar's Add to selection shows as on

### Requirement: One part of a group
Tapping One part of a group SHALL arm it for one pick: the next click or tap on a part in the 3D view SHALL select just that part and not its group, as Shift+Alt+click does, replacing the selection, or adding to it when Add to selection is on. It SHALL then turn off. Tapping it again or `Esc` SHALL turn it off without picking.

#### Scenario: Pick one beam of a group
- **WHEN** the Claw group is selected, the user taps One part of a group and then taps one of its beams
- **THEN** only that beam is selected, and One part of a group is off

### Requirement: Mark a hole
Tapping Mark a hole SHALL arm it. While it is armed:
- with a mouse, the hole face or free pin, peg or shaft end nearest the pointer SHALL be lit as it is with Alt held (see target-hole-placement);
- a click or one tap on such a hole or end SHALL set it as the target, move the target there, or clear the target when it is the target itself, exactly as Alt+click does, without changing the selection. On a touch screen the nearest hole or end within about 24 px of the tap is used;
- a hole that already has a part in it SHALL set nothing and show the same message as Alt+click, and the button SHALL stay armed;
- a click or tap away from every hole and end SHALL do nothing.

The button SHALL turn off once a target is set, moved or cleared, when it is tapped again, or on `Esc`. While a target is set the button SHALL show a mark, so the user can see one is set.

#### Scenario: Mark a hole by tap
- **WHEN** nothing is selected, the user taps Mark a hole and then taps the top of a free beam hole
- **THEN** the hole is marked as the target, the selection is unchanged, and Mark a hole is off with its mark showing

#### Scenario: Add into the marked hole
- **WHEN** a hole is marked and the user taps a 1x1 Connector Pin in the library
- **THEN** the pin is shown seated in the marked hole at its best fit, and the bar turns into the wheel bar for its fits

#### Scenario: Taken hole
- **WHEN** Mark a hole is armed and the user taps a hole with a pin in it
- **THEN** no target is set, the message says the hole already has a part in it, and the button is still armed

### Requirement: Join
The Join button SHALL be called **Auto Join**, with its own icon, while the selection is lined up with something it can be pushed into (the mate a double-click would do now, with or without arrows), or is a Robot Battery that fits a Robot Brain with a free bay; otherwise it SHALL be called **Manual Join**, with a different icon, because tapping it starts hole picking. The name, icon and tip SHALL follow as the part is moved into or out of line. Both are the same button in the same place.

Tapping Join SHALL do what double-clicking the selected part does: mate it with what it is lined up with, show the mate arrows when there is more than one way, or start hole picking when nothing is lined up (see pin-mating and hole-pick-insert); for a group or several parts, mate the set as double-clicking one of them does. With a Robot Battery selected and nothing lined up, Join SHALL slide it into the nearest Robot Brain it fits whose bay is free, as double-clicking that brain does. The same messages SHALL be shown as for the double-click ("Mated with …", "Nothing lined up to mate with", "Part is locked"). Double-click SHALL keep working.

#### Scenario: Auto or Manual
- **WHEN** a pin is selected with its tip lined up over a beam hole
- **THEN** the button is Auto Join with the Auto Join icon, and after the pin is dragged away from every hole it is Manual Join with the Manual Join icon

#### Scenario: Join a lined-up pin
- **WHEN** a pin is selected with its tip lined up over a beam hole and the user taps Join
- **THEN** the pin goes into the hole until it touches, as one history step

#### Scenario: Join with nothing lined up
- **WHEN** a pin is selected far from any hole and the user taps Join
- **THEN** hole picking starts for the pin and the bar turns into the wheel bar

#### Scenario: Join a battery
- **WHEN** a Robot Battery is selected, one Robot Brain with a free bay is in the build, and the user taps Join
- **THEN** the battery slides into the brain's bay

### Requirement: Stamp copies
Tapping Stamp copies SHALL turn it on. While it is on the view SHALL behave as it does with Ctrl or Cmd held (see copy-insert): the hole near the pointer is lit, a see-through copy is shown at the best fit, and the fits can be stepped through. With a mouse, one click on a lit hole that isn't taken SHALL insert a copy there, as Ctrl/Cmd+double-click does; on a touch screen a copy is inserted as "Touch taps show the fit before placing" says. Clicks and taps SHALL NOT change the selection while it is on. It SHALL stay on after a copy is inserted, so more can be stamped, and SHALL turn off when it is tapped again, on `Esc`, when the selection changes, or when Explode or Play mode is turned on. Holding Ctrl or Cmd and double-clicking SHALL keep working as before.

#### Scenario: Stamp three pins with a mouse
- **WHEN** a 0x2 Connector Pin is selected, the user clicks Stamp copies and then clicks three free beam holes in turn
- **THEN** three new pins are seated in those holes, the original pin is still selected, and the history has three "Insert copy of …" steps

#### Scenario: Selection is kept
- **WHEN** Stamp copies is on and the user clicks another part away from any hole
- **THEN** the selection doesn't change

#### Scenario: Turn it off
- **WHEN** Stamp copies is on and the user presses `Esc`
- **THEN** the preview goes away, Stamp copies is off and nothing was added

### Requirement: World arrows
World arrows SHALL be shown only while exactly one part is selected and its Move arrows or Rotate rings are on screen; it SHALL NOT be shown with nothing selected, for a group or several parts (their arrows always follow the world), or for a part that shows no arrows (locked, hidden, a strung band). Tapping World arrows SHALL turn it on or off. While it is on, the Move arrows and the Rotate rings of a single selected part SHALL follow the world's X, Y and Z, as they do while Alt is held; while it is off they follow the part's own axes. The switch SHALL NOT take effect in the middle of a drag or a ring turn. It SHALL stay as set when the selection changes and on `Esc`, also while the button isn't shown. Its icon SHALL show which of the two is on.

#### Scenario: Slide a tilted beam straight up
- **WHEN** a beam turned 30° is selected in Move mode and the user turns World arrows on
- **THEN** the arrows point along the world's X, Y and Z instead of along the beam

#### Scenario: It stays on
- **WHEN** World arrows is on and the user selects another single part
- **THEN** that part's arrows follow the world's axes too

#### Scenario: Not shown without arrows
- **WHEN** nothing is selected, or a group is selected
- **THEN** the bar has no World arrows button

### Requirement: Free move
Tapping Free move SHALL turn it on or off. While it is on, dragging a part or a set SHALL NOT pull it onto holes, straighten it or turn a gear to mesh: everything that holding Alt during a drag turns off (see drag-hole-snap, gear-meshing and multi-select). Pitch steps SHALL still apply. Free move SHALL NOT change which axes the arrows follow. It SHALL stay as set when the selection changes and on `Esc`, and its icon SHALL show whether pulling is on or off.

#### Scenario: Place a beam between holes
- **WHEN** Free move is on and the user drags a beam close to another beam's holes
- **THEN** the beam is not pulled onto them and moves in pitch steps from where the drag started

#### Scenario: Arrows unchanged
- **WHEN** a tilted part is selected and the user turns Free move on
- **THEN** the Move arrows still follow the part's own axes

### Requirement: Turn step
In Rotate mode the bar SHALL show a Turn step button with the current rotation snap on it (15°, 45°, 90° or Free). Tapping it SHALL show the four choices; picking one SHALL set the rotation snap for ring drags, the ring wheel and the tick marks (see rotate-mode), close the choices, and add no history step.

#### Scenario: Set 45°
- **WHEN** Rotate mode is on, the user taps Turn step and picks 45°
- **THEN** the button reads 45° and dragging a ring turns the part in 45° steps

### Requirement: Grow selection
Tapping Grow selection SHALL open a wheel session for the selection's layers. Each step up SHALL add one layer of joined parts and each step down SHALL take the last layer off, with the same rules, limits and "Layer N · M parts" message as Shift + mouse wheel (see multi-select). A **Pins only** switch in the wheel bar SHALL make the steps follow pins, pegs and shafts seated in holes only, as Shift + Ctrl/Cmd + wheel does; switching it SHALL start again from the current selection. The tick SHALL close the session and keep the selection. Any other change to the selection SHALL close it. Shift + wheel SHALL keep working without opening it.

#### Scenario: Grow two layers by touch
- **WHEN** a 2x8 beam with four pins in it is selected, the user taps Grow selection and drags the wheel up two steps
- **THEN** after the first step the beam and its pins are selected, and after the second the plates those pins go into are selected too

#### Scenario: Shrink back
- **WHEN** the selection has been grown two layers and the user drags the wheel down one step
- **THEN** the second layer is taken off

### Requirement: Duplicate and Delete
With one or more parts selected, the bar SHALL show Duplicate and Delete as its last two buttons, Delete last, set apart from the buttons above by a divider. Duplicate SHALL do what the `D` key and the Inspector's Clone do: add a copy of the part, or of the whole selection keeping the parts' places relative to one another, one pitch along, select the copy, as one history step. Delete SHALL do what the `Del` key and the Inspector's Delete do: remove every selected part as one history step and clear the selection. Neither SHALL ask first; one undo brings the parts back.

#### Scenario: Duplicate a part by tap
- **WHEN** a 2x8 Beam is selected and the user taps Duplicate
- **THEN** a copy of the beam appears one pitch along and is selected, and the history has one new step

#### Scenario: Delete a group by tap
- **WHEN** a group of five parts is selected and the user taps Delete
- **THEN** the five parts are removed, nothing is selected, and one undo brings them back

### Requirement: The bar turns into a wheel
While a wheel session is running, the bar's buttons SHALL be replaced by a wheel bar: a thumb wheel drawn edge-on, a read-out of the current value, a step button at each end of the wheel, and the session's tick and cross where it has them. The sessions are listed in "Wheel sessions".
- Dragging the wheel up or down SHALL step once for every 24 px of travel, up being the same direction as turning the mouse wheel away from the user. It SHALL NOT keep spinning after the finger lifts.
- Each step button SHALL step once.
- Turning the mouse wheel over the 3D view SHALL keep doing what it does today in that session, and the bar's wheel SHALL turn with it and the read-out SHALL follow. Turning the mouse wheel over the bar's wheel SHALL step too.
- Dragging the bar's wheel SHALL NOT turn, pan or zoom the camera.
- While there is nothing to step (no hole lit yet, or only one fit) the wheel SHALL be greyed, and the read-out SHALL say what to do first (for example "Tap a hole").
- The cross SHALL do what `Esc` does in that session, and the tick what the session's row in "Wheel sessions" says.

When the session ends the normal buttons SHALL come back.

#### Scenario: The wheel shows the wheel's job has changed
- **WHEN** hole picking starts
- **THEN** the bar is replaced by the wheel, a tick and a cross

#### Scenario: Drag the wheel
- **WHEN** a hole with 6 fits is lit, fit 1 is shown, and the user drags the bar's wheel up 48 px
- **THEN** fit 3 is shown, the read-out says "3 / 6", and the camera hasn't moved

#### Scenario: The mouse wheel turns the bar's wheel
- **WHEN** a hole with 6 fits is lit and the user turns the mouse wheel one notch over the 3D view
- **THEN** the next fit is shown, the bar's wheel turns one step and the read-out says "2 / 6"

#### Scenario: Nothing to step yet
- **WHEN** hole picking has started and no hole is lit
- **THEN** the wheel and the tick are greyed and the cross works

### Requirement: Wheel sessions
The wheel bar SHALL show in these sessions, with these controls:

| Session | Runs while | A step | Read-out | Tick | Cross |
|---|---|---|---|---|---|
| Fits | hole picking (one part or a set), a library part is being placed, a part is shown at the marked hole, or Stamp copies is on. Also while Ctrl or Cmd is held with a hole lit | the next or previous fit (as the mouse wheel, `R` and `Shift+R`) | "i / N" | puts the part in at the fit shown (as a click on the lit hole); for Stamp copies, inserts a copy and keeps going | ends the session with nothing changed (as `Esc`); for Stamp copies, turns it off |
| Bend fits | Bend sheet by holes is showing a fit | the next or previous fit | "i / N" | keeps the bend (as `Enter`) | drops the fit (as `Esc`) |
| Ring | a rotate ring is selected | one rotation snap step either way (5° when Free), as the mouse wheel | the ring's letter and angle, for example "Z 45°" | unselects the ring, saving the turn | not shown |
| Layers | Grow selection is open | one layer added or taken off | "Layer N · M" | closes the session | not shown |
| Band spots | the band builder is open and a spot is lit | the next or previous spot near the lit one (as the mouse wheel and `R`) | the spot's name | adds the lit spot (as a click on it) | not shown (the band panel has Done, Back and close) |

In the Ring session the wheel bar SHALL also show Turn step and, for a single part, World arrows. While mate arrows are shown and no other session is running, the bar SHALL show only a cross, which hides the arrows as `Esc` does. While Bend sheet by holes is waiting for the sheet hole or the hole to bend onto (no fit shown yet), the bar SHALL show only a cross, which stops Bend sheet as `Esc` and the banner's Stop do.

#### Scenario: Keep a fit with the tick
- **WHEN** a pin is being picked into a lit beam hole and the user taps the tick
- **THEN** the pin is inserted at the fit shown, as one history step, and the normal buttons come back

#### Scenario: Cancel with the cross
- **WHEN** hole picking is running and the user taps the cross
- **THEN** picking ends, nothing has moved and the history has no new step

#### Scenario: Turn a ring by wheel on a tablet
- **WHEN** Rotation snap is 15°, the user taps the X ring and drags the bar's wheel up three steps
- **THEN** the part turns 45° around X and the read-out says "X 45°"

#### Scenario: Step through bend fits
- **WHEN** Bend sheet by holes shows "Fit 1 of 2" and the user taps the wheel's upper step button
- **THEN** fit 2 is shown, and tapping the tick keeps it as one history step

#### Scenario: Mate arrows
- **WHEN** a corner connector with two ways to mate is joined and its arrows are shown
- **THEN** the bar shows only a cross, and tapping it hides the arrows

#### Scenario: Stop Bend sheet from the bar
- **WHEN** Bend sheet by holes is waiting for the sheet hole and the user taps the bar's cross
- **THEN** Bend sheet stops, as with its Stop button

### Requirement: Touch taps show the fit before placing
A finger or pen can't hover, so for touch and pen input in a Fits session and in the band builder:
- a tap within about 24 px of a hole, axle end or band spot SHALL light it and show its first fit (or the see-through band), as moving the mouse there does, and SHALL NOT place anything;
- a second tap on the same lit hole or spot, or the tick, SHALL place it, as a mouse click does;
- a tap on another hole or spot SHALL move the light and the preview there;
- a tap that is near no hole or spot SHALL change nothing: the session keeps running and the preview stays. Only the cross (or `Esc`) ends it;
- what is lit SHALL stay lit after the finger lifts.

A part shown at the marked hole SHALL be kept with the tick or a tap on the marked hole, and taken away with the cross; other taps in the view SHALL change nothing.

One tap SHALL be enough, with no preview first, to mark a hole (see "Mark a hole"), to pick the sheet hole and the hole to bend onto in Bend sheet by holes, to click a mate arrow, and to select a rotate ring or an anchor line. Mouse input SHALL keep working as before: moving the pointer previews, a click places, and a click away from every hole ends hole picking.

#### Scenario: Two taps to insert
- **WHEN** hole picking is running for a pin and the user taps a free beam hole on a tablet
- **THEN** the hole is ringed and the see-through pin is shown, nothing is inserted, and a second tap on that hole inserts the pin

#### Scenario: A missed tap
- **WHEN** a hole is lit during hole picking and the user taps empty space
- **THEN** picking is still running and the same hole is still lit

#### Scenario: Bend hole in one tap
- **WHEN** Bend sheet by holes is waiting for the sheet hole and the user taps one of the sheet's holes
- **THEN** that hole is marked as the one to anchor

#### Scenario: Band spot
- **WHEN** the band builder is open and the user taps a standoff on a tablet
- **THEN** the standoff's spot is lit with the see-through band shown, and tapping it again adds it to the route

#### Scenario: Mouse unchanged
- **WHEN** hole picking is running and the user clicks a lit hole with a mouse
- **THEN** the part is inserted with that one click

### Requirement: Every button explains itself
Every button on the bar SHALL have an icon that pictures what it does, different from every other icon on the bar and in the top toolbar, and an accessible name. A button that is on SHALL look different from one that is off without relying on colour alone.

Resting the mouse on a button for about half a second, or moving keyboard focus to it, SHALL show a tip with the button's name, one short line saying what it does, and the keys or mouse gesture that do the same (for example "Alt + click"). On a touch screen, pressing and holding a button for about half a second SHALL show the tip with the name and the line, without the keys, and lifting the finger SHALL NOT press the button. The tip SHALL stay inside the window and go away when the pointer leaves or the finger lifts.

#### Scenario: Hover shows the shortcut
- **WHEN** the user rests the mouse on Stamp copies
- **THEN** a tip shows "Stamp copies", a line saying it puts a copy of the part in each hole clicked, and "Ctrl/Cmd + double-click"

#### Scenario: Press and hold
- **WHEN** the user presses and holds Mark a hole on a tablet for a second and lifts
- **THEN** the tip was shown and Mark a hole is not armed

### Requirement: Messages name the controls in use
When the last press in the 3D view was by touch or pen, the banners and hints for hole picking, placing, the copy preview, Bend sheet by holes and the band builder SHALL name taps and the bar's wheel, tick and cross, and SHALL NOT name keys, the mouse wheel, double-clicks or right-clicks. After a press with a mouse they SHALL read as they do today.

#### Scenario: Hole picking on a tablet
- **WHEN** hole picking starts after the user tapped Join on a touch screen
- **THEN** the banner tells the user to tap a hole, turn the wheel for other fits and tap the tick, and doesn't mention `R`, `Esc` or the mouse wheel

#### Scenario: Back to the mouse
- **WHEN** the user then clicks in the view with a mouse and starts hole picking again
- **THEN** the banner names the wheel, `R` and `Esc` as before

### Requirement: Few messages over the view on a phone
In the small (phone) layout the 3D view SHALL NOT show the pills along its top (the pitch note, the selection count, the selected part's name, the picking banner), the Bend sheet banner, or the strip messages that report what was done ("Mated with …", "Inserted …"), so the build stays in view; the wheel bar's read-out says which fit is shown. Warnings and errors (a hole already taken, a part locked, a blocked way in, an overlapping part, a refused bend) SHALL instead show as one small warning button at the top left of the view, with how many there are. Tapping it SHALL open a short list of them, each with the button it carries today (for example Revert Pose for an overlapping part), and tapping it again or the list's close button SHALL hide the list. A warning that comes and goes with what is shown (a lit hole that is taken, an overlapping part) SHALL stay in the list while it holds; one that reports a refused action SHALL stay until the list has been opened and closed. The medium and large layouts SHALL show their messages as before.

#### Scenario: Scrubbing fits on a phone
- **WHEN** hole picking runs in a window 390 px wide and the user steps through fits with the wheel
- **THEN** no banner or pill covers the top of the view, and the wheel bar's read-out shows "2 / 6"

#### Scenario: A warning on a phone
- **WHEN** on a phone the user taps a hole that already has a part in it during hole picking
- **THEN** the warning button shows with 1, and tapping it shows "That hole already has a part in it"; tapping it again hides the list

#### Scenario: Tablet unchanged
- **WHEN** the same happens in a window 1024 px wide
- **THEN** the banner shows the warning over the view as before, and there is no warning button

### Requirement: The bar's switches are not part of the build
Turning a bar button on or off, arming one, or opening a wheel session SHALL NOT add a history step and SHALL NOT be saved with the build or sent to other open tabs. World arrows, Free move, Add to selection, Stamp copies and the armed buttons SHALL all be off when the app is opened or reloaded. What a button then does to the build (a join, an inserted copy, a kept fit) SHALL be saved exactly as the gesture it stands in for.

#### Scenario: Toggle and undo
- **WHEN** the user turns Free move on and presses Ctrl/Cmd+Z
- **THEN** the last change to the build is undone and Free move is still on

#### Scenario: Reload
- **WHEN** World arrows is on and the app is reloaded
- **THEN** World arrows is off
