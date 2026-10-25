// 3D car showcases: a studio shot of a car rendered into a rect of the shared three canvas (renderer.ts),
// BEHIND the Phaser UI. The Phaser side (showcaseSlot.ts) punches an ERASE hole into its panel at the right
// display-list position, so the panel's own UI (labels, buttons, icons) still draws on top.
//
// Each showcase is a small scene: look's studio rig (key with a fitted shadow, rims, fill, shadow catcher, contact
// blob) under one shared studio PMREM environment, a raw-sRGB gradient backdrop whose top edge equals the panel
// fill (a hole that ends mid-panel stays seamless), a glossy floor that fades out radially and, at high quality, a
// mirrored clone of the car under it (the reflection). Shown on a hero 3/4 sway, a turntable (drag to spin) or the
// paragon reveal.
// Cheap by design: all showcases render together on Phaser's POST_RENDER (same RAF), at 30 fps while idle and at
// full rate only during transitions, drags and camera shakes (one decision for all, since the drawing buffer is not
// preserved: either every showcase redraws this frame or none does). Car shaders compile asynchronously first.
// Lazy: only reached through a dynamic import in 3D mode.
import * as THREE from 'three';
import type Phaser from 'phaser';
import { getThreeLayer, type ThreeLayer } from './renderer';
import { buildCar3D, specFromVisual } from './cars';
import { studioEnvMap, studioLighting, type StudioRig } from './lighting';
import type { Car3D } from './types';
import type { CarVisual } from '../car';
import { GAME_W, PAL } from '../palette';

export interface GameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ShowMode = 'hero' | 'turntable' | 'reveal';
export type SwapFx = 'swap' | 'pulse' | 'reveal' | 'none';

export interface ShowcaseOpts {
  /** The viewport in game px (640x360): exactly the Phaser hole. */
  rect: GameRect;
  /** Where the car is framed, in game px (default: rect). Lets text sit over the rest of the backdrop. */
  focus?: GameRect;
  /** hero: a 3/4 front angle with a slow sway; turntable: keeps turning (drag to spin); reveal: the paragon moment. */
  mode?: ShowMode;
  /** Hero / start angle: nose toward screen right (default) or left. */
  facing?: 'right' | 'left';
  /** Backdrop colour at the top edge (the panel fill, for a seamless hole), and the glow tint behind the car. */
  bg?: number;
  glow?: number;
  /** Camera elevation (rad) and lens (vertical fov, deg). */
  elevation?: number;
  fov?: number;
  /** Fill of the framed area (0..1, default 0.9). */
  fill?: number;
  /** Render order among showcases (higher draws later, over lower ones). */
  layer?: number;
  /** Phaser camera shake source: game-px offsets applied to the viewport so the 3D shakes with the UI. */
  shake?: () => { x: number; y: number };
}

// ---------------------------------------------------------------------------------------------
// shared state: the layer, the studio environment and the frame loop (one listener for all showcases)

interface Shared {
  layer: ThreeLayer;
  env: THREE.Texture;
  shows: Set<CarShowcase>;
  since: number; // s since the last drawn frame
}
let shared: Shared | null = null;
let sharedPending: Promise<Shared | null> | null = null;
let uid = 0;
const IDLE_DT = 1 / 30;

// Effect parts that reach far past the body (the 16 m headlight ground beam, the trailing chute): never framed.
const OUTLINE_SKIP = new Set(['headBeam', 'chute']);
const OUTLINE_MAX = 1400;

/** Sampled points (car-root space) on the car's visible meshes: framing fits the real body, not a padded box. */
function measureOutline(root: THREE.Object3D): THREE.Vector3[] {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes: THREE.Mesh[] = [];
  let verts = 0;
  const walk = (o: THREE.Object3D) => {
    if (!o.visible || OUTLINE_SKIP.has(o.name)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.attributes.position) {
      meshes.push(m);
      verts += m.geometry.attributes.position.count;
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  const out: THREE.Vector3[] = [];
  const step = Math.max(1, Math.ceil(verts / OUTLINE_MAX));
  const mw = new THREE.Matrix4();
  for (const m of meshes) {
    mw.multiplyMatrices(inv, m.matrixWorld);
    if ((m as THREE.InstancedMesh).isInstancedMesh) {
      // instanced parts (wheels, bolts): their own bounds cover every instance
      const b = new THREE.Box3().setFromObject(m).applyMatrix4(inv);
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z));
      continue;
    }
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += step) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mw));
  }
  if (!out.length) out.push(new THREE.Vector3(-2.2, 0, -0.9), new THREE.Vector3(2.2, 1.4, 0.9));
  return out;
}

async function getShared(game: Phaser.Game): Promise<Shared | null> {
  if (shared) return shared;
  if (!sharedPending)
    sharedPending = getThreeLayer(game).then((layer) => {
      if (!layer) return null;
      const shows = new Set<CarShowcase>();
      shared = { layer, env: studioEnvMap(layer.renderer), shows, since: 1 };
      game.events.on('postrender', (_r: unknown, _t: number, delta: number) => frame(Math.min(0.05, Math.max(0, delta / 1000))));
      layer.onLost(() => [...shows].forEach((s) => s.fail('context lost')));
      return shared;
    });
  const s = await sharedPending;
  if (!s) sharedPending = null;
  return s;
}

function frame(dt: number) {
  const sh = shared;
  if (!sh || !sh.shows.size) return;
  const list = [...sh.shows].filter((s) => s.visible).sort((a, b) => a.layer - b.layer);
  for (const s of list) s.tick(dt);
  sh.since += dt;
  if (!list.some((s) => s.busy()) && sh.since < IDLE_DT - 0.004) return;
  sh.since = 0;
  const r = sh.layer.renderer;
  const { w: bw, h: bh } = sh.layer.size();
  if (bw < 2 || bh < 2) return;
  const k = bw / GAME_W;
  const autoClear = r.autoClear;
  r.autoClear = false;
  r.setRenderTarget(null);
  r.setScissorTest(true);
  for (const s of list) s.render(r, k, bh);
  r.setScissorTest(false);
  r.setViewport(0, 0, bw, bh);
  r.setScissor(0, 0, bw, bh);
  r.setClearColor(PAL.bg, 1);
  r.autoClear = autoClear;
}

// ---------------------------------------------------------------------------------------------
// procedural bits

function radialTexture(stops: [number, number][], size = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, v] of stops) grad.addColorStop(at, `rgb(${v},${v},${v})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const QUAD_VS = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;

// Backdrop: raw sRGB out (no tone mapping) so the top edge equals the Phaser panel fill exactly.
const BACK_FS = /* glsl */ `
uniform vec3 uTop, uMid, uBot, uGlow, uRayCol;
uniform vec2 uGlowPos, uAspect;
uniform float uHorizon, uRays, uTime;
varying vec2 vUv;
void main() {
  float y = vUv.y;
  vec3 c = mix(uBot, uMid, smoothstep(0.0, uHorizon, y));
  c = mix(c, uTop, smoothstep(uHorizon, 1.0, y));
  vec2 d = (vUv - uGlowPos) * uAspect;
  c += uGlow * exp(-dot(d, d) * 3.2);
  if (uRays > 0.0) {
    float a = atan(d.y, d.x);
    float ray = pow(0.5 + 0.5 * cos(a * 14.0 + uTime * 0.9), 5.0) + 0.5 * pow(0.5 + 0.5 * cos(a * 9.0 - uTime * 0.6), 8.0);
    c += uRayCol * ray * uRays * (0.35 + 0.65 * exp(-length(d) * 1.1));
  }
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

// Flash / heat overlay: additive white wash (a soft radial "white-hot" glow around the car + a flat flash).
const FLASH_FS = /* glsl */ `
uniform vec3 uCol; uniform float uFlash, uHeat; uniform vec2 uPos, uAspect;
varying vec2 vUv;
void main() {
  vec2 d = (vUv - uPos) * uAspect;
  float hot = uHeat * exp(-dot(d, d) * 5.0);
  gl_FragColor = vec4(uCol * (uFlash + hot), 1.0);
}`;

const srgb = (n: number) => new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);

// ---------------------------------------------------------------------------------------------

export class CarShowcase {
  readonly id = `show:${++uid}`;
  layer: number;
  visible = true;
  private sh: Shared;
  private opts: ShowcaseOpts;
  private rect: GameRect;
  private focus: GameRect;
  private mode: ShowMode;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private spin = new THREE.Group(); // yaw, pop scale, bounce
  private mirror = new THREE.Group(); // scale.y = -1: the reflection
  private spinR = new THREE.Group();
  private rig: StudioRig;
  private car: Car3D | null = null;
  private clone: THREE.Object3D | null = null;
  private next: Car3D | null = null;
  private pending: Car3D | null = null;
  private prepared: { key: string; car: Car3D; ready: Promise<void> } | null = null;
  private setToken = 0;
  private dims = { L: 4.5, W: 1.9, H: 1.4 };
  /** Sampled points on the car's visible body (turntable space, centred), so framing fits the real silhouette. */
  private outline: THREE.Vector3[] = [];
  private target = new THREE.Vector3();
  private dist = 10;
  private spot: THREE.SpotLight;
  private floor: THREE.Mesh;
  private back: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private over: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private owned: { dispose(): void }[] = [];
  private t = 0;
  private yaw = 0;
  private yaw0 = 0;
  private yawVel = 0;
  private dragging = false;
  private idle = 99;
  private popT = 9;
  private popAmp = 0;
  private swapT = -1;
  private inT = 9;
  private inFrom = 1;
  private revealT = 9;
  private spotK = 0;
  private flashK = 0;
  private heat = 0;
  private shakeAmp = 0;
  private keyBase = 1.8;
  private lastShake = { x: 0, y: 0 };
  private quality = '';
  private firstCbs: (() => void)[] = [];
  private failCbs: ((why: string) => void)[] = [];
  private framed = false;
  private dead = false;

  /** Resolves null when 3D can't run (no WebGL2, context failure): the caller keeps its pixel car. */
  static async create(game: Phaser.Game, opts: ShowcaseOpts): Promise<CarShowcase | null> {
    const sh = await getShared(game);
    return sh ? new CarShowcase(sh, opts) : null;
  }

  private constructor(sh: Shared, opts: ShowcaseOpts) {
    this.sh = sh;
    this.opts = opts;
    this.rect = { ...opts.rect };
    this.focus = { ...(opts.focus ?? opts.rect) };
    this.mode = opts.mode ?? 'hero';
    this.layer = opts.layer ?? 0;
    // car faces +X, +Z is its right; the camera sits on +Z: a negative yaw turns the nose toward the camera
    this.yaw0 = opts.facing === 'left' ? Math.PI + 0.62 : -0.62;
    this.yaw = this.yaw0;
    this.camera = new THREE.PerspectiveCamera(opts.fov ?? 26, this.focus.w / this.focus.h, 0.1, 200);

    const sc = this.scene;
    sc.environment = sh.env;
    sc.environmentIntensity = 1;
    sc.add(this.spin);
    this.mirror.scale.y = -1;
    this.mirror.add(this.spinR);
    sc.add(this.mirror);
    // look's studio rig (lights, fitted key shadow, shadow catcher, contact blob); our own floor + backdrop
    this.rig = studioLighting(sc, { floor: 'none', quality: sh.layer.quality(), background: null });
    this.keyBase = this.rig.key.intensity;
    this.spot = new THREE.SpotLight(0xffffff, 0, 30, 0.42, 0.6, 1.2);
    this.spot.position.set(0, 12, 2);
    sc.add(this.spot, this.spot.target);

    // backdrop
    const bg = opts.bg ?? 0x15122a;
    const glow = opts.glow ?? 0x6a58b8;
    const bot = srgb(bg).multiplyScalar(0.55);
    const backMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: BACK_FS,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTop: { value: srgb(bg) },
        uMid: { value: srgb(bg).lerp(new THREE.Vector3(1, 1, 1), 0.06).multiplyScalar(1.12) },
        uBot: { value: bot },
        uGlow: { value: srgb(glow).multiplyScalar(0.2) },
        uRayCol: { value: srgb(glow).multiplyScalar(0.55) },
        uGlowPos: { value: new THREE.Vector2(0.5, 0.55) },
        uAspect: { value: new THREE.Vector2(1, 1) },
        uHorizon: { value: 0.42 },
        uRays: { value: 0 },
        uTime: { value: 0 },
      },
    });
    this.back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backMat);
    this.back.frustumCulled = false;
    this.back.renderOrder = -1000;
    sc.add(this.back);
    const overMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: FLASH_FS,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uCol: { value: new THREE.Vector3(1, 0.97, 0.9) },
        uFlash: { value: 0 },
        uHeat: { value: 0 },
        uPos: { value: new THREE.Vector2(0.5, 0.5) },
        uAspect: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.over = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), overMat);
    this.over.frustumCulled = false;
    this.over.renderOrder = 10000;
    this.over.visible = false;
    sc.add(this.over);

    // glossy floor that fades out radially (alpha map), lit by the env; the reflection clone shows through it
    const floorA = radialTexture([[0, 255], [0.42, 245], [0.75, 90], [1, 0]]);
    const floorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setRGB(bot.x * 1.4, bot.y * 1.4, bot.z * 1.4, THREE.SRGBColorSpace),
      roughness: 0.32,
      metalness: 0,
      transparent: true,
      opacity: 0.86,
      alphaMap: floorA,
      depthWrite: false,
      envMapIntensity: 0.12,
    });
    this.floor = new THREE.Mesh(new THREE.CircleGeometry(1, 72), floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.renderOrder = -2;
    sc.add(this.floor);
    this.owned.push(backMat, this.back.geometry, overMat, this.over.geometry, floorA, floorMat, this.floor.geometry);

    sh.shows.add(this);
    sh.layer.claim(this.id);
  }

  // ------------------------------------------------------------------------------------------
  // public API

  /**
   * Build and show a car. Returns false if the 3D build failed (the caller should fall back to its pixel car).
   * Its shaders compile asynchronously first (KHR_parallel_shader_compile via compileAsync), so a first showing
   * never freezes the UI: the slot keeps the pixel car up until the 3D one has actually rendered.
   */
  setCar(v: CarVisual, fx: SwapFx = 'swap'): boolean {
    if (this.dead) return false;
    const key = JSON.stringify(v);
    let prep = this.prepared?.key === key ? this.prepared : null;
    if (!prep) prep = this.build(v, key);
    else this.prepared = null;
    if (!prep) return false;
    const token = ++this.setToken;
    this.pending?.dispose();
    const car = prep.car;
    this.pending = car;
    prep.ready.then(() => {
      if (this.dead || token !== this.setToken) return;
      this.pending = null;
      this.showCar(car, fx);
    });
    return true;
  }

  /** Build + compile a car ahead of time (e.g. the paragon during the build-up), so setCar(v) can swap instantly. */
  prepare(v: CarVisual) {
    if (this.dead) return;
    const key = JSON.stringify(v);
    if (this.prepared?.key === key) return;
    this.prepared?.car.dispose();
    this.prepared = this.build(v, key);
  }

  private build(v: CarVisual, key: string): { key: string; car: Car3D; ready: Promise<void> } | null {
    let car: Car3D;
    try {
      car = buildCar3D(specFromVisual(v), { quality: this.sh.layer.quality(), lights: 'auto', beams: false });
      car.setHeadlights(true);
      car.setBrakeLights(false);
    } catch (e) {
      console.error('[3d showcase] car build failed', e);
      this.fail('build');
      return null;
    }
    let ready: Promise<void>;
    try {
      ready = this.sh.layer.renderer.compileAsync(car.root, this.camera, this.scene).then(
        () => undefined,
        () => undefined,
      );
    } catch {
      ready = Promise.resolve();
    }
    return { key, car, ready };
  }

  /** Install pop: the car bounces on its springs under a quick flash. */
  pop(amount = 0.09) {
    this.popT = 0;
    this.popAmp = amount;
    this.flash(0.28);
  }

  flash(k = 0.6) {
    this.flashK = Math.max(this.flashK, k);
  }

  /** Scale the car in from small (e.g. it "flies" to centre stage). */
  enter(from = 0.55) {
    this.inT = 0;
    this.inFrom = from;
  }

  /** White-hot glow (0..1) washing over the car, for the paragon build-up. */
  setHeat(k: number) {
    this.heat = Math.max(0, k);
  }

  /** Light rays behind the car (reveal backdrop), 0..1. */
  setRays(k: number) {
    this.back.material.uniforms.uRays.value = k;
  }

  /** Jitter the car (game px amplitude). */
  setShake(amp: number) {
    this.shakeAmp = amp;
  }

  dragStart() {
    this.dragging = true;
    this.yawVel = 0;
  }

  /** Rotate by a horizontal pointer delta in game px (drag-to-spin). */
  dragBy(dx: number) {
    const d = dx * 0.018;
    this.yaw += d;
    this.yawVel = this.yawVel * 0.5 + d * 30;
    this.idle = 0;
  }

  dragEnd() {
    this.dragging = false;
    this.idle = 0;
  }

  setRect(rect: GameRect, focus?: GameRect) {
    this.rect = { ...rect };
    this.focus = { ...(focus ?? rect) };
    this.framed = false;
  }

  setVisible(on: boolean) {
    this.visible = on;
  }

  /** Called once, right after the first frame that showed a car (the slot opens its hole then). */
  onFirstFrame(cb: () => void) {
    this.firstCbs.push(cb);
  }

  onFail(cb: (why: string) => void) {
    this.failCbs.push(cb);
  }

  fail(why: string) {
    if (this.dead) return;
    const cbs = this.failCbs;
    this.failCbs = [];
    cbs.forEach((cb) => cb(why));
  }

  /** Something is animating fast (transition, drag, flash, shake): the frame loop renders at full rate. */
  busy(): boolean {
    return (
      this.dragging ||
      this.swapT >= 0 ||
      this.inT < 1.2 ||
      this.popT < 1 ||
      this.revealT < 9 ||
      this.flashK > 0 ||
      this.heat > 0 ||
      this.shakeAmp > 0 ||
      this.lastShake.x !== 0 ||
      this.lastShake.y !== 0 ||
      Math.abs(this.yawVel) > 0.6 ||
      this.firstCbs.length > 0
    );
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.sh.shows.delete(this);
    this.dropCar();
    this.next?.dispose();
    this.next = null;
    this.pending?.dispose();
    this.pending = null;
    this.prepared?.car.dispose();
    this.prepared = null;
    this.rig.dispose();
    this.owned.forEach((d) => d.dispose());
    this.owned = [];
    this.spot.dispose();
    this.sh.layer.release(this.id);
  }

  // ------------------------------------------------------------------------------------------
  // internals

  private showCar(car: Car3D, fx: SwapFx) {
    this.next?.dispose();
    this.next = null;
    if (!this.car || fx === 'none' || fx === 'reveal' || fx === 'pulse') {
      this.install(car);
      if (fx === 'pulse') {
        this.flash(0.35);
        this.pop(0.05);
      } else if (fx === 'reveal') this.revealIn();
      return;
    }
    // swap: the old car squashes into the floor under a flash, the new one springs up out of it
    this.next = car;
    this.swapT = 0;
  }

  private dropCar() {
    if (this.clone) this.spinR.remove(this.clone);
    this.clone = null;
    if (this.car) {
      this.spin.remove(this.car.root);
      this.car.dispose();
    }
    this.car = null;
  }

  private install(car: Car3D) {
    this.dropCar();
    this.car = car;
    // measure at rest (yaw 0), then centre the car on the turntable axis
    const pts = measureOutline(car.root);
    const box = new THREE.Box3().setFromPoints(pts);
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    this.dims = { L: size.x, W: size.z, H: size.y };
    this.outline = pts.map((p) => p.set(p.x - c.x, p.y, p.z - c.z));
    car.root.position.set(-c.x, 0, -c.z);
    this.spin.add(car.root);
    // shadow frustum + contact blob sized to the turning car (a box covering every yaw)
    const r = Math.hypot(size.x, size.z) / 2;
    this.rig.fit(new THREE.Box3(new THREE.Vector3(-r * 0.8, 0, -r * 0.8), new THREE.Vector3(r * 0.8, size.y, r * 0.8)));
    this.syncBlob();
    // the reflection (high only): a shallow clone sharing geometry + materials, minus its lights, drawn before the floor
    if (this.sh.layer.quality() === 'high') {
      const clone = car.root.clone(true);
      const lights: THREE.Object3D[] = [];
      clone.traverse((o) => {
        if ((o as THREE.Light).isLight) lights.push(o);
        const m = o as THREE.Mesh;
        m.castShadow = false;
        m.receiveShadow = false;
        m.renderOrder = -3;
      });
      lights.forEach((l) => l.removeFromParent());
      this.clone = clone;
      this.spinR.add(clone);
    }
    const R = Math.max(this.dims.L, this.dims.W) * 1.25;
    this.floor.scale.set(R, R, 1);
    this.framed = false;
  }

  /** look's contact blob is sized for yaw 0: keep it under the car as it turns. */
  private syncBlob() {
    const blob = this.scene.getObjectByName('contactShadow');
    if (!blob) return;
    blob.scale.set(this.dims.L / 4.6, this.dims.W / 1.9, 1);
    blob.position.set(0, 0.004, 0);
    blob.rotation.set(-Math.PI / 2, 0, this.yaw);
  }

  private revealIn() {
    this.revealT = 0;
    this.spotK = 1;
    this.yaw = this.yaw0 - Math.PI * 2.6;
    this.flash(1);
    this.inT = 0;
    this.inFrom = 1.45;
  }

  /** Fit the camera distance so the car (over its yaw range, plus floor room) fills the focus rect. */
  private frameCar() {
    const cam = this.camera;
    const f = this.focus;
    cam.aspect = f.w / f.h;
    cam.fov = this.opts.fov ?? 26;
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    const { L, W, H } = this.dims;
    const el = this.opts.elevation ?? 0.2;
    const fill = this.opts.fill ?? 0.9;
    const yaws: number[] = [];
    if (this.mode === 'hero') for (const d of [-0.16, -0.08, 0, 0.08, 0.16]) yaws.push(this.yaw0 + d);
    else for (let i = 0; i < 16; i++) yaws.push((i / 16) * Math.PI * 2);
    // the real silhouette (sampled body points) plus a little floor room under the wheels for the shadow/reflection
    const corners: THREE.Vector3[] = this.outline.length ? this.outline.slice() : [];
    for (const x of [-L / 2, L / 2]) for (const z of [-W / 2, W / 2]) corners.push(new THREE.Vector3(x * 0.85, -0.06 * H, z * 0.85));
    if (!this.outline.length) for (const x of [-L / 2, L / 2]) for (const z of [-W / 2, W / 2]) corners.push(new THREE.Vector3(x, H, z));
    const dir = new THREE.Vector3(0, Math.sin(el), Math.cos(el));
    this.target.set(0, H * 0.42, 0);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const measure = (d: number) => {
      cam.position.copy(this.target).addScaledVector(dir, d);
      cam.lookAt(this.target);
      cam.updateMatrixWorld();
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const yw of yaws) {
        q.setFromAxisAngle(up, yw);
        for (const c of corners) {
          p.copy(c).applyQuaternion(q).project(cam);
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          y0 = Math.min(y0, p.y);
          y1 = Math.max(y1, p.y);
        }
      }
      return { x0, x1, y0, y1 };
    };
    for (let pass = 0; pass < 2; pass++) {
      let lo = 1;
      let hi = 80;
      for (let i = 0; i < 22; i++) {
        const mid = (lo + hi) / 2;
        const m = measure(mid);
        if (Math.max((m.x1 - m.x0) / 2, (m.y1 - m.y0) / 2) > fill) lo = mid;
        else hi = mid;
      }
      this.dist = hi;
      // re-centre vertically: shift the target so the projected box is centred in the focus rect
      const m = measure(this.dist);
      this.target.y += ((m.y0 + m.y1) / 2) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * this.dist;
    }
    cam.position.copy(this.target).addScaledVector(dir, this.dist);
    cam.lookAt(this.target);
    // render the whole rect, with the nominal frustum on the focus rect
    const r = this.rect;
    cam.setViewOffset(f.w, f.h, r.x - f.x, r.y - f.y, r.w, r.h);
    cam.updateProjectionMatrix();
    const u = this.back.material.uniforms;
    u.uAspect.value.set(r.w / r.h, 1);
    const gx = (f.x + f.w / 2 - r.x) / r.w;
    u.uGlowPos.value.set(gx, 1 - (f.y + f.h * 0.55 - r.y) / r.h);
    u.uHorizon.value = THREE.MathUtils.clamp(1 - (f.y + f.h * 0.7 - r.y) / r.h, 0.15, 0.85);
    const ou = this.over.material.uniforms;
    ou.uAspect.value.set(r.w / r.h, 1);
    ou.uPos.value.set(gx, 1 - (f.y + f.h * 0.5 - r.y) / r.h);
    this.framed = true;
  }

  private applyQuality() {
    const q = this.sh.layer.quality();
    if (q === this.quality) return;
    this.quality = q;
    this.mirror.visible = q === 'high';
  }

  tick(dt: number) {
    if (this.dead) return;
    this.t += dt;
    this.back.material.uniforms.uTime.value = this.t;
    // swap: squash the old car into the floor, then spring the new one up
    if (this.swapT >= 0) {
      this.swapT += dt;
      const k = Math.min(1, this.swapT / 0.12);
      this.flashK = Math.max(this.flashK, k * 0.55);
      if (k >= 1 && this.next) {
        this.install(this.next);
        this.next = null;
        this.swapT = -1;
        this.inT = 0;
        this.inFrom = 0.7;
      }
    }
    // yaw
    if (this.mode === 'hero' && !this.dragging) {
      const want = this.yaw0 + Math.sin(this.t * 0.5) * 0.1;
      this.yaw += (want - this.yaw) * Math.min(1, dt * 1.6);
    } else if (!this.dragging) {
      this.idle += dt;
      const auto = this.mode === 'reveal' ? 0.45 : 0.3;
      const blend = this.idle > 1.6 ? Math.min(1, dt * 1.2) : dt * 0.25;
      this.yawVel += (auto - this.yawVel) * blend;
      this.yaw += this.yawVel * dt;
    }
    if (this.revealT < 9) {
      // spin in: wind off ~1.3 turns with a hard ease-out onto the hero angle, then keep turning slowly
      this.revealT += dt;
      const k = Math.min(1, this.revealT / 1.25);
      this.yaw = this.yaw0 - Math.PI * 2.6 * Math.pow(1 - k, 4);
      this.yawVel = 0.45;
      if (k >= 1) this.revealT = 9;
    }
    this.spotK = Math.max(0, this.spotK - dt * 0.5);
    this.spot.intensity = 70 * this.spotK + (this.mode === 'reveal' ? 10 : 0);
    // scale: enter spring, swap squash, install pop
    let sx = 1;
    let sy = 1;
    this.inT += dt;
    if (this.inT < 1.2) sx = sy = 1 - (1 - this.inFrom) * Math.exp(-7 * this.inT) * Math.cos(13 * this.inT);
    if (this.swapT >= 0) {
      const k = Math.min(1, this.swapT / 0.12);
      sy *= 1 - 0.96 * k * k;
      sx *= 1 + 0.12 * k;
    }
    this.popT += dt;
    let bounce = 0;
    if (this.popT < 1) {
      const w = this.popAmp * Math.exp(-6 * this.popT) * Math.cos(18 * this.popT);
      sx *= 1 + w;
      sy *= 1 + w;
      bounce = -Math.abs(this.popAmp) * 0.6 * Math.exp(-8 * this.popT) * Math.sin(20 * this.popT);
      this.car?.setSuspension(-bounce * 0.25, 0, bounce * 0.6);
    }
    this.spin.scale.set(sx, sy, sx);
    this.spin.rotation.y = this.yaw;
    let jx = 0;
    let jz = 0;
    this.spin.rotation.z = 0;
    if (this.shakeAmp > 0) {
      jx = (Math.random() * 2 - 1) * this.shakeAmp * 0.012;
      jz = (Math.random() * 2 - 1) * this.shakeAmp * 0.006;
      this.spin.rotation.z = (Math.random() * 2 - 1) * this.shakeAmp * 0.004;
    }
    this.spin.position.set(jx, Math.max(0, bounce), jz);
    this.spinR.position.copy(this.spin.position);
    this.spinR.rotation.copy(this.spin.rotation);
    this.spinR.scale.copy(this.spin.scale);
    this.syncBlob();
    this.car?.update(dt);
    // light + overlays
    this.flashK = Math.max(0, this.flashK - dt * 3.2);
    const ou = this.over.material.uniforms;
    ou.uFlash.value = this.flashK * 0.85;
    ou.uHeat.value = this.heat * 1.6;
    this.over.visible = this.flashK > 0.002 || this.heat > 0.002;
    this.rig.key.intensity = this.keyBase * (1 + this.flashK * 1.5 + this.heat * 2);
  }

  render(r: THREE.WebGLRenderer, k: number, bh: number) {
    if (this.dead || !this.car) return;
    this.applyQuality();
    if (!this.framed) this.frameCar();
    const sh = this.opts.shake?.() ?? { x: 0, y: 0 };
    this.lastShake = sh;
    const rc = this.rect;
    const x0 = Math.round((rc.x - sh.x) * k);
    const x1 = Math.round((rc.x + rc.w - sh.x) * k);
    const y0 = Math.round(bh - (rc.y + rc.h - sh.y) * k);
    const y1 = Math.round(bh - (rc.y - sh.y) * k);
    if (x1 - x0 < 2 || y1 - y0 < 2) return;
    r.setViewport(x0, y0, x1 - x0, y1 - y0);
    r.setScissor(x0, y0, x1 - x0, y1 - y0);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    if (this.firstCbs.length) {
      const cbs = this.firstCbs;
      this.firstCbs = [];
      cbs.forEach((cb) => cb());
    }
  }
}
