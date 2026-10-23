// Cutscene look + juice: soft-banded glossy toon materials (rim light, specular, shadow tint driven by the
// Stage's Look), screen-space inverted-hull outlines, pooled particles.
// The Modeler may call toonMat()/outline() directly; toonify() converts anything else at load time.
import * as THREE from 'three';

// ---------- toon shading ----------

let gradient: THREE.DataTexture | null = null;

/**
 * A soft-banded light ramp (v3 "candy" look): `steps` are the band levels, each band edge is a short
 * smooth blend instead of a hard pixel step. 64 texels, linear-filtered.
 */
export function softRamp(steps: number[] = [0.3, 0.52, 0.76, 1], soft = 0.07): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N);
  const n = steps.length;
  for (let i = 0; i < N; i++) {
    const x = i / (N - 1);
    let v = steps[0];
    for (let b = 1; b < n; b++) {
      const edge = b / n;
      const k = clamp01((x - edge + soft) / (2 * soft));
      const s = k * k * (3 - 2 * k);
      v += (steps[b] - steps[b - 1]) * s;
    }
    data[i] = Math.round(clamp01(v) * 255);
  }
  const t = new THREE.DataTexture(data, N, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** The shared light ramp: 4 soft bands (shadow, low, mid, lit). */
export function toonRamp(): THREE.DataTexture {
  if (gradient) return gradient;
  gradient = softRamp();
  return gradient;
}

/**
 * Global look uniforms shared by every toon material (fx + kit): two screen-side rim colours (A = left
 * edges, B = right edges and tops), rim strength, a global specular multiplier and a shadow tint. The Stage
 * writes them from the current Look (warmSweet / harshJerk) every frame.
 */
export const LOOK_U = {
  uRimA: { value: new THREE.Color(0xb6a8ff) },
  uRimB: { value: new THREE.Color(0xffd2a8) },
  uRimI: { value: 0.45 },
  uSpecI: { value: 1 },
  uShade: { value: new THREE.Color(0x5a4a8a) },
  uShadeI: { value: 0.25 },
};

export interface GlossOpts {
  /** Specular highlight strength (0 = matte, 0.4 = default soft sheen, 1 = candy/car-paint gloss). */
  gloss?: number;
  /** Highlight tightness (Blinn exponent, default 48; higher = smaller, sharper highlight). */
  shine?: number;
  /** Fresnel rim multiplier (default 1). */
  rim?: number;
}

/**
 * Patches a MeshToonMaterial with the v3 look: a toon-stepped glossy specular from the key light (soft-edged
 * blob, cartoon car-paint style), a two-colour screen-side fresnel rim, and a cool shadow tint. Idempotent.
 */
export function applyLook<T extends THREE.MeshToonMaterial>(m: T, o: GlossOpts = {}): T {
  if (m.userData.look) return m;
  const local = { uGloss: { value: o.gloss ?? 0.4 }, uShine: { value: o.shine ?? 48 }, uRimK: { value: o.rim ?? 1 } };
  m.userData.look = local;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, LOOK_U, local);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `uniform vec3 uRimA; uniform vec3 uRimB; uniform float uRimI; uniform float uSpecI;
uniform vec3 uShade; uniform float uShadeI; uniform float uGloss; uniform float uShine; uniform float uRimK;
void main() {`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `{
  vec3 V = normalize(vViewPosition);
  vec3 N = normalize(normal);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float lit = 1.0;
  #if NUM_DIR_LIGHTS > 0
    vec3 L = directionalLights[0].direction;
    vec3 H = normalize(L + V);
    float ndl = dot(N, L);
    lit = smoothstep(-0.1, 0.35, ndl);
    float sp = pow(max(dot(N, H), 0.0), uShine);
    sp = smoothstep(0.42, 0.62, sp) + 0.25 * smoothstep(0.08, 0.4, sp);
    outgoingLight += directionalLights[0].color * min(vec3(1.0), diffuseColor.rgb * 0.5 + 0.6) * sp * uGloss * uSpecI * 0.55;
  #endif
  // cool shadow tint: unlit sides lean toward the look's shade colour instead of flat grey
  outgoingLight = mix(outgoingLight, outgoingLight * (uShade * 2.0), (1.0 - lit) * uShadeI);
  float fr = 1.0 - ndv;
  float rim = smoothstep(0.52, 0.86, fr);
  float side = smoothstep(-0.35, 0.35, N.x + N.y * 0.5);
  vec3 rc = mix(uRimA, uRimB, side);
  outgoingLight += rc * rim * uRimI * uRimK * (0.35 + 0.65 * max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)));
}
#include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'revlook1';
  m.needsUpdate = true;
  return m;
}

export function toonMat(color: THREE.ColorRepresentation, opts: THREE.MeshToonMaterialParameters = {}, look: GlossOpts = {}): THREE.MeshToonMaterial {
  return applyLook(new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), ...opts }), look);
}

// ---------- outlines ----------

/** Outline width in render-target pixels, and the target size. Set by the Stage (v3: ~0.9 game px at 960x540). */
export const OUTLINE = { px: 1.4, res: new THREE.Vector2(960, 540) };

const outlineMats = new Map<string, THREE.ShaderMaterial>();
/** Default outline ink: a deep plum instead of pure black (cleaner, candier). */
export const INK = 0x140a1e;

/**
 * Black hull pushed out along smoothed normals in clip space, so the line is the same pixel width at
 * any distance or object scale (chunky pixel-art outline). Works for InstancedMesh too.
 */
export function outlineMat(color = INK, widthMul = 1): THREE.ShaderMaterial {
  const key = color + ':' + widthMul;
  const hit = outlineMats.get(key);
  if (hit) return hit;
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uPx: { value: OUTLINE.px * widthMul }, uRes: { value: OUTLINE.res } },
    vertexShader: /* glsl */ `
      attribute vec3 outlineNormal;
      uniform float uPx; uniform vec2 uRes;
      void main() {
        vec4 p = vec4(position, 1.0);
        vec3 n = outlineNormal;
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 clip = projectionMatrix * modelViewMatrix * p;
        vec3 vn = normalize(normalMatrix * n);
        vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
        float l = length(dir);
        if (l > 1e-5) clip.xy += dir / l * (uPx * 2.0 / uRes) * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }`,
    side: THREE.BackSide,
  });
  m.userData.shared = true;
  outlineMats.set(key, m);
  return m;
}

/** Averages normals of coincident vertices so hard-edged meshes get a gap-free hull. Cached on the geometry. */
function ensureOutlineNormals(g: THREE.BufferGeometry) {
  if (g.getAttribute('outlineNormal')) return;
  const pos = g.getAttribute('position');
  if (!pos) return;
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  const acc = new Map<string, THREE.Vector3>();
  const keyOf = (i: number) => `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = keyOf(i);
    let v = acc.get(k);
    if (!v) acc.set(k, (v = new THREE.Vector3()));
    v.x += nrm.getX(i);
    v.y += nrm.getY(i);
    v.z += nrm.getZ(i);
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = acc.get(keyOf(i))!;
    const l = v.length() || 1;
    out[i * 3] = v.x / l;
    out[i * 3 + 1] = v.y / l;
    out[i * 3 + 2] = v.z / l;
  }
  g.setAttribute('outlineNormal', new THREE.BufferAttribute(out, 3));
}

/** Adds a black hull child to a mesh. Returns the hull. */
export function outline(mesh: THREE.Mesh, color = INK, widthMul = 1): THREE.Mesh {
  ensureOutlineNormals(mesh.geometry);
  const hull =
    mesh instanceof THREE.InstancedMesh
      ? new THREE.InstancedMesh(mesh.geometry, outlineMat(color, widthMul), mesh.count)
      : new THREE.Mesh(mesh.geometry, outlineMat(color, widthMul));
  if (hull instanceof THREE.InstancedMesh && mesh instanceof THREE.InstancedMesh) {
    hull.instanceMatrix = mesh.instanceMatrix;
    hull.frustumCulled = false;
  }
  hull.userData.isOutline = true;
  hull.renderOrder = mesh.renderOrder;
  hull.castShadow = false;
  mesh.add(hull);
  return hull;
}

/**
 * Converts every lit material under `root` to the toon ramp and gives every opaque mesh an outline.
 * Skips: MeshBasicMaterial (glows, lights), transparent materials, `userData.noOutline`, and roots
 * flagged `userData.toon = true` (already done by the Modeler).
 */
export function toonify(root: THREE.Object3D, opts: { outline?: boolean } = {}) {
  if (root.userData.toon) return;
  root.userData.toon = true;
  const meshes: THREE.Mesh[] = [];
  let kit = false; // the Modeler's kit already outlines (userData.hull) and toon-shades its meshes
  root.traverse((o) => {
    if (o.userData.hull || o.userData.outlined) kit = true;
    if ((o as THREE.Mesh).isMesh && !o.userData.isOutline && !o.userData.hull) meshes.push(o as THREE.Mesh);
  });
  if (kit) return;
  for (const m of meshes) {
    if ((m as unknown as THREE.SkinnedMesh).isSkinnedMesh) continue;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const conv = mats.map((mat) => {
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhongMaterial || mat instanceof THREE.MeshLambertMaterial) {
        const glossy = mat instanceof THREE.MeshStandardMaterial ? 1 - mat.roughness : mat instanceof THREE.MeshPhongMaterial ? 0.6 : 0.2;
        const t = toonMat(mat.color, {
          map: mat.map,
          emissive: mat.emissive,
          emissiveIntensity: mat.emissiveIntensity,
          emissiveMap: mat.emissiveMap,
          transparent: mat.transparent,
          opacity: mat.opacity,
          side: mat.side,
          vertexColors: mat.vertexColors,
        }, { gloss: 0.15 + glossy * 0.7 });
        mat.dispose();
        return t;
      }
      return mat;
    });
    m.material = Array.isArray(m.material) ? conv : conv[0];
    const any = conv[0];
    const lit = !(any instanceof THREE.MeshBasicMaterial) && !(any instanceof THREE.ShaderMaterial);
    if (opts.outline !== false && lit && !any.transparent && !m.userData.noOutline && !m.children.some((c) => c.userData.isOutline))
      outline(m);
  }
}

/** Frees every geometry, material and texture under root (shared outline materials excepted). */
export function disposeTree(root: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const ms = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of ms) {
      mats.add(mat);
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) texs.add(v);
    }
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  texs.forEach((t) => t !== gradient && t.dispose());
}

/** Releases module-level caches (ramp + outline materials). Called when the cutscene ends. */
export function disposeShared() {
  outlineMats.forEach((m) => m.dispose());
  outlineMats.clear();
  gradient?.dispose();
  gradient = null;
  fireTex?.dispose();
  fireTex = null;
}

// ---------- small math ----------

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeIn = (t: number) => Math.pow(clamp01(t), 3);
export const easeInOut = (t: number) => {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
/** Overshoot then settle (the Balatro pop). */
export const easeBack = (t: number, s = 2.2) => {
  t = clamp01(t) - 1;
  return t * t * ((s + 1) * t + s) + 1;
};
/** 0..1 inside [a, b]. */
export const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- particles ----------

export interface ParticleOpts {
  vel?: THREE.Vector3Like;
  /** Random spread added to vel on each axis. */
  spread?: number;
  life?: number;
  size?: number;
  /** Size at end of life, as a multiple of size. */
  grow?: number;
  color?: THREE.ColorRepresentation;
  /** Colour at end of life (lerped from `color`), e.g. flames going yellow -> red. */
  colorEnd?: THREE.ColorRepresentation;
  gravity?: number;
  /** Velocity damping per second (0 = none). */
  drag?: number;
  /** Stretch along velocity (sparks, speed streaks). Works in every pool. */
  stretch?: number;
  /** Bounce off the ground (y = 0). */
  bounce?: number;
  /**
   * Solid puffs only (smoke, dust, oil): false = no black outline (soft pool: small pale dust, wind streaks,
   * haze). Default true, except dust, which defaults to false.
   */
  outline?: boolean;
}

interface P {
  p: THREE.Vector3;
  v: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  gravity: number;
  drag: number;
  stretch: number;
  bounce: number;
  spin: THREE.Euler;
  spinV: THREE.Vector3;
  c0: THREE.Color;
  c1: THREE.Color | null;
}

/** Camera info the pools use to keep puffs off the lens and tiny sparks visible. */
export interface PCam {
  pos: THREE.Vector3;
  quat?: THREE.Quaternion;
  /** Vertical fov, degrees. */
  fov?: number;
  /** Render target height in px (for the minimum spark size). */
  rows?: number;
}

class Pool {
  mesh: THREE.InstancedMesh;
  items: P[] = [];
  private next = 0;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private qz = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private col = new THREE.Color();

  /**
   * @param maxCover largest size a live puff may have relative to its distance from the lens (at fov 38),
   *   so nothing balloons over the frame; it shrinks smoothly instead.
   * @param minPx smallest on-screen size in render px (glows: sparks and embers never vanish sub-pixel).
   * @param billboard quads that always face the camera (soft fire).
   */
  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    readonly max: number,
    outlined: boolean,
    private readonly near = 0,
    private readonly maxCover = Infinity,
    private readonly minPx = 0,
    private readonly billboard = false,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.frustumCulled = false;
    this.mesh.count = max;
    for (let i = 0; i < max; i++) {
      this.items.push({
        p: new THREE.Vector3(), v: new THREE.Vector3(), age: 1, life: 0, size: 0, grow: 1, gravity: 0, drag: 0,
        stretch: 0, bounce: 0, spin: new THREE.Euler(), spinV: new THREE.Vector3(), c0: new THREE.Color(), c1: null,
      });
      this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
    }
    if (outlined) outline(this.mesh);
  }

  spawn(pos: THREE.Vector3Like, o: ParticleOpts) {
    const i = this.next;
    this.next = (this.next + 1) % this.max; // oldest gets recycled: counts stay bounded
    const it = this.items[i];
    const sp = o.spread ?? 0;
    it.p.set(pos.x, pos.y, pos.z);
    it.v.set((o.vel?.x ?? 0) + rand(-sp, sp), (o.vel?.y ?? 0) + rand(-sp, sp), (o.vel?.z ?? 0) + rand(-sp, sp));
    it.age = 0;
    it.life = (o.life ?? 1) * rand(0.8, 1.2);
    it.size = (o.size ?? 0.5) * rand(0.75, 1.25);
    it.grow = o.grow ?? 1;
    it.gravity = o.gravity ?? 0;
    it.drag = o.drag ?? 0;
    it.stretch = o.stretch ?? 0;
    it.bounce = o.bounce ?? 0;
    it.spin.set(rand(0, 6), rand(0, 6), rand(0, 6));
    it.spinV.set(rand(-3, 3), rand(-3, 3), rand(-3, 3));
    it.c0.set(o.color ?? 0xffffff);
    it.c1 = o.colorEnd !== undefined ? new THREE.Color(o.colorEnd) : null;
    this.mesh.setColorAt(i, it.c0);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number, cam?: PCam) {
    // fov-aware distance scale: telephoto shots magnify, so the lens guard tightens
    const fovK = cam?.fov ? Math.tan(((cam.fov * Math.PI) / 180) * 0.5) / Math.tan((19 * Math.PI) / 180) : 1;
    const pxSize = cam?.fov ? (2 * Math.tan(((cam.fov * Math.PI) / 180) * 0.5)) / (cam.rows ?? 180) : 0;
    let recolor = false;
    for (let i = 0; i < this.max; i++) {
      const it = this.items[i];
      if (it.age >= it.life) {
        if (it.life > 0) {
          this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
          it.life = 0;
        }
        continue;
      }
      it.age += dt;
      if (it.drag) it.v.multiplyScalar(Math.exp(-it.drag * dt));
      it.v.y -= it.gravity * dt;
      it.p.addScaledVector(it.v, dt);
      if (it.bounce && it.p.y < 0) {
        it.p.y = 0;
        it.v.y = -it.v.y * it.bounce;
        it.v.x *= 0.7;
        it.v.z *= 0.7;
      }
      const u = Math.min(1, it.age / it.life);
      // pop in fast, hold, shrink out: chunky cartoon puffs never fade, they shrink
      const env = Math.min(1, u * 6) * (u > 0.7 ? 1 - (u - 0.7) / 0.3 : 1);
      let sz = it.size * Math.max(0, 1 + (it.grow - 1) * u) * env;
      if (cam) {
        const d = it.p.distanceTo(cam.pos);
        // never let a puff swallow the lens: shrink as its surface nears the camera, cap its screen coverage
        if (this.near) sz *= clamp01((d - sz * 0.5 - this.near) / this.near);
        if (this.maxCover !== Infinity) sz = Math.min(sz, (this.maxCover * d * fovK));
        if (this.minPx && sz > 0 && pxSize) sz = Math.max(sz, this.minPx * pxSize * d);
      }
      if (it.c1) {
        this.mesh.setColorAt(i, this.col.copy(it.c0).lerp(it.c1, u));
        recolor = true;
      }
      if (this.billboard && cam?.quat) {
        it.spin.z += it.spinV.z * dt * 0.5;
        this.q.copy(cam.quat).multiply(this.qz.setFromAxisAngle(Z_AXIS, it.spin.z));
        const sp = it.stretch ? it.v.length() : 0;
        this.s.set(sz, sz * (1 + sp * it.stretch), sz);
      } else if (it.stretch) {
        const sp = it.v.length();
        this.dir.copy(it.v).divideScalar(sp || 1);
        this.q.setFromUnitVectors(X_AXIS, this.dir);
        this.s.set(sz * (1 + sp * it.stretch), sz, sz);
      } else {
        it.spin.x += it.spinV.x * dt;
        it.spin.y += it.spinV.y * dt;
        it.spin.z += it.spinV.z * dt;
        this.q.setFromEuler(it.spin);
        this.s.set(sz, sz, sz);
      }
      this.mesh.setMatrixAt(i, this.m4.compose(it.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (recolor && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

let fireTex: THREE.CanvasTexture | null = null;
/** Flame blob: a white-hot core, soft-stepped mid ring and faint edge (32 px, linear: smooth at the v3 res). */
function fireTexture(): THREE.CanvasTexture {
  if (fireTex) return fireTex;
  const S = 32;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const st = (e0: number, e1: number, x: number) => {
    const k = clamp01((x - e0) / (e1 - e0));
    return k * k * (3 - 2 * k);
  };
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x - (S - 1) / 2, y - (S - 1) / 2) / (S / 2);
      const a = 1 - 0.4 * st(0.38, 0.5, r) - 0.38 * st(0.68, 0.8, r) - 0.22 * st(0.9, 1, r);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(clamp01(a) * 255);
    }
  g.putImageData(img, 0, 0);
  fireTex = new THREE.CanvasTexture(c);
  fireTex.colorSpace = THREE.SRGBColorSpace;
  fireTex.magFilter = fireTex.minFilter = THREE.LinearFilter;
  fireTex.generateMipmaps = false;
  fireTex.userData.shared = true;
  return fireTex;
}

/**
 * Bounded particle pools: `solid` = toon-shaded, outlined puffs (smoke, oil, debris chunks); `soft` = the same
 * without outlines (dust, haze, wind streaks); `glow` = additive unlit cubes (sparks, embers, light flecks,
 * at least ~1 px on screen); `fire` = additive camera-facing soft blobs (flames, backfires, muzzle bursts).
 * Every pool keeps puffs from swallowing the lens.
 */
export class Particles {
  /** Output rows the minimum spark size is measured in (the Stage's RH). */
  static rows = 360;
  readonly group = new THREE.Group();
  readonly solid: Pool;
  readonly soft: Pool;
  readonly glow: Pool;
  readonly fire: Pool;

  constructor(maxSolid = 260, maxGlow = 260) {
    this.solid = new Pool(new THREE.IcosahedronGeometry(0.5, 2), toonMat(0xffffff, {}, { gloss: 0.35, shine: 30 }), maxSolid, true, 1.6, 0.4);
    this.soft = new Pool(new THREE.IcosahedronGeometry(0.5, 2), toonMat(0xffffff, {}, { gloss: 0, rim: 0.4 }), 200, false, 1.2, 0.3);
    this.glow = new Pool(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
      maxGlow,
      false,
      0.3,
      0.3,
      1.1,
    );
    this.fire = new Pool(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: fireTexture(),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
        fog: false,
        side: THREE.DoubleSide,
      }),
      160,
      false,
      0.6,
      0.3,
      2,
      true,
    );
    this.group.add(this.solid.mesh, this.soft.mesh, this.glow.mesh, this.fire.mesh);
  }

  /** Kill every live particle (use on a hard cut). */
  clear() {
    for (const pool of [this.solid, this.soft, this.glow, this.fire]) for (const it of pool.items) it.age = it.life;
  }

  /** `cam`: the camera (preferred: enables billboards, fov-aware lens guard, min spark size) or its position. */
  update(dt: number, cam?: THREE.Vector3 | THREE.PerspectiveCamera) {
    let c: PCam | undefined;
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.updateMatrixWorld();
      c = { pos: cam.getWorldPosition(new THREE.Vector3()), quat: cam.getWorldQuaternion(new THREE.Quaternion()), fov: cam.fov, rows: Particles.rows };
    } else if (cam) c = { pos: cam };
    this.solid.update(dt, c);
    this.soft.update(dt, c);
    this.glow.update(dt, c);
    this.fire.update(dt, c);
  }

  private puff(o: ParticleOpts, dflt = true) {
    return (o.outline ?? dflt) ? this.solid : this.soft;
  }

  /** Billowing cartoon tyre smoke. `outline: false` for softer haze. */
  smoke(pos: THREE.Vector3Like, n: number, o: ParticleOpts = {}) {
    const pool = this.puff(o);
    for (let i = 0; i < n; i++)
      pool.spawn(pos, { life: 1.6, size: 0.9, grow: 3, color: 0xe8e4f0, drag: 1.6, gravity: -0.6, spread: 1.2, ...o });
  }

  sparks(pos: THREE.Vector3Like, n: number, o: ParticleOpts = {}) {
    for (let i = 0; i < n; i++)
      this.glow.spawn(pos, { life: 0.5, size: 0.07, color: 0xffd36a, gravity: 14, spread: 6, stretch: 0.06, bounce: 0.4, ...o });
  }

  /**
   * Fat cartoon flames: soft additive blobs, white-yellow core going orange -> red as they rise and swell,
   * plus a few glow chunks for crackle. `size` is the blob diameter (1.2-1.6 = a big exhaust fireball).
   */
  flame(pos: THREE.Vector3Like, n: number, o: ParticleOpts = {}) {
    const cols = [0xfff2a0, 0xffc040, 0xff7a1a];
    const size = o.size ?? 0.6;
    for (let i = 0; i < n; i++) {
      this.fire.spawn(pos, { life: 0.32, grow: 1.3, color: cols[i % 3], colorEnd: 0xd8200a, spread: 0.6, gravity: -3, ...o, size });
      if (Math.random() < 0.3)
        this.glow.spawn(pos, { life: 0.25, grow: 0.3, color: cols[i % 3], spread: 1.2, gravity: -3, ...o, colorEnd: undefined, size: size * 0.22 });
    }
  }

  oil(pos: THREE.Vector3Like, n: number, o: ParticleOpts = {}) {
    const pool = this.puff(o);
    for (let i = 0; i < n; i++)
      pool.spawn(pos, { life: 2.2, size: 0.32, grow: 0.8, color: 0x17171f, gravity: 9, spread: 3, bounce: 0.1, ...o });
  }

  /** Kicked-up dust: no outline by default (pass outline: true for chunky toon dust). */
  dust(pos: THREE.Vector3Like, n: number, o: ParticleOpts = {}) {
    const pool = this.puff(o, false);
    for (let i = 0; i < n; i++)
      pool.spawn(pos, { life: 1.2, size: 0.5, grow: 2, color: 0x8a8296, drag: 2, gravity: -0.2, spread: 2, ...o });
  }
}
