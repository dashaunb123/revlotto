// Cars B body viewer (dev only): a hand-built body straight from BODY_BUILDERS (no kit), simple stand-in wheels at the
// anchors, under look's studio rig. /src/render/three/dev/carsB.html?body=muscle&view=34|r34|side|front|rear|top|low&anchors=1
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { BodyType } from '../../car';
import { BODY_BUILDERS } from '../cars/registry';
import type { BodyBuild, CarSpec } from '../types';

type Mod = Record<string, unknown>;
const lightingMod = Object.values(import.meta.glob('../lighting.ts', { eager: true }))[0] as Mod | undefined;
const q = new URLSearchParams(location.search);
const qp = (k: string, d = '') => q.get(k) ?? d;
if (qp('hud') === '0') document.body.classList.add('clean');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
const studio = lightingMod?.studioLighting as ((s: THREE.Scene, o: unknown) => unknown) | undefined;
if (studio && qp('rig') !== '0') studio(scene, { renderer, floor: 'reflective', quality: 'high' });
else {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.background = new THREE.Color(0x14121c);
  const key = new THREE.DirectionalLight(0xfff4e8, 2.4);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  scene.add(key, new THREE.HemisphereLight(0x4a4866, 0x0c0b10, 0.5));
}

const spec: CarSpec = {
  body: (qp('body', 'muscle') as BodyType),
  paint: qp('paint', '#c8141c'),
  accent: qp('accent', '#f7d23e'),
  rim: '#d6d4e4',
  livery: 'none',
  number: 0,
  parts: { tires: 'stock', aero: 'stock', exhaust: 'stock', intake: 'stock', forcedInduction: 'stock', engine: 'stock', suspension: 'stock', nitrous: false, carbon: false },
};
const root = new THREE.Group();
scene.add(root);
let build: BodyBuild | null = null;
let buildMs = 0;
function rebuild() {
  root.clear();
  const t = performance.now();
  build = BODY_BUILDERS[spec.body](spec);
  buildMs = performance.now() - t;
  root.add(build.body);
  // stand-in wheels
  const tyreM = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const rimM = new THREE.MeshStandardMaterial({ color: 0xb8bcc6, metalness: 1, roughness: 0.25 });
  const A = build.anchors;
  const R = build.dims.wheelR;
  for (const a of [A.wheelFL, A.wheelFR, A.wheelRL, A.wheelRR]) {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(R - 0.065, 0.075, 16, 40), tyreM);
    tyre.scale.z = 1.6;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.1, R - 0.1, 0.2, 32), rimM);
    rim.rotation.x = Math.PI / 2;
    w.add(tyre, rim);
    w.position.copy(a);
    root.add(w);
  }
  if (qp('anchors') === '1') {
    const dot = (p: THREE.Vector3, c: number) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: c, depthTest: false }));
      m.position.copy(p);
      m.renderOrder = 10;
      root.add(m);
    };
    [A.hood, A.roof, A.deck, A.frontBumper, A.seat].forEach((p) => dot(p, 0x00ff88));
    A.headlights.forEach((p) => dot(p, 0xffffff));
    A.taillights.forEach((p) => dot(p, 0xff0000));
    A.exhausts.forEach((e) => dot(e.pos, 0x00aaff));
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  if (qp('lights') === '1') build.tailLightMeshes?.forEach((m) => ((m.material as THREE.MeshStandardMaterial).emissiveIntensity *= 1));
}
function setView(v: string) {
  if (!build) return;
  const d = build.dims;
  const s = Math.max(d.length, 3.6) / 4.6;
  const t = new THREE.Vector3(0, d.height * 0.45, 0);
  const p = new THREE.Vector3();
  switch (v) {
    case 'side': p.set(0, 1.0, 10.5 * s); break;
    case 'front': p.set(9.5 * s, 1.2, 0); break;
    case 'rear': p.set(-9.5 * s, 1.3, 0); break;
    case 'r34': p.set(-6.8 * s, 2.0, 6.4 * s); break;
    case 'top': p.set(0, 12 * s, 0.01); t.y = 0; break;
    case 'low': p.set(5.2 * s, 0.32, 4.6 * s); t.y = d.height * 0.35; break;
    case 'f34c': p.set(4.2 * s, 1.3, 3.2 * s); t.set(1.4, 0.6, 0.3); break;
    case 'r34c': p.set(-4.4 * s, 1.3, 3.0 * s); t.set(-1.6, 0.7, 0.3); break;
    case 'frontc': p.set(5.5 * s, 0.9, 0); t.set(2, 0.6, 0); break;
    case 'rearc': p.set(-5.5 * s, 1.0, 0); t.set(-2, 0.65, 0); break;
    case 'cabin': p.set(1.2, 2.6, 2.6); t.set(-0.3, 0.9, 0); break;
    default: p.set(6.8 * s, 1.9, 6.4 * s);
  }
  camera.position.copy(p);
  controls.target.copy(t);
  controls.update();
}
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
rebuild();
resize();
setView(qp('view', '34'));
window.addEventListener('resize', resize);
const W = window as unknown as Record<string, unknown>;
function frame() {
  controls.update();
  renderer.render(scene, camera);
  W.__frames = ((W.__frames as number) ?? 0) + 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
const countTris = (o: THREE.Object3D) => {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
  });
  return n;
};
W.__viewer = {
  view: setView,
  get build() {
    return build;
  },
  stats: () => ({ tris: build ? countTris(build.body) : 0, buildMs: Math.round(buildMs), calls: renderer.info.render.calls }),
};
