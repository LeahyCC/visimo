/**
 * A preset may ask for a flow: a velocity field that carries the picture even
 * though the scene drawing into it solves none. The feedback pass already
 * reads the last frame back along whatever field it is handed; this says
 * where that field comes from when the scene has none of its own.
 *
 * Like `knobs.ts` this is vocabulary rather than machinery. It names the
 * flows a preset may ask for and answers the one question the renderer has:
 * must it run a solver of its own for this preset and this scene. That is a
 * domain rule, so it lives here beside the presets and not in the renderer.
 */
import type { SceneId } from '../scenes/catalog'

/** The flows a preset may name. Only the fluid solves a field today. */
export const FLOW_IDS = ['fluid'] as const
export type FlowId = (typeof FLOW_IDS)[number]

export const isFlowId = (value: string): value is FlowId =>
  (FLOW_IDS as readonly string[]).includes(value)

/**
 * Whether the renderer has to run a second solver for this pair. The Fluid
 * scene already solves the field it offers, so a fluid flow under it is the
 * scene itself and nothing extra runs; every other scene draws into a field
 * the renderer has to step on its own.
 */
export const needsFlowSolver = (flow: FlowId | undefined, scene: SceneId): boolean =>
  flow === 'fluid' && scene !== 'fluid'
