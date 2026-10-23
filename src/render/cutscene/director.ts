// Cutscene director: a real-time timeline (cues + spans), a world clock with a global timeScale for
// slow-mo ramps and freeze frames, a camera rig (dolly, whip pan, dutch tilt, zoom punch, shake), the
// particle pools, and the 2D overlay (letterbox, speed lines, flashes, Balatro-style name card).
import * as THREE from 'three';
import { duck } from '../audio';
import { FONT, PAL, hex } from '../palette';
import { Particles, clamp01, disposeTree, easeBack, easeInOut, easeOut, lerp, rand, seg, toonify } from './fx';
import { STING_LEAD, cutsceneSfx } from './sfx';
import { NO_GLITCH, OH, OW, mixLook, neutralLook, type GlitchParams, type Look, type Stage } from './stage';
import type { CarRig, CharacterRig, CutsceneId } from './types';

export interface CardInfo {
  /** Small word above the name ("SHERIFF"). */
  title: string;
  /** The big name ("BUCKSHOT"). */
  name: string;
  /** "ROUND 1 BOSS" / "FINAL BOSS". */
  round: string;
  /** Boss modifier name ("TIGHT TREE"). */
  modifier: string;
  taunt: string;
  /** Band colour and accent (CSS). */
  color: string;
  accent: string;
  /**
   * Card layout. 'left' (default): slanted band over the lower-left ~60%, so the boss must be framed in the
   * right third with the head in the upper half. 'low': full-width compact band at the bottom (y ~250-330).
   */
  layout?: 'left' | 'low';
  /**
   * World time scale while the card is up (default 0.15), so hair, beards and smoke keep drifting under it.
   * It composes with freeze(): a short d.freeze(CARD, 0.25) holds the slam, then the world runs at this.
   */
  timeScale?: number;
}

export interface StampOpts {
  /** Fill colour (CSS). Default yellow. */
  color?: string;
  /** Centre in 640x360 overlay px. Default (320, 140). */
  x?: number;
  y?: number;
  /** Press Start 2P size: 8, 16 or 24 px (default 24). */
  size?: 8 | 16 | 24;
  /** Resting tilt, radians (default -0.08). */
  rot?: number;
  /** Seconds on screen including the fade (default 0.9). */
  dur?: number;
  /** Optional comic starburst behind the text (CSS colour). */
  burst?: string;
}

type Ease = (u: number) => number;
type Vec = THREE.Vector3Like | [number, number, number];
const v3 = (v: Vec) => (Array.isArray(v) ? new THREE.Vector3(v[0], v[1], v[2]) : new THREE.Vector3(v.x, v.y, v.z));

const NOOP_SFX: typeof cutsceneSfx = Object.fromEntries(Object.keys(cutsceneSfx).map((k) => [k, () => {}])) as unknown as typeof cutsceneSfx;

/** Camera state the scenes animate. Shake / punch / roll are layered on at render time. */
export class CamRig {
  pos = new THREE.Vector3(0, 2, 10);
  look = new THREE.Vector3(0, 1, 0);
  fov = 38;
  /** Dutch tilt, radians. */
  roll = 0;
  trauma = 0;
  /** Extra buffeting (Gus's wind): constant shake floor. */
  buffet = 0;
  punchV = 0;
  private seed = Math.random() * 100;

  shake(amount: number) {
    this.trauma = Math.min(1.4, this.trauma + amount);
  }

  /** Zoom punch: a fast FOV kick (negative = punch in). */
  punch(deg: number) {
    this.punchV += deg;
  }

  apply(cam: THREE.PerspectiveCamera, t: number, dt: number) {
    const s = this.trauma * this.trauma + this.buffet;
    const n = (k: number) => Math.sin(t * 37 * k + this.seed * k) * 0.6 + Math.sin(t * 61 * k + this.seed) * 0.4;
    cam.position.copy(this.pos);
    cam.position.x += n(1.1) * s * 0.35;
    cam.position.y += n(1.7) * s * 0.35;
    cam.position.z += n(0.9) * s * 0.2;
    cam.up.set(0, 1, 0);
    cam.lookAt(this.look);
    cam.rotateZ(this.roll + n(2.3) * s * 0.08);
    cam.fov = Math.max(6, this.fov + this.punchV);
    cam.updateProjectionMatrix();
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.punchV *= Math.exp(-dt * 9);
  }
}

interface Cue {
  t: number;
  fn: () => void;
  done: boolean;
}
interface Span {
  t0: number;
  t1: number;
  fn: (u: number) => void;
  done: boolean;
  started: boolean;
  init?: () => void;
}

export class Director {
  readonly scene: THREE.Scene;
  readonly cam = new CamRig();
  readonly fx = new Particles();
  /** Real seconds since start. */
  t = 0;
  /** World seconds (integrated timeScale). */
  wt = 0;
  /** Current time scale (read-only for scenes; author with slowmo / freeze / timeScaleAt). */
  ts = 1;
  duration = 8;
  /** True while seeking (dev page) so sounds don't pile up. */
  silent = false;
  /** Crowd hype 0..1 (bounces the bleachers). */
  hype = 0.3;
  crowd: { update(t: number, hype: number): void } | null = null;

  private cues: Cue[] = [];
  private spans: Span[] = [];
  private updaters: ((dt: number, wdt: number) => void)[] = [];
  private tsKeys: [number, number][] = [[0, 1]];
  /** Slow-mo envelopes (Infinity outside their range); the world runs at the min of all layers. */
  private tsEnvs: ((t: number) => number)[] = [];
  /** Freeze windows [t0, t1): world time is 0 inside, whatever the other layers say. */
  private freezes: [number, number][] = [];
  private stepped = false;
  /** Real time of the name card (set by nameCard), and of its stinger cue. -1 = none. */
  cardAt = -1;
  private stingAt = -1;
  private skipped = false;
  private rigs: (CharacterRig | CarRig)[] = [];
  private ended = false;
  private resolve: (() => void) | null = null;
  private raf = 0;
  private lastNow = 0;
  private lastDuck = -1;
  private cleanup: (() => void)[] = [];

  // overlay state
  private flashA = 0;
  private flashCol = '#ffffff';
  private flashDecay = 6;
  letterbox = 0;
  private lbTarget = 0;
  /** 0..1 anime speed lines, focused on (fx, fy) in overlay px. */
  speedLines = 0;
  speedFocus: [number, number] = [OW / 2, OH / 2];
  /** Overlay tint over the 3D image, e.g. the freeze-frame darkening. */
  dim = 0;
  /** Colour wash for strobes (rgba css) and its alpha. */
  wash: { col: string; a: number } = { col: '#ff0000', a: 0 };
  private card: { t: number; info: CardInfo; landed: boolean } | null = null;
  private sparkles: { p: THREE.Vector3; t: number; size: number; col: string }[] = [];
  private cardEnd = Infinity;
  private skipHint = true;
  private impacts: { col: string; frames: number; shown: number }[] = [];
  private stamps: (Required<Omit<StampOpts, 'burst'>> & { t: number; text: string; burst?: string })[] = [];
  private splats: { t: number; col: string; sheen: string; seed: number }[] = [];
  private splatCanvas: HTMLCanvasElement | null = null;
  private glitches: { t0: number; t1: number; s: number }[] = [];
  private lookKeys: { t: number; look: Look; blend: number }[] = [];
  private lookFlicks: { t0: number; t1: number; a: Look; b: Look }[] = [];
  private neutral = neutralLook();
  private lookBuf = neutralLook();
  private lookBuf2 = neutralLook();
  private gp: GlitchParams = { ...NO_GLITCH };

  constructor(readonly stage: Stage) {
    this.scene = stage.scene;
    this.scene.add(this.fx.group);
  }

  get sfx(): typeof cutsceneSfx {
    if (this.silent) return NOOP_SFX;
    // the audio team's code is live-edited: never let a sound bug kill the cutscene
    return new Proxy(cutsceneSfx, {
      get: (o, k) => (...a: unknown[]) => {
        try {
          (o as unknown as Record<string | symbol, (...x: unknown[]) => void>)[k]?.(...a);
        } catch (e) {
          console.warn('[cutscene] sfx failed', String(k), e);
        }
      },
    });
  }

  // ---------- timeline authoring ----------

  /** One-shot at real time t. */
  at(t: number, fn: () => void) {
    this.cues.push({ t, fn, done: false });
  }

  /** Called every frame for t in [t0, t1] with u = 0..1, and once more with u = 1 after (so skips settle). */
  span(t0: number, t1: number, fn: (u: number) => void, init?: () => void) {
    this.spans.push({ t0, t1, fn, done: false, started: false, init });
  }

  /** Runs every frame. dt = real, wdt = world (slow-mo scaled). */
  every(fn: (dt: number, wdt: number) => void) {
    this.updaters.push(fn);
  }

  /**
   * Piecewise-linear timeScale keys in real time (a raw layer: keys interpolate between each other, so
   * bracket them yourself). Prefer slowmo() / freeze(), which compose in any order.
   */
  timeScaleAt(keys: [number, number][]) {
    this.tsKeys.push(...keys);
    this.tsKeys.sort((a, b) => a[0] - b[0]);
  }

  /**
   * Slow-mo from t0 to t1 at `scale`, ramping in over `ramp` and out over ramp/2, plus the whoosh sounds.
   * Layers compose: the world runs at the slowest active slow-mo, and freeze() beats everything.
   * `sound = false` skips the whooshes (e.g. a slow-time tail under the name card).
   */
  slowmo(t0: number, t1: number, scale = 0.12, ramp = 0.22, sound = true) {
    const r0 = Math.min(ramp, (t1 - t0) * 0.6);
    const r1 = Math.max(t0 + r0, t1 - ramp * 0.5);
    this.tsEnvs.push((t) => {
      if (t < t0 || t >= t1) return Infinity;
      if (t < t0 + r0) return lerp(1, scale, (t - t0) / Math.max(1e-6, r0));
      if (t < r1) return scale;
      return lerp(scale, 1, (t - r1) / Math.max(1e-6, t1 - r1));
    });
    if (!sound) return;
    this.at(t0, () => this.sfx.slowmoIn());
    if (Number.isFinite(t1)) this.at(r1, () => this.sfx.slowmoOut());
  }

  /** Freeze frame: world time stops for `dur` (real seconds) with a white pop. Composes with slowmo(). */
  freeze(t: number, dur: number, flash = 0.7) {
    this.freezes.push([t, t + dur]);
    this.at(t, () => {
      this.flash('#ffffff', flash, 10);
      this.cam.punch(-3);
    });
  }

  tsAt(t: number): number {
    for (const [a, b] of this.freezes) if (t >= a && t < b) return 0;
    const k = this.tsKeys;
    let v = k[k.length - 1][1];
    if (t <= k[0][0]) v = k[0][1];
    else
      for (let i = 1; i < k.length; i++) {
        if (t < k[i][0]) {
          const [ta, va] = k[i - 1];
          const [tb, vb] = k[i];
          v = tb - ta < 1e-6 ? vb : lerp(va, vb, (t - ta) / (tb - ta));
          break;
        }
      }
    for (const e of this.tsEnvs) v = Math.min(v, e(t));
    return v;
  }

  // ---------- camera authoring ----------

  /** Hard cut. */
  cut(t: number, pos: Vec, look: Vec, fov?: number, roll = 0) {
    this.at(t, () => {
      this.cam.pos.copy(v3(pos));
      this.cam.look.copy(v3(look));
      if (fov !== undefined) this.cam.fov = fov;
      this.cam.roll = roll;
    });
  }

  /** Dolly / pan / zoom / dutch from wherever the camera is at t0 to the target, eased. */
  move(t0: number, t1: number, to: { pos?: Vec; look?: Vec; fov?: number; roll?: number }, ease: Ease = easeInOut) {
    let p0 = new THREE.Vector3();
    let l0 = new THREE.Vector3();
    let f0 = 0;
    let r0 = 0;
    const p1 = to.pos ? v3(to.pos) : null;
    const l1 = to.look ? v3(to.look) : null;
    this.span(
      t0,
      t1,
      (u) => {
        const e = ease(u);
        if (p1) this.cam.pos.lerpVectors(p0, p1, e);
        if (l1) this.cam.look.lerpVectors(l0, l1, e);
        if (to.fov !== undefined) this.cam.fov = lerp(f0, to.fov, e);
        if (to.roll !== undefined) this.cam.roll = lerp(r0, to.roll, e);
      },
      () => {
        p0 = this.cam.pos.clone();
        l0 = this.cam.look.clone();
        f0 = this.cam.fov;
        r0 = this.cam.roll;
      },
    );
  }

  /** Whip pan: snap the look target over `dur` with streaks and a smear flash. */
  whip(t: number, dur: number, to: { pos?: Vec; look: Vec; fov?: number; roll?: number }) {
    this.move(t, t + dur, to, (u) => easeInOut(u));
    this.span(t, t + dur, (u) => (this.speedLines = Math.max(this.speedLines, Math.sin(u * Math.PI))));
  }

  /** Camera that tracks a moving thing: fn returns pos/look each frame. */
  follow(t0: number, t1: number, fn: (u: number) => { pos?: THREE.Vector3; look?: THREE.Vector3; fov?: number; roll?: number }) {
    this.span(t0, t1, (u) => {
      const r = fn(u);
      if (r.pos) this.cam.pos.copy(r.pos);
      if (r.look) this.cam.look.copy(r.look);
      if (r.fov !== undefined) this.cam.fov = r.fov;
      if (r.roll !== undefined) this.cam.roll = r.roll;
    });
  }

  // ---------- overlay authoring ----------

  flash(col = '#ffffff', a = 1, decay = 6) {
    this.flashCol = col;
    this.flashA = Math.max(this.flashA, a);
    this.flashDecay = decay;
  }

  /** Anime twinkle (4-point pixel star) at a world point, drawn on the overlay. */
  sparkle(p: THREE.Vector3Like, size = 14, col = '#ffffff') {
    this.sparkles.push({ p: v3(p), t: this.t, size, col });
  }

  bars(on: boolean) {
    this.lbTarget = on ? 1 : 0;
  }

  /**
   * Hit-stop impact frame: `frames` drawn frames (at least one) of solid colour over everything at real time t,
   * and world time stops for frames/60 s. `col` is any CSS colour, or 'invert' for a negative of the 3D frame.
   */
  impactFrame(t: number, col = '#000000', frames = 2) {
    const n = Math.max(1, Math.round(frames));
    this.freezes.push([t, t + n / 60]);
    this.at(t, () => this.impacts.push({ col, frames: n, shown: 0 }));
  }

  /**
   * Comic text slammed on screen at real time t, Balatro-style ("PULLED OVER.", "HWOOOOAAAAR"): pops in from
   * 2.4x with a jolt, letters bob, tilt wobbles, then it swells and fades over the last 0.22 s. Thick dark
   * outline + drop shadow. x/y = centre in 640x360 px. '\n' splits lines. Runs on real time (fine in freezes).
   */
  stamp(t: number, text: string, opts: StampOpts = {}) {
    const s = {
      t,
      text,
      color: opts.color ?? hex(PAL.yellow),
      x: opts.x ?? OW / 2,
      y: opts.y ?? 140,
      size: opts.size === 8 || opts.size === 16 ? opts.size : 24,
      rot: opts.rot ?? -0.08,
      dur: Math.max(0.3, opts.dur ?? 0.9),
      burst: opts.burst,
    } as const;
    this.at(t, () => this.stamps.push({ ...s, t: this.t }));
  }

  /**
   * A big glossy blob splats the lens at real time t (hard pop in ~3 frames), drips run down from it, a `sheen`
   * highlight sits on the upper-left, and it all fades out by ~0.7 s. Drawn on the overlay, over the letterbox.
   */
  lensSplat(t: number, col = '#07070c', sheen = '#5cf2ff') {
    const seed = Math.floor((t * 1000 + this.splats.length * 7919) % 2147483647) + 1;
    this.at(t, () => this.splats.push({ t: this.t, col, sheen, seed }));
  }

  /**
   * Turbo-style glitch corruption of the 3D frame over real time [t0, t1] (a post pass; the overlay stays
   * clean). Stutters at 30 Hz through: RGB channel split, sliding horizontal bands, thin scanline jitter,
   * datamosh macro-blocks, 1-2 hard scanline tears with a bright edge, candy-palette flicker, magenta/cyan
   * noise cells, negative (invert) frames and "pixel crush" frames that drop to chunky 8-12 px blocks with a
   * 6-level posterize (a nod to the old pixel look). Always: a crush frame on the first and on the last glitch
   * frame, an invert frame at the midpoint. A short 0.12 s settling tail after t1. `strength` 0..1+ scales
   * everything (0.5 = a light hiccup, 1 = the full heel turn, 1.3 = Rosa). Pure function of time: seeking
   * lands on exactly the same frame. Windows can overlap (the strongest wins per frame).
   * Pair it with sfx.glitch(t1 - t0), turnAt() for rig.setTurn, and lookFlicker() / heelTurn() for the light.
   */
  glitch(t0: number, t1: number, strength = 1) {
    this.glitches.push({ t0, t1: Math.max(t0 + 1 / 30, t1), s: strength });
  }

  /** Glitch amount 0..1 at real time t (0 outside every window). */
  glitchAt(t = this.t): number {
    return this.glitchParams(t).amount;
  }

  /**
   * Heel-turn state at real time t, in sync with the glitch's stutter: 0 before the first glitch window that
   * has started, 1 after it ends, and inside it a deterministic flicker between 0 and 1 that leans toward 1 as
   * the window goes on (the last ~20% is solid 1). With no glitch windows at all, always 0.
   * Use: d.every(() => rig.setTurn?.(d.turnAt())) or inside a span.
   */
  turnAt(t = this.t): 0 | 1 {
    let w: { t0: number; t1: number } | null = null;
    for (const g of this.glitches) if (t >= g.t0 && (!w || g.t0 > w.t0)) w = g;
    if (!w) return 0;
    if (t >= w.t1) return 1;
    return Director.flip(t, w.t0, w.t1);
  }

  private static hash(n: number) {
    const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  /** Deterministic sweet/jerk flicker inside [t0, t1): 30 Hz frames, P(jerk) ramps 0.15 -> 1. */
  static flip(t: number, t0: number, t1: number): 0 | 1 {
    const u = (t - t0) / Math.max(1e-6, t1 - t0);
    if (u < 0) return 0;
    if (u >= 0.8) return 1;
    const f = Math.floor((t - t0) * 30);
    // hold each state for 1-3 frames so the flicker reads as cuts, not noise
    const hold = Math.floor(f / (1 + Math.floor(Director.hash(Math.floor(f / 3) + 0.5) * 2)));
    const p = 0.15 + 0.85 * Math.pow(u / 0.8, 1.3);
    return Director.hash(hold * 7.13 + t0 * 3.1) < p ? 1 : 0;
  }

  /**
   * Lighting/grade preset from real time t: hard snap (blend 0) or an eased blend over `blend` seconds
   * from whatever was showing. Build looks with warmSweet() / harshJerk(color) / neutralLook() (stage.ts,
   * re-exported by scenes/common.ts). Keys resolve by time, so seeking is exact. Before any key: neutralLook().
   */
  look(t: number, look: Look, blend = 0) {
    this.lookKeys.push({ t, look, blend });
    this.lookKeys.sort((a, b) => a.t - b.t);
  }

  /**
   * Inside [t0, t1) the look flips between `a` (sweet) and `b` (jerk) in sync with turnAt()'s stutter
   * (same frames, so the light and the face flip together). Overrides look() keys inside the window.
   */
  lookFlicker(t0: number, t1: number, a: Look, b: Look) {
    this.lookFlicks.push({ t0, t1, a, b });
  }

  /** The look at real time t (resolved into a shared buffer). */
  lookAt(t = this.t): Look {
    for (const f of this.lookFlicks) if (t >= f.t0 && t < f.t1) return Director.flip(t, f.t0, f.t1) ? f.b : f.a;
    let cur: Look = this.neutral;
    let k = 0;
    for (const key of this.lookKeys) {
      if (key.t > t) break;
      const u = key.blend > 0 ? easeInOut((t - key.t) / key.blend) : 1;
      if (u >= 1) cur = key.look;
      else {
        cur = mixLook(cur, key.look, u, k++ % 2 ? this.lookBuf2 : this.lookBuf);
      }
    }
    return cur;
  }

  private glitchParams(t: number): GlitchParams {
    const out = this.gp;
    Object.assign(out, NO_GLITCH);
    const H = Director.hash;
    for (const w of this.glitches) {
      const TAIL = 0.12;
      if (t < w.t0 || t >= w.t1 + TAIL) continue;
      const f = Math.floor((t - w.t0) * 30);
      const nF = Math.max(1, Math.round((w.t1 - w.t0) * 30));
      const base = w.t0 * 17.3 + f;
      const tail = t >= w.t1 ? 1 - (t - w.t1) / TAIL : 1;
      const u = (t - w.t0) / (w.t1 - w.t0);
      const s = w.s * tail;
      // stutter: a few near-clean frames let the sweet/jerk flicker read; the end is the loudest
      let env = 0.45 + 0.55 * H(base + 0.1);
      if (H(base + 0.2) < 0.18 && f > 0 && f < nF - 2) env *= 0.2;
      env *= Math.min(1, 0.55 + u * 0.9);
      if (t >= w.t1) env = 0.5 * tail;
      const a = Math.min(1.2, env * s);
      if (a < out.amount) continue;
      const crushF = f === 0 || f === nF - 1 || (H(base + 0.3) < 0.1 * s && f > 1);
      const invF = t < w.t1 && (f === Math.floor(nF / 2) || (H(base + 0.4) < 0.07 * s && f > 1 && f < nF - 1));
      const crush = t < w.t1 && crushF && !invF;
      const k = crush ? a * 0.35 : a; // a crush frame reads clean: chunky pixels, light corruption
      out.amount = k;

      out.seed = (H(base + 0.5) * 97.0) % 97;
      out.split = k * (3 + 9 * H(base + 0.6)) * (H(base + 0.65) < 0.5 ? -1 : 1);
      out.slice = Math.min(0.85, k * (0.25 + 0.5 * H(base + 0.7)));
      out.block = k > 0.45 ? k * 0.22 * H(base + 0.8) : 0;
      out.tear = H(base + 0.9) < 0.6 ? Math.min(1, k * 1.2) : 0;
      out.invert = invF ? 1 : 0;
      out.crush = crush ? (H(base + 1.1) < 0.5 ? 6 : 8) : 0;
      out.palette = !crush && H(base + 1.2) < 0.4 ? Math.min(0.85, k * 0.8) : k * 0.12;
      out.noise = (crush ? 0 : a) * (0.04 + 0.08 * H(base + 1.3));
    }
    return out;
  }

  /**
   * Name card slam at time t; the cutscene ends `hold` seconds after the taunt finishes typing. While it's up
   * the world runs at info.timeScale (0.15) so it keeps drifting; a d.freeze(t, 0.25) on top holds the slam.
   * Skip jumps here first (see skip()).
   */
  nameCard(t: number, info: CardInfo, hold = 1.1, id?: CutsceneId) {
    // the stinger's chord hit lands exactly on the name slam (t + 0.34)
    if (id) {
      this.stingAt = Math.max(0, t + 0.34 - (STING_LEAD[id] ?? 0.7));
      this.at(this.stingAt, () => this.sfx.sting(id));
    }
    this.cardAt = t;
    const cs = info.timeScale ?? 0.15;
    this.tsEnvs.push((x) => (x < t ? Infinity : lerp(1, cs, clamp01((x - t) / 0.12))));
    this.at(t, () => {
      this.card = { t: this.t, info, landed: false };
      this.skipHint = false;
      this.lbTarget = 1; // the taunt types in the bottom bar
    });
    const typeDur = info.taunt.length / 38;
    this.cardEnd = t + 0.7 + typeDur + hold;
    this.duration = this.cardEnd + 0.12;
  }

  // ---------- object helpers ----------

  /** Registers a model rig: updated with world dt, disposed at the end. Converts it to toon + outlines. */
  rig<T extends CharacterRig | CarRig>(r: T): T {
    toonify(r.root);
    this.rigs.push(r);
    return r;
  }

  /** Uniformly scale an object so its bounding-box height is `h` metres. */
  static fitHeight(o: THREE.Object3D, h: number) {
    o.updateWorldMatrix(true, true);
    const b = new THREE.Box3().setFromObject(o);
    const cur = b.max.y - b.min.y;
    if (cur > 1e-3) o.scale.multiplyScalar(h / cur);
  }

  /** World position of an object (new vector). */
  static wp(o: THREE.Object3D, out = new THREE.Vector3()) {
    o.updateWorldMatrix(true, true);
    return o.getWorldPosition(out);
  }

  /** Simple ballistic prop (debris, hats, hubcaps): flies with gravity + spin, world-time scaled. */
  fling(o: THREE.Object3D, t: number, vel: Vec, spin: Vec, gravity = 9.8, floor = -Infinity) {
    const v = v3(vel);
    const w = v3(spin);
    let live = false;
    this.at(t, () => (live = true));
    this.every((_dt, wdt) => {
      if (!live) return;
      v.y -= gravity * wdt;
      o.position.addScaledVector(v, wdt);
      o.rotation.x += w.x * wdt;
      o.rotation.y += w.y * wdt;
      o.rotation.z += w.z * wdt;
      if (o.position.y < floor) {
        o.position.y = floor;
        v.multiplyScalar(0.4);
        v.y = Math.abs(v.y);
      }
    });
  }

  onDispose(fn: () => void) {
    this.cleanup.push(fn);
  }

  // ---------- running ----------

  /** Advance one step. Exposed for the dev page's seek. */
  step(dt: number) {
    this.stepped = true;
    const t = this.t;
    this.ts = this.tsAt(t);
    const wdt = dt * this.ts;
    this.wt += wdt;
    this.speedLines *= Math.exp(-dt * 10);
    // spans that were running and end now settle (u = 1) BEFORE this frame's cues, so a cut at a follow's
    // end time wins instead of being overwritten by the follow's last call
    for (const s of this.spans)
      if (s.started && !s.done && t >= s.t1) {
        s.fn(1);
        s.done = true;
      }
    for (const c of this.cues)
      if (!c.done && t >= c.t) {
        c.done = true;
        c.fn();
      }
    for (const s of this.spans) {
      if (s.done || t < s.t0) continue;
      if (!s.started) {
        s.started = true;
        s.init?.();
      }
      const u = clamp01((t - s.t0) / Math.max(1e-6, s.t1 - s.t0));
      s.fn(u);
      if (u >= 1) s.done = true;
    }
    for (const u of this.updaters) u(dt, wdt);
    for (const r of this.rigs) r.update(wdt);
    this.fx.update(wdt, this.stage.camera);
    this.crowd?.update(this.wt, this.hype);
    this.cam.apply(this.stage.camera, t, dt);
    this.flashA = Math.max(0, this.flashA - dt * this.flashDecay);
    this.letterbox += (this.lbTarget - this.letterbox) * Math.min(1, dt * 10);
    this.t += dt;
  }

  draw() {
    const L = this.lookAt(this.t);
    if (L !== this.stage.look) mixLook(L, L, 0, this.stage.look);
    this.stage.glitch = this.glitchParams(this.t);
    this.stage.render();
    this.drawOverlay();
  }

  /** Jump to time `t` by simulating at 60 fps (dev page). */
  seek(t: number) {
    this.silent = true;
    if (!this.stepped) this.step(0); // t = 0 cues (the opening cut) before any frame is drawn
    while (this.t < t) {
      this.step(Math.min(1 / 60, t - this.t + 1e-6));
      this.drawOverlay(); // the card's slam logic runs in its draw
    }
    this.silent = false;
    this.draw();
  }

  /** Plays to the end (or skip). Resolves once everything is disposed. */
  play(): Promise<void> {
    return new Promise((res) => {
      this.resolve = res;
      this.bindInput();
      if (!this.stepped) {
        // apply the t = 0 cues and show that frame now, so the first visible frame is never an unset camera
        try {
          this.step(0);
          this.draw();
        } catch (e) {
          console.error('[cutscene] first frame failed, ending', e);
          this.end();
          return;
        }
      }
      this.lastNow = performance.now();
      const tick = (now: number) => {
        if (this.ended) return;
        const dt = Math.min(0.05, (now - this.lastNow) / 1000);
        this.lastNow = now;
        if (this.t - this.lastDuck > 0.4) {
          this.lastDuck = this.t;
          if (!this.silent) duck(0.7);
        }
        try {
          this.step(dt);
          this.draw();
        } catch (e) {
          console.error('[cutscene] frame failed, ending', e);
          this.end();
          return;
        }
        if (this.t >= this.duration) this.end();
        else this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    });
  }

  /**
   * Space / Enter / Esc / click. First press during the action: hush the scene's sounds and fast-forward
   * (silently simulated, so every cue and span lands) to just before the stinger, so the player still sees
   * the name card slam on the beat. A second press, or any press once the card is up, ends the cutscene.
   */
  skip() {
    if (this.ended || this.t < 0.3) return;
    if (this.card || this.skipped || this.cardAt < 0 || this.t >= this.cardAt) {
      this.end();
      return;
    }
    this.skipped = true;
    // land a hair before the stinger (its riser leads the slam) unless we're already past it
    const to = this.stingAt >= 0 && this.stingAt - 0.02 > this.t ? this.stingAt - 0.02 : this.cardAt;
    try {
      this.sfx.hush();
    } catch {
      /* sound is optional */
    }
    this.silent = true;
    try {
      while (this.t < to - 1e-6) this.step(Math.min(1 / 60, to - this.t));
    } catch (e) {
      console.error('[cutscene] skip failed, ending', e);
      this.silent = false;
      this.end();
      return;
    }
    this.silent = false;
    this.sparkles = [];
    this.stamps = [];
    this.splats = [];
    this.impacts = [];
    this.flash('#ffffff', 0.7, 9); // smear the jump
    this.lastNow = performance.now();
  }

  private bindInput() {
    const SKIP = new Set(['Space', 'Enter', 'NumpadEnter', 'Escape']);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyM') return; // global mute stays live
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.type === 'keydown' && !e.repeat && SKIP.has(e.code)) this.skip();
    };
    const onPtr = (e: Event) => {
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
      if (e.type === 'pointerdown') this.skip();
    };
    const ptrs = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'];
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    ptrs.forEach((p) => window.addEventListener(p, onPtr, true));
    this.cleanup.push(() => {
      // keep swallowing briefly so the skip press's keyup/click can't land on Staging
      setTimeout(() => {
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('keyup', onKey, true);
        ptrs.forEach((p) => window.removeEventListener(p, onPtr, true));
      }, 280);
    });
  }

  end() {
    if (this.ended) return;
    this.ended = true;
    cancelAnimationFrame(this.raf);
    this.dispose();
    this.resolve?.();
  }

  dispose() {
    for (const r of this.rigs) {
      try {
        r.dispose();
      } catch (e) {
        console.warn('[cutscene] rig dispose failed', e);
      }
    }
    this.rigs = [];
    disposeTree(this.scene);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.stage.dispose();
  }

  // ---------- overlay drawing ----------

  private drawOverlay() {
    const g = this.stage.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, OW, OH);
    if (this.wash.a > 0.01) {
      g.globalAlpha = this.wash.a;
      g.fillStyle = this.wash.col;
      g.fillRect(0, 0, OW, OH);
      g.globalAlpha = 1;
    }
    if (this.dim > 0.01) {
      g.fillStyle = `rgba(7,6,13,${this.dim})`;
      g.fillRect(0, 0, OW, OH);
    }
    if (this.speedLines > 0.02) this.drawSpeedLines(g);
    this.sparkles = this.sparkles.filter((sp) => this.t - sp.t < 0.6);
    for (const sp of this.sparkles) {
      const q = sp.p.clone().project(this.stage.camera);
      if (q.z > 1) continue;
      const x = Math.round((q.x * 0.5 + 0.5) * OW);
      const y = Math.round((-q.y * 0.5 + 0.5) * OH);
      const u = (this.t - sp.t) / 0.6;
      const r = Math.round(sp.size * Math.sin(Math.min(1, u * 1.6) * Math.PI) + 1);
      g.fillStyle = sp.col;
      g.fillRect(x - 1, y - r, 2, r * 2);
      g.fillRect(x - r, y - 1, r * 2, 2);
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    const lb = Math.round(this.letterbox * 36);
    if (lb > 0) {
      g.fillStyle = '#07060d';
      g.fillRect(0, 0, OW, lb);
      g.fillRect(0, OH - lb, OW, lb);
    }
    if (this.splats.length) this.drawSplats(g);
    if (this.stamps.length) this.drawStamps(g);
    if (this.card) this.drawCard(g);
    if (this.impacts.length) this.drawImpacts(g);
    if (this.skipHint && this.t > 0.6) {
      g.font = `8px ${FONT}`;
      g.textBaseline = 'top';
      g.textAlign = 'right';
      g.fillStyle = Math.floor(this.t * 2) % 2 ? hex(PAL.inkDim) : hex(PAL.ink);
      g.fillText('SPACE: SKIP', OW - 10, OH - 16);
      g.textAlign = 'left';
    }
    if (this.flashA > 0.01) {
      g.globalAlpha = Math.min(1, this.flashA);
      g.fillStyle = this.flashCol;
      g.fillRect(0, 0, OW, OH);
      g.globalAlpha = 1;
    }
  }

  private drawSpeedLines(g: CanvasRenderingContext2D) {
    const [fx, fy] = this.speedFocus;
    const n = Math.round(60 * this.speedLines);
    g.fillStyle = 'rgba(244,236,216,0.85)';
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const r0 = rand(150, 260);
      const len = rand(60, 240);
      const w = rand(1, 4);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x0 = fx + ca * r0;
      const y0 = fy + sa * r0;
      const x1 = fx + ca * (r0 + len);
      const y1 = fy + sa * (r0 + len);
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1 - sa * w, y1 + ca * w);
      g.lineTo(x1 + sa * w, y1 - ca * w);
      g.closePath();
      g.fill();
    }
  }

  /** Pixel-crisp text with a hard outline and drop shadow. */
  private label(g: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, col: string, o = 2, shadow = 0) {
    g.font = `${size}px ${FONT}`;
    g.textBaseline = 'top';
    if (shadow) {
      g.fillStyle = '#07060d';
      for (let dx = -o; dx <= o; dx += o) for (let dy = -o; dy <= o; dy += o) g.fillText(s, x + dx + shadow, y + dy + shadow);
    }
    if (o) {
      g.fillStyle = '#07060d';
      for (let dx = -o; dx <= o; dx += o) for (let dy = -o; dy <= o; dy += o) if (dx || dy) g.fillText(s, x + dx, y + dy);
    }
    g.fillStyle = col;
    g.fillText(s, x, y);
  }

  /**
   * The name card. 'left': a slanted band over the lower-left ~60% (x < ~400, y ~200-290), ROUND tag above
   * it, BOSS pill under it, taunt typed in the bottom letterbox on the left; the right third and the upper
   * half stay clear for the boss. 'low': a compact full-width band at y ~256-320. The frame darkens by at
   * most 0.2, fading out before the right third.
   */
  private drawCard(g: CanvasRenderingContext2D) {
    const c = this.card!;
    const k = c.info;
    const e = this.t - c.t;
    const outT = this.cardEnd - this.t;
    const low = k.layout === 'low';
    // gentle darkening on the left two thirds only (never over the boss)
    const dimA = 0.2 * clamp01(e / 0.15);
    const grd = g.createLinearGradient(0, 0, (OW * 2) / 3, 0);
    grd.addColorStop(0, `rgba(7,6,13,${dimA})`);
    grd.addColorStop(0.75, `rgba(7,6,13,${dimA * 0.8})`);
    grd.addColorStop(1, 'rgba(7,6,13,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, Math.ceil((OW * 2) / 3), OH);

    const bandY = low ? 256 : 206;
    const bandH = low ? 62 : 76;
    // slide in from the left, then a 3 px wobble as it lands and a 2 px kick when the name slams
    const slide = easeOut(seg(e, 0, 0.16));
    const wob = e > 0.16 ? Math.sin((e - 0.16) * 46) * 3 * Math.exp(-(e - 0.16) * 7) : 0;
    const kick = e > 0.34 ? Math.sin((e - 0.34) * 52) * 2 * Math.exp(-(e - 0.34) * 9) : 0;
    const ox = Math.round(lerp(-OW, 0, slide) + wob);
    const oy = Math.round(kick);
    const R = low ? OW + 60 : 404;
    const rise = low ? 0 : 12; // the left band climbs a little toward its slanted end
    const slant = low ? 0 : 40;
    const quad = (dx: number, dy: number, y: number, h: number, col: string, grow = 0) => {
      const x = ox + dx;
      const yy = oy + dy + y;
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(x - 60, yy);
      g.lineTo(x + R + grow, yy - rise);
      g.lineTo(x + R + grow - slant * (h / bandH), yy + h - rise);
      g.lineTo(x - 60, yy + h);
      g.closePath();
      g.fill();
    };
    quad(10, 8, bandY, bandH, '#07060d');
    quad(0, 0, bandY, bandH, k.color);
    quad(4, -7, bandY - 4, 4, k.accent, 6);
    quad(-6, 3, bandY + bandH, 4, k.accent, -10);
    // chevrons scrolling in the band
    g.save();
    quad(0, 0, bandY, bandH, 'rgba(0,0,0,0)');
    g.clip();
    g.fillStyle = 'rgba(0,0,0,0.16)';
    const off = (e * 120) % 48;
    for (let x = -96 + off; x < OW + 48; x += 48) {
      g.beginPath();
      g.moveTo(ox + x, bandY - rise + oy);
      g.lineTo(ox + x + 20, bandY - rise + oy);
      g.lineTo(ox + x + 20 + bandH * 0.5, bandY + bandH + oy);
      g.lineTo(ox + x + bandH * 0.5, bandY + bandH + oy);
      g.closePath();
      g.fill();
    }
    g.restore();

    // ROUND tag pops above the band, on the left
    const tagE = seg(e, 0.12, 0.26);
    if (tagE > 0) {
      const s = easeBack(tagE);
      g.save();
      g.translate(44 + ox, bandY - 30 + oy);
      g.scale(s, s);
      g.font = `8px ${FONT}`;
      const w = g.measureText(k.round).width + 12;
      g.fillStyle = '#07060d';
      g.fillRect(2, 2, w, 16);
      g.fillStyle = hex(PAL.yellow);
      g.fillRect(0, 0, w, 16);
      g.fillStyle = '#07060d';
      g.textBaseline = 'top';
      g.fillText(k.round, 6, 4);
      g.restore();
    }

    // name: title word + giant name slam
    const tx = 52 + ox;
    const titleE = seg(e, 0.1, 0.22);
    if (titleE > 0 && k.title) this.label(g, k.title, Math.round(lerp(-200, 52, easeOut(titleE))) + ox, bandY + (low ? 5 : 9) + oy, 16, k.accent, 2, 2);
    const nameE = seg(e, 0.18, 0.34);
    if (nameE > 0) {
      const s = lerp(3.2, 1, easeBack(nameE, 1.4));
      g.save();
      const nx = tx - 4;
      const ny = bandY + (low ? 26 : 34) + oy;
      g.translate(nx, ny + 16);
      g.scale(s, s);
      g.translate(-nx, -(ny + 16));
      this.label(g, k.name, nx, ny, 32, '#ffffff', 3, 4);
      g.restore();
      if (!c.landed && nameE >= 1) {
        c.landed = true;
        this.sfx.impact();
        this.cam.shake(0.9);
        this.flash('#ffffff', 0.55, 8);
      }
    }

    // boss modifier pill: under the band on the left ('left'), inside the band on the right ('low')
    const modE = seg(e, 0.38, 0.52);
    if (modE > 0 && k.modifier) {
      const s = easeBack(modE);
      const str = `BOSS: ${k.modifier}`;
      g.font = `8px ${FONT}`;
      const w = g.measureText(str).width + 16;
      g.save();
      if (low) g.translate(OW - 30 - w / 2 + ox, bandY + bandH / 2 + oy);
      else g.translate(56 + w / 2 + ox, bandY + bandH + 22 + oy);
      g.rotate(-0.06);
      g.scale(s, s);
      g.fillStyle = '#07060d';
      g.fillRect(-w / 2 + 3, -10 + 3, w, 20);
      g.fillStyle = hex(PAL.red);
      g.fillRect(-w / 2, -10, w, 20);
      g.fillStyle = hex(PAL.ink);
      g.fillRect(-w / 2, -10, w, 2);
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.fillStyle = hex(PAL.ink);
      g.fillText(str, 0, 1);
      g.restore();
      g.textAlign = 'left';
    }

    // taunt typed out in the bottom letterbox, on the left
    const typeE = e - 0.62;
    if (typeE > 0 && k.taunt) {
      const lines = wrap(`"${k.taunt.toUpperCase()}"`, low ? 70 : 46).slice(0, 2);
      let n = Math.floor(typeE * 38);
      const y0 = lines.length > 1 ? OH - 33 : OH - 26;
      lines.forEach((ln, i) => {
        const shown = ln.slice(0, Math.max(0, n));
        n -= ln.length;
        const y = y0 + i * 14;
        this.label(g, shown, 44, y, 8, hex(PAL.ink), 1, 1);
        if (n < 0 && shown.length < ln.length && Math.floor(this.t * 8) % 2) {
          g.fillStyle = hex(PAL.ink);
          g.fillRect(44 + shown.length * 8, y, 7, 8);
        }
      });
    }
    // final white-out into Staging
    if (outT < 0.14) this.flash('#f4ecd8', 1 - outT / 0.14, 0.01);
  }

  /** Solid hit-stop frames (or a negative of the 3D frame for 'invert'). */
  private drawImpacts(g: CanvasRenderingContext2D) {
    const it = this.impacts[0];
    if (it.col === 'invert') {
      g.save();
      g.imageSmoothingEnabled = false;
      g.drawImage(this.stage.canvas, 0, 0, OW, OH);
      g.globalCompositeOperation = 'difference';
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, OW, OH);
      g.restore();
    } else {
      g.fillStyle = it.col;
      g.fillRect(0, 0, OW, OH);
    }
    it.shown++;
    if (it.shown >= it.frames) this.impacts.shift();
  }

  private drawStamps(g: CanvasRenderingContext2D) {
    this.stamps = this.stamps.filter((s) => this.t - s.t < s.dur);
    // each stamp is drawn opaque to a scratch canvas, then composited with its fade (no muddy outline overlap)
    const buf = this.scratch();
    const g0 = g;
    for (const s of this.stamps) {
      const g = buf.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, OW, OH);
      const e = this.t - s.t;
      const fade = seg(e, s.dur - 0.22, s.dur);
      const pop = e < 0.12 ? lerp(2.4, 1, easeBack(e / 0.12, 2.6)) : 1 + 0.04 * Math.sin(e * 20) * Math.exp(-(e - 0.12) * 5);
      const sc = pop * (1 + fade * 0.25);
      const rot = s.rot + Math.sin(e * 26) * 0.08 * Math.exp(-e * 4) + Math.sin(e * 4.5) * 0.02;
      const jit = e < 0.2 ? (1 - e / 0.2) * 3 : 0;
      const o = s.size >= 24 ? 3 : s.size >= 16 ? 2 : 1;
      const lines = s.text.split('\n');
      const lh = s.size + o * 2 + 4;
      const totalH = lines.length * lh - 4;
      const maxW = Math.max(...lines.map((l) => l.length)) * s.size;
      g.save();
      g.translate(Math.round(s.x + rand(-jit, jit)), Math.round(s.y + rand(-jit, jit)));
      g.rotate(rot);
      g.scale(sc, sc);
      if (s.burst) {
        const rx = maxW / 2 + 22;
        const ry = totalH / 2 + 18;
        const n = 14;
        const star = (grow: number, col: string) => {
          g.fillStyle = col;
          g.beginPath();
          for (let i = 0; i < n * 2; i++) {
            const a = (i / (n * 2)) * Math.PI * 2;
            const r = i % 2 ? 0.72 : 1 + 0.12 * Math.sin(i * 2.3);
            g.lineTo(Math.cos(a) * (rx + grow) * r, Math.sin(a) * (ry + grow) * r);
          }
          g.closePath();
          g.fill();
        };
        star(5, '#07060d');
        star(0, s.burst);
      }
      g.font = `${s.size}px ${FONT}`;
      g.textBaseline = 'top';
      lines.forEach((ln, li) => {
        const x0 = -(ln.length * s.size) / 2;
        const y0 = -totalH / 2 + li * lh;
        // per-letter bob (Balatro)
        const ys = [...ln].map((_, i) => Math.round(Math.sin(e * 9 + i * 0.75 + li) * (s.size / 12)));
        const pass = (dx: number, dy: number, col: string) => {
          g.fillStyle = col;
          for (let i = 0; i < ln.length; i++) g.fillText(ln[i], x0 + i * s.size + dx, y0 + ys[i] + dy);
        };
        for (let dx = -o; dx <= o; dx += o) for (let dy = -o; dy <= o; dy += o) pass(dx + o + 1, dy + o + 1, '#07060d'); // shadow
        for (let dx = -o; dx <= o; dx += o) for (let dy = -o; dy <= o; dy += o) if (dx || dy) pass(dx, dy, '#07060d');
        pass(0, 0, s.color);
      });
      g.restore();
      g0.save();
      g0.globalAlpha = 1 - fade;
      g0.drawImage(buf, 0, 0);
      g0.restore();
    }
  }

  private scratchCanvas: HTMLCanvasElement | null = null;
  /** Shared offscreen 640x360 canvas for stamps. */
  private scratch() {
    if (!this.scratchCanvas) {
      this.scratchCanvas = document.createElement('canvas');
      this.scratchCanvas.width = OW;
      this.scratchCanvas.height = OH;
    }
    return this.scratchCanvas;
  }

  private drawSplats(g: CanvasRenderingContext2D) {
    const DUR = 0.72;
    this.splats = this.splats.filter((s) => this.t - s.t < DUR);
    if (!this.splats.length) return;
    if (!this.splatCanvas) {
      this.splatCanvas = document.createElement('canvas');
      this.splatCanvas.width = OW;
      this.splatCanvas.height = OH;
    }
    const sc = this.splatCanvas;
    const h = sc.getContext('2d')!;
    for (const s of this.splats) {
      const e = this.t - s.t;
      let seed = s.seed;
      const r = (a: number, b: number) => {
        seed = (seed * 16807) % 2147483647;
        return a + ((seed - 1) / 2147483646) * (b - a);
      };
      const cx = OW / 2 + r(-110, 110);
      const cy = OH / 2 - 20 + r(-40, 30);
      const R = r(100, 125);
      // pop: overshoot then settle in ~3 frames
      const pop = e < 0.05 ? lerp(0.35, 1.08, e / 0.05) : lerp(1.08, 1, seg(e, 0.05, 0.12));
      const blobs: [number, number, number][] = [[cx, cy, R * 0.78 * pop]];
      const lobes = 9;
      for (let i = 0; i < lobes; i++) {
        const a = (i / lobes) * Math.PI * 2 + r(-0.3, 0.3);
        const d = R * r(0.55, 0.85) * pop;
        blobs.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.85, R * r(0.22, 0.42) * pop]);
      }
      const drops: [number, number, number][] = [];
      for (let i = 0; i < 16; i++) {
        const a = r(0, Math.PI * 2);
        const d = R * r(1.05, 1.9) * pop;
        drops.push([cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, r(3, 10)]);
      }
      const drips: [number, number, number, number][] = [];
      for (let i = 0; i < 7; i++) {
        const dx = r(-0.75, 0.75) * R;
        const len = r(50, 170) * easeOut(seg(e, 0.06, r(0.45, 0.75)));
        drips.push([cx + dx, cy + Math.sqrt(Math.max(0, 1 - (dx / R) ** 2)) * R * 0.62, r(7, 16), len]);
      }
      const shape = (grow: number) => {
        h.beginPath();
        for (const [x, y, rr] of blobs) {
          h.moveTo(x + rr + grow, y);
          h.arc(x, y, rr + grow, 0, Math.PI * 2);
        }
        for (const [x, y, rr] of drops) {
          h.moveTo(x + rr + grow, y);
          h.arc(x, y, rr + grow, 0, Math.PI * 2);
        }
        for (const [x, y, w, len] of drips) {
          h.rect(x - w / 2 - grow, y - 4, w + grow * 2, len + 4);
          h.moveTo(x + w * 0.7 + grow, y + len);
          h.arc(x, y + len, w * 0.7 + grow, 0, Math.PI * 2);
        }
        h.fill();
      };
      h.clearRect(0, 0, OW, OH);
      h.globalAlpha = 0.55;
      h.fillStyle = s.sheen; // thin rim light so a dark blob still reads on a dark frame
      shape(2);
      h.globalAlpha = 1;
      h.fillStyle = s.col;
      shape(0);
      // glossy highlights: a crescent on the upper-left, a hot dot, and a streak down each drip
      h.strokeStyle = s.sheen;
      h.lineCap = 'round';
      h.lineWidth = Math.max(4, R * 0.1);
      h.beginPath();
      h.arc(cx, cy, R * 0.58 * pop, Math.PI * 1.08, Math.PI * 1.42);
      h.stroke();
      h.lineWidth = 3;
      h.beginPath();
      h.arc(cx, cy, R * 0.46 * pop, Math.PI * 1.5, Math.PI * 1.62);
      h.stroke();
      h.fillStyle = '#ffffff';
      h.fillRect(Math.round(cx - R * 0.42), Math.round(cy - R * 0.42), 7, 7);
      h.fillStyle = s.sheen;
      for (const [x, y, w, len] of drips) if (len > 8) h.fillRect(Math.round(x - w * 0.25), Math.round(y + 6), 2, Math.round(len - 6));
      for (const [x, y, rr] of drops) if (rr > 6) h.fillRect(Math.round(x - rr * 0.4), Math.round(y - rr * 0.4), 2, 2);
      g.save();
      g.globalAlpha = 1 - seg(e, 0.22, DUR);
      g.drawImage(sc, 0, 0);
      g.restore();
    }
  }
}

function wrap(s: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of s.split(' ')) {
    if ((line + ' ' + w).trim().length > max) {
      out.push(line);
      line = w;
    } else line = (line + ' ' + w).trim();
  }
  if (line) out.push(line);
  return out;
}

export { easeBack, easeInOut, easeOut, seg, lerp, rand, clamp01, disposeTree };
