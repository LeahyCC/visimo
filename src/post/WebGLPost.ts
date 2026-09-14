import {
  BLOOM_LEVELS,
  bloomLevelSize,
  POST_UNIFORM_FLOATS,
  stageEnabled,
  writePostUniform,
} from './params'
import type { PostParams } from './params'

const VERTEX = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
const COMMON = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 result;
uniform vec4 post[7];
uniform sampler2D source;
`
const BRIGHT = `
void main() {
  vec3 colour = texture(source, uv).rgb;
  float luma = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  float threshold = post[2].x, knee = post[2].y;
  float soft = clamp(luma - threshold + knee, 0.0, 2.0 * knee);
  float curve = soft * soft / (4.0 * knee);
  float keep = max(curve, luma - threshold) / max(luma, 0.0001);
  result = vec4(colour * clamp(keep, 0.0, 1.0), 1.0);
}`
const BLUR = `
uniform vec2 stepSize;
void main() {
  vec3 sum = texture(source, uv).rgb * 0.2270270270;
  vec2 nearTap = stepSize * 1.3846153846;
  vec2 farTap = stepSize * 3.2307692308;
  sum += (texture(source, uv + nearTap).rgb + texture(source, uv - nearTap).rgb) * 0.3162162162;
  sum += (texture(source, uv + farTap).rgb + texture(source, uv - farTap).rgb) * 0.0702702703;
  result = vec4(sum, 1.0);
}`
const FEEDBACK = `
void main() {
  float zoom = max(post[1].z, 0.001), angle = -post[1].w;
  vec2 aspect = vec2(post[0].x / max(post[0].y, 1.0), 1.0);
  vec2 centred = (uv - 0.5) * aspect;
  float s = sin(angle), c = cos(angle);
  vec2 turned = vec2(centred.x * c - centred.y * s, centred.x * s + centred.y * c) / zoom;
  vec2 at = clamp(turned / aspect + 0.5, vec2(0.0), vec2(1.0));
  result = vec4(texture(source, at).rgb * post[1].x * post[1].y, 1.0);
}`
const COMPOSITE = `
uniform sampler2D bloom0;
uniform sampler2D bloom1;
uniform sampler2D bloom2;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 split = (uv - 0.5) * post[4].x;
  vec3 colour = vec3(texture(source, clamp(uv - split, 0.0, 1.0)).r,
                     texture(source, uv).g,
                     texture(source, clamp(uv + split, 0.0, 1.0)).b);
  vec3 glow = texture(bloom0, uv).rgb * post[3].x
            + texture(bloom1, uv).rgb * post[3].y
            + texture(bloom2, uv).rgb * post[3].z;
  colour += glow * post[2].z;
  colour *= post[5].x;
  float shoulder = post[5].y;
  float headroom = max(1.0 - shoulder, 0.0001);
  float peak = max(colour.r, max(colour.g, colour.b));
  float over = max(peak - shoulder, 0.0);
  float rolled = min(peak, shoulder) + headroom * over / (over + headroom);
  vec3 tinted = colour * rolled / max(peak, 0.0001);
  vec3 each = max(colour - shoulder, 0.0);
  vec3 bleached = min(colour, shoulder) + headroom * each / (each + headroom);
  vec3 mapped = mix(tinted, bleached, clamp(over / headroom, 0.0, 1.0));
  colour = mix(colour, mapped, post[5].z);
  vec2 pixel = vec2(gl_FragCoord.x, post[0].y - gl_FragCoord.y);
  colour += (hash(pixel + post[6].y * 137.0) - 0.5) * post[6].x;
  result = vec4(max(colour, 0.0), 1.0);
}`

type Target = {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  width: number
  height: number
}
type Pass = {
  program: WebGLProgram
  post: WebGLUniformLocation | null
  step: WebGLUniformLocation | null
  data: Float32Array
}

/** The same bloom and composite maths as PostStack, for browsers without a WebGPU adapter. */
export class WebGLPost {
  readonly supportsFeedback = true
  readonly hdr: boolean
  private readonly passes: Pass[] = []
  private readonly vao: WebGLVertexArrayObject
  private readonly uniform = new Float32Array(POST_UNIFORM_FLOATS)
  private targets: Target[] = []
  private width = 0
  private height = 0
  private current = 0
  private historyReady = false

  constructor(private readonly gl: WebGL2RenderingContext) {
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('WebGL could not allocate the post vertex array')
    this.vao = vao
    this.hdr = false
    try {
      // Half floats are filterable in WebGL2. Probe renderability as drivers can
      // expose the extension yet reject an attachment; RGBA8 still renders.
      if (gl.getExtension('EXT_color_buffer_float')) {
        try {
          const probe = this.makeTarget(1, 1, true)
          this.deleteTarget(probe)
          this.hdr = true
        } catch {
          this.hdr = false
        }
      }
      for (const shader of [FEEDBACK, BRIGHT, BLUR, COMPOSITE])
        this.passes.push(this.makePass(shader))
    } catch (error) {
      this.dispose()
      throw error
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    }
  }

  /** Bind the scene attachment. The caller draws a full frame before render(). */
  target(width: number, height: number): void {
    width = Math.max(1, Math.floor(width))
    height = Math.max(1, Math.floor(height))
    if (width !== this.width || height !== this.height) {
      this.releaseTargets()
      try {
        this.targets.push(this.makeTarget(width, height, this.hdr))
        this.targets.push(this.makeTarget(width, height, this.hdr))
        for (let i = 0; i < BLOOM_LEVELS; i++) {
          const size = bloomLevelSize(width, height, i)
          this.targets.push(this.makeTarget(size.width, size.height, this.hdr))
          this.targets.push(this.makeTarget(size.width, size.height, this.hdr))
        }
        this.width = width
        this.height = height
      } catch (error) {
        this.releaseTargets()
        throw error
      }
    }
    this.bind(this.targets[this.current] ?? null)
    this.gl.disable(this.gl.BLEND)
    this.gl.disable(this.gl.DEPTH_TEST)
    this.gl.disable(this.gl.SCISSOR_TEST)
    this.gl.disable(this.gl.CULL_FACE)
    this.gl.colorMask(true, true, true, true)
  }

  render(params: PostParams, features: Float32Array): void {
    const gl = this.gl
    const scene = this.targets[this.current]
    const previous = this.targets[1 - this.current]
    const [feedback, bright, blur, composite] = this.passes
    if (!scene || !previous || !feedback || !bright || !blur || !composite) return
    writePostUniform(params, features, this.width, this.height, this.uniform)
    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)
    if (this.historyReady && stageEnabled(params, 'feedback')) {
      gl.enable(gl.BLEND)
      gl.blendEquation(gl.FUNC_ADD)
      gl.blendFunc(gl.ONE, gl.ONE)
      this.draw(feedback, previous, scene)
      gl.disable(gl.BLEND)
    }
    const first = this.targets[2]
    if (stageEnabled(params, 'bloom') && first) {
      this.draw(bright, scene, first)
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        const destination = this.targets[2 + i * 2]
        const temp = this.targets[3 + i * 2]
        const source = i === 0 ? first : this.targets[i * 2]
        if (!source || !destination || !temp) continue
        this.draw(blur, source, temp, 1 / source.width, 0)
        this.draw(blur, temp, destination, 0, 1 / temp.height)
      }
    }
    gl.useProgram(composite.program)
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      gl.activeTexture(gl.TEXTURE1 + i)
      gl.bindTexture(gl.TEXTURE_2D, this.targets[2 + i * 2]?.texture ?? null)
    }
    this.draw(composite, scene, null)
    this.current = 1 - this.current
    this.historyReady = true
    gl.bindVertexArray(null)
  }

  resetHistory(): void {
    this.historyReady = false
  }

  dispose(): void {
    // A deleted current program stays alive until unbound, including after a
    // later shader fails during construction and the caller retries startup.
    this.gl.useProgram(null)
    this.gl.bindVertexArray(null)
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    this.releaseTargets()
    for (const pass of this.passes) this.gl.deleteProgram(pass.program)
    this.passes.length = 0
    this.gl.deleteVertexArray(this.vao)
  }

  private bind(target: Target | null): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null)
    gl.viewport(0, 0, target?.width ?? this.width, target?.height ?? this.height)
  }

  private draw(pass: Pass, source: Target, target: Target | null, x = 0, y = 0): void {
    const gl = this.gl
    this.bind(target)
    gl.useProgram(pass.program)
    if (pass.post) gl.uniform4fv(pass.post, pass.data)
    gl.uniform2f(pass.step, x, y)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source.texture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private makeTarget(width: number, height: number, hdr: boolean): Target {
    const gl = this.gl
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) {
      gl.deleteTexture(texture)
      gl.deleteFramebuffer(framebuffer)
      throw new Error('WebGL could not allocate a post target')
    }
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      hdr ? gl.RGBA16F : gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
      null,
    )
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture)
      gl.deleteFramebuffer(framebuffer)
      throw new Error('WebGL post framebuffer is incomplete')
    }
    gl.clearColor(0, 0, 0, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    return { texture, framebuffer, width, height }
  }

  private deleteTarget(target: Target): void {
    this.gl.deleteTexture(target.texture)
    this.gl.deleteFramebuffer(target.framebuffer)
  }

  private releaseTargets(): void {
    for (const target of this.targets) this.deleteTarget(target)
    this.targets = []
    this.width = this.height = this.current = 0
    this.historyReady = false
  }

  private makePass(fragment: string): Pass {
    const gl = this.gl
    const shaders: WebGLShader[] = []
    const program = gl.createProgram()
    if (!program) throw new Error('WebGL could not allocate a post program')
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, VERTEX],
        [gl.FRAGMENT_SHADER, COMMON + fragment],
      ] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('WebGL could not allocate a post shader')
        shaders.push(shader)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(`WebGL post shader: ${gl.getShaderInfoLog(shader) ?? 'compile failed'}`)
        gl.attachShader(program, shader)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(`WebGL post link: ${gl.getProgramInfoLog(program) ?? 'link failed'}`)
      gl.useProgram(program)
      for (const [index, name] of ['source', 'bloom0', 'bloom1', 'bloom2'].entries())
        gl.uniform1i(gl.getUniformLocation(program, name), index)
      let postSize = 0
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
      for (let index = 0; index < count; index++) {
        const active = gl.getActiveUniform(program, index)
        if (active?.name === 'post[0]') postSize = active.size
      }
      return {
        program,
        post: gl.getUniformLocation(program, 'post[0]'),
        step: gl.getUniformLocation(program, 'stepSize'),
        data: this.uniform.subarray(0, postSize * 4),
      }
    } catch (error) {
      gl.deleteProgram(program)
      throw error
    } finally {
      for (const shader of shaders) gl.deleteShader(shader)
    }
  }
}
