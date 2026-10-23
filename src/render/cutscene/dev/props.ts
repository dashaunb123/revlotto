// Dev turntable for the hand props (and boss cars), rendered at 640x360 and nearest-upscaled.
// ?prop=oilgun|oilcan|lollipop|ticket|pinwheel|autograph|all  &k=0..1 (pump / written / eaten / crumple)
// &spin=rad/s (pinwheel) &rot=yaw &t=seconds (freeze) &hand=1 (show a 0.13 m fist at the grip) &res=360
// &dark=1 (harsh jerk lighting) &cam=x,y,z,lx,ly,lz &ppx=1 (draw the target 60-120 px height band)
import * as THREE from 'three';
import * as P from '../models/props';

const q = new URLSearchParams(location.search);
const H = Number(q.get('res') ?? 360), W = Math.round((H * 16) / 9);
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const dark = q.has('dark');
const scene = new THREE.Scene();
scene.background = new THREE.Color(dark ? 0x140c1c : 0x6a5a8a);
scene.add(new THREE.HemisphereLight(dark ? 0x6070a0 : 0xfff0e0, 0x403040, dark ? 0.6 : 1.4));
const sun = new THREE.DirectionalLight(0xffffff, dark ? 2.8 : 2.2);
sun.position.set(3, 5, 4);
scene.add(sun);
const rim = new THREE.DirectionalLight(dark ? 0x30f0ff : 0xff80c0, 1.4);
rim.position.set(-4, 2, -3);
scene.add(rim);

const builders: Record<string, () => P.Prop> = {
  oilgun: P.buildOilGun, oilcan: P.buildOilCan, lollipop: P.buildLollipop, ticket: P.buildTicketPad,
  pinwheel: P.buildPinwheel, autograph: P.buildAutograph,
};
const name = q.get('prop') ?? 'all';
const names = name === 'all' ? Object.keys(builders) : [name];
const k = Number(q.get('k') ?? 0);
const props: P.Prop[] = [];
const turn = new THREE.Group();
scene.add(turn);
const holders: THREE.Group[] = [];
names.forEach((n, i) => {
  const p = builders[n]();
  props.push(p);
  const holder = new THREE.Group();
  if (names.length > 1) holder.position.x = ((i % 3) - 1) * 0.95, holder.position.y = i < 3 ? 0.45 : -0.45;
  holder.add(p.root);
  if (q.has('hand')) {
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshToonMaterial({ color: 0x1c1c26 }));
    fist.scale.set(1, 1.05, 0.75);
    holder.add(fist);
  }
  holders.push(holder);
  turn.add(holder);
  const r = p as unknown as Record<string, (v: number) => void>;
  r.setPump?.(k);
  r.setWritten?.(k);
  r.setEaten?.(k);
  r.crumple?.(k);
  r.setSpin?.(Number(q.get('spin') ?? 6));
});

const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
const box = new THREE.Box3().setFromObject(turn);
const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
const dist = (Math.max(s.x / (W / H), s.y) * 1.25) / (2 * Math.tan((15 * Math.PI) / 180));
cam.position.set(c.x, c.y + dist * 0.15, c.z + dist);
cam.lookAt(c);
if (q.get('cam')) {
  const v = q.get('cam')!.split(',').map(Number);
  cam.position.set(v[0], v[1], v[2]);
  cam.lookAt(v[3], v[4], v[5]);
}
const hud = document.getElementById('hud')!;
let t = 0;
const step = (dt: number) => {
  t += dt;
  for (const p of props) p.update?.(dt);
  turn.rotation.y = q.has('rot') ? Number(q.get('rot')) : Math.sin(t * 0.6) * 0.7;
  hud.textContent = `${name} k=${k}`;
};
if (q.has('t')) {
  const target = Number(q.get('t'));
  while (t < target) step(1 / 60);
  renderer.render(scene, cam);
  (window as unknown as { __ready: boolean }).__ready = true;
} else {
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    step(Math.min(0.05, (now - last) / 1000));
    last = now;
    renderer.render(scene, cam);
  });
}
if (q.has('dispose')) {
  for (const p of props) p.dispose();
  renderer.render(scene, cam);
  const m = renderer.info.memory;
  (window as unknown as { __mem: unknown }).__mem = { geometries: m.geometries, textures: m.textures };
}
