// Title: wobbling chunky logo, a light tree that keeps launching a car down the strip,
// New Run (-> RunSetup: car, heat, seed) / Continue / How to play / Paint shop, plus a subtle meta progress line.
//
// LAYOUT (640x360)
//   light tree   x 40..80, y 40..160 (left)       logo "REVLOTTO" 32px, letters x 176+36i, y 52
//   subtitle y 96, progress line y 108             buttons x 240..400: NEW RUN y124, CONTINUE y160
//   HOW TO PLAY (240,y+8,160,20)  PAINT SHOP (+26)  key hint below
//   road y 296..360 with a car launching at ground y 334
//   GRAPHICS 2D/3D switch (right column, cx 540): label y 122, switch 128x24 at y 134, QUALITY y 170 + LOW/MED/HIGH y 182
import Phaser from 'phaser';
import { game, hasSavedRun, loadSavedRun } from '../game/game';
import { goToPhase } from './nav';
import { GAME_W, PAL, hex } from '../render/palette';
import { burst, button, drawFlame, drawPanel, heatColor, hitBox, pop, sfx, shadowTxt, shake, txt, type Button } from '../render/ui';
import { ensureTextures } from '../render/icons';
import { carVisualForOpponent, carVisualFromParts, makeCar } from '../render/car';
import { loadLook } from '../game/cosmetics';
import { settings, type Quality } from '../game/settings';
import { preloadShowcase, webgl2Ok } from '../render/three/showcaseSlot';

const LOGO = 'REVLOTTO';
const LOGO_COLORS = [PAL.yellow, PAL.yellow, PAL.orange, PAL.orange, PAL.red, PAL.red, PAL.pink, PAL.pink];

export class TitleScene extends Phaser.Scene {
  private letters: { top: Phaser.GameObjects.Text; mid: Phaser.GameObjects.Text; sh: Phaser.GameObjects.Text; x: number }[] = [];
  private help: Phaser.GameObjects.Container | null = null;
  private treeG: Phaser.GameObjects.Graphics | null = null;
  private road!: Phaser.GameObjects.Graphics;
  private roadOff = 0;
  private t0 = 0;
  private starting = false;

  constructor() {
    super('Title');
  }

  create() {
    this.letters = [];
    this.help = null;
    this.starting = false;
    this.t0 = this.time.now;
    ensureTextures(this);
    this.cameras.main.fadeIn(250, 11, 10, 20);

    // sky gradient bands
    const sky = this.add.graphics();
    const bands = [0x07060d, 0x0b0a14, 0x110e20, 0x17122b, 0x1f1636, 0x2a1840, 0x3a1a44];
    bands.forEach((c, i) => sky.fillStyle(c, 1).fillRect(0, i * 42, GAME_W, 42));
    // distant city / grandstand silhouettes
    sky.fillStyle(0x140f24, 1);
    for (let x = 0; x < GAME_W; x += 24) {
      const h = 20 + ((x * 37) % 40);
      sky.fillRect(x, 296 - h, 22, h);
    }
    sky.fillStyle(PAL.yellow, 0.5);
    for (let x = 6; x < GAME_W; x += 24) for (let y = 300 - 50; y < 290; y += 8) if ((x * 7 + y * 3) % 5 === 0) sky.fillRect(x, y, 2, 2);
    this.road = this.add.graphics();

    // logo
    LOGO.split('').forEach((ch, i) => {
      const x = 176 + i * 36;
      const sh = txt(this, x + 3, 55, ch, 32, PAL.bgDeep, [0, 0]);
      const mid = txt(this, x + 2, 54, ch, 32, PAL.red, [0, 0]);
      const top = txt(this, x, 52, ch, 32, LOGO_COLORS[i], [0, 0]);
      this.letters.push({ top, mid, sh, x });
    });
    shadowTxt(this, 320, 96, 'A DRAG RACING ROGUELIKE', 8, PAL.inkDim, [0.5, 0]);

    // light tree
    this.treeG = this.add.graphics();

    // buttons
    const saved = safe(() => hasSavedRun(), false);
    const newBtn = button(this, 240, 124, 160, 28, 'NEW RUN', () => this.startNew(), PAL.red, 16);
    let y = 160;
    let contBtn: Button | null = null;
    if (saved) {
      contBtn = button(this, 240, y, 160, 28, 'CONTINUE', () => this.continueRun(), PAL.blue, 16);
      y += 36;
    }
    void contBtn;
    y += 8;
    button(this, 240, y, 160, 20, 'HOW TO PLAY', () => this.toggleHelp(), PAL.purple);
    y += 26;
    button(this, 240, y, 160, 20, 'PAINT SHOP', () => this.openGarage(), PAL.orange);
    txt(this, 320, y + 28, 'ENTER: NEW RUN  H: HELP  G: PAINT', 8, PAL.inkDim, [0.5, 0]);
    pop(this, newBtn.container, 1.1, 300);
    this.drawProgress();
    this.buildGraphicsToggle();

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      if (this.help) {
        this.toggleHelp();
        return;
      }
      if (e.key === 'Enter') this.startNew();
      else if (e.key === 'h' || e.key === 'H') this.toggleHelp();
      else if (e.key === 'g' || e.key === 'G') this.openGarage();
      else if ((e.key === 'c' || e.key === 'C') && saved) this.continueRun();
    });

    this.runAttract();
  }

  /**
   * GRAPHICS: a chunky 2D/3D switch (3D wears a NEW! chip) plus a LOW/MED/HIGH quality row while 3D is on.
   * Persisted in settings; without WebGL2 the 3D half reads NOT SUPPORTED and the switch stays on 2D.
   */
  private buildGraphicsToggle() {
    const CX = 540;
    const W = 128;
    const H = 24;
    const X = CX - W / 2;
    const Y = 134;
    const ok = webgl2Ok();
    if (!ok && settings.renderMode() === '3d') settings.setRenderMode('2d');
    if (ok) preloadShowcase();
    shadowTxt(this, CX, 122, 'GRAPHICS', 8, PAL.inkDim, [0.5, 0]);
    const sw = this.add.container(X, Y);
    const g = this.add.graphics();
    const knob = this.add.graphics();
    const l2 = txt(this, W / 4, H / 2, '2D', 8, PAL.ink, [0.5, 0.5]);
    const l3 = txt(this, (W * 3) / 4, H / 2, ok ? '3D' : 'N/A', 8, PAL.ink, [0.5, 0.5]);
    for (const l of [l2, l3]) l.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
    sw.add([g, knob, l2, l3]);
    sw.setSize(W, H);
    hitBox(sw, 0, 0, W, H);
    if (sw.input) sw.input.cursor = 'pointer';
    // the NEW! chip on the 3D half (tilted sticker, gently pulsing)
    const chip = this.add.container(X + W - 6, Y - 2);
    const cg = this.add.graphics();
    cg.fillStyle(PAL.bgDeep, 1).fillRect(-17, -5, 36, 12);
    cg.fillStyle(PAL.yellow, 1).fillRect(-18, -6, 36, 12);
    cg.fillStyle(0xffffff, 0.35).fillRect(-18, -6, 36, 1);
    chip.add([cg, txt(this, 0, 0, 'NEW!', 8, PAL.bgDeep, [0.5, 0.5])]);
    chip.setAngle(8);
    this.tweens.add({ targets: chip, scale: 1.12, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    if (!ok) {
      chip.setVisible(false);
      const ns = this.add.container(CX, Y + H + 12);
      const ng = this.add.graphics();
      const nt = txt(this, 0, 0, 'NOT SUPPORTED', 8, PAL.ink, [0.5, 0.5]);
      const nw = Math.ceil(nt.width) + 12;
      ng.fillStyle(PAL.bgDeep, 1).fillRect(-nw / 2 + 2, -5, nw, 12);
      ng.fillStyle(PAL.red, 1).fillRect(-nw / 2, -7, nw, 12);
      ns.add([ng, nt]);
    }

    let hover = false;
    let kx = settings.renderMode() === '3d' ? W / 2 : 0;
    const draw = () => {
      const on3 = settings.renderMode() === '3d';
      g.clear();
      g.fillStyle(PAL.bgDeep, 1).fillRect(2, 2, W, H); // drop shadow
      g.fillStyle(hover ? PAL.panelLight : PAL.panelEdge, 1).fillRect(0, 0, W, H);
      g.fillStyle(PAL.bgDeep, 1).fillRect(2, 2, W - 4, H - 4);
      if (!ok) for (let x = W / 2 + 4; x < W - 4; x += 6) g.fillStyle(PAL.panel, 1).fillRect(x, 4, 2, H - 8);
      knob.clear();
      const col = on3 ? PAL.teal : PAL.orange;
      knob.fillStyle(0x000000, 0.35).fillRect(kx + 3, 5, W / 2 - 4, H - 6);
      knob.fillStyle(col, 1).fillRect(kx + 2, 2, W / 2 - 4, H - 4);
      knob.fillStyle(0xffffff, hover ? 0.35 : 0.22).fillRect(kx + 2, 2, W / 2 - 4, 2);
      knob.fillStyle(0x000000, 0.2).fillRect(kx + 2, H - 4, W / 2 - 4, 2);
      l2.setColor(hex(on3 ? PAL.inkDim : PAL.ink));
      l3.setColor(hex(!ok ? PAL.panelEdge : on3 ? PAL.ink : PAL.inkDim));
    };
    // quality row (only while 3D is on)
    const qual = this.add.container(0, 0);
    qual.add(shadowTxt(this, CX, 168, 'QUALITY', 8, PAL.inkDim, [0.5, 0]));
    const QS: [Quality, string][] = [['low', 'LOW'], ['medium', 'MED'], ['high', 'HIGH']];
    const qDraw: (() => void)[] = [];
    QS.forEach(([q, label], i) => {
      const bw = 40;
      const bx = X + i * (bw + 4);
      const c = this.add.container(bx, 180);
      const bg = this.add.graphics();
      const t = txt(this, bw / 2, 8, label, 8, PAL.ink, [0.5, 0.5]);
      t.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
      c.add([bg, t]);
      c.setSize(bw, 16);
      hitBox(c, 0, 0, bw, 16);
      if (c.input) c.input.cursor = 'pointer';
      let hv = false;
      const d = () => {
        const sel = settings.get().quality === q;
        const lift = hv && !sel ? -1 : 0;
        bg.clear();
        bg.fillStyle(PAL.bgDeep, 1).fillRect(0, 2, bw, 16);
        bg.fillStyle(sel ? PAL.yellow : PAL.panelLight, 1).fillRect(0, lift, bw, 16);
        bg.fillStyle(0xffffff, sel ? 0.3 : hv ? 0.2 : 0.1).fillRect(0, lift, bw, 2);
        t.setY(8 + lift).setColor(hex(sel ? PAL.bgDeep : PAL.ink)).setShadow(sel ? 0 : 1, sel ? 0 : 1, hex(PAL.bgDeep), 0, false, true);
      };
      qDraw.push(d);
      c.on('pointerover', () => ((hv = true), d(), sfx('hover')));
      c.on('pointerout', () => ((hv = false), d()));
      c.on('pointerup', () => {
        if (settings.get().quality === q) return;
        settings.setQuality(q);
        sfx('click');
        qDraw.forEach((f) => f());
        pop(this, c, 1.15, 180);
      });
      d();
      qual.add(c);
    });
    const showQual = (on: boolean, anim: boolean) => {
      this.tweens.killTweensOf(qual);
      if (!anim) return void qual.setAlpha(on ? 1 : 0).setY(0).setVisible(on);
      qual.setVisible(true);
      this.tweens.add({ targets: qual, alpha: on ? 1 : 0, y: on ? 0 : -6, duration: 160, ease: 'Cubic.easeOut', onComplete: () => qual.setVisible(on) });
    };
    sw.on('pointerover', () => ((hover = true), draw(), sfx('hover')));
    sw.on('pointerout', () => ((hover = false), draw()));
    sw.on('pointerup', () => {
      if (!ok) {
        sfx('error');
        shake(this, sw, 3);
        return;
      }
      const to3 = settings.renderMode() !== '3d';
      settings.setRenderMode(to3 ? '3d' : '2d');
      const k = { x: kx };
      this.tweens.add({ targets: k, x: to3 ? W / 2 : 0, duration: 150, ease: 'Back.easeOut', onUpdate: () => ((kx = k.x), draw()), onComplete: () => ((kx = k.x), draw()) });
      draw();
      showQual(to3, true);
      if (to3) {
        sfx('pick');
        preloadShowcase();
        pop(this, chip, 1.5, 300);
        burst(this, X + (W * 3) / 4, Y + H / 2, [PAL.teal, PAL.ink, PAL.blue], 18, 90, 20);
      } else sfx('click');
    });
    draw();
    showQual(settings.renderMode() === '3d', false);
  }

  /** Meta progress, kept subtle: best heat unlocked, runs won, furthest endless round. */
  private drawProgress() {
    const m = safe(() => game.meta(), null);
    if (!m) return;
    const parts: string[] = [];
    // heat is earned per car, so the summary is the highest heat beaten with any car
    const topHeat = Math.max(-1, ...Object.values(m.bestHeatByCar));
    if (topHeat >= 0) parts.push(`TOP HEAT ${topHeat} BEATEN`);
    if (m.runsWon > 0) parts.push(`${m.runsWon} WIN${m.runsWon === 1 ? '' : 'S'}`);
    if (m.bestEndlessRound > 4) parts.push(`ENDLESS RND ${m.bestEndlessRound}`);
    if (!parts.length) return;
    const t = txt(this, 320, 108, parts.join('  -  '), 8, PAL.panelEdge, [0.5, 0]);
    if (topHeat >= 0) {
      const g = this.add.graphics();
      drawFlame(g, Math.round(t.x - t.width / 2) - 12, 107, heatColor(Math.max(1, topHeat)));
    }
  }

  private startNew() {
    if (this.starting) return;
    this.starting = true;
    sfx('pick');
    this.cameras.main.fadeOut(200, 11, 10, 20);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('RunSetup'));
  }

  private openGarage() {
    if (this.starting) return;
    this.starting = true;
    sfx('click');
    this.cameras.main.fadeOut(150, 11, 10, 20);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Garage', { from: 'Title' }));
  }

  private continueRun() {
    if (this.starting) return;
    if (!safe(() => loadSavedRun(), false)) {
      const t = txt(this, 320, 150, 'NO SAVED RUN', 8, PAL.red, [0.5, 0.5]);
      shake(this, t, 3);
      this.time.delayedCall(1200, () => t.destroy());
      return;
    }
    this.starting = true;
    sfx('pick');
    goToPhase(this, 250);
  }

  private toggleHelp() {
    if (this.help) {
      this.help.destroy();
      this.help = null;
      return;
    }
    sfx('click');
    const c = this.add.container(0, 0).setDepth(100);
    const scrim = this.add.rectangle(0, 0, GAME_W, 360, PAL.bgDeep, 0.8).setOrigin(0, 0).setInteractive();
    scrim.on('pointerup', () => this.toggleHelp());
    const g = this.add.graphics();
    drawPanel(g, 80, 28, 480, 304);
    c.add([scrim, g]);
    c.add(shadowTxt(this, 320, 40, 'HOW TO PLAY', 16, PAL.yellow, [0.5, 0]));
    const lines: [string, number][] = [
      ['THE STRIP', PAL.orange],
      ['SPACE  launch when the tree goes GREEN', PAL.ink],
      ['SPACE  shift when the needle is in the', PAL.ink],
      ['       GREEN band (perfect = more power)', PAL.ink],
      ['N      fire nitrous (if you have a kit)', PAL.ink],
      ['Jumping the light = false start (+0.3s)', PAL.inkDim],
      ['', 0],
      ['THE RUN', PAL.orange],
      ['Beat the target ET shown before each race.', PAL.ink],
      ['ONE LOSS ENDS THE RUN.', PAL.red],
      ['4 rounds x (3 races + a boss) = 16 races.', PAL.ink],
      ['', 0],
      ['THE SHOP', PAL.orange],
      ['Wins pay cash. Buy parts, passives,', PAL.ink],
      ['consumables and packs. Passives work', PAL.ink],
      ['left to right: drag them to reorder.', PAL.ink],
    ];
    lines.forEach(([s, col], i) => {
      if (s) c.add(txt(this, 100, 66 + i * 14, s, 8, col));
    });
    c.add(txt(this, 320, 314, 'CLICK OR PRESS ANY KEY', 8, PAL.inkDim, [0.5, 0]));
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, duration: 150 });
    this.help = c;
  }

  /** Attract loop: the tree counts down, a car launches across the strip, repeat. */
  private runAttract() {
    let i = 0;
    const cars = [
      () => carVisualFromParts(game.state.parts, loadLook()),
      () => carVisualForOpponent({ car: { body: 'muscle', color: '#3c78e8', accent: '#f4ecd8' }, round: 3, race: 3 }),
      () => carVisualForOpponent({ car: { body: 'wedge', color: '#9b4de0', accent: '#f7d23e' }, round: 4, race: 3 }),
      () => carVisualForOpponent({ car: { body: 'super', color: '#5ad25a', accent: '#0b0a14' }, round: 4, race: 3 }),
    ];
    const cycle = () => {
      if (!this.scene.isActive()) return;
      let car: Phaser.GameObjects.Container & { flameBurst?: (ms?: number) => unknown; setWheelSpin?: (s: number) => unknown };
      try {
        car = makeCar(this, 40, 334, cars[i % cars.length](), 2);
      } catch {
        car = this.add.container(40, 334, [this.add.rectangle(0, -10, 100, 20, PAL.red)]);
      }
      i++;
      car.setDepth(5);
      this.lightsState = 0;
      const step = (n: number) => {
        this.lightsState = n;
        if (n < 4) {
          sfx('hover');
          this.time.delayedCall(450, () => step(n + 1));
        } else {
          car.flameBurst?.(300);
          car.setWheelSpin?.(30);
          this.tweens.add({
            targets: car,
            x: 760,
            duration: 1500,
            ease: 'Cubic.easeIn',
            onUpdate: (tw) => {
              this.roadSpeed = tw.progress * 14;
            },
            onComplete: () => {
              car.destroy();
              this.roadSpeed = 0;
              this.lightsState = 0;
              this.time.delayedCall(900, cycle);
            },
          });
        }
      };
      this.time.delayedCall(800, () => step(1));
    };
    cycle();
  }

  private lightsState = 0;
  private roadSpeed = 0;

  update(time: number, dt: number) {
    const t = (time - this.t0) / 1000;
    // logo wobble + shimmer sweep
    const sweep = (t * 6) % 14;
    this.letters.forEach((L, i) => {
      const dy = Math.round(Math.sin(t * 3 + i * 0.7) * 3);
      L.top.y = 52 + dy;
      L.mid.y = 54 + dy;
      L.sh.y = 55 + dy;
      L.top.setColor(hex(Math.abs(sweep - i) < 0.8 ? PAL.ink : LOGO_COLORS[i]));
    });
    // road
    this.roadOff = (this.roadOff + this.roadSpeed * dt * 0.06) % 32;
    const r = this.road;
    r.clear();
    r.fillStyle(PAL.asphalt, 1).fillRect(0, 296, GAME_W, 64);
    r.fillStyle(PAL.asphaltLight, 1).fillRect(0, 296, GAME_W, 3);
    r.fillStyle(PAL.ink, 1).fillRect(0, 338, GAME_W, 2);
    for (let x = -32; x < GAME_W + 32; x += 32) r.fillStyle(PAL.stripe, 0.5).fillRect(Math.round(x - this.roadOff), 318, 16, 2);
    // start line
    r.fillStyle(PAL.ink, 1);
    for (let y = 300; y < 360; y += 4) r.fillRect(((y / 4) % 2) * 2 + 96, y, 2, 4);
    // light tree (left)
    const g = this.treeG!;
    g.clear();
    g.fillStyle(0x2b2547, 1).fillRect(58, 120, 4, 176);
    g.fillStyle(PAL.bgDeep, 1).fillRect(46, 120, 28, 96);
    g.fillStyle(0x2b2547, 1).fillRect(48, 122, 24, 92);
    for (let k = 0; k < 4; k++) {
      const lit = k < 3 ? this.lightsState > k && this.lightsState < 4 : this.lightsState === 4;
      const col = k < 3 ? (lit ? PAL.orange : 0x3a2a1a) : lit ? PAL.green : 0x173a1a;
      const yy = 128 + k * 22;
      g.fillStyle(PAL.bgDeep, 1).fillRect(52, yy, 16, 16);
      g.fillStyle(col, 1).fillRect(54, yy + 2, 12, 12);
      if (lit) g.fillStyle(0xffffff, 0.5).fillRect(56, yy + 4, 4, 3);
      if (lit) g.fillStyle(col, 0.25).fillRect(48, yy - 2, 24, 20);
    }
  }
}

function safe<T>(fn: () => T, dflt: T): T {
  try {
    return fn();
  } catch {
    return dflt;
  }
}
