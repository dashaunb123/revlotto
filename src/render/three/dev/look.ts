// Look-dev scene (dev only): material balls + a smooth lofted placeholder car under the race or studio rig.
//   /src/render/three/dev/look.html?rig=race|studio&view=spheres|car|side|rear|close|top&finish=metallic&paint=%23c8161e
//   &livery=flames&number=7&paragon=stallion&quality=low|medium|high&post=0&dof=4,0.6&blur=0.6&radial=1&spin=1
//   &body=muscle (use the real body + kit from cars/index instead of the lookdev shape) &perf=1 (preset timings)
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Quality } from '../../../game/settings';
import type { BodyType, LiveryId } from '../../car';
import { PARAGONS } from '../../car';
import { raceLighting, studioLighting, contactShadow } from '../lighting';
import {
  applyLivery, brakeDisc, caliper, carbon, chrome, glass, lens, lightMaterial, paintMaterial, plastic, rimMaterial, rubber, brushedMetal,
  type PaintFinish, disposeObject,
} from '../materials';
import { createComposer, CAR_MASK_LAYER, POST_PRESETS, type Post } from '../post';
import type { BodyBuild, CarSpec } from '../types';

const q = new URLSearchParams(location.search);
const qp = (k: string, d = '') => q.get(k) ?? d;
if (qp('hud') === '0') document.body.classList.add('clean');
const quality = qp('quality', 'high') as Quality;
const rigKind = qp('rig', 'race');
const view = qp('view', 'car');

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: qp('post') === '0', powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1 : 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = quality !== 'low' || rigKind === 'studio';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 1200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

// ---- rig ----
let rig: { dispose(): void; follow?: (t: THREE.Vector3, r?: number) => void; fit?: (o: THREE.Object3D) => void };
if (rigKind === 'studio') {
  rig = studioLighting(scene, { renderer, floor: qp('floor', 'reflective') as 'reflective', quality, envOmit: qp('envomit').split(',').filter(Boolean) });
} else {
  rig = raceLighting(scene, { renderer, quality });
  scene.background = new THREE.Color('#05060c');
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(400, 60), new THREE.MeshPhysicalMaterial({ color: '#2b2b2e', roughness: 0.82, metalness: 0 }));
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.receiveShadow = true;
  scene.add(asphalt);
  // lane lines for scale
  for (const z of [-5.8, 0, 5.8]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(400, 0.12), new THREE.MeshStandardMaterial({ color: '#d8d8d0', roughness: 0.6 }));
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.002, z);
    scene.add(line);
  }
}

// ---- material balls ----
const balls = new THREE.Group();
scene.add(balls);
const ballDefs: [string, THREE.Material][] = [
  ['solid red', paintMaterial('#c8161e', { finish: 'solid' })],
  ['metallic red', paintMaterial('#b0101a', { finish: 'metallic' })],
  ['candy blue', paintMaterial('#1e50d2', { finish: 'candy' })],
  ['pearl white', paintMaterial('#f2f0ea', { finish: 'pearl' })],
  ['metallic black', paintMaterial('#2c2b34', { finish: 'metallic' })],
  ['lime pearl', paintMaterial('#8ee000', { finish: 'pearl' })],
  ['matte grey', paintMaterial('#55565c', { finish: 'matte' })],
  ['chrome', chrome()],
  ['carbon', carbon()],
  ['brushed', brushedMetal()],
  ['rubber', rubber({ sidewall: true })],
  ['plastic', plastic()],
];
ballDefs.forEach(([name, m], i) => {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.42, 96, 48), m);
  s.position.set(-((ballDefs.length - 1) * 1.0) / 2 + i * 1.0, 0.42, 0);
  s.castShadow = s.receiveShadow = true;
  s.name = name;
  balls.add(s);
});
const glassBall = new THREE.Mesh(new THREE.SphereGeometry(0.42, 64, 32), glass());
glassBall.position.set(0, 0.42, 1.2);
balls.add(glassBall);
balls.position.set(0, 0, view === 'spheres' ? 0 : -8);
balls.visible = view === 'spheres' || qp('balls') === '1';

// ---- lookdev car: a smooth lofted body (curved panels, belt crease), glass greenhouse, wheels with discs ----
function superSection(n: number, hw: number, cy: number, hTop: number, hBot: number, seg: number, out: THREE.Vector3[], x: number) {
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const z = Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * hw;
    const y = cy + Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * (s > 0 ? hTop : hBot);
    out.push(new THREE.Vector3(x, y, z));
  }
}

function loft(nx: number, seg: number, x0: number, x1: number, sec: (x: number, u: number, out: THREE.Vector3[]) => void) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nx; i++) {
    const u = i / nx;
    const x = x0 + (x1 - x0) * (0.5 - 0.5 * Math.cos(u * Math.PI));
    const ring: THREE.Vector3[] = [];
    sec(x, u, ring);
    ring.forEach((p) => pos.push(p.x, p.y, p.z));
  }
  const rs = seg + 1;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * rs + j;
      const b = a + rs;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function lookdevCar(spec: CarSpec): { root: THREE.Group; build: BodyBuild } {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const L = 4.6;
  const hl = L / 2;
  const end = (u: number) => Math.pow(Math.max(0, Math.sin(u * Math.PI)), 0.28);
  const bodyGeo = loft(120, 72, -hl, hl, (x, u, out) => {
    const t = (x + hl) / L; // 0 rear .. 1 front
    const k = end(u);
    const hw = 0.93 * k * (1 - 0.06 * Math.pow(t, 3));
    const top = 0.98 - 0.26 * Math.pow(Math.max(0, t - 0.62) / 0.38, 1.6) + 0.02 * Math.sin(t * Math.PI);
    const bot = 0.26 + 0.05 * Math.pow(Math.abs(t - 0.5) * 2, 3);
    const cy = bot + (top - bot) * 0.55;
    superSection(3.4, hw, cy, (top - cy) * k, (cy - bot) * k, 72, out, x);
  });
  const paintM = paintMaterial(spec.paint, { finish: (qp('finish') || undefined) as PaintFinish | undefined });
  const lower = new THREE.Mesh(bodyGeo, paintM);
  lower.castShadow = lower.receiveShadow = true;
  lower.name = 'body';
  body.add(lower);
  // greenhouse (glass) + roof cap (paint)
  const gx0 = -1.25;
  const gx1 = 0.75;
  const ghGeo = loft(60, 48, gx0, gx1, (x, u, out) => {
    const k = Math.pow(Math.max(0, Math.sin(u * Math.PI)), 0.55);
    const hw = 0.8 - 0.1 * (1 - k);
    superSection(2.6, hw * (0.75 + 0.25 * k), 0.95, 0.42 * k, 0.05, 48, out, x);
  });
  const gh = new THREE.Mesh(ghGeo, glass());
  body.add(gh);
  const roofGeo = loft(48, 48, gx0 + 0.42, gx1 - 0.4, (x, u, out) => {
    const k = Math.pow(Math.max(0, Math.sin(u * Math.PI)), 0.4);
    superSection(2.6, 0.66 * (0.85 + 0.15 * k), 1.0, 0.385 * k + 0.02, 0.02, 48, out, x);
  });
  const roof = new THREE.Mesh(roofGeo, paintM);
  roof.castShadow = true;
  roof.name = 'roof';
  body.add(roof);
  // interior hint
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), plastic('#1a1a1e'));
  seat.position.set(-0.4, 0.95, 0.35);
  body.add(seat);
  const seat2 = seat.clone();
  seat2.position.z = -0.35;
  body.add(seat2);
  // lights
  const head = lightMaterial('#f4f6ff', 8);
  const tail = lightMaterial('#ff1a10', 5);
  for (const z of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 12), head);
    h.scale.set(0.5, 0.7, 1.4);
    h.position.set(hl - 0.12, 0.76, z);
    body.add(h);
    const hlens = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 12), lens());
    hlens.scale.set(0.55, 0.7, 1.4);
    hlens.position.copy(h.position).add(new THREE.Vector3(0.02, 0, 0));
    body.add(hlens);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.42), tail);
    t.position.set(-hl + 0.03, 0.86, z * 1.05);
    body.add(t);
  }
  // wheels
  const wb = 2.7;
  const wr = 0.34;
  const tr = 0.8;
  const tyreGeo = new THREE.TorusGeometry(wr - 0.085, 0.09, 24, 64);
  const rimGeo = new THREE.CylinderGeometry(wr - 0.11, wr - 0.11, 0.2, 48, 1, false);
  const discGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.03, 48);
  for (const [x, z] of [[wb / 2, tr], [wb / 2, -tr], [-wb / 2, tr], [-wb / 2, -tr]]) {
    const w = new THREE.Group();
    w.position.set(x, wr, z);
    const tyre = new THREE.Mesh(tyreGeo, rubber({ sidewall: true }));
    tyre.scale.set(1, 1, 1.25);
    tyre.castShadow = true;
    w.add(tyre);
    const rim = new THREE.Mesh(rimGeo, rimMaterial(spec.rim));
    rim.rotation.x = Math.PI / 2;
    w.add(rim);
    const disc = new THREE.Mesh(discGeo, brakeDisc());
    disc.rotation.x = Math.PI / 2;
    disc.position.z = -Math.sign(z) * 0.06;
    w.add(disc);
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.06), caliper('#d0182c'));
    cal.position.set(-0.12, 0.08, -Math.sign(z) * 0.06);
    w.add(cal);
    root.add(w);
  }
  const shadow = contactShadow(L, 1.9);
  root.add(shadow);
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  body.userData = { belt: 0.92, sill: 0.34, door: [-0.55, 0.65], cowl: 0.75 };
  const build: BodyBuild = {
    body,
    dims: { length: L, width: 1.86, height: 1.4, wheelbase: wb, trackF: tr * 2, trackR: tr * 2, wheelR: wr, rideHeight: 0.14 },
    anchors: {
      wheelFL: v(wb / 2, wr, tr), wheelFR: v(wb / 2, wr, -tr), wheelRL: v(-wb / 2, wr, tr), wheelRR: v(-wb / 2, wr, -tr),
      exhausts: [], hood: v(1.4, 0.95, 0), roof: v(-0.3, 1.4, 0), deck: v(-2, 1, 0), frontBumper: v(hl, 0.35, 0), seat: v(-0.4, 1.2, 0.35),
      headlights: [], taillights: [],
    },
    paintMeshes: [lower, roof],
  };
  return { root, build };
}

const pg = qp('paragon');
const pgLook = pg ? PARAGONS[pg] : undefined;
const spec: CarSpec = {
  body: (qp('body') || pgLook?.body || 'compact') as BodyType,
  paint: qp('paint') || pgLook?.color || '#c8161e',
  accent: qp('accent') || pgLook?.accent || '#f7d23e',
  rim: qp('rim') || pgLook?.rim || '#d6d4e4',
  livery: (qp('livery') || 'none') as LiveryId,
  number: +qp('number', '0'),
  parts: { tires: 'sport', aero: 'stock', exhaust: 'sport', intake: 'stock', forcedInduction: 'stock', engine: 'stock', suspension: 'stock', nitrous: false, carbon: false },
  paragon: pg || undefined,
};

let car: { root: THREE.Group; build: BodyBuild; update?: (dt: number) => void; dispose?: () => void } | null = null;
async function makeCar() {
  if (qp('body')) {
    try {
      const mod = await import('../cars/index');
      const c = mod.buildCar3D(spec);
      // If the kit doesn't apply the livery yet, do it here so the lookdev shows it.
      if (!(c.build.paintMeshes[0]?.material as THREE.Material | undefined)?.userData?.hookKey?.includes('livery')) applyLivery(c.build, spec);
      c.root.traverse((o) => ((o as THREE.Mesh).isMesh ? ((o.castShadow = true), (o.receiveShadow = true)) : 0));
      return c;
    } catch (e) {
      console.warn('real body failed, using lookdev shape', e);
    }
  }
  const c = lookdevCar(spec);
  if (qp('livery') || pg || spec.number) applyLivery(c.build, spec, { finish: (qp('finish') || undefined) as PaintFinish | undefined });
  return c;
}

// ---- post ----
let post: Post | null = null;
if (qp('post') !== '0') {
  post = createComposer(renderer, scene, camera, quality);
  post.gradePreset(rigKind === 'studio' ? 'studio' : 'race');
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post?.setSize(w, h);
}
window.addEventListener('resize', resize);

function placeCamera() {
  const t = new THREE.Vector3(0, 0.6, 0);
  const p = new THREE.Vector3();
  switch (view) {
    case 'spheres':
      p.set(0, 2.2, 9.5);
      t.set(0, 0.45, 0.3);
      camera.fov = 45;
      break;
    case 'side':
      p.set(0, 0.9, 9.5);
      break;
    case 'rear':
      p.set(-6.5, 1.6, 4.2);
      break;
    case 'close':
      p.set(1.9, 1.05, 2.1);
      t.set(1.3, 0.75, 0.9);
      camera.fov = 26;
      break;
    case 'top':
      p.set(0.01, 10, 0.01);
      t.set(0, 0, 0);
      break;
    case 'chase':
      p.set(-7.5, 1.75, 0.6);
      t.set(12, 0.65, 0);
      camera.fov = 55;
      break;
    case 'front':
      p.set(8, 1.0, 0.01);
      break;
    default:
      p.set(5.8, 1.7, 5.4);
  }
  camera.position.copy(p);
  controls.target.copy(t);
  camera.updateProjectionMatrix();
  controls.update();
}

const hud = document.getElementById('hud')!;
let frames = 0;
let last = performance.now();
(window as unknown as { __frames: number }).__frames = 0;

async function main() {
  if (view !== 'spheres' || qp('car') === '1') {
    car = await makeCar();
    scene.add(car.root);
    if (qp('rival') === '1') {
      // a rival one lane over and a little ahead (chase-cam screen edge), plus trackside boards to streak
      const r = await makeCar();
      r.root.position.set(4, 0, -6.1);
      scene.add(r.root);
      for (let i = 0; i < 40; i++) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.9, 0.1), new THREE.MeshStandardMaterial({ color: i % 2 ? '#d02a2a' : '#f2c21a', roughness: 0.6 }));
        board.position.set(-10 + i * 3, 0.6, 3.2);
        scene.add(board);
      }
      if (qp('mask') === '1')
        for (const c of [car, r]) c.root.traverse((o) => ((o as THREE.Mesh).isMesh ? o.layers.enable(CAR_MASK_LAYER) : 0));
    }
    rig.fit?.(car.root);
  }
  if (qp('nolights') === '1') scene.traverse((o) => ((o as THREE.Light).isLight ? (o.visible = false) : 0));
  if (qp('noenv') === '1') scene.environment = null;
  resize();
  placeCamera();
  const dofQ = qp('dof');
  if (dofQ && post) {
    const [d, a] = dofQ.split(',').map(Number);
    post.setFocus(d, a);
  }
  if (qp('blur') && post) post.setSpeedBlur(+qp('blur'), { radial: qp('radial') === '1', dir: [-1, 0], protect: camera.position.distanceTo(controls.target) });
  if (qp('perf') === '1') await perf();
  const spin = qp('spin') === '1';
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (spin && car) car.root.rotation.y += dt * 0.4;
    controls.update();
    rig.follow?.(car?.root.position ?? new THREE.Vector3(), 6);
    car?.update?.(dt);
    if (post) post.render(dt);
    else renderer.render(scene, camera);
    frames++;
    (window as unknown as { __frames: number }).__frames = frames;
    hud.textContent = `look dev  rig=${rigKind} view=${view} quality=${quality} post=${post ? 'on' : 'off'}  ${post ? post.stats.ms.toFixed(2) + ' ms cpu' : ''}`;
    requestAnimationFrame(loop);
  };
  loop();
}

/** GPU-synced frame times per post preset (same scene): window.__perf. */
async function perf() {
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const out: Record<string, number> = {};
  const time = (label: string, f: () => void, n = 80) => {
    for (let i = 0; i < 25; i++) f();
    sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) f();
    sync();
    out[label] = +((performance.now() - t0) / n).toFixed(2);
  };
  rig.follow?.(new THREE.Vector3(), 6);
  time('raw (no post)', () => renderer.render(scene, camera));
  const p = post ?? createComposer(renderer, scene, camera, quality);
  for (const ql of ['low', 'medium', 'high'] as Quality[]) {
    p.setQuality(ql);
    p.setFocus(5, 0);
    p.setSpeedBlur(0);
    time(ql, () => p.render(1 / 60));
    p.setFocus(6, 0.6);
    p.setSpeedBlur(0.6);
    time(ql + ' +dof+blur', () => p.render(1 / 60));
    time(ql + ' (repeat)', () => (p.setFocus(5, 0), p.setSpeedBlur(0), p.render(1 / 60)));
  }
  // breakdown of 'high': without AO, without MSAA
  const hp = POST_PRESETS.high;
  const keep = { ...hp };
  Object.assign(hp, { ao: false });
  p.setQuality('medium');
  p.setQuality('high');
  time('high -ao', () => p.render(1 / 60));
  Object.assign(hp, { ao: true, msaa: 0, aa: 'smaa' });
  p.setQuality('medium');
  p.setQuality('high');
  time('high -msaa(+smaa)', () => p.render(1 / 60));
  Object.assign(hp, keep);
  p.setQuality('medium');
  p.setQuality(quality);
  p.setFocus(5, 0);
  p.setSpeedBlur(0);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) as string) : '';
  (window as unknown as { __perf: unknown }).__perf = { size: [size.x, size.y], ms: out, gpu };
  console.log('perf', JSON.stringify(out));
}

(window as unknown as { __look: unknown }).__look = { scene, camera, renderer, get post() { return post; } };
main();
window.addEventListener('beforeunload', () => {
  if (car) disposeObject(car.root);
  post?.dispose();
  rig.dispose();
});
