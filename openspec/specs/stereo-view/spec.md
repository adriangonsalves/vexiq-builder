# stereo-view Specification

## Purpose
Shows the build as a side-by-side stereo pair, with a separation that follows the camera's distance, so the user can see it in depth by free-viewing (parallel or cross-eyed) or with a phone VR viewer.

## Requirements

### Requirement: Side-by-side stereo pair
In the Stereo layout, the viewport SHALL be split into two equal halves, side by side. Each half SHALL show the main camera's view from one eye position. The two eye positions SHALL be offset horizontally, to the camera's left and right, and the cameras SHALL stay parallel and not toe in. Both images SHALL meet at the orbit target, so the target appears at screen depth, nearer things in front and farther things behind.

Stereo SHALL always use perspective. When the main view is orthographic, it SHALL show perspective in stereo and go back to orthographic when stereo is turned off.

#### Scenario: Turn on stereo
- **WHEN** the user picks Stereo
- **THEN** two slightly different images of the build appear side by side, each half the width, centered on the same target

#### Scenario: Orthographic is kept
- **WHEN** the view is orthographic, and the user turns stereo on and then picks Single
- **THEN** stereo shows perspective images, and Single is orthographic again

### Requirement: Separation follows the distance
The eye separation SHALL be about 1/30 of the distance from the camera to the orbit target, multiplied by the stereo depth setting (1 by default, 0.25 to 3). It SHALL update every frame as the user zooms, orbits or frames, so moving in or out keeps the depth comfortable. A depth control SHALL be shown in the toolbar while Stereo is on.

#### Scenario: Zoom keeps depth comfortable
- **WHEN** the user zooms from 600 mm to 150 mm away from the target
- **THEN** the separation shrinks from about 20 mm to about 5 mm

#### Scenario: More depth
- **WHEN** the user sets the depth to 2
- **THEN** the separation doubles at the same distance

### Requirement: Parallel and cross-eyed viewing
By default, the left half SHALL show the left eye's image and the right half the right eye's (parallel viewing, phone VR viewers). A Cross-eyed toggle shown while Stereo is on SHALL swap the halves. With cross-eyed viewing, the right eye looks at the left half, so the left half then shows the right eye's image.

#### Scenario: Cross-eyed
- **WHEN** the user turns on Cross-eyed
- **THEN** the image that was on the right is now on the left, and the other way round

### Requirement: Full editing in either half
Stereo SHALL be a full workbench. The user SHALL be able to work in either picture: the half under the pointer is the working half. Pointing, clicking and dragging in a half SHALL be judged from that half's eye, so what the pointer touches is what that picture shows under it. The working half SHALL switch when the pointer moves into the other half with no button held. It SHALL NOT switch in the middle of a drag, ring turn or other gesture.

In Stereo, everything SHALL work as in Single:
- orbit, pan and zoom;
- clicking to select;
- the Move gizmo with drag snapping (grid, holes, flush faces, Alt to turn snapping off) and plane handles;
- Rotate mode (right-click), with ring drags, wheel turns and typed angles;
- double-click mating with direction arrows;
- hole picking;
- the Ctrl/Cmd copy preview and copy insert;
- every key (Frame, undo, redo and the rest).

The gizmo, rotate rings, mate arrows, hole highlights and pick and copy previews SHALL be drawn in both pictures, so they are seen in depth with the parts. The angle labels of the rotate rings SHALL be shown in the working half. The view cube SHALL stay hidden in Stereo.

#### Scenario: Orbit in stereo
- **WHEN** the user drags empty space in the right half
- **THEN** both images orbit together around the target

#### Scenario: Move in stereo
- **WHEN** a beam is selected in Stereo and the user drags its Move gizmo arrow in the left half near a hole
- **THEN** the beam moves along that axis and snaps to the hole as in Single, and both pictures show it moving

#### Scenario: Work in the other half
- **WHEN** the user moves the pointer from the left picture into the right one and drags the gizmo there
- **THEN** the gizmo responds to the right picture, judged from the right eye

#### Scenario: Mate and rotate in stereo
- **WHEN** a lined-up pin is selected in Stereo and the user double-clicks it, then right-clicks it and drags a ring
- **THEN** the pin mates into the hole, then turns in Rotate mode, as in Single

### Requirement: Distraction-free full screen
While Stereo is on, a Full screen button SHALL fill the whole screen with the stereo pair, with nothing else on screen:
- no toolbar, side panels or timeline;
- no on-screen labels, status pills or shortcuts bar.

The pair SHALL fill the screen: each half takes half its width and its full height. The app SHALL ask the browser for full screen. When the browser refuses (for example inside a frame), the pair SHALL still fill the whole browser window.

A short hint ("Esc to exit full screen") SHALL show for about 3 seconds after entering, then fade away.

In full screen, everything SHALL work as in Stereo, editing included.

When hole picking, mate arrows or a selected ring is active, `Esc` SHALL end that first, as it does outside full screen. Otherwise `Esc` SHALL leave full screen and SHALL NOT also deselect or end anything else. Where the browser itself handles `Esc` to leave its full screen, it may leave full screen at once. Leaving full screen, or the layout changing away from Stereo (for example over MCP), SHALL bring the normal screen back with the stereo settings unchanged. The full-screen state SHALL NOT be saved.

#### Scenario: Enter full screen
- **WHEN** Stereo is on and the user clicks Full screen
- **THEN** the two pictures fill the screen side by side, with no toolbar, panels, pills or shortcuts bar, and a hint shows briefly

#### Scenario: Leave with Esc
- **WHEN** the user presses Esc in full screen with a part selected
- **THEN** the normal screen comes back in Stereo, and the part is still selected

#### Scenario: Orbit in full screen
- **WHEN** the user drags in full screen
- **THEN** both pictures orbit together
