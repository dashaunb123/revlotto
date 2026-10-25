// Cars C's own body viewer (dev only): tuner / wedge / hyper under Look's studio rig, with the kit's assembly when it loads
// (?kit=0 or a kit error falls back to the bare body on stand-in wheels).
//   /src/render/three/dev/carsC.html?body=tuner&view=34|side|front|rear|r34|top|low|under&paint=%23e8413c&lights=1&hud=0&post=0
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { studioLighting } from '../lighting';
import { createComposer } from '../post';
import tuner from '../cars/bodies/tuner';
import wedge from '../cars/bodies/wedge';
import hyper from '../cars/bodies/hyper';
import type { BodyBuild, CarSpec } from '../types';
import { setLightLevel } from '../materials';

const q = new URLSearchParams(location.search);
const qp = (k: string, d = '') => q.get(k) ?? d;
if (qp('hud') === '0') document.body.classList.add('clean');
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
const rig = studioLighting(scene, { renderer, floor: (qp('floor', 'reflective') as 'reflective'), quality: 'high' });

const BUILDERS: Record<string, (s: CarSpec) => BodyBuild> = { tuner, wedge, hyper };
const bodyName = qp('body', 'tuner');
const spec: CarSpec = {
  body: bodyName as CarSpec['body'],
  paint: qp('paint', '#e8413c'),
  accent: '#f7d23e',
  rim: '#d6d4e4',
  livery: 'none',
  number: 0,
  parts: { tires: 'stock', aero: 'stock', exhaust: 'stock', intake: 'stock', forcedInduction: 'stock', engine: 'stock', suspension: 'stock', nitrous: false, carbon: false },
};
const tier = qp('tier');
if (tier) for (const k of Object.keys(spec.parts) as (keyof CarSpec['parts'])[]) if (typeof spec.parts[k] === 'string') (spec.parts as Record<string, unknown>)[k] = tier;

let root: THREE.Object3D = new THREE.Group();
let build: BodyBuild = null as unknown as BodyBuild;
async function make() {
  if (qp('kit') !== '0') {
    try {
      const kit = await import('../cars/index');
      const car = kit.buildCar3D(spec);
      car.setBrakeLights(qp('lights') === '1');
      car.setHeadlights(qp('lights') === '1');
      root = car.root;
      build = car.build;
      return;
    } catch (e) {
      console.warn('kit failed, bare body', e);
    }
  }
  build = BUILDERS[bodyName](spec);
  root = new THREE.Group();
  root.add(build.body);
  const tyreM = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const rimM = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.25 });
  const R = build.dims.wheelR;
  for (const k of ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'] as const) {
    const a = build.anchors[k];
    const t = new THREE.Mesh(new THREE.TorusGeometry(R - 0.07, 0.07, 14, 40), tyreM);
    t.scale.z = 1.6;
    t.position.copy(a);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.1, R - 0.1, 0.16, 32), rimM);
    r.rotation.x = Math.PI / 2;
    r.position.copy(a);
    root.add(t, r);
  }
  const on = qp('lights') === '1' ? 1 : 0;
  for (const m of [...(build.tailLightMeshes ?? []), ...(build.headLightMeshes ?? [])]) setLightLevel(m.material as THREE.Material, on);
}

await make();
root.traverse((o) => {
  if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
});
scene.add(root);
rig.fit(root);
// anchors debug: ?anchors=1
if (qp('anchors') === '1') {
  const a = build.anchors;
  const pts = [a.hood, a.roof, a.deck, a.frontBumper, a.seat, ...a.headlights, ...a.taillights, ...a.exhausts.map((e) => e.pos)];
  for (const p of pts) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0x00ff88, depthTest: false }));
    m.position.copy(p);
    m.renderOrder = 10;
    root.add(m);
  }
}

const d = build.dims;
const s = Math.max(d.length, 3.6) / 4.6;
const t = new THREE.Vector3(0, d.height * 0.45, 0);
const p = new THREE.Vector3();
switch (qp('view', '34')) {
  case 'side': p.set(0, 0.9, 10.5 * s); break;
  case 'front': p.set(9.5 * s, 1.1, 0); break;
  case 'rear': p.set(-9.5 * s, 1.2, 0); break;
  case 'r34': p.set(-6.8 * s, 2.0, 6.4 * s); break;
  case 'top': p.set(0, 12 * s, 0.01); t.y = 0; break;
  case 'low': p.set(5.2 * s, 0.4, 4.6 * s); t.y = d.height * 0.35; break;
  case 'under': p.set(-2.8 * s, 0.25, 4.0 * s); t.set(-d.length * 0.3, 0.25, 0); break;
  case 'close': p.set(3.6 * s, 1.2, 2.6 * s); t.set(d.length * 0.3, 0.5, 0.3); break;
  case 'closer': p.set(-3.4 * s, 1.1, 2.4 * s); t.set(-d.length * 0.33, 0.6, 0.3); break;
  case 'cabin': p.set(1.2, 1.9, 2.6); t.set(-0.2, 0.8, 0); break;
  default: p.set(6.8 * s, 1.9, 6.4 * s);
}
const cam = qp('cam');
if (cam) {
  const c = cam.split(',').map(Number);
  p.set(c[0], c[1], c[2]);
  if (c.length >= 6) t.set(c[3], c[4], c[5]);
}
camera.position.copy(p);
controls.target.copy(t);
controls.update();

const composer = qp('post') !== '0' ? createComposer(renderer, scene, camera, 'high') : null;
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  composer?.setSize(innerWidth, innerHeight);
}
resize();
addEventListener('resize', resize);
let tris = 0;
build.body.traverse((o) => {
  const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if ((o as THREE.Mesh).isMesh && g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
});
(document.getElementById('hud') as HTMLDivElement).textContent = `${bodyName} body tris ${Math.round(tris).toLocaleString()} meshes ${build.body.children.length}`;
const per: Record<string, number> = {};
build.body.traverse((o) => {
  const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  if ((o as THREE.Mesh).isMesh && g) per[o.name] = (per[o.name] ?? 0) + Math.round((g.index ? g.index.count : g.attributes.position.count) / 3);
});
(window as unknown as { __stats: unknown }).__stats = { bodyTris: Math.round(tris), meshes: build.body.children.length, per };
function frame() {
  controls.update();
  if (composer) composer.render(1 / 60);
  else renderer.render(scene, camera);
  (window as unknown as { __frames: number }).__frames = ((window as unknown as { __frames?: number }).__frames ?? 0) + 1;
  requestAnimationFrame(frame);
}
frame();
