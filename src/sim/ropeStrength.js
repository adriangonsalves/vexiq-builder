/**
 * How hard a rope pulls in Play mode (openspec rope-and-spool, design decision 8). A rope is
 * weightless, frictionless and doesn't stretch: one pull T ≥ 0 along its whole length, found each
 * step so the path stops growing past the rope's length. These numbers steer how fast T is found;
 * none is measured from a real rope yet.
 */
export const ROPE_PULL = {
  gamma: 0.6, // share of the needed correction applied per pass (assumed)
  beta: 0.2, // share of the overshoot taken back per step (assumed)
  passes: 4, // correction passes per step, all ropes in turn (assumed)
  maxN: 150, // the pull cap: above a stalled Smart Motor on a bare 2x spool (51 N) (assumed)
  slackMm: 0.2, // a path this much shorter than the rope is slack (assumed)
  biasGain: 0.5, // share of last step's unseen stretch carried into the next step's aim (assumed)
  spoolDamping: 8, // a spool's turning drag on its shaft, per second (other bodies 0.3): a free spool stops within about half a second (assumed)
  easingShare: 0.01, // a contact's push falling by this share in a step counts as the rope drawing its body off it (assumed)
  assumed: true
};
