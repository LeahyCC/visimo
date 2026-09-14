import type { PostParams } from '../post/params'
import { WebGLPost } from '../post/WebGLPost'
import type { Tuning } from '../presets/knobs'
import fragment from '../shaders/kaleidoscope.glsl?raw'
import {
  KALEIDOSCOPE_UNIFORM_FLOATS,
  KaleidoscopeMotion,
  kaleidoscopeParams,
  writeKaleidoscopeUniform,
} from './kaleidoscope.params'

const vertex = `#version 300 es
void main() {
  vec2 xy = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(xy * 2.0 - 1.0, 0.0, 1.0);
}`

/** The same scene and CPU uniforms, drawn through the browser's WebGL2 path. */
export class KaleidoscopeWebGL {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly uniform: WebGLBuffer
  private readonly vao: WebGLVertexArrayObject
  private readonly post: WebGLPost
  private readonly data = new Float32Array(KALEIDOSCOPE_UNIFORM_FLOATS)
  readonly adapter: string
  readonly software: boolean
  get detail() {
    return `5-band 3D kaleidoscope / WebGL2${this.software ? ' software' : ''}`
  }

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly motion: KaleidoscopeMotion,
  ) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false })
    if (!gl) throw new Error('WebGL2 is unavailable')
    this.gl = gl
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const adapter: unknown = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : ''
    this.adapter = typeof adapter === 'string' ? adapter : 'WebGL2'
    this.software = /swiftshader|llvmpipe|software|basic render|\bwarp\b/i.test(this.adapter)
    const program = gl.createProgram()
    const uniform = gl.createBuffer()
    const vao = gl.createVertexArray()
    if (!program || !uniform || !vao) {
      gl.deleteProgram(program)
      gl.deleteBuffer(uniform)
      gl.deleteVertexArray(vao)
      throw new Error('Could not allocate the WebGL2 scene')
    }
    this.program = program
    this.uniform = uniform
    this.vao = vao
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, vertex],
        [gl.FRAGMENT_SHADER, fragment],
      ] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Could not allocate a WebGL2 shader')
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS)
        const error = gl.getShaderInfoLog(shader)
        if (compiled) gl.attachShader(program, shader)
        gl.deleteShader(shader)
        if (!compiled) throw new Error(`Kaleidoscope shader: ${error}`)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(`Kaleidoscope program: ${gl.getProgramInfoLog(program)}`)
      const block = gl.getUniformBlockIndex(program, 'Params')
      if (block === gl.INVALID_INDEX)
        throw new Error('Kaleidoscope shader is missing its parameter block')
      const bytes: unknown = gl.getActiveUniformBlockParameter(
        program,
        block,
        gl.UNIFORM_BLOCK_DATA_SIZE,
      )
      if (bytes !== this.data.byteLength)
        throw new Error('Kaleidoscope shader parameter layout does not match the scene')
      gl.uniformBlockBinding(program, block, 0)
      gl.bindBuffer(gl.UNIFORM_BUFFER, uniform)
      gl.bufferData(gl.UNIFORM_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW)
      this.post = new WebGLPost(gl)
    } catch (error) {
      gl.useProgram(null)
      gl.bindBuffer(gl.UNIFORM_BUFFER, null)
      gl.deleteProgram(program)
      gl.deleteBuffer(uniform)
      gl.deleteVertexArray(vao)
      throw error
    }
  }

  render(features: Float32Array, dt: number, tuning: Tuning, post: PostParams) {
    const gl = this.gl
    if (gl.isContextLost()) return
    const params = kaleidoscopeParams(tuning)
    this.motion.step(params, dt, features)
    writeKaleidoscopeUniform(
      params,
      this.motion,
      this.canvas.width,
      this.canvas.height,
      this.software,
      this.data,
    )
    this.post.target(this.canvas.width, this.canvas.height)
    gl.useProgram(this.program)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.uniform)
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.data)
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.uniform)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    this.post.render(post, features)
  }

  dispose() {
    this.post.dispose()
    this.gl.bindBufferBase(this.gl.UNIFORM_BUFFER, 0, null)
    this.gl.bindBuffer(this.gl.UNIFORM_BUFFER, null)
    this.gl.deleteProgram(this.program)
    this.gl.deleteBuffer(this.uniform)
    this.gl.deleteVertexArray(this.vao)
  }

  /** Keep CPU rasterisers within a bounded pixel budget at any display size. */
  pixelRatio(width: number, height: number, ratio: number) {
    return this.software
      ? Math.min(
          ratio,
          Math.sqrt((480 * 270) / Math.max(1, width * height)),
          960 / Math.max(1, width, height),
        )
      : ratio
  }
}
