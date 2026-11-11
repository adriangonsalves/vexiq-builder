## MODIFIED Requirements

### Requirement: Entering and leaving Rotate mode
Right-clicking the selected part SHALL switch between Move and Rotate mode. With a group or several parts selected, right-clicking any selected part SHALL do the same, and the rings turn the whole set about its centre. A right-click counts only when the pointer moves less than 5 px between press and release and a selected part is anywhere under the pointer (including behind another part); a right-drag SHALL keep panning the camera and SHALL NOT change the mode. The browser's context menu SHALL NOT open over the viewport. Right-clicking a part that is not selected, or empty space, SHALL do nothing. The `E` key, the context bar's Rotate button (see context-toolbar) and the assistant's viewport setting `transformMode: 'rotate'` SHALL enter the same Rotate mode; the `W` key and the context bar's Move button SHALL leave it.

#### Scenario: Right-click the selected part
- **WHEN** a beam is selected in Move mode and the user right-clicks it
- **THEN** Rotate mode is on, the Move arrows are gone, and the rotation rings are shown around the beam

#### Scenario: Right-click a selected group
- **WHEN** a group is selected in Move mode and the user right-clicks one of its parts
- **THEN** Rotate mode is on and the rings are shown around the group's centre

#### Scenario: Right-click again
- **WHEN** Rotate mode is on and the user right-clicks the selected part
- **THEN** Move mode is on again and the Move arrows are shown

#### Scenario: Right-drag pans
- **WHEN** the user holds the right button on the selected part and drags 40 px
- **THEN** the camera pans and the mode does not change

#### Scenario: No browser menu
- **WHEN** the user right-clicks anywhere in the viewport
- **THEN** the browser's context menu does not appear

#### Scenario: Keyboard shortcut
- **WHEN** a part is selected and the user presses `E`
- **THEN** the same rotation rings appear as with a right-click

#### Scenario: Context bar button
- **WHEN** a part is selected and the user taps Rotate on the context bar
- **THEN** the same rotation rings appear as with a right-click
