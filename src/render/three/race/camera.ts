// Race camera. BEFORE the run: cinematic staging (a low orbit / dolly / rear shot through the burnout smoke, a tyre
// close-up, tight on the tree), then a smooth 0.7 s move into the chase cam, settled before the first amber.
// THE RUN (tree countdown to the finish line): ONE fixed chase cam, no cuts: critically damped follow, a small
// pull-back under hard acceleration, FOV 55-65 deg with speed, a short FOV punch + push on nitrous, subtle shakes on
// launch, missed shifts and nitrous; no roll, no wheelie pitch. AFTER the finish: cinematic shots (side-on photo
// finish from the finish tower in slow-mo when it's close, a shutdown flyby or rear shot, a wide coast; a DNF gets its
// own). Staging and finish shot choice is seeded by the race number. All motion is SmoothDamp springs in the car's
// frame, then hard-constrained out of the ground, walls, tree and both car bodies.
// Units: metres. Cars drive +X from the start line at x = 0; +Y up.
import * as THREE from 'three';
import type { Grade, GradeEvent, SimState, Tier } from '../../../core/types';

// ------------------------------------------------------------------ contract

/** Anything with a root and (optionally) the body dims: a Car3D satisfies it. */
export interface CineCar {
  root: THREE.Object3D;
  build?: { dims?: { length: number; width: number; height: number; wheelbase?: number; wheelR?: number } };
}

export type CinePhase = 'preroll' | 'live' | 'finishing' | 'done';

/** The per-frame view of the race that both CameraDirector and RaceFx3D read. */
export interface CineView {
  player: CineCar;
  ghost?: CineCar | null;
  /** The player's sim state (read-only). */
  state: Pick<SimState, 't' | 'phase' | 'lights' | 'launched' | 'x' | 'v' | 'a' | 'gear' | 'rpm' | 'nitroActive' | 'wheelspin' | 'limiter' | 'grades' | 'et' | 'penalty'>;
  /** Ghost front bumper (m from the start line) and speed (m/s). */
  ghostX?: number;
  ghostV?: number;
  phase: CinePhase;
  /** Seconds since the preroll (burnout + roll into stage) began, and its total length. */
  prerollT?: number;
  prerollLen?: number;
  /** 0..1 burnout intensity (player). */
  burn?: number;
  /** Player wheelie angle (rad). */
  wheelie?: number;
  targetEt: number;
  /** Seeds shot choice (deterministic per race). */
  raceNo?: number;
  laneZ?: { player: number; ghost: number };
  /** World position of the christmas tree's bulbs (centre). */
  tree?: THREE.Vector3;
  finishX?: number;
  /** Build-dependent smoke density (~0.8 starter .. ~2.1 pro build) and tyre tier. */
  smokeK?: number;
  tyres?: Tier;
  /** Result margin once known (targetEt - et; + = won by). */
  margin?: number;
  dnf?: string | null;
  /** Boss hazards: the rear tyres spinning on oil right now. */
  oilSpin?: boolean;
  // Per-frame FX drivers the Race3D scene derives exactly like the 2D RaceScene (all optional, 0..1):
  /** tyre glow, smoke rate, rubber laying, oil flung off the tyre, exhaust heat haze, dust at speed */
  heat?: number;
  smoke?: number;
  rubber?: number;
  oilFling?: boolean | number;
  haze?: number;
  dust?: number;
  /** wheelie bar / rear bumper scraping the strip (0..1 or boolean) */
  scrape?: boolean | number;
  /** body pitch (rad) and crosswind on the car (0..1) */
  pitch?: number;
  gust?: number;
  /** Whether each car's build spits exhaust flame on shifts / launch (economy cars just puff). */
  flames?: { player: boolean; ghost: boolean };
}

export type CineEventKind =
  | 'burnout' | 'staged' | 'amber' | 'green' | 'falseStart' | 'launch' | 'shift' | 'limiter'
  | 'nitro' | 'nitroEnd' | 'finish' | 'backfire' | 'purge'
  // extras the Race3D scene forwards from the 2D timeline
  | 'flame' | 'flutter' | 'exhaustPuff' | 'sparks' | 'oil' | 'gust' | 'shake' | 'photoFinish';

export interface CineEvent {
  kind: CineEventKind;
  grade?: Grade;
  gear?: number;
  /** amber number 1..3 */
  n?: number;
  margin?: number;
  won?: boolean;
  dnf?: string | null;
  close?: boolean;
  who?: 'player' | 'ghost';
  /** flame / shake duration (ms), shake amplitude (2D camera units, ~0.003..0.01), counts, gust strength. */
  ms?: number;
  amp?: number;
  n2?: number;
  strength?: number;
}

export type ShotId =
  // before the run
  | 'stage_orbit' | 'stage_dolly' | 'stage_rear' | 'tyre' | 'tree'
  // the run: the one chase cam
  | 'run'
  // after the finish
  | 'finish_photo' | 'shutdown' | 'shutdown_rear' | 'coast' | 'dnf';

export interface CameraDirectorOpts {
  raceNo?: number;
  laneZ?: { player: number; ghost: number };
  /** The camera never goes past |z| = wallZ (inside the guard walls). */
  wallZ?: number;
  /** Where the wall stops mattering: above this height the camera may cross it. */
  wallH?: number;
  tree?: THREE.Vector3;
  finishX?: number;
  /** Fractions of the screen covered by the Phaser HUD (bottom panel, top-left tree). */
  hud?: { bottom: number; top: number };
}

/** Event kinds the director derives from view.state by itself (onEvent de-dupes them). */
const TRACK = 402.3;
const V = () => new THREE.Vector3();

// ------------------------------------------------------------------ helpers

/** Critically damped spring (SmoothDamp). Returns the new value; vel is carried in v[i]. */
function sd(cur: number, target: number, v: number[], i: number, smooth: number, dt: number): number {
  if (smooth <= 1e-4 || dt <= 0) {
    if (smooth <= 1e-4) v[i] = 0;
    return smooth <= 1e-4 ? target : cur;
  }
  const w = 2 / smooth;
  const x = w * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const ch = cur - target;
  const tmp = (v[i] + w * ch) * dt;
  v[i] = (v[i] - w * tmp) * e;
  return target + (ch + tmp) * e;
}

class Spring3 {
  readonly p = V();
  private v = [0, 0, 0];
  snap(t: THREE.Vector3) {
    this.p.copy(t);
    this.v[0] = this.v[1] = this.v[2] = 0;
  }
  step(t: THREE.Vector3, smooth: number, dt: number) {
    this.p.set(sd(this.p.x, t.x, this.v, 0, smooth, dt), sd(this.p.y, t.y, this.v, 1, smooth, dt), sd(this.p.z, t.z, this.v, 2, smooth, dt));
    return this.p;
  }
}

class Spring1 {
  x = 0;
  private v = [0];
  snap(t: number) {
    this.x = t;
    this.v[0] = 0;
  }
  step(t: number, smooth: number, dt: number) {
    return (this.x = sd(this.x, t, this.v, 0, smooth, dt));
  }
}

/** Under-damped kick spring (FOV punch, recoil): rings once and settles. */
class Kick {
  x = 0;
  private v = 0;
  constructor(private w = 14, private z = 0.45) {}
  hit(dv: number) {
    this.v += dv;
  }
  step(dt: number) {
    const n = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (-this.w * this.w * this.x - 2 * this.z * this.w * this.v) * h;
      this.x += this.v * h;
    }
    return this.x;
  }
  reset() {
    this.x = this.v = 0;
  }
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Smooth 1D noise in [-1, 1]: three incommensurate sines with seeded phases. */
function makeNoise(r: () => number) {
  const p = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
  return (t: number) => Math.sin(t * 1.0 + p[0]) * 0.45 + Math.sin(t * 2.31 + p[1]) * 0.3 + Math.sin(t * 4.87 + p[2]) * 0.17 + Math.sin(t * 9.73 + p[3]) * 0.08;
}

// ------------------------------------------------------------------ shots

interface ShotCtx {
  /** Seconds in this shot (scaled by slow-mo). */
  t: number;
  P: THREE.Vector3; // player root (world)
  G: THREE.Vector3 | null; // ghost root
  L: number; W: number; H: number; // player dims
  v: number;
  o: number; // outer side sign (+1 when the player lane is at +z)
  laneP: number; laneG: number;
  tree: THREE.Vector3;
  finishX: number;
  /** Lateral room from the player's lane centre to just inside the outer wall (m), and the camera aspect. */
  room: number;
  aspect: number;
  wheel: THREE.Vector3; // scratch
  /** Eased wheelie factor 0..1 (the front lifting). */
  wk: number;
  view: CineView;
  /** Seeded 0..1 variant for this shot instance. */
  k: number;
  /** Per-instance scratch (fixed camera points chosen at the cut). */
  d: Record<string, number>;
}

type Ref = 'anchor' | 'car' | 'world';

interface ShotOut {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  posRef: Ref;
  lookRef: Ref;
  /** Where the look point should sit on screen (NDC). */
  comp: [number, number];
  roll: number; // rad (dutch)
  posSmooth: number;
  lookSmooth: number;
  fovSmooth: number;
  /** SmoothDamp time of the anchor that trails the car (0 = rigid). Gives launch/shift pull-away. */
  lag: number;
  /** DOF: focus point and strength 0..1. */
  focus?: THREE.Vector3;
  aperture: number;
  /** Engine/body vibration this shot picks up (car-mounted rigs shake more). */
  vib: number;
}

const out: ShotOut = {
  pos: V(), look: V(), fov: 45, posRef: 'anchor', lookRef: 'car', comp: [0, 0.12], roll: 0,
  posSmooth: 0.25, lookSmooth: 0.12, fovSmooth: 0.3, lag: 0, aperture: 0, vib: 0,
};

function base(o: ShotOut, fov: number, posRef: Ref, lookRef: Ref) {
  o.fov = fov;
  o.posRef = posRef;
  o.lookRef = lookRef;
  o.comp[0] = 0;
  o.comp[1] = 0.12;
  o.roll = 0;
  o.posSmooth = 0.25;
  o.lookSmooth = 0.12;
  o.fovSmooth = 0.35;
  o.lag = 0;
  o.focus = undefined;
  o.aperture = 0;
  o.vib = 0.15;
  return o;
}

/** Auto-zoom: the FOV (deg) that frames `size` metres at `dist`, clamped. */
const zoomFov = (size: number, dist: number, lo: number, hi: number) => clamp((2 * Math.atan(size / 2 / Math.max(0.1, dist)) * 180) / Math.PI, lo, hi);

/** Vertical FOV (deg) that fits `w` metres across the frame at `dist` (horizontal fit), clamped. */
const fitFov = (c: ShotCtx, w: number, dist: number, lo: number, hi: number) =>
  clamp((2 * Math.atan(Math.tan(Math.atan(w / 2 / Math.max(0.1, dist))) / c.aspect) * 180) / Math.PI, lo, hi);

const SHOTS: Record<ShotId, (c: ShotCtx, o: ShotOut) => ShotOut> = {
  // ---------------------------------------------------------------- before the run
  // Low orbit round the player's car through the burnout smoke: front 3/4, past the flank (squeezed by the outer
  // wall, so the lens widens), round toward the rear 3/4 with the smoke pouring off the tyres.
  stage_orbit(c, o) {
    base(o, 40, 'anchor', 'car');
    const len = c.d.len || 1.3;
    const u = smooth01(c.t / len) * 0.85 + (c.t / len) * 0.15;
    // a slow arc through the front 3/4 only (the outer wall leaves no room for a flank pass at 3 m+)
    const ang = (c.k < 0.5 ? 1.15 : 1.0) - u * 0.6; // 0 = straight out the outer side, + = toward the front
    const rx = 7.4 - u * 0.6;
    const rz = Math.min(c.room, 4.5);
    o.pos.set(c.P.x - 0.3 + Math.sin(ang) * rx, 1.1 + u * 0.2, c.P.z + c.o * Math.cos(ang) * rz);
    o.look.set(c.P.x - c.L * 0.1 * u, 0.62, c.P.z);
    o.fov = fitFov(c, c.L * 1.7, Math.hypot(o.pos.x - c.P.x, o.pos.z - c.P.z), 32, 58);
    o.fovSmooth = 0.25;
    o.comp[1] = 0.02;
    o.posSmooth = 0.35;
    o.lookSmooth = 0.2;
    o.aperture = 0.08;
    o.focus = c.P;
    return o;
  },
  // Dolly in on the front 3/4 from the outer side, never closer than ~3 m to the nose (nose to the right, as 2D).
  stage_dolly(c, o) {
    base(o, 42, 'anchor', 'car');
    const len = c.d.len || 1.3;
    const u = smooth01(c.t / len) * 0.8 + (c.t / len) * 0.2;
    const dz = Math.min(c.room, 3.4);
    o.pos.set(c.P.x + c.L / 2 + 6 - u * 2.6, 1.1 - u * 0.15, c.P.z + c.o * dz);
    o.look.set(c.P.x + 0.2, 0.6, c.P.z);
    o.fov = fitFov(c, c.L * 1.5, Math.hypot(o.pos.x - c.P.x, dz), 32, 60);
    o.fovSmooth = 0.2;
    o.comp[1] = 0.02;
    o.posSmooth = 0.3;
    o.aperture = 0.08;
    o.focus = c.P;
    return o;
  },
  // Behind both cars between the lanes, low, the tree and the strip ahead: slow push in.
  stage_rear(c, o) {
    base(o, 38, 'anchor', 'world');
    const len = c.d.len || 1.3;
    const u = smooth01(c.t / len);
    const zMid = (c.laneP + c.laneG) / 2;
    o.pos.set(c.P.x - 10.5 + u * 2.6, 0.95 + u * 0.2, zMid + (c.laneP - zMid) * 0.22);
    o.look.set(c.P.x + 9, 0.95, zMid + (c.laneP - zMid) * 0.4);
    o.comp[1] = 0.0;
    o.posSmooth = 0.3;
    return o;
  },
  // Tyre close-up: low beside the spinning rear tyre, smoke boiling out of the arch.
  tyre(c, o) {
    base(o, 44, 'anchor', 'car');
    const len = c.d.len || 1.3;
    const u = smooth01(c.t / len);
    const wx = c.P.x - c.L * 0.3;
    o.pos.set(wx + 2.1 - u * 0.5, 0.32 + u * 0.08, c.P.z + c.o * Math.min(c.room - 0.1, c.W / 2 + 1.2));
    o.look.set(wx - 0.4, 0.42, c.P.z + c.o * (c.W / 2 - 0.15));
    o.comp[0] = -0.12 * c.o;
    o.comp[1] = 0.04;
    o.posSmooth = 0.3;
    o.vib = 0.7;
    o.focus = this_wheel(c);
    o.aperture = 0.25;
    return o;
  },
  // The tree from behind the player's car: long lens on the bulbs, the car's tail soft in the foreground. The
  // move into the chase cam is then a straight pull-out with the car in frame the whole way.
  tree(c, o) {
    base(o, 24, 'anchor', 'world');
    const push = smooth01(c.t / 1.2);
    o.pos.set(c.P.x - c.L / 2 - 3.2 + push * 0.4, 1.5, c.laneP - c.o * 0.25);
    o.look.set(c.tree.x, c.tree.y - 0.1, c.tree.z);
    o.comp[1] = 0.0;
    o.posSmooth = 0.3;
    o.focus = c.tree;
    o.aperture = 0.35;
    return o;
  },

  // ---------------------------------------------------------------- the run
  // The chase cam, rigid to the car (the director adds the acceleration pull, road buzz, shakes): low and close,
  // nudged toward the centre so the rival (screen left) reads, aimed 12 m past the nose; the lens widens with speed.
  run(c, o) {
    base(o, 52, 'car', 'car');
    const sp = smooth01(c.v / 62);
    const back = c.L / 2 + 4.6 - 1.0 * sp;
    // above roof height so the roof skin reads as a band (not a convertible); the camera follows only part of the
    // car's sideways motion (oil step-outs, gust pushes show). A wheelie drops the rig low and toward the centre,
    // looking under the lifted nose so the gap under the front tyres shows against the lit strip.
    // height per body: ~5 deg down onto the roof (hatch 1.85, muscle 1.80, wedge 1.60, truck 2.35), which also keeps
    // the player's own lane visible 10 m+ ahead (oil patches) and a tall cab off the vanishing point
    const h = clamp(c.H + 0.42, 1.6, 2.35);
    const wk = c.wk;
    const lat = c.P.z - c.laneP;
    o.pos.set(c.P.x - back, h - 0.85 * wk, c.laneP - c.o * (1.0 + 1.2 * wk) + 0.25 * lat);
    o.look.set(c.P.x + c.L / 2 + 12, 0.8 + 0.6 * (h - 1.45) - 0.25 * wk, c.laneP - c.o * 1.9 + 0.6 * lat);
    o.fov = 52 + 20 * sp;
    o.fovSmooth = 0.4;
    o.comp[0] = 0;
    o.comp[1] = 0;
    o.lag = 0;
    o.posSmooth = 0.05;
    o.lookSmooth = 0.05;
    o.vib = 0.1;
    o.aperture = 0;
    return o;
  },

  // ---------------------------------------------------------------- after the finish
  // Photo finish, line-scan style: on the finish gantry right over the line on the player's side, looking down and
  // across at the far lane: the painted line projects as a vertical screen line, both cars run left -> right across
  // it, both noses are judged against the same line, and the near car can't hide the far one. World-fixed.
  finish_photo(c, o) {
    // out over the fence by the gantry leg so both lanes fit the HUD band (near car ~59 deg down, far ~30 deg);
    // 66 deg keeps the far car clear of the ET box and the near car clear of the tach
    base(o, 66, 'world', 'world');
    o.pos.set(c.finishX + 0.45, 6.2, c.o * 6.4);
    o.look.set(c.finishX + 0.45, 0.3, c.o * 0.75);
    o.comp[0] = 0.15;
    o.comp[1] = 0;
    o.fovSmooth = 0;
    o.posSmooth = 0;
    o.lookSmooth = 0;
    o.vib = 0;
    return o;
  },
  // Shutdown flyby: planted at the outer wall down the shutdown; the car blasts past braking.
  shutdown(c, o) {
    base(o, 40, 'world', 'car');
    if (c.d.x === undefined) {
      c.d.x = c.P.x + clamp(c.v * 0.62, 12, 40);
      // high over the lane's outer edge (well clear of the fence): ~3.5 m from the car as it blasts past below
      c.d.z = c.laneP + c.o * 1.6;
      c.d.y = 4.2 + c.k * 0.4;
    }
    o.pos.set(c.d.x, c.d.y, c.d.z);
    o.look.set(c.P.x + c.L * 0.25, 0.6, c.P.z - c.o * 0.6);
    o.fov = zoomFov(c.W * 4, Math.hypot(c.d.x - c.P.x, c.d.z - c.P.z, c.d.y), 10, 50);
    o.fovSmooth = 0.2;
    o.comp[1] = -0.42; // below the WIN / ET text block
    o.lookSmooth = 0.04;
    o.posSmooth = 0;
    o.vib = 0.05;
    return o;
  },
  // Shutdown from behind: high over the line, long lens on both cars braking away, brake lights blazing.
  shutdown_rear(c, o) {
    base(o, 30, 'world', 'car');
    o.comp[1] = -0.42; // below the WIN / ET text block
    const zMid = (c.laneP + c.laneG) / 2;
    o.pos.set(c.finishX - 10, 4.6, zMid + (c.laneP - zMid) * 0.3);
    const gx = c.G ? c.G.x : c.P.x;
    // both cars when they're together, else a long lens on the player braking away (the rival is far behind)
    const both = Math.abs(gx - c.P.x) < 30;
    o.look.set(both ? (gx - c.P.x) * 0.45 : 0, 0.7, both ? (zMid - c.P.z) * 0.65 : 0);
    o.look.add(c.P);
    o.look.y = 0.7;
    const dist = Math.hypot(o.look.x - o.pos.x, o.pos.y);
    o.fov = zoomFov(both ? Math.abs(gx - c.P.x) + 14 : c.L * 3, dist, 5, 50);
    // opening ~0.6 s: wide enough for the player's scoreboard (x 418, y 5-7, z 12.5 on its side) in the top third
    const sb = 1 - smooth01((c.t - 0.5) / 0.4);
    if (sb > 0) {
      o.look.lerp(c.wheel.set(418, 3.0, c.o * 6), 0.35 * sb);
      o.fov = Math.max(o.fov, 40 * sb);
    }
    o.fovSmooth = 0.4;
    o.lookSmooth = 0.15;
    o.posSmooth = 0;
    o.vib = 0;
    return o;
  },
  // Coast: wide, high, long lens from the shutdown area as both cars brake toward it.
  coast(c, o) {
    base(o, 28, 'world', 'world');
    o.comp[1] = -0.42; // below the WIN / ET text block
    if (c.d.x === undefined) {
      const stop = c.P.x + (c.v * c.v) / (2 * 9);
      c.d.x = Math.min(stop + 26, c.finishX + 170);
      c.d.z = c.laneP + c.o * Math.min(c.room, 2.4);
    }
    const gx = c.G ? c.G.x : c.P.x;
    const mx = (c.P.x + gx) / 2;
    o.pos.set(c.d.x - c.t * 0.6, 3.6 + c.t * 0.12, c.d.z);
    o.look.set(mx, 0.55, (c.laneP + c.laneG) / 2 + (c.laneP - c.laneG) * 0.1);
    o.fov = zoomFov(Math.abs(gx - c.P.x) + 12, Math.hypot(o.pos.x - mx, o.pos.z - o.look.z), 14, 50);
    o.fovSmooth = 0.6;
    o.lookSmooth = 0.3;
    o.posSmooth = 0;
    o.vib = 0;
    return o;
  },
  // DNF: low front 3/4 on the stricken car as it coasts down, the strip empty ahead of it.
  dnf(c, o) {
    base(o, 40, 'anchor', 'car');
    o.comp[1] = -0.42; // below the WIN / ET text block
    const ahead = c.L / 2 + 5.5 + c.t * 0.8;
    const dz = Math.min(c.room, 2.3);
    o.pos.set(c.P.x + ahead, 0.7, c.P.z + c.o * dz);
    o.look.set(c.P.x, 0.6, c.P.z - c.o * 0.4);
    o.fov = fitFov(c, c.L * 1.7, Math.hypot(ahead, dz), 30, 56);
    o.lag = 0.2;
    o.vib = 0.1;
    o.aperture = 0.1;
    o.focus = c.P;
    return o;
  },
};

function this_wheel(c: ShotCtx) {
  return c.wheel.set(c.P.x - c.L * 0.3, 0.4, c.P.z + c.o * c.W * 0.5);
}

/** Photo finish: near-freeze time scale and how long it holds (real seconds) before the 0.2 slow-mo resumes. */
const PHOTO_SLOW = 0.03;
const PHOTO_FREEZE = 0.7;

const STAGE_POOL: ShotId[] = ['stage_orbit', 'stage_dolly', 'stage_rear', 'tyre'];
/** The staging move into the chase cam (real seconds); it lands well before the first amber. */
const RUN_BLEND = 0.7;

// ------------------------------------------------------------------ director

export class CameraDirector {
  /** Sim time scale: multiply the sim (and FX) dt by this. 1 = normal; ~0.2 on a photo finish. */
  slowmo = 1;
  /** Current shot id (debug / dev page). */
  shot: ShotId = 'stage_orbit';
  /** Depth of field for the composer: focus distance (m, view depth) and strength 0..1. 0 during the run. */
  readonly dof = { focus: 8, aperture: 0 };
  /** Post-FX drivers: speed 0..1, nitro 0..1, shake 0..1. */
  readonly fxK = { speed: 0, nitro: 0, shake: 0 };
  /**
   * Speed blur for post.setSpeedBlur(k, {dir, radial, center, protect}): derived from how the CAMERA moves (a fixed
   * trackside cam gets none); `protect` keeps everything nearer than the car's nose sharp.
   */
  readonly blur = {
    k: 0,
    dir: [-1, 0] as [number, number],
    radial: false,
    center: [0.5, 0.5] as [number, number],
    protect: 0,
    /** The player's car on screen: UV ellipse (origin bottom-left, half-extents, padded ~15%); rx = ry = 0 off screen. */
    ellipse: { cx: 0.5, cy: 0.5, rx: 0, ry: 0 },
    /** Straight-line distance camera -> the player's car centre (m). */
    depth: 0,
    /** The rival, same conventions (a fallback for keeping it sharp too). */
    ghost: { cx: 0.5, cy: 0.5, rx: 0, ry: 0 },
    ghostDepth: 0,
  };
  /** Dev: hold this shot instead of the timeline. */
  forced: ShotId | null = null;

  private cam: THREE.PerspectiveCamera;
  private o: Required<Pick<CameraDirectorOpts, 'wallZ' | 'wallH'>> & CameraDirectorOpts;
  private rng: () => number;
  private noise: ((t: number) => number)[];
  private seen = new Set<string>();
  private gradesSeen = 0;
  private lastLights = 0;
  private wasNitro = false;
  private wasPhase: CinePhase | null = null;
  private wasSimPhase = '';
  private first = true;

  private st = 0; // seconds in shot (sim-scaled)
  private stReal = 0; // seconds in shot (real)
  private tt = 0; // total sim-scaled time
  private shotK = 0;
  private shotD: Record<string, number> = {};
  private stageShot: ShotId;
  private postSeq: ShotId[] = [];
  private postI = -1;
  private postLen: number[] = [];
  private close = false;
  private finishedAt = -1; // tt the player crossed
  private ghostCrossAt = -1;

  private anchor = new Spring3();
  private posOff = new Spring3();
  private lookOff = new Spring3();
  private fov = new Spring1();
  private roll = new Spring1();
  private fovKick = new Kick(11, 0.42);
  // the chase rig's acceleration pull (m, + = the car pulls away from the lens) and the launch shake window
  private aF = 0;
  private aS = 0; // slow accel: what the rig has caught up with
  private pull = 0;
  private pullV = 0;
  private launchT = -1;
  private ttReal = 0;
  private trauma = 0;
  private vibK = new Spring1();
  private needCut = true;
  private justCut = false;
  private justCutPan = true;
  private panK = 0;
  private fwPrev = V();
  // the staging -> chase move
  private blendT = -1;
  private blendLen = RUN_BLEND;
  private blendPos = V();
  private blendQ = new THREE.Quaternion();
  private blendFov = 50;
  private blendLook = V();
  private lastLook = V();
  private blendComp: [number, number] = [0, 0];
  private lastComp: [number, number] = [0, 0];
  private ctx: ShotCtx;

  private tmpA = V();
  private tmpB = V();
  private tmpC = V();
  private tmpD = V();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private e = new THREE.Euler();
  private m = new THREE.Matrix4();
  private P = V();
  private G = V();
  private treeV = V();
  private camPrev = V();
  private camVel = V();

  constructor(camera: THREE.PerspectiveCamera, opts: CameraDirectorOpts = {}) {
    this.cam = camera;
    this.o = { wallZ: 5.8, wallH: 1.05, ...opts };
    const seed = (opts.raceNo ?? 1) * 7919 + 17;
    this.rng = mulberry32(seed);
    const nr = mulberry32(seed ^ 0x5bd1e995);
    this.noise = [makeNoise(nr), makeNoise(nr), makeNoise(nr), makeNoise(nr), makeNoise(nr)];
    this.stageShot = STAGE_POOL[Math.floor(this.rng() * STAGE_POOL.length)];
    this.ctx = {
      t: 0, P: this.P, G: this.G, L: 4.6, W: 1.9, H: 1.35, v: 0, o: 1, laneP: 3.05, laneG: -3.05,
      tree: this.treeV, finishX: TRACK, room: 2.4, aspect: 16 / 9, wheel: V(), wk: 0,
      view: null as unknown as CineView, k: 0, d: {},
    };
  }

  /** True while the fixed chase cam owns the camera (the run). */
  get running(): boolean {
    return this.shot === 'run';
  }

  /** Dev page: jump to a shot now (null = back to the timeline). */
  force(id: ShotId | null) {
    this.forced = id;
    if (id) this.cut(id);
  }

  /** Cut to a shot (springs snap to the new framing on the next update). */
  private cut(id: ShotId) {
    this.blur.k = 0;
    this.camVel.set(0, 0, 0);
    this.justCut = true;
    this.justCutPan = true;
    this.shot = id;
    this.st = 0;
    this.stReal = 0;
    this.shotK = this.rng();
    this.shotD = {};
    this.needCut = true;
  }

  /** Move (not cut) into a shot: the new shot's rig starts settled, the view eases over from where it is. */
  private blendTo(id: ShotId, len: number) {
    this.blendPos.copy(this.cam.position);
    this.blendQ.copy(this.cam.quaternion);
    this.blendFov = this.cam.fov;
    this.blendLook.copy(this.lastLook);
    this.blendComp[0] = this.lastComp[0];
    this.blendComp[1] = this.lastComp[1];
    this.blendT = 0;
    this.blendLen = len;
    this.cut(id);
  }

  // ---------------------------------------------------------------- events

  onEvent(e: CineEvent) {
    const key = e.kind === 'shift' ? `shift${e.gear ?? 0}` : e.kind === 'amber' ? `amber${e.n ?? 0}` : e.kind;
    const once: CineEventKind[] = ['launch', 'shift', 'nitro', 'nitroEnd', 'finish', 'falseStart', 'green', 'amber', 'staged', 'burnout'];
    if (once.includes(e.kind)) {
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    const run = this.shot === 'run';
    switch (e.kind) {
      case 'launch':
        // the shake follows the car's real acceleration for half a second (see update)
        this.launchT = 0;
        break;
      case 'shift':
        // the clutch gap drops the car back onto the lens: a nod on a clean shift, a bog (and a jolt) on a miss
        this.pullV -= (e.grade === 'miss' ? 4.2 : e.grade === 'good' ? 3.0 : 2.5) * clamp(1.3 - this.ctx.v / 60, 0.5, 1);
        if (e.grade === 'miss') this.addTrauma(0.34);
        this.lastShiftReal = this.ttReal;
        break;
      case 'nitro':
        // a short FOV punch, a jolt, and the rig kicked back as the car surges away. Nitrous usually fires on the
        // same frame as a shift: land the kick just after the shift's drop-back instead of cancelling it.
        this.addTrauma(0.38);
        if (this.ttReal - this.lastShiftReal < 0.2) this.nitroKickAt = this.lastShiftReal + 0.15;
        else this.nitroKick();
        break;
      case 'shake':
        // the 2D scene's camera shakes: ignored during the run (it stays smooth), honoured (capped) after the finish
        if (!run) this.addTrauma(Math.min(0.45, clamp((e.amp ?? 0.005) * 40, 0.05, 0.4) * clamp((e.ms ?? 200) / 220, 0.5, 1.5)));
        break;
      case 'photoFinish':
        this.close = true;
        break;
      case 'finish':
        if (e.dnf) this.close = false;
        else if (e.close !== undefined) this.close = e.close;
        else if (e.margin !== undefined) this.close = Math.abs(e.margin) < 0.1;
        break;
      default:
        break;
    }
  }

  /** Road buzz: 9 / 13.7 / 21.3 Hz sines with seeded phases, normalised (nothing near the 30 Hz Nyquist at 60 fps). */
  private buzzPh = [0, 1, 2].map((k) => [k * 1.7 + 0.3, k * 2.9 + 1.1, k * 0.7 + 2.3]);
  private buzz(axis: number) {
    const t = this.ttReal * Math.PI * 2;
    const p = this.buzzPh[axis];
    return Math.sin(t * 9 + p[0]) * 0.5 + Math.sin(t * 13.7 + p[1]) * 0.33 + Math.sin(t * 21.3 + p[2]) * 0.17;
  }

  private lastShiftReal = -9;
  private nitroKickAt = -1;
  private nitroKick() {
    this.fovKick.hit(120);
    this.pullV += 3.2;
    this.nitroKickAt = -1;
  }

  addTrauma(k: number) {
    this.trauma = Math.min(1, this.trauma + k);
  }

  /** Derive events from the sim state so the scene doesn't have to send them (onEvent de-dupes). */
  private autoEvents(view: CineView) {
    const s = view.state;
    if (view.phase === 'preroll' && this.wasPhase !== 'preroll') this.onEvent({ kind: 'burnout' });
    this.wasPhase = view.phase;
    if (s.lights !== this.lastLights) {
      if (s.lights >= 1 && s.lights <= 3) this.onEvent({ kind: 'amber', n: s.lights });
      if (s.lights === 4) this.onEvent({ kind: 'green' });
      this.lastLights = s.lights;
    }
    const gs = s.grades as GradeEvent[];
    for (; this.gradesSeen < gs.length; this.gradesSeen++) {
      const g = gs[this.gradesSeen];
      if (g.kind === 'launch') this.onEvent({ kind: 'launch', grade: g.grade });
      else if (g.kind === 'shift') this.onEvent({ kind: 'shift', grade: g.grade, gear: g.gear });
      else if (g.kind === 'false_start') this.onEvent({ kind: 'falseStart', grade: g.grade });
    }
    if (s.launched && !this.seen.has('launch')) this.onEvent({ kind: 'launch', grade: 'good' });
    if (s.nitroActive && !this.wasNitro) this.onEvent({ kind: 'nitro' });
    if (!s.nitroActive && this.wasNitro) this.onEvent({ kind: 'nitroEnd' });
    this.wasNitro = s.nitroActive;
    if (s.phase === 'finished' && this.wasSimPhase !== 'finished') {
      const margin = view.margin ?? (s.et !== null ? view.targetEt - s.et : undefined);
      this.onEvent({ kind: 'finish', margin, dnf: view.dnf ?? null });
    }
    this.wasSimPhase = s.phase;
  }

  // ---------------------------------------------------------------- timeline

  private schedule(view: CineView) {
    const s = view.state;
    if (this.forced) {
      if (this.shot !== this.forced) this.cut(this.forced);
      return;
    }
    const gx = view.ghostX ?? -1e9;
    const crossedP = s.phase === 'finished' || s.x >= TRACK;
    if (crossedP && this.finishedAt < 0) this.finishedAt = this.tt;
    if (gx >= TRACK && this.ghostCrossAt < 0) this.ghostCrossAt = this.tt;

    // ---- after the finish (or a DNF): cinematic. On a photo finish it starts the moment the LEADER's nose
    // touches the line, frozen there (even if that's the rival, a few frames before the player crosses).
    const photo = this.close && !view.dnf && Math.max(s.x, gx) >= TRACK && Math.abs(s.x - gx) < 4;
    if (crossedP || photo) {
      if (this.postI < 0) {
        // a time-only "close" (a false-start penalty) with the cars metres apart is not a photo finish
        if (this.close && Math.abs(s.x - gx) >= 4) this.close = false;
        this.startPost(view);
        if (this.shot === 'finish_photo') this.slowmo = PHOTO_SLOW;
      }
      else if (this.postI < this.postSeq.length - 1) {
        let done = this.stReal >= this.postLen[this.postI];
        // the photo finish holds until the trailing car is over the line and time is back up to speed
        if (this.shot === 'finish_photo') {
          const both = s.phase === 'finished' && (this.ghostCrossAt >= 0 || !view.ghost || gx < 0);
          // freeze (0.7 s), then at least a second of the pair running on in slow-mo; 1.7 .. 2.8 s in all
          done = (both && this.stReal > PHOTO_FREEZE + 1.0 && this.slowmo > 0.6) || this.stReal > 2.8;
        }
        if (done) this.cut(this.postSeq[++this.postI]);
      }
      return;
    }

    // ---- before the run: staging shots, then the move into the chase cam
    if (view.phase === 'preroll' && this.first) {
      this.first = false;
      this.cut(this.stageShot);
    }
    if (view.phase === 'preroll' && this.shot !== 'run') {
      const pl = view.prerollLen ?? 2.4;
      const pt = view.prerollT ?? 0;
      const blendAt = pl - 0.55; // 0.7 s move: settled ~0.35 s before the first amber
      const treeAt = Math.max(0.5, pl - 1.15);
      if (pt >= blendAt) this.blendTo('run', RUN_BLEND);
      else if (pt >= treeAt) {
        if (this.shot !== 'tree') this.cut('tree');
      } else if (this.shot !== this.stageShot) this.cut(this.stageShot);
      if (this.shot === this.stageShot) {
        this.shotD.len = treeAt;
        this.st = this.stReal = pt; // the staging move is locked to the preroll timeline
      }
      return;
    }

    // ---- the run: one chase cam, no cuts (a late preroll/none at all still eases in)
    if (this.shot !== 'run') {
      if (this.first) this.cut('run');
      else this.blendTo('run', 0.6);
    }
    this.first = false;
  }

  /** After the line. The scene leaves ~2.6 s after the finish (+0.6 s on a photo finish): two shots fit. */
  private startPost(view: CineView) {
    if (view.dnf) {
      this.postSeq = ['dnf', 'coast'];
      this.postLen = [1.8, 99];
    } else if (this.close) {
      this.postSeq = ['finish_photo', 'shutdown_rear'];
      this.postLen = [2.8, 99];
    } else {
      this.postSeq = ['shutdown', 'shutdown_rear'];
      this.postLen = [1.6, 99];
    }
    this.postI = 0;
    this.cut(this.postSeq[0]);
  }

  private updateSlowmo(view: CineView, realDt: number) {
    const s = view.state;
    let target = 1;
    const gx = view.ghostX ?? -1e9;
    const crossedP = s.phase === 'finished' || s.x >= TRACK;
    // predict the photo finish as the line comes up (the ghost lands exactly on target)
    if (!crossedP && TRACK - s.x < 60 && s.v > 1 && !view.dnf) {
      const tP = s.t + (TRACK - s.x) / s.v + s.penalty;
      // close on the clock AND side by side on the strip (a false-start penalty alone isn't a photo finish)
      this.close = Math.abs(view.targetEt - tP) < 0.11 && Math.abs(s.x - gx) < 8;
    }
    if (this.close && !view.dnf && !this.forced) {
      const lead = Math.max(s.x, gx);
      const trail = Math.min(s.x, gx < 0 ? s.x : gx);
      const lastCross = Math.max(this.finishedAt, this.ghostCrossAt);
      const inZone = TRACK - lead < 14 && (trail < TRACK + 1.5 || (lastCross >= 0 && this.tt - lastCross < 0.12));
      if (inZone) target = 0.2;
      // the freeze: the leader's nose on the line
      if (this.shot === 'finish_photo' && this.stReal < PHOTO_FREEZE) target = PHOTO_SLOW;
    } else if (this.finishedAt >= 0 && this.tt - this.finishedAt < 0.25 && !view.dnf) target = 0.6;
    const rate = target < this.slowmo ? 16 : 2.4;
    this.slowmo += (target - this.slowmo) * (1 - Math.exp(-rate * realDt));
    if (Math.abs(this.slowmo - target) < 0.002) this.slowmo = target;
  }

  // ---------------------------------------------------------------- frame

  update(realDt: number, view: CineView) {
    realDt = Math.min(realDt, 0.1);
    this.autoEvents(view);
    this.updateSlowmo(view, realDt);
    const dt = realDt * this.slowmo;
    this.tt += dt;
    this.st += dt;
    this.stReal += realDt;
    this.ttReal += realDt;
    if (this.nitroKickAt >= 0 && this.ttReal >= this.nitroKickAt) this.nitroKick();

    // context
    const c = this.ctx;
    view.player.root.getWorldPosition(this.P);
    const hasGhost = !!view.ghost;
    if (view.ghost) view.ghost.root.getWorldPosition(this.G);
    c.G = hasGhost ? this.G : null;
    const dims = view.player.build?.dims;
    c.L = dims?.length ?? 4.6;
    c.W = dims?.width ?? 1.9;
    c.H = dims?.height ?? 1.35;
    c.v = view.state.v;
    c.laneP = view.laneZ?.player ?? this.o.laneZ?.player ?? this.P.z;
    c.laneG = view.laneZ?.ghost ?? this.o.laneZ?.ghost ?? (hasGhost ? this.G.z : -c.laneP);
    c.o = Math.sign(c.laneP - c.laneG) || 1;
    const tr = view.tree ?? this.o.tree;
    if (tr) this.treeV.copy(tr);
    else this.treeV.set(7, 1.95, (c.laneP + c.laneG) / 2);
    c.finishX = view.finishX ?? this.o.finishX ?? TRACK;
    c.room = Math.max(1.6, this.o.wallZ - 0.4 - Math.abs(c.laneP));
    c.aspect = this.cam.aspect || 16 / 9;
    // the wheelie factor eases (~0.25 s) toward the nose lift (full at ~4 deg)
    const wkT = clamp((view.wheelie ?? 0) / 0.07, 0, 1);
    c.wk += (wkT - c.wk) * (1 - Math.exp(-realDt / 0.25));
    c.view = view;

    this.schedule(view);
    c.t = this.st;
    c.k = this.shotK;
    c.d = this.shotD;
    const so = SHOTS[this.shot](c, out);
    const run = this.shot === 'run';

    // refs: the anchor trails the car (lag > 0) or rides it rigidly
    const refOf = (r: Ref, dst: THREE.Vector3) => (r === 'world' ? dst.set(0, 0, 0) : r === 'car' ? dst.copy(this.P) : dst.copy(this.anchor.p));
    if (this.needCut) this.anchor.snap(this.P);
    else this.anchor.step(this.P, so.lag, dt);
    if (this.P.x - this.anchor.p.x > 3) this.anchor.p.x = this.P.x - 3;
    this.anchor.p.y = this.P.y;
    this.anchor.p.z = this.P.z;

    const tgtPosOff = this.tmpB.copy(so.pos).sub(refOf(so.posRef, this.tmpA));
    const tgtLookOff = this.tmpD.copy(so.look).sub(refOf(so.lookRef, this.tmpC));
    if (this.needCut) {
      this.posOff.snap(tgtPosOff);
      this.lookOff.snap(tgtLookOff);
      this.fov.snap(so.fov);
      this.roll.snap(so.roll);
      this.fovKick.reset();
      this.needCut = false;
    } else {
      this.posOff.step(tgtPosOff, so.posSmooth, dt);
      this.lookOff.step(tgtLookOff, so.lookSmooth, dt);
      this.fov.step(so.fov, so.fovSmooth, dt);
      this.roll.step(so.roll, 0.4, dt);
    }
    const pos = this.tmpA.copy(refOf(so.posRef, this.tmpA)).add(this.posOff.p);
    const look = this.tmpC.copy(refOf(so.lookRef, this.tmpC)).add(this.lookOff.p);

    const s = view.state;
    // ---- FOV first (the shake scales with it): the shot's (52-72 with speed in the run) + the nitrous punch
    const kick = this.fovKick.step(dt);
    this.fxK.nitro += ((s.nitroActive ? 1 : 0) - this.fxK.nitro) * (1 - Math.exp(-realDt * 5));
    this.fxK.speed = clamp((s.v - 25) / 45, 0, 1);
    let fov = clamp(this.fov.x + kick + (run ? this.fxK.nitro * 3 : 0), 8, 95);

    // ---- the chase rig's acceleration pull (sim time): the car surges away under power, drops back onto the lens
    // in a shift (a nod; a bog on a miss); the nitrous hit kicks the rig back. Under-damped: w 6.5, zeta 0.6.
    if (dt > 0) {
      this.aF += (s.a - this.aF) * (1 - Math.exp(-dt / 0.15));
      this.aS += (this.aF - this.aS) * (1 - Math.exp(-dt / 1.1));
      const raw = (this.aF - this.aS) * 0.12 + this.aS * 0.02;
      const tgt = Math.max(-0.45, Math.tanh(raw)) + 0.25 * this.fxK.nitro; // stock ~0.75 m, pro <= 1 m
      const W = 6.5, Z = 0.6;
      const n = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.pullV += (W * W * (tgt - this.pull) - 2 * Z * W * this.pullV) * h;
        this.pull += this.pullV * h;
      }
    }
    if (run) pos.x -= this.pull;

    // ---- shake. Launch trauma follows the car's real acceleration; decay and noise run in REAL time (slow-mo never
    // freezes it into a tilt) and the amplitude scales with the lens (a long lens doesn't magnify it). Level: no roll.
    if (this.launchT >= 0) {
      this.launchT += realDt;
      if (this.launchT < 0.5) this.trauma = Math.max(this.trauma, clamp(0.15 + 0.025 * s.a, 0.3, 1) * (1 - this.launchT / 0.5));
      else this.launchT = -1;
    }
    let rumble = 0;
    if (run) {
      if (s.nitroActive) rumble = 0.14;
    } else if (!s.launched && (view.burn ?? 0) > 0.2) rumble = 0.3 * (view.burn ?? 0);
    this.vibK.step(so.vib, 0.3, realDt);
    const tr2 = Math.max(this.trauma, rumble * (0.4 + this.vibK.x));
    const shakeK = (run ? Math.pow(tr2, 1.5) : tr2 * tr2) * clamp(fov / 50, 0.25, 1.2);
    this.trauma = Math.max(0, this.trauma - realDt * (run ? 2.0 : 1.35));
    this.fxK.shake = shakeK;
    const tn = this.ttReal * 21;
    const ang = ((run ? 0.75 : 1.6) * Math.PI) / 180;
    let yaw = this.noise[0](tn) * ang * shakeK;
    let pitch = this.noise[1](tn * 1.07) * ang * shakeK;
    const rollS = run ? 0 : this.noise[2](tn * 0.93) * ang * 1.4 * shakeK;
    const shPos = (run ? 0.018 : 0.035) * shakeK;
    pos.x += this.noise[3](tn * 1.3) * shPos;
    pos.y += this.noise[4](tn * 1.21) * shPos;
    if (run) {
      // road buzz: a fine high-frequency tremor that grows with speed and nitrous
      const spK = smooth01(s.v / 62);
      const buzz = ((0.05 + 0.15 * spK + 0.1 * this.fxK.nitro) * Math.PI) / 180;
      yaw += this.buzz(0) * buzz;
      pitch += this.buzz(1) * buzz;
      pos.y += this.buzz(2) * 0.01 * (spK + 0.5 * this.fxK.nitro);
      // crosswind: the rig sways and yaws a touch while a gust is on
      const g = view.gust ?? 0;
      if (g > 0) {
        pos.z += Math.sin(this.ttReal * 1.7) * 0.12 * g;
        yaw += this.noise[2](this.ttReal * 2.3) * ((0.35 * Math.PI) / 180) * g;
      }
    }

    // ---- the staging -> chase move: from the tree shot behind the car, a straight pull-out with a small lift
    let bk01 = 1;
    if (this.blendT >= 0) {
      this.blendT += realDt;
      bk01 = smooth01(this.blendT / this.blendLen);
      pos.lerpVectors(this.blendPos, pos, bk01);
      pos.y += Math.sin(bk01 * Math.PI) * 0.3;
      look.lerpVectors(this.blendLook, look, bk01);
      so.comp[0] = this.blendComp[0] + (so.comp[0] - this.blendComp[0]) * bk01;
      so.comp[1] = this.blendComp[1] + (so.comp[1] - this.blendComp[1]) * bk01;
      if (bk01 >= 1) this.blendT = -1;
    }
    this.lastLook.copy(look);
    this.lastComp[0] = so.comp[0];
    this.lastComp[1] = so.comp[1];

    this.constrain(pos, so, view);

    if (bk01 < 1) fov = this.blendFov + (fov - this.blendFov) * bk01;

    // ---- orient: look-at, composition offsets, dutch, shake
    this.m.lookAt(pos, look, this.cam.up);
    this.q.setFromRotationMatrix(this.m);
    const vf = (fov * Math.PI) / 360;
    const hf = Math.atan(Math.tan(vf) * (this.cam.aspect || 16 / 9));
    const cy = so.comp[1] + (this.o.hud ? (this.o.hud.bottom - this.o.hud.top) * 0.5 : 0);
    this.e.set(-Math.atan(cy * Math.tan(vf)) + pitch, Math.atan(so.comp[0] * Math.tan(hf)) + yaw, (run ? 0 : this.roll.x) + rollS, 'YXZ');
    this.q2.setFromEuler(this.e);
    this.q.multiply(this.q2);
    this.cam.position.copy(pos);
    this.cam.quaternion.copy(this.q);
    if (Math.abs(this.cam.fov - fov) > 1e-3) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
    this.cam.updateMatrixWorld();

    // ---- speed blur from the camera's own motion (cuts excluded); light during the run, the car kept sharp
    if (dt > 0 && !this.justCut) {
      const cv = this.tmpB.copy(pos).sub(this.camPrev).divideScalar(Math.max(1e-3, dt));
      if (cv.lengthSq() < 150 * 150) this.camVel.lerp(cv, 1 - Math.exp(-dt * 10));
    }
    this.justCut = false;
    this.camPrev.copy(pos);
    const sp = this.camVel.length();
    let bk = clamp((sp - 12) / 50, 0, 1) * 0.85 + this.fxK.nitro * 0.35 * clamp(sp / 30, 0, 1);
    if (run) bk = Math.min(0.55, bk * 0.7);
    const fe = this.cam.matrixWorld.elements;
    // a fast pan (the flyby whipping round after a 300 km/h car) smears the background along the pan; the tracked
    // car stays protected, like a real whip pan
    const fw0 = this.tmpD.set(-fe[8], -fe[9], -fe[10]);
    let pan = 0, pr = 0, pu = 0;
    if (realDt > 0 && !this.justCutPan) {
      const dx = fw0.x - this.fwPrev.x, dy = fw0.y - this.fwPrev.y, dz = fw0.z - this.fwPrev.z;
      pan = Math.hypot(dx, dy, dz) / realDt; // rad/s (small-angle)
      pr = dx * fe[0] + dy * fe[1] + dz * fe[2];
      pu = dx * fe[4] + dy * fe[5] + dz * fe[6];
    }
    this.justCutPan = false;
    this.fwPrev.copy(fw0);
    const kPan = run ? 0 : clamp((pan - 0.8) / 4, 0, 0.8);
    const panning = kPan > bk;
    if (panning) bk = kPan;
    this.blur.k += (Math.min(1, bk) - this.blur.k) * (1 - Math.exp(-realDt * 6));
    this.panK = kPan;
    if (panning) {
      const l = Math.hypot(pr, pu) || 1;
      this.blur.radial = false;
      this.blur.dir[0] = -pr / l;
      this.blur.dir[1] = -pu / l;
    } else if (sp > 1) {
      const vn = this.tmpB.copy(this.camVel).divideScalar(sp);
      const r = vn.x * fe[0] + vn.y * fe[1] + vn.z * fe[2];
      const u = vn.x * fe[4] + vn.y * fe[5] + vn.z * fe[6];
      const fw = -(vn.x * fe[8] + vn.y * fe[9] + vn.z * fe[10]);
      if (Math.abs(fw) > 0.62) {
        this.blur.radial = true;
        const k = Math.sign(fw) / Math.max(0.2, Math.abs(fw));
        this.blur.center[0] = clamp(0.5 + 0.5 * ((r * k) / Math.tan(hf)), 0.05, 0.95);
        this.blur.center[1] = clamp(0.5 + 0.5 * ((u * k) / Math.tan(vf)), 0.05, 0.95);
      } else {
        this.blur.radial = false;
        const l = Math.hypot(r, u) || 1;
        this.blur.dir[0] = -r / l;
        this.blur.dir[1] = -u / l;
      }
    }
    // keep the player's car sharp: protect everything up to just past its nose
    const nose = this.tmpB.set(this.P.x + c.L / 2 + 1, this.P.y + 0.6, this.P.z);
    this.blur.protect = run ? Math.max(0, -((nose.x - pos.x) * fe[8] + (nose.y - pos.y) * fe[9] + (nose.z - pos.z) * fe[10])) : 0;
    this.carEllipse(c);

    // ---- DOF (view depth to the subject's body); off during the run
    const f = this.tmpB.copy(so.focus ?? this.P);
    if (!so.focus || so.focus === this.P) f.y += c.H * 0.45;
    this.dof.focus = Math.max(0.3, -((f.x - pos.x) * fe[8] + (f.y - pos.y) * fe[9] + (f.z - pos.z) * fe[10]));
    const ap = this.blendT >= 0 || run ? 0 : so.aperture;
    this.dof.aperture += (ap - this.dof.aperture) * (1 - Math.exp(-realDt * (ap < this.dof.aperture ? 16 : 8)));
    if (run && this.blendT < 0) this.dof.aperture = 0;
  }

  /** Both cars' boxes projected to the screen: UV ellipses padded ~15% plus distances (the speed blur mask). */
  private carEllipse(c: ShotCtx) {
    this.blur.depth = this.ellipseOf(this.P, c.L, c.W, c.H, this.blur.ellipse);
    // a whip pan after a 300 km/h car: let its edges smear a little too (it is crossing the frame fast)
    if (this.panK > 0.3) {
      const k = 1 - 0.45 * clamp((this.panK - 0.3) / 0.5, 0, 1);
      this.blur.ellipse.rx *= k;
      this.blur.ellipse.ry *= k;
    }
    const g = c.view.ghost?.build?.dims;
    if (c.G) this.blur.ghostDepth = this.ellipseOf(c.G, g?.length ?? 4.6, g?.width ?? 1.9, g?.height ?? 1.35, this.blur.ghost);
    else {
      this.blur.ghost.rx = this.blur.ghost.ry = 0;
      this.blur.ghostDepth = 0;
    }
  }

  private ellipseOf(P: THREE.Vector3, L: number, W: number, H: number, el: { cx: number; cy: number; rx: number; ry: number }): number {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const v = this.tmpB;
    for (let i = 0; i < 8; i++) {
      v.set(P.x + ((i & 1 ? 1 : -1) * L) / 2, P.y + (i & 2 ? H : 0.05), P.z + ((i & 4 ? 1 : -1) * W) / 2);
      v.applyMatrix4(this.cam.matrixWorldInverse);
      if (-v.z < 0.1) {
        el.rx = el.ry = 0;
        return 0;
      }
      v.applyMatrix4(this.cam.projectionMatrix);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
    }
    el.cx = (x0 + x1) * 0.25 + 0.5;
    el.cy = (y0 + y1) * 0.25 + 0.5;
    el.rx = (x1 - x0) * 0.25 * 1.15;
    el.ry = (y1 - y0) * 0.25 * 1.15;
    return this.cam.position.distanceTo(v.set(P.x, P.y + H * 0.5, P.z));
  }

  /** Hard constraints: above the ground, inside the walls, out of the centre wall, the tree and both car bodies. */
  private constrain(pos: THREE.Vector3, so: ShotOut, view: CineView) {
    pos.y = Math.max(pos.y, 0.24);
    const wz = this.o.wallZ - 0.35;
    if (pos.y < this.o.wallH + 0.3) pos.z = clamp(pos.z, -wz, wz);
    const tr = this.treeV;
    const dx = pos.x - tr.x;
    const dz = pos.z - tr.z;
    const r = Math.hypot(dx, dz);
    if (pos.y < tr.y + 1.2 && r < 0.75) {
      const k = 0.75 / Math.max(1e-3, r);
      pos.x = tr.x + (r > 1e-3 ? dx * k : -0.75);
      pos.z = tr.z + (r > 1e-3 ? dz * k : 0);
    }
    // the centre guard wall (0.6 wide, 0.85 tall) from x = +9 down the strip
    const cz = (this.ctx.laneP + this.ctx.laneG) / 2;
    if (pos.x > 8.6 && pos.y < 1.15 && Math.abs(pos.z - cz) < 0.62) pos.z = cz + Math.sign(pos.z - cz || this.ctx.o) * 0.62;
    this.pushOut(pos, view.player, so.posRef === 'car' ? 0.18 : 0.32);
    if (view.ghost) this.pushOut(pos, view.ghost, 0.32);
  }

  private pushOut(pos: THREE.Vector3, car: CineCar, margin: number) {
    const d = car.build?.dims;
    const L = (d?.length ?? 4.6) / 2 + margin;
    const W = (d?.width ?? 1.9) / 2 + margin;
    const H = (d?.height ?? 1.35) + margin;
    const c = car.root.getWorldPosition(this.tmpD);
    const lx = pos.x - c.x;
    const lz = pos.z - c.z;
    if (Math.abs(lx) >= L || Math.abs(lz) >= W || pos.y >= H) return;
    const ox = L - Math.abs(lx);
    const oz = W - Math.abs(lz);
    const oy = H - pos.y;
    if (oz <= ox && oz <= oy) pos.z = c.z + Math.sign(lz || 1) * W;
    else if (ox <= oy) pos.x = c.x + Math.sign(lx || -1) * L;
    else pos.y = H;
  }

  /** Back to the start of the timeline (rerun). */
  reset(raceNo?: number) {
    const n = raceNo ?? this.o.raceNo ?? 1;
    const fresh = new CameraDirector(this.cam, { ...this.o, raceNo: n });
    Object.assign(this, fresh);
  }
}
