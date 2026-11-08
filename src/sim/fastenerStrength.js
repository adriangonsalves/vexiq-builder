/**
 * How strongly VEX IQ joints hold and how stiff parts are, for Play mode's drop test (openspec
 * drop-load-network). Plain data, one entry per value, each `source: 'assumed'` until measured on
 * real parts. TODO: measure real forces. The measurements to make are listed in
 * openspec/changes/drop-load-network/design.md (Open Questions) and openspec/follow-ups.md; change an
 * entry's `source` to 'measured' (with the date in its note) when a real value replaces it.
 *
 * Also the rules built on the table: how much one pin end grips one part (`seatGrip`), when two parts
 * on a pin come apart (`gapStrengths`, the slide-off rule), and each joint kind's strengths and
 * stiffness (`jointSpec`). Pure, so the node checks and the app share it.
 */

const assumed = (value, unit, note) => ({ value, unit, source: 'assumed', note });

export const STRENGTH = {
  // Pin and peg grip
  pinSnapN: assumed(15, 'N', 'Snap ridge of a connector pin or standoff pin end, counted once for the part at its tip; with friction a fully seated 1x1 end (4.8 mm) holds about 44 N. VEX IQ pins are tight (a pin tool is often used); raised from 8 N during implementation, near the top of what seems plausible'),
  pinGripPerMmN: assumed(6, 'N/mm', 'Friction along a pin end, for every mm it sits in a part'),
  pegSnapN: assumed(12, 'N', 'Snap ridge of an integral peg (corner connectors, traction links)'),
  pegGripPerMmN: assumed(6, 'N/mm', 'Friction along an integral peg, per mm seated'),
  weakFactor: assumed(0.6, '×', '"(Weak)" pins and standoffs, made to let go more easily'),
  capTearN: assumed(150, 'N', 'A plate pulled against a pin cap: the hole tears out'),
  pinShearN: assumed(120, 'N', 'A pin pushed sideways in its hole: the hole wall gives way'),
  pinLeverMm: assumed(6, 'mm', 'Least distance two parts pinned face to face bear on each other round a pin (their shared face, measured on the meshes, usually reaches further)'),
  // Shafts
  collarSlipN: assumed(5, 'N', 'Rubber Shaft Collar sliding along a square shaft (friction only); a few newtons, far below a pin. Raised from 3 N: at 3 N every Clawbot collar slid in a flat 15 cm drop'),
  motorHoldNm: assumed(0.414, 'N·m', 'Torque a Smart Motor holds its shaft at before it turns (stall torque)'),
  // Joint stiffness
  pinPlayMm: assumed(0.15, 'mm', 'Play of a pin or shaft in its hole: within it a joint is loose (5% of its stiffness), beyond it stiff'),
  pinAxialK: assumed(6e4, 'N/m', 'Pin seat along the pin, with the play of a snap fit'),
  pinShearK: assumed(1.2e5, 'N/m', 'Pin seat sideways, with the play of a snap fit'),
  pinRockK: assumed(1, 'N·m/rad', 'Pin seat rocking across the pin: its sideways stiffness spread along a ~5 mm seat (4×10⁵ × 0.005² / 12 ≈ 0.8)'),
  collarAxialK: assumed(2e4, 'N/m', 'Rubber collar along its shaft, before it slides'),
  squareTwistK: assumed(50, 'N·m/rad', 'A square shaft turning in a square opening'),
  socketTwistK: assumed(30, 'N·m/rad', 'A motor shaft turning in the Smart Motor socket, below the stall torque'),
  gearMeshK: assumed(20, 'N·m/rad', 'Two meshed gears or a chain, per radian of the driven gear out of ratio'),
  pushK: assumed(1e5, 'N/m', 'Neighbours along a shaft pressing on each other, and parts pinned face to face pressing together'),
  bayK: assumed(3e5, 'N/m', 'A Gen 1 battery in its bay or a tire on its hub: held all round, as one piece'),
  faceFriction: assumed(0.4, '×', 'Friction between two plastic faces pinned together, while they press on each other'),
  connectorWallMm: assumed(3, 'mm', 'Wall thickness of a connector or bracket, for how much it flexes between its pegs and holes'),
  // Material
  absE: assumed(2.2e9, 'Pa', 'ABS plastic stiffness (handbook range 2.0–2.6 GPa)'),
  metalShaftE: assumed(200e9, 'Pa', 'Steel shafts'),
  plasticShaftE: assumed(2.5e9, 'Pa', 'Plastic shafts'),
  shearOverE: assumed(1 / 2.6, '×', 'Shear modulus over stiffness for plastic and steel'),
  beamMaxK: assumed(3e5, 'N/m', 'Cap on a beam or connector piece\'s stretch and edgewise stiffness: still stiffer than any pin, so it moves no load, and keeps the solve\'s steps long enough'),
  beamMaxRotK: assumed(100, 'N·m/rad', 'Cap on a beam or connector piece\'s twisting and edgewise turning stiffness, for the same reason'),
  sectionFactor: assumed(0.35, '×', 'Beam and plate bending stiffness against a solid bar the same size (holes and ribs)'),
  // Floor
  tireContactK: assumed(20e3, 'N/m', 'A tire pressed into the floor, averaged over its squash: soft at first, stiffening as it squashes towards the hub (5–10 kN/m let a Clawbot\'s hubs hit the floor at 15 cm)'),
  hardContactK: assumed(50e3, 'N/m', 'A hard plastic part pressed into the floor (plastic edge and floor both give a little)'),
  contactDamping: assumed(0.3, '× critical', 'Floor contact damping, a bounce of roughly 0.3'),
  jointDamping: assumed(0.3, '× critical', 'Joint and bending damping: snap-fit plastic joints rub and lose energy'),
  // Masses
  brainKg: assumed(0.18, 'kg', 'Robot Brain'),
  batteryKg: assumed(0.14, 'kg', 'Robot Battery'),
  motorKg: assumed(0.082, 'kg', 'Smart Motor'),
  pinKg: assumed(0.0015, 'kg', 'A connector pin'),
  density: assumed(1050, 'kg/m³', 'ABS'),
  fillFactor: assumed(0.38, '×', 'Share of a part\'s box that is plastic'),
  minPartKg: assumed(0.002, 'kg', 'Lightest part'),
  maxPartKg: assumed(0.16, 'kg', 'Heaviest plastic part')
};

/** A table value. */
export const S = (key) => {
  const entry = STRENGTH[key];
  if (!entry) throw new Error(`No strength entry ${key}`);
  return entry.value;
};

/** Every value in the table (or every one of `keys`) has been measured on real parts. */
export const allMeasured = (keys = Object.keys(STRENGTH)) => keys.every((k) => STRENGTH[k]?.source === 'measured');

const BRAIN = /Brain/i;
const BATTERY = /Battery/i;
const MOTOR = /Smart Motor|^Motor/i;
const BRAIN_PN = /228-6480|228-2540/;
const BATTERY_PN = /228-7045|228-2604/;
const MOTOR_PN = /228-2560/;

/**
 * A part's mass (kg): the Brain, battery and Smart Motor from the table, a pin from the table, and any
 * other part from its box: size (mm) × ABS density × fill share.
 */
export function partMassKg({ name = '', partNumber = '', size = null, pin = false }) {
  const pn = String(partNumber);
  if (BRAIN.test(name) || BRAIN_PN.test(pn)) return BATTERY.test(name) ? S('brainKg') + S('batteryKg') : S('brainKg');
  if (BATTERY.test(name) || BATTERY_PN.test(pn)) return S('batteryKg');
  if (MOTOR.test(name) || MOTOR_PN.test(pn)) return S('motorKg');
  if (pin) return S('pinKg');
  if (!size) return 0.018;
  const vol = Math.max(1e-9, size[0] * size[1] * size[2] * 1e-9);
  return Math.min(S('maxPartKg'), Math.max(S('minPartKg'), vol * S('fillFactor') * S('density')));
}

/** Friction grip (N) of one pin or peg end seated `depthMm` in one part, without the snap ridge. */
export function seatGrip({ depthMm, peg = false, weak = false }) {
  const perMm = S(peg ? 'pegGripPerMmN' : 'pinGripPerMmN');
  return Math.max(0, depthMm) * perMm * (weak ? S('weakFactor') : 1);
}

/** The snap ridge's extra hold (N) for the part at a pin end's tip. */
export const snapGrip = ({ peg = false, weak = false }) => S(peg ? 'pegSnapN' : 'pinSnapN') * (weak ? S('weakFactor') : 1);

/**
 * The slide-off rule. `seats` are the parts on one pin (or pin stack), each `{ part, t, depthMm }` with
 * `t` its place along the pin (mm, any fixed origin and direction); `blockers` are `[lo, hi]` spans on
 * the same line that no part can slide past (shoulders, caps, standoff bodies). Parts in one seat list
 * may repeat (a part held twice); they count once, at their first place.
 *
 * Between each pair of neighbouring parts the pin comes apart only when the parts on one side slide off
 * their end of the pin. That way is blocked when a blocker lies between those parts and their end; its
 * hold is the friction grip of every part that slides plus the snap ridge (the tip part always slides).
 * A capped side that can't let go leaves the cap's tear-out as its hold. Returns one entry per gap,
 * `{ a, b, pullN, way }`, with `a` the part on the low side, `way` 'low' or 'high' (which end gives way).
 */
export function gapStrengths({ seats, blockers = [], peg = false, weak = false }) {
  const byPart = new Map();
  for (const s of seats) {
    const prev = byPart.get(s.part);
    if (!prev) byPart.set(s.part, { ...s });
    else prev.depthMm = Math.max(prev.depthMm, s.depthMm);
  }
  const list = [...byPart.values()].sort((x, y) => x.t - y.t || (x.part < y.part ? -1 : 1));
  const mids = blockers.map(([lo, hi]) => (lo + hi) / 2);
  const out = [];
  for (let i = 0; i + 1 < list.length; i++) {
    const low = list.slice(0, i + 1);
    const high = list.slice(i + 1);
    const lowMin = low[0].t;
    const highMax = high[high.length - 1].t;
    const hold = (group) => group.reduce((sum, s) => sum + seatGrip({ depthMm: s.depthMm, peg, weak }), 0) + snapGrip({ peg, weak });
    const lowBlocked = mids.some((m) => m < lowMin);
    const highBlocked = mids.some((m) => m > highMax);
    const lowHold = lowBlocked ? Infinity : hold(low);
    const highHold = highBlocked ? Infinity : hold(high);
    let pullN = Math.min(lowHold, highHold);
    // Both ways blocked (a pin capped at both ends, or a stack whose ends are both caps): the hole tears
    if (!Number.isFinite(pullN)) pullN = S('capTearN');
    out.push({ a: list[i].part, b: list[i + 1].part, pullN, way: lowHold <= highHold ? 'low' : 'high', depthMm: Math.min(list[i].depthMm, list[i + 1].depthMm) });
  }
  return out;
}

/**
 * Strengths and stiffness of one joint of `kind`, as `{ pullN, shearN, rockNm, k: { axial, shear,
 * rock, twist }, pushOnly, slipN, twistHoldNm }`. Pulls along the joint's axis count against `pullN`
 * only when they pull its parts apart (pressing together goes through their faces); `slipN` is a
 * friction slide either way (collars); `pushOnly` joints only push (spacers, neighbours on a shaft);
 * `playM` is how far it moves loosely before it is stiff (pins and shafts in holes); `travelM` how far it
 * must slide before it comes off (a pin its seated depth, a collar the rest of its shaft): a brief pull only
 * moves it part way;
 * `twistHoldNm` caps the turning torque the joint passes on (a motor holding its shaft); `leverM` turns a
 * pin's rocking into pull (M / leverM), so prying adds to pulling and `rockNm` = `pullN` × `leverM`.
 * `pullN` and `depthMm` come from the slide-off rule for pins and pegs.
 */
export function jointSpec(kind, { pullN = Infinity, depthMm = 5, travelMm } = {}) {
  const pin = { axial: S('pinAxialK'), shear: S('pinShearK'), rock: S('pinRockK'), twist: 0 };
  switch (kind) {
    case 'pin':
    case 'peg':
      // Prying pulls the pin over the lever of the face edge the part pivots on
      // It comes out only by sliding its whole seated depth, gripping less as it goes
      return { pullN, shearN: S('pinShearN'), rockNm: pullN * S('pinLeverMm') * 1e-3, leverM: S('pinLeverMm') * 1e-3, playM: S('pinPlayMm') * 1e-3, travelM: Math.max(0.5, travelMm ?? depthMm) * 1e-3, k: pin };
    case 'collar':
      // It slides gripping all the way, and comes off once it has slid the rest of the shaft
      return { pullN: Infinity, shearN: Infinity, rockNm: Infinity, slipN: S('collarSlipN'), travelM: Math.max(1, travelMm ?? 5) * 1e-3, k: { axial: S('collarAxialK'), shear: S('pinShearK'), rock: 0, twist: 0 } };
    case 'square':
      return { pullN: Infinity, shearN: Infinity, rockNm: Infinity, playM: S('pinPlayMm') * 1e-3, k: { axial: 0, shear: S('pinShearK'), rock: S('pinRockK'), twist: S('squareTwistK') } };
    case 'bearing':
      // A part round a shaft can't leave it sideways, only by sliding off its end
      return { pullN: Infinity, shearN: Infinity, rockNm: Infinity, playM: S('pinPlayMm') * 1e-3, k: { axial: 0, shear: S('pinShearK'), rock: S('pinRockK') * 0.2, twist: 0 } };
    case 'socket':
      // A motor shaft can't leave its socket sideways either
      return { pullN: Infinity, shearN: Infinity, rockNm: Infinity, twistHoldNm: S('motorHoldNm'), k: { axial: S('pinAxialK'), shear: S('pinShearK'), rock: S('pinRockK'), twist: S('socketTwistK') } };
    case 'push':
      return { pullN: Infinity, shearN: Infinity, rockNm: Infinity, pushOnly: true, k: { axial: S('pushK'), shear: 0, rock: 0, twist: 0 } };
    case 'tire':
    case 'bay':
      // A tire on its hub, and a Gen 1 battery in its brain (friction and a clip): one piece
      return { pullN: Infinity, shearN: Infinity, rockNm: Infinity, k: { axial: S('bayK'), shear: S('bayK'), rock: S('pinRockK') * 4, twist: S('pinRockK') * 4 } };
    default:
      throw new Error(`Unknown joint kind ${kind}`);
  }
}
