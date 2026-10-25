// Lighting rigs for the 3D mode.
//   raceLighting(scene, { envMap?, renderer?, quality? }): night stadium key (shadow caster fitted tightly around the
//     player via follow()), cool rim from down-track, warm fill, hemisphere, + a procedural night env map fallback.
//   studioLighting(scene, { renderer, floor?, quality?, background? }): showroom softboxes (as env-map reflections +
//     matching direct lights), rim lights, reflective/matte floor with a shadow catcher and a contact blob.
// Intensities are physical (r169 default): directional = lux-ish, tuned for ACES at exposure 1.
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { Quality } from '../../game/settings';

const SHADOW_MAP: Record<Quality, number> = { low: 1024, medium: 2048, high: 4096 };

// ---------------------------------------------------------------------------------------------------------------
// Procedural env maps (PMREM). Bright emissive panels in a dark room: what paint and glass reflect.

function softPanelTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 90);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.55, '#f0f0f0');
  grd.addColorStop(0.8, '#808080');
  grd.addColorStop(1, '#000000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.LinearSRGBColorSpace;
  return t;
}

/** Strip-light texture: a bright core across the short (V) axis with quick falloff, soft fade at the ends (U). */
function stripTex(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  const across = g.createLinearGradient(0, 0, 0, 64);
  across.addColorStop(0, '#000');
  across.addColorStop(0.28, '#9a9a9a');
  across.addColorStop(0.4, '#fff');
  across.addColorStop(0.6, '#fff');
  across.addColorStop(0.72, '#9a9a9a');
  across.addColorStop(1, '#000');
  g.fillStyle = across;
  g.fillRect(0, 0, 256, 64);
  const ends = g.createLinearGradient(0, 0, 256, 0);
  ends.addColorStop(0, 'rgba(0,0,0,1)');
  ends.addColorStop(0.08, 'rgba(0,0,0,0)');
  ends.addColorStop(0.92, 'rgba(0,0,0,0)');
  ends.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = ends;
  g.fillRect(0, 0, 256, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.LinearSRGBColorSpace;
  return t;
}

function panel(w: number, h: number, color: THREE.ColorRepresentation, intensity: number, tex?: THREE.Texture) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), map: tex ?? null, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

function gradientDome(top: THREE.ColorRepresentation, horizon: THREE.ColorRepresentation, bottom: THREE.ColorRepresentation, radius = 400) {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { cTop: { value: new THREE.Color(top) }, cHor: { value: new THREE.Color(horizon) }, cBot: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 cTop, cHor, cBot; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(cHor, cTop, pow(y, 0.6)) : mix(cHor, cBot, pow(-y, 0.4)); gl_FragColor = vec4(c, 1.0); }',
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), m);
}

function disposeScene(s: THREE.Object3D) {
  s.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

/** Night drag strip: dark sky, light-tower banks down both sides, warm sodium city glow, a lit asphalt pad. */
export function nightEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();
  s.add(gradientDome('#03040a', '#141a2c', '#050505'));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshBasicMaterial({ color: new THREE.Color('#1a1a1c').multiplyScalar(0.35) }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  s.add(ground);
  const tex = softPanelTex();
  // Light towers: a 3x2 bank of lamp heads every 45 m, both sides, 22 m up, aimed at the strip.
  for (const side of [-1, 1])
    for (let x = -90; x <= 360; x += 45) {
      const bank = new THREE.Group();
      for (let i = 0; i < 3; i++)
        for (let j = 0; j < 2; j++) {
          const p = panel(1.5, 1.1, '#e8eeff', 55, tex);
          p.position.set((i - 1) * 1.7, j * 1.3, 0);
          bank.add(p);
        }
      bank.position.set(x, 22, side * 24);
      bank.lookAt(x, 0, 0);
      s.add(bank);
      // the lit pool on the strip under each tower
      const pool = panel(30, 18, '#c8ccd8', 0.5, tex);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x, -0.45, side * 8);
      s.add(pool);
    }
  // Grandstand fascia + scoreboard glow, low and broad.
  for (const side of [-1, 1]) {
    const stand = panel(260, 6, '#2a3044', 0.6);
    stand.position.set(90, 5, side * 30);
    stand.lookAt(90, 5, 0);
    s.add(stand);
  }
  const board = panel(14, 5, '#ffb040', 6, tex);
  board.position.set(420, 9, -12);
  board.lookAt(0, 5, 0);
  s.add(board);
  // Distant sodium city glow on the horizon.
  const city = panel(900, 14, '#ff9a40', 0.9, tex);
  city.position.set(0, 4, -380);
  s.add(city);
  const city2 = city.clone();
  city2.position.set(0, 4, 380);
  city2.rotation.y = Math.PI;
  s.add(city2);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0, 0.1, 1000).texture;
  pm.dispose();
  disposeScene(s);
  tex.dispose();
  return env;
}

/** Showroom: one big overhead softbox, two tall side strips, a rear rim strip, a dim front card, a dark cyclorama. */
/** o.omit (debug/look dev): skip env elements by name: dome, floor, top, side, side2, rim, card. */
export function studioEnvMap(renderer: THREE.WebGLRenderer, o: { omit?: string[] } = {}): THREE.Texture {
  const s = new THREE.Scene();
  const add = (name: string, m: THREE.Object3D) => {
    if (!o.omit?.includes(name)) s.add(m);
    else disposeScene(m);
  };
  add('dome', gradientDome('#1a1a20', '#2c2c34', '#101014', 40));
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshBasicMaterial({ color: new THREE.Color('#202026').multiplyScalar(0.5) }));
  floor.rotation.x = -Math.PI / 2;
  add('floor', floor);
  const tex = softPanelTex();
  // Overhead: four narrow strip lights along the car with dark gaps, so flat glass and hoods show crisp streaks
  // instead of one white sheet.
  const stex = stripTex();
  for (const z of [-2.1, -0.7, 0.7, 2.1]) {
    const top = panel(6.5, 0.3, '#fff8f0', 3.6, stex);
    top.rotation.x = Math.PI / 2;
    top.position.set(0, 5.6, z);
    add('top', top);
  }
  // Tall side strips, hard-cored like the overhead ones (a radial glow here reflects as a white cloud on raked
  // windshields and flat hoods). Built long along X, then stood up.
  for (const z of [-5.5, 5.5]) {
    const strip = panel(3.6, 0.4, '#f4f6ff', 3.2, stex);
    strip.position.set(0.6, 2.2, z);
    strip.lookAt(0, 0.8, 0);
    strip.rotateZ(Math.PI / 2);
    add('side', strip);
    const strip2 = panel(3, 0.3, '#f4f6ff', 2.2, stex);
    strip2.position.set(-3.4, 2.0, z * 0.85);
    strip2.lookAt(0, 0.8, 0);
    strip2.rotateZ(Math.PI / 2);
    add('side2', strip2);
  }
  const rim = panel(6, 0.6, '#dfe8ff', 6, tex);
  rim.position.set(-7, 2.6, 0);
  rim.lookAt(0, 0.6, 0);
  add('rim', rim);
  const card = panel(5, 1.6, '#ffe8d0', 2.2, tex);
  card.position.set(7, 1.4, 1.5);
  card.lookAt(0, 0.7, 0);
  add('card', card);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(s, 0, 0.1, 100).texture;
  pm.dispose();
  disposeScene(s);
  tex.dispose();
  stex.dispose();
  return env;
}

// ---------------------------------------------------------------------------------------------------------------
// Contact shadow: a soft ambient-occlusion blob under a car (multiply-blended so it darkens asphalt or floor).

let blobTex: THREE.Texture | null = null;
function contactTex() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 64, 0, 128, 64, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.92)');
  grd.addColorStop(0.45, 'rgba(0,0,0,0.75)');
  grd.addColorStop(0.75, 'rgba(0,0,0,0.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.setTransform(1, 0, 0, 0.5, 0, 32);
  g.fillStyle = grd;
  g.fillRect(0, -64, 256, 256);
  blobTex = new THREE.CanvasTexture(c);
  blobTex.userData.shared = true;
  return blobTex;
}

/** A contact-shadow plane for a car of the given footprint (add it to the car root at y ~ 0.005). */
export function contactShadow(length: number, width: number, strength = 0.85): THREE.Mesh {
  const m = new THREE.MeshBasicMaterial({ map: contactTex(), transparent: true, opacity: strength, depthWrite: false, color: 0x000000 });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.ZeroFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length * 1.18, width * 1.45), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.006;
  mesh.renderOrder = -1;
  mesh.name = 'contactShadow';
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------
// Shadow fitting

function fitShadow(light: THREE.DirectionalLight, target: THREE.Vector3, radius: number, dir: THREE.Vector3, dist = 40) {
  const cam = light.shadow.camera;
  cam.left = -radius;
  cam.right = radius;
  cam.top = radius;
  cam.bottom = -radius;
  cam.near = Math.max(0.5, dist - radius * 2.5);
  cam.far = dist + radius * 2.5;
  cam.updateProjectionMatrix();
  // Snap the centre to shadow texels (in light space) so the map doesn't shimmer while the target moves.
  const texel = (2 * radius) / light.shadow.mapSize.x;
  // Same basis as the shadow camera (lookAt from +dir with +Y up).
  const rot = new THREE.Matrix4().lookAt(dir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const inv = rot.clone().transpose();
  const p = target.clone().applyMatrix4(inv);
  p.x = Math.round(p.x / texel) * texel;
  p.y = Math.round(p.y / texel) * texel;
  p.applyMatrix4(rot);
  light.target.position.copy(p);
  light.position.copy(p).addScaledVector(dir, dist);
  light.target.updateMatrixWorld();
  light.updateMatrixWorld();
}

function setupShadow(light: THREE.DirectionalLight, q: Quality) {
  light.castShadow = true;
  light.shadow.mapSize.set(SHADOW_MAP[q], SHADOW_MAP[q]);
  light.shadow.bias = -0.00025;
  light.shadow.normalBias = 0.025;
  light.shadow.radius = q === 'high' ? 3 : 2;
}

// ---------------------------------------------------------------------------------------------------------------
// Race (night stadium)

export interface RaceRig {
  key: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  rim: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  envMap: THREE.Texture | null;
  /** Fit the shadow frustum around a world point (the player car), radius in metres (covers both lanes at ~9). */
  follow(target: THREE.Vector3, radius?: number): void;
  /** Scale the direct lights (e.g. env.lightAt(x, z) under the towers vs between them). */
  setLevel(k: number): void;
  setQuality(q: Quality): void;
  dispose(): void;
}

export function raceLighting(
  scene: THREE.Scene,
  o: { envMap?: THREE.Texture | null; renderer?: THREE.WebGLRenderer; quality?: Quality; envIntensity?: number } = {},
): RaceRig {
  const q = o.quality ?? 'high';
  const group = new THREE.Group();
  group.name = 'raceLighting';
  // Stadium key: high and off to the far (ghost) side, so shadows fall short and toward the camera lane.
  const keyDir = new THREE.Vector3(0.25, 1, -0.55).normalize();
  const key = new THREE.DirectionalLight(0xe9efff, 2.6);
  setupShadow(key, q);
  key.shadow.mapSize.set(SHADOW_MAP[q], SHADOW_MAP[q]);
  const fillDir = new THREE.Vector3(-0.4, 0.7, 0.6).normalize();
  const fill = new THREE.DirectionalLight(0xffe2c4, 0.55);
  const rimDir = new THREE.Vector3(1, 0.45, 0.1).normalize();
  const rim = new THREE.DirectionalLight(0xc8d8ff, 1.1);
  const hemi = new THREE.HemisphereLight(0x33405e, 0x17130f, 0.5);
  group.add(key, key.target, fill, fill.target, rim, rim.target, hemi);
  scene.add(group);
  let level = 1;
  const base = { key: key.intensity, fill: fill.intensity, rim: rim.intensity };
  const own = !o.envMap && o.renderer ? nightEnvMap(o.renderer) : null;
  const envMap = o.envMap ?? own;
  const prevEnv = scene.environment;
  if (envMap) {
    scene.environment = envMap;
    scene.environmentIntensity = o.envIntensity ?? 1;
  }
  const rig: RaceRig = {
    key,
    fill,
    rim,
    hemi,
    envMap,
    follow(target, radius = 9) {
      fitShadow(key, target, radius, keyDir);
      fill.target.position.copy(target);
      fill.position.copy(target).addScaledVector(fillDir, 30);
      rim.target.position.copy(target);
      rim.position.copy(target).addScaledVector(rimDir, 30);
      fill.target.updateMatrixWorld();
      rim.target.updateMatrixWorld();
    },
    setLevel(k) {
      level = k;
      key.intensity = base.key * level;
      fill.intensity = base.fill * (0.6 + 0.4 * level);
      rim.intensity = base.rim * level;
    },
    setQuality(nq) {
      key.shadow.mapSize.set(SHADOW_MAP[nq], SHADOW_MAP[nq]);
      key.shadow.map?.dispose();
      key.shadow.map = null;
      key.shadow.radius = nq === 'high' ? 3 : 2;
    },
    dispose() {
      scene.remove(group);
      key.shadow.map?.dispose();
      key.dispose();
      fill.dispose();
      rim.dispose();
      hemi.dispose();
      if (scene.environment === envMap) scene.environment = prevEnv;
      own?.dispose();
    },
  };
  rig.follow(new THREE.Vector3(0, 0, 0));
  return rig;
}

// ---------------------------------------------------------------------------------------------------------------
// Studio (showroom turntable)

export interface StudioRig {
  envMap: THREE.Texture | null;
  key: THREE.DirectionalLight;
  floor: THREE.Object3D | null;
  /** Size the shadow frustum + contact blob to an object (call after the car is placed). */
  fit(obj: THREE.Object3D | THREE.Box3): void;
  dispose(): void;
}

const FLOOR_VS = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec2 vP;
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FLOOR_FS = /* glsl */ `
uniform vec3 color;
uniform vec3 uBase;
uniform vec3 uBg;
uniform float uRefl;
uniform float uFade;
uniform float uBlur;
uniform sampler2D tDiffuse;
varying vec4 vUv;
varying vec2 vP;
void main() {
  vec2 uv = vUv.xy / vUv.w;
  vec3 r = vec3(0.0);
  float b = uBlur;
  r += texture2D(tDiffuse, uv).rgb * 0.36;
  r += texture2D(tDiffuse, uv + vec2(b, 0.0)).rgb * 0.16;
  r += texture2D(tDiffuse, uv - vec2(b, 0.0)).rgb * 0.16;
  r += texture2D(tDiffuse, uv + vec2(0.0, b)).rgb * 0.16;
  r += texture2D(tDiffuse, uv - vec2(0.0, b)).rgb * 0.16;
  float d = length(vP);
  float fade = 1.0 - smoothstep(uFade * 0.35, uFade, d);
  float pool = exp(-d * d / 9.0);
  vec3 c = uBase * (0.6 + 2.2 * pool) + r * uRefl * color * (0.5 + 0.5 * pool);
  gl_FragColor = vec4(mix(uBg, c, fade), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function studioLighting(
  scene: THREE.Scene,
  o: { renderer?: THREE.WebGLRenderer; floor?: 'reflective' | 'matte' | 'none'; quality?: Quality; background?: THREE.ColorRepresentation | null; envOmit?: string[] } = {},
): StudioRig {
  const q = o.quality ?? 'high';
  const floorKind = o.floor ?? (q === 'low' ? 'matte' : 'reflective');
  const bg = new THREE.Color(o.background === undefined ? '#0e0d15' : (o.background ?? '#0e0d15'));
  const group = new THREE.Group();
  group.name = 'studioLighting';
  const keyDir = new THREE.Vector3(0.35, 1, 0.45).normalize();
  const key = new THREE.DirectionalLight(0xfff6ec, 1.8);
  setupShadow(key, q === 'low' ? 'medium' : 'high');
  const rimL = new THREE.DirectionalLight(0xdce6ff, 0.7);
  rimL.position.set(-5, 6, 3.5);
  const rimR = new THREE.DirectionalLight(0xdce6ff, 0.7);
  rimR.position.set(-5, 6, -3.5);
  const fill = new THREE.DirectionalLight(0xffeedd, 0.35);
  fill.position.set(6, 1.5, 2);
  const hemi = new THREE.HemisphereLight(0x8890a8, 0x18161c, 0.25);
  group.add(key, key.target, rimL, rimR, fill, hemi);

  let floor: THREE.Object3D | null = null;
  const disposables: { dispose(): void }[] = [];
  const shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(9, 64), new THREE.ShadowMaterial({ opacity: 0.55, depthWrite: false }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.position.y = 0.002;
  shadowCatcher.receiveShadow = true;
  shadowCatcher.renderOrder = 1;
  disposables.push(shadowCatcher.geometry, shadowCatcher.material);
  const blob = contactShadow(4.6, 1.9, 0.8);
  blob.position.y = 0.004;
  disposables.push(blob.geometry, blob.material as THREE.Material);

  if (floorKind === 'reflective') {
    const res = q === 'high' ? 1024 : 512;
    const refl = new Reflector(new THREE.CircleGeometry(12, 64), {
      textureWidth: res,
      textureHeight: res,
      clipBias: 0.002,
      color: 0xffffff,
      multisample: q === 'high' ? 4 : 0,
      shader: {
        name: 'StudioFloor',
        uniforms: {
          color: { value: new THREE.Color(1, 1, 1) },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
          uBase: { value: new THREE.Color('#1c1b22').multiplyScalar(0.55) },
          uBg: { value: bg.clone() },
          uRefl: { value: 0.1 },
          uFade: { value: 9 },
          uBlur: { value: 0.004 },
        },
        vertexShader: FLOOR_VS,
        fragmentShader: FLOOR_FS,
      },
    });
    refl.rotation.x = -Math.PI / 2;
    floor = refl;
    disposables.push(refl);
  } else if (floorKind === 'matte') {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 30, 128, 128, 128);
    grd.addColorStop(0, '#2a2930');
    grd.addColorStop(1, '#' + bg.getHexString(THREE.SRGBColorSpace));
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0 });
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(12, 64), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    floor = mesh;
    disposables.push(mesh.geometry, m, t);
  }
  if (floor) group.add(floor);
  // Cyclorama: a dark dome whose horizon matches the floor's fade colour (skipped when background === null).
  if (o.background !== null) {
    const dome = gradientDome('#050508', '#' + bg.getHexString(), '#' + bg.getHexString(), 30);
    dome.renderOrder = -2;
    group.add(dome);
    disposables.push(dome.geometry, dome.material as THREE.Material);
  }
  if (floorKind !== 'matte') group.add(shadowCatcher);
  group.add(blob);
  scene.add(group);

  const own = o.renderer ? studioEnvMap(o.renderer, { omit: o.envOmit }) : null;
  const prevEnv = scene.environment;
  const prevBg = scene.background;
  if (own) {
    scene.environment = own;
    scene.environmentIntensity = 1;
  }
  if (o.background !== null) scene.background = bg;

  const rig: StudioRig = {
    envMap: own,
    key,
    floor,
    fit(obj) {
      const box = obj instanceof THREE.Box3 ? obj : new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(size.x, size.z) * 0.62 + 0.4;
      fitShadow(key, new THREE.Vector3(c.x, 0, c.z), r, keyDir, 20);
      blob.scale.set(size.x / 4.6, size.z / 1.9, 1);
      blob.position.set(c.x, 0.004, c.z);
    },
    dispose() {
      scene.remove(group);
      key.shadow.map?.dispose();
      [key, rimL, rimR, fill, hemi].forEach((l) => l.dispose());
      disposables.forEach((d) => d.dispose());
      if (scene.environment === own) scene.environment = prevEnv;
      if (o.background !== null) scene.background = prevBg;
      own?.dispose();
    },
  };
  rig.fit(new THREE.Box3(new THREE.Vector3(-2.3, 0, -0.95), new THREE.Vector3(2.3, 1.4, 0.95)));
  return rig;
}
