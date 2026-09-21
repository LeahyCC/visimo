/**
 * What a study on the analytic flow that has no use for the curl term carries
 * for it. The speed is 0, which is off and encodes nothing on its own. The two
 * shape numbers sit at the resting values curl drift carries, and that is on
 * purpose: two flows on one implementation are blended by their knobs while a
 * change is running, and a shape that jumped between the two studies would
 * slide the pattern's cells and clock across the crossfade for a term that is
 * off in one of them.
 */
export const NO_CURL = { curl: 0, curlScale: 3.5, curlRate: 0.05 }
