import {
  BLOOM_LEVELS,
  bloomLevelSize,
  freshWeight,
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
// The uniform's fifteen vec4s. The eighth is the flow block and nothing on
// this path solves a velocity field, so it is uploaded and never read; the
// ninth is the floor and the fade's knee, which the feedback pass below does
// use. The tenth and eleventh are the ribbon's, which this path does not draw,
// so nothing reads them. The twelfth is the grade and the thirteenth the gate
// weave, which only the composite reads. The last two are the canvas hold and
// what ages inside the loop; the feedback pass below reads the step out of the
// first of them and all of the second, and leaves the hold itself alone, for
// the reason the class comment gives. `data` uploads as many of them as the
// program it belongs to declares live, which is the highest one it reads, so
// the feedback pass sends all fifteen and so does the composite.
const COMMON = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 result;
uniform vec4 post[15];
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
// The zoom and the turn, then the sharpen, the two floors, the ceiling, the
// channels parting and the hue turning: everything the WGSL pass does except
// the carry and the canvas hold. With no fluid here there is no velocity field
// to read the last frame back along, so that term is the identity whatever a
// cast asks for, and the hold wants a ladder of passes down to one texel,
// which is the one thing on this path worth skipping. Everything else depends
// on nothing but the history, so all of it is the same maths as
// post.feedback.wgsl, and every term is exactly off at zero.
const FEEDBACK = `
void main() {
  float zoom = max(post[1].z, 0.001), angle = -post[1].w;
  vec2 aspect = vec2(post[0].x / max(post[0].y, 1.0), 1.0);
  vec2 centred = (uv - 0.5) * aspect;
  float s = sin(angle), c = cos(angle);
  vec2 spun = vec2(centred.x * c - centred.y * s, centred.x * s + centred.y * c) / zoom;
  vec2 wanted = spun / aspect + 0.5;
  vec2 at = clamp(wanted, vec2(0.0), vec2(1.0));
  // Nothing to carry from off the edge; see post.feedback.wgsl.
  vec2 off = max(abs(wanted - 0.5) - 0.5, vec2(0.0));
  float inside = off.x + off.y <= 0.0 ? 1.0 : 0.0;
  float frames = post[13].x;
  vec3 taken = texture(source, at).rgb;
  float crisp = post[14].z;
  if (crisp > 0.0) {
    vec2 reach = post[0].zw;
    vec3 around = texture(source, clamp(at + vec2(reach.x, 0.0), 0.0, 1.0)).rgb
                + texture(source, clamp(at - vec2(reach.x, 0.0), 0.0, 1.0)).rgb
                + texture(source, clamp(at + vec2(0.0, reach.y), 0.0, 1.0)).rgb
                + texture(source, clamp(at - vec2(0.0, reach.y), 0.0, 1.0)).rgb;
    taken = max(taken + (taken - around * 0.25) * crisp, 0.0);
  }
  float cool = post[14].y;
  vec3 parted = vec3(1.0 - max(cool, 0.0), 1.0, 1.0 - max(-cool, 0.0));
  vec3 old = taken * post[1].x * post[1].y * pow(parted, vec3(frames)) * inside;
  // The brightest channel carries every limit and the other two follow it,
  // so a long trail loses brightness rather than colour.
  float peak = max(max(old.r, max(old.g, old.b)), 0.0);
  float left = max(peak - post[8].x, 0.0);
  float knee = post[8].y;
  if (knee > 0.0) left *= pow(left / (left + knee), frames);
  float shoulder = max(post[7].y, 1e-4) * 0.5;
  float over = max(left - shoulder, 0.0);
  float rolled = min(left, shoulder) + shoulder * over / (over + shoulder);
  vec3 carried = old * (rolled / max(peak, 1e-5));
  // The hue of what survives, turned about the grey axis; 0 is the identity.
  float turn = post[14].x;
  vec3 axis = vec3(0.5773502692);
  vec3 aged = turn == 0.0 ? carried
    : carried * cos(turn) + cross(axis, carried) * sin(turn)
      + axis * dot(axis, carried) * (1.0 - cos(turn));
  result = vec4(max(aged, 0.0), 1.0);
}`
const COMPOSITE = `
uniform sampler2D bloom0;
uniform sampler2D bloom1;
uniform sampler2D bloom2;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 split = (uv - 0.5) * post[4].x;
  // The gate weave, as post.composite.wgsl has it: the frame is read from a
  // span narrowed about the middle and moved, so it never leaves the texture,
  // while the vignette and the split's centre stay with the screen. Both
  // terms are 0 with the weave off, so framed is uv exactly.
  vec2 framed = uv - (uv - 0.5) * post[12].zw + post[12].xy;
  vec3 colour = vec3(texture(source, clamp(framed - split, 0.0, 1.0)).r,
                     texture(source, framed).g,
                     texture(source, clamp(framed + split, 0.0, 1.0)).b);
  vec3 glow = texture(bloom0, framed).rgb * post[3].x
            + texture(bloom1, framed).rgb * post[3].y
            + texture(bloom2, framed).rgb * post[3].z;
  colour += glow * post[2].z;
  // The grade, as post.composite.wgsl has it: the vignette, then the colour
  // scaled about its luminance, both exact copies at the neutral numbers.
  float inner = 1.0 - post[11].x;
  colour *= 1.0 - smoothstep(inner, inner + post[11].z, length(uv - 0.5) * 1.4142136);
  colour = mix(vec3(dot(colour, vec3(0.2126, 0.7152, 0.0722))), colour, post[11].y);
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

/**
 * The same bloom and composite maths as PostStack, for browsers without a
 * WebGPU adapter. Kaleidoscope is the only scene that reaches it and there is
 * no compute here to solve a fluid with, so the feedback pass carries nothing
 * along a flow; `feedback.carry` reads as zero whatever a preset asks for.
 * `feedback.hold` is skipped for the same kind of reason: it wants a ladder of
 * passes reducing the frame to one texel, and this path is a fallback rather
 * than a second implementation. So a cast that leans on the hold to keep a
 * long memory in bounds here has only `feedback.ceiling` holding it, which is
 * what held it before the hold existed. `floor`, `fade`, `cool`, `hue`,
 * `sharpen` and `ceiling` need no flow and no measurement, so all six apply
 * here exactly as they do on the WebGPU path, and so does the grade, a few
 * lines of the composite, the gate weave among them. The ribbon is skipped: it wants the
 * analyser's waveform and a strip drawn into the scene's target, and this path
 * has neither. A preset that turns it on still draws, without the line, and
 * nothing here reads or throws on its numbers.
 */
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
      // The constant weights the frame already in the target; see feedbackStep.
      const fresh = freshWeight(params, features)
      gl.blendColor(fresh, fresh, fresh, 1)
      gl.blendFunc(gl.ONE, gl.CONSTANT_COLOR)
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
