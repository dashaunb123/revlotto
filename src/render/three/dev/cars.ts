// THE shared 3D car viewer (dev only): any body x tier x paragon x livery under studio light.
//   /src/render/three/dev/cars.html?body=muscle&tier=sport&view=34&spin=1
// Params: body, tier (all parts) or per-part tires/aero/exhaust/intake/fi/engine/susp, nitrous=0|1, carbon=0|1, paragon,
// paint/accent/rim (#hex), livery, number, view (34|r34|side|front|rear|top|wheel|wheelr|low|hood|under), spin=1, lights=1,
// nitro=1, wheelie (rad), steer (rad), roll (wheel rad/s), quality, hud=0, post=0, bg=studio|black.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Tier } from '../../../core/types';
import { PARAGON_IDS, paragonVisual, type BodyType, type CarVisual, type LiveryId } from '../../car';
import { buildCar3D, specFromVisual, type KitCar3D } from '../cars/index';
import type { CarSpec } from '../types';

type Mod = Record<string, unknown>;
const lightingMod = Object.values(import.meta.glob('../lighting.ts', { eager: true }))[0] as Mod | undefined;
const postMod = Object.values(import.meta.glob('../post.ts', { eager: true }))[0] as Mod | undefined;

const BODIES: BodyType[] = ['compact', 'sedan', 'hatch', 'truck', 'muscle', 'brick', 'widebody', 'super', 'tuner', 'wedge', 'hyper'];
const TIERS: Tier[] = ['stock', 'street', 'sport', 'pro'];
const VIEWS = ['34', 'r34', 'side', 'front', 'rear', 'top', 'wheel', 'wheelr', 'low', 'hood', 'under', 'chute'];

const q = new URLSearchParams(location.search);
const params: Record<string, string> = Object.fromEntries(q.entries());
const qp = (k: string, d = '') => params[k] ?? d;
if (qp('hud') === '0') document.body.classList.add('clean');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
const quality = qp('quality', 'high');
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.6, 0);

// ---- Studio: Look's rig when it lands, else a simple fallback (room env + key/rim lights + floor) ----
let rigDispose: (() => void) | undefined;
const studio = lightingMod?.studioLighting as ((s: THREE.Scene, o: Record<string, unknown>) => unknown) | undefined;
if (studio) {
  const rig = studio(scene, { renderer, floor: qp("floor", "reflective"), quality }) as { dispose?: () => void } | undefined;
  rigDispose = rig?.dispose?.bind(rig);
} else {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  scene.background = new THREE.Color(qp('bg') === 'black' ? 0x000000 : 0x14121c);
  const key = new THREE.DirectionalLight(0xfff4e8, 2.4);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ab8ff, 1.2);
  rim.position.set(-5, 3, -4);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0x4a4866, 0x0c0b10, 0.5));
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(30, 64),
    new THREE.MeshStandardMaterial({ color: 0x1a1922, roughness: 0.55, metalness: 0.0 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
}
if (qp('bg') === 'black') scene.background = new THREE.Color(0x000000);

// ---- Spec from params ----
function tierP(k: string, d: Tier): Tier {
  const v = params[k];
  return (TIERS as string[]).includes(v) ? (v as Tier) : d;
}
function specFromParams(): CarSpec {
  const pg = qp('paragon');
  if (pg && PARAGON_IDS.includes(pg)) {
    const v = paragonVisual(pg) as CarVisual;
    return specFromVisual(v);
  }
  const t = tierP('tier', 'stock');
  const body = (BODIES as string[]).includes(qp('body')) ? (qp('body') as BodyType) : 'muscle';
  const hi = TIERS.indexOf(t);
  const v: CarVisual = {
    body,
    color: qp('paint', '#e8413c'),
    accent: qp('accent', '#f7d23e'),
    rim: params.rim,
    livery: (qp('livery', 'none') as LiveryId) || 'none',
    number: +qp('number', '0'),
    tires: tierP('tires', t),
    aero: tierP('aero', t),
    exhaust: tierP('exhaust', t),
    intake: tierP('intake', t),
    forcedInduction: tierP('fi', t),
    engine: tierP('engine', t),
    suspension: tierP('susp', t),
    nitrous: params.nitrous ? params.nitrous === '1' : hi >= 2,
    carbon: params.carbon ? params.carbon === '1' : hi >= 3,
  };
  if (qp('opp') === '1') {
    // opponent-style visual (no rim/livery): exercises opponent plates
    delete v.rim;
    delete v.livery;
  }
  return specFromVisual(v, params.plate ? { plate: params.plate } : {});
}

let car: KitCar3D | null = null;
let spinAngle = 0;
const t0 = performance.now();
function rebuild() {
  if (car) {
    scene.remove(car.root);
    car.dispose();
  }
  const spec = specFromParams();
  car = buildCar3D(spec, { quality: quality as 'low' | 'medium' | 'high', lights: qp('dyn', 'auto') as 'auto' | 'none' | 'full' });
  car.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  scene.add(car.root);
  car.prewarm(renderer, camera, scene);
  car.setBrakeLights(qp('lights') === '1' || qp('brake') === '1');
  car.setHeadlights(qp('lights') === '1' || qp('head') === '1');
  car.setNitro(qp('nitro') === '1');
  car.setWheelie(+qp('wheelie', '0'));
  car.setSteer(+qp('steer', '0'));
  const roll = +qp('roll', '0');
  car.setWheelSpin(roll, roll);
  car.setSuspension(+qp('pitch', '0'), +qp('bodyroll', '0'), +qp('squat', '0'));
  if (qp('chute')) car.setChute(+qp('chute'));
  setView(qp('view', '34'));
  hudSpec = spec;
}
let hudSpec: CarSpec | null = null;

function setView(v: string) {
  if (!car) return;
  params.view = v;
  const d = car.build.dims;
  const L = Math.max(d.length, 3.6);
  const A = car.build.anchors;
  const t = new THREE.Vector3(0, d.height * 0.45, 0);
  const p = new THREE.Vector3();
  const s = L / 4.6;
  switch (v) {
    case 'side': p.set(0, 1.0, 10.5 * s); break;
    case 'front': p.set(9.5 * s, 1.2, 0); break;
    case 'rear': p.set(-9.5 * s, 1.3, 0); break;
    case 'r34': p.set(-6.8 * s, 2.0, 6.4 * s); break;
    case 'top': p.set(0, 12 * s, 0.01); t.y = 0; break;
    case 'low': p.set(5.2 * s, 0.32, 4.6 * s); t.y = d.height * 0.35; break;
    case 'hood': p.set(A.hood.x + 2.6, A.hood.y + 2.2, 2.4); t.copy(A.hood); break;
    case 'under': p.set(-2.8 * s, 0.25, 4.0 * s); t.set(-L * 0.35, 0.25, 0); break;
    case 'chute': p.set(-1.5, 2.2, 11.5); t.set(-L / 2 - 2.6, 0.7, 0); break;
    case 'wheel': {
      const w = car.wheelCentre(car.wheelCentre(0).z > 0 ? 0 : 1);
      t.copy(w);
      p.set(w.x + 0.55, w.y + 0.18, w.z + 1.55);
      break;
    }
    case 'wheelr': {
      const w = car.wheelCentre(car.wheelCentre(2).z > 0 ? 2 : 3);
      t.copy(w);
      p.set(w.x - 0.55, w.y + 0.18, w.z + 1.55);
      break;
    }
    default: p.set(6.8 * s, 1.9, 6.4 * s);
  }
  camera.position.copy(p);
  controls.target.copy(t);
  controls.update();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer?.setSize?.(w, h);
}

// ---- Post (Look's composer when it lands) ----
type Composer = { render: (dt?: number) => void; setSize?: (w: number, h: number) => void; dispose?: () => void };
let composer: Composer | null = null;
const mk = postMod?.createComposer as ((...a: unknown[]) => Composer) | undefined;
if (mk && qp('post') !== '0') {
  try {
    composer = mk(renderer, scene, camera, quality);
  } catch (e) {
    console.warn('composer failed', e);
  }
}

rebuild();
resize();
window.addEventListener('resize', resize);

let spin = qp('spin') === '1';
let rolling = +qp('roll', '0');
let lights = qp('lights') === '1';
let nitro = qp('nitro') === '1';
let wheelie = +qp('wheelie', '0');
const navTo = (k: string, v: string) => {
  params[k] = v;
  const u = new URLSearchParams(params);
  history.replaceState(null, '', '?' + u.toString());
  rebuild();
};
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '4') {
    delete params.paragon;
    navTo('tier', TIERS[+k - 1]);
  } else if (k === 'b') {
    delete params.paragon;
    navTo('body', BODIES[(BODIES.indexOf(qp('body', 'muscle') as BodyType) + 1) % BODIES.length]);
  } else if (k === 'p') navTo('paragon', PARAGON_IDS[(PARAGON_IDS.indexOf(qp('paragon')) + 1) % PARAGON_IDS.length]);
  else if (k === 'v') setView(VIEWS[(VIEWS.indexOf(qp('view', '34')) + 1) % VIEWS.length]);
  else if (k === 's') spin = !spin;
  else if (k === 'r') {
    rolling = rolling ? 0 : 80;
    car?.setWheelSpin(rolling, rolling);
  } else if (k === 'l') {
    lights = !lights;
    car?.setBrakeLights(lights);
    car?.setHeadlights(lights);
  } else if (k === 'n') {
    nitro = !nitro;
    car?.setNitro(nitro);
  } else if (k === 'w') {
    wheelie = wheelie ? 0 : 0.12;
    car?.setWheelie(wheelie);
  }
});

const hud = document.getElementById('hud') as HTMLDivElement;
let last = performance.now();
let frames = 0;
let fps = 0;
let fpsT = last;
function countTris(o: THREE.Object3D): number {
  let n = 0;
  o.traverseVisible((x) => {
    const g = (x as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!(x as THREE.Mesh).isMesh || !g) return;
    const c = g.index ? g.index.count : g.attributes.position.count;
    n += c / 3 * ((x as THREE.InstancedMesh).count ?? 1);
  });
  return Math.round(n);
}
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (car) {
    if (spin) {
      spinAngle += dt * 0.5;
      car.root.rotation.y = spinAngle;
    }
    car.update(dt);
  }
  controls.update();
  if (composer) composer.render(dt);
  else renderer.render(scene, camera);
  frames++;
  if (now - fpsT > 500) {
    fps = (frames * 1000) / (now - fpsT);
    frames = 0;
    fpsT = now;
    if (car && hudSpec) {
      const s = hudSpec;
      hud.textContent =
        `${s.paragon ? 'PARAGON ' + s.paragon + ' / ' : ''}${s.body}  view=${qp('view', '34')}  ${quality}\n` +
        `tires ${s.parts.tires}  aero ${s.parts.aero}  exh ${s.parts.exhaust}  intake ${s.parts.intake}  fi ${s.parts.forcedInduction}\n` +
        `engine ${s.parts.engine}  susp ${s.parts.suspension}  nos ${s.parts.nitrous ? 1 : 0}  carbon ${s.parts.carbon ? 1 : 0}  livery ${s.livery}\n` +
        `car tris ${countTris(car.root).toLocaleString()}  calls ${renderer.info.render.calls}  fps ${fps.toFixed(0)}  t ${((now - t0) / 1000).toFixed(1)}s`;
    }
  }
  (window as unknown as { __frames: number }).__frames = ((window as unknown as { __frames?: number }).__frames ?? 0) + 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For headless screenshot drivers: window.__viewer.set({ view: 'side' }) and wait for __frames to advance.
(window as unknown as { __viewer: unknown }).__viewer = {
  set(p: Record<string, string>) {
    Object.assign(params, p);
    if (p.hud) document.body.classList.toggle('clean', p.hud === '0');
    rebuild();
  },
  view: setView,
  get car() {
    return car;
  },
  stats: () => {
    if (!car) return {};
    const kitG = car.build.body.getObjectByName('kit');
    const wheels = car.wheels.reduce((n, w) => n + countTris(w.steer), 0);
    const kit = kitG ? countTris(kitG) : 0;
    const all = countTris(car.root);
    let draws = 0;
    car.root.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) draws += Array.isArray(m.material) ? Math.max(1, m.geometry.groups.length) : 1;
    });
    return { tris: all, wheels, kit, body: all - wheels - kit, draws };
  },
};
window.addEventListener('beforeunload', () => {
  car?.dispose();
  rigDispose?.();
  composer?.dispose?.();
});
