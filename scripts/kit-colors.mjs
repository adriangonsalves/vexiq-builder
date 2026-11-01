/**
 * Default colours for the parts shown in the VEX IQ Competition Kit poster
 * (https://content.vexrobotics.com/vexpro/pdf/IQ-Competition-Kit-111521.pdf). The colours were
 * sampled from the poster's pictures. Parts that aren't on the poster return null and keep the
 * colour the converter gave them.
 */
export const KIT_COLORS = {
  blue: '#0075c9',
  orange: '#f96b02',
  green: '#81bc00',
  lightGrey: '#acafae', // 1xN beams
  midGrey: '#858b8b', // 2xN beams
  plate: '#3f4245', // plates, wedge beams, corner beams
  connector: '#d6d5d1', // hubs, washers
  white: '#f8fafc', // corner connectors and linear motion brackets
  black: '#1c1c1c', // standoffs, tires
  pin: '#3e4143', // 1x2, 2x2, 0x2 and 0x3 connector pins
  rubber: '#2a2829', // collars, spacers, 32.2 mm hub
  cappedPlastic: '#5a5857',
  chainGrey: '#374151' // chain links, tank treads and the flaps' flap body
};

const C = KIT_COLORS;

// First match wins. Each rule is [name pattern, colour].
const RULES = [
  // Beams in colour families
  [/30 Degree (Angle )?Beam|30 Degree Jogged Beam|Delta Tee Beam/, C.orange],
  [/Ball Socket|Center Lock Beam|End Lock Beam|Center Offset Round Lock|Right Angle Beam|Tee Beam|Truss Beam|45 Degree (Angle )?Beam|2x Wide, 3x3 60 Degree Angle Beam/, C.blue],
  [/60 Degre+e (Angle )?Beam|Double 60 Degree Beam|Wye Lock Beam/, C.green],
  [/Corner Beam$/, C.plate],
  [/Wedge Beam|Trapezoid Plate|Girder Plate|Truss Plate|^\d+x\d+ Plate$/, C.plate],
  [/^1x\d+ (Linear Motion )?Beam$/, C.lightGrey],
  [/^2x\d+ Beam$/, C.midGrey],

  // Gears, cams, sprockets
  [/Rack Gear/, C.plate],
  [/Ratchet|Pawl/, C.green],
  [/Sprocket|Cam$|Cam Follower/, C.orange],
  [/Ring Gear|Thrust Washer/, null],
  [/Crank Arm|Gear$|Idler Pulley/, C.blue],
  [/^Chain Link$/, null],

  // Pins and standoffs
  [/Standoff Connector/, C.blue],
  [/0\.25x Pitch Standoff$/, C.connector],
  [/Standoff( Extender)?$/, C.black],
  [/^1x1 Idler Pin$/, C.orange],
  [/^0x2 Idler Pin$/, C.green],
  [/^1x1 Connector Pin$/, C.blue],
  [/^(1x2|2x2|0x2|0x3) Connector Pin$/, C.pin],

  // Shafts, collars
  [/^2x Pitch Plastic Motor Shaft$|^1x Pitch Plastic Motor Snap Shaft$/, C.orange],
  [/^3x Pitch Plastic Motor Shaft$/, C.blue],
  [/^4x Pitch Plastic Motor Shaft$/, C.green],
  [/Capped Plastic Shaft/, C.cappedPlastic],
  [/Rubber Shaft Collar|Spacer/, C.rubber],
  [/^Washer$/, C.connector],

  // Connectors
  [/Corner Connector|Linear Motion Bracket/, C.white],

  // Wheels
  [/32\.2mm Diameter Hub/, C.rubber],
  [/Wheel Hub|48\.5mm Diameter Hub|Omni-Directional Wheel/, C.connector],
  [/^Tire |Balloon Tire/, C.black],
  [/Tank Tread/, C.chainGrey],
  [/Flywheel/, C.plate],

  // Specialty
  [/Sheet Pin/, '#f8fafc'],
  [/^2x Wide Spool$|Silicone Rubber Band|Ball Pin Bushing/, C.orange],
  [/^1x Wide Spool$|Rubber Band Anchor/, C.blue],
  [/Intake Flap/, C.chainGrey],
  [/Traction Link|Cable Anchor|Shock Absorber|Pitch Rope/, C.black],
  [/^2x8 Smooth Panel$/, '#c8c9c8'],
  [/Plastic (Sheet|PET Sheet)/, '#8fd0ee'] // a slight blue tint: drawn as see-through glossy plastic
];

/** The kit colour for a part name, or null when the poster doesn't show it. */
export function kitColor(name) {
  for (const [pattern, color] of RULES) {
    if (pattern.test(name)) return color;
  }
  return null;
}
