// The 3D race world: the bridge from the deterministic sim to three.js. Owns the scene, camera, strip, lighting,
// both cars, boss hazards, the cinematic director, the race FX and the post chain, and renders into the shared
// layer behind the Phaser HUD. Race3DScene drives it once per frame with the sim state it already reads; nothing
// here feeds back into the sim. Lazy: only loaded through Race3DScene's dynamic import.
//
// Mapping: world x = metres down the strip; the sim's state.x maps to the FRONT WHEELS (stage beams trip on the
// front tyre: front wheels at x = 0 when staged). Player lane +Z, ghost -Z (env/layout.ts).
import * as THREE from 'three';
import type Phaser from 'phaser';
import type { Grade, SimState, Tier } from '../../../core/types';
import { settings, type Quality } from '../../../game/settings';
import { TRACK_LENGTH, ghostV, type HazardState, type RaceSim } from '../../../sim/RaceSim';
import type { CarVisual } from '../../car';
import { buildCar3D, plateFor, specFromVisual, type KitCar3D } from '../cars/index';
import { kitStyle } from '../cars/kit/style';
import { buildDragStrip, shaderLog, type DragStrip } from '../env/index';
import { LANE_W, OUTER_Z, TREE_X } from '../env/layout';
import { raceLighting, type RaceRig } from '../lighting';
import * as Post from '../post';
import { createComposer, type Post as PostChain } from '../post';
import { getThreeLayer, setPhaserClear, type ThreeLayer } from '../renderer';
import type { Car3D } from '../types';
import { CameraDirector, type CineEvent, type CineEventKind, type CinePhase, type CineView } from './camera';
import { RaceFx3D } from './fx';
import { Hazards3D } from './hazards';

// ------------------------------------------------------------------ contract (shared with cine: camera.ts / fx.ts)

/** Race events (cine's CineEvent): counts ride in n2, flame / shake durations in ms, shake amplitude in amp. */
export type RaceEventKind = CineEventKind;
export type RaceEvent = CineEvent;

/** One object per race, updated in place every frame. CameraDirector and RaceFx3D read it. */
export interface RaceView extends CineView {
  player: Car3D;
  ghost: Car3D;
  state: SimState;
  phase: CinePhase;
  /** Real seconds since the world was created, and this frame's real dt. */
  t: number;
  dt: number;
  hzs: HazardState;
  /** Player front-wheel world x (state.x + the preroll offset). */
  playerX: number;
  /** Body pitch (rad, + nose up). */
  pitch: number;
  /** 0..1 tyre glow (heats in the burnout / wheelspin). */
  heat: number;
  /** Continuous FX rates, the same signals the 2D scene uses: tyre smoke 0..~2 (x smokeK), rubber 0..1. */
  smoke: number;
  rubber: number;
  /** Oil flung off the rear tyre; heat haze at high rpm; dust at speed 0..1; wheelie bar / bumper on the strip. */
  oilFling: boolean;
  haze: number;
  dust: number;
  scrape: boolean;
  /** Gust strength on the car now (0..1). */
  gust: number;
  /** Events this frame (also delivered through onEvent). */
  events: RaceEvent[];
  /**
   * Which cars are loud enough to spit flames on upshifts / launch (sport+ exhaust or engine, or a boss).
   * FX: gate the automatic shift / launch jet bursts on it; misses, limiter and backfires still pop.
   */
  flames: { player: boolean; ghost: boolean };
}

export interface RaceWorldOpts {
  sim: RaceSim;
  player: CarVisual;
  ghost: CarVisual;
  quality: Quality;
  smokeK: number;
  tyres: Tier;
  raceNo: number;
  /** The player's car has a wheelie bar (pro suspension): caps the wheelie at ~3 deg. */
  wheelieBar: boolean;
  /** The opponent is a boss (bigger launch, harder pull). */
  boss: boolean;
  /** The opponent's name (its own licence plate). */
  ghostName?: string;
}

/** What the scene hands in every frame (the preroll is scene-side and visual only). */
export interface FrameInput {
  realDt: number; // s
  phase: CinePhase;
  prerollT: number;
  /** Player offset (m) behind the line during the preroll; 0 once live. */
  prerollOff: number;
  /** m/s of that roll (for the wheels). */
  rollV: number;
  burn: number;
  ghostX: number;
  ghostV: number;
  /** Stage lights for the tree (player): 0 none, 1 pre-stage, 2 staged. */
  staged: number;
  falseStart: boolean;
  margin?: number;
  dnf?: string | null;
  /** The player's distance (m) interpolated between 120 Hz sim steps for this frame (default: state.x). */
  x?: number;
  /** The ghost's own preroll: offset behind the line (m), roll speed (m/s), burnout 0..1, stage bulbs 0..2. */
  ghostOff?: number;
  ghostRollV?: number;
  ghostBurn?: number;
  ghostStaged?: number;
}

// ------------------------------------------------------------------ helpers

const DEG = Math.PI / 180;
const WHEELIE_BAR_MAX = 3.2; // deg: the bar wheel touches down at ~3 (as 2D)
const PREROLL = 2.4;

/**
 * One car's body attitude, in real units (degrees, seconds, metres). Pitch: an underdamped spring on low-passed
 * acceleration (the driveline's ~40 ms compliance), soft-limited, with impulse kicks at launch and shifts (nod +
 * re-squat). Wheelie: lift driven by acceleration (capped by the wheelie bar), plus a launch kick; the front drops
 * faster than it rises and a landing goes into the body instead of bouncing. Yaw / lateral: small springs for oil
 * spins, tyre shake, gusts and high-speed wander. All frame-rate independent (4 substeps).
 */
class CarMotion {
  aF = 0; // low-passed accel, m/s^2
  p = 0; // pitch, deg (+ = nose up)
  pv = 0; // deg/s
  w = 0; // wheelie, deg
  wv = 0;
  holdA = 0;
  holdT = 0;
  yaw = 0; // rad (+ = nose toward -Z)
  yawV = 0;
  lat = 0; // m (+ = toward +Z)
  latV = 0;
  yawTgt = 0;
  latTgt = 0;
  constructor(readonly bar: boolean) {}

  kick(degPerS: number) {
    this.pv += degPerS;
  }

  /** Launch wheelie kick (amp in degrees: 0 stock .. ~7 pro), held briefly by the launch torque. */
  wheelieKick(amp: number, touchBar = false) {
    this.wv += amp * 13;
    this.holdA = amp * 0.6;
    this.holdT = amp > 2 ? 0.22 : 0.08;
    if (touchBar && this.bar) {
      // a perfect launch on a bar car really lands on the bar (contact-gated sparks fire)
      this.holdA = Math.max(this.holdA, WHEELIE_BAR_MAX + 0.4);
      this.holdT = Math.max(this.holdT, 0.18);
    }
  }

  /** Visible pitch (deg) after the soft limit. */
  get pitch() {
    return 3.6 * Math.tanh(this.p / 3.6);
  }

  /** speed (m/s): no sustained lift at speed; noLift: the tyres are blown away (a missed launch), nothing to lift on. */
  step(dt: number, a: number, nitro: number, burn: number, speed = 0, noLift = false) {
    if (dt <= 0) return;
    this.aF += (a - this.aF) * (1 - Math.exp(-dt / 0.04));
    const tgt = THREE.MathUtils.clamp(this.aF * 0.2, -1.6, 3.2) + 0.6 * nitro + 1.1 * burn;
    let lift = THREE.MathUtils.clamp((this.aF - 14) * 0.45, 0, this.bar ? WHEELIE_BAR_MAX + 0.4 : 6);
    // a few tenths of a degree just reads as hovering front tyres: below 0.8 deg (or past ~160 km/h) they stay down
    if (noLift || lift < 0.8 || speed > 45) lift = 0;
    this.holdT -= dt;
    const wt = Math.max(lift, this.holdT > 0 ? this.holdA : 0);
    const W = 14, Z = 0.42;
    const ww = wt < this.w ? 13 : 9; // the nose drops faster than the torque lifts it
    const YW = 6, YZ = 0.55, LW = 1.2, LZ = 0.9;
    const h = dt / 4;
    for (let i = 0; i < 4; i++) {
      this.pv += (W * W * (tgt - this.p) - 2 * Z * W * this.pv) * h;
      this.p += this.pv * h;
      this.wv += (-ww * ww * (this.w - wt) - 2 * 0.6 * ww * this.wv) * h;
      this.w += this.wv * h;
      if (this.w < 0) {
        // the front tyres land: no rigid bounce, the hit goes into the body
        if (this.wv < 0) this.pv -= Math.abs(this.wv) * 0.5;
        this.w = 0;
        this.wv = 0;
      }
      if (this.bar && this.w > WHEELIE_BAR_MAX) {
        this.w = WHEELIE_BAR_MAX; // up on the bar
        if (this.wv > 0) this.wv = 0;
      }
      this.yawV += (YW * YW * (this.yawTgt - this.yaw) - 2 * YZ * YW * this.yawV) * h;
      this.yaw += this.yawV * h;
      this.latV += (LW * LW * (this.latTgt - this.lat) - 2 * LZ * LW * this.latV) * h;
      this.lat += this.latV * h;
    }
    const YMAX = 3.5 * DEG;
    this.yaw = YMAX * Math.tanh(this.yaw / YMAX);
    this.lat = 0.35 * Math.tanh(this.lat / 0.35);
  }
}

/** Post-finish visual coast (the sim keeps its own): a lift, then the chute (or brakes) bites. */
interface Coast {
  on: boolean;
  x: number;
  v: number;
  t: number;
  chute: boolean;
  chuteK: number;
  bloomed: boolean;
}
const newCoast = (chute: boolean): Coast => ({ on: false, x: 0, v: 0, t: 0, chute, chuteK: 0, bloomed: false });
function coastDecel(c: Coast): number {
  const t = c.t;
  if (t < 0.35) return 2; // off the throttle
  if (!c.chute) return t < 0.55 ? 2 + ((t - 0.35) / 0.2) * 10 : 12; // brakes (hard: visibly slowing before the cut)
  if (t < 0.4) return 2;
  if (t < 0.75) return 2 + ((t - 0.4) / 0.35) * 20; // canopy fills
  return t < 2.0 ? 22 : 8;
}

// ------------------------------------------------------------------ the session's world

/**
 * ONE race world per session (per quality), reused by every race: the strip, lights, FX pools, post chain and the
 * shader programs they compiled stay alive between races (a cold shader compile is many seconds on some GPUs), so
 * only the first race loads; reruns and later races just swap cars / hazards and reset. Parked (hidden, Phaser
 * opaque again) between races; disposed when 3D is switched off, the quality changes or the context is lost.
 */
let session: { quality: Quality; p: Promise<RaceWorld> } | null = null;

/** Get the session's world ready for this race (builds it the first time). Throws if 3D can't run. */
export async function acquireRaceWorld(game: Phaser.Game, o: RaceWorldOpts): Promise<RaceWorld> {
  if (session && session.quality !== o.quality) disposeRaceWorld();
  if (!session) {
    const p = (async () => {
      const layer = await getThreeLayer(game);
      if (!layer) throw new Error('3D unavailable (no WebGL2)');
      return new RaceWorld(game, layer, o.quality);
    })();
    session = { quality: o.quality, p };
    p.catch(() => session?.p === p && (session = null));
  }
  const s = session;
  const w = await s.p;
  if (w.isDisposed) {
    if (session === s) session = null;
    return acquireRaceWorld(game, o);
  }
  await w.begin(o);
  return w;
}

/** Free the session's world (GPU included). */
export function disposeRaceWorld() {
  const s = session;
  session = null;
  s?.p.then((w) => w.dispose()).catch(() => {});
}

// switching back to 2D frees the 3D race's GPU memory
settings.subscribe((st) => {
  if (st.renderMode !== '3d' && session) disposeRaceWorld();
});

export class RaceWorld {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 1500);
  readonly view: RaceView;
  readonly director: CameraDirector;
  readonly quality: Quality;
  /** Rolling frame-time stats (ms of CPU in frame(): sim-to-world + render submit) and >50 ms spikes. */
  readonly perf = { frames: 0, total: 0, max: 0, last: 0, samples: [] as number[], spikes: [] as { ms: number; t: number; phase: string; programs: number; names: string }[] };
  /** Dev / perf: ms per load phase (first race: strip, rig, fx+post; every race: cars, hazards, compile, warmRender). */
  readonly loadTimes: Record<string, number> = {};
  private progSeen = 0;

  private layer: ThreeLayer;
  private game: Phaser.Game;
  private o!: RaceWorldOpts;
  private strip: DragStrip;
  private rig: RaceRig;
  private composer: PostChain;
  private fx: RaceFx3D;
  private hazards: Hazards3D | null = null;
  private player!: Car3D;
  private ghost!: Car3D;
  private playerKey = '';
  private ghostKey = '';
  private pFrontWheel = 0; // root x -> front wheel x offset
  private gFrontWheel = 0;
  private wheelbase = 2.7;
  private offs: (() => void)[] = [];
  private shown = false;
  private disposed = false;
  private warm = false;
  private busy: Promise<unknown> = Promise.resolve();
  /** Dev: warns about every shader program compiled after the race is shown (a late compile = a hitch). */
  private shaderLog: (() => number) | null = null;

  // per-car body motion (real units) and post-finish visual coast
  private pm = new CarMotion(false);
  private gm = new CarMotion(false);
  private pCoast = newCoast(false);
  private gCoast = newCoast(false);
  /** Presentation state handed to camera / FX as view.state: the sim's, interpolated, with traction read right. */
  private vs = {} as SimState;
  private launchGrade: Grade | null = null;
  private gLaunched = false;
  private gPrevV = 0;
  private gShift = 0; // visual ghost shifts done
  /** The opponent's car is loud enough to flame on shifts (bosses, or a sport/pro exhaust or engine). */
  private ghostLoud = false;
  private gCutT = 0;
  private prevRollV = 0;
  private spinT = -1; // s since a real wheelspin / oil spin began (-1 = none)
  private spinSign = 1;
  private wasOil = false;
  private heat = 0;
  private brakes = false;
  private gBrakes = false;
  private wasGust = 0;
  private scoreboardSet = false;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(game: Phaser.Game, layer: ThreeLayer, quality: Quality) {
    this.game = game;
    this.layer = layer;
    this.quality = quality;
    const renderer = layer.renderer;
    const scene = this.scene;
    const mark = this.timer();
    // strip (env) with its PMREM stadium env map; lighting (look) on top of it
    this.strip = buildDragStrip({ quality, renderer });
    mark('strip');
    scene.add(this.strip.group);
    scene.fog = this.strip.fog;
    scene.background = this.strip.background;
    const laneZ = this.strip.laneZ;
    this.rig = raceLighting(scene, { envMap: this.strip.envMap, renderer, quality });
    mark('rig');
    const tree = new THREE.Vector3(TREE_X, 1.95, 0);
    this.director = new CameraDirector(this.camera, { raceNo: 1, laneZ, tree, finishX: TRACK_LENGTH, hud: { bottom: 60 / 360, top: 56 / 360 } });
    this.composer = createComposer(renderer, scene, this.camera, quality);
    this.composer.gradePreset('race');
    this.fx = this.makeFx();
    mark('fx+post');

    this.view = {
      player: null as unknown as Car3D,
      ghost: null as unknown as Car3D,
      state: null as unknown as SimState,
      ghostX: 0,
      ghostV: 0,
      phase: 'preroll',
      prerollT: 0,
      prerollLen: PREROLL,
      burn: 0,
      wheelie: 0,
      targetEt: 14,
      raceNo: 1,
      laneZ,
      tree,
      finishX: TRACK_LENGTH,
      smokeK: 1,
      tyres: 'stock',
      t: 0,
      dt: 0,
      hzs: null as unknown as HazardState,
      playerX: 0,
      pitch: 0,
      heat: 0,
      smoke: 0,
      rubber: 0,
      oilFling: false,
      haze: 0,
      dust: 0,
      scrape: false,
      gust: 0,
      events: [],
      flames: { player: true, ghost: true },
    };

    const resize = (w: number, h: number) => {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.composer.setSize(w, h);
    };
    const sz = layer.size();
    resize(sz.w, sz.h);
    this.offs.push(layer.onResize(resize));
    this.offs.push(layer.onLost(() => this.dispose()));
  }

  get isDisposed() {
    return this.disposed;
  }

  private timer() {
    let tp = performance.now();
    return (k: string) => {
      const n = performance.now();
      this.loadTimes[k] = Math.round(n - tp);
      tp = n;
    };
  }

  /** Set up for a race: cars (rebuilt only if the build changed), fresh hazards, reset FX / camera / strip / state. */
  begin(o: RaceWorldOpts): Promise<void> {
    const run = this.busy.then(() => this.beginNow(o));
    this.busy = run.catch(() => {});
    return run;
  }

  private async beginNow(o: RaceWorldOpts) {
    if (this.disposed) throw new Error('race world disposed');
    this.park();
    this.o = o;
    const mark = this.timer();
    let added = !this.warm;
    const gSpec = { plate: o.ghostName ? plateFor(o.ghostName) : undefined };
    const pk = JSON.stringify(specFromVisual(o.player));
    const gk = JSON.stringify(specFromVisual(o.ghost, gSpec));
    if (pk !== this.playerKey) {
      if (this.player) this.dropCar(this.player);
      this.player = this.makeCar(o.player, this.quality, 'auto', {});
      this.playerKey = pk;
      added = true;
    }
    if (gk !== this.ghostKey) {
      if (this.ghost) this.dropCar(this.ghost);
      // the ghost is never the hero: one LOD down, no dynamic light of its own (every light costs every material)
      this.ghost = this.makeCar(o.ghost, this.quality === 'high' ? 'medium' : this.quality, 'none', gSpec);
      this.ghostKey = gk;
      added = true;
    }
    // FX keep per-car pieces (flame jets) keyed by car: a new car gets a fresh FX set, the old one is freed
    if (added && this.warm) {
      if (this.fx.hazePass) this.composer.removePass(this.fx.hazePass);
      this.fx.dispose();
      this.fx = this.makeFx();
    }
    const laneZ = this.strip.laneZ;
    for (const c of [this.player, this.ghost]) {
      c.setBrakeLights(false);
      c.setNitro(false);
      c.setWheelie(0);
      c.setSuspension(0, 0, 0);
      c.setWheelSpin(0, 0);
    }
    const pa = this.player.build.anchors;
    this.pFrontWheel = pa.wheelFL.x;
    this.gFrontWheel = this.ghost.build.anchors.wheelFL.x;
    this.wheelbase = pa.wheelFL.x - pa.wheelRL.x;
    this.player.root.position.set(-this.pFrontWheel - 4, 0, laneZ.player);
    this.ghost.root.position.set(-this.gFrontWheel, 0, laneZ.ghost);
    mark('cars');
    this.hazards?.dispose();
    this.hazards = new Hazards3D(this.scene, o.sim, { quality: this.quality, laneZ: laneZ.player, laneW: LANE_W, wallZ: OUTER_Z, wheelbase: this.wheelbase });
    if (o.sim.hz.oil.length || o.sim.hz.gusts.length) added = true;
    mark('hazards');

    // per-race state
    const pStyle = kitStyle(specFromVisual(o.player));
    const gStyle = kitStyle(specFromVisual(o.ghost));
    this.pm = new CarMotion(pStyle.wheelieBar);
    this.gm = new CarMotion(gStyle.wheelieBar);
    const hasChute = (c: Car3D, style: { chute: boolean }) => (c as { hasChute?: boolean }).hasChute ?? style.chute;
    this.pCoast = newCoast(hasChute(this.player, pStyle));
    this.gCoast = newCoast(hasChute(this.ghost, gStyle));
    for (const c of [this.player, this.ghost]) (c as Partial<{ setChute(k: number): void }>).setChute?.(0);
    this.launchGrade = null;
    const rank = (t: Tier | undefined) => ['stock', 'street', 'sport', 'pro'].indexOf(t ?? 'stock');
    this.ghostLoud = o.boss || rank(o.ghost.exhaust) >= 2 || rank(o.ghost.engine) >= 2;
    this.view.flames = { player: rank(o.player.exhaust) >= 2 || rank(o.player.engine) >= 2, ghost: this.ghostLoud };
    this.gPrevV = this.heat = this.wasGust = this.gShift = this.gCutT = this.prevRollV = 0;
    this.spinT = -1;
    this.spinSign = o.raceNo % 2 ? 1 : -1;
    this.gLaunched = this.brakes = this.gBrakes = this.scoreboardSet = this.wasOil = false;
    const v = this.view;
    Object.assign(v, {
      player: this.player, ghost: this.ghost, state: Object.assign(this.vs, o.sim.state), hzs: o.sim.hzs, targetEt: o.sim.setup.targetEt, raceNo: o.raceNo,
      smokeK: o.smokeK, tyres: o.tyres, t: 0, dt: 0, phase: 'preroll', prerollT: 0, burn: 0, wheelie: 0, ghostX: 0, ghostV: 0,
      margin: undefined, dnf: null, oilSpin: false, gust: 0,
    });
    v.events.length = 0;
    this.director.reset(o.raceNo);
    (this.fx as unknown as { reset?(): void }).reset?.();
    this.strip.setTree({ lights: 0, staged: [0, 2] });
    this.strip.setScoreboard(null, null, null, null, null);
    this.perf.frames = this.perf.total = this.perf.max = 0;
    this.perf.samples.length = this.perf.spikes.length = 0;
    if (added) await this.warmUp();
    this.warm = true;
  }

  private makeFx(): RaceFx3D {
    const fx = new RaceFx3D(this.scene, this.quality, { lightAt: (x, z) => this.strip.lightAt(x, z), keyLight: this.rig.key });
    if (fx.hazePass) this.composer.insertPass(fx.hazePass, 1);
    return fx;
  }

  private makeCar(visual: CarVisual, quality: Quality, lights: 'auto' | 'none', specOpts: { plate?: string }): Car3D {
    const c = buildCar3D(specFromVisual(visual, specOpts), { quality, lights });
    // the car-only mask layer (post keeps the cars out of the speed blur), on every part that rides on the car
    const maskLayer = (Post as Record<string, unknown>).CAR_MASK_LAYER;
    // Not the chute: it only appears after the line, and post rescans its mask list every 30 frames, so for up to half
    // a second the canopy would be drawn into the mask pass with its own material and no lights: a late compile. It
    // trails behind the car, so a little speed blur on it costs nothing. (Instanced parts are skipped for the same reason.)
    const enableMask = (o: THREE.Object3D) => {
      if (o.name === 'chute') return;
      if (!(o as THREE.InstancedMesh).isInstancedMesh) o.layers.enable(maskLayer as number);
      o.children.forEach(enableMask);
    };
    if (typeof maskLayer === 'number') enableMask(c.root);
    // Stadium light pools on the car's paint (the panels that matter; every patched material is a big extra
    // shader program). Library materials (userData.shared) outlive the strip, so they are never patched.
    const paint = new Set<THREE.Material>();
    for (const m of c.build.paintMeshes) for (const x of [m.material].flat()) paint.add(x);
    c.root.traverse((m) => {
      const mesh = m as THREE.Mesh;
      if (!mesh.isMesh) return; // (shadow flags are the kit's: glass, blur discs and chute lines don't cast)
      for (const x of [mesh.material].flat())
        if (paint.has(x) && !x.userData.shared && !x.userData.slPatched && (x as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          x.userData.slPatched = true;
          this.strip.patchStadiumLights(x);
        }
    });
    c.setHeadlights(true);
    this.scene.add(c.root);
    return c;
  }

  private dropCar(c: Car3D) {
    this.scene.remove(c.root);
    c.dispose();
  }

  /**
   * Compile every program up front, so launch / nitrous / speed blur / the finish never hitch: every material in
   * the scene (hidden FX included), the shadow-depth variants, and each post pass that only runs on demand (DOF,
   * speed blur). Rendered into the still-hidden canvas while the HUD shows LOADING.
   */
  private async warmUp() {
    // one dry frame first: FX / kit create their per-car pieces (flame jets...) on first update. Then switch on
    // every state that may swap in material variants (nitrous, brake lights) and fire the FX once, so their
    // programs compile now; all of it is reset below.
    this.frame({ realDt: 0, phase: 'preroll', prerollT: 0, prerollOff: -4, rollV: 0, burn: 0, ghostX: 0, ghostV: 0, staged: 0, falseStart: false }, false);
    const cars = [this.player, this.ghost];
    cars.forEach((c) => (c.setNitro(true), c.setBrakeLights(true)));
    // the chute only reaches its open shape (and its final program variant) once deployed: open it for the warm-up
    const chutes = cars.filter((c) => (c as { hasChute?: boolean }).hasChute) as (Car3D & { setChute(k: number): void })[];
    for (const c of chutes) {
      c.setChute(1);
      for (let i = 0; i < 12; i++) c.update(0.05);
    }
    for (const kind of ['burnout', 'flame', 'backfire', 'purge', 'sparks', 'exhaustPuff', 'flutter'] as const) this.fx.onEvent({ kind, who: 'player', ms: 120, n2: 4 });
    this.fx.update(1 / 60, this.camera, this.view);
    const hidden: THREE.Object3D[] = [];
    const culled: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      // lights keep their state: the light count is part of every lit program's key
      if (!o.visible && !(o as THREE.Light).isLight) {
        hidden.push(o);
        o.visible = true;
      }
      // no culling during the warm render: packed / zero-scale parts (the chute) still build their shadow-depth programs
      if (o.frustumCulled) {
        culled.push(o);
        o.frustumCulled = false;
      }
    });
    const r = this.layer.renderer;
    const mark = this.timer();
    try {
      // Compile against the composer's HDR target: tone mapping and output colour space are part of every program's
      // key, so compiling for the canvas would build a second, unused set. compile() runs synchronously inside the
      // call; the await then lets KHR_parallel_shader_compile finish off the main thread.
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.composer.sceneTarget);
      // kit's own pass over each car (every material, the scene's real lights), cine's FX pass, then env compiles
      // the whole scene and renders one frame into the HDR target (shadow-map programs included)
      for (const c of cars) (c as Partial<KitCar3D>).prewarm?.(r, this.camera, this.scene);
      (this.fx as Partial<{ warmup(r: THREE.WebGLRenderer, c: THREE.Camera): void }>).warmup?.(r, this.camera);
      r.setRenderTarget(prev);
      await this.strip.warmup(r, this.camera, this.scene, this.composer.sceneTarget);
      // and a final sweep over everything (hazards included) with the HDR target bound
      r.setRenderTarget(this.composer.sceneTarget);
      const ready = r.compileAsync(this.scene, this.camera);
      r.setRenderTarget(prev);
      await ready;
      mark('compile');
      // every post variant the race can ask for: DOF strong + radial blur, DOF soft + directional blur with the car
      // mask (ellipse + depth), DOF + legacy protect, and the chroma composite
      const c = this.composer as PostChain & { setChroma?(k: number): void };
      c.setChroma?.(0.6);
      c.setFocus(6, 1);
      c.setSpeedBlur(1, { radial: true, center: [0.5, 0.5] });
      c.render(0);
      c.setFocus(14, 0.35);
      c.setSpeedBlur(1, { dir: [-1, 0], ellipse: { cx: 0.5, cy: 0.4, rx: 0.15, ry: 0.12 }, depth: 8 });
      c.render(0);
      c.setFocus(30, 0.6);
      c.setSpeedBlur(0.6, { dir: [1, 0], protect: 9 });
      c.render(0);
      c.setChroma?.(0.15);
    } finally {
      hidden.forEach((o) => (o.visible = false));
      culled.forEach((o) => (o.frustumCulled = true));
      this.composer.setFocus(8, 0);
      this.composer.setSpeedBlur(0);
      chutes.forEach((c) => c.setChute(0));
      cars.forEach((c) => (c.setNitro(false), c.setBrakeLights(false), c.update(0.5)));
      this.fx.reset();
    }
    this.composer.render(0);
    mark('warmRender');
  }

  /** Make the layer visible and Phaser transparent over it. */
  show() {
    if (this.shown || this.disposed) return;
    this.shown = true;
    this.layer.claim('race');
    setPhaserClear(this.game, true);
    if (import.meta.env.DEV) this.shaderLog = shaderLog(this.layer.renderer, 'race3d');
  }

  /** Between races: hide the layer, Phaser opaque again. Everything stays built for the next race. */
  park() {
    if (!this.shown) return;
    this.shown = false;
    this.shaderLog = null;
    setPhaserClear(this.game, false);
    this.layer.release('race');
  }

  /** Queue an event for this frame (camera + FX react to it). */
  emit(e: RaceEvent) {
    this.view.events.push(e);
    this.director.onEvent(e);
    this.fx.onEvent(e);
    // (the director owns every camera shake: 'shake' events go to it via onEvent above)
    if (e.kind === 'launch') {
      this.pm.kick(18);
      this.launchGrade = e.grade ?? 'good';
    }
    if (e.kind === 'shift') this.pm.kick(-16);
    if (e.kind === 'nitro') this.player.setNitro(true);
    if (e.kind === 'nitroEnd') this.player.setNitro(false);
    if (e.kind === 'finish') {
      // the crowd reacts to every result: a long roar for a photo finish, a roar for a win, a murmur for a loss
      const cheer = this.strip.cheer as (ms: number, k?: number) => void;
      if (e.close) cheer.call(this.strip, 3500, 1);
      else if (e.won) cheer.call(this.strip, 3000, 1);
      else cheer.call(this.strip, 2200, 0.35);
    }
  }

  /** Perfect launch with hook-up: a wheelie kick (amp in degrees, power-based: 0 stock .. ~7 pro). */
  startWheelie(amp: number, touchBar = false) {
    this.pm.wheelieKick(amp, touchBar);
  }

  /** A clean launch on a car too weak to lift the front: the nose pops up on the springs instead. */
  popNose(k = 1) {
    this.pm.kick(28 * k);
  }

  /** Speed to show on the HUD: the visual coast after the line (the sim's own coast is gentler). */
  displaySpeed(): number {
    return this.pCoast.on ? this.pCoast.v : this.o.sim.state.v;
  }

  /** Sim speed the director wants: slow-mo only after the line (the run itself always plays in real time). */
  slowmo(): number {
    const k = this.director.slowmo;
    if (this.o.sim.state.phase !== 'finished') return 1;
    return Number.isFinite(k) && k > 0 ? k : 1;
  }

  /** Project a world point to game px (640x360). vis = in front of the camera and on screen. */
  project(p: THREE.Vector3, out = { x: 0, y: 0, vis: false }) {
    this.tmp2.copy(p).project(this.camera);
    out.x = (this.tmp2.x + 1) * 320;
    out.y = (1 - this.tmp2.y) * 180;
    out.vis = this.tmp2.z < 1 && Math.abs(this.tmp2.x) <= 1 && Math.abs(this.tmp2.y) <= 1;
    return out;
  }

  /** The player car's roof on screen (game px), for the grade popups and the gust front. */
  playerScreen(out = { x: 0, y: 0, vis: false }) {
    const r = this.player.root.position;
    this.tmp.set(r.x, this.player.build.dims.height * 0.9, r.z);
    return this.project(this.tmp, out);
  }

  /** The ghost's roof on screen (game px); vis false when off-screen (gap arrows). */
  ghostScreen(out = { x: 0, y: 0, vis: false }) {
    const r = this.ghost.root.position;
    this.tmp.set(r.x, this.ghost.build.dims.height * 0.6, r.z);
    return this.project(this.tmp, out);
  }

  /** Player wheelbase (m): the sim's rear-wheel distances sit this far behind state.x. */
  get wheelbaseM() {
    return this.wheelbase;
  }

  /** Called if the WebGL context is lost mid-race. Returns an unsubscribe. */
  onLost(cb: () => void): () => void {
    return this.layer.onLost(cb);
  }

  /** Screen x of a world x on the player's lane (for the off-screen oil arrow); Infinity behind the camera. */
  laneScreenX(x: number): number {
    this.tmp.set(x, 0.2, this.view.laneZ!.player);
    const p = this.project(this.tmp);
    return this.tmp2.z < 1 ? p.x : Infinity;
  }

  /** The player car's screen ellipse in UV (bottom-left origin), padded 15%, for the speed-blur protection. */
  private carEllipse() {
    const car = this.player;
    const d = car.build.dims;
    const r = car.root.position;
    let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
    for (const sx of [-0.5, 0.5])
      for (const sy of [0, 1])
        for (const sz of [-0.5, 0.5]) {
          this.tmp.set(r.x + sx * d.length, sy * d.height, r.z + sz * d.width).project(this.camera);
          const u = this.tmp.x * 0.5 + 0.5;
          const w = this.tmp.y * 0.5 + 0.5;
          x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, w); y1 = Math.max(y1, w);
        }
    const e = this.ell;
    e.cx = (x0 + x1) / 2;
    e.cy = (y0 + y1) / 2;
    e.rx = Math.max(0.01, ((x1 - x0) / 2) * 1.15);
    e.ry = Math.max(0.01, ((y1 - y0) / 2) * 1.15);
    return e;
  }
  private ell = { cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1 };

  /** Place, animate, direct and render one frame. */
  frame(f: FrameInput, render = true) {
    if (this.disposed) return;
    const t0 = performance.now();
    const o = this.o;
    const s = o.sim.state;
    const hzs = o.sim.hzs;
    const v = this.view;
    const dt = f.realDt;
    const sdt = dt * this.slowmo(); // game time: everything that animates follows the slow-mo
    v.t += dt;
    v.dt = dt;
    v.phase = f.phase;
    v.prerollT = f.prerollT;
    v.burn = f.burn;
    v.margin = f.margin;
    v.dnf = f.dnf;

    // ---- traction, read the way a drag car shows it: hooked (traction-limited but pulling > 1.2 g) is not a spin
    const running = s.launched && s.phase === 'running';
    const sinceLaunch = s.launched ? s.t - (s.reaction ?? 0) : -1;
    const oilSpin = running && (hzs.spin > 0 || (hzs.onOil && s.wheelspin));
    // A MISSED launch on a big build still pulls ~1.5 g (the sim cuts grip to 0.82), but it is a blown launch: full
    // spin, smoke, no lift. A merely good launch gets a short spin hit before it hooks.
    const blown = running && s.wheelspin && this.launchGrade === 'miss' && sinceLaunch < 1.2;
    const goodHit = running && s.wheelspin && this.launchGrade === 'good' && sinceLaunch < 0.2;
    const realSpin = oilSpin || blown || goodHit || (running && s.wheelspin && s.a < 12);
    const hooked = running && s.wheelspin && !realSpin;
    v.oilSpin = oilSpin;
    if (realSpin) this.spinT = this.spinT < 0 ? 0 : this.spinT + sdt;
    else this.spinT = -1;

    // ---- positions: the sim's 120 Hz state interpolated to this frame, then the visual coast after the line
    const simX = f.x ?? s.x;
    const pc = this.pCoast;
    const gc = this.gCoast;
    if (s.phase === 'finished' && !pc.on) Object.assign(pc, { on: true, x: simX, v: s.v, t: 0 });
    if (f.ghostX > TRACK_LENGTH && !gc.on) Object.assign(gc, { on: true, x: f.ghostX, v: f.ghostV, t: 0 });
    for (const c of [pc, gc])
      if (c.on && sdt > 0) {
        c.t += sdt;
        c.v = Math.max(0, c.v - coastDecel(c) * sdt);
        c.x += c.v * sdt;
        if (c.chute && c.t > 0.4) c.chuteK = Math.min(1, (c.t - 0.4) / 0.35);
      }
    const px = pc.on ? pc.x : simX + f.prerollOff;
    const pv = pc.on ? pc.v : f.phase === 'preroll' ? f.rollV : s.v;
    const gx = gc.on ? gc.x : f.ghostX + (f.ghostOff ?? 0);
    const gvel = gc.on ? gc.v : f.ghostV;
    v.playerX = px;
    v.ghostX = gx;
    v.ghostV = gvel;
    const vs = Object.assign(this.vs, s);
    vs.x = px;
    vs.v = pv;
    vs.wheelspin = realSpin;
    const laneZ = v.laneZ!;
    const pr = this.player.root.position;
    pr.x = px - this.pFrontWheel;
    const gr = this.ghost.root.position;
    gr.x = gx - this.gFrontWheel;

    // ---- player body: accel -> pitch / squat / wheelie springs, kicks at launch + shifts, lift + chute after the line
    const pa = pc.on ? -coastDecel(pc) : f.phase === 'preroll' ? (dt > 0 ? (f.rollV - this.prevRollV) / dt : 0) : s.a;
    this.prevRollV = f.rollV;
    const pmn = this.pm;
    if (pc.on && pc.chute && pc.chuteK > 0.8 && !pc.bloomed) {
      pc.bloomed = true;
      pmn.kick(10); // the canopy blooms and yanks the tail down
    }
    pmn.step(sdt, pa, s.nitroActive ? 1 : 0, f.burn, pv, blown);
    // yaw / lateral targets: oil spin wiggle + drift, tyre shake while really spinning, gust push, high-speed wander
    const tt = v.t;
    const speedK = THREE.MathUtils.clamp((pv - 30) / 50, 0, 1);
    let yawT = 0.0026 * Math.sin(tt * 0.9) * speedK;
    let latT = 0.05 * Math.sin(tt * 0.37 + 1) * speedK;
    if (oilSpin && !this.wasOil) pmn.yawV += 0.9 * this.spinSign; // the rear steps out as the tyres break loose
    this.wasOil = oilSpin;
    if (oilSpin) {
      yawT += 0.045 * Math.sin(2 * Math.PI * 3.2 * Math.max(0, this.spinT)) * this.spinSign;
      latT += 0.18 * this.spinSign;
    }
    if (realSpin && this.spinT < 0.6) yawT += 0.012 * Math.sin(2 * Math.PI * 9 * this.spinT) * (1 - this.spinT / 0.6);
    const gust = this.hazards?.gustNow ?? 0;
    latT -= 0.22 * gust;
    pmn.yawTgt = yawT;
    pmn.latTgt = latT;
    // idle / burnout shake: deterministic engine-order sines plus a slow lope, not per-frame noise
    const idle = !s.launched && s.rpm > 0.3 && f.burn <= 0.3;
    const shakeK = f.burn > 0.3 ? 0.012 * f.burn : idle ? 0.004 : 0;
    const jitter = shakeK * 0.5 * (Math.sin(2 * Math.PI * 11 * tt) + 0.6 * Math.sin(2 * Math.PI * 23 * tt)) + (idle ? 0.0015 * Math.sin(2 * Math.PI * 1.2 * tt) : 0);
    const buffet = gust * (0.006 * Math.sin(2 * Math.PI * 5.3 * tt));
    const pitchDeg = pmn.pitch + gust * 0.3 * Math.sin(2 * Math.PI * 3.7 * tt);
    const roll = THREE.MathUtils.clamp(pmn.aF, 0, 14) * 0.0011 + f.burn * 0.012 + jitter * 0.6 + buffet;
    const squat = THREE.MathUtils.clamp(pmn.p, -1.5, 3.6) * 0.012 + f.burn * 0.015 + jitter;
    this.player.setSuspension(pitchDeg * DEG, roll, squat);
    this.player.setWheelie(pmn.w * DEG);
    this.player.root.rotation.y = pmn.yaw;
    pr.z = laneZ.player + pmn.lat;
    this.player.setSteer(-2.5 * pmn.yaw);
    v.wheelie = pmn.w * DEG;
    v.pitch = pitchDeg * DEG;
    const pk = this.player as Partial<KitCar3D> & { setChute?(k: number): void };
    pk.setEngine?.(s.rpm);
    pk.setChute?.(pc.chute && pc.t > 0.4 ? 1 : 0); // kit grows the canopy over 0.3 s; chuteK models the drag
    // brake lights after the lift (later on chute cars, which brake once the canopy has done the work)
    if (pc.on && !this.brakes && pc.t > (pc.chute ? 1.2 : 0.35)) {
      this.brakes = true;
      this.player.setBrakeLights(true);
    }
    // wheels from the real fitted tyre radii
    const pTyre = pk.tyreRadius ?? { front: this.player.build.dims.wheelR, rear: this.player.build.dims.wheelR };
    let front = pv / pTyre.front;
    let rear = s.launched || pc.on ? (Math.max(pv, realSpin ? 6 : 0) / pTyre.rear) * (oilSpin ? 2.5 : realSpin ? 1.8 : hooked ? 1.07 : 1) : 0;
    if (f.phase === 'preroll') rear = Math.max(front, f.burn * 120);
    if (f.phase === 'preroll') front = f.rollV / pTyre.front;
    this.player.setWheelSpin(front, rear);

    // ---- ghost: same body model; its own burnout + staging, visual-only shifts, launch kick, coast
    const gmn = this.gm;
    const te = o.sim.setup.targetEt;
    const vTop = ghostV(te, te);
    let ga = dt > 0 ? (gvel - this.gPrevV) / dt : 0;
    this.gPrevV = gvel;
    if (f.phase === 'preroll') ga = 0;
    if (!this.gLaunched && f.ghostV > 0.5) {
      this.gLaunched = true;
      gmn.kick(18);
      // only a boss car lifts the front; everyday opponents just pop the nose, like the stock player
      if (o.boss) gmn.wheelieKick(3.2);
      else gmn.kick(12);
      if (this.ghostLoud) this.emit({ kind: 'flame', who: 'ghost', ms: 160 });
    }
    const GSHIFT = [0.3, 0.5, 0.72];
    if (!gc.on && this.gShift < GSHIFT.length && f.ghostV > GSHIFT[this.gShift] * vTop) {
      this.gShift++;
      this.gCutT = 0.09;
      gmn.kick(-16);
      // economy opponents don't spit flames on upshifts: a puff of exhaust instead
      if (this.ghostLoud) this.emit({ kind: 'flame', who: 'ghost', ms: 150 });
      else this.emit({ kind: 'exhaustPuff', who: 'ghost', n2: 3 });
    }
    if (this.gCutT > 0) {
      this.gCutT -= sdt;
      ga = 0; // the drive cuts for the shift
    }
    if (gc.on) ga = -coastDecel(gc);
    if (gc.on && gc.chute && gc.chuteK > 0.8 && !gc.bloomed) {
      gc.bloomed = true;
      gmn.kick(10);
    }
    gmn.yawTgt = 0.0026 * Math.sin(tt * 0.8 + 2) * THREE.MathUtils.clamp((gvel - 30) / 50, 0, 1);
    gmn.latTgt = 0.04 * Math.sin(tt * 0.31 + 2) * THREE.MathUtils.clamp((gvel - 30) / 50, 0, 1);
    const gBurn = f.ghostBurn ?? 0;
    gmn.step(sdt, ga, 0, gBurn, gvel);
    const gj = gBurn > 0.3 ? 0.012 * gBurn * 0.5 * (Math.sin(2 * Math.PI * 11 * tt + 1) + 0.6 * Math.sin(2 * Math.PI * 23 * tt + 2)) : 0;
    this.ghost.setSuspension(
      gmn.pitch * DEG,
      THREE.MathUtils.clamp(gmn.aF, 0, 14) * 0.0011 + gBurn * 0.012 + gj * 0.6,
      THREE.MathUtils.clamp(gmn.p, -1.5, 3.6) * 0.012 + gBurn * 0.015 + gj,
    );
    this.ghost.setWheelie(gmn.w * DEG);
    this.ghost.root.rotation.y = gmn.yaw;
    gr.z = laneZ.ghost + gmn.lat;
    const gk = this.ghost as Partial<KitCar3D> & { setChute?(k: number): void };
    gk.setEngine?.(gc.on ? 0.3 : THREE.MathUtils.clamp(0.25 + (gvel / Math.max(1, vTop)) * 0.7, 0, 1));
    gk.setChute?.(gc.chute && gc.t > 0.4 ? 1 : 0);
    if (gc.on && !this.gBrakes && gc.t > (gc.chute ? 1.2 : 0.35)) {
      this.gBrakes = true;
      this.ghost.setBrakeLights(true);
    }
    const gTyre = gk.tyreRadius ?? { front: this.ghost.build.dims.wheelR, rear: this.ghost.build.dims.wheelR };
    const gRoll = f.phase === 'preroll' ? f.ghostRollV ?? 0 : gvel;
    this.ghost.setWheelSpin(gRoll / gTyre.front, Math.max(gRoll / gTyre.rear, gBurn * 120));

    // ---- continuous FX signals (the 2D scene's per-frame rates, traction read as above)
    const gradeK = this.launchGrade === 'perfect' ? 0.15 : this.launchGrade === 'good' ? 0.4 : 1;
    let smoke = f.burn > 0 ? 0.8 * f.burn : realSpin ? 0.9 : hooked ? 0.25 : 0;
    if (!oilSpin && !realSpin && sinceLaunch >= 0 && sinceLaunch < 0.3 && s.v < 12) smoke = Math.max(smoke, 0.6 * (1 - sinceLaunch / 0.3) * gradeK);
    v.smoke = smoke * o.smokeK;
    v.oilFling = oilSpin;
    let rubber = 0;
    if (f.phase === 'preroll') rubber = f.rollV > 0.06 ? 0.25 + this.heat * 0.35 : f.burn > 0.5 ? 0.5 : 0;
    else if (realSpin) rubber = 0.6;
    else if (hooked) rubber = 0.3;
    else if (sinceLaunch >= 0 && sinceLaunch < 0.6) rubber = 0.5 * (1 - sinceLaunch / 0.6);
    v.rubber = rubber;
    this.heat = THREE.MathUtils.clamp(this.heat + (f.burn > 0.5 || realSpin ? dt / 0.5 : -dt / 2.2), 0, 1);
    v.heat = this.heat;
    // heat haze eased (~0.25 s) so it doesn't blink off at every shift
    const hazeT = running && s.rpm > 0.82 ? Math.min(1, (s.rpm - 0.82) / 0.15) : 0;
    v.haze = (v.haze as number) + (hazeT - (v.haze as number)) * (1 - Math.exp(-dt / 0.25));
    v.dust = pv > 38 && s.phase === 'running' ? Math.min(0.7, (pv - 38) / 30) : 0;
    // sparks only while the wheelie bar really touches (kit reports the contact), or the bumper on a huge wheelie
    const barAt = (this.player as Partial<KitCar3D>).wheelieBarWorld;
    v.scrape = barAt ? !!barAt.call(this.player, this.tmp2) : pmn.bar ? pmn.w >= WHEELIE_BAR_MAX - 0.05 : pmn.w > 4.5;

    // ---- hazards, strip, tree, scoreboard ----
    this.hazards?.update(dt, px, this.camera);
    v.gust = gust;
    if (v.gust > 0.5 && this.wasGust <= 0.5) this.emit({ kind: 'gust', strength: v.gust });
    this.wasGust = v.gust;
    this.strip.setTree({
      lights: s.lights,
      falseStart: f.falseStart,
      decoy: hzs.decoy,
      staged: [f.staged, f.ghostStaged ?? 2],
      redLane: f.falseStart ? 'player' : undefined,
    });
    if (s.phase === 'finished' && !this.scoreboardSet) {
      this.scoreboardSet = true;
      const mph = s.trapSpeedKph !== null ? s.trapSpeedKph / 1.609 : s.v * 2.237;
      const won = s.et !== null && !hzs.dnf && s.et < te;
      this.strip.setScoreboard(hzs.dnf ? null : s.et, mph, te, vTop * 2.237, won ? 'player' : 'ghost');
    }
    this.strip.update(dt, v.t);
    this.rig.follow(this.tmp.set(pr.x + 1.5, 0, pr.z * 0.5), 9);
    // the direct light swells under the tower pools and dips between them
    this.rig.setLevel(THREE.MathUtils.clamp(0.55 + 0.5 * this.strip.lightAt(pr.x, pr.z), 0.55, 1.15));

    // ---- cars' own animation (game time: wheels don't race in slow-mo), camera, FX, post ----
    this.player.update(sdt);
    this.ghost.update(sdt);
    this.director.update(dt, v);
    this.fx.update(sdt, this.camera, v);
    v.events.length = 0;
    if (!render) return;
    const c = this.composer;
    const dof = this.director.dof;
    c.setFocus(dof.focus, dof.aperture);
    const b = this.director.blur as typeof this.director.blur & { ellipse?: { cx: number; cy: number; rx: number; ry: number }; depth?: number; near?: number };
    c.setSpeedBlur(b.k, { dir: b.dir, radial: b.radial, center: b.center, ellipse: b.ellipse ?? this.carEllipse(), depth: b.depth ?? this.camera.position.distanceTo(this.tmp.set(pr.x, 0.7, pr.z)), near: b.near, protect: b.protect });
    // chromatic aberration as a speed cue: a hint at rest, rising with speed and nitrous
    const fk = (this.director as { fxK?: { speed: number; nitro: number } }).fxK;
    const cK = 0.15 + 0.4 * (fk ? fk.speed : THREE.MathUtils.clamp((pv - 25) / 45, 0, 1)) + 0.1 * (fk ? fk.nitro : s.nitroActive ? 1 : 0);
    (c as Partial<{ setChroma(k: number): void }>).setChroma?.(Math.min(1, cK));
    c.render(dt);
    this.shaderLog?.();
    const ms = performance.now() - t0;
    const p = this.perf;
    p.frames++;
    p.total += ms;
    p.last = ms;
    p.max = Math.max(p.max, ms);
    if (p.samples.length < 4000) p.samples.push(ms);
    const progs = this.layer.renderer.info.programs ?? [];
    if (ms > 50 && p.spikes.length < 20)
      p.spikes.push({ ms: Math.round(ms), t: +s.t.toFixed(2), phase: f.phase, programs: progs.length, names: progs.slice(this.progSeen).map((x) => { const q = x as unknown as { name: string; cacheKey: string }; return (q.name || "?") + ":" + q.cacheKey.slice(0, 90); }).join(" | ") });
    this.progSeen = progs.length;
  }

  /** Dev / perf: renderer counters and buffer size. */
  info() {
    const i = this.layer.renderer.info;
    return { quality: this.quality, loadTimes: this.loadTimes, size: this.layer.size(), calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, post: this.composer.stats.ms, crowd: this.strip.stats.crowd, fx: (this.fx as unknown as { stats?(): unknown }).stats?.() };
  }

  /** Free everything (GPU included) and hand the layer back. Safe to call twice. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.park();
    this.offs.forEach((f) => f());
    for (const c of [this.player, this.ghost]) if (c) this.dropCar(c);
    this.hazards?.dispose();
    this.fx.dispose();
    this.composer.dispose();
    this.rig.dispose();
    this.scene.remove(this.strip.group);
    this.strip.dispose();
    this.scene.environment = null;
    this.scene.background = null;
    this.scene.clear();
    this.layer.renderer.renderLists.dispose();
  }
}
