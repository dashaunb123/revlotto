// HDR post pipeline for the 3D mode.
//   const post = createComposer(renderer, scene, camera, quality);  post.render(dt) each frame instead of renderer.render.
// Frame: scene -> HDR target (half float, depth texture, MSAA on high) -> user HDR passes (insertPass: e.g. heat haze)
// -> GTAO (high) -> speed blur (depth-masked directional/radial) -> bokeh DOF (half res, gather) -> bloom (13-tap
// down / tent up mip chain) -> composite (exposure, ACES filmic, lift/gamma/gain grade, split tone, vignette, chromatic
// aberration, grain, dither, sRGB) -> SMAA (medium) / FXAA (low) -> canvas (optionally a sub-rect: setViewport).
// Don't enable logarithmicDepthBuffer: DOF, AO and the speed-blur mask read the depth buffer.
import * as THREE from 'three';
import { FullScreenQuad, type Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { Quality } from '../../game/settings';

/**
 * Enable this layer on every mesh of the race cars (mesh.layers.enable(CAR_MASK_LAYER), keep layer 0): the composer then
 * renders a half-res car mask each frame and the speed blur leaves BOTH cars sharp (no smeared rival, no sharp
 * bubble). Without any object on the layer it falls back to the ellipse/depth opts of setSpeedBlur.
 */
export const CAR_MASK_LAYER = 7;

export interface Grade {
  exposure: number;
  /** 0 = plain per-channel ACES, 1 = fully hue-preserving (no pink reds / purple blues). */
  huePreserve: number;
  saturation: number;
  contrast: number;
  /** Per-channel lift / gamma / gain (display space). */
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  /** Split toning: shadow and highlight tints ('#rrggbb') and amount. */
  shadowTint: string;
  highlightTint: string;
  tint: number;
  vignette: number;
  chroma: number;
  grain: number;
}

export interface BloomOpts {
  strength: number;
  radius: number;
  threshold: number;
}

export interface SpeedBlurOpts {
  /** Screen direction the background streams in (x right, y up); default [-1, 0] (side tracking shot). */
  dir?: [number, number];
  /** Radial zoom blur from `center` (chase / nitrous shots). */
  radial?: boolean;
  center?: [number, number];
  /**
   * The player's car, kept sharp: a screen-space ellipse in UV (origin bottom-left, like gl/three UVs: u = ndc.x*0.5+0.5,
   * v = ndc.y*0.5+0.5; rx/ry are half-extents in UV) plus its camera distance `depth` (m, Euclidean, to the car centre).
   * Only pixels inside the ellipse AND within ~3.5 m of `depth` are protected; blur taps landing on the car are dropped.
   */
  ellipse?: { cx: number; cy: number; rx: number; ry: number };
  depth?: number;
  /** Blur strength scales with nearness: clamp(near / dist, 0.2, 1) (default near = 9 m). Sky and skyline get none. */
  near?: number;
  /** Legacy (pre-ellipse): treated as the car depth with a default centre ellipse. */
  protect?: number;
}

export interface Post {
  render(dt?: number): void;
  /** CSS px (multiplied by renderer.getPixelRatio()). */
  setSize(w: number, h: number): void;
  setQuality(q: Quality): void;
  setCamera(c: THREE.Camera): void;
  setScene(s: THREE.Scene): void;
  /** Focus distance (m) + aperture 0..1 (0 = DOF off). */
  setFocus(dist: number, aperture: number): void;
  /** 0..1 speed feel; 0 = off. */
  setSpeedBlur(k: number, o?: SpeedBlurOpts): void;
  /** Chromatic aberration amount (a speed cue: ~0.2 at rest, rising with speed / nitrous). Cheap; call per frame. */
  setChroma(k: number): void;
  setBloom(o: Partial<BloomOpts>): void;
  /** Ambient occlusion strength 0..1 and the view-depth range (m) over which it fades out (high preset only). */
  setAO(o: { intensity?: number; fadeNear?: number; fadeFar?: number }): void;
  setGrade(o: Partial<Grade>): void;
  gradePreset(name: 'race' | 'studio' | 'victory' | 'neutral'): void;
  /** Three Pass objects run on the HDR buffer (after the scene render, before AO/blur/bloom). */
  addPass(p: Pass): void;
  insertPass(p: Pass, index: number): void;
  removePass(p: Pass): void;
  /** Draw the final image into a sub-rect of the canvas (CSS px, origin bottom-left like renderer.setViewport). */
  setViewport(x: number, y: number, w: number, h: number): void;
  clearViewport(): void;
  readonly sceneTarget: THREE.WebGLRenderTarget;
  readonly quality: Quality;
  /** Last frame's CPU-side submit time (ms) for perf HUDs. */
  readonly stats: { ms: number };
  dispose(): void;
}

interface Preset {
  msaa: number;
  aa: 'fxaa' | 'smaa' | 'none';
  ao: boolean;
  bloomMips: number;
  dofRad: number; // gather ring step (smaller = more taps, nicer)
  dofMax: number; // max blur radius (half-res px)
  blurTaps: number;
  chroma: boolean;
}

export const POST_PRESETS: Record<Quality, Preset> = {
  low: { msaa: 0, aa: 'fxaa', ao: false, bloomMips: 4, dofRad: 2.6, dofMax: 7, blurTaps: 6, chroma: false },
  medium: { msaa: 0, aa: 'smaa', ao: false, bloomMips: 5, dofRad: 1.6, dofMax: 10, blurTaps: 10, chroma: true },
  high: { msaa: 4, aa: 'none', ao: true, bloomMips: 6, dofRad: 1.15, dofMax: 13, blurTaps: 16, chroma: true },
};

const GRADES: Record<'race' | 'studio' | 'victory' | 'neutral', Partial<Grade>> = {
  neutral: { exposure: 1, huePreserve: 0.55, saturation: 1, contrast: 0, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], tint: 0, vignette: 0.2, chroma: 0, grain: 0 },
  // Night strip: cool teal shadows, warm sodium highlights, a punchy curve.
  race: { exposure: 1.05, saturation: 1.08, contrast: 0.22, lift: [0.0, 0.006, 0.014], gamma: [1, 1, 1.02], gain: [1.02, 1, 0.98], shadowTint: '#2a6a8a', highlightTint: '#ffb070', tint: 0.07, vignette: 0.34, chroma: 0.2, grain: 0.035 },
  studio: { exposure: 0.92, saturation: 1.04, contrast: 0.14, lift: [0.004, 0.004, 0.008], gamma: [1, 1, 1], gain: [1, 1, 1], shadowTint: '#3a4a6a', highlightTint: '#fff0e0', tint: 0.04, vignette: 0.3, chroma: 0.35, grain: 0.02 },
  victory: { exposure: 1.1, saturation: 1.15, contrast: 0.18, lift: [0.01, 0.006, 0.0], gamma: [1, 1, 1], gain: [1.04, 1.0, 0.94], shadowTint: '#4a3a6a', highlightTint: '#ffc060', tint: 0.1, vignette: 0.3, chroma: 0.5, grain: 0.03 },
};

// ---------------------------------------------------------------------------------------------------------------
// Shaders

const VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DEPTH_FN = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float uNear, uFar;
uniform float uOrtho;
uniform vec2 uRay; // (tan(fov/2) * aspect, tan(fov/2)): view-ray slope at the screen edge
float viewDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (d >= 1.0) return uFar * 4.0;
  return uOrtho > 0.5 ? -orthographicDepthToViewZ(d, uNear, uFar) : -perspectiveDepthToViewZ(d, uNear, uFar);
}
// Camera-to-surface distance (what callers mean by 'focus distance'), not view-axis depth.
float viewDist(vec2 uv) {
  float z = viewDepth(uv);
  return uOrtho > 0.5 ? z : z * length(vec3((uv * 2.0 - 1.0) * uRay, 1.0));
}`;

// Signed circle of confusion in half-res px. An in-focus band around the focus distance keeps a whole car sharp.
const COC_FN = /* glsl */ `
uniform float uFocus, uAperture, uMaxR;
float cocHalf(float dist) {
  float band = max(0.4, uFocus * 0.22);
  float d = max(abs(dist - uFocus) - band, 0.0);
  float c = clamp(d / max(dist, 1e-3) * 2.2, 0.0, 1.0) * uAperture * uMaxR;
  return dist < uFocus ? -c : c;
}`;

function mat(fs: string, uniforms: Record<string, THREE.IUniform>, defines: Record<string, number | string> = {}, blending: THREE.Blending = THREE.NoBlending) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, defines, depthTest: false, depthWrite: false, blending, toneMapped: false });
}

// Bloom: 13-tap downsample (Jimenez 2014) with soft-knee threshold + Karis average on the first level.
const DOWN_FS = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold, uKnee;
varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d) {
  float wa = 1.0 / (1.0 + lum(a)), wb = 1.0 / (1.0 + lum(b)), wc = 1.0 / (1.0 + lum(c)), wd = 1.0 / (1.0 + lum(d));
  return (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
}
vec3 T(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 a = T(vec2(-2, 2)), b = T(vec2(0, 2)), c = T(vec2(2, 2));
  vec3 d = T(vec2(-2, 0)), e = T(vec2(0, 0)), f = T(vec2(2, 0));
  vec3 g = T(vec2(-2, -2)), h = T(vec2(0, -2)), i = T(vec2(2, -2));
  vec3 j = T(vec2(-1, 1)), k = T(vec2(1, 1)), l = T(vec2(-1, -1)), m = T(vec2(1, -1));
  vec3 col;
  if (uFirst > 0.5) {
    col = karis(j, k, l, m) * 0.5 + karis(a, b, d, e) * 0.125 + karis(b, c, e, f) * 0.125 + karis(d, e, g, h) * 0.125 + karis(e, f, h, i) * 0.125;
    float br = max(col.r, max(col.g, col.b));
    float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    col *= max(soft, br - uThreshold) / max(br, 1e-4);
    col = min(col, vec3(64.0));
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const UP_FS = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uScale;
varying vec2 vUv;
vec3 T(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = T(vec2(0)) * 4.0 + (T(vec2(-1, 0)) + T(vec2(1, 0)) + T(vec2(0, -1)) + T(vec2(0, 1))) * 2.0
    + T(vec2(-1, -1)) + T(vec2(1, -1)) + T(vec2(-1, 1)) + T(vec2(1, 1));
  gl_FragColor = vec4(c / 16.0 * uScale, 1.0);
}`;

// DOF prefilter (half res): colour + signed circle of confusion (half-res px) in alpha.
const COC_FS = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
${DEPTH_FN}
${COC_FN}
void main() {
  vec3 c = (texture2D(tColor, vUv + uTexel * vec2(-0.5, -0.5)).rgb + texture2D(tColor, vUv + uTexel * vec2(0.5, -0.5)).rgb
    + texture2D(tColor, vUv + uTexel * vec2(-0.5, 0.5)).rgb + texture2D(tColor, vUv + uTexel * vec2(0.5, 0.5)).rgb) * 0.25;
  gl_FragColor = vec4(min(c, vec3(10.0)), cocHalf(viewDist(vUv)));
}`;

// Single-pass golden-angle gather (after Dennis Gustafsson's bokeh).
const BOKEH_FS = /* glsl */ `
uniform sampler2D tCoc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec4 ctr = texture2D(tCoc, vUv);
  float cSize = abs(ctr.a);
  vec3 col = ctr.rgb;
  float tot = 1.0;
  float radius = RAD_SCALE;
  float ang = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  for (int i = 0; i < 400; i++) {
    if (radius >= MAX_BLUR) break;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
    vec4 s = texture2D(tCoc, tc);
    float sSize = abs(s.a);
    if (s.a > ctr.a) sSize = clamp(sSize, 0.0, cSize * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, sSize);
    col += mix(col / tot, s.rgb, m);
    tot += 1.0;
    radius += RAD_SCALE / radius;
    ang += 2.39996323;
  }
  gl_FragColor = vec4(col / tot, cSize);
}`;

// Speed blur: strength by NEARNESS (near walls/boards/lane stream, the far crowd barely moves, sky/stars never streak),
// the player's car protected by a screen ellipse + depth band, and taps that land on the car rejected (no car ghosting).
const BLUR_FS = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uDir, uCenter;
uniform float uK, uRadial, uAspect, uFrame, uNearRef, uCarDepth;
uniform vec4 uEllipse; // cx, cy, rx, ry (UV); rx <= 0: no car
uniform sampler2D tMask; // car mask: r = distance * coverage, g = coverage
uniform float uMaskOn;
varying vec2 vUv;
${DEPTH_FN}
// A car is HERE if the mask covers this pixel and the scene's surface is the car's (not a wall in front of it).
float carHere(vec2 uv, float dist) {
  vec2 mk = texture2D(tMask, uv).rg;
  if (mk.g < 0.02) return 0.0;
  float md = mk.r / mk.g;
  return mk.g * (1.0 - smoothstep(0.4 + 0.02 * dist, 1.2 + 0.05 * dist, abs(dist - md)));
}
float carMask(vec2 uv, float dist) {
  vec2 e = (uv - uEllipse.xy) / uEllipse.zw;
  float inside = 1.0 - smoothstep(0.75, 1.0, dot(e, e));
  float dz = uCarDepth > 0.0 ? 1.0 - smoothstep(3.5, 5.0, abs(dist - uCarDepth)) : 1.0;
  return inside * dz;
}
void main() {
  vec4 c0 = texture2D(tColor, vUv);
  float raw = texture2D(tDepth, vUv).x;
  float dist = viewDist(vUv);
  float m = raw >= 0.9999 ? 0.0 : clamp(uNearRef / max(dist, 1e-3), 0.2, 1.0) * (1.0 - smoothstep(400.0, 900.0, dist));
  if (uMaskOn > 0.5) m *= 1.0 - carHere(vUv, dist);
  else if (uEllipse.z > 0.0) m *= 1.0 - carMask(vUv, dist);
  vec2 d;
  if (uRadial > 0.5) {
    vec2 v = vUv - uCenter;
    d = v * 0.14;
    m *= smoothstep(0.02, 0.3, length(v * vec2(uAspect, 1.0)));
  } else {
    d = uDir * vec2(1.0 / uAspect, 1.0) * 0.045;
  }
  d *= uK * m;
  if (dot(d, d) < 1e-10) {
    gl_FragColor = vec4(c0.rgb, 1.0);
    return;
  }
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy + uFrame * 5.588238, vec2(0.06711056, 0.00583715))));
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < TAPS; i++) {
    float t = (float(i) + jit) / float(TAPS) - 0.5;
    vec2 uv = vUv + d * t;
    float w = 1.0;
    if (uMaskOn > 0.5) w = 1.0 - step(0.5, texture2D(tMask, uv).g);
    else if (uEllipse.z > 0.0) {
      vec2 e = (uv - uEllipse.xy) / uEllipse.zw;
      if (dot(e, e) < 1.0) w = 1.0 - carMask(uv, viewDist(uv));
    }
    acc += texture2D(tColor, uv).rgb * w;
    wsum += w;
  }
  gl_FragColor = vec4(wsum > 0.05 ? acc / wsum : c0.rgb, 1.0);
}`;

const COMPOSITE_FS = /* glsl */ `
uniform sampler2D tColor, tBloom, tDof;
uniform float uBloom, uDofOn;
uniform float uHue, uExposure, uSat, uContrast, uTintAmt, uVignette, uChroma, uGrain, uTime, uAspect;
uniform vec3 uLift, uGamma, uGain, uShadowTint, uHiTint;
uniform vec2 uTexel;
varying vec2 vUv;
${DEPTH_FN}
${COC_FN}
vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  c = I * (c / 0.6);
  c = RRTAndODTFit(c);
  return clamp(O * c, 0.0, 1.0);
}
// Per-channel ACES desaturates and hue-shifts saturated highlights (red paint goes pink). Blend with the ACES curve
// applied to the max channel, which keeps the hue.
vec3 tonemap(vec3 c) {
  vec3 a = aces(c);
  float m = max(c.r, max(c.g, c.b));
  vec3 h = c * (aces(vec3(m)).g / max(m, 1e-5));
  return mix(a, h, uHue);
}
vec3 oetf(vec3 c) { return mix(c * 12.92, pow(c, vec3(0.41666)) * 1.055 - 0.055, vec3(lessThanEqual(vec3(0.0031308), c))); }
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 scene(vec2 uv) {
#ifdef CHROMA
  vec2 off = (uv - 0.5) * uChroma * 0.006;
  vec3 c = vec3(texture2D(tColor, uv + off).r, texture2D(tColor, uv).g, texture2D(tColor, uv - off).b);
#else
  vec3 c = texture2D(tColor, uv).rgb;
#endif
  return c;
}
void main() {
  vec3 c = scene(vUv);
  if (uDofOn > 0.5) {
    float coc = abs(cocHalf(viewDist(vUv)));
    vec4 b = texture2D(tDof, vUv) * 0.4 + (texture2D(tDof, vUv + uTexel * vec2(1.5, 0.5)) + texture2D(tDof, vUv + uTexel * vec2(-1.5, -0.5))
      + texture2D(tDof, vUv + uTexel * vec2(-0.5, 1.5)) + texture2D(tDof, vUv + uTexel * vec2(0.5, -1.5))) * 0.15;
    c = mix(c, b.rgb, smoothstep(0.5, 1.5, coc));
  }
  c += texture2D(tBloom, vUv).rgb * uBloom;
  c = tonemap(c * uExposure);
  c = oetf(c);
  // grade (display space)
  c = uGain * (c + uLift * (1.0 - c));
  c = pow(max(c, 0.0), 1.0 / uGamma);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c += uTintAmt * (uShadowTint - 0.5) * (1.0 - l) * (1.0 - l) + uTintAmt * (uHiTint - 0.5) * l * l;
  vec2 v = (vUv - 0.5) * vec2(uAspect, 1.0);
  c *= 1.0 - uVignette * smoothstep(0.3, 1.05, length(v) * 1.15);
  float n = hash(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5;
  c += n * uGrain * (1.0 - 0.6 * l);
  c += (hash(gl_FragCoord.xy * 1.37 + 11.0) - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

// GTAO applied here instead of GTAOPass's blend: faded out with distance, where reconstructed depth/normals band.
const AO_FS = /* glsl */ `
uniform sampler2D tColor, tAO;
uniform float uIntensity, uFadeNear, uFadeFar;
varying vec2 vUv;
${DEPTH_FN}
void main() {
  vec4 c = texture2D(tColor, vUv);
  float k = uIntensity * (1.0 - smoothstep(uFadeNear, uFadeFar, viewDepth(vUv)));
  gl_FragColor = vec4(c.rgb * mix(1.0, texture2D(tAO, vUv).r, k), c.a);
}`;

const COPY_FS = /* glsl */ `uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vUv); }`;

// ---------------------------------------------------------------------------------------------------------------

const hdrOpts = (samples = 0): THREE.RenderTargetOptions => ({
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  depthBuffer: false,
  samples,
});

export function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: Quality = 'high'): Post {
  let q = quality;
  let P = POST_PRESETS[q];
  let cam = camera;
  let scn = scene;
  let W = 2;
  let H = 2;
  let frame = 0;
  let time = 0;
  let viewport: THREE.Vector4 | null = null;
  const passes: Pass[] = [];
  const stats = { ms: 0 };

  const makeSceneRT = () => {
    const rt = new THREE.WebGLRenderTarget(W, H, { ...hdrOpts(P.msaa), depthBuffer: true, stencilBuffer: false });
    rt.depthTexture = new THREE.DepthTexture(W, H, THREE.UnsignedIntType);
    rt.depthTexture.format = THREE.DepthFormat;
    return rt;
  };
  let sceneRT = makeSceneRT();
  const hdrA = new THREE.WebGLRenderTarget(W, H, hdrOpts());
  const hdrB = new THREE.WebGLRenderTarget(W, H, hdrOpts());
  const ldr = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const cocRT = new THREE.WebGLRenderTarget(1, 1, hdrOpts());
  const dofRT = new THREE.WebGLRenderTarget(1, 1, hdrOpts());
  let mips: THREE.WebGLRenderTarget[] = [];
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  black.needsUpdate = true;

  const depthU = () => ({ tDepth: { value: sceneRT.depthTexture }, uNear: { value: 0.1 }, uFar: { value: 1000 }, uOrtho: { value: 0 }, uRay: { value: new THREE.Vector2(1, 1) } });
  const downM = mat(DOWN_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.0 }, uKnee: { value: 0.6 } });
  const upM = mat(UP_FS, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uScale: { value: 1 } }, {}, THREE.AdditiveBlending);
  const cocM = mat(COC_FS, { tColor: { value: null }, uTexel: { value: new THREE.Vector2() }, uFocus: { value: 5 }, uAperture: { value: 0 }, uMaxR: { value: 10 }, ...depthU() });
  let bokehM = makeBokeh();
  let blurM = makeBlur();
  let compM = makeComposite();
  const copyM = mat(COPY_FS, { tSrc: { value: null } });
  const aoM = mat(AO_FS, { tColor: { value: null }, tAO: { value: null }, uIntensity: { value: 0.85 }, uFadeNear: { value: 45 }, uFadeFar: { value: 100 }, ...depthU() });
  const aoSink = new THREE.WebGLRenderTarget(1, 1); // GTAOPass insists on copying its output somewhere
  // Car mask (half res): distance + coverage of every mesh on CAR_MASK_LAYER, own depth buffer for self-occlusion.
  const maskRT = new THREE.WebGLRenderTarget(1, 1, { ...hdrOpts(), depthBuffer: true });
  const maskM = new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <common>
      #include <batching_pars_vertex>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      varying vec3 vVP;
      void main() {
        #include <batching_vertex>
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        vVP = mvPosition.xyz;
      }`,
    fragmentShader: 'varying vec3 vVP; void main() { gl_FragColor = vec4(length(vVP), 1.0, 0.0, 1.0); }',
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  let maskActive = false;
  let maskBroken = false;
  let maskScanAt = -1e9;
  const maskClear = new THREE.Color();
  const maskMeshes: THREE.Mesh[] = [];
  const maskOthers: THREE.Object3D[] = [];
  const noop = () => {};
  const scanMask = () => {
    maskMeshes.length = 0;
    maskOthers.length = 0;
    // traverse (not traverseVisible): a car part that becomes visible between scans must already be on the list, or it
    // draws its own material in the light-less mask pass and compiles a new program mid-race
    scn.traverse((o) => {
      if (!o.layers.isEnabled(CAR_MASK_LAYER)) return;
      if ((o as THREE.Mesh).isMesh) maskMeshes.push(o as THREE.Mesh);
      else if ((o as THREE.Mesh).material !== undefined || (o as THREE.Light).isLight) maskOthers.push(o);
    });
    maskActive = maskMeshes.length > 0 && !maskBroken;
  };
  // Swap materials on the car meshes ourselves (not scene.overrideMaterial) and silence their render hooks for the
  // pass: kit/fx hooks may read uniforms off the material they're handed. Sprites/points/lights on the layer sit out.
  type Saved = { m: THREE.Material | THREE.Material[]; b: THREE.Mesh['onBeforeRender']; a: THREE.Mesh['onAfterRender'] };
  const saved: Saved[] = [];
  const hidden: boolean[] = [];
  const renderMask = () => {
    const bg = scn.background;
    const layers = cam.layers.mask;
    const autoSh = renderer.shadowMap.autoUpdate;
    renderer.getClearColor(maskClear);
    const ca = renderer.getClearAlpha();
    saved.length = 0;
    hidden.length = 0;
    try {
      for (const o of maskMeshes) {
        saved.push({ m: o.material, b: o.onBeforeRender, a: o.onAfterRender });
        o.material = maskM;
        o.onBeforeRender = noop;
        o.onAfterRender = noop;
      }
      for (const o of maskOthers) {
        hidden.push(o.visible);
        o.visible = false;
      }
      scn.background = null;
      cam.layers.set(CAR_MASK_LAYER);
      renderer.shadowMap.autoUpdate = false;
      renderer.setRenderTarget(maskRT);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, true, false);
      renderer.render(scn, cam);
    } catch (e) {
      maskBroken = true;
      maskActive = false;
      console.warn('[post] car mask failed, using the ellipse fallback', e);
    } finally {
      maskMeshes.forEach((o, i) => {
        const v = saved[i];
        if (!v) return;
        o.material = v.m;
        o.onBeforeRender = v.b;
        o.onAfterRender = v.a;
      });
      maskOthers.forEach((o, i) => {
        if (i < hidden.length) o.visible = hidden[i];
      });
      renderer.setClearColor(maskClear, ca);
      renderer.shadowMap.autoUpdate = autoSh;
      cam.layers.mask = layers;
      scn.background = bg;
    }
  };
  const fxaaM = new THREE.ShaderMaterial({ ...FXAAShader, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), depthTest: false, depthWrite: false });
  let smaa: SMAAPass | null = null;
  let gtao: GTAOPass | null = null;
  const quad = new FullScreenQuad();

  function makeBokeh() {
    return mat(BOKEH_FS, { tCoc: { value: null }, uTexel: { value: new THREE.Vector2() } }, { RAD_SCALE: P.dofRad.toFixed(2), MAX_BLUR: P.dofMax.toFixed(1) });
  }
  function makeBlur() {
    return mat(
      BLUR_FS,
      { tColor: { value: null }, uDir: { value: new THREE.Vector2(-1, 0) }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uK: { value: 0 }, uRadial: { value: 0 }, uAspect: { value: 1 }, uFrame: { value: 0 }, uNearRef: { value: 9 }, uCarDepth: { value: 0 }, uEllipse: { value: new THREE.Vector4(0, 0, 0, 0) }, tMask: { value: null }, uMaskOn: { value: 0 }, ...depthU() },
      { TAPS: P.blurTaps },
    );
  }
  function makeComposite() {
    const u: Record<string, THREE.IUniform> = {
      tColor: { value: null }, tBloom: { value: black }, tDof: { value: black }, uBloom: { value: 1 }, uDofOn: { value: 0 }, uFocus: { value: 5 }, uAperture: { value: 0 }, uMaxR: { value: 10 },
      uHue: { value: 0.5 }, uExposure: { value: 1 }, uSat: { value: 1 }, uContrast: { value: 0 }, uTintAmt: { value: 0 }, uVignette: { value: 0.3 }, uChroma: { value: 0 }, uGrain: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 },
      uLift: { value: new THREE.Vector3() }, uGamma: { value: new THREE.Vector3(1, 1, 1) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
      uShadowTint: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uHiTint: { value: new THREE.Vector3(0.5, 0.5, 0.5) }, uTexel: { value: new THREE.Vector2() },
      ...depthU(),
    };
    return mat(COMPOSITE_FS, u, P.chroma ? { CHROMA: 1 } : {});
  }

  const bloom: BloomOpts = { strength: 0.9, radius: 0.75, threshold: 1.0 };
  const grade: Grade = {
    exposure: renderer.toneMappingExposure || 1, huePreserve: 0.55, saturation: 1, contrast: 0, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1],
    shadowTint: '#808080', highlightTint: '#808080', tint: 0, vignette: 0.3, chroma: 0, grain: 0,
  };
  const dof = { focus: 5, aperture: 0, set: false };
  let chromaManual = false;
  const sb = { k: 0, dir: [-1, 0] as [number, number], radial: false, center: [0.5, 0.5] as [number, number], near: 9, depth: 0, ellipse: new THREE.Vector4(0, 0, 0, 0) };

  function buildMips() {
    mips.forEach((m) => m.dispose());
    mips = [];
    let w = Math.max(1, W >> 1);
    let h = Math.max(1, H >> 1);
    for (let i = 0; i < P.bloomMips; i++) {
      mips.push(new THREE.WebGLRenderTarget(w, h, hdrOpts()));
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
    }
  }

  function buildQualityDeps() {
    P = POST_PRESETS[q];
    sceneRT.dispose();
    sceneRT.depthTexture?.dispose();
    sceneRT = makeSceneRT();
    for (const m of [cocM, blurM, compM, aoM]) m.uniforms.tDepth.value = sceneRT.depthTexture;
    bokehM.dispose();
    blurM.dispose();
    compM.dispose();
    bokehM = makeBokeh();
    blurM = makeBlur();
    compM = makeComposite();
    applyGrade();
    smaa?.dispose();
    smaa = P.aa === 'smaa' ? new SMAAPass(W, H) : null;
    gtao?.dispose();
    gtao = null;
    if (P.ao) {
      gtao = new GTAOPass(scn, cam, Math.max(1, W >> 1), Math.max(1, H >> 1));
      gtao.setGBuffer(sceneRT.depthTexture!);
      gtao.output = GTAOPass.OUTPUT.Denoise;
      gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 12 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    }
    buildMips();
    resizeAll();
  }

  function resizeAll() {
    sceneRT.setSize(W, H);
    hdrA.setSize(W, H);
    hdrB.setSize(W, H);
    ldr.setSize(W, H);
    const hw = Math.max(1, W >> 1);
    const hh = Math.max(1, H >> 1);
    cocRT.setSize(hw, hh);
    dofRT.setSize(hw, hh);
    maskRT.setSize(hw, hh);
    buildMips();
    smaa?.setSize(W, H);
    gtao?.setSize(hw, hh);
    passes.forEach((p) => p.setSize(W, H));
    fxaaM.uniforms.resolution.value.set(1 / W, 1 / H);
  }

  function applyGrade() {
    const u = compM.uniforms;
    u.uExposure.value = grade.exposure;
    u.uHue.value = grade.huePreserve;
    u.uSat.value = grade.saturation;
    u.uContrast.value = grade.contrast;
    u.uLift.value.set(...grade.lift);
    u.uGamma.value.set(...grade.gamma);
    u.uGain.value.set(...grade.gain);
    // tints in display space: 0.5 = neutral
    const st = new THREE.Color(grade.shadowTint).convertLinearToSRGB();
    const ht = new THREE.Color(grade.highlightTint).convertLinearToSRGB();
    u.uShadowTint.value.set(st.r, st.g, st.b);
    u.uHiTint.value.set(ht.r, ht.g, ht.b);
    u.uTintAmt.value = grade.tint;
    u.uVignette.value = grade.vignette;
    u.uChroma.value = grade.chroma;
    u.uGrain.value = grade.grain;
  }

  function depthUniforms(m: THREE.ShaderMaterial) {
    const c = cam as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    m.uniforms.uNear.value = c.near ?? 0.1;
    m.uniforms.uFar.value = c.far ?? 1000;
    m.uniforms.uOrtho.value = c.isOrthographicCamera ? 1 : 0;
    const pm = c.projectionMatrix.elements;
    m.uniforms.uRay.value.set(1 / pm[0], 1 / pm[5]);
  }

  function draw(m: THREE.Material, target: THREE.WebGLRenderTarget | null) {
    quad.material = m;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  }

  const post: Post = {
    get sceneTarget() {
      return sceneRT;
    },
    get quality() {
      return q;
    },
    stats,
    render(dt = 1 / 60) {
      const t0 = performance.now();
      time += dt;
      frame++;
      const prevTarget = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      const prevXr = renderer.xr.enabled;
      renderer.xr.enabled = false;
      renderer.autoClear = true;
      // 1. scene -> HDR
      renderer.setRenderTarget(sceneRT);
      renderer.render(scn, cam);
      renderer.autoClear = false;
      let read: THREE.WebGLRenderTarget = sceneRT;
      const other = () => (read === hdrA ? hdrB : hdrA);
      // 2. user passes (HDR)
      for (const p of passes) {
        if (!p.enabled) continue;
        const write = other();
        p.render(renderer, write, read, dt, false);
        if (p.needsSwap) read = write;
      }
      // 3. ambient occlusion
      if (gtao) {
        gtao.render(renderer, aoSink, read, dt, false);
        depthUniforms(aoM);
        aoM.uniforms.tColor.value = read.texture;
        aoM.uniforms.tAO.value = gtao.pdRenderTarget.texture;
        const write = other();
        draw(aoM, write);
        read = write;
      }
      // 4. speed blur
      if (sb.k > 0.005) {
        if (frame - maskScanAt >= 30) {
          maskScanAt = frame;
          scanMask();
        }
        if (maskActive) renderMask();
        const u = blurM.uniforms;
        u.uMaskOn.value = maskActive && !maskBroken ? 1 : 0;
        u.tMask.value = maskRT.texture;
        depthUniforms(blurM);
        u.tColor.value = read.texture;
        u.uK.value = sb.k;
        u.uDir.value.set(...sb.dir).normalize();
        u.uRadial.value = sb.radial ? 1 : 0;
        u.uCenter.value.set(...sb.center);
        u.uNearRef.value = sb.near;
        u.uCarDepth.value = sb.depth;
        u.uEllipse.value.copy(sb.ellipse);
        u.uAspect.value = W / H;
        u.uFrame.value = frame % 64;
        const write = other();
        draw(blurM, write);
        read = write;
      }
      // 5. DOF (half res)
      const dofOn = dof.aperture > 0.001;
      const maxR = P.dofMax;
      if (dofOn) {
        depthUniforms(cocM);
        cocM.uniforms.tColor.value = read.texture;
        cocM.uniforms.uTexel.value.set(1 / W, 1 / H);
        cocM.uniforms.uFocus.value = dof.focus;
        cocM.uniforms.uAperture.value = dof.aperture;
        cocM.uniforms.uMaxR.value = maxR;
        draw(cocM, cocRT);
        bokehM.uniforms.tCoc.value = cocRT.texture;
        bokehM.uniforms.uTexel.value.set(1 / cocRT.width, 1 / cocRT.height);
        draw(bokehM, dofRT);
      }
      // 6. bloom
      let src: THREE.Texture = read.texture;
      let sw = W;
      let sh = H;
      for (let i = 0; i < mips.length; i++) {
        downM.uniforms.tSrc.value = src;
        downM.uniforms.uTexel.value.set(1 / sw, 1 / sh);
        downM.uniforms.uFirst.value = i === 0 ? 1 : 0;
        downM.uniforms.uThreshold.value = bloom.threshold;
        draw(downM, mips[i]);
        src = mips[i].texture;
        sw = mips[i].width;
        sh = mips[i].height;
      }
      for (let i = mips.length - 2; i >= 0; i--) {
        upM.uniforms.tSrc.value = mips[i + 1].texture;
        upM.uniforms.uTexel.value.set(1 / mips[i + 1].width, 1 / mips[i + 1].height);
        upM.uniforms.uScale.value = 0.35 + 0.65 * bloom.radius;
        draw(upM, mips[i]);
      }
      // 7. composite
      const cu = compM.uniforms;
      depthUniforms(compM);
      cu.tColor.value = read.texture;
      cu.tBloom.value = mips[0]?.texture ?? black;
      cu.uBloom.value = bloom.strength / Math.max(1, mips.length * 0.9);
      cu.uDofOn.value = dofOn ? 1 : 0;
      cu.tDof.value = dofOn ? dofRT.texture : black;
      cu.uFocus.value = dof.focus;
      cu.uAperture.value = dof.aperture;
      cu.uMaxR.value = maxR;
      cu.uTime.value = time;
      // Until a caller drives setChroma, aberration rides on the speed blur (a speed cue, not a constant lens flaw).
      if (!chromaManual) cu.uChroma.value = Math.min(0.65, grade.chroma + 1.4 * sb.k);
      cu.uAspect.value = W / H;
      cu.uTexel.value.set(1 / W, 1 / H);
      const toScreen = P.aa === 'none';
      const out = (m: THREE.Material) => {
        renderer.setRenderTarget(null);
        if (viewport) {
          renderer.setViewport(viewport.x, viewport.y, viewport.z, viewport.w);
          renderer.setScissor(viewport.x, viewport.y, viewport.z, viewport.w);
          renderer.setScissorTest(true);
        }
        quad.material = m;
        quad.render(renderer);
        if (viewport) {
          renderer.setScissorTest(false);
          const s = renderer.getSize(new THREE.Vector2());
          renderer.setViewport(0, 0, s.x, s.y);
        }
      };
      if (toScreen) out(compM);
      else {
        draw(compM, ldr);
        if (P.aa === 'smaa' && smaa) {
          smaa.renderToScreen = !viewport;
          if (viewport) {
            smaa.render(renderer, hdrA, ldr, dt, false);
            copyM.uniforms.tSrc.value = hdrA.texture;
            out(copyM);
          } else smaa.render(renderer, null as unknown as THREE.WebGLRenderTarget, ldr, dt, false);
        } else {
          fxaaM.uniforms.tDiffuse.value = ldr.texture;
          out(fxaaM);
        }
      }
      renderer.autoClear = prevAuto;
      renderer.xr.enabled = prevXr;
      renderer.setRenderTarget(prevTarget);
      stats.ms = performance.now() - t0;
    },
    setSize(w, h) {
      const pr = renderer.getPixelRatio();
      W = Math.max(2, Math.round(w * pr));
      H = Math.max(2, Math.round(h * pr));
      resizeAll();
    },
    setQuality(nq) {
      if (nq === q) return;
      q = nq;
      buildQualityDeps();
    },
    setCamera(c) {
      cam = c;
      if (gtao) gtao.camera = c;
    },
    setScene(s) {
      scn = s;
      maskScanAt = -1e9;
      if (gtao) gtao.scene = s;
    },
    setFocus(dist, aperture) {
      dof.focus = Math.max(0.05, dist);
      dof.set = true;
      dof.aperture = THREE.MathUtils.clamp(aperture, 0, 1);
    },
    setSpeedBlur(k, o = {}) {
      sb.k = THREE.MathUtils.clamp(k, 0, 1);
      if (o.dir) sb.dir = o.dir;
      sb.radial = !!o.radial;
      if (o.center) sb.center = o.center;
      sb.near = o.near ?? 9;
      const e = o.ellipse;
      if (e && e.rx > 0 && e.ry > 0) {
        sb.ellipse.set(e.cx, e.cy, e.rx, e.ry);
        sb.depth = o.depth ?? o.protect ?? 0;
      } else if ((o.depth ?? o.protect ?? 0) > 0) {
        // legacy / no projection available: a generous ellipse where a chase cam frames the car; the old `protect`
        // was the depth just past the nose, ~3 m beyond the car centre
        sb.ellipse.set(0.5, 0.36, 0.17, 0.2);
        sb.depth = o.depth ?? Math.max(1, (o.protect ?? 0) - 3);
      } else {
        sb.ellipse.set(0, 0, 0, 0);
        sb.depth = 0;
      }
    },
    setChroma(k) {
      chromaManual = true;
      grade.chroma = THREE.MathUtils.clamp(k, 0, 0.65);
      compM.uniforms.uChroma.value = grade.chroma;
    },
    setBloom(o) {
      Object.assign(bloom, o);
    },
    setAO(o) {
      if (o.intensity !== undefined) aoM.uniforms.uIntensity.value = o.intensity;
      if (o.fadeNear !== undefined) aoM.uniforms.uFadeNear.value = o.fadeNear;
      if (o.fadeFar !== undefined) aoM.uniforms.uFadeFar.value = o.fadeFar;
    },
    setGrade(o) {
      Object.assign(grade, o);
      applyGrade();
    },
    gradePreset(name) {
      Object.assign(grade, GRADES.neutral, GRADES[name]);
      applyGrade();
    },
    addPass(p) {
      passes.push(p);
      p.setSize(W, H);
    },
    insertPass(p, index) {
      passes.splice(Math.max(0, index - 1), 0, p);
      p.setSize(W, H);
    },
    removePass(p) {
      const i = passes.indexOf(p);
      if (i >= 0) passes.splice(i, 1);
    },
    setViewport(x, y, w, h) {
      viewport = new THREE.Vector4(x, y, w, h);
    },
    clearViewport() {
      viewport = null;
    },
    dispose() {
      [sceneRT, hdrA, hdrB, ldr, cocRT, dofRT, aoSink, maskRT, ...mips].forEach((t) => t.dispose());
      sceneRT.depthTexture?.dispose();
      [downM, upM, cocM, bokehM, blurM, compM, copyM, fxaaM, aoM, maskM].forEach((m) => m.dispose());
      smaa?.dispose();
      gtao?.dispose();
      black.dispose();
      quad.dispose();
    },
  };

  const size = renderer.getSize(new THREE.Vector2());
  W = Math.max(2, Math.round(size.x * renderer.getPixelRatio()));
  H = Math.max(2, Math.round(size.y * renderer.getPixelRatio()));
  buildQualityDeps();
  post.gradePreset('race');
  return post;
}
