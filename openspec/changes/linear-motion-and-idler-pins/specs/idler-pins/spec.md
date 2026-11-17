## ADDED Requirements

### Requirement: An idler pin holds a part by its centre hole
The smooth end of an idler pin (0x2 Idler Pin, 0x2 Idler Pin (Weak), 0x3 Idler Pin, 0x3 Smooth Idler Pin (Weak), 1x1 Idler Pin, 1x2 Idler Pin, 2x3 Smooth Idler Pin) SHALL count as seated in the centre hole of a gear, sprocket, pulley or wheel (a square or round shaft hole) when the pin's line is along the hole's line within the tolerances pins in holes use, and the smooth end reaches at least 2 mm into the hole.

A part seated this way SHALL count as held by the pin, free to turn about it: the audit SHALL NOT list the part as unsecured, SHALL NOT list the pin as floating or half-seated for that end, and SHALL list the joint with the pin's other joints. An ordinary connector pin in a centre hole SHALL NOT count as seated.

The snap end of an idler pin SHALL keep seating in round pin holes as it does today.

#### Scenario: Huey's idler gears
- **WHEN** the Huey starter is audited
- **THEN** the two 36 Tooth Gears and two 48 Tooth Gears on 0x2 Idler Pins in the Drive group are held, and none is listed as unsecured

#### Scenario: Ordinary pin in a gear's centre
- **WHEN** a 1x1 Connector Pin is put in a gear's square centre hole
- **THEN** the gear is not held by it

#### Scenario: Idler pin not reaching
- **WHEN** an idler pin's smooth end is less than 2 mm into a gear's centre hole
- **THEN** the gear is not held and the audit lists it as unsecured
