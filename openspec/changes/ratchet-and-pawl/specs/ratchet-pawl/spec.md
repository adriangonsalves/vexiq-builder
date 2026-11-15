## Purpose

Lets a builder fit a pawl to a ratchet so a shaft turns one way only: the app knows where the teeth are, seats the pawl, shows which way the ratchet still turns, and reports pawls that won't hold.

## ADDED Requirements

### Requirement: Measured ratchet and pawl data
The part data SHALL record, measured from the part models, for the 16 Tooth Ratchet and the 40 Tooth Ratchet: the tooth count, the tip and root radius, the angle of one tooth, the tooth band along the axis, and which way the teeth lean (the turning direction a pawl stops). For the Short Low-Profile Pawl it SHALL record the tip point, the direction the tip faces, and the pawl's thickness. Ratchets SHALL stay out of gear meshing: a ratchet never meshes with a gear.

#### Scenario: Ratchet data
- **WHEN** the part data is built
- **THEN** the 16 Tooth Ratchet reports 16 teeth and the 40 Tooth Ratchet 40, each with tip and root radius, tooth angle and lean, and building it twice gives the same values

#### Scenario: Ratchet beside a gear
- **WHEN** a 16 Tooth Ratchet sits beside a 36 Tooth Gear on parallel shafts at any distance
- **THEN** the two are not reported as meshing and neither turns to fit the other

### Requirement: When a pawl holds a ratchet
A pawl SHALL count as holding a ratchet when the pawl's holes are parallel to the ratchet's shaft, the pawl overlaps the ratchet's tooth band along the shaft, and the pawl's tip sits between the ratchet's tip and root circles (within 0.5 mm). The ratchet SHALL then be free to turn the way its teeth slide under the tip and stopped the other way. Turning the ratchet over on its shaft SHALL reverse the way it is held.

A pawl whose tip is in the teeth but faces so that the teeth would push it out instead of catching it SHALL count as facing the wrong way and SHALL NOT hold.

#### Scenario: Pawl in the teeth
- **WHEN** a Short Low-Profile Pawl is pinned beside a 16 Tooth Ratchet in the same plane with its tip in a tooth gap, facing the teeth's steep sides
- **THEN** the pawl holds the ratchet, and the ratchet's free direction is the one in which the teeth's sloped sides pass under the tip

#### Scenario: Ratchet turned over
- **WHEN** the same ratchet is turned over on its shaft and the pawl is set on it again from the matching side
- **THEN** the free direction is the opposite one

#### Scenario: Pawl out of plane
- **WHEN** the pawl sits one beam thickness further along the shaft than the ratchet, so it doesn't overlap the teeth
- **THEN** the pawl does not hold the ratchet

#### Scenario: Pawl facing the wrong way
- **WHEN** a pawl's tip is in the teeth but pointing the way the teeth lean
- **THEN** the pawl is reported as facing the wrong way and the ratchet counts as free both ways

### Requirement: Set pawl
With one pawl selected, the builder SHALL be able to set it on a ratchet in any of these ways: double-clicking the ratchet, Tools → **Set pawl** (with the ratchet also selected, or with exactly one ratchet within reach), or the context bar's Join button. The pawl SHALL move to a pawl spot, as one undo step. A pawl spot is a pose where:
- one of the pawl's holes lines up with a pin hole of another part (not the ratchet) that lies flat against the pawl's plane, or with a pin already standing in such a hole;
- the tip rests in the ratchet's teeth, facing the right way to hold;
- the pawl overlaps no other part.

By double-click the pawl SHALL go to the spot nearest the click; otherwise to the spot nearest where the pawl is. Setting it again SHALL step to the next spot. The ratchet and what is on its shaft SHALL NOT move or turn. When there is no spot, nothing SHALL move and a message SHALL say why (no part with holes beside the ratchet, or every spot is blocked and by what).

#### Scenario: Double-click the ratchet
- **WHEN** a 16 Tooth Ratchet sits on a shaft between two plates, a loose pawl is selected, and the user double-clicks the ratchet
- **THEN** the pawl moves so one of its holes lines up with a plate hole and its tip rests in the teeth, the ratchet has not moved, and one undo puts the pawl back

#### Scenario: Tools menu
- **WHEN** a pawl and a ratchet are selected and the user picks Tools → Set pawl
- **THEN** the pawl moves to the spot nearest its current place

#### Scenario: On a tablet
- **WHEN** a pawl is selected within reach of a ratchet on a touch screen and the user taps Join on the context bar
- **THEN** the pawl moves to the nearest spot

#### Scenario: Next spot
- **WHEN** the pawl has just been set and the user sets it on the same ratchet again
- **THEN** it moves to the next spot round the ratchet

#### Scenario: Nothing to pin to
- **WHEN** the ratchet is on a bare shaft with no beam or plate beside it
- **THEN** nothing moves and a message says the pawl needs a beam or plate beside the ratchet to pin to

#### Scenario: Set pawl turned off
- **WHEN** no pawl is selected
- **THEN** Tools → Set pawl is greyed out and its tip says to select a pawl

### Requirement: A placed pawl swings onto its ratchet
When a pawl is placed or moved so that it hangs on exactly one pin or hole (drag, double-click mate, hole picking, copy insert, the assistant's tools) and a ratchet is within its reach in the same plane, the pawl SHALL turn about that pin until its tip rests on the ratchet, facing the way that holds. The ratchet SHALL NOT move. Holding Alt or using Free move SHALL place the pawl without turning it, and a turn made by hand in Rotate mode SHALL be kept.

#### Scenario: Pawl dropped on a pin
- **WHEN** the user drags a pawl onto a pin that stands about 28 mm from a 16 Tooth Ratchet's shaft, in the ratchet's plane
- **THEN** the pawl lands on the pin turned so its tip rests in the ratchet's teeth

#### Scenario: Ratchet out of reach
- **WHEN** the pin stands further from the ratchet than the pawl can reach
- **THEN** the pawl is placed as any other part and does not turn

#### Scenario: Alt keeps the pose
- **WHEN** the user holds Alt while dropping the pawl on the pin
- **THEN** the pawl keeps the turn it had

### Requirement: Direction arrow
While a pawl that holds a ratchet, or that ratchet, is selected, the view SHALL show a curved arrow round the ratchet pointing the way it can turn. A ratchet with no pawl holding it SHALL show no arrow.

#### Scenario: Selecting the ratchet
- **WHEN** the user selects a ratchet held by a pawl
- **THEN** an arrow round the ratchet points in its free direction, and it goes away when the selection changes

### Requirement: Audit reports ratchets and pawls
The audit SHALL list each pawl that holds a ratchet with the way the ratchet can turn. It SHALL warn about:
- a pawl facing the wrong way;
- a pawl held by two or more pins, which can't lift, so the ratchet is locked both ways;
- a pawl held by no pin;
- a pawl with no band or belt on it or on a pin in it (a note that only its weight presses it onto the teeth).

A pawl resting in a ratchet's teeth SHALL NOT be reported as overlapping the ratchet.

#### Scenario: Working ratchet
- **WHEN** the audit runs on a build with a pawl on one pin, a belt pulling it onto a 16 Tooth Ratchet
- **THEN** the audit lists the pair with the ratchet's free direction and gives no warning for it

#### Scenario: Pawl on two pins
- **WHEN** the pawl is pinned through two of its holes
- **THEN** the audit warns that the pawl can't lift and the ratchet is locked

#### Scenario: Swish winch
- **WHEN** Hero Bot Swish is imported from VEX's CAD and audited
- **THEN** the audit lists its Short Low-Profile Pawl as holding the 16 Tooth Ratchet, with no overlap between them

### Requirement: Assistant sets a pawl
The assistant's tools SHALL include `set_pawl`. Given a pawl in the build (or a pawl part to add) and a ratchet, a call without a spot SHALL change nothing and list the pawl spots: for each, its number, the part and hole the pawl pins to, the pawl's hole used, the ratchet's free direction, and whether it is blocked and by what. A call with a spot SHALL put the pawl there as one undo step and reply with the free direction. `place_part` and `place_parts` SHALL swing a pawl onto its ratchet as placing by hand does. The assistant's instructions SHALL say how a ratchet and pawl go together.

#### Scenario: Listing spots
- **WHEN** `set_pawl` is called with a pawl part and a ratchet between two plates, without a spot
- **THEN** the reply lists the spots and the build is unchanged

#### Scenario: Placing at a spot
- **WHEN** `set_pawl` is called again with a spot number from the list
- **THEN** the pawl is added at that spot, `audit_assembly` lists it as holding the ratchet, and one `undo` removes it

#### Scenario: Blocked spot
- **WHEN** `set_pawl` is called with a spot the list marked as blocked
- **THEN** nothing is placed and the reply names the part in the way
