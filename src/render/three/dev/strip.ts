// Drag strip flythrough (dev only).
//   /src/render/three/dev/strip.html?quality=high&shot=start|tree|stands|finish|track|aerial|burnout|shutdown|crowd|fly
//   &cam=x,y,z,lx,ly,lz (free camera) &lights=0..4 &false=1 &decoy=1 &cheer=1 &post=0 (no composer) &cars=0 &hud=0
//   &cheerk=0..1 (cheer strength) &fov=50 &t=seconds (freeze time) &shaderlog=1 (console-log every shader program compiled after load) &warm=1 (strip.warmup first)
//   ; drag to orbit. window.__strip exposes shot(name) / info() for headless capture.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Quality } from '../../../game/settings';
import { buildDragStrip, shaderLog } from '../env';
import type { CarSpec } from '../types';

const q = new URLSearchParams(location.search);
const qp = (k: string, d = '') => q.get(k) ?? d;
if (qp('hud') === '0') document.body.classList.add('clean');
const quality = qp('quality', 'high') as Quality;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const usePost = qp('post', '1') !== '0';
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !usePost, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1 : quality === 'medium' ? 1.5 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
const hud = document.getElementById('hud')!;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(Number(qp('fov', '50')), innerWidth / innerHeight, 0.1, 3000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const t0 = performance.now();
const strip = buildDragStrip({ quality, renderer });
const buildMs = performance.now() - t0;
scene.add(strip.group);
scene.fog = strip.fog;
scene.background = strip.background;
scene.environment = strip.envMap;

// lighting rig (look's race rig if present, else a minimal night key)
type Rig = { follow(t: THREE.Vector3, r?: number): void; setLevel?(k: number): void; dispose(): void };
let rig: Rig | null = null;
const lightingMod = await import('../lighting').catch(() => null);
if (lightingMod?.raceLighting) rig = lightingMod.raceLighting(scene, { envMap: strip.envMap, renderer, quality });
else {
  const hemi = new THREE.HemisphereLight(0x33405e, 0x17130f, 0.4);
  const key = new THREE.DirectionalLight(0xe9efff, 1.6);
  key.castShadow = true;
  scene.add(hemi, key, key.target);
  rig = { follow(t) { key.target.position.copy(t); key.position.copy(t).add(new THREE.Vector3(6, 30, -14)); key.target.updateMatrixWorld(); }, dispose() {} };
}
const postMod = usePost ? await import('../post').catch(() => null) : null;
const post = postMod?.createComposer ? postMod.createComposer(renderer, scene, camera, quality) : null;
post?.gradePreset?.('race');

// two cars on the line for scale (kit cars if available, else boxes)
const cars: THREE.Object3D[] = [];
const carUpd: ((dt: number) => void)[] = [];
if (qp('cars', 'box') !== '0') {
  const kit = qp('cars', 'box') === 'kit' ? await import('../cars/index').catch((e) => { console.warn('kit import failed', String(e)); return null; }) : null;
  const specs: CarSpec[] = [
    { body: 'muscle', paint: '#c8161e', accent: '#111111', rim: '#c0c0c0', livery: 'stripes', number: 7, parts: { tires: 'sport', aero: 'street', exhaust: 'sport', intake: 'street', forcedInduction: 'stock', engine: 'sport', suspension: 'sport', nitrous: true, carbon: false } },
    { body: 'tuner', paint: '#f2f2f2', accent: '#1a1a1a', rim: '#222222', livery: 'none', number: 3, parts: { tires: 'street', aero: 'sport', exhaust: 'street', intake: 'stock', forcedInduction: 'sport', engine: 'street', suspension: 'street', nitrous: false, carbon: true } },
  ];
  specs.forEach((s, i) => {
    let o: THREE.Object3D;
    try {
      if (!kit) throw new Error('box cars');
      const c = kit.buildCar3D(s, { quality });
      c.setHeadlights?.(true);
      carUpd.push((dt) => c.update(dt));
      o = c.root;
    } catch (e) {
      if (kit) console.warn('car fallback', e);
      o = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.3, 1.9), new THREE.MeshPhysicalMaterial({ color: s.paint, roughness: 0.3, clearcoat: 1 }));
      o.position.y = 0.65;
      o.castShadow = true;
    }
    const g = new THREE.Group();
    g.add(o);
    g.position.set(-1.6, 0, i === 0 ? strip.laneZ.player : strip.laneZ.ghost);
    g.traverse((m) => { if ((m as THREE.Mesh).isMesh) m.castShadow = true; });
    scene.add(g);
    cars.push(g);
  });
}

for (const n of qp('hide').split(',').filter(Boolean)) strip.group.traverse((o) => { if (o.name === n) o.visible = false; });

// tree state
const lights = Number(qp('lights', '2'));
strip.setTree({ lights, falseStart: qp('false') === '1', decoy: qp('decoy') === '1', staged: [2, 2] });
strip.setScoreboard(9.874, 141.62, 10.215, 136.04, 'player');
if (qp('cheer') === '1') strip.cheer(1e9, Number(qp('cheerk', '1')));

// shots
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const pz = strip.laneZ.player;
const SHOTS: Record<string, [THREE.Vector3, THREE.Vector3, number?]> = {
  start: [V(-17, 2.3, 0.4), V(10, 1.5, 0), 50],
  outside: [V(-14, 2.4, 9.5), V(6, 1.2, 0), 50],
  tree: [V(2.6, 1.9, 1.4), V(7, 2.05, 0), 40],
  treeside: [V(5.2, 1.8, 2.6), V(7, 2.05, 0), 38],
  stands: [V(40, 2.2, -3.5), V(10, 6, 24), 60],
  crowd: [V(30, 4, 6), V(18, 4.5, 22), 45],
  finish: [V(380, 2.0, 3.0), V(420, 4, 0), 55],
  track: [V(2.5, 1.0, pz - 0.4), V(80, 1.3, pz * 0.4), 55],
  chase: [V(-9.5, 1.6, pz + 0.3), V(10, 1.1, pz * 0.7), 50],
  asphalt: [V(292, 1.55, pz + 0.3), V(318, 1.0, pz * 0.6), 56],
  board: [V(395, 3.2, 1.5), V(418, 6.2, 12.5), 40],
  aerial: [V(-80, 70, 70), V(150, 0, -10), 50],
  burnout: [V(-34, 1.6, 7.5), V(-14, 0.3, 1.5), 45],
  shutdown: [V(470, 3, -3), V(720, 1, 10), 50],
  tower: [V(10, 3, 4), V(-6, 6, -17), 55],
  pits: [V(30, 2, 0), V(-60, 2, 0), 55],
};
let fly = false;
function shot(name: string) {
  const s = SHOTS[name];
  fly = name === 'fly';
  if (!s) return;
  camera.position.copy(s[0]);
  controls.target.copy(s[1]);
  camera.fov = s[2] ?? 50;
  camera.updateProjectionMatrix();
  camera.lookAt(s[1]);
  controls.update();
}
const camQ = qp('cam');
if (camQ) {
  const c = camQ.split(',').map(Number);
  camera.position.set(c[0], c[1], c[2]);
  controls.target.set(c[3], c[4], c[5]);
  controls.update();
} else shot(qp('shot', 'start'));

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post?.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

// compile against the target the scene really renders into (the composer's HDR buffer when post is on)
if (qp('warm') === '1') await strip.warmup(renderer, camera, scene, post?.sceneTarget ?? null);
const slog = qp('shaderlog') === '1' ? shaderLog(renderer, 'strip') : null;
let programs = 0;
const freeze = q.has('t') ? Number(qp('t')) : null;
let t = freeze ?? 0, last = performance.now(), frames = 0, fpsT = 0, fps = 0;
const focus = new THREE.Vector3();
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (freeze == null) t += dt;
  if (fly) {
    const x = -20 + ((t * 30) % 760);
    camera.position.set(x, 1.4 + Math.sin(t * 0.3) * 0.6, pz + 1.5);
    controls.target.set(x + 30, 1.2, 0);
  }
  controls.update();
  focus.set(camera.position.x, 0, 0);
  rig?.follow(cars[0]?.position ?? focus, 10);
  rig?.setLevel?.(0.5 + 0.5 * strip.lightAt(cars[0]?.position.x ?? 0, pz));
  renderer.info.reset();
  strip.update(dt, t);
  carUpd.forEach((u) => u(dt));
  if (post) post.render(dt);
  else renderer.render(scene, camera);
  programs = slog ? slog() : renderer.info.programs?.length ?? 0;
  frames++;
  fpsT += dt;
  if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
  const i = renderer.info.render;
  hud.textContent = `strip ${quality} | ${fps.toFixed(0)} fps | calls ${i.calls} | tris ${(i.triangles / 1000).toFixed(0)}k | build ${buildMs.toFixed(0)} ms | crowd ${strip.stats.crowd} | lights ${strip.stats.stadiumLights} | programs ${programs}\ncam ${camera.position.toArray().map((v) => v.toFixed(1)).join(',')}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __strip: unknown }).__strip = {
  ready: true,
  shot,
  strip,
  programs: () => (renderer.info.programs ?? []).map((pr) => pr.name),
  info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, fps, buildMs, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length, ...strip.stats }),
  setTree: strip.setTree,
  cheer: strip.cheer,
};
