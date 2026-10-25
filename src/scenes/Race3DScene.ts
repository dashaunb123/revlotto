// The race in the semi-realistic 3D mode (settings.renderMode() === '3d'). The SAME sim loop as RaceScene (fixed
// step, input, autopilot, grades, finish -> game.finishRace, Mulligan rerun, leave flow) and the SAME Phaser HUD
// (tree, tach, popups, stamps, boss UI, tutorial, mute, gap arrows, splits, passive notes), but the world is
// three.js (render/three/race/world.ts), lazy-loaded and drawn on the shared canvas behind the transparent Phaser
// canvas. Any 3D failure (no WebGL2, a load/build error, context loss, a throw mid-race) falls back to the 2D
// 'Race' scene with the same setup. The 2D RaceScene is untouched.
import Phaser from 'phaser';
import type { GradeEvent, OpponentDef, RaceInput, RaceResult, RaceSetup, SlotId, Tier } from '../core/types';
import { CONTENT, partById } from '../data/content';
import { game } from '../game/game';
import { settings } from '../game/settings';
import { EngineSound, engineProfileFromParts, onMuteChange, sfx, unlockAudio } from '../render/audio';
import { carVisualForOpponent, carVisualFromParts } from '../render/car';
import { fxText, popup, stamp } from '../render/fx';
import { GAME_H, GAME_W, GRADE_COLOR, PAL, hex } from '../render/palette';
import { BossHud } from '../render/race/bossHud';
import { Confetti, LightTree, Tach } from '../render/race/hud';
import { parseColor } from '../render/race/pix';
import { GROUND_BOTTOM, PPM, type Track } from '../render/track';
import { panel, txt } from '../render/ui';
import { REAR_M, RaceSim, SIM_DT, TRACK_LENGTH, ghostV, ghostX } from '../sim/RaceSim';
import { goToPhase, runLook } from './nav';
import type { RaceWorld } from '../render/three/race/world';

// Preroll (before the sim and its 2 s tree start), as RaceScene: burnout behind the line, then creep into stage.
const PREROLL = 2.4;
const BURN_ON = 0.2;
const BURN_OFF = 1.35;
const BURN_FADE = 1.6;
// 3D roll-in: a creep into stage (~3.6 m/s peak over 1.5 m), not 2D's 64 px lunge (which reads as 41 km/h in 3D)
const ROLL_START = 1.45;
const ROLL_END = 2.1;
const PRESTAGE_AT = 1.9;
const STAGE_AT = 2.1;
const BURNOUT_BACK_M = 1.5;
/** The ghost runs its own (shorter) burnout and stages this much earlier than the player. */
const GHOST_LEAD = 0.2;

/** Burnout intensity 0..1 at preroll time t for a burnout window [on, off] with a fade to `fade`. */
function burnAt(t: number, on: number, off: number, fade: number) {
  return t < on ? 0 : t < on + 0.15 ? (t - on) / 0.15 : t < off ? 1 : t < fade ? 1 - (t - off) / (fade - off) : 0;
}
/** Offset (m, <= 0) behind the stage beam while creeping in over [r0, r1]. */
function rollAt(t: number, r0: number, r1: number) {
  const u = Phaser.Math.Clamp((t - r0) / (r1 - r0), 0, 1);
  return -BURNOUT_BACK_M * (1 - (0.5 - 0.5 * Math.cos(u * Math.PI)));
}
const FEET = 0.3048;

/** Set once 3D failed this session: later races go straight to 2D instead of retrying. */
let broken3D = false;

function partTier(parts: Partial<Record<SlotId, { partId: string }>>, slot: SlotId): Tier {
  const ip = parts[slot];
  if (!ip) return 'stock';
  try {
    return partById(ip.partId)?.tier ?? 'stock';
  } catch {
    return 'stock';
  }
}

type Phase = 'loading' | 'preroll' | 'live' | 'finishing' | 'done';
type InitData = { setup?: RaceSetup; autopilot?: (sim: RaceSim) => RaceInput | null };

export class Race3DScene extends Phaser.Scene {
  private data0: InitData = {};
  private setup!: RaceSetup;
  private autopilot: ((sim: RaceSim) => RaceInput | null) | null = null;
  private sim!: RaceSim;
  private opp!: OpponentDef;
  private world: RaceWorld | null = null;
  private gen = 0; // bumps on shutdown: a world that finishes loading late is thrown away
  private tree!: LightTree;
  private tach!: Tach;
  private engine: EngineSound | null = null;
  private hud!: Phaser.GameObjects.Layer;
  private flashRect!: Phaser.GameObjects.Rectangle;
  private loadingText?: Phaser.GameObjects.Text;

  private phase: Phase = 'loading';
  private prerollT = 0;
  private acc = 0;
  private gradesSeen = 0;
  private notesSeen = 0;
  private lastLights = 0;
  private wasLaunched = false;
  private wasNitro = false;
  private limiterT = 0;
  private limiterPopped = false;
  private limiterFlameT = 0;
  private streak = 0;
  private falseStart = false;
  private popupY = 0;
  private popupT = 0;
  private splitsShown = new Set<number>();
  private result: RaceResult | null = null;
  private tutorial = false;
  private tutText?: Phaser.GameObjects.Container;
  private tutStage = 0;
  private confetti!: Confetti;
  private boss!: BossHud;
  private muteOff: (() => void) | null = null;
  private lostOff: (() => void) | null = null;

  private tires: Tier = 'stock';
  private susp: Tier = 'stock';
  private boost: Tier = 'stock';
  /** Sport/pro exhaust or engine: flames on upshifts. */
  private loud = false;
  private smokeK = 1;

  private burn = 0;
  private prerollOff = 0; // m
  private rollV = 0; // m/s
  private staged = 0;
  private purges = 0;
  private launchGrade: GradeEvent['grade'] | null = null;
  private wheelieWait = -1;
  private screen = { x: 210, y: 200, vis: true };
  // render interpolation between 120 Hz sim steps
  private prevX = 0;
  private prevT = 0;
  private popupAt = 0; // popups are queued this far apart (ms) so they never land on top of each other
  private photoWait: { since: number; seen: boolean; done: () => void } | null = null;
  // the ghost's own preroll
  private gOff = -BURNOUT_BACK_M;
  private gRollV = 0;
  private gBurn = 0;

  private etText!: Phaser.GameObjects.Text;
  private gearText!: Phaser.GameObjects.Text;
  private speedText!: Phaser.GameObjects.Text;
  private nosText?: Phaser.GameObjects.Text;
  private progress!: Phaser.GameObjects.Graphics;
  private gapG!: Phaser.GameObjects.Graphics;
  private gapText!: Phaser.GameObjects.Text;
  private muteText!: Phaser.GameObjects.Text;

  constructor() {
    super('Race3D');
  }

  init(data: InitData) {
    this.autopilot = data?.autopilot ?? null;
    this.setup = data?.setup ?? game.startRace();
    this.data0 = { setup: this.setup, autopilot: data?.autopilot };
    this.phase = 'loading';
    this.prerollT = 0;
    this.acc = 0;
    this.gradesSeen = 0;
    this.notesSeen = 0;
    this.lastLights = 0;
    this.wasLaunched = false;
    this.wasNitro = false;
    this.limiterT = 0;
    this.limiterPopped = false;
    this.limiterFlameT = 0;
    this.streak = 0;
    this.falseStart = false;
    this.popupY = 0;
    this.popupT = 0;
    this.splitsShown = new Set();
    this.result = null;
    this.tutStage = 0;
    this.tutText = undefined;
    this.nosText = undefined;
    this.loadingText = undefined;
    this.burn = 0;
    this.prerollOff = -BURNOUT_BACK_M;
    this.gOff = -BURNOUT_BACK_M;
    this.gRollV = this.gBurn = this.prevX = this.prevT = this.popupAt = 0;
    this.photoWait = null;
    this.rollV = 0;
    this.staged = 0;
    this.purges = 0;
    this.launchGrade = null;
    this.wheelieWait = -1;
    this.world = null;
  }

  create() {
    if (broken3D) return this.fallback(null);
    this.sim = new RaceSim(this.setup);
    this.opp = game.currentOpponent();
    const bdef = this.setup.boss ? CONTENT.bosses.find((b) => b.id === this.setup.boss?.id) : undefined;
    if (bdef) this.opp = { ...this.opp, name: bdef.name, car: bdef.car, taunt: bdef.taunt, race: 3 };
    this.tutorial = game.state.history.length === 0 && !this.setup.boss;
    const parts = game.state.parts;
    this.tires = partTier(parts, 'tires');
    this.susp = partTier(parts, 'suspension');
    this.boost = partTier(parts, 'forced_induction');
    const rank = (t: Tier) => ['stock', 'street', 'sport', 'pro'].indexOf(t);
    this.loud = rank(partTier(parts, 'exhaust')) >= 2 || rank(partTier(parts, 'engine')) >= 2;
    const tyreK = this.tires === 'pro' ? 1.3 : this.tires === 'sport' ? 1.2 : this.tires === 'street' ? 1.1 : 0.9;
    this.smokeK = Phaser.Math.Clamp(Math.pow(this.setup.stats.power / 200, 0.55) * tyreK, 0.8, 2.1);

    // ---- HUD (identical to RaceScene; the world flash sits under it) ----
    this.hud = this.add.layer();
    this.flashRect = this.add.rectangle(0, 0, GAME_W, GAME_H, 0xffffff, 1).setOrigin(0, 0).setAlpha(0);
    this.hud.add(this.flashRect);
    this.buildHud();
    this.confetti = new Confetti(this, this.hud);
    // Oil is drawn in 3D (hazards.ts); the HUD only needs the shim for its constructor.
    const trackShim = { oilPatch() {} } as unknown as Track;
    this.boss = new BossHud(this, this.sim, this.hud, trackShim, this.tach, 0, { gustStreaks: false }); // 3D draws the gust
    this.boss.bindTach(this.tach);
    this.hud.setVisible(false);
    this.loadingText = fxText(this, 320, 180, 'LOADING', 8, PAL.inkDim, 3);

    // ---- input ----
    const kb = this.input.keyboard!;
    kb.addCapture('SPACE');
    kb.on('keydown-SPACE', (e: KeyboardEvent) => !e.repeat && this.press('go'));
    kb.on('keydown-N', (e: KeyboardEvent) => !e.repeat && this.press('nitro'));
    this.input.on('pointerdown', () => this.press('go'));
    this.muteOff = onMuteChange((m) => this.showMute(m));
    unlockAudio();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.gen++;
      this.engine?.stop();
      this.engine = null;
      this.muteOff?.();
      this.muteOff = null;
      this.lostOff?.();
      this.lostOff = null;
      this.world?.park(); // kept (parked) for the next race / rerun: no rebuild, no recompile
      this.world = null;
      if (import.meta.env.DEV) (window as unknown as { __race3d?: unknown }).__race3d = undefined;
    });

    // ---- the 3D world (lazy) ----
    const gen = this.gen;
    const t0 = performance.now();
    import('../render/three/race/world')
      .then((m) =>
        m.acquireRaceWorld(this.game, {
          sim: this.sim,
          player: carVisualFromParts(game.state.parts, runLook()),
          ghost: carVisualForOpponent(this.opp),
          quality: settings.get().quality,
          smokeK: this.smokeK,
          tyres: this.tires,
          raceNo: game.state.history.length + 1,
          wheelieBar: this.susp === 'pro',
          boss: this.opp.race === 3,
          ghostName: this.opp.name,
        }),
      )
      .then((w) => {
        if (gen !== this.gen) return; // left while loading: the world stays parked for the next race
        this.onReady(w, performance.now() - t0);
      })
      .catch((e) => gen === this.gen && this.fallback(e));
  }

  private onReady(w: RaceWorld, loadMs: number) {
    this.world = w;
    console.info(`[3d] race world ready in ${Math.round(loadMs)} ms ${JSON.stringify(w.loadTimes)}`);
    w.show();
    this.lostOff = w.onLost(() => this.fallback(new Error('WebGL context lost')));
    this.loadingText?.destroy();
    this.loadingText = undefined;
    this.hud.setVisible(true);
    this.cameras.main.fadeIn(200, 11, 10, 20);
    this.engine = new EngineSound(engineProfileFromParts(game.state.parts));
    this.phase = 'preroll';
    if (this.tutorial) this.showTutorial('PRESS SPACE WHEN THE LIGHT TURNS GREEN', 'DONT JUMP EARLY: FALSE START = +0.3S');
    if (import.meta.env.DEV) (window as unknown as { __race3d?: unknown }).__race3d = this;
  }

  /** 3D can't run (or broke): log it and race this same setup in the 2D scene. */
  private fallback(e: unknown) {
    if (e) console.error('[3d] race falling back to 2D', e);
    broken3D = true;
    // free whatever 3D got built (later races in this session go straight to 2D)
    import('../render/three/race/world').then((m) => m.disposeRaceWorld()).catch(() => {});
    if (this.result) {
      // already finished: just drop the 3D world and let the HUD's leave flow run
      this.world = null;
      return;
    }
    this.world = null;
    this.scene.start('Race', this.data0);
  }

  // ------------------------------------------------------------------ HUD (as RaceScene)

  private buildHud() {
    const h = this.hud;
    this.tree = new LightTree(this, h, 8, 8);
    const etBox = panel(this, 222, 6, 196, 46, PAL.panel, PAL.panelEdge);
    h.add(etBox);
    h.add(txt(this, 232, 12, 'ET', 8, PAL.inkDim));
    this.etText = fxText(this, 320, 26, '0.000', 24, PAL.ink, 4);
    h.add(this.etText);
    this.progress = this.add.graphics();
    h.add(this.progress);

    const name = this.opp.name.length > 20 ? this.opp.name.slice(0, 19) + '.' : this.opp.name;
    h.add(txt(this, 632, 8, name, 8, PAL.ink, [1, 0]));
    h.add(txt(this, 632, 20, 'TARGET', 8, PAL.inkDim, [1, 0]));
    h.add(fxText(this, 632, 40, this.setup.targetEt.toFixed(3), 16, PAL.yellow, 3).setOrigin(1, 0.5));
    if (this.opp.race === 3) h.add(txt(this, 632, 54, 'BOSS', 8, PAL.red, [1, 0]));

    const g = this.add.graphics();
    g.fillStyle(PAL.bgDeep, 1).fillRect(0, GROUND_BOTTOM, GAME_W, GAME_H - GROUND_BOTTOM);
    g.fillStyle(PAL.panelEdge, 1).fillRect(0, GROUND_BOTTOM, GAME_W, 2);
    g.fillStyle(PAL.panel, 1).fillRect(0, GROUND_BOTTOM + 2, GAME_W, GAME_H - GROUND_BOTTOM - 2);
    g.fillStyle(PAL.panelLight, 1).fillRect(6, 306, 56, 48);
    h.add(g);
    h.add(txt(this, 34, 309, 'GEAR', 8, PAL.inkDim, [0.5, 0]));
    this.gearText = fxText(this, 34, 336, '1', 24, PAL.ink, 4);
    h.add(this.gearText);
    this.tach = new Tach(this, h, 76, 318, 408, 20);
    h.add(txt(this, 632, 306, 'KM/H', 8, PAL.inkDim, [1, 0]));
    this.speedText = fxText(this, 632, 328, '0', 24, PAL.ink, 4).setOrigin(1, 0.5);
    h.add(this.speedText);
    if (this.sim.state.nitroAvailable) {
      this.nosText = txt(this, 632, 344, 'NOS [N]', 8, PAL.blue, [1, 0]);
      h.add(this.nosText);
    }
    this.gapG = this.add.graphics();
    this.gapText = fxText(this, 0, 0, '', 8, PAL.ink, 3);
    h.add([this.gapG, this.gapText]);
    this.muteText = fxText(this, 320, 290, '', 8, PAL.inkDim, 3).setAlpha(0);
    h.add(this.muteText);
  }

  private drawProgress() {
    const g = this.progress;
    g.clear();
    const x0 = 232,
      x1 = 408,
      y = 44;
    g.fillStyle(0x15121f, 1).fillRect(x0, y - 2, x1 - x0, 4);
    for (let i = 0; i < 4; i++) {
      g.fillStyle(i % 2 ? 0xffffff : 0x101010, 1).fillRect(x1, y - 4 + i * 2, 2, 2);
      g.fillStyle(i % 2 ? 0x101010 : 0xffffff, 1).fillRect(x1 + 2, y - 4 + i * 2, 2, 2);
    }
    const s = this.sim.state;
    this.boss.progressMarks(g, x0, x1, y);
    const px = x0 + Math.min(1, s.x / TRACK_LENGTH) * (x1 - x0);
    const gx = x0 + Math.min(1, this.ghostMeters() / TRACK_LENGTH) * (x1 - x0);
    g.fillStyle(parseColor(this.opp.car.color), 1).fillRect(Math.round(gx) - 2, y - 5, 5, 5);
    g.fillStyle(PAL.bgDeep, 1).fillRect(Math.round(gx) - 2, y, 5, 1);
    g.fillStyle(PAL.red, 1).fillRect(Math.round(px) - 2, y, 5, 5);
    g.fillStyle(0xffffff, 1).fillRect(Math.round(px) - 2, y, 5, 1);
  }

  private showMute(m: boolean) {
    this.muteText.setText(m ? 'SOUND OFF  [M]' : 'SOUND ON  [M]').setAlpha(1);
    this.tweens.killTweensOf(this.muteText);
    this.tweens.add({ targets: this.muteText, alpha: 0, delay: 900, duration: 300 });
  }

  private showTutorial(a: string, b: string) {
    this.tutText?.destroy();
    const c = this.add.container(320, 92);
    const bg = this.add.rectangle(0, 0, 400, 34, PAL.bgDeep, 0.85).setStrokeStyle(2, PAL.yellow);
    c.add([bg, fxText(this, 0, -7, a, 8, PAL.yellow, 0), fxText(this, 0, 7, b, 8, PAL.ink, 0)]);
    this.hud.add(c);
    c.setScale(0.6).setAlpha(0);
    this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 200, ease: 'Back.easeOut' });
    this.tutText = c;
  }

  private hideTutorial() {
    const c = this.tutText;
    if (!c) return;
    this.tutText = undefined;
    this.tweens.add({ targets: c, alpha: 0, y: c.y - 10, duration: 250, onComplete: () => c.destroy() });
  }

  /** 2D's world-camera shake: the 3D camera shakes (the director's trauma). */
  private worldShake(ms: number, amp: number) {
    this.world?.emit({ kind: 'shake', ms, amp });
  }

  /** 2D's world-camera flash: a full-screen flash under the HUD. */
  private worldFlash(ms: number, color: number, alpha: number) {
    this.tweens.killTweensOf(this.flashRect);
    this.flashRect.setFillStyle(color, 1).setAlpha(alpha);
    this.tweens.add({ targets: this.flashRect, alpha: 0, duration: ms });
  }

  // ------------------------------------------------------------------ input

  private press(action: 'go' | 'nitro') {
    unlockAudio();
    if (this.phase === 'done' || this.phase === 'finishing' || this.phase === 'preroll' || this.phase === 'loading') return;
    const e = this.sim.input(action);
    if (e) this.processGrades();
  }

  // ------------------------------------------------------------------ loop

  update(_time: number, deltaMs: number) {
    if (this.phase === 'loading' || !this.sim) return;
    const dt = Math.min(deltaMs, 100);
    const s = this.sim.state;
    try {
      if (this.phase === 'preroll') this.updatePreroll(dt / 1000);
      else if (this.phase !== 'done' || s.v > 0.05) {
        this.acc += (dt / 1000) * (this.world?.slowmo() ?? 1);
        let steps = 0;
        while (this.acc >= SIM_DT && steps < 40) {
          if (this.autopilot && this.phase === 'live') {
            const act = this.autopilot(this.sim);
            if (act) this.sim.input(act);
          }
          this.prevX = s.x;
          this.prevT = s.t;
          this.sim.step();
          this.acc -= SIM_DT;
          steps++;
          this.afterStep();
        }
      }
      this.renderFrame(dt);
      this.updatePhotoWait();
    } catch (e) {
      if (!this.world) throw e;
      this.fallback(e);
    }
  }

  private updatePreroll(dts: number) {
    const t0 = this.prerollT;
    const t = (this.prerollT += dts);
    const crossed = (at: number) => t0 < at && t >= at;
    this.burn = burnAt(t, BURN_ON, BURN_OFF, BURN_FADE);
    if (crossed(BURN_ON)) {
      sfx.backfire();
      this.world?.emit({ kind: 'burnout' });
      this.world?.emit({ kind: 'flame', who: 'player', ms: 160 });
    }
    const off = rollAt(t, ROLL_START, ROLL_END);
    this.rollV = dts > 0 ? (off - this.prerollOff) / dts : 0;
    this.prerollOff = off;
    // the ghost: a shorter burnout a beat later, then it creeps in and stages GHOST_LEAD s ahead of the player
    this.gBurn = burnAt(t, BURN_ON + 0.15, BURN_OFF - 0.2, BURN_FADE - 0.2) * 0.85;
    if (crossed(BURN_ON + 0.15)) this.world?.emit({ kind: 'flame', who: 'ghost', ms: 140 });
    const goff = rollAt(t, ROLL_START - GHOST_LEAD, ROLL_END - GHOST_LEAD);
    this.gRollV = dts > 0 ? (goff - this.gOff) / dts : 0;
    this.gOff = goff;
    this.staged = t >= STAGE_AT ? 2 : t >= PRESTAGE_AT ? 1 : 0;
    if (crossed(PRESTAGE_AT) || crossed(STAGE_AT)) sfx.tick();
    if (crossed(STAGE_AT)) this.world?.emit({ kind: 'staged' });
    this.tree.set(0, this.staged, false);
    if (crossed(2.2)) this.nitroPurge();
    if (t >= PREROLL) {
      this.phase = 'live';
      this.prerollOff = this.gOff = 0;
      this.rollV = this.gRollV = this.gBurn = 0;
      this.staged = 2;
      this.prevX = this.sim.state.x;
      this.prevT = this.sim.state.t;
    }
  }

  private nitroPurge() {
    if (!this.sim.state.nitroAvailable) return;
    this.purges++;
    sfx.nitro();
    this.world?.emit({ kind: 'purge' });
  }

  private afterStep() {
    const s = this.sim.state;
    if (s.lights !== this.lastLights) {
      this.lastLights = s.lights;
      if (s.lights >= 1 && s.lights <= 3) {
        sfx.amber();
        this.world?.emit({ kind: 'amber', n: s.lights });
      }
      if (s.lights === 4 && !this.falseStart) {
        sfx.green();
        this.world?.emit({ kind: 'green' });
      }
    }
    if (s.grades.length > this.gradesSeen) this.processGrades();
    if (this.sim.ctx.notes.length > this.notesSeen) {
      for (let i = this.notesSeen; i < this.sim.ctx.notes.length; i++) this.passiveNote(this.sim.ctx.notes[i], i - this.notesSeen);
      this.notesSeen = this.sim.ctx.notes.length;
    }
    if (s.launched && !this.wasLaunched) this.onLaunch();
    if (this.wheelieWait >= 0 && this.wheelieWait-- === 0) this.startWheelie();
    if (s.phase === 'tree' && s.t >= -1.75 && this.purges === 1) this.nitroPurge();
    if (s.nitroActive && !this.wasNitro) this.onNitro();
    if (!s.nitroActive && this.wasNitro) this.onNitroEnd();
    this.wasNitro = s.nitroActive;

    if (s.limiter) {
      this.limiterT += SIM_DT;
      this.limiterFlameT -= SIM_DT;
      if (this.limiterFlameT <= 0) {
        this.limiterFlameT = 0.13;
        this.world?.emit({ kind: 'flame', who: 'player', ms: 90 });
        this.world?.emit({ kind: 'backfire' });
        sfx.backfire();
      }
      if (this.limiterT > 0.15 && !this.limiterPopped) {
        this.limiterPopped = true;
        this.carPopup('LIMITER', PAL.red, 16, 'SHIFT!');
        this.world?.emit({ kind: 'limiter' });
        this.worldShake(120, 0.003);
      }
    } else {
      this.limiterT = 0;
      this.limiterPopped = false;
    }

    const splits: [number, string][] = [
      [60 * FEET, '60FT'],
      [330 * FEET, '330FT'],
      [660 * FEET, '1/8'],
      [1000 * FEET, '1000FT'],
    ];
    for (const [m, label] of splits) {
      if (s.x >= m && !this.splitsShown.has(m) && s.phase === 'running') {
        this.splitsShown.add(m);
        const t = s.t + s.penalty;
        // left column with the passive notes, below the tutorial box while it shows
        const c = popup(this, this.hud, 150, this.tutText ? 186 : this.boss.splitY + 30, `${label} ${t.toFixed(3)}`, PAL.ink, 8, { rise: 8, hold: 700 });
        c.setDepth(1);
      }
    }

    if (s.phase === 'finished' && this.phase === 'live') this.onFinish();
  }

  private processGrades() {
    const s = this.sim.state;
    for (let i = this.gradesSeen; i < s.grades.length; i++) this.onGrade(s.grades[i]);
    this.gradesSeen = s.grades.length;
  }

  private carPopup(text: string, color: number, size: 8 | 16 | 24 = 16, sub?: string) {
    // queued ~350 ms apart (NITROUS! never lands on PERFECT!), on the outer side of the car, clear of the top HUD,
    // the tutorial box and the vanishing point
    const now = this.time.now;
    const at = Math.max(now, this.popupAt);
    this.popupAt = at + 350;
    const show = () => {
      const t = this.time.now;
      if (t - this.popupT < 1200) this.popupY -= 46; // a popup lives ~1.1 s: stack until it has gone
      else this.popupY = 0;
      this.popupT = t;
      const m = size === 24 ? 150 : size === 16 ? 110 : 80;
      const top = this.tutText ? 150 : 112;
      const y0 = this.screen.vis ? Phaser.Math.Clamp(this.screen.y - 34, 128, 196) : 196;
      const y = Math.max(top, y0 + Math.max(-92, this.popupY));
      popup(this, this.hud, Phaser.Math.Clamp(this.screen.x + 80, m, GAME_W - m), y, text, color, size, { sub });
    };
    if (at <= now) show();
    else this.time.delayedCall(at - now, show);
  }

  private onGrade(e: GradeEvent) {
    const color = GRADE_COLOR[e.grade];
    if (e.grade === 'perfect') this.streak++;
    else if (e.kind !== 'nitro') this.streak = 0;
    const streakSub = this.streak >= 2 ? `STREAK x${this.streak}` : undefined;
    switch (e.kind) {
      case 'false_start':
        this.falseStart = true;
        this.carPopup('FALSE START', PAL.red, 16, '+0.300 S');
        this.tree.set(this.sim.state.lights, 2, true);
        sfx.redLight();
        this.world?.emit({ kind: 'falseStart' });
        this.worldShake(200, 0.006);
        break;
      case 'launch': {
        this.launchGrade = e.grade;
        const rt = (e.offsetMs ?? 0) / 1000;
        const label = e.label === 'ASLEEP' ? 'ASLEEP!' : e.grade === 'perfect' ? 'PERFECT!' : e.grade === 'good' ? 'GOOD' : 'MISS';
        this.carPopup(label, color, e.grade === 'perfect' ? 24 : 16, `R/T ${rt.toFixed(3)}`);
        if (e.grade === 'perfect') sfx.perfect();
        else if (e.grade === 'miss') sfx.miss();
        break;
      }
      case 'shift': {
        let label = e.grade === 'perfect' ? 'PERFECT!' : e.grade === 'good' ? 'GOOD' : 'MISS';
        if (e.label === 'LIMITER') label = 'LIMITER';
        if (e.label === 'OIL') {
          this.carPopup('OIL SPIN!', PAL.red, 16, 'SHIFTED ON OIL');
          this.world?.emit({ kind: 'oil' });
          this.worldShake(260, 0.007);
          this.onShift(e);
          break;
        }
        const sub = e.grade === 'perfect' ? streakSub : e.label && e.label !== 'PERFECT' && e.label !== 'LIMITER' ? e.label : undefined;
        this.carPopup(label, color, e.grade === 'perfect' ? 24 : 16, sub);
        this.onShift(e);
        break;
      }
      case 'nitro':
        this.carPopup('NITROUS!', 0x6fb4ff, 24, e.grade === 'miss' ? 'WHEELSPIN' : undefined);
        break;
    }
  }

  private onLaunch() {
    this.wasLaunched = true;
    this.world?.emit({ kind: 'launch', grade: this.launchGrade ?? 'good' });
    this.world?.emit({ kind: 'flame', who: 'player', ms: 200 });
    this.worldShake(220, 0.008);
    this.cameras.main.shake(140, 0.003);
    this.wheelieWait = 4;
    if (this.tutorial) {
      this.tutStage = 1;
      this.showTutorial('SPACE TO SHIFT WHEN THE NEEDLE', 'HITS THE GREEN BAND ON THE TACH');
    }
  }

  /**
   * Launch attitude in 3D (2D keeps its own): only a real oil spin cancels it (the sim's wheelspin flag also means
   * "traction-limited", i.e. hooked hard). The wheelie kick scales with power: none on a stock car (its nose pops
   * on the springs instead), small on street builds, big on pro ones; the sustained lift comes from acceleration.
   */
  private startWheelie() {
    if (this.sim.hzs.spin > 0 || !this.launchGrade || this.launchGrade === 'miss') return;
    let amp = Phaser.Math.Clamp((this.setup.stats.power - 260) / 70, 0, 7);
    if (this.launchGrade === 'good') amp *= 0.35;
    if (amp < 0.5) this.world?.popNose(this.launchGrade === 'perfect' ? 1 : 0.5);
    else this.world?.startWheelie(amp, this.launchGrade === 'perfect');
  }

  private onShift(e: GradeEvent) {
    sfx.shift();
    this.engine?.shift(e.grade);
    this.world?.emit({ kind: 'shift', grade: e.grade, gear: e.gear });
    // flames on an upshift need a loud build (sport/pro exhaust or engine), or a missed / limiter shift; an
    // economy car just puffs
    if (this.loud || e.grade === 'miss' || e.label === 'LIMITER') this.world?.emit({ kind: 'flame', who: 'player', ms: e.grade === 'perfect' ? 220 : 150 });
    else this.world?.emit({ kind: 'exhaustPuff', who: 'player', n2: 3 });
    if (e.grade !== 'perfect') {
      sfx.backfire();
      this.world?.emit({ kind: 'backfire' });
    }
    this.world?.emit({ kind: 'exhaustPuff', n2: 4 });
    if (e.grade === 'perfect') {
      this.world?.emit({ kind: 'sparks', n2: 8 });
      this.worldShake(90, 0.003);
    }
    if (this.boost !== 'stock') {
      this.world?.emit({ kind: 'flutter' });
      this.time.delayedCall(80, () => this.world?.emit({ kind: 'flutter' }));
    }
    this.gearText.setScale(1.6);
    this.tweens.add({ targets: this.gearText, scale: 1, duration: 220, ease: 'Back.easeOut' });
    if (this.tutorial && this.tutStage === 1 && (e.gear ?? 1) >= 2) {
      this.tutStage = 2;
      this.hideTutorial();
    }
  }

  private onNitro() {
    sfx.nitro();
    this.world?.emit({ kind: 'nitro' });
    this.worldShake(500, 0.005);
    if (this.nosText) this.nosText.setText('NOS!!!').setColor(hex(0x9cd8ff));
  }

  private onNitroEnd() {
    this.world?.emit({ kind: 'nitroEnd' });
    if (this.nosText) this.nosText.setText('NOS EMPTY').setColor(hex(PAL.inkDim));
  }

  private passiveNote(note: string, k: number) {
    // left column: car popups live on the right of the car, so the two never share space
    const c = popup(this, this.hud, 150, (this.tutText ? 150 : 118) + k * 14, note, PAL.pink, 8, { rise: 14, hold: 1100 });
    c.setDepth(2);
  }

  // ------------------------------------------------------------------ finish (as RaceScene)

  private onFinish() {
    this.phase = 'finishing';
    this.result = this.sim.result();
    const r = this.result;
    const outcome = game.finishRace(r);
    this.hideTutorial();

    // the finish slow-mo is the camera director's (a short punch, or a long one on a photo finish)
    this.engine?.set(0.4, 0, false);

    const dnf = (r as RaceResult & { dnf?: string }).dnf;
    const close = !dnf && Math.abs(r.margin) < 0.1;
    this.world?.emit({ kind: 'finish', won: r.won, margin: r.margin, dnf: dnf ?? null, close });
    if (close) this.world?.emit({ kind: 'photoFinish' });
    const word = r.won ? 'WIN!' : dnf ?? 'LOSE';
    const col = r.won ? PAL.green : PAL.red;
    // the verdict: stamp, result lines, flash, then the leave (or the Mulligan rerun)
    const verdict = () => {
      stamp(this, this.hud, 320, 140, word, col, 32);
      this.time.delayedCall(120, () => {
        if (r.won) {
          sfx.win();
          this.confetti.burst(1800);
          this.worldFlash(220, 0xfff0d0, 0.38); // a warm pop, not a white-out (the crowd + exposure do the rest)
        } else {
          sfx.lose();
          this.worldFlash(220, 0xe8413c, 0.25);
        }
        this.worldShake(260, 0.01);
        this.cameras.main.shake(200, 0.006);
      });
      const sign = r.margin >= 0 ? '-' : '+';
      const line = dnf ? `DNF  vs  ${r.targetEt.toFixed(3)}` : `${r.et.toFixed(3)}  vs  ${r.targetEt.toFixed(3)}`;
      popup(this, this.hud, 320, 182, line, PAL.ink, 16, { rise: 0, hold: 99999 });
      popup(this, this.hud, 320, 202, dnf ? 'ONE MISS WAS ALL IT TOOK' : `${sign}${Math.abs(r.margin).toFixed(3)} S`, col, 8, { rise: 0, hold: 99999 });
      const extra = close ? 400 : 0; // a photo finish lets the verdict sink in a little longer
      if (outcome.next === 'race') {
        this.time.delayedCall(1440 + extra, () => {
          stamp(this, this.hud, 320, 250, 'MULLIGAN! RERUN', PAL.purple, 24);
          sfx.slam();
        });
        this.time.delayedCall(3040 + extra, () => this.leave(true));
      } else this.time.delayedCall(2340 + extra, () => this.leave(false));
    };
    if (close) {
      // photo first, then the verdict: only PHOTO FINISH! while the camera holds the line, the result once it cuts away.
      // y 168 sits over the centre wall in the line-scan shot, between the far car (top) and the near car (bottom).
      const ph = popup(this, this.hud, 320, 168, 'PHOTO FINISH!', PAL.yellow, 16, { rise: 0, hold: 99999 });
      this.photoWait = {
        since: this.time.now,
        seen: false,
        done: () => {
          this.tweens.add({ targets: ph, alpha: 0, duration: 200, onComplete: () => ph.destroy() });
          verdict();
        },
      };
    } else this.time.delayedCall(260, verdict);
  }

  /** While a photo finish plays: wait for the director's photo shot to end (or a safety timeout), then the verdict. */
  private updatePhotoWait() {
    const pw = this.photoWait;
    if (!pw) return;
    const shot = this.world?.director.shot;
    if (shot === 'finish_photo') pw.seen = true;
    const age = this.time.now - pw.since;
    if ((pw.seen && shot !== 'finish_photo') || (!pw.seen && age > 450) || age > 3200 || !this.world) {
      this.photoWait = null;
      pw.done();
    }
  }

  private leave(rerun: boolean) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.engine?.stop();
    this.engine = null;
    if (rerun) {
      this.cameras.main.fadeOut(150, 11, 10, 20);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({}));
    } else goToPhase(this, 150);
  }

  // ------------------------------------------------------------------ render

  private ghostMeters(at = this.sim.state.t): number {
    const t = Math.max(0, at);
    const te = this.setup.targetEt;
    if (t <= te) return ghostX(t, te);
    const vEnd = ghostV(te, te);
    const dt = t - te;
    const decel = 9;
    const tStop = vEnd / decel;
    const d = Math.min(dt, tStop);
    return TRACK_LENGTH + vEnd * d - 0.5 * decel * d * d;
  }

  private ghostSpeed(t = this.sim.state.t): number {
    const te = this.setup.targetEt;
    let gv = t > 0 ? ghostV(Math.min(t, te), te) : 0;
    if (t > te) gv = Math.max(0, gv - 9 * (t - te));
    return gv;
  }

  private renderFrame(dt: number) {
    const s = this.sim.state;
    const w = this.world;
    if (this.phase !== 'preroll') this.tree.set(s.lights, 2, this.falseStart, this.sim.hzs.decoy);

    if (w) {
      // render between the last two sim steps (the 120 Hz sim never lines up with the display: no stutter, no
      // slideshow in slow-mo); the ghost follows the same interpolated clock
      const live = this.phase !== 'preroll' && this.phase !== 'loading';
      const alpha = live ? Phaser.Math.Clamp(this.acc / SIM_DT, 0, 1) : 1;
      const xR = live ? this.prevX + (s.x - this.prevX) * alpha : s.x;
      const tR = live ? this.prevT + (s.t - this.prevT) * alpha : s.t;
      w.frame({
        realDt: dt / 1000,
        phase: this.phase === 'loading' ? 'preroll' : this.phase,
        prerollT: this.prerollT,
        prerollOff: this.prerollOff,
        rollV: this.rollV,
        burn: this.burn,
        ghostX: this.ghostMeters(tR),
        ghostV: this.ghostSpeed(tR),
        x: xR,
        ghostOff: this.gOff,
        ghostRollV: this.gRollV,
        ghostBurn: this.gBurn,
        ghostStaged: this.phase === 'preroll' ? (this.prerollT >= STAGE_AT - GHOST_LEAD ? 2 : this.prerollT >= PRESTAGE_AT - GHOST_LEAD ? 1 : 0) : 2,
        staged: this.staged,
        falseStart: this.falseStart,
        margin: this.result?.margin,
        dnf: (this.result as (RaceResult & { dnf?: string }) | null)?.dnf ?? null,
      });
      w.playerScreen(this.screen);
    }

    // HUD numbers
    const etShown = s.et ?? (s.t > 0 ? s.t + s.penalty : 0);
    this.etText.setText(this.sim.hzs.dnf ? 'DNF' : etShown.toFixed(3));
    if (s.et !== null && this.result) this.etText.setColor(hex(this.result.won ? PAL.green : PAL.red));
    this.gearText.setText(String(s.gear));
    this.speedText.setText(String(Math.round((this.world ? this.world.displaySpeed() : s.v) * 3.6)));
    this.tach.update(s.rpm, s.shiftWindow, s.limiter, s.launched && s.gear < 4 && s.phase === 'running', dt, this.boss.tachOpts());
    this.boss.update(dt, Phaser.Math.Clamp(this.screen.x, 0, GAME_W), this.oilCamX());
    this.drawProgress();
    this.drawGap();

    if (this.engine) {
      let throttle = s.phase === 'running' && s.launched ? 1 : s.lights > 0 ? 0.5 : 0.1;
      let rpm = s.rpm;
      if (this.phase === 'preroll') {
        rpm = Math.max(rpm, 0.2 + this.burn * (0.62 + Math.sin(this.time.now / 70) * 0.04));
        throttle = Math.max(throttle, this.burn);
      }
      this.engine.set(rpm, throttle, s.limiter, s.nitroActive);
      this.engine.setSqueal(this.burn > 0 ? this.burn * 0.9 : s.wheelspin && s.phase === 'running' ? 0.7 : 0);
    }
  }

  /**
   * BossHud's off-screen oil arrow works in 2D px (patch x * PPM + shift - camX > 640). Feed it a camX that puts
   * the next patch's near edge at its projected 3D screen x, so the arrow shows exactly when the patch is off-screen.
   */
  private oilCamX(): number {
    const hz = this.sim.hz;
    const w = this.world;
    if (!hz.oil.length || !w) return 0;
    const rear = this.sim.state.x - REAR_M;
    const next = hz.oil.find((o) => o.b > rear);
    if (!next) return 0;
    const sx = w.laneScreenX(next.a + REAR_M - w.wheelbaseM);
    return next.a * PPM + REAR_M * PPM - (Number.isFinite(sx) ? sx : 9999);
  }

  /** Off-screen gap arrows, as 2D, from the ghost's projected position. */
  private drawGap() {
    const g = this.gapG;
    g.clear();
    const s = this.sim.state;
    if (s.t <= 0.2 || this.phase === 'done' || !this.world) {
      this.gapText.setText('');
      return;
    }
    const gap = this.ghostMeters() - s.x;
    const gs = this.world.ghostScreen();
    const y = 208;
    if (!gs.vis && gap > 1) {
      g.fillStyle(PAL.bgDeep, 0.8).fillRect(GAME_W - 86, y - 10, 80, 20);
      g.fillStyle(PAL.red, 1).fillTriangle(GAME_W - 4, y, GAME_W - 14, y - 8, GAME_W - 14, y + 8);
      this.gapText.setPosition(GAME_W - 50, y).setText(`+${gap.toFixed(1)}M`).setColor(hex(PAL.red));
    } else if (!gs.vis && gap < -1) {
      g.fillStyle(PAL.bgDeep, 0.8).fillRect(6, y - 10, 80, 20);
      g.fillStyle(PAL.green, 1).fillTriangle(4, y, 14, y - 8, 14, y + 8);
      this.gapText.setPosition(52, y).setText(`${gap.toFixed(1)}M`).setColor(hex(PAL.green));
    } else this.gapText.setText('');
  }
}
