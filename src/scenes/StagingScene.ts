// Staging lanes: opponent card, boss modifier, consumable toggles, and the left-to-right stat count-up.
// Bottom bar: controls (tutorial on the first race) | SKIP-for-a-tag box or boss HOW TO BEAT IT box (188,306,292,50) | RACE!
// Handoff: RACE! calls game.startRace() and starts 'Race' with { setup }.
import Phaser from 'phaser';
import type { StatBreakdownStep, StatKey } from '../core/types';
import { game } from '../game/game';
import { sfx, unlockAudio } from '../render/audio';
import { carVisualForOpponent, carVisualFromParts, makeCar } from '../render/car';
import { consumableIcon, ensureTextures } from '../render/icons';
import { fxText, popup } from '../render/fx';
import { GAME_H, GAME_W, PAL, hex } from '../render/palette';
import { burst, drawPanel, heatBadge, hitBox, panel, roundLabel, shadowTxt, shake, tagIconKey, Tooltip, txt, wrap } from '../render/ui';
import { RARITY_COLOR } from '../render/palette';
import { brandInfo, brandLogo, ownedBrands, paragonOf } from '../render/shop/factory';
import { paragonTip, brandTip } from '../render/shop/describe';
import { paragonAbility } from '../game/effects';
import { goToPhase, raceScene, runLook } from './nav';
import { ShowcaseSlot, use3D } from '../render/three/showcaseSlot';

const STATS: { key: StatKey; label: string; fmt: (v: number) => string }[] = [
  { key: 'power', label: 'POWER', fmt: (v) => String(Math.round(v)) },
  { key: 'grip', label: 'GRIP', fmt: (v) => v.toFixed(2) },
  { key: 'weight', label: 'WEIGHT', fmt: (v) => String(Math.round(v)) },
  { key: 'gearing', label: 'GEARING', fmt: (v) => v.toFixed(2) },
  { key: 'drag', label: 'DRAG', fmt: (v) => v.toFixed(2) },
];
const COL_X = [76, 196, 316, 436, 556];
const KIND_COLOR: Record<StatBreakdownStep['kind'], number> = {
  base: PAL.inkDim,
  part: PAL.teal,
  tuning: PAL.orange,
  passive: PAL.purple,
  consumable: PAL.pink,
  boss: PAL.red,
  set: PAL.yellow,
  paragon: PAL.yellow,
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
  private tip!: Tooltip;
  private skipArmed = false;
  private skipBtn: { draw: (armed: boolean) => void; c: Phaser.GameObjects.Container } | null = null;

  constructor() {
    super('Staging');
  }

  create() {
    this.leaving = false;
    this.skipArmed = false;
    this.skipBtn = null;
    this.timers = [];
    this.valueTexts = [];
    this.chipIndex = -1;
    const s = game.state;
    const op = game.currentOpponent();
    const boss = op.race === 3;
    const final = boss && safe(() => game.isFinalBoss(), false);
    ensureTextures(this);
    this.cameras.main.fadeIn(180, 11, 10, 20);
    this.add.rectangle(0, 0, GAME_W, GAME_H, PAL.bg).setOrigin(0, 0);
    // subtle checker floor
    const bgG = this.add.graphics();
    for (let y = 0; y < GAME_H; y += 16)
      for (let x = (y / 16) % 2 ? 16 : 0; x < GAME_W; x += 32) bgG.fillStyle(0x100e1c, 1).fillRect(x, y, 16, 16);

    // ---- header ----
    const hdr = txt(this, 12, 8, `${roundLabel(s.round)} - ${boss ? (final ? 'FINAL BOSS' : 'BOSS') : `RACE ${s.race + 1}/4`}`, 8, s.round > 4 ? PAL.teal : PAL.inkDim);
    if (s.heat > 0) heatBadge(this, hdr.x + hdr.width + 10, 12, s.heat);
    const cashT = txt(this, GAME_W - 12, 8, `$${s.cash}`, 8, PAL.cash, [1, 0]);
    if (s.round <= 4) txt(this, cashT.x - cashT.width - 12, 8, `${game.raceNumber()}/16`, 8, PAL.inkDim, [1, 0]);
    if (boss) {
      const mod = game.bossModifier(op.bossModifier);
      const extra = safe(() => game.previewStats().setup.boss?.extra ?? [], []).map((e) => game.bossModifier(e.modifier)?.name).filter(Boolean);
      const g = this.add.graphics();
      g.fillStyle(PAL.bgDeep, 1).fillRect(0, 22, GAME_W, 26);
      g.fillStyle(PAL.red, 1).fillRect(0, 22, GAME_W, 24);
      for (let x = 0; x < GAME_W; x += 16) g.fillStyle(0x000000, 0.18).fillTriangle(x, 22, x + 8, 22, x, 30);
      const bt = fxText(this, 320, 30, `BOSS: ${[mod?.name ?? 'BOSS', ...extra].join(' + ').toUpperCase()}`, 8, PAL.yellow, 3);
      const bd = fxText(this, 320, 40, (mod?.desc ?? '').toUpperCase(), 8, PAL.ink, 3);
      [bt, bd].forEach((t) => t.setScale(0));
      this.tweens.add({ targets: [bt, bd], scale: 1, duration: 300, delay: 200, ease: 'Back.easeOut' });
      this.tweens.add({ targets: g, alpha: { from: 1, to: 0.8 }, duration: 500, yoyo: true, repeat: -1 });
    } else {
      fxText(this, 320, 32, 'STAGING LANES', 16, PAL.ink, 4);
    }

    // ---- opponent card ----
    const opPanel = panel(this, 12, 52, 300, 152, PAL.panel, boss ? PAL.red : PAL.panelEdge);
    // 3D mode: both cars as studio showcases behind their panels, facing each other (pixel cars stay as the fallback)
    const show3d = use3D();
    const opSlot = show3d
      ? new ShowcaseSlot(this, { rect: { x: 14, y: 54, w: 296, h: 148 }, focus: { x: 40, y: 84, w: 244, h: 64 }, after: opPanel, bg: PAL.panel, glow: boss ? PAL.red : parseInt(op.car.color.slice(1), 16), facing: 'right' })
      : null;
    txt(this, 24, 60, boss ? (final ? 'FINAL BOSS' : 'BOSS') : 'OPPONENT', 8, boss ? PAL.red : PAL.inkDim);
    const name = op.name.toUpperCase();
    txt(this, 24, 72, name, name.length <= 17 ? 16 : 8, PAL.ink).setDepth(10).setShadow(2, 2, '#07060d', 0, false, true);
    const opVisual = carVisualForOpponent(op);
    const opCar = makeCar(this, 162, 136, opVisual, 2);
    opCar.setWheelSpin(0);
    opSlot?.cover(opCar);
    opSlot?.setCar(opVisual, 'none');
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
    const mePanel = panel(this, 328, 52, 300, 152);
    const meSlot = show3d
      ? new ShowcaseSlot(this, { rect: { x: 330, y: 54, w: 296, h: 148 }, focus: { x: 356, y: 70, w: 244, h: 70 }, after: mePanel, bg: PAL.panel, glow: 0x6a58b8, facing: 'left' })
      : null;
    txt(this, 340, 60, 'YOUR CAR', 8, PAL.inkDim).setDepth(10);
    const meVisual = carVisualFromParts(s.parts, runLook());
    const me = makeCar(this, 478, 134, meVisual, 2);
    me.setWheelSpin(0);
    meSlot?.cover(me);
    meSlot?.setCar(meVisual, 'none');
    this.makeBrandBadge();
    this.tweens.add({ targets: me, y: 133, duration: 100, yoyo: true, repeat: -1, repeatDelay: 400 });
    this.hintText = txt(this, 340, 142, this.consLabel(), 8, PAL.inkDim);
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
    if (s.history.length === 0) {
      // first race: the controls column becomes the tutorial
      const t1 = txt(this, 12, 312, 'SPACE ON GREEN,', 8, PAL.yellow);
      const t2 = txt(this, 12, 325, 'THEN SPACE TO SHIFT', 8, PAL.yellow);
      const t3 = txt(this, 12, 338, 'IN THE GREEN BAND', 8, PAL.yellow);
      this.tweens.add({ targets: [t1, t2, t3], alpha: 0.55, duration: 500, yoyo: true, repeat: -1 });
    } else {
      txt(this, 12, 314, 'SPACE LAUNCH/SHIFT', 8, PAL.ink);
      txt(this, 12, 328, nitro ? 'N     NITROUS' : 'M     MUTE', 8, nitro ? PAL.blue : PAL.inkDim);
      if (nitro) txt(this, 12, 342, 'M     MUTE', 8, PAL.inkDim);
    }
    this.tip = new Tooltip(this);
    if (boss) this.makeBossHint(op);
    else this.makeSkip();
    this.makeRaceButton();

    // ---- input ----
    const kb = this.input.keyboard!;
    kb.addCapture('SPACE');
    kb.on('keydown-SPACE', () => this.go());
    kb.on('keydown-ENTER', () => this.go());
    kb.on('keydown-ONE', () => this.toggle(0));
    kb.on('keydown-TWO', () => this.toggle(1));
    kb.on('keydown-THREE', () => this.toggle(2));
    kb.on('keydown-FOUR', () => this.toggle(3));
    kb.on('keydown-S', () => !boss && this.skipClick());
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
    const n = Math.max(2, s.consumableSlots ?? 2, s.consumables.length);
    const cw = Math.floor((278 - (n - 1) * 6) / n);
    const small = n > 2;
    for (let i = 0; i < n; i++) {
      const id = s.consumables[i];
      const x = 340 + i * (cw + 6);
      const y = 156;
      if (!id) {
        const g = this.add.graphics();
        g.lineStyle(2, PAL.panelLight, 1).strokeRect(x + 1, y + 1, cw - 2, 38);
        c.add([g, txt(this, x + cw / 2, y + 20, small ? '-' : 'EMPTY', 8, PAL.panelLight, [0.5, 0.5])]);
        continue;
      }
      const def = game.consumable(id);
      const on = game.isConsumableStaged(i);
      const lift = on ? -3 : 0;
      const card = this.add.container(x, y + lift);
      const g = this.add.graphics();
      g.fillStyle(PAL.bgDeep, 1).fillRect(2, 2 - lift, cw, 40);
      g.fillStyle(on ? PAL.pink : PAL.panelEdge, 1).fillRect(0, 0, cw, 40);
      g.fillStyle(on ? 0x3a1f3a : PAL.panelLight, 1).fillRect(2, 2, cw - 4, 36);
      const nm = def.name.toUpperCase();
      card.add(g);
      if (small) {
        card.add([
          this.add.image(cw - 16, 20, consumableIcon(this, def.id, def.name)).setScale(2),
          txt(this, 6, 8, String(i + 1), 8, PAL.ink),
          txt(this, 6, 24, on ? 'ON' : 'OFF', 8, on ? PAL.pink : PAL.inkDim),
        ]);
      } else {
        card.add([txt(this, 8, 8, `${i + 1} ${nm.slice(0, Math.floor((cw - 24) / 8))}`, 8, PAL.ink), txt(this, 8, 24, on ? 'USING' : 'OFF', 8, on ? PAL.pink : PAL.inkDim)]);
      }
      card.setSize(cw, 40);
      hitBox(card, 0, 0, cw, 40);
      card.on('pointerup', () => this.toggle(i));
      card.on('pointerover', () => this.hintText.setText(wrap(`${nm}: ${def.desc}`.toUpperCase(), 34, 1)).setColor(hex(PAL.pink)));
      card.on('pointerout', () => this.hintText.setText(this.consLabel()).setColor(hex(PAL.inkDim)));
      c.add(card);
      if (on) this.tweens.add({ targets: card, angle: { from: -1.5, to: 1.5 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }
  }

  private consLabel() {
    const n = Math.min(4, Math.max(2, game.state.consumableSlots ?? 2));
    return 'CONSUMABLES  ' + Array.from({ length: n }, (_, i) => `[${i + 1}]`).join(' ');
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
      const mult = (step.kind === 'passive' || step.kind === 'consumable' || step.kind === 'boss' || step.kind === 'set' || step.kind === 'paragon') && a !== 0 && Math.abs(b / a - 1) > 0.001;
      const delta = b - a;
      const label = mult
        ? `x${(b / a).toFixed(2)}`
        : `${delta > 0 ? '+' : '-'}${st.key === 'power' || st.key === 'weight' ? Math.round(Math.abs(delta)) : Math.abs(delta).toFixed(2)}`;
      popup(this, null, COL_X[i], 262, label, better(st.key, delta) ? PAL.green : PAL.red, 8, { rise: 18, hold: 420 });
    });
    if (any) sfx.tick();
    if (step.kind === 'paragon' || step.kind === 'set') {
      // set bonuses and the paragon get a stamp of their own in the count-up
      const para = step.kind === 'paragon';
      const col = para ? PAL.yellow : brandInfo(this.stepBrand(step.source))?.color ?? PAL.yellow;
      const t = shadowTxt(this, 320, 238, para ? 'PARAGON!' : 'SET BONUS!', para ? 16 : 8, col, [0.5, 0.5]).setDepth(30);
      t.setScale(2.4).setAngle(-4);
      this.tweens.add({ targets: t, scale: 1, duration: 200, ease: 'Back.easeOut' });
      this.tweens.add({ targets: t, alpha: 0, y: 228, delay: Math.max(300, interval * 2), duration: 260, onComplete: () => t.destroy() });
      burst(this, 320, 238, [col, PAL.ink, PAL.yellow], para ? 30 : 14, para ? 140 : 80, 31);
      if (para) {
        this.cameras.main.shake(140, 0.006);
        sfx.perfect();
      }
    }
  }

  /** Brand id from a breakdown source like 'MALIBRU SET (4)' or 'PARAGON: MALIBRU SS'. */
  private stepBrand(source: string): string | null {
    const u = source.toUpperCase();
    for (const r of ownedBrands(game.state.parts)) {
      const b = brandInfo(r.id);
      if (b && (u.includes(b.name.toUpperCase()) || u.includes(r.id.toUpperCase()))) return r.id;
    }
    return null;
  }

  /** YOUR CAR panel: the active paragon (name + signature ability), else the best set in progress. */
  private makeBrandBadge() {
    const s = game.state;
    const pid = safe(() => game.activeParagon(), null);
    const owned = ownedBrands(s.parts);
    if (pid) {
      // header row, right of YOUR CAR: [PARAGON|NAME], then the signature ability name under it (desc on hover)
      const b = brandInfo(pid);
      const para = paragonOf(pid);
      const abil = paragonAbility(para?.ability);
      const col = b?.color ?? PAL.yellow;
      const name = (para?.name ?? `${b?.name ?? pid} paragon`).toUpperCase().slice(0, 18);
      const x = 414;
      const w = name.length * 8 + 70;
      const g = this.add.graphics().setDepth(10);
      g.fillStyle(PAL.bgDeep, 1).fillRect(x + 2, 57 + 2, w, 14);
      g.fillStyle(PAL.yellow, 1).fillRect(x, 57, w, 14);
      g.fillStyle(col, 1).fillRect(x + 62, 58, w - 63, 12);
      txt(this, x + 4, 64, 'PARAGON', 8, PAL.bgDeep, [0, 0.5]).setDepth(11);
      txt(this, x + 66, 64, name, 8, b?.ink ?? PAL.ink, [0, 0.5]).setDepth(11);
      const ab = txt(this, 340, 74, `SIGNATURE: ${(abil?.name ?? para?.ability ?? '').toUpperCase()}`.slice(0, 34), 8, PAL.yellow).setDepth(10);
      ab.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
      this.tweens.add({ targets: g, alpha: { from: 1, to: 0.8 }, duration: 500, yoyo: true, repeat: -1 });
      const z = this.add.zone(340, 56, 288, 28).setOrigin(0, 0).setInteractive();
      z.on('pointerover', () => {
        const t = safe(() => paragonTip(pid), null);
        if (t) this.tip.show({ x: 340, y: 56, w: 288, h: 28 }, t.title, t.color, t.lines, z);
      });
      z.on('pointerout', () => this.tip.hide(z));
      return;
    }
    const top = owned[0];
    if (!top || top.n < 2) return;
    const b = brandInfo(top.id);
    if (!b) return;
    brandLogo(this, 419, 64, top.id, 10).forEach((o) => (o as unknown as Phaser.GameObjects.Components.Depth).setDepth?.(10));
    const lvl = top.n >= 8 ? 'SET 8' : top.n >= 4 ? 'SET 4' : 'SET';
    txt(this, 428, 60, `${b.name.toUpperCase()} ${lvl} ${top.n}/12`, 8, b.color === PAL.bgDeep ? PAL.ink : b.color).setDepth(10);
    const z = this.add.zone(412, 56, 210, 14).setOrigin(0, 0).setInteractive();
    z.on('pointerover', () => {
      const t = safe(() => brandTip(top.id), null);
      if (t) this.tip.show({ x: 412, y: 56, w: 210, h: 14 }, t.title, t.color, t.lines, z);
    });
    z.on('pointerout', () => this.tip.hide(z));
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
    const bcol = step.kind === 'set' ? brandInfo(this.stepBrand(step.source))?.color : undefined;
    this.kindText.setText(kind).setColor(hex(step.disabled ? PAL.panelEdge : bcol ?? KIND_COLOR[step.kind] ?? PAL.inkDim));
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
      const col = st.disabled ? PAL.panelEdge : KIND_COLOR[st.kind] ?? PAL.inkDim;
      const active = k === this.chipIndex;
      g.fillStyle(PAL.bgDeep, 1).fillRect(x, y + 1, w - 3, 9);
      g.fillStyle(reached ? col : 0x2a2440, 1).fillRect(x, y - (active ? 2 : 0), w - 3, 8);
      if (active) g.fillStyle(0xffffff, 0.6).fillRect(x, y - 2, w - 3, 2);
      if (st.disabled && reached) {
        g.fillStyle(PAL.red, 1).fillRect(x + Math.floor((w - 3) / 2) - 1, y - 1, 2, 10);
      }
    }
  }

  // ------------------------------------------------------------------ boss hint / skip

  /** Boss races: the modifier's "how to beat it", big and clear, right next to RACE!. */
  private makeBossHint(op: ReturnType<typeof game.currentOpponent>) {
    const bd = op.bossId ? safe(() => game.boss(op.bossId!) as { hint?: string }, null) : null;
    const mod = game.bossModifier(op.bossModifier);
    const hint = bd?.hint ?? mod?.hint ?? mod?.desc ?? '';
    const x = 188, y = 306, w = 292, h = 50;
    const g = this.add.graphics();
    drawPanel(g, x, y, w, h, 0x2a1020, PAL.yellow);
    const ex = this.add.graphics();
    ex.fillStyle(PAL.yellow, 1).fillRect(x + 8, y + 6, 10, 10);
    ex.fillStyle(PAL.bgDeep, 1).fillRect(x + 12, y + 7, 2, 5).fillRect(x + 12, y + 13, 2, 2);
    txt(this, x + 24, y + 7, 'HOW TO BEAT IT', 8, PAL.yellow);
    txt(this, x + 8, y + 20, wrap(hint.toUpperCase(), 34, 3), 8, PAL.ink).setLineSpacing(2);
    this.tweens.add({ targets: [g, ex], alpha: { from: 1, to: 0.75 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /** Regular races: skip it for the tag shown (no race, no payout, no shop). Two clicks to confirm. */
  private makeSkip() {
    const tag = safe(() => game.skipTagPreview(), null);
    if (!tag) return;
    const x = 188, y = 306, w = 292, h = 50;
    const col = RARITY_COLOR[tag.rarity] === PAL.inkDim ? PAL.teal : RARITY_COLOR[tag.rarity];
    const g = this.add.graphics();
    drawPanel(g, x, y, w, h, PAL.panel, col);
    // tag icon tile
    const tile = this.add.graphics();
    tile.fillStyle(PAL.bgDeep, 1).fillRect(x + 6, y + 9, 32, 32);
    tile.fillStyle(col, 0.25).fillRect(x + 7, y + 10, 30, 30);
    const icon = this.add.image(x + 22, y + 25, tagIconKey(this, tag.id)).setScale(2);
    this.tweens.add({ targets: icon, angle: { from: -6, to: 6 }, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    txt(this, x + 44, y + 6, 'SKIP FOR', 8, PAL.inkDim);
    txt(this, x + 116, y + 6, tag.name.toUpperCase().slice(0, 13), 8, col);
    txt(this, x + 44, y + 18, wrap(tag.desc.toUpperCase(), 23, 3), 8, PAL.ink).setLineSpacing(2);
    // button on the right
    const bx = x + w - 52, by = y + 6, bw = 46, bh = 38;
    const c = this.add.container(bx, by);
    const bg = this.add.graphics();
    const bt = txt(this, bw / 2, bh / 2, 'SKIP\n>>', 8, PAL.ink, [0.5, 0.5]).setAlign('center').setLineSpacing(4);
    bt.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
    let hover = false;
    const draw = (armed: boolean) => {
      bg.clear();
      const lift = hover ? -1 : 0;
      bg.fillStyle(PAL.bgDeep, 1).fillRect(0, 2, bw, bh);
      bg.fillStyle(armed ? PAL.yellow : PAL.orange, 1).fillRect(0, lift, bw, bh);
      bg.fillStyle(0xffffff, 0.25).fillRect(0, lift, bw, 2);
      bt.setText(armed ? 'SURE?' : 'SKIP\n>>').setColor(hex(armed ? PAL.bgDeep : PAL.ink)).setY(bh / 2 + lift);
    };
    c.add([bg, bt]);
    c.setSize(bw, bh);
    hitBox(c, 0, 0, bw, bh);
    if (c.input) c.input.cursor = 'pointer';
    c.on('pointerover', () => {
      hover = true;
      draw(this.skipArmed);
      this.tip.show({ x, y, w, h }, `SKIP: ${tag.name}`, col, [
        tag.desc,
        '',
        { t: 'No race, no payout, and no shop: straight to the next race.', c: PAL.inkDim },
        { t: 'Click twice to confirm. Key: S', c: PAL.inkDim },
      ], c);
    });
    c.on('pointerout', () => {
      hover = false;
      draw(this.skipArmed);
      this.tip.hide(c);
    });
    c.on('pointerup', () => this.skipClick());
    draw(false);
    this.skipBtn = { draw, c };
    this.skipBtn.c.setData('tag', tag);
    this.skipBtn.c.setData('icon', icon);
  }

  private skipClick() {
    if (this.leaving || !this.skipBtn) return;
    unlockAudio();
    const b = this.skipBtn;
    if (!this.skipArmed) {
      this.skipArmed = true;
      b.draw(true);
      sfx.click();
      b.c.setScale(1.15);
      this.tweens.add({ targets: b.c, scale: 1, duration: 200, ease: 'Back.easeOut' });
      this.time.delayedCall(2200, () => {
        if (this.leaving || !this.skipArmed) return;
        this.skipArmed = false;
        b.draw(false);
      });
      return;
    }
    const tag = b.c.getData('tag') as { id: string; name: string };
    const r = game.skipRace();
    if (!r.ok) {
      this.skipArmed = false;
      b.draw(false);
      shake(this, b.c, 3);
      sfx.miss();
      const t = shadowTxt(this, 334, 296, r.reason.toUpperCase().slice(0, 34), 8, PAL.red, [0.5, 0.5]).setDepth(50);
      this.tweens.add({ targets: t, alpha: 0, delay: 1200, duration: 300, onComplete: () => t.destroy() });
      return;
    }
    this.leaving = true;
    this.tip.hide();
    this.timers.forEach((t) => t.remove(false));
    this.skipAnim(tag, b.c.getData('icon') as Phaser.GameObjects.Image);
  }

  /** The tag pops out of its tile, grows in the middle of the screen, SKIPPED! stamps, then on to the next race. */
  private skipAnim(tag: { id: string; name: string }, icon: Phaser.GameObjects.Image) {
    sfx.slam();
    this.cameras.main.shake(140, 0.005);
    const scrim = this.add.rectangle(0, 0, GAME_W, GAME_H, PAL.bgDeep, 0).setOrigin(0, 0).setDepth(80);
    this.tweens.add({ targets: scrim, fillAlpha: 0.75, duration: 250 });
    const big = this.add.image(icon.x, icon.y, icon.texture.key).setScale(2).setDepth(90);
    const glow = this.add.graphics().setDepth(89);
    icon.setVisible(false);
    this.tweens.add({
      targets: big,
      x: 320,
      y: 160,
      scale: 6,
      angle: 360,
      duration: 520,
      ease: 'Back.easeOut',
      onComplete: () => {
        sfx.perfect();
        burst(this, 320, 160, [PAL.yellow, PAL.ink, PAL.teal, PAL.pink], 40, 200, 95);
        glow.fillStyle(PAL.yellow, 0.18).fillCircle(320, 160, 52);
        this.tweens.add({ targets: glow, alpha: { from: 1, to: 0.4 }, duration: 300, yoyo: true, repeat: -1 });
        this.tweens.add({ targets: big, y: 154, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        const st = fxText(this, 320, 82, 'SKIPPED!', 24, PAL.orange, 5).setDepth(95).setScale(3).setAlpha(0).setAngle(-8);
        this.tweens.add({ targets: st, scale: 1, alpha: 1, angle: -4, duration: 220, ease: 'Back.easeOut' });
        const nm = fxText(this, 320, 222, `+ ${tag.name.toUpperCase()}`, 16, PAL.yellow, 4).setDepth(95).setAlpha(0);
        this.tweens.add({ targets: nm, alpha: 1, y: 216, duration: 260, delay: 160 });
        const nxt = fxText(this, 320, 244, 'TAG HELD UNTIL IT TRIGGERS', 8, PAL.inkDim, 3).setDepth(95).setAlpha(0);
        this.tweens.add({ targets: nxt, alpha: 1, duration: 200, delay: 360 });
        this.time.delayedCall(1300, () => goToPhase(this, 220));
      },
    });
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
    hitBox(c, 0, 0, w, h);
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
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(raceScene(), { setup }));
    });
  }
}


function safe<T>(fn: () => T, dflt: T): T {
  try {
    return fn();
  } catch {
    return dflt;
  }
}
