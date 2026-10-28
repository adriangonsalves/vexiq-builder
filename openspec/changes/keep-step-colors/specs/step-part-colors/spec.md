## Purpose

Parts keep the colours their official STEP files give to each body, so details like a motor shaft's red stop ring show in the 3D view and in thumbnails.

## ADDED Requirements

### Requirement: Multi-colour STEP bodies keep their colours
When a part's STEP file gives its bodies more than one colour, the converted part SHALL keep each body in its STEP colour. The only exception is the main body, which is the body with the most faces.

#### Scenario: Motor shaft stop ring
- **WHEN** the 4x Pitch Motor Shaft is placed in the 3D view
- **THEN** the stop ring is drawn red and the shaft is drawn in the part's colour

#### Scenario: Omni wheel rollers stay black
- **WHEN** the 200mm Travel Omni-Directional Wheel is placed
- **THEN** its rubber rollers are drawn black, as they are now, and its metal pins keep their grey STEP colour

#### Scenario: Control parts keep their colours
- **WHEN** a Smart Motor, Robot Brain, Robot Brain with Battery, a sensor or the cable is placed
- **THEN** each of its colour bodies is drawn in its STEP colour, except the main body

### Requirement: Part colour applies to the main body only
Changing a part's colour SHALL change only its main body. The other colour bodies SHALL keep their STEP colours.

#### Scenario: Recolour a motor shaft
- **WHEN** the user gives a 3x Pitch Motor Shaft a blue colour
- **THEN** the shaft turns blue and the stop ring stays red

### Requirement: Thumbnails show the extra colours
A part's thumbnail SHALL draw each extra colour body in its STEP colour. Very dark colours SHALL be lifted to a tone that can be seen, the same way the main colour is.

#### Scenario: Motor shaft thumbnail
- **WHEN** the parts list shows the 2x Pitch Motor Shaft
- **THEN** its thumbnail shows the red stop ring

### Requirement: Non-plastic shafts render with reflective metallic silver
Non-plastic shafts (including motor shafts, capped shafts, and standard axles) SHALL render with a reflective metallic silver material (`metalness: 0.85`, `roughness: 0.22`, default color `#e2e8f0`). Multi-color accents (such as the motor shaft red stop ring) SHALL remain in their fixed accent color.

#### Scenario: Metal motor shaft appearance
- **WHEN** a 2x, 3x, or 4x Pitch Motor Shaft is placed in the 3D view
- **THEN** its shaft body is drawn in reflective metallic silver and its stop ring is drawn in red

#### Scenario: Plastic shafts unchanged
- **WHEN** a Plastic Motor Shaft or Plastic Shaft is placed
- **THEN** it renders with standard plastic material (`metalness: 0.12`, `roughness: 0.38`)

### Requirement: Single-colour and uncoloured parts unchanged
Parts whose STEP files have one colour or none SHALL look the same as before.

#### Scenario: Uncoloured plate
- **WHEN** a part whose STEP file has no colours is converted again
- **THEN** it is drawn in a single colour, its default colour, as before
