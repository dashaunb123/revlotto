// The race: light tree, fixed-step sim, side-view strip, tach, ghost opponent.
// Handoff: Staging calls game.startRace() and starts this scene with { setup }. If started without
// data (Mulligan rerun, reload mid-race), we call game.startRace() ourselves: in phase 'race' it
// recomputes the setup without consuming anything.
import Phaser from 'phaser';
import type { GradeEvent, OpponentDef, RaceInput, RaceResult, RaceSetup } from '../core/types';
import { game } from '../game/game';
import { EngineSound, sfx, toggleMute, unlockAudio } from '../render/audio';
import { CarSprite, carVisualForOpponent, carVisualFromParts, makeCar } from '../render/car';
import { RaceFx, SpeedLines, fxText, popup, stamp } from '../render/fx';
import { GAME_H, GAME_W, GRADE_COLOR, PAL, hex } from '../render/palette';
import { LightTree, Tach } from '../render/race/hud';
import { parseColor } from '../render/race/pix';
import { GROUND_BOTTOM, LANE_FAR_Y, LANE_NEAR_Y, PPM, Track } from '../render/track';
import { panel, txt } from '../render/ui';
import { RaceSim, SIM_DT, TRACK_LENGTH, ghostV, ghostX } from '../sim/RaceSim';
import { goToPhase } from './nav';

const CAR_SCALE = 2;
const PLAYER_SCREEN_X = 210; // where the camera keeps the player's car centre
const PREROLL = 1.1; // seconds of staging bulbs before the sim (and its 2 s tree) starts
const FEET = 0.3048;

type Phase = 'preroll' | 'live' | 'finishing' | 'done';

export class RaceScene extends Phaser.Scene {
  private setup!: RaceSetup;
  /** Optional input policy (attract mode / dev preview): called before every sim step. */
  private autopilot: ((sim: RaceSim) => RaceInput | null) | null = null;
  private sim!: RaceSim;
  private opp!: OpponentDef;
  private track!: Track;
  private fx!: RaceFx;
  private speedLines!: SpeedLines;
  private player!: CarSprite;
  private ghost!: CarSprite;
  private tree!: LightTree;
  private tach!: Tach;
  private engine: EngineSound | null = null;
  private hud!: Phaser.GameObjects.Layer;
  private world!: Phaser.GameObjects.Layer;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;

  private phase: Phase = 'preroll';
  private prerollT = 0;
  private acc = 0;
  private simSpeed = 1;
  private gradesSeen = 0;
  private notesSeen = 0;
  private lastLights = 0;
  private wasLaunched = false;
  private wasNitro = false;
  private limiterT = 0;
  private limiterPopped = false;
  private limiterFlameT = 0;
  private pitch = 0;
  private pitchVel = 0;
  private camX = 0;
  private lookAhead = 0;
  private streak = 0;
  private falseStart = false;
  private popupY = 0;
  private popupT = 0;
  private splitsShown = new Set<number>();
  private result: RaceResult | null = null;
  private tutorial = false;
  private tutText?: Phaser.GameObjects.Container;
  private tutStage = 0;

  // HUD texts
  private etText!: Phaser.GameObjects.Text;
  private gearText!: Phaser.GameObjects.Text;
  private speedText!: Phaser.GameObjects.Text;
  private nosText?: Phaser.GameObjects.Text;
  private progress!: Phaser.GameObjects.Graphics;
  private gapG!: Phaser.GameObjects.Graphics;
  private gapText!: Phaser.GameObjects.Text;
  private muteText!: Phaser.GameObjects.Text;

  constructor() {
    super('Race');
  }

  init(data: { setup?: RaceSetup; autopilot?: (sim: RaceSim) => RaceInput | null }) {
    this.autopilot = data?.autopilot ?? null;
    this.setup = data?.setup ?? game.startRace();
    this.phase = 'preroll';
    this.prerollT = 0;
    this.acc = 0;
    this.simSpeed = 1;
    this.gradesSeen = 0;
    this.notesSeen = 0;
    this.lastLights = 0;
    this.wasLaunched = false;
    this.wasNitro = false;
    this.limiterT = 0;
    this.limiterPopped = false;
    this.limiterFlameT = 0;
    this.pitch = 0;
    this.pitchVel = 0;
    this.lookAhead = 0;
    this.streak = 0;
    this.falseStart = false;
    this.popupY = 0;
    this.popupT = 0;
    this.splitsShown = new Set();
    this.result = null;
    this.tutStage = 0;
    this.tutText = undefined;
    this.nosText = undefined;
  }

  create() {
    this.sim = new RaceSim(this.setup);
    this.opp = game.currentOpponent();
    this.tutorial = game.state.history.length === 0;

    // ---- world ----
    this.track = new Track(this, TRACK_LENGTH);
    this.world = this.add.layer();
    this.ghost = makeCar(this, 0, LANE_FAR_Y, carVisualForOpponent(this.opp), CAR_SCALE);
    this.player = makeCar(this, 0, LANE_NEAR_Y, carVisualFromParts(game.state.parts), CAR_SCALE);
    this.fx = new RaceFx(this, this.world);
    this.world.add([this.ghost, this.player]);
    this.placeCars();
    this.camX = this.player.x - PLAYER_SCREEN_X;
    this.cameras.main.setScroll(this.camX, 0);

    // ---- HUD ----
    this.hud = this.add.layer();
    this.speedLines = new SpeedLines(this, this.hud);
    this.buildHud();

    this.uiCam = this.cameras.add(0, 0, GAME_W, GAME_H);
    this.cameras.main.ignore([this.hud]);
    this.uiCam.ignore([this.track.layer, this.world]);
    this.cameras.main.fadeIn(200, 11, 10, 20);
    this.uiCam.fadeIn(200, 11, 10, 20);

    // ---- input ----
    const kb = this.input.keyboard!;
    kb.addCapture('SPACE');
    kb.on('keydown-SPACE', (e: KeyboardEvent) => !e.repeat && this.press('go'));
    kb.on('keydown-N', (e: KeyboardEvent) => !e.repeat && this.press('nitro'));
    kb.on('keydown-M', () => this.showMute(toggleMute()));
    this.input.on('pointerdown', () => this.press('go'));

    unlockAudio();
    this.engine = new EngineSound();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.engine?.stop();
      this.engine = null;
    });

    if (this.tutorial) this.showTutorial('PRESS SPACE WHEN THE LIGHT TURNS GREEN', 'DONT JUMP EARLY: FALSE START = +0.3S');
  }

  // ------------------------------------------------------------------ HUD

  private buildHud() {
    const h = this.hud;
    this.tree = new LightTree(this, h, 8, 8);

    // ET + progress (top centre)
    const etBox = panel(this, 222, 6, 196, 46, PAL.panel, PAL.panelEdge);
    h.add(etBox);
    h.add(txt(this, 232, 12, 'ET', 8, PAL.inkDim));
    this.etText = fxText(this, 320, 26, '0.000', 24, PAL.ink, 4);
    h.add(this.etText);
    this.progress = this.add.graphics();
    h.add(this.progress);

    // Opponent (top right)
    const name = this.opp.name.length > 20 ? this.opp.name.slice(0, 19) + '.' : this.opp.name;
    h.add(txt(this, 632, 8, name, 8, PAL.ink, [1, 0]));
    h.add(txt(this, 632, 20, 'TARGET', 8, PAL.inkDim, [1, 0]));
    h.add(fxText(this, 632, 40, this.setup.targetEt.toFixed(3), 16, PAL.yellow, 3).setOrigin(1, 0.5));
    if (this.opp.race === 3) h.add(txt(this, 632, 54, 'BOSS', 8, PAL.red, [1, 0]));

    // Bottom panel
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

  // ------------------------------------------------------------------ input

  private press(action: 'go' | 'nitro') {
    unlockAudio();
    if (this.phase === 'done' || this.phase === 'finishing') return;
    if (this.phase === 'preroll') return; // not staged yet: ignore
    const e = this.sim.input(action);
    if (e) this.processGrades();
  }

  // ------------------------------------------------------------------ loop

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 100);
    const s = this.sim.state;

    if (this.phase === 'preroll') {
      this.prerollT += dt / 1000;
      const staged = this.prerollT > 0.35 ? (this.prerollT > 0.75 ? 2 : 1) : 0;
      if (staged > 0 && this.tree) {
        if (staged === 1 && this.prerollT - dt / 1000 <= 0.35) sfx.tick();
        if (staged === 2 && this.prerollT - dt / 1000 <= 0.75) sfx.tick();
      }
      this.tree.set(0, staged, false);
      if (this.prerollT >= PREROLL) this.phase = 'live';
    } else if (this.phase !== 'done' || s.v > 0.05) {
      this.acc += (dt / 1000) * this.simSpeed;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 40) {
        if (this.autopilot && this.phase === 'live') {
          const act = this.autopilot(this.sim);
          if (act) this.sim.input(act);
        }
        this.sim.step();
        this.acc -= SIM_DT;
        steps++;
        this.afterStep();
      }
    }

    this.renderFrame(dt);
  }

  /** Events that only the step loop can detect. */
  private afterStep() {
    const s = this.sim.state;
    if (s.lights !== this.lastLights) {
      this.lastLights = s.lights;
      if (s.lights >= 1 && s.lights <= 3) sfx.amber();
      if (s.lights === 4 && !this.falseStart) sfx.green();
    }
    if (s.grades.length > this.gradesSeen) this.processGrades();
    if (this.sim.ctx.notes.length > this.notesSeen) {
      for (let i = this.notesSeen; i < this.sim.ctx.notes.length; i++) this.passiveNote(this.sim.ctx.notes[i], i - this.notesSeen);
      this.notesSeen = this.sim.ctx.notes.length;
    }
    if (s.launched && !this.wasLaunched) this.onLaunch();
    if (s.nitroActive && !this.wasNitro) this.onNitro();
    if (!s.nitroActive && this.wasNitro) this.onNitroEnd();
    this.wasNitro = s.nitroActive;

    // limiter: bouncing flames + popup once per episode
    if (s.limiter) {
      this.limiterT += SIM_DT;
      this.limiterFlameT -= SIM_DT;
      if (this.limiterFlameT <= 0) {
        this.limiterFlameT = 0.13;
        this.player.flameBurst(90);
        sfx.backfire();
      }
      if (this.limiterT > 0.15 && !this.limiterPopped) {
        this.limiterPopped = true;
        this.carPopup('LIMITER', PAL.red, 16, 'SHIFT!');
        this.cameras.main.shake(120, 0.003);
      }
    } else {
      this.limiterT = 0;
      this.limiterPopped = false;
    }

    // distance splits
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
        const c = popup(this, this.hud, 320, 66, `${label} ${t.toFixed(3)}`, PAL.ink, 8, { rise: 8, hold: 700 });
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
    const now = this.time.now;
    if (now - this.popupT < 500) this.popupY -= 22;
    else this.popupY = 0;
    this.popupT = now;
    const sx = this.player.x - this.cameras.main.scrollX;
    popup(this, this.hud, Phaser.Math.Clamp(sx, 80, 560), 196 + Math.max(-60, this.popupY), text, color, size, { sub });
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
        this.cameras.main.shake(200, 0.006);
        break;
      case 'launch': {
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
    const s = this.sim.state;
    this.cameras.main.shake(220, 0.008);
    this.uiCam.shake(140, 0.003);
    this.pitchVel += 30;
    this.player.flameBurst(200);
    const rx = this.player.x + this.player.rearContactLocal.x * CAR_SCALE;
    this.fx.tyreSmoke(rx, LANE_NEAR_Y - 2, s.wheelspin ? 18 : 10);
    if (this.tutorial) {
      this.tutStage = 1;
      this.showTutorial('SPACE TO SHIFT WHEN THE NEEDLE', 'HITS THE GREEN BAND ON THE TACH');
    }
  }

  private onShift(e: GradeEvent) {
    sfx.shift();
    this.player.flameBurst(e.grade === 'perfect' ? 220 : 150);
    if (e.grade !== 'perfect') sfx.backfire();
    this.pitchVel -= 35;
    const ex = this.player.x + this.player.exhaustLocal.x * CAR_SCALE;
    const ey = this.player.y + this.player.exhaustLocal.y * CAR_SCALE;
    this.fx.exhaustPuff(ex, ey, 4);
    if (e.grade === 'perfect') {
      this.fx.sparkBurst(ex, ey, 8);
      this.cameras.main.shake(90, 0.003);
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
    this.player.setNitro(true);
    this.cameras.main.shake(500, 0.005);
    this.tweens.add({ targets: this.cameras.main, zoom: 1.06, duration: 250, ease: 'Quad.easeOut' });
    if (this.nosText) this.nosText.setText('NOS!!!').setColor(hex(0x9cd8ff));
  }

  private onNitroEnd() {
    this.player.setNitro(false);
    this.tweens.add({ targets: this.cameras.main, zoom: 1, duration: 400, ease: 'Quad.easeInOut' });
    if (this.nosText) this.nosText.setText('NOS EMPTY').setColor(hex(PAL.inkDim));
  }

  private passiveNote(note: string, k: number) {
    const c = popup(this, this.hud, 320, 118 + k * 14, note, PAL.pink, 8, { rise: 14, hold: 1100 });
    c.setDepth(2);
  }

  // ------------------------------------------------------------------ finish

  private onFinish() {
    this.phase = 'finishing';
    this.result = this.sim.result();
    const r = this.result;
    const outcome = game.finishRace(r);
    this.hideTutorial();

    // Slow-mo punch then ease back to normal for the coast.
    this.simSpeed = 0.15;
    this.tweens.addCounter({
      from: 0.15,
      to: 1,
      delay: 650,
      duration: 700,
      onUpdate: (tw) => (this.simSpeed = tw.getValue() ?? 1),
    });
    this.engine?.set(0.4, 0, false);

    const close = Math.abs(r.margin) < 0.1;
    const word = r.won ? 'WIN!' : 'LOSE';
    const col = r.won ? PAL.green : PAL.red;
    this.time.delayedCall(260, () => {
      stamp(this, this.hud, 320, 140, word, col, 32);
      this.time.delayedCall(120, () => {
        if (r.won) {
          sfx.win();
          this.track.cheer(3000);
          this.cameras.main.flash(160, 255, 255, 255);
        } else {
          sfx.lose();
          this.cameras.main.flash(200, 232, 65, 60);
        }
        this.cameras.main.shake(260, 0.01);
        this.uiCam.shake(200, 0.006);
      });
      const sign = r.margin >= 0 ? '-' : '+';
      const line = `${r.et.toFixed(3)}  vs  ${r.targetEt.toFixed(3)}`;
      const sub = popup(this, this.hud, 320, 182, line, PAL.ink, 16, { rise: 0, hold: 99999 });
      void sub;
      const m = popup(this, this.hud, 320, 202, `${sign}${Math.abs(r.margin).toFixed(3)} S`, col, 8, { rise: 0, hold: 99999 });
      void m;
      if (close) popup(this, this.hud, 320, 90, 'PHOTO FINISH!', PAL.yellow, 16, { rise: 0, hold: 1800 });
    });

    if (outcome.next === 'race') {
      this.time.delayedCall(1700, () => {
        stamp(this, this.hud, 320, 250, 'MULLIGAN! RERUN', PAL.purple, 24);
        sfx.slam();
      });
      this.time.delayedCall(3300, () => this.leave(true));
    } else {
      this.time.delayedCall(2600, () => this.leave(false));
    }
  }

  private leave(rerun: boolean) {
    if (this.phase === 'done') return;
    this.phase = 'done';
    this.engine?.stop();
    this.engine = null;
    this.uiCam.fadeOut(150, 11, 10, 20);
    if (rerun) {
      this.cameras.main.fadeOut(150, 11, 10, 20);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.restart({}));
    } else goToPhase(this, 150); // fades the main camera, then starts the phase's scene
  }

  // ------------------------------------------------------------------ render

  private ghostMeters(): number {
    const s = this.sim.state;
    const t = Math.max(0, s.t);
    const te = this.setup.targetEt;
    if (t <= te) return ghostX(t, te);
    // past the line: coast down
    const vEnd = ghostV(te, te);
    const dt = t - te;
    const decel = 9;
    const tStop = vEnd / decel;
    const d = Math.min(dt, tStop);
    return TRACK_LENGTH + vEnd * d - 0.5 * decel * d * d;
  }

  private placeCars() {
    const s = this.sim.state;
    const half = this.player.length; // half length * scale 2 = L
    this.player.x = Math.round(s.x * PPM - half);
    const gm = this.ghostMeters();
    this.ghost.x = Math.round(gm * PPM - this.ghost.length);
  }

  private renderFrame(dt: number) {
    const s = this.sim.state;
    const cam = this.cameras.main;
    this.placeCars();

    // camera: keep the player at a fixed screen x, sliding back a bit at speed for look-ahead
    const targetLook = Math.min(70, s.v * 1.4);
    this.lookAhead += (targetLook - this.lookAhead) * Math.min(1, dt / 400);
    this.camX = this.player.x - (PLAYER_SCREEN_X - this.lookAhead);
    cam.setScroll(Math.round(this.camX), 0);
    this.track.update(cam.scrollX, dt);
    this.track.setTreeLights(s.lights, this.falseStart);

    // tree
    if (this.phase !== 'preroll') this.tree.set(s.lights, 2, this.falseStart);

    // wheels
    const wheelRevs = (v: number, r: number) => (v * PPM) / (2 * Math.PI * r);
    const spin = s.wheelspin ? 1.8 : 1;
    const rearRevs = s.launched ? wheelRevs(Math.max(s.v, s.wheelspin ? 6 : 0), this.player.rearR) * spin : 0;
    this.player.setWheelSpin(wheelRevs(s.v, this.player.frontR), rearRevs);
    const te = this.setup.targetEt;
    let gv = s.t > 0 ? ghostV(Math.min(s.t, te), te) : 0;
    if (s.t > te) gv = Math.max(0, gv - 9 * (s.t - te));
    this.ghost.setWheelSpin(wheelRevs(gv, this.ghost.frontR));

    // body pitch spring: squat under acceleration
    const targetPitch = Phaser.Math.Clamp(s.a * 0.22, -1.5, 3) + (s.nitroActive ? 1 : 0);
    const k = 0.09,
      damp = 0.82;
    this.pitchVel = (this.pitchVel + (targetPitch - this.pitch) * k * (dt / 16)) * Math.pow(damp, dt / 16);
    this.pitch += this.pitchVel * (dt / 1000) * 10;
    this.pitch = Phaser.Math.Clamp(this.pitch, -2, 3);
    this.player.setBodyRoll(Math.round(this.pitch * 2) / 2);
    // idle shake while revving on the line
    this.player.y = LANE_NEAR_Y + (!s.launched && s.rpm > 0.3 && Math.random() < 0.3 ? -1 : 0);

    // smoke
    if (s.wheelspin || (s.launched && s.t - (s.reaction ?? 0) < 0.25 && s.v < 12)) {
      const rx = this.player.x + this.player.rearContactLocal.x * CAR_SCALE;
      if (Math.random() < 0.8) this.fx.tyreSmoke(rx, LANE_NEAR_Y - 2, 2);
    }
    if (!s.launched && s.rpm > 0.35 && Math.random() < 0.08) {
      this.fx.exhaustPuff(this.player.x + this.player.exhaustLocal.x * CAR_SCALE, this.player.y + this.player.exhaustLocal.y * CAR_SCALE, 1);
    }

    // speed lines
    const intensity = Phaser.Math.Clamp((s.v - 25) / 45, 0, 1);
    this.speedLines.update(dt, s.nitroActive ? Math.max(0.8, intensity) : intensity * 0.7, s.nitroActive);

    // HUD numbers
    const etShown = s.et ?? (s.t > 0 ? s.t + s.penalty : 0);
    this.etText.setText(etShown.toFixed(3));
    if (s.et !== null && this.result) this.etText.setColor(hex(this.result.won ? PAL.green : PAL.red));
    this.gearText.setText(String(s.gear));
    this.speedText.setText(String(Math.round(s.v * 3.6)));
    this.tach.update(s.rpm, s.shiftWindow, s.limiter, s.launched && s.gear < 4 && s.phase === 'running', dt);
    this.drawProgress();
    this.drawGap();

    if (this.engine) {
      const throttle = s.phase === 'running' && s.launched ? 1 : s.lights > 0 ? 0.5 : 0.1;
      this.engine.set(s.rpm, throttle, s.limiter, s.nitroActive);
    }
  }

  private drawGap() {
    const g = this.gapG;
    g.clear();
    const s = this.sim.state;
    if (s.t <= 0.2 || this.phase === 'done') {
      this.gapText.setText('');
      return;
    }
    const cam = this.cameras.main;
    const gsx = this.ghost.x - cam.scrollX;
    const half = this.ghost.length;
    const gap = this.ghostMeters() - s.x;
    const y = LANE_FAR_Y - 30;
    if (gsx - half > GAME_W) {
      // ghost ahead off-screen
      g.fillStyle(PAL.bgDeep, 0.8).fillRect(GAME_W - 86, y - 10, 80, 20);
      g.fillStyle(PAL.red, 1).fillTriangle(GAME_W - 4, y, GAME_W - 14, y - 8, GAME_W - 14, y + 8);
      this.gapText.setPosition(GAME_W - 50, y).setText(`+${gap.toFixed(1)}M`).setColor(hex(PAL.red));
    } else if (gsx + half < 0) {
      g.fillStyle(PAL.bgDeep, 0.8).fillRect(6, y - 10, 80, 20);
      g.fillStyle(PAL.green, 1).fillTriangle(4, y, 14, y - 8, 14, y + 8);
      this.gapText.setPosition(52, y).setText(`${gap.toFixed(1)}M`).setColor(hex(PAL.green));
    } else this.gapText.setText('');
  }
}
