/**
 * Spots the part data can't give (openspec rubber-bands), by part number: each in the part's own
 * frame, as bandPath.js's spots are ({ feature, kind, label, center, axis, radius, span }).
 *
 * The Rubber Band Anchor (228-2500-157) has no connection points in the library yet, so its hook is
 * read off its model by eye (the arm's rounded top, about 3 mm across): an estimate, to be checked on
 * a robot that uses it.
 */
export const BAND_SPOT_TABLE = {
  '228-2500-157': [{ feature: 'hook', kind: 'hook', label: 'hook', center: [-5, 15, 0], axis: [0, 0, 1], radius: 1.5, span: [-3.05, 3.05], estimated: true }]
};
