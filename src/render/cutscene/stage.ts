// The cutscene stage (v3 look): the 3D scene renders supersampled (960x540, 4x MSAA) into a target, then one
// post pass composites bloom, the colour grade of the current Look (warmSweet / harshJerk), a very mild
// dithered posterize, and the Turbo glitch, down to a 640x360 canvas: the game's own pixel grid, so it
// still sits in the pixel game while shading reads smooth. The canvas is laid exactly over the Phaser
// canvas (nearest-neighbour upscale). A 640x360 2D overlay canvas holds the name card and screen juice.
import * as THREE from 'three';
import { LOOK_U, OUTLINE, Particles, disposeShared, disposeTree, outline, toonMat, toonify } from './fx';

/** Output (canvas) resolution: the game's own 640x360 pixel grid. */
export const RW = 640;
export const RH = 360;
/** Supersample factor for the 3D render target (960x540). */
export const SS = 1.5;
export const OW = 640;
export const OH = 360;

// ---------- looks (lighting + grade presets) ----------

/** A full lighting + grade state. Build with warmSweet() / harshJerk() / neutralLook(), blend with mixLook(). */
export interface Look {
  /** Key light colour + multiplier on the set's key (stadium) light. */
  key: THREE.Color;
  keyI: number;
  /** Hemisphere sky / ground colours + multiplier on the set's hemi light. */
  sky: THREE.Color;
  ground: THREE.Color;
  hemiI: number;
  /** Camera-side fill (follows the camera, slightly above and left). */
  fill: THREE.Color;
  fillI: number;
  /** Material fresnel rim: A = left edges, B = right edges + tops. */
  rimA: THREE.Color;
  rimB: THREE.Color;
  rimI: number;
  /** Global specular multiplier. */
  spec: number;
  /** Shadow tint colour + amount (unlit sides lean toward it). */
  shade: THREE.Color;
  shadeI: number;
  /** Grade: multiply tint, lift (added to shadows), saturation, contrast, vignette, bloom strength, exposure. */
  tint: THREE.Color;
  lift: THREE.Color;
  sat: number;
  contrast: number;
  vignette: number;
  bloom: number;
  exposure: number;
}

const C = (h: number) => new THREE.Color(h);

/** The default look: the set's own lights untouched, a modest cool/warm rim and a light grade. */
export function neutralLook(): Look {
  return {
    key: C(0xfff2dc), keyI: 1, sky: C(0x8c80c8), ground: C(0x1a1428), hemiI: 1, fill: C(0xffffff), fillI: 0,
    rimA: C(0xa898ff), rimB: C(0xffcfa0), rimI: 0.42, spec: 1, shade: C(0x5a4a8a), shadeI: 0.22,
    tint: C(0xffffff), lift: C(0x000000), sat: 1.08, contrast: 1.06, vignette: 0.22, bloom: 0.7, exposure: 1,
  };
}

/**
 * (Currently unused: the bosses are jerks throughout.) Soft golden-hour / cosy light. Warm honey key, peachy sky fill, a camera-side warm fill so faces
 * read soft, gentle peach + pink rims, low contrast, dreamy bloom, warm lifted shadows, soft vignette.
 */
export function warmSweet(): Look {
  return {
    key: C(0xffd49a), keyI: 0.95, sky: C(0xffc8a8), ground: C(0x4a3048), hemiI: 1.05, fill: C(0xffd8b8), fillI: 0.35,
    rimA: C(0xffe2a8), rimB: C(0xffa8cc), rimI: 0.6, spec: 0.85, shade: C(0x8a5a7a), shadeI: 0.3,
    tint: C(0xfff4e6), lift: C(0x140a10), sat: 1.1, contrast: 0.96, vignette: 0.2, bloom: 0.75, exposure: 0.98,
  };
}

/**
 * The bosses' look (dramatic, Turbo-villain): high contrast, dark cold ambient, a hard white-blue key, and strong coloured rims: `color` on
 * the left edges, a hot complementary on the right (pass `color2` to choose it). Crunchy contrast, deep vignette.
 */
export function harshJerk(color: THREE.ColorRepresentation = 0xff2a5a, color2?: THREE.ColorRepresentation): Look {
  const a = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  a.getHSL(hsl);
  const b = color2 !== undefined ? new THREE.Color(color2) : new THREE.Color().setHSL((hsl.h + 0.5) % 1, 1, 0.6);
  return {
    key: C(0xdfe6ff), keyI: 1.05, sky: C(0x40306a), ground: C(0x06040c), hemiI: 0.42, fill: a.clone(), fillI: 0.18,
    rimA: a.clone().multiplyScalar(1.4), rimB: b, rimI: 1.9, spec: 1.35, shade: C(0x2a1a5a), shadeI: 0.45,
    tint: C(0xeef0ff), lift: C(0x000000), sat: 1.22, contrast: 1.28, vignette: 0.6, bloom: 0.9, exposure: 0.98,
  };
}

/** Blend two looks (k = 0 -> a, 1 -> b) into `out` (new by default). */
export function mixLook(a: Look, b: Look, k: number, out: Look = neutralLook()): Look {
  for (const key of Object.keys(a) as (keyof Look)[]) {
    const va = a[key];
    const vb = b[key];
    if (va instanceof THREE.Color) (out[key] as THREE.Color).copy(va).lerp(vb as THREE.Color, k);
    else (out as unknown as Record<string, number>)[key] = (va as number) + ((vb as number) - (va as number)) * k;
  }
  return out;
}

// ---------- post pass ----------

const FULL_VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/** Glitch parameters for the post pass (all 0 = clean). Computed by Director.glitch per frame. */
export interface GlitchParams {
  /** Overall 0..1. */
  amount: number;
  /** Per-frame random seed. */
  seed: number;
  /** RGB split in output px. */
  split: number;
  /** Fraction of horizontal bands displaced (0..1). */
  slice: number;
  /** Fraction of macro-blocks swapped / smeared (0..1). */
  block: number;
  /** Scanline tear strength (0..1). */
  tear: number;
  /** 1 = negative frame. */
  invert: number;
  /** Pixel-crush block size in output px (<= 1 = off). */
  crush: number;
  /** Candy-palette remap 0..1. */
  palette: number;
  /** Solid digital-noise cells 0..1. */
  noise: number;
}

export const NO_GLITCH: GlitchParams = { amount: 0, seed: 0, split: 0, slice: 0, block: 0, tear: 0, invert: 0, crush: 0, palette: 0, noise: 0 };

const BRIGHT_FS = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
vec3 b(vec2 o) { vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return c * smoothstep(0.72, 1.0, l); }
void main() { gl_FragColor = vec4((b(vec2(-1.0,-1.0)) + b(vec2(1.0,-1.0)) + b(vec2(-1.0,1.0)) + b(vec2(1.0,1.0))) * 0.25, 1.0); }`;

const BLUR_FS = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.227;
  c += (texture2D(tSrc, vUv + uDir * 1.385).rgb + texture2D(tSrc, vUv - uDir * 1.385).rgb) * 0.316;
  c += (texture2D(tSrc, vUv + uDir * 3.231).rgb + texture2D(tSrc, vUv - uDir * 3.231).rgb) * 0.070;
  gl_FragColor = vec4(c, 1.0);
}`;

const POST_FS = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloomA; uniform sampler2D tBloomB;
uniform vec2 uRes;
uniform float uBloom, uSat, uContrast, uVig, uExpo, uLevels;
uniform vec3 uTint, uLift;
uniform float uG, uSeed, uSplit, uSlice, uBlock, uTear, uInvert, uCrush, uPal, uNoise;
varying vec2 vUv;

float h1(float n) { return fract(sin(n * 127.13 + 1.7) * 43758.5453); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 toSRGB(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 img(vec2 uv) {
  return texture2D(tScene, uv).rgb + (texture2D(tBloomA, uv).rgb * 0.9 + texture2D(tBloomB, uv).rgb * 1.1) * uBloom;
}
// candy corruption palette (deep plum, magenta, cyan, cream) by luminance
vec3 candy(float l) {
  vec3 a = vec3(0.07, 0.02, 0.16), b = vec3(1.0, 0.12, 0.55), c = vec3(0.2, 0.95, 1.0), d = vec3(1.0, 0.96, 0.75);
  return l < 0.33 ? mix(a, b, l / 0.33) : l < 0.66 ? mix(b, c, (l - 0.33) / 0.33) : mix(c, d, (l - 0.66) / 0.34);
}
float bayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  // 4x4 ordered dither via a small lookup expressed arithmetically
  float m[16];
  m[0]=0.0; m[1]=8.0; m[2]=2.0; m[3]=10.0; m[4]=12.0; m[5]=4.0; m[6]=14.0; m[7]=6.0;
  m[8]=3.0; m[9]=11.0; m[10]=1.0; m[11]=9.0; m[12]=15.0; m[13]=7.0; m[14]=13.0; m[15]=5.0;
  float v = 0.0;
  for (int k = 0; k < 16; k++) if (float(k) == i) v = m[k];
  return v / 16.0 - 0.47;
}
void main() {
  vec2 uv = vUv;
  vec2 fc = uv * uRes;
  float crushOn = step(1.5, uCrush);
  if (crushOn > 0.5) { vec2 bs = uRes / uCrush; uv = (floor(uv * bs) + 0.5) / bs; fc = floor(fc / uCrush) * uCrush; }
  float split = uSplit;
  vec3 noiseCol = vec3(-1.0);
  if (uG > 0.001) {
    // thick bands slide sideways (two band scales so it never looks like a regular grid)
    float band = floor(uv.y * (9.0 + floor(h1(uSeed) * 14.0)) + h1(uSeed + 1.0) * 5.0);
    float rb = h2(vec2(band, uSeed));
    if (rb < uSlice) { float dx = (h2(vec2(band, uSeed + 3.1)) - 0.5) * 0.22 * (0.4 + uG); uv.x += dx; split += abs(dx) * uRes.x * 0.06; }
    // thin scanline jitters
    float line = floor(fc.y / 2.0);
    if (h2(vec2(line, uSeed * 1.7 + 4.0)) < uSlice * 0.22) uv.x += (h2(vec2(line, uSeed + 9.0)) - 0.5) * 0.05;
    // macro-blocks lifted from elsewhere in the frame (datamosh)
    vec2 cell = floor(uv * vec2(16.0, 9.0));
    if (h2(cell + uSeed * 13.0) < uBlock) {
      vec2 src = vec2(h2(cell + uSeed + 0.3), h2(cell - uSeed - 0.7)) - 0.5;
      uv += src * vec2(0.18, 0.1);
    }
    // the tear: one or two hard horizontal rips with a bright edge
    for (int k = 0; k < 2; k++) {
      float ty = h1(uSeed * 3.3 + float(k) * 7.7);
      float th = (0.008 + 0.05 * h1(uSeed + float(k))) * uTear;
      float d = uv.y - ty;
      if (d > 0.0 && d < th) uv.x += (h1(uSeed + 11.0 + float(k)) - 0.5) * 0.35;
      if (abs(d) < 1.2 / uRes.y && uTear > 0.1) noiseCol = vec3(1.0, 0.95, 1.0);
    }
    // solid digital noise: short horizontal runs of 8x4 px cells, clustered on a few rows
    vec2 nc = floor(fc / vec2(8.0, 4.0));
    nc.x = floor(nc.x / (1.0 + floor(h2(vec2(nc.y, uSeed)) * 4.0)));
    if (h2(vec2(nc.y, uSeed + 2.0)) > 0.3) nc.x = -1e4;
    float rn = h2(nc + uSeed * 7.0);
    if (rn < uNoise && nc.x > -1e3) { float pick = h2(nc - uSeed); noiseCol = pick < 0.33 ? vec3(1.0, 0.1, 0.6) : pick < 0.66 ? vec3(0.15, 0.95, 1.0) : vec3(0.05, 0.0, 0.1); }
    uv.x = fract(uv.x);
    uv.y = clamp(uv.y, 0.0, 1.0);
  }
  vec3 c;
  if (split > 0.01) {
    vec2 so = vec2(split / uRes.x, split * 0.2 / uRes.y);
    c = vec3(img(uv + so).r, img(uv).g, img(uv - so).b);
  } else c = img(uv);
  c *= uExpo;
  c = toSRGB(c);
  // grade (in display space): tint, lift, saturation, contrast, vignette
  c = c * uTint + uLift * (1.0 - c);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  vec2 vq = (vUv - 0.5) * vec2(1.25, 1.0);
  c *= 1.0 - uVig * smoothstep(0.3, 0.85, length(vq) * 1.25);
  if (uG > 0.001) {
    l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, candy(clamp(l, 0.0, 1.0)), uPal);
    c *= 1.0 - 0.28 * uG * step(0.5, fract(fc.y * 0.5));
    if (noiseCol.x >= 0.0) c = noiseCol;
  }
  c = mix(c, 1.0 - c, uInvert);
  // very mild ordered-dither posterize (uLevels per channel); chunky when crushed
  float lv = crushOn > 0.5 ? 5.0 : uLevels;
  c = floor(clamp(c, 0.0, 1.0) * lv + 0.5 + bayer(fc) * 0.9 * (1.0 - crushOn)) / lv;
  gl_FragColor = vec4(c, 1.0);
}`;

class Post {
  readonly rt: THREE.WebGLRenderTarget;
  private a4: THREE.WebGLRenderTarget;
  private b4: THREE.WebGLRenderTarget;
  private a8: THREE.WebGLRenderTarget;
  private b8: THREE.WebGLRenderTarget;
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private bright: THREE.ShaderMaterial;
  private blur: THREE.ShaderMaterial;
  readonly mat: THREE.ShaderMaterial;

  constructor(w: number, h: number) {
    const opt = { type: THREE.UnsignedByteType, depthBuffer: false } as const;
    this.rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.UnsignedByteType });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.rt.texture.generateMipmaps = false;
    const w4 = Math.round(w / 4), h4 = Math.round(h / 4);
    const w8 = Math.round(w / 8), h8 = Math.round(h / 8);
    this.a4 = new THREE.WebGLRenderTarget(w4, h4, opt);
    this.b4 = new THREE.WebGLRenderTarget(w4, h4, opt);
    this.a8 = new THREE.WebGLRenderTarget(w8, h8, opt);
    this.b8 = new THREE.WebGLRenderTarget(w8, h8, opt);
    this.bright = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2(1 / w, 1 / h) } }, vertexShader: FULL_VS, fragmentShader: BRIGHT_FS, depthTest: false, depthWrite: false });
    this.blur = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: FULL_VS, fragmentShader: BLUR_FS, depthTest: false, depthWrite: false });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture }, tBloomA: { value: this.a4.texture }, tBloomB: { value: this.a8.texture },
        uRes: { value: new THREE.Vector2(RW, RH) }, uBloom: { value: 0.7 }, uSat: { value: 1 }, uContrast: { value: 1 }, uVig: { value: 0 },
        uExpo: { value: 1 }, uLevels: { value: 40 }, uTint: { value: new THREE.Color(1, 1, 1) }, uLift: { value: new THREE.Color(0, 0, 0) },
        uG: { value: 0 }, uSeed: { value: 0 }, uSplit: { value: 0 }, uSlice: { value: 0 }, uBlock: { value: 0 }, uTear: { value: 0 },
        uInvert: { value: 0 }, uCrush: { value: 0 }, uPal: { value: 0 }, uNoise: { value: 0 },
      },
      vertexShader: FULL_VS,
      fragmentShader: POST_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
  }

  private pass(r: THREE.WebGLRenderer, m: THREE.ShaderMaterial, to: THREE.WebGLRenderTarget | null) {
    this.quad.material = m;
    r.setRenderTarget(to);
    r.render(this.qScene, this.qCam);
  }

  run(r: THREE.WebGLRenderer, look: Look, g: GlitchParams) {
    const u = this.mat.uniforms;
    if (look.bloom > 0.01) {
      this.bright.uniforms.tSrc.value = this.rt.texture;
      this.pass(r, this.bright, this.a4);
      const bl = this.blur.uniforms;
      for (const [a, b] of [[this.a4, this.b4], [this.a8, this.b8]] as const) {
        if (a === this.a8) {
          bl.tSrc.value = this.a4.texture;
          bl.uDir.value.set(0, 0);
          this.pass(r, this.blur, this.a8);
        }
        bl.tSrc.value = a.texture;
        bl.uDir.value.set(1 / a.width, 0);
        this.pass(r, this.blur, b);
        bl.tSrc.value = b.texture;
        bl.uDir.value.set(0, 1 / a.height);
        this.pass(r, this.blur, a);
      }
    }
    u.uBloom.value = look.bloom;
    u.uSat.value = look.sat;
    u.uContrast.value = look.contrast;
    u.uVig.value = look.vignette;
    u.uExpo.value = look.exposure;
    u.uTint.value.copy(look.tint);
    u.uLift.value.copy(look.lift);
    u.uG.value = g.amount;
    u.uSeed.value = g.seed;
    u.uSplit.value = g.split;
    u.uSlice.value = g.slice;
    u.uBlock.value = g.block;
    u.uTear.value = g.tear;
    u.uInvert.value = g.invert;
    u.uCrush.value = g.crush;
    u.uPal.value = g.palette;
    u.uNoise.value = g.noise;
    this.pass(r, this.mat, null);
  }

  dispose() {
    for (const t of [this.rt, this.a4, this.b4, this.a8, this.b8]) t.dispose();
    this.bright.dispose();
    this.blur.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, RW / RH, 0.1, 900);
  readonly canvas: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** The look being shown (the Director resolves its look timeline into this every frame). */
  readonly look: Look = neutralLook();
  /** Glitch for this frame (the Director writes it). */
  glitch: GlitchParams = NO_GLITCH;
  private post: Post;
  private fill = new THREE.DirectionalLight(0xffffff, 0);
  private setLights: { key: THREE.DirectionalLight; hemi: THREE.HemisphereLight; power: number; dark: boolean } | null = null;
  private readonly onResize = () => this.layout();

  constructor(private parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.overlay = document.createElement('canvas');
    this.overlay.width = OW;
    this.overlay.height = OH;
    for (const c of [this.canvas, this.overlay]) {
      Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', imageRendering: 'pixelated', zIndex: '50', pointerEvents: 'none' });
    }
    this.overlay.style.zIndex = '51';
    this.overlay.style.pointerEvents = 'auto';
    this.overlay.style.cursor = 'pointer';
    // throws if WebGL is unavailable; the caller catches and skips the cutscene
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
    // fixed-size buffers: the device pixel ratio never multiplies the cost (capped at 1 by design)
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RW, RH, false);
    this.renderer.setClearColor(0x07060d, 1);
    const sw = Math.round(RW * SS);
    const sh = Math.round(RH * SS);
    this.post = new Post(sw, sh);
    const ctx = this.overlay.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
    OUTLINE.res.set(sw, sh);
    OUTLINE.px = 1.35 * SS; // ~1.35 game px: thinner than v2's 2 game px, still crisp
    Particles.rows = RH;
    this.fill.userData.stageFill = true;
    this.scene.add(this.fill, this.fill.target);
    parent.appendChild(this.canvas);
    parent.appendChild(this.overlay);
    this.layout();
    window.addEventListener('resize', this.onResize);
  }

  /** The set's key + hemi lights, so Looks can recolour them (buildDragStrip registers its own). */
  registerSetLights(key: THREE.DirectionalLight, hemi: THREE.HemisphereLight, dark = false) {
    this.setLights = { key, hemi, power: dark ? 0 : 1, dark };
  }

  /** Stadium power fraction 0..1 (buildDragStrip's power()). */
  setPower(f: number) {
    if (this.setLights) this.setLights.power = f;
  }

  /** Match the Phaser canvas's on-screen rect (Scale.FIT + CENTER_BOTH), or FIT the parent if there is none. */
  layout() {
    const game = this.parent.querySelector('canvas:not([data-cutscene])') as HTMLCanvasElement | null;
    let r: { left: number; top: number; width: number; height: number };
    const own = game === this.canvas || game === this.overlay;
    if (game && !own && game.getBoundingClientRect().width > 0) r = game.getBoundingClientRect();
    else {
      const p = this.parent.getBoundingClientRect();
      const s = Math.min(p.width / OW, p.height / OH) || 1;
      r = { width: OW * s, height: OH * s, left: p.left + (p.width - OW * s) / 2, top: p.top + (p.height - OH * s) / 2 };
    }
    for (const c of [this.canvas, this.overlay]) {
      c.dataset.cutscene = '1';
      Object.assign(c.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    }
  }

  private _f = new THREE.Vector3();
  private _r = new THREE.Vector3();
  private applyLook() {
    const L = this.look;
    LOOK_U.uRimA.value.copy(L.rimA);
    LOOK_U.uRimB.value.copy(L.rimB);
    LOOK_U.uRimI.value = L.rimI;
    LOOK_U.uSpecI.value = L.spec;
    LOOK_U.uShade.value.copy(L.shade);
    LOOK_U.uShadeI.value = L.shadeI;
    const s = this.setLights;
    if (s) {
      s.key.color.copy(L.key);
      s.key.intensity = (0.3 + 1.9 * s.power) * L.keyI;
      s.hemi.color.copy(L.sky);
      s.hemi.groundColor.copy(L.ground);
      s.hemi.intensity = (0.35 + 0.75 * s.power) * L.hemiI;
    }
    // camera-side fill: from just above-left of the lens toward what it looks at
    const cam = this.camera;
    cam.updateMatrixWorld();
    cam.getWorldDirection(this._f);
    this._r.crossVectors(this._f, cam.up).normalize();
    this.fill.color.copy(L.fill);
    this.fill.intensity = L.fillI;
    this.fill.visible = L.fillI > 0.001;
    this.fill.position.copy(cam.position).addScaledVector(this._r, -4).addScaledVector(cam.up, 3);
    this.fill.target.position.copy(cam.position).addScaledVector(this._f, 10);
    this.fill.target.updateMatrixWorld();
  }

  render() {
    this.applyLook();
    const r = this.renderer;
    r.setRenderTarget(this.post.rt);
    r.render(this.scene, this.camera);
    this.post.run(r, this.look, this.glitch);
    r.setRenderTarget(null);
  }

  dispose() {
    window.removeEventListener('resize', this.onResize);
    disposeTree(this.scene);
    this.scene.clear();
    disposeShared();
    this.post.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.overlay.remove();
  }
}

// ---------- shared textures ----------

/** Soft radial glow for light flares and haze cards. */
export function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)'));
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function glowSprite(tex: THREE.Texture, color: THREE.ColorRepresentation, size: number, opacity = 1): THREE.Sprite {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false }),
  );
  s.scale.set(size, size, 1);
  return s;
}

// ---------- the set ----------

export interface DragStrip {
  group: THREE.Group;
  crowd: { update(t: number, hype: number): void };
  lights: THREE.Group;
  /** Stadium power per tower: on(x) decides by tower position, so banks can slam on in sequence. */
  power(on: (x: number) => boolean): void;
}

export interface SetOpts {
  /** Haze / sky tint. */
  haze?: number;
  sky?: [number, number];
  fogNear?: number;
  fogFar?: number;
  /** Turn the stadium lights off (Rosa's darkness opening). */
  dark?: boolean;
}

const LANE_Z = 2.6;
/** Big flat set pieces: no rim (grazing ground would glow) and no gloss. */
const FLAT = { gloss: 0, rim: 0 };

/** Night drag strip running along +X: asphalt, lanes, walls, stadium light towers, bleachers + crowd, haze. */
export function buildDragStrip(stage: Stage, o: SetOpts = {}): DragStrip {
  const group = new THREE.Group();
  const haze = o.haze ?? 0x241a3a;
  stage.scene.fog = new THREE.Fog(haze, o.fogNear ?? 25, o.fogFar ?? 150);
  stage.scene.background = new THREE.Color(o.sky?.[1] ?? 0x07060d);

  // sky dome gradient
  const skyGeo = new THREE.SphereGeometry(600, 32, 16);
  const top = new THREE.Color(o.sky?.[1] ?? 0x07060d);
  const bot = new THREE.Color(o.sky?.[0] ?? haze);
  const cols: number[] = [];
  const pos = skyGeo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const c = bot.clone().lerp(top, Math.min(1, Math.max(0, pos.getY(i) / 200)));
    cols.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  group.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));

  // asphalt + shoulders
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 400), toonMat(0x1b1a22, {}, FLAT));
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(1200, LANE_Z * 4), toonMat(0x2c2a36, {}, FLAT));
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.005;
  group.add(strip);
  // rubbered-in launch pads: darker streaks just past the start line
  for (const z of [-LANE_Z, LANE_Z])
    for (const dz of [-0.75, 0.75]) {
      const r = new THREE.Mesh(new THREE.PlaneGeometry(60, 0.5), toonMat(0x16151b, {}, FLAT));
      r.rotation.x = -Math.PI / 2;
      r.position.set(25, 0.01, z + dz);
      group.add(r);
    }
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xd8d2c4 });
  for (const z of [0, -LANE_Z * 2, LANE_Z * 2]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(1200, 0.18), lineMat);
    l.rotation.x = -Math.PI / 2;
    l.position.set(0, 0.015, z);
    group.add(l);
  }
  const start = new THREE.Mesh(new THREE.PlaneGeometry(0.5, LANE_Z * 4), new THREE.MeshBasicMaterial({ color: 0xf4ecd8 }));
  start.rotation.x = -Math.PI / 2;
  start.position.set(0, 0.02, 0);
  group.add(start);

  // concrete walls with ad stripes
  const adCols = [0xe8413c, 0xf7d23e, 0x38c6c0, 0x9b4de0, 0xf28c28, 0x3c78e8];
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1200, 1.1, 0.5), toonMat(0x8c8698, {}, { gloss: 0.1, rim: 0.3 }));
    wall.position.set(0, 0.55, side * (LANE_Z * 2 + 3.2));
    outline(wall);
    group.add(wall);
    for (let x = -120; x < 320; x += 12) {
      const ad = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 0.6),
        new THREE.MeshBasicMaterial({ color: adCols[Math.abs(Math.round(x / 12)) % adCols.length] }),
      );
      ad.position.set(x, 0.6, side * (LANE_Z * 2 + 3.2 - 0.26 * side));
      if (side > 0) ad.rotation.y = Math.PI;
      group.add(ad);
    }
  }

  // bleachers + crowd (both sides)
  const crowdBody = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.7, 0.4), toonMat(0xffffff), 900);
  const crowdHead = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 10, 7), toonMat(0xffffff, {}, { gloss: 0.2 }), 900);
  const base: { x: number; y: number; z: number; ph: number; amp: number }[] = [];
  const shirt = [0x2a2440, 0x3a2f5a, 0x1f1b30, 0x5a2a4a, 0x2a3a5a, 0x6a2a2a];
  const col = new THREE.Color();
  for (const side of [-1, 1]) {
    for (let row = 0; row < 7; row++) {
      const z = side * (LANE_Z * 2 + 7 + row * 1.4);
      const y = 0.8 + row * 0.9;
      const step = new THREE.Mesh(new THREE.BoxGeometry(260, 0.9, 1.4), toonMat(0x34304a, {}, FLAT));
      step.position.set(70, y - 0.45, z);
      group.add(step);
      for (let x = -55; x < 200; x += 2.2) {
        if (base.length >= 900 || Math.random() < 0.18) continue;
        const i = base.length;
        base.push({ x: x + Math.random(), y, z: z + (Math.random() - 0.5) * 0.3, ph: Math.random() * 6.28, amp: 0.15 + Math.random() * 0.35 });
        col.setHex(shirt[(i * 7) % shirt.length]);
        crowdBody.setColorAt(i, col);
        crowdHead.setColorAt(i, col.setHex(0x3a3048));
      }
    }
  }
  crowdBody.count = crowdHead.count = base.length;
  outline(crowdBody);
  group.add(crowdBody, crowdHead);
  // phone camera flashes
  const flashTex = glowTexture();
  const flashes: THREE.Sprite[] = [];
  for (let i = 0; i < 26; i++) {
    const s = glowSprite(flashTex, 0xffffff, 1.6, 0);
    const b = base[Math.floor(Math.random() * base.length)];
    if (b) s.position.set(b.x, b.y + 1.2, b.z);
    flashes.push(s);
    group.add(s);
  }
  const m4 = new THREE.Matrix4();
  const crowd = {
    update(t: number, hype: number) {
      for (let i = 0; i < base.length; i++) {
        const b = base[i];
        const j = Math.max(0, Math.sin(t * (6 + hype * 4) + b.ph)) * b.amp * (0.4 + hype);
        crowdBody.setMatrixAt(i, m4.makeTranslation(b.x, b.y + 0.35 + j, b.z));
        crowdHead.setMatrixAt(i, m4.makeTranslation(b.x, b.y + 0.92 + j, b.z));
      }
      crowdBody.instanceMatrix.needsUpdate = crowdHead.instanceMatrix.needsUpdate = true;
      flashes.forEach((f, i) => {
        const on = Math.sin(t * 13 + i * 2.7) > 0.93 - hype * 0.05;
        (f.material as THREE.SpriteMaterial).opacity = on ? 1 : 0;
      });
    },
  };
  crowd.update(0, 0.3);

  // stadium light towers
  const lights = new THREE.Group();
  const poleMat = toonMat(0x4a4458);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff4d0, fog: false });
  const beamTex = glowTexture('rgba(255,244,214,1)');
  const towers: { x: number; head: THREE.Mesh; flare: THREE.Sprite; beam: THREE.Mesh }[] = [];
  for (const side of [-1, 1])
    for (let x = -60; x <= 220; x += 46) {
      const z = side * (LANE_Z * 2 + 18);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.6, 22, 0.6), poleMat);
      pole.position.set(x, 11, z);
      outline(pole);
      group.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.6), lampMat);
      head.position.set(x, 22.5, z);
      head.lookAt(x, 0, 0);
      lights.add(head);
      if (o.dark) head.visible = false;
      const flare = glowSprite(beamTex, 0xfff0c8, 16, o.dark ? 0 : 0.9);
      flare.position.set(x, 22.5, z - side * 0.6);
      lights.add(flare);
      // volumetric beam through the haze
      const beam = new THREE.Mesh(
        new THREE.ConeGeometry(7, 26, 24, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xfff0c8, transparent: true, opacity: o.dark ? 0 : 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      );
      beam.position.set(x, 11, z * 0.55);
      beam.rotation.x = side * -0.7;
      lights.add(beam);
      towers.push({ x, head, flare, beam });
    }
  group.add(lights);

  // light: dim purple ambience + a stadium key from high front-left
  const hemi = new THREE.HemisphereLight(0x8c80c8, 0x1a1428, o.dark ? 0.35 : 1.1);
  group.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2dc, o.dark ? 0.3 : 2.2);
  key.position.set(-20, 40, 30);
  group.add(key);
  group.userData.key = key;
  group.userData.hemi = hemi;
  stage.registerSetLights(key, hemi, o.dark);

  stage.scene.add(group);
  const power = (on: (x: number) => boolean) => {
    let n = 0;
    for (const t of towers) {
      const k = on(t.x);
      if (k) n++;
      t.head.visible = k;
      (t.flare.material as THREE.SpriteMaterial).opacity = k ? 0.9 : 0;
      (t.beam.material as THREE.MeshBasicMaterial).opacity = k ? 0.05 : 0;
    }
    const f = n / towers.length;
    key.intensity = 0.3 + 1.9 * f;
    hemi.intensity = 0.35 + 0.75 * f;
    stage.setPower(f); // the Stage re-applies these each frame through the current Look
  };
  return { group, crowd, lights, power };
}

/** Drag-race "christmas tree": pre-stage/stage bulbs, three ambers, green, red, on a pole. */
export function buildTree(): { root: THREE.Group; set(state: 'off' | 'stage' | 'amber1' | 'amber2' | 'amber3' | 'green' | 'red' | 'all'): void } {
  const root = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.2, 0.35), toonMat(0x2b2733));
  pole.position.y = 1.6;
  root.add(pole);
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3.2, 0.5), toonMat(0x1b1922));
  box.position.y = 4.4;
  root.add(box);
  toonify(root);
  const tex = glowTexture();
  const rows: { y: number; c: number }[] = [
    { y: 5.6, c: 0xfff4d0 },
    { y: 5.2, c: 0xfff4d0 },
    { y: 4.7, c: 0xffb020 },
    { y: 4.2, c: 0xffb020 },
    { y: 3.7, c: 0xffb020 },
    { y: 3.2, c: 0x3cff5a },
    { y: 2.85, c: 0xff2a2a },
  ];
  const bulbs: { m: THREE.MeshBasicMaterial; g: THREE.Sprite; c: number }[] = [];
  for (const r of rows)
    for (const dx of [-0.38, 0.38]) {
      const m = new THREE.MeshBasicMaterial({ color: 0x222028 });
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), m);
      b.position.set(dx, r.y, 0.28);
      root.add(b);
      const g = glowSprite(tex, r.c, 1.6, 0);
      g.position.set(dx, r.y, 0.4);
      root.add(g);
      bulbs.push({ m, g, c: r.c });
    }
  const order = ['stage', 'amber1', 'amber2', 'amber3', 'green', 'red'];
  return {
    root,
    set(state) {
      bulbs.forEach((b, i) => {
        const row = Math.floor(i / 2);
        let on = false;
        if (state === 'all') on = true;
        else if (state === 'stage') on = row <= 1;
        else if (state.startsWith('amber')) on = row <= 1 || row === order.indexOf(state) + 1;
        else if (state === 'green') on = row <= 1 || row === 5;
        else if (state === 'red') on = row === 6;
        b.m.color.setHex(on ? b.c : 0x222028);
        (b.g.material as THREE.SpriteMaterial).opacity = on ? 1 : 0;
      });
    },
  };
}
