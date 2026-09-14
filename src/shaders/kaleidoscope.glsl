#version 300 es
precision highp float;
precision highp int;

layout(std140) uniform Params {
  vec4 screen;
  vec4 form;
  vec4 detail;
  vec4 colour;
  vec4 response;
  vec4 bands[5];
} p;

layout(location = 0) out vec4 fragColour;
const float TAU = 6.28318530718;

vec2 rotate(vec2 v, float a) {
  return mat2(cos(a), sin(a), -sin(a), cos(a)) * v;
}

vec3 palette(float t) {
  return pow(0.5 + 0.5 * cos(TAU * (t + vec3(0.04, 0.37, 0.67))), vec3(1.45));
}

vec3 originOf(vec3 point) {
  float wedge = TAU / p.form.y;
  float angle = atan(point.y, point.x) + p.screen.z + point.z * (0.02 + p.form.w * 0.065);
  float a = abs(fract(angle / wedge + 0.5) - 0.5) * wedge;
  float r = length(point.xy);
  return vec3(r * cos(a), r * sin(a), point.z + sin(p.screen.w) * 0.08) * 0.7;
}

vec4 fold(vec3 z, vec3 origin, int i) {
  int owner = min(4, i * 5 / (int(p.detail.x) + 2));
  vec4 voice = p.bands[owner];
  float drive = p.response.x * (voice.x * 0.4 + voice.y * 0.6);
  float limit = 1.0 + (p.detail.z - 0.42) * 0.02 + (owner == 0 ? p.detail.w * 0.008 : 0.0);
  vec3 box = clamp(z, vec3(-limit), vec3(limit)) * 2.0 - z;
  float k = 2.15 / clamp(dot(box, box), 0.34, 1.0);
  vec3 scaled = box * k;
  vec2 xy = rotate(scaled.xy, (0.065 + p.detail.y * 0.1) * sin(p.form.x + float(i) * 0.4) + drive * 0.018);
  return vec4(vec3(xy, scaled.z) + origin, k);
}

// Keep the distance pass separate so material orbits are evaluated only at hits.
float distanceToFractal(vec3 point) {
  vec3 origin = originOf(point);
  vec3 z = origin;
  float derivative = 1.0;
  for (int i = 0; i < int(p.detail.x) + 2; i++) {
    vec4 next = fold(z, origin, i);
    z = next.xyz;
    derivative = derivative * next.w + 1.0;
  }
  return length(z) / derivative / 0.7;
}

vec3 surface(vec3 point, vec3 normal, vec3 ray, float occlusion) {
  vec3 origin = originOf(point);
  vec3 z = origin;
  float traps[5] = float[5](1.0, 1.0, 1.0, 1.0, 1.0);
  float derivative = 1.0;
  float footprint = max(0.001, length(point - vec3(0.0, 0.0, -5.2)) / min(p.screen.x, p.screen.y));
  for (int i = 0; i < int(p.detail.x) + 2; i++) {
    vec4 next = fold(z, origin, i);
    z = next.xyz;
    derivative = derivative * next.w + 1.0;
    int owner = min(4, i * 5 / (int(p.detail.x) + 2));
    float plane = abs(z[owner % 3]) / (0.25 + length(z));
    float resolved = 1.0 - smoothstep(0.08, 0.5, footprint * derivative);
    traps[owner] = min(traps[owner], mix(1.0, plane, resolved));
  }
  vec3 light = normalize(vec3(-0.45, 0.7, -1.0));
  float diffuse = max(0.0, dot(normal, light));
  float side = max(0.0, dot(normal, normalize(vec3(0.8, -0.2, -0.6))));
  float specular = pow(max(0.0, dot(reflect(ray, normal), light)), 36.0);
  float fresnel = pow(1.0 - max(0.0, dot(normal, -ray)), 3.0);
  vec3 colour = vec3(0.0);
  // Each band colours its assigned recursion scale within the shared field.
  for (int band = 0; band < 5; band++) {
    vec4 voice = p.bands[band];
    float fb = float(band);
    float gain = smoothstep(0.005, 0.035, voice.x) * min(1.5, p.response.x * (voice.x + voice.y * 0.55));
    float ridge = 1.0 - smoothstep(0.018, 0.27 / (1.0 + fb * 0.17), traps[band]);
    float broad = band < 2 ? 0.19 : 0.0;
    float mask = broad + (1.0 - broad) * ridge;
    float hue = p.colour.w + fb * 0.18 + point.z * 0.16 + length(point.xy) * 0.11 + dot(normal, light) * 0.12 + sin(voice.z) * 0.035;
    vec3 pigment = palette(hue);
    vec3 enamel = pigment * (0.16 + diffuse * 0.8 + side * 0.25) * occlusion;
    vec3 accent = palette(hue + 0.12) * (specular * (0.06 + fb * 0.015 + (band == 4 ? p.colour.x * 0.15 : 0.0)) + fresnel * 0.12) * voice.y;
    colour = mix(colour, enamel, clamp(mask * gain * 0.98, 0.0, 1.0));
    colour += accent * gain + pigment * ridge * voice.y * gain * 0.1;
  }
  return colour;
}

vec4 sampleScene(vec2 pixel) {
  float energy = 0.0;
  for (int b = 0; b < 5; b++) energy = max(energy, p.bands[b].x);
  if (energy < 0.005 || p.response.x <= 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  vec2 q = (pixel * 2.0 - p.screen.xy) / min(p.screen.x, p.screen.y);
  float zoom = log(max(p.form.z, 0.1));
  vec3 ro = vec3(0.0, 0.0, -(5.2 - clamp(zoom, -1.5, 2.0) * 0.7));
  vec3 rd = normalize(vec3(q / exp(zoom * 0.75), 1.65));
  float distance = 0.35;
  bool found = false;
  float steps = 0.0;
  int limit = p.response.y > 0.5 ? 44 : 72;
  float footprint = 1.0 / min(p.screen.x, p.screen.y);
  for (int i = 0; i < limit; i++) {
    if (distance > 10.0) break;
    float d = distanceToFractal(ro + rd * distance);
    if (d < max(0.0005, distance * footprint * 0.75)) {
      found = true;
      break;
    }
    distance += max(d * 0.65, 0.0004);
    steps += 1.0;
  }
  vec3 colour = vec3(0.0);
  if (found) {
    vec3 point = ro + rd * distance;
    float e = max(0.0015, distance * footprint * 2.5);
    vec3 a = vec3(1.0, -1.0, -1.0);
    vec3 b = vec3(-1.0, -1.0, 1.0);
    vec3 c = vec3(-1.0, 1.0, -1.0);
    vec3 d = vec3(1.0, 1.0, 1.0);
    vec3 gradient = a * distanceToFractal(point + a * e) + b * distanceToFractal(point + b * e) + c * distanceToFractal(point + c * e) + d * distanceToFractal(point + d * e);
    vec3 normal = gradient / max(length(gradient), 0.000001);
    float occlusion = exp(-steps * 0.018);
    colour = surface(point, normal, rd, occlusion);
  }
  colour = max(vec3(0.0), colour - vec3(min(colour.r, min(colour.g, colour.b)) * 0.7));
  float grey = dot(colour, vec3(0.2126, 0.7152, 0.0722));
  return vec4(max(vec3(0.0), mix(vec3(grey), colour, p.colour.z)) * p.colour.y * 2.2, 1.0);
}

vec4 spatialSamples(vec2 pixel) {
  float smaller = min(p.screen.x, p.screen.y);
  if (p.response.y > 0.5 || smaller >= 1440.0) return sampleScene(pixel);
  if (smaller >= 900.0) {
    return (sampleScene(pixel + vec2(-0.25, 0.25)) + sampleScene(pixel + vec2(0.25, -0.25))) * 0.5;
  }
  return (sampleScene(pixel + vec2(-0.125, -0.375))
    + sampleScene(pixel + vec2(0.375, -0.125))
    + sampleScene(pixel + vec2(-0.375, 0.125))
    + sampleScene(pixel + vec2(0.125, 0.375))) * 0.25;
}

void main() {
  // WebGL's lower-left fragment origin must match the WGSL upper-left origin.
  fragColour = spatialSamples(vec2(gl_FragCoord.x, p.screen.y - gl_FragCoord.y));
}
