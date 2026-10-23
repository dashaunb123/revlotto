// Dev turntable for the cutscene models, rendered low-res and nearest-upscaled like the real thing.
// ?id=buckshot|olga|gus|rosa  ?car=compact|muscle|wedge|truck|super  ?boss=buckshot (boss car)  ?all=1 lineup
// Freeze for screenshots: &t=2.5 (seconds simulated) &exp=yell &sig=1 &rot=0.4 &view=face|full &res=180
// &helmet=0 (Rosa) &noshades=1 (Buckshot) &seat=1 (character in its boss car)
// Beat controls (called every step with the value): &shades= &tip= &guns= (Buckshot) &flick=0.03 (flickPick()
// that many seconds before the frame) &bellow= (Gus) &cackle= &innocent= &goggles= (Olga) &cold= &glow= &lift= (Rosa)
// &cam=x,y,z,lx,ly,lz custom camera
// Heel turn + hands: &turn=0..1 (setTurn) &hand=open|fist|grip|point|wave|gun|flat (both hands) &handL= &handR=
// &prop=1 puts a test stick (+X red, +Y green) in props.gripR / gripL; &arms=up raises both forearms
import * as THREE from 'three';
import { buildBossCar, buildCar, buildCharacter } from '../models';
import type { CutsceneId, Expression } from '../types';

const q = new URLSearchParams(location.search);
// Frozen frames: deterministic blinks (first blink at ~3.3 s).
if (q.has('t')) Math.random = () => 0.9;
const H = Number(q.get('res') ?? 180), W = Math.round((H * 16) / 9);
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2440);
scene.add(new THREE.HemisphereLight(0xcfd8ff, 0x403040, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 5, 4);
scene.add(sun);
const rim = new THREE.DirectionalLight(0xff60c0, 1.2);
rim.position.set(-4, 2, -3);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 24), new THREE.MeshToonMaterial({ color: 0x3a3456 }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 100);
const turn = new THREE.Group();
scene.add(turn);

const ids: CutsceneId[] = ['buckshot', 'rosa', 'olga', 'gus'];
const exps: Expression[] = ['smirk', 'grin', 'yell', 'crazy', 'wink'];
const id = q.get('id') as CutsceneId | null;
const carQ = q.get('car');
const boss = q.get('boss') as CutsceneId | null;
const all = q.has('all');
const view = q.get('view') ?? 'full';
const chars: ReturnType<typeof buildCharacter>[] = [];
const cars: ReturnType<typeof buildCar>[] = [];

if (all) {
  ids.forEach((cid, i) => {
    const c = buildCharacter(cid);
    c.root.position.x = (i - 1.5) * 1.6;
    turn.add(c.root);
    chars.push(c);
  });
  cam.position.set(0, 1.6, 9.5);
  cam.lookAt(0, 1.2, 0);
} else if (carQ || boss) {
  const car = boss ? buildBossCar(boss) : buildCar({ body: carQ as 'muscle', color: q.get('color') ?? '#e8413c', accent: q.get('accent') ?? '#f4ecd8' });
  turn.add(car.root);
  cars.push(car);
  car.setWheelSpin(4, 8);
  if (boss && q.has('seat')) {
    const c = buildCharacter(boss);
    car.seat.add(c.root);
    c.root.position.y = -c.hipHeight;
    c.legs.visible = false;
    chars.push(c);
  }
  cam.position.set(4.5, 2.3, 7.5);
  cam.lookAt(0, 0.8, 0);
} else {
  const c = buildCharacter(id ?? 'buckshot');
  turn.add(c.root);
  chars.push(c);
  if (view === 'hand') {
    cam.position.set(1.2, 1.0, 1.8);
    cam.lookAt(-0.4, 0.75, 0);
  } else if (view === 'face') {
    cam.position.set(0, 1.95, 2.4);
    cam.lookAt(0, 1.85, 0);
  } else {
    cam.position.set(0, 1.4, 6.2);
    cam.lookAt(0, 1.15, 0);
  }
}
for (const c of chars) {
  if (q.get('helmet') === '0' && c.props.helmet) c.props.helmet.visible = false;
  if (q.get('noshades') === '1' && c.props.glasses) c.props.glasses.visible = false;
}
if (q.get('cam')) {
  const v = q.get('cam')!.split(',').map(Number);
  cam.position.set(v[0], v[1], v[2]);
  cam.lookAt(v[3], v[4], v[5]);
}
if (q.get('fov')) cam.fov = Number(q.get('fov')), cam.updateProjectionMatrix();
if (q.has('prop')) {
  for (const c of chars) for (const g of [c.props.gripR, c.props.gripL]) {
    if (!g) continue;
    const ax = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: 0xff3030 }));
    ax.position.x = 0.2;
    const ay = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.25, 0.03), new THREE.MeshBasicMaterial({ color: 0x30ff30 }));
    ay.position.y = 0.125;
    g.add(ax, ay);
  }
}
const controls: [string, string][] = [
  ['shades', 'setShades'], ['tip', 'tipHat'], ['guns', 'fingerGuns'], ['bellow', 'setBellow'], ['cackle', 'setCackle'],
  ['innocent', 'setInnocent'], ['goggles', 'setGoggles'], ['cold', 'setCold'], ['glow', 'setEyeGlow'], ['lift', 'liftHelmet'],
];
const flickAt = q.has('flick') && q.has('t') ? Number(q.get('t')) - Number(q.get('flick')) : -1;
let flicked = false;

const hud = document.getElementById('hud')!;
const frozen = q.has('t');
const fixedExp = q.get('exp') as Expression | null;
const fixedSig = q.get('sig');
let t = 0;
const step = (dt: number) => {
  t += dt;
  const ei = Math.floor(t / 2) % exps.length;
  const e = fixedExp ?? exps[ei];
  const sig = fixedSig !== null ? Number(fixedSig) : Math.floor(t / 5) % 2;
  for (const c of chars) {
    c.setExpression(e);
    c.setSignature(sig);
    const r = c as unknown as Record<string, (v?: number) => void>;
    for (const [p, m] of controls) if (q.has(p) && typeof r[m] === 'function') r[m](Number(q.get(p)));
    if (q.has('turn')) r.setTurn?.(Number(q.get('turn')));
    const hp = c as unknown as { setHandPose?: (s: string, p: string) => void };
    if (q.has('hand')) hp.setHandPose?.('L', q.get('hand')!), hp.setHandPose?.('R', q.get('hand')!);
    if (q.has('handL')) hp.setHandPose?.('L', q.get('handL')!);
    if (q.has('handR')) hp.setHandPose?.('R', q.get('handR')!);
    if (!flicked && flickAt >= 0 && t >= flickAt && r.flickPick) r.flickPick(), (flicked = true);
    c.update(dt);
    if (q.get('arms') === 'up') {
      c.armL.rotation.set(-1.2, 0, 0.5);
      c.armR.rotation.set(-1.2, 0, -0.5);
    }
  }
  for (const c of cars) {
    c.setSteer(Math.sin(t) * 0.4);
    c.setLean(Math.sin(t * 0.8) * 0.04, Math.sin(t * 0.5) * 0.03);
    c.update(dt);
  }
  turn.rotation.y = q.has('rot') ? Number(q.get('rot')) : Math.sin(t * 0.5) * 0.9;
  hud.textContent = `${id ?? carQ ?? boss ?? 'all'}  exp=${e}  sig=${sig}`;
};

if (frozen) {
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

// Dispose check: ?dispose=1 builds and frees everything, then reports renderer memory.
if (q.has('dispose')) {
  for (const c of chars) c.dispose();
  for (const c of cars) c.dispose();
  renderer.render(scene, cam);
  const m = renderer.info.memory;
  (window as unknown as { __mem: unknown }).__mem = { geometries: m.geometries, textures: m.textures };
}
