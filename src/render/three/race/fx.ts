// Race FX for the semi-realistic 3D mode: volumetric-looking tyre smoke (lit, sorted, soft billboards from a
// procedural puff atlas), exhaust flames + backfire pops with flashes and point-light flicker, nitrous jets
// with shock diamonds, rubber laid on the strip, sparks, dust and speed streaks (velocity-stretched ribbons),
// ground light pools and a heat-haze distortion pass. Everything is pooled in a handful of instanced draws with
// fixed counts per quality level; dispose() frees every geometry, material, texture and render target.
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import type { Quality } from '../../../game/settings';
import type { CineCar, CineEvent, CineView } from './camera';

// ------------------------------------------------------------------ contract

/** What the FX need from a car (Car3D satisfies it; everything past root is optional). */
export interface FxCar extends CineCar {
  build?: CineCar['build'] & {
    anchors?: {
      exhausts?: { pos: THREE.Vector3; dir: THREE.Vector3 }[];
      wheelRL?: THREE.Vector3; wheelRR?: THREE.Vector3; wheelFL?: THREE.Vector3; wheelFR?: THREE.Vector3;
      hood?: THREE.Vector3; frontBumper?: THREE.Vector3; taillights?: THREE.Vector3[];
    };
  };
  exhaustWorld?(i: number, out: THREE.Vector3): THREE.Vector3;
  /** Kit (optional): the fitted tip count and world direction (tips can differ from the body anchors). */
  exhaustCount?: number;
  exhaustDirWorld?(i: number, out: THREE.Vector3): THREE.Vector3;
  rearContactWorld?(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3;
  /** Kit (optional): brake disc glow 0..1, wheelie-bar wheel contact point. */
  setBrakeGlow?(k: number): void;
  wheelieBarWorld?(out: THREE.Vector3): THREE.Vector3 | null;
}

export interface RaceFxOpts {
  /** Stadium light level at (x, z) from the strip (0 dark .. ~1 under a pool): lights the smoke. */
  lightAt?: (x: number, z: number) => number;
  /** The key light the smoke is shaded by (default: the first DirectionalLight found in the scene). */
  keyLight?: THREE.DirectionalLight;
}

interface QCfg { smoke: number; rate: number; lines: number; rubber: number; lights: number; haze: boolean; glows: number }
const QUALITY: Record<Quality, QCfg> = {
  low: { smoke: 120, rate: 0.4, lines: 100, rubber: 500, lights: 0, haze: false, glows: 8 },
  medium: { smoke: 260, rate: 0.65, lines: 200, rubber: 1200, lights: 1, haze: true, glows: 10 },
  high: { smoke: 420, rate: 0.85, lines: 300, rubber: 1800, lights: 1, haze: true, glows: 12 },
};

const TRACK = 402.3;
const V = () => new THREE.Vector3();
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const num = (x: boolean | number | undefined) => (typeof x === 'number' ? x : x ? 1 : 0);

// deterministic-free randomness is fine for FX, but keep a cheap fast one
let seedR = 0x9e3779b9;
function rnd(): number {
  seedR = (seedR + 0x6d2b79f5) >>> 0;
  let t = seedR;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a: number, b: number) => a + (b - a) * rnd();

// ------------------------------------------------------------------ procedural textures

function hash2(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number, s: number, oct = 5): number {
  let f = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    f += a * vnoise(x, y, s + i * 31);
    n += a;
    x = x * 2.03 + 1.7;
    y = y * 2.03 - 0.9;
    a *= 0.5;
  }
  return f / n;
}

/**
 * Smoke puff atlas, 2x2 tiles of billowy cumulus puffs. Each puff is a union of noisy spheres: R = density,
 * GB = the sphere-union surface normal (so a flat sprite shades like a lumpy volume), A = thickness.
 */
function smokeAtlas(): THREE.DataTexture {
  const T = 128, N = T * 2;
  const data = new Uint8Array(N * N * 4);
  const H = new Float32Array(T * T);
  for (let tile = 0; tile < 4; tile++) {
    const s = 101 + tile * 977;
    const blobs: number[][] = [];
    // a big core plus lobes round it, biased up (smoke billows up and out)
    blobs.push([0, -0.02, 0.17 + hash2(tile, 1, 5) * 0.04]);
    const nb = 13 + Math.floor(hash2(tile, 3, 9) * 8);
    for (let b = 0; b < nb; b++) {
      const a = hash2(b, tile, 11) * Math.PI * 2;
      const rad = 0.08 + Math.sqrt(hash2(b, tile, 12)) * 0.2;
      const R = 0.055 + hash2(b, tile, 13) * 0.085 * (1 - rad * 1.6);
      blobs.push([Math.cos(a) * rad, Math.sin(a) * rad * 0.8 + 0.02, R]);
    }
    let hmax = 1e-6;
    for (let j = 0; j < T; j++) {
      for (let i = 0; i < T; i++) {
        let u = (i + 0.5) / T - 0.5, v = (j + 0.5) / T - 0.5;
        // wispy edges: domain-warp before the sphere test
        u += (fbm(u * 7 + tile, v * 7, s, 4) - 0.5) * 0.07;
        v += (fbm(u * 7 - 3, v * 7 + tile, s + 1, 4) - 0.5) * 0.07;
        let h = 0;
        for (const [bx, by, br] of blobs) {
          const q = 1 - ((u - bx) ** 2 + (v - by) ** 2) / (br * br);
          if (q > 0) h = Math.max(h, Math.sqrt(q) * br);
        }
        // surface detail: small billows on the spheres
        h *= 0.9 + 0.2 * fbm(u * 16, v * 16, s + 2, 3);
        H[j * T + i] = h;
        hmax = Math.max(hmax, h);
      }
    }
    const ox = (tile % 2) * T, oy = Math.floor(tile / 2) * T;
    const at = (x: number, y: number) => H[clamp(y, 0, T - 1) * T + clamp(x, 0, T - 1)];
    for (let j = 0; j < T; j++) {
      for (let i = 0; i < T; i++) {
        const h = at(i, j);
        const hn = h / hmax;
        // density: solid inside, a soft noisy rim; wisps where the height is thin
        const den = smooth(0.0, 0.95, hn) * (0.55 + 0.45 * fbm(i / 11, j / 11, tile + 40, 3));
        // normal from the height field (metric units: texels -> uv)
        const e = 1.5 / T;
        const dx = (at(i + 1, j) - at(i - 1, j)) / (2 * e);
        const dy = (at(i, j + 1) - at(i, j - 1)) / (2 * e);
        const l = Math.hypot(dx, dy, 1);
        const k = ((oy + j) * N + ox + i) * 4;
        data[k] = Math.round(clamp(den, 0, 1) * 255);
        data[k + 1] = Math.round(clamp((-dx / l) * 0.5 + 0.5, 0, 1) * 255);
        data[k + 2] = Math.round(clamp((-dy / l) * 0.5 + 0.5, 0, 1) * 255);
        data[k + 3] = Math.round(clamp(hn, 0, 1) * 255);
      }
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
function smooth(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Rubber mark texture: dark longitudinal tread streaks with feathered edges (U across, V along). */
function rubberTex(): THREE.DataTexture {
  const W = 64, H = 256;
  const data = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / W;
      const edge = smooth(0, 0.16, u) * smooth(1, 0.84, u);
      const grooves = 0.75 + 0.25 * Math.sin(u * Math.PI * 9 + vnoise(u * 4, j / 40, 3) * 2);
      const streak = 0.55 + 0.45 * fbm(u * 18, j / 26, 7, 4);
      const k = (j * W + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(clamp(edge * grooves * streak * 1.25, 0, 1) * 255);
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ shared GLSL

const GLSL_NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm3(vec2 p){ return 0.55 * vn(p) + 0.3 * vn(p * 2.07 + 3.1) + 0.15 * vn(p * 4.3 - 1.7); }
`;

/**
 * One invisible instance far below the strip (alpha / colour 0): instanced FX never draw zero instances, so every
 * program and pipeline is built on the first frame instead of the first time the effect fires (a hitch).
 */
function parkInstance(A: Float32Array, B: Float32Array | null, C: Float32Array | null): number {
  A[0] = 0; A[1] = -50; A[2] = 0; A[3] = 0.01;
  if (B) { B[0] = 0; B[1] = -50; B[2] = 0; B[3] = 0; }
  if (C) { C[0] = C[1] = C[2] = C[3] = 0; }
  return 1;
}

// ------------------------------------------------------------------ smoke

const SMOKE_VS = /* glsl */ `
attribute vec4 iA; // world pos, size (m)
attribute vec4 iB; // rotation, alpha, atlas tile, stadium light
attribute vec4 iC; // tint rgb, self-glow (hot/emissive) 0..1
uniform vec4 uPL[4]; // point lights at the smoke: pos, range
uniform vec3 uPLC[4]; // colour * intensity
varying vec2 vUv; varying vec2 vCS; varying float vAlpha; varying vec3 vTint; varying vec3 vPt;
varying float vLight; varying float vY; varying float vSize; varying float vCamD; varying float vGlow;
#include <fog_pars_vertex>
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(iB.x), s = sin(iB.x);
  vec2 p = position.xy;
  vec2 r = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  vec3 wp = iA.xyz + (right * r.x + up * r.y) * iA.w;
  float tile = iB.z;
  vUv = (uv + vec2(mod(tile, 2.0), floor(tile * 0.5))) * 0.5;
  vCS = vec2(c, s);
  vAlpha = iB.y; vTint = iC.rgb; vGlow = iC.a; vLight = iB.w; vY = wp.y; vSize = iA.w;
  vec3 pt = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 d = uPL[i].xyz - iA.xyz;
    float rr = uPL[i].w;
    float q = dot(d, d) / max(1e-3, rr * rr);
    pt += uPLC[i] * max(0.0, 1.0 - q) / (1.0 + q * 6.0);
  }
  vPt = pt;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  vCamD = -mvPosition.z;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const SMOKE_FS = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uKeyV; // key light direction (towards the light), view space
uniform vec3 uKeyC;
uniform vec3 uAmb;
uniform vec3 uUpV; // world up in view space
uniform vec3 uStadC;
uniform vec4 uView;     // viewport (px) for gl_FragCoord -> uv
uniform vec4 uCar;      // the player's car on screen: uv ellipse centre + radii (rx = 0: none)
uniform float uCarD;    // its distance (m): smoke nearer than this over the car thins out
uniform float uAlphaK;  // global coverage cap (1 = none)
varying vec2 vUv; varying vec2 vCS; varying float vAlpha; varying vec3 vTint; varying vec3 vPt;
varying float vLight; varying float vY; varying float vSize; varying float vCamD; varying float vGlow;
#include <fog_pars_fragment>
void main() {
  vec4 t = texture2D(uTex, vUv);
  float d = t.r;
  if (d * vAlpha < 0.002) discard;
  vec2 g = t.gb * 2.0 - 1.0;
  g = vec2(vCS.x * g.x - vCS.y * g.y, vCS.y * g.x + vCS.x * g.y);
  // the puff's sphere-union normal, softened (smoke is not a hard surface)
  vec3 n = normalize(mix(vec3(0.0, 0.0, 1.0), vec3(g, sqrt(max(0.0, 1.0 - dot(g, g)))), 0.5));
  float thick = t.a;
  float key = clamp(dot(n, uKeyV) * 0.65 + 0.35, 0.0, 1.0);
  float upK = clamp(dot(n, uUpV) * 0.6 + 0.4, 0.0, 1.0);
  // light shining through the thin edges toward the camera
  float scat = pow(clamp(-uKeyV.z, 0.0, 1.0), 3.0) * (1.0 - thick) * 1.2;
  // self-shadow: the core of a thick puff, facing away from the light, goes dark
  float occ = mix(1.0, 0.8, thick * (1.0 - key));
  vec3 lit = uAmb * (0.35 + 0.65 * upK) * occ
    + uKeyC * (key + scat) * occ
    + uStadC * vLight * upK * upK * occ
    + vPt * (0.4 + 0.6 * (1.0 - thick));
  vec3 col = vTint * lit + vTint * vGlow * (1.0 - thick * 0.5);
  float a = d * vAlpha;
  a *= smoothstep(0.0, max(0.05, 0.16 * vSize), vY);   // soft where it meets the strip
  float exempt = step(0.004, vGlow); // the nitrous purge: always shows
  a *= mix(smoothstep(1.0, 3.6, vCamD), 1.0, exempt);   // thins out as it reaches the lens
  // keep the hero car readable: smoke between the lens and the car thins over the car's screen ellipse
  if (uCar.z > 0.0 && exempt < 0.5) {
    vec2 q = ((gl_FragCoord.xy - uView.xy) / uView.zw - uCar.xy) / (uCar.zw * 1.35);
    float inE = 1.0 - smoothstep(0.7, 1.0, dot(q, q));
    a *= 1.0 - inE * 0.75 * (1.0 - smoothstep(uCarD - 1.0, uCarD + 1.5, vCamD));
  }
  a *= mix(uAlphaK, 1.0, exempt);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
  gl_FragColor.rgb *= a;
}`;

interface SmokeKind { tint: [number, number, number]; glow?: number }

class Smoke {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  readonly mat: THREE.ShaderMaterial;
  private A: THREE.InstancedBufferAttribute;
  private B: THREE.InstancedBufferAttribute;
  private C: THREE.InstancedBufferAttribute;
  readonly max: number;
  n = 0;
  // SoA particle state
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private sz: Float32Array; private gr: Float32Array; private rot: Float32Array; private rv: Float32Array;
  private age: Float32Array; private life: Float32Array; private a0: Float32Array; private tile: Float32Array;
  private buoy: Float32Array; private drag: Float32Array; private light: Float32Array; private sz0: Float32Array;
  private tr: Float32Array; private tg: Float32Array; private tb: Float32Array; private glow: Float32Array;
  private fadeS: Float32Array; // life fraction where the fade-out starts (big burnout clouds hang on)
  /** World wind (m/s) every puff drifts on: a slow ambient drift plus gusts. */
  readonly wind = new THREE.Vector3(-0.3, 0, -0.6);
  private order: number[] = [];
  private keys: Float32Array;
  private tex: THREE.DataTexture;
  lightAt: (x: number, z: number) => number = () => 0.75;
  private lightI = 0;
  private recycleI = 0;

  constructor(max: number) {
    this.max = max;
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.sz = f(); this.gr = f(); this.rot = f(); this.rv = f(); this.age = f(); this.life = f(); this.a0 = f();
    this.tile = f(); this.buoy = f(); this.drag = f(); this.light = f(); this.sz0 = f();
    this.tr = f(); this.tg = f(); this.tb = f(); this.glow = f(); this.fadeS = f();
    this.keys = f();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.A = mk(); this.B = mk(); this.C = mk();
    this.geo.setAttribute('iA', this.A);
    this.geo.setAttribute('iB', this.B);
    this.geo.setAttribute('iC', this.C);
    this.geo.instanceCount = 0;
    quad.dispose(); // attributes now belong to geo
    this.tex = smokeAtlas();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VS,
      fragmentShader: SMOKE_FS,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTex: { value: null }, uKeyV: { value: V() }, uKeyC: { value: new THREE.Color() }, uAmb: { value: new THREE.Color() },
          uUpV: { value: V() }, uStadC: { value: new THREE.Color() },
          uView: { value: new THREE.Vector4(0, 0, 1, 1) }, uCar: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, uCarD: { value: 0 }, uAlphaK: { value: 1 },
          uPL: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -100, 0, 1)) },
          uPLC: { value: [0, 1, 2, 3].map(() => new THREE.Color(0, 0, 0)) },
        },
      ]),
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mat.uniforms.uTex.value = this.tex;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'fx:smoke';
    const view = this.mat.uniforms.uView.value as THREE.Vector4;
    this.mesh.onBeforeRender = (renderer) => void renderer.getCurrentViewport(view);
  }

  /** Spawn one puff. Returns false when the pool is full (oldest-first recycling keeps clouds alive). */
  /** Spawn a puff. A full pool recycles its most-faded puff; `force` (event FX) always gets a slot. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, grow: number, life: number, alpha: number, k: SmokeKind, buoy = 0.35, drag = 1.6, fadeStart = 0.42, force = false) {
    let i = this.n;
    if (i >= this.max) {
      let best = 0, bv = -1;
      for (let j = (this.recycleI++ % 3); j < this.n; j += 3) {
        const f = this.age[j] / this.life[j];
        if (f > bv) { bv = f; best = j; }
      }
      if (bv < 0.45 && !force) return false;
      i = best;
    } else this.n++;
    this.px[i] = x; this.py[i] = Math.max(y, size * 0.3); this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.sz[i] = this.sz0[i] = size; this.gr[i] = grow; this.rot[i] = rnd() * 6.283; this.rv[i] = rr(-0.9, 0.9);
    this.age[i] = 0; this.life[i] = life; this.a0[i] = alpha; this.tile[i] = Math.floor(rnd() * 4);
    this.buoy[i] = buoy; this.drag[i] = drag;
    this.light[i] = this.lightAt(x, z);
    const j = rr(0.93, 1.05);
    this.tr[i] = k.tint[0] * j; this.tg[i] = k.tint[1] * j; this.tb[i] = k.tint[2] * j; this.glow[i] = k.glow ?? 0;
    this.fadeS[i] = fadeStart;
    return true;
  }

  update(dt: number, t: number, cam: THREE.Camera) {
    let n = this.n;
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        // swap-remove
        n--;
        this.copy(n, i);
        i--;
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      // cheap swirl: a divergence-free-ish field from sines, scaled by size (big clouds roll slowly)
      const x = this.px[i], y = this.py[i], z = this.pz[i];
      const sw = 0.9 / (0.6 + this.sz[i] * 0.35);
      const cx = Math.sin(y * 1.7 + t * 0.9 + z * 0.6) - Math.sin(z * 1.3 - t * 0.7);
      const cz = Math.sin(x * 1.1 - t * 0.8) - Math.cos(y * 1.5 + t * 0.6);
      this.vx[i] = this.vx[i] * dr + cx * sw * dt;
      this.vz[i] = this.vz[i] * dr + cz * sw * dt;
      this.vy[i] = this.vy[i] * dr + (this.buoy[i] + Math.sin(x * 0.9 + t * 1.3) * 0.12) * dt;
      this.px[i] = x + (this.vx[i] + this.wind.x) * dt;
      this.py[i] = y + this.vy[i] * dt;
      this.pz[i] = z + (this.vz[i] + this.wind.z) * dt;
      // expansion slows as the puff ages
      this.sz[i] += (this.gr[i] * dt) / (1 + this.age[i] * 1.2);
      const floor = this.sz[i] * 0.28;
      if (this.py[i] < floor) {
        this.py[i] = floor;
        if (this.vy[i] < 0) {
          // hits the strip: spreads sideways
          this.vx[i] += -this.vy[i] * 0.5 * Math.sign(this.vx[i] || 1);
          this.vy[i] *= -0.1;
        }
      }
      this.rot[i] += this.rv[i] * dt / (1 + this.age[i] * 0.5);
    }
    this.n = n;
    // refresh stadium light a few per frame
    for (let k = 0; k < 24 && n > 0; k++) {
      this.lightI = (this.lightI + 1) % n;
      this.light[this.lightI] = this.lightAt(this.px[this.lightI], this.pz[this.lightI]);
    }
    // back-to-front sort
    const e = cam.matrixWorld.elements;
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ox = e[12], oy = e[13], oz = e[14];
    const ord = this.order;
    ord.length = n;
    for (let i = 0; i < n; i++) {
      ord[i] = i;
      this.keys[i] = (this.px[i] - ox) * fx + (this.py[i] - oy) * fy + (this.pz[i] - oz) * fz;
    }
    const keys = this.keys;
    ord.sort((a, b) => keys[b] - keys[a]);
    const A = this.A.array as Float32Array, B = this.B.array as Float32Array, C = this.C.array as Float32Array;
    const pc = cam as THREE.PerspectiveCamera;
    const tanV = Math.tan(((pc.fov ?? 50) * Math.PI) / 360);
    const aspect = pc.aspect ?? 16 / 9;
    let cov = 0;
    let m = 0;
    for (let k = 0; k < n; k++) {
      const i = ord[k];
      if (keys[i] < -1) continue; // behind the camera
      const f = this.age[i] / this.life[i];
      // fade in fast, thin out as it expands, fade out over the back half
      const fin = Math.min(1, this.age[i] / 0.09);
      const fout = 1 - smooth(this.fadeS[i], 1, f);
      const thin = Math.pow(this.sz0[i] / this.sz[i], 0.55);
      // the lingering burnout haze goes thin as it ages: atmosphere the cars drive through, not a wall
      const old = this.fadeS[i] > 0.5 ? 1 - 0.55 * smooth(0.12, 0.55, f) : 1;
      const a = this.a0[i] * fin * fout * (0.35 + 0.65 * thin) * old;
      // screen coverage estimate (fraction of the frame, alpha-weighted)
      if (keys[i] > 1.0 && this.glow[i] === 0) {
        // what actually shows: the shader fades puffs nearer than ~3.6 m
        const r = (this.sz[i] * 0.5) / (keys[i] * tanV);
        cov += Math.min(1, (Math.PI * r * r) / (4 * aspect)) * a * 0.5 * smooth(1.0, 3.6, keys[i]);
      }
      const o = m * 4;
      A[o] = this.px[i]; A[o + 1] = this.py[i]; A[o + 2] = this.pz[i]; A[o + 3] = this.sz[i];
      B[o] = this.rot[i]; B[o + 1] = a; B[o + 2] = this.tile[i]; B[o + 3] = this.light[i];
      C[o] = this.tr[i]; C[o + 1] = this.tg[i]; C[o + 2] = this.tb[i]; C[o + 3] = this.glow[i] * (1 - f);
      m++;
    }
    if (m === 0) m = parkInstance(A, B, C);
    this.geo.instanceCount = m;
    for (const at of [this.A, this.B, this.C]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, m * 4);
      at.needsUpdate = true;
    }
    // cap the smoke's total screen coverage: beyond ~1.3 frames' worth of alpha everything thins together
    const u = this.mat.uniforms.uAlphaK;
    const target = cov > 2.5 ? Math.max(0.35, 2.5 / cov) : 1;
    u.value += (target - u.value) * (1 - Math.exp(-dt * 10));
  }

  /** The hero car on screen (uv ellipse, distance) so the smoke in front of it thins. */
  setCar(cx: number, cy: number, rx: number, ry: number, dist: number) {
    (this.mat.uniforms.uCar.value as THREE.Vector4).set(cx, cy, rx, ry);
    this.mat.uniforms.uCarD.value = dist;
  }

  private copy(from: number, to: number) {
    const arrs = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.sz, this.gr, this.rot, this.rv, this.age, this.life, this.a0, this.tile, this.buoy, this.drag, this.light, this.sz0, this.tr, this.tg, this.tb, this.glow, this.fadeS];
    for (const a of arrs) a[to] = a[from];
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

// ------------------------------------------------------------------ line particles (sparks, dust, streaks)

const LINE_VS = /* glsl */ `
attribute vec4 iA; // head pos, width
attribute vec4 iB; // tail pos, alpha
attribute vec4 iC; // colour (HDR)
varying vec2 vUv; varying vec3 vCol; varying float vA;
#include <fog_pars_vertex>
void main() {
  vec3 head = iA.xyz, tail = iB.xyz;
  vec3 p = mix(head, tail, position.x);
  vec3 dir = tail - head;
  float L = length(dir);
  dir = L > 1e-4 ? dir / L : vec3(1.0, 0.0, 0.0);
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = cross(dir, toCam);
  float sl = length(side);
  side = sl > 1e-3 ? side / sl : vec3(0.0, 1.0, 0.0);
  // a short head-on segment still gets a round-ish blob: extend along dir by the width
  p += side * position.y * iA.w + dir * (position.x * 2.0 - 1.0) * iA.w * 0.5;
  vUv = vec2(position.x, position.y);
  vCol = iC.rgb; vA = iB.w;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const LINE_FS = /* glsl */ `
varying vec2 vUv; varying vec3 vCol; varying float vA;
#include <fog_pars_fragment>
void main() {
  float across = 1.0 - vUv.y * vUv.y;
  float along = mix(1.0, 0.25, vUv.x);
  float k = across * across * along * vA;
  if (k < 0.002) discard;
  gl_FragColor = vec4(vCol * k, 1.0);
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    gl_FragColor.rgb *= 1.0 - fogFactor;
  #endif
}`;

const enum LK { Spark = 0, Dust = 1, Streak = 2 }

class Lines {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  readonly mat: THREE.ShaderMaterial;
  private A: THREE.InstancedBufferAttribute;
  private B: THREE.InstancedBufferAttribute;
  private C: THREE.InstancedBufferAttribute;
  readonly max: number;
  n = 0;
  private s: Float32Array; // stride 16: pos3 vel3 age life width kind r g b bright stretch spare
  private static S = 16;

  constructor(max: number) {
    this.max = max;
    this.s = new Float32Array(max * Lines.S);
    this.geo = new THREE.InstancedBufferGeometry();
    // ribbon: x 0..1 along, y -1..1 across (2 segments along so the fade reads)
    const pos = new Float32Array([0, -1, 0, 1, -1, 0, 0, 1, 0, 1, 1, 0]);
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setIndex([0, 1, 2, 2, 1, 3]);
    const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.A = mk(); this.B = mk(); this.C = mk();
    this.geo.setAttribute('iA', this.A);
    this.geo.setAttribute('iB', this.B);
    this.geo.setAttribute('iC', this.C);
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: LINE_VS,
      fragmentShader: LINE_FS,
      uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 12;
    this.mesh.name = 'fx:lines';
  }

  emit(kind: LK, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, width: number, r: number, g: number, b: number, bright = 1, stretch = 0.03) {
    let i = this.n;
    if (i >= this.max) i = Math.floor(rnd() * this.max);
    else this.n++;
    const o = i * Lines.S, s = this.s;
    s[o] = x; s[o + 1] = y; s[o + 2] = z; s[o + 3] = vx; s[o + 4] = vy; s[o + 5] = vz;
    s[o + 6] = 0; s[o + 7] = life; s[o + 8] = width; s[o + 9] = kind;
    s[o + 10] = r; s[o + 11] = g; s[o + 12] = b; s[o + 13] = bright; s[o + 14] = stretch;
  }

  /** camVel: for streaks (static in the world), the blur comes from the camera's own motion. */
  update(dt: number, camVel: THREE.Vector3, camX: number, wind?: THREE.Vector3) {
    const s = this.s, S = Lines.S;
    let n = this.n;
    const A = this.A.array as Float32Array, B = this.B.array as Float32Array, C = this.C.array as Float32Array;
    let m = 0;
    for (let i = 0; i < n; i++) {
      let o = i * S;
      s[o + 6] += dt;
      const kind = s[o + 9];
      const dead = s[o + 6] >= s[o + 7] || (kind === LK.Streak && s[o] < camX - 6);
      if (dead) {
        n--;
        s.copyWithin(o, n * S, n * S + S);
        i--;
        continue;
      }
      const f = s[o + 6] / s[o + 7];
      if (kind === LK.Spark) {
        s[o + 4] -= 9.8 * dt;
        const dr = Math.exp(-1.2 * dt);
        s[o + 3] *= dr; s[o + 5] *= dr;
        s[o] += s[o + 3] * dt; s[o + 1] += s[o + 4] * dt; s[o + 2] += s[o + 5] * dt;
        if (s[o + 1] < 0.015) {
          s[o + 1] = 0.015;
          if (s[o + 4] < 0) s[o + 4] *= -0.32;
          s[o + 3] *= 0.75; s[o + 5] *= 0.75;
        }
      } else if (kind === LK.Dust) {
        s[o + 4] -= 2.5 * dt;
        const dr = Math.exp(-2.4 * dt);
        s[o + 3] *= dr; s[o + 4] *= dr; s[o + 5] *= dr;
        s[o] += (s[o + 3] + (wind ? wind.x : 0)) * dt; s[o + 1] = Math.max(0.02, s[o + 1] + s[o + 4] * dt); s[o + 2] += (s[o + 5] + (wind ? wind.z : 0)) * dt;
      }
      // tail: along the motion relative to the camera (streaks: pure camera motion)
      const st = s[o + 14];
      let rvx = s[o + 3], rvy = s[o + 4], rvz = s[o + 5];
      if (kind === LK.Streak) { rvx = -camVel.x; rvy = -camVel.y; rvz = -camVel.z; }
      else { rvx -= camVel.x * 0.5; rvy -= camVel.y * 0.5; rvz -= camVel.z * 0.5; }
      const q = m * 4;
      A[q] = s[o]; A[q + 1] = s[o + 1]; A[q + 2] = s[o + 2]; A[q + 3] = s[o + 8];
      B[q] = s[o] - rvx * st; B[q + 1] = s[o + 1] - rvy * st; B[q + 2] = s[o + 2] - rvz * st;
      let a: number;
      let cr = s[o + 10], cg = s[o + 11], cb = s[o + 12];
      if (kind === LK.Spark) {
        // white-hot to orange to dull red
        a = (1 - f) * s[o + 13];
        cg *= 1 - f * 0.55; cb *= 1 - f * 0.9;
      } else if (kind === LK.Dust) a = s[o + 13] * Math.sin(Math.PI * Math.min(1, f * 1.15));
      else a = s[o + 13] * Math.min(1, s[o + 6] / 0.12) * (1 - f);
      B[q + 3] = a;
      C[q] = cr; C[q + 1] = cg; C[q + 2] = cb; C[q + 3] = 1;
      m++;
      o = 0;
    }
    this.n = n;
    if (m === 0) m = parkInstance(A, B, C);
    this.geo.instanceCount = m;
    for (const at of [this.A, this.B, this.C]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, m * 4);
      at.needsUpdate = true;
    }
  }

  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ------------------------------------------------------------------ flames

const FLAME_VS = /* glsl */ `
uniform vec3 uOrigin; uniform vec3 uDir; uniform float uLen; uniform float uWidth;
varying vec2 vUv; varying float vFace;
void main() {
  // axis billboard: the quad spins round the jet axis to face the camera
  vec3 toCam = normalize(cameraPosition - uOrigin);
  vec3 side = cross(uDir, toCam);
  float sl = length(side);
  side = sl > 1e-3 ? side / sl : vec3(0.0, 1.0, 0.0);
  float x = position.x, y = position.y;
  float prof = (0.42 + 0.58 * sqrt(x)) * (1.0 - 0.35 * x);
  vec3 p = uOrigin + uDir * (x * uLen) + side * (y * uWidth * prof);
  vUv = vec2(x, y);
  vFace = sl; // ~0 when looking straight down the pipe
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FLAME_FS = /* glsl */ `
uniform float uTime; uniform float uI; uniform float uNitro; uniform float uSeed;
varying vec2 vUv; varying float vFace;
${GLSL_NOISE}
void main() {
  float x = vUv.x, y = vUv.y, ay = abs(y);
  // ---- petrol: blue root, a white-yellow core, an orange body torn into licks, red tips
  float sp = 13.0;
  float n = fbm3(vec2(x * 3.4 - uTime * sp, y * 1.7 + uSeed));
  float n2 = vn(vec2(x * 9.0 - uTime * sp * 1.5, y * 3.2 - uSeed));
  float w = 1.0 - smoothstep(0.3, 0.95, ay + (n - 0.5) * 0.8);
  float fade = 1.0 - smoothstep(0.3, 1.0, x + (n - 0.5) * 0.5);
  float body = w * fade;
  float core = (1.0 - smoothstep(0.0, 0.38, ay)) * (1.0 - smoothstep(0.0, 0.45, x + (n2 - 0.5) * 0.2));
  vec3 pet = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.62, 0.16), n2) * body * (1.0 - x * 0.5);
  pet += vec3(1.0, 0.86, 0.55) * core * 1.6;
  pet = mix(pet, vec3(0.3, 0.45, 1.0) * body, (1.0 - smoothstep(0.0, 0.08, x)) * 0.7);
  // ---- nitrous: a tight white-blue core with shock diamonds inside a thin electric-blue sheath, violet fringe
  float nn = vn(vec2(x * 6.0 - uTime * 30.0, y * 2.0 + uSeed));
  float sheath = (1.0 - smoothstep(0.3, 0.9, ay + (nn - 0.5) * 0.25)) * (1.0 - smoothstep(0.5, 1.0, x + (nn - 0.5) * 0.2));
  float ncore = (1.0 - smoothstep(0.0, 0.22, ay)) * (1.0 - smoothstep(0.2, 0.75, x));
  float dia = pow(0.5 + 0.5 * cos((x * 6.0 - 0.1) * 6.2832), 6.0) * (1.0 - smoothstep(0.05, 0.7, x));
  float fringe = (1.0 - smoothstep(0.6, 1.0, ay)) * smoothstep(0.35, 0.7, ay) * (1.0 - smoothstep(0.3, 0.9, x));
  vec3 nos = vec3(0.15, 0.42, 1.0) * sheath * 0.9 + vec3(0.5, 0.22, 1.0) * fringe * 0.5;
  nos += vec3(0.75, 0.9, 1.0) * ncore * (1.6 + dia * 3.0);
  vec3 col = mix(pet, nos, uNitro);
  float edgeOn = smoothstep(0.02, 0.3, vFace);
  gl_FragColor = vec4(col * uI * edgeOn, 1.0);
}`;

const GLOW_VS = /* glsl */ `
attribute vec4 iA; // pos, size
attribute vec4 iC; // colour * intensity, mode (0 sprite, 1 ground decal)
varying vec2 vUv; varying vec3 vCol;
void main() {
  vec3 p;
  if (iC.a > 0.5) {
    p = iA.xyz + vec3(position.x, 0.0, position.y) * iA.w;
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    p = iA.xyz + (right * position.x + up * position.y) * iA.w;
  }
  vUv = position.xy * 2.0;
  vCol = iC.rgb;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const GLOW_FS = /* glsl */ `
varying vec2 vUv; varying vec3 vCol;
void main() {
  float r = length(vUv);
  float k = exp(-r * r * 4.5) * (1.0 - smoothstep(0.75, 1.0, r));
  if (k < 0.002) discard;
  gl_FragColor = vec4(vCol * k, 1.0);
}`;

/** Additive glow quads: camera-facing flashes and flat ground light pools. */
class Glows {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  readonly mat: THREE.ShaderMaterial;
  private A: THREE.InstancedBufferAttribute;
  private C: THREE.InstancedBufferAttribute;
  private n = 0;
  constructor(readonly max: number) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    quad.dispose();
    this.A = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.C = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iA', this.A);
    this.geo.setAttribute('iC', this.C);
    this.mat = new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mat.polygonOffset = true;
    this.mat.polygonOffsetFactor = -2;
    this.mat.polygonOffsetUnits = -2;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.name = 'fx:glows';
  }
  begin() {
    this.n = 0;
  }
  add(p: THREE.Vector3, size: number, c: THREE.Color, k: number, ground = false) {
    if (this.n >= this.max || k <= 0.001) return;
    const o = this.n * 4;
    const A = this.A.array as Float32Array, C = this.C.array as Float32Array;
    A[o] = p.x; A[o + 1] = ground ? 0.012 : p.y; A[o + 2] = p.z; A[o + 3] = size;
    C[o] = c.r * k; C[o + 1] = c.g * k; C[o + 2] = c.b * k; C[o + 3] = ground ? 1 : 0;
    this.n++;
  }
  end() {
    if (this.n === 0) this.n = parkInstance(this.A.array as Float32Array, null, this.C.array as Float32Array);
    this.geo.instanceCount = this.n;
    for (const at of [this.A, this.C]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * 4);
      at.needsUpdate = true;
    }
  }
  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

class FlameJet {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  burst = 0; // seconds of flame left (2D flameBurst)
  burstLen = 0.2;
  pop = 0; // 0..1 spike (backfire)
  nitro = 0; // smoothed 0..1
  intensity = 0;
  readonly origin = V();
  readonly dir = new THREE.Vector3(-1, 0, 0);
  /** Off: zero intensity on a speck parked under the strip. It stays drawn so its program never compiles late. */
  idle() {
    const u = this.mat.uniforms;
    u.uI.value = 0;
    u.uLen.value = 0.001;
    u.uWidth.value = 0.001;
    this.origin.set(0, -50, 0);
  }
  constructor(geo: THREE.BufferGeometry, seed: number) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FLAME_VS,
      fragmentShader: FLAME_FS,
      uniforms: {
        uOrigin: { value: this.origin }, uDir: { value: this.dir }, uLen: { value: 0.5 }, uWidth: { value: 0.1 },
        uTime: { value: 0 }, uI: { value: 0 }, uNitro: { value: 0 }, uSeed: { value: seed },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    this.mesh.name = 'fx:flame';
    this.idle();
  }
}

// ------------------------------------------------------------------ rubber

const RUBBER_VS = /* glsl */ `
attribute float aA;
varying vec2 vUv; varying float vA;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vA = aA;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const RUBBER_FS = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv; varying float vA;
#include <fog_pars_fragment>
void main() {
  float a = texture2D(uTex, vUv).a * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.012, 0.011, 0.01), a);
  #include <fog_fragment>
}`;

/** Ring buffer of tyre-mark quads laid flat on the strip. */
class Rubber {
  readonly mesh: THREE.Mesh;
  private geo: THREE.BufferGeometry;
  readonly mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private uv: Float32Array;
  private al: Float32Array;
  private head = 0;
  private used = 0;
  private tex: THREE.DataTexture;
  private dirty = false;
  private lo = Infinity;
  private hi = -1;
  constructor(readonly max: number) {
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 4 * 3);
    this.uv = new Float32Array(max * 4 * 2);
    this.al = new Float32Array(max * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 2; idx[o + 2] = v + 1; idx[o + 3] = v + 1; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    this.geo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aA', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.tex = rubberTex();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: RUBBER_VS,
      fragmentShader: RUBBER_FS,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: null } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    this.mat.uniforms.uTex.value = this.tex;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'fx:rubber';
  }

  /** A mark from (x0, z0) to (x1, z1), `w` wide; v0 is the texture offset along the mark. */
  lay(x0: number, z0: number, x1: number, z1: number, w: number, a: number, v0: number) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.used = Math.min(this.max, this.used + 1);
    let dx = x1 - x0, dz = z1 - z0;
    const L = Math.hypot(dx, dz) || 1e-3;
    dx /= L; dz /= L;
    const nx = -dz * w * 0.5, nz = dx * w * 0.5;
    const p = this.pos, o = i * 12, y = 0.004;
    p[o] = x0 + nx; p[o + 1] = y; p[o + 2] = z0 + nz;
    p[o + 3] = x0 - nx; p[o + 4] = y; p[o + 5] = z0 - nz;
    p[o + 6] = x1 + nx; p[o + 7] = y; p[o + 8] = z1 + nz;
    p[o + 9] = x1 - nx; p[o + 10] = y; p[o + 11] = z1 - nz;
    const u = this.uv, q = i * 8, v1 = v0 + L / 1.4;
    u[q] = 0; u[q + 1] = v0; u[q + 2] = 1; u[q + 3] = v0; u[q + 4] = 0; u[q + 5] = v1; u[q + 6] = 1; u[q + 7] = v1;
    const al = this.al, r = i * 4;
    al[r] = al[r + 1] = a * 0.85; al[r + 2] = al[r + 3] = a;
    this.lo = Math.min(this.lo, i);
    this.hi = Math.max(this.hi, i);
    this.dirty = true;
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    const P = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const U = this.geo.getAttribute('uv') as THREE.BufferAttribute;
    const A = this.geo.getAttribute('aA') as THREE.BufferAttribute;
    const lo = this.lo, n = this.hi - this.lo + 1;
    P.clearUpdateRanges(); P.addUpdateRange(lo * 12, n * 12); P.needsUpdate = true;
    U.clearUpdateRanges(); U.addUpdateRange(lo * 8, n * 8); U.needsUpdate = true;
    A.clearUpdateRanges(); A.addUpdateRange(lo * 4, n * 4); A.needsUpdate = true;
    this.lo = Infinity;
    this.hi = -1;
    this.geo.setDrawRange(0, this.used * 6);
  }

  clear() {
    this.used = this.head = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

// ------------------------------------------------------------------ heat haze

const HAZE_VS = /* glsl */ `
attribute vec4 iA; // pos, size
attribute vec4 iB; // strength, seed, rise speed, stretch (vertical)
varying vec2 vUv; varying vec4 vB;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 p = iA.xyz + (right * position.x + up * position.y * iB.w) * iA.w;
  vUv = position.xy * 2.0;
  vB = iB;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const HAZE_FS = /* glsl */ `
uniform float uTime;
varying vec2 vUv; varying vec4 vB;
${GLSL_NOISE}
void main() {
  float r = length(vUv);
  float fall = (1.0 - smoothstep(0.2, 1.0, r));
  vec2 q = vUv * 2.6 + vec2(vB.y, -uTime * vB.z);
  vec2 off = vec2(fbm3(q) - 0.5, fbm3(q + 5.2) - 0.5) * 2.0 * fall * vB.x;
  gl_FragColor = vec4(max(off, 0.0), max(-off, 0.0));
}`;
const DISTORT_FS = /* glsl */ `
uniform sampler2D tDiffuse; uniform sampler2D tHaze; uniform float uAmount;
varying vec2 vUv;
void main() {
  vec4 h = texture2D(tHaze, vUv);
  vec2 off = clamp((h.rg - h.ba) * uAmount, vec2(-0.003), vec2(0.003));
  gl_FragColor = texture2D(tDiffuse, vUv + off);
}`;

/** Heat-haze post pass: renders haze sprites into a half-res offset buffer, then refracts the frame by it. */
export class HazePass extends Pass {
  readonly scene = new THREE.Scene();
  camera: THREE.Camera | null = null;
  private rt: THREE.WebGLRenderTarget;
  private fs: FullScreenQuad;
  private dmat: THREE.ShaderMaterial;
  readonly hmat: THREE.ShaderMaterial;
  private geo: THREE.InstancedBufferGeometry;
  private A: THREE.InstancedBufferAttribute;
  private B: THREE.InstancedBufferAttribute;
  private n = 0;
  private clearC = new THREE.Color(0, 0, 0);
  constructor(readonly max = 24) {
    super();
    this.rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, type: THREE.UnsignedByteType });
    this.rt.texture.generateMipmaps = false;
    this.dmat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tHaze: { value: this.rt.texture }, uAmount: { value: 0.0035 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: DISTORT_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.fs = new FullScreenQuad(this.dmat);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    quad.dispose();
    this.A = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.B = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iA', this.A);
    this.geo.setAttribute('iB', this.B);
    this.hmat = new THREE.ShaderMaterial({
      vertexShader: HAZE_VS,
      fragmentShader: HAZE_FS,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(this.geo, this.hmat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.enabled = false;
  }
  begin() {
    this.n = 0;
  }
  /** Frames left to run with nothing in it (warm-up: builds the mask + distortion programs at load). */
  warm = 4;
  add(p: THREE.Vector3, size: number, strength: number, stretch = 1.6, rise = 1.4) {
    if (this.n >= this.max || strength <= 0.005) return;
    const o = this.n * 4;
    const A = this.A.array as Float32Array, B = this.B.array as Float32Array;
    A[o] = p.x; A[o + 1] = p.y; A[o + 2] = p.z; A[o + 3] = size;
    B[o] = strength; B[o + 1] = (this.n * 3.7) % 11; B[o + 2] = rise; B[o + 3] = stretch;
    this.n++;
  }
  end(t: number) {
    this.hmat.uniforms.uTime.value = t;
    this.geo.instanceCount = this.n;
    for (const at of [this.A, this.B]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * 4);
      at.needsUpdate = true;
    }
    if (this.warm > 0) {
      this.warm--;
      if (this.n === 0) {
        this.geo.instanceCount = parkInstance(this.A.array as Float32Array, this.B.array as Float32Array, null);
        this.A.needsUpdate = this.B.needsUpdate = true;
      }
      this.enabled = !!this.camera;
      return;
    }
    this.enabled = this.n > 0 && !!this.camera;
  }
  setSize(w: number, h: number) {
    this.rt.setSize(Math.max(4, Math.floor(w / 2)), Math.max(4, Math.floor(h / 2)));
  }
  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    if (!this.camera) return;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevA = renderer.getClearAlpha();
    const auto = renderer.autoClear;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(this.clearC, 0);
    renderer.clear(true, false, false);
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
    renderer.setClearColor(prevClear, prevA);
    this.dmat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear && !this.renderToScreen) renderer.clear();
    this.fs.render(renderer);
  }
  dispose() {
    this.rt.dispose();
    this.dmat.dispose();
    this.hmat.dispose();
    this.geo.dispose();
    this.fs.dispose();
  }
}

// ------------------------------------------------------------------ per-car state

interface CarFx {
  jets: FlameJet[];
  /** Tip index per jet: up to 4 jets spread across every fitted tip (both sides of a quad / 8-tip exhaust). */
  tips: number[];
  lastL: THREE.Vector3 | null;
  lastR: THREE.Vector3 | null;
  vL: number; // rubber texture offsets
  vR: number;
  burnPatchT: number;
  brake: number;
  popT: number; // limiter pop timer
  launchedAt: number;
  lastV: number;
}

const SMOKE_TYRE: SmokeKind = { tint: [0.86, 0.86, 0.88] };
const SMOKE_EXH: SmokeKind = { tint: [0.6, 0.59, 0.6] };
const SMOKE_PURGE: SmokeKind = { tint: [0.95, 0.98, 1.05], glow: 0.06 }; // glow > 0 also exempts it from the thinning
const SMOKE_OIL: SmokeKind = { tint: [0.07, 0.06, 0.05] };
const SMOKE_DUST: SmokeKind = { tint: [0.55, 0.5, 0.44] };
const SMOKE_VEIL: SmokeKind = { tint: [0.95, 0.87, 0.74] }; // gust dust: pale, catches the stadium light
const C_FLAME = new THREE.Color(1.0, 0.45, 0.12);
const C_NOS = new THREE.Color(0.3, 0.55, 1.0);
const C_TAIL = new THREE.Color(1.0, 0.06, 0.03);
const C_CORE = new THREE.Color(0.9, 0.95, 1.0);
const C_NOS_CORE = new THREE.Color(0.55, 0.75, 1.0);
const C_SPARK = [1.0, 0.72, 0.32] as const;

interface LightReq { p: THREE.Vector3; c: THREE.Color; k: number; range: number }

// ------------------------------------------------------------------ RaceFx3D

export class RaceFx3D {
  readonly group = new THREE.Group();
  /** Insert after the RenderPass: composer.insertPass(fx.hazePass, 1). Null on 'low'. */
  readonly hazePass: HazePass | null;
  readonly quality: Quality;
  /** Global multipliers for tuning against the final lighting. */
  readonly tune = { smokeBright: 1, smokeAlpha: 1, flame: 1, light: 1 };

  private q: QCfg;
  private scene: THREE.Scene;
  private smoke: Smoke;
  private lines: Lines;
  private glows: Glows;
  private rubber: Rubber;
  private flameGeo: THREE.BufferGeometry;
  private lights: THREE.PointLight[] = [];
  /** Flame jets made up front (2 cars x 4 tips) and handed out per car: none is ever created mid-race. */
  private jetPool: FlameJet[] = [];
  private cars = new Map<FxCar, CarFx>();
  private cam: THREE.Camera | null = null;
  private camPrev = V();
  private camVel = V();
  private t = 0;
  private keyLight: THREE.DirectionalLight | null;
  private ambient = new THREE.Color(0.18, 0.2, 0.26);
  private tmp2C = new THREE.Color();
  private lookT = -1;
  private lightReqs: LightReq[] = [];
  private seen = new Set<string>();
  private gradesSeen = 0;
  private wasNitro = false;
  private wasPhase = '';
  private ghostV0 = 0;
  private ghostLaunched = false;
  private streakAcc = 0;
  private veilAcc = 0;
  private view: CineView | null = null;
  private tmp = V();
  private tmp2 = V();
  private tmp3 = V();
  private q4 = new THREE.Quaternion();

  constructor(scene: THREE.Scene, quality: Quality = 'high', opts: RaceFxOpts = {}) {
    this.scene = scene;
    this.quality = quality;
    this.q = QUALITY[quality] ?? QUALITY.high;
    this.smoke = new Smoke(this.q.smoke);
    if (opts.lightAt) this.smoke.lightAt = opts.lightAt;
    this.lines = new Lines(this.q.lines);
    this.glows = new Glows(this.q.glows + 8);
    this.rubber = new Rubber(this.q.rubber);
    // flame quad: 8 segments along, 2 across
    this.flameGeo = new THREE.PlaneGeometry(1, 2, 8, 2);
    this.flameGeo.translate(0.5, 0, 0);
    for (let i = 0; i < 8; i++) this.jetPool.push(this.newJet());
    for (let i = 0; i < this.q.lights; i++) {
      const l = new THREE.PointLight(0xff8040, 0, 7, 2);
      l.castShadow = false;
      l.name = 'fx:light';
      this.lights.push(l);
      this.group.add(l);
    }
    this.group.name = 'fx';
    this.group.add(this.rubber.mesh, this.smoke.mesh, this.glows.mesh, this.lines.mesh);
    // one invisible mark far off the strip so the rubber program is built (and drawn) from frame one
    this.rubber.lay(-1000, 0, -999.5, 0, 0.1, 0, 0);
    this.rubber.flush();
    scene.add(this.group);
    this.hazePass = this.q.haze ? new HazePass(24) : null;
    this.keyLight = opts.keyLight ?? null;
  }

  // ---------------------------------------------------------------- per-car helpers

  private newJet(): FlameJet {
    const j = new FlameJet(this.flameGeo, rnd() * 10);
    this.group.add(j.mesh);
    return j;
  }

  /**
   * Optional: build every FX program now (call once after the scene is assembled, before the first frame). The
   * instanced systems and flame jets also stay drawn at zero intensity, so nothing compiles on first use.
   */
  warmup(renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
    renderer.compile(this.scene, camera);
    if (this.hazePass) renderer.compile(this.hazePass.scene, camera);
  }

  private carFx(car: FxCar): CarFx {
    let c = this.cars.get(car);
    if (!c) {
      const nTips = Math.max(1, car.exhaustCount ?? car.build?.anchors?.exhausts?.length ?? 1);
      const nEx = Math.min(4, nTips);
      const jets: FlameJet[] = [];
      const tips: number[] = [];
      for (let i = 0; i < nEx; i++) {
        jets.push(this.jetPool.pop() ?? this.newJet());
        tips.push(nEx === 1 ? 0 : Math.round((i * (nTips - 1)) / (nEx - 1)));
      }
      c = { jets, tips, lastL: null, lastR: null, vL: rnd() * 5, vR: rnd() * 5, burnPatchT: 0, brake: 0, popT: 0, launchedAt: -1, lastV: 0 };
      this.cars.set(car, c);
    }
    return c;
  }

  /** World position + direction of jet i's tip (jets map onto tips spread across both sides). */
  private exhaust(car: FxCar, jet: number, outP: THREE.Vector3, outD: THREE.Vector3) {
    const tips = this.cars.get(car)?.tips;
    const i = tips ? tips[jet % tips.length] : jet;
    const ex = car.build?.anchors?.exhausts;
    const L = car.build?.dims?.length ?? 4.6;
    if (car.exhaustWorld && car.exhaustCount !== undefined) {
      car.exhaustWorld(i, outP);
      if (car.exhaustDirWorld) return car.exhaustDirWorld(i, outD), outP;
    } else if (car.exhaustWorld && ex && ex.length) car.exhaustWorld(i % ex.length, outP);
    else if (ex && ex.length) car.root.localToWorld(outP.copy(ex[i % ex.length].pos));
    else car.root.localToWorld(outP.set(-L / 2, 0.32, -0.4));
    const d = ex?.[i % Math.max(1, ex?.length ?? 1)]?.dir;
    car.root.getWorldQuaternion(this.q4);
    outD.copy(d ?? this.tmp3.set(-1, 0, 0)).applyQuaternion(this.q4).normalize();
    return outP;
  }

  private contact(car: FxCar, side: 'L' | 'R', out: THREE.Vector3) {
    if (car.rearContactWorld) return car.rearContactWorld(side, out);
    const a = side === 'L' ? car.build?.anchors?.wheelRL : car.build?.anchors?.wheelRR;
    const L = car.build?.dims?.length ?? 4.6;
    const W = car.build?.dims?.width ?? 1.9;
    if (a) return car.root.localToWorld(out.set(a.x, 0, a.z));
    return car.root.localToWorld(out.set(-L * 0.3, 0, (side === 'L' ? 1 : -1) * W * 0.42));
  }

  private rearWheelR(car: FxCar) {
    return car.build?.dims?.wheelR ?? 0.33;
  }

  // ---------------------------------------------------------------- emitters

  /**
   * Tyre smoke at a rear contact patch. k ~ particles to emit (fractional = probability). In the burnout (big = 1)
   * the clouds are big and long-lived so the cars launch through their tail; at speed the puffs are bigger,
   * fainter, faster-growing and shorter-lived so they smear into a trail instead of a chain of popcorn.
   */
  private tyreSmoke(car: FxCar, side: 'L' | 'R', k: number, carV: number, big: number) {
    const p = this.contact(car, side, this.tmp);
    const sgn = side === 'L' ? 1 : -1;
    const r = this.rearWheelR(car);
    const fast = carV > 12;
    const sizeK = fast ? 1 + carV / 35 : 1;
    const alphaK = fast ? clamp(12 / carV, 0.35, 1) : 1;
    const burnout = big >= 1 && carV < 3;
    for (; k > 0; k--) {
      if (k < 1 && rnd() > k) break;
      const size = rr(0.45, 0.85) * (0.8 + big * 0.6) * sizeK;
      const grow = rr(1.1, 2.2) * (0.8 + big * 0.7) * (fast ? 1.5 : 1);
      const life = burnout ? rr(3.5, 5.5) : rr(1.6, 2.8) * (0.75 + big * 0.35) * (fast ? 0.6 : 1);
      this.smoke.emit(
        p.x - r * rr(0.4, 1.1), r * rr(0.25, 0.9), p.z + sgn * rr(-0.05, 0.25),
        carV * rr(0.15, 0.35) - rr(0.6, 2.6) * (0.6 + big), rr(0.25, 1.1), sgn * rr(0.1, 1.4) * (0.5 + big),
        size, grow, life, rr(0.32, 0.55) * alphaK * (burnout ? 0.75 : 1) * this.tune.smokeAlpha, SMOKE_TYRE,
        burnout ? rr(0.3, 0.5) : rr(0.3, 0.75) * (0.6 + big * 0.5), burnout ? 2.0 : 1.1, burnout ? 0.55 : 0.42,
      );
    }
  }

  private launchPlume(car: FxCar, k: number) {
    const n = Math.round(clamp(6 * k, 3, 14) * (0.5 + this.q.rate * 0.5));
    for (const side of ['L', 'R'] as const) {
      const p = this.contact(car, side, this.tmp2);
      const sgn = side === 'L' ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const a = rr(-0.4, 1.4);
        this.smoke.emit(
          p.x - rr(0.1, 0.8), rr(0.15, 0.5), p.z + sgn * rr(0, 0.3),
          -rr(1.5, 5) * Math.cos(a), rr(0.3, 1.6), sgn * rr(1.2, 5.5) * Math.sin(a + 0.5),
          rr(0.5, 1.0), rr(2.2, 3.6), rr(1.6, 2.8), rr(0.25, 0.45) * this.tune.smokeAlpha, SMOKE_TYRE, rr(0.25, 0.6), 1.9,
        );
      }
    }
  }

  /** Smoke rolling right past the lens (launch): only when the camera sits near the rear wheels. */
  private lensSmoke(car: FxCar, k: number) {
    const cam = this.cam;
    if (!cam) return;
    const p = this.contact(car, 'L', this.tmp);
    const d = cam.position.distanceTo(p);
    if (d > 7.5 || cam.position.y > 2.2) return;
    const fwd = this.tmp2.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = this.tmp3.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const n = Math.round(2 + 2 * k);
    for (let i = 0; i < n; i++) {
      const dist = rr(1.3, 2.8);
      const sx = rr(-1.4, 1.4);
      const x = cam.position.x + fwd.x * dist + right.x * sx;
      const z = cam.position.z + fwd.z * dist + right.z * sx;
      const y = Math.max(0.25, cam.position.y + rr(-0.35, 0.25));
      this.smoke.emit(x, y, z, right.x * -sx * 0.6 - 1.2, rr(0.1, 0.5), right.z * -sx * 0.6, rr(0.9, 1.6), rr(1.2, 2.2), rr(0.6, 1.1), rr(0.14, 0.24) * this.tune.smokeAlpha, SMOKE_TYRE, 0.2, 1.4);
    }
  }

  private exhaustPuff(car: FxCar, n: number, dark = 1) {
    const c = this.carFx(car);
    for (let j = 0; j < c.jets.length; j++) {
      const p = this.exhaust(car, j, this.tmp, this.tmp2);
      for (let i = 0; i < n; i++) {
        this.smoke.emit(
          p.x + this.tmp2.x * 0.1, p.y, p.z + this.tmp2.z * 0.1,
          this.tmp2.x * rr(1.2, 3) + rr(-0.3, 0.3), rr(0.1, 0.6), this.tmp2.z * rr(1.2, 3) + rr(-0.3, 0.3),
          rr(0.18, 0.32), rr(0.8, 1.5), rr(0.8, 1.6), rr(0.35, 0.55) * dark, SMOKE_EXH, 0.4, 2,
        );
      }
    }
  }

  private sparks(p: THREE.Vector3, n: number, vx: number, spread = 1, dirX = -1) {
    for (let i = 0; i < n; i++) {
      this.lines.emit(
        LK.Spark, p.x, Math.max(0.03, p.y), p.z,
        vx + dirX * rr(1, 6) * spread, rr(0.5, 3.5) * spread, rr(-2.2, 2.2) * spread,
        rr(0.25, 0.6), rr(0.008, 0.014), C_SPARK[0] * 6, C_SPARK[1] * 6, C_SPARK[2] * 6, 1, 0.022,
      );
    }
  }

  /** Nitrous purge: a fast, thin white vapour jet out of each side of the nose, a little mist where it dies. */
  private purge(car: FxCar) {
    const a = car.build?.anchors;
    const L = car.build?.dims?.length ?? 4.6;
    const src = a?.frontBumper ?? a?.hood ?? new THREE.Vector3(L / 2, 0.4, 0);
    const p = car.root.localToWorld(this.tmp.copy(src));
    const n = Math.round(30 * (0.5 + this.q.rate * 0.5));
    for (const s of [-1, 1]) {
      for (let i = 0; i < n; i++) {
        // a 45 deg cone up and out, slightly forward
        const sp = rr(10, 16), u = rr(-0.38, 0.38), w = rr(-0.38, 0.38);
        const dy = Math.cos(u), dxz = Math.sin(u);
        this.smoke.emit(p.x + rr(-0.05, 0.1), p.y + 0.1, p.z + s * 0.4, (0.35 + w * 0.5) * sp * 0.6, dy * sp, s * (0.25 + dxz) * sp * 0.5, rr(0.14, 0.24), rr(0.9, 1.5), rr(0.5, 0.85), rr(0.65, 0.85), SMOKE_PURGE, -0.5, 2.4, 0.42, true);
      }
      // bright vapour streaks that shoot up past the roofline
      for (let i = 0; i < 10; i++) this.lines.emit(LK.Dust, p.x, p.y + 0.1, p.z + s * 0.4, rr(1, 4), rr(11, 17), s * rr(1, 4), rr(0.3, 0.5), 0.035, 1.2, 1.25, 1.35, 1.0, 0.05);
      for (let i = 0; i < 3; i++) this.smoke.emit(p.x + rr(0, 0.5), p.y + rr(1.6, 2.6), p.z + s * rr(0.6, 1.2), rr(-0.5, 0.5), rr(0.5, 1.2), s * rr(0.2, 0.8), rr(0.5, 0.8), 1.6, rr(0.8, 1.3), 0.25, SMOKE_PURGE, 0.1, 1.5, 0.42, true);
    }
  }

  /** Oil flung off a spinning tyre: tiny dark droplets carried along at near car speed (never a blob in the lens). */
  private oilSplash(car: FxCar, n: number) {
    const p = this.contact(car, rnd() < 0.5 ? 'L' : 'R', this.tmp);
    const v = this.view?.state.v ?? 0;
    for (let i = 0; i < n; i++) {
      const big = rnd() < 0.2;
      this.smoke.emit(p.x - 0.3, rr(0.1, 0.4), p.z + rr(-0.1, 0.1), v * 0.85 - rr(0.5, 2), rr(1, 2.6), rr(-0.8, 0.8), big ? rr(0.08, 0.12) : rr(0.03, 0.06), big ? 0.06 : 0.03, rr(0.35, 0.6), 0.9, SMOKE_OIL, -6, 0.6);
    }
  }

  /** Backfire / limiter pop: a flame spike, a white flash, a flicker of light, dark smoke and a few sparks. */
  private pop(car: FxCar, k = 1) {
    const c = this.carFx(car);
    for (const j of c.jets) j.pop = Math.max(j.pop, clamp(k * rr(0.75, 1.1), 0, 1.3));
    if (rnd() < 0.6) this.exhaustPuff(car, 1, 0.8);
    if (k > 0.6) {
      const p = this.exhaust(car, 0, this.tmp, this.tmp2);
      this.sparks(p, Math.round(2 + 3 * k), (this.view?.state.v ?? 0) * 0.6, 0.6);
    }
  }

  // ---------------------------------------------------------------- events

  onEvent(e: CineEvent) {
    const v = this.view;
    if (!v) return;
    const once = ['launch', 'shift', 'nitro', 'nitroEnd', 'finish', 'burnout', 'purge'];
    const key = e.kind === 'shift' ? `shift${e.gear ?? 0}` : e.kind === 'purge' ? `purge${this.t.toFixed(1)}` : e.kind;
    if (once.includes(e.kind)) {
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    const car = (e.who === 'ghost' ? v.ghost : v.player) as FxCar | null | undefined;
    if (!car) return;
    const c = this.carFx(car);
    const smokeK = clamp(v.smokeK ?? 1, 0.6, 2.4);
    switch (e.kind) {
      case 'burnout':
        this.pop(car, 1);
        for (const j of c.jets) j.burst = Math.max(j.burst, 0.16);
        break;
      case 'launch': {
        c.launchedAt = this.t;
        const k = smokeK * (v.state.wheelspin ? 1.4 : 1);
        this.launchPlume(car, k);
        this.lensSmoke(car, k);
        if (this.flamesOn(e.who)) for (const j of c.jets) { j.burst = Math.max(j.burst, 0.2); j.burstLen = 0.2; }
        else this.exhaustPuff(car, 2);
        break;
      }
      case 'shift': {
        // tuned / boss cars spit flame on a shift (and anything on a miss: the scene folds that into view.flames);
        // an economy car just puffs
        this.exhaustPuff(car, 2);
        if (!this.flamesOn(e.who)) break;
        const ms = e.grade === 'perfect' ? 0.22 : 0.15;
        for (const j of c.jets) { j.burst = Math.max(j.burst, ms); j.burstLen = ms; }
        if (e.grade !== 'perfect') this.pop(car, 0.8);
        else this.sparks(this.exhaust(car, 0, this.tmp, this.tmp2), 6, v.state.v * 0.7, 0.8);
        break;
      }
      case 'flame': {
        const ms = (e.ms ?? 160) / 1000;
        for (const j of c.jets) { j.burst = Math.max(j.burst, ms); j.burstLen = Math.max(j.burstLen, ms); }
        break;
      }
      case 'backfire':
      case 'limiter':
        this.pop(car, e.kind === 'limiter' ? 0.75 : 1);
        break;
      case 'exhaustPuff':
        this.exhaustPuff(car, Math.max(1, Math.round((e.n ?? e.n2 ?? 2) / 2)));
        break;
      case 'sparks':
        this.sparks(this.exhaust(car, 0, this.tmp, this.tmp2), e.n ?? e.n2 ?? 6, v.state.v * 0.7, 0.8);
        break;
      case 'flutter': {
        const a = car.build?.anchors;
        const p = car.root.localToWorld(this.tmp.copy(a?.hood ?? new THREE.Vector3(1, 1, 0)));
        for (let i = 0; i < 3; i++) this.smoke.emit(p.x, p.y + 0.1, p.z + rr(-0.3, 0.3), rr(-1, 1) + v.state.v * 0.6, rr(1, 2.5), rr(-1, 1), 0.15, 0.9, 0.6, 0.3, SMOKE_PURGE, 0.2, 2.5);
        break;
      }
      case 'purge':
        this.purge(car);
        break;
      case 'oil':
        this.oilSplash(car, 8);
        break;
      case 'gust': {
        const P = car.root.position;
        for (let i = 0; i < 18; i++) this.lines.emit(LK.Dust, P.x + rr(-6, 14), rr(0.05, 0.8), P.z + rr(-4, 4), rr(-2, 2), rr(0, 0.6), rr(5, 9) * (e.strength ?? 1), rr(0.6, 1.2), 0.012, 0.5, 0.46, 0.4, 0.35, 0.05);
        break;
      }
      default:
        break;
    }
  }

  /** Whether this car's build spits flame on shifts / launch (the scene's view.flames; default: yes). */
  private flamesOn(who?: 'player' | 'ghost') {
    const f = this.view?.flames;
    if (!f) return true;
    return who === 'ghost' ? f.ghost : f.player;
  }

  /** Same auto-derivation as the director: sim-visible events fire even if the scene doesn't send them. */
  private autoEvents(v: CineView) {
    const s = v.state;
    if (v.phase === 'preroll' && this.wasPhase !== 'preroll') this.onEvent({ kind: 'burnout' });
    this.wasPhase = v.phase;
    const gs = s.grades;
    for (; this.gradesSeen < gs.length; this.gradesSeen++) {
      const g = gs[this.gradesSeen];
      if (g.kind === 'launch') this.onEvent({ kind: 'launch', grade: g.grade });
      else if (g.kind === 'shift') this.onEvent({ kind: 'shift', grade: g.grade, gear: g.gear });
    }
    if (s.launched && !this.seen.has('launch')) this.onEvent({ kind: 'launch', grade: 'good' });
    this.wasNitro = s.nitroActive;
    // the ghost: launches at its reaction time, pops through its "gears"
    const gv = v.ghostV ?? 0;
    if (v.ghost) {
      const g = v.ghost as FxCar;
      if (!this.ghostLaunched && gv > 0.05) {
        this.ghostLaunched = true;
        this.carFx(g).launchedAt = this.t;
        this.launchPlume(g, 0.8);
        if (this.flamesOn('ghost')) for (const j of this.carFx(g).jets) j.burst = 0.18;
      }
      for (const th of [15, 26, 37]) if (this.ghostV0 < th && gv >= th) {
        if (this.flamesOn('ghost')) for (const j of this.carFx(g).jets) { j.burst = Math.max(j.burst, 0.16); j.burstLen = 0.16; }
        this.exhaustPuff(g, 1);
      }
    }
    this.ghostV0 = gv;
  }

  // ---------------------------------------------------------------- frame

  /** dt: SIM-scaled seconds (dt * director.slowmo). */
  update(dt: number, camera: THREE.Camera, view: CineView) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    this.view = view;
    this.cam = camera;
    // camera velocity (for streak blur), smoothed
    if (dt > 0) {
      const cv = this.tmp.copy(camera.position).sub(this.camPrev).divideScalar(Math.max(dt, 1e-3));
      if (cv.lengthSq() > 200 * 200) cv.set(0, 0, 0); // a cut: not motion
      this.camVel.lerp(cv, 1 - Math.exp(-dt * 12));
    }
    this.camPrev.copy(camera.position);
    this.autoEvents(view);
    this.findLights();
    this.lightReqs.length = 0;
    this.glows.begin();
    this.hazePass?.begin();

    const s = view.state;
    const P = view.player as FxCar;
    this.driveCar(P, view, dt, true);
    if (view.ghost) this.driveCar(view.ghost as FxCar, view, dt, false);

    // speed streaks: static specks placed in the OUTER band of the frame (8-60 m out, never over the car), blurred
    // into streaks by the camera's own motion; they start early and thicken with speed, blue on nitrous
    const speedK = clamp((s.v - 15) / 35, 0, 1);
    const nitro = s.nitroActive ? 1 : 0;
    this.streakAcc += (speedK * 90 + nitro * 60) * this.q.rate * dt;
    const pc = camera as THREE.PerspectiveCamera;
    const tanV = Math.tan(((pc.fov ?? 50) * Math.PI) / 360);
    const tanH = tanV * (pc.aspect ?? 16 / 9);
    const e = camera.matrixWorld.elements;
    let guard = 0;
    while (this.streakAcc >= 1 && guard++ < 64) {
      this.streakAcc--;
      let nx = rr(-1, 1), ny = rr(-0.9, 0.9);
      if (Math.abs(nx) < 0.6 && Math.abs(ny) < 0.55) {
        if (rnd() < 0.65) nx = (nx < 0 ? -1 : 1) * rr(0.6, 1);
        else ny = (ny < 0 ? -1 : 1) * rr(0.55, 0.9);
      }
      const d = rr(8, 60);
      const wx = e[12] - e[8] * d + e[0] * nx * d * tanH + e[4] * ny * d * tanV;
      const wy = e[13] - e[9] * d + e[1] * nx * d * tanH + e[5] * ny * d * tanV;
      const wz = e[14] - e[10] * d + e[2] * nx * d * tanH + e[6] * ny * d * tanV;
      if (wy < 0.03 || wy > 3.5 || Math.abs(wz) > 5.7) continue; // the strip and walls, not the sky
      const nos = nitro > 0 && rnd() < 0.6;
      const w = (0.0035 + rnd() * 0.004) * d * 0.25;
      if (nos) this.lines.emit(LK.Streak, wx, wy, wz, 0, 0, 0, rr(0.3, 0.5), w, 0.6, 0.95, 2.2, 0.5, 0.06);
      else this.lines.emit(LK.Streak, wx, wy, wz, 0, 0, 0, rr(0.35, 0.7), w, 1.0, 0.95, 0.85, 0.35, 0.06);
    }

    // wind: a slow ambient drift, plus the gust's headwind (it blows down the strip against the cars)
    const g = view.gust ?? 0;
    // a gust you can see: a dust veil blowing across the lane ahead
    if (g > 0.3) {
      // spread ahead by speed so the veil stays in view about a second as the car drives into it
      const vv = s.v;
      this.veilAcc += 50 * g * this.q.rate * dt;
      for (; this.veilAcc >= 1; this.veilAcc--) {
        // born on the outer side, the crosswind sweeps it across the player's lane toward the rival's
        const side = Math.sign(P.root.position.z) || 1;
        this.smoke.emit(P.root.position.x + rr(8, 12 + vv * 1.1), rr(0.3, 1.4), P.root.position.z + side * rr(-1.5, 2.6), -6 * g, rr(0, 0.3), -side * rr(2.5, 4.5), rr(2.6, 4.4), 1.2, rr(1, 1.6), rr(0.3, 0.42), SMOKE_VEIL, 0, 0.4, 0.35);
      }
    }
    this.smoke.wind.set(-0.3 - g * 7, 0, -0.6 - g * 1.0 * (Math.sign(P.root.position.z) || 1));

    this.carOnScreen(P, camera);
    this.smoke.update(dt, this.t, camera);
    this.lines.update(dt, this.camVel, camera.position.x, this.smoke.wind);
    this.rubber.flush();
    this.applyLights();
    this.glows.end();
    if (this.hazePass) {
      this.hazePass.camera = camera;
      this.hazePass.end(this.t);
    }
  }

  private driveCar(car: FxCar, v: CineView, dt: number, isPlayer: boolean) {
    const c = this.carFx(car);
    const s = v.state;
    const q = this.q;
    const smokeK = clamp(v.smokeK ?? 1, 0.6, 2.4);
    const carV = isPlayer ? s.v : v.ghostV ?? 0;
    const launched = isPlayer ? s.launched : (v.ghostV ?? 0) > 0.05;
    const sinceLaunch = c.launchedAt >= 0 ? this.t - c.launchedAt : -1;
    const burn = isPlayer ? v.burn ?? 0 : 0;
    const spin = isPlayer && launched && s.phase === 'running' && (s.wheelspin || !!v.oilSpin);

    // ---- tyre smoke (rates per second, scaled by quality)
    let rate = 0;
    let big = 0;
    if (isPlayer) {
      if (burn > 0) { rate = 34 * burn; big = 1; }
      else if (spin) { rate = 26; big = 0.55; }
      else if (sinceLaunch >= 0 && sinceLaunch < 0.4 && carV < 14) { rate = 30 * (1 - sinceLaunch / 0.4); big = 0.7; }
      // the scene's 2D-equivalent rate already includes smokeK
      if (v.smoke !== undefined && !(burn > 0)) rate = Math.max(rate * 0.5, (v.smoke / smokeK) * 34);
    } else if (sinceLaunch >= 0 && sinceLaunch < 0.3) { rate = 14 * (1 - sinceLaunch / 0.3); big = 0.4; }
    rate *= smokeK * q.rate * (carV > 12 ? 2 : 1);
    if (rate > 0) {
      this.tyreSmoke(car, 'L', rate * dt, carV, big);
      this.tyreSmoke(car, 'R', rate * dt, carV, big);
    }

    // ---- rubber
    let rub = 0;
    if (isPlayer) {
      if (v.rubber !== undefined) rub = v.rubber;
      else if (v.phase === 'preroll') rub = burn > 0.3 ? 0.35 : 0;
      else if (spin) rub = 0.6;
      else if (sinceLaunch >= 0 && sinceLaunch < 0.7) rub = 0.55 * (1 - sinceLaunch / 0.7);
    } else if (sinceLaunch >= 0 && sinceLaunch < 0.45) rub = 0.4 * (1 - sinceLaunch / 0.45);
    this.layRubber(car, c, rub, burn, dt);

    // ---- exhaust: idle puffs on the line, flames, nitrous
    const rpm = isPlayer ? s.rpm : 0.5;
    if (isPlayer && !launched && (rpm > 0.35 || burn > 0) && rnd() < (0.6 + burn * 4) * dt) this.exhaustPuff(car, 1, 0.28);
    if (isPlayer && s.limiter && s.phase === 'running') {
      c.popT -= dt;
      if (c.popT <= 0) {
        c.popT = 0.13;
        this.pop(car, 0.75);
      }
    }
    if (isPlayer && burn > 0.6 && rnd() < dt * 2.2) this.pop(car, 0.7);
    const nitro = isPlayer && s.nitroActive;
    this.updateJets(car, c, dt, nitro, carV);

    // ---- wheelie bar / bumper scraping: sparks
    const scrape = isPlayer ? num(v.scrape) : 0;
    if (scrape > 0) {
      const p = this.tmp;
      const L = car.build?.dims?.length ?? 4.6;
      if (!car.wheelieBarWorld?.(p)) car.root.localToWorld(p.set(-L / 2 - 0.35, 0.03, 0));
      p.y = 0.03;
      const n = Math.min(8, Math.floor(110 * scrape * dt + rnd()));
      for (let i = 0; i < n; i++) {
        this.lines.emit(LK.Spark, p.x + rr(-0.05, 0.05), 0.03, p.z + rr(-0.25, 0.25), carV * rr(0.55, 0.85) - rr(2, 6), rr(0.6, 3.2), rr(-2.5, 2.5), rr(0.25, 0.55), rr(0.008, 0.013), 6, 4.4, 2, 1, 0.022);
      }
      this.lightReqs.push({ p: p.clone().setY(0.15), c: C_FLAME, k: 0.25 * scrape, range: 3 });
      this.glows.add(p, 0.8, C_FLAME, 0.35 * scrape, true);
    }

    // ---- dust off the tyres at speed
    const dust = isPlayer ? v.dust ?? clamp((carV - 38) / 30, 0, 0.7) : 0;
    if (dust > 0 && s.phase === 'running' && rnd() < dust * 22 * dt * q.rate) {
      const p = this.contact(car, rnd() < 0.5 ? 'L' : 'R', this.tmp);
      this.smoke.emit(p.x - 0.4, 0.2, p.z, carV * 0.45, rr(0.2, 0.6), rr(-0.5, 0.5), rr(0.25, 0.45), 1.6, rr(0.6, 1.0), 0.16, SMOKE_DUST, 0.1, 2.2);
      for (let i = 0; i < 2; i++) this.lines.emit(LK.Dust, p.x - 0.3, 0.05, p.z, carV * rr(0.5, 0.8), rr(0.5, 2.4), rr(-1.2, 1.2), rr(0.3, 0.6), 0.01, 0.6, 0.55, 0.5, 0.6, 0.03);
    }

    // ---- oil flung off a spinning tyre
    if (isPlayer && (num(v.oilFling) > 0 || v.oilSpin) && rnd() < 30 * dt) this.oilSplash(car, 2);

    // ---- heat haze: exhaust at high rpm, the engine bay in the burnout
    const hp = this.hazePass;
    if (hp && this.cam) {
      const fwd = this.tmp3.set(0, 0, -1).applyQuaternion(this.cam.quaternion);
      // from the front the haze would refract the car body itself: fade it out
      const fromBehind = smooth(-0.35, 0.35, fwd.x);
      let hz = (v.haze !== undefined && isPlayer ? v.haze : launched && s.phase === 'running' && rpm > 0.8 ? 1 : 0) * 0.35;
      if (isPlayer && !launched && (rpm > 0.35 || burn > 0)) hz = 0.2 + burn * 0.15;
      if (!isPlayer) hz = launched && carV > 5 ? 0.25 : 0;
      if (nitro) hz = 0.5;
      hz *= fromBehind;
      if (hz > 0.01) {
        for (let j = 0; j < c.jets.length; j++) {
          const p = this.exhaust(car, j, this.tmp, this.tmp2);
          p.addScaledVector(this.tmp2, 1.0).y += 0.1;
          hp.add(p, 0.45 + (nitro ? 0.2 : 0), hz, 1.3, 1.6);
        }
        if (burn > 0.2) {
          const a = car.build?.anchors?.hood;
          if (a) hp.add(car.root.localToWorld(this.tmp.copy(a)).setY((a.y ?? 1) + 0.45), 1.0, burn * 0.25 * fromBehind, 1.2, 1.0);
        }
      }
    }

    // ---- taillights glow into the smoke (always lit at night, brighter braking)
    const braking = isPlayer ? s.phase === 'finished' && s.v > 0.5 : (v.ghostX ?? 0) > TRACK && carV > 0.5;
    const tl = car.build?.anchors?.taillights;
    if (tl && tl.length) {
      const p = this.tmp.set(0, 0, 0);
      for (const a of tl) p.add(a);
      p.divideScalar(tl.length);
      car.root.localToWorld(p);
      p.x -= 0.5;
      this.lightReqs.push({ p: p.clone(), c: C_TAIL, k: braking ? 0.3 : 0.04, range: 2.2, smokeOnly: true } as LightReq);
    }

    // ---- brake glow (Kit API if present): heats while braking hard, cools slowly
    c.brake = clamp(c.brake + (braking && carV > 8 ? dt / 1.6 : -dt / 5), 0, 1);
    car.setBrakeGlow?.(c.brake);
    c.lastV = carV;
  }

  private updateJets(car: FxCar, c: CarFx, dt: number, nitro: boolean, carV: number) {
    const tier = this.view?.tyres; // build power shows in flame length
    void tier;
    for (let i = 0; i < c.jets.length; i++) {
      const j = c.jets[i];
      j.burst = Math.max(0, j.burst - dt);
      j.pop = Math.max(0, j.pop - dt * 9);
      j.nitro += ((nitro ? 1 : 0) - j.nitro) * (1 - Math.exp(-dt * 10));
      const env = j.burst > 0 ? Math.min(1, j.burst / Math.max(0.05, j.burstLen) * 2.5) : 0;
      const flick = 0.75 + 0.25 * Math.sin(this.t * 63 + i * 2.1) * Math.sin(this.t * 37 + i);
      const petrol = Math.max(env * flick, j.pop);
      const k = Math.max(petrol, j.nitro * (0.85 + 0.15 * flick));
      j.intensity = k;
      if (k <= 0.01) {
        j.idle();
        continue;
      }
      this.exhaust(car, i, j.origin, j.dir);
      // the jets kick up a little; nitrous blasts up and out like zoomie headers, so it reads from the chase cam
      const out = Math.sign(j.origin.z - car.root.position.z) || (i % 2 ? 1 : -1);
      j.dir.y += 0.06 + 0.04 * j.nitro;
      j.dir.z += out * 0.08 * j.nitro;
      j.dir.normalize();
      const len = j.nitro > 0.5 ? rr(0.9, 1.3) : (0.45 + 0.55 * petrol + j.pop * 0.45) * rr(0.85, 1.15);
      const u = j.mat.uniforms;
      u.uLen.value = len;
      u.uWidth.value = j.nitro > 0.5 ? 0.11 : 0.075 + 0.06 * petrol;
      u.uTime.value = this.t;
      u.uNitro.value = j.nitro;
      // looking down the pipe the ribbon foreshortens into a blob: a bright disc (core + halo) stands in for the jet
      let headOn = 0;
      if (this.cam) headOn = Math.abs(this.tmp3.copy(this.cam.position).sub(j.origin).normalize().dot(j.dir));
      // nitrous from straight behind (the chase cam): dim the foreshortened ribbon so it reads as jets, not a lamp
      const nosDim = j.nitro > 0.5 ? 1 - 0.55 * smooth(0.85, 0.98, headOn) : 1;
      u.uI.value = k * (j.nitro > 0.5 ? 7 : 4.5) * nosDim * this.tune.flame;
      // flash at the tip + the head-on disc, ground pool, light
      const col = j.nitro > 0.5 ? C_NOS : C_FLAME;
      const tip = this.tmp.copy(j.origin).addScaledVector(j.dir, len * (0.12 + 0.2 * headOn));
      const fk = k * this.tune.flame;
      if (j.nitro > 0.5) {
        // nitrous seen from the chase cam: a modest blue halo, a small bluish core only when nearly head-on
        // (from the chase cam we look almost straight down the pipes: keep the halo small so it never reads as a lamp)
        this.glows.add(tip, (0.2 + j.pop * 0.45) * (1 + headOn * 0.3), col, fk * (0.6 + j.pop * 2 + headOn * 0.4));
        if (headOn > 0.75) this.glows.add(tip, 0.06, C_NOS_CORE, fk * (headOn - 0.75) * 2);
      } else {
        this.glows.add(tip, (0.22 + j.pop * 0.45) * (1 + headOn * 1.2), col, fk * (1.1 + j.pop * 2 + headOn * 2.2));
        if (headOn > 0.4) this.glows.add(tip, 0.1, C_CORE, fk * (headOn - 0.4) * 6);
      }
      if (i === 0) {
        const g = this.tmp2.copy(j.origin).addScaledVector(j.dir, len * (0.5 + 0.4 * j.nitro));
        this.glows.add(g, 1.1 + j.nitro * 0.9, col, fk * 0.07, true);
        // the jet's light: a flicker on the bumper and strip, not a lamp on the rear panel
        this.lightReqs.push({ p: g.clone().setY(Math.max(0.45, j.origin.y + 0.1)), c: col, k: k * (0.5 + j.pop * 0.6 - j.nitro * 0.2), range: 2.5 });
      }
    }
    // nitrous: a blue pool under the car while it burns
    if (c.jets[0] && c.jets[0].nitro > 0.05) {
      const p = this.tmp.copy(car.root.position);
      p.x -= (car.build?.dims?.length ?? 4.6) * 0.45;
      this.glows.add(p, (car.build?.dims?.length ?? 4.6) * 0.9, C_NOS, c.jets[0].nitro * (0.07 + 0.02 * Math.sin(this.t * 40)), true);
    }
    void carV;
  }

  private layRubber(car: FxCar, c: CarFx, a: number, burn: number, dt: number) {
    const w = 0.24 + (this.view?.tyres === 'pro' ? 0.1 : this.view?.tyres === 'sport' ? 0.06 : this.view?.tyres === 'street' ? 0.03 : 0);
    for (const side of ['L', 'R'] as const) {
      const p = this.contact(car, side, side === 'L' ? this.tmp : this.tmp2);
      const last = side === 'L' ? c.lastL : c.lastR;
      if (a <= 0.01) {
        if (side === 'L') c.lastL = null;
        else c.lastR = null;
        continue;
      }
      if (!last) {
        const v = p.clone();
        if (side === 'L') c.lastL = v;
        else c.lastR = v;
        continue;
      }
      const d = p.x - last.x;
      if (d >= 0.35) {
        const vo = side === 'L' ? c.vL : c.vR;
        this.rubber.lay(last.x, last.z, p.x, p.z, w, clamp(a, 0, 1) * 0.75, vo);
        if (side === 'L') c.vL += d / 1.4;
        else c.vR += d / 1.4;
        last.copy(p);
      }
    }
    // burnout in place: a dark patch builds under the spinning tyres
    if (burn > 0.5) {
      c.burnPatchT -= dt;
      if (c.burnPatchT <= 0) {
        c.burnPatchT = 0.12;
        for (const side of ['L', 'R'] as const) {
          const p = this.contact(car, side, this.tmp);
          this.rubber.lay(p.x - rr(0.5, 0.9), p.z, p.x + rr(0.1, 0.3), p.z, w * 1.05, 0.22, rnd() * 4);
        }
      }
    }
  }

  // ---------------------------------------------------------------- lighting

  /** Pick up the scene's key and ambient light (once a second) for shading the smoke. */
  private findLights() {
    if (this.t - this.lookT < 1 && this.lookT >= 0) return;
    this.lookT = this.t;
    let key: THREE.DirectionalLight | null = this.keyLight;
    const amb = new THREE.Color(0, 0, 0);
    let found = false;
    this.scene.traverse((o) => {
      const l = o as THREE.Light;
      if (!l.isLight || !l.visible) return;
      if ((l as THREE.DirectionalLight).isDirectionalLight && !key) key = l as THREE.DirectionalLight;
      if ((l as THREE.HemisphereLight).isHemisphereLight) {
        const h = l as THREE.HemisphereLight;
        amb.r += (h.color.r * 0.7 + h.groundColor.r * 0.3) * h.intensity;
        amb.g += (h.color.g * 0.7 + h.groundColor.g * 0.3) * h.intensity;
        amb.b += (h.color.b * 0.7 + h.groundColor.b * 0.3) * h.intensity;
        found = true;
      }
      if ((l as THREE.AmbientLight).isAmbientLight) {
        amb.r += l.color.r * l.intensity;
        amb.g += l.color.g * l.intensity;
        amb.b += l.color.b * l.intensity;
        found = true;
      }
    });
    this.keyLight = key;
    if (found) this.ambient.copy(amb);
  }

  private applyLights() {
    const cam = this.cam;
    if (!cam) return;
    const u = this.smoke.mat.uniforms;
    const view = cam.matrixWorldInverse;
    const key = this.keyLight;
    const kd = this.tmp.set(0.3, 1, 0.2);
    const kc = u.uKeyC.value as THREE.Color;
    if (key) {
      key.updateMatrixWorld();
      key.target.updateMatrixWorld();
      kd.setFromMatrixPosition(key.matrixWorld).sub(this.tmp2.setFromMatrixPosition(key.target.matrixWorld)).normalize();
      kc.copy(key.color).multiplyScalar(Math.min(4, key.intensity) * 0.55);
    } else kc.setRGB(1.1, 1.05, 0.98);
    (u.uKeyV.value as THREE.Vector3).copy(kd).transformDirection(view);
    (u.uUpV.value as THREE.Vector3).set(0, 1, 0).transformDirection(view);
    const b = this.tune.smokeBright;
    kc.multiplyScalar(b);
    // the night ambient is blue: desaturate it 60% for the smoke (grey smoke, not lilac)
    const amb = u.uAmb.value as THREE.Color;
    amb.copy(this.ambient);
    const lum = amb.r * 0.2126 + amb.g * 0.7152 + amb.b * 0.0722;
    amb.lerp(this.tmp2C.setRGB(lum, lum, lum), 0.6).multiplyScalar(0.9 * b).addScalar(0.04 * b);
    (u.uStadC.value as THREE.Color).setRGB(1.0, 0.94, 0.85).multiplyScalar(0.9 * b);

    // strongest requests drive the real point lights; the first four also light the smoke
    const reqs = this.lightReqs.sort((a, b2) => b2.k - a.k);
    const PL = u.uPL.value as THREE.Vector4[];
    const PLC = u.uPLC.value as THREE.Color[];
    for (let i = 0; i < 4; i++) {
      const r = reqs[i];
      if (r) {
        PL[i].set(r.p.x, r.p.y, r.p.z, r.range);
        PLC[i].copy(r.c).multiplyScalar(r.k * 0.8 * b);
      } else {
        PL[i].set(0, -100, 0, 1);
        PLC[i].setRGB(0, 0, 0);
      }
    }
    let li = 0;
    for (const r of reqs) {
      if (li >= this.lights.length) break;
      if ((r as LightReq & { smokeOnly?: boolean }).smokeOnly) continue;
      const l = this.lights[li++];
      l.position.copy(r.p);
      l.color.copy(r.c);
      // candela at a metre or so from the strip: keep it a flicker, not a floodlight
      l.intensity = r.k * 0.9 * this.tune.light;
      l.distance = r.range * 1.4;
    }
    for (; li < this.lights.length; li++) this.lights[li].intensity = 0;
  }

  // ---------------------------------------------------------------- lifecycle

  /** Wipe all particles and marks (rerun). */
  reset() {
    this.smoke.clear();
    this.lines.clear();
    this.rubber.clear();
    this.seen.clear();
    this.gradesSeen = 0;
    this.ghostLaunched = false;
    this.ghostV0 = 0;
    for (const c of this.cars.values()) {
      c.lastL = c.lastR = null;
      c.launchedAt = -1;
      c.brake = 0;
      for (const j of c.jets) j.burst = j.pop = j.nitro = 0;
    }
  }

  /** Project the player's car box: the smoke thins over it so the hero car always reads. */
  private carOnScreen(car: FxCar, camera: THREE.Camera) {
    const d = car.build?.dims;
    const L = d?.length ?? 4.6, W = d?.width ?? 1.9, H = d?.height ?? 1.35;
    const P = car.root.position;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const v = this.tmp;
    camera.updateMatrixWorld();
    for (let i = 0; i < 8; i++) {
      v.set(P.x + ((i & 1 ? 1 : -1) * L) / 2, P.y + (i & 2 ? H : 0.05), P.z + ((i & 4 ? 1 : -1) * W) / 2);
      v.applyMatrix4(camera.matrixWorldInverse);
      if (-v.z < 0.1) return this.smoke.setCar(0.5, 0.5, 0, 0, 0);
      v.applyMatrix4(camera.projectionMatrix);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    const dist = camera.position.distanceTo(v.set(P.x, P.y + H * 0.5, P.z));
    this.smoke.setCar((x0 + x1) * 0.25 + 0.5, (y0 + y1) * 0.25 + 0.5, (x1 - x0) * 0.25, (y1 - y0) * 0.25, dist);
  }

  /** Stats for the dev page / perf report. */
  stats() {
    return { smoke: this.smoke.n, lines: this.lines.n, rubberMax: this.rubber.max, lights: this.lights.length, haze: !!this.hazePass?.enabled };
  }

  dispose() {
    this.scene.remove(this.group);
    for (const c of this.cars.values()) for (const j of c.jets) j.mat.dispose();
    for (const j of this.jetPool) j.mat.dispose();
    this.cars.clear();
    this.flameGeo.dispose();
    this.smoke.dispose();
    this.lines.dispose();
    this.glows.dispose();
    this.rubber.dispose();
    for (const l of this.lights) l.dispose();
    this.hazePass?.dispose();
  }
}
