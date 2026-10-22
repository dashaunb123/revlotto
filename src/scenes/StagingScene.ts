// Staging lanes: opponent card, boss modifier, consumable toggles, and the left-to-right stat count-up.
// Handoff: RACE! calls game.startRace() and starts 'Race' with { setup }.
import Phaser from 'phaser';
import type { StatBreakdownStep, StatKey } from '../core/types';
import { game } from '../game/game';
import { sfx, toggleMute, unlockAudio } from '../render/audio';
import { carVisualForOpponent, carVisualFromParts, makeCar } from '../render/car';
import { fxText, popup } from '../render/fx';
import { GAME_H, GAME_W, PAL, hex } from '../render/palette';
import { panel, txt } from '../render/ui';

const STATS: { key: StatKey; label: string; fmt: (v: number) => string }[] = [
  { key: 'power', label: 'POWER', fmt: (v) => String(Math.round(v)) },
  { key: 'grip', label: 'GRIP', fmt: (v) => v.toFixed(2) },
  { key: 'weight', label: 'WEIGHT', fmt: (v) => String(Math.round(v)) },
  { key: 'gearing', label: 'GEARING', fmt: (v) => v.toFixed(2) },
  { key: 'drag', label: 'DRAG', fmt: (v) => v.toFixed(2) },
];
const CONS_LABEL = 'CONSUMABLES  [1] [2]';
const COL_X = [76, 196, 316, 436, 556];
const KIND_COLOR: Record<StatBreakdownStep['kind'], number> = {
  base: PAL.inkDim,
  part: PAL.teal,
  tuning: PAL.orange,
  passive: PAL.purple,
  consumable: PAL.pink,
  boss: PAL.red,
};

function better(k: StatKey, delta: number) {
  return k === 'weight' || k === 'drag' ? delta < 0 : delta > 0;
}

export class StagingScene extends Phaser.Scene {
  private breakdown: StatBreakdownStep[] = [];
  private shown: Record<string, number> = {};
  private valueTexts: Phaser.GameObjects.Text[] = [];
  private sourceText!: Phaser.GameObjects.Text;
  private kindText!: Phaser.GameObjects.Text;
  private chips!: Phaser.GameObjects.Graphics;
  private chipIndex = -1;
  private animating = false;
  private timers: Phaser.Time.TimerEvent[] = [];
  private consumableBox!: Phaser.GameObjects.Container;
  private hintText!: Phaser.GameObjects.Text;
  private leaving = false;

  constructor() {
    super('Staging');
  }

  create() {
    this.leaving = false;
    this.timers = [];
    this.valueTexts = [];
    this.chipIndex = -1;
    const s = game.state;
    const op = game.currentOpponent();
    const boss = op.race === 3;
    this.cameras.main.fadeIn(180, 11, 10, 20);
    this.add.rectangle(0, 0, GAME_W, GAME_H, PAL.bg).setOrigin(0, 0);
    // subtle checker floor
    const bgG = this.add.graphics();
    for (let y = 0; y < GAME_H; y += 16)
      for (let x = (y / 16) % 2 ? 16 : 0; x < GAME_W; x += 32) bgG.fillStyle(0x100e1c, 1).fillRect(x, y, 16, 16);

    // ---- header ----
    txt(this, 12, 8, `ROUND ${s.round} - RACE ${s.race + 1}/4`, 8, PAL.inkDim);
    txt(this, GAME_W - 12, 8, `$${s.cash}`, 8, PAL.cash, [1, 0]);
    txt(this, GAME_W - 60, 8, `${game.raceNumber()}/16`, 8, PAL.inkDim, [1, 0]);
    if (boss) {
      const mod = game.bossModifier(op.bossModifier);
      const g = this.add.graphics();
      g.fillStyle(PAL.bgDeep, 1).fillRect(0, 22, GAME_W, 26);
      g.fillStyle(PAL.red, 1).fillRect(0, 22, GAME_W, 24);
      for (let x = 0; x < GAME_W; x += 16) g.fillStyle(0x000000, 0.18).fillTriangle(x, 22, x + 8, 22, x, 30);
      const bt = fxText(this, 320, 30, `BOSS: ${(mod?.name ?? 'BOSS').toUpperCase()}`, 8, PAL.yellow, 3);
      const bd = fxText(this, 320, 40, (mod?.desc ?? '').toUpperCase(), 8, PAL.ink, 3);
      [bt, bd].forEach((t) => t.setScale(0));
      this.tweens.add({ targets: [bt, bd], scale: 1, duration: 300, delay: 200, ease: 'Back.easeOut' });
      this.tweens.add({ targets: g, alpha: { from: 1, to: 0.8 }, duration: 500, yoyo: true, repeat: -1 });
    } else {
      fxText(this, 320, 32, 'STAGING LANES', 16, PAL.ink, 4);
    }

    // ---- opponent card ----
    panel(this, 12, 52, 300, 152, PAL.panel, boss ? PAL.red : PAL.panelEdge);
    txt(this, 24, 60, boss ? 'BOSS' : 'OPPONENT', 8, boss ? PAL.red : PAL.inkDim);
    const name = op.name.toUpperCase();
    txt(this, 24, 72, name, name.length <= 17 ? 16 : 8, PAL.ink);
    const opCar = makeCar(this, 162, 136, carVisualForOpponent(op), 2);
    opCar.setWheelSpin(0);
    this.tweens.add({ targets: opCar, y: 135, duration: 120, yoyo: true, repeat: -1, repeatDelay: 600 });
    if (op.taunt) {
      this.add
        .text(24, 146, `"${op.taunt}"`, {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: '8px',
          color: hex(PAL.inkDim),
          wordWrap: { width: 276 },
          lineSpacing: 4,
          resolution: 1,
        })
        .setOrigin(0, 0);
    }
    txt(this, 24, 184, 'TARGET ET', 8, PAL.inkDim);
    const et = fxText(this, 300, 186, op.targetEt.toFixed(3), 24, PAL.yellow, 4).setOrigin(1, 0.5);
    et.setScale(0);
    this.tweens.add({ targets: et, scale: 1, duration: 260, delay: 120, ease: 'Back.easeOut' });

    // ---- your car ----
    panel(this, 328, 52, 300, 152);
    txt(this, 340, 60, 'YOUR CAR', 8, PAL.inkDim);
    const me = makeCar(this, 478, 134, carVisualFromParts(s.parts), 2);
    me.setWheelSpin(0);
    this.tweens.add({ targets: me, y: 133, duration: 100, yoyo: true, repeat: -1, repeatDelay: 400 });
    this.hintText = txt(this, 340, 142, CONS_LABEL, 8, PAL.inkDim);
    this.consumableBox = this.add.container(0, 0);
    this.drawConsumables();

    // ---- stat breakdown ----
    panel(this, 12, 212, 616, 92);
    this.kindText = txt(this, 24, 220, '', 8, PAL.inkDim);
    this.sourceText = txt(this, 112, 220, '', 8, PAL.ink);
    this.chips = this.add.graphics();
    STATS.forEach((st, i) => {
      txt(this, COL_X[i], 254, st.label, 8, PAL.inkDim, [0.5, 0]);
      const v = fxText(this, COL_X[i], 280, '', 16, PAL.ink, 4);
      this.valueTexts.push(v);
    });

    // ---- bottom bar ----
    const nitro = game.previewStats().setup.stats.nitroPower > 0;
    txt(this, 16, 314, 'SPACE  LAUNCH / SHIFT', 8, PAL.ink);
    txt(this, 16, 328, nitro ? 'N      NITROUS (ONCE)' : 'M      MUTE', 8, nitro ? PAL.blue : PAL.inkDim);
    if (nitro) txt(this, 16, 342, 'M      MUTE', 8, PAL.inkDim);
    if (s.history.length === 0) {
      const t1 = txt(this, 196, 314, 'FIRST RACE? HIT SPACE THE', 8, PAL.yellow);
      const t2 = txt(this, 196, 328, 'INSTANT THE LIGHT IS GREEN,', 8, PAL.yellow);
      const t3 = txt(this, 196, 342, 'THEN SHIFT IN THE GREEN BAND', 8, PAL.yellow);
      this.tweens.add({ targets: [t1, t2, t3], alpha: 0.55, duration: 500, yoyo: true, repeat: -1 });
    }
    this.makeRaceButton();

    // ---- input ----
    const kb = this.input.keyboard!;
    kb.addCapture('SPACE');
    kb.on('keydown-SPACE', () => this.go());
    kb.on('keydown-ENTER', () => this.go());
    kb.on('keydown-ONE', () => this.toggle(0));
    kb.on('keydown-TWO', () => this.toggle(1));
    kb.on('keydown-M', () => toggleMute());
    this.input.on('pointerdown', () => unlockAudio());

    this.loadBreakdown(true);
  }

  // ------------------------------------------------------------------ consumables

  private drawConsumables() {
    const c = this.consumableBox;
    c.removeAll(true);
    const s = game.state;
    if (s.consumables.length === 0) {
      c.add(txt(this, 478, 176, 'NONE - BUY SOME IN THE SHOP', 8, PAL.panelEdge, [0.5, 0.5]));
      return;
    }
    for (let i = 0; i < 2; i++) {
      const id = s.consumables[i];
      const x = 340 + i * 144;
      const y = 156;
      if (!id) {
        const g = this.add.graphics();
        g.lineStyle(2, PAL.panelLight, 1).strokeRect(x + 1, y + 1, 132, 38);
        c.add([g, txt(this, x + 67, y + 20, 'EMPTY', 8, PAL.panelLight, [0.5, 0.5])]);
        continue;
      }
      const def = game.consumable(id);
      const on = game.isConsumableStaged(i);
      const lift = on ? -3 : 0;
      const card = this.add.container(x, y + lift);
      const g = this.add.graphics();
      g.fillStyle(PAL.bgDeep, 1).fillRect(2, 2 - lift, 134, 40);
      g.fillStyle(on ? PAL.pink : PAL.panelEdge, 1).fillRect(0, 0, 134, 40);
      g.fillStyle(on ? 0x3a1f3a : PAL.panelLight, 1).fillRect(2, 2, 130, 36);
      const nm = def.name.toUpperCase();
      card.add([
        g,
        txt(this, 8, 8, `${i + 1} ${nm.length > 14 ? nm.slice(0, 14) : nm}`, 8, PAL.ink),
        txt(this, 8, 24, on ? 'USING' : 'OFF', 8, on ? PAL.pink : PAL.inkDim),
      ]);
      card.setSize(134, 40);
      card.setInteractive(new Phaser.Geom.Rectangle(0, 0, 134, 40), Phaser.Geom.Rectangle.Contains);
      card.on('pointerup', () => this.toggle(i));
      card.on('pointerover', () => this.hintText.setText(def.desc.toUpperCase().slice(0, 34)).setColor(hex(PAL.pink)));
      card.on('pointerout', () => this.hintText.setText(CONS_LABEL).setColor(hex(PAL.inkDim)));
      c.add(card);
      if (on) this.tweens.add({ targets: card, angle: { from: -1.5, to: 1.5 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  private toggle(i: number) {
    if (this.leaving || !game.state.consumables[i]) return;
    unlockAudio();
    game.toggleStagedConsumable(i);
    sfx.click();
    this.drawConsumables();
    this.loadBreakdown(false);
  }

  // ------------------------------------------------------------------ breakdown

  private loadBreakdown(animate: boolean) {
    this.timers.forEach((t) => t.remove(false));
    this.timers = [];
    this.breakdown = game.previewStats().breakdown;
    const steps = this.breakdown;
    if (!steps.length) return;
    if (!animate) {
      this.animating = false;
      const fin = steps[steps.length - 1];
      this.chipIndex = steps.length - 1;
      this.drawChips();
      this.setSource(fin, steps.length > 1);
      STATS.forEach((st, i) => {
        const old = this.shown[st.key];
        const nv = fin.stats[st.key];
        if (old !== undefined && st.fmt(old) !== st.fmt(nv)) this.bumpValue(i, old, nv, 200);
        else this.setValue(i, nv);
      });
      return;
    }
    this.animating = true;
    this.chipIndex = 0;
    this.setSource(steps[0], false);
    STATS.forEach((st, i) => this.setValue(i, steps[0].stats[st.key]));
    this.drawChips();
    const interval = Phaser.Math.Clamp(Math.floor(2600 / steps.length), 110, 240);
    for (let k = 1; k < steps.length; k++) {
      this.timers.push(this.time.delayedCall(350 + k * interval, () => this.playStep(k, interval)));
    }
    this.timers.push(
      this.time.delayedCall(350 + steps.length * interval + 80, () => {
        this.animating = false;
        this.finale();
      }),
    );
  }

  private playStep(k: number, interval: number) {
    const step = this.breakdown[k];
    const prev = this.breakdown[k - 1];
    this.chipIndex = k;
    this.drawChips();
    this.setSource(step, true);
    if (step.disabled) {
      sfx.miss();
      return;
    }
    let any = false;
    STATS.forEach((st, i) => {
      const a = prev.stats[st.key];
      const b = step.stats[st.key];
      if (st.fmt(a) === st.fmt(b)) return;
      any = true;
      this.bumpValue(i, a, b, interval * 0.8);
      const mult = (step.kind === 'passive' || step.kind === 'consumable' || step.kind === 'boss') && a !== 0 && Math.abs(b / a - 1) > 0.001;
      const delta = b - a;
      const label = mult
        ? `x${(b / a).toFixed(2)}`
        : `${delta > 0 ? '+' : '-'}${st.key === 'power' || st.key === 'weight' ? Math.round(Math.abs(delta)) : Math.abs(delta).toFixed(2)}`;
      popup(this, null, COL_X[i], 262, label, better(st.key, delta) ? PAL.green : PAL.red, 8, { rise: 18, hold: 420 });
    });
    if (any) sfx.tick();
  }

  private finale() {
    sfx.perfect();
    this.valueTexts.forEach((t, i) => {
      this.time.delayedCall(i * 60, () => {
        t.setScale(1.35);
        this.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
      });
    });
    const fin = this.breakdown[this.breakdown.length - 1];
    this.kindText.setText('TOTAL').setColor(hex(PAL.yellow));
    this.sourceText.setText(`${this.breakdown.length - 1} SOURCES`).setColor(hex(PAL.ink));
    void fin;
  }

  private setSource(step: StatBreakdownStep, pop: boolean) {
    const kind = step.kind.toUpperCase();
    this.kindText.setText(kind).setColor(hex(step.disabled ? PAL.panelEdge : KIND_COLOR[step.kind]));
    this.sourceText.setText(step.disabled ? `${step.source.toUpperCase()} (OFF)` : step.source.toUpperCase());
    this.sourceText.setColor(hex(step.disabled ? PAL.panelEdge : PAL.ink));
    if (pop) {
      this.sourceText.setScale(1.25);
      this.tweens.add({ targets: this.sourceText, scale: 1, duration: 140, ease: 'Back.easeOut' });
    }
  }

  private setValue(i: number, v: number) {
    const st = STATS[i];
    this.shown[st.key] = v;
    this.valueTexts[i].setText(st.fmt(v)).setColor(hex(PAL.ink));
  }

  private bumpValue(i: number, from: number, to: number, ms: number) {
    const st = STATS[i];
    const t = this.valueTexts[i];
    const good = better(st.key, to - from);
    this.shown[st.key] = to;
    this.tweens.addCounter({
      from,
      to,
      duration: Math.max(60, ms),
      ease: 'Quad.easeOut',
      onUpdate: (tw) => t.setText(st.fmt(tw.getValue() ?? to)),
      onComplete: () => t.setText(st.fmt(to)),
    });
    t.setColor(hex(good ? PAL.green : PAL.red)).setScale(1.4);
    this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.easeOut' });
    this.time.delayedCall(Math.max(200, ms + 120), () => t.setColor(hex(PAL.ink)));
  }

  private drawChips() {
    const g = this.chips;
    g.clear();
    const steps = this.breakdown;
    const n = steps.length;
    const w = Math.min(14, Math.floor(592 / Math.max(1, n)));
    for (let k = 0; k < n; k++) {
      const st = steps[k];
      const x = 24 + k * w;
      const y = 234;
      const reached = k <= this.chipIndex;
      const col = st.disabled ? PAL.panelEdge : KIND_COLOR[st.kind];
      const active = k === this.chipIndex;
      g.fillStyle(PAL.bgDeep, 1).fillRect(x, y + 1, w - 3, 9);
      g.fillStyle(reached ? col : 0x2a2440, 1).fillRect(x, y - (active ? 2 : 0), w - 3, 8);
      if (active) g.fillStyle(0xffffff, 0.6).fillRect(x, y - 2, w - 3, 2);
      if (st.disabled && reached) {
        g.fillStyle(PAL.red, 1).fillRect(x + Math.floor((w - 3) / 2) - 1, y - 1, 2, 10);
      }
    }
  }

  // ------------------------------------------------------------------ go

  private makeRaceButton() {
    const x = 488,
      y = 310,
      w = 140,
      h = 42;
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    const t = fxText(this, w / 2, h / 2, 'RACE!', 16, PAL.ink, 4);
    let hover = false;
    const draw = () => {
      g.clear();
      const lift = hover ? -2 : 0;
      g.fillStyle(PAL.bgDeep, 1).fillRect(0, 3, w, h);
      g.fillStyle(PAL.red, 1).fillRect(0, lift, w, h);
      g.fillStyle(0xffffff, 0.22).fillRect(0, lift, w, 3);
      g.fillStyle(0x000000, 0.2).fillRect(0, lift + h - 3, w, 3);
      t.setY(h / 2 + lift);
    };
    draw();
    c.add([g, t]);
    c.setSize(w, h);
    c.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    c.on('pointerover', () => ((hover = true), draw()));
    c.on('pointerout', () => ((hover = false), draw()));
    c.on('pointerup', () => this.go(true));
    this.tweens.add({ targets: t, scale: 1.12, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private go(force = false) {
    unlockAudio();
    if (this.leaving) return;
    if (this.animating && !force) {
      // first press skips the count-up
      this.loadBreakdown(false);
      this.finale();
      return;
    }
    if (game.state.phase !== 'staging' && game.state.phase !== 'race') return;
    this.leaving = true;
    this.timers.forEach((t) => t.remove(false));
    sfx.slam();
    const setup = game.startRace();
    this.cameras.main.flash(120, 255, 255, 255);
    this.cameras.main.shake(150, 0.006);
    this.time.delayedCall(140, () => {
      this.cameras.main.fadeOut(160, 11, 10, 20);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Race', { setup }));
    });
  }
}

