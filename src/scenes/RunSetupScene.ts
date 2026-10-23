// NEW RUN: pick a starting car (Balatro decks) and a heat level (stakes), optionally type a seed.
//
// LAYOUT (640x360)
//   BACK (8,8,56,16)     "NEW RUN" 24px centered y 20                       best endless (right, y 12)
//   car cards 120x96 at x 12+124i, y 40..136: name y+6, car ground y+70, heat sticker top-right
//   CAR panel (12,146)-(244,300): name 16px, rule text, best heat / best endless, or the unlock hint
//   HEAT panel (252,146)-(628,300): < N > selector, heat name, cumulative rules 1..8 at y 200+11i (41 chars)
//   SEED box (52,308,120,20)   hint y 338                                 START RUN (452,306,176,44)
import Phaser from 'phaser';
import type { CarBody, HeatDef, StartingCarDef } from '../core/types';
import { game } from '../game/game';
import { goToPhase } from './nav';
import { GAME_H, GAME_W, PAL, hex } from '../render/palette';
import { burst, button, drawFlame, drawLock, drawPanel, heatBadge, heatColor, hitBox, panel, pop, sfx, shadowTxt, shake, txt, wrap } from '../render/ui';
import { fxText } from '../render/fx';
import { ensureTextures } from '../render/icons';
import { carVisualFromParts, makeCar } from '../render/car';
import { loadLook } from '../game/cosmetics';

const CARD_W = 120;
const CARD_H = 96;
const CARD_X = (i: number) => 12 + i * 124;
const CARD_Y = 40;
const PREF_KEY = 'revlotto.setup';

function unlockText(c: StartingCarDef): string {
  const u = c.unlock;
  switch (u.kind) {
    case 'beat_round':
      return `Beat the round ${u.value ?? 1} boss once.`;
    case 'win_run':
      return 'Win a run with any car.';
    case 'win_heat':
      return `Win a run on heat ${u.value ?? 1} or higher.`;
    default:
      return 'Free.';
  }
}
function unlockShort(c: StartingCarDef): string {
  const u = c.unlock;
  if (u.kind === 'beat_round') return `BEAT ROUND ${u.value ?? 1}`;
  if (u.kind === 'win_run') return 'WIN A RUN';
  if (u.kind === 'win_heat') return `WIN HEAT ${u.value ?? 1}`;
  return '';
}

export class RunSetupScene extends Phaser.Scene {
  private cars: StartingCarDef[] = [];
  private heats: HeatDef[] = [];
  private maxHeat = 0;
  private sel = 0;
  private heat = 0;
  private seed = '';
  private seedFocus = false;
  private starting = false;
  private cardConts: Phaser.GameObjects.Container[] = [];
  private cardFrames: Phaser.GameObjects.Graphics[] = [];
  private carObjs: Phaser.GameObjects.GameObject[] = [];
  private heatObjs: Phaser.GameObjects.GameObject[] = [];
  private seedBox!: Phaser.GameObjects.Graphics;
  private seedText!: Phaser.GameObjects.Text;
  private startBtn!: ReturnType<typeof button>;

  constructor() {
    super('RunSetup');
  }

  create(data?: { seed?: string }) {
    this.starting = false;
    this.seedFocus = false;
    this.cardConts = [];
    this.cardFrames = [];
    this.carObjs = [];
    this.heatObjs = [];
    this.seed = (data?.seed ?? '').toUpperCase().slice(0, 6);
    ensureTextures(this);
    this.cameras.main.fadeIn(200, 11, 10, 20);

    this.cars = safe(() => game.startingCars(), []);
    this.heats = safe(() => game.heatLevels(), []).slice().sort((a, b) => a.level - b.level);
    this.maxHeat = Math.max(0, ...this.heats.filter((h) => h.unlocked !== false).map((h) => h.level));
    const pref = loadPref();
    const prefIdx = this.cars.findIndex((c) => c.id === pref.car && c.unlocked !== false);
    this.sel = prefIdx >= 0 ? prefIdx : Math.max(0, this.cars.findIndex((c) => c.unlocked !== false));
    this.heat = Phaser.Math.Clamp(pref.heat ?? 0, 0, this.maxHeat);

    // background: checker floor + a warm glow that scales with heat
    this.add.rectangle(0, 0, GAME_W, GAME_H, PAL.bg).setOrigin(0, 0);
    const bgG = this.add.graphics();
    for (let y = 0; y < GAME_H; y += 16)
      for (let x = (y / 16) % 2 ? 16 : 0; x < GAME_W; x += 32) bgG.fillStyle(0x100e1c, 1).fillRect(x, y, 16, 16);

    button(this, 8, 8, 56, 16, '< BACK', () => this.back(), PAL.panelLight);
    const title = fxText(this, 320, 20, 'NEW RUN', 24, PAL.yellow, 4);
    pop(this, title, 1.3, 320);
    const meta = safe(() => game.meta(), null);
    if (meta && meta.bestEndlessRound > 0) txt(this, 632, 8, `BEST ENDLESS RND ${meta.bestEndlessRound}`, 8, PAL.teal, [1, 0]);
    if (meta && meta.runsWon > 0) txt(this, 632, 20, `RUNS WON ${meta.runsWon}`, 8, PAL.inkDim, [1, 0]);

    this.cars.forEach((c, i) => this.buildCard(c, i));
    panel(this, 12, 146, 232, 154);
    panel(this, 252, 146, 376, 154);

    // seed + start
    txt(this, 12, 314, 'SEED', 8, PAL.inkDim);
    this.seedBox = this.add.graphics();
    this.seedText = txt(this, 112, 318, '', 8, PAL.ink, [0.5, 0.5]);
    const sz = this.add.zone(52, 308, 120, 20).setOrigin(0, 0).setInteractive({ cursor: 'text' });
    sz.on('pointerup', () => {
      this.seedFocus = true;
      sfx('click');
      this.drawSeed();
    });
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.seedFocus && !over.includes(sz)) {
        this.seedFocus = false;
        this.drawSeed();
      }
    });
    this.drawSeed();
    txt(this, 12, 338, '<> CAR   ^v HEAT   ENTER GO', 8, PAL.inkDim);
    this.startBtn = button(this, 452, 306, 176, 44, 'START RUN', () => this.start(), PAL.red, 16);
    this.tweens.add({ targets: this.startBtn.container, scale: { from: 1, to: 1.03 }, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });

    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => this.onKey(e));
    this.select(this.sel, false);
    this.drawHeat(false);
  }

  // ------------------------------------------------------------------ cars

  private buildCard(c: StartingCarDef, i: number) {
    const locked = c.unlocked === false;
    const x = CARD_X(i) + CARD_W / 2;
    const y = CARD_Y + CARD_H / 2;
    const cont = this.add.container(x, y);
    const frame = this.add.graphics();
    const body = this.add.graphics();
    body.fillStyle(locked ? 0x120f20 : PAL.panel, 1).fillRect(-CARD_W / 2 + 3, -CARD_H / 2 + 3, CARD_W - 6, CARD_H - 6);
    // little strip under the car
    body.fillStyle(PAL.asphalt, 1).fillRect(-CARD_W / 2 + 3, 22, CARD_W - 6, 10);
    body.fillStyle(PAL.asphaltLight, 1).fillRect(-CARD_W / 2 + 3, 22, CARD_W - 6, 1);
    cont.add([frame, body]);
    const name = txt(this, 0, -CARD_H / 2 + 7, c.name.toUpperCase(), 8, locked ? PAL.panelEdge : PAL.ink, [0.5, 0]);
    name.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
    cont.add(name);
    try {
      const look = loadLook();
      const vis = carVisualFromParts(game.state.parts, { ...look, body: c.body as CarBody });
      const car = makeCar(this, 0, 24, locked ? { ...vis, color: '#1c1830', accent: '#2b2547', rim: '#2b2547', livery: 'none', number: 0 } : vis, 1);
      car.setWheelSpin?.(0);
      cont.add(car);
    } catch {
      cont.add(this.add.rectangle(0, 14, 60, 14, locked ? 0x1c1830 : PAL.red));
    }
    if (locked) {
      const lg = this.add.graphics();
      drawLock(lg, -12, -16, PAL.inkDim, 2);
      cont.add(lg);
      cont.add(txt(this, 0, CARD_H / 2 - 12, unlockShort(c), 8, PAL.inkDim, [0.5, 0]));
    } else {
      // best heat sticker (Balatro stake sticker): top-right corner of the art
      const bh = c.bestHeat;
      if (bh !== null && bh !== undefined && bh >= 0) {
        const sg = this.add.graphics();
        const col = heatColor(bh);
        const sx = CARD_W / 2 - 24;
        const sy = -CARD_H / 2 + 18;
        sg.fillStyle(PAL.bgDeep, 1).fillRect(sx + 1, sy + 1, 20, 14);
        sg.fillStyle(col, 1).fillRect(sx, sy, 20, 14);
        sg.fillStyle(PAL.bgDeep, 1).fillRect(sx + 2, sy + 2, 8, 10);
        drawFlame(sg, sx + 2, sy + 2, PAL.orange);
        sg.fillStyle(0xffffff, 0.35).fillRect(sx, sy, 20, 1);
        cont.add([sg, txt(this, sx + 15, sy + 7, String(bh), 8, PAL.bgDeep, [0.5, 0.5])]);
        cont.setData('sticker', true);
      }
      const be = c.bestEndlessRound ?? 0;
      cont.add(txt(this, 0, CARD_H / 2 - 12, be > 4 ? `BEST RND ${be}` : '', 8, PAL.teal, [0.5, 0]));
    }
    cont.setSize(CARD_W, CARD_H);
    hitBox(cont, -CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
    if (cont.input) cont.input.cursor = 'pointer';
    cont.on('pointerover', () => {
      sfx('hover');
      if (i !== this.sel) this.tweens.add({ targets: cont, y: y - 2, duration: 100 });
    });
    cont.on('pointerout', () => i !== this.sel && this.tweens.add({ targets: cont, y, duration: 100 }));
    cont.on('pointerup', () => this.select(i, true));
    this.cardConts.push(cont);
    this.cardFrames.push(frame);
  }

  private select(i: number, juice: boolean) {
    if (!this.cars.length) return;
    this.sel = (i + this.cars.length) % this.cars.length;
    const baseY = CARD_Y + CARD_H / 2;
    this.cardConts.forEach((cont, k) => {
      const on = k === this.sel;
      const locked = this.cars[k].unlocked === false;
      const g = this.cardFrames[k];
      g.clear();
      g.fillStyle(PAL.bgDeep, 0.9).fillRect(-CARD_W / 2 + 2, -CARD_H / 2 + 3, CARD_W, CARD_H);
      g.fillStyle(on ? (locked ? PAL.red : PAL.yellow) : locked ? 0x2b2547 : PAL.panelEdge, 1).fillRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H);
      g.fillStyle(PAL.bgDeep, 1).fillRect(-CARD_W / 2 + 2, -CARD_H / 2 + 2, CARD_W - 4, CARD_H - 4);
      this.tweens.killTweensOf(cont);
      cont.setAngle(0);
      if (on) {
        this.tweens.add({ targets: cont, y: baseY - 4, duration: 140, ease: 'Back.easeOut' });
        if (!locked) this.tweens.add({ targets: cont, angle: { from: -1, to: 1 }, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      } else this.tweens.add({ targets: cont, y: baseY, duration: 120 });
    });
    if (juice) {
      const cont = this.cardConts[this.sel];
      const locked = this.cars[this.sel].unlocked === false;
      if (locked) {
        sfx('error');
        shake(this, cont, 3);
      } else {
        sfx('pick');
        pop(this, cont, 1.08, 220);
        burst(this, cont.x, cont.y + 20, [PAL.yellow, PAL.ink, PAL.orange], 14, 80, 30);
        const car = cont.list.find((o) => (o as { flameBurst?: unknown }).flameBurst) as { flameBurst?: (ms?: number) => void } | undefined;
        car?.flameBurst?.(260);
      }
    }
    this.drawCarInfo();
    this.startBtn?.setEnabled(this.cars[this.sel]?.unlocked !== false);
    savePref({ car: this.cars[this.sel]?.id, heat: this.heat });
  }

  private drawCarInfo() {
    for (const o of this.carObjs) o.destroy();
    this.carObjs = [];
    const c = this.cars[this.sel];
    if (!c) return;
    const locked = c.unlocked === false;
    const o = this.carObjs;
    o.push(txt(this, 24, 154, 'STARTING CAR', 8, PAL.inkDim));
    o.push(shadowTxt(this, 24, 168, c.name.toUpperCase(), 16, locked ? PAL.inkDim : PAL.yellow));
    o.push(txt(this, 24, 194, wrap(c.desc.toUpperCase(), 26, 5), 8, locked ? PAL.inkDim : PAL.ink).setLineSpacing(4));
    if (locked) {
      const g = this.add.graphics();
      drawLock(g, 24, 252, PAL.red);
      o.push(g, txt(this, 42, 252, 'LOCKED', 8, PAL.red), txt(this, 42, 266, wrap(unlockText(c).toUpperCase(), 23, 3), 8, PAL.ink).setLineSpacing(3));
      return;
    }
    const bh = c.bestHeat;
    const won = bh !== null && bh !== undefined && bh >= 0;
    o.push(txt(this, 24, 256, 'BEST WIN', 8, PAL.inkDim));
    if (won) o.push(heatBadge(this, 112, 260, bh!));
    else o.push(txt(this, 112, 256, 'NOT YET', 8, PAL.panelEdge));
    o.push(txt(this, 24, 274, 'BEST ENDLESS', 8, PAL.inkDim));
    const be = c.bestEndlessRound ?? 0;
    o.push(txt(this, 132, 274, be > 0 ? `ROUND ${be}` : '-', 8, be > 0 ? PAL.teal : PAL.panelEdge));
  }

  // ------------------------------------------------------------------ heat

  private setHeat(h: number) {
    if (h < 0 || h > 8) return sfx('error');
    if (h > this.maxHeat) {
      sfx('error');
      const lockRow = this.heatObjs.find((o) => o.getData?.('row') === h) as Phaser.GameObjects.Text | undefined;
      if (lockRow) shake(this, lockRow, 3);
      return;
    }
    if (h === this.heat) return;
    const up = h > this.heat;
    this.heat = h;
    sfx(up ? 'buy' : 'click');
    this.drawHeat(true);
    if (up) this.cameras.main.shake(80, 0.002 + h * 0.0005);
    savePref({ car: this.cars[this.sel]?.id, heat: this.heat });
  }

  private drawHeat(juice: boolean) {
    for (const o of this.heatObjs) o.destroy();
    this.heatObjs = [];
    const o = this.heatObjs;
    const h = this.heat;
    const col = heatColor(h);
    o.push(txt(this, 264, 154, 'HEAT', 8, PAL.inkDim));
    // selector: [<] N [>]
    const dn = button(this, 264, 166, 22, 22, '<', () => this.setHeat(this.heat - 1), PAL.panelLight);
    const upB = button(this, 332, 166, 22, 22, '>', () => this.setHeat(this.heat + 1), this.heat < this.maxHeat ? PAL.orange : PAL.panelLight);
    dn.setEnabled(h > 0);
    upB.setEnabled(h < this.maxHeat);
    o.push(dn.container, upB.container);
    const fg = this.add.graphics();
    drawPanel(fg, 290, 164, 38, 26, PAL.bgDeep, col);
    o.push(fg);
    const num = fxText(this, 309, 178, String(h), 16, col, 3);
    o.push(num);
    if (juice) pop(this, num, 1.6, 260);
    const def = this.heats.find((d) => d.level === h);
    o.push(txt(this, 366, 166, (def?.name ?? `Heat ${h}`).toUpperCase(), 8, col));
    o.push(txt(this, 366, 178, this.maxHeat > 0 ? `MAX UNLOCKED ${this.maxHeat}` : 'WIN A RUN: HEAT 1', 8, PAL.inkDim));
    // cumulative rules
    const rules = this.heats.filter((d) => d.level > 0);
    rules.forEach((d, k) => {
      const yy = 200 + k * 11;
      const active = d.level <= h;
      const locked = d.level > this.maxHeat;
      const rowCol = active ? PAL.ink : locked ? PAL.panelEdge : PAL.inkDim;
      const n = txt(this, 264, yy, String(d.level), 8, active ? heatColor(d.level) : rowCol);
      const t = txt(this, 280, yy, wrap(d.desc.toUpperCase(), 41, 1), 8, rowCol);
      t.setData('row', d.level);
      o.push(n, t);
      if (locked) {
        const lg = this.add.graphics();
        drawLock(lg, 612, yy, PAL.panelEdge, 0.6);
        o.push(lg);
      }
      if (juice && d.level === h) {
        t.setX(300).setAlpha(0);
        this.tweens.add({ targets: t, x: 280, alpha: 1, duration: 200, ease: 'Back.easeOut' });
      }
    });
  }

  // ------------------------------------------------------------------ seed / input / go

  private drawSeed() {
    const g = this.seedBox;
    g.clear();
    drawPanel(g, 52, 308, 120, 20, PAL.bgDeep, this.seedFocus ? PAL.yellow : PAL.panelEdge);
    this.seedText.setText(this.seed || this.seedFocus ? this.seed.padEnd(6, '_') : 'RANDOM');
    this.seedText.setColor(hex(this.seed ? PAL.yellow : PAL.inkDim));
  }

  private onKey(e: KeyboardEvent) {
    if (this.starting) return;
    if (this.seedFocus) {
      if (e.key === 'Backspace') this.seed = this.seed.slice(0, -1);
      else if (e.key === 'Escape') this.seedFocus = false;
      else if (e.key === 'Enter') return this.start();
      else if (/^[a-z0-9]$/i.test(e.key) && this.seed.length < 6) {
        this.seed += e.key.toUpperCase();
        sfx('hover');
      }
      this.drawSeed();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'a') this.select(this.sel - 1, true);
    else if (e.key === 'ArrowRight' || e.key === 'd') this.select(this.sel + 1, true);
    else if (e.key === 'ArrowUp' || e.key === 'w') this.setHeat(this.heat + 1);
    else if (e.key === 'ArrowDown' || e.key === 's') this.setHeat(this.heat - 1);
    else if (e.key === 'Enter') this.start();
    else if (e.key === 'Escape') this.back();
  }

  private start() {
    if (this.starting) return;
    const c = this.cars[this.sel];
    if (!c || c.unlocked === false) {
      toastLocked(this, this.startBtn.container);
      return;
    }
    this.starting = true;
    sfx('pick');
    try {
      game.abandonRun();
    } catch {
      /* optional */
    }
    savePref({ car: c.id, heat: this.heat });
    game.newRun(this.seed.length ? this.seed : undefined, { car: c.id, heat: this.heat });
    // launch: the chosen card rockets off to the right
    const cont = this.cardConts[this.sel];
    this.cameras.main.flash(120, 255, 255, 255);
    if (cont) this.tweens.add({ targets: cont, x: GAME_W + 120, angle: 0, duration: 380, ease: 'Cubic.easeIn' });
    this.time.delayedCall(200, () => goToPhase(this, 220));
  }

  private back() {
    if (this.starting) return;
    this.starting = true;
    sfx('click');
    this.cameras.main.fadeOut(150, 11, 10, 20);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Title'));
  }
}

function toastLocked(scene: Phaser.Scene, target: Phaser.GameObjects.Container) {
  shake(scene, target, 3);
  sfx('error');
  const t = shadowTxt(scene, 540, 296, 'CAR LOCKED', 8, PAL.red, [0.5, 0.5]).setDepth(50);
  scene.tweens.add({ targets: t, alpha: 0, y: 288, delay: 700, duration: 300, onComplete: () => t.destroy() });
}

function loadPref(): { car?: string; heat?: number } {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function savePref(p: { car?: string; heat?: number }) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* private mode */
  }
}

function safe<T>(fn: () => T, dflt: T): T {
  try {
    return fn();
  } catch {
    return dflt;
  }
}
