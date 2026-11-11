/**
 * How hard rubber bands and belts pull, and where their stretch colours change (openspec
 * rubber-bands). Plain data, one entry per value, each `source: 'assumed'` until measured on real
 * bands. TODO: measure real pulls (hang a weight on each band at 1.5×, 2× and 3× its free length);
 * change an entry's `source` to 'measured' (with the date in its note) when a real value replaces it.
 */

const assumed = (value, unit, note) => ({ value, unit, source: 'assumed', note });

export const BAND_STRETCH = {
  snug: assumed(1.0, '×', 'Below this a band is slack (grey): longer than its route, it hangs loose'),
  tight: assumed(2.0, '×', 'Up to this a band is snug (green); silicone bands are made to run about here'),
  tooFar: assumed(3.0, '×', 'Up to this a band is tight (amber); past it, too far (red): a real band would be hard to fit or would snap'),
  best: assumed(1.5, '×', 'The stretch the size suggestion aims for')
};

/** Pull per mm of stretch past the free length, by part number. */
export const BAND_STIFFNESS = {
  '228-2500-468': assumed(0.033, 'N/mm', '#32: about 6 N at 2× (184 mm free)'),
  '228-2500-474': assumed(0.025, 'N/mm', 'Thin #64: about 4.5 N at 2× (181 mm free)'),
  '228-2500-475': assumed(0.06, 'N/mm', '#64 (twice as wide as #32): about 11 N at 2×'),
  '228-2500-470': assumed(0.028, 'N/mm', '#117B: about 10 N at 2× (354 mm free)'),
  '228-2500-1225': assumed(0.053, 'N/mm', '2x30 mm Square Silicone Belt: about 5 N at 2× (94 mm free)'),
  '228-2500-221': assumed(0.064, 'N/mm', '2x30 mm Rubber Belt: about 6 N at 2×'),
  '228-2500-222': assumed(0.048, 'N/mm', '2x40 mm Rubber Belt: about 6 N at 2×'),
  '228-2500-223': assumed(0.038, 'N/mm', '2x50 mm Rubber Belt: about 6 N at 2×'),
  '228-2500-224': assumed(0.032, 'N/mm', '2x60 mm Rubber Belt: about 6 N at 2×')
};

const DEFAULT_STIFFNESS = assumed(0.03, 'N/mm', 'A band or belt not listed above');

/** A band's pull in newtons at `lengthMm` round its route (0 when slack). */
export function bandPullN(partNumber, freeMm, lengthMm) {
  const k = (BAND_STIFFNESS[partNumber] || DEFAULT_STIFFNESS).value;
  return lengthMm > freeMm ? k * (lengthMm - freeMm) : 0;
}

/** 'slack' | 'snug' | 'tight' | 'too far' for a stretch ratio. */
export function stretchState(ratio) {
  if (ratio < BAND_STRETCH.snug.value) return 'slack';
  if (ratio <= BAND_STRETCH.tight.value) return 'snug';
  if (ratio <= BAND_STRETCH.tooFar.value) return 'tight';
  return 'too far';
}

/** Colours for the four states (hex), shared by the viewport, the panel and the ring close-up. */
export const STRETCH_COLORS = { slack: 0x9aa0a6, snug: 0x2fa84f, tight: 0xf2a900, 'too far': 0xd93025 };
