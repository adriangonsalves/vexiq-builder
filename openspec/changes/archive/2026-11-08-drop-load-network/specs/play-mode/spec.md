## REMOVED Requirements

### Requirement: Fastener pullout strength and ABS impact compliance
**Reason**: Its single pullout number per joint (rated by total pin length, ~80 N for capped pins, 8 N for collars), fixed 14 ms impact window, bottoming-out boost and hand-set shares for shear, compression, clevis and hinge cases are replaced by per-end grip, bending stiffness and a whole-robot impact solve.
**Migration**: See "Fastener holding strength", "Parts bend under impact" and "Impact loads and joint failure" below. No saved builds or user settings depend on the old numbers.

## ADDED Requirements

### Requirement: Fastener holding strength
Play mode SHALL rate every joint the drop test can break from one table of holding strengths. Each value in the table SHALL be marked as assumed or measured.
- A pin, peg or standoff end SHALL grip each part it sits in by an amount that grows with the depth it is seated in that part. Only the part at the tip of that end SHALL add the extra hold of the snap ridge.
- Two parts joined by a pin SHALL separate only when the parts on one side slide off their end of the pin. The hold against that is the total grip of every part that must slide. A way off SHALL be blocked when a cap is at that end or the pin's shoulder sits between those parts and that end. The joint SHALL hold up to the weakest way off that isn't blocked.
- A Rubber Shaft Collar SHALL hold only by friction along its shaft, a few newtons and far less than a fully seated pin end.
- Spacers and washers on a shaft SHALL hold nothing when pulled; they SHALL only push back when pressed.
- A square shaft in a square opening SHALL resist turning and sideways load but SHALL NOT resist sliding along the shaft. A shaft in a round hole SHALL resist only sideways load.
- Every pin and peg joint SHALL also have a sideways strength, and prying (a part tipping on its face edge) SHALL load it as pull. Joints round a shaft (round holes, square fits, the Smart Motor socket) SHALL NOT fail sideways; they let go only by sliding off the end of the shaft.
- A tire on its hub, and a Gen 1 battery in its Brain, SHALL be held as one piece that a drop doesn't separate.
- Weak variants of pins and standoffs SHALL hold less than their regular versions.

#### Scenario: Deeper seating holds more
- **WHEN** the same pin end sits 3 mm deep in one build and 6 mm deep in another
- **THEN** the 6 mm seat holds more pull than the 3 mm seat

#### Scenario: A longer pin doesn't grip one part harder
- **WHEN** a 1x1 pin and the short end of a 1x2 pin each sit fully in the same beam
- **THEN** both ends hold the same pull against that beam

#### Scenario: Capped side can't let go
- **WHEN** two plates are joined by a capped pin and pulled apart along the pin
- **THEN** the plate under the cap stays on the pin, and the joint gives way only when the pin pulls out of the other plate

#### Scenario: Collar slides before pins let go
- **WHEN** a wheel held on its shaft by a Rubber Shaft Collar and a beam held by fully seated pins take the same pull along their axes
- **THEN** the collar slides at a much lower force than the pins pull out

### Requirement: Parts bend under impact
During a drop, beams, plates and shafts SHALL flex according to their length, width, thickness and material, so long, thin or unbraced parts bend more than short, thick or braced ones. Bending SHALL both soften the impact (spreading it over more time) and load the joints at a bent part's ends with prying.

#### Scenario: A heavier load pries harder
- **WHEN** the same arm, held to the frame by the same two pins, carries a Smart Motor at its tip in one build and a light block in another, and both are dropped from the same height
- **THEN** the pins at the arm's root take more load with the Smart Motor

#### Scenario: Bending softens the hit
- **WHEN** the same arm carrying the same weight is dropped once as it is and once made ten times stiffer
- **THEN** the stiffer arm's root pins take more load, because the flexing arm spreads the hit over more time

#### Scenario: Bracing protects an arm
- **WHEN** the same cantilevered arm is dropped with and without a brace beam from its end back to the frame
- **THEN** the braced arm's root pins take less load, and at a height where the unbraced arm's pins pop the braced arm's hold

### Requirement: Impact loads and joint failure
On floor impact, Play mode SHALL work out the load in every joint from the whole robot at once: each structural part SHALL decelerate by its own mass and the joints and bending parts that tie it to the rest, and the floor SHALL push only on parts that touch it.
- Each joint's load SHALL be split into pull along its axis, sideways load and prying. A joint SHALL fail when those loads together pass its strength.
- A pin, peg or collar pulled harder than it grips SHALL slide out gradually (a pin gripping less the further it has slid) and SHALL let go only once it has slid its whole seated depth (a collar: the rest of its shaft); a joint pushed sideways past its strength SHALL let go at once.
- A joint that fails during the impact SHALL stop carrying load at once, and its load SHALL pass to the joints still holding during the same impact.
- The result SHALL depend only on the build, the drop height and the landing. Moving or turning the whole build in space before Play mode SHALL NOT change which joints break, and a mirrored build SHALL break in the mirrored places.
- A higher drop with the same landing SHALL never break fewer joints or give a lower peak joint load.

#### Scenario: Moving the build changes nothing
- **WHEN** the same robot is dropped from 0.5 m flat, once where it was built and once moved 200 mm sideways
- **THEN** the same joints break, with the same forces to within 1%

#### Scenario: Mirrored build breaks in mirrored places
- **WHEN** a robot and its mirror image are dropped from the same height, the first on its left side and the second on its right side
- **THEN** each joint that breaks in one has its mirror partner break in the other

#### Scenario: Load passes to the joints that are left
- **WHEN** one of two pins holding an arm pulls out during an impact
- **THEN** the other pin carries the arm's load for the rest of that impact and is checked against its strength under that larger load

#### Scenario: Collars slide on side landings
- **WHEN** a wheel held on its shaft by a Rubber Shaft Collar is dropped from 0.5 m flat, and again from 0.5 m on the side that throws the wheel along its shaft
- **THEN** the collar doesn't move on the flat landing and is pushed along its shaft on the side landing, coming off only if pushed the rest of the shaft's length

#### Scenario: A brief pull loosens, a sustained pull removes
- **WHEN** a pin or collar is pulled harder than it grips for only part of the time it would take to slide out
- **THEN** it slides part way out and holds, and the report lists it as loosened with how far it slid; only a pull that lasts until it has slid out its whole seated depth (for a collar, the rest of its shaft) makes it let go

## MODIFIED Requirements

### Requirement: Drop and crash simulation
The Play panel SHALL provide a **Drop test** control with a selectable drop height (from gentle drops such as `0.15 m` up to severe drops such as `1.5 m`), a selectable landing (**Flat**, **Front**, **Back**, **Left side**, **Right side** or **Corner**, using the build's own directions with +X as Front, matching the view cube), a **Drop** action and a **Reset** action. Triggering a drop SHALL turn the robot so it lands as chosen, lift it to the chosen height above the floor, release the whole robot under gravity, and work out joint loads on first floor contact (see "Impact loads and joint failure"):
- Any part or subassembly left with no unbroken joints to the rest of its body SHALL detach into an independent rigid body that falls, tumbles and bounces on the floor, leaving with the speed and spin it had at the end of the impact. Parts fitted onto a square shaft SHALL stay on their shaft unless what holds them along it fails.
- Any part or subassembly reduced from two or more pin lines to a single pin line SHALL become a hinged body that swings under gravity about the remaining pin.
- The Play panel SHALL report:
  - the number of joints broken and parts detached
  - the peak deceleration of the robot in g and the peak joint load in newtons
  - for each broken joint, how it failed (pulled out, pried out, slid off or sheared) and its load against its strength
  - weak spots: joints that used 70% or more of their strength, or slid part way out, without breaking
- Hovering a reported joint or part SHALL highlight it.
- A **Highlight loose parts** option SHALL light up every part that came off and every part left hanging by a single pin line, for as long as the drop lasts; the report SHALL list the hanging parts.
- A **Slow motion** choice SHALL play the drop at real time, or 2, 4 or 8 times slower.
- While any holding strength or stiffness in use is an assumed value, the Drop test section SHALL say the strengths are estimates.
- Pieces that broke away SHALL collide with the rest of the robot once they move apart, so a loose part never passes through the parts it came off.
- Triggering **Reset** (or leaving Play mode) SHALL restore all broken joints and return every part to its assembled pose without modifying the build or undo history.

#### Scenario: Gentle drop survives intact
- **WHEN** a well-braced robot (such as Clawbot) is dropped flat from `0.15 m` or `0.30 m`, or Flop from `0.15 m`
- **THEN** the robot lands, remains fully assembled with zero broken joints and zero detached parts, and reports its peak deceleration and peak joint load

#### Scenario: Flop at 0.30 m keeps every part
- **WHEN** Flop is dropped flat from `0.30 m`
- **THEN** no part comes off (with the assumed strengths a pin or two may pry loose; recheck once strengths are measured)

#### Scenario: High drop pops weak pins and detaches parts
- **WHEN** a robot with a heavy cantilevered subassembly (such as Clawbot's wrist and claw) is dropped flat from `1.5 m`
- **THEN** the joints whose load passes their strength break, the subassembly they held detaches and falls independently, and the panel lists each broken joint with how it failed

#### Scenario: Weak spots shown when nothing breaks
- **WHEN** a drop leaves the robot intact but some joints used 70% or more of their strength
- **THEN** the panel lists those joints as weak spots, and hovering one highlights it

#### Scenario: Landing choice changes what is loaded
- **WHEN** the same robot is dropped from the same height once **Flat** and once on its **Left side**
- **THEN** each drop lands on the chosen face and the reported loads differ between the two

#### Scenario: Estimates notice
- **WHEN** the strength table still holds assumed values and the user opens the Drop test section
- **THEN** the section says the strengths are estimates

#### Scenario: Loose parts don't pass through the robot
- **WHEN** a hard drop knocks the Brain loose and it swings or falls against the plates it sat on
- **THEN** it stops against them instead of passing through (allowing a few millimetres where the collision outlines are simplified)

#### Scenario: Highlighting loose parts
- **WHEN** **Highlight loose parts** is on and a drop knocks parts off or leaves some hanging by one pin
- **THEN** those parts are lit up in the view until Reset, and the report lists the hanging ones

#### Scenario: Resetting or closing Play mode after a crash
- **WHEN** the user runs a drop test that detaches parts and then clicks **Reset** or closes Play mode
- **THEN** all parts return to their original assembled positions and the build history is unchanged
