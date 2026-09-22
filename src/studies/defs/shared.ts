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

/**
 * The same for the lens term, and for the same reason. The pull is 0, which
 * is off, and the photon radius sits where the black hole rests, so a change
 * between two analytic flows blends the pull alone and never slides the
 * radius the sign turns over at across the crossfade.
 */
export const NO_LENS = { lens: 0, photon: 0.07 }
