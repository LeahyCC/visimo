/**
 * The stage and everything it drags in: WebGPU, the shaders, the scene. Import
 * this one lazily. The preset and scene lists live in `visimo/presets` and
 * `visimo/catalog` precisely so a picker can be drawn without loading it.
 */
export { default as VisualizerStage } from './Visualizer'
export { renderer } from './gpu/Renderer'
export type { AttachResult, Live, PlayheadSource } from './gpu/Renderer'
export { hasWebGpu } from './gpu/Device'
export { FeatureClient } from './audio/FeatureClient'
export { F, PACKET_LENGTH } from './audio/FeatureExtractor'
