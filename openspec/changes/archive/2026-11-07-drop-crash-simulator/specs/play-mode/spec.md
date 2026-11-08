## ADDED Requirements

### Requirement: Fastener pullout strength and ABS impact compliance
Play mode SHALL assign an axial pullout force threshold to each seated pin, peg, standoff, and shaft retention joint according to its fastener geometry and engagement depth:
- Rubber Shaft Collars (`openingKind === 'collar_hole'`) SHALL have a nominal axial friction slip threshold of approximately 8 N on shafts.
- Short `1x1` connector pins and integral corner-connector or traction-pad pegs SHALL have a nominal axial pullout threshold of approximately 20 N (with full engagement reached at `2.4 mm` for integral pegs and `5.0 mm` for discrete pins).
- Longer connector pins (`1x2`, `2x2`, `3x`) and standoffs SHALL have a higher nominal axial pullout threshold of approximately 35–40 N.
- Capped pins SHALL resist pullout up to approximately 80 N in the direction blocked by the cap and approximately 20–34 N from the uncapped end.
- Engagement depth SHALL scale the pullout threshold proportionally when a pin is only partially seated.
During a drop or crash impact, the physics simulation SHALL model ABS plastic and tire compliance over the impact duration ($\Delta t \approx 14\text{ ms}$, with nonlinear hard-stop bottoming-out amplification above `0.45 m` drop height) and evaluate directional pin and collar loads accounting for:
- **Axial tension vs. radial shear and vertical compression**: Horizontal pins carry vertical drop forces primarily in radial shear against the hole wall, and vertical pins or standoffs carrying a subassembly resting above them experience axial compression during primary impact rather than hanging pullout tension.
- **Clevis / boxed capture vs. single-sided cantilevers**: Subassemblies captured in double shear between left and right plates (`axialSpan > 20 mm`), multi-axis joints, or multi-part bridges resist prying, whereas single-sided 2-pin lap-jointed cantilevers experience flexural plate whip and lever-arm prying.
- **Free hinge rotation and multi-hinge load sharing**: Hinged mechanisms rotate freely about their hinge axis so in-plane torque does not pry the hinge pin out, and parallel hinges supporting the same child body share the impact load across all supporting pins.

#### Scenario: Short 1x1 pin vs longer 1x2 or 2x2 pin under drop impact
- **WHEN** two identical cantilevered subassemblies are dropped from the same height, one held by short `1x1` connector pins (~20 N pullout) and the other held by longer `2x2` connector pins or standoffs (~35–40 N pullout)
- **THEN** the `1x1` pin joint exceeds its pullout threshold and pops out at a lower drop height than the `2x2` pin or standoff joint

#### Scenario: Lever-arm prying on a cantilevered part
- **WHEN** a cantilevered assembly held by a single-sided pin joint hits the floor or experiences high drop deceleration with closely spaced pins
- **THEN** the bending moment and plate whip amplify the axial pullout load on the outer pin, causing it to pop out when the prying force exceeds its pullout threshold

### Requirement: Drop and crash simulation
The Play panel SHALL provide a **Drop test** control with a selectable drop height (from gentle drops such as `0.15 m` up to severe drops such as `1.5 m`), a **Drop** action, and a **Reset** action. Triggering a drop SHALL lift the robot to the chosen height above the floor plane, release the entire robot under gravity with realistic ABS restitution and slight impact tilt, and evaluate pin joint loads on floor impact:
- Any pin joint whose axial pullout load exceeds its pullout threshold SHALL break, cascading redistributed load to surviving pins.
- Any part or subassembly that loses all fixed pin connections to its parent body SHALL detach into an independent dynamic rigid body that falls, tumbles, and bounces on the floor, while parts fitted onto a square shaft SHALL remain bonded to their shaft.
- Any part or subassembly reduced from two or more pin lines to a single pin line SHALL become a hinged body that swings under gravity about the remaining pin.
- The Play panel SHALL report the outcome of the drop (number of popped pins, number of detached parts, and peak pin force in newtons) and highlight affected parts when hovered.
- Triggering **Reset** (or leaving Play mode) SHALL restore all broken joints and return every part to its assembled pose without modifying the build or undo history.

#### Scenario: Gentle drop survives intact
- **WHEN** a well-braced robot (such as Clawbot or Flop) is dropped from a low or moderate height (`0.15 m` or `0.30 m`) where directional pin pullout loads remain below 20 N
- **THEN** the robot falls onto the floor, bounces with slight ABS flex, remains fully assembled with zero popped pins and zero detached parts, and reports the peak pin load

#### Scenario: High drop pops weak pins and detaches parts
- **WHEN** a robot with a heavy cantilevered subassembly (such as Clawbot's wrist/claw) is dropped from `1.0 m` or `1.5 m` so the impact load on its pins exceeds their pullout force
- **THEN** those pins break on impact, the unanchored subassembly detaches and falls onto the floor independently, and the Play panel reports the popped pins and detached parts

#### Scenario: Resetting or closing Play mode after a crash
- **WHEN** the user runs a drop test that detaches parts and then clicks **Reset** or closes Play mode
- **THEN** all parts return to their original assembled positions and the build history is unchanged
