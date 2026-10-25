## Purpose

Shows the build as a side-by-side stereo pair, with a separation that follows the camera's distance, so the user can see it in depth by free-viewing (parallel or cross-eyed) or with a phone VR viewer.

## ADDED Requirements

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

### Requirement: Input while stereo is on
In Stereo:
- orbit, pan and zoom SHALL work by dragging or scrolling in either half;
- a click on a part in either half SHALL select it, judged from that half's eye;
- Frame (`F`), undo, redo and the other keys SHALL keep working.

These SHALL be off while Stereo is on, and SHALL come back when another layout is picked:
- the Move gizmo and drag snapping;
- Rotate mode and its rings;
- double-click mating and hole picking;
- the copy preview;
- the view cube.

The status line SHALL say that editing is off in stereo when the user double-clicks or right-clicks a part.

#### Scenario: Orbit in stereo
- **WHEN** the user drags in the right half
- **THEN** both images orbit together around the target

#### Scenario: Select in stereo
- **WHEN** the user clicks a beam in the left half
- **THEN** the beam is selected and highlighted in both halves, with no gizmo shown

#### Scenario: Editing returns
- **WHEN** a part is selected in stereo and the user picks Single
- **THEN** the Move gizmo appears on the selected part
