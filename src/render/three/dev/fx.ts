// Race FX + cinematic camera bench (dev only). Runs the real deterministic sim with a bot on the 3D strip (env's
// when it lands, else a stand-in), drives CameraDirector + RaceFx3D exactly like Race3D, and can freeze any moment.
//   /src/render/three/dev/fx.html?q=high&race=3&bot=perfect&at=nitro&off=0.5&freeze=1   (or &shot=tyre to force a ShotId)
// Params: q (low|medium|high), race (seed), bot (perfect|average|sloppy), body / gbody, power, nitro=1, close=1 (photo
// finish), shot (force a ShotId), at (burnout|stage|amber1|green|launch|shift1|shift2|shift3|nitro|finish|coast) + off
// (s), seek (timeline s), x (player metres), freeze=1, hud=0 (hide the HUD mock), info=0, post=0, bar=1 (wheelie bar).
// Headless: window.__dev = { ready, run(opts), info(), perf(frames) }.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { RaceSetup, Tier } from '../../../core/types';
import { CONTENT } from '../../../data/content';
import type { Quality } from '../../../game/settings';
import { makeBot, type BotProfile } from '../../../sim/bots';
import { RaceSim, SIM_DT, TRACK_LENGTH, ghostV, ghostX } from '../../../sim/RaceSim';
import type { BodyType } from '../../car';
import { placeholderBody } from '../cars/bodies/placeholder';
import { CameraDirector, type CineView, type ShotId } from '../race/camera';
import { RaceFx3D } from '../race/fx';
import type { Car3D, CarSpec } from '../types';

type Mod = Record<string, unknown>;
type Fn = (...a: unknown[]) => unknown;
/** Other agents' modules land (and break) in parallel: load each lazily, fall back to stand-ins on failure. */
async function load(g: Record<string, () => Promise<unknown>>, name: string): Promise<Mod | undefined> {
  for (const f of Object.values(g)) {
    try {
      const m = (await f()) as Mod;
      if (typeof m?.[name] === 'function') return m;
    } catch (e) {
      console.warn('optional module failed:', name, String(e).slice(0, 300));
    }
  }
  return undefined;
}
const [ENV, POST, LIGHT, CARS] = await Promise.all([
  load(import.meta.glob('../env/index.ts'), 'buildDragStrip'),
  load(import.meta.glob('../post.ts'), 'createComposer'),
  load(import.meta.glob('../lighting.ts'), 'raceLighting'),
  load(import.meta.glob('../cars/index.ts'), 'buildCar3D'),
]);

/** Stand-in car (placeholder body + wheels) with the Car3D API, until the kit's assembly loads. */
function standInCar(spec: CarSpec): Car3D {
  const dims: Record<string, [number, number, number]> = { muscle: [4.79, 1.92, 1.38], tuner: [4.52, 1.81, 1.27], hyper: [4.78, 2.03, 1.14], compact: [4.0, 1.68, 1.4] };
  const [length, width, height] = dims[spec.body] ?? [4.6, 1.9, 1.35];
  const build = placeholderBody(spec, { length, width, height });
  const root = new THREE.Group();
  const sprung = new THREE.Group();
  sprung.add(build.body);
  root.add(sprung);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x111113, roughness: 0.9 });
  const wheels: THREE.Mesh[] = [];
  for (const a of [build.anchors.wheelFL, build.anchors.wheelFR, build.anchors.wheelRL, build.anchors.wheelRR]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(build.dims.wheelR, build.dims.wheelR, 0.26, 24), tyre);
    w.rotation.x = Math.PI / 2;
    w.position.copy(a);
    root.add(w);
    wheels.push(w);
  }
  const tmp = new THREE.Vector3();
  return {
    root, build,
    setWheelSpin() {}, setSteer() {}, setSuspension(p) { sprung.rotation.z = p; }, setWheelie(r) { root.rotation.z = r; },
    setBrakeLights() {}, setHeadlights() {}, setNitro() {},
    exhaustWorld(i, out) { return root.localToWorld(out.copy(build.anchors.exhausts[i]?.pos ?? tmp.set(0, 0, 0))); },
    rearContactWorld(side, out) { const a = side === 'L' ? build.anchors.wheelRL : build.anchors.wheelRR; return root.localToWorld(out.set(a.x, 0, a.z)); },
    update() {},
    dispose() { root.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); },
  };
}
const buildCar3D = (s: CarSpec): Car3D => {
  if (CARS) {
    try {
      return (CARS.buildCar3D as (s: CarSpec, o?: unknown) => Car3D)(s, { quality });
    } catch (e) {
      console.warn('buildCar3D failed, stand-in used', e);
    }
  }
  return standInCar(s);
};

const qs = new URLSearchParams(location.search);
const P = (k: string, d = '') => qs.get(k) ?? d;
if (P('hud') === '0') document.body.classList.add('nohud');
if (P('info') === '0') document.body.classList.add('clean');
const quality = (['low', 'medium', 'high'].includes(P('q')) ? P('q') : 'high') as Quality;

// ------------------------------------------------------------------ renderer + scene

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1500);

interface Strip {
  group: THREE.Object3D;
  envMap?: THREE.Texture | null;
  fog?: THREE.FogExp2 | THREE.Fog;
  background?: THREE.Color | THREE.Texture;
  laneZ?: { player: number; ghost: number };
  lightAt?: (x: number, z: number) => number;
  setTree?(s: { lights: number; falseStart?: boolean; staged?: [number, number] }): void;
  update?(dt: number, t: number): void;
}

function fallbackStrip(): Strip {
  const g = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.82, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 80), asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(330, 0, 0);
  ground.receiveShadow = true;
  g.add(ground);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(230, 11.6), new THREE.MeshStandardMaterial({ color: 0x4a4a4e, roughness: 0.75 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(85, 0.001, 0);
  pad.receiveShadow = true;
  g.add(pad);
  const line = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, roughness: 0.6, emissive: 0x202020 });
  for (const z of [-5.8, 5.8]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(800, 0.12), line);
    l.rotation.x = -Math.PI / 2;
    l.position.set(330, 0.002, z * 0.97);
    g.add(l);
  }
  for (const x of [0, TRACK_LENGTH]) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 11.6), line);
    l.rotation.x = -Math.PI / 2;
    l.position.set(x, 0.003, 0);
    g.add(l);
  }
  const wallM = new THREE.MeshStandardMaterial({ color: 0x8a8a90, roughness: 0.7 });
  for (const z of [-5.96, 5.96]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(800, 1.05, 0.32), wallM);
    w.position.set(330, 0.525, z);
    w.castShadow = w.receiveShadow = true;
    g.add(w);
  }
  const cw = new THREE.Mesh(new THREE.BoxGeometry(590, 0.85, 0.6), wallM);
  cw.position.set(9 + 295, 0.425, 0);
  cw.castShadow = cw.receiveShadow = true;
  g.add(cw);
  // light towers both sides
  const pole = new THREE.MeshStandardMaterial({ color: 0x303036, roughness: 0.5, metalness: 0.6 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dc, emissiveIntensity: 6 });
  for (let x = -40; x < 700; x += 55) {
    for (const z of [-10, 10]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 22, 8), pole);
      p.position.set(x, 11, z);
      g.add(p);
      const l = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.0, 0.3), lamp);
      l.position.set(x, 22, z * 0.95);
      g.add(l);
    }
  }
  // the tree
  const tree = new THREE.Group();
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.7, 0.3), pole);
  post.position.y = 1.35;
  tree.add(post);
  const bulbs: THREE.MeshStandardMaterial[] = [];
  for (let i = 0; i < 6; i++) {
    for (const s of [-1, 1]) {
      const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: i < 2 ? 0xfff0d0 : i < 5 ? 0xffa018 : 0x30ff40, emissiveIntensity: 0 });
      bulbs.push(m);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 8), m);
      b.position.set(-0.16, 2.55 - i * 0.24, s * 0.16);
      tree.add(b);
    }
  }
  tree.position.set(7, 0, 0);
  g.add(tree);
  const fog = new THREE.FogExp2(0x0a0b10, 0.0045);
  return {
    group: g,
    fog,
    background: new THREE.Color(0x05060a),
    laneZ: { player: 3.05, ghost: -3.05 },
    lightAt: (x) => 0.55 + 0.45 * Math.cos(((x + 40) / 55) * Math.PI * 2) ** 2,
    setTree(s) {
      bulbs.forEach((m, i) => {
        const row = Math.floor(i / 2);
        const on = row === 0 ? (s.staged?.[0] ?? 0) >= 1 : row === 1 ? (s.staged?.[0] ?? 0) >= 2 : row < 5 ? s.lights >= row - 1 && s.lights < 4 : s.lights === 4;
        m.emissiveIntensity = on ? 8 : 0.02;
      });
    },
  };
}

const strip: Strip = ENV ? ((ENV.buildDragStrip as Fn)({ quality, renderer }) as Strip) : fallbackStrip();
scene.add(strip.group);
if (strip.fog) scene.fog = strip.fog;
scene.background = strip.background ?? new THREE.Color(0x05060a);
const laneZ = strip.laneZ ?? { player: 3.05, ghost: -3.05 };
let rig: { follow?(t: THREE.Vector3, r?: number): void } | null = null;
if (LIGHT) rig = (LIGHT.raceLighting as Fn)(scene, { envMap: strip.envMap ?? null, renderer, quality }) as typeof rig;
else {
  const key = new THREE.DirectionalLight(0xe9efff, 2.6);
  key.position.set(20, 40, -22);
  key.castShadow = true;
  scene.add(key, key.target, new THREE.HemisphereLight(0x33405e, 0x17130f, 0.6));
}

// post: look's composer, else bloom + output so flames bloom the same way
interface Composer { render(dt?: number): void; setSize?(w: number, h: number): void; setFocus?(d: number, a: number): void; setSpeedBlur?(k: number, o?: unknown): void; insertPass?(p: unknown, i: number): void }
let composer: Composer | null = null;

// ------------------------------------------------------------------ cars

function spec(body: BodyType, paint: string, tier: Tier, nitro: boolean): CarSpec {
  return {
    body, paint, accent: '#f2f2f2', rim: '#c9c9d2', livery: 'none', number: 7,
    parts: { tires: tier, aero: tier, exhaust: tier, intake: tier, forcedInduction: tier, engine: tier, suspension: tier, nitrous: nitro, carbon: false },
    paragon: P('paragon') || undefined,
  };
}
const tier = (P('tier', 'sport') as Tier) || 'sport';
const nitroOn = P('nitro', '1') === '1';
const player: Car3D = buildCar3D(spec((P('body', 'muscle') as BodyType), P('paint', '#c8102e'), tier, nitroOn));
const ghost: Car3D = buildCar3D(spec((P('gbody', 'tuner') as BodyType), P('gpaint', '#1f6fd6'), 'street', false));
scene.add(player.root, ghost.root);
player.root.position.z = laneZ.player;
ghost.root.position.z = laneZ.ghost;
player.setHeadlights?.(true);
ghost.setHeadlights?.(true);
const frontWheel = (c: Car3D) => c.build.anchors.wheelFL.x;

// ------------------------------------------------------------------ race timeline (mirrors RaceScene's preroll)

const PREROLL = 2.4, BURN_ON = 0.2, BURN_OFF = 1.35, BURN_FADE = 1.6, ROLL_START = 1.55, ROLL_END = 2.1, PRESTAGE_AT = 1.9, STAGE_AT = 2.1;
const BURNOUT_BACK = 4; // m

interface Run {
  sim: RaceSim; bot: ReturnType<typeof makeBot>; director: CameraDirector; fx: RaceFx3D;
  phase: CineView['phase']; prerollT: number; prerollOff: number; acc: number; T: number; doneT: number;
  marks: Record<string, number>; view: CineView; wheelie: number; wheelieVel: number; result: number | null;
}

function makeSetup(close: boolean, profile: BotProfile): RaceSetup {
  const st = { ...CONTENT.balance.starter, power: Number(P('power', '340')), grip: 1.25, nitroPower: nitroOn ? 0.25 : 0, nitroDuration: nitroOn ? 1.6 : 0 };
  const setup: RaceSetup = { stats: st, hooks: [], quirks: [], launchWindowMult: 1, extraShiftWindowMult: 1, gripEarlyMult: 1, gripEarlySeconds: 0, targetEt: 99 };
  // dry run: the bot's ET, so the ghost can be set to a photo finish (or a clear win)
  const sim = new RaceSim(setup);
  const bot = makeBot(profile, Number(P('race', '3')) * 31 + 7);
  while (sim.state.phase !== 'finished' && sim.state.t < 40) {
    const a = bot(sim);
    if (a) sim.input(a);
    sim.step();
  }
  const et = sim.state.et ?? 12;
  setup.targetEt = close ? et + (P('lead') === 'ghost' ? -0.03 : 0.03) : et + Number(P('margin', '0.45'));
  return setup;
}

let fx: RaceFx3D | null = null;
function newRun(): Run {
  const close = P('close') === '1';
  const profile = (P('bot', 'perfect') as BotProfile) || 'perfect';
  const setup = makeSetup(close, profile);
  const raceNo = Number(P('race', '3'));
  const director = new CameraDirector(camera, { raceNo, laneZ, finishX: TRACK_LENGTH, tree: new THREE.Vector3(7, 1.95, 0) });
  if (!fx) fx = new RaceFx3D(scene, quality, { lightAt: strip.lightAt });
  else fx.reset();
  const shot = P('shot') as ShotId;
  if (shot) director.force(shot);
  const sim = new RaceSim(setup);
  const view: CineView = {
    player, ghost, state: sim.state, ghostX: 0, ghostV: 0, phase: 'preroll', prerollT: 0, prerollLen: PREROLL, burn: 0, wheelie: 0,
    targetEt: setup.targetEt, raceNo, laneZ, tree: new THREE.Vector3(7, 1.95, 0), finishX: TRACK_LENGTH, smokeK: 1.6, tyres: tier,
  };
  return {
    sim, bot: makeBot(profile, raceNo * 31 + 7), director, fx, phase: 'preroll', prerollT: 0, prerollOff: -BURNOUT_BACK, acc: 0, T: 0, doneT: 0,
    marks: {}, view, wheelie: 0, wheelieVel: 0, result: null,
  };
}

function ghostMeters(r: Run) {
  const s = r.sim.state, te = r.sim.setup.targetEt;
  const t = Math.max(0, s.t);
  if (t <= te) return ghostX(t, te);
  const vEnd = ghostV(te, te), d = Math.min(t - te, vEnd / 9);
  return TRACK_LENGTH + vEnd * d - 4.5 * d * d;
}

function step(r: Run, dt: number) {
  const s = r.sim.state;
  const v = r.view;
  const mark = (k: string) => (r.marks[k] ??= r.T);
  r.T += dt;
  let burn = 0;
  let rollV = 0;
  if (r.phase === 'preroll') {
    const t = (r.prerollT += dt);
    burn = t < BURN_ON ? 0 : t < BURN_ON + 0.15 ? (t - BURN_ON) / 0.15 : t < BURN_OFF ? 1 : t < BURN_FADE ? 1 - (t - BURN_OFF) / (BURN_FADE - BURN_OFF) : 0;
    if (burn > 0) mark('burnout');
    const u = Math.min(1, Math.max(0, (t - ROLL_START) / (ROLL_END - ROLL_START)));
    const off = -BURNOUT_BACK * (1 - (0.5 - 0.5 * Math.cos(u * Math.PI)));
    rollV = (off - r.prerollOff) / Math.max(dt, 1e-4);
    r.prerollOff = off;
    if (t >= STAGE_AT) mark('stage');
    strip.setTree?.({ lights: 0, staged: [t >= STAGE_AT ? 2 : t >= PRESTAGE_AT ? 1 : 0, 2] });
    if (t >= PREROLL) {
      r.phase = 'live';
      r.prerollOff = 0;
    }
  } else if (r.phase !== 'done') {
    // Race3D's rule: slow-mo only once no shift is left to make
    const scale = s.gear >= 4 || s.phase === 'finished' ? r.director.slowmo : 1;
    r.acc += dt * scale;
    let n = 0;
    while (r.acc >= SIM_DT && n++ < 40) {
      if (s.phase !== 'finished') {
        const a = r.bot(r.sim);
        if (a) r.sim.input(a);
      }
      r.sim.step();
      r.acc -= SIM_DT;
    }
    strip.setTree?.({ lights: s.lights, staged: [2, 2] });
    if (s.lights >= 1) mark('amber1');
    if (s.lights === 4) mark('green');
    if (s.launched) mark('launch');
    for (const g of s.grades) if (g.kind === 'shift') mark(`shift${g.gear}`);
    if (s.nitroActive) mark('nitro');
    if (s.phase === 'finished') {
      mark('finish');
      if (r.result === null) r.result = r.sim.result().margin;
      r.phase = 'finishing';
      if (s.v < 0.1) r.phase = 'done';
    }
  }
  if (r.director.shot === 'coast') mark('coast');
  if (r.director.shot === 'finish_photo') mark('photo');
  // place + animate cars
  const gm = ghostMeters(r);
  const gv = s.t > 0 ? Math.max(0, ghostV(Math.min(s.t, r.sim.setup.targetEt), r.sim.setup.targetEt) - (s.t > r.sim.setup.targetEt ? 9 * (s.t - r.sim.setup.targetEt) : 0)) : 0;
  player.root.position.x = s.x + r.prerollOff - frontWheel(player);
  ghost.root.position.x = gm - frontWheel(ghost);
  const wr = player.build.dims.wheelR;
  const front = r.phase === 'preroll' ? rollV / wr : s.v / wr;
  const rear = r.phase === 'preroll' ? Math.max(rollV / wr, burn * 120) : s.launched ? (Math.max(s.v, s.wheelspin ? 6 : 0) / wr) * (s.wheelspin ? 1.8 : 1) : 0;
  player.setWheelSpin(front, rear);
  ghost.setWheelSpin(gv / ghost.build.dims.wheelR);
  player.setSuspension(Math.min(0.05, Math.max(-0.03, s.a * 0.003)) + burn * 0.02, 0, Math.min(0.03, Math.max(0, s.a * 0.002)) + burn * 0.015);
  // launch wheelie (2D spring, radians)
  const since = s.launched ? s.t - (s.reaction ?? 0) : -1;
  if (since >= 0 && since < 0.04 && r.wheelieVel === 0 && r.wheelie === 0) r.wheelieVel = 1.0;
  if (r.wheelie !== 0 || r.wheelieVel !== 0) {
    const w = 9, z = 0.6, h = dt / 4;
    for (let i = 0; i < 4; i++) {
      r.wheelieVel += (-w * w * r.wheelie - 2 * z * w * r.wheelieVel) * h;
      r.wheelie += r.wheelieVel * h;
      if (r.wheelie < 0) { r.wheelie = 0; r.wheelieVel = Math.abs(r.wheelieVel) > 0.1 ? -r.wheelieVel * 0.25 : 0; }
      if (P('bar') === '1' && r.wheelie > 0.056) { r.wheelie = 0.056; if (r.wheelieVel > 0) r.wheelieVel = 0; }
    }
    if (r.wheelie < 0.001 && Math.abs(r.wheelieVel) < 0.02) r.wheelie = r.wheelieVel = 0;
  }
  player.setWheelie(r.wheelie);
  player.setNitro(s.nitroActive);
  player.setBrakeLights(s.phase === 'finished');
  ghost.setBrakeLights(gm > TRACK_LENGTH);
  player.update(dt);
  ghost.update(dt);
  // view
  v.phase = r.phase;
  v.prerollT = r.prerollT;
  v.burn = burn;
  v.ghostX = gm;
  v.ghostV = gv;
  v.wheelie = r.wheelie;
  v.margin = r.result ?? undefined;
  v.dnf = r.sim.hzs.dnf;
  v.scrape = P('bar') === '1' ? r.wheelie > 0.05 : r.wheelie > 0.075;
  if (P('gust')) v.gust = s.phase === 'running' ? Number(P('gust')) : 0;
  r.director.update(dt, v);
  r.fx.update(dt * r.director.slowmo, camera, v);
  rig?.follow?.(new THREE.Vector3(player.root.position.x + 1.5, 0, laneZ.player * 0.5), 12);
  strip.update?.(dt, r.T);
}

// ------------------------------------------------------------------ boot, loop, headless API

let run = newRun();
let frozen = false;
const info = document.getElementById('info')!;

function resize() {
  const stage = document.getElementById('stage')!;
  const w = Math.round(stage.clientWidth), h = Math.round(stage.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer?.setSize?.(w, h);
}

function setupPost() {
  if (P('post') === '0') return;
  if (POST) {
    composer = (POST.createComposer as Fn)(renderer, scene, camera, quality) as Composer;
    (composer as Composer & { gradePreset?(n: string): void }).gradePreset?.('race');
  } else {
    const ec = new EffectComposer(renderer);
    ec.addPass(new RenderPass(scene, camera));
    ec.addPass(new UnrealBloomPass(new THREE.Vector2(640, 360), 0.55, 0.45, 0.9));
    ec.addPass(new OutputPass());
    composer = { render: () => ec.render(), setSize: (w, h) => ec.setSize(w, h), insertPass: (p, i) => ec.insertPass(p as never, i) };
  }
  if (fx?.hazePass && P('haze') !== '0') composer.insertPass?.(fx.hazePass, 1);
}

function render(dt: number) {
  const d = run.director;
  if (composer) {
    composer.setFocus?.(d.dof.focus, P('dof') === '0' ? 0 : d.dof.aperture);
    composer.setSpeedBlur?.(d.blur.k, { dir: d.blur.dir, radial: d.blur.radial, center: d.blur.center, protect: d.blur.protect });
    composer.render(dt);
  } else renderer.render(scene, camera);
}

function seekTo(o: { at?: string; off?: number; seek?: number; x?: number }) {
  const off = o.off ?? 0;
  const dt = 1 / 60;
  for (let i = 0; i < 60 * 40; i++) {
    if (o.seek !== undefined && run.T >= o.seek) break;
    if (o.x !== undefined && run.sim.state.x >= o.x) break;
    if (o.at && run.marks[o.at] !== undefined && run.T >= run.marks[o.at] + off) break;
    step(run, dt);
  }
}

function showInfo() {
  const s = run.sim.state;
  info.textContent = `${run.director.shot}  T ${run.T.toFixed(2)}  t ${s.t.toFixed(2)}  x ${s.x.toFixed(1)}  ${(s.v * 3.6).toFixed(0)} km/h  g${s.gear}  slowmo ${run.director.slowmo.toFixed(2)}  ${JSON.stringify(run.fx.stats())}  ${quality}${ENV ? '' : ' [stand-in strip]'}`;
}

let last = performance.now();
function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!frozen) {
    step(run, dt);
    if (run.phase === 'done' && (run.doneT += dt) > 2.5) run = newRun();
  }
  render(dt);
  showInfo();
  frames++;
  requestAnimationFrame(loop);
}
let frames = 0;

resize();
setupPost();
resize();
window.addEventListener('resize', resize);
const at = P('at'), seek = P('seek'), xq = P('x');
if (at || seek || xq) seekTo({ at: at || undefined, off: Number(P('off', '0')), seek: seek ? Number(seek) : undefined, x: xq ? Number(xq) : undefined });
frozen = P('freeze') === '1';
render(1 / 60);
showInfo();
requestAnimationFrame(loop);
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') frozen = !frozen;
  if (e.key === 'r') run = newRun();
});

const dev = {
  ready: true,
  frames: () => frames,
  /** Restart and fast-forward: { at, off, seek, x, shot } then freeze and render one frame. */
  run(o: { at?: string; off?: number; seek?: number; x?: number; shot?: ShotId | null }) {
    if (o.shot !== undefined) qs.set('shot', o.shot ?? '');
    run = newRun();
    seekTo(o);
    frozen = true;
    render(1 / 60);
    showInfo();
    return dev.info();
  },
  /** Fire an FX/camera event, then advance n frames and render (e.g. fire('purge', 15)). */
  fire(kind: string, n = 10) {
    const e = { kind } as Parameters<RaceFx3D['onEvent']>[0];
    run.fx.onEvent(e);
    run.director.onEvent(e);
    for (let i = 0; i < n; i++) step(run, 1 / 60);
    render(1 / 60);
    showInfo();
    return run.fx.stats();
  },
  /** The player's fitted exhaust tips (world) and directions, as the FX see them. */
  tips() {
    const c = player as Car3D & { exhaustCount?: number; exhaustDirWorld?(i: number, o: THREE.Vector3): THREE.Vector3 };
    const n = c.exhaustCount ?? player.build.anchors.exhausts.length;
    const out: number[][] = [];
    for (let i = 0; i < n; i++) {
      const p = c.exhaustWorld(i, new THREE.Vector3()).sub(player.root.position);
      const d = c.exhaustDirWorld?.(i, new THREE.Vector3()) ?? new THREE.Vector3();
      out.push([+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2)]);
    }
    const a = player.build.anchors;
    return { n, out, front: a.frontBumper.toArray(), hood: a.hood.toArray(), root: player.root.position.toArray(), rootParent: player.root.parent?.type };
  },
  info() {
    const s = run.sim.state;
    return { cam: camera.position.toArray().map((v) => +v.toFixed(2)), root: player.root.position.toArray().map((v) => +v.toFixed(2)), shot: run.director.shot, dof: { ...run.director.dof }, blur: JSON.parse(JSON.stringify(run.director.blur)), fov: camera.fov, T: run.T, t: s.t, x: s.x, v: s.v, gear: s.gear, slowmo: run.director.slowmo, marks: run.marks, fx: run.fx.stats(), env: !!ENV, post: !!POST, light: !!LIGHT, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  },
  /** GPU-synced frame cost (ms) over n frames: whole frame, then with FX hidden. Also the CPU update cost. */
  perf(n = 60) {
    const gl = renderer.getContext();
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const time = (f: () => void) => {
      f(); sync();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { f(); sync(); }
      return (performance.now() - t0) / n;
    };
    const fxg = scene.getObjectByName('fx')!;
    const hz = run.fx.hazePass;
    const full = time(() => render(1 / 60));
    const hazeOn = hz?.enabled ?? false;
    fxg.visible = false;
    if (hz) hz.enabled = false;
    const bare = time(() => render(1 / 60));
    fxg.visible = true;
    if (hz) hz.enabled = hazeOn;
    // CPU: director + fx update
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      run.director.update(1 / 600, run.view);
      run.fx.update(1 / 600, camera, run.view);
    }
    const cpu = (performance.now() - t0) / n;
    return { full, bare, fxGpu: full - bare, cpuUpdate: cpu, info: dev.info() };
  },
};
(window as unknown as { __dev: typeof dev }).__dev = dev;
