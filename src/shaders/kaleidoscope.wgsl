struct Params {
  screen: vec4<f32>, // resolution, rotation, travel
  form: vec4<f32>,   // morph, symmetry, zoom, depth
  detail: vec4<f32>, // fold budget, warp, thickness, sub expansion trim
  colour: vec4<f32>, // treble highlight trim, intensity, saturation, palette
  response: vec4<f32>, // band gain, software adapter
  bands: array<vec4<f32>, 5>, // level, hit envelope, phase, hit width
}
@group(0) @binding(0) var<uniform> p: Params;
const TAU = 6.28318530718;
const LOD_LOW = 0.05;
const LOD_HIGH = 0.25;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}
fn rotate(v: vec2<f32>, a: f32) -> vec2<f32> {
  return mat2x2<f32>(cos(a),sin(a),-sin(a),cos(a))*v;
}
fn palette(t: f32) -> vec3<f32> {
  return pow(0.5+0.5*cos(TAU*(t+vec3<f32>(0.04,0.37,0.67))),vec3<f32>(1.45));
}
fn originOf(point: vec3<f32>) -> vec3<f32> {
  let wedge = TAU/p.form.y;
  let angle = atan2(point.y,point.x)+p.screen.z+point.z*(0.02+p.form.w*0.065);
  let a = abs(fract(angle/wedge+0.5)-0.5)*wedge;
  let r = length(point.xy);
  return vec3<f32>(r*cos(a),r*sin(a),point.z+sin(p.screen.w)*0.08)*0.7;
}
fn fold(z: vec3<f32>, origin: vec3<f32>, i: i32) -> vec4<f32> {
  let owner = min(4,i*5/(i32(p.detail.x)+2));
  let voice = p.bands[owner];
  let drive = p.response.x*(voice.x*0.4+voice.y*0.6);
  let limit = 1.0+(p.detail.z-0.42)*0.02+select(0.0,p.detail.w*0.008,owner==0);
  let box = clamp(z,vec3<f32>(-limit),vec3<f32>(limit))*2.0-z;
  let k = 2.15/clamp(dot(box,box),0.34,1.0);
  let scaled = box*k;
  let xy = rotate(scaled.xy,(0.065+p.detail.y*0.1)*sin(p.form.x+f32(i)*0.4)+drive*0.018);
  return vec4<f32>(vec3<f32>(xy,scaled.z)+origin,k);
}
// Box and sphere folds carry a scalar derivative, bounding a safe march step.
// Keep this pass distance-only; five material scales are sampled once at the hit.
// The march passes `pixel` as zero and gets every fold, since the surface is
// wherever the derivative grows large enough. The normal passes the world size
// of a pixel: a fold with creases below that only scrambles the gradient, which
// shimmers, so those folds fade out of the field the normal is taken from.
fn distanceToFractal(point: vec3<f32>, pixel: f32) -> f32 {
  let origin = originOf(point);
  var z = origin;
  var derivative = 1.0;
  var estimate = length(z);
  for(var i=0;i<i32(p.detail.x)+2;i++) {
    let next = fold(z,origin,i);
    z = next.xyz;
    derivative = derivative*next.w+1.0;
    let unresolved = smoothstep(LOD_LOW,LOD_HIGH,derivative*pixel);
    if(i>1 && unresolved>=1.0){break;}
    estimate = mix(length(z)/derivative,estimate,select(unresolved,0.0,i<2));
  }
  return estimate/0.7;
}
fn surface(point: vec3<f32>, normal: vec3<f32>, ray: vec3<f32>, occlusion: f32) -> vec3<f32> {
  let origin = originOf(point);
  var z = origin;
  var traps = array<f32,5>(1.0,1.0,1.0,1.0,1.0);

  var derivative = 1.0;
  let footprint = max(0.001,length(point-vec3<f32>(0.0,0.0,-5.2))/min(p.screen.x,p.screen.y));
  for(var i=0;i<i32(p.detail.x)+2;i++) {
    let next = fold(z,origin,i);
    z = next.xyz;
    derivative = derivative*next.w+1.0;
    let owner = min(4,i*5/(i32(p.detail.x)+2));
    let plane = abs(z[owner%3])/(0.25+length(z));
    let resolved = 1.0-smoothstep(0.08,0.5,footprint*derivative);
    traps[owner] = min(traps[owner],mix(1.0,plane,resolved));

  }
  let light = normalize(vec3<f32>(-0.45,0.7,-1.0));
  let diffuse = max(0.0,dot(normal,light));
  let side = max(0.0,dot(normal,normalize(vec3<f32>(0.8,-0.2,-0.6))));
  let specular = pow(max(0.0,dot(reflect(ray,normal),light)),36.0);
  let fresnel = pow(1.0-max(0.0,dot(normal,-ray)),3.0);
  var colour = vec3<f32>(0.0);
  // Coarse folds carry weight; finer folds carry mids, then bright treble seams.
  // An inactive voice contributes no colour, even when another band is loud.
  for(var band=0;band<5;band++) {
    let voice = p.bands[band];
    let fb = f32(band);
    let gain = smoothstep(0.005,0.035,voice.x)*min(1.5,p.response.x*(voice.x+voice.y*0.55));
    let ridge = 1.0-smoothstep(0.018,0.27/(1.0+fb*0.17),traps[band]);
    let broad = select(0.0,0.19,band<2);
    let mask = broad+(1.0-broad)*ridge;
    let hue = p.colour.w+fb*0.18+point.z*0.16+length(point.xy)*0.11+dot(normal,light)*0.12+sin(voice.z)*0.035;
    let pigment = palette(hue);
    let enamel = pigment*(0.16+diffuse*0.8+side*0.25)*occlusion;
    let accent = palette(hue+0.12)*(specular*(0.06+fb*0.015+select(0.0,p.colour.x*0.15,band==4))+fresnel*0.12)*voice.y;
    colour = mix(colour,enamel,clamp(mask*gain*0.98,0.0,1.0));
    colour += accent*gain+pigment*ridge*voice.y*gain*0.1;
  }
  return colour;
}
fn sampleScene(pixel: vec2<f32>) -> vec4<f32> {
  var energy = 0.0;
  for(var b=0;b<5;b++){energy=max(energy,p.bands[b].x);}
  if(energy<0.005 || p.response.x<=0.0){return vec4<f32>(0.0,0.0,0.0,1.0);}
  let q = (pixel*2.0-p.screen.xy)/min(p.screen.x,p.screen.y);
  let zoom = log(max(p.form.z,0.1));
  let ro = vec3<f32>(0.0,0.0,-(5.2-clamp(zoom,-1.5,2.0)*0.7));
  let rd = normalize(vec3<f32>(q/exp(zoom*0.75),1.65));
  var distance = 0.35;
  var found = false;
  var steps = 0.0;
  let limit = select(72,44,p.response.y>0.5);
  // The sweep narrows the field of view, which shrinks a pixel with it.
  let footprint = 1.0/(min(p.screen.x,p.screen.y)*exp(zoom*0.75));
  for(var i=0;i<limit;i++) {
    if(distance>10.0){break;}
    let d = distanceToFractal(ro+rd*distance,0.0);
    if(d<max(0.0005,distance*footprint*0.75)){found=true;break;}
    distance+=max(d*0.65,0.0004);
    steps+=1.0;
  }
  var colour = vec3<f32>(0.0);
  if(found) {
    let point = ro+rd*distance;
    let e = max(0.0015,distance*footprint*2.5);
    // Tetrahedral gradient needs four distance samples and remains isotropic.
    let a = vec3<f32>(1.0,-1.0,-1.0);
    let b = vec3<f32>(-1.0,-1.0,1.0);
    let c = vec3<f32>(-1.0,1.0,-1.0);
    let d = vec3<f32>(1.0,1.0,1.0);
    let size = distance*footprint;
    let gradient = a*distanceToFractal(point+a*e,size)+b*distanceToFractal(point+b*e,size)+c*distanceToFractal(point+c*e,size)+d*distanceToFractal(point+d*e,size);
    let normal = gradient/max(length(gradient),0.000001);
    let occlusion = exp(-steps*0.018);
    colour = surface(point,normal,rd,occlusion);
  }
  colour = max(vec3<f32>(0.0),colour-vec3<f32>(min(colour.r,min(colour.g,colour.b))*0.7));
  let grey = dot(colour,vec3<f32>(0.2126,0.7152,0.0722));
  return vec4<f32>(max(vec3<f32>(0.0),mix(vec3<f32>(grey),colour,p.colour.z))*p.colour.y*2.2,1.0);
}







// Rotated spatial samples resolve subpixel ridges without trails or history.
// Higher-resolution canvases already sample a smaller area of the fractal.
@fragment fn fs(@builtin(position) pixel: vec4<f32>) -> @location(0) vec4<f32> {
  let smaller = min(p.screen.x,p.screen.y);
  if(p.response.y>0.5 || smaller>=1440.0) { return sampleScene(pixel.xy); }
  if(smaller>=900.0) {
    return (sampleScene(pixel.xy+vec2<f32>(-0.25,0.25))+sampleScene(pixel.xy+vec2<f32>(0.25,-0.25)))*0.5;
  }
  return (sampleScene(pixel.xy+vec2<f32>(-0.125,-0.375))
    +sampleScene(pixel.xy+vec2<f32>(0.375,-0.125))
    +sampleScene(pixel.xy+vec2<f32>(-0.375,0.125))
    +sampleScene(pixel.xy+vec2<f32>(0.125,0.375)))*0.25;
}
