// Cars A body viewer (dev only): a bare hand-built body (no kit) + stand-in wheels at its anchors, under Look's studio rig.
//   /src/render/three/dev/carsA.html?body=compact&view=34|side|front|rear|r34|top|low&paint=%23c8102e&wire=1&lights=1
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BodyType } from '../../car';
import { BODY_BUILDERS } from '../cars/registry';
import { setLightLevel } from '../materials';
import type { BodyBuild, CarSpec } from '../types';

type Mod = Record<string, unknown>;
const lightingMod = Object.values(import.meta.glob('../lighting.ts', { eager: true }))[0] as Mod | undefined;
const postMod = Object.values(import.meta.glob('../post.ts', { eager: true }))[0] as Mod | undefined;
const q = new URLSearchParams(location.search);
const body = (q.get('body') ?? 'compact') as BodyType;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 200);
const controls = new OrbitControls(camera, canvas);
const studio = lightingMod?.studioLighting as ((s: THREE.Scene, o: unknown) => unknown) | undefined;
if (studio) studio(scene, { renderer, floor: q.get('floor') ?? 'matte' });
else {
  scene.background = new THREE.Color(0x14121c);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x222222, 2));
}
const spec: CarSpec = {
  body, paint: q.get('paint') ?? '#c8102e', accent: '#f7d23e', rim: '#d6d4e4', livery: 'none', number: 7,
  parts: { tires: 'stock', aero: 'stock', exhaust: 'stock', intake: 'stock', forcedInduction: 'stock', engine: 'stock', suspension: 'stock', nitrous: false, carbon: false },
};
const t0 = performance.now();
const build: BodyBuild = BODY_BUILDERS[body](spec);
const buildMs = performance.now() - t0;
const root = new THREE.Group();
root.add(build.body);
scene.add(root);
if (q.get('wire') === '1') build.body.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) m.material = new THREE.MeshBasicMaterial({ color: 0x66ccff, wireframe: true }); });
const lights = q.get('lights') === '1' ? 1 : 0;
[...(build.headLightMeshes ?? []), ...(build.tailLightMeshes ?? [])].forEach((m) => setLightLevel(m.material as THREE.Material, lights));
// stand-in wheels (the kit builds the real ones)
const d = build.dims;
const tyreM = new THREE.MeshStandardMaterial({ color: 0x151517, roughness: 0.9 });
const rimM = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.25 });
const A = build.anchors;
for (const w of [A.wheelFL, A.wheelFR, A.wheelRL, A.wheelRR]) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(d.wheelR * 0.78, d.wheelR * 0.24, 16, 48), tyreM);
  tyre.scale.z = 1.6;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(d.wheelR * 0.62, d.wheelR * 0.62, 0.16, 32).rotateX(Math.PI / 2), rimM);
  g.add(tyre, rim);
  g.position.copy(w);
  tyre.castShadow = rim.castShadow = true;
  root.add(g);
}
let tris = 0;
build.body.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
type Composer = { render: (dt?: number) => void; setSize?: (w: number, h: number) => void };
let composer: Composer | null = null;
const mk = postMod?.createComposer as ((...a: unknown[]) => Composer) | undefined;
if (mk && q.get('post') !== '0') try { composer = mk(renderer, scene, camera, 'high'); } catch (e) { console.warn('composer', e); }

function view(v: string) {
  const L = d.length / 4.6;
  const t = new THREE.Vector3(0, d.height * 0.45, 0);
  const p = new THREE.Vector3();
  switch (v) {
    case 'side': p.set(0, 0.9, 10.5 * L); break;
    case 'front': p.set(9.5 * L, 1.1, 0); break;
    case 'rear': p.set(-9.5 * L, 1.2, 0); break;
    case 'r34': p.set(-6.8 * L, 1.9, 6.4 * L); break;
    case 'top': p.set(0, 12 * L, 0.01); t.y = 0; break;
    case 'low': p.set(5.2 * L, 0.35, 4.6 * L); break;
    case 'fclose': p.set(3.6 * L, 1.0, 1.6 * L); t.set(d.length / 2 - 0.2, 0.65, 0.2); break;
    case 'rclose': p.set(-3.6 * L, 1.1, 1.6 * L); t.set(-d.length / 2 + 0.2, 0.7, 0.2); break;
    case 'cabin': p.set(0.6, 2.2, 2.6); t.set(-0.2, 0.9, 0); break;
    default: p.set(6.8 * L, 1.8, 6.4 * L);
  }
  camera.position.copy(p);
  controls.target.copy(t);
  controls.update();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  composer?.setSize?.(innerWidth, innerHeight);
}
resize();
addEventListener('resize', resize);
view(q.get('view') ?? '34');
const W = window as unknown as { __frames: number; __viewer: unknown };
W.__frames = 0;
W.__viewer = { view, stats: () => ({ tris: Math.round(tris), buildMs: Math.round(buildMs), meshes: build.body.children.length }) };
(document.getElementById('hud') as HTMLDivElement).textContent = q.get('hud') === '0' ? '' : `${body}  tris ${Math.round(tris)}  build ${buildMs.toFixed(0)} ms`;
function frame() {
  controls.update();
  if (composer) composer.render(1 / 60);
  else renderer.render(scene, camera);
  W.__frames++;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
