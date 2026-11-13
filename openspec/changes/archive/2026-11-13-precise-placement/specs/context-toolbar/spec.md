## MODIFIED Requirements

### Requirement: Join
The Join button SHALL be called **Auto Join**, with its own icon, while the selection is lined up with something it can be pushed into (the mate a double-click would do now, with or without arrows), or is a Robot Battery that fits a Robot Brain with a free bay; otherwise it SHALL be called **Manual Join**, with a different icon, because tapping it starts hole picking. The name, icon and tip SHALL follow as the part is moved into or out of line. Both are the same button in the same place. While a target is marked and one part is selected that isn't the part the target is on, the button SHALL be Auto Join and its tip SHALL say it puts the part into the marked hole.

Tapping Join SHALL do what double-clicking the selected part does: put it into the marked target when one is set (see pin-mating), otherwise mate it with what it is lined up with, show the mate arrows when there is more than one way, or start hole picking when nothing is lined up (see pin-mating and hole-pick-insert); for a group or several parts, mate the set as double-clicking one of them does. With a Robot Battery selected and nothing lined up, Join SHALL slide it into the nearest Robot Brain it fits whose bay is free, as double-clicking that brain does. The same messages SHALL be shown as for the double-click ("Mated with …", "Nothing lined up to mate with", "Part is locked", "No free fit for … at this hole"). Double-click SHALL keep working.

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

#### Scenario: Join into the mark on a tablet
- **WHEN** a motor hole is marked with Mark a hole, the user taps a pin standing in a beam and then taps Join
- **THEN** the pin is shown seated in the marked hole and the bar turns into the wheel bar for its fits
